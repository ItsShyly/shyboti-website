<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { API } from '../api'
import { useAuth } from '../auth'

const { session } = useAuth()

interface RoleConfig {
  modsEnabled: boolean
  canToggleCommands: boolean
  canEditCooldowns: boolean
  canManage7TV: boolean
}

interface ModEntry {
  username: string
  blocked: boolean
}

const modRole = ref<RoleConfig>({
  modsEnabled: true,
  canToggleCommands: true,
  canEditCooldowns: false,
  canManage7TV: false,
})

const mods        = ref<ModEntry[]>([])
const modsLoading = ref(false)

const permissions: { key: keyof Omit<RoleConfig, 'modsEnabled'>; label: string; desc: string }[] = [
  { key: 'canToggleCommands', label: 'Toggle Commands',  desc: 'Enable or disable commands in the commands panel.' },
  { key: 'canEditCooldowns',  label: 'Edit Cooldowns',   desc: 'Change the cooldown timer on commands.' },
  { key: 'canManage7TV',      label: 'Manage 7TV',       desc: 'Add, remove or configure 7TV emote rules.' },
]

const saved  = ref(false)
const saving = ref(false)

async function load() {
  if (!session.value) return
  try {
    const res = await fetch(`${API}/role/${session.value.channel}`, {
      headers: { Authorization: `Bearer ${session.value.token}` }
    })
    if (!res.ok) return
    const data = await res.json() as { role: string; permissions: RoleConfig }
    modRole.value = { ...modRole.value, ...data.permissions }
  } catch {}
}

async function loadMods() {
  if (!session.value) return
  modsLoading.value = true
  try {
    const res = await fetch(`${API}/mods/${session.value.channel}`, {
      headers: { Authorization: `Bearer ${session.value.token}` }
    })
    if (!res.ok) return
    const data = await res.json() as { mods: ModEntry[] }
    mods.value = data.mods
  } catch {} finally {
    modsLoading.value = false
  }
}

async function save() {
  if (!session.value) return
  saving.value = true
  try {
    await fetch(`${API}/roles/${session.value.channel}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.value.token}` },
      body: JSON.stringify(modRole.value),
    })
    saved.value = true
    setTimeout(() => (saved.value = false), 2000)
  } catch {}
  saving.value = false
}

async function toggleModBlock(mod: ModEntry) {
  if (!session.value) return
  mod.blocked = !mod.blocked
  try {
    await fetch(`${API}/mods/${session.value.channel}/${mod.username}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.value.token}` },
      body: JSON.stringify({ blocked: mod.blocked }),
    })
  } catch { mod.blocked = !mod.blocked }
}

onMounted(() => { load(); loadMods() })
</script>

<template>
  <div class="roles">
    <div class="roles-header">
      <div>
        <h2 class="roles-title">Roles</h2>
        <p class="roles-sub">Control what mods can access in <span class="chan">#{{ session?.channel }}</span>.</p>
      </div>
      <button class="save-btn" :class="{ saved }" :disabled="saving" @click="save">
        {{ saved ? '✓ Saved' : saving ? 'Saving…' : 'Save changes' }}
      </button>
    </div>

    <!-- Master mod toggle -->
    <div class="role-section">
      <div class="master-row">
        <div class="master-info">
          <div class="role-section-title">
            <span class="role-badge mod">MOD</span>
            Moderator Access
          </div>
          <p class="role-section-sub">Allow mods to access the dashboard at all. When off, mods see nothing.</p>
        </div>
        <div class="toggle" :class="{ on: modRole.modsEnabled }" @click="modRole.modsEnabled = !modRole.modsEnabled">
          <div class="toggle-knob"></div>
        </div>
      </div>

      <!-- Per-permission toggles — only visible when mods are enabled -->
      <div class="perm-list" :class="{ dimmed: !modRole.modsEnabled }">
        <div v-for="perm in permissions" :key="perm.key" class="perm-row">
          <div class="perm-info">
            <div class="perm-label">{{ perm.label }}</div>
            <div class="perm-desc">{{ perm.desc }}</div>
          </div>
          <div
            class="toggle sm"
            :class="{ on: modRole[perm.key] && modRole.modsEnabled }"
            @click="if (modRole.modsEnabled) modRole[perm.key] = !modRole[perm.key]"
          >
            <div class="toggle-knob"></div>
          </div>
        </div>
      </div>
    </div>

    <!-- Individual mod overrides -->
    <div class="role-section">
      <div class="role-section-title">
        <span class="role-badge mod">MODS</span>
        Individual Mod Access
      </div>
      <p class="role-section-sub">Block specific mods from accessing the dashboard regardless of global settings.</p>

      <div v-if="modsLoading" class="mods-empty">Loading mods…</div>
      <div v-else-if="mods.length === 0" class="mods-empty">No mods found — make sure the bot is in your channel.</div>

      <div v-else class="mod-list">
        <div v-for="mod in mods" :key="mod.username" class="mod-row">
          <div class="mod-name">
            <span class="mod-dot" :class="{ blocked: mod.blocked }"></span>
            {{ mod.username }}
          </div>
          <div class="mod-status" :class="mod.blocked ? 'status-blocked' : 'status-allowed'">
            {{ mod.blocked ? 'Blocked' : 'Allowed' }}
          </div>
          <button
            class="mod-btn"
            :class="{ 'mod-btn-block': !mod.blocked, 'mod-btn-allow': mod.blocked }"
            @click="toggleModBlock(mod)"
          >
            {{ mod.blocked ? 'Allow' : 'Block' }}
          </button>
        </div>
      </div>
    </div>

    <div class="coming-soon">
      <span class="cs-icon">🛠</span>
      Custom roles coming soon — create named roles with specific permission sets.
    </div>
  </div>
