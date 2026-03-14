<script setup lang="ts">
import { ref, onMounted, watch } from 'vue'
import { API } from '../api'
import { useAuth } from '../auth'
import { highlightScript } from '../composables/scriptHighlight'

const { session } = useAuth()

const REF_GROUPS = [
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
]

interface Timer {
  id: number; name: string; response: string
  interval_sec: number; min_messages: number
  enabled_when: string; required_game: string
  condition: string; is_active: number
}

const timers  = ref<Timer[]>([])
const loading = ref(false)
const saving  = ref<string | null>(null)
const error   = ref('')
const success = ref('')

// Edit panel
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

onMounted(load)
watch(() => session.value?.channel, load)

function openNew() {
  isNew.value = true
  editTimer.value = { name: '', response: '', interval_sec: 300, min_messages: 0,
    enabled_when: 'always', required_game: '', condition: '', is_active: 1 }
  editOpen.value = true
  setTimeout(() => {
    if (editorRef.value) { editorRef.value.innerText = ''; applyHL() }
  }, 50)
}

function openEdit(t: Timer) {
  isNew.value = false
  editTimer.value = { ...t }
  editOpen.value = true
  setTimeout(() => {
    if (editorRef.value) { editorRef.value.innerText = t.response; applyHL() }
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
  // restore caret
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
    showSuccess('Timer saved!')
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
    timers.value = timers.value.filter(t => t.name !== name)
    if (editOpen.value && editTimer.value.name === name) editOpen.value = false
  } catch { error.value = 'Could not delete timer.' }
  saving.value = null
}

async function toggleActive(t: Timer) {
  if (!session.value) return
  const next = t.is_active ? 0 : 1
  await fetch(`${API}/timers/${session.value.channel}/${t.name}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.value.token}` },
    body: JSON.stringify({ ...t, is_active: next }),
  })
  t.is_active = next
}
</script>

<template>
  <div class="view">
    <div class="view-header">
      <div>
        <div class="view-title">Timers</div>
        <div class="view-sub">Automated messages on an interval for #{{ session?.channel }}</div>
      </div>
      <button class="btn-new" @click="openNew">+ New timer</button>
    </div>

    <div v-if="success" class="toast success">{{ success }}</div>
    <div v-if="error"   class="toast error">{{ error }}</div>

    <div v-if="loading" class="empty">Loading…</div>
    <div v-else-if="!timers.length" class="empty">No timers yet. Create one to get started.</div>

    <div v-else class="timer-list">
      <div v-for="t in timers" :key="t.id" class="timer-row" :class="{ inactive: !t.is_active }">
        <div class="timer-toggle-wrap">
          <button class="toggle-btn" :class="{ on: t.is_active }" @click="toggleActive(t)" :title="t.is_active ? 'Disable' : 'Enable'">
            <span class="toggle-knob"></span>
          </button>
        </div>
        <div class="timer-info" @click="openEdit(t)">
          <div class="timer-name">{{ t.name }}</div>
          <div class="timer-meta">
            <span class="meta-pill interval">⏱ {{ fmtInterval(t.interval_sec) }}</span>
            <span v-if="t.min_messages" class="meta-pill msgs">💬 {{ t.min_messages }}+ msgs</span>
            <span v-if="t.enabled_when !== 'always'" class="meta-pill when">{{ t.enabled_when }}</span>
            <span v-if="t.required_game" class="meta-pill game">🎮 {{ t.required_game }}</span>
            <span v-if="t.condition" class="meta-pill cond">if …</span>
          </div>
          <div class="timer-response">{{ t.response.slice(0, 80) }}{{ t.response.length > 80 ? '…' : '' }}</div>
        </div>
        <div class="row-actions">
          <button class="btn-action edit" @click.stop="openEdit(t)">Edit</button>
          <button class="btn-action del" @click.stop="deleteTimer(t.name)" :disabled="saving === t.name">✕</button>
        </div>
      </div>
    </div>

    <!-- Edit panel -->
    <Teleport to="body">
      <div v-if="editOpen" class="panel-overlay" @click.self="editOpen = false">
        <div class="panel">
          <div class="panel-header">
            <div>
              <div class="panel-title">{{ isNew ? 'New timer' : `Edit · ${editTimer.name}` }}</div>
              <div class="panel-sub">#{{ session?.channel }}</div>
            </div>
            <button class="panel-close" @click="editOpen = false">✕</button>
          </div>

          <div class="panel-body">
            <div class="field-group">
              <label class="field-label">Name <span class="field-hint">lowercase, no spaces</span></label>
              <input v-model="editTimer.name" class="field-input" :disabled="!isNew" placeholder="welcome" />
            </div>

            <div class="field-group">
              <label class="field-label">Response <span class="field-hint">supports $variables</span></label>
              <div
                ref="editorRef"
                class="script-editor"
                contenteditable="true"
                spellcheck="false"
                data-placeholder="Hello chat! $channel.viewers viewers right now."
                @input="onEditorInput"
              ></div>
              <details class="ref-panel">
                <summary class="ref-summary">📖 Variable reference</summary>
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
                <label class="field-label">Interval</label>
                <div class="interval-row">
                  <input v-model.number="editTimer.interval_sec" type="number" min="30" class="field-input" />
                  <span class="field-hint">seconds · {{ fmtInterval(editTimer.interval_sec ?? 300) }}</span>
                </div>
              </div>
              <div class="field-group">
                <label class="field-label">Min messages <span class="field-hint">per interval</span></label>
                <input v-model.number="editTimer.min_messages" type="number" min="0" class="field-input" />
              </div>
            </div>

            <div class="row-3">
              <div class="field-group">
                <label class="field-label">Active when</label>
                <select v-model="editTimer.enabled_when" class="field-select">
                  <option value="always">Always</option>
                  <option value="online">Online only</option>
                  <option value="offline">Offline only</option>
                </select>
              </div>
              <div class="field-group">
                <label class="field-label">Required game <span class="field-hint">optional</span></label>
                <input v-model="editTimer.required_game" class="field-input" placeholder="Just Chatting" />
              </div>
            </div>

            <div class="field-group">
              <label class="field-label">Condition <span class="field-hint">optional · $variable expression</span></label>
              <input v-model="editTimer.condition" class="field-input mono" placeholder="$channel.viewers > 10" />
            </div>

            <div class="panel-footer">
              <button v-if="!isNew" class="btn-delete" @click="deleteTimer(editTimer.name); editOpen = false">Delete</button>
              <div v-else></div>
              <div class="footer-right">
                <button class="btn-cancel" @click="editOpen = false">Cancel</button>
                <button class="btn-save" @click="saveTimer" :disabled="!!saving || !editTimer.name || !editTimer.response">
                  {{ saving ? 'Saving…' : 'Save timer' }}
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </Teleport>
  </div>
