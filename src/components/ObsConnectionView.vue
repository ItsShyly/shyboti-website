<script setup lang="ts">
// ObsConnectionView.vue
// Agent-relay model: no host/port/password fields. The streamer:
//   1. clicks "Generate token" (or it auto-generates on first open)
//   2. downloads the ShyBoti Agent app (link on this page)
//   3. pastes the token into the agent on their PC - done
// From here on the agent keeps a persistent outbound ws connection to the
// relay; this page just shows status and lets them manage scenes/bindings.
// Routed page (/obs-connection), not a modal - the settings sub-panel
// (enabled/screenshots/arg-commands, broadcaster only) is the only remaining
// Teleport overlay here.

import { ref, computed, onMounted, onUnmounted, watch } from 'vue'
import { API } from '../api'
import { useAuth } from '../auth'
import { useOverlayClose } from '../composables/useOverlayClose'

const { session, channelRole } = useAuth()
const settingsOverlay = useOverlayClose()

interface AgentStatus {
  paired: boolean
  connected: boolean
  last_seen: number
  version: string
  obs_connected: boolean
  current_scene: string
  video_mix_projector_open?: boolean
  video_mix_projector_title?: string | null
  scene_bindings:  SceneBind[]
  source_bindings: SourceBind[]
  arg_commands: Record<string, string>
  screenshots: boolean
  // broadcaster-only fields - the backend omits these entirely for anyone else
  enabled?: boolean
  screenshot_interval_sec?: number
}

interface SceneInfo { sceneName: string; sceneIndex: number }
interface SourceInfo { sceneItemId: number; sourceName: string; sceneItemEnabled: boolean; visible: boolean; isAudioSource: boolean; inputKind: string | null; muted?: boolean; volumePercent?: number }
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

// >>> Every action that can be triggered generically, e.g. "+scene cam" or
// >>> "+volume mic 50", instead of one fixed binding per scene/source. Mirrors
// >>> resolveObsCommand's kind-check in agentRelay.ts - 'scene' is handled as
// >>> its own arg shape (just a name), everything else takes a source name
// >>> (+ a value for volume).
const ARG_ACTIONS = [
  { value: 'scene',      label: 'Switch scene',       usage: '+<cmd> <scene name>' },
  { value: 'show',       label: 'Show source',        usage: '+<cmd> <source name>' },
  { value: 'hide',       label: 'Hide source',        usage: '+<cmd> <source name>' },
  { value: 'toggle',     label: 'Toggle visibility',  usage: '+<cmd> <source name>' },
  { value: 'mute',       label: 'Mute source',        usage: '+<cmd> <source name>' },
  { value: 'unmute',     label: 'Unmute source',      usage: '+<cmd> <source name>' },
  { value: 'mutetoggle', label: 'Toggle mute',        usage: '+<cmd> <source name>' },
  { value: 'volume',     label: 'Set volume',         usage: '+<cmd> <source name> <0-100>' },
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
const argCommands    = ref<Record<string, string>>({})
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
const pendingSources = ref<Set<number>>(new Set())
watch(sources, list => {
  for (const s of list) if (!knownSources.value.includes(s.sourceName)) knownSources.value.push(s.sourceName)
})
watch(argCommands, () => { bindingsDirty.value = true }, { deep: true })

// --- settings panel (broadcaster only - mirrors the PUT /obs/:ch/settings guard) ---
const showSettings         = ref(false)
const settingsSaving       = ref(false)
const settingsSaved        = ref(false)
const enabledLocal         = ref(true)
const screenshotsLocal     = ref(true)
const screenshotIntervalLocal = ref(5)

function openSettings() {
  if (!isBroadcaster.value) return // belt-and-suspenders - the gear button is v-if'd out for non-broadcasters already
  enabledLocal.value             = agentStatus.value?.enabled ?? true
  screenshotsLocal.value         = agentStatus.value?.screenshots ?? true
  screenshotIntervalLocal.value  = agentStatus.value?.screenshot_interval_sec ?? 5
  showSettings.value = true
}

async function saveSettings() {
  if (!session.value || !isBroadcaster.value) return
  settingsSaving.value = true
  try {
    const res = await fetch(`${API}/obs/${session.value.channel}/settings`, {
      method: 'PUT',
      headers: { ...authHeaders.value, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        enabled: enabledLocal.value,
        screenshots: screenshotsLocal.value,
        screenshot_interval_sec: screenshotIntervalLocal.value,
      }),
    })
    if (res.ok) {
      settingsSaved.value = true
      setTimeout(() => { settingsSaved.value = false }, 2000)
      await load()
      restartShotLoop()
    }
  } catch {}
  settingsSaving.value = false
}

