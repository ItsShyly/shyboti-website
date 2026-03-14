<script setup lang="ts">
import { ref, computed, onMounted, watch, nextTick } from 'vue'
import { API } from '../api'
import { useAuth } from '../auth'
import CommandEditPanel from './CommandEditPanel.vue'

const { session, channelRole } = useAuth()

const canToggle   = computed(() => channelRole.value?.permissions.canToggleCommands ?? false)
const canCooldown = computed(() => channelRole.value?.permissions.canEditCooldowns ?? false)

interface Command {
  name: string
  isActive: boolean
  cooldown: number
  userCooldown: number
  modOnly: boolean
  broadcasterOnly: boolean
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
}

const commands       = ref<Command[]>([])
const customCommands = ref<CustomCommand[]>([])
const prefix         = ref('+')
const loading        = ref(true)
const customLoading  = ref(false)
const search         = ref('')
const saving         = ref<string | null>(null)
const cdTimers       = ref<Record<string, ReturnType<typeof setTimeout>>>({})

// Edit panel — isBuiltIn=true for hardcoded commands, false for custom
const editOpen      = ref(false)
const editingCmd    = ref('')
const editIsBuiltIn = ref(true)

// New command name input state
const creatingNew   = ref(false)
const newCmdName    = ref('')
const newCmdError   = ref('')
const newCmdInput   = ref<HTMLInputElement | null>(null)

function openEdit(name: string, builtIn: boolean) {
  editingCmd.value    = name
  editIsBuiltIn.value = builtIn
  editOpen.value      = true
}

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

// Internal tab state — replaces old activeNav prop
const activeTab = ref<'Default' | 'Custom'>('Default')

// Sort state for custom commands
const sortField = ref<'name' | 'cooldown' | 'isActive'>('name')
const sortDir   = ref<'asc' | 'desc'>('asc')
function setSort(field: typeof sortField.value) {
  if (sortField.value === field) sortDir.value = sortDir.value === 'asc' ? 'desc' : 'asc'
  else { sortField.value = field; sortDir.value = 'asc' }
}

const BLOCKED = ['join','leave','pm2','refresh','whitelist','git']

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
  let list = commands.value
  if (search.value.trim()) list = list.filter(c => c.name.includes(search.value.toLowerCase()))
  return list
}

function filteredCustom() {
  let list = customCommands.value
  if (search.value.trim()) list = list.filter(c => c.name.includes(search.value.toLowerCase()))
  // Sort
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
  if (!canToggle.value) return
  ;(cmd as any)[field] = !(cmd as any)[field]
  if (customCommands.value.includes(cmd as CustomCommand)) updateCustomActive(cmd as CustomCommand)
  else updateCommand(cmd as Command)
}

function cycleRestriction(cmd: Command | CustomCommand) {
  if (!canToggle.value) return
  const c = cmd as any
  if (!c.modOnly && !c.broadcasterOnly) { c.modOnly = true;  c.broadcasterOnly = false }
  else if (c.modOnly)                   { c.modOnly = false; c.broadcasterOnly = true  }
  else                                  { c.modOnly = false; c.broadcasterOnly = false }
  if (customCommands.value.includes(cmd as CustomCommand)) updateCustomActive(cmd as CustomCommand)
  else updateCommand(cmd as Command)
}

function restrictionLabel(cmd: { modOnly: boolean; broadcasterOnly: boolean }): string {
  if (cmd.broadcasterOnly) return 'BC only'
  if (cmd.modOnly)         return 'Mod only'
  return 'Everyone'
}

const deletingName = ref<string | null>(null)
const deleteConfirmName = ref<string | null>(null)

