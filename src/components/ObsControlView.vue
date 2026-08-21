<script setup lang="ts">
// >>> agent-relay model, token-based, no port/password

import { ref, computed, onMounted, onUnmounted, watch } from "vue";
import { useRouter, onBeforeRouteLeave } from "vue-router";
import { API } from "../api";
import { useAuth } from "../auth";
import { useOverlayClose } from "../composables/useOverlayClose";
import EditableNameHeader from "./shared/EditableNameHeader.vue";
import TypeaheadInput from "./shared/TypeaheadInput.vue";
import type { TypeaheadItem } from "./shared/TypeaheadInput.vue";
import ObsOverlayEditor from "./overlay/ObsOverlayEditor.vue";
import { iconSvg as iconSvgFor } from "../composables/icons";

const { session, channelRole } = useAuth();
const router = useRouter();
const settingsOverlay = useOverlayClose();

type AccessLevel = "everyone" | "mod" | "broadcaster";
// >>> old data may be plain string, handle both
type ArgCommandRaw = string | { command: string; access?: AccessLevel };

interface AgentStatus {
  paired: boolean;
  connected: boolean;
  last_seen: number;
  version: string;
  obs_connected: boolean;
  current_scene: string;
  video_mix_projector_open?: boolean;
  video_mix_projector_title?: string | null;
  scene_bindings: SceneBind[];
  source_bindings: SourceBind[];
  arg_commands: Record<string, ArgCommandRaw>;
  rules: ObsRule[];
  bitrate_kbps: number | null;
  congested: boolean;
  streaming: boolean;
  screenshots: boolean;
  hidden_scenes: string[];
  // >>> broadcaster-only, backend omits for others
  enabled?: boolean;
  screenshot_interval_sec?: number;
}

interface SceneInfo {
  sceneName: string;
  sceneIndex: number;
}
interface SourceInfo {
  sceneItemId: number;
  sourceName: string;
  sceneItemEnabled: boolean;
  visible: boolean;
  isAudioSource: boolean;
  inputKind: string | null;
  muted?: boolean;
  volumePercent?: number;
}
interface SceneBind {
  command: string;
  scene: string;
  access?: AccessLevel;
}
interface SourceBind {
  command: string;
  source: string;
  action: string;
  value?: number;
  access?: AccessLevel;
}
interface ArgCommand {
  command: string;
  access: AccessLevel;
}
// >>> runs agent-side, see agent/src/rules.js
interface ObsRule {
  id: string;
  condition: "below" | "above";
  bitrate_kbps: number;
  action: string;
  target: string;
  value?: number;
  enabled: boolean;
}

const ACCESS_CYCLE: AccessLevel[] = ["everyone", "mod", "broadcaster"];
function nextAccess(a: AccessLevel): AccessLevel {
  return ACCESS_CYCLE[(ACCESS_CYCLE.indexOf(a) + 1) % ACCESS_CYCLE.length]!;
}
function accessLabel(a: AccessLevel): string {
  return a === "broadcaster"
    ? "bc only"
    : a === "mod"
      ? "mod only"
      : "everyone";
}

// >>> unified action list for builder
const BUILDER_ACTIONS = [
  { value: "scene", label: "Switch scene", usage: "+<cmd> <scene name>" },
  { value: "show", label: "Show source", usage: "+<cmd> <source name>" },
  { value: "hide", label: "Hide source", usage: "+<cmd> <source name>" },
  {
    value: "toggle",
    label: "Toggle visibility",
    usage: "+<cmd> <source name>",
  },
  { value: "mute", label: "Mute source", usage: "+<cmd> <source name>" },
  { value: "unmute", label: "Unmute source", usage: "+<cmd> <source name>" },
  { value: "mutetoggle", label: "Toggle mute", usage: "+<cmd> <source name>" },
  {
    value: "volume",
    label: "Set volume",
    usage: "+<cmd> <source name> <0-100>",
  },
];
const BUILDER_ACTION_LABEL: Record<string, string> = Object.fromEntries(
  BUILDER_ACTIONS.map((a) => [a.value, a.label]),
);

// vvv state vvv
const loading = ref(false);
const agentStatus = ref<AgentStatus | null>(null);

const token = ref(""); // <<< shown once after (re)generate
const tokenVisible = ref(false);
const tokenRevealed = ref(false); // <<< masked like a password until toggled
const generatingToken = ref(false);
const tokenJustCopied = ref(false);

const scenes = ref<SceneInfo[]>([]);
const selectedScene = ref("");
const sources = ref<SourceInfo[]>([]);
const sourcesLoading = ref(false);

const sceneBindings = ref<SceneBind[]>([]);
const sourceBindings = ref<SourceBind[]>([]);
const argCommands = ref<Record<string, ArgCommand>>({});
const bindingsSaving = ref(false);
const bindingsSaved = ref(false);

// >>> command builder / rule builder tab
const builderView = ref<"command" | "rule">("command");

// >>> rule builder
const rules = ref<ObsRule[]>([]);
const rulesSaving = ref(false);
const rulesSaved = ref(false);
const ruleCondition = ref<"below" | "above">("below");
const ruleBitrate = ref(2500);
const ruleAction = ref("scene");
const ruleTarget = ref("");
const ruleValue = ref(50);
const ruleAddDisabled = computed(() => {
  if (!ruleBitrate.value || ruleBitrate.value <= 0) return true;
  if (!ruleTarget.value.trim()) return true;
  return false;
});

// >>> command builder
const builderAction = ref("scene");
const builderMode = ref<"specific" | "argument">("specific");
const builderVolMode = ref<"both" | "vol_only">("both");
const builderAccess = ref<AccessLevel>("everyone");
const builderCmd = ref("");
const builderTarget = ref("");

const addDisabled = computed(() => {
  if (!builderCmd.value.trim()) return true;
  const needsTarget =
    (builderAction.value !== "volume" && builderMode.value === "specific") ||
    (builderAction.value === "volume" && builderVolMode.value === "vol_only");
  if (needsTarget && !builderTarget.value.trim()) return true;
  const cmd = builderCmd.value.trim().replace(/^\+/, "").toLowerCase();
  if (unifiedCommands.value.some((c) => c.command === cmd)) return true;
  // >>> don't allow names that clash with existing custom commands
  if (existingCmdNames.value.includes(cmd)) return true;
  return false;
});

const knownSources = ref<string[]>([]);
const pendingSources = ref<Set<number>>(new Set());
const existingCmdNames = ref<string[]>([]); // <<< all custom command names for this channel
watch(sources, (list) => {
  for (const s of list)
    if (!knownSources.value.includes(s.sourceName))
      knownSources.value.push(s.sourceName);
});

async function loadExistingCmdNames() {
  if (!session.value) return;
  try {
    const [defRes, customRes] = await Promise.all([
      fetch(`${API}/commands/${session.value.channel}`, {
        headers: authHeaders.value,
      }),
      fetch(`${API}/custom-commands/${session.value.channel}`, {
        headers: authHeaders.value,
      }),
    ]);
    const names: string[] = [];
    if (defRes.ok) {
      const d = (await defRes.json()) as { commands: { name: string }[] };
      names.push(...(d.commands ?? []).map((c) => c.name.toLowerCase()));
    }
    if (customRes.ok) {
      const d = (await customRes.json()) as { commands: { name: string }[] };
      names.push(...(d.commands ?? []).map((c) => c.name.toLowerCase()));
    }
    existingCmdNames.value = names;
  } catch { }
}

// >>> set of known scene/source names for "unknown target" warnings
const knownSceneNames = computed(
  () => new Set(scenes.value.map((s) => s.sceneName)),
);
const knownSourceNames = computed(() => new Set(knownSources.value));

function isTargetMissing(c: UnifiedCommand): boolean {
  if (!obsConnected.value) return false;
  if (c.badgeClass === "arg-type") return false;
  if (c.type === "scene")
    return (
      knownSceneNames.value.size > 0 &&
      !knownSceneNames.value.has(c.targetDisplay)
    );
  if (c.type === "source") {
    const rawTarget = c.targetDisplay
      .replace(/ <vol>$/, "")
      .replace(/ @ \d+%$/, "");
    return (
      knownSourceNames.value.size > 0 && !knownSourceNames.value.has(rawTarget)
    );
  }
  return false;
}

// >>> settings panel (broadcaster only)
const showSettings = ref(false);
const settingsSaving = ref(false);
const settingsSaved = ref(false);
const enabledLocal = ref(true);
const screenshotsLocal = ref(true);
const screenshotIntervalLocal = ref(5);

function openSettings() {
  if (!isBroadcaster.value) return;
  enabledLocal.value = agentStatus.value?.enabled ?? true;
  screenshotsLocal.value = agentStatus.value?.screenshots ?? true;
  screenshotIntervalLocal.value =
    agentStatus.value?.screenshot_interval_sec ?? 5;
  tokenRevealed.value = false;
  showSettings.value = true;
}

async function saveSettings() {
  if (!session.value || !isBroadcaster.value) return;
  settingsSaving.value = true;
  try {
    const res = await fetch(`${API}/obs/${session.value.channel}/settings`, {
      method: "PUT",
      headers: { ...authHeaders.value, "Content-Type": "application/json" },
      body: JSON.stringify({
        enabled: enabledLocal.value,
        screenshots: screenshotsLocal.value,
        screenshot_interval_sec: screenshotIntervalLocal.value,
      }),
    });
    if (res.ok) {
      settingsSaved.value = true;
      setTimeout(() => {
        settingsSaved.value = false;
      }, 2000);
      await load();
      restartShotLoop();
    }
  } catch { }
  settingsSaving.value = false;
}

// >>> scene filter, obs_edit not broadcaster-only
const showFilter = ref(false);
const filterOverlay = useOverlayClose();
const filterSaving = ref(false);

function openFilter() {
  if (!canFilterScenes.value) return;
  showFilter.value = true;
}

async function toggleSceneHidden(sceneName: string) {
  if (!session.value || !canFilterScenes.value) return;
  const current = agentStatus.value?.hidden_scenes ?? [];
  const next = current.includes(sceneName)
    ? current.filter((n) => n !== sceneName)
    : [...current, sceneName];
  if (agentStatus.value) agentStatus.value = { ...agentStatus.value, hidden_scenes: next };
  filterSaving.value = true;
  try {
    await fetch(`${API}/obs/${session.value.channel}/hidden-scenes`, {
      method: "PUT",
      headers: { ...authHeaders.value, "Content-Type": "application/json" },
      body: JSON.stringify({ hidden_scenes: next }),
    });
  } catch { }
  filterSaving.value = false;
}

const sceneShots = ref<Record<string, string>>({});
let shotTimer: ReturnType<typeof setInterval> | null = null;

const liveShotStats = ref<{ cpuMs: number | null; kb: number | null }>({
  cpuMs: null,
  kb: null,
});

const LIVE_SHOT_WIDTH = 1000;
const LIVE_SHOT_QUALITY = 80;
const OTHER_SHOT_WIDTH = 480;
const OTHER_SHOT_QUALITY = 65;

async function refreshScreenshot(sceneName: string, isLive: boolean) {
  if (!session.value || !agentStatus.value?.screenshots) return;
  try {
    const width = isLive ? LIVE_SHOT_WIDTH : OTHER_SHOT_WIDTH;
    const quality = isLive ? LIVE_SHOT_QUALITY : OTHER_SHOT_QUALITY;

    const res = await fetch(
      `${API}/obs/${session.value.channel}/screenshot?scene=${encodeURIComponent(sceneName)}&width=${width}&quality=${quality}`,
      { headers: authHeaders.value },
    );
    if (res.ok) {
      const d = (await res.json()) as {
        imageData: string | null;
        cpuMs?: number | null;
        kb?: number;
      };
      if (d.imageData)
        sceneShots.value = { ...sceneShots.value, [sceneName]: d.imageData };
      // >>> only overwrite stats when real numbers arrive
      if (isLive && (typeof d.cpuMs === "number" || typeof d.kb === "number")) {
        liveShotStats.value = {
          cpuMs:
            typeof d.cpuMs === "number" ? d.cpuMs : liveShotStats.value.cpuMs,
          kb: typeof d.kb === "number" ? d.kb : liveShotStats.value.kb,
        };
      }
    }
  } catch { }
}

async function refreshAllShots() {
  if (!agentConnected.value || !obsConnected.value || !agentStatus.value?.screenshots || previewsPaused.value)
    return;
  // >>> live scene first, hidden scenes skip otherwise
  const live = scenes.value.find((s) => s.sceneName === currentScene.value);
  const rest = scenes.value.filter(
    (s) => s.sceneName !== currentScene.value && !hiddenScenes.value.has(s.sceneName),
  );
  const ordered = live ? [live, ...rest] : rest;
  for (const s of ordered) {
    await refreshScreenshot(s.sceneName, s.sceneName === currentScene.value);
  }
}

function restartShotLoop() {
  if (shotTimer) {
    clearInterval(shotTimer);
    shotTimer = null;
  }
  if (!agentStatus.value?.screenshots || previewsPaused.value) return;
  const intervalMs =
    Math.max(1, agentStatus.value?.screenshot_interval_sec ?? 5) * 1000;
  refreshAllShots(); // <<< don't wait a full interval for the first paint
  shotTimer = setInterval(refreshAllShots, intervalMs);
}

let pollTimer: ReturnType<typeof setInterval> | null = null;
// ^^^ state ^^^

// vvv navigation safety switch vvv
const requestGen = ref(0);
// >>> true the instant we start leaving
const locked = ref(false);

function lockForNavigation() {
  requestGen.value++;
  locked.value = true;
  editMode.value = true; // <<< never carry an armed live-mode into a new channel/page
  pendingSceneName.value = null;
  pendingSourceEdits.value = {};
  pendingCategory.value = null;
}
// ^^^ navigation safety switch ^^^

// vvv live/edit mode + staged changes vvv
const editMode = ref(true); // <<< default: edit mode, nothing applies until Save
const pendingSceneName = ref<string | null>(null);
interface SourceTransform {
  positionX: number;
  positionY: number;
  scaleX: number;
  scaleY: number;
  rotation: number;
}
interface PendingSourceEdit {
  scene: string;
  sceneItemId: number;
  sourceName: string;
  isAudioSource: boolean;
  baseline: {
    visible: boolean;
    muted: boolean;
    volumePercent: number;
    sceneItemIndex: number;
    transform: SourceTransform;
  };
  visible?: boolean;
  muted?: boolean;
  volumePercent?: number;
  sceneItemIndex?: number;
  transform?: SourceTransform;
}
const pendingSourceEdits = ref<Record<string, PendingSourceEdit>>({});
function sourceEditKey(scene: string, sceneItemId: number): string {
  return `${scene} ${sceneItemId}`;
}
function getPendingEdit(src: any, scene: string = selectedScene.value): PendingSourceEdit | undefined {
  return pendingSourceEdits.value[sourceEditKey(scene, src.sceneItemId)];
}
// >>> creates baseline snapshot on first edit only
function stageSourceEdit(
  src: any,
  patch: Partial<Pick<PendingSourceEdit, "visible" | "muted" | "volumePercent" | "sceneItemIndex" | "transform">>,
  scene: string = selectedScene.value,
) {
  const key = sourceEditKey(scene, src.sceneItemId);
  const existing = pendingSourceEdits.value[key];
  const entry: PendingSourceEdit = existing ?? {
    scene,
    sceneItemId: src.sceneItemId,
    sourceName: src.sourceName,
    isAudioSource: !!src.isAudioSource,
    baseline: {
      visible: src.visible ?? src.sceneItemEnabled,
      muted: !!src.muted,
      volumePercent: src.volumePercent ?? 100,
      sceneItemIndex: src.sceneItemIndex,
      transform: {
        positionX: src.positionX ?? 0,
        positionY: src.positionY ?? 0,
        scaleX: src.scaleX ?? 1,
        scaleY: src.scaleY ?? 1,
        rotation: src.rotation ?? 0,
      },
    },
  };
  pendingSourceEdits.value = {
    ...pendingSourceEdits.value,
    [key]: { ...entry, ...patch },
  };
}
function transformEq(a: SourceTransform, b: SourceTransform): boolean {
  return (
    a.positionX === b.positionX &&
    a.positionY === b.positionY &&
    a.scaleX === b.scaleX &&
    a.scaleY === b.scaleY &&
    a.rotation === b.rotation
  );
}
function pendingEditIsNoop(e: PendingSourceEdit): boolean {
  return (
    (e.visible === undefined || e.visible === e.baseline.visible) &&
    (e.muted === undefined || e.muted === e.baseline.muted) &&
    (e.volumePercent === undefined || e.volumePercent === e.baseline.volumePercent) &&
    (e.sceneItemIndex === undefined || e.sceneItemIndex === e.baseline.sceneItemIndex) &&
    (e.transform === undefined || transformEq(e.transform, e.baseline.transform))
  );
}
const pendingCategory = ref<{ id: string; name: string; boxArt: string } | null>(
  null,
);

