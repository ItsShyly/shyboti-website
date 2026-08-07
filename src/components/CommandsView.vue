<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted, watch, nextTick, inject, type Ref } from 'vue'
import { API } from '../api'
import { useAuth } from '../auth'
import { useI18n } from '../i18n'
import CommandEditPanel from './CommandEditPanel.vue'

const { session, channelRole } = useAuth()
const { t } = useI18n()

const canView    = computed(() => channelRole.value?.permissions.commands_view    ?? false)
const canToggle  = computed(() => channelRole.value?.permissions.commands_toggle  ?? false)
const canEdit    = computed(() => channelRole.value?.permissions.commands_edit    ?? false)
const canDelete  = computed(() => channelRole.value?.permissions.commands_delete  ?? false)

interface Command {
  name: string
  isActive: boolean
  cooldown: number
  userCooldown: number
  modOnly: boolean
  broadcasterOnly: boolean
  description: string
  argVariants: { usage: string; desc: string }[]
}

interface CustomCommand {
  name: string
  response: string
  rule: string
  alias: string
  enabled_when: string
  required_game: string
  regex1: string; regex2: string; text1: string; text2: string
  isActive: boolean
  cooldown: number
  userCooldown: number
  modOnly: boolean
  broadcasterOnly: boolean
  description: string
  arg_descs: { usage: string; desc: string }[]
}

const commands       = ref<Command[]>([])
const customCommands = ref<CustomCommand[]>([])
const prefix         = ref('+')
const loading        = ref(true)
const customLoading  = ref(false)
const search         = ref('')
const saving         = ref<string | null>(null)
const cdTimers       = ref<Record<string, ReturnType<typeof setTimeout>>>({})

// >>> Edit panel - isBuiltIn=true for hardcoded commands, false for custom
const editOpen      = ref(false)
const editingCmd    = ref('')
const editIsBuiltIn = ref(true)

// >>>  New command name input state
const creatingNew   = ref(false)
const newCmdName    = ref('')
const newCmdError   = ref('')
const newCmdInput   = ref<HTMLInputElement | null>(null)

function openEdit(name: string, builtIn: boolean) {
  editingCmd.value    = name
  editIsBuiltIn.value = builtIn
  editOpen.value      = true
}

// >>> When App.vue search selects a command, open its edit panel directly
const searchOpenEdit = inject<Ref<{ name: string; builtIn: boolean } | null>>('searchOpenEdit', ref(null))
watch(searchOpenEdit, (val) => {
  if (!val) return
  // Wait for the page to mount before opening the panel
  nextTick(() => {
    openEdit(val.name, val.builtIn)
    searchOpenEdit.value = null
  })
})

function onEditSaved() {
  fetchCommands()
  fetchCustomCommands()
}

function startCreate() {
  creatingNew.value = true
  newCmdName.value  = ''
  newCmdError.value = ''
  nextTick(() => newCmdInput.value?.focus())
}

function cancelCreate() {
  creatingNew.value = false
  newCmdName.value  = ''
  newCmdError.value = ''
}

async function confirmCreate() {
  const name = newCmdName.value.trim().toLowerCase().replace(/^\+/, '')
  if (!name) { newCmdError.value = 'Enter a name'; return }
  if (!/^[a-z0-9_]+$/.test(name)) { newCmdError.value = 'Only letters, numbers, _'; return }
  if (customCommands.value.some(c => c.name === name)) { newCmdError.value = 'Already exists'; return }
  if (commands.value.some(c => c.name === name)) { newCmdError.value = 'Name conflicts with a default command'; return }
  if (!session.value) return
  creatingNew.value = false
  await fetch(`${API}/custom-commands/${session.value.channel}/${name}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.value.token}` },
    body: JSON.stringify({ response: '', rule: '', isActive: true }),
  })
  await fetchCustomCommands()
  openEdit(name, false)
}

// >>>  Internal tab state
const activeTab = ref<'Default' | 'Custom' | 'Extras'>('Default')

// >>> Extras / Feature flags
const mentionEnabled = ref(false)
const has7tvSet      = ref(false)
const extrasLoading  = ref(false)
const extrasSaving   = ref(false)
const extrasSaved    = ref(false)

async function fetchExtras() {
  if (!session.value) return
  extrasLoading.value = true
  try {
    const res  = await fetch(`${API}/settings/${session.value.channel}`, {
      headers: { Authorization: `Bearer ${session.value.token}` }
    })
    if (!res.ok) return
    const data = await res.json() as { mention_enabled: boolean; has_7tv_set: boolean }
    mentionEnabled.value = data.mention_enabled
    has7tvSet.value      = data.has_7tv_set ?? false
  } catch {} finally { extrasLoading.value = false }
}

async function saveExtras() {
  if (!session.value) return
  extrasSaving.value = true
  try {
    await fetch(`${API}/settings/${session.value.channel}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.value.token}` },
      body: JSON.stringify({ mention_enabled: mentionEnabled.value }),
    })
    extrasSaved.value = true
    setTimeout(() => extrasSaved.value = false, 2000)
  } catch {}
  extrasSaving.value = false
}

const isBroadcaster = computed(() => channelRole.value?.role === 'broadcaster')

// >>> Expanded row tracking - one set for default, one for custom
const expandedDefault = ref<Set<string>>(new Set())
const expandedCustom  = ref<Set<string>>(new Set())

function toggleExpandDefault(name: string) {
  const s = new Set(expandedDefault.value)
  s.has(name) ? s.delete(name) : s.add(name)
  expandedDefault.value = s
}
function toggleExpandCustom(name: string) {
  const s = new Set(expandedCustom.value)
  s.has(name) ? s.delete(name) : s.add(name)
  expandedCustom.value = s
}

// >>> Auto-detect whether a custom command uses arguments by scanning its response/rule
function customHasArgs(cmd: CustomCommand): boolean {
  if (cmd.arg_descs?.length) return true
  const src = (cmd.response || '') + ' ' + (cmd.rule || '')
  return /\$args|\$\d\b|\{args\}|\$args\./i.test(src)
}

// >>> Get arg variants for a custom command:
// If the user has saved explicit arg_descs, use those; otherwise auto-generate a placeholder.
function getCustomArgVariants(cmd: CustomCommand): { usage: string; desc: string }[] {
  if (cmd.arg_descs?.length) return cmd.arg_descs
  // Auto-detect: parse $args.1, $1, $2 etc. from response to generate placeholder usages
  const src = (cmd.response || '') + ' ' + (cmd.rule || '')
  const argNums = new Set<number>()
  for (const m of src.matchAll(/\$args\.(\d+)|\$(\d+)\b/g)) {
    const n = parseInt(m[1] ?? m[2] ?? '')
    if (!isNaN(n)) argNums.add(n)
  }
  if (argNums.size > 0) {
    const max = Math.max(...argNums)
    const placeholder = Array.from({ length: max }, (_, i) => `<arg${i + 1}>`).join(' ')
    return [{ usage: placeholder, desc: '' }]
  }
  if (/\{args\}|\$args\b/i.test(src)) return [{ usage: '<args>', desc: '' }]
  return []
}

