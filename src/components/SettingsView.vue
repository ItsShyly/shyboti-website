<script setup lang="ts">
import { ref, onMounted, watch } from 'vue'
import { API } from '../api'
import { useAuth } from '../auth'

const { session } = useAuth()

// ── Prefix ────────────────────────────────────────────────────────────────
const prefix      = ref('+')
const prefixSaved = ref(false)
const prefixSaving = ref(false)

// ── Log opt-out ───────────────────────────────────────────────────────────
const logsEnabled   = ref(true)
const logsSaving    = ref(false)

// ── Bot management ────────────────────────────────────────────────────────
const removeConfirm = ref(false)
let removeTimer: ReturnType<typeof setTimeout> | null = null

// ── Counters ──────────────────────────────────────────────────────────────
interface Counter { name: string; value: number }
const counters     = ref<Counter[]>([])
const countersLoading = ref(false)
const counterResetting = ref<string | null>(null)

// ── Variables ─────────────────────────────────────────────────────────────
interface Var { name: string; value: string }
const vars         = ref<Var[]>([])
const varsLoading  = ref(false)
const varDeleting  = ref<string | null>(null)

// ── Load ──────────────────────────────────────────────────────────────────
async function load() {
  if (!session.value) return
  const h = { Authorization: `Bearer ${session.value.token}` }
  const ch = session.value.channel

  // Load prefix & log settings from channel settings endpoint
  try {
    const res = await fetch(`${API}/settings/${ch}`, { headers: h })
    if (res.ok) {
      const d = await res.json() as any
      prefix.value     = d.prefix      ?? '+'
      logsEnabled.value = d.logsEnabled ?? true
    }
  } catch {}

  // Load counters
  countersLoading.value = true
  try {
    const res = await fetch(`${API}/settings/${ch}/counters`, { headers: h })
    if (res.ok) counters.value = (await res.json()).counters ?? []
  } catch {} finally { countersLoading.value = false }

  // Load variables
  varsLoading.value = true
  try {
    const res = await fetch(`${API}/settings/${ch}/vars`, { headers: h })
    if (res.ok) vars.value = (await res.json()).vars ?? []
  } catch {} finally { varsLoading.value = false }
}

onMounted(load)
watch(() => session.value?.channel, load)

// ── Save prefix ───────────────────────────────────────────────────────────
async function savePrefix() {
  if (!session.value) return
  prefixSaving.value = true
  try {
    await fetch(`${API}/settings/${session.value.channel}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.value.token}` },
      body: JSON.stringify({ prefix: prefix.value }),
    })
    prefixSaved.value = true; setTimeout(() => prefixSaved.value = false, 2000)
  } catch {}
  prefixSaving.value = false
}

// ── Save log opt-out ──────────────────────────────────────────────────────
async function toggleLogs() {
  if (!session.value) return
  logsSaving.value = true
  try {
    await fetch(`${API}/settings/${session.value.channel}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.value.token}` },
      body: JSON.stringify({ logsEnabled: logsEnabled.value }),
    })
  } catch {}
  logsSaving.value = false
}

// ── Remove bot ────────────────────────────────────────────────────────────
function startRemove() {
  if (removeConfirm.value) {
    window.location.href = `${API}/auth/remove`
    return
  }
  removeConfirm.value = true
  if (removeTimer) clearTimeout(removeTimer)
  removeTimer = setTimeout(() => { removeConfirm.value = false }, 5000)
}

// ── Reset counter ─────────────────────────────────────────────────────────
async function resetCounter(name: string) {
  if (!session.value) return
  counterResetting.value = name
  try {
    await fetch(`${API}/settings/${session.value.channel}/counters/${encodeURIComponent(name)}/reset`, {
      method: 'POST', headers: { Authorization: `Bearer ${session.value.token}` }
    })
    const c = counters.value.find(c => c.name === name)
    if (c) c.value = 0
  } catch {}
  counterResetting.value = null
}