// >>> staged browser sources, no id until save
interface PendingCreate {
  id: string; // <<< client-side only, for :key / removal
  scene: string;
  name: string;
  url: string;
  width: number;
  height: number;
}
const pendingCreates = ref<PendingCreate[]>([]);

const pendingChanges = computed(() => {
  const list: string[] = [];
  if (pendingSceneName.value && pendingSceneName.value !== currentScene.value)
    list.push(`Scene → ${pendingSceneName.value}`);
  for (const e of Object.values(pendingSourceEdits.value)) {
    if (pendingEditIsNoop(e)) continue;
    const label = e.scene === selectedScene.value ? e.sourceName : `${e.sourceName} (${e.scene})`;
    if (e.visible !== undefined && e.visible !== e.baseline.visible)
      list.push(`${label} ${e.visible ? "shown" : "hidden"}`);
    if (e.muted !== undefined && e.muted !== e.baseline.muted)
      list.push(`${label} ${e.muted ? "muted" : "unmuted"}`);
    if (e.volumePercent !== undefined && e.volumePercent !== e.baseline.volumePercent)
      list.push(`${label} volume → ${e.volumePercent}%`);
    if (e.sceneItemIndex !== undefined && e.sceneItemIndex !== e.baseline.sceneItemIndex)
      list.push(`${label} reordered`);
    if (e.transform !== undefined && !transformEq(e.transform, e.baseline.transform))
      list.push(`${label} repositioned`);
  }
  for (const c of pendingCreates.value) list.push(`+ ${c.name}`);
  if (pendingCategory.value && pendingCategory.value.id !== currentCategoryId.value)
    list.push(`Category → ${pendingCategory.value.name}`);
  return list;
});
const hasPending = computed(() => pendingChanges.value.length > 0);

function effectiveVisible(src: any): boolean {
  return getPendingEdit(src)?.visible ?? src.visible;
}
function effectiveMuted(src: any): boolean {
  return getPendingEdit(src)?.muted ?? !!src.muted;
}
function isScenePending(name: string): boolean {
  return (
    editMode.value &&
    pendingSceneName.value === name &&
    name !== currentScene.value
  );
}
function isSourcePending(src: any): boolean {
  if (!editMode.value) return false;
  const e = getPendingEdit(src);
  if (!e) return false;
  return !pendingEditIsNoop(e);
}
function isCategoryPending(categoryId: string): boolean {
  return (
    editMode.value &&
    pendingCategory.value?.id === categoryId &&
    categoryId !== currentCategoryId.value
  );
}

function onSceneClick(name: string) {
  if (locked.value) return;
  if (!editMode.value) {
    switchScene(name);
    return;
  }
  // >>> clicking browses only, doesn't stage a scene switch
  selectedScene.value = name;
  loadSources(name);
}

// >>> explicit switch-on-save, separate from browsing
function stageSceneSwitch(name: string) {
  if (locked.value || !editMode.value) return;
  pendingSceneName.value = pendingSceneName.value === name ? null : name;
}

// >>> one editor for the whole channel, not per-scene
const overlayEditorOpen = ref(false);
const overlayEditorScene = ref("");
// >>> only the editor open pauses previews, not overlay-active
const previewsPaused = computed(() => overlayEditorOpen.value);
watch(previewsPaused, (paused) => {
  if (!paused) restartShotLoop();
});
function openOverlayEditor(sceneName: string) {
  overlayEditorScene.value = sceneName;
  overlayEditorOpen.value = true;
}
function closeOverlayEditor() {
  overlayEditorOpen.value = false;
}

// >>> fixed name lets sources list spot it without a fetch
const OVERLAY_SOURCE_PREFIX = "ShyBoti Overlay - ";
const hasOverlaySource = computed(() =>
  (sources.value as any[]).some((s) => s.sourceName?.startsWith(OVERLAY_SOURCE_PREFIX)),
);
function onSourceRowDblClick(src: any) {
  if (selectedScene.value && String(src.sourceName || "").startsWith(OVERLAY_SOURCE_PREFIX)) {
    openOverlayEditor(selectedScene.value);
  }
}

function onToggleVisible(src: any) {
  if (locked.value) return;
  if (!editMode.value) {
    toggleSourceVisible(src);
    return;
  }
  stageSourceEdit(src, { visible: !effectiveVisible(src) });
}

function onToggleMute(src: any) {
  if (locked.value) return;
  if (!editMode.value) {
    toggleSourceMute(src);
    return;
  }
  stageSourceEdit(src, { muted: !effectiveMuted(src) });
}

function onVolumeCommit(src: any, percent: number) {
  if (locked.value) return;
  if (!editMode.value) {
    onVolumeChange(src, percent);
    return;
  }
  stageSourceEdit(src, { volumePercent: percent });
  const next = { ...sliderOverride.value };
  delete next[src.sceneItemId];
  sliderOverride.value = next;
}

function onCategoryClick(c: CategoryHistoryEntry) {
  if (locked.value) return;
  if (!editMode.value) {
    switchCategory(c.category_id, c.category_name, c.box_art_url);
    return;
  }
  pendingCategory.value = {
    id: c.category_id,
    name: c.category_name,
    boxArt: c.box_art_url,
  };
}

function setMode(next: boolean) {
  if (locked.value || next === editMode.value) return;
  if (next === false && hasPending.value) discardChanges(); // <<< live mode has no staging concept
  editMode.value = next;
  // >>> live mode snaps back to the actual live scene
  if (next === false && currentScene.value && currentScene.value !== selectedScene.value) {
    selectedScene.value = currentScene.value;
    loadSources(currentScene.value);
  }
}

async function saveChanges() {
  if (locked.value || !hasPending.value) return;
  const gen = requestGen.value;
  const tasks: Promise<any>[] = [];
  if (pendingSceneName.value && pendingSceneName.value !== currentScene.value)
    tasks.push(switchScene(pendingSceneName.value));
  for (const e of Object.values(pendingSourceEdits.value)) {
    if (pendingEditIsNoop(e)) continue;
    const ref_ = { sceneItemId: e.sceneItemId, sourceName: e.sourceName };
    if (e.visible !== undefined && e.visible !== e.baseline.visible)
      tasks.push(setSourceVisibility(ref_, e.visible, e.scene));
    if (e.muted !== undefined && e.muted !== e.baseline.muted)
      tasks.push(setSourceMute(ref_, e.muted));
    if (e.volumePercent !== undefined && e.volumePercent !== e.baseline.volumePercent)
      tasks.push(setSourceVolume(ref_, e.volumePercent));
    if (e.sceneItemIndex !== undefined && e.sceneItemIndex !== e.baseline.sceneItemIndex)
      tasks.push(setSourceIndex(ref_, e.sceneItemIndex, e.scene));
    if (e.transform !== undefined && !transformEq(e.transform, e.baseline.transform))
      tasks.push(setSourceTransform(ref_, e.transform, e.scene));
  }
  for (const c of pendingCreates.value)
    tasks.push(createSourceNow(c.scene, c.name, c.url, c.width, c.height));
  if (pendingCategory.value && pendingCategory.value.id !== currentCategoryId.value)
    tasks.push(
      switchCategory(
        pendingCategory.value.id,
        pendingCategory.value.name,
        pendingCategory.value.boxArt,
      ),
    );
  await Promise.all(tasks);
  if (gen === requestGen.value) {
    pendingSceneName.value = null;
    pendingSourceEdits.value = {};
    pendingCreates.value = [];
    pendingCategory.value = null;
  }
}

function discardChanges() {
  pendingSceneName.value = null;
  pendingSourceEdits.value = {};
  pendingCreates.value = [];
  pendingCategory.value = null;
}
// ^^^ live/edit mode + staged changes ^^^

const authHeaders = computed(() =>
  session.value
    ? { Authorization: `Bearer ${session.value.token}` }
    : ({} as Record<string, string>),
);
const isBroadcaster = computed(
  () =>
    session.value?.login?.toLowerCase() ===
    session.value?.channel?.toLowerCase(),
);
const canForcePreview = computed(
  () =>
    !!agentStatus.value?.screenshots &&
    (isBroadcaster.value ||
      channelRole.value?.permissions?.obs_force_preview === true),
);
const canFilterScenes = computed(
  () =>
    isBroadcaster.value || channelRole.value?.permissions?.obs_edit === true,
);
const videoMixProjectorOpen = computed(
  () => !!agentStatus.value?.video_mix_projector_open,
);
const videoMixProjectorTitle = computed(
  () => agentStatus.value?.video_mix_projector_title ?? null,
);

// >>> bitrate badge goes red off OBS's own congestion flag 
const bitrateLabel = computed(() => {
  if (!agentStatus.value?.streaming) return null;
  const kbps = agentStatus.value.bitrate_kbps;
  return kbps == null ? "measuring…" : `${kbps} kbps`;
});
const bitrateBad = computed(
  () => !!agentStatus.value?.streaming && !!agentStatus.value?.congested,
);

// >>> derived
const agentConnected = computed(() => agentStatus.value?.connected ?? false);
const obsConnected = computed(() => agentStatus.value?.obs_connected ?? false);
const currentScene = computed(() => agentStatus.value?.current_scene ?? "");
const hiddenScenes = computed(() => new Set(agentStatus.value?.hidden_scenes ?? []));
// >>> hidden filter doesn't apply to the live scene row
const nonLiveScenes = computed(() =>
  scenes.value.filter(
    (s) => s.sceneName !== currentScene.value && !hiddenScenes.value.has(s.sceneName),
  ),
);

// >>> only live mode follows the actual live scene
watch(currentScene, (name) => {
  if (!name || editMode.value) return;
  selectedScene.value = name;
  loadSources(name);
});
const connStatusLabel = computed(() => {
  if (!agentStatus.value?.paired) return "not set up";
  if (!agentConnected.value) return "agent offline";
  if (!obsConnected.value) return "agent online · OBS not connected";
  return "ready";
});
const connStatusClass = computed(() => {
  if (!agentStatus.value?.paired) return "status-none";
  if (!agentConnected.value) return "status-offline";
  if (!obsConnected.value) return "status-partial";
  return "status-ready";
});

// vvv load vvv
async function load() {
  if (!session.value) return;
  const gen = requestGen.value;
  try {
    const res = await fetch(`${API}/obs/${session.value.channel}`, {
      headers: authHeaders.value,
    });
    if (gen !== requestGen.value) return; // <<< superseded mid-flight, discard
    if (res.ok) {
      const d = (await res.json()) as AgentStatus;
      if (gen !== requestGen.value) return;
      agentStatus.value = d;
      sceneBindings.value = d.scene_bindings ?? [];
      sourceBindings.value = d.source_bindings ?? [];
      rules.value = d.rules ?? [];
      const normalizedArg: Record<string, ArgCommand> = {};
      for (const [action, entry] of Object.entries(d.arg_commands ?? {})) {
        if (typeof entry === "string")
          normalizedArg[action] = { command: entry, access: "everyone" };
        else if (entry?.command)
          normalizedArg[action] = {
            command: entry.command,
            access: entry.access ?? "everyone",
          };
      }
      argCommands.value = normalizedArg;
    }
  } catch { }
  if (gen !== requestGen.value) return;
  if (agentConnected.value && obsConnected.value) await refreshScenes();
  if (gen !== requestGen.value) return;
  await loadCategoryHistory();
  if (gen === requestGen.value) locked.value = false; // <<< fresh state landed, safe to edit again
}

async function poll() {
  if (!session.value) return;
  const gen = requestGen.value;
  try {
    const res = await fetch(`${API}/obs/${session.value.channel}`, {
      headers: authHeaders.value,
    });
    if (gen !== requestGen.value) return;
    if (res.ok) {
      const d = (await res.json()) as AgentStatus;
      if (gen !== requestGen.value) return;
      const wasConnected = obsConnected.value;
      agentStatus.value = d;
      // >>> OBS offline → clear cached scene/source so stale warnings disappear
      if (wasConnected && !d.obs_connected) {
        scenes.value = [];
        knownSources.value = [];
        selectedScene.value = "";
        sceneShots.value = {};
        if (shotTimer) {
          clearInterval(shotTimer);
          shotTimer = null;
        }
      }
    }
  } catch { }
}
// ^^^ load ^^^

// vvv token vvv
async function generateToken() {
  if (!session.value || !isBroadcaster.value) return;
  generatingToken.value = true;
  try {
    const res = await fetch(`${API}/obs/${session.value.channel}/token`, {
      method: "POST",
      headers: authHeaders.value,
    });
    if (res.ok) {
      const d = (await res.json()) as { token: string };
      token.value = d.token;
      tokenVisible.value = true;
    }
  } catch { }
  generatingToken.value = false;
}

function openAgentPairingPage() {
  window.open("http://127.0.0.1:47115/", "_blank");
}

const checkingAgentUpdate = ref(false);
const agentUpdateResult = ref("");
async function checkAgentUpdate() {
  if (!session.value || !isBroadcaster.value) return;
  checkingAgentUpdate.value = true;
  agentUpdateResult.value = "";
  try {
    const res = await fetch(`${API}/obs/${session.value.channel}/check-update`, {
      method: "POST",
      headers: authHeaders.value,
    });
    if (res.ok) {
      const d = (await res.json()) as { ok: boolean; updated: boolean };
      agentUpdateResult.value = d.updated
        ? "updated - agent is restarting"
        : "already up to date";
    } else {
      agentUpdateResult.value = "agent not reachable";
    }
  } catch {
    agentUpdateResult.value = "agent not reachable";
  }
  checkingAgentUpdate.value = false;
  setTimeout(() => (agentUpdateResult.value = ""), 5000);
}

const disconnectingAgent = ref(false);
const disconnectConfirm = ref(false);
async function disconnectAgent() {
  if (!session.value || !isBroadcaster.value) return;
  if (!disconnectConfirm.value) {
    disconnectConfirm.value = true;
    setTimeout(() => (disconnectConfirm.value = false), 3000);
    return;
  }
  disconnectConfirm.value = false;
  disconnectingAgent.value = true;
  try {
    await fetch(`${API}/obs/${session.value.channel}/disconnect`, {
      method: "POST",
      headers: authHeaders.value,
    });
    await load();
  } catch { }
  disconnectingAgent.value = false;
}

// vvv recent categories vvv
interface CategoryHistoryEntry {
  category_id: string;
  category_name: string;
  box_art_url: string;
  changed_at: number;
}
const categoryHistory = ref<CategoryHistoryEntry[]>([]);
const currentCategoryId = ref<string | null>(null);
const switchingCategory = ref<string | null>(null);
const categorySwitchError = ref("");
const MAX_CATEGORY_CARDS = 5;
const emptyCategorySlots = computed(() =>
  Math.max(0, MAX_CATEGORY_CARDS - categoryHistory.value.length),
);

