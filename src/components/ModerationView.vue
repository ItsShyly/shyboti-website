<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { API } from '../api'
import { useAuth } from '../auth'
import { useI18n } from '../i18n'

const { session, channelRole } = useAuth()
const { t } = useI18n()

const canView   = computed(() => channelRole.value?.permissions.moderation_view   ?? false)
const canManage = computed(() => channelRole.value?.permissions.moderation_manage ?? false)

// >>> Types
interface BlockedTerm   { id: number; term: string; action: string; duration: number; is_regex: number }
interface SpamFilter    { id: number; type: string; threshold: number; min_letters: number; action: string; duration: number }
interface NukeConfig    { id: number; trigger: string; duration: number; label: string; lookback: number; stay_active: number; match_exact: number; is_regex: number; expires_at: number | null }

// >>> Tab
type Tab = 'blocked' | 'spam' | 'nukes'
const activeTab = ref<Tab>('blocked')

// >>> Blocked Terms
const blockedTerms    = ref<BlockedTerm[]>([])
const newTerm         = ref('')
const newTermAction   = ref<'delete' | 'timeout' | 'ban'>('delete')
const newTermDur      = ref(300)
const newTermIsRegex  = ref(false)

// >>> Spam Filters
const spamFilters   = ref<SpamFilter[]>([])
const SPAM_TYPES = computed(() => [
  { value: 'caps',    label: t('mod.spam.caps'),   hint: t('mod.spam.caps_hint') },
  { value: 'links',   label: t('mod.spam.links'),  hint: t('mod.spam.links_hint') },
  { value: 'emoji',   label: t('mod.spam.emoji'),  hint: t('mod.spam.emoji_hint') },
  { value: 'repeat',  label: t('mod.spam.repeat'), hint: t('mod.spam.repeat_hint') },
  { value: 'flood',   label: t('mod.spam.flood'),  hint: t('mod.spam.flood_hint') },
])
const newSpamType       = ref('caps')
const newSpamThreshold  = ref(70)
const newSpamMinLetters = ref(0)
const newSpamAction     = ref<'delete' | 'timeout' | 'ban'>('delete')
const newSpamDur        = ref(300)

// >>> Nukes
const nukes           = ref<NukeConfig[]>([])
const newNuke         = ref('')
const newNukeDur      = ref(600)
const newNukeLabel    = ref('')
const newNukeLookback = ref(30)
const newNukeStayActive = ref(false)
const newNukeMatchExact = ref(false)
const newNukeIsRegex    = ref(false)
const newNukeExpiry     = ref(false)
const newNukeExpiryMins = ref(60)

// >>> Shared
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
  } catch { error.value = t('mod.error.load') }
  loading.value = false
}

async function addBlockedTerm() {
  if (!session.value || !newTerm.value.trim()) return
  saving.value = true
  try {
    const res = await fetch(`${API}/moderation/${session.value.channel}/blocked-terms`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${session.value.token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ term: newTerm.value.trim(), action: newTermAction.value, duration: newTermDur.value, is_regex: newTermIsRegex.value ? 1 : 0 })
    })
    if (!res.ok) throw new Error()
    const data = await res.json()
    blockedTerms.value.push(data.item)
    newTerm.value = ''; newTermIsRegex.value = false
    showSuccess(t('mod.success.added'))
  } catch { error.value = t('mod.error.add_term') }
  saving.value = false
}

async function removeBlockedTerm(id: number) {
  if (!session.value) return
  try {
    await fetch(`${API}/moderation/${session.value.channel}/blocked-terms/${id}`, {
      method: 'DELETE', headers: { Authorization: `Bearer ${session.value.token}` }
    })
    blockedTerms.value = blockedTerms.value.filter(t => t.id !== id)
    showSuccess(t('mod.success.removed'))
  } catch { error.value = t('mod.error.remove') }
}

async function addSpamFilter() {
  if (!session.value) return
  saving.value = true
  try {
    const res = await fetch(`${API}/moderation/${session.value.channel}/spam-filters`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${session.value.token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: newSpamType.value, threshold: newSpamThreshold.value, min_letters: newSpamMinLetters.value, action: newSpamAction.value, duration: newSpamDur.value })
    })
    if (!res.ok) throw new Error()
    const data = await res.json()
    spamFilters.value.push(data.item)
    showSuccess(t('mod.success.spam_added'))
  } catch { error.value = t('mod.error.add_spam') }
  saving.value = false
}

