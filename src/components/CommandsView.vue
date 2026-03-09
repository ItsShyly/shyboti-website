<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { API } from '../api'
import { useAuth } from '../auth'

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

const commands = ref<Command[]>([])
const prefix   = ref('+')
const loading  = ref(true)
const search   = ref('')
const saving   = ref<string | null>(null)

const CATEGORIES: Record<string, string[]> = {
  Default:    [],
  '7TV':      ['7tv'],
  APIs:       ['song', 'gpt', 'ask'],
  Logs:       ['git', 'pm2'],
  Moderation: ['whitelist', 'to', 'user'],
}

const props = defineProps<{ activeNav: string }>()

const BLOCKED = ['join','leave','pm2','refresh','say','to','whitelist','git']

function inferCategory(name: string): string {
  const utility = ['ping','commands','join','leave','pm2','refresh','say','to','user','whitelist','git','cmd','message']
  const chat    = ['ask','song','gpt','7tv','talk','verify','shyboti']
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
  const catNames = CATEGORIES[props.activeNav] ?? []
  let list = (props.activeNav === 'Default' || props.activeNav === 'Custom')
    ? commands.value
    : commands.value.filter(c => catNames.includes(c.name))
  if (search.value.trim()) list = list.filter(c => c.name.includes(search.value.toLowerCase()))
  return list
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

function setCooldown(cmd: Command, field: 'cooldown' | 'userCooldown') {
  if (!canCooldown.value) return
  const label = field === 'cooldown' ? 'Global cooldown' : 'User cooldown'
  const val = prompt(`${label} for ${prefix.value}${cmd.name} (seconds):`, String(cmd[field]))
  if (val !== null && !isNaN(Number(val))) {
    cmd[field] = Number(val)
    updateCommand(cmd)
  }
}

onMounted(fetchCommands)
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

          <div><div class="cooldown-box" :class="{ disabled: !canCooldown }" @click="setCooldown(cmd, 'cooldown')">{{ cmd.cooldown }}s</div></div>

          <div><div class="cooldown-box user" :class="{ disabled: !canCooldown }" @click="setCooldown(cmd, 'userCooldown')">{{ cmd.userCooldown }}s</div></div>

          <div>
            <button class="edit-btn" :class="{ blocked: BLOCKED.includes(cmd.name) }">
              {{ BLOCKED.includes(cmd.name) ? 'Blocked' : 'Edit' }}
            </button>
          </div>
        </div>
      </div>
    </template>
  </div>
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

.cooldown-box {
  display: inline-flex; align-items: center; justify-content: center;
  min-width: 48px; height: 28px; padding: 0 8px;
  background: #111217; font-size: 13px; cursor: pointer; transition: background 0.1s;
}
.cooldown-box:hover:not(.disabled) { background: #1e1e26; }
.cooldown-box.user { background: #111e26; }
.cooldown-box.user:hover:not(.disabled) { background: #1a2a36; }

.edit-btn {
  width: 76px; height: 34px;
  border: 2px solid #6f2bff; background: transparent;
  color: #ccc; font-family: inherit; font-size: 12px; cursor: pointer;
  transition: background 0.15s, color 0.15s;
}
.edit-btn:hover:not(.blocked) { background: #6f2bff; color: #fff; }
.edit-btn.blocked { border-color: #333; color: #444; cursor: default; }
</style>