async function loadCategoryHistory() {
  if (!session.value) return;
  const gen = requestGen.value;
  try {
    const res = await fetch(`${API}/obs/${session.value.channel}/category-history`, {
      headers: authHeaders.value,
    });
    if (gen !== requestGen.value) return;
    if (res.ok) {
      const d = (await res.json()) as {
        history: CategoryHistoryEntry[];
        current_category_id: string | null;
      };
      if (gen !== requestGen.value) return;
      categoryHistory.value = d.history ?? [];
      currentCategoryId.value = d.current_category_id ?? null;
    }
  } catch { }
}

const showAddCategory = ref(false);
const addCategoryOverlay = useOverlayClose();
const addCategoryQuery = ref("");
async function fetchCategories(query: string): Promise<TypeaheadItem[]> {
  if (!session.value) return [];
  try {
    const res = await fetch(
      `${API}/obs/twitch/categories?q=${encodeURIComponent(query)}`,
      { headers: authHeaders.value },
    );
    if (!res.ok) return [];
    const d = (await res.json()) as {
      categories: { id: string; name: string; box_art_url: string }[];
    };
    return (d.categories ?? []).map((c) => ({ id: c.id, label: c.name, iconUrl: c.box_art_url }));
  } catch {
    return [];
  }
}
// >>> adds to strip only, doesn't switch live category
async function onAddCategorySelect(item: TypeaheadItem) {
  showAddCategory.value = false;
  addCategoryQuery.value = "";
  if (!item.id || !session.value || !canFilterScenes.value) return;

  const entry: CategoryHistoryEntry = {
    category_id: item.id,
    category_name: item.label,
    box_art_url: item.iconUrl ?? "",
    changed_at: Date.now(),
  };
  categoryHistory.value = [
    entry,
    ...categoryHistory.value.filter((c) => c.category_id !== item.id),
  ].slice(0, MAX_CATEGORY_CARDS);

  try {
    await fetch(`${API}/obs/${session.value.channel}/category-history`, {
      method: "POST",
      headers: { ...authHeaders.value, "Content-Type": "application/json" },
      body: JSON.stringify({
        category_id: item.id,
        category_name: item.label,
        box_art_url: item.iconUrl ?? "",
      }),
    });
    // >>> low-res thumbnail for instant paint
    await loadCategoryHistory();
  } catch { }
}

// >>> name/boxArt are only needed for the optimistic update 
async function switchCategory(categoryId: string, name?: string, boxArt?: string) {
  if (!session.value || !canFilterScenes.value || switchingCategory.value) return;
  switchingCategory.value = categoryId;
  categorySwitchError.value = "";

  const existing = categoryHistory.value.find((c) => c.category_id === categoryId);
  const entry: CategoryHistoryEntry = {
    category_id: categoryId,
    category_name: name ?? existing?.category_name ?? "",
    box_art_url: boxArt ?? existing?.box_art_url ?? "",
    changed_at: Date.now(),
  };
  categoryHistory.value = [
    entry,
    ...categoryHistory.value.filter((c) => c.category_id !== categoryId),
  ].slice(0, MAX_CATEGORY_CARDS);
  currentCategoryId.value = categoryId;

  try {
    const res = await fetch(`${API}/obs/${session.value.channel}/category`, {
      method: "POST",
      headers: { ...authHeaders.value, "Content-Type": "application/json" },
      body: JSON.stringify({ category_id: categoryId }),
    });
    if (!res.ok) {
      const d = (await res.json().catch(() => ({}))) as { error?: string };
      categorySwitchError.value = d.error ?? "Could not switch category";
      await loadCategoryHistory(); // <<< roll back the optimistic update
    }
  } catch {
    categorySwitchError.value = "Could not switch category";
    await loadCategoryHistory();
  }
  switchingCategory.value = null;
}

async function removeCategory(categoryId: string) {
  if (!session.value || !canFilterScenes.value) return;
  categoryHistory.value = categoryHistory.value.filter((c) => c.category_id !== categoryId);
  try {
    await fetch(
      `${API}/obs/${session.value.channel}/category-history/${encodeURIComponent(categoryId)}`,
      { method: "DELETE", headers: authHeaders.value },
    );
  } catch { }
}
// ^^^ recent categories ^^^

async function copyToken() {
  if (!token.value) return;
  await navigator.clipboard.writeText(token.value).catch(() => { });
  tokenJustCopied.value = true;
  setTimeout(() => {
    tokenJustCopied.value = false;
  }, 2000);
}

// vvv scenes vvv
async function refreshScenes() {
  if (!session.value) return;
  const gen = requestGen.value;
  try {
    const res = await fetch(`${API}/obs/${session.value.channel}/scenes`, {
      headers: authHeaders.value,
    });
    if (gen !== requestGen.value) return;
    if (res.ok) {
      const d = (await res.json()) as {
        scenes: SceneInfo[];
        currentScene: string;
      };
      if (gen !== requestGen.value) return;
      scenes.value = d.scenes;
      // >>> syncs live scene from response, not cache
      if (d.currentScene && agentStatus.value)
        agentStatus.value.current_scene = d.currentScene;
      if (!selectedScene.value)
        selectedScene.value =
          d.currentScene || scenes.value[0]?.sceneName || "";
      if (selectedScene.value) await loadSources(selectedScene.value);
      restartShotLoop();
      // >>> preloads source names for target-missing checks
      for (const s of scenes.value) prefetchSourceNames(s.sceneName);
    }
  } catch { }
}

async function prefetchSourceNames(sceneName: string) {
  if (!session.value) return;
  const gen = requestGen.value;
  try {
    const res = await fetch(
      `${API}/obs/${session.value.channel}/sources?scene=${encodeURIComponent(sceneName)}`,
      { headers: authHeaders.value },
    );
    if (gen !== requestGen.value) return;
    if (res.ok) {
      const data = ((await res.json()) as any).sources ?? [];
      if (gen !== requestGen.value) return;
      for (const s of data) {
        if (s.sourceName && !knownSources.value.includes(s.sourceName))
          knownSources.value = [...knownSources.value, s.sourceName];
      }
    }
  } catch { }
}

async function switchScene(name: string) {
  if (!session.value) return;

  if (agentStatus.value) agentStatus.value.current_scene = name;
  try {
    await fetch(`${API}/obs/${session.value.channel}/scene`, {
      method: "POST",
      headers: { ...authHeaders.value, "Content-Type": "application/json" },
      body: JSON.stringify({ name }),
    });
  } catch { }
}
// ^^^ scenes ^^^

// vvv sources vvv
// >>> silent mode skips loading flag for background refreshes
async function loadSources(sceneName: string, opts: { silent?: boolean } = {}) {
  if (!session.value) return;
  const gen = requestGen.value;
  selectedScene.value = sceneName;
  if (!opts.silent) sourcesLoading.value = true;
  try {
    const res = await fetch(
      `${API}/obs/${session.value.channel}/sources?scene=${encodeURIComponent(sceneName)}`,
      { headers: authHeaders.value },
    );
    if (gen !== requestGen.value) return;
    if (res.ok) {
      const rawSources = ((await res.json()) as any).sources ?? [];
      if (gen !== requestGen.value) return;

      // >>> obs-websocket order is backwards, just reverse it
      sources.value = rawSources
        .map((s: any) => ({ ...s, visible: s.sceneItemEnabled }))
        .reverse();
    }
  } catch { }
  if (gen === requestGen.value) sourcesLoading.value = false;
}

// >>> drag-to-reorder
const dragSourceIndex = ref<number | null>(null);
function onSourceDragStart(i: number) {
  dragSourceIndex.value = i;
}
async function onSourceDrop(targetIndex: number) {
  const fromIndex = dragSourceIndex.value;
  dragSourceIndex.value = null;
  if (fromIndex === null || fromIndex === targetIndex || !session.value || !selectedScene.value)
    return;
  const list = [...(sources.value as any[])];
  // >>> uses the real index already at the drop slot
  const targetRealIndex = list[targetIndex]!.sceneItemIndex;
  const [moved] = list.splice(fromIndex, 1);
  list.splice(targetIndex, 0, moved);
  sources.value = list; // <<< optimistic reorder for immediate feedback

  if (editMode.value) {
    stageSourceEdit(moved, { sceneItemIndex: targetRealIndex });
    return;
  }
  await setSourceIndex(moved, targetRealIndex);
}

async function setSourceIndex(
  src: { sceneItemId: number },
  sceneItemIndex: number,
  scene: string = selectedScene.value,
) {
  if (!session.value) return;
  try {
    await fetch(`${API}/obs/${session.value.channel}/source/reorder`, {
      method: "POST",
      headers: { ...authHeaders.value, "Content-Type": "application/json" },
      body: JSON.stringify({ scene, sceneItemId: src.sceneItemId, sceneItemIndex }),
    });
  } catch { }
  if (scene === selectedScene.value) await loadSources(scene, { silent: true });
}

async function setSourceTransform(
  src: { sceneItemId: number },
  transform: SourceTransform,
  scene: string = selectedScene.value,
) {
  if (!session.value) return;
  try {
    await fetch(`${API}/obs/${session.value.channel}/source/transform`, {
      method: "POST",
      headers: { ...authHeaders.value, "Content-Type": "application/json" },
      body: JSON.stringify({ scene, sceneItemId: src.sceneItemId, transform }),
    });
  } catch { }
  if (scene === selectedScene.value) await loadSources(scene, { silent: true });
}

// >>> target-setting
async function setSourceVisibility(
  src: { sceneItemId: number },
  target: boolean,
  scene: string = selectedScene.value,
) {
  if (!session.value || pendingSources.value.has(src.sceneItemId)) return;
  pendingSources.value = new Set(pendingSources.value).add(src.sceneItemId);
  try {
    await fetch(`${API}/obs/${session.value.channel}/source/visibility`, {
      method: "POST",
      headers: { ...authHeaders.value, "Content-Type": "application/json" },
      body: JSON.stringify({
        scene,
        sceneItemId: src.sceneItemId,
        enabled: target,
      }),
    });
  } catch { }
  if (scene === selectedScene.value) await loadSources(scene, { silent: true });
  const next_ = new Set(pendingSources.value);
  next_.delete(src.sceneItemId);
  pendingSources.value = next_;
}
function toggleSourceVisible(src: SourceInfo) {
  return setSourceVisibility(src, !src.visible);
}

async function setSourceMute(src: { sceneItemId: number; sourceName: string }, target: boolean) {
  if (!session.value || pendingSources.value.has(src.sceneItemId)) return;
  pendingSources.value = new Set(pendingSources.value).add(src.sceneItemId);
  try {
    await fetch(`${API}/obs/${session.value.channel}/source/mute`, {
      method: "POST",
      headers: { ...authHeaders.value, "Content-Type": "application/json" },
      body: JSON.stringify({
        source: src.sourceName,
        muted: target,
      }),
    });
  } catch { }
  if (selectedScene.value) await loadSources(selectedScene.value, { silent: true });
  const next_ = new Set(pendingSources.value);
  next_.delete(src.sceneItemId);
  pendingSources.value = next_;
}
function toggleSourceMute(src: SourceInfo & { muted?: boolean }) {
  return setSourceMute(src, !(src.muted ?? false));
}
// ^^^ sources ^^^

// vvv bindings vvv
async function saveBindings() {
  if (!session.value) return;
  bindingsSaving.value = true;
  try {
    // >>> blank cmd name disables, not saves empty
    const cleanedArgCommands: Record<string, ArgCommand> = {};
    for (const [action, entry] of Object.entries(argCommands.value)) {
      if (entry?.command && entry.command.trim()) {
        cleanedArgCommands[action] = {
          command: entry.command.trim().replace(/^\+/, "").toLowerCase(),
          access: entry.access ?? "everyone",
        };
      }
    }
    await fetch(`${API}/obs/${session.value.channel}/bindings`, {
      method: "PUT",
      headers: { ...authHeaders.value, "Content-Type": "application/json" },
      body: JSON.stringify({
        scene_bindings: sceneBindings.value,
        source_bindings: sourceBindings.value,
        arg_commands: cleanedArgCommands,
      }),
    });
    bindingsSaved.value = true;
    setTimeout(() => {
      bindingsSaved.value = false;
    }, 2000);
  } catch { }
  bindingsSaving.value = false;
}
// ^^^ bindings ^^^

// vvv command builder vvv
// >>> unified command model for the table
interface UnifiedCommand {
  type: "scene" | "source" | "arg";
  command: string;
  actionLabel: string;
  targetDisplay: string;
  badgeText: string;
  badgeClass: "fixed-type" | "arg-type";
  access: AccessLevel;
  index?: number;
  action?: string;
  actionHint?: string;
}

const unifiedCommands = computed<UnifiedCommand[]>(() => {
  const list: UnifiedCommand[] = [];

  sceneBindings.value.forEach((b, i) => {
    list.push({
      type: "scene",
      command: b.command,
      actionLabel: "Switch scene",
      targetDisplay: b.scene,
      badgeText: "fixed",
      badgeClass: "fixed-type",
      access: b.access ?? "everyone",
      index: i,
      actionHint: "",
    });
  });

  sourceBindings.value.forEach((b, i) => {
    const isVolArg = b.action === "volume" && b.value === undefined;
    const badgeClass = isVolArg
      ? ("arg-type" as const)
      : ("fixed-type" as const);
    const actionLabel = BUILDER_ACTION_LABEL[b.action] ?? b.action;

    let actionHint = "";
    if (isVolArg) {
      actionHint = " <volume>"; // <<< fixed source, volume from chat
    } else if (b.action === "volume") {
      actionHint = ""; // <<< fixed value binding, no chat argument
    } else if (badgeClass === "fixed-type") {
      actionHint = ""; // <<< fixed source action (show/hide/toggle etc.)
    }

    list.push({
      type: "source",
      command: b.command,
      actionLabel,
      targetDisplay:
        b.action === "volume"
          ? isVolArg
            ? b.source
            : `${b.source} @ ${b.value}%`
          : b.source,
      badgeText: isVolArg ? "vol arg" : "fixed",
      badgeClass,
      access: b.access ?? "everyone",
      index: i,
      action: b.action,
      actionHint,
    });
  });

  Object.entries(argCommands.value).forEach(([action, entry]) => {
    if (!entry?.command) return;

    const actionLabel = BUILDER_ACTION_LABEL[action] ?? action;
    let targetDisplay = "";
    let actionHint = "";

    if (action === "volume") {
      targetDisplay = "<source>";
      actionHint = " <source> <vol>";
    } else if (action === "scene") {
      targetDisplay = "<scene>";
      actionHint = " <scene>";
    } else {
      targetDisplay = "<source>";
      actionHint = " <source>";
    }

    list.push({
      type: "arg",
      command: entry.command,
      actionLabel,
      targetDisplay,
      badgeText: action === "volume" ? "args" : "arg",
      badgeClass: "arg-type",
      access: entry.access ?? "everyone",
      action,
      actionHint,
    });
  });

  return list;
});

function addBuilderCommand() {
  if (addDisabled.value) return;
  const cmd = builderCmd.value.trim().replace(/^\+/, "").toLowerCase();
  if (builderAction.value === "volume") {
    if (builderVolMode.value === "both") {
      argCommands.value = {
        ...argCommands.value,
        volume: { command: cmd, access: builderAccess.value },
      };
    } else {
      sourceBindings.value.push({
        command: cmd,
        source: builderTarget.value.trim(),
        action: "volume",
        access: builderAccess.value,
      });
    }
  } else if (builderMode.value === "argument") {
    argCommands.value = {
      ...argCommands.value,
      [builderAction.value]: { command: cmd, access: builderAccess.value },
    };
  } else {
    if (builderAction.value === "scene") {
      sceneBindings.value.push({
        command: cmd,
        scene: builderTarget.value.trim(),
        access: builderAccess.value,
      });
    } else {
      sourceBindings.value.push({
        command: cmd,
        source: builderTarget.value.trim(),
        action: builderAction.value,
        access: builderAccess.value,
      });
    }
  }

  builderCmd.value = "";
  builderTarget.value = "";
  saveBindings();
}

