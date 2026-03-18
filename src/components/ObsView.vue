<script setup lang="ts">
import { ref, computed, onMounted, watch } from 'vue'
import { API } from '../api'
import { useAuth } from '../auth'

const { session, channelRole } = useAuth()

const canEdit = computed(() => channelRole.value?.role === 'broadcaster' || channelRole.value?.permissions?.automations_edit)

interface Widget {
  id: string; name: string; content: string
  style: string; refresh_ms: number; created_at: number
}

const widgets = ref<Widget[]>([])
const loading = ref(false)
const saving = ref(false)
const deleteId = ref<string | null>(null)
const copied = ref('')
const saveError = ref('')
const saveSuccess = ref('')

const editOpen = ref(false)
const isNew = ref(false)
const editOrigName = ref('')
const form = ref({
  name: '', content: '', refresh_ms: 5000,
  style: {
    fontSize: 48, color: '#ffffff', fontFamily: 'sans-serif',
    fontWeight: 'bold', textAlign: 'left',
    stroke: false, strokeColor: '#000000',
    shadow: false, shadowColor: 'rgba(0,0,0,0.8)',
    padding: 8, background: '',
  }
})

const previewValue = ref('…')
const previewing = ref(false)

// >>> Live variable references
interface VarRef { label: string; expr: string }
const varRefs = ref<VarRef[]>([])
const varRefsLoaded = ref(false)

async function loadVarRefs() {
  if (!session.value || varRefsLoaded.value) return
  varRefsLoaded.value = true
  try {
    const res = await fetch(`${API}/variables/${session.value.channel}`, {
      headers: { Authorization: `Bearer ${session.value.token}` }
    })
    if (!res.ok) return
    const d = await res.json() as { counters: { name: string }[]; vars: { name: string }[] }
    varRefs.value = [
      ...d.counters.map(c => ({ label: `counter.${c.name}`, expr: `$counter.${c.name}.get` })),
      ...d.vars.map(v => ({ label: `var.${v.name}`, expr: `$var.${v.name}` })),
    ]
  } catch { }
}

const widgetUrl = (id: string) => `https://obs.shyboti.de/${id}`

async function load() {
  if (!session.value) return
  loading.value = true
  try {
    const res = await fetch(`${API}/obs-widgets/${session.value.channel}`, {
      headers: { Authorization: `Bearer ${session.value.token}` }
    })
    if (res.ok) widgets.value = (await res.json() as { widgets: Widget[] }).widgets
  } catch { }
  loading.value = false
}

function openNew() {
  isNew.value = true; editOrigName.value = ''
  form.value = {
    name: '', content: '', refresh_ms: 5000,
    style: { fontSize: 48, color: '#ffffff', fontFamily: 'sans-serif', fontWeight: 'bold', textAlign: 'left', stroke: false, strokeColor: '#000000', shadow: false, shadowColor: 'rgba(0,0,0,0.8)', padding: 8, background: '' }
  }
  previewValue.value = '…'; saveError.value = ''
  editOpen.value = true
  loadVarRefs()
}

function openEdit(w: Widget) {
  isNew.value = false; editOrigName.value = w.name
  const s = (() => { try { return JSON.parse(w.style) } catch { return {} } })()
  form.value = {
    name: w.name, content: w.content, refresh_ms: w.refresh_ms,
    style: { fontSize: s.fontSize ?? 48, color: s.color ?? '#ffffff', fontFamily: s.fontFamily ?? 'sans-serif', fontWeight: s.fontWeight ?? 'bold', textAlign: s.textAlign ?? 'left', stroke: s.stroke ?? false, strokeColor: s.strokeColor ?? '#000000', shadow: s.shadow ?? false, shadowColor: s.shadowColor ?? 'rgba(0,0,0,0.8)', padding: s.padding ?? 8, background: s.background ?? '' }
  }
  previewValue.value = '…'; saveError.value = ''
  editOpen.value = true
  loadVarRefs()
}

