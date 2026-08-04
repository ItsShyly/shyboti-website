<script setup lang="ts">
// ObsConnectionPanel.vue
// Agent-relay model: no host/port/password fields. The streamer:
//   1. clicks "Generate token" (or it auto-generates on first open)
//   2. downloads the ShyBoti Agent app (link on this page)
//   3. pastes the token into the agent on their PC - done
// From here on the agent keeps a persistent outbound ws connection to the
// relay; this panel just shows status and lets them manage scenes/bindings.

import { ref, computed, onMounted, onUnmounted, watch } from 'vue'
import { API } from '../api'
import { useAuth } from '../auth'

const { session } = useAuth()

interface AgentStatus {
  paired: boolean
  connected: boolean
  last_seen: number
  version: string
  obs_connected: boolean
  current_scene: string
  scene_bindings:  SceneBind[]
  source_bindings: SourceBind[]
}

interface SceneInfo { sceneName: string; sceneIndex: number }
interface SourceInfo { sceneItemId: number; sourceName: string; visible: boolean; isAudioSource: boolean }
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

// --- state ---
const loading        = ref(true)
const agentStatus    = ref<AgentStatus | null>(null)

const token          = ref('')           // shown once after (re)generate
const tokenVisible   = ref(false)
const generatingToken = ref(false)
const tokenJustCopied = ref(false)

const scenes         = ref<SceneInfo[]>([])
const selectedScene  = ref('')
const sources        = ref<SourceInfo[]>([])
const sourcesLoading = ref(false)

const sceneBindings  = ref<SceneBind[]>([])
const sourceBindings = ref<SourceBind[]>([])
const bindingsDirty  = ref(false)
const bindingsSaving = ref(false)
const bindingsSaved  = ref(false)

const newSceneCmd    = ref('')
const newSceneTarget = ref('')
const newSourceCmd   = ref('')
const newSourceTarget = ref('')
const newSourceAction = ref('show')
const newSourceValue  = ref(50)

const knownSources   = ref<string[]>([])
watch(sources, list => {
  for (const s of list) if (!knownSources.value.includes(s.sourceName)) knownSources.value.push(s.sourceName)
})

let pollTimer: ReturnType<typeof setInterval> | null = null

const authHeaders = computed(() => session.value ? { Authorization: `Bearer ${session.value.token}` } : {} as Record<string, string>)
const isBroadcaster = computed(() => session.value?.login?.toLowerCase() === session.value?.channel?.toLowerCase())

// derived
const agentConnected = computed(() => agentStatus.value?.connected ?? false)
const obsConnected   = computed(() => agentStatus.value?.obs_connected ?? false)
const currentScene   = computed(() => agentStatus.value?.current_scene ?? '')
const connStatusLabel = computed(() => {
  if (!agentStatus.value?.paired) return 'not set up'
  if (!agentConnected.value) return 'agent offline'
  if (!obsConnected.value)   return 'agent online · OBS not connected'
  return 'ready'
})
const connStatusClass = computed(() => {
  if (!agentStatus.value?.paired)  return 'status-none'
  if (!agentConnected.value)       return 'status-offline'
  if (!obsConnected.value)         return 'status-partial'
  return 'status-ready'
})

// --- load ---
async function load() {
  if (!session.value) return
  loading.value = true
  try {
    const res = await fetch(`${API}/obs/${session.value.channel}`, { headers: authHeaders.value })
    if (res.ok) {
      const d = await res.json() as AgentStatus
      agentStatus.value   = d
      sceneBindings.value  = d.scene_bindings  ?? []
      sourceBindings.value = d.source_bindings ?? []
      bindingsDirty.value  = false
    }
  } catch {}
  loading.value = false
  if (agentConnected.value && obsConnected.value) refreshScenes()
}

async function poll() {
  if (!session.value) return
  try {
    const res = await fetch(`${API}/obs/${session.value.channel}`, { headers: authHeaders.value })
    if (res.ok) {
      const d = await res.json() as AgentStatus
      agentStatus.value = d
    }
  } catch {}
}

// --- token ---
async function generateToken() {
  if (!session.value || !isBroadcaster.value) return
  generatingToken.value = true
  try {
    const res = await fetch(`${API}/obs/${session.value.channel}/token`, {
      method: 'POST', headers: authHeaders.value,
    })
    if (res.ok) {
      const d = await res.json() as { token: string }
      token.value        = d.token
      tokenVisible.value = true
    }
  } catch {}
  generatingToken.value = false
}

async function copyToken() {
  if (!token.value) return
  await navigator.clipboard.writeText(token.value).catch(() => {})
  tokenJustCopied.value = true
  setTimeout(() => { tokenJustCopied.value = false }, 2000)
}