function removeUnifiedCommand(item: UnifiedCommand) {
  if (item.type === "scene" && item.index != null)
    sceneBindings.value.splice(item.index, 1);
  else if (item.type === "source" && item.index != null)
    sourceBindings.value.splice(item.index, 1);
  else if (item.type === "arg" && item.action) {
    const next = { ...argCommands.value };
    delete next[item.action];
    argCommands.value = next;
  }
  saveBindings();
}

function cycleUnifiedAccess(item: UnifiedCommand) {
  const next = nextAccess(item.access);
  if (item.type === "scene" && item.index != null) {
    const b = sceneBindings.value[item.index];
    if (b) b.access = next;
  } else if (item.type === "source" && item.index != null) {
    const b = sourceBindings.value[item.index];
    if (b) b.access = next;
  } else if (item.type === "arg" && item.action) {
    const cur = argCommands.value[item.action];
    if (cur)
      argCommands.value = {
        ...argCommands.value,
        [item.action]: { ...cur, access: next },
      };
  }
  saveBindings();
}
// ^^^ command builder ^^^

// vvv add browser source vvv
interface ObsWidget {
  id: string;
  name: string;
}
const showAddSource = ref(false);
const addSourceOverlay = useOverlayClose();
const addSourceMode = ref<"url" | "widget" | "overlay">("url");
const addSourceName = ref("");
const addSourceUrl = ref("");
const addSourceWidgetId = ref("");
const addSourceWidth = ref(1920);
const addSourceHeight = ref(1080);
const addSourceSaving = ref(false);
const addSourceError = ref("");
const widgets = ref<ObsWidget[]>([]);

async function loadWidgetsForAddSource() {
  if (!session.value) return;
  try {
    const res = await fetch(`${API}/obs-widgets/${session.value.channel}`, {
      headers: authHeaders.value,
    });
    if (res.ok) widgets.value = ((await res.json()) as { widgets: ObsWidget[] }).widgets ?? [];
  } catch { }
}

// vvv overlay tab vvv
interface OverlayChoice { id: string; name: string }
const overlaysForPicker = ref<OverlayChoice[]>([]);
const selectedOverlayChoice = ref<string>("new");
async function loadOverlaysForPicker() {
  if (!session.value) return;
  try {
    const res = await fetch(`${API}/overlays/${session.value.channel}`, {
      headers: authHeaders.value,
    });
    if (res.ok)
      overlaysForPicker.value = ((await res.json()) as { overlays: OverlayChoice[] }).overlays ?? [];
  } catch { }
}
// ^^^ overlay tab ^^^

function openAddSource() {
  if (!selectedScene.value) return;
  addSourceMode.value = "url";
  addSourceName.value = "";
  addSourceUrl.value = "";
  addSourceWidgetId.value = "";
  addSourceWidth.value = 1920;
  addSourceHeight.value = 1080;
  addSourceError.value = "";
  selectedOverlayChoice.value = "new";
  showAddSource.value = true;
  loadWidgetsForAddSource();
  if (!hasOverlaySource.value) loadOverlaysForPicker();
}

function pickAddSourceWidget(id: string) {
  addSourceWidgetId.value = id;
  const w = widgets.value.find((w) => w.id === id);
  if (w && !addSourceName.value.trim()) addSourceName.value = w.name;
}

async function createSourceNow(
  scene: string,
  name: string,
  url: string,
  width: number,
  height: number,
): Promise<{ ok: boolean; error?: string }> {
  if (!session.value) return { ok: false, error: "not logged in" };
  try {
    const res = await fetch(`${API}/obs/${session.value.channel}/source`, {
      method: "POST",
      headers: { ...authHeaders.value, "Content-Type": "application/json" },
      body: JSON.stringify({ scene, name, url, width, height }),
    });
    if (scene === selectedScene.value) await loadSources(scene, { silent: true });
    if (res.ok) return { ok: true };

    const d = await res.json().catch(() => ({}) as any);
    return { ok: false, error: d.error };
  } catch {
    return { ok: false };
  }
}

async function submitAddSource() {
  if (!session.value || !selectedScene.value) return;

  if (addSourceMode.value === "overlay") {
    addSourceSaving.value = true;
    addSourceError.value = "";
    try {
      let overlayId = selectedOverlayChoice.value;
      if (overlayId === "new") {
        const createRes = await fetch(`${API}/overlays/${session.value.channel}`, {
          method: "POST",
          headers: authHeaders.value,
        });
        if (!createRes.ok) {
          addSourceError.value = "Could not create the overlay";
          addSourceSaving.value = false;
          return;
        }
        const d = (await createRes.json()) as { overlay: { id: string } };
        overlayId = d.overlay.id;
      }
      const res = await fetch(
        `${API}/overlay/${session.value.channel}/${overlayId}/add-to-scene`,
        {
          method: "POST",
          headers: { ...authHeaders.value, "Content-Type": "application/json" },
          body: JSON.stringify({ scene: selectedScene.value }),
        },
      );
      if (res.ok) {
        await loadSources(selectedScene.value, { silent: true });
        showAddSource.value = false;
      } else {
        const d = await res.json().catch(() => ({}) as any);
        addSourceError.value = d.error ?? "Could not add the overlay";
      }
    } catch {
      addSourceError.value = "Could not add the overlay";
    }
    addSourceSaving.value = false;
    return;
  }

  const name = addSourceName.value.trim();
  const url =
    addSourceMode.value === "widget"
      ? addSourceWidgetId.value
        ? `https://obs.shyboti.de/${addSourceWidgetId.value}`
        : ""
      : addSourceUrl.value.trim();
  if (!name || !url) {
    addSourceError.value = "Name and URL are required";
    return;
  }

  // >>> edit mode stages it, no id until save
  if (editMode.value) {
    pendingCreates.value = [
      ...pendingCreates.value,
      {
        id: crypto.randomUUID(),
        scene: selectedScene.value,
        name,
        url,
        width: addSourceWidth.value,
        height: addSourceHeight.value,
      },
    ];
    showAddSource.value = false;
    return;
  }

  addSourceSaving.value = true;
  addSourceError.value = "";
  const result = await createSourceNow(
    selectedScene.value,
    name,
    url,
    addSourceWidth.value,
    addSourceHeight.value,
  );
  if (result.ok) {
    showAddSource.value = false;
  } else {
    addSourceError.value = result.error ?? "Failed to add source";
  }
  addSourceSaving.value = false;
}
function removePendingCreate(id: string) {
  pendingCreates.value = pendingCreates.value.filter((c) => c.id !== id);
}
// ^^^ add browser source ^^^

// vvv audio mixer vvv
const audioSources = computed(() =>
  (sources.value as any[]).filter((s) => s.isAudioSource),
);

function volumeToDb(percent: number | undefined): string {
  const mul = Math.max(0, Math.min(100, percent ?? 0)) / 100;
  if (mul <= 0) return "-∞";
  return (20 * Math.log10(mul)).toFixed(1);
}

// >>> local override so polling doesn't snap back
const sliderOverride = ref<Record<number, number>>({});

function onVolumeInput(src: any, percent: number) {
  sliderOverride.value = {
    ...sliderOverride.value,
    [src.sceneItemId]: percent,
  };
}

async function onVolumeChange(src: any, percent: number) {
  onVolumeInput(src, percent);
  await setSourceVolume(src, percent);
  const next = { ...sliderOverride.value };
  delete next[src.sceneItemId];
  sliderOverride.value = next;
}

async function setSourceVolume(src: { sourceName: string }, percent: number) {
  if (!session.value) return;
  try {
    await fetch(`${API}/obs/${session.value.channel}/source/volume`, {
      method: "POST",
      headers: { ...authHeaders.value, "Content-Type": "application/json" },
      body: JSON.stringify({ source: src.sourceName, percent }),
    });
  } catch { }
  if (selectedScene.value) await loadSources(selectedScene.value, { silent: true });
}
// ^^^ audio mixer ^^^

// vvv force all previews button vvv
const forcePreviewLoading = ref(false);

async function forceAllPreviews() {
  if (!session.value || !canForcePreview.value) return;
  forcePreviewLoading.value = true;
  try {
    await fetch(`${API}/obs/${session.value.channel}/force-all-previews`, {
      method: "POST",
      headers: authHeaders.value,
    });
  } catch { }
  forcePreviewLoading.value = false;
}

// >>> ctrl+s saves staged changes, overrides browser save
function onKeydown(e: KeyboardEvent) {
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "s") {
    e.preventDefault();
    if (editMode.value && hasPending.value && !locked.value) saveChanges();
  }
}
// ^^^ force all previews button ^^^

// vvv lifecycle vvv
let categoryPollTimer: ReturnType<typeof setInterval> | null = null;
onMounted(() => {
  load();
  pollTimer = setInterval(async () => {
    await poll();
    if (agentConnected.value && obsConnected.value && selectedScene.value)
      loadSources(selectedScene.value, { silent: true });
    if (agentConnected.value && obsConnected.value && scenes.value.length === 0)
      refreshScenes();
  }, 5000);
  // >>> category can change without us clicking anything
  categoryPollTimer = setInterval(loadCategoryHistory, 30000);
  window.addEventListener("keydown", onKeydown);
});
onUnmounted(() => {
  requestGen.value++; // <<< defensive - covers any unmount path besides router nav
  if (pollTimer) clearInterval(pollTimer);
  if (shotTimer) clearInterval(shotTimer);
  if (categoryPollTimer) clearInterval(categoryPollTimer);
  window.removeEventListener("keydown", onKeydown);
});
// >>> locks instantly before the route finishes changing
onBeforeRouteLeave(() => {
  lockForNavigation();
});

// >>> channel switch isn't a route change, hard reset needed
watch(
  () => session.value?.channel,
  () => {
    lockForNavigation();
    agentStatus.value = null;
    scenes.value = [];
    selectedScene.value = "";
    sources.value = [];
    sceneShots.value = {};
    knownSources.value = [];
    categoryHistory.value = [];
    currentCategoryId.value = null;
    if (shotTimer) {
      clearInterval(shotTimer);
      shotTimer = null;
    }
    load();
  },
);
// ^^^ lifecycle ^^^
</script>

