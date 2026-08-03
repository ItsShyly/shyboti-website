<script setup lang="ts">
// obs connection panel - lets a broadcaster point the bot at their own OBS
// websocket server, then control scenes, sources and audio straight from
// the dashboard. everything actually goes through the bot's own connection
// on the backend (lib/core/obsClient.ts) rather than connecting from the
// browser, since chat commands need a connection that's alive even when
// nobody has this page open.

import { ref, computed, onMounted, onUnmounted, watch } from 'vue'
import { API } from '../api'
import { useAuth } from '../auth'

const { session } = useAuth()

interface SceneRow   { sceneName: string; sceneIndex: number; active: boolean; screenshot: string | null }
interface SourceRow  { sceneItemId: number; sourceName: string; visible: boolean; isAudioSource: boolean; muted: boolean | null; volume: number | null }
interface SceneBind  { command: string; scene: string }
interface SourceBind { command: string; source: string; action: string; value?: number }

const SOURCE_ACTIONS = [
  { value: 'show',       label: 'show' },
  { value: 'hide',       label: 'hide' },
  { value: 'toggle',     label: 'toggle visibility' },
  { value: 'mute',       label: 'mute' },
  { value: 'unmute',     label: 'unmute' },
  { value: 'mutetoggle', label: 'toggle mute' },
  { value: 'volume',     label: 'set volume' },
]

// connection settings, loaded from and saved to the server
const wsHost      = ref('127.0.0.1')
const wsPort      = ref(4455)
const wsPassword  = ref('')
const hasPassword = ref(false)
const showPass    = ref(false)
const enabled     = ref(false)
const screenshots = ref(true)
const shotInterval = ref(5)

// live status, polled while the panel is open
const status        = ref<'disconnected' | 'connecting' | 'connected' | 'error'>('disconnected')
const statusError    = ref('')
const currentScene   = ref('')
const connectBusy    = ref(false)

const scenes         = ref<SceneRow[]>([])
const selectedScene  = ref('')
const sources        = ref<SourceRow[]>([])
const sourcesLoading = ref(false)

const sceneBindings  = ref<SceneBind[]>([])
const sourceBindings = ref<SourceBind[]>([])
const bindingsDirty   = ref(false)
const bindingsSaving  = ref(false)
const bindingsSaved   = ref(false)

const newSceneCmd    = ref('')
const newSceneTarget = ref('')
const newSourceCmd    = ref('')
const newSourceTarget = ref('')
const newSourceAction = ref('show')
const newSourceValue  = ref(50)

const saving  = ref(false)
const saved   = ref(false)
const loading = ref(false)

const editingVolume = ref<number | null>(null)
const volumeDraft    = ref(100)

let pollTimer: ReturnType<typeof setInterval> | null = null

const authHeaders = computed(() => session.value ? { Authorization: `Bearer ${session.value.token}` } : {})

// ---------------------------------------------------------------------------
// settings

async function loadSettings() {
  if (!session.value) return
  loading.value = true
  try {
    const res = await fetch(`${API}/obs/${session.value.channel}`, { headers: authHeaders.value })
    if (res.ok) {
      const d = await res.json() as any
      wsHost.value       = d.ws_host ?? '127.0.0.1'
      wsPort.value        = d.ws_port ?? 4455
      hasPassword.value   = !!d.has_password
      enabled.value        = !!d.enabled
      screenshots.value    = d.screenshots !== false
      shotInterval.value   = d.screenshot_interval_sec ?? 5
      status.value         = d.status ?? 'disconnected'
      statusError.value    = d.error ?? ''
      currentScene.value   = d.currentScene ?? ''
    }
  } catch {}
  loading.value = false
  if (status.value === 'connected') refreshScenes()
}