// --- scenes ---
async function refreshScenes() {
  if (!session.value) return
  try {
    const res = await fetch(`${API}/obs/${session.value.channel}/scenes`, { headers: authHeaders.value })
    if (res.ok) {
      const d = await res.json() as { scenes: SceneInfo[]; currentScene: string }
      scenes.value = d.scenes
      if (!selectedScene.value && scenes.value[0]) selectedScene.value = scenes.value[0].sceneName
      if (selectedScene.value) loadSources(selectedScene.value)
    }
  } catch {}
}

async function switchScene(name: string) {
  if (!session.value || !isBroadcaster.value) return
  try {
    await fetch(`${API}/obs/${session.value.channel}/scene`, {
      method: 'POST',
      headers: { ...authHeaders.value, 'Content-Type': 'application/json' },
      body: JSON.stringify({ name }),
    })
    if (agentStatus.value) agentStatus.value.current_scene = name
  } catch {}
}

// --- sources ---
async function loadSources(sceneName: string) {
  if (!session.value) return
  selectedScene.value  = sceneName
  sourcesLoading.value = true
  try {
    const res = await fetch(
      `${API}/obs/${session.value.channel}/sources?scene=${encodeURIComponent(sceneName)}`,
      { headers: authHeaders.value }
    )
    if (res.ok) sources.value = (await res.json() as any).sources ?? []
  } catch {}
  sourcesLoading.value = false
}

async function toggleSourceVisible(src: SourceInfo) {
  if (!session.value || !isBroadcaster.value) return
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

async function toggleSourceMute(src: SourceInfo & { muted?: boolean }) {
  if (!session.value || !isBroadcaster.value) return
  const next = !(src.muted ?? false)
  src.muted = next
  try {
    await fetch(`${API}/obs/${session.value.channel}/source/mute`, {
      method: 'POST',
      headers: { ...authHeaders.value, 'Content-Type': 'application/json' },
      body: JSON.stringify({ source: src.sourceName, muted: next }),
    })
  } catch { src.muted = !next }
}

// --- bindings ---
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
  newSceneCmd.value = ''; newSceneTarget.value = ''
  bindingsDirty.value = true
}

function removeSceneBinding(i: number) { sceneBindings.value.splice(i, 1); bindingsDirty.value = true }

function addSourceBinding() {
  const cmd = newSourceCmd.value.trim().replace(/^\+/, '').toLowerCase()
  if (!cmd || !newSourceTarget.value) return
  if (sourceBindings.value.some(b => b.command === cmd)) return
  const entry: SourceBind = { command: cmd, source: newSourceTarget.value, action: newSourceAction.value }
  if (newSourceAction.value === 'volume') entry.value = newSourceValue.value
  sourceBindings.value.push(entry)
  newSourceCmd.value = ''; newSourceTarget.value = ''
  bindingsDirty.value = true
}

function removeSourceBinding(i: number) { sourceBindings.value.splice(i, 1); bindingsDirty.value = true }

// --- lifecycle ---
onMounted(() => {
  load()
  pollTimer = setInterval(async () => {
    await poll()
    if (agentConnected.value && obsConnected.value && selectedScene.value) loadSources(selectedScene.value)
    if (agentConnected.value && obsConnected.value && scenes.value.length === 0) refreshScenes()
  }, 5000)
})
onUnmounted(() => { if (pollTimer) clearInterval(pollTimer) })
watch(() => session.value?.channel, () => load())
</script>