async function previewContent() {
  if (!session.value || !form.value.content.trim()) return
  previewing.value = true
  try {
    const res = await fetch(`${API}/obs-widgets/${session.value.channel}/___preview`, {
      method: 'PUT',
      headers: { Authorization: `Bearer ${session.value.token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ content: form.value.content, style: form.value.style, refresh_ms: 9999999 })
    })
    if (res.ok) {
      const d = await res.json() as { id: string }
      const r2 = await fetch(`${API}/obs/${d.id}/data`)
      if (r2.ok) previewValue.value = (await r2.json() as { value: string }).value || '(empty)'
    }
  } catch { }
  previewing.value = false
}

async function save() {
  if (!session.value || !form.value.name.trim()) return
  saving.value = true; saveError.value = ''
  try {
    const res = await fetch(`${API}/obs-widgets/${session.value.channel}/${encodeURIComponent(form.value.name.trim())}`, {
      method: 'PUT',
      headers: { Authorization: `Bearer ${session.value.token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ content: form.value.content, style: form.value.style, refresh_ms: form.value.refresh_ms })
    })
    if (!res.ok) { const d = await res.json() as any; throw new Error(d.error ?? 'Save failed') }
    saveSuccess.value = 'Saved!'; setTimeout(() => saveSuccess.value = '', 2000)
    editOpen.value = false; load()
  } catch (e: any) { saveError.value = e.message ?? 'Failed' }
  saving.value = false
}

async function deleteWidget(id: string, name: string) {
  if (deleteId.value !== id) {
    deleteId.value = id; setTimeout(() => { if (deleteId.value === id) deleteId.value = null }, 3000); return
  }
  deleteId.value = null
  if (!session.value) return
  await fetch(`${API}/obs-widgets/${session.value.channel}/${encodeURIComponent(name)}`, {
    method: 'DELETE', headers: { Authorization: `Bearer ${session.value.token}` }
  })
  widgets.value = widgets.value.filter(w => w.id !== id)
}

function copyUrl(id: string, key: string) {
  navigator.clipboard.writeText(widgetUrl(id)).catch(() => { })
  copied.value = key; setTimeout(() => { if (copied.value === key) copied.value = '' }, 1500)
}

function fmtDate(ts: number) {
  return new Date(ts).toLocaleDateString([], { day: '2-digit', month: 'short', year: 'numeric' })
}

const previewStyle = computed(() => {
  const s = form.value.style
  const shadows: string[] = []
  if (s.stroke) { const c = s.strokeColor; shadows.push(`-2px -2px 0 ${c}`, `2px -2px 0 ${c}`, `-2px 2px 0 ${c}`, `2px 2px 0 ${c}`) }
  return { fontFamily: s.fontFamily, fontSize: `${s.fontSize}px`, color: s.color, fontWeight: s.fontWeight, textAlign: s.textAlign as any, textShadow: shadows.join(', ') || undefined, filter: s.shadow ? `drop-shadow(2px 2px 4px ${s.shadowColor})` : undefined, padding: `${s.padding}px`, background: s.background || 'transparent' }
})

const FONT_FAMILIES = [
  { label: 'Sans-serif', value: 'sans-serif' },
  { label: 'Monospace', value: 'monospace' },
  { label: 'Serif', value: 'serif' },
  { label: 'Impact', value: 'Impact, fantasy' },
  { label: 'Arial', value: 'Arial, sans-serif' },
  { label: 'Courier', value: '"Courier New", monospace' },
]

// >>> Variable reference groups for OBS (subset relevant to OBS widgets)
const OBS_REF_GROUPS = [
  {
    label: 'Counters', items: [
      { token: '$counter.<em>name</em>.get', desc: 'Read counter value' },
      { token: '$counter.<em>name</em>', desc: 'Increment +1, return value' },
      { token: '$ucounter.<em>name</em>', desc: 'Per-user counter' },
    ]
  },
  {
    label: 'Variables', items: [
      { token: '$var.<em>name</em>', desc: 'Read variable' },
      { token: '$uvar.<em>name</em>', desc: 'Per-user variable' },
    ]
  },
  {
    label: 'Channel', items: [
      { token: '$channel.viewers', desc: 'Current viewer count' },
      { token: '$channel.title', desc: 'Stream title' },
      { token: '$channel.game', desc: 'Current game' },
      { token: '$channel.uptime', desc: 'Stream uptime' },
      { token: '$channel.isLive', desc: 'true / false' },
    ]
  },
  {
    label: 'Text & Math', items: [
      { token: '$calc(<em>expr</em>)', desc: 'Math expression' },
      { token: '$text.upper(<em>text</em>)', desc: 'Uppercase' },
      { token: '$text.lower(<em>text</em>)', desc: 'Lowercase' },
    ]
  },
  {
    label: 'Time', items: [
      { token: '$time.now', desc: 'Current ISO timestamp' },
      { token: '$time.unix', desc: 'Unix seconds' },
      { token: '$time.format(<em>ts</em>,<em>fmt</em>)', desc: 'Format timestamp' },
    ]
  },
  {
    label: 'HTTP', items: [
      { token: '$http.get(<em>url</em>)', desc: 'GET request, returns text' },
      { token: '$http.json(<em>url</em>,<em>path</em>)', desc: 'GET + extract JSON path' },
    ]
  },
]

