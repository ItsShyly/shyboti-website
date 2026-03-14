<script setup lang="ts">
import { ref, onMounted, watch } from 'vue'
import { API } from '../api'
import { useAuth } from '../auth'
import { highlightScript } from '../composables/scriptHighlight'

const { session } = useAuth()

const REF_GROUPS = [
  { label: 'User', items: [
    { token: '$user.name',    desc: 'Sender login name' },
    { token: '$user.display', desc: 'Sender display name' },
    { token: '$user.mention', desc: '@DisplayName' },
    { token: '$user.is(mod)', desc: 'true/false' },
    { token: '$user.is(sub)', desc: 'true/false' },
  ]},
  { label: 'Message', items: [
    { token: '$message.text',   desc: 'Full message text' },
    { token: '$args',           desc: 'Text after trigger pattern' },
    { token: '$1', desc: 'First word of args' },
    { token: '$2', desc: 'Second word of args' },
  ]},
  { label: 'Channel', items: [
    { token: '$channel.name',    desc: 'Channel login' },
    { token: '$channel.game',    desc: 'Current game' },
    { token: '$channel.title',   desc: 'Stream title' },
    { token: '$channel.viewers', desc: 'Viewer count' },
    { token: '$channel.isLive',  desc: 'true/false' },
  ]},
  { label: 'Variables / Counters', items: [
    { token: '$var.name',           desc: 'Read variable' },
    { token: '$var.name.set(value)', desc: 'Set variable' },
    { token: '$counter.name',       desc: 'Increment +1' },
    { token: '$counter.name.get',    desc: 'Read counter' },
  ]},
  { label: 'Random / Text', items: [
    { token: '$random.int(min,max)', desc: 'Random integer' },
    { token: '$random.pick(a,b,c)', desc: 'Pick from list' },
    { token: '$text.upper(text)',    desc: 'Uppercase' },
    { token: '$calc(expr)',          desc: 'Math expression' },
    { token: '$http.get(url)',       desc: 'GET request' },
  ]},
]

interface Trigger {
  id: number; name: string
  event_type: string; match_pattern: string; match_type: string
  response: string; action_type: string
  enabled_when: string; required_game: string
  condition: string; cooldown_sec: number; is_active: number
}

const triggers = ref<Trigger[]>([])
const loading  = ref(false)
const saving   = ref<string | null>(null)
const error    = ref('')
const success  = ref('')

const editOpen    = ref(false)
const isNew       = ref(false)
const editorRef   = ref<HTMLDivElement | null>(null)
const editTrigger = ref<Partial<Trigger> & { name: string }>({
  name: '', event_type: 'message', match_pattern: '', match_type: 'contains',
  response: '', action_type: 'say', enabled_when: 'always',
  required_game: '', condition: '', cooldown_sec: 30, is_active: 1,
})

const EVENT_TYPES = [
  { value: 'message',  label: 'Chat message',  hint: 'Any message matching the pattern' },
  { value: 'command',  label: 'Command used',  hint: 'When a specific command is triggered' },
  { value: 'join',     label: 'User joins',    hint: 'When a viewer joins the channel' },
  { value: 'follow',   label: 'Follow',        hint: 'New follower (requires EventSub)' },
  { value: 'sub',      label: 'Sub / Resub',   hint: 'Subscription event' },
  { value: 'bits',     label: 'Bits cheer',    hint: 'Bits donation event' },
  { value: 'raid',     label: 'Raid',          hint: 'Incoming raid' },
  { value: 'schedule', label: 'Schedule',      hint: 'At a specific time (cron-like)' },
]

const MATCH_TYPES = [
  { value: 'contains', label: 'contains' },
  { value: 'exact',    label: 'exact match' },
  { value: 'starts',   label: 'starts with' },
  { value: 'ends',     label: 'ends with' },
  { value: 'regex',    label: 'regex' },
]

