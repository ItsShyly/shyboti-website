<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { API } from '../api'
import { useAuth } from '../auth'
import { useI18n } from '../i18n'
import type { RolePermissions } from '../auth'

const { session } = useAuth()
const { t } = useI18n()

// >>> Permission groups for the UI - labels pulled from i18n
const PERM_GROUPS = computed(() => [
  { label: t('perm.group.dashboard'), perms: [
    { key: 'dashboard' as keyof Omit<RolePermissions,'modsEnabled'>,       label: t('perm.dashboard'),       desc: t('perm.dashboard.desc') },
  ]},
  { label: t('perm.group.commands'), perms: [
    { key: 'commands_view'   as keyof Omit<RolePermissions,'modsEnabled'>, label: t('perm.commands_view'),   desc: t('perm.commands_view.desc') },
    { key: 'commands_toggle' as keyof Omit<RolePermissions,'modsEnabled'>, label: t('perm.commands_toggle'), desc: t('perm.commands_toggle.desc') },
    { key: 'commands_edit'   as keyof Omit<RolePermissions,'modsEnabled'>, label: t('perm.commands_edit'),   desc: t('perm.commands_edit.desc') },
    { key: 'commands_delete' as keyof Omit<RolePermissions,'modsEnabled'>, label: t('perm.commands_delete'), desc: t('perm.commands_delete.desc') },
  ]},
  { label: t('perm.group.automations'), perms: [
    { key: 'automations_view'   as keyof Omit<RolePermissions,'modsEnabled'>, label: t('perm.automations_view'),   desc: t('perm.automations_view.desc') },
    { key: 'automations_toggle' as keyof Omit<RolePermissions,'modsEnabled'>, label: t('perm.automations_toggle'), desc: t('perm.automations_toggle.desc') },
    { key: 'automations_edit'   as keyof Omit<RolePermissions,'modsEnabled'>, label: t('perm.automations_edit'),   desc: t('perm.automations_edit.desc') },
    { key: 'automations_delete' as keyof Omit<RolePermissions,'modsEnabled'>, label: t('perm.automations_delete'), desc: t('perm.automations_delete.desc') },
  ]},
  { label: t('perm.group.logs'), perms: [
    { key: 'logs_view' as keyof Omit<RolePermissions,'modsEnabled'>, label: t('perm.logs_view'), desc: t('perm.logs_view.desc') },
  ]},
  { label: t('perm.group.moderation'), perms: [
    { key: 'moderation_view'   as keyof Omit<RolePermissions,'modsEnabled'>, label: t('perm.moderation_view'),   desc: t('perm.moderation_view.desc') },
    { key: 'moderation_manage' as keyof Omit<RolePermissions,'modsEnabled'>, label: t('perm.moderation_manage'), desc: t('perm.moderation_manage.desc') },
  ]},
])

const DEFAULT_PERMS: Omit<RolePermissions, 'modsEnabled'> = {
  dashboard:        true,
  commands_view:      true, commands_toggle:     true, commands_edit:      false, commands_delete:     false,
  automations_view:   true, automations_toggle:  true, automations_edit:   false, automations_delete:  false,
  logs_view:          true,
  moderation_view:    true,
  moderation_manage:  false,
}

// >>> Global mod defaults
const modsEnabled = ref(true)
const globalPerms = ref<Omit<RolePermissions,'modsEnabled'>>({ ...DEFAULT_PERMS })

// >>> Mod list
interface ModEntry {
  username:    string
  blocked:     boolean
  permissions: Omit<RolePermissions,'modsEnabled'> | null
}

const mods        = ref<ModEntry[]>([])
const modsLoading = ref(false)
const expandedMod = ref<string | null>(null)

// >>> Save state
const saving    = ref(false)
const saved     = ref(false)
const modSaving = ref<string | null>(null)

function showSaved() { saved.value = true; setTimeout(() => saved.value = false, 2000) }

// >>> Load
async function load() {
  if (!session.value) return
  try {
    const res = await fetch(`${API}/role/${session.value.channel}`, {
      headers: { Authorization: `Bearer ${session.value.token}` }
    })
    if (!res.ok) return
    const data = await res.json() as { role: string; permissions: RolePermissions }
    modsEnabled.value = data.permissions.modsEnabled ?? true
    const { modsEnabled: _, ...rest } = data.permissions
    Object.assign(globalPerms.value, rest)
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

// >>> Save global
async function save() {
  if (!session.value) return
  saving.value = true
  try {
    await fetch(`${API}/roles/${session.value.channel}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.value.token}` },
      body: JSON.stringify({ modsEnabled: modsEnabled.value, ...globalPerms.value }),
    })
    showSaved()
  } catch {}
  saving.value = false
}

