<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted, watch } from 'vue'
import { API } from '../api'
import { useAuth } from '../auth'
import { useI18n } from '../i18n'
import { highlightScript } from '../composables/scriptHighlight'

const { session, channelRole } = useAuth()
const { t } = useI18n()

const canToggle = computed(() => channelRole.value?.permissions.automations_toggle ?? false)
const canEdit   = computed(() => channelRole.value?.permissions.automations_edit   ?? false)
const canDelete = computed(() => channelRole.value?.permissions.automations_delete ?? false)

// >>> Variable reference for countdown scripts <<<
const REF_GROUPS = [
  { label: 'Countdown', items: [
    { token: '$countdown.name.remaining', desc: 'Seconds remaining' },
    { token: '$countdown.name.total',     desc: 'Total duration in seconds' },
    { token: '$countdown.name.elapsed',   desc: 'Seconds elapsed' },
    { token: '$countdown.name.percent',   desc: 'Percent complete (0–100)' },
  ]},
  { label: 'Channel', items: [
    { token: '$channel.name',    desc: 'Channel login name' },
    { token: '$channel.game',    desc: 'Current game' },
    { token: '$channel.viewers', desc: 'Viewer count' },
  ]},
  { label: 'Variables', items: [
    { token: '$var.name',            desc: 'Read variable' },
    { token: '$var.name.set(value)', desc: 'Set variable' },
    { token: '$counter.name.get',    desc: 'Read counter' },
  ]},
  { label: 'Random / Text', items: [
    { token: '$random.int(min,max)', desc: 'Random integer' },
    { token: '$calc(expr)',          desc: 'Math expression' },
  ]},
]

interface Countdown {
  id: number
  name: string
  duration_sec: number
  msg_start: string
  msg_tick: string
  tick_every_sec: number
  msg_end: string
  enabled_when: string
  condition: string
  is_active: number
  status: 'idle' | 'running' | 'finished'
  started_at: number | null
}

const countdowns  = ref<Countdown[]>([])
const loading     = ref(false)
const saving      = ref<string | null>(null)
const error       = ref('')
const success     = ref('')

// >>> Edit panel <<<
const editOpen = ref(false)
const isNew    = ref(false)
const editCountdown = ref<Partial<Countdown> & { name: string }>({
  name: '', duration_sec: 60, msg_start: '', msg_tick: '',
  tick_every_sec: 10, msg_end: '', enabled_when: 'always',
  condition: '', is_active: 1,
})

const startEditorRef = ref<HTMLDivElement | null>(null)
const tickEditorRef  = ref<HTMLDivElement | null>(null)
const endEditorRef   = ref<HTMLDivElement | null>(null)

function showSuccess(msg: string) { success.value = msg; setTimeout(() => success.value = '', 3000) }

function fmtDuration(s: number) {
  if (s >= 3600) return `${Math.floor(s/3600)}h ${Math.floor((s%3600)/60)}m`
  if (s >= 60)   return `${Math.floor(s/60)}m ${s%60}s`
  return `${s}s`
}

function fmtRemaining(cd: Countdown): string {
  if (cd.status !== 'running' || !cd.started_at) return fmtDuration(cd.duration_sec)
  const elapsed = Math.floor((Date.now() - cd.started_at) / 1000)
  const rem = Math.max(0, cd.duration_sec - elapsed)
  return fmtDuration(rem)
}

// >>> Tick: recompute remaining every second <<<
const tick = ref(0)
let tickInterval: ReturnType<typeof setInterval> | null = null

onMounted(() => {
  tickInterval = setInterval(() => tick.value++, 1000)
  load()
})
onUnmounted(() => { if (tickInterval) clearInterval(tickInterval) })
watch(() => session.value?.channel, load)

async function load() {
  if (!session.value) return
  loading.value = true; error.value = ''
  try {
    const res = await fetch(`${API}/countdowns/${session.value.channel}`, {
      headers: { Authorization: `Bearer ${session.value.token}` }
    })
    if (!res.ok) throw new Error()
    const data = await res.json() as { countdowns: Countdown[] }
    countdowns.value = data.countdowns
  } catch (e: any) { error.value = 'Could not load countdowns.' }
  loading.value = false
}