const ACTION_TYPES = [
  { value: 'say',          label: 'Send message' },
  { value: 'set_title',    label: 'Set stream title' },
  { value: 'set_category', label: 'Set stream category' },
  { value: 'timeout',      label: 'Timeout user' },
  { value: 'ban',          label: 'Ban user' },
  { value: 'mod',          label: 'Mod user' },
]

function showSuccess(msg: string) { success.value = msg; setTimeout(() => success.value = '', 3000) }

async function load() {
  if (!session.value) return
  loading.value = true; error.value = ''
  try {
    const res = await fetch(`${API}/triggers/${session.value.channel}`, {
      headers: { Authorization: `Bearer ${session.value.token}` }
    })
    if (!res.ok) throw new Error()
    const data = await res.json() as { triggers: Trigger[] }
    triggers.value = data.triggers
  } catch (e: any) { error.value = 'Could not load triggers: ' + (e?.message ?? e) }
  loading.value = false
}

onMounted(load)
watch(() => session.value?.channel, load)

function openNew() {
  isNew.value = true
  editTrigger.value = { name: '', event_type: 'message', match_pattern: '', match_type: 'contains',
    response: '', action_type: 'say', enabled_when: 'always',
    required_game: '', condition: '', cooldown_sec: 30, is_active: 1 }
  editOpen.value = true
  setTimeout(() => { if (editorRef.value) { editorRef.value.innerText = ''; applyHL() } }, 50)
}

function openEdit(t: Trigger) {
  isNew.value = false
  editTrigger.value = { ...t }
  editOpen.value = true
  setTimeout(() => { if (editorRef.value) { editorRef.value.innerText = t.response; applyHL() } }, 50)
}

function applyHL() {
  const el = editorRef.value; if (!el) return
  const sel = window.getSelection(); let offset = 0
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
      if (rem <= len) { const r = document.createRange(); r.setStart(node, rem); r.collapse(true); sel?.removeAllRanges(); sel?.addRange(r); placed = true; return }
      rem -= len; return
    }
    for (const c of Array.from(node.childNodes)) walk(c)
  }
  walk(el)
}

function onEditorInput() {
  const el = editorRef.value; if (!el) return
  editTrigger.value.response = el.innerText.replace(/\n$/, '')
  applyHL()
}

async function saveTrigger() {
  if (!session.value || !editTrigger.value.name) return
  saving.value = editTrigger.value.name
  try {
    const res = await fetch(`${API}/triggers/${session.value.channel}/${editTrigger.value.name}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.value.token}` },
      body: JSON.stringify(editTrigger.value),
    })
    if (!res.ok) throw new Error(await res.text())
    showSuccess('Trigger saved!')
    editOpen.value = false
    load()
  } catch (e: any) { error.value = 'Could not save trigger: ' + (e?.message ?? e) }
  finally { saving.value = null }
}

async function deleteTrigger(name: string) {
  if (!session.value) return
  saving.value = name
  try {
    await fetch(`${API}/triggers/${session.value.channel}/${name}`, {
      method: 'DELETE', headers: { Authorization: `Bearer ${session.value.token}` }
    })
    triggers.value = triggers.value.filter(t => t.name !== name)
    if (editOpen.value && editTrigger.value.name === name) editOpen.value = false
  } catch { error.value = 'Could not delete trigger.' }
  saving.value = null
}

async function toggleActive(t: Trigger) {
  if (!session.value) return
  const next = t.is_active ? 0 : 1
  await fetch(`${API}/triggers/${session.value.channel}/${t.name}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.value.token}` },
    body: JSON.stringify({ ...t, is_active: next }),
  })
  t.is_active = next
}

function eventLabel(v: string) { return EVENT_TYPES.find(e => e.value === v)?.label ?? v }
function actionLabel(v: string) { return ACTION_TYPES.find(a => a.value === v)?.label ?? v }
function matchLabel(v: string)  { return MATCH_TYPES.find(m => m.value === v)?.label ?? v }

