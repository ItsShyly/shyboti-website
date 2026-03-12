<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { API } from '../api'
import { useAuth } from '../auth'

const { session } = useAuth()

// ── Types ──────────────────────────────────────────────────────────────────
interface BlockedTerm   { id: number; term: string; action: string; duration: number }
interface SpamFilter    { id: number; type: string; threshold: number; action: string; duration: number }
interface NukeConfig    { id: number; trigger: string; duration: number; label: string }

// ── Tab ────────────────────────────────────────────────────────────────────
type Tab = 'blocked' | 'spam' | 'nukes'
const activeTab = ref<Tab>('blocked')

// ── Blocked Terms ──────────────────────────────────────────────────────────
const blockedTerms  = ref<BlockedTerm[]>([])
const newTerm       = ref('')
const newTermAction = ref<'delete' | 'timeout' | 'ban'>('delete')
const newTermDur    = ref(300)

// ── Spam Filters ───────────────────────────────────────────────────────────
const spamFilters   = ref<SpamFilter[]>([])
const SPAM_TYPES = [
  { value: 'caps',    label: 'Caps spam',     hint: '% of message in caps' },
  { value: 'links',   label: 'Link spam',     hint: 'links per message' },
  { value: 'emoji',   label: 'Emoji spam',    hint: 'emojis per message' },
  { value: 'repeat',  label: 'Repeat chars',  hint: 'same char repeated' },
  { value: 'flood',   label: 'Message flood', hint: 'messages per 10s' },
]
const newSpamType      = ref('caps')
const newSpamThreshold = ref(70)
const newSpamAction    = ref<'delete' | 'timeout' | 'ban'>('delete')
const newSpamDur       = ref(300)

// ── Nukes ──────────────────────────────────────────────────────────────────
const nukes    = ref<NukeConfig[]>([])
const newNuke  = ref('')
const newNukeDur   = ref(600)
const newNukeLabel = ref('')

// ── Shared ────────────────────────────────────────────────────────────────
const loading = ref(false)
const saving  = ref(false)
const error   = ref('')
const success = ref('')

function showSuccess(msg: string) { success.value = msg; setTimeout(() => success.value = '', 3000) }

async function load() {
  if (!session.value) return
  loading.value = true; error.value = ''
  try {
    const headers = { Authorization: `Bearer ${session.value.token}` }
    const ch = session.value.channel

    const [bRes, sRes, nRes] = await Promise.all([
      fetch(`${API}/moderation/${ch}/blocked-terms`, { headers }),
      fetch(`${API}/moderation/${ch}/spam-filters`,  { headers }),
      fetch(`${API}/moderation/${ch}/nukes`,          { headers }),
    ])

    if (bRes.ok) blockedTerms.value  = (await bRes.json()).items  ?? []
    if (sRes.ok) spamFilters.value   = (await sRes.json()).items  ?? []
    if (nRes.ok) nukes.value         = (await nRes.json()).items  ?? []
  } catch { error.value = 'Could not load moderation config.' }
  loading.value = false
}

async function addBlockedTerm() {
  if (!session.value || !newTerm.value.trim()) return
  saving.value = true
  try {
    const res = await fetch(`${API}/moderation/${session.value.channel}/blocked-terms`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${session.value.token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ term: newTerm.value.trim(), action: newTermAction.value, duration: newTermDur.value })
    })
    if (!res.ok) throw new Error()
    const data = await res.json()
    blockedTerms.value.push(data.item)
    newTerm.value = ''
    showSuccess('Term added.')
  } catch { error.value = 'Could not add term.' }
  saving.value = false
}

async function removeBlockedTerm(id: number) {
  if (!session.value) return
  try {
    await fetch(`${API}/moderation/${session.value.channel}/blocked-terms/${id}`, {
      method: 'DELETE', headers: { Authorization: `Bearer ${session.value.token}` }
    })
    blockedTerms.value = blockedTerms.value.filter(t => t.id !== id)
    showSuccess('Removed.')
  } catch { error.value = 'Could not remove.' }
}

