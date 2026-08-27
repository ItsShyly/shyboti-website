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
import RowKebabMenu, { type KebabMenuItem } from "./shared/RowKebabMenu.vue";
import { iconSvg as iconSvgFor } from "../composables/icons";
import { useI18n } from "../i18n";

const { t } = useI18n();
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

// >>> sources/mixer/categories drawer, opens up from the bottom bar
const boxesOpen = ref(false);
// >>> collapsed by default, state outlives closing/reopening the drawer
// >>> since this component never unmounts while just toggling boxesOpen
const sourcesCollapsed = ref(true);
const mixerCollapsed = ref(true);
// >>> starts open, unlike sources/mixer - categories are picked at a glance
const categoriesCollapsed = ref(false);

// >>> phone-only bottom nav tab - which panel the drawer shows instead of the topbar
type MobileTab = "scenes" | "categories" | "sources" | "mixer" | "stats";
const mobileTab = ref<MobileTab>("scenes");
function selectMobileTab(tab: MobileTab) {
  mobileTab.value = tab;
  boxesOpen.value = tab !== "scenes";
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
  pendingSourceEdits.value = {};
  pendingCategory.value = null;
}
// ^^^ navigation safety switch ^^^

// vvv live/edit mode + staged changes vvv
const editMode = ref(true); // <<< default: edit mode, nothing applies until Save
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

// >>> always just previews - same in both modes, never switches live on its own
function onSceneClick(name: string) {
  if (locked.value) return;
  selectedScene.value = name;
  loadSources(name);
}

// >>> the only way to actually go live with the previewed scene - immediate,
// >>> not staged, same in both edit and live mode
const canTakeToProgram = computed(
  () => !locked.value && !!selectedScene.value && selectedScene.value !== currentScene.value,
);
function takeToProgram() {
  if (!canTakeToProgram.value) return;
  switchScene(selectedScene.value);
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
}

async function saveChanges() {
  if (locked.value || !hasPending.value) return;
  const gen = requestGen.value;
  const tasks: Promise<any>[] = [];
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
    pendingSourceEdits.value = {};
    pendingCreates.value = [];
    pendingCategory.value = null;
  }
}