onMounted(load)
watch(() => session.value?.channel, () => { load(); varRefsLoaded.value = false })
</script>

<template>
  <div class="obs-view">
    <div class="obs-header">
      <div>
        <div class="obs-title">OBS Browser Sources</div>
        <div class="obs-sub">Live widgets for #{{ session?.channel }}</div>
      </div>
      <button class="btn-new" @click="openNew" :disabled="!canEdit">+ New widget</button>
    </div>

    <div v-if="saveSuccess" class="toast ok">{{ saveSuccess }}</div>

    <div v-if="loading" class="empty">Loading…</div>
    <div v-else-if="!widgets.length" class="empty">
      No widgets yet.<br>
      <span class="empty-hint">Create one to get a URL you can paste into OBS as a Browser Source.</span>
    </div>

    <div v-else class="widget-list">
      <div v-for="w in widgets" :key="w.id" class="widget-row">
        <div class="widget-icon">
          <svg viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg">
            <rect x="1" y="3" width="18" height="12" rx="2" stroke="currentColor" stroke-width="1.5" />
            <path d="M7 18h6M10 15v3" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" />
          </svg>
        </div>
        <div class="widget-info" @click="canEdit && openEdit(w)">
          <div class="widget-name">{{ w.name }}</div>
          <code class="widget-content">{{ w.content.slice(0, 60) }}{{ w.content.length > 60 ? '…' : '' }}</code>
          <div class="widget-meta">↻ every {{ w.refresh_ms / 1000 }}s · {{ fmtDate(w.created_at) }}</div>
        </div>
        <div class="widget-actions">
          <div class="url-row">
            <code class="widget-url">obs.shyboti.de/{{ w.id }}</code>
            <button class="copy-btn" @click="copyUrl(w.id, w.id)">{{ copied === w.id ? '✓' : 'Copy URL' }}</button>
          </div>
          <div class="row-btns">
            <button class="btn-action edit" @click="canEdit && openEdit(w)">Edit</button>
            <button class="btn-action del" :class="{ confirm: deleteId === w.id }"
              @click="deleteWidget(w.id, w.name)">{{ deleteId === w.id ? 'Sure?' : '✕' }}</button>
          </div>
        </div>
      </div>
    </div>

    <!-- Edit panel -->
    <Teleport to="body">
      <div v-if="editOpen" class="panel-overlay" @click.self="editOpen = false">
        <div class="panel">

          <div class="panel-header">
            <div>
              <div class="panel-title">{{ isNew ? 'New widget' : `Edit · ${editOrigName}` }}</div>
              <div class="panel-sub">#{{ session?.channel }}</div>
            </div>
            <button class="panel-close" @click="editOpen = false">✕</button>
          </div>

          <div class="panel-body">

            <!-- Name -->
            <div class="field-group">
              <label class="field-label">Name <span class="field-hint">internal label</span></label>
              <input v-model="form.name" class="field-input" placeholder="kills-counter" :disabled="!isNew" />
            </div>

            <!-- Content -->
            <div class="field-group">
              <label class="field-label">Content <span class="field-hint">script expression or plain text</span></label>
              <input v-model="form.content" class="field-input mono" placeholder="$counter.kills.get" />
            </div>

            <!-- Variable Reference -->
            <details class="ref-panel">
              <summary class="ref-summary">Variable reference</summary>
              <div class="ref-content">
                <!-- Live var refs from channel -->
                <div v-if="varRefs.length" class="ref-group">
                  <div class="ref-group-label">Your Counters &amp; Vars</div>
                  <div v-for="v in varRefs" :key="v.expr" class="ref-row has-example" @click="form.content = v.expr"
                    style="cursor:pointer">
                    <code class="ref-token">{{ v.label }}</code>
                    <span class="ref-desc">click to use</span>
                    <span class="ref-example">{{ v.expr }}</span>
                  </div>
                </div>
                <!-- Static reference -->
                <div v-for="g in OBS_REF_GROUPS" :key="g.label" class="ref-group">
                  <div class="ref-group-label">{{ g.label }}</div>
                  <div v-for="r in g.items" :key="r.token" class="ref-row has-example"
                    @click="form.content = r.token.replace(/<[^>]+>/g, '')" style="cursor:pointer">
                    <code class="ref-token"
                      v-html="r.token.replace(/<em>/g, '<span class=\'ref-token-name\'>').replace(/<\/em>/g, '</span>')"></code>
                    <span class="ref-desc">{{ r.desc }}</span>
                  </div>
                </div>
              </div>
            </details>

            <!-- Preview -->
            <div class="preview-section">
              <div class="preview-bar">
                <span class="field-label">Preview</span>
                <button class="preview-btn" @click="previewContent" :disabled="previewing || !form.content.trim()">
                  {{ previewing ? 'Evaluating…' : '▶ Run' }}
                </button>
              </div>
              <div class="preview-box" :style="{ background: form.style.background || '#111217' }">
                <div class="preview-val" :style="previewStyle">{{ previewValue }}</div>
              </div>
            </div>

            <!-- Refresh -->
            <div class="field-group">
              <label class="field-label">Refresh every</label>
              <div class="refresh-row">
                <button v-for="ms in [1000, 2000, 5000, 10000, 30000]" :key="ms" class="ms-btn"
                  :class="{ active: form.refresh_ms === ms }" @click="form.refresh_ms = ms">{{ ms >= 1000 ?
                    `${ms / 1000}s` : `${ms}ms` }}</button>
                <input v-model.number="form.refresh_ms" type="number" min="500" class="field-input ms-custom" />
              </div>
            </div>

            <div class="obs-cache-hint">
              After changing style, right-click Browser Source in OBS → <strong>Properties</strong> → <strong>Refresh
                cache of current page</strong>
            </div>

            <!-- Style -->
            <div class="style-section">
              <div class="style-title">Style</div>
              <div class="style-grid">
                <div class="field-group">
                  <label class="field-label">Size (px)</label>
                  <input v-model.number="form.style.fontSize" type="number" min="8" max="200" class="field-input" />
                </div>
                <div class="field-group">
                  <label class="field-label">Color</label>
                  <div class="color-row">
                    <input type="color" v-model="form.style.color" class="color-pick" />
                    <input v-model="form.style.color" class="field-input" placeholder="#ffffff" />
                  </div>
                </div>
                <div class="field-group">
                  <label class="field-label">Font</label>
                  <select v-model="form.style.fontFamily" class="field-select">
                    <option v-for="f in FONT_FAMILIES" :key="f.value" :value="f.value">{{ f.label }}</option>
                  </select>
                </div>
                <div class="field-group">
                  <label class="field-label">Weight</label>
                  <select v-model="form.style.fontWeight" class="field-select">
                    <option value="normal">Normal</option>
                    <option value="bold">Bold</option>
                    <option value="900">Black</option>
                  </select>
                </div>
                <div class="field-group">
                  <label class="field-label">Align</label>
                  <select v-model="form.style.textAlign" class="field-select">
                    <option value="left">Left</option>
                    <option value="center">Center</option>
                    <option value="right">Right</option>
                  </select>
                </div>
                <div class="field-group">
                  <label class="field-label">Padding (px)</label>
                  <input v-model.number="form.style.padding" type="number" min="0" class="field-input" />
                </div>
              </div>
              <div class="toggle-row">
                <label class="toggle-label"><input type="checkbox" v-model="form.style.stroke" /> Text stroke</label>
                <input v-if="form.style.stroke" type="color" v-model="form.style.strokeColor" class="color-pick" />
              </div>
              <div class="toggle-row">
                <label class="toggle-label"><input type="checkbox" v-model="form.style.shadow" /> Drop shadow</label>
              </div>
              <div class="field-group">
                <label class="field-label">Background <span class="field-hint">empty = transparent</span></label>
                <div class="color-row">
                  <input type="color" v-model="form.style.background" class="color-pick" />
                  <input v-model="form.style.background" class="field-input" placeholder="transparent" />
                  <button class="clear-btn" @click="form.style.background = ''">Clear</button>
                </div>
              </div>
            </div>

          </div>

          <!-- Footer pinned outside scroll -->
          <div class="panel-footer">
            <div v-if="saveError" class="save-error">{{ saveError }}</div>
            <div v-else></div>
            <div class="footer-right">
              <button class="btn-cancel" @click="editOpen = false">Cancel</button>
              <button class="btn-save" @click="save" :disabled="saving || !form.name.trim() || !form.content.trim()">
                {{ saving ? 'Saving…' : 'Save' }}
              </button>
            </div>
          </div>

        </div>
      </div>
    </Teleport>
  </div>