async function saveSettings() {
  if (!session.value) return
  saving.value = true
  try {
    await fetch(`${API}/obs/${session.value.channel}`, {
      method: 'PUT',
      headers: { ...authHeaders.value, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ws_host: wsHost.value,
        ws_port: wsPort.value,
        // only send a password when the person actually typed a new one, an
        // empty field on save just keeps whatever was already stored
        ws_password: wsPassword.value || undefined,
        enabled: enabled.value,
        screenshots: screenshots.value,
        screenshot_interval_sec: shotInterval.value,
      }),
    })
    wsPassword.value = ''
    saved.value = true
    setTimeout(() => { saved.value = false }, 2000)
    await refreshStatus()
  } catch {}
  saving.value = false
}

async function refreshStatus() {
  if (!session.value) return
  try {
    const res = await fetch(`${API}/obs/${session.value.channel}`, { headers: authHeaders.value })
    if (res.ok) {
      const d = await res.json() as any
      status.value       = d.status ?? 'disconnected'
      statusError.value  = d.error ?? ''
      currentScene.value = d.currentScene ?? ''
      hasPassword.value  = !!d.has_password
    }
  } catch {}
}

async function doConnect() {
  if (!session.value || connectBusy.value) return
  connectBusy.value = true
  try {
    const res = await fetch(`${API}/obs/${session.value.channel}/connect`, { method: 'POST', headers: authHeaders.value })
    const d = await res.json() as any
    status.value      = d.status ?? 'error'
    statusError.value = d.error ?? ''
    if (status.value === 'connected') await refreshScenes()
  } catch {}
  connectBusy.value = false
}

async function doDisconnect() {
  if (!session.value) return
  await fetch(`${API}/obs/${session.value.channel}/disconnect`, { method: 'POST', headers: authHeaders.value }).catch(() => {})
  status.value = 'disconnected'
  scenes.value = []
  sources.value = []
  selectedScene.value = ''
}

// ---------------------------------------------------------------------------
// scenes and sources

async function refreshScenes() {
  if (!session.value) return
  try {
    const res = await fetch(`${API}/obs/${session.value.channel}/scenes`, { headers: authHeaders.value })
    if (!res.ok) return
    const d = await res.json() as any
    scenes.value       = d.scenes ?? []
    currentScene.value = d.currentScene ?? currentScene.value
    status.value        = d.status ?? status.value
    if (!selectedScene.value && scenes.value[0]) selectedScene.value = scenes.value[0].sceneName
    if (selectedScene.value) loadSources(selectedScene.value)
  } catch {}
}

async function switchScene(name: string) {
  if (!session.value || status.value !== 'connected') return
  try {
    await fetch(`${API}/obs/${session.value.channel}/scene`, {
      method: 'POST',
      headers: { ...authHeaders.value, 'Content-Type': 'application/json' },
      body: JSON.stringify({ name }),
    })
    currentScene.value = name
  } catch {}
}

async function loadSources(sceneName: string) {
  if (!session.value) return
  selectedScene.value = sceneName
  sourcesLoading.value = true
  try {
    const res = await fetch(`${API}/obs/${session.value.channel}/sources?scene=${encodeURIComponent(sceneName)}`, { headers: authHeaders.value })
    if (res.ok) sources.value = (await res.json() as any).sources ?? []
  } catch {}
  sourcesLoading.value = false
}

async function toggleSourceVisible(src: SourceRow) {
  if (!session.value) return
  const next = !src.visible
  src.visible = next
  try {
    await fetch(`${API}/obs/${session.value.channel}/source/visibility`, {
      method: 'POST',
      headers: { ...authHeaders.value, 'Content-Type': 'application/json' },
      body: JSON.stringify({ scene: selectedScene.value, sceneItemId: src.sceneItemId, enabled: next }),
    })
  } catch { src.visible = !next }
}

async function toggleSourceMute(src: SourceRow) {
  if (!session.value || src.muted === null) return
  const next = !src.muted
  src.muted = next
  try {
    await fetch(`${API}/obs/${session.value.channel}/source/mute`, {
      method: 'POST',
      headers: { ...authHeaders.value, 'Content-Type': 'application/json' },
      body: JSON.stringify({ source: src.sourceName, muted: next }),
    })
  } catch { src.muted = !next }
}