// >>> Per-mod
function toggleExpand(username: string) {
  expandedMod.value = expandedMod.value === username ? null : username
}

function modPerms(mod: ModEntry): Omit<RolePermissions,'modsEnabled'> {
  return mod.permissions ?? { ...globalPerms.value }
}

function hasOverride(mod: ModEntry): boolean {
  return mod.blocked || mod.permissions !== null
}

async function saveModOverride(mod: ModEntry) {
  if (!session.value) return
  modSaving.value = mod.username
  try {
    await fetch(`${API}/mods/${session.value.channel}/${mod.username}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.value.token}` },
      body: JSON.stringify({ blocked: mod.blocked, permissions: mod.permissions }),
    })
  } catch {}
  modSaving.value = null
}

async function blockMod(mod: ModEntry) {
  mod.blocked = !mod.blocked
  if (mod.blocked) mod.permissions = null
  await saveModOverride(mod)
}

function setModOverride(mod: ModEntry) {
  if (!mod.permissions) {
    mod.permissions = { ...globalPerms.value }
  }
}

async function clearModOverride(mod: ModEntry) {
  mod.permissions = null
  mod.blocked = false
  await saveModOverride(mod)
}

async function toggleModPerm(mod: ModEntry, key: keyof Omit<RolePermissions,'modsEnabled'>) {
  if (!mod.permissions) setModOverride(mod)
  mod.permissions![key] = !mod.permissions![key]
  await saveModOverride(mod)
}

onMounted(() => { load(); loadMods() })
</script>

<template>
  <div class="roles">
    <div class="roles-header">
      <div>
        <h2 class="roles-title">{{ t('roles.title') }}</h2>
        <p class="roles-sub">{{ t('roles.sub') }} <span class="chan">#{{ session?.channel }}</span>.</p>
      </div>
      <span v-if="saved" class="autosave-indicator">{{ t('roles.saved') }}</span>
    </div>

    <!-- Master enable/disable -->
    <div class="section">
      <div class="master-row">
        <div class="master-info">
          <div class="section-title">
            <span class="badge mod">MOD</span>
            {{ t('roles.mod_access') }}
          </div>
          <p class="section-sub">{{ t('roles.mod_sub') }}</p>
        </div>
        <div class="toggle" :class="{ on: modsEnabled }" @click="modsEnabled = !modsEnabled; save()">
          <div class="toggle-knob"></div>
        </div>
      </div>

      <!-- Permission grid - dimmed when mods disabled -->
      <div class="perm-grid" :class="{ dimmed: !modsEnabled }">
        <div v-for="group in PERM_GROUPS" :key="group.label" class="perm-group">
          <div class="perm-group-label">{{ group.label }}</div>
          <div class="perm-rows">
            <div v-for="perm in group.perms" :key="perm.key" class="perm-row">
              <div class="perm-info">
                <div class="perm-label">{{ perm.label }}</div>
                <div class="perm-desc">{{ perm.desc }}</div>
              </div>
              <div
                class="toggle sm"
                :class="{ on: modsEnabled && (globalPerms as any)[perm.key] }"
                @click="modsEnabled && ((globalPerms as any)[perm.key] = !(globalPerms as any)[perm.key]); modsEnabled && save()"
              ><div class="toggle-knob"></div></div>
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- Individual mod overrides -->
    <div class="section">
      <div class="section-title">
        <span class="badge mod">MODS</span>
        {{ t('roles.overrides') }}
      </div>
      <p class="section-sub">{{ t('roles.overrides_sub') }}</p>

      <div v-if="modsLoading" class="mods-empty">{{ t('roles.loading') }}</div>
      <div v-else-if="mods.length === 0" class="mods-empty">{{ t('roles.no_mods') }}</div>

      <div v-else class="mod-list">
        <div v-for="mod in mods" :key="mod.username" class="mod-item" :class="{ expanded: expandedMod === mod.username, blocked: mod.blocked, overridden: !mod.blocked && mod.permissions !== null }">

          <!-- Mod header row -->
          <div class="mod-header" @click="toggleExpand(mod.username)">
            <span class="mod-dot" :class="{ blocked: mod.blocked, override: !mod.blocked && mod.permissions !== null }"></span>
            <span class="mod-name">{{ mod.username }}</span>
            <span class="mod-badge" v-if="mod.blocked">{{ t('roles.badge.blocked') }}</span>
            <span class="mod-badge override" v-else-if="mod.permissions !== null">{{ t('roles.badge.custom') }}</span>
            <span class="mod-badge default" v-else>{{ t('roles.badge.default') }}</span>
            <div class="mod-header-actions" @click.stop>
              <button class="mod-block-btn" :class="{ 'mod-block-btn-allow': mod.blocked }" @click="blockMod(mod)" :disabled="modSaving === mod.username">
                {{ mod.blocked ? t('roles.unblock') : t('roles.block') }}
              </button>
            </div>
            <span class="mod-chevron">{{ expandedMod === mod.username ? '▲' : '▼' }}</span>
          </div>

          <!-- Expanded permission overrides -->
          <div v-if="expandedMod === mod.username && !mod.blocked" class="mod-perms">
            <div class="mod-perms-header">
              <span class="mod-perms-sub">{{ mod.permissions !== null ? t('roles.custom_perms') : t('roles.using_default') }}</span>
              <button v-if="mod.permissions !== null" class="reset-btn" @click="clearModOverride(mod)" :disabled="modSaving === mod.username">{{ t('roles.reset') }}</button>
              <button v-else class="override-btn" @click="setModOverride(mod)">{{ t('roles.set_custom') }}</button>
            </div>

            <div v-if="mod.permissions !== null" class="mod-perm-grid">
              <div v-for="group in PERM_GROUPS" :key="group.label" class="mod-perm-group">
                <div class="perm-group-label">{{ group.label }}</div>
                <div class="perm-rows">
                  <div v-for="perm in group.perms" :key="perm.key" class="perm-row compact">
                    <div class="perm-info">
                      <div class="perm-label">{{ perm.label }}</div>
                    </div>
                    <div class="toggle-wrap">
                      <span class="default-val" :class="{ active: (globalPerms as any)[perm.key] }">
                        {{ (globalPerms as any)[perm.key] ? t('roles.default_on') : t('roles.default_off') }}
                      </span>
                      <div class="toggle sm"
                        :class="{ on: (mod.permissions as any)[perm.key] }"
                        @click="toggleModPerm(mod, perm.key)"
                      ><div class="toggle-knob"></div></div>
                    </div>
                  </div>
                </div>
              </div>
            </div>

            <!-- Read-only view when using defaults -->
            <div v-else class="mod-perm-grid dimmed">
              <div v-for="group in PERM_GROUPS" :key="group.label" class="mod-perm-group">
                <div class="perm-group-label">{{ group.label }}</div>
                <div class="perm-rows">
                  <div v-for="perm in group.perms" :key="perm.key" class="perm-row compact">
                    <div class="perm-info"><div class="perm-label">{{ perm.label }}</div></div>
                    <div class="toggle sm" :class="{ on: modsEnabled && (globalPerms as any)[perm.key] }">
                      <div class="toggle-knob"></div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.roles { display: flex; flex-direction: column; gap: 20px; }