<template>
  <div class="obsconn-page">
    <div class="obsconn-header">
      <div>
        <div class="obsconn-title">OBS Control</div>
      </div>
      <div class="mode-bar">
        <div class="mode-bar-left">
          <span class="ep-field-label" style="margin: 0">mode</span>
          <div class="switch" :class="editMode ? 'edit' : 'live'" @click="setMode(!editMode)">
            <div class="knob"></div>
          </div>
          <span class="mode-state" :class="editMode ? 'edit' : 'live'">{{ editMode ? "Edit" : "Live" }}</span>
        </div>
        <span v-if="locked" class="mode-hint locked-hint"><span v-html="iconSvgFor('lock')"></span> leaving -
          loading fresh state…</span>
        <span v-else class="mode-hint">{{
          editMode
            ? "Changes stage here until you press Save."
            : "Changes apply to your stream instantly."
        }}</span>
      </div>

      <div class="obsconn-header-right">
        <div class="obs-status-bar" :class="connStatusClass">
          <div class="obs-status-dot"></div>
          <span class="obs-status-text">{{ connStatusLabel }}</span>
          <span v-if="agentStatus?.version" class="obs-status-version">v{{ agentStatus.version }}</span>
        </div>
        <button v-if="obsConnected && canFilterScenes" class="obs-refresh-btn" @click="refreshScenes"
          title="Refresh scene list" v-html="iconSvgFor('refresh-cw')">
        </button>
        <button v-if="obsConnected && canFilterScenes" class="obsconn-gear-btn" title="Filter scenes"
          @click="openFilter">
          <svg viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg">
            <path d="M3 4h14l-5.5 6.5v5l-3 1.5v-6.5L3 4z" stroke="currentColor" stroke-width="1.5"
              stroke-linejoin="round" />
          </svg>
        </button>
        <button v-if="isBroadcaster" class="obsconn-gear-btn" title="OBS settings" @click="openSettings">
          <svg viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg">
            <path d="M10 12.5a2.5 2.5 0 100-5 2.5 2.5 0 000 5z" stroke="currentColor" stroke-width="1.5" />
            <path
              d="M16.2 12.3a1.4 1.4 0 00.3 1.5l.05.05a1.65 1.65 0 11-2.35 2.35l-.05-.05a1.4 1.4 0 00-1.5-.3 1.4 1.4 0 00-.85 1.28v.14a1.65 1.65 0 11-3.3 0v-.07a1.4 1.4 0 00-.92-1.28 1.4 1.4 0 00-1.5.3l-.05.05A1.65 1.65 0 113.63 13.9l.05-.05a1.4 1.4 0 00.3-1.5 1.4 1.4 0 00-1.28-.85h-.14a1.65 1.65 0 110-3.3h.07a1.4 1.4 0 001.28-.92 1.4 1.4 0 00-.3-1.5l-.05-.05A1.65 1.65 0 116.09 3.38l.05.05a1.4 1.4 0 001.5.3h.06a1.4 1.4 0 00.85-1.28V2.3a1.65 1.65 0 113.3 0v.07a1.4 1.4 0 00.85 1.28h.06a1.4 1.4 0 001.5-.3l.05-.05a1.65 1.65 0 112.35 2.35l-.05.05a1.4 1.4 0 00-.3 1.5v.06a1.4 1.4 0 001.28.85h.14a1.65 1.65 0 110 3.3h-.07a1.4 1.4 0 00-1.28.85z"
              stroke="currentColor" stroke-width="1.3" />
          </svg>
          <span v-if="!loading && !agentStatus?.paired" class="obs-gear-badge" title="OBS agent not set up yet">!</span>
        </button>
        <div v-if="agentConnected && obsConnected" class="obs-live-stats">
          <div class="obs-live-stat" :class="{ bad: bitrateBad }">
            <span class="obs-live-stat-label">bitrate</span>
            <span class="obs-live-stat-value">{{
              bitrateLabel ?? "not streaming"
            }}</span>
          </div>
          <div class="obs-live-stat">
            <span class="obs-live-stat-label">preview size</span>
            <span class="obs-live-stat-value">{{
              liveShotStats.kb != null
                ? liveShotStats.kb + " kb"
                : agentStatus?.screenshots
                  ? "--"
                  : "off"
            }}</span>
          </div>
          <div class="obs-live-stat">
            <span class="obs-live-stat-label">preview cpu</span>
            <span class="obs-live-stat-value">{{
              liveShotStats.cpuMs != null
                ? liveShotStats.cpuMs + " ms"
                : agentStatus?.screenshots
                  ? "--"
                  : "off"
            }}</span>
          </div>
        </div>
      </div>
    </div>

    <div class="obsconn-body" :class="{ 'obs-locked': locked }">
      <template v-if="loading">
        <div class="obs-loading">
          <img src="https://cdn.7tv.app/emote/01G0PEAVDR0008B1SW0M995JQJ/2x.gif" alt="loading"
            class="obs-loading-emote" />
        </div>
      </template>

      <!-- >>> setup prompt, full instructions live in gear panel -->
      <template v-else-if="!agentConnected || !obsConnected">
        <div class="obs-setup-card obs-setup-compact">
          <template v-if="isBroadcaster">
            <div class="obs-setup-title">
              {{
                agentStatus?.paired
                  ? agentConnected
                    ? "Agent connected - waiting for OBS…"
                    : "Waiting for the agent to connect…"
                  : "OBS agent is not set up yet"
              }}
            </div>
            <div class="obs-setup-hint">
              Click the gear icon above to
              {{
                agentStatus?.paired
                  ? "view your pairing token again or re-download the agent."
                  : "get your pairing token and download the agent."
              }}
            </div>
          </template>
          <template v-else>
            <div class="obs-setup-title">OBS isn't connected yet</div>
            <div class="obs-setup-hint">
              Ask your broadcaster to set it up (gear icon, broadcaster only).
            </div>
          </template>
        </div>
      </template>

      <template v-if="agentConnected && obsConnected">
        <div class="ep-field-group">

          <div class="ep-field-label obs-section-label">
          </div>
          <div class="obs-scenes">
            <!-- >>> avoids a layout jump from an extra async fetch -->
            <div class="obs-scenes-live-row" v-if="currentScene">
              <div class="obs-live-scene-wrap">
                <div class="obs-scene-card obs-scene-card-live active"
                  :class="{ picked: currentScene === selectedScene }" @click="onSceneClick(currentScene)">
                  <div class="obs-scene-thumb">
                    <img v-if="sceneShots[currentScene]" :src="sceneShots[currentScene]" :alt="currentScene" />
                    <div v-else class="obs-scene-thumb-empty">
                      {{ agentStatus?.screenshots ? "…" : "previews off" }}
                    </div>
                  </div>
                  <div class="obs-scene-name-row">
                    <div class="obs-scene-name">{{ currentScene }}</div>
                    <button class="obs-scene-fs-btn" title="Edit stream overlay"
                      @click.stop="openOverlayEditor(currentScene)" v-html="iconSvgFor('edit')"></button>
                  </div>
                  <div class="obs-scene-live">live</div>
                </div>
              </div>
            </div>
            <div class="obs-scenes-others">
              <div v-for="s in nonLiveScenes" :key="s.sceneName" class="obs-scene-card"
                :class="{ picked: s.sceneName === selectedScene, pending: isScenePending(s.sceneName) }"
                @click="onSceneClick(s.sceneName)">
                <div class="obs-scene-thumb">
                  <img v-if="sceneShots[s.sceneName]" :src="sceneShots[s.sceneName]" :alt="s.sceneName" />
                  <div v-else class="obs-scene-thumb-empty">
                    {{ agentStatus?.screenshots ? "…" : "previews off" }}
                  </div>
                  <span v-if="isScenePending(s.sceneName)" class="obs-scene-pending-tag">pending</span>
                  <button v-if="editMode" class="obs-scene-stage-btn" :class="{ active: isScenePending(s.sceneName) }"
                    :title="isScenePending(s.sceneName) ? 'Unstage - keep current scene live' : 'Switch to this scene on Save'"
                    @click.stop="stageSceneSwitch(s.sceneName)" v-html="iconSvgFor('play')">
                  </button>
                </div>
                <div class="obs-scene-name-row">
                  <div class="obs-scene-name">{{ s.sceneName }}</div>
                  <button class="obs-scene-fs-btn" title="Edit stream overlay"
                    @click.stop="openOverlayEditor(s.sceneName)" v-html="iconSvgFor('edit')"></button>
                </div>
              </div>
            </div>
            <div v-if="!scenes.length" class="ep-empty">
              <button class="ep-btn-cancel" @click="refreshScenes">
                load scenes
              </button>
            </div>
          </div>
          <button v-if="
            canForcePreview && scenes.length > 0 && !videoMixProjectorOpen
          " class="ep-btn-new" @click="forceAllPreviews()" :disabled="forcePreviewLoading"
            style="width: 200px; display: block; margin: 0 auto">
            {{ forcePreviewLoading ? "Opening…" : "Force all previews" }}
          </button>
          <div v-if="canForcePreview" class="obs-projector-state">
            Multiview projector: {{ videoMixProjectorOpen ? "open" : "closed" }}
            <span v-if="videoMixProjectorTitle" class="obs-projector-title">"{{ videoMixProjectorTitle }}"</span>
          </div>
        </div>
      </template>

      <ObsOverlayEditor v-if="overlayEditorOpen && session" :channel="session.channel" :auth-headers="authHeaders"
        :scenes="scenes.map((s) => s.sceneName)" :current-scene="currentScene" :initial-scene="overlayEditorScene"
        :obs-ready="agentConnected && obsConnected" @close="closeOverlayEditor" />

      <!-- >>> builder still works even if obs isn't connected -->
      <div v-if="(agentConnected && obsConnected) || agentStatus?.paired" class="obs-boxes-row"
        :class="{ 'obs-boxes-single': !(agentConnected && obsConnected) }">
        <template v-if="agentConnected && obsConnected">
          <div class="ep-field-group obs-box">
            <div class="obs-box-label-row">
              <label class="ep-field-label">sources
                <span v-if="selectedScene" class="ep-field-hint">{{
                  selectedScene
                  }}</span></label>
              <button v-if="selectedScene" class="obs-add-source-btn" title="Add a browser source"
                @click="openAddSource" v-html="iconSvgFor('plus')"></button>
            </div>
            <div class="obs-source-list">
              <!-- >>> background refreshes stay silent, no flash over rows -->
              <template v-if="sourcesLoading && !sources.length">
                <div class="obs-source-row" v-for="i in 4" :key="i">
                  <div class="ep-skeleton-block" style="height:10px;width:40%;"></div>
                  <div class="ep-skeleton-block ep-skeleton-btn"></div>
                </div>
              </template>
              <div v-for="(src, i) in sources as any[]" :key="src.sceneItemId" class="obs-source-row"
                :class="{ pending: isSourcePending(src), dragging: dragSourceIndex === i }" draggable="true"
                @dragstart="onSourceDragStart(i)" @dragover.prevent @drop="onSourceDrop(i)"
                @dblclick="onSourceRowDblClick(src)">
                <span class="obs-drag-handle" title="Drag to reorder" v-html="iconSvgFor('grip')"></span>
                <span class="obs-source-name">{{ src.sourceName }}</span>
                <span v-if="isSourcePending(src)" class="pending-tag">pending</span>
                <button class="obs-vis-btn" :class="{ on: effectiveVisible(src) }"
                  :disabled="pendingSources.has(src.sceneItemId)" @click.stop="onToggleVisible(src)">
                  {{ effectiveVisible(src) ? "visible" : "hidden" }}
                </button>
                <template v-if="src.isAudioSource">
                  <button class="obs-mute-btn" :class="{ muted: effectiveMuted(src) }"
                    :disabled="pendingSources.has(src.sceneItemId)" @click.stop="onToggleMute(src)">
                    {{ effectiveMuted(src) ? "muted" : "unmuted" }}
                  </button>
                </template>
              </div>
              <div v-for="c in pendingCreates.filter((c) => c.scene === selectedScene)" :key="c.id"
                class="obs-source-row pending">
                <span class="obs-source-name">{{ c.name }}</span>
                <span class="pending-tag">pending (new)</span>
                <button class="ep-btn-action del" title="Cancel" @click="removePendingCreate(c.id)">
                  <span v-html="iconSvgFor('x')"></span>
                </button>
              </div>
              <div v-if="!sources.length && !sourcesLoading && !pendingCreates.some((c) => c.scene === selectedScene)"
                class="ep-empty">
                {{
                  selectedScene
                    ? "no sources in this scene"
                    : "pick a scene above"
                }}
              </div>
            </div>
          </div>

          <div class="ep-field-group obs-box">
            <label class="ep-field-label">audio mixer
              <span v-if="selectedScene" class="ep-field-hint">{{
                selectedScene
                }}</span></label>
            <div class="obs-mixer-list">
              <div v-for="src in audioSources" :key="src.sceneItemId" class="obs-mixer-row"
                :class="{ pending: isSourcePending(src) }">
                <div class="obs-mixer-top">
                  <span class="obs-source-name">{{ src.sourceName }}</span>
                  <span v-if="isSourcePending(src)" class="pending-tag">pending</span>
                  <button class="obs-mute-btn" :class="{ muted: effectiveMuted(src) }"
                    :disabled="pendingSources.has(src.sceneItemId)" @click="onToggleMute(src)">
                    {{ effectiveMuted(src) ? "muted" : "unmuted" }}
                  </button>
                </div>
                <div class="obs-mixer-slider-row">
                  <input type="range" min="0" max="100" :value="sliderOverride[src.sceneItemId] ??
                    getPendingEdit(src)?.volumePercent ??
                    src.volumePercent ??
                    100
                    " class="obs-mixer-slider" @input="
                      onVolumeInput(
                        src,
                        +($event.target as HTMLInputElement).value,
                      )
                      " @change="
                        onVolumeCommit(
                          src,
                          +($event.target as HTMLInputElement).value,
                        )
                        " />
                  <span class="obs-mixer-db">{{
                    volumeToDb(
                      sliderOverride[src.sceneItemId] ??
                      getPendingEdit(src)?.volumePercent ??
                      src.volumePercent,
                    )
                  }}
                    dB</span>
                </div>
              </div>
              <div v-if="!audioSources.length" class="ep-empty">
                {{
                  selectedScene
                    ? "no audio sources in this scene"
                    : "pick a scene above"
                }}
              </div>
            </div>
          </div>
        </template>

        <div v-if="agentConnected && obsConnected" class="ep-field-group obs-box obs-box-cat">
          <label class="ep-field-label">Switch categories</label>
          <div class="obs-category-strip">
            <button v-for="c in categoryHistory" :key="c.category_id" class="obs-category-card"
              :class="{ disabled: !canFilterScenes, active: c.category_id === currentCategoryId, pending: isCategoryPending(c.category_id), switching: switchingCategory === c.category_id }"
              :disabled="switchingCategory === c.category_id" :title="c.category_name" @click="onCategoryClick(c)">
              <span v-if="canFilterScenes" class="obs-category-remove" title="Remove"
                @click.stop="removeCategory(c.category_id)">×</span>
              <img v-if="c.box_art_url" :src="c.box_art_url" :alt="c.category_name" />
              <div v-else class="obs-category-empty">{{ c.category_name.slice(0, 2) }}</div>
              <span class="obs-category-name">{{ c.category_name }}</span>
            </button>
            <template v-if="canFilterScenes">
              <button v-for="n in emptyCategorySlots" :key="'empty' + n" class="obs-category-card obs-category-add"
                title="Add a category" @click="showAddCategory = true">
                <div class="obs-category-empty obs-category-plus">+</div>
              </button>
            </template>
          </div>
          <div v-if="categorySwitchError" class="obs-category-error">{{ categorySwitchError }}</div>
        </div>

        <div v-if="agentConnected && obsConnected" class="ep-field-group obs-box obs-box-links">
          <label class="ep-field-label">quick links</label>
          <button class="ep-btn-cancel obs-link-btn" @click="router.push('/commands')">
            OBS commands
          </button>
          <button class="ep-btn-cancel obs-link-btn" @click="router.push('/automations?tab=obs')">
            OBS automations
          </button>
        </div>
      </div>
    </div>

    <div v-if="bindingsSaving || bindingsSaved" class="obsconn-autosave">
      {{ bindingsSaving ? "saving…" : "saved" }}
    </div>
  </div>

  <!-- >>> broadcaster only -->
  <Teleport to="body">
    <div v-if="showSettings && isBroadcaster" class="ep-overlay"
      v-bind="settingsOverlay.handlers(() => (showSettings = false))">
      <div class="ep-panel obsconn-settings-panel obs-settings-redesign">
        <div class="ep-panel-header">
          <div>
            <div class="ep-panel-title">OBS settings</div>
            <div class="ep-panel-sub">broadcaster only</div>
          </div>
          <button class="ep-panel-close" @click="showSettings = false">
            x
          </button>
        </div>

        <div class="ep-panel-body">
          <div v-if="agentConnected && obsConnected" class="ep-section">
            <div class="ep-section-label">Connection</div>
            <div class="ep-status-badge ready">
              <span class="ep-status-dot"></span>
              Agent ready
            </div>
            <div class="ep-field-hint">
              Connected to OBS<template v-if="agentStatus?.version"> · v{{ agentStatus.version }}</template>
            </div>
          </div>

          <details class="ep-details" :open="!(agentConnected && obsConnected)">
            <summary>Setup &amp; Pairing</summary>
            <div class="ep-details-body">
              <template v-if="agentConnected && obsConnected">
                <div class="ep-note">
                  Agent is connected and paired. You can view your pairing token or regenerate it.
                </div>
                <button class="ep-btn ep-btn-secondary" style="margin-top: 4px;" :disabled="generatingToken"
                  @click="generateToken">
                  {{ generatingToken ? "generating..." : "Show/Regenerate token" }}
                </button>
              </template>
              <template v-else>
                <ol class="ep-steps">
                  <li>
                    <strong>Generate a pairing token</strong>
                    <div style="margin-top: 4px;">
                      <button class="ep-btn ep-btn-primary" :disabled="generatingToken" @click="generateToken">
                        {{
                          generatingToken
                            ? "generating..."
                            : agentStatus?.paired
                              ? "Regenerate token"
                              : "Generate token"
                        }}
                      </button>
                      <div v-if="!(tokenVisible && token)" class="ep-field-hint" style="margin-top: 4px;">
                        {{
                          agentStatus?.paired
                            ? 'Token already set. Click "Regenerate token" to replace it.'
                            : "No token generated yet."
                        }}
                      </div>
                    </div>
                  </li>
                  <li>
                    <strong>Download the ShyBoti Agent</strong>
                    <div class="ep-download-row">
                      <a class="ep-btn ep-btn-secondary" :href="`${API}/agent/download/windows`" target="_blank"
                        rel="noopener">
                        Windows (.zip)
                      </a>
                      <a class="ep-btn ep-btn-secondary" :href="`${API}/agent/download/linux`" target="_blank"
                        rel="noopener">
                        Linux (.tar.gz)
                      </a>
                    </div>
                    <div class="ep-note" style="margin-top: 4px;">
                      Extract, then run <code>start.bat</code> (Win) or <code>start.sh</code> (Linux/Mac). Requires
                      <a href="https://nodejs.org" target="_blank" rel="noopener" class="ep-note-link">Node.js</a>.
                    </div>
                  </li>
                  <li>
                    <strong>Paste the token</strong> into the agent when prompted.
                  </li>
                  <li>
                    <strong>Open OBS</strong> - the agent connects locally.
                  </li>
                </ol>
                <div v-if="agentStatus?.paired && !agentConnected" class="ep-note">
                  Token is set - waiting for agent to connect...
                </div>
              </template>

              <div v-if="tokenVisible && token" class="ep-token-box">
                <input class="ep-token-value" :type="tokenRevealed ? 'text' : 'password'" :value="token" readonly />
                <button class="ep-eye-btn" @click="tokenRevealed = !tokenRevealed"
                  :title="tokenRevealed ? 'hide token' : 'show token'"
                  v-html="iconSvgFor(tokenRevealed ? 'eye-off' : 'eye')"></button>
                <button class="ep-copy-btn" @click="copyToken">{{ tokenJustCopied ? "copied!" : "Copy" }}</button>
                <button class="ep-dismiss-btn" @click="
                  tokenVisible = false;
                token = '';
                tokenRevealed = false;
                " title="I saved it, dismiss">
                  Done
                </button>
                <div class="ep-token-warning">Copy before dismissing - not stored on server.</div>
              </div>
            </div>
          </details>

          <div class="ep-field-group">
            <label class="ep-field-label">Optional: autostart with OBS</label>
            <div class="ep-note">
              In OBS, Tools → Scripts → + → pick <code>autostart.lua</code> from the agent's extracted folder.
              Starts the agent with OBS, stops it when OBS closes.
            </div>
          </div>

          <div class="ep-section">
            <div class="ep-section-label">General Settings</div>

            <div class="ep-field-group">
              <div class="ep-switch-row" @click="
                enabledLocal = !enabledLocal;
              saveSettings();
              ">
                <div class="ep-switch" :class="{ on: enabledLocal }">
                  <div class="ep-switch-knob"></div>
                </div>
                <span class="ep-switch-label">{{ enabledLocal ? "Connection enabled" : "Connection disabled"
                  }}</span>
              </div>
              <div class="ep-field-hint">Turn off to reject all agent connections.</div>
            </div>

            <div class="ep-field-group">
              <div class="ep-switch-row" @click="
                screenshotsLocal = !screenshotsLocal;
              saveSettings();
              ">
                <div class="ep-switch" :class="{ on: screenshotsLocal }">
                  <div class="ep-switch-knob"></div>
                </div>
                <span class="ep-switch-label">{{ screenshotsLocal ? "Scene previews on" : "Scene previews off"
                  }}</span>
              </div>
              <div class="ep-field-hint">Periodic screenshots of each scene.</div>
              <div v-if="screenshotsLocal" class="ep-interval-row">
                <span class="ep-field-hint">Refresh every</span>
                <input v-model.number="screenshotIntervalLocal" type="number" min="1" max="60" class="ep-field-input"
                  @change="saveSettings" />
                <span class="ep-field-hint">seconds (min 1)</span>
              </div>
              <div class="ep-field-hint">Only the broadcaster can change this.</div>
            </div>
          </div>

          <div v-if="agentConnected" class="ep-section">
            <div class="ep-section-label">Agent Management</div>

            <div class="ep-field-group">
              <div class="ep-download-row">
                <button class="ep-btn ep-btn-secondary" @click="openAgentPairingPage">Open pairing page</button>
                <button class="ep-btn ep-btn-secondary" :disabled="checkingAgentUpdate" @click="checkAgentUpdate">
                  {{ checkingAgentUpdate ? "checking..." : "Check for update" }}
                </button>
              </div>
              <div v-if="agentUpdateResult" class="ep-field-hint">{{ agentUpdateResult }}</div>
            </div>

            <div class="ep-field-group">
              <button class="ep-btn ep-btn-danger" :class="{ confirm: disconnectConfirm }"
                :disabled="disconnectingAgent" @click="disconnectAgent">
                {{
                  disconnectingAgent
                    ? "disconnecting..."
                    : disconnectConfirm
                      ? "Click again to confirm"
                      : "Disconnect agent"
                }}
              </button>
              <div class="ep-field-hint">Shuts down agent process on your PC.</div>
            </div>
          </div>

          <div v-if="settingsSaving || settingsSaved" class="ep-autosave">
            {{ settingsSaving ? "saving..." : "saved" }}
          </div>
        </div>

        <div class="ep-panel-footer">
          <button class="ep-btn ep-btn-secondary" @click="showSettings = false">Done</button>
        </div>
      </div>
    </div>
  </Teleport>

  <!-- >>> obs_edit permission, not broadcaster-only -->
  <Teleport to="body">
    <div v-if="showFilter && canFilterScenes" class="ep-overlay"
      v-bind="filterOverlay.handlers(() => (showFilter = false))">
      <div class="ep-panel obsconn-settings-panel">
        <div class="ep-panel-header">
          <div>
            <div class="ep-panel-title">Filter scenes</div>
          </div>
          <button class="ep-panel-close" @click="showFilter = false">
            x
          </button>
        </div>

        <div class="ep-panel-body">
          <div class="ep-field-group">
            <div class="ep-field-label obs-section-label">
              Scenes
              <button class="obs-refresh-btn" @click="refreshScenes" title="Refresh scene list"
                v-html="iconSvgFor('refresh-cw')">
              </button>
            </div>
            <div class="ep-field-hint">
              Unchecked scenes stay out of the scenes unless live - saves resources aswell
            </div>
            <div class="obs-filter-list">
              <div v-for="s in scenes" :key="s.sceneName" class="ep-list-row"
                :class="{ inactive: hiddenScenes.has(s.sceneName) }">
                <div class="ep-switch" :class="hiddenScenes.has(s.sceneName) ? 'off' : 'on'"
                  @click="toggleSceneHidden(s.sceneName)"><span class="ep-switch-knob"></span></div>
                <span>{{ s.sceneName }}</span>
              </div>
              <div v-if="!scenes.length" class="ep-field-hint">no scenes loaded yet</div>
            </div>
          </div>

          <div v-if="filterSaving" class="obsconn-autosave">saving…</div>
        </div>
      </div>
    </div>
  </Teleport>

  <Teleport to="body">
    <div v-if="showAddCategory" class="ep-overlay"
      v-bind="addCategoryOverlay.handlers(() => (showAddCategory = false))">
      <div class="ep-panel obs-add-category-panel">
        <div class="ep-panel-header">
          <div>
            <div class="ep-panel-title">Add category</div>
          </div>
          <button class="ep-panel-close" @click="showAddCategory = false">
            x
          </button>
        </div>
        <div class="ep-panel-body">
          <div class="ep-field-group">
            <label class="ep-field-label">Category</label>
            <TypeaheadInput v-model="addCategoryQuery" :fetch-items="fetchCategories" :min-chars="1" autofocus
              placeholder="Search a Twitch category..." @select="onAddCategorySelect" />
          </div>
        </div>
      </div>
    </div>
  </Teleport>

  <Teleport to="body">
    <div v-if="showAddSource" class="ep-overlay" v-bind="addSourceOverlay.handlers(() => (showAddSource = false))">
      <div class="ep-panel obs-add-category-panel">
        <div class="ep-panel-header">
          <div>
            <div class="ep-panel-title">Add browser source</div>
            <div class="ep-panel-sub">scene: {{ selectedScene }}</div>
          </div>
          <button class="ep-panel-close" @click="showAddSource = false">
            x
          </button>
        </div>
        <div class="ep-panel-body">
          <div class="ep-tabs">
            <button class="ep-tab" :class="{ active: addSourceMode === 'url' }" @click="addSourceMode = 'url'">
              URL
            </button>
            <button class="ep-tab" :class="{ active: addSourceMode === 'widget' }" @click="addSourceMode = 'widget'">
              ShyBoti widget
            </button>
            <button v-if="!hasOverlaySource" class="ep-tab" :class="{ active: addSourceMode === 'overlay' }"
              @click="addSourceMode = 'overlay'">
              Overlay
            </button>
          </div>

          <template v-if="addSourceMode === 'overlay'">
            <div class="ep-field-group">
              <label class="ep-field-label">Overlay</label>
              <select v-model="selectedOverlayChoice" class="ep-field-select">
                <option value="new">Create a new overlay</option>
                <option v-for="o in overlaysForPicker" :key="o.id" :value="o.id">{{ o.name }}</option>
              </select>
              <div class="ep-field-hint">
                An existing overlay's content is shared across every scene it's added to.
              </div>
            </div>

            <div v-if="addSourceError" class="ep-toast error">{{ addSourceError }}</div>

            <button class="ep-btn-save" :disabled="addSourceSaving" @click="submitAddSource">
              {{ addSourceSaving ? "adding..." : "add overlay" }}
            </button>
          </template>
          <template v-else>
            <div class="ep-field-group">
              <label class="ep-field-label">Name</label>
              <input v-model="addSourceName" type="text" class="ep-field-input" placeholder="Source name" />
            </div>

            <div v-if="addSourceMode === 'url'" class="ep-field-group">
              <label class="ep-field-label">URL</label>
              <input v-model="addSourceUrl" type="text" class="ep-field-input" placeholder="https://..." />
            </div>
            <div v-else class="ep-field-group">
              <label class="ep-field-label">Widget</label>
              <select v-model="addSourceWidgetId" class="ep-field-select"
                @change="pickAddSourceWidget(addSourceWidgetId)">
                <option value="" disabled>Pick a widget...</option>
                <option v-for="w in widgets" :key="w.id" :value="w.id">{{ w.name }}</option>
              </select>
              <div v-if="!widgets.length" class="ep-field-hint">
                No OBS widgets yet - create one on the OBS Widgets page first.
              </div>
            </div>

            <div class="ep-row-2">
              <div class="ep-field-group ep-sm">
                <label class="ep-field-label">Width</label>
                <input v-model.number="addSourceWidth" type="number" min="1" class="ep-field-input" />
              </div>
              <div class="ep-field-group ep-sm">
                <label class="ep-field-label">Height</label>
                <input v-model.number="addSourceHeight" type="number" min="1" class="ep-field-input" />
              </div>
            </div>

            <div v-if="addSourceError" class="ep-toast error">{{ addSourceError }}</div>

            <button class="ep-btn-save" :disabled="addSourceSaving" @click="submitAddSource">
              {{ addSourceSaving ? "adding..." : editMode ? "stage source (added on Save)" : "add source" }}
            </button>
          </template>
        </div>
      </div>
    </div>
  </Teleport>

  <!-- >>> site-wide, sits under navbar regardless of tab -->
  <Teleport to="body">
    <div v-if="!editMode" class="obs-live-mode-banner">
      <span class="dot"></span>Live mode is on - scene, source and category changes apply to your stream instantly
    </div>
  </Teleport>

  <Teleport to="body">
    <div v-if="editMode && hasPending && !locked" class="obs-save-bar">
      <span class="obs-save-lead">Unsaved changes</span>
      <div class="obs-diff-chips">
        <span v-for="(d, i) in pendingChanges" :key="i" class="obs-diff-chip">{{ d }}</span>
      </div>
      <div class="obs-save-btns">
        <button class="obs-btn-discard" @click="discardChanges">Discard</button>
        <button class="obs-btn-save" @click="saveChanges">Save changes</button>
      </div>
    </div>
  </Teleport>