function openVolumeEditor(src: SourceRow) {
  editingVolume.value = src.sceneItemId
  volumeDraft.value   = src.volume ?? 100
}

async function applyVolume(src: SourceRow) {
  if (!session.value) return
  try {
    await fetch(`${API}/obs/${session.value.channel}/source/volume`, {
      method: 'POST',
      headers: { ...authHeaders.value, 'Content-Type': 'application/json' },
      body: JSON.stringify({ source: src.sourceName, percent: volumeDraft.value }),
    })
    src.volume = volumeDraft.value
  } catch {}
  editingVolume.value = null
}

// ---------------------------------------------------------------------------
// command bindings

async function loadBindings() {
  if (!session.value) return
  try {
    const res = await fetch(`${API}/obs/${session.value.channel}/bindings`, { headers: authHeaders.value })
    if (res.ok) {
      const d = await res.json() as any
      sceneBindings.value  = d.scene_bindings ?? []
      sourceBindings.value = d.source_bindings ?? []
    }
  } catch {}
  bindingsDirty.value = false
}

async function saveBindings() {
  if (!session.value) return
  bindingsSaving.value = true
  try {
    await fetch(`${API}/obs/${session.value.channel}/bindings`, {
      method: 'PUT',
      headers: { ...authHeaders.value, 'Content-Type': 'application/json' },
      body: JSON.stringify({ scene_bindings: sceneBindings.value, source_bindings: sourceBindings.value }),
    })
    bindingsDirty.value = false
    bindingsSaved.value  = true
    setTimeout(() => { bindingsSaved.value = false }, 2000)
  } catch {}
  bindingsSaving.value = false
}

function addSceneBinding() {
  const cmd = newSceneCmd.value.trim().replace(/^\+/, '').toLowerCase()
  if (!cmd || !newSceneTarget.value) return
  if (sceneBindings.value.some(b => b.command === cmd)) return
  sceneBindings.value.push({ command: cmd, scene: newSceneTarget.value })
  newSceneCmd.value = ''
  newSceneTarget.value = ''
  bindingsDirty.value = true
}

function removeSceneBinding(i: number) {
  sceneBindings.value.splice(i, 1)
  bindingsDirty.value = true
}

function addSourceBinding() {
  const cmd = newSourceCmd.value.trim().replace(/^\+/, '').toLowerCase()
  if (!cmd || !newSourceTarget.value) return
  if (sourceBindings.value.some(b => b.command === cmd)) return
  const entry: SourceBind = { command: cmd, source: newSourceTarget.value, action: newSourceAction.value }
  if (newSourceAction.value === 'volume') entry.value = newSourceValue.value
  sourceBindings.value.push(entry)
  newSourceCmd.value = ''
  newSourceTarget.value = ''
  bindingsDirty.value = true
}

function removeSourceBinding(i: number) {
  sourceBindings.value.splice(i, 1)
  bindingsDirty.value = true
}

// every source name that has actually shown up while browsing scenes, used
// so the source-binding dropdown has something to pick from without the
// person having to type it exactly
const knownSources = ref<string[]>([])
watch(sources, list => {
  for (const s of list) if (!knownSources.value.includes(s.sourceName)) knownSources.value.push(s.sourceName)
})

// ---------------------------------------------------------------------------
// lifecycle - status gets polled while the panel is open so a scene change
// made from OBS itself (or from chat) shows up here without a manual refresh

onMounted(() => {
  loadSettings()
  loadBindings()
  pollTimer = setInterval(() => {
    refreshStatus()
    if (status.value === 'connected' && selectedScene.value) loadSources(selectedScene.value)
    if (status.value === 'connected') refreshScenes()
  }, 6000)
})
onUnmounted(() => { if (pollTimer) clearInterval(pollTimer) })
watch(() => session.value?.channel, () => { loadSettings(); loadBindings() })
</script>