function openNew() {
  isNew.value = true
  editCountdown.value = {
    name: '', duration_sec: 60, msg_start: '', msg_tick: '',
    tick_every_sec: 10, msg_end: '', enabled_when: 'always',
    condition: '', is_active: 1,
  }
  editOpen.value = true
  setTimeout(() => { initEditors() }, 50)
}

function openEdit(cd: Countdown) {
  isNew.value = false
  editCountdown.value = { ...cd }
  editOpen.value = true
  setTimeout(() => { initEditors() }, 50)
}

function initEditors() {
  for (const [ref_, field] of [
    [startEditorRef.value, 'msg_start'],
    [tickEditorRef.value,  'msg_tick'],
    [endEditorRef.value,   'msg_end'],
  ] as [HTMLDivElement | null, keyof typeof editCountdown.value][]) {
    if (ref_) {
      const val = String(editCountdown.value[field] ?? '')
      ref_.innerText = val
      applyHL(ref_)
    }
  }
}

function applyHL(el: HTMLDivElement) {
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

function onEditorInput(el: HTMLDivElement | null, field: 'msg_start' | 'msg_tick' | 'msg_end') {
  if (!el) return
  editCountdown.value[field] = el.innerText.replace(/\n$/, '')
  applyHL(el)
}

const isBroadcaster = computed(() => channelRole.value?.role === 'broadcaster')

async function saveCountdown() {
  if (!session.value || !editCountdown.value.name) return
  if (!canEdit.value && !isBroadcaster.value) return
  saving.value = editCountdown.value.name
  try {
    const res = await fetch(`${API}/countdowns/${session.value.channel}/${editCountdown.value.name}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.value.token}` },
      body: JSON.stringify(editCountdown.value),
    })
    if (!res.ok) {
      const errData = await res.json().catch(() => ({ error: res.statusText }))
      throw new Error(errData.error ?? 'Save failed')
    }
    showSuccess(t('countdown.save') + '!')
    editOpen.value = false
    load()
  } catch (e: any) { error.value = e.message ?? 'Could not save countdown.' }
  finally { saving.value = null }
}

async function deleteCountdown(name: string) {
  if (!session.value) return
  saving.value = name
  try {
    await fetch(`${API}/countdowns/${session.value.channel}/${name}`, {
      method: 'DELETE', headers: { Authorization: `Bearer ${session.value.token}` }
    })
    countdowns.value = countdowns.value.filter(c => c.name !== name)
    if (editOpen.value && editCountdown.value.name === name) editOpen.value = false
  } catch { error.value = 'Could not delete countdown.' }
  saving.value = null
}

async function controlCountdown(name: string, action: 'start' | 'stop' | 'reset') {
  if (!session.value) return
  try {
    const res = await fetch(`${API}/countdowns/${session.value.channel}/${name}/${action}`, {
      method: 'POST', headers: { Authorization: `Bearer ${session.value.token}` }
    })
    if (res.ok) {
      const data = await res.json() as any
      const cd = countdowns.value.find(c => c.name === name)
      if (cd) {
        cd.status     = data.status ?? (action === 'start' ? 'running' : action === 'reset' ? 'idle' : 'idle')
        cd.started_at = data.started_at ?? (action === 'start' ? Date.now() : null)
      }
    }
  } catch {}
}
</script>

