<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted, watch } from 'vue'
import { API } from '../api'
import { useAuth } from '../auth'
import { useI18n } from '../i18n'
import { highlightScript } from '../composables/scriptHighlight'

const { session, availableChannels, channelRole } = useAuth()
const { t } = useI18n()

const canToggle = computed(() => channelRole.value?.permissions.automations_toggle ?? false)
const canEdit   = computed(() => channelRole.value?.permissions.automations_edit   ?? false)
const canDelete = computed(() => channelRole.value?.permissions.automations_delete ?? false)

const REF_GROUPS = computed(() => [
  { label: 'Channel', items: [
    { token: '$channel.name',    desc: 'Channel login name' },
    { token: '$channel.title',   desc: 'Stream title' },
    { token: '$channel.game',    desc: 'Current game/category' },
    { token: '$channel.viewers', desc: 'Viewer count' },
    { token: '$channel.isLive',  desc: 'true/false' },
    { token: '$channel.uptime',  desc: 'Stream uptime e.g. 1h 23m' },
  ]},
  { label: 'Counters', items: [
    { token: '$counter.name',         desc: 'Increment +1, return value' },
    { token: '$counter.name.get',      desc: 'Read without changing' },
    { token: '$counter.name.set(n)',   desc: 'Set to value' },
    { token: '$counter.name.add(n)',   desc: 'Add value' },
    { token: '$counter.name.reset',    desc: 'Reset to 0' },
  ]},
  { label: 'Variables', items: [
    { token: '$var.name',           desc: 'Read variable' },
    { token: '$var.name.set(value)', desc: 'Set variable' },
  ]},
  { label: 'Lists', items: [
    { token: '$list.name',        desc: 'Random item from list' },
    { token: '$list.name.size',   desc: 'Number of items' },
    { token: '$list.name.random', desc: 'Random item' },
  ]},
  { label: 'Random', items: [
    { token: '$random.int(min,max)',  desc: 'Random integer' },
    { token: '$random.pick(a,b,c)',  desc: 'Pick randomly from list' },
    { token: '$random.chance(pct)',  desc: 'true with pct% probability' },
  ]},
  { label: 'Time', items: [
    { token: '$time.now',          desc: 'Current ISO timestamp' },
    { token: '$time.unix',         desc: 'Unix timestamp (seconds)' },
    { token: '$time.format(ts,fmt)',desc: 'Format a timestamp' },
  ]},
  { label: 'Text / Calc', items: [
    { token: '$text.upper(text)',  desc: 'Uppercase' },
    { token: '$text.lower(text)',  desc: 'Lowercase' },
    { token: '$calc(expr)',        desc: 'Math expression e.g. $calc(2+2)' },
    { token: '$http.get(url)',     desc: 'GET request, returns text' },
  ]},
])

interface Timer {
  id: number; name: string; response: string
  interval_sec: number; min_messages: number
  enabled_when: string; required_game: string
  condition: string; is_active: number
  last_fired: number
}

const timers  = ref<Timer[]>([])
const loading = ref(false)
const saving  = ref<string | null>(null)
const error   = ref('')
const success = ref('')

// >>> Live clock for next-fire countdowns
const now = ref(Date.now())
let _clockInterval: ReturnType<typeof setInterval> | null = null
onUnmounted(() => { if (_clockInterval) clearInterval(_clockInterval) })

function fmtNextFire(timer: Timer): string {
  if (!timer.is_active) return ''
  const fired = timer.last_fired ?? 0
  const nextMs = fired + timer.interval_sec * 1000
  const diffMs = nextMs - now.value
  if (diffMs <= 0) return 'firing soon'
  const s = Math.ceil(diffMs / 1000)
  if (s >= 3600) return `in ${Math.floor(s/3600)}h ${Math.floor((s%3600)/60)}m`
  if (s >= 60)   return `in ${Math.floor(s/60)}m ${s%60}s`
  return `in ${s}s`
}

// >>> Edit panel
const editOpen = ref(false)
const editTimer = ref<Partial<Timer> & { name: string }>({
  name: '', response: '', interval_sec: 300, min_messages: 0,
  enabled_when: 'always', required_game: '', condition: '', is_active: 1,
})
const isNew = ref(false)
const editorRef = ref<HTMLDivElement | null>(null)