// >>> Sort state for custom commands
const sortField = ref<'name' | 'cooldown' | 'isActive'>('name')
const sortDir   = ref<'asc' | 'desc'>('asc')
function setSort(field: typeof sortField.value) {
  if (sortField.value === field) sortDir.value = sortDir.value === 'asc' ? 'desc' : 'asc'
  else { sortField.value = field; sortDir.value = 'asc' }
}

const BLOCKED     = ['join','leave','pm2','refresh','whitelist','git']
// Commands that must be at least mod - the cycle skips "everyone" for these
const MINIMUM_MOD = new Set(['nuke','pm2','refresh','join','leave','create','say','to','cmd'])
const MINIMUM_BC  = new Set(['pm2','refresh','join','leave'])

function inferCategory(name: string): string {
  const utility = ['ping','commands','join','leave','pm2','refresh','say','to','user','whitelist','git','cmd','message', 'to']
  const chat    = ['ask','song','gpt','7tv','talk','verify','shyboti','say']
  const games   = ['66','ssp','sw','bottle']
  if (utility.includes(name)) return 'utility'
  if (chat.includes(name))    return 'chat'
  if (games.includes(name))   return 'games'
  return 'fun'
}

const CAT_COLOR: Record<string, string> = {
  utility: '#7c83ff', chat: '#4ec9b0', fun: '#f9a84d', games: '#e06c75',
}

function filtered() {
  let list = commands.value.filter(c => !BLOCKED.includes(c.name))
  if (search.value.trim()) list = list.filter(c => c.name.includes(search.value.toLowerCase()))
  return list
}

function filteredCustom() {
  let list = customCommands.value
  if (search.value.trim()) list = list.filter(c => c.name.includes(search.value.toLowerCase()))
  // >>> Sort
  list = [...list].sort((a, b) => {
    let av: any = a[sortField.value], bv: any = b[sortField.value]
    if (typeof av === 'boolean') av = av ? 1 : 0
    if (typeof bv === 'boolean') bv = bv ? 1 : 0
    if (av < bv) return sortDir.value === 'asc' ? -1 : 1
    if (av > bv) return sortDir.value === 'asc' ? 1 : -1
    return 0
  })
  return list
}

async function fetchCustomCommands() {
  if (!session.value) return
  customLoading.value = true
  try {
    const res  = await fetch(`${API}/custom-commands/${session.value.channel}`, {
      headers: { Authorization: `Bearer ${session.value.token}` }
    })
    if (!res.ok) throw new Error()
    const data = await res.json() as { commands: CustomCommand[] }
    customCommands.value = data.commands.map(c => ({ ...c, isActive: !!c.isActive, modOnly: !!c.modOnly, broadcasterOnly: !!c.broadcasterOnly }))
  } catch {
    customCommands.value = []
  } finally {
    customLoading.value = false
  }
}



async function fetchCommands() {
  if (!session.value) return
  loading.value = true
  try {
    const res  = await fetch(`${API}/commands/${session.value.channel}`, {
      headers: { Authorization: `Bearer ${session.value.token}` }
    })
    if (!res.ok) throw new Error()
    const data = await res.json() as { commands: Command[]; prefix: string }
    commands.value = data.commands
    prefix.value   = data.prefix
  } catch {
    commands.value = []
  } finally {
    loading.value = false
  }
}

async function updateCommand(cmd: Command) {
  if (!session.value) return
  saving.value = cmd.name
  try {
    await fetch(`${API}/commands/${session.value.channel}/${cmd.name}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.value.token}` },
      body: JSON.stringify({
        isActive: cmd.isActive, cooldown: cmd.cooldown, userCooldown: cmd.userCooldown,
        modOnly: cmd.modOnly, broadcasterOnly: cmd.broadcasterOnly,
      }),
    })
  } finally {
    saving.value = null
  }
}

function toggle(cmd: Command | CustomCommand, field: 'isActive' | 'modOnly' | 'broadcasterOnly') {
  if (field === 'isActive' && !canToggle.value) return
  if (field !== 'isActive' && !canEdit.value) return
  ;(cmd as any)[field] = !(cmd as any)[field]
  if (customCommands.value.includes(cmd as CustomCommand)) updateCustomActive(cmd as CustomCommand)
  else updateCommand(cmd as Command)
}

function cycleRestriction(cmd: Command | CustomCommand) {
  if (!canEdit.value) return
  const c    = cmd as any
  const name = c.name as string
  const isBC  = MINIMUM_BC.has(name)
  const isMod = !isBC && MINIMUM_MOD.has(name)
  if (!c.modOnly && !c.broadcasterOnly) {
    // everyone -> mod (always allowed)
    c.modOnly = true; c.broadcasterOnly = false
  } else if (c.modOnly) {
    // mod -> broadcaster
    c.modOnly = false; c.broadcasterOnly = true
  } else {
    // broadcaster -> everyone (only if not locked)
    if (isBC)  { c.modOnly = false; c.broadcasterOnly = true  } // stay at broadcaster
    else if (isMod) { c.modOnly = true;  c.broadcasterOnly = false } // back to mod
    else        { c.modOnly = false; c.broadcasterOnly = false }   // allow everyone
  }
  if (customCommands.value.includes(cmd as CustomCommand)) updateCustomActive(cmd as CustomCommand)
  else updateCommand(cmd as Command)
}

function restrictionLabel(cmd: { modOnly: boolean; broadcasterOnly: boolean }): string {
  if (cmd.broadcasterOnly) return t('cmd.access.bc')
  if (cmd.modOnly)         return t('cmd.access.mod')
  return t('cmd.access.everyone')
}

// >>>  Use i18n description if available, fall back to backend string, then '-'
function cmdDesc(cmd: Command): string {
  const key = `cmddesc.${cmd.name}`
  const translated = t(key)
  // >>> t() returns the key itself if not found
  if (translated !== key) return translated
  return cmd.description || '-'
}

const deletingName = ref<string | null>(null)
const deleteConfirmName = ref<string | null>(null)

function deleteCustom(name: string) {
  if (deleteConfirmName.value === name) {
    // >>> second click - confirmed
    doDeleteCustom(name)
  } else {
    deleteConfirmName.value = name
    // >>> auto-cancel after 3s
    setTimeout(() => { if (deleteConfirmName.value === name) deleteConfirmName.value = null }, 3000)
  }
}

async function doDeleteCustom(name: string) {
  if (!session.value) return
  deletingName.value = name
  deleteConfirmName.value = null
  try {
    await fetch(`${API}/custom-commands/${session.value.channel}/${name}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${session.value.token}` },
    })
    await fetchCustomCommands()
  } catch {}
  deletingName.value = null
}