</template>

<style scoped>
.obs-view {
  display: flex;
  flex-direction: column;
  gap: 16px;
  height: 100%;
}

.obs-header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
}

.obs-title {
  font-size: 18px;
  font-weight: 700;
  color: #e0e0e0;
  margin-bottom: 4px;
}

.obs-sub {
  font-size: 12px;
  color: #555;
}

.btn-new {
  height: 32px;
  padding: 0 14px;
  border: 1px solid #6f2bff66;
  background: #6f2bff15;
  color: #9d6cff;
  font-family: inherit;
  font-size: 12px;
  cursor: pointer;
}

.btn-new:hover {
  background: #6f2bff30;
}

.btn-new:disabled {
  opacity: .35;
  cursor: not-allowed;
}

.toast.ok {
  padding: 8px 14px;
  font-size: 12px;
  background: rgba(35, 209, 139, .1);
  border: 1px solid rgba(35, 209, 139, .3);
  color: #23d18b;
}

.empty {
  color: #444;
  font-size: 13px;
  padding: 40px;
  text-align: center;
  line-height: 1.8;
}

.empty-hint {
  color: #333;
  font-size: 11px;
}

.widget-list {
  display: flex;
  flex-direction: column;
  gap: 2px;
  overflow-y: auto;
  flex: 1;
}