function showSuccess(msg: string) { success.value = msg; setTimeout(() => success.value = '', 3000) }

function fmtInterval(s: number) {
  if (s >= 3600) return `${Math.round(s/3600)}h`
  if (s >= 60)   return `${Math.round(s/60)}m`
  return `${s}s`
}

async function load() {
  if (!session.value) return
  loading.value = true; error.value = ''
  try {
    const res = await fetch(`${API}/timers/${session.value.channel}`, {
      headers: { Authorization: `Bearer ${session.value.token}` }
    })
    if (!res.ok) throw new Error()
    const data = await res.json() as { timers: Timer[] }
    timers.value = data.timers
  } catch (e: any) { error.value = 'Could not load timers: ' + (e?.message ?? e) }
  loading.value = false
}

function openNew() {
  isNew.value = true
  editTimer.value = { name: '', response: '', interval_sec: 300, min_messages: 0,
    enabled_when: 'always', required_game: '', condition: '', is_active: 1 }
  editOpen.value = true
  setTimeout(() => {
    if (editorRef.value) { editorRef.value.innerText = ''; applyHL() }
  }, 50)
}

function openEdit(timer: Timer) {
  isNew.value = false
  editTimer.value = { ...timer }
  editOpen.value = true
  setTimeout(() => {
    if (editorRef.value) { editorRef.value.innerText = timer.response; applyHL() }
  }, 50)
}

function applyHL() {
  const el = editorRef.value; if (!el) return
  const sel = window.getSelection()
  let offset = 0
  if (sel?.rangeCount && el.contains(sel.getRangeAt(0).startContainer)) {
    const r = sel.getRangeAt(0); const pre = r.cloneRange()
    pre.selectNodeContents(el); pre.setEnd(r.startContainer, r.startOffset)
    offset = pre.toString().length
  }
  el.innerHTML = highlightScript(el.innerText.replace(/\n$/, ''))
  let rem = offset, placed = false
  function walk(node: Node) {
    if (placed) return
    if (node.nodeType === 3) {
      const len = node.textContent?.length ?? 0
      if (rem <= len) {
        const r = document.createRange(); r.setStart(node, rem); r.collapse(true)
        sel?.removeAllRanges(); sel?.addRange(r); placed = true; return
      }
      rem -= len; return
    }
    for (const c of Array.from(node.childNodes)) walk(c)
  }
  walk(el)
}

function onEditorInput() {
  const el = editorRef.value; if (!el) return
  editTimer.value.response = el.innerText.replace(/\n$/, '')
  applyHL()
}

async function saveTimer() {
  if (!session.value || !editTimer.value.name) return
  saving.value = editTimer.value.name
  try {
    const res = await fetch(`${API}/timers/${session.value.channel}/${editTimer.value.name}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.value.token}` },
      body: JSON.stringify(editTimer.value),
    })
    if (!res.ok) throw new Error(await res.text())
    showSuccess(t('timer.save') + '!')
    editOpen.value = false
    load()
  } catch (e: any) { error.value = 'Could not save timer: ' + (e?.message ?? e) }
  finally { saving.value = null }
}

async function deleteTimer(name: string) {
  if (!session.value) return
  saving.value = name
  try {
    await fetch(`${API}/timers/${session.value.channel}/${name}`, {
      method: 'DELETE', headers: { Authorization: `Bearer ${session.value.token}` }
    })
    timers.value = timers.value.filter(timer => timer.name !== name)
    if (editOpen.value && editTimer.value.name === name) editOpen.value = false
  } catch { error.value = 'Could not delete timer.' }
  saving.value = null
}

async function toggleActive(timer: Timer) {
  if (!session.value) return
  const next = timer.is_active ? 0 : 1
  await fetch(`${API}/timers/${session.value.channel}/${timer.name}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.value.token}` },
    body: JSON.stringify({ is_active: next }),
  })
  timer.is_active = next
}

// >>> Share
const shareOpen    = ref(false)
const shareTimer   = ref('')
const shareTarget  = ref('')
const shareSaving  = ref(false)
const shareSuccess = ref('')
const shareError   = ref('')