<template>
  <div class="ep-panel">

    <div class="ep-panel-header">
      <div>
        <div class="ep-panel-title">OBS control</div>
        <div class="ep-panel-sub">#{{ session?.channel }}</div>
      </div>
      <button class="ep-panel-close" @click="$emit('close')">x</button>
    </div>

    <div class="ep-panel-body">

      <!-- STATUS BAR -->
      <div class="obc-status-bar" :class="connStatusClass">
        <div class="obc-status-dot"></div>
        <span class="obc-status-text">{{ connStatusLabel }}</span>
        <span v-if="agentStatus?.version" class="obc-status-version">v{{ agentStatus.version }}</span>
      </div>

      <!-- SETUP SECTION (shown until agent is connected + OBS is reachable) -->
      <template v-if="!agentConnected || !obsConnected">
        <div class="obc-setup-card">
          <div class="obc-setup-title">Set up the ShyBoti Agent</div>
          <ol class="obc-setup-steps">
            <li>
              <strong>Generate a pairing token</strong> - valid until you regenerate it.
              <template v-if="isBroadcaster">
                <button class="ep-btn-new obc-token-btn" :disabled="generatingToken" @click="generateToken">
                  {{ generatingToken ? 'generating…' : agentStatus?.paired ? 'regenerate token' : 'generate token' }}
                </button>
                <div v-if="tokenVisible && token" class="obc-token-box">
                  <code class="obc-token-val">{{ token }}</code>
                  <button class="obc-copy-btn" @click="copyToken">
                    {{ tokenJustCopied ? 'copied!' : 'copy' }}
                  </button>
                  <div class="obc-token-warn">⚠ Save this now - it won't be shown again after you close this panel.</div>
                </div>
              </template>
              <span v-else class="obc-setup-hint">Ask your broadcaster to generate a token.</span>
            </li>
            <li>
              <strong>Download the ShyBoti Agent</strong> - a small app that runs alongside OBS on the streamer's PC.
              <a class="ep-btn-cancel obc-dl-btn" href="https://shyboti.de/agent/download" target="_blank" rel="noopener">
                Download Agent (.exe)
              </a>
            </li>
            <li>
              <strong>Paste the token</strong> into the agent when prompted, then click "Connect". The agent will dial our server outbound - no port-forwarding needed.
            </li>
            <li>
              <strong>Open OBS</strong> with the WebSocket server enabled (Tools → WebSocket Server Settings → enabled). The agent connects to OBS locally on the same PC - you never share your OBS password with anyone.
            </li>
          </ol>
          <div v-if="agentStatus?.paired && !agentConnected" class="obc-setup-hint obc-paired-hint">
            Token is set - waiting for the agent to connect…
          </div>
        </div>
      </template>

      <!-- LIVE CONTROLS (shown when agent + OBS both reachable) -->
      <template v-if="agentConnected && obsConnected">

        <!-- Scenes -->
        <div class="ep-field-group">
          <div class="ep-field-label obc-section-label">
            Scenes
            <button class="obc-refresh-btn" @click="refreshScenes" title="Refresh scene list">↻</button>
          </div>
          <div class="obc-scenes">
            <div
              v-for="s in scenes"
              :key="s.sceneName"
              class="obc-scene-card"
              :class="{ active: s.sceneName === currentScene, picked: s.sceneName === selectedScene }"
              @click="switchScene(s.sceneName); loadSources(s.sceneName)"
            >
              <div class="obc-scene-name">{{ s.sceneName }}</div>
              <div v-if="s.sceneName === currentScene" class="obc-scene-live">live</div>
            </div>
            <div v-if="!scenes.length" class="ep-empty">
              <button class="ep-btn-cancel" @click="refreshScenes">load scenes</button>
            </div>
          </div>
        </div>

        <!-- Sources -->
        <div class="ep-field-group" v-if="selectedScene">
          <label class="ep-field-label">sources <span class="ep-field-hint">{{ selectedScene }}</span></label>
          <div class="obc-source-list">
            <div v-for="src in (sources as any[])" :key="src.sceneItemId" class="obc-source-row">
              <span class="obc-source-name">{{ src.sourceName }}</span>
              <button class="obc-vis-btn" :class="{ on: src.visible }" @click="toggleSourceVisible(src)">
                {{ src.visible ? 'visible' : 'hidden' }}
              </button>
              <template v-if="src.isAudioSource">
                <button class="obc-mute-btn" :class="{ muted: src.muted }" @click="toggleSourceMute(src)">
                  {{ src.muted ? 'muted' : 'live' }}
                </button>
              </template>
            </div>
            <div v-if="!sources.length && !sourcesLoading" class="ep-empty">no sources in this scene</div>
          </div>
        </div>

      </template><!-- end live controls -->

      <!-- COMMAND BINDINGS (always shown once paired, even if offline, so bindings can be set up in advance) -->
      <template v-if="agentStatus?.paired">

        <div class="ep-field-group">
          <label class="ep-field-label">
            Scene commands
            <span class="ep-field-hint">type a chat command → switches to a scene</span>
          </label>
          <div class="obc-bind-list">
            <div v-for="(b, i) in sceneBindings" :key="'sc'+i" class="obc-bind-row">
              <span class="obc-bind-prefix">+</span>
              <input v-model="b.command" class="ep-field-input ep-mono obc-bind-cmd" @change="bindingsDirty = true" />
              <span class="obc-bind-arrow">→</span>
              <select v-model="b.scene" class="ep-field-select obc-bind-target" @change="bindingsDirty = true">
                <option v-for="s in scenes" :key="s.sceneName" :value="s.sceneName">{{ s.sceneName }}</option>
                <option v-if="!scenes.some(s => s.sceneName === b.scene)" :value="b.scene">{{ b.scene }}</option>
              </select>
              <button class="ep-btn-delete" @click="removeSceneBinding(i)">×</button>
            </div>
          </div>
          <div class="obc-add-row">
            <span class="obc-bind-prefix">+</span>
            <input v-model="newSceneCmd" class="ep-field-input ep-mono obc-bind-cmd" placeholder="command" />
            <span class="obc-bind-arrow">→</span>
            <select v-model="newSceneTarget" class="ep-field-select obc-bind-target">
              <option value="" disabled>pick scene</option>
              <option v-for="s in scenes" :key="s.sceneName" :value="s.sceneName">{{ s.sceneName }}</option>
            </select>
            <button class="ep-btn-new" :disabled="!newSceneCmd || !newSceneTarget" @click="addSceneBinding">add</button>
          </div>
        </div>

        <div class="ep-field-group">
          <label class="ep-field-label">
            Source commands
            <span class="ep-field-hint">show, hide, mute or set volume from chat</span>
          </label>
          <div class="obc-bind-list">
            <div v-for="(b, i) in sourceBindings" :key="'so'+i" class="obc-bind-row">
              <span class="obc-bind-prefix">+</span>
              <input v-model="b.command" class="ep-field-input ep-mono obc-bind-cmd" @change="bindingsDirty = true" />
              <span class="obc-bind-arrow">→</span>
              <input v-model="b.source" list="obc-src-names" class="ep-field-input obc-bind-target" @change="bindingsDirty = true" />
              <select v-model="b.action" class="ep-field-select" @change="bindingsDirty = true">
                <option v-for="a in SOURCE_ACTIONS" :key="a.value" :value="a.value">{{ a.label }}</option>
              </select>
              <input v-if="b.action === 'volume'" v-model.number="b.value" type="number" min="0" max="100" class="ep-field-input obc-bind-vol" @change="bindingsDirty = true" />
              <button class="ep-btn-delete" @click="removeSourceBinding(i)">×</button>
            </div>
          </div>
          <div class="obc-add-row">
            <span class="obc-bind-prefix">+</span>
            <input v-model="newSourceCmd" class="ep-field-input ep-mono obc-bind-cmd" placeholder="command" />
            <span class="obc-bind-arrow">→</span>
            <input v-model="newSourceTarget" list="obc-src-names" class="ep-field-input obc-bind-target" placeholder="source name" />
            <select v-model="newSourceAction" class="ep-field-select">
              <option v-for="a in SOURCE_ACTIONS" :key="a.value" :value="a.value">{{ a.label }}</option>
            </select>
            <input v-if="newSourceAction === 'volume'" v-model.number="newSourceValue" type="number" min="0" max="100" class="ep-field-input obc-bind-vol" />
            <button class="ep-btn-new" :disabled="!newSourceCmd || !newSourceTarget" @click="addSourceBinding">add</button>
          </div>
          <datalist id="obc-src-names">
            <option v-for="n in knownSources" :key="n" :value="n" />
          </datalist>
        </div>

      </template>

    </div><!-- end body -->

    <div class="ep-panel-footer">
      <div>
        <span v-if="bindingsDirty" class="obc-unsaved">unsaved changes</span>
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
/* Status bar */
.obc-status-bar {
  display: flex; align-items: center; gap: 8px;
  padding: 7px 10px; margin-bottom: 2px;
  border: 1px solid; font-size: 11px;
}
.obc-status-dot {
  width: 7px; height: 7px; border-radius: 50%; flex-shrink: 0;
}
.obc-status-text { flex: 1; font-weight: 600; text-transform: uppercase; letter-spacing: .04em; }
.obc-status-version { font-size: 9px; color: #444; }

.status-none    { color: #444; border-color: #2a2a30; background: transparent; }
.status-none    .obc-status-dot { background: #333; }
.status-offline { color: #888; border-color: #2a2a3088; background: #0d0d1088; }
.status-offline .obc-status-dot { background: #555; }
.status-partial { color: #e5c07b; border-color: #e5c07b44; background: #e5c07b08; }
.status-partial .obc-status-dot { background: #e5c07b; }
.status-ready   { color: #23d18b; border-color: #23d18b44; background: #23d18b08; }
.status-ready   .obc-status-dot { background: #23d18b; animation: pulse 2s ease-in-out infinite; }

@keyframes pulse {
  0%, 100% { opacity: 1; } 50% { opacity: .4; }
}

/* Setup card */
.obc-setup-card {
  border: 1px solid #1e1e22; padding: 14px 16px; background: #0d0d10;
}
.obc-setup-title { font-size: 12px; font-weight: 600; color: #ccc; margin-bottom: 12px; }
.obc-setup-steps {
  padding-left: 18px; margin: 0 0 10px; display: flex; flex-direction: column; gap: 12px;
}
.obc-setup-steps li { font-size: 12px; color: #777; line-height: 1.6; }
.obc-setup-steps li strong { color: #aaa; }
.obc-setup-hint { font-size: 11px; color: #555; display: block; margin-top: 4px; }
.obc-paired-hint { color: #e5c07b; border-top: 1px solid #1e1e22; padding-top: 10px; margin-top: 4px; }

.obc-token-btn { margin-top: 6px; display: block; }
.obc-dl-btn    { margin-top: 6px; display: inline-block; text-decoration: none; }

.obc-token-box {
  margin-top: 8px; padding: 8px 10px; background: #0a0a0d;
  border: 1px solid #6f2bff44; display: flex; flex-wrap: wrap; gap: 6px; align-items: flex-start;
}
.obc-token-val {
  font-family: 'Consolas','Fira Mono',monospace; font-size: 11px; color: #c4a0ff;
  flex: 1; min-width: 0; word-break: break-all;
}
.obc-copy-btn {
  height: 24px; padding: 0 10px; border: 1px solid #6f2bff55;
  background: transparent; color: #9d6cff; font-size: 11px;
  font-family: inherit; cursor: pointer; flex-shrink: 0;
  transition: background .15s;
}
.obc-copy-btn:hover { background: #6f2bff22; }
.obc-token-warn { width: 100%; font-size: 10px; color: #e5c07b; flex-basis: 100%; }

/* Scenes */
.obc-section-label { display: flex; align-items: center; gap: 8px; }
.obc-refresh-btn {
  height: 20px; padding: 0 7px; border: 1px solid #2a2a30; background: transparent;
  color: #555; font-size: 12px; cursor: pointer; transition: color .15s;
}
.obc-refresh-btn:hover { color: #9d6cff; }

.obc-scenes { display: flex; flex-wrap: wrap; gap: 6px; }
.obc-scene-card {
  padding: 7px 12px; border: 1px solid #2a2a30; background: #111217;
  cursor: pointer; font-size: 11px; color: #888; position: relative;
  transition: border-color .15s, color .15s;
}
.obc-scene-card:hover { border-color: #3a3a44; color: #aaa; }
.obc-scene-card.active { border-color: #6f2bff; color: #c4a0ff; }
.obc-scene-card.picked:not(.active) { border-color: #2a2a42; }
.obc-scene-live {
  position: absolute; top: 3px; right: 4px;
  font-size: 7px; font-weight: 700; letter-spacing: .08em;
  color: #fff; background: #f14949; padding: 1px 4px;
}
.obc-scene-name { white-space: nowrap; }

/* Sources */
.obc-source-list { display: flex; flex-direction: column; gap: 2px; }
.obc-source-row {
  display: flex; align-items: center; gap: 8px; flex-wrap: wrap;
  padding: 5px 8px; background: #111217; border: 1px solid #1e1e24;
}
.obc-source-name { flex: 1; font-size: 12px; color: #888; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.obc-vis-btn, .obc-mute-btn {
  height: 22px; padding: 0 9px; border: 1px solid #2a2a30; background: transparent;
  color: #555; font-family: inherit; font-size: 10px; cursor: pointer; flex-shrink: 0; transition: all .15s;
}
.obc-vis-btn.on   { border-color: #6f2bff55; color: #9d6cff; background: #6f2bff0e; }
.obc-mute-btn.muted { border-color: #f1494944; color: #f14949; background: #f149490a; }
.obc-vis-btn:hover, .obc-mute-btn:hover { border-color: #444; color: #aaa; }

/* Bindings */
.obc-bind-list { display: flex; flex-direction: column; gap: 4px; margin-bottom: 8px; }
.obc-bind-row, .obc-add-row { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; padding: 3px 0; }
.obc-bind-prefix { color: #9d6cff; font-weight: 700; font-size: 12px; flex-shrink: 0; }
.obc-bind-cmd    { width: 120px; flex: none; }
.obc-bind-target { width: 150px; flex: none; }
.obc-bind-vol    { width: 64px; flex: none; }
.obc-bind-arrow  { color: #555; font-size: 12px; flex-shrink: 0; }

.obc-unsaved { font-size: 11px; color: #e5c07b; }

@media (max-width: 680px) {
  .obc-bind-cmd, .obc-bind-target { width: 100%; }
}
</style>