.widget-row {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 12px 14px;
  background: #141418;
  border-bottom: 1px solid #1e1e1e;
  transition: background .1s;
}

.widget-row:hover {
  background: #1c1c20;
}

.widget-icon {
  width: 28px;
  flex-shrink: 0;
  color: #9d6cff;
  opacity: .7;
}

.widget-icon svg {
  width: 22px;
  height: 22px;
}

.widget-info {
  flex: 1;
  cursor: pointer;
  min-width: 0;
}

.widget-name {
  font-size: 13px;
  font-weight: 600;
  color: #e0e0e0;
  margin-bottom: 3px;
}

.widget-content {
  font-family: 'Consolas', 'Fira Mono', monospace;
  font-size: 11px;
  color: #9d6cff;
  display: block;
  margin-bottom: 3px;
}

.widget-meta {
  font-size: 10px;
  color: #444;
}

.widget-actions {
  display: flex;
  flex-direction: column;
  gap: 6px;
  align-items: flex-end;
  flex-shrink: 0;
}

.url-row {
  display: flex;
  align-items: center;
  gap: 6px;
}

.widget-url {
  font-family: 'Consolas', 'Fira Mono', monospace;
  font-size: 10px;
  color: #555;
}

.copy-btn {
  height: 22px;
  padding: 0 10px;
  border: 1px solid #6f2bff44;
  background: transparent;
  color: #9d6cff;
  font-family: inherit;
  font-size: 10px;
  cursor: pointer;
  white-space: nowrap;
}

.copy-btn:hover {
  background: #6f2bff18;
}

.row-btns {
  display: flex;
  gap: 5px;
}

.btn-action {
  height: 26px;
  padding: 0 10px;
  border: 1px solid;
  background: transparent;
  font-family: inherit;
  font-size: 10px;
  cursor: pointer;
}

.btn-action.edit {
  border-color: #6f2bff66;
  color: #9d6cff;
}

.btn-action.edit:hover {
  background: #6f2bff18;
}

.btn-action.del {
  border-color: #f1494944;
  color: #f14949;
}

.btn-action.del:hover {
  background: rgba(241, 73, 73, .1);
}

.btn-action.del.confirm {
  background: rgba(241, 73, 73, .15);
  border-color: #f14949;
}

/* Panel */
.panel-overlay {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, .65);
  display: flex;
  align-items: flex-start;
  justify-content: flex-end;
  z-index: 1000;
}