// --- scene screenshots (item: previews weren't rendered anywhere before) ---
// Uses the existing GET /obs/:ch/screenshot?scene=X route + the channel's
// `screenshots` toggle, which were already wired up server-side but nothing
// in the frontend ever called them.
const sceneShots = ref<Record<string, string>>({})
let shotTimer: ReturnType<typeof setInterval> | null = null

async function refreshScreenshot(sceneName: string) {
  if (!session.value || !agentStatus.value?.screenshots) return
  try {
    const res = await fetch(
      `${API}/obs/${session.value.channel}/screenshot?scene=${encodeURIComponent(sceneName)}`,
      { headers: authHeaders.value }
    )
    if (res.ok) {
      const d = await res.json() as { imageData: string | null }
      if (d.imageData) sceneShots.value = { ...sceneShots.value, [sceneName]: d.imageData }
    }
  } catch {}
}

function refreshAllShots() {
  if (!agentConnected.value || !obsConnected.value || !agentStatus.value?.screenshots) return
  for (const s of scenes.value) refreshScreenshot(s.sceneName)
}

function restartShotLoop() {
  if (shotTimer) { clearInterval(shotTimer); shotTimer = null }
  if (!agentStatus.value?.screenshots) return
  const intervalMs = Math.max(3, agentStatus.value?.screenshot_interval_sec ?? 5) * 1000
  refreshAllShots() // don't wait a full interval for the first paint
  shotTimer = setInterval(refreshAllShots, intervalMs)
}

let pollTimer: ReturnType<typeof setInterval> | null = null

const authHeaders = computed(() => session.value ? { Authorization: `Bearer ${session.value.token}` } : {} as Record<string, string>)
const isBroadcaster = computed(() => session.value?.login?.toLowerCase() === session.value?.channel?.toLowerCase())
const canForcePreview = computed(() =>
  !!agentStatus.value?.screenshots &&
  (isBroadcaster.value || channelRole.value?.permissions?.obs_force_preview === true)
)
const videoMixProjectorOpen = computed(() => !!agentStatus.value?.video_mix_projector_open)
const videoMixProjectorTitle = computed(() => agentStatus.value?.video_mix_projector_title ?? null)

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
      argCommands.value    = d.arg_commands    ?? {}
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
      restartShotLoop()
    }
  } catch {}
}

async function switchScene(name: string) {
  if (!session.value) return // backend enforces obs_edit permission; mods with it can switch scenes too
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
    if (res.ok) {
      const rawSources = (await res.json() as any).sources ?? []
      sources.value = rawSources.map((s: any) => ({ ...s, visible: s.sceneItemEnabled }))
    }
  } catch {}
  sourcesLoading.value = false
}