// ── Delete variable ───────────────────────────────────────────────────────
async function deleteVar(name: string) {
  if (!session.value) return
  varDeleting.value = name
  try {
    await fetch(`${API}/settings/${session.value.channel}/vars/${encodeURIComponent(name)}`, {
      method: 'DELETE', headers: { Authorization: `Bearer ${session.value.token}` }
    })
    vars.value = vars.value.filter(v => v.name !== name)
  } catch {}
  varDeleting.value = null
}
</script>

<template>
  <div class="settings">
    <div class="page-header">
      <h2 class="page-title">Settings</h2>
      <p class="page-sub">Channel settings for <span class="chan">#{{ session?.channel }}</span></p>
    </div>

    <!-- ── Bot Prefix ── -->
    <div class="section">
      <div class="section-title">Command Prefix</div>
      <p class="section-sub">The character before all bot commands (e.g. + for +song).</p>
      <div class="input-row">
        <input v-model="prefix" class="field-input prefix-input" maxlength="3" placeholder="+" />
        <button class="btn-save" :class="{ saved: prefixSaved }" :disabled="prefixSaving || !prefix" @click="savePrefix">
          {{ prefixSaved ? '✓ Saved' : prefixSaving ? '…' : 'Save' }}
        </button>
      </div>
    </div>

    <!-- ── Logs ── -->
    <div class="section">
      <div class="section-row">
        <div>
          <div class="section-title">Chat Logs</div>
          <p class="section-sub">Allow the bot to store and display your chat logs in the Logs view.</p>
        </div>
        <div class="toggle" :class="{ on: logsEnabled }" @click="logsEnabled = !logsEnabled; toggleLogs()">
          <div class="toggle-knob"></div>
        </div>
      </div>
    </div>

    <!-- ── Counters ── -->
    <div class="section">
      <div class="section-title">Script Counters</div>
      <p class="section-sub">All counters created via $counter.name in commands. You can reset them to 0.</p>
      <div v-if="countersLoading" class="empty">Loading…</div>
      <div v-else-if="!counters.length" class="empty">No counters yet. Use $counter.name in a command response.</div>
      <div v-else class="item-list">
        <div v-for="c in counters" :key="c.name" class="item-row">
          <code class="item-name">{{ c.name }}</code>
          <span class="item-value">{{ c.value }}</span>
          <button class="btn-reset" :disabled="counterResetting === c.name" @click="resetCounter(c.name)">
            {{ counterResetting === c.name ? '…' : '↺ Reset' }}
          </button>
        </div>
      </div>
    </div>

    <!-- ── Variables ── -->
    <div class="section">
      <div class="section-title">Script Variables</div>
      <p class="section-sub">All persistent variables set via $var.name.set(). You can delete them.</p>
      <div v-if="varsLoading" class="empty">Loading…</div>
      <div v-else-if="!vars.length" class="empty">No variables yet. Use $var.name.set(value) in a command response.</div>
      <div v-else class="item-list">
        <div v-for="v in vars" :key="v.name" class="item-row">
          <code class="item-name">{{ v.name }}</code>
          <span class="item-value var-value">{{ v.value.slice(0, 60) }}{{ v.value.length > 60 ? '…' : '' }}</span>
          <button class="btn-del" :disabled="varDeleting === v.name" @click="deleteVar(v.name)">
            {{ varDeleting === v.name ? '…' : '✕' }}
          </button>
        </div>
      </div>
    </div>

    <!-- ── Remove bot ── -->
    <div class="section danger-section">
      <div class="section-title danger-title">Danger Zone</div>
      <div class="section-row">
        <div>
          <div class="danger-label">Remove ShyBoti from channel</div>
          <p class="section-sub">This will make the bot leave your channel and delete stored tokens. All settings are preserved.</p>
        </div>
        <button class="btn-danger" :class="{ confirm: removeConfirm }" @click="startRemove">
          {{ removeConfirm ? '⚠ Confirm remove' : 'Remove bot' }}
        </button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.settings { display: flex; flex-direction: column; gap: 16px; }