function discardChanges() {
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
// >>> one unified strip now (program/preview panels show live vs previewed)
const visibleScenes = computed(() =>
  scenes.value.filter((s) => !hiddenScenes.value.has(s.sceneName)),
);
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
      const prevScreenshots = agentStatus.value?.screenshots;
      agentStatus.value = d;
      // >>> shot loop only (re)starts from local actions
      if (d.screenshots !== prevScreenshots || (d.screenshots && !shotTimer)) {
        restartShotLoop();
      }
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

function openAgentDebugConsole() {
  window.open("http://127.0.0.1:47115/logs", "_blank");
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

// >>> lets a plain vertical mouse wheel scroll the horizontal scene strip
function onSceneStripWheel(e: WheelEvent) {
  const el = e.currentTarget as HTMLElement;
  if (el.scrollWidth <= el.clientWidth) return;
  e.preventDefault();
  el.scrollLeft += e.deltaY;
}

// >>> mobile-only, the top bar's gear/refresh buttons collapse into this
const topbarKebabItems = computed<KebabMenuItem[]>(() => {
  const items: KebabMenuItem[] = [];
  if (obsConnected.value && canFilterScenes.value) {
    items.push({ key: "refresh", label: "Refresh scene list", icon: "refresh-cw", onClick: refreshScenes });
    items.push({ key: "filter", label: "Filter scenes", icon: "tool", onClick: openFilter });
  }
  if (isBroadcaster.value) {
    items.push({ key: "settings", label: "OBS settings", icon: "settings", onClick: openSettings });
  }
  return items;
});

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
  <div class="obsconn-page" :data-mtab="mobileTab">
    <!-- vvv top bar - mode/connection/gear controls + the sources/mixer drawer toggle vvv -->
    <div class="obs-topbar">
      <div class="obs-topbar-left">
        <div class="obsconn-title-slim obs-topbar-mobile-hide">{{ t('obsconn.title') }}</div>

        <div class="obs-mode-toggle-slim" :title="editMode
          ? t('obsconn.mode.edit_hint')
          : t('obsconn.mode.live_hint')
          " @click="setMode(!editMode)">
          <div class="switch" :class="editMode ? 'edit' : 'live'">
            <div class="knob"></div>
          </div>
          <span class="mode-state" :class="editMode ? 'edit' : 'live'">{{ editMode ? t('obsconn.mode.edit') : t('obsconn.mode.live') }}</span>
        </div>

        <span v-if="locked" class="mode-hint locked-hint"><span v-html="iconSvgFor('lock')"></span> {{ t('obsconn.leaving') }}</span>

        <div class="obs-status-bar-slim" :class="connStatusClass"
          :title="agentStatus?.version ? `v${agentStatus.version}` : ''">
          <div class="obs-status-dot"></div>
          <span class="obs-status-text obs-topbar-mobile-hide">{{ connStatusLabel }}</span>
        </div>
      </div>

      <button v-if="(agentConnected && obsConnected) || agentStatus?.paired" class="obs-drawer-toggle"
        :class="{ open: boxesOpen }" :title="t('obsconn.drawer_toggle')" @click="boxesOpen = !boxesOpen"
        v-html="iconSvgFor('chevron-down')"></button>

      <div class="obs-topbar-right">
        <div v-if="agentConnected && obsConnected && bitrateLabel" class="obs-topbar-stat obs-topbar-mobile-hide"
          :class="{ bad: bitrateBad }">
          {{ bitrateLabel }}
        </div>

        <button v-if="obsConnected && canFilterScenes" class="obs-refresh-btn obs-topbar-mobile-hide"
          @click="refreshScenes" :title="t('obsconn.refresh_title')" v-html="iconSvgFor('refresh-cw')">
        </button>
        <button v-if="obsConnected && canFilterScenes" class="obsconn-gear-btn obs-topbar-mobile-hide"
          :title="t('obsconn.filter_title')" @click="openFilter">
          <svg viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg">
            <path d="M3 4h14l-5.5 6.5v5l-3 1.5v-6.5L3 4z" stroke="currentColor" stroke-width="1.5"
              stroke-linejoin="round" />
          </svg>
        </button>
        <button v-if="isBroadcaster" class="obsconn-gear-btn obs-topbar-mobile-hide" :title="t('obsconn.settings_title')"
          @click="openSettings">
          <svg viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg">
            <path d="M10 12.5a2.5 2.5 0 100-5 2.5 2.5 0 000 5z" stroke="currentColor" stroke-width="1.5" />
            <path
              d="M16.2 12.3a1.4 1.4 0 00.3 1.5l.05.05a1.65 1.65 0 11-2.35 2.35l-.05-.05a1.4 1.4 0 00-1.5-.3 1.4 1.4 0 00-.85 1.28v.14a1.65 1.65 0 11-3.3 0v-.07a1.4 1.4 0 00-.92-1.28 1.4 1.4 0 00-1.5.3l-.05.05A1.65 1.65 0 113.63 13.9l.05-.05a1.4 1.4 0 00.3-1.5 1.4 1.4 0 00-1.28-.85h-.14a1.65 1.65 0 110-3.3h.07a1.4 1.4 0 001.28-.92 1.4 1.4 0 00-.3-1.5l-.05-.05A1.65 1.65 0 116.09 3.38l.05.05a1.4 1.4 0 001.5.3h.06a1.4 1.4 0 00.85-1.28V2.3a1.65 1.65 0 113.3 0v.07a1.4 1.4 0 00.85 1.28h.06a1.4 1.4 0 001.5-.3l.05-.05a1.65 1.65 0 112.35 2.35l-.05.05a1.4 1.4 0 00-.3 1.5v.06a1.4 1.4 0 001.28.85h.14a1.65 1.65 0 110 3.3h-.07a1.4 1.4 0 00-1.28.85z"
              stroke="currentColor" stroke-width="1.3" />
          </svg>
          <span v-if="!loading && !agentStatus?.paired" class="obs-gear-badge" :title="t('obsconn.not_set_up_badge')">!</span>
        </button>

        <RowKebabMenu :items="topbarKebabItems" @click.stop />
      </div>

      <!-- >>> no backdrop, stays open so scenes stay clickable while it's open -->
      <div class="obs-drawer" :class="{ open: boxesOpen }">
        <div v-if="agentConnected && obsConnected" class="obs-live-stats">
          <div class="flex">
            <div class="obs-live-stat" :class="{ bad: bitrateBad }">
              <span class="obs-live-stat-label">{{ t('obsconn.stat.bitrate') }}</span>
              <span class="obs-live-stat-value">{{ bitrateLabel ?? t('obsconn.not_streaming') }}</span>
            </div>
            <div class="obs-live-stat">
              <span class="obs-live-stat-label">{{ t('obsconn.stat.preview_size') }}</span>
              <span class="obs-live-stat-value">{{
                liveShotStats.kb != null
                  ? liveShotStats.kb + " kb"
                  : agentStatus?.screenshots
                    ? "--"
                    : t('obsconn.stat_off')
              }}</span>
            </div>
            <div class="obs-live-stat">
              <span class="obs-live-stat-label">{{ t('obsconn.stat.preview_cpu') }}</span>
              <span class="obs-live-stat-value">{{
                liveShotStats.cpuMs != null
                  ? liveShotStats.cpuMs + " ms"
                  : agentStatus?.screenshots
                    ? "--"
                    : t('obsconn.stat_off')
              }}</span>
            </div>
          </div>
          <div> <button class="ep-btn-cancel obs-link-btn" @click="router.push('/commands')">
              OBS commands
            </button>
            <button class="ep-btn-cancel obs-link-btn" @click="router.push('/automations?tab=obs')">
              OBS automations
            </button>
          </div>
        </div>

        <!-- >>> builder still works even if obs isn't connected -->
        <div v-if="(agentConnected && obsConnected) || agentStatus?.paired" class="obs-boxes-row"
          :class="{ 'obs-boxes-single': !(agentConnected && obsConnected) }">
          <template v-if="agentConnected && obsConnected">
            <div class="ep-field-group obs-box obs-box-sources" :class="{ collapsed: sourcesCollapsed }">
              <div class="obs-box-label-row">
                <label class="ep-field-label obs-box-collapse-label" @click="sourcesCollapsed = !sourcesCollapsed">
                  <span class="obs-box-collapse-chevron" :class="{ open: !sourcesCollapsed }"
                    v-html="iconSvgFor('chevron-down')"></span>
                  {{ t('obsconn.sources_label') }}
                  <span v-if="selectedScene" class="ep-field-hint">{{
                    selectedScene
                  }}</span></label>
                <button v-if="selectedScene" class="obs-add-source-btn" :title="t('obsconn.add_source_title')"
                  @click="openAddSource" v-html="iconSvgFor('plus')"></button>
              </div>
              <div v-show="!sourcesCollapsed" class="obs-source-list">
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
                  <span class="obs-drag-handle" :title="t('obsconn.drag_reorder')" v-html="iconSvgFor('grip')"></span>
                  <span class="obs-source-name">{{ src.sourceName }}</span>
                  <span v-if="isSourcePending(src)" class="pending-tag">pending</span>
                  <button class="obs-vis-btn" :class="{ on: effectiveVisible(src) }"
                    :disabled="pendingSources.has(src.sceneItemId)" @click.stop="onToggleVisible(src)">
                    {{ effectiveVisible(src) ? t('obsconn.visible') : t('obsconn.hidden') }}
                  </button>
                  <template v-if="src.isAudioSource">
                    <button class="obs-mute-btn" :class="{ muted: effectiveMuted(src) }"
                      :disabled="pendingSources.has(src.sceneItemId)" @click.stop="onToggleMute(src)">
                      {{ effectiveMuted(src) ? t('obsconn.muted') : t('obsconn.unmuted') }}
                    </button>
                  </template>
                </div>
                <div v-for="c in pendingCreates.filter((c) => c.scene === selectedScene)" :key="c.id"
                  class="obs-source-row pending">
                  <span class="obs-source-name">{{ c.name }}</span>
                  <span class="pending-tag">pending (new)</span>
                  <button class="ep-btn-action del" :title="t('obsconn.cancel_title')" @click="removePendingCreate(c.id)">
                    <span v-html="iconSvgFor('x')"></span>
                  </button>
                </div>
                <div v-if="!sources.length && !sourcesLoading && !pendingCreates.some((c) => c.scene === selectedScene)"
                  class="ep-empty">
                  {{
                    selectedScene
                      ? t('obsconn.no_sources')
                      : t('obsconn.pick_scene_above')
                  }}
                </div>
              </div>
            </div>

            <div class="ep-field-group obs-box obs-box-mixer" :class="{ collapsed: mixerCollapsed }">
              <div class="obs-box-label-row">
                <label class="ep-field-label obs-box-collapse-label" @click="mixerCollapsed = !mixerCollapsed">
                  <span class="obs-box-collapse-chevron" :class="{ open: !mixerCollapsed }"
                    v-html="iconSvgFor('chevron-down')"></span>
                  {{ t('obsconn.mixer_label') }}
                  <span v-if="selectedScene" class="ep-field-hint">{{
                    selectedScene
                  }}</span></label>
              </div>
              <div v-show="!mixerCollapsed" class="obs-mixer-list">
                <div v-for="src in audioSources" :key="src.sceneItemId" class="obs-mixer-row"
                  :class="{ pending: isSourcePending(src) }">
                  <div class="obs-mixer-top">
                    <span class="obs-source-name">{{ src.sourceName }}</span>
                    <span v-if="isSourcePending(src)" class="pending-tag">pending</span>
                    <button class="obs-mute-btn" :class="{ muted: effectiveMuted(src) }"
                      :disabled="pendingSources.has(src.sceneItemId)" @click="onToggleMute(src)">
                      {{ effectiveMuted(src) ? t('obsconn.muted') : t('obsconn.unmuted') }}
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
                      ? t('obsconn.no_audio_sources')
                      : t('obsconn.pick_scene_above')
                  }}
                </div>
              </div>
            </div>
          </template>

          <div v-if="agentConnected && obsConnected" class="ep-field-group obs-box obs-box-cat"
            :class="{ collapsed: categoriesCollapsed }">
            <div class="obs-drawer-preview-mini">
              <div class="obs-drawer-preview-mini-thumb">
                <img v-if="selectedScene && sceneShots[selectedScene]" :src="sceneShots[selectedScene]"
                  :alt="selectedScene" />
                <div v-else class="obs-scene-thumb-empty">{{ selectedScene && agentStatus?.screenshots ? "…" : "" }}
                </div>
              </div>
              <div class="obs-drawer-preview-mini-info">
                <div class="obs-drawer-preview-mini-label">{{ t('obsconn.previewing_label') }}</div>
                <div class="obs-drawer-preview-mini-name">{{ selectedScene || t('obsconn.no_scene_selected') }}</div>
              </div>
            </div>
            <div class="obs-box-label-row">
              <label class="ep-field-label obs-box-collapse-label" @click="categoriesCollapsed = !categoriesCollapsed">
                <span class="obs-box-collapse-chevron" :class="{ open: !categoriesCollapsed }"
                  v-html="iconSvgFor('chevron-down')"></span>
                {{ t('obsconn.switch_categories') }}
              </label>
            </div>
            <div v-show="!categoriesCollapsed" class="obs-category-content">
              <div class="obs-category-strip" @wheel="onSceneStripWheel">
                <button v-for="c in categoryHistory" :key="c.category_id" class="obs-category-card"
                  :class="{ disabled: !canFilterScenes, active: c.category_id === currentCategoryId, pending: isCategoryPending(c.category_id), switching: switchingCategory === c.category_id }"
                  :disabled="switchingCategory === c.category_id" :title="c.category_name" @click="onCategoryClick(c)">
                  <span v-if="canFilterScenes" class="obs-category-remove" :title="t('obsconn.remove_title')"
                    @click.stop="removeCategory(c.category_id)">×</span>
                  <img v-if="c.box_art_url" :src="c.box_art_url" :alt="c.category_name" />
                  <div v-else class="obs-category-empty">{{ c.category_name.slice(0, 2) }}</div>
                  <span class="obs-category-name">{{ c.category_name }}</span>
                </button>
                <template v-if="canFilterScenes">
                  <button v-for="n in emptyCategorySlots" :key="'empty' + n" class="obs-category-card obs-category-add"
                    :title="t('obsconn.add_category_title')" @click="showAddCategory = true">
                    <div class="obs-category-empty obs-category-plus">+</div>
                  </button>
                </template>
              </div>
              <div v-if="categorySwitchError" class="obs-category-error">{{ categorySwitchError }}</div>
            </div>
          </div>
        </div>
      </div>
      <!-- ^^^ drawer ^^^ -->
    </div>
    <!-- ^^^ top bar ^^^ -->

    <div v-if="!editMode" class="obs-live-mode-banner">
      <span class="dot"></span>{{ t('obsconn.live_banner') }}
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
                    ? t('obsconn.setup.agent_connected')
                    : t('obsconn.setup.waiting_agent')
                  : t('obsconn.setup.not_set_up')
              }}
            </div>
            <div class="obs-setup-hint">
              {{ t('obsconn.setup.click_gear') }}
              {{
                agentStatus?.paired
                  ? t('obsconn.setup.view_token')
                  : t('obsconn.setup.get_token')
              }}
            </div>
          </template>
          <template v-else>
            <div class="obs-setup-title">{{ t('obsconn.setup.not_connected') }}</div>
            <div class="obs-setup-hint">
              {{ t('obsconn.setup.ask_broadcaster') }}
            </div>
          </template>
        </div>
      </template>

      <template v-if="agentConnected && obsConnected">
        <div class="obs-program-preview">
          <div class="obs-pp-pane obs-pp-preview" :class="{ empty: !selectedScene }">
            <div class="obs-pp-label">{{ t('obsconn.preview_label') }}</div>
            <div class="obs-pp-thumb">
              <img v-if="selectedScene && sceneShots[selectedScene]" :src="sceneShots[selectedScene]"
                :alt="selectedScene" />
              <div v-else class="obs-scene-thumb-empty">
                {{ selectedScene ? (agentStatus?.screenshots ? "…" : t('obsconn.previews_off')) : t('obsconn.pick_scene_below') }}
              </div>
            </div>
            <div class="obs-pp-name-row">
              <div class="obs-pp-name">{{ selectedScene || "—" }}</div>
              <button v-if="selectedScene" class="obs-scene-fs-btn" :title="t('obsconn.edit_overlay_title')"
                @click.stop="openOverlayEditor(selectedScene)" v-html="iconSvgFor('edit')"></button>
            </div>
          </div>

          <button class="obs-take-btn" :disabled="!canTakeToProgram"
            :title="t('obsconn.take_hint')" @click="takeToProgram">
            <span v-html="iconSvgFor('arrow-right')"></span>
            <span class="obs-take-btn-label">{{ t('obsconn.take_label') }}</span>
          </button>

          <div class="obs-pp-pane obs-pp-program">
            <div class="obs-pp-label">{{ t('obsconn.live_label') }}</div>
            <div class="obs-pp-thumb">
              <img v-if="currentScene && sceneShots[currentScene]" :src="sceneShots[currentScene]"
                :alt="currentScene" />
              <div v-else class="obs-scene-thumb-empty">
                {{ agentStatus?.screenshots ? "…" : t('obsconn.previews_off') }}
              </div>
            </div>
            <div class="obs-pp-name-row">
              <div class="obs-pp-name">{{ currentScene || "—" }}</div>
            </div>
          </div>
        </div>

        <div class="obs-scene-strip" @wheel="onSceneStripWheel">
          <div v-for="s in visibleScenes" :key="s.sceneName" class="obs-scene-card" :class="{
            picked: s.sceneName === selectedScene,
            live: s.sceneName === currentScene,
          }" @click="onSceneClick(s.sceneName)">
            <div class="obs-scene-thumb">
              <img v-if="sceneShots[s.sceneName]" :src="sceneShots[s.sceneName]" :alt="s.sceneName" />
              <div v-else class="obs-scene-thumb-empty">
                {{ agentStatus?.screenshots ? "…" : t('obsconn.previews_off') }}
              </div>
              <span v-if="s.sceneName === currentScene" class="obs-scene-live-tag">{{ t('obsconn.live_label') }}</span>
            </div>
            <div class="obs-scene-name-row">
              <div class="obs-scene-name">{{ s.sceneName }}</div>
              <button class="obs-scene-fs-btn" :title="t('obsconn.edit_overlay_title')" @click.stop="openOverlayEditor(s.sceneName)"
                v-html="iconSvgFor('edit')"></button>
            </div>
          </div>
          <div v-if="!scenes.length" class="ep-empty">
            <button class="ep-btn-cancel" @click="refreshScenes">
              {{ t('obsconn.load_scenes') }}
            </button>
          </div>
        </div>

        <div class="obs-scenes-footer">
          <button v-if="canForcePreview && scenes.length > 0 && !videoMixProjectorOpen" class="ep-btn-cancel"
            @click="forceAllPreviews()" :disabled="forcePreviewLoading">
            {{ forcePreviewLoading ? t('obsconn.opening') : t('obsconn.force_previews') }}
          </button>
          <div v-if="canForcePreview" class="obs-projector-state">
            {{ t('obsconn.projector_prefix') }} {{ videoMixProjectorOpen ? t('obsconn.state_open') : t('obsconn.state_closed') }}
            <span v-if="videoMixProjectorTitle" class="obs-projector-title">"{{ videoMixProjectorTitle }}"</span>
          </div>
        </div>
      </template>

      <ObsOverlayEditor v-if="overlayEditorOpen && session" :channel="session.channel" :auth-headers="authHeaders"
        :scenes="scenes.map((s) => s.sceneName)" :current-scene="currentScene" :initial-scene="overlayEditorScene"
        :obs-ready="agentConnected && obsConnected" @close="closeOverlayEditor" />

      <div v-if="bindingsSaving || bindingsSaved" class="obsconn-autosave">
        {{ bindingsSaving ? t('obsconn.saving_ellipsis') : t('obsconn.saved') }}
      </div>
    </div>

    <!-- vvv phone-only bottom nav - replaces the topbar/drawer chrome on mobile vvv -->
    <nav v-if="(agentConnected && obsConnected) || agentStatus?.paired" class="obs-mobile-nav">
      <button class="obs-mobile-nav-btn" :class="{ active: mobileTab === 'scenes' }"
        :title="t('obsconn.nav.scenes')" @click="selectMobileTab('scenes')">
        <span v-html="iconSvgFor('monitor')"></span>
        <span class="obs-mobile-nav-label">{{ t('obsconn.nav.scenes') }}</span>
      </button>
      <button v-if="agentConnected && obsConnected" class="obs-mobile-nav-btn"
        :class="{ active: mobileTab === 'categories' }" :title="t('obsconn.nav.categories')"
        @click="selectMobileTab('categories')">
        <span v-html="iconSvgFor('film')"></span>
        <span class="obs-mobile-nav-label">{{ t('obsconn.nav.categories') }}</span>
      </button>
      <button v-if="agentConnected && obsConnected" class="obs-mobile-nav-btn"
        :class="{ active: mobileTab === 'sources' }" :title="t('obsconn.nav.sources')"
        @click="selectMobileTab('sources')">
        <span v-html="iconSvgFor('layers')"></span>
        <span class="obs-mobile-nav-label">{{ t('obsconn.nav.sources') }}</span>
      </button>
      <button v-if="agentConnected && obsConnected" class="obs-mobile-nav-btn"
        :class="{ active: mobileTab === 'mixer' }" :title="t('obsconn.nav.mixer')"
        @click="selectMobileTab('mixer')">
        <span v-html="iconSvgFor('sliders')"></span>
        <span class="obs-mobile-nav-label">{{ t('obsconn.nav.mixer') }}</span>
      </button>
      <button v-if="agentConnected && obsConnected" class="obs-mobile-nav-btn"
        :class="{ active: mobileTab === 'stats' }" :title="t('obsconn.nav.stats')"
        @click="selectMobileTab('stats')">
        <span v-html="iconSvgFor('activity')"></span>
        <span class="obs-mobile-nav-label">{{ t('obsconn.nav.stats') }}</span>
      </button>
      <button class="obs-mobile-nav-btn obs-mobile-nav-mode" :class="editMode ? 'edit' : 'live'"
        :title="editMode ? t('obsconn.mode.edit_hint') : t('obsconn.mode.live_hint')"
        @click="setMode(!editMode)">
        <span class="obs-mobile-nav-mode-switch">
          <span class="knob"></span>
        </span>
        <span class="obs-mobile-nav-label">{{ t('obsconn.nav.mode') }}</span>
      </button>
    </nav>
    <!-- ^^^ phone-only bottom nav ^^^ -->

  </div>

  <!-- >>> broadcaster only -->
  <Teleport to="body">
    <div v-if="showSettings && isBroadcaster" class="ep-overlay"
      v-bind="settingsOverlay.handlers(() => (showSettings = false))">
      <div class="ep-panel obsconn-settings-panel obs-settings-redesign">
        <div class="ep-panel-header">
          <div>
            <div class="ep-panel-title">{{ t('obsconn.settings_title') }}</div>
            <div class="ep-panel-sub">{{ t('obsconn.broadcaster_only') }}</div>
          </div>
          <button class="ep-panel-close" @click="showSettings = false">
            x
          </button>
        </div>

        <div class="ep-panel-body">
          <div v-if="agentConnected && obsConnected" class="ep-section">
            <div class="ep-section-label">{{ t('obsconn.connection_label') }}</div>
            <div class="ep-status-badge ready">
              <span class="ep-status-dot"></span>
              {{ t('obsconn.agent_ready') }}
            </div>
            <div class="ep-field-hint">
              {{ t('obsconn.connected_to_obs') }}<template v-if="agentStatus?.version"> · v{{ agentStatus.version }}</template>
            </div>
          </div>

          <details class="ep-details" :open="!agentStatus?.paired">
            <summary>
              {{ t('obsconn.setup_pairing') }}
              <span class="ep-details-icon closed" v-html="iconSvgFor('chevron-right')"></span>
              <span class="ep-details-icon open" v-html="iconSvgFor('chevron-down')"></span>
            </summary>
            <div class="ep-details-body">
              <template v-if="agentConnected && obsConnected">
                <div class="ep-note">
                  {{ t('obsconn.agent_paired_note') }}
                </div>
                <button class="ep-btn ep-btn-secondary" style="margin-top: 4px;" :disabled="generatingToken"
                  @click="generateToken">
                  {{ generatingToken ? t('obsconn.generating') : t('obsconn.show_regen_token') }}
                </button>
              </template>
              <template v-else>
                <ol class="ep-steps">
                  <li>
                    <strong>{{ t('obsconn.step_generate_token') }}</strong>
                    <div style="margin-top: 4px;">
                      <button class="ep-btn ep-btn-primary" :disabled="generatingToken" @click="generateToken">
                        {{
                          generatingToken
                            ? t('obsconn.generating')
                            : agentStatus?.paired
                              ? t('obsconn.regen_token')
                              : t('obsconn.gen_token')
                        }}
                      </button>
                      <div v-if="!(tokenVisible && token)" class="ep-field-hint" style="margin-top: 4px;">
                        {{
                          agentStatus?.paired
                            ? t('obsconn.token_already_set')
                            : t('obsconn.no_token_yet')
                        }}
                      </div>
                    </div>
                  </li>
                  <li>
                    <strong>{{ t('obsconn.step_download') }}</strong>
                    <div class="ep-download-row">
                      <a class="ep-btn ep-btn-secondary" :href="`${API}/agent/download/windows`" target="_blank"
                        rel="noopener">
                        {{ t('obsconn.win_zip') }}
                      </a>
                      <a class="ep-btn ep-btn-secondary" :href="`${API}/agent/download/linux`" target="_blank"
                        rel="noopener">
                        {{ t('obsconn.linux_targz') }}
                      </a>
                    </div>
                    <div class="ep-note" style="margin-top: 4px;">
                      {{ t('obsconn.extract_run_pre') }} <code>start.bat</code> {{ t('obsconn.extract_run_mid') }} <code>start.sh</code>
                    </div>
                  </li>
                  <li>
                    <strong>{{ t('obsconn.step_paste') }}</strong> <span class="ep-step-sub">{{ t('obsconn.step_paste_sub') }}</span>
                  </li>
                  <li>
                    <strong>{{ t('obsconn.step_open_obs') }}</strong> <span class="ep-step-sub">{{ t('obsconn.step_open_obs_sub') }}</span>
                  </li>
                </ol>
                <div v-if="agentStatus?.paired && !agentConnected" class="ep-note">
                  {{ t('obsconn.token_waiting') }}
                </div>
              </template>

              <div v-if="tokenVisible && token" class="ep-token-box">
                <input class="ep-token-value" :type="tokenRevealed ? 'text' : 'password'" :value="token" readonly />
                <button class="ep-eye-btn" @click="tokenRevealed = !tokenRevealed"
                  :title="tokenRevealed ? t('obsconn.hide_token') : t('obsconn.show_token')"
                  v-html="iconSvgFor(tokenRevealed ? 'eye-off' : 'eye')"></button>
                <button class="ep-copy-btn" @click="copyToken">{{ tokenJustCopied ? t('obsconn.copied') : t('obsconn.copy_btn') }}</button>
                <button class="ep-dismiss-btn" @click="
                  tokenVisible = false;
                token = '';
                tokenRevealed = false;
                " :title="t('obsconn.dismiss_title')">
                  {{ t('obsconn.done') }}
                </button>
                <div class="ep-token-warning">{{ t('obsconn.copy_warning') }}</div>
              </div>
            </div>
          </details>

          <div class="ep-field-group">
            <label class="ep-field-label">{{ t('obsconn.autostart_label') }}</label>
            <div class="ep-note">
              {{ t('obsconn.autostart_pre') }} <strong class="ep-note-menu">Tools</strong> {{ t('obsconn.autostart_mid1') }} <strong class="ep-note-menu">Scripts</strong>
              {{ t('obsconn.autostart_mid1') }} <strong class="ep-note-menu">+</strong> {{ t('obsconn.autostart_mid2') }} <code>autostart.lua</code> {{ t('obsconn.autostart_post') }}
            </div>
          </div>

          <details class="ep-details" open>
            <summary>
              {{ t('obsconn.general_settings') }}
              <span class="ep-details-icon closed" v-html="iconSvgFor('chevron-right')"></span>
              <span class="ep-details-icon open" v-html="iconSvgFor('chevron-down')"></span>
            </summary>
            <div class="ep-details-body">
              <div class="ep-field-group">
                <div class="ep-switch-row" @click="
                  enabledLocal = !enabledLocal;
                saveSettings();
                ">
                  <div class="ep-switch" :class="{ on: enabledLocal }">
                    <div class="ep-switch-knob"></div>
                  </div>
                  <span class="ep-switch-label">{{ enabledLocal ? t('obsconn.conn_enabled') : t('obsconn.conn_disabled')
                  }}</span>
                </div>
                <div class="ep-field-hint">{{ t('obsconn.conn_hint') }}</div>
              </div>

              <div class="ep-field-group">
                <div class="ep-switch-row" @click="
                  screenshotsLocal = !screenshotsLocal;
                saveSettings();
                ">
                  <div class="ep-switch" :class="{ on: screenshotsLocal }">
                    <div class="ep-switch-knob"></div>
                  </div>
                  <span class="ep-switch-label">{{ screenshotsLocal ? t('obsconn.previews_on_setting') : t('obsconn.previews_off_setting')
                  }}</span>
                </div>
                <div class="ep-field-hint">{{ t('obsconn.previews_hint') }}</div>
                <div v-if="screenshotsLocal" class="ep-interval-row">
                  <span class="ep-switch-label">{{ t('obsconn.refresh_every') }}</span>
                  <input v-model.number="screenshotIntervalLocal" type="number" min="1" max="60" class="ep-field-input"
                    @change="saveSettings" />
                  <span class="ep-switch-label">{{ t('obsconn.seconds_min1') }}</span>
                </div>
                <div class="ep-field-hint">{{ t('obsconn.broadcaster_only_change') }}</div>
              </div>
            </div>
          </details>

          <details v-if="agentConnected" class="ep-details">
            <summary>
              {{ t('obsconn.agent_mgmt') }}
              <span class="ep-details-icon closed" v-html="iconSvgFor('chevron-right')"></span>
              <span class="ep-details-icon open" v-html="iconSvgFor('chevron-down')"></span>
            </summary>
            <div class="ep-details-body">
              <div class="ep-field-group">
                <div class="ep-download-row">
                  <button class="ep-btn ep-btn-secondary" @click="openAgentPairingPage">{{ t('obsconn.open_pairing') }}</button>
                  <button class="ep-btn ep-btn-secondary" @click="openAgentDebugConsole">{{ t('obsconn.open_debug') }}</button>
                  <button class="ep-btn ep-btn-secondary" :disabled="checkingAgentUpdate" @click="checkAgentUpdate">
                    {{ checkingAgentUpdate ? t('obsconn.checking') : t('obsconn.check_update') }}
                  </button>
                </div>
                <div v-if="agentUpdateResult" class="ep-field-hint">{{ agentUpdateResult }}</div>
              </div>

              <div class="ep-field-group">
                <button class="ep-btn ep-btn-danger" :class="{ confirm: disconnectConfirm }"
                  :disabled="disconnectingAgent" @click="disconnectAgent">
                  {{
                    disconnectingAgent
                      ? t('obsconn.disconnecting')
                      : disconnectConfirm
                        ? t('obsconn.confirm_again')
                        : t('obsconn.disconnect_agent')
                  }}
                </button>
                <div class="ep-field-hint">{{ t('obsconn.disconnect_hint') }}</div>
              </div>
            </div>
          </details>

          <div v-if="settingsSaving || settingsSaved" class="ep-autosave">
            {{ settingsSaving ? t('obsconn.saving_ellipsis') : t('obsconn.saved') }}
          </div>
        </div>

        <div class="ep-panel-footer">
          <button class="ep-btn ep-btn-secondary" @click="showSettings = false">{{ t('obsconn.done') }}</button>
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
            <div class="ep-panel-title">{{ t('obsconn.filter_title') }}</div>
          </div>
          <button class="ep-panel-close" @click="showFilter = false">
            x
          </button>
        </div>

        <div class="ep-panel-body">
          <div class="ep-field-group">
            <div class="ep-field-label obs-section-label">
              {{ t('obsconn.scenes_label') }}
              <button class="obs-refresh-btn" @click="refreshScenes" :title="t('obsconn.refresh_title')"
                v-html="iconSvgFor('refresh-cw')">
              </button>
            </div>
            <div class="ep-field-hint">
              {{ t('obsconn.filter_hint') }}
            </div>
            <div class="obs-filter-list">
              <div v-for="s in scenes" :key="s.sceneName" class="ep-list-row"
                :class="{ inactive: hiddenScenes.has(s.sceneName) }">
                <div class="ep-switch" :class="hiddenScenes.has(s.sceneName) ? 'off' : 'on'"
                  @click="toggleSceneHidden(s.sceneName)"><span class="ep-switch-knob"></span></div>
                <span>{{ s.sceneName }}</span>
              </div>
              <div v-if="!scenes.length" class="ep-field-hint">{{ t('obsconn.no_scenes_loaded') }}</div>
            </div>
          </div>

          <div v-if="filterSaving" class="obsconn-autosave">{{ t('obsconn.saving_ellipsis') }}</div>
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
            <div class="ep-panel-title">{{ t('obsconn.add_category_panel_title') }}</div>
          </div>
          <button class="ep-panel-close" @click="showAddCategory = false">
            x
          </button>
        </div>
        <div class="ep-panel-body">
          <div class="ep-field-group">
            <label class="ep-field-label">{{ t('obsconn.category_label') }}</label>
            <TypeaheadInput v-model="addCategoryQuery" :fetch-items="fetchCategories" :min-chars="1" autofocus
              :placeholder="t('obsconn.search_category_ph')" @select="onAddCategorySelect" />
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
            <div class="ep-panel-title">{{ t('obsconn.add_source_panel_title') }}</div>
            <div class="ep-panel-sub">{{ t('obsconn.scene_prefix') }} {{ selectedScene }}</div>
          </div>
          <button class="ep-panel-close" @click="showAddSource = false">
            x
          </button>
        </div>
        <div class="ep-panel-body">
          <div class="ep-tabs">
            <button class="ep-tab" :class="{ active: addSourceMode === 'url' }" @click="addSourceMode = 'url'">
              {{ t('obsconn.tab_url') }}
            </button>
            <button class="ep-tab" :class="{ active: addSourceMode === 'widget' }" @click="addSourceMode = 'widget'">
              {{ t('obsconn.tab_widget') }}
            </button>
            <button v-if="!hasOverlaySource" class="ep-tab" :class="{ active: addSourceMode === 'overlay' }"
              @click="addSourceMode = 'overlay'">
              {{ t('obsconn.tab_overlay') }}
            </button>
          </div>

          <template v-if="addSourceMode === 'overlay'">
            <div class="ep-field-group">
              <label class="ep-field-label">{{ t('obsconn.overlay_label') }}</label>
              <select v-model="selectedOverlayChoice" class="ep-field-select">
                <option value="new">{{ t('obsconn.create_new_overlay') }}</option>
                <option v-for="o in overlaysForPicker" :key="o.id" :value="o.id">{{ o.name }}</option>
              </select>
              <div class="ep-field-hint">
                {{ t('obsconn.overlay_shared_hint') }}
              </div>
            </div>

            <div v-if="addSourceError" class="ep-toast error">{{ addSourceError }}</div>

            <button class="ep-btn-save" :disabled="addSourceSaving" @click="submitAddSource">
              {{ addSourceSaving ? t('obsconn.adding') : t('obsconn.add_overlay_btn') }}
            </button>
          </template>
          <template v-else>
            <div class="ep-field-group">
              <label class="ep-field-label">{{ t('obsconn.name_label') }}</label>
              <input v-model="addSourceName" type="text" class="ep-field-input" :placeholder="t('obsconn.source_name_ph')" />
            </div>

            <div v-if="addSourceMode === 'url'" class="ep-field-group">
              <label class="ep-field-label">{{ t('obsconn.tab_url') }}</label>
              <input v-model="addSourceUrl" type="text" class="ep-field-input" placeholder="https://..." />
            </div>
            <div v-else class="ep-field-group">
              <label class="ep-field-label">{{ t('obsconn.widget_label') }}</label>
              <select v-model="addSourceWidgetId" class="ep-field-select"
                @change="pickAddSourceWidget(addSourceWidgetId)">
                <option value="" disabled>{{ t('obsconn.pick_widget') }}</option>
                <option v-for="w in widgets" :key="w.id" :value="w.id">{{ w.name }}</option>
              </select>
              <div v-if="!widgets.length" class="ep-field-hint">
                {{ t('obsconn.no_widgets_yet') }}
              </div>
            </div>

            <div class="ep-row-2">
              <div class="ep-field-group ep-sm">
                <label class="ep-field-label">{{ t('obsconn.width_label') }}</label>
                <input v-model.number="addSourceWidth" type="number" min="1" class="ep-field-input" />
              </div>
              <div class="ep-field-group ep-sm">
                <label class="ep-field-label">{{ t('obsconn.height_label') }}</label>
                <input v-model.number="addSourceHeight" type="number" min="1" class="ep-field-input" />
              </div>
            </div>

            <div v-if="addSourceError" class="ep-toast error">{{ addSourceError }}</div>

            <button class="ep-btn-save" :disabled="addSourceSaving" @click="submitAddSource">
              {{ addSourceSaving ? t('obsconn.adding') : editMode ? t('obsconn.staged_add_source') : t('obsconn.add_source_btn') }}
            </button>
          </template>
        </div>
      </div>
    </div>
  </Teleport>

  <Teleport to="body">
    <div v-if="editMode && hasPending && !locked" class="obs-save-bar">
      <span class="obs-save-lead">{{ t('obsconn.unsaved_changes') }}</span>
      <div class="obs-diff-chips">
        <span v-for="(d, i) in pendingChanges" :key="i" class="obs-diff-chip">{{ d }}</span>
      </div>
      <div class="obs-save-btns">
        <button class="obs-btn-discard" @click="discardChanges">{{ t('obsconn.discard') }}</button>
        <button class="obs-btn-save" @click="saveChanges">{{ t('obsconn.save_changes') }}</button>
      </div>
    </div>
  </Teleport>