async function addSpamFilter() {
  if (!session.value) return
  saving.value = true
  try {
    const res = await fetch(`${API}/moderation/${session.value.channel}/spam-filters`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${session.value.token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: newSpamType.value, threshold: newSpamThreshold.value, action: newSpamAction.value, duration: newSpamDur.value })
    })
    if (!res.ok) throw new Error()
    const data = await res.json()
    spamFilters.value.push(data.item)
    showSuccess('Spam filter added.')
  } catch { error.value = 'Could not add spam filter.' }
  saving.value = false
}

async function removeSpamFilter(id: number) {
  if (!session.value) return
  try {
    await fetch(`${API}/moderation/${session.value.channel}/spam-filters/${id}`, {
      method: 'DELETE', headers: { Authorization: `Bearer ${session.value.token}` }
    })
    spamFilters.value = spamFilters.value.filter(f => f.id !== id)
    showSuccess('Removed.')
  } catch { error.value = 'Could not remove.' }
}

async function addNuke() {
  if (!session.value || !newNuke.value.trim()) return
  saving.value = true
  try {
    const res = await fetch(`${API}/moderation/${session.value.channel}/nukes`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${session.value.token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ trigger: newNuke.value.trim(), duration: newNukeDur.value, label: newNukeLabel.value || newNuke.value.trim() })
    })
    if (!res.ok) throw new Error()
    const data = await res.json()
    nukes.value.push(data.item)
    newNuke.value = ''; newNukeLabel.value = ''
    showSuccess('Nuke created.')
  } catch { error.value = 'Could not create nuke.' }
  saving.value = false
}

async function removeNuke(id: number) {
  if (!session.value) return
  try {
    await fetch(`${API}/moderation/${session.value.channel}/nukes/${id}`, {
      method: 'DELETE', headers: { Authorization: `Bearer ${session.value.token}` }
    })
    nukes.value = nukes.value.filter(n => n.id !== id)
    showSuccess('Removed.')
  } catch { error.value = 'Could not remove.' }
}

async function fireNuke(id: number) {
  const nuke = nukes.value.find(n => n.id === id); if (!nuke || !session.value) return
  if (!confirm(`Fire nuke "${nuke.label}"? This will timeout everyone who said "${nuke.trigger}" recently.`)) return
  try {
    const res = await fetch(`${API}/moderation/${session.value.channel}/nukes/${id}/fire`, {
      method: 'POST', headers: { Authorization: `Bearer ${session.value.token}` }
    })
    const data = await res.json() as any
    showSuccess(`Nuke fired! ${data.affected ?? 0} users timed out.`)
  } catch { error.value = 'Nuke failed.' }
}

function fmtDur(s: number) {
  if (s < 60) return `${s}s`
  if (s < 3600) return `${Math.floor(s/60)}m`
  return `${Math.floor(s/3600)}h`
}

const ACTION_COLORS: Record<string, string> = { delete: '#e5c07b', timeout: '#c792ea', ban: '#f14949' }

onMounted(load)
</script>

