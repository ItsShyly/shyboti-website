<script setup lang="ts">
// ObsControlView.vue
// Main OBS control page - scene switching, sources, audio, bindings, screenshots.
// Config (token, enabled toggle, screenshot interval) opens in a side panel.
// Screenshots poll via the server relay, not a direct OBS Control.

import { ref, computed, onMounted, onUnmounted, watch } from 'vue'
import { API } from '../api'
import { useAuth } from '../auth'

const { session, channelRole } = useAuth()

// ─── interfaces ──────────────────────────────────────────────────────────────

interface AgentStatus {
  paired:        boolean
  connected:     boolean
  obs_connected: boolean
  current_scene: string | null
  last_seen:     number
  agent_version: string
  scene_bindings:  SceneBind[]
  source_bindings: SourceBind[]
  arg_commands:    Record<string, string>
  screenshots:     boolean
  bitrate_kbps:    number | null
  streaming:       boolean
  congested:       boolean
  // broadcaster only
  enabled?:                 boolean
  screenshot_interval_sec?: number
  ws_host?:                 string
  ws_port?:                 number
}

interface SceneInfo { sceneName: string; sceneIndex: number }
interface SourceInfo {
  sceneItemId:   number
  sourceName:    string
  visible:       boolean
  isAudioSource: boolean
  muted?:        boolean
  volumePercent?: number
}
interface SceneBind  { command: string; scene: string }
interface SourceBind { command: string; source: string; action: string; value?: number }

const SOURCE_ACTIONS = [
  { value: 'show',        label: 'show' },
  { value: 'hide',        label: 'hide' },
  { value: 'toggle',      label: 'toggle' },
  { value: 'mute',        label: 'mute' },
  { value: 'unmute',      label: 'unmute' },
  { value: 'mutetoggle',  label: 'toggle mute' },
  { value: 'volume',      label: 'set volume' },
]

// ─── state ────────────────────────────────────────────────────────────────────

const loading       = ref(true)
const agentStatus   = ref<AgentStatus | null>(null)

const scenes        = ref<SceneInfo[]>([])
const selectedScene = ref('')
const sources       = ref<SourceInfo[]>([])
const sourcesLoading = ref(false)

// screenshot per scene name
const shots        = ref<Record<string, string | null>>({})
const shotPending  = ref<Record<string, boolean>>({})
const lastShotKb   = ref<Record<string, number>>({})
const lastShotCpuMs = ref<Record<string, number | null>>({})

// bindings state
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

// arg command edit fields - one per supported action kind
const argSceneCmd  = ref('')
const argVolCmd    = ref('')
const argMuteCmd   = ref('')
const argShowCmd   = ref('')

// known source names for datalist autocomplete
const knownSources = ref<string[]>([])
watch(sources, list => {
  for (const s of list) if (!knownSources.value.includes(s.sourceName)) knownSources.value.push(s.sourceName)
})

// config panel
const configOpen     = ref(false)
const settings       = ref({ enabled: false, screenshots: true, screenshot_interval_sec: 5, ws_host: '127.0.0.1', ws_port: 4455 })
const settingsSaving = ref(false)
const settingsSaved  = ref(false)

// token
const token           = ref('')
const tokenVisible    = ref(false)
const generatingToken = ref(false)
const tokenCopied     = ref(false)

// volume inline editor
const editingVol  = ref<string | null>(null)
const editVolVal  = ref(50)

let pollTimer:       ReturnType<typeof setInterval> | null = null
let screenshotTimer: ReturnType<typeof setInterval> | null = null

// ─── computed ─────────────────────────────────────────────────────────────────

const authHeaders = computed<Record<string, string>>(() => {
  const headers: Record<string, string> = {}
  if (session.value) headers.Authorization = `Bearer ${session.value.token}`
  return headers
})
const isBroadcaster = computed(() =>
  session.value?.login?.toLowerCase() === session.value?.channel?.toLowerCase()
)
const canEdit = computed(() =>
  isBroadcaster.value || (channelRole.value?.permissions?.obs_edit ?? false)
)
const agentOk = computed(() => agentStatus.value?.connected && agentStatus.value?.obs_connected)
const currentScene = computed(() => agentStatus.value?.current_scene ?? '')
const statusLabel  = computed(() => {
  const s = agentStatus.value
  if (!s?.paired)        return 'not set up'
  if (!s.connected)      return 'agent offline'
  if (!s.obs_connected)  return 'agent online - OBS not connected'
  return 'ready'
})
const statusClass = computed(() => {
  const s = agentStatus.value
  if (!s?.paired)       return 'st-none'
  if (!s.connected)     return 'st-offline'
  if (!s.obs_connected) return 'st-partial'
  return 'st-ready'
})

// ─── load / poll ─────────────────────────────────────────────────────────────

async function load() {
  if (!session.value) return
  loading.value = true
  try {
    const res = await fetch(`${API}/obs/${session.value.channel}`, { headers: authHeaders.value })
    if (res.ok) {
      const d = await res.json() as AgentStatus
      applyStatus(d)
    }
  } catch {}
  loading.value = false
  if (agentOk.value) refreshScenes()
}

