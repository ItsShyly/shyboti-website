<script setup lang="ts">
import { ref, computed, onMounted, watch } from 'vue'
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

function openEdit(name: string, builtIn: boolean) {
  editingCmd.value    = name
  editIsBuiltIn.value = builtIn
  editOpen.value      = true
}

function onEditSaved() {
  fetchCommands()
  fetchCustomCommands()
}

const CATEGORIES: Record<string, string[]> = {
  Default:    [],
  '7TV':      ['7tv'],
  APIs:       ['song', 'gpt', 'ask'],
  Logs:       ['git', 'pm2'],
  Moderation: ['whitelist', 'to', 'user'],
}

const props = defineProps<{ activeNav: string }>()

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
  if (props.activeNav === 'Custom') return [] // custom tab handled separately
  const catNames = CATEGORIES[props.activeNav] ?? []
  let list = props.activeNav === 'Default'
    ? commands.value
    : commands.value.filter(c => catNames.includes(c.name))
  if (search.value.trim()) list = list.filter(c => c.name.includes(search.value.toLowerCase()))
  return list
}

function filteredCustom() {
  let list = customCommands.value
  if (search.value.trim()) list = list.filter(c => c.name.includes(search.value.toLowerCase()))
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
    customCommands.value = data.commands.map(c => ({ ...c, isActive: !!c.isActive }))
  } catch {
    customCommands.value = []
  } finally {
    customLoading.value = false
  }
}

async function createCustomCommand() {
  const name = prompt('Command name (no prefix):')?.trim().toLowerCase()
  if (!name || !/^[a-z0-9_]+$/.test(name)) return
  if (!session.value) return
  await fetch(`${API}/custom-commands/${session.value.channel}/${name}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.value.token}` },
    body: JSON.stringify({ response: '', rule: '', isActive: true }),
  })
  await fetchCustomCommands()
  openEdit(name, false)
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

function toggle(cmd: Command, field: 'isActive' | 'modOnly' | 'broadcasterOnly') {
  if (!canToggle.value) return
  cmd[field] = !cmd[field]
  updateCommand(cmd)
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

onMounted(() => { fetchCommands(); fetchCustomCommands() })
watch(() => session.value?.channel, () => { fetchCommands(); fetchCustomCommands() })
</script>

<template>
  <div>
    <!-- Search bar inside panel -->
    <div class="cmd-search-wrap">
      <svg class="cmd-search-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
        <circle cx="11" cy="11" r="7"/><line x1="16.5" y1="16.5" x2="22" y2="22"/>
      </svg>
      <input v-model="search" class="cmd-search" placeholder="Search commands…" />
    </div>

    <div v-if="loading" class="state-msg">Loading commands…</div>
    <div v-else-if="commands.length === 0" class="state-msg">No commands found for #{{ session?.channel }}</div>

    <template v-else>
      <div class="table-header">
        <div>On/Off</div>
        <div>Name</div>
        <div>Mod Only</div>
        <div>Broadcaster Only</div>
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

          <div><div class="square" :class="cmd.modOnly ? 'on' : 'off'" @click="toggle(cmd, 'modOnly')"></div></div>

          <div><div class="square" :class="cmd.broadcasterOnly ? 'on' : 'off'" @click="toggle(cmd, 'broadcasterOnly')"></div></div>

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

    <!-- ── Custom commands tab ─────────────────────────────────────── -->
    <template v-if="activeNav === 'Custom'">
      <div class="custom-header">
        <span class="custom-count">{{ customCommands.length }} custom command{{ customCommands.length !== 1 ? 's' : '' }}</span>
        <button class="create-btn" @click="createCustomCommand">+ New command</button>
      </div>

      <div v-if="customLoading" class="state-msg">Loading…</div>

      <div v-else-if="filteredCustom().length === 0" class="custom-empty">
        <div class="empty-icon">✦</div>
        <div class="empty-title">No custom commands yet</div>
        <div class="empty-sub">Create your first command with the builder above.</div>
        <button class="create-btn mt" @click="createCustomCommand">+ New command</button>
      </div>

      <div v-else class="rows">
        <div v-for="cmd in filteredCustom()" :key="cmd.name" class="table-row custom-row">
          <div>
            <div class="square" :class="cmd.isActive ? 'on' : 'off'"
              @click="cmd.isActive = !cmd.isActive; updateCustomActive(cmd)"></div>
          </div>
          <div class="cmd-name">
            <span class="cmd-cat-dot" style="background:#9d6cff"></span>
            {{ prefix }}{{ cmd.name }}
            <span v-if="cmd.alias" class="cmd-alias">= {{ prefix }}{{ cmd.alias }}</span>
          </div>
          <div class="custom-response-preview">{{ cmd.response || '\u2014' }}</div>
          <div>
            <button class="edit-btn" @click="openEdit(cmd.name, false)">Edit</button>
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
</template>

<style scoped>
.cmd-search-wrap {
  position: relative; height: 38px; background: #2c2c2e;
  display: flex; align-items: center; margin-bottom: 12px;
}
.cmd-search-icon { position: absolute; left: 10px; width: 16px; height: 16px; color: #666; pointer-events: none; }
.cmd-search {
  width: 100%; height: 100%; background: transparent; border: none; outline: none;
  color: #fff; font-family: inherit; font-size: 13px; padding: 0 12px 0 34px;
}
.cmd-search::placeholder { color: #555; }

.state-msg { color: #555; padding: 40px; text-align: center; font-size: 14px; }

.table-header,
.table-row { display: grid; grid-template-columns: 70px 1fr 100px 160px 90px 90px 110px; align-items: center; }

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

.custom-row { grid-template-columns: 70px 1fr 1fr 110px; }
.custom-response-preview {
  font-size: 12px; color: #555; overflow: hidden;
  text-overflow: ellipsis; white-space: nowrap; padding-right: 12px;
}
.cmd-alias { font-size: 11px; color: #6f2bff; font-weight: 400; margin-left: 6px; }
</style>