<template>
  <div class="ep-panel">

    <div class="ep-panel-header">
      <div>
        <div class="ep-panel-title">OBS connection</div>
        <div class="ep-panel-sub">#{{ session?.channel }}</div>
      </div>
      <button class="ep-panel-close" @click="$emit('close')">x</button>
    </div>

    <div class="ep-panel-body">

      <!-- websocket settings -->
      <div class="ep-field-group">
        <label class="ep-field-label">
          Websocket server
          <span class="ep-field-hint">found in OBS under Tools, WebSocket Server Settings</span>
        </label>
        <div class="ep-row-2">
          <div class="ep-field-group ep-sm">
            <label class="ep-field-label">host</label>
            <input v-model="wsHost" class="ep-field-input ep-mono" placeholder="127.0.0.1" spellcheck="false" />
          </div>
          <div class="ep-field-group ep-sm">
            <label class="ep-field-label">port</label>
            <input v-model.number="wsPort" type="number" class="ep-field-input ep-mono" placeholder="4455" />
          </div>
        </div>
        <div class="ep-field-group">
          <label class="ep-field-label">password</label>
          <div class="obc-pw-row">
            <input
              v-model="wsPassword"
              class="ep-field-input ep-mono"
              :type="showPass ? 'text' : 'password'"
              :placeholder="hasPassword ? 'saved, leave blank to keep it' : 'leave blank if none'"
              autocomplete="new-password"
              spellcheck="false"
            />
            <button class="obc-eye" type="button" @click="showPass = !showPass" :title="showPass ? 'hide' : 'show'">
              <svg v-if="!showPass" viewBox="0 0 16 16" fill="none"><path d="M1 8s2.5-5 7-5 7 5 7 5-2.5 5-7 5-7-5-7-5z" stroke="currentColor" stroke-width="1.3"/><circle cx="8" cy="8" r="2.2" stroke="currentColor" stroke-width="1.3"/></svg>
              <svg v-else viewBox="0 0 16 16" fill="none"><path d="M2 2l12 12M6.5 6.6A2.2 2.2 0 0 0 9.4 9.5M4.2 4.3C2.7 5.4 1.5 7 1.5 7s2 4.5 6.5 4.5c1.1 0 2-.3 2.8-.7M6.8 3.6C7.3 3.5 7.9 3.5 8 3.5c4.5 0 6.5 4.5 6.5 4.5s-.5 1.1-1.4 2.1" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/></svg>
            </button>
          </div>
        </div>
      </div>

      <div class="obc-toggle-row">
        <button class="ep-toggle-btn" :class="{ on: enabled }" @click="enabled = !enabled; saveSettings()">
          <span class="ep-toggle-knob"></span>
        </button>
        <span class="obc-toggle-lbl">{{ enabled ? 'enabled' : 'disabled' }}</span>
        <span class="obc-toggle-sub">the bot only tries to reach OBS while this is on</span>
      </div>

      <div class="obc-connect-row">
        <button v-if="status !== 'connected'" class="ep-btn-new" :disabled="connectBusy" @click="doConnect">
          {{ connectBusy ? 'connecting' : 'connect' }}
        </button>
        <button v-else class="ep-btn-delete" @click="doDisconnect">disconnect</button>
        <button class="ep-btn-cancel" @click="saveSettings" :disabled="saving">{{ saved ? 'saved' : saving ? 'saving' : 'save' }}</button>
        <span class="obc-status" :class="status">{{ status }}</span>
        <span v-if="statusError" class="obc-status-err">{{ statusError }}</span>
      </div>

      <!-- screenshots -->
      <div class="obc-toggle-row">
        <button class="ep-toggle-btn" :class="{ on: screenshots }" @click="screenshots = !screenshots; saveSettings()">
          <span class="ep-toggle-knob"></span>
        </button>
        <span class="obc-toggle-lbl">scene previews</span>
        <span class="obc-toggle-sub">grabs a screenshot of each scene every few seconds</span>
      </div>
      <div v-if="screenshots" class="ep-field-group">
        <label class="ep-field-label">refresh every <span class="ep-field-hint">seconds</span></label>
        <input v-model.number="shotInterval" @change="saveSettings" type="number" min="2" class="ep-field-input" style="width: 90px" />
      </div>

      <!-- scenes -->
      <template v-if="status === 'connected'">
        <div class="ep-field-group">
          <label class="ep-field-label">scenes</label>
          <div class="obc-scenes">
            <div
              v-for="s in scenes"
              :key="s.sceneName"
              class="obc-scene-card"
              :class="{ active: s.sceneName === currentScene, picked: s.sceneName === selectedScene }"
              @click="switchScene(s.sceneName); loadSources(s.sceneName)"
            >
              <div class="obc-scene-thumb">
                <img v-if="s.screenshot" :src="s.screenshot" class="obc-thumb-img" />
                <div v-else class="obc-thumb-empty"></div>
              </div>
              <div class="obc-scene-name">{{ s.sceneName }}</div>
              <div v-if="s.sceneName === currentScene" class="obc-scene-live">live</div>
            </div>
            <div v-if="!scenes.length" class="ep-empty">no scenes found</div>
          </div>
        </div>

        <!-- sources -->
        <div class="ep-field-group" v-if="selectedScene">
          <label class="ep-field-label">sources <span class="ep-field-hint">{{ selectedScene }}</span></label>
          <div class="obc-source-list">
            <div v-for="src in sources" :key="src.sceneItemId" class="obc-source-row">
              <span class="obc-source-name">{{ src.sourceName }}</span>
              <button class="obc-vis-btn" :class="{ on: src.visible }" @click="toggleSourceVisible(src)">
                {{ src.visible ? 'visible' : 'hidden' }}
              </button>
              <template v-if="src.isAudioSource">
                <button class="obc-mute-btn" :class="{ muted: src.muted }" @click="toggleSourceMute(src)">
                  {{ src.muted ? 'muted' : 'unmuted' }}
                </button>
                <button class="obc-vol-btn" @click="openVolumeEditor(src)">{{ src.volume ?? 0 }}%</button>
              </template>
              <div v-if="editingVolume === src.sceneItemId" class="obc-vol-row">
                <input type="range" min="0" max="100" v-model.number="volumeDraft" class="obc-vol-slider" />
                <span class="obc-vol-val">{{ volumeDraft }}%</span>
                <button class="ep-btn-cancel" @click="applyVolume(src)">set</button>
              </div>
            </div>
            <div v-if="!sources.length && !sourcesLoading" class="ep-empty">no sources in this scene</div>
          </div>
        </div>
      </template>
      <div v-else class="ep-empty">connect to see scenes and sources here</div>

      <!-- scene command bindings -->
      <div class="ep-field-group">
        <label class="ep-field-label">scene commands <span class="ep-field-hint">a chat command that switches to a scene</span></label>
        <div class="obc-bind-list">
          <div v-for="(b, i) in sceneBindings" :key="'sc' + i" class="obc-bind-row">
            <span class="obc-bind-prefix">+</span>
            <input v-model="b.command" class="ep-field-input ep-mono obc-bind-cmd" @change="bindingsDirty = true" />
            <span class="obc-bind-arrow">-&gt;</span>
            <select v-model="b.scene" class="ep-field-select obc-bind-target" @change="bindingsDirty = true">
              <option v-for="s in scenes" :key="s.sceneName" :value="s.sceneName">{{ s.sceneName }}</option>
              <option v-if="!scenes.some(s => s.sceneName === b.scene)" :value="b.scene">{{ b.scene }}</option>
            </select>
            <button class="ep-btn-delete" @click="removeSceneBinding(i)">remove</button>
          </div>
        </div>
        <div class="obc-add-row">
          <span class="obc-bind-prefix">+</span>
          <input v-model="newSceneCmd" class="ep-field-input ep-mono obc-bind-cmd" placeholder="command" />
          <span class="obc-bind-arrow">-&gt;</span>
          <select v-model="newSceneTarget" class="ep-field-select obc-bind-target">
            <option value="" disabled>scene</option>
            <option v-for="s in scenes" :key="s.sceneName" :value="s.sceneName">{{ s.sceneName }}</option>
          </select>
          <button class="ep-btn-new" :disabled="!newSceneCmd || !newSceneTarget" @click="addSceneBinding">add</button>
        </div>
      </div>

      <!-- source command bindings -->
      <div class="ep-field-group">
        <label class="ep-field-label">source commands <span class="ep-field-hint">show, hide, mute or set the volume of a source from chat</span></label>
        <div class="obc-bind-list">
          <div v-for="(b, i) in sourceBindings" :key="'so' + i" class="obc-bind-row">
            <span class="obc-bind-prefix">+</span>
            <input v-model="b.command" class="ep-field-input ep-mono obc-bind-cmd" @change="bindingsDirty = true" />
            <span class="obc-bind-arrow">-&gt;</span>
            <input v-model="b.source" list="obc-source-names" class="ep-field-input obc-bind-target" @change="bindingsDirty = true" />
            <select v-model="b.action" class="ep-field-select" @change="bindingsDirty = true">
              <option v-for="a in SOURCE_ACTIONS" :key="a.value" :value="a.value">{{ a.label }}</option>
            </select>
            <input v-if="b.action === 'volume'" v-model.number="b.value" type="number" min="0" max="100" class="ep-field-input obc-bind-vol" @change="bindingsDirty = true" />
            <button class="ep-btn-delete" @click="removeSourceBinding(i)">remove</button>
          </div>
        </div>
        <div class="obc-add-row">
          <span class="obc-bind-prefix">+</span>
          <input v-model="newSourceCmd" class="ep-field-input ep-mono obc-bind-cmd" placeholder="command" />
          <span class="obc-bind-arrow">-&gt;</span>
          <input v-model="newSourceTarget" list="obc-source-names" class="ep-field-input obc-bind-target" placeholder="source name" />
          <select v-model="newSourceAction" class="ep-field-select">
            <option v-for="a in SOURCE_ACTIONS" :key="a.value" :value="a.value">{{ a.label }}</option>
          </select>
          <input v-if="newSourceAction === 'volume'" v-model.number="newSourceValue" type="number" min="0" max="100" class="ep-field-input obc-bind-vol" />
          <button class="ep-btn-new" :disabled="!newSourceCmd || !newSourceTarget" @click="addSourceBinding">add</button>
        </div>
        <datalist id="obc-source-names">
          <option v-for="n in knownSources" :key="n" :value="n"></option>
        </datalist>
      </div>

    </div>

    <div class="ep-panel-footer">
      <div>
        <span v-if="bindingsDirty" class="obc-unsaved">command list has unsaved changes</span>
      </div>
      <div class="ep-footer-right">
        <button class="ep-btn-save" :class="{ saved: bindingsSaved }" :disabled="bindingsSaving || !bindingsDirty" @click="saveBindings">
          {{ bindingsSaved ? 'saved' : bindingsSaving ? 'saving' : 'save commands' }}
        </button>
      </div>
    </div>

  </div>