<template>
  <div class="mod-view">
    <div class="mod-header">
      <div class="mod-title">Moderation</div>
      <div class="mod-sub">Automod rules for <span class="chan">#{{ session?.channel }}</span></div>
    </div>

    <div v-if="error"   class="mod-error">{{ error }}</div>
    <div v-if="success" class="mod-success">{{ success }}</div>

    <div class="tabs">
      <button v-for="t in (['blocked','spam','nukes'] as Tab[])" :key="t"
        class="tab-btn" :class="{ active: activeTab === t }" @click="activeTab = t">
        {{ t === 'blocked' ? 'Blocked Terms' : t === 'spam' ? 'Spam Filters' : 'Nukes' }}
      </button>
    </div>

    <div v-if="loading" class="mod-empty">Loading…</div>

    <!-- ── Blocked Terms ── -->
    <template v-else-if="activeTab === 'blocked'">
      <div class="add-row">
        <input v-model="newTerm" class="field-input flex1" placeholder="word or phrase to block" @keydown.enter="addBlockedTerm" />
        <select v-model="newTermAction" class="field-select">
          <option value="delete">Delete</option>
          <option value="timeout">Timeout</option>
          <option value="ban">Ban</option>
        </select>
        <input v-if="newTermAction !== 'delete'" v-model.number="newTermDur" type="number" min="1" class="field-input dur-input" placeholder="secs" />
        <button class="add-btn" @click="addBlockedTerm" :disabled="saving">+ Add</button>
      </div>
      <div v-if="!blockedTerms.length" class="mod-empty">No blocked terms yet.</div>
      <div v-else class="item-list">
        <div v-for="t in blockedTerms" :key="t.id" class="item-row">
          <span class="item-term">{{ t.term }}</span>
          <span class="item-action" :style="{ color: ACTION_COLORS[t.action] }">{{ t.action }}</span>
          <span v-if="t.action !== 'delete'" class="item-dur">{{ fmtDur(t.duration) }}</span>
          <button class="item-del" @click="removeBlockedTerm(t.id)">✕</button>
        </div>
      </div>
    </template>

    <!-- ── Spam Filters ── -->
    <template v-else-if="activeTab === 'spam'">
      <div class="add-row">
        <select v-model="newSpamType" class="field-select flex1">
          <option v-for="s in SPAM_TYPES" :key="s.value" :value="s.value">{{ s.label }}</option>
        </select>
        <div class="threshold-wrap">
          <span class="threshold-lbl">≥</span>
          <input v-model.number="newSpamThreshold" type="number" min="1" max="9999" class="field-input dur-input" />
          <span class="threshold-hint">{{ SPAM_TYPES.find(s => s.value === newSpamType)?.hint }}</span>
        </div>
        <select v-model="newSpamAction" class="field-select">
          <option value="delete">Delete</option>
          <option value="timeout">Timeout</option>
          <option value="ban">Ban</option>
        </select>
        <input v-if="newSpamAction !== 'delete'" v-model.number="newSpamDur" type="number" min="1" class="field-input dur-input" placeholder="secs" />
        <button class="add-btn" @click="addSpamFilter" :disabled="saving">+ Add</button>
      </div>
      <div v-if="!spamFilters.length" class="mod-empty">No spam filters yet.</div>
      <div v-else class="item-list">
        <div v-for="f in spamFilters" :key="f.id" class="item-row">
          <span class="item-term">{{ SPAM_TYPES.find(s => s.value === f.type)?.label ?? f.type }}</span>
          <span class="item-dur" style="color:#888">≥ {{ f.threshold }}</span>
          <span class="item-action" :style="{ color: ACTION_COLORS[f.action] }">{{ f.action }}</span>
          <span v-if="f.action !== 'delete'" class="item-dur">{{ fmtDur(f.duration) }}</span>
          <button class="item-del" @click="removeSpamFilter(f.id)">✕</button>
        </div>
      </div>
    </template>

    <!-- ── Nukes ── -->
    <template v-else-if="activeTab === 'nukes'">
      <div class="nuke-hint">
        A nuke watches for a trigger word in recent chat. Fire it to timeout everyone who said it.
      </div>
      <div class="add-row">
        <input v-model="newNuke" class="field-input flex1" placeholder="trigger word/phrase" @keydown.enter="addNuke" />
        <input v-model="newNukeLabel" class="field-input" style="width:120px" placeholder="label (optional)" />
        <div class="threshold-wrap">
          <span class="threshold-lbl">⏱</span>
          <input v-model.number="newNukeDur" type="number" min="1" class="field-input dur-input" />
          <span class="threshold-hint">sec timeout</span>
        </div>
        <button class="add-btn" @click="addNuke" :disabled="saving">+ Create</button>
      </div>
      <div v-if="!nukes.length" class="mod-empty">No nukes configured.</div>
      <div v-else class="item-list">
        <div v-for="n in nukes" :key="n.id" class="item-row">
          <span class="item-label">{{ n.label }}</span>
          <span class="item-term" style="color:#555">{{ n.trigger }}</span>
          <span class="item-dur">{{ fmtDur(n.duration) }}</span>
          <button class="nuke-fire-btn" @click="fireNuke(n.id)">💣 Fire</button>
          <button class="item-del" @click="removeNuke(n.id)">✕</button>
        </div>
      </div>
    </template>
  </div>