.panel {
  width: 560px;
  max-width: 100vw;
  height: 100vh;
  background: #1a1a1e;
  border-left: 1px solid #2a2a30;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  animation: slideIn .2s ease;
}

@keyframes slideIn {
  from {
    transform: translateX(40px);
    opacity: 0
  }

  to {
    transform: none;
    opacity: 1
  }
}

.panel-header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  padding: 20px 24px 16px;
  border-bottom: 1px solid #222;
  flex-shrink: 0;
}

.panel-title {
  font-size: 16px;
  font-weight: 700;
  color: #e0e0e0;
}

.panel-sub {
  font-size: 11px;
  color: #555;
  margin-top: 3px;
}

.panel-close {
  width: 28px;
  height: 28px;
  border: none;
  background: transparent;
  color: #555;
  font-size: 14px;
  cursor: pointer;
}

.panel-close:hover {
  color: #e0e0e0;
}

.panel-body {
  flex: 1;
  overflow-y: scroll;
  padding: 20px 24px;
  display: flex;
  flex-direction: column;
  gap: 14px;
  scrollbar-width: none;
}

.panel-body::-webkit-scrollbar {
  display: none;
}

.panel-footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 12px 24px;
  border-top: 1px solid #222;
  flex-shrink: 0;
  background: #1a1a1e;
}

.footer-right {
  display: flex;
  gap: 8px;
}

.btn-save {
  height: 34px;
  padding: 0 20px;
  border: none;
  background: #6f2bff;
  color: #fff;
  font-family: inherit;
  font-size: 12px;
  font-weight: 600;
  cursor: pointer;
}

.btn-save:hover:not(:disabled) {
  background: #7f3fff;
}

.btn-save:disabled {
  opacity: .4;
  cursor: not-allowed;
}

.btn-cancel {
  height: 34px;
  padding: 0 16px;
  border: 1px solid #333;
  background: transparent;
  color: #888;
  font-family: inherit;
  font-size: 12px;
  cursor: pointer;
}

.btn-cancel:hover {
  border-color: #555;
  color: #e0e0e0;
}

.save-error {
  font-size: 11px;
  color: #f14949;
}

/* Fields */
.field-group {
  display: flex;
  flex-direction: column;
  gap: 5px;
}

.field-label {
  font-size: 11px;
  font-weight: 600;
  color: #888;
  text-transform: uppercase;
  letter-spacing: .05em;
  display: flex;
  align-items: center;
  gap: 6px;
}

.field-hint {
  font-size: 10px;
  color: #555;
  font-weight: 400;
  text-transform: none;
  letter-spacing: 0;
}

.field-input {
  background: #111217;
  border: 1px solid #2a2a30;
  color: #e0e0e0;
  font-family: inherit;
  font-size: 13px;
  padding: 7px 10px;
  outline: none;
}

.field-input:focus {
  border-color: #6f2bff55;
}

.field-input.mono {
  font-family: 'Consolas', 'Fira Mono', monospace;
}

.field-select {
  background: #111217;
  border: 1px solid #2a2a30;
  color: #e0e0e0;
  font-family: inherit;
  font-size: 13px;
  padding: 7px 10px;
  outline: none;
  appearance: none;
  cursor: pointer;
  width: 100%;
}