</template>

<style scoped>
/* >>> page chrome, now a routed page not a modal */
.obsconn-page {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

/* >>> grid centers on full width, not leftover space */
.obsconn-header {
  position: relative;
  display: grid;
  grid-template-columns: 1fr auto 1fr;
  align-items: flex-start;
  gap: 12px;
}

.obsconn-header>.mode-bar {
  justify-self: center;
}

.obsconn-header-right {
  justify-self: end;
}

@media (max-width: 900px) {
  .obsconn-header {
    grid-template-columns: 1fr;
    justify-items: start;
  }

  .obsconn-header>.mode-bar,
  .obsconn-header-right {
    justify-self: stretch;
  }
}

.obsconn-title {
  font-size: 20px;
  font-weight: 700;
  color: #e0e0e0;
}

.obsconn-sub {
  font-size: 12px;
  color: #555;
  margin-top: 2px;
}

.obsconn-header-right {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
  justify-content: flex-end;
}

.obsconn-gear-btn {
  position: relative;
  width: 30px;
  height: 30px;
  display: flex;
  align-items: center;
  justify-content: center;
  border: 1px solid #2a2a30;
  background: #111217;
  color: #666;
  cursor: pointer;
  transition: all 0.15s;
  flex-shrink: 0;
}

.obs-gear-badge {
  position: absolute;
  top: -5px;
  right: -5px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 15px;
  height: 15px;
  padding: 0 3px;
  background: #f14949;
  color: #fff;
  border-radius: 3px;
  font-weight: 700;
  font-size: 10px;
  line-height: 1;
}

.obsconn-gear-btn svg {
  width: 16px;
  height: 16px;
}

.obsconn-gear-btn:hover {
  border-color: #9d6cff55;
  color: #9d6cff;
}

.obsconn-body {
  display: flex;
  flex-direction: column;
  gap: 18px;
}

.obsconn-settings-panel {
  width: min(560px, 92vw);
}

/* >>> settings panel redesign */
/* >>> scoped to just this panel, obsconn-settings-panel is shared with Filter scenes too */
.obs-settings-redesign .ep-panel-header {
  padding: 16px 20px;
}

.obs-settings-redesign .ep-panel-body {
  padding: 20px;
  gap: 16px;
}

.obs-settings-redesign .ep-field-label,
.obs-settings-redesign .ep-field-hint {
  font-size: 10px;
}

.obs-settings-redesign .ep-field-input {
  height: 32px;
  padding: 6px 10px;
  font-size: 12px;
}

.obs-settings-redesign .ep-panel-footer {
  justify-content: flex-end;
  padding: 12px 20px;
}

.ep-section {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.ep-section-label {
  font-size: 11px;
  font-weight: 700;
  color: #555;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  display: flex;
  align-items: center;
  gap: 6px;
}

.ep-section-label::after {
  content: "";
  flex: 1;
  height: 1px;
  background: #1e1e22;
}

.ep-details {
  border: 1px solid #1e1e22;
  background: #1a1a1e;
}

.ep-details summary {
  padding: 10px 12px;
  font-size: 11px;
  font-weight: 700;
  color: #555;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  cursor: pointer;
  list-style: none;
  display: flex;
  align-items: center;
  gap: 6px;
  transition: color 0.15s;
}

.ep-details summary::-webkit-details-marker {
  display: none;
}

.ep-details summary:hover {
  color: #9d6cff;
}

.ep-details summary::after {
  content: "▸";
  font-size: 10px;
  transition: transform 0.15s;
}

.ep-details[open] summary::after {
  transform: rotate(90deg);
}

.ep-details-body {
  padding: 10px 12px;
  border-top: 1px solid #1e1e22;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.ep-status-badge {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 4px 10px;
  font-size: 11px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  width: fit-content;
}

.ep-status-badge.ready {
  color: #23d18b;
  border: 1px solid rgba(35, 209, 139, 0.4);
  background: rgba(35, 209, 139, 0.08);
}

.ep-status-dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: currentColor;
}

.ep-steps {
  list-style: none;
  counter-reset: step;
}

.ep-steps li {
  counter-increment: step;
  position: relative;
  padding-left: 28px;
  margin-bottom: 12px;
  font-size: 12px;
  color: #777;
  line-height: 1.6;
}

.ep-steps li::before {
  content: counter(step);
  position: absolute;
  left: 0;
  top: 2px;
  width: 18px;
  height: 18px;
  background: rgba(111, 43, 255, 0.12);
  border: 1px solid rgba(111, 43, 255, 0.4);
  color: #9d6cff;
  font-size: 10px;
  font-weight: 700;
  display: flex;
  align-items: center;
  justify-content: center;
}

.ep-steps li strong {
  color: #aaa;
}

.ep-download-row {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
  margin-top: 4px;
}

.ep-download-row .ep-btn {
  height: 28px;
  font-size: 10px;
  padding: 0 12px;
}

.ep-note {
  font-size: 10px;
  color: #555;
  line-height: 1.5;
}

.ep-note code {
  font-family: "Consolas", "Fira Mono", monospace;
  color: #9d6cff;
}

.ep-note-link {
  color: #9d6cff;
  text-decoration: none;
}

/* Buttons */
.ep-btn {
  padding: 7px 14px;
  font-size: 11px;
  font-weight: 600;
  cursor: pointer;
  border: 1px solid;
  transition:
    background 0.15s,
    border-color 0.15s,
    color 0.15s;
  letter-spacing: 0.02em;
  height: 32px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 4px;
  text-decoration: none;
  color: inherit;
  font-family: inherit;
}

.ep-btn-primary {
  background: #6f2bff;
  border-color: #6f2bff;
  color: #fff;
}

.ep-btn-primary:hover {
  background: #7c3cff;
}

.ep-btn-secondary {
  background: transparent;
  border-color: #333;
  color: #888;
}

.ep-btn-secondary:hover {
  border-color: #555;
  color: #e0e0e0;
}

.ep-btn-danger {
  background: transparent;
  border-color: rgba(241, 73, 73, 0.4);
  color: #f14949;
}

.ep-btn-danger:hover {
  background: rgba(241, 73, 73, 0.1);
}

.ep-btn-danger.confirm {
  background: rgba(241, 73, 73, 0.2);
  border-color: #f14949;
  font-weight: 700;
}

.ep-btn:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}