</template>

<style scoped>
.mod-view { display: flex; flex-direction: column; gap: 14px; }
.mod-header { margin-bottom: 2px; }
.mod-title { font-size: 18px; font-weight: 700; color: #e0e0e0; margin-bottom: 4px; }
.mod-sub   { font-size: 12px; color: #555; }
.chan      { color: #9d6cff; }

.mod-error   { color: #f14949; font-size: 12px; background: rgba(241,73,73,.08); border-left: 2px solid #f14949; padding: 7px 12px; }
.mod-success { color: #23d18b; font-size: 12px; background: rgba(35,209,139,.08); border-left: 2px solid #23d18b; padding: 7px 12px; }
.mod-empty   { color: #444; font-size: 13px; padding: 24px; text-align: center; }

.tabs { display: flex; gap: 0; border-bottom: 1px solid #222; }
.tab-btn {
  padding: 8px 20px; border: none; background: transparent;
  color: #555; font-family: inherit; font-size: 12px; font-weight: 600;
  cursor: pointer; border-bottom: 2px solid transparent; margin-bottom: -1px;
  transition: color .15s;
}
.tab-btn:hover { color: #aaa; }
.tab-btn.active { color: #9d6cff; border-bottom-color: #6f2bff; }

.nuke-hint { font-size: 11px; color: #555; padding: 6px 0; }

.add-row {
  display: flex; align-items: center; gap: 8px; flex-wrap: wrap;
  background: #141418; padding: 12px 14px; border: 1px solid #1e1e24;
}
.field-input {
  background: #0d0d10; border: 1px solid #2a2a30; color: #e0e0e0;
  font-family: inherit; font-size: 12px; padding: 7px 10px; outline: none;
  transition: border-color .15s; min-width: 0;
}
.field-input:focus { border-color: #6f2bff55; }
.field-select {
  background: #0d0d10; border: 1px solid #2a2a30; color: #e0e0e0;
  font-family: inherit; font-size: 12px; padding: 7px 8px; outline: none; cursor: pointer;
}
.flex1    { flex: 1; }
.dur-input { width: 70px; }
.threshold-wrap { display: flex; align-items: center; gap: 6px; }
.threshold-lbl  { font-size: 12px; color: #666; }
.threshold-hint { font-size: 10px; color: #444; white-space: nowrap; }
.add-btn {
  height: 34px; padding: 0 16px; background: #6f2bff; border: none;
  color: #fff; font-family: inherit; font-size: 12px; font-weight: 700;
  cursor: pointer; white-space: nowrap; flex-shrink: 0;
}
.add-btn:hover:not(:disabled) { background: #7f3fff; }
.add-btn:disabled { opacity: .4; cursor: default; }

.item-list { display: flex; flex-direction: column; gap: 1px; }
.item-row {
  display: flex; align-items: center; gap: 12px;
  padding: 9px 14px; background: #141418; border-bottom: 1px solid #1a1a1e;
  transition: background .1s;
}
.item-row:hover { background: #1c1c20; }
.item-term   { flex: 1; font-size: 12px; color: #e0e0e0; font-family: 'Consolas','Fira Mono',monospace; }
.item-label  { font-size: 12px; color: #e0e0e0; font-weight: 600; min-width: 80px; }
.item-action { font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: .04em; }
.item-dur    { font-size: 11px; color: #555; }
.item-del    { margin-left: auto; background: transparent; border: 1px solid #f1494933; color: #f14949; font-size: 11px; padding: 2px 7px; cursor: pointer; }
.item-del:hover { background: rgba(241,73,73,.1); }
.nuke-fire-btn { height: 28px; padding: 0 12px; background: rgba(241,73,73,.15); border: 1px solid #f1494966; color: #f14949; font-family: inherit; font-size: 11px; font-weight: 700; cursor: pointer; margin-left: auto; transition: background .15s; }
.nuke-fire-btn:hover { background: rgba(241,73,73,.3); }
</style>