function openShare(name: string) {
  shareTimer.value = name; shareTarget.value = ''; shareSuccess.value = ''; shareError.value = ''
  shareOpen.value = true
}
async function doShare() {
  if (!session.value || !shareTarget.value) return
  shareSaving.value = true; shareError.value = ''
  try {
    const res = await fetch(`${API}/timers/${session.value.channel}/${shareTimer.value}/share`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.value.token}` },
      body: JSON.stringify({ target_channel: shareTarget.value }),
    })
    if (!res.ok) throw new Error((await res.json() as any).error ?? 'Failed')
    shareSuccess.value = `Copied to #${shareTarget.value}!`
    setTimeout(() => { shareOpen.value = false }, 1500)
  } catch (e: any) { shareError.value = e.message ?? 'Share failed' }
  shareSaving.value = false
}

// >>> Sync
const syncConf    = ref<{ sync_from: string; is_active: number; last_synced: number } | null>(null)
const syncOpen    = ref(false)
const syncFrom    = ref('')
const syncSaving  = ref(false)
const syncRunning = ref(false)
const syncMsg     = ref('')

async function fetchSync() {
  if (!session.value) return
  try {
    const res = await fetch(`${API}/timer-sync/${session.value.channel}`, {
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
    await fetch(`${API}/timer-sync/${session.value.channel}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.value.token}` },
      body: JSON.stringify({ sync_from: syncFrom.value, is_active: true }),
    })
    await fetchSync()
    await runSync()
  } catch { syncMsg.value = 'Failed to save.' }
  syncSaving.value = false
}
async function stopSync() {
  if (!session.value || !syncConf.value) return
  syncSaving.value = true
  try {
    await fetch(`${API}/timer-sync/${session.value.channel}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.value.token}` },
      body: JSON.stringify({ sync_from: syncConf.value.sync_from, is_active: false }),
    })
    syncConf.value = { ...syncConf.value, is_active: 0 }; syncMsg.value = 'Sync stopped.'
  } catch { syncMsg.value = 'Failed.' }
  syncSaving.value = false
}
async function runSync() {
  if (!session.value) return
  syncRunning.value = true; syncMsg.value = ''
  try {
    const res = await fetch(`${API}/timer-sync/${session.value.channel}/run`, {
      method: 'POST', headers: { Authorization: `Bearer ${session.value.token}` }
    })
    const data = await res.json() as { count?: number; error?: string }
    if (!res.ok) throw new Error(data.error)
    syncMsg.value = `Synced ${data.count} timers from #${syncConf.value?.sync_from}.`
    await load()
  } catch (e: any) { syncMsg.value = e.message ?? 'Sync failed' }
  syncRunning.value = false
}

onMounted(() => { load(); fetchSync(); _clockInterval = setInterval(() => now.value = Date.now(), 1000) })
watch(() => session.value?.channel, () => { load(); fetchSync() })
</script>