.obs-settings-redesign .ep-panel-footer .ep-btn {
  min-width: 80px;
}

/* Toggle switch row (label + switch, exact demo sizing) */
.ep-switch-row {
  display: flex;
  align-items: center;
  gap: 12px;
  cursor: pointer;
  user-select: none;
}

.ep-switch-label {
  font-size: 12px;
  color: #888;
}

/* Token box */
.ep-token-box {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
  padding: 8px 10px;
  background: #111217;
  border: 1px solid rgba(111, 43, 255, 0.4);
}

.ep-token-value {
  font-family: "Consolas", "Fira Mono", monospace;
  font-size: 11px;
  letter-spacing: 2px;
  color: #b795ff;
  background: transparent;
  border: none;
  outline: none;
  flex: 1;
  min-width: 0;
}

.ep-eye-btn {
  width: 24px;
  height: 24px;
  padding: 0;
  border: 1px solid #2a2a30;
  background: transparent;
  color: #555;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
}

.ep-eye-btn:hover {
  color: #9d6cff;
  border-color: #9d6cff;
}

.ep-eye-btn svg {
  width: 13px;
  height: 13px;
}

.ep-copy-btn,
.ep-dismiss-btn {
  height: 24px;
  padding: 0 10px;
  font-size: 10px;
  cursor: pointer;
  border: 1px solid #2a2a30;
  background: transparent;
  color: #555;
}

.ep-copy-btn:hover {
  color: #9d6cff;
  border-color: #9d6cff;
}

.ep-dismiss-btn:hover {
  color: #e0e0e0;
  border-color: #444;
}

.ep-token-warning {
  width: 100%;
  font-size: 10px;
  color: #e5c07b;
  line-height: 1.4;
}

.ep-interval-row {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-top: 4px;
}

.ep-interval-row .ep-field-input {
  width: 60px;
  flex-shrink: 0;
  text-align: center;
}

.ep-autosave {
  align-self: flex-end;
  font-size: 10px;
  color: #555;
  padding-top: 4px;
}

.obs-add-category-panel {
  width: min(420px, 92vw);
}

/* >>> status bar */
.obs-status-bar {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 7px 10px;
  margin-bottom: 2px;
  border: 1px solid;
  font-size: 11px;
}

.obs-status-dot {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  flex-shrink: 0;
}

.obs-status-text {
  flex: 1;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.04em;
}

.obs-status-version {
  font-size: 9px;
  color: #444;
}

.status-none {
  color: #444;
  border-color: #2a2a30;
  background: transparent;
}

.status-none .obs-status-dot {
  background: #333;
}

.status-offline {
  color: #888;
  border-color: #2a2a3088;
  background: #0d0d1088;
}

.status-offline .obs-status-dot {
  background: #555;
}

.status-partial {
  color: #e5c07b;
  border-color: #e5c07b44;
  background: #e5c07b08;
}

.status-partial .obs-status-dot {
  background: #e5c07b;
}

.status-ready {
  color: #23d18b;
  border-color: #23d18b44;
  background: #23d18b08;
}

.status-ready .obs-status-dot {
  background: #23d18b;
  animation: pulse 2s ease-in-out infinite;
}

@keyframes pulse {

  0%,
  100% {
    opacity: 1;
  }

  50% {
    opacity: 0.4;
  }
}