function deleteCustom(name: string) {
  if (deleteConfirmName.value === name) {
    // second click — confirmed
    doDeleteCustom(name)
  } else {
    deleteConfirmName.value = name
    // auto-cancel after 3s
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
  if (!canCooldown.value) return
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
  if (!canCooldown.value) return
  const val = parseInt(raw)
  if (isNaN(val) || val < 0) return
  cmd[field] = val
  const key = `${cmd.name}_${field}`
  clearTimeout(cdTimers.value[key])
  cdTimers.value[key] = setTimeout(() => updateCommand(cmd), 600)
}

// ── Share ────────────────────────────────────────────────────────────────
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

// ── Sync ─────────────────────────────────────────────────────────────────
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

onMounted(() => { fetchCommands(); fetchCustomCommands(); fetchSync() })
watch(() => session.value?.channel, () => { fetchCommands(); fetchCustomCommands(); fetchSync() })
</script>

<template>
  <div class="cmd-root">
    <!-- Tab bar + search — sticky together -->
    <div class="cmd-sticky-top">
      <div class="cmd-tabs">
        <button class="cmd-tab" :class="{ active: activeTab === 'Default' }" @click="activeTab = 'Default'">Default</button>
        <button class="cmd-tab" :class="{ active: activeTab === 'Custom' }" @click="activeTab = 'Custom'">Custom</button>
      </div>
      <div class="cmd-search-wrap">
        <svg class="cmd-search-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
          <circle cx="11" cy="11" r="7"/><line x1="16.5" y1="16.5" x2="22" y2="22"/>
        </svg>
        <input v-model="search" class="cmd-search" placeholder="Search commands…" />
      </div>
    </div>

    <template v-if="activeTab === 'Default'">
    <div v-if="loading" class="state-msg">Loading commands…</div>
    <div v-else-if="commands.length === 0" class="state-msg">No commands found for #{{ session?.channel }}</div>

    <template v-else>
      <div class="table-header">
        <div>On/Off</div>
        <div>Name</div>
        <div>Access</div>
        <div>Global CD</div>
        <div>User CD</div>
        <div>Features</div>
      </div>

      <div class="rows">
        <div v-for="cmd in filtered()" :key="cmd.name" class="table-row" :class="{ saving: saving === cmd.name }">
          <div><div class="square" :class="[cmd.isActive ? 'on' : 'off', { disabled: !canToggle }]" @click="toggle(cmd, 'isActive')"></div></div>

          <div class="cmd-name">
            <span class="cmd-cat-dot" :style="{ background: CAT_COLOR[inferCategory(cmd.name)] }"></span>
            {{ prefix }}{{ cmd.name }}
          </div>

          <div>
            <button class="access-btn" :class="{ 'access-mod': cmd.modOnly, 'access-bc': cmd.broadcasterOnly, disabled: !canToggle }" @click="cycleRestriction(cmd)">{{ restrictionLabel(cmd) }}</button>
          </div>

          <div>
            <div class="cd-input-wrap" :class="{ disabled: !canCooldown }">
              <input
                type="number" min="0" class="cd-input"
                :disabled="!canCooldown"
                :value="cmd.cooldown"
                @change="onCooldownInput(cmd, 'cooldown', ($event.target as HTMLInputElement).value)"
              />
              <span class="cd-unit">s</span>
            </div>
          </div>

          <div>
            <div class="cd-input-wrap user" :class="{ disabled: !canCooldown }">
              <input
                type="number" min="0" class="cd-input"
                :disabled="!canCooldown"
                :value="cmd.userCooldown"
                @change="onCooldownInput(cmd, 'userCooldown', ($event.target as HTMLInputElement).value)"
              />
              <span class="cd-unit">s</span>
            </div>
          </div>

          <div>
            <button
              class="edit-btn"
              :class="{ blocked: BLOCKED.includes(cmd.name) }"
              @click="!BLOCKED.includes(cmd.name) && openEdit(cmd.name, true)"
            >
              {{ BLOCKED.includes(cmd.name) ? 'Blocked' : 'Edit' }}
            </button>
          </div>
        </div>
      </div>
    </template>
    </template><!-- /Default tab -->

    <!-- ── Custom commands tab ─────────────────────────────────────── -->
    <template v-if="activeTab === 'Custom'">
    <div class="custom-header">
      <div class="custom-header-left">
        <span class="custom-count">{{ customCommands.length }} custom command{{ customCommands.length !== 1 ? 's' : '' }}</span>
        <!-- Sync indicator — always visible when active, click to expand -->
        <button v-if="syncConf?.is_active" class="sync-indicator" @click="syncOpen = !syncOpen" :title="`Syncing from #${syncConf.sync_from} · click to manage`">
          <span class="sync-indicator-dot"></span>
          <span>synced from #{{ syncConf.sync_from }}</span>
          <span class="sync-indicator-chevron">{{ syncOpen ? '▲' : '▼' }}</span>
        </button>
        <button v-else class="sync-config-btn" @click="syncOpen = !syncOpen">
          ↻ Sync from channel…
        </button>
      </div>
        <div v-if="!creatingNew">
          <button class="create-btn" @click="startCreate">+ New command</button>
        </div>
        <div v-else class="new-cmd-row">
          <span class="new-cmd-prefix">+</span>
          <input
            ref="newCmdInput"
            v-model="newCmdName"
            class="new-cmd-input"
            placeholder="commandname"
            maxlength="32"
            @keydown.enter="confirmCreate"
            @keydown.escape="cancelCreate"
          />
          <button class="create-btn" @click="confirmCreate">Create</button>
          <button class="cancel-btn" @click="cancelCreate">✕</button>
          <span v-if="newCmdError" class="new-cmd-error">{{ newCmdError }}</span>
        </div>
      </div>

      <!-- Sync panel — compact dropdown -->
      <div v-if="syncOpen" class="sync-panel">
        <div class="sync-row">
          <select v-model="syncFrom" class="field-select-sm">
            <option value="">{{ syncConf?.is_active ? 'Change source…' : 'Select channel…' }}</option>
            <option v-for="ch in availableChannels.filter(c => c !== session?.channel)" :key="ch" :value="ch">#{{ ch }}</option>
          </select>
          <button class="sync-save-btn" @click="saveSync" :disabled="syncSaving || !syncFrom">{{ syncSaving ? '…' : syncConf?.is_active ? 'Update' : 'Enable' }}</button>
          <button v-if="syncConf?.is_active" class="sync-run-btn" @click="runSync" :disabled="syncRunning">{{ syncRunning ? '…' : '↻ Pull now' }}</button>
          <button v-if="syncConf?.is_active" class="sync-stop-btn" @click="stopSync">Stop</button>
        </div>
        <div v-if="syncConf?.last_synced" class="sync-last">Last pull: {{ new Date(syncConf.last_synced).toLocaleString() }}</div>
        <div v-if="syncMsg" class="sync-msg" :class="{ err: syncMsg.includes('fail') || syncMsg.includes('Error') }">{{ syncMsg }}</div>
      </div>

      <!-- Custom tab header row with sort -->
      <div v-if="!customLoading && filteredCustom().length > 0" class="table-header custom-table-header">
        <div></div>
        <div class="sort-col" @click="setSort('name')">Name <span class="sort-arrow">{{ sortField==='name' ? (sortDir==='asc'?'↑':'↓') : '↕' }}</span></div>
        <div class="sort-col" @click="setSort('isActive')">On/Off <span class="sort-arrow">{{ sortField==='isActive' ? (sortDir==='asc'?'↑':'↓') : '↕' }}</span></div>
        <div>Access</div>
        <div class="sort-col" @click="setSort('cooldown')">Global CD <span class="sort-arrow">{{ sortField==='cooldown' ? (sortDir==='asc'?'↑':'↓') : '↕' }}</span></div>
        <div>User CD</div>
        <div>Actions</div>
      </div>

      <div v-if="customLoading" class="state-msg">Loading…</div>

      <div v-else-if="filteredCustom().length === 0" class="custom-empty">
        <div class="empty-icon">✦</div>
        <div class="empty-title">No custom commands yet</div>
        <div class="empty-sub">Create your first command with the builder above.</div>
        <button class="create-btn mt" @click="startCreate">+ New command</button>
      </div>

      <div v-else class="rows">
        <div v-for="cmd in filteredCustom()" :key="cmd.name" class="table-row custom-row">
          <div><div class="square" :class="cmd.isActive ? 'on' : 'off'"
            @click="cmd.isActive = !cmd.isActive; updateCustomActive(cmd)"></div></div>

          <div class="cmd-name">
            <span class="cmd-cat-dot" style="background:#9d6cff"></span>
            {{ prefix }}{{ cmd.name }}
            <span v-if="cmd.alias" class="cmd-alias">= {{ prefix }}{{ cmd.alias }}</span>
          </div>

          <!-- on/off square duplicate column for alignment with header -->
          <div></div>

          <div>
            <button class="access-btn" :class="{ 'access-mod': cmd.modOnly, 'access-bc': cmd.broadcasterOnly, disabled: !canToggle }" @click="cycleRestriction(cmd)">{{ restrictionLabel(cmd) }}</button>
          </div>

          <div>
            <div class="cd-input-wrap" :class="{ disabled: !canCooldown }">
              <input type="number" min="0" class="cd-input"
                :disabled="!canCooldown" :value="cmd.cooldown"
                @change="onCustomCooldownInput(cmd, 'cooldown', ($event.target as HTMLInputElement).value)" />
              <span class="cd-unit">s</span>
            </div>
          </div>

          <div>
            <div class="cd-input-wrap user" :class="{ disabled: !canCooldown }">
              <input type="number" min="0" class="cd-input"
                :disabled="!canCooldown" :value="cmd.userCooldown"
                @change="onCustomCooldownInput(cmd, 'userCooldown', ($event.target as HTMLInputElement).value)" />
              <span class="cd-unit">s</span>
            </div>
          </div>

          <div class="custom-actions">
            <button class="edit-btn" @click="openEdit(cmd.name, false)">Edit</button>
            <button class="share-btn" @click="openShare(cmd.name)" title="Copy to another channel">↪</button>
            <button
              class="del-btn"
              :class="{ confirm: deleteConfirmName === cmd.name, deleting: deletingName === cmd.name }"
              @click="deleteCustom(cmd.name)"
              :title="deleteConfirmName === cmd.name ? 'Click again to confirm' : 'Delete'"
            >{{ deletingName === cmd.name ? '…' : deleteConfirmName === cmd.name ? 'Sure?' : '✕' }}</button>
          </div>
        </div>
      </div>
    </template>
  </div>
<CommandEditPanel
    :cmdName="editingCmd"
    :channel="session?.channel ?? ''"
    :open="editOpen"
    :isBuiltIn="editIsBuiltIn"
    @close="editOpen = false"
    @saved="onEditSaved"
  />

  <!-- Share modal -->
  <Teleport to="body">
    <div v-if="shareOpen" class="modal-overlay" @click.self="shareOpen = false">
      <div class="modal">
        <div class="modal-title">Share <span class="modal-cmd">+{{ shareCmd }}</span></div>
        <div class="modal-sub">Copy this command to another channel you have access to.</div>
        <select v-model="shareTarget" class="field-select-sm" style="width:100%;margin-top:12px">
          <option value="">Select target channel…</option>
          <option v-for="ch in availableChannels.filter(c => c !== session?.channel)" :key="ch" :value="ch">#{{ ch }}</option>
        </select>
        <div v-if="shareError"   class="modal-msg err">{{ shareError }}</div>
        <div v-if="shareSuccess" class="modal-msg ok">{{ shareSuccess }}</div>
        <div class="modal-footer">
          <button class="btn-cancel" @click="shareOpen = false">Cancel</button>
          <button class="btn-save" @click="doShare" :disabled="shareSaving || !shareTarget">{{ shareSaving ? 'Copying…' : 'Copy command' }}</button>
        </div>
      </div>
    </div>
  </Teleport>
</template>

<style scoped>
.cmd-root { display: flex; flex-direction: column; height: 100%; min-height: 0; }
.cmd-sticky-top { position: sticky; top: 0; z-index: 10; background: var(--panel-bg, #1a1a1e); }
.cmd-tabs { display: flex; gap: 0; border-bottom: 1px solid #222; }
.cmd-tab { padding: 8px 20px; border: none; background: transparent; color: #555; font-family: inherit; font-size: 12px; font-weight: 600; cursor: pointer; border-bottom: 2px solid transparent; margin-bottom: -1px; transition: color .15s; }
.cmd-tab:hover { color: #aaa; }
.cmd-tab.active { color: #9d6cff; border-bottom-color: #6f2bff; }

.cmd-search-wrap {
  position: relative; height: 38px; background: #2c2c2e;
  display: flex; align-items: center; margin-bottom: 0;
  border-bottom: 1px solid #222;
}
.cmd-search-icon { position: absolute; left: 10px; width: 16px; height: 16px; color: #666; pointer-events: none; }
.cmd-search {
  width: 100%; height: 100%; background: transparent; border: none; outline: none;
  color: #fff; font-family: inherit; font-size: 13px; padding: 0 12px 0 34px;
}
.cmd-search::placeholder { color: #555; }

.state-msg { color: #555; padding: 40px; text-align: center; font-size: 14px; }

.table-header,
.table-row { display: grid; grid-template-columns: 70px 1fr 110px 90px 90px 110px; align-items: center; }

.table-header {
  padding: 0 16px 10px;
  color: #666; font-size: 11px; letter-spacing: 0.06em; text-transform: uppercase;
  border-bottom: 1px solid #2a2a2a;
}

.rows { display: flex; flex-direction: column; gap: 3px; margin-top: 4px; }

.table-row {
  height: 60px; padding: 0 16px;
  background: #2c2c2e; border-top: 1px solid #222; transition: background 0.1s, opacity 0.2s;
}
.table-row:hover { background: #313135; }
.table-row.saving { opacity: 0.6; pointer-events: none; }

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

/* ── Custom tab ─────────────────────────────────────────────────── */
.custom-header {
  display: flex; align-items: center; justify-content: space-between;
  margin-bottom: 12px; padding-bottom: 10px; border-bottom: 1px solid #222;
}
.custom-count { font-size: 11px; color: #555; }
.create-btn {
  height: 32px; padding: 0 14px; border: 1px solid #6f2bff66;
  background: transparent; color: #9d6cff;
  font-family: inherit; font-size: 12px; font-weight: 600; cursor: pointer;
  transition: background 0.15s;
}
.create-btn:hover { background: #6f2bff22; }
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
</style>