<template>
  <div class="view">
    <div class="view-header">
      <div class="view-header-left">
        <div>
          <div class="view-title">{{ t('timer.title') }}</div>
          <div class="view-sub">{{ t('timer.sub') }} #{{ session?.channel }}</div>
          <button v-if="syncConf?.is_active" class="sync-indicator" @click="syncOpen = !syncOpen" :title="`${t('timer.sync.active')} #${syncConf.sync_from}`">
            <span class="sync-dot"></span>{{ t('timer.sync.active') }} #{{ syncConf.sync_from }}
            <span class="sync-chevron">{{ syncOpen ? '▲' : '▼' }}</span>
          </button>
          <button v-else class="sync-config-btn" @click="syncOpen = !syncOpen">{{ t('timer.sync.config') }} <span class="sync-chevron">{{ syncOpen ? '▲' : '▼' }}</span></button>
        </div>
      </div>
      <button class="btn-new" @click="canEdit && openNew()" :disabled="!canEdit" :class="{ 'btn-new-disabled': !canEdit }">{{ t('timer.new') }}</button>
    </div>

    <!-- Sync panel -->
    <div v-if="syncOpen" class="sync-panel">
      <div class="sync-row">
        <select v-model="syncFrom" class="field-select-sm">
          <option value="">{{ syncConf?.is_active ? t('timer.sync.change') : t('timer.sync.select') }}</option>
          <option v-for="ch in availableChannels.filter(c => c !== session?.channel)" :key="ch" :value="ch">#{{ ch }}</option>
        </select>
        <button class="sync-save-btn" @click="saveSync" :disabled="syncSaving || !syncFrom">{{ syncSaving ? '…' : syncConf?.is_active ? t('timer.sync.update') : t('timer.sync.enable') }}</button>
        <button v-if="syncConf?.is_active" class="sync-stop-btn" @click="stopSync">{{ t('timer.sync.stop') }}</button>
      </div>
      <div v-if="syncConf?.last_synced" class="sync-last">{{ t('timer.sync.last') }} {{ new Date(syncConf.last_synced).toLocaleString() }}</div>
      <div v-if="syncMsg" class="sync-msg" :class="{ err: syncMsg.includes('fail') || syncMsg.includes('Error') }">{{ syncMsg }}</div>
    </div>

    <div v-if="success" class="toast success">{{ success }}</div>
    <div v-if="error"   class="toast error">{{ error }}</div>

    <div v-if="loading" class="empty">{{ t('timer.loading') }}</div>
    <div v-else-if="!timers.length" class="empty">{{ t('timer.empty') }}</div>

    <div v-else class="timer-list">
      <div v-for="timer in timers" :key="timer.id" class="timer-row" :class="{ inactive: !timer.is_active }">
        <div class="timer-toggle-wrap">
          <button class="toggle-btn" :class="{ on: timer.is_active, 'toggle-disabled': !canToggle }" @click="canToggle && toggleActive(timer)" :title="timer.is_active ? 'Disable' : 'Enable'">
            <span class="toggle-knob"></span>
          </button>
        </div>
        <div class="timer-info" @click="openEdit(timer)">
          <div class="timer-name">{{ timer.name }}</div>
          <div class="timer-meta">
            <span class="meta-pill interval">⏱ {{ fmtInterval(timer.interval_sec) }}</span>
            <span v-if="timer.min_messages" class="meta-pill msgs">💬 {{ timer.min_messages }}+ msgs</span>
            <span v-if="timer.enabled_when !== 'always'" class="meta-pill when">{{ timer.enabled_when }}</span>
            <span v-if="timer.required_game" class="meta-pill game">🎮 {{ timer.required_game }}</span>
            <span v-if="timer.condition" class="meta-pill cond">if …</span>
          </div>
          <div class="timer-response">{{ timer.response.slice(0, 80) }}{{ timer.response.length > 80 ? '…' : '' }}</div>
          <div v-if="timer.is_active" class="timer-next">{{ fmtNextFire(timer) }}</div>
        </div>
        <div class="row-actions">
          <button class="btn-action edit" @click.stop="canEdit && openEdit(timer)" :class="{ 'btn-action-disabled': !canEdit }">{{ canEdit ? t('timer.edit') : t('timer.view') }}</button>
          <button class="btn-action share" @click.stop="openShare(timer.name)" :title="t('timer.share')">↪</button>
          <button v-if="canDelete" class="btn-action del" @click.stop="deleteTimer(timer.name)" :disabled="saving === timer.name">✕</button>
        </div>
      </div>
    </div>

    <!-- Edit panel -->
    <Teleport to="body">
      <div v-if="editOpen" class="panel-overlay" @click.self="editOpen = false">
        <div class="panel">
          <div class="panel-header">
            <div>
              <div class="panel-title">{{ isNew ? t('timer.edit_new') : `${t('timer.edit_title')} ${editTimer.name}` }}</div>
              <div class="panel-sub">#{{ session?.channel }}</div>
            </div>
            <button class="panel-close" @click="editOpen = false">✕</button>
          </div>

          <div class="panel-body">
            <div class="field-group">
              <label class="field-label">{{ t('timer.field.name') }} <span class="field-hint">{{ t('timer.field.name_hint') }}</span></label>
              <input v-model="editTimer.name" class="field-input" :disabled="!isNew" placeholder="welcome" />
            </div>

            <div class="field-group">
              <label class="field-label">{{ t('timer.field.response') }} <span class="field-hint">{{ t('timer.field.resp_hint') }}</span></label>
              <div
                ref="editorRef"
                class="script-editor"
                contenteditable="true"
                spellcheck="false"
                data-placeholder="Hello chat! $channel.viewers viewers right now."
                @input="onEditorInput"
              ></div>
              <details class="ref-panel">
                <summary class="ref-summary">{{ t('edit.var_ref') }}</summary>
                <div class="ref-content">
                  <div v-for="g in REF_GROUPS" :key="g.label" class="ref-group">
                    <div class="ref-group-label">{{ g.label }}</div>
                    <div v-for="r in g.items" :key="r.token" class="ref-row">
                      <code class="ref-token">{{ r.token }}</code>
                      <span class="ref-desc">{{ r.desc }}</span>
                    </div>
                  </div>
                </div>
              </details>
            </div>

            <div class="row-2">
              <div class="field-group">
                <label class="field-label">{{ t('timer.field.interval') }}</label>
                <div class="interval-row">
                  <input v-model.number="editTimer.interval_sec" type="number" min="30" class="field-input" />
                  <span class="field-hint">{{ t('timer.field.interval_hint') }} · {{ fmtInterval(editTimer.interval_sec ?? 300) }}</span>
                </div>
              </div>
              <div class="field-group">
                <label class="field-label">{{ t('timer.field.min_msgs') }} <span class="field-hint">{{ t('timer.field.min_msgs_hint') }}</span></label>
                <input v-model.number="editTimer.min_messages" type="number" min="0" class="field-input" />
              </div>
            </div>

            <div class="row-3">
              <div class="field-group">
                <label class="field-label">{{ t('timer.field.active_when') }}</label>
                <select v-model="editTimer.enabled_when" class="field-select">
                  <option value="always">{{ t('timer.when.always') }}</option>
                  <option value="online">{{ t('timer.when.online') }}</option>
                  <option value="offline">{{ t('timer.when.offline') }}</option>
                </select>
              </div>
              <div class="field-group">
                <label class="field-label">{{ t('timer.field.game') }} <span class="field-hint">{{ t('timer.field.game_hint') }}</span></label>
                <input v-model="editTimer.required_game" class="field-input" placeholder="Just Chatting" />
              </div>
            </div>

            <div class="field-group">
              <label class="field-label">{{ t('timer.field.condition') }} <span class="field-hint">{{ t('timer.field.cond_hint') }}</span></label>
              <input v-model="editTimer.condition" class="field-input mono" placeholder="$channel.viewers > 10" />
            </div>

            <div class="panel-footer">
              <button v-if="!isNew && canDelete" class="btn-delete" @click="deleteTimer(editTimer.name); editOpen = false">{{ t('timer.delete') }}</button>
              <div v-else></div>
              <div class="footer-right">
                <button class="btn-cancel" @click="editOpen = false">{{ t('timer.cancel') }}</button>
                <button class="btn-save" @click="saveTimer" :disabled="!!saving || !editTimer.name || !editTimer.response">
                  {{ saving ? t('timer.saving') : t('timer.save') }}
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </Teleport>

  <!-- Share modal -->
  <Teleport to="body">
    <div v-if="shareOpen" class="modal-overlay" @click.self="shareOpen = false">
      <div class="modal">
        <div class="modal-title">{{ t('timer.share.title') }} <span class="modal-name">{{ shareTimer }}</span></div>
        <div class="modal-sub">{{ t('timer.share.sub') }}</div>
        <select v-model="shareTarget" class="field-select-sm" style="width:100%;margin-top:12px">
          <option value="">{{ t('timer.share.select') }}</option>
          <option v-for="ch in availableChannels.filter(c => c !== session?.channel)" :key="ch" :value="ch">#{{ ch }}</option>
        </select>
        <div v-if="shareError"   class="modal-msg err">{{ shareError }}</div>
        <div v-if="shareSuccess" class="modal-msg ok">{{ shareSuccess }}</div>
        <div class="modal-footer">
          <button class="btn-cancel" @click="shareOpen = false">{{ t('timer.cancel') }}</button>
          <button class="btn-save" @click="doShare" :disabled="shareSaving || !shareTarget">{{ shareSaving ? t('timer.share.copying') : t('timer.share.btn') }}</button>
        </div>
      </div>
    </div>
  </Teleport>
  </div>