function applyStatus(d: AgentStatus) {
  agentStatus.value    = d
  sceneBindings.value  = d.scene_bindings  ?? []
  sourceBindings.value = d.source_bindings ?? []
  argCommands.value    = d.arg_commands    ?? {}
  argSceneCmd.value    = argCommands.value['scene']      ?? ''
  argVolCmd.value      = argCommands.value['volume']     ?? ''
  argMuteCmd.value     = argCommands.value['mutetoggle'] ?? ''
  argShowCmd.value     = argCommands.value['toggle']     ?? ''
  if (isBroadcaster.value && d.enabled !== undefined) {
    settings.value = {
      enabled:                d.enabled ?? false,
      screenshots:            d.screenshots ?? true,
      screenshot_interval_sec: d.screenshot_interval_sec ?? 5,
      ws_host:                d.ws_host ?? '127.0.0.1',
      ws_port:                d.ws_port ?? 4455,
    }
  } else {
    settings.value.screenshots = d.screenshots ?? true
  }
}

async function poll() {
  if (!session.value) return
  try {
    const res = await fetch(`${API}/obs/${session.value.channel}`, { headers: authHeaders.value })
    if (res.ok) {
      const d = await res.json() as AgentStatus
      agentStatus.value = d
      if (isBroadcaster.value && d.enabled !== undefined) {
        settings.value.screenshots = d.screenshots ?? true
        settings.value.screenshot_interval_sec = d.screenshot_interval_sec ?? 5
      } else {
        settings.value.screenshots = d.screenshots ?? true
      }
    }
  } catch {}
}

// ─── scenes ──────────────────────────────────────────────────────────────────

async function refreshScenes() {
  if (!session.value) return
  try {
    const res = await fetch(`${API}/obs/${session.value.channel}/scenes`, { headers: authHeaders.value })
    if (!res.ok) return
    const d = await res.json() as { scenes: SceneInfo[]; currentScene: string }
    scenes.value = d.scenes
    if (agentStatus.value) agentStatus.value.current_scene = d.currentScene
    if (!selectedScene.value && scenes.value[0]) {
      selectedScene.value = scenes.value[0].sceneName
      loadSources(scenes.value[0].sceneName)
    }
    if (settings.value.screenshots) {
      for (const s of scenes.value) fetchShot(s.sceneName)
    }
  } catch {}
}

async function switchScene(name: string) {
  if (!session.value || !canEdit.value) return
  try {
    await fetch(`${API}/obs/${session.value.channel}/scene`, {
      method: 'POST',
      headers: { ...authHeaders.value, 'Content-Type': 'application/json' },
      body: JSON.stringify({ name }),
    })
    if (agentStatus.value) agentStatus.value.current_scene = name
  } catch {}
}

// ─── screenshot ───────────────────────────────────────────────────────────────

async function fetchShot(sceneName: string) {
  if (!session.value || !settings.value.screenshots) return
  if (shotPending.value[sceneName]) return
  shotPending.value = { ...shotPending.value, [sceneName]: true }
  try {
    const res = await fetch(
      `${API}/obs/${session.value.channel}/screenshot?scene=${encodeURIComponent(sceneName)}`,
      { headers: authHeaders.value }
    )
    if (res.ok) {
      const d = await res.json() as { imageData: string | null; kb?: number; cpuMs?: number | null }
      if (d.imageData) shots.value = { ...shots.value, [sceneName]: d.imageData }
      if (d.kb    !== undefined) lastShotKb.value    = { ...lastShotKb.value,    [sceneName]: d.kb }
      if (d.cpuMs !== undefined) lastShotCpuMs.value = { ...lastShotCpuMs.value, [sceneName]: d.cpuMs ?? null }
    }
  } catch {}
  shotPending.value = { ...shotPending.value, [sceneName]: false }
}

function startShotPolling() {
  stopShotPolling()
  if (!settings.value.screenshots || !scenes.value.length) return
  const intervalMs = Math.max(3000, (settings.value.screenshot_interval_sec ?? 5) * 1000)
  screenshotTimer = setInterval(() => {
    if (!agentOk.value || !settings.value.screenshots) return
    // only refresh the current scene and the selected one to keep load low
    const toFetch = [...new Set([currentScene.value, selectedScene.value].filter(Boolean))]
    for (const s of toFetch) fetchShot(s)
  }, intervalMs)
}

function stopShotPolling() {
  if (screenshotTimer) { clearInterval(screenshotTimer); screenshotTimer = null }
}

watch(() => settings.value.screenshots, v => { if (v && agentOk.value) startShotPolling(); else stopShotPolling() })
watch(agentOk, v => { if (v) { refreshScenes(); if (settings.value.screenshots) startShotPolling() } else stopShotPolling() })
// keep currentScene in sync when polled status updates - no click needed
watch(() => agentStatus.value?.current_scene, (scene) => {
  if (scene && scenes.value.length === 0) refreshScenes()
})

// ─── sources ─────────────────────────────────────────────────────────────────

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