</template>

<style scoped>
.flex {
  display: flex;
}

/* >>> page chrome, now a routed page not a modal */
/* >>> fills whatever height .main-panel gives it - the scene/preview area
   below grows into the leftover space instead of the page scrolling */
.obsconn-page {
  display: flex;
  flex-direction: column;
  gap: 8px;
  flex: 1;
  min-height: 0;
  position: relative;
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
  gap: 12px;
  flex: 1;
  min-height: 0;
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
  justify-content: space-between;
  gap: 6px;
  transition: color 0.15s;
}

.ep-details summary::-webkit-details-marker {
  display: none;
}

.ep-details summary:hover {
  color: #9d6cff;
}

.ep-details-icon {
  width: 12px;
  height: 12px;
  flex-shrink: 0;
  display: flex;
  align-items: center;
  justify-content: center;
}

.ep-details-icon svg {
  width: 100%;
  height: 100%;
}

.ep-details-icon.open {
  display: none;
}

.ep-details[open] .ep-details-icon.closed {
  display: none;
}

.ep-details[open] .ep-details-icon.open {
  display: flex;
}

.ep-details[open] {
  background: #17171a;
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

.ep-step-sub {
  font-size: 11px;
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

.ep-note-menu {
  color: #9d6cff;
  font-weight: 700;
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
.obs-status-bar-slim {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 5px 9px;
  border: 1px solid;
  font-size: 10px;
  flex-shrink: 0;
  cursor: default;
}

.obs-status-dot {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  flex-shrink: 0;
}

.obs-status-text {
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  white-space: nowrap;
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

.obs-setup-hint {
  font-size: 11px;
  color: #555;
  display: block;
  margin-top: 4px;
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

/* >>> OBS-studio style: preview (staged pick) left, program (live) right,
   a take button between them is the only thing that actually switches */
.obs-program-preview {
  display: flex;
  align-items: center;
  gap: 14px;
  flex: 1;
  min-height: 0;
}

.obs-pp-pane {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  border: 1px solid #2a2a30;
  background: #111217;
  min-height: 0;
}

.obs-pp-preview {
  border-color: #6f2bff55;
}

.obs-pp-preview.empty {
  border-style: dashed;
}

.obs-pp-preview .obs-pp-thumb {
  aspect-ratio: 16 / 9;
}

.obs-pp-program {
  border-color: #f1494955;
}

.obs-pp-label {
  font-size: 9px;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.08em;
  padding: 5px 8px;
  flex-shrink: 0;
}

.obs-pp-preview .obs-pp-label {
  color: #9d6cff;
}

.obs-pp-program .obs-pp-label {
  color: #f14949;
}

.obs-pp-thumb {
  flex: 1;
  min-height: 0;
  background: #0a0a0d;
  display: flex;
  align-items: center;
  justify-content: center;
  overflow: hidden;
}

.obs-pp-thumb img {
  width: 100%;
  height: 100%;
  object-fit: contain;
  display: block;
}

.obs-pp-name-row {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 6px 10px;
  border-top: 1px solid #1e1e24;
  flex-shrink: 0;
}

.obs-pp-name {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 13px;
  font-weight: 600;
  color: #e0e0e0;
}

.obs-take-btn {
  flex-shrink: 0;
  width: 56px;
  height: 56px;
  border-radius: 0;
  border: 1px solid #6f2bff88;
  background: #6f2bff22;
  color: #c4a0ff;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 4px;
  cursor: pointer;
  transition: background 0.15s, border-color 0.15s;
}

/* >>> :deep - the icon is injected via v-html, so it never gets the
   scoped-CSS attribute a plain descendant selector needs to match it */
.obs-take-btn :deep(svg) {
  width: 20px;
  height: 20px;
}

.obs-take-btn-label {
  font-size: 9px;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.06em;
}

.obs-take-btn:hover:not(:disabled) {
  background: #6f2bff44;
  border-color: #9d6cff;
}

.obs-take-btn:disabled {
  opacity: 0.3;
  cursor: not-allowed;
}

/* >>> scene picker strip - clicking one only sets preview, never switches live */
.obs-scene-strip {
  display: flex;
  gap: 10px;
  overflow-x: auto;
  flex-shrink: 0;
  scrollbar-width: thin;
  scrollbar-color: #3a3a44 #111217;
  padding-bottom: 4px;
}

.obs-scene-strip::-webkit-scrollbar {
  height: 8px;
}

.obs-scene-strip::-webkit-scrollbar-track {
  background: #111217;
}

.obs-scene-strip::-webkit-scrollbar-thumb {
  background: #3a3a44;
  border-radius: 4px;
}

.obs-scene-strip::-webkit-scrollbar-thumb:hover {
  background: #6f2bff88;
}

.obs-scenes-footer {
  display: flex;
  align-items: center;
  gap: 12px;
  flex-shrink: 0;
}

.obs-scene-card {
  width: 145px;
  flex-shrink: 0;
  padding: 0 0 6px;
  border: 1px solid #2a2a30;
  background: #111217;
  cursor: pointer;
  font-size: 11px;
  color: #888;
  position: relative;
  transition:
    border-color 0.15s,
    color 0.15s;
  overflow: hidden;
}

.obs-scene-card:hover {
  border-color: #3a3a44;
  color: #aaa;
}

.obs-scene-card.picked {
  border-color: #6f2bff;
  color: #c4a0ff;
}

.obs-scene-card.live {
  border-color: #f1494988;
}

.obs-scene-live-tag {
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

.obs-scene-fs-btn :deep(svg) {
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
  max-height: 320px;
  overflow-y: auto;
  scrollbar-width: thin;
  scrollbar-color: #3a3a44 #111217;
}

.obs-source-list::-webkit-scrollbar {
  width: 8px;
}

.obs-source-list::-webkit-scrollbar-track {
  background: #111217;
}

.obs-source-list::-webkit-scrollbar-thumb {
  background: #3a3a44;
  border-radius: 4px;
}

.obs-source-list::-webkit-scrollbar-thumb:hover {
  background: #6f2bff88;
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

.obs-box-collapse-label {
  display: flex;
  align-items: center;
  gap: 4px;
  cursor: pointer;
  user-select: none;
}

.obs-box-collapse-chevron {
  display: flex;
  align-items: center;
  transition: transform 0.15s;
}

.obs-box-collapse-chevron.open {
  transform: rotate(180deg);
}

.obs-box-collapse-chevron :deep(svg) {
  width: 11px;
  height: 11px;
}

/* >>> collapsing is a phone-only concept - desktop always shows content,
   v-show's inline display:none gets beaten back by this !important */
@media (min-width: 681px) {
  .obs-box-collapse-label {
    cursor: default;
  }

  .obs-box-collapse-chevron {
    display: none;
  }

  .obs-source-list,
  .obs-mixer-list {
    display: flex !important;
  }

  .obs-category-content {
    display: block !important;
  }
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
  min-height: 280px;
}

/* >>> collapsing is phone-only (see the 681px+ override above), so this
   only ever matters in the column-direction mobile layout */
.obs-box.collapsed {
  min-height: 0;
}

.obs-box-cat {
  flex: 0 0 590px;
  max-width: 590px;
  width: 590px;
}

/* >>> reminds which scene is staged while the drawer covers the big preview pane */
.obs-drawer-preview-mini {
  display: flex;
  gap: 8px;
  margin-bottom: 10px;
  padding-bottom: 10px;
  border-bottom: 1px solid #1e1e22;
  flex-direction: column;
  align-items: center;
}

.obs-drawer-preview-mini-thumb {
  width: 515px;
  height: 290px;
  flex-shrink: 0;
  background: #0a0a0d;
  overflow: hidden;
  display: flex;
  align-items: center;
  justify-content: center;
  border: 1px solid #2a2a30;
}

.obs-drawer-preview-mini-thumb img {
  width: 100%;
  height: 100%;
  object-fit: cover;
  display: block;
}

.obs-drawer-preview-mini-info {
  min-width: 0;
}

.obs-drawer-preview-mini-label {
  font-size: 8px;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  color: #9d6cff;
}

.obs-drawer-preview-mini-name {
  font-size: 12px;
  font-weight: 600;
  color: #e0e0e0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

/* >>> the two quick-link buttons now sit inline in .obs-live-stats */
.obs-link-btn {
  flex-shrink: 0;
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

  .obs-box,
  .obs-box-cat {
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

  /* >>> side-by-side program/preview don't fit a phone width - stack instead,
     live on top (matches "what's actually on stream" being the priority),
     preview below it, arrow rotates to point up since it swaps bottom into top */
  .obs-program-preview {
    flex-direction: column-reverse;
  }

  .obs-take-btn :deep(svg) {
    transform: rotate(-90deg);
  }

  /* >>> no cap on phone - drawer just grows to fit its (now much more
     compact) content instead of scrolling internally */
  .obs-drawer {
    max-height: none;
    min-height: 0;
  }

  /* >>> redundant with the big preview pane right above the drawer toggle,
     just clutter on a small screen */
  .obs-drawer-preview-mini {
    display: none;
  }

  /* >>> a source row's content shouldn't be able to push wider than its box */
  .obs-box,
  .obs-source-row {
    box-sizing: border-box;
    max-width: 100%;
  }

  /* >>> way denser - this is low-value secondary info on a phone, not
     something that needs desktop-sized breathing room */
  .obs-boxes-row {
    gap: 8px;
  }

  .obs-box {
    padding: 8px 10px;
    min-height: 0;
  }

  .obs-box .ep-field-label {
    font-size: 10px;
  }

  .obs-source-row {
    padding: 3px 6px;
    gap: 6px;
    font-size: 10px;
  }

  .obs-source-name {
    font-size: 10px;
  }

  .obs-vis-btn,
  .obs-mute-btn {
    height: 18px;
    padding: 0 6px;
    font-size: 9px;
  }

  .obs-mixer-row {
    padding: 4px 6px;
    gap: 3px;
  }

  .obs-mixer-slider-row {
    gap: 6px;
  }

  /* >>> scrolls sideways instead of wrapping to many rows, like the scene strip */
  .obs-category-strip {
    flex-wrap: nowrap;
    overflow-x: auto;
    scrollbar-width: thin;
    scrollbar-color: #3a3a44 #111217;
    padding-bottom: 4px;
  }

  .obs-category-strip::-webkit-scrollbar {
    height: 8px;
  }

  .obs-category-strip::-webkit-scrollbar-track {
    background: #111217;
  }

  .obs-category-strip::-webkit-scrollbar-thumb {
    background: #3a3a44;
    border-radius: 4px;
  }

  .obs-category-card {
    flex-shrink: 0;
  }

  /* >>> .obs-box's min-height (280px, sized for sources/mixer) was beating
     this box's own max-height (min-height wins CSS's min/max conflict rule),
     forcing empty space under a short category list */
  .obs-box-cat {
    min-height: 0;
  }

  .obs-scene-card {
    width: 100px;
  }

  .obs-live-stats {
    position: static;
    margin-top: 10px;
    flex-direction: row;
    flex-wrap: wrap;
    justify-content: space-between;
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

.obs-live-stats {
  display: flex;
  flex-direction: row;
  flex-wrap: wrap;
  justify-content: space-between;
  align-items: center;
  gap: 6px;
  margin-bottom: 10px;
  padding-bottom: 10px;
  border-bottom: 1px solid #1e1e22;
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

/* >>> top bar - everything that used to be the page header, plus the
   sources/mixer drawer toggle. breaks out of .main-panel's own padding
   (negative margin matching each breakpoint) so it sits flush under the
   site navbar instead of floating with a gap above it */
.obs-topbar {
  position: relative;
  display: grid;
  grid-template-columns: 1fr auto 1fr;
  align-items: center;
  gap: 8px;
  padding: 8px 20px;
  border-bottom: 1px solid #1e1e22;
  background: #0d0d10;
  flex-shrink: 0;
  margin: -20px -20px 0;
}

@media (min-width: 681px) and (max-width: 960px) {
  .obs-topbar {
    margin: -16px -16px 0;
    padding: 8px 16px;
  }
}

@media (max-width: 680px) {

  /* >>> topbar chrome goes away entirely - only the status dot survives,
     floating fixed top-right; settings/filter/refresh move to a small
     floating kebab top-left so they stay reachable without the bar */
  .obs-topbar {
    margin: 0;
    padding: 0;
    border-bottom: none;
    background: transparent;
    min-height: 0;
    display: block;
  }

  .obsconn-title-slim,
  .obs-mode-toggle-slim,
  .mode-hint.locked-hint,
  .obs-topbar-stat,
  .obs-drawer-toggle {
    display: none !important;
  }

  .obs-topbar-left,
  .obs-topbar-right {
    flex-wrap: nowrap;
  }

  .obs-topbar-mobile-hide {
    display: none !important;
  }

  .obs-status-bar-slim {
    position: fixed;
    top: 10px;
    right: 10px;
    padding: 6px;
    background: #16161a;
    border: 1px solid #2a2a30;
    z-index: 120;
  }

  .obs-topbar-right {
    position: fixed;
    top: 10px;
    left: 10px;
    z-index: 120;
  }

  /* >>> claw back every bit of vertical space so scenes need no scrolling */
  .obsconn-page {
    gap: 4px;
    padding-top: 44px;
    padding-bottom: 62px;
  }

  .obsconn-body {
    gap: 6px;
  }

  .obs-live-mode-banner {
    padding: 4px 10px;
    font-size: 10px;
  }

  .obs-pp-label {
    padding: 3px 6px;
  }

  .obs-pp-name-row {
    padding: 4px 8px;
  }

  .obs-scenes-footer {
    flex-wrap: wrap;
    gap: 6px;
  }

  /* >>> bottom nav replaces the drawer-toggle/kebab as the way in */
  .obs-mobile-nav {
    display: flex;
  }

  /* >>> Scenes tab = the normal Program/Preview body; other tabs hide it
     and show the drawer full-screen instead */
  .obsconn-page:not([data-mtab="scenes"]) .obsconn-body {
    display: none;
  }

  .obs-drawer {
    position: fixed;
    left: 0;
    right: 0;
    top: 44px;
    bottom: 62px;
    margin-top: 0;
    max-height: none;
    border-left: none;
    border-right: none;
    padding: 12px 14px;
  }

  .obs-live-stats,
  .obs-box-sources,
  .obs-box-mixer,
  .obs-box-cat {
    display: none;
  }

  .obsconn-page[data-mtab="stats"] .obs-live-stats {
    display: flex;
    flex-direction: column;
    gap: 10px;
  }

  .obsconn-page[data-mtab="sources"] .obs-box-sources,
  .obsconn-page[data-mtab="mixer"] .obs-box-mixer,
  .obsconn-page[data-mtab="categories"] .obs-box-cat {
    display: flex;
  }

  .obs-boxes-row {
    display: block;
  }

  .obs-box,
  .obs-box-cat {
    width: 100%;
    max-width: none;
    min-height: 0;
    height: 100%;
  }
}

/* >>> Instagram-style bottom tab bar, phone only - see @media 680px above for display:flex */
.obs-mobile-nav {
  display: none;
  position: fixed;
  left: 0;
  right: 0;
  bottom: 0;
  z-index: 130;
  background: #16161a;
  border-top: 1px solid #2a2a30;
  padding: 4px 2px;
  padding-bottom: calc(4px + env(safe-area-inset-bottom, 0px));
}

.obs-mobile-nav-btn {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 3px;
  padding: 6px 2px;
  border: none;
  background: transparent;
  color: #666;
  cursor: pointer;
}

.obs-mobile-nav-btn :deep(svg) {
  width: 19px;
  height: 19px;
}

.obs-mobile-nav-btn.active {
  color: #9d6cff;
}

.obs-mobile-nav-label {
  font-size: 9px;
  font-weight: 600;
  letter-spacing: 0.02em;
}

.obs-mobile-nav-mode-switch {
  position: relative;
  width: 26px;
  height: 15px;
  border: 1px solid #2a2a30;
  flex-shrink: 0;
}

.obs-mobile-nav-mode-switch .knob {
  position: absolute;
  top: 1px;
  left: 1px;
  width: 11px;
  height: 11px;
  background: #666;
  transition: transform 0.15s, background 0.15s;
}

.obs-mobile-nav-mode.edit .obs-mobile-nav-mode-switch {
  border-color: #e5c07b66;
}

.obs-mobile-nav-mode.edit .obs-mobile-nav-mode-switch .knob {
  background: #e5c07b;
}

.obs-mobile-nav-mode.live .obs-mobile-nav-mode-switch {
  border-color: #f1494966;
}

.obs-mobile-nav-mode.live .obs-mobile-nav-mode-switch .knob {
  transform: translateX(11px);
  background: #f14949;
}

.obs-mobile-nav-mode.edit .obs-mobile-nav-label {
  color: #e5c07b;
}

.obs-mobile-nav-mode.live .obs-mobile-nav-label {
  color: #f14949;
}

.obs-topbar-left,
.obs-topbar-right {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 8px;
  min-width: 0;
}

.obs-topbar-right {
  justify-content: flex-end;
}

.obsconn-title-slim {
  font-size: 12px;
  font-weight: 700;
  color: #888;
  flex-shrink: 0;
  white-space: nowrap;
}

.obs-topbar-stat {
  font-size: 11px;
  font-family: "Consolas", "Fira Mono", monospace;
  color: #9d6cff;
  padding: 4px 8px;
  border: 1px solid #1e1e24;
  flex-shrink: 0;
}

.obs-topbar-stat.bad {
  color: #f14949;
}

/* >>> dead center via the grid's 1fr/auto/1fr columns, regardless of how
   wide the left/right sides end up. points where the drawer will open */
.obs-drawer-toggle {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 34px;
  height: 30px;
  border: 1px solid #6f2bff66;
  background: #6f2bff15;
  color: #9d6cff;
  cursor: pointer;
  flex-shrink: 0;
  transition: background 0.15s;
}

.obs-drawer-toggle:hover {
  background: #6f2bff30;
}

/* >>> :deep - icon is injected via v-html, needs :deep() to match past scoping */
.obs-drawer-toggle :deep(svg) {
  width: 14px;
  height: 14px;
  transition: transform 0.15s;
}

.obs-drawer-toggle.open :deep(svg) {
  transform: rotate(180deg);
}

/* >>> opens downward below the top bar, over the scene view. no backdrop
   and no forced-close on outside click - stays open, scenes stay clickable */
.obs-drawer {
  position: absolute;
  left: 0;
  right: 0;
  top: 100%;
  margin-top: 4px;
  max-height: 67vh;
  overflow-y: auto;
  background: #16161a;
  border: 1px solid #2a2a30;
  border-top: none;
  padding: 12px;
  z-index: 95;
  transform: translateY(-8px);
  opacity: 0;
  pointer-events: none;
  transition: transform 0.2s ease, opacity 0.2s ease;
  scrollbar-width: none;
}

.obs-drawer::-webkit-scrollbar {
  display: none;
}

.obs-drawer.open {
  transform: translateY(0);
  opacity: 1;
  pointer-events: auto;
}

.obs-drawer-handle {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  width: 100%;
  height: 26px;
  margin-bottom: 10px;
  border: 1px solid #2a2a30;
  background: transparent;
  color: #666;
  font-family: inherit;
  font-size: 11px;
  cursor: pointer;
}

.obs-drawer-handle:hover {
  color: #9d6cff;
  border-color: #6f2bff66;
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
.obs-mode-toggle-slim {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 4px 8px;
  border: 1px solid #1e1e22;
  background: #0d0d10;
  cursor: pointer;
  flex-shrink: 0;
}

.obs-mode-toggle-slim .switch {
  position: relative;
  width: 32px;
  height: 18px;
  border: 1px solid #2a2a30;
  background: #111217;
  cursor: pointer;
  flex-shrink: 0;
}

.obs-mode-toggle-slim .switch .knob {
  position: absolute;
  top: 2px;
  left: 2px;
  width: 12px;
  height: 12px;
  background: #555;
  transition: left 0.15s, background 0.15s;
}

.obs-mode-toggle-slim .switch.live {
  border-color: #f1494966;
  background: #f1494914;
}

.obs-mode-toggle-slim .switch.live .knob {
  left: 16px;
  background: #f14949;
}

.obs-mode-toggle-slim .switch.edit {
  border-color: #e5c07b55;
  background: #e5c07b0e;
}

.obs-mode-toggle-slim .switch.edit .knob {
  background: #e5c07b;
}

.mode-state {
  font-size: 11px;
  font-weight: 700;
  min-width: 26px;
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

.obs-source-row.pending,
.obs-mixer-row.pending {
  border-left: 2px solid #e5c07b;
  background: #e5c07b0d;
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

/* >>> in-flow now, sits right below the top bar instead of a fixed
   teleport - that used to float over the top bar's own controls */
.obs-live-mode-banner {
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
  flex-shrink: 0;
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