<template>
  <div class="view">
    <div class="view-header">
      <div>
        <div class="view-title">{{ t('countdown.title') }}</div>
        <div class="view-sub">{{ t('countdown.sub') }} #{{ session?.channel }}</div>
      </div>
      <button class="btn-new" @click="(canEdit || isBroadcaster) && openNew()" :disabled="!canEdit && !isBroadcaster" :class="{ 'btn-new-disabled': !canEdit && !isBroadcaster }">
        {{ t('countdown.new') }}
      </button>
    </div>

    <div v-if="success" class="toast success">{{ success }}</div>
    <div v-if="error"   class="toast error">{{ error }}</div>

    <div v-if="loading" class="empty">{{ t('countdown.loading') }}</div>
    <div v-else-if="!countdowns.length" class="empty">{{ t('countdown.empty') }}</div>

    <div v-else class="countdown-list">
      <!-- >>> Force recompute of remaining time each tick via tick ref <<< -->
      <template :key="tick">
        <div v-for="cd in countdowns" :key="cd.id" class="countdown-row" :class="{ inactive: !cd.is_active }">

          <!-- Status indicator -->
          <div class="cd-status-dot" :class="cd.status ?? 'idle'"></div>

          <!-- Main info -->
          <div class="cd-info" @click="openEdit(cd)">
            <div class="cd-name">{{ cd.name }}</div>
            <div class="cd-meta">
              <span class="meta-pill dur">⏱ {{ fmtDuration(cd.duration_sec) }}</span>
              <span v-if="cd.tick_every_sec" class="meta-pill tick">↻ {{ t('countdown.field.tick_every') }} {{ cd.tick_every_sec }}s</span>
              <span v-if="cd.enabled_when !== 'always'" class="meta-pill when">{{ cd.enabled_when }}</span>
              <span v-if="cd.condition" class="meta-pill cond">if …</span>
            </div>
            <!-- Running countdown: show live remaining -->
            <div v-if="cd.status === 'running'" class="cd-remaining">
              {{ fmtRemaining(cd) }} {{ t('countdown.status.running') }}
            </div>
            <div v-else-if="cd.status === 'finished'" class="cd-remaining finished">
              {{ t('countdown.status.finished') }}
            </div>
            <div v-else class="cd-remaining idle">
              {{ t('countdown.status.idle') }}
            </div>
          </div>

          <!-- Controls -->
          <div class="cd-controls">
            <button
              v-if="canToggle"
              class="ctrl-btn start"
              :class="{ active: cd.status === 'running' }"
              @click.stop="controlCountdown(cd.name, cd.status === 'running' ? 'stop' : 'start')"
              :title="cd.status === 'running' ? t('countdown.action.stop') : t('countdown.action.start')"
            >{{ cd.status === 'running' ? t('countdown.action.stop') : t('countdown.action.start') }}</button>
            <button
              v-if="canToggle"
              class="ctrl-btn reset"
              @click.stop="controlCountdown(cd.name, 'reset')"
              :title="t('countdown.action.reset')"
            >{{ t('countdown.action.reset') }}</button>
          </div>

          <!-- Edit / Delete -->
          <div class="row-actions">
            <button class="btn-action edit" @click.stop="canEdit && openEdit(cd)" :class="{ 'btn-action-disabled': !canEdit }">
              {{ canEdit ? t('countdown.edit') : t('countdown.view') }}
            </button>
            <button v-if="canDelete" class="btn-action del" @click.stop="deleteCountdown(cd.name)" :disabled="saving === cd.name">✕</button>
          </div>
        </div>
      </template>
    </div>

    <!-- >>> Edit panel <<< -->
    <Teleport to="body">
      <div v-if="editOpen" class="panel-overlay" @click.self="editOpen = false">
        <div class="panel">
          <div class="panel-header">
            <div>
              <div class="panel-title">{{ isNew ? t('countdown.edit_new') : `${t('countdown.edit_title')} ${editCountdown.name}` }}</div>
              <div class="panel-sub">#{{ session?.channel }}</div>
            </div>
            <button class="panel-close" @click="editOpen = false">✕</button>
          </div>

          <div class="panel-body">

            <!-- Name + Duration -->
            <div class="row-2">
              <div class="field-group">
                <label class="field-label">{{ t('countdown.field.name') }} <span class="field-hint">{{ t('countdown.field.name_hint') }}</span></label>
                <input v-model="editCountdown.name" class="field-input" :disabled="!isNew" placeholder="hype" />
              </div>
              <div class="field-group">
                <label class="field-label">{{ t('countdown.field.seconds') }} <span class="field-hint">{{ t('countdown.field.secs_hint') }}</span></label>
                <div class="dur-row">
                  <input v-model.number="editCountdown.duration_sec" type="number" min="1" class="field-input" />
                  <span class="field-hint">= {{ fmtDuration(editCountdown.duration_sec ?? 60) }}</span>
                </div>
              </div>
            </div>

            <!-- On start message -->
            <div class="field-group">
              <label class="field-label">{{ t('countdown.field.msg_start') }} <span class="field-hint">{{ t('countdown.field.resp_hint') }}</span></label>
              <div
                ref="startEditorRef"
                class="script-editor"
                contenteditable="true"
                spellcheck="false"
                data-placeholder="Countdown gestartet! $countdown.hype.remaining Sekunden verbleiben."
                @input="onEditorInput(startEditorRef, 'msg_start')"
              ></div>
            </div>

            <!-- Tick -->
            <div class="row-2">
              <div class="field-group">
                <label class="field-label">{{ t('countdown.field.msg_tick') }} <span class="field-hint">{{ t('countdown.field.tick_hint') }}</span></label>
                <div
                  ref="tickEditorRef"
                  class="script-editor"
                  contenteditable="true"
                  spellcheck="false"
                  data-placeholder="Noch $countdown.hype.remaining Sekunden!"
                  @input="onEditorInput(tickEditorRef, 'msg_tick')"
                ></div>
              </div>
              <div class="field-group sm">
                <label class="field-label">{{ t('countdown.field.tick_every') }} <span class="field-hint">s</span></label>
                <input v-model.number="editCountdown.tick_every_sec" type="number" min="1" class="field-input" />
              </div>
            </div>

            <!-- On finish message -->
            <div class="field-group">
              <label class="field-label">{{ t('countdown.field.msg_end') }} <span class="field-hint">{{ t('countdown.field.resp_hint') }}</span></label>
              <div
                ref="endEditorRef"
                class="script-editor"
                contenteditable="true"
                spellcheck="false"
                data-placeholder="Zeit ist abgelaufen! PogChamp"
                @input="onEditorInput(endEditorRef, 'msg_end')"
              ></div>
            </div>

            <!-- Variable reference -->
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

            <!-- Conditions -->
            <div class="row-2">
              <div class="field-group">
                <label class="field-label">{{ t('countdown.field.active_when') }}</label>
                <select v-model="editCountdown.enabled_when" class="field-select">
                  <option value="always">{{ t('countdown.when.always') }}</option>
                  <option value="online">{{ t('countdown.when.online') }}</option>
                  <option value="offline">{{ t('countdown.when.offline') }}</option>
                </select>
              </div>
              <div class="field-group">
                <label class="field-label">{{ t('countdown.field.condition') }} <span class="field-hint">{{ t('countdown.field.cond_hint') }}</span></label>
                <input v-model="editCountdown.condition" class="field-input mono" placeholder="$channel.viewers > 10" />
              </div>
            </div>

            <div class="panel-footer">
              <button v-if="!isNew && canDelete" class="btn-delete" @click="deleteCountdown(editCountdown.name); editOpen = false">{{ t('countdown.delete') }}</button>
              <div v-else></div>
              <div class="footer-right">
                <button class="btn-cancel" @click="editOpen = false">{{ t('countdown.cancel') }}</button>
                <button class="btn-save" @click="saveCountdown" :disabled="!!saving || !editCountdown.name">
                  {{ saving ? t('countdown.saving') : t('countdown.save') }}
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
.btn-new-disabled { opacity: .35; cursor: not-allowed; }
.btn-action-disabled { opacity: .35; cursor: not-allowed; }