async function removeSpamFilter(id: number) {
  if (!session.value) return
  try {
    await fetch(`${API}/moderation/${session.value.channel}/spam-filters/${id}`, {
      method: 'DELETE', headers: { Authorization: `Bearer ${session.value.token}` }
    })
    spamFilters.value = spamFilters.value.filter(f => f.id !== id)
    showSuccess(t('mod.success.removed'))
  } catch { error.value = t('mod.error.remove') }
}

async function addNuke() {
  if (!session.value || !newNuke.value.trim()) return
  saving.value = true
  try {
    const res = await fetch(`${API}/moderation/${session.value.channel}/nukes`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${session.value.token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        trigger:     newNuke.value.trim(),
        duration:    newNukeDur.value,
        label:       newNukeLabel.value || newNuke.value.trim(),
        lookback:    newNukeLookback.value,
        stay_active: newNukeStayActive.value ? 1 : 0,
        match_exact: newNukeMatchExact.value ? 1 : 0,
        is_regex:    newNukeIsRegex.value    ? 1 : 0,
        expires_at:  (newNukeStayActive.value && newNukeExpiry.value)
          ? Date.now() + newNukeExpiryMins.value * 60_000 : null,
      })
    })
    if (!res.ok) throw new Error()
    const data = await res.json()
    nukes.value.push(data.item)
    newNuke.value = ''; newNukeLabel.value = ''
    newNukeStayActive.value = false; newNukeMatchExact.value = false; newNukeIsRegex.value = false
    showSuccess(t('mod.success.nuke_created'))
  } catch { error.value = t('mod.error.create_nuke') }
  saving.value = false
}