const customCdTimers = ref<Record<string, ReturnType<typeof setTimeout>>>({})

function onCustomCooldownInput(cmd: CustomCommand, field: 'cooldown' | 'userCooldown', raw: string) {
  if (!canEdit.value) return
  const val = parseInt(raw)
  if (isNaN(val) || val < 0) return
  cmd[field] = val
  const key = `custom_${cmd.name}_${field}`
  clearTimeout(customCdTimers.value[key])
  customCdTimers.value[key] = setTimeout(() => updateCustomActive(cmd), 600)
}

async function updateCustomActive(cmd: CustomCommand) {
  if (!session.value) return
  await fetch(`${API}/custom-commands/${session.value.channel}/${cmd.name}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.value.token}` },
    body: JSON.stringify({ ...cmd, isActive: cmd.isActive }),
  })
}

function onCooldownInput(cmd: Command, field: 'cooldown' | 'userCooldown', raw: string) {
  if (!canEdit.value) return
  const val = parseInt(raw)
  if (isNaN(val) || val < 0) return
  cmd[field] = val
  const key = `${cmd.name}_${field}`
  clearTimeout(cdTimers.value[key])
  cdTimers.value[key] = setTimeout(() => updateCommand(cmd), 600)
}

// >>> Share
const shareOpen    = ref(false)
const shareCmd     = ref('')
const shareTarget  = ref('')
const shareSaving  = ref(false)
const shareSuccess = ref('')
const shareError   = ref('')

function openShare(name: string) {
  shareCmd.value = name; shareTarget.value = ''; shareSuccess.value = ''; shareError.value = ''
  shareOpen.value = true
}

async function doShare() {
  if (!session.value || !shareTarget.value) return
  shareSaving.value = true; shareError.value = ''
  try {
    const res = await fetch(`${API}/custom-commands/${session.value.channel}/${shareCmd.value}/share`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.value.token}` },
      body: JSON.stringify({ target_channel: shareTarget.value }),
    })
    if (!res.ok) throw new Error((await res.json()).error ?? 'Failed')
    shareSuccess.value = `Copied to #${shareTarget.value}!`
    setTimeout(() => { shareOpen.value = false }, 1500)
  } catch (e: any) { shareError.value = e.message ?? 'Share failed' }
  shareSaving.value = false
}

// >>> Sync
const syncConf     = ref<{ sync_from: string; is_active: number; last_synced: number } | null>(null)
const syncOpen     = ref(false)
const syncFrom     = ref('')
const syncSaving   = ref(false)
const syncRunning  = ref(false)
const syncMsg      = ref('')

async function fetchSync() {
  if (!session.value) return
  try {
    const res = await fetch(`${API}/command-sync/${session.value.channel}`, {
      headers: { Authorization: `Bearer ${session.value.token}` }
    })
    const data = await res.json() as { sync: any }
    syncConf.value = data.sync
    syncFrom.value = data.sync?.sync_from ?? ''
  } catch {}
}

async function saveSync() {
  if (!session.value || !syncFrom.value) return
  syncSaving.value = true
  try {
    await fetch(`${API}/command-sync/${session.value.channel}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.value.token}` },
      body: JSON.stringify({ sync_from: syncFrom.value, is_active: true }),
    })
    await fetchSync()
    syncMsg.value = 'Sync config saved.'
  } catch { syncMsg.value = 'Failed to save.' }
  syncSaving.value = false
}

async function stopSync() {
  if (!session.value || !syncConf.value) return
  syncSaving.value = true
  try {
    await fetch(`${API}/command-sync/${session.value.channel}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.value.token}` },
      body: JSON.stringify({ sync_from: syncConf.value.sync_from, is_active: false }),
    })
    syncConf.value = { ...syncConf.value, is_active: 0 }
    syncMsg.value = 'Sync stopped.'
  } catch { syncMsg.value = 'Failed to stop sync.' }
  syncSaving.value = false
}

async function runSync() {
  if (!session.value) return
  syncRunning.value = true; syncMsg.value = ''
  try {
    const res  = await fetch(`${API}/command-sync/${session.value.channel}/run`, {
      method: 'POST', headers: { Authorization: `Bearer ${session.value.token}` }
    })
    const data = await res.json() as { count?: number; error?: string }
    if (!res.ok) throw new Error(data.error)
    syncMsg.value = `Synced ${data.count} commands from #${syncConf.value?.sync_from}.`
    await fetchCustomCommands()
  } catch (e: any) { syncMsg.value = e.message ?? 'Sync failed' }
  syncRunning.value = false
}

const { availableChannels } = useAuth()

// >>> Reload button + SSE-based auto-refresh when commands change in another tab/session
const reloading = ref(false)
async function reloadAll() {
  reloading.value = true
  await Promise.all([fetchCommands(), fetchCustomCommands(), fetchSync(), fetchExtras()])
  reloading.value = false
}

// >>> Auto-refresh via activity SSE: if a cmd_added/cmd_changed/cmd_removed event arrives,
// re-fetch quietly so collaborators see each other's changes without manual reload.
let _sseSource: EventSource | null = null
function startCommandSSE() {
  _sseSource?.close()
  if (!session.value?.token) return
  fetch(`${API}/activity/sse-ticket`, { method: 'POST', headers: { Authorization: `Bearer ${session.value.token}` } })
    .then(r => r.ok ? r.json() as Promise<{ ticket: string }> : Promise.reject())
    .then(({ ticket }) => {
      const ch = session.value?.channel ?? ''
      const es = new EventSource(`${API}/activity/stream?ticket=${ticket}&channel=${ch}`)
      _sseSource = es
      es.onmessage = (e) => {
        try {
          const ev = JSON.parse(e.data) as { type: string }
          if (ev.type?.startsWith('cmd_')) { fetchCommands(); fetchCustomCommands() }
        } catch {}
      }
      es.onerror = () => { es.close(); setTimeout(startCommandSSE, 10_000) }
    })
    .catch(() => {})
}

onMounted(() => { fetchCommands(); fetchCustomCommands(); fetchSync(); fetchExtras(); startCommandSSE() })
watch(() => session.value?.channel, () => { fetchCommands(); fetchCustomCommands(); fetchSync(); fetchExtras(); startCommandSSE() })
onUnmounted(() => { _sseSource?.close() })
</script>