/* >>> setup card */
.cmd-usecase-arg {
  color: rgb(from #e5c07b r g b / 80%);
}

.cmd-usecase {
  color: rgb(from #c4a0ff r g b / 80%);
  font-size: 10px;
  padding-left: 10px;
}

.obs-setup-card {
  border: 1px solid #1e1e22;
  padding: 14px 16px;
  background: #0d0d10;
}

.obs-setup-compact {
  padding: 12px 14px;
}

.obs-setup-compact .obs-setup-title {
  margin-bottom: 4px;
}

.obs-setup-title {
  font-size: 12px;
  font-weight: 600;
  color: #ccc;
  margin-bottom: 12px;
}

.obs-section-label {
  display: flex;
  align-items: center;
  gap: 8px;
}

.obs-refresh-btn {
  height: 30px;
  width: 30px;
  padding: 0 7px;
  border: 1px solid #2a2a30;
  background: #111217;
  color: #666666;
  font-size: 12px;
  cursor: pointer;
  transition: color 0.15s;
}

.obs-refresh-btn:hover {
  color: #9d6cff;
}

/* >>> live scene big & centered, rest small below */
.obs-scenes {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 14px;
}

.obs-scenes-live-row {
  display: flex;
  justify-content: center;
  align-items: stretch;
  width: 100%;
}

/* >>> sized to match the card, ignores stats overlay */
.obs-live-scene-wrap {
  position: relative;
}

.obs-scenes-others {
  display: flex;
  flex-wrap: wrap;
  justify-content: center;
  gap: 10px;
  width: 100%;
}

.obs-scene-card {
  width: 200px;
  padding: 0 0 8px;
  border: 1px solid #2a2a30;
  background: #111217;
  cursor: pointer;
  font-size: 12px;
  color: #888;
  position: relative;
  transition:
    border-color 0.15s,
    color 0.15s;
  overflow: hidden;
}

.obs-scene-card-live {
  width: 500px;
  max-width: 100%;
}

.obs-scene-card:hover {
  border-color: #3a3a44;
  color: #aaa;
}

.obs-scene-card.active {
  border-color: #6f2bff;
  color: #c4a0ff;
}

.obs-scene-card.picked:not(.active) {
  border-color: #2a2a42;
}

.obs-scene-live {
  position: absolute;
  top: 5px;
  right: 6px;
  font-size: 8px;
  font-weight: 700;
  letter-spacing: 0.08em;
  color: #fff;
  background: #f14949;
  padding: 2px 5px;
  z-index: 1;
}

.obs-scene-name {
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  text-align: center;
  flex: 1;
  min-width: 0;
}

.obs-scene-name-row {
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 7px 6px 0 10px;
}

.obs-scene-fs-btn {
  width: 18px;
  height: 18px;
  border: none;
  background: transparent;
  color: #555;
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  flex-shrink: 0;
}

.obs-scene-fs-btn svg {
  width: 11px;
  height: 11px;
}

.obs-scene-fs-btn:hover {
  color: #9d6cff;
}

.obs-scene-thumb {
  width: 100%;
  aspect-ratio: 16/9;
  background: #0a0a0d;
  overflow: hidden;
  display: flex;
  align-items: center;
  justify-content: center;
  border-bottom: 1px solid #1e1e24;
}

.obs-scene-thumb img {
  width: 100%;
  height: 100%;
  object-fit: cover;
  display: block;
}

.obs-scene-thumb-empty {
  font-size: 9px;
  color: #333;
}

.obs-projector-state {
  margin-top: 6px;
  font-size: 11px;
  color: #666;
}

.obs-projector-title {
  color: #666666ab;
  font-style: italic;
}

/* >>> sources */
.obs-source-list {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.obs-source-row {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
  padding: 5px 8px;
  background: #111217;
  border: 1px solid #1e1e24;
}

.obs-source-row.dragging {
  opacity: 0.4;
}

.obs-drag-handle {
  display: flex;
  align-items: center;
  color: #444;
  cursor: grab;
  flex-shrink: 0;
}

.obs-drag-handle:hover {
  color: #888;
}

.obs-box-label-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}

.obs-add-source-btn {
  width: 22px;
  height: 22px;
  border: 1px solid #6f2bff66;
  background: #6f2bff15;
  color: #9d6cff;
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  flex-shrink: 0;
  transition: background 0.15s;
}

.obs-add-source-btn svg {
  width: 11px;
  height: 11px;
}

.obs-add-source-btn:hover {
  background: #6f2bff30;
}

.obs-source-name {
  flex: 1;
  font-size: 12px;
  color: #888;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.obs-vis-btn,
.obs-mute-btn {
  height: 22px;
  padding: 0 9px;
  border: 1px solid #2a2a30;
  background: transparent;
  color: #555;
  font-family: inherit;
  font-size: 10px;
  cursor: pointer;
  flex-shrink: 0;
  transition: all 0.15s;
}

.obs-vis-btn.on {
  border-color: #6f2bff55;
  color: #9d6cff;
  background: #6f2bff0e;
}

.obs-mute-btn.muted {
  border-color: #f1494944;
  color: #f14949;
  background: #f149490a;
}

.obs-vis-btn:hover,
.obs-mute-btn:hover {
  border-color: #444;
  color: #aaa;
}

/* >>> bindings */
.obs-bind-list {
  display: flex;
  flex-direction: column;
  gap: 4px;
  margin-bottom: 8px;
}

.obs-bind-row,
.obs-add-row {
  display: flex;
  align-items: center;
  gap: 6px;
  flex-wrap: wrap;
  padding: 3px 0;
}

.obs-bind-prefix {
  color: #9d6cff;
  font-weight: 700;
  font-size: 12px;
  flex-shrink: 0;
}

.obs-bind-cmd {
  width: 120px;
  flex: none;
}

.obs-bind-target {
  width: 150px;
  flex: none;
}

.obs-bind-vol {
  width: 64px;
  flex: none;
}

.obs-bind-arrow {
  color: #555;
  font-size: 12px;
  flex-shrink: 0;
}

.obs-filter-list {
  display: flex;
  flex-direction: column;
  margin-top: 8px;
  max-height: 520px;
  overflow-y: auto;
  border: 1px solid #1e1e1e;
  scrollbar-width: none;
}

.obs-filter-list::-webkit-scrollbar {
  display: none;
}

.obs-filter-list .ep-list-row {
  font-size: 13px;
  color: #ccc;
}

.obs-filter-list .ep-list-row:last-child {
  border-bottom: none;
}

.obs-toggle {
  width: 34px;
  height: 18px;
  border: 1px solid #2a2a30;
  background: #0d0d10;
  padding: 2px;
  cursor: pointer;
  flex-shrink: 0;
  transition:
    border-color 0.15s,
    background 0.15s;
}

.obs-toggle.on {
  border-color: #6f2bff88;
  background: #6f2bff22;
}

.obs-toggle-knob {
  display: block;
  width: 12px;
  height: 12px;
  background: #555;
  transition:
    transform 0.15s,
    background 0.15s;
}

.obs-toggle.on .obs-toggle-knob {
  background: #9d6cff;
  transform: translateX(14px);
}

.obs-arg-list {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.obs-arg-row {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
  padding: 3px 0;
}

.obs-arg-label {
  width: 130px;
  flex: none;
  font-size: 11px;
  color: #999;
}

.obs-arg-usage {
  font-size: 10px;
  color: #444;
  font-family: "Consolas", "Fira Mono", monospace;
}

/* >>> centers boxes of different heights side by side */
.ep-field-group {
  justify-content: center;
}

.obs-box {
  justify-content: flex-start;
}

/* >>> avoids flashing not-set-up on first load */
.obs-loading {
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 48px 0;
}

.obs-loading-emote {
  width: 48px;
  height: 48px;
  image-rendering: pixelated;
  animation: obs-spin 1.1s linear infinite;
}

@keyframes obs-spin {
  to {
    transform: rotate(360deg);
  }
}

/* >>> sources | audio mixer | command builder */
.obs-boxes-row {
  display: flex;
  flex-wrap: wrap;
  gap: 14px;
  align-items: stretch;
}

.obs-boxes-row.obs-boxes-single {
  display: block;
}

.obs-box {
  padding: 12px 14px;
  border: 1px solid #1e1e22;
  background: #0d0d10;
  flex: 1 1 200px;
  min-width: 200px;
  max-width: 400px;
}

.obs-box-cat {
  flex: 0 0 590px;
  max-width: 590px;
  width: 590px;
  max-height: 200px
}

.obs-box-links {
  flex: 0 0 180px;
  max-width: 180px;
  width: 180px;
  gap: 8px;
  max-height: 200px
}

.obs-link-btn {
  width: 100%;
  text-align: center;
}

.obs-category-strip {
  display: flex;
  gap: 10px;
  flex-wrap: wrap;
  width: 100%;
}

.obs-category-card {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 6px;
  width: 100px;
  padding: 0;
  border: none;
  background: transparent;
  cursor: pointer;
  font-family: inherit;
  position: relative;
}

.obs-category-remove {
  position: absolute;
  top: 3px;
  right: 3px;
  width: 16px;
  height: 16px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(13, 13, 16, 0.85);
  border: 1px solid #2a2a30;
  color: #888;
  font-size: 12px;
  line-height: 1;
  z-index: 1;
}

.obs-category-remove:hover {
  border-color: #f14949;
  color: #f14949;
}

.obs-category-card.switching {
  opacity: 0.6;
}

.obs-category-card img,
.obs-category-empty {
  width: 100px;
  height: 133px;
  border: 1px solid #2a2a30;
  background: #111217;
  object-fit: cover;
  transition: border-color 0.15s;
}

.obs-category-empty {
  display: flex;
  align-items: center;
  justify-content: center;
  color: #555;
  font-size: 20px;
  font-weight: 700;
  text-transform: uppercase;
}

.obs-category-card:hover img,
.obs-category-card:hover .obs-category-empty {
  border-color: rgb(58, 58, 68);
}

.obs-category-card.active img,
.obs-category-card.active .obs-category-empty {
  border-width: 2px;
  border-color: rgb(111, 43, 255);
}

.obs-category-card:disabled {
  cursor: default;
}

.obs-category-card.disabled {
  cursor: default;
  opacity: 0.7;
}

.obs-category-plus {
  color: #444;
  font-size: 34px;
  font-weight: 400;
}

.obs-category-add:hover .obs-category-plus {
  color: #888;
}

.obs-category-name {
  font-size: 11px;
  color: #ccc;
  text-align: center;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  max-width: 100px;
}

.obs-category-error {
  margin-top: 8px;
  font-size: 11px;
  color: #f14949;
}

/* >>> access-level button, matches CommandsView's access-btn */
.access-btn {
  height: 28px;
  min-width: 70px;
  padding: 0 9px;
  border: 1px solid #2a2a30;
  background: transparent;
  color: #555;
  font-family: inherit;
  font-size: 10px;
  cursor: pointer;
  flex-shrink: 0;
  transition: all 0.15s;
}

.access-btn:hover {
  border-color: #555;
  color: #aaa;
}

.access-arrow {
  display: inline-block;
  font-size: 10px;
  opacity: 0.5;
  transition:
    color 0.15s,
    opacity 0.15s;
}

.access-arrow:first-child {
  margin-right: 3px;
}

.access-arrow:last-child {
  margin-left: 3px;
}

.access-btn:hover .access-arrow {
  color: #9d6cff;
  opacity: 1;
}

.access-btn.access-mod {
  border-color: #c792ea55;
  color: #c792ea;
  background: rgba(199, 146, 234, 0.08);
}

.access-btn.access-mod:hover {
  background: rgba(199, 146, 234, 0.15);
}

.access-btn.access-bc {
  border-color: #f1494955;
  color: #f14949;
  background: rgba(241, 73, 73, 0.08);
}

.access-btn.access-bc:hover {
  background: rgba(241, 73, 73, 0.15);
}

.access-btn-sm {
  height: 20px;
  font-size: 9px;
}

/* >>> audio mixer */
.obs-mixer-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.obs-mixer-row {
  padding: 6px 8px;
  background: #111217;
  border: 1px solid #1e1e24;
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.obs-mixer-top {
  display: flex;
  align-items: center;
  gap: 8px;
}

.obs-mixer-slider-row {
  display: flex;
  align-items: center;
  gap: 8px;
}

.obs-mixer-slider {
  flex: 1;
  accent-color: #9d6cff;
  /* >>> removes default white track background */
  background: transparent;
  -webkit-appearance: none;
  height: 4px;
}

.obs-mixer-slider::-webkit-slider-runnable-track {
  background: #2a2a30;
  height: 4px;
  border-radius: 2px;
}

.obs-mixer-slider::-webkit-slider-thumb {
  -webkit-appearance: none;
  width: 12px;
  height: 12px;
  border-radius: 50%;
  background: #9d6cff;
  margin-top: -4px;
  cursor: pointer;
}

.obs-mixer-slider::-moz-range-track {
  background: #2a2a30;
  height: 4px;
  border-radius: 2px;
}

.obs-mixer-slider::-moz-range-thumb {
  width: 12px;
  height: 12px;
  border-radius: 50%;
  background: #9d6cff;
  border: none;
  cursor: pointer;
}

.obs-mixer-db {
  font-size: 10px;
  color: #666;
  font-family: "Consolas", "Fira Mono", monospace;
  width: 56px;
  text-align: right;
  flex-shrink: 0;
}

/* >>> command builder, single-row form */
.obs-label-row {
  display: flex;
  align-items: flex-end;
  gap: 10px;
  flex-wrap: wrap;
  padding: 4px 0 12px;
}

.obs-label-col {
  display: flex;
  flex-direction: column;
  gap: 4px;
  flex-shrink: 0;
}

.obs-label-col-end {
  align-self: flex-end;
}

.obs-col-label {
  font-size: 9px;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  color: #555;
  white-space: nowrap;
}

/* >>> builder chat command name header */
.obs-cmd-name-row {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-bottom: 12px;
  padding-bottom: 12px;
  border-bottom: 1px solid #1e1e24;
}

.obs-cmd-name-prefix {
  font-size: 22px;
  font-weight: 700;
  color: #9d6cff;
  flex-shrink: 0;
  line-height: 1;
}

.obs-cmd-name-input {
  flex: 1;
  max-width: 260px;
  height: 36px;
  padding: 0 8px;
  font-size: 17px;
  font-weight: 600;
  background: transparent;
  border: none;
  border-bottom: 2px solid #2a2a38;
  color: #e0e0e0;
  outline: none;
  transition: border-color .15s;
}

.obs-cmd-name-input::placeholder {
  color: #2a2a3a;
  font-weight: 400;
}

.obs-cmd-name-input:focus {
  border-bottom-color: #9d6cff;
}

.obs-cmd-name-input.obs-trigger-conflict {
  border-bottom-color: #f14949;
  color: #f14949;
}

.obs-cmd-name-conflict {
  font-size: 10px;
  color: #f14949;
  letter-spacing: .04em;
  text-transform: uppercase;
  flex-shrink: 0;
}

/* >>> obs builder */
.obs-action-select {
  width: 140px;
  max-width: 140px;
  flex-shrink: 0;
}

.obs-target-input {
  width: 130px;
  flex-shrink: 0;
}

.obs-mode-seg {
  display: inline-flex;
  border: 1px solid #2a2a30;
  overflow: hidden;
  flex-shrink: 0;
}

.obs-mode-seg-btn {
  height: 26px;
  padding: 0 8px;
  border: none;
  background: transparent;
  color: #666;
  font-family: inherit;
  font-size: 10px;
  cursor: pointer;
  transition: all 0.15s;
  white-space: nowrap;
  border-right: 1px solid #2a2a30;
}

.obs-mode-seg-btn:last-child {
  border-right: none;
}

.obs-mode-seg-btn.active {
  background: #6f2bff15;
  color: #9d6cff;
  font-weight: 600;
}

.obs-mode-seg-btn:hover:not(.active) {
  color: #888;
}

.obs-arg-badge {
  display: inline-flex;
  align-items: center;
  height: 28px;
  padding: 0 8px;
  background: #e5c07b0e;
  border: 1px dashed #e5c07b55;
  color: #e5c07b;
  font-family: "Consolas", "Fira Mono", monospace;
  font-size: 10px;
  white-space: nowrap;
}

.obs-add-btn {
  height: 28px;
  padding: 0 14px;
  border: 1px solid #6f2bff66;
  background: #6f2bff12;
  color: #9d6cff;
  font-family: inherit;
  font-size: 11px;
  font-weight: 600;
  cursor: pointer;
  transition: all 0.15s;
  white-space: nowrap;
}

.obs-add-btn:hover:not(:disabled) {
  background: #6f2bff25;
  border-color: #9d6cff99;
}

.obs-add-btn:disabled {
  opacity: 0.35;
  cursor: not-allowed;
}

.obs-table-wrap {
  max-height: 240px;
  overflow-y: auto;
  border: 1px solid #1e1e24;
}

.obs-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 11px;
}

.obs-table th {
  text-align: left;
  padding: 6px 10px;
  color: #555;
  font-weight: 600;
  font-size: 9px;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  border-bottom: 1px solid #1e1e24;
  background: #0a0a0d;
  position: sticky;
  top: 0;
  z-index: 1;
}

.obs-table td {
  padding: 6px 10px;
  color: #888;
  border-bottom: 1px solid #1a1a20;
  white-space: nowrap;
  max-width: 160px;
  overflow: hidden;
  text-overflow: ellipsis;
}

.obs-table tbody tr:hover {
  background: #ffffff03;
}

.obs-table-empty {
  text-align: center;
  color: #444;
  padding: 20px !important;
}

.obs-td-trigger {
  color: #c4a0ff;
  font-weight: 600;
}

.obs-td-target {
  color: #ccc;
}

.obs-td-target-arg {
  color: #e5c07b;
  font-style: italic;
  font-family: "Consolas", "Fira Mono", monospace;
}

.obs-target-warn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  margin-left: 4px;
  min-width: 15px;
  height: 15px;
  padding: 0 3px;
  background: #f14949;
  color: #fff;
  border-radius: 3px;
  font-weight: 700;
  font-size: 10px;
  line-height: 1;
  cursor: help;
}

.obs-td-delete {
  color: #555;
  cursor: pointer;
  font-size: 13px;
  transition: color 0.15s;
  text-align: center;
  width: 30px;
}

.obs-td-delete:hover {
  color: #f14949;
}

.obs-type-badge {
  display: inline-block;
  font-size: 9px;
  padding: 1px 7px;
  border: 1px solid #2a2a30;
  color: #666;
}

.obs-type-badge.fixed-type {
  border-color: #6f2bff44;
  color: #9d6cff;
}

.obs-type-badge.arg-type {
  border-color: #e5c07b44;
  color: #e5c07b;
}

@media (max-width: 900px) {
  .obs-boxes-row {
    flex-direction: column;
  }

  .obs-box,
  .obs-box-cat,
  .obs-box-links {
    max-width: 100%;
    width: 100%;
  }
}

@media (max-width: 680px) {

  .obs-bind-cmd,
  .obs-bind-target {
    width: 100%;
  }

  .obs-arg-label {
    width: 100%;
  }

  .obs-scenes-others {
    gap: 8px;
  }

  .obs-scenes-others .obs-scene-card {
    width: calc(50% - 4px);
  }

  .obs-live-scene-wrap {
    display: flex;
    flex-direction: column;
    align-items: center;
    width: 100%;
  }

  .obs-live-stats {
    position: static;
    margin-top: 10px;
    flex-direction: row;
    flex-wrap: wrap;
    justify-content: center;
    width: 100%;
  }

  .obs-live-stat {
    flex: 1 1 90px;
  }

  .obs-label-row {
    flex-direction: column;
    align-items: stretch;
    gap: 10px;
  }

  .obs-label-col,
  .obs-label-col-end {
    width: 100%;
    align-self: stretch;
  }

  .obs-action-select,
  .obs-target-input {
    width: 100%;
    max-width: none;
  }

  .obs-mode-seg {
    width: 100%;
    display: flex;
  }

  .obs-mode-seg-btn {
    flex: 1;
  }

  .obs-arg-badge {
    width: 100%;
    justify-content: center;
    box-sizing: border-box;
  }

  /* >>> scoped to the builder form, not per-row buttons */
  .obs-label-row .access-btn,
  .obs-add-btn {
    width: 100%;
  }

  /* >>> scrolls sideways instead of truncating cells */
  .obs-table-wrap {
    overflow-x: auto;
  }

  .obs-table {
    min-width: 560px;
  }

  .obs-builder-tabs {
    overflow-x: auto;
  }

  .obs-box-cat {
    padding: 12px;
  }
}

/* >>> in-flow so it reserves space, was overlapping mode-bar */
.obs-live-stats {
  display: flex;
  flex-direction: row;
  flex-wrap: wrap;
  justify-content: flex-end;
  align-items: center;
  gap: 6px;
  flex-basis: 100%;
  margin-top: 6px;
}

.obs-live-stat {
  display: flex;
  flex-direction: row;
  align-items: baseline;
  gap: 5px;
  padding: 3px 8px;
  border: 1px solid #1e1e24;
  background: #0d0d10;
}

.obs-live-stat-label {
  font-size: 9px;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  color: #555;
}

.obs-live-stat-value {
  font-size: 13px;
  font-family: "Consolas", "Fira Mono", monospace;
  color: #9d6cff;
  font-weight: 600;
}

.obs-live-stat.bad .obs-live-stat-value {
  color: #f14949;
}

/* >>> command/rule builder tab switch */
.obs-builder-tabs {
  display: flex;
  gap: 2px;
  margin-bottom: 10px;
  border-bottom: 1px solid #1e1e22;
}

.obs-builder-tab {
  padding: 6px 12px;
  border: none;
  background: transparent;
  color: #555;
  font-family: inherit;
  font-size: 11px;
  font-weight: 600;
  cursor: pointer;
  border-bottom: 2px solid transparent;
  margin-bottom: -1px;
  transition:
    color 0.15s,
    border-color 0.15s;
}

.obs-builder-tab.active {
  color: #9d6cff;
  border-bottom-color: #6f2bff;
}

.obs-builder-tab:hover:not(.active) {
  color: #888;
}

/* >>> small toggle for the rule table's on column */
.obs-toggle-sm {
  width: 26px;
  height: 15px;
}

.obs-toggle-sm .obs-toggle-knob {
  width: 9px;
  height: 9px;
}

.obs-toggle-sm.on .obs-toggle-knob {
  transform: translateX(11px);
}

/* vvv live/edit mode + staged changes vvv */
/* >>> lives in the header row, sized to content not stretched */
.mode-bar {
  display: flex;
  align-items: center;
  gap: 14px;
  flex-wrap: wrap;
  padding: 6px 12px;
  border: 1px solid #1e1e22;
  background: #0d0d10;
  width: max-content;
  max-width: 480px;
}

.mode-bar-left {
  display: flex;
  align-items: center;
  gap: 10px;
}

.mode-bar .switch {
  position: relative;
  width: 40px;
  height: 22px;
  border: 1px solid #2a2a30;
  background: #111217;
  cursor: pointer;
  flex-shrink: 0;
}

.mode-bar .switch .knob {
  position: absolute;
  top: 2px;
  left: 2px;
  width: 16px;
  height: 16px;
  background: #555;
  transition: left 0.15s, background 0.15s;
}

.mode-bar .switch.live {
  border-color: #f1494966;
  background: #f1494914;
}

.mode-bar .switch.live .knob {
  left: 20px;
  background: #f14949;
}

.mode-bar .switch.edit {
  border-color: #e5c07b55;
  background: #e5c07b0e;
}

.mode-bar .switch.edit .knob {
  background: #e5c07b;
}

.mode-state {
  font-size: 12px;
  font-weight: 700;
  min-width: 32px;
}

.mode-state.edit {
  color: #e5c07b;
}

.mode-state.live {
  color: #f14949;
}

.mode-hint {
  font-size: 11px;
  color: #555;
}

.mode-hint.locked-hint {
  color: #f14949;
  font-weight: 600;
}

/* >>> instant safety-switch lock */
.obs-locked {
  opacity: 0.5;
  pointer-events: none;
}

.obs-scene-card.pending {
  border-color: #e5c07b;
  color: #f0d9a0;
}

.obs-scene-pending-tag {
  position: absolute;
  top: 5px;
  left: 6px;
  font-size: 8px;
  font-weight: 700;
  letter-spacing: 0.08em;
  color: #20180a;
  background: #e5c07b;
  padding: 2px 5px;
  z-index: 1;
}

.obs-source-row.pending,
.obs-mixer-row.pending {
  border-left: 2px solid #e5c07b;
  background: #e5c07b0d;
}

/* >>> switch-on-save, separate from clicking the card */
.obs-scene-stage-btn {
  position: absolute;
  top: 5px;
  right: 6px;
  width: 22px;
  height: 22px;
  border: 1px solid #2a2a30;
  background: #0d0d10cc;
  color: #666;
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  z-index: 2;
  transition: color 0.15s, border-color 0.15s, background 0.15s;
}

.obs-scene-stage-btn svg {
  width: 10px;
  height: 10px;
}

.obs-scene-stage-btn:hover {
  color: #9d6cff;
  border-color: #6f2bff66;
}

.obs-scene-stage-btn.active {
  color: #20180a;
  background: #e5c07b;
  border-color: #e5c07b;
}

.pending-tag {
  font-size: 8px;
  font-weight: 700;
  color: #20180a;
  background: #e5c07b;
  padding: 2px 5px;
  letter-spacing: 0.05em;
  text-transform: uppercase;
  flex-shrink: 0;
}

.obs-category-card.pending img,
.obs-category-card.pending .obs-category-empty {
  border-width: 2px;
  border-color: #e5c07b;
}

/* >>> site-wide live-mode banner, teleported under navbar */
.obs-live-mode-banner {
  position: fixed;
  top: 52px;
  left: 0;
  right: 0;
  z-index: 150;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  padding: 7px 16px;
  background: #f1494914;
  border-bottom: 1px solid #f1494944;
  color: #f14949;
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.04em;
  text-transform: uppercase;
}

.obs-live-mode-banner .dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: #f14949;
  animation: obs-live-blip 1.1s ease-in-out infinite;
}

@keyframes obs-live-blip {

  0%,
  100% {
    opacity: 1;
  }

  50% {
    opacity: 0.2;
  }
}

@media (prefers-reduced-motion: reduce) {
  .obs-live-mode-banner .dot {
    animation: none;
  }
}

/* >>> floating save bar for staged changes */
.obs-save-bar {
  position: fixed;
  left: 200px;
  right: 0;
  bottom: 0;
  background: #17130a;
  border-top: 1px solid #e5c07b73;
  padding: 10px 20px;
  display: flex;
  align-items: center;
  gap: 14px;
  flex-wrap: wrap;
  z-index: 140;
}

.obs-save-lead {
  font-size: 11px;
  font-weight: 700;
  color: #e5c07b;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  flex-shrink: 0;
}

.obs-diff-chips {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  flex: 1;
  min-width: 0;
}

.obs-diff-chip {
  font-size: 11px;
  background: #e5c07b16;
  border: 1px solid #e5c07b66;
  color: #f0d9a0;
  padding: 3px 8px;
  white-space: nowrap;
}

.obs-save-btns {
  display: flex;
  gap: 8px;
  flex-shrink: 0;
}

.obs-btn-save,
.obs-btn-discard {
  border: none;
  padding: 8px 14px;
  font-size: 12px;
  font-weight: 700;
  cursor: pointer;
  font-family: inherit;
}

.obs-btn-save {
  background: #23d18b;
  color: #04170f;
}

.obs-btn-save:hover {
  background: #33e0a0;
}

.obs-btn-discard {
  background: transparent;
  border: 1px solid #333;
  color: #888;
}

.obs-btn-discard:hover {
  color: #e0e0e0;
  border-color: #555;
}

@media (max-width: 680px) {
  .obs-save-bar {
    left: 0;
  }
}

/* ^^^ live/edit mode + staged changes ^^^ */
</style>