// Show pattern field only for message/command events
const needsPattern = (ev: string) => ['message','command'].includes(ev)
</script>

<template>
  <div class="view">
    <div class="view-header">
      <div>
        <div class="view-title">Triggers</div>
        <div class="view-sub">Automatic actions on events for #{{ session?.channel }}</div>
      </div>
      <button class="btn-new" @click="openNew">+ New trigger</button>
    </div>

    <div v-if="success" class="toast success">{{ success }}</div>
    <div v-if="error"   class="toast error">{{ error }}</div>

    <div v-if="loading" class="empty">Loading…</div>
    <div v-else-if="!triggers.length" class="empty">No triggers yet. Create one to get started.</div>

    <div v-else class="trigger-list">
      <div v-for="t in triggers" :key="t.id" class="trigger-row" :class="{ inactive: !t.is_active }">
        <div class="trigger-toggle-wrap">
          <button class="toggle-btn" :class="{ on: t.is_active }" @click="toggleActive(t)">
            <span class="toggle-knob"></span>
          </button>
        </div>
        <div class="trigger-info" @click="openEdit(t)">
          <div class="trigger-name">{{ t.name }}</div>
          <div class="trigger-meta">
            <span class="meta-pill event">{{ eventLabel(t.event_type) }}</span>
            <span v-if="t.match_pattern" class="meta-pill pattern">{{ matchLabel(t.match_type) }}: "{{ t.match_pattern.slice(0,20) }}{{ t.match_pattern.length>20?'…':'' }}"</span>
            <span class="meta-pill action">→ {{ actionLabel(t.action_type) }}</span>
            <span v-if="t.enabled_when !== 'always'" class="meta-pill when">{{ t.enabled_when }}</span>
            <span v-if="t.required_game" class="meta-pill game">🎮 {{ t.required_game }}</span>
            <span v-if="t.cooldown_sec" class="meta-pill cd">⏱ {{ t.cooldown_sec }}s cd</span>
          </div>
          <div class="trigger-response">{{ t.response.slice(0,80) }}{{ t.response.length>80?'…':'' }}</div>
        </div>
        <button class="btn-del" @click.stop="deleteTrigger(t.name)" :disabled="saving === t.name">✕</button>
      </div>
    </div>

    <Teleport to="body">
      <div v-if="editOpen" class="panel-overlay" @click.self="editOpen = false">
        <div class="panel">
          <div class="panel-header">
            <div>
              <div class="panel-title">{{ isNew ? 'New trigger' : `Edit · ${editTrigger.name}` }}</div>
              <div class="panel-sub">#{{ session?.channel }}</div>
            </div>
            <button class="panel-close" @click="editOpen = false">✕</button>
          </div>

          <div class="panel-body">
            <div class="field-group">
              <label class="field-label">Name</label>
              <input v-model="editTrigger.name" class="field-input" :disabled="!isNew" placeholder="hype-train" />
            </div>

            <!-- Event type -->
            <div class="field-group">
              <label class="field-label">Event type</label>
              <div class="event-grid">
                <button v-for="e in EVENT_TYPES" :key="e.value"
                  class="event-btn" :class="{ active: editTrigger.event_type === e.value }"
                  @click="editTrigger.event_type = e.value" :title="e.hint">
                  {{ e.label }}
                </button>
              </div>
            </div>

            <!-- Match pattern — only for message/command -->
            <div v-if="needsPattern(editTrigger.event_type ?? 'message')" class="field-group">
              <label class="field-label">Match pattern</label>
              <div class="match-row">
                <select v-model="editTrigger.match_type" class="field-select match-type">
                  <option v-for="m in MATCH_TYPES" :key="m.value" :value="m.value">{{ m.label }}</option>
                </select>
                <input v-model="editTrigger.match_pattern" class="field-input" placeholder="!lurk or hello" />
              </div>
            </div>

            <!-- Action type -->
            <div class="field-group">
              <label class="field-label">Action</label>
              <div class="action-grid">
                <button v-for="a in ACTION_TYPES" :key="a.value"
                  class="action-btn" :class="{ active: editTrigger.action_type === a.value }"
                  @click="editTrigger.action_type = a.value">
                  {{ a.label }}
                </button>
              </div>
            </div>

            <!-- Response -->
            <div class="field-group">
              <label class="field-label">
                {{ editTrigger.action_type === 'say' ? 'Response' : 'Value' }}
                <span class="field-hint">supports $variables</span>
              </label>
              <div
                ref="editorRef"
                class="script-editor"
                contenteditable="true"
                spellcheck="false"
                data-placeholder="$user.mention just triggered this! PogChamp"
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

            <div class="row-3">
              <div class="field-group">
                <label class="field-label">Active when</label>
                <select v-model="editTrigger.enabled_when" class="field-select">
                  <option value="always">Always</option>
                  <option value="online">Online only</option>
                  <option value="offline">Offline only</option>
                </select>
              </div>
              <div class="field-group">
                <label class="field-label">Required game</label>
                <input v-model="editTrigger.required_game" class="field-input" placeholder="optional" />
              </div>
              <div class="field-group">
                <label class="field-label">Cooldown <span class="field-hint">s</span></label>
                <input v-model.number="editTrigger.cooldown_sec" type="number" min="0" class="field-input" />
              </div>
            </div>

            <div class="field-group">
              <label class="field-label">Condition <span class="field-hint">optional · only fire when this is true</span></label>
              <input v-model="editTrigger.condition" class="field-input mono" placeholder="$channel.game == Just Chatting" />
            </div>

            <div class="panel-footer">
              <button v-if="!isNew" class="btn-delete" @click="deleteTrigger(editTrigger.name); editOpen = false">Delete</button>
              <div v-else></div>
              <div class="footer-right">
                <button class="btn-cancel" @click="editOpen = false">Cancel</button>
                <button class="btn-save" @click="saveTrigger" :disabled="!!saving || !editTrigger.name">
                  {{ saving ? 'Saving…' : 'Save trigger' }}
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
.btn-new { height: 32px; padding: 0 14px; border: 1px solid #6f2bff66; background: #6f2bff15; color: #9d6cff; font-family: inherit; font-size: 12px; cursor: pointer; }
.btn-new:hover { background: #6f2bff30; }
.toast { padding: 8px 14px; font-size: 12px; margin-bottom: 4px; }
.toast.success { background: rgba(35,209,139,.1); border: 1px solid rgba(35,209,139,.3); color: #23d18b; }
.toast.error   { background: rgba(241,73,73,.1);  border: 1px solid rgba(241,73,73,.3);  color: #f14949; }
.empty { color: #444; font-size: 13px; padding: 40px; text-align: center; }

.trigger-list { display: flex; flex-direction: column; gap: 2px; overflow-y: auto; flex: 1; }
.trigger-row  { display: flex; align-items: center; gap: 12px; padding: 10px 14px; background: #141418; border-bottom: 1px solid #1e1e1e; transition: background .1s; }
.trigger-row:hover { background: #1c1c20; }
.trigger-row.inactive { opacity: .45; }
.toggle-btn { width: 36px; height: 20px; border: 1px solid #2a2a30; background: #0d0d10; cursor: pointer; position: relative; flex-shrink: 0; transition: background .2s, border-color .2s; }
.toggle-btn.on { background: #6f2bff33; border-color: #6f2bff88; }
.toggle-knob { position: absolute; top: 2px; left: 2px; width: 14px; height: 14px; background: #333; transition: transform .2s, background .2s; }
.toggle-btn.on .toggle-knob { transform: translateX(16px); background: #9d6cff; }
.trigger-info { flex: 1; cursor: pointer; min-width: 0; }
.trigger-name { font-size: 13px; font-weight: 600; color: #e0e0e0; margin-bottom: 4px; }
.trigger-meta { display: flex; gap: 6px; flex-wrap: wrap; margin-bottom: 4px; }
.trigger-response { font-size: 11px; color: #555; font-family: 'Consolas','Fira Mono',monospace; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.meta-pill    { font-size: 10px; padding: 1px 6px; border: 1px solid; }
.meta-pill.event   { color: #569cd6; border-color: #569cd644; background: #569cd611; }
.meta-pill.pattern { color: #e5c07b; border-color: #e5c07b44; background: #e5c07b11; font-family: monospace; }
.meta-pill.action  { color: #23d18b; border-color: #23d18b44; background: #23d18b11; }
.meta-pill.when    { color: #e5c07b; border-color: #e5c07b44; background: #e5c07b11; }
.meta-pill.game    { color: #4ec9b0; border-color: #4ec9b044; background: #4ec9b011; }
.meta-pill.cd      { color: #c792ea; border-color: #c792ea44; background: #c792ea11; }
.btn-del { width: 26px; height: 26px; border: 1px solid #f1494933; background: transparent; color: #f14949; font-size: 11px; cursor: pointer; flex-shrink: 0; opacity: 0; }
.trigger-row:hover .btn-del { opacity: 1; }
.btn-del:hover { background: #f1494922; }

.panel-overlay { position: fixed; inset: 0; background: rgba(0,0,0,.65); display: flex; align-items: flex-start; justify-content: flex-end; z-index: 1000; }
.panel { width: 580px; max-width: 100vw; height: 100vh; background: #1a1a1e; border-left: 1px solid #2a2a30; display: flex; flex-direction: column; overflow: hidden; animation: slideIn .2s ease; }
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
.field-input, .field-select { background: #111217; border: 1px solid #2a2a30; color: #e0e0e0; font-family: inherit; font-size: 13px; padding: 7px 10px; outline: none; transition: border-color .15s; width: 100%; box-sizing: border-box; }
.field-input:focus, .field-select:focus { border-color: #6f2bff55; }
.field-input.mono { font-family: 'Consolas','Fira Mono',monospace; }
.field-select { appearance: none; cursor: pointer; }

.event-grid { display: flex; flex-wrap: wrap; gap: 4px; }
.event-btn { height: 28px; padding: 0 12px; border: 1px solid #2a2a30; background: #111217; color: #666; font-family: inherit; font-size: 11px; cursor: pointer; transition: all .15s; }
.event-btn:hover { color: #aaa; border-color: #444; }
.event-btn.active { color: #569cd6; border-color: #569cd666; background: #569cd615; }

.action-grid { display: flex; flex-wrap: wrap; gap: 4px; }
.action-btn { height: 28px; padding: 0 12px; border: 1px solid #2a2a30; background: #111217; color: #666; font-family: inherit; font-size: 11px; cursor: pointer; transition: all .15s; }
.action-btn:hover { color: #aaa; border-color: #444; }
.action-btn.active { color: #23d18b; border-color: #23d18b66; background: #23d18b15; }

.match-row { display: flex; gap: 8px; }
.match-type { width: 130px; flex-shrink: 0; }
.match-row .field-input { flex: 1; }

.row-3 { display: flex; gap: 12px; }
.row-3 > * { flex: 1; min-width: 0; }

.script-editor { min-height: 80px; max-height: 180px; overflow-y: auto; background: #0d0d10; border: 1px solid #2a2a30; padding: 10px 12px; font-family: 'Consolas','Fira Mono',monospace; font-size: 13px; line-height: 1.7; color: #c0c0c0; outline: none; white-space: pre-wrap; word-break: break-word; }
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
.sh-kw { color: #569cd6; } .sh-builtin { color: #9d6cff; } .sh-custom { color: #4fc1e9; }
.sh-op { color: #c792ea; } .sh-string { color: #ce9178; } .sh-number { color: #b5cea8; }
.sh-paren { color: #888; } .sh-error { color: #f14949; text-decoration: underline wavy #f1494966; }
</style>