.roles-header {
  display: flex; align-items: flex-start; justify-content: space-between; gap: 16px;
  padding-bottom: 16px; border-bottom: 1px solid #222;
}
.roles-title { font-size: 18px; font-weight: 700; color: #e0e0e0; margin-bottom: 4px; }
.roles-sub   { font-size: 12px; color: #666; }
.chan        { color: #9d6cff; }

.autosave-indicator { font-size: 11px; color: #23d18b; padding: 4px 10px; background: rgba(35,209,139,.08); border: 1px solid rgba(35,209,139,.3); }

.section { background: #1a1a1e; border: 1px solid #2a2a30; padding: 18px 20px; }
.section-title {
  display: flex; align-items: center; gap: 8px;
  font-size: 13px; font-weight: 700; color: #e0e0e0; margin-bottom: 4px;
}
.section-sub { font-size: 11px; color: #555; margin-bottom: 14px; }

.badge {
  font-size: 9px; font-weight: 700; padding: 2px 6px; letter-spacing: .05em;
}
.badge.mod { background: #6f2bff22; color: #9d6cff; border: 1px solid #6f2bff44; }

.master-row {
  display: flex; align-items: flex-start; justify-content: space-between; gap: 16px;
  padding-bottom: 14px; margin-bottom: 14px; border-bottom: 1px solid #222;
}
.master-info { flex: 1; }
.master-info .section-sub { margin-top: 4px; }

.perm-grid {
  display: grid; grid-template-columns: repeat(auto-fill, minmax(220px, 1fr)); gap: 12px;
  transition: opacity .2s;
}
.perm-grid.dimmed { opacity: .3; pointer-events: none; }

.perm-group { display: flex; flex-direction: column; gap: 4px; }
.perm-group-label {
  font-size: 9px; font-weight: 700; text-transform: uppercase; letter-spacing: .08em;
  color: #9d6cff; margin-bottom: 4px;
}
.perm-rows { display: flex; flex-direction: column; gap: 2px; }

.perm-row {
  display: flex; align-items: center; justify-content: space-between; gap: 12px;
  padding: 8px 10px; background: #222226; transition: background .1s;
}
.perm-row:hover { background: #28282e; }
.perm-row.compact { padding: 6px 10px; }

.perm-info { flex: 1; min-width: 0; }
.perm-label { font-size: 12px; font-weight: 600; color: #d0d0d0; }
.perm-desc  { font-size: 10px; color: #555; margin-top: 1px; }

.toggle {
  width: 38px; height: 20px;
  background: #111217; cursor: pointer;
  position: relative; transition: background .2s; flex-shrink: 0;
}
.toggle.on { background: #6f2bff; }
.toggle.sm { width: 32px; height: 18px; }
.toggle-knob {
  position: absolute; top: 3px; left: 3px;
  width: 14px; height: 14px;
  background: #555; transition: transform .2s, background .2s;
}
.toggle.sm .toggle-knob { width: 12px; height: 12px; }
.toggle.on .toggle-knob { transform: translateX(18px); background: #fff; }
.toggle.sm.on .toggle-knob { transform: translateX(14px); }

.mods-empty { font-size: 12px; color: #555; padding: 16px 0 4px; }
.mod-list { display: flex; flex-direction: column; gap: 2px; margin-top: 14px; }

.mod-item { border: 1px solid #222; background: #141418; transition: border-color .15s; }
.mod-item.expanded   { border-color: #6f2bff44; }
.mod-item.blocked    { border-color: #f1494933; opacity: .8; }
.mod-item.overridden { border-color: #e5c07b33; }

.mod-header {
  display: flex; align-items: center; gap: 10px;
  padding: 10px 14px; cursor: pointer; user-select: none;
  transition: background .1s;
}
.mod-header:hover { background: #1c1c22; }

.mod-dot {
  width: 7px; height: 7px; flex-shrink: 0;
  background: #23d18b; transition: background .2s;
}
.mod-dot.blocked  { background: #f14949; }
.mod-dot.override { background: #e5c07b; }

.mod-name { flex: 1; font-size: 13px; font-weight: 600; color: #d0d0d0; }

.mod-badge {
  font-size: 9px; font-weight: 700; padding: 2px 6px; letter-spacing: .04em;
  background: #23d18b15; color: #23d18b; border: 1px solid #23d18b33;
}
.mod-badge.default  { background: #11111a; color: #444; border-color: #222; }
.mod-badge.override { background: #e5c07b15; color: #e5c07b; border-color: #e5c07b33; }

.mod-header-actions { display: flex; gap: 6px; }
.mod-block-btn {
  height: 24px; padding: 0 10px; border: 1px solid #f1494944;
  background: transparent; color: #f14949; font-family: inherit; font-size: 10px;
  cursor: pointer; transition: background .15s;
}
.mod-block-btn:hover { background: #f1494911; }
.mod-block-btn.mod-block-btn-allow { border-color: #23d18b44; color: #23d18b; }
.mod-block-btn.mod-block-btn-allow:hover { background: #23d18b11; }
.mod-block-btn:disabled { opacity: .4; cursor: not-allowed; }

.mod-chevron { font-size: 8px; color: #444; }

.mod-perms { padding: 12px 14px 14px; border-top: 1px solid #222; background: #111115; }
.mod-perms-header {
  display: flex; align-items: center; justify-content: space-between; margin-bottom: 12px;
}
.mod-perms-sub { font-size: 11px; color: #555; }

.reset-btn, .override-btn {
  height: 24px; padding: 0 10px; border: 1px solid #2a2a30;
  background: transparent; font-family: inherit; font-size: 10px; cursor: pointer;
}
.reset-btn    { color: #e5c07b; border-color: #e5c07b33; }
.reset-btn:hover { background: #e5c07b11; }
.override-btn { color: #9d6cff; border-color: #6f2bff44; }
.override-btn:hover { background: #6f2bff11; }
.reset-btn:disabled { opacity: .4; cursor: not-allowed; }

.mod-perm-grid {
  display: grid; grid-template-columns: repeat(auto-fill, minmax(180px, 1fr)); gap: 10px;
}
.mod-perm-grid.dimmed { opacity: .5; pointer-events: none; }
.mod-perm-group { display: flex; flex-direction: column; gap: 3px; }

.toggle-wrap { display: flex; align-items: center; gap: 8px; flex-shrink: 0; }
.default-val { font-size: 9px; color: #333; white-space: nowrap; }
.default-val.active { color: #555; }

@media (max-width: 680px) {
  .roles-header { flex-direction: column; align-items: stretch; }
  .perm-grid { grid-template-columns: 1fr; }
  .mod-perm-grid { grid-template-columns: 1fr; }
  .master-row { flex-direction: column; }
}
</style>