.page-header { padding-bottom: 16px; border-bottom: 1px solid #222; }
.page-title { font-size: 18px; font-weight: 700; color: #e0e0e0; margin-bottom: 4px; }
.page-sub   { font-size: 12px; color: #666; }
.chan       { color: #9d6cff; }

.section { background: #1a1a1e; border: 1px solid #2a2a30; padding: 18px 20px; display: flex; flex-direction: column; gap: 10px; }
.section-title { font-size: 13px; font-weight: 700; color: #e0e0e0; }
.section-sub   { font-size: 11px; color: #555; }
.section-row   { display: flex; align-items: center; justify-content: space-between; gap: 20px; }

.input-row { display: flex; gap: 8px; align-items: center; }
.field-input { background: #111217; border: 1px solid #2a2a30; color: #e0e0e0; font-family: inherit; font-size: 13px; padding: 7px 10px; outline: none; transition: border-color .15s; }
.field-input:focus { border-color: #6f2bff55; }
.prefix-input { width: 80px; font-family: 'Consolas','Fira Mono',monospace; font-size: 16px; text-align: center; }

.btn-save { height: 34px; padding: 0 16px; border: none; background: #6f2bff; color: #fff; font-family: inherit; font-size: 12px; font-weight: 600; cursor: pointer; transition: background .15s; }
.btn-save:hover:not(:disabled) { background: #7f3fff; }
.btn-save:disabled { opacity: .4; cursor: not-allowed; }
.btn-save.saved { background: #1a3d2a; color: #23d18b; }

/* Toggle */
.toggle { width: 42px; height: 22px; background: #111217; cursor: pointer; position: relative; transition: background .2s; flex-shrink: 0; }
.toggle.on { background: #6f2bff; }
.toggle-knob { position: absolute; top: 3px; left: 3px; width: 16px; height: 16px; background: #555; transition: transform .2s, background .2s; }
.toggle.on .toggle-knob { transform: translateX(20px); background: #fff; }

.empty { font-size: 12px; color: #444; padding: 8px 0; }

.item-list { display: flex; flex-direction: column; gap: 2px; }
.item-row  { display: flex; align-items: center; gap: 12px; padding: 8px 12px; background: #141418; border: 1px solid #1e1e22; }
.item-name  { font-family: 'Consolas','Fira Mono',monospace; font-size: 12px; color: #9d6cff; min-width: 100px; flex-shrink: 0; }
.item-value { font-size: 12px; color: #888; flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.var-value  { font-family: 'Consolas','Fira Mono',monospace; color: #e5c07b; }

.btn-reset { height: 26px; padding: 0 10px; border: 1px solid #23d18b44; background: transparent; color: #23d18b; font-family: inherit; font-size: 11px; cursor: pointer; flex-shrink: 0; }
.btn-reset:hover:not(:disabled) { background: rgba(35,209,139,.1); }
.btn-reset:disabled { opacity: .4; cursor: not-allowed; }

.btn-del { height: 26px; padding: 0 10px; border: 1px solid #f1494944; background: transparent; color: #f14949; font-family: inherit; font-size: 11px; cursor: pointer; flex-shrink: 0; }
.btn-del:hover:not(:disabled) { background: rgba(241,73,73,.1); }
.btn-del:disabled { opacity: .4; cursor: not-allowed; }

.danger-section { border-color: #f1494933; }
.danger-title   { color: #f14949; }
.danger-label   { font-size: 13px; font-weight: 600; color: #e0e0e0; margin-bottom: 4px; }

.btn-danger { height: 34px; padding: 0 16px; border: 1px solid #f1494966; background: transparent; color: #f14949; font-family: inherit; font-size: 12px; font-weight: 600; cursor: pointer; flex-shrink: 0; transition: background .15s; }
.btn-danger:hover { background: rgba(241,73,73,.1); }
.btn-danger.confirm { border-color: #f14949; background: rgba(241,73,73,.2); animation: pulse-red .6s infinite alternate; }
@keyframes pulse-red { from { box-shadow: none; } to { box-shadow: 0 0 8px rgba(241,73,73,.4); } }
</style>