.toast { padding: 8px 14px; font-size: 12px; margin-bottom: 4px; }
.toast.success { background: rgba(35,209,139,.1); border: 1px solid rgba(35,209,139,.3); color: #23d18b; }
.toast.error   { background: rgba(241,73,73,.1);  border: 1px solid rgba(241,73,73,.3);  color: #f14949; }
.empty { color: #444; font-size: 13px; padding: 40px; text-align: center; }

/* >>> Countdown list <<< */
.countdown-list { display: flex; flex-direction: column; gap: 2px; overflow-y: auto; flex: 1; }
.countdown-row  {
  display: flex; align-items: center; gap: 12px;
  padding: 10px 14px; background: #141418; border-bottom: 1px solid #1e1e1e;
  transition: background .1s;
}
.countdown-row:hover { background: #1c1c20; }
.countdown-row.inactive { opacity: .45; }

/* Status dot */
.cd-status-dot {
  width: 8px; height: 8px; border-radius: 50%; flex-shrink: 0;
  background: #333; transition: background .3s;
}
.cd-status-dot.running  { background: #23d18b; box-shadow: 0 0 6px #23d18b88; animation: pulse-dot 1.2s ease-in-out infinite; }
.cd-status-dot.finished { background: #f14949; }
.cd-status-dot.idle     { background: #444; }
@keyframes pulse-dot { 0%,100%{opacity:1} 50%{opacity:.4} }

.cd-info     { flex: 1; cursor: pointer; min-width: 0; }
.cd-name     { font-size: 13px; font-weight: 600; color: #e0e0e0; margin-bottom: 4px; }
.cd-meta     { display: flex; gap: 6px; flex-wrap: wrap; margin-bottom: 4px; }
.cd-remaining { font-size: 11px; font-family: 'Consolas','Fira Mono',monospace; color: #555; }
.cd-remaining.finished { color: #f14949; }
.cd-remaining.idle     { color: #444; }

.meta-pill    { font-size: 10px; padding: 1px 6px; border: 1px solid; }
.meta-pill.dur  { color: #9d6cff; border-color: #9d6cff44; background: #9d6cff11; }
.meta-pill.tick { color: #4ec9b0; border-color: #4ec9b044; background: #4ec9b011; }
.meta-pill.when { color: #e5c07b; border-color: #e5c07b44; background: #e5c07b11; }
.meta-pill.cond { color: #c792ea; border-color: #c792ea44; background: #c792ea11; }

/* Controls */
.cd-controls { display: flex; gap: 5px; flex-shrink: 0; }
.ctrl-btn {
  height: 28px; padding: 0 10px; border: 1px solid #2a2a30;
  background: transparent; color: #666; font-family: inherit; font-size: 11px;
  cursor: pointer; transition: all .15s;
}
.ctrl-btn.start       { border-color: #23d18b44; color: #23d18b; }
.ctrl-btn.start:hover { background: rgba(35,209,139,.1); }
.ctrl-btn.start.active       { border-color: #f1494944; color: #f14949; background: rgba(241,73,73,.08); }
.ctrl-btn.start.active:hover { background: rgba(241,73,73,.18); }
.ctrl-btn.reset       { border-color: #e5c07b33; color: #888; }
.ctrl-btn.reset:hover { border-color: #e5c07b66; color: #e5c07b; background: rgba(229,192,123,.08); }

.row-actions { display: flex; gap: 6px; flex-shrink: 0; }
.btn-action { height: 30px; padding: 0 10px; border: 1px solid; background: transparent; font-family: inherit; font-size: 11px; cursor: pointer; transition: background .15s; white-space: nowrap; }
.btn-action.edit { border-color: #6f2bff66; color: #9d6cff; }
.btn-action.edit:hover { background: #6f2bff22; }
.btn-action.del { border-color: #f1494944; color: #f14949; }
.btn-action.del:hover { background: #f1494911; }
.btn-action:disabled { opacity: .4; cursor: not-allowed; }

/* >>> Panel <<< */
.panel-overlay { position: fixed; inset: 0; background: rgba(0,0,0,.65); display: flex; align-items: flex-start; justify-content: flex-end; z-index: 1000; }
.panel { width: 580px; max-width: 100vw; height: 100vh; background: #1a1a1e; border-left: 1px solid #2a2a30; display: flex; flex-direction: column; overflow: hidden; animation: slideIn .2s ease; }
@keyframes slideIn { from { transform: translateX(40px); opacity: 0 } to { transform: none; opacity: 1 } }
.panel-header { display: flex; align-items: flex-start; justify-content: space-between; padding: 20px 24px 16px; border-bottom: 1px solid #222; flex-shrink: 0; }
.panel-title  { font-size: 16px; font-weight: 700; color: #e0e0e0; }
.panel-sub    { font-size: 11px; color: #555; margin-top: 3px; }
.panel-close  { width: 28px; height: 28px; border: none; background: transparent; color: #555; font-size: 14px; cursor: pointer; }
.panel-close:hover { color: #e0e0e0; }
.panel-body   { flex: 1; overflow-y: auto; padding: 20px 24px; display: flex; flex-direction: column; gap: 14px; scrollbar-width: none; }
.panel-body::-webkit-scrollbar { display: none; }

.field-group  { display: flex; flex-direction: column; gap: 5px; }
.field-group.sm { width: 120px; flex-shrink: 0; }
.field-label  { font-size: 11px; font-weight: 600; color: #888; text-transform: uppercase; letter-spacing: .05em; display: flex; align-items: center; gap: 6px; }
.field-hint   { font-size: 10px; color: #555; font-weight: 400; text-transform: none; letter-spacing: 0; }
.field-input, .field-select { background: #111217; border: 1px solid #2a2a30; color: #e0e0e0; font-family: inherit; font-size: 13px; padding: 7px 10px; outline: none; transition: border-color .15s; }
.field-input:focus, .field-select:focus { border-color: #6f2bff55; }
.field-input.mono { font-family: 'Consolas','Fira Mono',monospace; }
.field-select { appearance: none; cursor: pointer; }
.dur-row { display: flex; align-items: center; gap: 8px; }
.dur-row .field-input { flex: 1; }
.row-2 { display: flex; gap: 12px; }
.row-2 > * { flex: 1; min-width: 0; }

.script-editor {
  min-height: 60px; max-height: 140px; overflow-y: auto;
  background: #0d0d10; border: 1px solid #2a2a30;
  padding: 8px 10px; font-family: 'Consolas','Fira Mono',monospace;
  font-size: 13px; line-height: 1.7; color: #c0c0c0;
  outline: none; white-space: pre-wrap; word-break: break-word;
}
.script-editor:focus { border-color: #6f2bff55; }
.script-editor:empty::before { content: attr(data-placeholder); color: #2a2a35; pointer-events: none; }

.ref-panel { border: 1px solid #1e1e22; }
.ref-summary { padding: 5px 10px; font-size: 10px; font-weight: 600; color: #555; text-transform: uppercase; letter-spacing: .05em; cursor: pointer; user-select: none; list-style: none; }
.ref-summary:hover { color: #888; }
.ref-content { max-height: 200px; overflow-y: auto; padding: 6px 10px; display: flex; flex-direction: column; gap: 8px; scrollbar-width: none; }
.ref-content::-webkit-scrollbar { display: none; }
.ref-group-label { font-size: 9px; font-weight: 700; text-transform: uppercase; letter-spacing: .06em; color: #9d6cff; margin-bottom: 2px; }
.ref-row { display: flex; align-items: baseline; gap: 8px; padding: 1px 0; }
.ref-token { font-family: 'Consolas','Fira Mono',monospace; font-size: 11px; color: #4ec9b0; background: rgba(78,201,176,.08); padding: 1px 5px; white-space: nowrap; flex-shrink: 0; }
.ref-desc { font-size: 10px; color: #484848; }

.panel-footer { display: flex; align-items: center; justify-content: space-between; padding-top: 16px; border-top: 1px solid #222; margin-top: 4px; }
.footer-right { display: flex; gap: 8px; }
.btn-save   { height: 34px; padding: 0 20px; border: none; background: #6f2bff; color: #fff; font-family: inherit; font-size: 12px; font-weight: 600; cursor: pointer; }
.btn-save:hover:not(:disabled) { background: #7f3fff; }
.btn-save:disabled { opacity: .4; cursor: not-allowed; }
.btn-cancel { height: 34px; padding: 0 16px; border: 1px solid #333; background: transparent; color: #888; font-family: inherit; font-size: 12px; cursor: pointer; }
.btn-cancel:hover { border-color: #555; color: #e0e0e0; }
.btn-delete { height: 34px; padding: 0 14px; border: 1px solid #f1494944; background: transparent; color: #f14949; font-family: inherit; font-size: 12px; cursor: pointer; }
.btn-delete:hover { background: #f1494911; }

@media (max-width: 680px) {
  .panel { width: 100vw !important; }
  .row-2 { flex-direction: column; gap: 8px; }
  .countdown-row { flex-wrap: wrap; gap: 8px; }
  .cd-controls { gap: 4px; }
}
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