async function toggleSourceVisible(src: SourceInfo) {
  if (!session.value || pendingSources.value.has(src.sceneItemId)) return
  pendingSources.value = new Set(pendingSources.value).add(src.sceneItemId)
  try {
    await fetch(`${API}/obs/${session.value.channel}/source/visibility`, {
      method: 'POST',
      headers: { ...authHeaders.value, 'Content-Type': 'application/json' },
      body: JSON.stringify({ scene: selectedScene.value, sceneItemId: src.sceneItemId, enabled: !src.visible }),
    })
  } catch {}
  // reload ground truth to sync UI with actual OBS state
  if (selectedScene.value) await loadSources(selectedScene.value)
  const next_ = new Set(pendingSources.value); next_.delete(src.sceneItemId); pendingSources.value = next_
}

async function toggleSourceMute(src: SourceInfo & { muted?: boolean }) {
  if (!session.value || pendingSources.value.has(src.sceneItemId)) return
  pendingSources.value = new Set(pendingSources.value).add(src.sceneItemId)
  try {
    await fetch(`${API}/obs/${session.value.channel}/source/mute`, {
      method: 'POST',
      headers: { ...authHeaders.value, 'Content-Type': 'application/json' },
      body: JSON.stringify({ source: src.sourceName, muted: !(src.muted ?? false) }),
    })
  } catch {}
  if (selectedScene.value) await loadSources(selectedScene.value)
  const next_ = new Set(pendingSources.value); next_.delete(src.sceneItemId); pendingSources.value = next_
}