</template>

<style scoped>
.obc-pw-row { display: flex; align-items: center; }
.obc-pw-row .ep-field-input { flex: 1; }
.obc-eye {
  width: 32px; height: 33px; flex-shrink: 0;
  border: 1px solid #2a2a30; border-left: none;
  background: #111217; cursor: pointer; color: #555;
  display: flex; align-items: center; justify-content: center;
}
.obc-eye:hover { color: #9d6cff; }
.obc-eye svg { width: 13px; height: 13px; }

.obc-toggle-row { display: flex; align-items: center; gap: 10px; }
.obc-toggle-lbl { font-size: 12px; color: #ccc; }
.obc-toggle-sub { font-size: 10px; color: #444; }

.obc-connect-row { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.obc-status { font-size: 10px; font-weight: 600; letter-spacing: .04em; padding: 3px 8px; border: 1px solid; text-transform: uppercase; }
.obc-status.connected    { color: #23d18b; border-color: #23d18b44; background: #23d18b0e; }
.obc-status.connecting   { color: #e5c07b; border-color: #e5c07b44; background: #e5c07b0e; }
.obc-status.disconnected { color: #555; border-color: #2a2a30; }
.obc-status.error        { color: #f14949; border-color: #f1494944; background: #f149490e; }
.obc-status-err { font-size: 11px; color: #f14949; max-width: 260px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }

.obc-scenes { display: flex; flex-wrap: wrap; gap: 10px; }
.obc-scene-card {
  width: 160px; flex-shrink: 0; cursor: pointer;
  border: 1px solid #2a2a30; background: #111217;
  transition: border-color .15s, background .15s;
  position: relative; overflow: hidden;
}
.obc-scene-card:hover { border-color: #3a3a44; background: #16161a; }
.obc-scene-card.active { border-color: #6f2bff; }
.obc-scene-card.picked:not(.active) { border-color: #2a2a42; }
.obc-scene-thumb { width: 100%; height: 90px; background: #0a0a0e; overflow: hidden; }
.obc-thumb-img { width: 100%; height: 100%; object-fit: cover; display: block; }
.obc-thumb-empty { width: 100%; height: 100%; background: #0a0a0e; }
.obc-scene-name { padding: 6px 8px; font-size: 11px; color: #aaa; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.obc-scene-card.active .obc-scene-name { color: #c4a0ff; }
.obc-scene-live { position: absolute; top: 5px; left: 5px; font-size: 8px; font-weight: 700; letter-spacing: .08em; color: #fff; background: #f14949; padding: 1px 5px; }

.obc-source-list { display: flex; flex-direction: column; gap: 2px; }
.obc-source-row { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; padding: 6px 8px; background: #111217; border: 1px solid #1e1e24; }
.obc-source-name { flex: 1; font-size: 12px; color: #888; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.obc-vis-btn, .obc-mute-btn, .obc-vol-btn {
  height: 24px; padding: 0 10px; border: 1px solid #2a2a30; background: transparent; color: #555;
  font-family: inherit; font-size: 10px; cursor: pointer; flex-shrink: 0; transition: all .15s;
}
.obc-vis-btn.on { border-color: #6f2bff55; color: #9d6cff; background: #6f2bff0e; }
.obc-mute-btn.muted { border-color: #f1494944; color: #f14949; background: #f149490a; }
.obc-vis-btn:hover, .obc-mute-btn:hover, .obc-vol-btn:hover { border-color: #444; color: #aaa; }
.obc-vol-row { width: 100%; display: flex; align-items: center; gap: 8px; padding: 6px 0 2px; border-top: 1px solid #1e1e24; margin-top: 4px; flex-basis: 100%; }
.obc-vol-slider { flex: 1; accent-color: #6f2bff; cursor: pointer; }
.obc-vol-val { font-size: 11px; color: #9d6cff; width: 34px; text-align: right; flex-shrink: 0; }

.obc-bind-list { display: flex; flex-direction: column; gap: 4px; margin-bottom: 8px; }
.obc-bind-row, .obc-add-row { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; padding: 4px 0; }
.obc-bind-prefix { color: #9d6cff; font-weight: 700; font-size: 12px; flex-shrink: 0; }
.obc-bind-cmd { width: 130px; flex: none; }
.obc-bind-target { width: 150px; flex: none; }
.obc-bind-vol { width: 70px; flex: none; }
.obc-bind-arrow { color: #444; font-size: 11px; flex-shrink: 0; }

.obc-unsaved { font-size: 11px; color: #e5c07b; }

@media (max-width: 680px) {
  .obc-scene-card { width: calc(50% - 5px); }
  .obc-bind-cmd, .obc-bind-target { width: 100%; }
}
</style>