</template>

<style scoped>
.view { display: flex; flex-direction: column; gap: 16px; height: 100%; }
.view-header { display: flex; align-items: flex-start; justify-content: space-between; }
.view-title  { font-size: 18px; font-weight: 700; color: #e0e0e0; margin-bottom: 4px; }
.view-sub    { font-size: 12px; color: #555; }

.btn-new { height: 32px; padding: 0 14px; border: 1px solid #6f2bff66; background: #6f2bff15; color: #9d6cff; font-family: inherit; font-size: 12px; cursor: pointer; transition: background .15s; }
.btn-new:hover { background: #6f2bff30; }

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

/* Panel */
.panel-overlay { position: fixed; inset: 0; background: rgba(0,0,0,.65); display: flex; align-items: flex-start; justify-content: flex-end; z-index: 1000; }
.panel { width: 560px; max-width: 100vw; height: 100vh; background: #1a1a1e; border-left: 1px solid #2a2a30; display: flex; flex-direction: column; overflow: hidden; animation: slideIn .2s ease; }
@keyframes slideIn { from { transform: translateX(40px); opacity: 0 } to { transform: none; opacity: 1 } }
.panel-header { display: flex; align-items: flex-start; justify-content: space-between; padding: 20px 24px 16px; border-bottom: 1px solid #222; flex-shrink: 0; }
.panel-title { font-size: 16px; font-weight: 700; color: #e0e0e0; }
.panel-sub   { font-size: 11px; color: #555; margin-top: 3px; }
.panel-close { width: 28px; height: 28px; border: none; background: transparent; color: #555; font-size: 14px; cursor: pointer; }
.panel-close:hover { color: #e0e0e0; }
.panel-body  { flex: 1; overflow-y: auto; padding: 20px 24px; display: flex; flex-direction: column; gap: 14px; }

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
.ref-content { max-height: 240px; overflow-y: auto; padding: 6px 10px; display: flex; flex-direction: column; gap: 8px; }
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