// --- bindings ---
async function saveBindings() {
  if (!session.value) return
  bindingsSaving.value = true
  try {
    // >>> Drop blank command names so an emptied field actually disables that
    // >>> generic command instead of saving "" as its trigger word.
    const cleanedArgCommands: Record<string, string> = {}
    for (const [action, cmd] of Object.entries(argCommands.value)) {
      if (cmd && cmd.trim()) cleanedArgCommands[action] = cmd.trim().replace(/^\+/, '').toLowerCase()
    }
    await fetch(`${API}/obs/${session.value.channel}/bindings`, {
      method: 'PUT',
      headers: { ...authHeaders.value, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        scene_bindings: sceneBindings.value,
        source_bindings: sourceBindings.value,
        arg_commands: cleanedArgCommands,
      }),
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

// --- force all previews button ---
const forcePreviewLoading = ref(false)

async function forceAllPreviews() {
  if (!session.value || !canForcePreview.value) return
  forcePreviewLoading.value = true
  try {
    await fetch(`${API}/obs/${session.value.channel}/force-all-previews`, {
      method: 'POST',
      headers: authHeaders.value,
    })
  } catch {}
  forcePreviewLoading.value = false
}

// --- lifecycle ---
onMounted(() => {
  load()
  pollTimer = setInterval(async () => {
    await poll()
    if (agentConnected.value && obsConnected.value && selectedScene.value) loadSources(selectedScene.value)
    if (agentConnected.value && obsConnected.value && scenes.value.length === 0) refreshScenes()
  }, 5000)
})
onUnmounted(() => {
  if (pollTimer) clearInterval(pollTimer)
  if (shotTimer) clearInterval(shotTimer)
})
watch(() => session.value?.channel, () => load())
</script>

<template>
  <div class="obsconn-page">

    <div class="obsconn-header">
      <div>
        <div class="obsconn-title">OBS connection</div>
        <div class="obsconn-sub">#{{ session?.channel }}</div>
      </div>
      <div class="obsconn-header-right">
        <div class="obc-status-bar" :class="connStatusClass">
          <div class="obc-status-dot"></div>
          <span class="obc-status-text">{{ connStatusLabel }}</span>
          <span v-if="agentStatus?.version" class="obc-status-version">v{{ agentStatus.version }}</span>
        </div>
        <button v-if="isBroadcaster" class="obsconn-gear-btn" title="OBS settings" @click="openSettings">
          <svg viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg">
            <path d="M10 12.5a2.5 2.5 0 100-5 2.5 2.5 0 000 5z" stroke="currentColor" stroke-width="1.5"/>
            <path d="M16.2 12.3a1.4 1.4 0 00.3 1.5l.05.05a1.65 1.65 0 11-2.35 2.35l-.05-.05a1.4 1.4 0 00-1.5-.3 1.4 1.4 0 00-.85 1.28v.14a1.65 1.65 0 11-3.3 0v-.07a1.4 1.4 0 00-.92-1.28 1.4 1.4 0 00-1.5.3l-.05.05A1.65 1.65 0 113.63 13.9l.05-.05a1.4 1.4 0 00.3-1.5 1.4 1.4 0 00-1.28-.85h-.14a1.65 1.65 0 110-3.3h.07a1.4 1.4 0 001.28-.92 1.4 1.4 0 00-.3-1.5l-.05-.05A1.65 1.65 0 116.09 3.38l.05.05a1.4 1.4 0 001.5.3h.06a1.4 1.4 0 00.85-1.28V2.3a1.65 1.65 0 113.3 0v.07a1.4 1.4 0 00.85 1.28h.06a1.4 1.4 0 001.5-.3l.05-.05a1.65 1.65 0 112.35 2.35l-.05.05a1.4 1.4 0 00-.3 1.5v.06a1.4 1.4 0 001.28.85h.14a1.65 1.65 0 110 3.3h-.07a1.4 1.4 0 00-1.28.85z" stroke="currentColor" stroke-width="1.3"/>
          </svg>
        </button>
      </div>
    </div>

    <div class="obsconn-body">

      <!-- SETUP PROMPT (shown until agent is connected + OBS is reachable) -->
      <!-- Full setup instructions live in the gear panel now - broadcaster only -->
      <template v-if="!agentConnected || !obsConnected">
        <div class="obc-setup-card obc-setup-compact">
          <template v-if="isBroadcaster">
            <div class="obc-setup-title">
              {{ agentStatus?.paired ? (agentConnected ? 'Agent connected - waiting for OBS…' : 'Waiting for the agent to connect…') : 'OBS agent is not set up yet' }}
            </div>
            <div class="obc-setup-hint">
              Click the gear icon above to
              {{ agentStatus?.paired ? 'view your pairing token again or re-download the agent.' : 'get your pairing token and download the agent.' }}
            </div>
          </template>
          <template v-else>
            <div class="obc-setup-title">OBS isn't connected yet</div>
            <div class="obc-setup-hint">Ask your broadcaster to set it up (gear icon, broadcaster only).</div>
          </template>
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
              <div class="obc-scene-thumb">
                <img v-if="sceneShots[s.sceneName]" :src="sceneShots[s.sceneName]" :alt="s.sceneName" />
                <div v-else class="obc-scene-thumb-empty">{{ agentStatus?.screenshots ? '…' : 'previews off' }}</div>
              </div>
              <div class="obc-scene-name">{{ s.sceneName }}</div>
              <div v-if="s.sceneName === currentScene" class="obc-scene-live">live</div>
            </div>
            <div v-if="!scenes.length" class="ep-empty">
              <button class="ep-btn-cancel" @click="refreshScenes">load scenes</button>
            </div>
          </div>
          <button
            v-if="canForcePreview && scenes.length > 0 && !videoMixProjectorOpen"
            class="ep-btn-new"
            @click="forceAllPreviews()"
            :disabled="forcePreviewLoading"
            style="width: 200px; display: block; margin: 0 auto;"
          >
            {{ forcePreviewLoading ? 'Opening…' : 'Force all previews' }}
          </button>
          <div v-if="canForcePreview" class="obc-projector-state">
            Multiview projector: {{ videoMixProjectorOpen ? 'open' : 'closed' }}
            <span v-if="videoMixProjectorTitle" class="obc-projector-title">"{{ videoMixProjectorTitle }}"</span>
          </div>
        </div>

        <!-- Sources -->
        <div class="ep-field-group" v-if="selectedScene">
          <label class="ep-field-label">sources <span class="ep-field-hint">{{ selectedScene }}</span></label>
          <div class="obc-source-list">
            <div v-for="src in (sources as any[])" :key="src.sceneItemId" class="obc-source-row">
              <span class="obc-source-name">{{ src.sourceName }}</span>
              <button class="obc-vis-btn" :class="{ on: src.visible }" :disabled="pendingSources.has(src.sceneItemId)" @click="toggleSourceVisible(src)">
                {{ src.visible ? 'visible' : 'hidden' }}
              </button>
              <template v-if="src.isAudioSource">
                <button class="obc-mute-btn" :class="{ muted: src.muted }" :disabled="pendingSources.has(src.sceneItemId)" @click="toggleSourceMute(src)">
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

        <div class="ep-field-group">
          <label class="ep-field-label">
            Arg commands
            <span class="ep-field-hint">one command per action, works with any scene/source name typed as the argument - e.g. "+scene cam" instead of one binding per scene</span>
          </label>
          <div class="obc-arg-list">
            <div v-for="a in ARG_ACTIONS" :key="a.value" class="obc-arg-row">
              <span class="obc-arg-label">{{ a.label }}</span>
              <span class="obc-bind-prefix">+</span>
              <input v-model="argCommands[a.value]" class="ep-field-input ep-mono obc-bind-cmd" placeholder="(disabled)" />
              <span class="obc-arg-usage">{{ a.usage }}</span>
            </div>
          </div>
        </div>

      </template>

    </div><!-- end body -->

    <div class="obsconn-footer">
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

  <!-- SETTINGS PANEL - broadcaster only, mirrors PUT /obs/:ch/settings's own guard -->
  <Teleport to="body">
    <div v-if="showSettings && isBroadcaster" class="ep-overlay" v-bind="settingsOverlay.handlers(() => showSettings = false)">
      <div class="ep-panel obsconn-settings-panel">
        <div class="ep-panel-header">
          <div>
            <div class="ep-panel-title">OBS settings</div>
            <div class="ep-panel-sub">broadcaster only</div>
          </div>
          <button class="ep-panel-close" @click="showSettings = false">x</button>
        </div>

        <div class="ep-panel-body">

          <div class="ep-field-group">
            <label class="ep-field-label">Set up the ShyBoti Agent</label>
            <ol class="obc-setup-steps">
              <li>
                <strong>Generate a pairing token</strong> - valid until you regenerate it.
                <button class="ep-btn-new obc-token-btn" :disabled="generatingToken" @click="generateToken">
                  {{ generatingToken ? 'generating...' : agentStatus?.paired ? 'regenerate token' : 'generate token' }}
                </button>
                <div v-if="tokenVisible && token" class="obc-token-box">
                  <code class="obc-token-val">{{ token }}</code>
                  <button class="obc-copy-btn" @click="copyToken">
                    {{ tokenJustCopied ? 'copied!' : 'copy' }}
                  </button>
                  <button class="obc-dismiss-btn" @click="tokenVisible = false; token = ''" title="I saved it, dismiss">
                    done
                  </button>
                  <div class="obc-token-warn">Copy this before dismissing - it is not stored on the server and cannot be shown again. If you lose it, regenerate a new one (this will disconnect the agent).</div>
                </div>
                <div v-else-if="agentStatus?.paired && !token" class="obc-token-hint">
                  Token already set. Click "regenerate token" to replace it (disconnects the current agent).
                </div>
              </li>
              <li>
                <strong>Download the ShyBoti Agent</strong> - a small Node.js app that runs alongside OBS on the streamer's PC. Requires <a href="https://nodejs.org" target="_blank" rel="noopener" class="obc-link">Node.js</a>.
                <div class="obc-dl-row">
                  <a class="ep-btn-cancel obc-dl-btn" :href="`${API}/agent/download/windows`" target="_blank" rel="noopener">
                    Download for Windows (.zip)
                  </a>
                  <a class="ep-btn-cancel obc-dl-btn" :href="`${API}/agent/download/linux`" target="_blank" rel="noopener">
                    Download for Linux (.tar.gz)
                  </a>
                </div>
                <div class="obc-av-note">Extract the zip, then run <code>start.bat</code> (Windows) or <code>start.sh</code> (Linux/Mac)</div>
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

          <div class="ep-field-group">
            <label class="ep-field-label">Connection enabled</label>
            <div class="obc-toggle-row">
              <button class="obc-toggle" :class="{ on: enabledLocal }" @click="enabledLocal = !enabledLocal">
                <span class="obc-toggle-knob"></span>
              </button>
              <span class="obc-toggle-label">{{ enabledLocal ? 'on - agent can relay commands' : 'off - agent connections are rejected' }}</span>
            </div>
          </div>

          <div class="ep-field-group">
            <label class="ep-field-label">Scene previews</label>
            <div class="obc-toggle-row">
              <button class="obc-toggle" :class="{ on: screenshotsLocal }" @click="screenshotsLocal = !screenshotsLocal">
                <span class="obc-toggle-knob"></span>
              </button>
              <span class="obc-toggle-label">{{ screenshotsLocal ? 'on - periodic screenshots of each scene' : 'off - no screenshots are taken' }}</span>
            </div>
            <div v-if="screenshotsLocal" class="obc-interval-row">
              <span class="ep-field-hint">refresh every</span>
              <input v-model.number="screenshotIntervalLocal" type="number" min="3" max="60" class="ep-field-input obc-interval-input" />
              <span class="ep-field-hint">seconds (min 3, to keep this light on OBS)</span>
            </div>
            <div class="ep-field-hint">
              Only you (the broadcaster) can change this - moderators can see previews if they're on, but can't turn them on or off.
            </div>
          </div>

        </div>

        <div class="ep-panel-footer">
          <div></div>
          <div class="ep-footer-right">
            <button class="ep-btn-save" :class="{ saved: settingsSaved }" :disabled="settingsSaving" @click="saveSettings">
              {{ settingsSaved ? 'saved' : settingsSaving ? 'saving' : 'save settings' }}
            </button>
          </div>
        </div>
      </div>
    </div>
  </Teleport>


</template>

<style scoped>
/* Page chrome (was a modal panel before, now a routed page like ObsView) */
.obsconn-page { display: flex; flex-direction: column; gap: 16px;}
.obsconn-header { display: flex; align-items: flex-start; justify-content: space-between; gap: 12px; flex-wrap: wrap; }
.obsconn-title { font-size: 20px; font-weight: 700; color: #e0e0e0; }
.obsconn-sub   { font-size: 12px; color: #555; margin-top: 2px; }
.obsconn-header-right { display: flex; align-items: center; gap: 8px; }
.obsconn-gear-btn {
  width: 30px; height: 30px; display: flex; align-items: center; justify-content: center;
  border: 1px solid #2a2a30; background: #111217; color: #666; cursor: pointer; transition: all .15s; flex-shrink: 0;
}
.obsconn-gear-btn svg { width: 16px; height: 16px; }
.obsconn-gear-btn:hover { border-color: #9d6cff55; color: #9d6cff; }
.obsconn-body   { display: flex; flex-direction: column; gap: 18px; }
.obsconn-footer { display: flex; align-items: center; justify-content: space-between; gap: 12px; padding-top: 10px; border-top: 1px solid #1e1e22; }
.obsconn-settings-panel { width: min(560px, 92vw); }

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
.obc-setup-compact { padding: 12px 14px; }
.obc-setup-compact .obc-setup-title { margin-bottom: 4px; }
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
.obc-token-warn { width: 100%; font-size: 10px; color: #e5c07b; flex-basis: 100%; line-height: 1.5; }
.obc-token-hint { font-size: 11px; color: #555; margin-top: 4px; }
.obc-dismiss-btn {
  height: 22px; padding: 0 10px; border: 1px solid #2a2a30;
  background: transparent; color: #666; font-family: inherit; font-size: 10px;
  cursor: pointer; flex-shrink: 0;
}
.obc-dismiss-btn:hover { border-color: #444; color: #aaa; }
.obc-dl-row { display: flex; gap: 8px; flex-wrap: wrap; margin-top: 6px; }
.obc-av-note { font-size: 10px; color: #555; margin-top: 6px; line-height: 1.5; }
.obc-av-note code { color: #9d6cff; font-family: 'Consolas','Fira Mono',monospace; }
.obc-link { color: #9d6cff; text-decoration: none; }
.obc-link:hover { text-decoration: underline; }

/* Scenes */
.obc-section-label { display: flex; align-items: center; gap: 8px; }
.obc-refresh-btn {
  height: 20px; padding: 0 7px; border: 1px solid #2a2a30; background: transparent;
  color: #555; font-size: 12px; cursor: pointer; transition: color .15s;
}
.obc-refresh-btn:hover { color: #9d6cff; }

.obc-scenes { display: flex; flex-wrap: wrap; gap: 6px; max-width: 800px;}
.obc-scene-card {
  width: 150px; padding: 0 0 7px; border: 1px solid #2a2a30; background: #111217;
  cursor: pointer; font-size: 11px; color: #888; position: relative;
  transition: border-color .15s, color .15s; overflow: hidden;
}
.obc-scene-card:hover { border-color: #3a3a44; color: #aaa; }
.obc-scene-card.active { border-color: #6f2bff; color: #c4a0ff; }
.obc-scene-card.picked:not(.active) { border-color: #2a2a42; }
.obc-scene-live {
  position: absolute; top: 3px; right: 4px;
  font-size: 7px; font-weight: 700; letter-spacing: .08em;
  color: #fff; background: #f14949; padding: 1px 4px; z-index: 1;
}
.obc-scene-name { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; padding: 6px 8px 0; }
.obc-scene-thumb {
  width: 100%; aspect-ratio: 16/9; background: #0a0a0d; overflow: hidden;
  display: flex; align-items: center; justify-content: center; border-bottom: 1px solid #1e1e24;
}
.obc-scene-thumb img { width: 100%; height: 100%; object-fit: cover; display: block; }
.obc-scene-thumb-empty { font-size: 9px; color: #333; }
.obc-projector-state { margin-top: 6px; font-size: 11px; color: #666; }
.obc-projector-title { color: #666666ab; font-style: italic; }

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

/* Settings panel: toggles + generic arg commands */
.obc-toggle-row { display: flex; align-items: center; gap: 10px; }
.obc-toggle {
  width: 34px; height: 18px; border: 1px solid #2a2a30; background: #0d0d10;
  padding: 2px; cursor: pointer; flex-shrink: 0; transition: border-color .15s, background .15s;
}
.obc-toggle.on { border-color: #6f2bff88; background: #6f2bff22; }
.obc-toggle-knob {
  display: block; width: 12px; height: 12px; background: #555; transition: transform .15s, background .15s;
}
.obc-toggle.on .obc-toggle-knob { background: #9d6cff; transform: translateX(14px); }
.obc-toggle-label { font-size: 11px; color: #888; }

.obc-interval-row { display: flex; align-items: center; gap: 6px; margin-top: 8px; }
.obc-interval-input { width: 56px; flex: none; text-align: center; }

.obc-arg-list { display: flex; flex-direction: column; gap: 6px; }
.obc-arg-row { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; padding: 3px 0; }
.obc-arg-label { width: 130px; flex: none; font-size: 11px; color: #999; }
.obc-arg-usage { font-size: 10px; color: #444; font-family: 'Consolas','Fira Mono',monospace; }

@media (max-width: 680px) {
  .obc-bind-cmd, .obc-bind-target { width: 100%; }
  .obc-arg-label { width: 100%; }
}
</style>