async function toggleVisible(src: SourceInfo) {
  if (!session.value || !canEdit.value) return
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

async function toggleMute(src: SourceInfo & { muted?: boolean }) {
  if (!session.value || !canEdit.value) return
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

function openVol(src: SourceInfo) {
  editingVol.value = src.sourceName
  editVolVal.value = src.volumePercent ?? 100
}

async function applyVol(src: SourceInfo) {
  if (!session.value || !canEdit.value) return
  try {
    await fetch(`${API}/obs/${session.value.channel}/source/volume`, {
      method: 'POST',
      headers: { ...authHeaders.value, 'Content-Type': 'application/json' },
      body: JSON.stringify({ source: src.sourceName, percent: editVolVal.value }),
    })
    src.volumePercent = editVolVal.value
  } catch {}
  editingVol.value = null
}

// ─── bindings ─────────────────────────────────────────────────────────────────

function addSceneBind() {
  const cmd = newSceneCmd.value.trim().replace(/^\+/, '').toLowerCase()
  if (!cmd || !newSceneTarget.value) return
  if (sceneBindings.value.some(b => b.command === cmd)) return
  sceneBindings.value.push({ command: cmd, scene: newSceneTarget.value })
  newSceneCmd.value = ''; newSceneTarget.value = ''
  bindingsDirty.value = true
}
function removeSceneBind(i: number) { sceneBindings.value.splice(i, 1); bindingsDirty.value = true }

function addSourceBind() {
  const cmd = newSourceCmd.value.trim().replace(/^\+/, '').toLowerCase()
  if (!cmd || !newSourceTarget.value) return
  if (sourceBindings.value.some(b => b.command === cmd)) return
  const entry: SourceBind = { command: cmd, source: newSourceTarget.value, action: newSourceAction.value }
  if (newSourceAction.value === 'volume') entry.value = newSourceValue.value
  sourceBindings.value.push(entry)
  newSourceCmd.value = ''; newSourceTarget.value = ''
  bindingsDirty.value = true
}
function removeSourceBind(i: number) { sourceBindings.value.splice(i, 1); bindingsDirty.value = true }

function markArgDirty() { bindingsDirty.value = true }

async function saveBindings() {
  if (!session.value) return
  bindingsSaving.value = true
  // rebuild arg_commands from the individual input fields
  const arg: Record<string, string> = {}
  if (argSceneCmd.value.trim())  arg['scene']      = argSceneCmd.value.trim().replace(/^\+/, '')
  if (argVolCmd.value.trim())    arg['volume']      = argVolCmd.value.trim().replace(/^\+/, '')
  if (argMuteCmd.value.trim())   arg['mutetoggle']  = argMuteCmd.value.trim().replace(/^\+/, '')
  if (argShowCmd.value.trim())   arg['toggle']      = argShowCmd.value.trim().replace(/^\+/, '')
  try {
    await fetch(`${API}/obs/${session.value.channel}/bindings`, {
      method: 'PUT',
      headers: { ...authHeaders.value, 'Content-Type': 'application/json' },
      body: JSON.stringify({ scene_bindings: sceneBindings.value, source_bindings: sourceBindings.value, arg_commands: arg }),
    })
    argCommands.value   = arg
    bindingsDirty.value = false
    bindingsSaved.value  = true
    setTimeout(() => { bindingsSaved.value = false }, 2000)
  } catch {}
  bindingsSaving.value = false
}

// ─── settings (broadcaster only) ─────────────────────────────────────────────

async function saveSettings() {
  if (!session.value || !isBroadcaster.value) return
  settingsSaving.value = true
  try {
    await fetch(`${API}/obs/${session.value.channel}/settings`, {
      method: 'PUT',
      headers: { ...authHeaders.value, 'Content-Type': 'application/json' },
      body: JSON.stringify(settings.value),
    })
    settingsSaved.value = true
    setTimeout(() => { settingsSaved.value = false }, 2000)
  } catch {}
  settingsSaving.value = false
}

// ─── token ────────────────────────────────────────────────────────────────────

async function generateToken() {
  if (!session.value || !isBroadcaster.value) return
  generatingToken.value = true
  try {
    const res = await fetch(`${API}/obs/${session.value.channel}/token`, {
      method: 'POST', headers: authHeaders.value,
    })
    if (res.ok) {
      token.value        = (await res.json() as { token: string }).token
      tokenVisible.value = true
    }
  } catch {}
  generatingToken.value = false
}

async function copyToken() {
  await navigator.clipboard.writeText(token.value).catch(() => {})
  tokenCopied.value = true
  setTimeout(() => { tokenCopied.value = false }, 2000)
}

const canForcePreview = computed(() =>
  agentOk.value &&
  settings.value.screenshots &&
  (isBroadcaster.value || (channelRole.value?.permissions?.obs_force_preview ?? false))
)

const forcingPreviews = ref(false)
const forcePreviewError = ref('')

async function forceAllPreviews() {
  if (!session.value || !canForcePreview.value) return
  forcingPreviews.value = true
  forcePreviewError.value = ''
  try {
    const res = await fetch(`${API}/obs/${session.value.channel}/projector`, {
      method: 'POST',
      headers: { ...authHeaders.value, 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    })
    if (!res.ok) {
      const d = await res.json().catch(() => ({})) as any
      forcePreviewError.value = d?.error ?? `Error ${res.status}`
    }
  } catch (e: any) {
    forcePreviewError.value = e?.message ?? 'Request failed'
  }
  forcingPreviews.value = false
  if (forcePreviewError.value) setTimeout(() => { forcePreviewError.value = '' }, 4000)
}

onMounted(() => {
  load()
  pollTimer = setInterval(async () => {
    await poll()
    if (agentOk.value && scenes.value.length === 0) refreshScenes()
  }, 5000)
})
onUnmounted(() => {
  if (pollTimer)       clearInterval(pollTimer)
  stopShotPolling()
})
watch(() => session.value?.channel, () => load())
</script>

<template>
  <div class="obs-view">

    <!-- header row -->
    <div class="ep-view-header">
      <div class="ep-view-header-left">
        <div class="ep-view-title">OBS Control</div>
        <div class="ep-view-sub">#{{ session?.channel }}</div>
        <!-- status chip -->
        <div class="obs-status-chip" :class="statusClass">
          <span class="obs-status-dot"></span>
          {{ statusLabel }}
          <span v-if="agentStatus?.agent_version" class="obs-status-ver">v{{ agentStatus.agent_version }}</span>
        </div>
      </div>
      <div class="ep-view-header-right">
        <button v-if="agentOk" class="ep-btn-action edit" @click="refreshScenes">refresh</button>
        <button class="ep-btn-action edit" @click="configOpen = !configOpen">
          {{ configOpen ? 'close config' : 'config' }}
        </button>
      </div>
    </div>

    <!-- config side panel (broadcaster only) -->
    <div v-if="configOpen" class="obs-config-panel">
      <div class="obs-config-title">Setup</div>

      <!-- pairing token section -->
      <div class="ep-field-group">
        <label class="ep-field-label">Pairing token</label>
        <template v-if="isBroadcaster">
          <button class="ep-btn-new" :disabled="generatingToken" @click="generateToken" style="margin-bottom:6px">
            {{ generatingToken ? 'generating...' : agentStatus?.paired ? 'regenerate token' : 'generate token' }}
          </button>
          <div v-if="tokenVisible && token" class="obs-token-box">
            <code class="obs-token-val">{{ token }}</code>
            <button class="ep-btn-action edit" @click="copyToken">{{ tokenCopied ? 'copied!' : 'copy' }}</button>
            <button class="ep-btn-cancel" @click="tokenVisible = false; token = ''">done</button>
            <div class="obs-token-warn">Copy this now - it cannot be shown again. Regenerating disconnects the current agent.</div>
          </div>
          <div v-else-if="agentStatus?.paired && !token" class="obs-hint">
            Token is set. Regenerate to replace (disconnects current agent).
          </div>
        </template>
        <div v-else class="obs-hint">Ask your broadcaster to generate a token.</div>
      </div>

      <!-- agent download -->
      <div class="ep-field-group">
        <label class="ep-field-label">Agent app</label>
        <div class="ep-field-hint" style="margin-bottom:6px">Runs on your streaming PC next to OBS. Requires Node.js.</div>
        <div class="obs-dl-row">
          <a class="ep-btn-cancel" :href="`${API}/agent/download/windows`" target="_blank" rel="noopener">Windows (.zip)</a>
          <a class="ep-btn-cancel" :href="`${API}/agent/download/linux`"   target="_blank" rel="noopener">Linux (.tar.gz)</a>
        </div>
        <div class="obs-hint" style="margin-top:4px">Extract, run start.bat or start.sh. No installer, no .exe.</div>
      </div>

      <!-- connection settings (broadcaster only) -->
      <template v-if="isBroadcaster">
        <div class="ep-field-group">
          <label class="ep-field-label">Connection</label>
          <div class="obs-settings-rows">
            <div class="obs-settings-row">
              <span class="obs-settings-lbl">Enabled</span>
              <input type="checkbox" v-model="settings.enabled" />
            </div>
            <div class="obs-settings-row">
              <span class="obs-settings-lbl">Screenshots</span>
              <input type="checkbox" v-model="settings.screenshots" />
            </div>
            <div class="obs-settings-row" v-if="settings.screenshots">
              <span class="obs-settings-lbl">Interval (s)</span>
              <input type="number" v-model.number="settings.screenshot_interval_sec" min="2" max="60" class="ep-field-input obs-small-input" />
            </div>
          </div>
        </div>
        <button class="ep-btn-save" :disabled="settingsSaving" @click="saveSettings" style="align-self:flex-start">
          {{ settingsSaved ? 'saved' : settingsSaving ? '...' : 'save settings' }}
        </button>
      </template>
    </div>

    <!-- not set up yet -->
    <div v-if="!agentStatus?.paired && !loading" class="obs-not-paired">
      Open config above to generate a pairing token and download the agent.
    </div>

    <!-- live controls -->
    <template v-if="agentOk">

      <!-- scene grid -->
      <div class="ep-field-group">
        <div class="ep-field-label obs-section-hd">
          Scenes
          <span class="ep-field-hint">click to switch</span>
          <button class="obs-sm-btn" @click="refreshScenes">refresh</button>
          <button
            v-if="canForcePreview"
            class="obs-sm-btn obs-force-btn"
            :disabled="forcingPreviews"
            @click="forceAllPreviews"
            title="Open a floating OBS window showing the full program mix"
          >{{ forcingPreviews ? '...' : 'force preview' }}</button>
          <span v-if="forcePreviewError" class="obs-force-err">{{ forcePreviewError }}</span>
        </div>
        <div class="obs-scene-grid">
          <div
            v-for="s in scenes"
            :key="s.sceneName"
            class="obs-scene-card"
            :class="{
              active:  s.sceneName === currentScene,
              picked:  s.sceneName === selectedScene,
              loading: shotPending[s.sceneName],
            }"
            @click="switchScene(s.sceneName); loadSources(s.sceneName)"
          >
            <!-- screenshot thumb -->
            <div class="obs-thumb">
              <img v-if="shots[s.sceneName]" :src="shots[s.sceneName]!" class="obs-thumb-img" />
              <div v-else-if="shotPending[s.sceneName]" class="obs-thumb-ph">...</div>
              <div v-else-if="settings.screenshots" class="obs-thumb-ph obs-thumb-click" @click.stop="fetchShot(s.sceneName)">
                <svg viewBox="0 0 16 16" fill="none"><path d="M8 3v10M3 8h10" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>
              </div>
              <div v-else class="obs-thumb-ph obs-thumb-no-shot">
                <svg viewBox="0 0 16 16" fill="none"><rect x="1" y="3" width="14" height="10" rx="1.5" stroke="currentColor" stroke-width="1.2"/><path d="M6 7h4M8 5v4" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/></svg>
              </div>
              <div v-if="s.sceneName === currentScene" class="obs-live-badge">
                <span class="obs-live-dot"></span>live
                <span v-if="agentStatus?.bitrate_kbps != null" class="obs-live-stat" :class="{ 'obs-live-congested': agentStatus.congested }">{{ agentStatus.bitrate_kbps }}<span class="obs-live-unit">kbps</span></span>
                <span v-if="lastShotKb[s.sceneName]" class="obs-live-stat obs-live-kb">{{ lastShotKb[s.sceneName] }}<span class="obs-live-unit">KB</span></span>
                <span v-if="lastShotCpuMs[s.sceneName] != null" class="obs-live-stat obs-live-ms">{{ lastShotCpuMs[s.sceneName] }}<span class="obs-live-unit">ms</span></span>
              </div>
            </div>
            <div class="obs-scene-label">{{ s.sceneName }}</div>
          </div>
          <div v-if="!scenes.length" class="ep-empty">
            <button class="ep-btn-cancel" @click="refreshScenes">load scenes</button>
          </div>
        </div>
      </div>

      <!-- sources for selected scene -->
      <div v-if="selectedScene" class="ep-field-group">
        <label class="ep-field-label obs-section-hd">
          Sources
          <span class="ep-field-hint">{{ selectedScene }}</span>
          <button class="obs-sm-btn" @click="loadSources(selectedScene)">refresh</button>
        </label>
        <div class="obs-source-list">
          <div v-for="src in (sources as any[])" :key="src.sceneItemId" class="obs-source-row">
            <span class="obs-source-name">{{ src.sourceName }}</span>
            <button
              class="obs-src-btn"
              :class="{ on: src.visible }"
              :disabled="!canEdit"
              @click="toggleVisible(src)"
            >{{ src.visible ? 'visible' : 'hidden' }}</button>
            <template v-if="src.isAudioSource">
              <button
                class="obs-src-btn mute-btn"
                :class="{ muted: src.muted }"
                :disabled="!canEdit"
                @click="toggleMute(src)"
              >{{ src.muted ? 'muted' : 'live' }}</button>
              <button class="obs-vol-badge" :disabled="!canEdit" @click="openVol(src)">
                {{ src.volumePercent ?? '?' }}%
              </button>
            </template>
            <!-- inline volume slider -->
            <div v-if="editingVol === src.sourceName" class="obs-vol-row">
              <input type="range" min="0" max="100" v-model.number="editVolVal" class="obs-vol-slider" />
              <span class="obs-vol-num">{{ editVolVal }}%</span>
              <button class="ep-btn-save" @click="applyVol(src)">set</button>
              <button class="ep-btn-cancel" @click="editingVol = null">cancel</button>
            </div>
          </div>
          <div v-if="!sources.length && !sourcesLoading" class="ep-empty">no sources in this scene</div>
          <div v-if="sourcesLoading" class="ep-empty">loading...</div>
        </div>
      </div>

    </template>

    <!-- offline hint when paired but not connected -->
    <div v-else-if="agentStatus?.paired && !loading" class="obs-offline-hint">
      {{ !agentStatus.connected ? 'Agent is offline - launch start.bat on your streaming PC.' : 'Agent is online but OBS is not connected. Make sure OBS is open with WebSocket enabled.' }}
    </div>

    <!-- command bindings - always shown once paired so they can be set up while offline -->
    <template v-if="agentStatus?.paired">

      <!-- arg-based generic commands -->
      <div class="ep-field-group">
        <label class="ep-field-label obs-section-hd">
          Generic commands
          <span class="ep-field-hint">command + argument, e.g. +scene gaming</span>
        </label>
        <div class="obs-arg-list">
          <div class="obs-arg-row">
            <span class="obs-bind-prefix">+</span>
            <input v-model="argSceneCmd"  class="ep-field-input obs-bind-cmd" placeholder="scene" @input="markArgDirty" />
            <span class="obs-bind-desc">scene name - switches to any scene by name</span>
          </div>
          <div class="obs-arg-row">
            <span class="obs-bind-prefix">+</span>
            <input v-model="argVolCmd"    class="ep-field-input obs-bind-cmd" placeholder="volume" @input="markArgDirty" />
            <span class="obs-bind-desc">source + value - e.g. +volume mic 80</span>
          </div>
          <div class="obs-arg-row">
            <span class="obs-bind-prefix">+</span>
            <input v-model="argMuteCmd"   class="ep-field-input obs-bind-cmd" placeholder="mutetoggle" @input="markArgDirty" />
            <span class="obs-bind-desc">source name - toggles mute on that source</span>
          </div>
          <div class="obs-arg-row">
            <span class="obs-bind-prefix">+</span>
            <input v-model="argShowCmd"   class="ep-field-input obs-bind-cmd" placeholder="toggle" @input="markArgDirty" />
            <span class="obs-bind-desc">source name - toggles visibility</span>
          </div>
        </div>
      </div>

      <!-- fixed scene bindings -->
      <div class="ep-field-group">
        <label class="ep-field-label obs-section-hd">
          Scene commands
          <span class="ep-field-hint">fixed command to fixed scene</span>
        </label>
        <div class="obc-bind-list">
          <div v-for="(b, i) in sceneBindings" :key="'sc'+i" class="obc-bind-row">
            <span class="obs-bind-prefix">+</span>
            <input v-model="b.command" class="ep-field-input ep-mono obs-bind-cmd" @input="bindingsDirty = true" />
            <span class="obc-bind-arrow">to</span>
            <select v-model="b.scene" class="ep-field-select obs-bind-target" @change="bindingsDirty = true">
              <option v-for="s in scenes" :key="s.sceneName" :value="s.sceneName">{{ s.sceneName }}</option>
              <option v-if="!scenes.some(s => s.sceneName === b.scene)" :value="b.scene">{{ b.scene }}</option>
            </select>
            <button class="ep-btn-delete" @click="removeSceneBind(i)">x</button>
          </div>
        </div>
        <div class="obs-add-row">
          <span class="obs-bind-prefix">+</span>
          <input v-model="newSceneCmd" class="ep-field-input ep-mono obs-bind-cmd" placeholder="command" />
          <span class="obc-bind-arrow">to</span>
          <select v-model="newSceneTarget" class="ep-field-select obs-bind-target">
            <option value="" disabled>pick scene</option>
            <option v-for="s in scenes" :key="s.sceneName" :value="s.sceneName">{{ s.sceneName }}</option>
          </select>
          <button class="ep-btn-new" :disabled="!newSceneCmd || !newSceneTarget" @click="addSceneBind">add</button>
        </div>
      </div>

      <!-- fixed source bindings -->
      <div class="ep-field-group">
        <label class="ep-field-label obs-section-hd">
          Source commands
          <span class="ep-field-hint">fixed command to fixed action on a source</span>
        </label>
        <div class="obc-bind-list">
          <div v-for="(b, i) in sourceBindings" :key="'so'+i" class="obc-bind-row">
            <span class="obs-bind-prefix">+</span>
            <input v-model="b.command" class="ep-field-input ep-mono obs-bind-cmd" @input="bindingsDirty = true" />
            <span class="obc-bind-arrow">to</span>
            <input v-model="b.source" list="obs-src-names" class="ep-field-input obs-bind-target" @input="bindingsDirty = true" />
            <select v-model="b.action" class="ep-field-select" @change="bindingsDirty = true">
              <option v-for="a in SOURCE_ACTIONS" :key="a.value" :value="a.value">{{ a.label }}</option>
            </select>
            <input v-if="b.action === 'volume'" v-model.number="b.value" type="number" min="0" max="100" class="ep-field-input obs-bind-vol" @input="bindingsDirty = true" />
            <button class="ep-btn-delete" @click="removeSourceBind(i)">x</button>
          </div>
        </div>
        <div class="obs-add-row">
          <span class="obs-bind-prefix">+</span>
          <input v-model="newSourceCmd" class="ep-field-input ep-mono obs-bind-cmd" placeholder="command" />
          <span class="obc-bind-arrow">to</span>
          <input v-model="newSourceTarget" list="obs-src-names" class="ep-field-input obs-bind-target" placeholder="source name" />
          <select v-model="newSourceAction" class="ep-field-select">
            <option v-for="a in SOURCE_ACTIONS" :key="a.value" :value="a.value">{{ a.label }}</option>
          </select>
          <input v-if="newSourceAction === 'volume'" v-model.number="newSourceValue" type="number" min="0" max="100" class="ep-field-input obs-bind-vol" />
          <button class="ep-btn-new" :disabled="!newSourceCmd || !newSourceTarget" @click="addSourceBind">add</button>
        </div>
        <datalist id="obs-src-names">
          <option v-for="n in knownSources" :key="n" :value="n" />
        </datalist>
      </div>

      <!-- save bar -->
      <div class="obs-save-bar">
        <span v-if="bindingsDirty" class="obs-unsaved">unsaved changes</span>
        <button
          class="ep-btn-save"
          :class="{ saved: bindingsSaved }"
          :disabled="bindingsSaving || !bindingsDirty"
          @click="saveBindings"
        >{{ bindingsSaved ? 'saved' : bindingsSaving ? '...' : 'save commands' }}</button>
      </div>

    </template>

  </div>
</template>

<style scoped>
.obs-view {
  display: flex; flex-direction: column; gap: 0;
  padding: 20px 24px; max-width: 1100px;
}

/* header */
.ep-view-header      { display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 10px; margin-bottom: 20px; }
.ep-view-header-left { display: flex; align-items: center; gap: 12px; flex-wrap: wrap; }
.ep-view-title       { font-size: 15px; font-weight: 700; color: #e0e0e0; }
.ep-view-sub         { font-size: 11px; color: #555; }
.ep-view-header-right { display: flex; gap: 6px; flex-shrink: 0; }

/* status chip */
.obs-status-chip {
  display: flex; align-items: center; gap: 6px;
  font-size: 10px; font-weight: 600; text-transform: uppercase; letter-spacing: .04em;
  padding: 3px 8px; border: 1px solid; flex-shrink: 0;
}
.obs-status-dot { width: 6px; height: 6px; border-radius: 50%; flex-shrink: 0; }
.obs-status-ver { font-size: 9px; font-weight: 400; opacity: .6; margin-left: 2px; }

.st-none    { color: #444; border-color: #2a2a30; }
.st-none    .obs-status-dot { background: #333; }
.st-offline { color: #777; border-color: #2a2a3088; }
.st-offline .obs-status-dot { background: #555; }
.st-partial { color: #e5c07b; border-color: #e5c07b44; background: #e5c07b08; }
.st-partial .obs-status-dot { background: #e5c07b; }
.st-ready   { color: #23d18b; border-color: #23d18b44; background: #23d18b08; }
.st-ready   .obs-status-dot { background: #23d18b; animation: pulse 2s ease-in-out infinite; }

@keyframes pulse { 0%, 100% { opacity: 1; } 50% { opacity: .35; } }

/* config panel */
.obs-config-panel {
  display: flex; flex-direction: column; gap: 16px;
  padding: 16px; margin-bottom: 20px;
  border: 1px solid #2a2a30; background: #0d0d10;
}
.obs-config-title { font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: .06em; color: #555; }

.obs-token-box {
  padding: 8px; background: #0a0a0d; border: 1px solid #6f2bff44;
  display: flex; flex-wrap: wrap; gap: 6px; align-items: flex-start; margin-top: 6px;
}
.obs-token-val { font-family: 'Consolas','Fira Mono',monospace; font-size: 11px; color: #c4a0ff; flex: 1; min-width: 0; word-break: break-all; }
.obs-token-warn { width: 100%; font-size: 10px; color: #e5c07b; flex-basis: 100%; line-height: 1.5; }
.obs-hint { font-size: 11px; color: #555; margin-top: 4px; }
.obs-dl-row { display: flex; gap: 8px; flex-wrap: wrap; }

.obs-settings-rows { display: flex; flex-direction: column; gap: 6px; margin-top: 4px; }
.obs-settings-row  { display: flex; align-items: center; gap: 10px; }
.obs-settings-lbl  { width: 100px; font-size: 11px; color: #777; flex-shrink: 0; }
.obs-settings-row input[type="checkbox"] { accent-color: #6f2bff; width: 14px; height: 14px; cursor: pointer; }
.obs-small-input   { width: 80px; }

/* section header */
.obs-section-hd { display: flex; align-items: center; gap: 8px; }
.obs-sm-btn {
  height: 18px; padding: 0 8px; border: 1px solid #2a2a30; background: transparent;
  color: #555; font-family: inherit; font-size: 10px; cursor: pointer;
}
.obs-sm-btn:hover { color: #aaa; border-color: #444; }
.obs-force-btn { border-color: #6f2bff44; color: #9d6cff; }
.obs-force-btn:hover:not(:disabled) { border-color: #9d6cff; background: #6f2bff14; }
.obs-force-btn:disabled { opacity: .4; cursor: default; }
.obs-force-err { font-size: 10px; color: #f14949; margin-left: 4px; }

/* scene grid */
.obs-scene-grid {
  display: grid; grid-template-columns: repeat(auto-fill, minmax(140px, 1fr)); gap: 10px; margin-top: 4px;
}
.obs-scene-card {
  width: 180px; flex-shrink: 0; cursor: pointer;
  border: 1px solid #2a2a30; background: #111217;
  transition: border-color .15s;
}
.obs-scene-card:hover  { border-color: #3a3a44; }
.obs-scene-card.active { border-color: #6f2bff; }
.obs-scene-card.picked:not(.active) { border-color: #2a2a42; }

.obs-thumb {
  width: 100%; height: 101px; background: #0a0a0e;
  position: relative; display: flex; align-items: center; justify-content: center; overflow: hidden;
}
.obs-thumb-img   { width: 100%; height: 100%; object-fit: cover; display: block; }
.obs-thumb-ph    { font-size: 10px; color: #333; display: flex; align-items: center; justify-content: center; width: 100%; height: 100%; }
.obs-thumb-ph svg { width: 20px; height: 20px; }
.obs-thumb-click { cursor: pointer; }
.obs-thumb-click:hover { color: #555; }
.obs-thumb-no-shot { color: #222; }

.obs-live-badge {
  position: absolute; top: 4px; left: 4px;
  display: flex; align-items: center; gap: 4px;
  font-size: 8px; font-weight: 700; letter-spacing: .06em;
  color: #fff; background: rgba(0,0,0,.7); padding: 2px 5px;
  max-width: calc(100% - 8px); overflow: hidden;
}
.obs-live-dot { width: 5px; height: 5px; border-radius: 50%; background: #f14949; flex-shrink: 0; animation: pulse 1.5s ease-in-out infinite; }
.obs-live-stat { color: #aaa; font-size: 8px; font-weight: 400; white-space: nowrap; flex-shrink: 1; overflow: hidden; text-overflow: ellipsis; }
.obs-live-unit { color: #666; margin-left: 1px; }
.obs-live-congested { color: #f14949; font-weight: 700; }
.obs-live-kb  { color: #23d18b; }
.obs-live-ms  { color: #9d6cff; }
.obs-scene-label {
  padding: 5px 8px; font-size: 11px; color: #888;
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
}
.obs-scene-card.active .obs-scene-label { color: #c4a0ff; }

/* sources */
.obs-source-list { display: flex; flex-direction: column; gap: 2px; margin-top: 4px; }
.obs-source-row  {
  display: flex; align-items: center; gap: 6px; flex-wrap: wrap;
  padding: 5px 8px; background: #111217; border: 1px solid #1e1e24;
}
.obs-source-name { flex: 1; font-size: 12px; color: #888; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.obs-src-btn {
  height: 22px; padding: 0 9px; border: 1px solid #2a2a30; background: transparent;
  color: #555; font-family: inherit; font-size: 10px; cursor: pointer; flex-shrink: 0; transition: all .15s;
}
.obs-src-btn:disabled { opacity: .4; cursor: default; }
.obs-src-btn.on       { border-color: #6f2bff55; color: #9d6cff; background: #6f2bff0e; }
.obs-src-btn.muted    { border-color: #f1494944; color: #f14949; background: #f149490a; }
.obs-src-btn:not(:disabled):hover { border-color: #444; color: #aaa; }

.obs-vol-badge {
  height: 22px; padding: 0 8px; border: 1px solid #2a2a30; background: transparent;
  color: #666; font-family: inherit; font-size: 10px; cursor: pointer; flex-shrink: 0;
}
.obs-vol-badge:disabled { opacity: .4; cursor: default; }
.obs-vol-badge:not(:disabled):hover { border-color: #444; color: #aaa; }

.obs-vol-row {
  flex-basis: 100%; display: flex; align-items: center; gap: 8px;
  padding-top: 6px; border-top: 1px solid #1e1e24; margin-top: 2px;
}
.obs-vol-slider { flex: 1; accent-color: #6f2bff; cursor: pointer; }
.obs-vol-num    { font-size: 11px; color: #9d6cff; width: 34px; text-align: right; flex-shrink: 0; }

/* bindings shared */
.obs-bind-prefix { color: #9d6cff; font-weight: 700; font-size: 12px; flex-shrink: 0; }
.obs-bind-cmd    { width: 120px; flex: none; }
.obs-bind-target { width: 150px; flex: none; }
.obs-bind-vol    { width: 64px; flex: none; }
.obc-bind-arrow  { color: #555; font-size: 11px; flex-shrink: 0; }

.obc-bind-list { display: flex; flex-direction: column; gap: 4px; margin-bottom: 8px; }
.obc-bind-row, .obs-add-row { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; padding: 3px 0; }

/* generic arg commands */
.obs-arg-list { display: flex; flex-direction: column; gap: 6px; margin-top: 4px; }
.obs-arg-row  { display: flex; align-items: center; gap: 8px; }
.obs-bind-desc { font-size: 11px; color: #444; flex: 1; }

/* save bar */
.obs-save-bar {
  display: flex; align-items: center; justify-content: flex-end; gap: 12px;
  padding: 12px 0 0; border-top: 1px solid #1e1e24; margin-top: 8px;
}
.obs-unsaved { font-size: 11px; color: #e5c07b; }

/* misc */
.obs-not-paired, .obs-offline-hint {
  font-size: 12px; color: #555; padding: 16px 0; border-top: 1px solid #1e1e24;
}

@media (max-width: 680px) {
  .obs-view        { padding: 14px 14px; }
  .obs-scene-card  { width: calc(50% - 5px); }
  .obs-bind-cmd, .obs-bind-target { width: 100%; }
  .obs-arg-row { flex-wrap: wrap; }
}
</style>