async function setNukeExpiry(nuke: NukeConfig, mins: number | null) {
  if (!session.value) return
  const expires_at = mins ? Date.now() + mins * 60_000 : null
  try {
    await fetch(`${API}/moderation/${session.value.channel}/nukes/${nuke.id}`, {
      method: 'PUT',
      headers: { Authorization: `Bearer ${session.value.token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ expires_at })
    })
    nuke.expires_at = expires_at
    showSuccess(mins ? `${t('mod.nuke.expire_in')} ${mins} ${t('mod.nuke.min')}.` : t('mod.nuke.expiry_cleared'))
  } catch { error.value = t('mod.error.set_expiry') }
}

function nukeExpiresIn(n: NukeConfig): string | null {
  if (!n.expires_at) return null
  const rem = n.expires_at - Date.now()
  if (rem <= 0) return t('mod.nuke.expired')
  const m = Math.floor(rem / 60_000)
  const h = Math.floor(m / 60)
  return h > 0 ? `${h}h ${m % 60}${t('mod.nuke.min')}` : `${m}${t('mod.nuke.min')}`
}

async function removeNuke(id: number) {
  if (!session.value) return
  try {
    await fetch(`${API}/moderation/${session.value.channel}/nukes/${id}`, {
      method: 'DELETE', headers: { Authorization: `Bearer ${session.value.token}` }
    })
    nukes.value = nukes.value.filter(n => n.id !== id)
    showSuccess(t('mod.success.removed'))
  } catch { error.value = t('mod.error.remove') }
}

const nukeLookbackOverride = ref<Record<number, number>>({})
const nukeConfirm = ref<number | null>(null)

async function fireNuke(id: number) {
  if (nukeConfirm.value !== id) {
    nukeConfirm.value = id
    setTimeout(() => { if (nukeConfirm.value === id) nukeConfirm.value = null }, 4000)
    return
  }
  nukeConfirm.value = null
  const nuke = nukes.value.find(n => n.id === id); if (!nuke || !session.value) return
  const lookback = nukeLookbackOverride.value[id] ?? nuke.lookback ?? 30
  try {
    const res = await fetch(`${API}/moderation/${session.value.channel}/nukes/${id}/fire?lookback=${lookback}`, {
      method: 'POST', headers: { Authorization: `Bearer ${session.value.token}` }
    })
    const data = await res.json() as any
    showSuccess(`${t('mod.nuke.fired')} ${data.affected ?? 0} ${t('mod.nuke.users_timed_out')}`)
  } catch { error.value = t('mod.error.fire_nuke') }
}

function fmtDur(s: number) {
  if (s < 60) return `${s}${t('mod.field.secs')}`
  if (s < 3600) return `${Math.floor(s/60)}m`
  return `${Math.floor(s/3600)}h`
}

const ACTION_COLORS: Record<string, string> = { delete: '#e5c07b', timeout: '#c792ea', ban: '#f14949' }

onMounted(load)
</script>

<template>
  <div class="mod-view">
    <div class="mod-header">
      <div class="mod-title">{{ t('mod.title') }}</div>
      <div class="mod-sub">{{ t('mod.sub') }} <span class="chan">#{{ session?.channel }}</span></div>
    </div>

    <div v-if="error"   class="mod-error">{{ error }}</div>
    <div v-if="success" class="mod-success">{{ success }}</div>

    <div class="tabs">
      <button v-for="tab in (['blocked','spam','nukes'] as Tab[])" :key="tab"
        class="tab-btn" :class="{ active: activeTab === tab }" @click="activeTab = tab">
        {{ tab === 'blocked' ? t('mod.tab.blocked') : tab === 'spam' ? t('mod.tab.spam') : t('mod.tab.nukes') }}
      </button>
    </div>

    <div v-if="loading" class="mod-empty">{{ t('mod.loading') }}</div>

    <!-- >>> Blocked Terms -->
    <template v-else-if="activeTab === 'blocked'">
      <div v-if="canManage" class="add-row">
        <input v-model="newTerm" class="field-input flex1"
          :placeholder="newTermIsRegex ? t('mod.field.term_re') : t('mod.field.term')"
          @keydown.enter="addBlockedTerm" />
        <label class="toggle-label">
          <input type="checkbox" v-model="newTermIsRegex" class="toggle-cb" />
          <span class="toggle-track" :class="{ on: newTermIsRegex }"><span class="toggle-thumb"></span></span>
          <span class="toggle-text">{{ t('mod.nuke.regex') }}</span>
          <span class="info-icon" :title="t('mod.nuke.regex_hint')">ⓘ</span>
        </label>
        <select v-model="newTermAction" class="field-select">
          <option value="delete">{{ t('mod.action.delete') }}</option>
          <option value="timeout">{{ t('mod.action.timeout') }}</option>
          <option value="ban">{{ t('mod.action.ban') }}</option>
        </select>
        <input v-if="newTermAction !== 'delete'" v-model.number="newTermDur" type="number" min="1" class="field-input dur-input" :placeholder="t('mod.field.secs')" />
        <button class="add-btn" @click="addBlockedTerm" :disabled="saving">{{ t('mod.add') }}</button>
      </div>
      <div v-if="!blockedTerms.length" class="mod-empty">{{ t('mod.empty.blocked') }}</div>
      <div v-else class="item-list">
        <div v-for="term in blockedTerms" :key="term.id" class="item-row">
          <span class="item-badge regex-badge" v-if="term.is_regex">{{ t('mod.badge.regex') }}</span>
          <span class="item-term">{{ term.term }}</span>
          <span class="item-action" :style="{ color: ACTION_COLORS[term.action] }">{{ term.action === 'delete' ? t('mod.action.delete') : term.action === 'timeout' ? t('mod.action.timeout') : t('mod.action.ban') }}</span>
          <span v-if="term.action !== 'delete'" class="item-dur">{{ fmtDur(term.duration) }}</span>
          <button v-if="canManage" class="item-del" @click="removeBlockedTerm(term.id)">✕</button>
        </div>
      </div>
    </template>

    <!-- >>> Spam Filters -->
    <template v-else-if="activeTab === 'spam'">
      <div v-if="canManage" class="add-row">
        <select v-model="newSpamType" class="field-select flex1">
          <option v-for="s in SPAM_TYPES" :key="s.value" :value="s.value">{{ s.label }}</option>
        </select>
        <div class="threshold-wrap">
          <span class="threshold-lbl">≥</span>
          <input v-model.number="newSpamThreshold" type="number" min="1" max="9999" class="field-input dur-input" />
          <span class="threshold-hint">{{ SPAM_TYPES.find(s => s.value === newSpamType)?.hint }}</span>
        </div>
        <div v-if="newSpamType === 'caps'" class="threshold-wrap">
          <span class="threshold-lbl" style="white-space:nowrap">min.</span>
          <input v-model.number="newSpamMinLetters" type="number" min="0" max="999" class="field-input dur-input" />
          <span class="threshold-hint">Letters</span>
        </div>
        <select v-model="newSpamAction" class="field-select">
          <option value="delete">{{ t('mod.action.delete') }}</option>
          <option value="timeout">{{ t('mod.action.timeout') }}</option>
          <option value="ban">{{ t('mod.action.ban') }}</option>
        </select>
        <input v-if="newSpamAction !== 'delete'" v-model.number="newSpamDur" type="number" min="1" class="field-input dur-input" :placeholder="t('mod.field.secs')" />
        <button class="add-btn" @click="addSpamFilter" :disabled="saving">{{ t('mod.add') }}</button>
      </div>
      <div v-if="!spamFilters.length" class="mod-empty">{{ t('mod.empty.spam') }}</div>
      <div v-else class="item-list">
        <div v-for="f in spamFilters" :key="f.id" class="item-row">
          <span class="item-term" style="flex:1">
            <template v-if="f.type === 'caps'">
              Caps-Spam<template v-if="f.min_letters > 0"> min. {{ f.min_letters }} Letters</template> AND ≥ {{ f.threshold }}% Caps
            </template>
            <template v-if="f.type === 'repeat'">
              Repeated chars<template v-if="f.min_letters > 0"> min. {{ f.min_letters }} Letters</template> AND ≥ {{ f.threshold }}% Repeated chars
            </template>
            <template v-else>
              {{ SPAM_TYPES.find(s => s.value === f.type)?.label ?? f.type }} ≥ {{ f.threshold }}
            </template>
          </span>
          <span class="item-action" :style="{ color: ACTION_COLORS[f.action] }">{{ f.action === 'delete' ? t('mod.action.delete') : f.action === 'timeout' ? t('mod.action.timeout') : t('mod.action.ban') }}</span>
          <span v-if="f.action !== 'delete'" class="item-dur">{{ fmtDur(f.duration) }}</span>
          <button v-if="canManage" class="item-del" @click="removeSpamFilter(f.id)">✕</button>
        </div>
      </div>
    </template>

    <!-- >>> Nukes -->
    <template v-else-if="activeTab === 'nukes'">
      <div class="nuke-hint">
        {{ t('mod.nuke.hint') }}
        <strong>{{ t('mod.nuke.stay') }}</strong> - {{ t('mod.nuke.hint2') }}
      </div>

      <!-- Create nuke form -->
      <div v-if="canManage" class="add-row nuke-add-row">
        <div class="nuke-inputs-top">
          <input v-model="newNuke" class="field-input flex1"
            :placeholder="newNukeIsRegex ? t('mod.nuke.trigger_re_ph') : t('mod.nuke.trigger_ph')"
            @keydown.enter="addNuke" />
          <input v-model="newNukeLabel" class="field-input" style="width:120px" :placeholder="t('mod.nuke.label')" />
          <div class="threshold-wrap">
            <span class="threshold-lbl">{{ t('mod.nuke.timeout') }}</span>
            <input v-model.number="newNukeDur" type="number" min="1" class="field-input dur-input" />
            <span class="threshold-hint">{{ t('mod.nuke.sec') }}</span>
          </div>
          <div class="threshold-wrap">
            <span class="threshold-lbl">{{ t('mod.nuke.lookback') }}</span>
            <input v-model.number="newNukeLookback" type="number" min="1" max="1440" class="field-input dur-input" />
            <span class="threshold-hint">{{ t('mod.nuke.min') }}</span>
          </div>
        </div>
        <div class="nuke-toggles-row">
          <label class="toggle-label">
            <input type="checkbox" v-model="newNukeStayActive" class="toggle-cb" />
            <span class="toggle-track" :class="{ on: newNukeStayActive }"><span class="toggle-thumb"></span></span>
            <span class="toggle-text">{{ t('mod.nuke.stay') }}</span>
            <span class="info-icon" :title="t('mod.nuke.stay_hint')">ⓘ</span>
          </label>
          <label class="toggle-label" :class="{ dimmed: newNukeIsRegex }">
            <input type="checkbox" v-model="newNukeMatchExact" class="toggle-cb" :disabled="newNukeIsRegex" />
            <span class="toggle-track" :class="{ on: newNukeMatchExact && !newNukeIsRegex }"><span class="toggle-thumb"></span></span>
            <span class="toggle-text">{{ t('mod.nuke.exact') }}</span>
            <span class="info-icon" :title="t('mod.nuke.exact_hint')">ⓘ</span>
          </label>
          <label class="toggle-label">
            <input type="checkbox" v-model="newNukeIsRegex" class="toggle-cb" @change="newNukeIsRegex && (newNukeMatchExact = false)" />
            <span class="toggle-track" :class="{ on: newNukeIsRegex }"><span class="toggle-thumb"></span></span>
            <span class="toggle-text">{{ t('mod.nuke.regex') }}</span>
            <span class="info-icon" :title="t('mod.nuke.regex_hint')">ⓘ</span>
          </label>
          <label class="toggle-label" :class="{ dimmed: !newNukeStayActive }">
            <input type="checkbox" v-model="newNukeExpiry" class="toggle-cb" :disabled="!newNukeStayActive" />
            <span class="toggle-track" :class="{ on: newNukeExpiry && newNukeStayActive }"><span class="toggle-thumb"></span></span>
            <span class="toggle-text">{{ t('mod.nuke.expiry') }}</span>
            <span class="info-icon" :title="t('mod.nuke.expiry_hint')">ⓘ</span>
          </label>
          <div v-if="newNukeExpiry && newNukeStayActive" class="threshold-wrap">
            <input v-model.number="newNukeExpiryMins" type="number" min="1" class="field-input dur-input" />
            <span class="threshold-hint">{{ t('mod.nuke.min') }}</span>
          </div>
          <button class="add-btn" @click="addNuke" :disabled="saving" style="margin-left:auto">{{ t('mod.create') }}</button>
        </div>
      </div>

      <div v-if="!nukes.length" class="mod-empty">{{ t('mod.empty.nukes') }}</div>
      <div v-else class="item-list">
        <div v-for="n in nukes" :key="n.id" class="item-row">
          <div class="nuke-row-badges">
            <span v-if="n.stay_active" class="item-badge stay-badge" :title="t('mod.nuke.stay_hint')">{{ t('mod.badge.stay') }}</span>
            <span v-if="n.is_regex"    class="item-badge regex-badge" :title="t('mod.nuke.regex_hint')">{{ t('mod.badge.regex') }}</span>
            <span v-if="n.match_exact" class="item-badge exact-badge" :title="t('mod.nuke.exact_hint')">{{ t('mod.badge.exact') }}</span>
          </div>
          <span class="item-label">{{ n.label }}</span>
          <span class="item-term" style="color:#555">{{ n.trigger }}</span>
          <span class="item-dur">{{ fmtDur(n.duration) }}</span>
          <div class="threshold-wrap" style="margin-left:auto">
            <span class="threshold-lbl" style="font-size:10px">↩</span>
            <input type="number" min="1" max="1440"
              :value="nukeLookbackOverride[n.id] ?? n.lookback ?? 30"
              @input="nukeLookbackOverride[n.id] = parseInt(($event.target as HTMLInputElement).value)"
              class="field-input dur-input" style="width:52px" :title="t('mod.nuke.lookback')" />
            <span class="threshold-hint">{{ t('mod.nuke.min') }}</span>
          </div>
          <!-- Expiry indicator + controls -->
          <div v-if="n.stay_active" class="expiry-wrap">
            <span v-if="n.expires_at" class="expiry-badge" :class="{ expired: nukeExpiresIn(n) === t('mod.nuke.expired') }">
              {{ nukeExpiresIn(n) === t('mod.nuke.expired') ? t('mod.nuke.expired') : `${t('mod.nuke.expires')} ${nukeExpiresIn(n)}` }}
              <button v-if="canManage" class="expiry-clear" @click="setNukeExpiry(n, null)" title="✕">✕</button>
            </span>
            <select v-else-if="canManage" class="expiry-select" @change="setNukeExpiry(n, parseInt(($event.target as HTMLSelectElement).value))" :title="t('mod.nuke.expiry')">
              <option value="0">{{ t('mod.nuke.set_expiry') }}</option>
              <option value="15">{{ t('mod.nuke.expiry_15') }}</option>
              <option value="30">{{ t('mod.nuke.expiry_30') }}</option>
              <option value="60">{{ t('mod.nuke.expiry_1h') }}</option>
              <option value="120">{{ t('mod.nuke.expiry_2h') }}</option>
              <option value="240">{{ t('mod.nuke.expiry_4h') }}</option>
              <option value="480">{{ t('mod.nuke.expiry_8h') }}</option>
            </select>
          </div>
          <button v-if="canManage" class="nuke-fire-btn" :class="{ confirm: nukeConfirm === n.id }" @click="fireNuke(n.id)">
            {{ nukeConfirm === n.id ? t('mod.nuke.sure') : t('mod.nuke.fire') }}
          </button>
          <button v-if="canManage" class="item-del" @click="removeNuke(n.id)">✕</button>
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
.nuke-hint strong { color: #888; font-weight: 600; }

.add-row {
  display: flex; align-items: center; gap: 8px; flex-wrap: wrap;
  background: #141418; padding: 12px 14px; border: 1px solid #1e1e24;
}
.nuke-add-row { flex-direction: column; align-items: stretch; }
.nuke-inputs-top { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.nuke-toggles-row { display: flex; align-items: center; gap: 14px; flex-wrap: wrap; margin-top: 8px; padding-top: 8px; border-top: 1px solid #1e1e24; }

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

/* >>> Toggle switch */
.toggle-label {
  display: flex; align-items: center; gap: 6px;
  cursor: pointer; user-select: none; flex-shrink: 0;
}
.toggle-label.dimmed { opacity: .35; pointer-events: none; }
.toggle-cb { display: none; }
.toggle-track {
  width: 30px; height: 16px; border-radius: 8px; background: #2a2a30;
  border: 1px solid #333; position: relative; transition: background .2s, border-color .2s;
  flex-shrink: 0;
}
.toggle-track.on { background: rgba(111,43,255,.5); border-color: #6f2bff88; }
.toggle-thumb {
  position: absolute; top: 2px; left: 2px;
  width: 10px; height: 10px; border-radius: 50%;
  background: #555; transition: left .2s, background .2s;
}
.toggle-track.on .toggle-thumb { left: 16px; background: #9d6cff; }
.toggle-text { font-size: 11px; color: #888; font-weight: 600; }
.info-icon { font-size: 11px; color: #444; cursor: help; transition: color .15s; }
.info-icon:hover { color: #9d6cff; }

/* >>> Item list */
.item-list { display: flex; flex-direction: column; gap: 1px; }
.item-row {
  display: flex; align-items: center; gap: 10px;
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

/* >>> Badges */
.item-badge {
  font-size: 9px; font-weight: 700; text-transform: uppercase; letter-spacing: .05em;
  padding: 1px 5px; border-radius: 2px; flex-shrink: 0;
}
.stay-badge  { color: #23d18b; background: rgba(35,209,139,.12);  border: 1px solid rgba(35,209,139,.3); }
.regex-badge { color: #c792ea; background: rgba(199,146,234,.12); border: 1px solid rgba(199,146,234,.3); }
.exact-badge { color: #e5c07b; background: rgba(229,192,123,.12); border: 1px solid rgba(229,192,123,.3); }
.nuke-row-badges { display: flex; gap: 4px; align-items: center; }

/* >>> Nuke fire button */
.nuke-fire-btn { height: 28px; padding: 0 12px; background: rgba(241,73,73,.15); border: 1px solid #f1494966; color: #f14949; font-family: inherit; font-size: 11px; font-weight: 700; cursor: pointer; margin-left: auto; transition: background .15s, border-color .15s; }
.nuke-fire-btn:hover { background: rgba(241,73,73,.3); }
.nuke-fire-btn.confirm { background: rgba(241,73,73,.35); border-color: #f14949; animation: pulse-red .6s infinite alternate; }
@keyframes pulse-red { from { box-shadow: 0 0 0 0 rgba(241,73,73,.4); } to { box-shadow: 0 0 0 4px rgba(241,73,73,0); } }

.expiry-wrap { display: flex; align-items: center; }
.expiry-badge { font-size: 10px; color: #23d18b; background: rgba(35,209,139,.1); border: 1px solid rgba(35,209,139,.3); padding: 2px 7px; display: flex; align-items: center; gap: 5px; }
.expiry-badge.expired { color: #f14949; background: rgba(241,73,73,.1); border-color: rgba(241,73,73,.3); }
.expiry-clear { background: none; border: none; color: inherit; cursor: pointer; font-size: 10px; padding: 0; opacity: .6; }
.expiry-clear:hover { opacity: 1; }
.expiry-select { background: #0d0d10; border: 1px solid #2a2a30; color: #555; font-family: inherit; font-size: 10px; padding: 3px 6px; cursor: pointer; outline: none; }

@media (max-width: 680px) {
  .add-row { flex-direction: column; align-items: stretch; gap: 8px; }
  .nuke-inputs-top { flex-direction: column; }
  .nuke-toggles-row { flex-wrap: wrap; gap: 10px; }
  .item-row { flex-wrap: wrap; gap: 6px; }
  .item-term { width: 100%; }
  .nuke-fire-btn { margin-left: 0; }
  .tabs { overflow-x: auto; }
  .threshold-wrap { flex-wrap: wrap; }
}
</style>