</template>

<style scoped>
.view { display: flex; flex-direction: column; gap: 16px; height: 100%; }
.view-header { display: flex; align-items: flex-start; justify-content: space-between; }
.view-header-left { display: flex; align-items: center; gap: 12px; flex-wrap: wrap; }
.view-title  { font-size: 18px; font-weight: 700; color: #e0e0e0; margin-bottom: 4px; }
.view-sub    { font-size: 12px; color: #555; margin-bottom: 4px; }

.sync-indicator { display: flex; align-items: center; gap: 5px; height: 22px; padding: 0 8px; border: 1px solid #23d18b44; background: rgba(35,209,139,.06); color: #23d18b; font-family: inherit; font-size: 10px; cursor: pointer; }
.sync-indicator:hover { background: rgba(35,209,139,.12); }
.sync-dot { width: 6px; height: 6px; border-radius: 50%; background: #23d18b; animation: pulse-dot 2s ease-in-out infinite; flex-shrink: 0; }
.sync-chevron { font-size: 8px; opacity: .6; }
@keyframes pulse-dot { 0%,100%{opacity:1} 50%{opacity:.4} }
.sync-config-btn { display: inline-flex; height: 22px; padding: 0 8px; border: 1px solid #2a2a30; background: transparent; color: #555; font-family: inherit; font-size: 10px; cursor: pointer; }
.sync-config-btn:hover { color: #9d6cff; border-color: #6f2bff44; }
.sync-panel { background: #141418; border: 1px solid #1e1e24; padding: 8px 10px; margin-bottom: 4px; display: flex; flex-direction: column; gap: 5px; }
.sync-row { display: flex; gap: 6px; align-items: center; }
.sync-msg { font-size: 10px; color: #23d18b; }
.sync-msg.err { color: #f14949; }
.sync-last { font-size: 10px; color: #444; }
.field-select-sm { background: #0d0d10; border: 1px solid #2a2a30; color: #e0e0e0; font-family: inherit; font-size: 12px; padding: 6px 8px; outline: none; cursor: pointer; }
.sync-save-btn { height: 32px; padding: 0 12px; border: none; background: #6f2bff; color: #fff; font-family: inherit; font-size: 11px; font-weight: 600; cursor: pointer; }
.sync-save-btn:hover:not(:disabled) { background: #7f3fff; }
.sync-save-btn:disabled { opacity: .4; cursor: not-allowed; }
.sync-stop-btn { height: 28px; padding: 0 8px; border: 1px solid #f1494944; background: transparent; color: #f14949; font-family: inherit; font-size: 11px; cursor: pointer; }
.sync-stop-btn:hover { background: rgba(241,73,73,.1); }

.btn-action.share { border-color: #4ec9b044; color: #4ec9b0; }
.btn-action.share:hover { background: rgba(78,201,176,.1); }

.modal-overlay { position: fixed; inset: 0; background: rgba(0,0,0,.65); display: flex; align-items: center; justify-content: center; z-index: 1001; }
.modal { background: #1a1a1e; border: 1px solid #2a2a30; padding: 24px; width: 360px; max-width: 90vw; }
.modal-title { font-size: 15px; font-weight: 700; color: #e0e0e0; margin-bottom: 4px; }
.modal-name  { color: #9d6cff; }
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

.btn-new { height: 32px; padding: 0 14px; border: 1px solid #6f2bff66; background: #6f2bff15; color: #9d6cff; font-family: inherit; font-size: 12px; cursor: pointer; transition: background .15s; }
.btn-new:hover { background: #6f2bff30; }
.btn-new-disabled { opacity: .35; cursor: not-allowed; }
.toggle-disabled { opacity: .35; cursor: not-allowed; }
.btn-action-disabled { opacity: .35; cursor: not-allowed; }

@media (max-width: 680px) {
  .view-header { flex-wrap: wrap; gap: 10px; }
  .panel { width: 100vw !important; }
  .panel-body { padding: 14px 16px; }
  .row-2, .row-3 { flex-direction: column; gap: 8px; }
  .timer-row { padding: 10px 10px; gap: 8px; }
  .row-actions { gap: 4px; }
  .btn-action { padding: 0 8px; font-size: 10px; }
  .sync-row { flex-wrap: wrap; }
}

.toast { padding: 8px 14px; font-size: 12px; margin-bottom: 4px; }
.toast.success { background: rgba(35,209,139,.1); border: 1px solid rgba(35,209,139,.3); color: #23d18b; }
.toast.error   { background: rgba(241,73,73,.1);  border: 1px solid rgba(241,73,73,.3);  color: #f14949; }

.empty { color: #444; font-size: 13px; padding: 40px; text-align: center; }

.timer-list { display: flex; flex-direction: column; gap: 2px; overflow-y: auto; flex: 1; }
.timer-row  { display: flex; align-items: center; gap: 12px; padding: 10px 14px; background: #141418; border-bottom: 1px solid #1e1e1e; transition: background .1s; }
.timer-row:hover { background: #1c1c20; }
.timer-row.inactive { opacity: .45; }

.toggle-btn { width: 36px; height: 20px; border: 1px solid #2a2a30; background: #0d0d10; cursor: pointer; position: relative; flex-shrink: 0; transition: background .2s, border-color .2s; }
.toggle-btn.on { background: #6f2bff33; border-color: #6f2bff88; }
.toggle-knob { position: absolute; top: 2px; left: 2px; width: 14px; height: 14px; background: #333; transition: transform .2s, background .2s; }
.toggle-btn.on .toggle-knob { transform: translateX(16px); background: #9d6cff; }

.timer-info   { flex: 1; cursor: pointer; min-width: 0; }
.timer-name   { font-size: 13px; font-weight: 600; color: #e0e0e0; margin-bottom: 4px; }
.timer-meta   { display: flex; gap: 6px; flex-wrap: wrap; margin-bottom: 4px; }
.timer-response { font-size: 11px; color: #555; font-family: 'Consolas','Fira Mono',monospace; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.timer-next     { font-size: 10px; color: #9d6cff88; margin-top: 2px; font-family: 'Consolas','Fira Mono',monospace; }
.meta-pill    { font-size: 10px; padding: 1px 6px; border: 1px solid; }
.meta-pill.interval { color: #9d6cff; border-color: #9d6cff44; background: #9d6cff11; }
.meta-pill.msgs     { color: #4ec9b0; border-color: #4ec9b044; background: #4ec9b011; }
.meta-pill.when     { color: #e5c07b; border-color: #e5c07b44; background: #e5c07b11; }
.meta-pill.game     { color: #23d18b; border-color: #23d18b44; background: #23d18b11; }
.meta-pill.cond     { color: #c792ea; border-color: #c792ea44; background: #c792ea11; }

.row-actions { display: flex; gap: 6px; flex-shrink: 0; }
.btn-action { height: 30px; padding: 0 10px; border: 1px solid; background: transparent; font-family: inherit; font-size: 11px; cursor: pointer; transition: background .15s; white-space: nowrap; }
.btn-action.edit { border-color: #6f2bff66; color: #9d6cff; }
.btn-action.edit:hover { background: #6f2bff22; }
.btn-action.del { border-color: #f1494944; color: #f14949; }
.btn-action.del:hover { background: #f1494911; }
.btn-action:disabled { opacity: .4; cursor: not-allowed; }

.panel-overlay { position: fixed; inset: 0; background: rgba(0,0,0,.65); display: flex; align-items: flex-start; justify-content: flex-end; z-index: 1000; }
.panel { width: 560px; max-width: 100vw; height: 100vh; background: #1a1a1e; border-left: 1px solid #2a2a30; display: flex; flex-direction: column; overflow: hidden; animation: slideIn .2s ease; }
@keyframes slideIn { from { transform: translateX(40px); opacity: 0 } to { transform: none; opacity: 1 } }
.panel-header { display: flex; align-items: flex-start; justify-content: space-between; padding: 20px 24px 16px; border-bottom: 1px solid #222; flex-shrink: 0; }
.panel-title { font-size: 16px; font-weight: 700; color: #e0e0e0; }
.panel-sub   { font-size: 11px; color: #555; margin-top: 3px; }
.panel-close { width: 28px; height: 28px; border: none; background: transparent; color: #555; font-size: 14px; cursor: pointer; }
.panel-close:hover { color: #e0e0e0; }
.panel-body  { flex: 1; overflow-y: auto; padding: 20px 24px; display: flex; flex-direction: column; gap: 14px; scrollbar-width: none; }
.panel-body::-webkit-scrollbar { display: none; }

.field-group  { display: flex; flex-direction: column; gap: 5px; }
.field-label  { font-size: 11px; font-weight: 600; color: #888; text-transform: uppercase; letter-spacing: .05em; display: flex; align-items: center; gap: 6px; }
.field-hint   { font-size: 10px; color: #555; font-weight: 400; text-transform: none; letter-spacing: 0; }
.field-input, .field-select { background: #111217; border: 1px solid #2a2a30; color: #e0e0e0; font-family: inherit; font-size: 13px; padding: 7px 10px; outline: none; transition: border-color .15s; }
.field-input:focus, .field-select:focus { border-color: #6f2bff55; }
.field-input.mono { font-family: 'Consolas','Fira Mono',monospace; }
.field-select { appearance: none; cursor: pointer; }
.interval-row { display: flex; align-items: center; gap: 8px; }
.interval-row .field-input { flex: 1; }
.row-2, .row-3 { display: flex; gap: 12px; }
.row-2 > *, .row-3 > * { flex: 1; min-width: 0; }

.script-editor {
  min-height: 90px; max-height: 200px; overflow-y: auto;
  background: #0d0d10; border: 1px solid #2a2a30;
  padding: 10px 12px; font-family: 'Consolas','Fira Mono',monospace;
  font-size: 13px; line-height: 1.7; color: #c0c0c0;
  outline: none; white-space: pre-wrap; word-break: break-word;
}
.script-editor:focus { border-color: #6f2bff55; }
.script-editor:empty::before { content: attr(data-placeholder); color: #2a2a35; pointer-events: none; }

.panel-footer { display: flex; align-items: center; justify-content: space-between; padding-top: 16px; border-top: 1px solid #222; margin-top: 4px; }
.footer-right { display: flex; gap: 8px; }
.btn-save   { height: 34px; padding: 0 20px; border: none; background: #6f2bff; color: #fff; font-family: inherit; font-size: 12px; font-weight: 600; cursor: pointer; }
.btn-save:hover:not(:disabled) { background: #7f3fff; }
.btn-save:disabled { opacity: .4; cursor: not-allowed; }
.btn-cancel { height: 34px; padding: 0 16px; border: 1px solid #333; background: transparent; color: #888; font-family: inherit; font-size: 12px; cursor: pointer; }
.btn-cancel:hover { border-color: #555; color: #e0e0e0; }
.btn-delete { height: 34px; padding: 0 14px; border: 1px solid #f1494944; background: transparent; color: #f14949; font-family: inherit; font-size: 12px; cursor: pointer; }
.btn-delete:hover { background: #f1494911; }

.ref-panel { border: 1px solid #1e1e22; margin-top: 4px; }
.ref-summary { padding: 5px 10px; font-size: 10px; font-weight: 600; color: #555; text-transform: uppercase; letter-spacing: .05em; cursor: pointer; user-select: none; list-style: none; }
.ref-summary:hover { color: #888; }
.ref-content { max-height: 240px; overflow-y: auto; padding: 6px 10px; display: flex; flex-direction: column; gap: 8px; scrollbar-width: none; }
.ref-content::-webkit-scrollbar { display: none; }
.ref-group-label { font-size: 9px; font-weight: 700; text-transform: uppercase; letter-spacing: .06em; color: #9d6cff; margin-bottom: 2px; }
.ref-row { display: flex; align-items: baseline; gap: 8px; padding: 1px 0; }
.ref-token { font-family: 'Consolas','Fira Mono',monospace; font-size: 11px; color: #4ec9b0; background: rgba(78,201,176,.08); padding: 1px 5px; white-space: nowrap; flex-shrink: 0; }
.ref-desc { font-size: 10px; color: #484848; }
</style>

<style>
.sh-kw      { color: #569cd6; }
.sh-builtin { color: #9d6cff; }
.sh-custom  { color: #4fc1e9; }
.sh-op      { color: #c792ea; }
.sh-string  { color: #ce9178; }
.sh-number  { color: #b5cea8; }
.sh-paren   { color: #888; }
.sh-error   { color: #f14949; text-decoration: underline wavy #f1494966; }
</style>