/* Preview */
.preview-section {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.preview-bar {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.preview-btn {
  height: 24px;
  padding: 0 12px;
  border: 1px solid #6f2bff44;
  background: transparent;
  color: #9d6cff;
  font-family: inherit;
  font-size: 11px;
  cursor: pointer;
}

.preview-btn:hover:not(:disabled) {
  background: #6f2bff18;
}

.preview-btn:disabled {
  opacity: .4;
  cursor: not-allowed;
}

.preview-box {
  min-height: 52px;
  padding: 12px;
  display: flex;
  align-items: center;
  border: 1px solid #2a2a30;
}

.preview-val {
  max-width: 100%;
  word-break: break-word;
}

/* Refresh */
.refresh-row {
  display: flex;
  align-items: center;
  gap: 5px;
  flex-wrap: wrap;
}

.ms-btn {
  height: 30px;
  padding: 0 10px;
  border: 1px solid #2a2a30;
  background: transparent;
  color: #666;
  font-family: inherit;
  font-size: 11px;
  cursor: pointer;
}

.ms-btn:hover {
  border-color: #6f2bff44;
  color: #9d6cff;
}

.ms-btn.active {
  border-color: #6f2bff;
  color: #9d6cff;
  background: #6f2bff18;
}

.ms-custom {
  width: 70px;
  flex-shrink: 0;
}

/* Style section */
.style-section {
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 12px;
  background: #111217;
  border: 1px solid #1e1e24;
}

.style-title {
  font-size: 10px;
  font-weight: 700;
  color: #555;
  text-transform: uppercase;
  letter-spacing: .06em;
}

.style-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 10px;
}

.color-row {
  display: flex;
  align-items: center;
  gap: 6px;
}

.color-pick {
  width: 32px;
  height: 32px;
  border: 1px solid #2a2a30;
  padding: 2px;
  background: #111217;
  cursor: pointer;
  flex-shrink: 0;
}

.color-row .field-input {
  flex: 1;
}

.toggle-row {
  display: flex;
  align-items: center;
  gap: 8px;
}

.toggle-label {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 12px;
  color: #888;
  cursor: pointer;
  user-select: none;
}

.toggle-label input[type="checkbox"] {
  width: 14px;
  height: 14px;
  accent-color: #9d6cff;
  cursor: pointer;
}

.clear-btn {
  height: 32px;
  padding: 0 10px;
  border: 1px solid #2a2a30;
  background: transparent;
  color: #555;
  font-family: inherit;
  font-size: 11px;
  cursor: pointer;
  flex-shrink: 0;
}

.clear-btn:hover {
  color: #e0e0e0;
  border-color: #444;
}

.obs-cache-hint {
  font-size: 11px;
  color: #555;
  background: #111217;
  border: 1px solid #1e1e24;
  padding: 8px 12px;
  line-height: 1.6;
}

.obs-cache-hint strong {
  color: #888;
  font-weight: 600;
}

/* Reference panel - same style as CommandEditPanel */
.ref-panel {
  border: 1px solid #1e1e22;
}

.ref-summary {
  padding: 6px 10px;
  font-size: 10px;
  font-weight: 600;
  color: #555;
  text-transform: uppercase;
  letter-spacing: .05em;
  cursor: pointer;
  user-select: none;
  list-style: none;
}

.ref-summary:hover {
  color: #888;
}

.ref-content {
  max-height: 320px;
  overflow-y: scroll;
  padding: 8px 10px;
  display: flex;
  flex-direction: column;
  gap: 10px;
  scrollbar-width: none;
}

.ref-content::-webkit-scrollbar {
  display: none;
}

.ref-group-label {
  font-size: 9px;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: .06em;
  color: #9d6cff;
  margin-bottom: 3px;
}

.ref-row {
  display: flex;
  align-items: baseline;
  gap: 8px;
  padding: 1px 0;
  position: relative;
}

.ref-token {
  font-family: 'Consolas', 'Fira Mono', monospace;
  font-size: 11px;
  color: #4ec9b0;
  background: rgba(78, 201, 176, .08);
  padding: 1px 5px;
  white-space: nowrap;
  flex-shrink: 0;
}

.ref-desc {
  font-size: 10px;
  color: #484848;
  flex: 1;
}

.ref-example {
  display: none;
  position: absolute;
  right: 0;
  top: 50%;
  transform: translateY(-50%);
  font-family: 'Consolas', 'Fira Mono', monospace;
  font-size: 10px;
  color: #23d18b;
  background: #0d1a13;
  border: 1px solid rgba(35, 209, 139, .3);
  padding: 2px 7px;
  white-space: nowrap;
  pointer-events: none;
  z-index: 10;
}

.ref-row.has-example:hover .ref-example {
  display: block;
}

.ref-row.has-example:hover .ref-desc {
  opacity: 0.4;
}

.ref-group {
  display: flex;
  flex-direction: column;
  gap: 0;
}

@media (max-width: 680px) {
  .panel {
    width: 100vw;
  }

  .style-grid {
    grid-template-columns: 1fr;
  }

  .widget-row {
    flex-wrap: wrap;
  }

  .widget-actions {
    align-items: flex-start;
    width: 100%;
  }
}
</style>

<style>
/* ref-token-name must be global to work inside v-html */
.ref-token-name {
  color: #7cb8ea;
  font-style: italic;
}
</style>