</template>

<style scoped>
.roles { display: flex; flex-direction: column; gap: 24px; }

.roles-header {
  display: flex; align-items: flex-start; justify-content: space-between; gap: 16px;
  padding-bottom: 16px; border-bottom: 1px solid #222;
}
.roles-title { font-size: 18px; font-weight: 700; color: #e0e0e0; margin-bottom: 4px; }
.roles-sub   { font-size: 12px; color: #666; }
.chan        { color: #9d6cff; }

.save-btn {
  height: 34px; padding: 0 18px; border: none; flex-shrink: 0;
  background: #6f2bff; color: #fff;
  font-family: inherit; font-size: 12px; font-weight: 600; cursor: pointer;
  transition: background 0.15s;
}
.save-btn:hover { background: #7f3fff; }
.save-btn.saved { background: #1a3d2a; color: #23d18b; cursor: default; }

.role-section {
  background: #222226; border: 1px solid #2a2a30; padding: 20px;
  display: flex; flex-direction: column; gap: 0;
}
.role-section-title {
  display: flex; align-items: center; gap: 10px;
  font-size: 14px; font-weight: 700; color: #e0e0e0; margin-bottom: 6px;
}
.role-badge {
  font-size: 10px; font-weight: 700; padding: 2px 7px; border-radius: 3px; letter-spacing: 0.05em;
}
.role-badge.mod { background: #6f2bff33; color: #9d6cff; border: 1px solid #6f2bff55; }
.role-section-sub { font-size: 12px; color: #555; }

/* Master row */
.master-row {
  display: flex; align-items: flex-start; justify-content: space-between; gap: 16px;
  padding-bottom: 16px; margin-bottom: 16px; border-bottom: 1px solid #2a2a30;
}
.master-info { flex: 1; }
.master-info .role-section-sub { margin-top: 4px; }

/* Perm list */
.perm-list { display: flex; flex-direction: column; gap: 2px; transition: opacity 0.2s; }
.perm-list.dimmed { opacity: 0.35; pointer-events: none; }

.perm-row {
  display: flex; align-items: center; justify-content: space-between; gap: 16px;
  padding: 12px 16px; background: #2c2c2e; transition: background 0.1s;
}
.perm-row:hover { background: #313135; }

.perm-info { flex: 1; }
.perm-label { font-size: 13px; font-weight: 600; color: #d0d0d0; margin-bottom: 2px; }
.perm-desc  { font-size: 11px; color: #555; }

/* Toggle switch */
.toggle {
  width: 42px; height: 22px; border-radius: 11px;
  background: #111217; cursor: pointer;
  position: relative; transition: background 0.2s; flex-shrink: 0;
}
.toggle.on { background: #6f2bff; }
.toggle.sm { width: 36px; height: 20px; border-radius: 10px; }
.toggle-knob {
  position: absolute; top: 3px; left: 3px;
  width: 16px; height: 16px; border-radius: 50%;
  background: #555; transition: transform 0.2s, background 0.2s;
}
.toggle.sm .toggle-knob { width: 14px; height: 14px; }
.toggle.on .toggle-knob { transform: translateX(20px); background: #fff; }
.toggle.sm.on .toggle-knob { transform: translateX(16px); }

/* Mod list */
.mods-empty { font-size: 12px; color: #555; padding: 20px 0 4px; }
.mod-list { display: flex; flex-direction: column; gap: 2px; margin-top: 16px; }

.mod-row {
  display: flex; align-items: center; gap: 12px;
  padding: 10px 16px; background: #2c2c2e;
  transition: background 0.1s;
}
.mod-row:hover { background: #313135; }

.mod-name {
  flex: 1; font-size: 13px; font-weight: 600; color: #d0d0d0;
  display: flex; align-items: center; gap: 8px;
}
.mod-dot {
  width: 7px; height: 7px; border-radius: 50%;
  background: #23d18b; flex-shrink: 0; transition: background 0.2s;
}
.mod-dot.blocked { background: #f14949; }

.mod-status {
  font-size: 11px; font-weight: 600; min-width: 50px; text-align: right;
}
.status-allowed { color: #23d18b; }
.status-blocked { color: #f14949; }

.mod-btn {
  height: 28px; padding: 0 14px; border: 1px solid;
  background: transparent; font-family: inherit; font-size: 11px;
  font-weight: 600; cursor: pointer; transition: background 0.15s, color 0.15s;
}
.mod-btn-block { border-color: #f1494944; color: #f14949; }
.mod-btn-block:hover { background: #f1494922; }
.mod-btn-allow { border-color: #23d18b44; color: #23d18b; }
.mod-btn-allow:hover { background: #23d18b22; }

.coming-soon {
  display: flex; align-items: center; gap: 10px;
  padding: 14px 18px; background: #1a1a1e; border: 1px dashed #333;
  font-size: 12px; color: #555;
}
.cs-icon { font-size: 1rem; }
</style>