<template>
  <div class="cmd-root">
    <div class="cmd-tabs">
      <button class="cmd-tab" :class="{ active: activeTab === 'Default' }" @click="activeTab = 'Default'">{{ t('cmd.title_default') }}</button>
      <button class="cmd-tab" :class="{ active: activeTab === 'Custom' }" @click="activeTab = 'Custom'">{{ t('cmd.title_custom') }}</button>
      <button class="cmd-tab" :class="{ active: activeTab === 'Extras' }" @click="activeTab = 'Extras'">{{ t('cmd.title_extras') }}</button>
      <button class="cmd-tab reload-tab" @click="reloadAll" :disabled="reloading" title="Reload">{{ reloading ? '…' : '↺' }}</button>
    </div>


    <template v-if="activeTab === 'Default'">
    <div v-if="loading" class="state-msg">{{ t('cmd.loading') }}</div>
    <div v-else-if="commands.length === 0" class="state-msg">{{ t('cmd.none') }} #{{ session?.channel }}</div>

    <template v-else>
      <div class="table-header">
        <div></div>
        <div>{{ t('cmd.header.onoff') }}</div>
        <div>{{ t('cmd.header.name') }}</div>
        <div>{{ t('cmd.header.desc') }}</div>
        <div>{{ t('cmd.header.access') }}</div>
        <div>{{ t('cmd.header.gcd') }}</div>
        <div>{{ t('cmd.header.ucd') }}</div>
        <div>{{ t('cmd.header.feat') }}</div>
      </div>

      <div class="rows">
        <template v-for="cmd in filtered()" :key="cmd.name">
          <div class="table-row" :class="{ saving: saving === cmd.name, expanded: expandedDefault.has(cmd.name) }">
            <!-- Chevron: only visible if command has arg variants -->
            <div class="row-chevron-cell">
              <button
                v-if="cmd.argVariants?.length"
                class="row-chevron"
                :class="{ open: expandedDefault.has(cmd.name) }"
                @click.stop="toggleExpandDefault(cmd.name)"
                title="Show argument variants"
              >▾</button>
            </div>

            <div><div class="square" :class="[cmd.isActive ? 'on' : 'off', { disabled: !canToggle }]" @click="toggle(cmd, 'isActive')"></div></div>

            <div class="cmd-name">
              <span class="cmd-cat-dot" :style="{ background: CAT_COLOR[inferCategory(cmd.name)] }"></span>
              {{ prefix }}{{ cmd.name }}
            </div>

            <div class="cmd-desc">{{ cmdDesc(cmd) }}</div>

            <div>
              <button class="access-btn" :class="{ 'access-mod': cmd.modOnly, 'access-bc': cmd.broadcasterOnly, disabled: !canToggle }" @click="cycleRestriction(cmd)">{{ restrictionLabel(cmd) }}</button>
            </div>

            <div>
              <div class="cd-input-wrap" :class="{ disabled: !canEdit }">
                <input
                  type="number" min="0" class="cd-input"
                  :disabled="!canEdit"
                  :value="cmd.cooldown"
                  @change="onCooldownInput(cmd, 'cooldown', ($event.target as HTMLInputElement).value)"
                />
                <span class="cd-unit">s</span>
              </div>
            </div>

            <div>
              <div class="cd-input-wrap user" :class="{ disabled: !canEdit }">
                <input
                  type="number" min="0" class="cd-input"
                  :disabled="!canEdit"
                  :value="cmd.userCooldown"
                  @change="onCooldownInput(cmd, 'userCooldown', ($event.target as HTMLInputElement).value)"
                />
                <span class="cd-unit">s</span>
              </div>
            </div>

            <div>
              <button
                class="edit-btn"
                :class="{ blocked: BLOCKED.includes(cmd.name) || !canEdit }"
                @click="canEdit && !BLOCKED.includes(cmd.name) && openEdit(cmd.name, true)"
              >
                {{ BLOCKED.includes(cmd.name) ? t('cmd.blocked') : !canEdit ? t('cmd.no_access') : t('cmd.edit') }}
              </button>
            </div>
          </div>

          <!-- Arg variant rows -->
          <template v-if="expandedDefault.has(cmd.name) && cmd.argVariants?.length">
            <div v-for="(v, vi) in cmd.argVariants" :key="vi" class="arg-variant-row">
              <div class="arg-variant-indent"></div>
              <div class="arg-variant-usage">
                <span class="arg-prefix">{{ prefix }}{{ cmd.name }}</span>
                <span class="arg-args">{{ v.usage.replace(/^<(\$[^>]+)>$/, '[$1]') }}</span>
              </div>
              <div class="arg-variant-desc">{{ v.desc || '' }}</div>
            </div>
          </template>
        </template>
      </div>
    </template>
    </template><!-- /Default tab -->

    <!-- Custom commands tab -->
    <template v-if="activeTab === 'Custom'">
    <div class="custom-header">
      <div class="custom-header-left">
        <span class="custom-count">{{ customCommands.length }} {{ customCommands.length !== 1 ? t('cmd.count_plural') : t('cmd.count') }}</span>
        <!-- Sync indicator - always visible when active, click to expand -->
          <button v-if="syncConf?.is_active" class="sync-indicator" @click="syncOpen = !syncOpen" :title="`Syncing from #${syncConf.sync_from}`">
            <span class="sync-dot"></span>{{ t('cmd.sync.active') }} #{{ syncConf.sync_from }}
            <span class="sync-chevron">{{ syncOpen ? '▲' : '▼' }}</span>
          </button>
          <button v-else class="sync-config-btn" @click="syncOpen = !syncOpen">{{ t('cmd.sync.config') }} <span class="sync-chevron">{{ syncOpen ? '▲' : '▼' }}</span></button>
      </div>
        <div v-if="!creatingNew">
          <button class="create-btn" :disabled="!canEdit" :class="{ 'create-btn-disabled': !canEdit }" @click="canEdit && startCreate()">{{ t('cmd.new') }}</button>
        </div>
        <div v-else class="new-cmd-row">
          <span class="new-cmd-prefix">+</span>
          <input
            ref="newCmdInput"
            v-model="newCmdName"
            class="new-cmd-input"
            :class="{ 'new-cmd-input-conflict': newCmdName && (commands.some(c => c.name === newCmdName.trim().toLowerCase().replace(/^\+/, '')) || customCommands.some(c => c.name === newCmdName.trim().toLowerCase().replace(/^\+/, ''))) }"
            placeholder="commandname"
            maxlength="32"
            @keydown.enter="confirmCreate"
            @keydown.escape="cancelCreate"
          />
          <button class="create-btn" @click="confirmCreate">{{ t('cmd.create') }}</button>
          <button class="cancel-btn" @click="cancelCreate">✕</button>
          <span v-if="newCmdError" class="new-cmd-error">{{ newCmdError }}</span>
        </div>
      </div>

      <!-- Sync panel - compact dropdown -->
      <div v-if="syncOpen" class="sync-panel">
        <div class="sync-row">
          <select v-model="syncFrom" class="field-select-sm">
            <option value="">{{ syncConf?.is_active ? t('cmd.sync.change') : t('cmd.sync.select') }}</option>
            <option v-for="ch in availableChannels.filter(c => c !== session?.channel)" :key="ch" :value="ch">#{{ ch }}</option>
          </select>
          <button class="sync-save-btn" @click="saveSync" :disabled="syncSaving || !syncFrom">{{ syncSaving ? '…' : syncConf?.is_active ? t('cmd.sync.update') : t('cmd.sync.enable') }}</button>
          <button v-if="syncConf?.is_active" class="sync-run-btn" @click="runSync" :disabled="syncRunning">{{ syncRunning ? '…' : t('cmd.sync.pull') }}</button>
          <button v-if="syncConf?.is_active" class="sync-stop-btn" @click="stopSync">{{ t('cmd.sync.stop') }}</button>
        </div>
        <div v-if="syncConf?.last_synced" class="sync-last">{{ t('cmd.sync.last') }} {{ new Date(syncConf.last_synced).toLocaleString() }}</div>
        <div v-if="syncMsg" class="sync-msg" :class="{ err: syncMsg.includes('fail') || syncMsg.includes('Error') }">{{ syncMsg }}</div>
      </div>

      <!-- Custom tab header row with sort -->
      <div v-if="!customLoading && filteredCustom().length > 0" class="table-header custom-table-header">
        <div></div>
        <div class="sort-col" @click="setSort('name')">{{ t('cmd.sort.name') }} <span class="sort-arrow">{{ sortField==='name' ? (sortDir==='asc'?'↑':'↓') : '↕' }}</span></div>
        <div>{{ t('cmd.sort.access') }}</div>
        <div class="sort-col" @click="setSort('cooldown')">{{ t('cmd.sort.gcd') }} <span class="sort-arrow">{{ sortField==='cooldown' ? (sortDir==='asc'?'↑':'↓') : '↕' }}</span></div>
        <div>{{ t('cmd.header.ucd') }}</div>
        <div>{{ t('cmd.sort.actions') }}</div>
      </div>

      <div v-if="customLoading" class="state-msg">{{ t('cmd.loading') }}</div>

      <div v-else-if="filteredCustom().length === 0" class="custom-empty">
        <div class="empty-icon">✦</div>
        <div class="empty-title">{{ t('cmd.empty.title') }}</div>
        <div class="empty-sub">{{ t('cmd.empty.sub') }}</div>
        <button class="create-btn mt" @click="startCreate">{{ t('cmd.new') }}</button>
      </div>

      <!-- OBS commands live in their own table/page, not here -->
      <template v-else>
        <div class="obs-cmd-notice">
        <svg viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg" class="obs-cmd-icon">
          <rect x="1" y="2" width="14" height="10" rx="1.5" stroke="currentColor" stroke-width="1.3"/>
          <circle cx="8" cy="7" r="2.5" stroke="currentColor" stroke-width="1.3"/>
          <path d="M5 14h6" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/>
        </svg>
        OBS commands are managed on the
        <router-link to="/obs-connection" class="obs-cmd-link">OBS connection</router-link> page (they won't appear here).
      </div>

      <div class="rows">
        <template v-for="cmd in filteredCustom()" :key="cmd.name">
          <div class="table-row custom-row" :class="{ expanded: expandedCustom.has(cmd.name) }">
            <!-- chevron -->
            <div class="row-chevron-cell">
              <button
                v-if="customHasArgs(cmd)"
                class="row-chevron"
                :class="{ open: expandedCustom.has(cmd.name) }"
                @click.stop="toggleExpandCustom(cmd.name)"
                title="Show argument variants"
              >▾</button>
            </div>

            <!-- toggle - matches default command column 2 -->
            <div>
              <div class="square" :class="[cmd.isActive ? 'on' : 'off', { disabled: !canToggle }]"
                @click="cmd.isActive = !cmd.isActive; updateCustomActive(cmd)"></div>
            </div>

            <div class="cmd-name-col">
              <div class="cmd-name">
                <span class="cmd-cat-dot" style="background:#9d6cff"></span>
                {{ prefix }}{{ cmd.name }}
                <span v-if="cmd.alias" class="cmd-alias">= {{ prefix }}{{ cmd.alias }}</span>
              </div>
              <div v-if="cmd.description" class="cmd-desc-inline">{{ cmd.description }}</div>
            </div>

            <div>
              <button class="access-btn" :class="{ 'access-mod': cmd.modOnly, 'access-bc': cmd.broadcasterOnly, disabled: !canToggle }" @click="cycleRestriction(cmd)">{{ restrictionLabel(cmd) }}</button>
            </div>

            <div>
              <div class="cd-input-wrap" :class="{ disabled: !canEdit }">
                <input type="number" min="0" class="cd-input"
                  :disabled="!canEdit" :value="cmd.cooldown"
                  @change="onCustomCooldownInput(cmd, 'cooldown', ($event.target as HTMLInputElement).value)" />
                <span class="cd-unit">s</span>
              </div>
            </div>

            <div>
              <div class="cd-input-wrap user" :class="{ disabled: !canEdit }">
                <input type="number" min="0" class="cd-input"
                  :disabled="!canEdit" :value="cmd.userCooldown"
                  @change="onCustomCooldownInput(cmd, 'userCooldown', ($event.target as HTMLInputElement).value)" />
                <span class="cd-unit">s</span>
              </div>
            </div>

            <div class="custom-actions">
              <button class="edit-btn" :class="{ blocked: !canEdit }" @click="canEdit && openEdit(cmd.name, false)">{{ canEdit ? t('cmd.edit') : t('cmd.view') }}</button>
              <button class="share-btn" @click="openShare(cmd.name)" title="Copy to another channel">↪</button>
              <button v-if="canDelete"
                class="del-btn"
                :class="{ confirm: deleteConfirmName === cmd.name, deleting: deletingName === cmd.name }"
                @click="deleteCustom(cmd.name)"
                :title="deleteConfirmName === cmd.name ? 'Click again to confirm' : 'Delete'"
              >{{ deletingName === cmd.name ? '…' : deleteConfirmName === cmd.name ? t('cmd.delete_sure') : t('cmd.delete') }}</button>
            </div>
          </div>

          <!-- Arg variant rows for custom -->
          <template v-if="expandedCustom.has(cmd.name)">
            <div v-for="(v, vi) in getCustomArgVariants(cmd)" :key="vi" class="arg-variant-row">
              <div class="arg-variant-indent"></div>
              <div class="arg-variant-usage">
                <span class="arg-prefix">{{ prefix }}{{ cmd.name }}</span>
                <span class="arg-args">{{ v.usage }}</span>
              </div>
              <div class="arg-variant-desc">{{ v.desc || '' }}</div>
            </div>
          </template>
        </template>
      </div>
      </template>
    </template><!-- /Custom tab -->

    <!-- Extras tab -->
    <template v-if="activeTab === 'Extras'">
      <div v-if="extrasLoading" class="state-msg">Loading…</div>
      <template v-else>
        <div class="extras-section">
          <div class="extras-section-title">{{ t('cmd.extras.section') }}</div>

          <!-- Mention trigger -->
          <div class="extras-row">
            <div class="extras-info">
              <div class="extras-label">{{ t('cmd.extras.mention_label') }}</div>
              <div class="extras-desc">{{ t('cmd.extras.mention_desc') }}</div>
              <div v-if="!has7tvSet" class="extras-gate-note">
                {{ t('cmd.extras.mention_needs_7tv') }}
              </div>
            </div>
            <div
              class="extras-toggle"
              :class="{ on: mentionEnabled && has7tvSet, disabled: !isBroadcaster || !has7tvSet }"
              @click="isBroadcaster && has7tvSet && (mentionEnabled = !mentionEnabled, saveExtras())"
            >
              <div class="extras-toggle-knob"></div>
            </div>
          </div>
        </div>

        <div v-if="!isBroadcaster" class="extras-readonly-note">{{ t('cmd.extras.readonly') }}</div>
      </template>
    </template><!-- /Extras tab -->
  </div>
<CommandEditPanel
    :cmdName="editingCmd"
    :channel="session?.channel ?? ''"
    :open="editOpen"
    :isBuiltIn="editIsBuiltIn"
    :prefix="prefix"
    @close="editOpen = false"
    @saved="onEditSaved"
  />

  <!-- Share modal -->
  <Teleport to="body">
    <div v-if="shareOpen" class="modal-overlay" @click.self="shareOpen = false">
      <div class="modal">
        <div class="modal-title">{{ t('cmd.share.title') }} <span class="modal-cmd">+{{ shareCmd }}</span></div>
        <div class="modal-sub">{{ t('cmd.share.sub') }}</div>
        <select v-model="shareTarget" class="field-select-sm" style="width:100%;margin-top:12px">
          <option value="">{{ t('cmd.share.select') }}</option>
          <option v-for="ch in availableChannels.filter(c => c !== session?.channel)" :key="ch" :value="ch">#{{ ch }}</option>
        </select>
        <div v-if="shareError"   class="modal-msg err">{{ shareError }}</div>
        <div v-if="shareSuccess" class="modal-msg ok">{{ shareSuccess }}</div>
        <div class="modal-footer">
          <button class="btn-cancel" @click="shareOpen = false">{{ t('settings.cancel') }}</button>
          <button class="btn-save" @click="doShare" :disabled="shareSaving || !shareTarget">{{ shareSaving ? t('cmd.share.copying') : t('cmd.share.btn') }}</button>
        </div>
      </div>
    </div>
  </Teleport>
</template>

<style scoped>
.cmd-root { display: flex; flex-direction: column; }
.cmd-tabs { display: flex; gap: 0; margin-bottom: 0; }
.cmd-tab { padding: 8px 20px; border: none; background: transparent; color: #555; font-family: inherit; font-size: 12px; font-weight: 600; cursor: pointer; border-bottom: 2px solid transparent; margin-bottom: -1px; transition: color .15s; }
.cmd-tab:hover { color: #aaa; }
.cmd-tab.active { color: #9d6cff; border-bottom-color: #6f2bff; }
.reload-tab { margin-left: auto; font-size: 14px; padding: 4px 14px; }
.reload-tab:disabled { opacity: .4; cursor: not-allowed; }



.state-msg { color: #555; padding: 40px; text-align: center; font-size: 14px; }

.table-header,
.table-row { display: grid; grid-template-columns: 28px 50px 140px 1fr 110px 90px 90px 110px; align-items: center; }

/* Custom commands use wider last column for 3 action buttons */
.custom-table-header,
.custom-row { grid-template-columns: 28px 32px 1fr 110px 90px 90px 150px; }

.sort-col { cursor: pointer; user-select: none; }
.sort-col:hover { color: #aaa; }
.sort-arrow { font-size: 9px; color: #555; margin-left: 3px; }

.table-header {
  padding: 10px 16px 10px;
  color: #666; font-size: 11px; letter-spacing: 0.06em; text-transform: uppercase;
  border-bottom: 1px solid #2a2a2a;
}

.rows { display: flex; flex-direction: column; gap: 0; margin-top: 4px; }

.table-row {
  min-height: 60px; padding: 0 16px 0 8px;
  background: #2c2c2e; border-top: 1px solid #222; transition: background 0.1s, opacity 0.2s;
}
.table-row:hover { background: #313135; }
.table-row.saving { opacity: 0.6; pointer-events: none; }
.table-row.expanded { border-bottom: none; }

/* Chevron cell */
.row-chevron-cell { display: flex; align-items: center; justify-content: center; }
.row-chevron {
  width: 20px; height: 20px; border: none; background: transparent;
  color: #555; font-size: 14px; cursor: pointer; display: flex; align-items: center;
  justify-content: center; padding: 0; line-height: 1; transition: color .15s, transform .2s;
  transform-origin: center;
}
.row-chevron:hover { color: #9d6cff; }
.row-chevron.open { transform: rotate(-180deg); color: #9d6cff; }

/* Arg variant rows */
.arg-variant-row {
  display: grid; grid-template-columns: 28px 1fr 1fr;
  padding: 6px 16px 6px 8px;
  background: #222226; border-top: 1px solid #1e1e22;
  align-items: center; gap: 8px;
  animation: slideDown .15s ease;
}
.arg-variant-row:last-of-type { border-bottom: 1px solid #222; margin-bottom: 2px; }
@keyframes slideDown { from { opacity: 0; transform: translateY(-4px) } to { opacity: 1; transform: none } }
.arg-variant-indent { width: 20px; }
.arg-variant-usage {
  display: flex; align-items: center; gap: 5px;
  font-family: 'Consolas','Fira Mono',monospace; font-size: 12px;
}
.arg-prefix { color: #9d6cff; font-weight: 700; }
.arg-args   { color: #e5c07b; }
.arg-variant-desc {
  font-size: 11px; color: #555; font-style: italic;
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
}

/* Inline toggle for custom row (replaces the square; same visual) */
.toggle-inline {
  width: 24px; height: 24px; border: 2px solid #161616; cursor: pointer;
  transition: background 0.15s; flex-shrink: 0;
}
.toggle-inline.on  { background: #6b35d4; }
.toggle-inline.off { background: #111217; }
.toggle-inline:hover { opacity: 0.8; }

.square {
  width: 24px; height: 24px; border: 2px solid #161616; cursor: pointer; transition: background 0.15s;
}
.square.on  { background: #6b35d4; }
.square.off { background: #111217; }
.square:hover { opacity: 0.8; }
.square.disabled { opacity: 0.3; cursor: not-allowed; }
.cooldown-box.disabled { opacity: 0.3; cursor: not-allowed; }

.cmd-name {
  font-size: 14px; font-weight: 700; color: #e0e0e0;
  display: flex; align-items: center; gap: 7px;
}
.cmd-cat-dot { width: 6px; height: 6px; border-radius: 50%; flex-shrink: 0; }

.cd-input-wrap {
  display: inline-flex; align-items: center;
  height: 28px; background: #111217; padding: 0 6px 0 8px;
  transition: background 0.15s, opacity 0.15s;
}
.cd-input-wrap:focus-within { background: #1a1a24; outline: 1px solid #6f2bff55; }
.cd-input-wrap.user { background: #111e26; }
.cd-input-wrap.user:focus-within { background: #141f2e; }
.cd-input-wrap.disabled { opacity: 0.3; pointer-events: none; }
.cd-input {
  width: 38px; background: transparent; border: none; outline: none;
  color: #e0e0e0; font-family: inherit; font-size: 13px;
  text-align: right;
  -moz-appearance: textfield;
}
.cd-input::-webkit-outer-spin-button,
.cd-input::-webkit-inner-spin-button { -webkit-appearance: none; margin: 0; }
.cd-unit { font-size: 11px; color: #555; margin-left: 2px; }

.edit-btn {
  width: 76px; height: 34px;
  border: 2px solid #6f2bff; background: transparent;
  color: #ccc; font-family: inherit; font-size: 12px; cursor: pointer;
  transition: background 0.15s, color 0.15s;
}
.edit-btn:hover:not(.blocked) { background: #6f2bff; color: #fff; }
.edit-btn.blocked { border-color: #333; color: #444; cursor: default; }

.access-btn {
  height: 26px; padding: 0 8px; min-width: 76px;
  border: 1px solid #333; background: #111217;
  color: #555; font-family: inherit; font-size: 11px; cursor: pointer;
  transition: background .15s, color .15s, border-color .15s;
  white-space: nowrap;
}
.access-btn:hover:not(.disabled) { border-color: #555; color: #aaa; }
.access-btn.access-mod  { border-color: #c792ea55; color: #c792ea; background: rgba(199,146,234,.08); }
.access-btn.access-mod:hover { background: rgba(199,146,234,.15); }
.access-btn.access-bc   { border-color: #f1494955; color: #f14949; background: rgba(241,73,73,.08); }
.access-btn.access-bc:hover  { background: rgba(241,73,73,.15); }
.access-btn.disabled    { opacity: .35; cursor: not-allowed; pointer-events: none; }

/* Custom tab */
.custom-header {
  display: flex; align-items: center; justify-content: space-between;
  margin-bottom: 12px; padding-bottom: 10px; border-bottom: 1px solid #222; padding: 10px 0 10px 0;
}
.custom-count { font-size: 11px; color: #555; }
.create-btn {
  height: 32px; padding: 0 14px; border: 1px solid #6f2bff66;
  background: transparent; color: #9d6cff;
  font-family: inherit; font-size: 12px; font-weight: 600; cursor: pointer;
  transition: background 0.15s;
}
.create-btn:hover { background: #6f2bff22; }
.create-btn-disabled { opacity: .35; cursor: not-allowed; pointer-events: none; }
.create-btn.mt { margin-top: 16px; }

.custom-empty {
  display: flex; flex-direction: column; align-items: center;
  padding: 48px 24px; color: #444; text-align: center;
}
.empty-icon  { font-size: 24px; color: #333; margin-bottom: 12px; }
.empty-title { font-size: 14px; font-weight: 700; color: #555; margin-bottom: 6px; }
.empty-sub   { font-size: 12px; color: #444; }

.custom-actions { display: flex; align-items: center; gap: 6px; }
.cmd-alias { font-size: 11px; color: #6f2bff; font-weight: 400; margin-left: 6px; }
.cmd-desc { font-size: 11px; color: #8d8d8d; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.cmd-name-col { display: flex; flex-direction: column; gap: 2px; min-width: 0; }
.cmd-desc-inline { font-size: 10px; color: #8d8d8d; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.del-btn { height: 34px; padding: 0 10px; border: 1px solid #f1494944; background: transparent; color: #f14949; font-family: inherit; font-size: 11px; cursor: pointer; transition: background .15s, border-color .15s, color .15s; white-space: nowrap; }
.del-btn:hover { background: #f1494911; }
.del-btn.confirm { border-color: #f14949aa; color: #ff6b6b; background: #f1494922; }
.del-btn.deleting { opacity: .5; cursor: not-allowed; }

.new-cmd-row {
  display: flex; align-items: center; gap: 6px;
}
.new-cmd-prefix {
  font-size: 14px; font-weight: 700; color: #9d6cff;
}
.new-cmd-input {
  height: 32px; padding: 0 10px;
  background: #111217; border: 1px solid #6f2bff55; color: #e0e0e0;
  font-family: inherit; font-size: 13px; outline: none; width: 160px;
}
.new-cmd-input:focus { border-color: #9d6cff; }
.new-cmd-input-conflict { border-color: #f1494966 !important; background: #1c1215 !important; }
.cancel-btn {
  height: 32px; width: 32px; border: 1px solid #333; background: transparent;
  color: #666; font-size: 12px; cursor: pointer;
}
.cancel-btn:hover { color: #e0e0e0; border-color: #555; }
.new-cmd-error {
  font-size: 11px; color: #f14949;
}

/* Share button */
.share-btn { height: 34px; padding: 0 10px; border: 1px solid #4ec9b044; background: transparent; color: #4ec9b0; font-family: inherit; font-size: 13px; cursor: pointer; transition: background .15s; }
.share-btn:hover { background: rgba(78,201,176,.1); }

/* Sync config */
.custom-header-left { display: flex; align-items: center; gap: 10px; }
.sync-indicator { display: flex; align-items: center; gap: 5px; height: 22px; padding: 0 8px; border: 1px solid #23d18b44; background: rgba(35,209,139,.06); color: #23d18b; font-family: inherit; font-size: 10px; cursor: pointer; transition: background .15s; }
.sync-indicator:hover { background: rgba(35,209,139,.12); }
.sync-indicator-dot { width: 6px; height: 6px; border-radius: 50%; background: #23d18b; box-shadow: 0 0 4px #23d18b88; animation: pulse-live 2s ease-in-out infinite; flex-shrink: 0; }
.sync-indicator-chevron { font-size: 8px; opacity: .6; }
@keyframes pulse-live { 0%,100%{opacity:1} 50%{opacity:.4} }
.sync-config-btn { height: 22px; padding: 0 8px; border: 1px solid #2a2a30; background: transparent; color: #555; font-family: inherit; font-size: 10px; cursor: pointer; transition: all .15s; }
.sync-config-btn:hover { color: #9d6cff; border-color: #6f2bff44; }
.sync-panel { background: #141418; border: 1px solid #1e1e24; border-top: none; padding: 8px 10px; margin-bottom: 8px; display: flex; flex-direction: column; gap: 5px; }
.sync-row  { display: flex; gap: 6px; align-items: center; }
.sync-msg  { font-size: 10px; color: #23d18b; }
.sync-msg.err { color: #f14949; }
.sync-last { font-size: 10px; color: #444; }
.sync-stop-btn { height: 28px; padding: 0 8px; border: 1px solid #f1494944; background: transparent; color: #f14949; font-family: inherit; font-size: 11px; cursor: pointer; }
.sync-stop-btn:hover { background: rgba(241,73,73,.1); }
.field-select-sm { background: #0d0d10; border: 1px solid #2a2a30; color: #e0e0e0; font-family: inherit; font-size: 12px; padding: 6px 8px; outline: none; cursor: pointer; }
.sync-save-btn { height: 32px; padding: 0 12px; border: none; background: #6f2bff; color: #fff; font-family: inherit; font-size: 11px; font-weight: 600; cursor: pointer; }
.sync-save-btn:hover:not(:disabled) { background: #7f3fff; }
.sync-save-btn:disabled { opacity: .4; cursor: not-allowed; }
.sync-run-btn  { height: 32px; padding: 0 12px; border: 1px solid #23d18b44; background: rgba(35,209,139,.08); color: #23d18b; font-family: inherit; font-size: 11px; cursor: pointer; }
.sync-run-btn:hover:not(:disabled) { background: rgba(35,209,139,.2); }
.sync-run-btn:disabled { opacity: .4; cursor: not-allowed; }

/* Share modal */
.modal-overlay { position: fixed; inset: 0; background: rgba(0,0,0,.65); display: flex; align-items: center; justify-content: center; z-index: 1001; }
.modal { background: #1a1a1e; border: 1px solid #2a2a30; padding: 24px; width: 360px; max-width: 90vw; }
.modal-title { font-size: 15px; font-weight: 700; color: #e0e0e0; margin-bottom: 4px; }
.modal-cmd   { color: #9d6cff; }
.modal-sub   { font-size: 11px; color: #555; }
.modal-msg   { font-size: 11px; margin-top: 8px; padding: 6px 10px; }
.modal-msg.ok  { color: #23d18b; background: rgba(35,209,139,.08); border-left: 2px solid #23d18b; }
.modal-msg.err { color: #f14949; background: rgba(241,73,73,.08); border-left: 2px solid #f14949; }
.modal-footer { display: flex; gap: 8px; justify-content: flex-end; margin-top: 16px; }
.btn-save   { height: 32px; padding: 0 16px; border: none; background: #6f2bff; color: #fff; font-family: inherit; font-size: 12px; font-weight: 600; cursor: pointer; }
.btn-save:hover:not(:disabled) { background: #7f3fff; }
.btn-save:disabled { opacity: .4; cursor: not-allowed; }
.btn-cancel { height: 32px; padding: 0 12px; border: 1px solid #333; background: transparent; color: #888; font-family: inherit; font-size: 12px; cursor: pointer; }
.btn-cancel:hover { border-color: #555; color: #e0e0e0; }

/* OBS commands notice in Custom tab */
.obs-cmd-notice {
  display: flex; align-items: center; gap: 8px; margin-top: 10px;
  padding: 8px 12px; background: #111217; border: 1px solid #2a2a30;
  font-size: 11px; color: #555;
}
.obs-cmd-icon { width: 14px; height: 14px; flex-shrink: 0; color: #9d6cff55; }
.obs-cmd-link { color: #9d6cff; text-decoration: none; }
.obs-cmd-link:hover { text-decoration: underline; }

/*  Extras tab  */
.extras-gate-note { font-size: 11px; color: #e5c07b; margin-top: 5px; max-width: 300px; line-height: 1.5; }
.extras-section       { background: #222226; border: 1px solid #2a2a30; padding: 20px; margin-top: 12px; }
.extras-section-title { font-size: 9px; font-weight: 700; text-transform: uppercase; letter-spacing: .08em; color: #9d6cff; margin-bottom: 12px; }
.extras-row   { display: flex; align-items: center; justify-content: space-between; gap: 20px; padding: 12px 0; border-top: 1px solid #2a2a30; }
.extras-row:first-of-type { border-top: none; }
.extras-info  { flex: 1; }
.extras-label { font-size: 13px; font-weight: 600; color: #d0d0d0; margin-bottom: 4px; }
.extras-desc  { font-size: 11px; color: #555; line-height: 1.5; }
.extras-code  { font-family: 'Consolas','Fira Mono',monospace; font-size: 10px; color: #9d6cff; background: #9d6cff15; padding: 1px 5px; }
.extras-toggle {
  width: 42px; height: 22px; background: #111217; cursor: pointer;
  position: relative; transition: background .2s; flex-shrink: 0;
}
.extras-toggle.on  { background: #6f2bff; }
.extras-toggle.disabled { opacity: .35; cursor: not-allowed; }
.extras-toggle-knob {
  position: absolute; top: 3px; left: 3px; width: 16px; height: 16px;
  background: #555; transition: transform .2s, background .2s;
}
.extras-toggle.on .extras-toggle-knob { transform: translateX(20px); background: #fff; }
.extras-footer { margin-top: 16px; display: flex; justify-content: flex-end; }
.extras-save-btn {
  height: 34px; padding: 0 20px; border: none; background: #6f2bff;
  color: #fff; font-family: inherit; font-size: 12px; font-weight: 600; cursor: pointer;
  transition: background .15s;
}
.extras-save-btn:hover:not(:disabled) { background: #7f3fff; }
.extras-save-btn:disabled { opacity: .5; cursor: not-allowed; }
.extras-save-btn.saved { background: #1a3d2a; color: #23d18b; cursor: default; }
.extras-readonly-note { font-size: 11px; color: #555; margin-top: 16px; text-align: center; }

/*  Responsive  */
@media (max-width: 680px) {
  /* Commands table: toggle | name+desc | edit button. Hide cooldown columns. */
  .table-header { display: none; }
  .table-row {
    display: flex; flex-wrap: wrap; align-items: center;
    height: auto; padding: 10px 12px; gap: 8px;
  }
  .table-row > *:nth-child(1) { flex-shrink: 0; }
  .table-row > *:nth-child(2) { flex: 1; min-width: 0; }
  .table-row > *:nth-child(3) { order: 10; width: 100%; } /* access on second line */
  .table-row > *:nth-child(4),
  .table-row > *:nth-child(5) { display: none; }           /* hide CDs */
  .table-row > *:nth-child(6) { flex-shrink: 0; }          /* edit button */
  .table-row > *:nth-child(7) { flex-shrink: 0; }          /* desc col (7col layout) */

  /* Custom row same treatment */
  .custom-row {
    display: flex; flex-wrap: wrap; align-items: center;
    height: auto; padding: 10px 12px; gap: 8px;
  }
  .custom-row > *:nth-child(4),
  .custom-row > *:nth-child(5) { display: none; }
  .custom-row > *:nth-child(3) { order: 10; width: 100%; }

  /* Custom header: stack instead of columns on mobile */
  .custom-header { flex-wrap: wrap; gap: 8px; }
  .custom-header-left { flex-wrap: wrap; gap: 6px; }

  /* Sync row: wrap */
  .sync-row { flex-wrap: wrap; }

  /* New cmd input: shrink */
  .new-cmd-input { width: 120px; }
}
</style>
