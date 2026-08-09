<script setup lang="ts">
// >>> obs control page, agent-relay model, no port/password fields
// >>> generate token, download agent, paste token, done
// >>> routed page, settings panel is a teleport overlay

import { ref, computed, onMounted, onUnmounted, watch } from "vue";
import { API } from "../api";
import { useAuth } from "../auth";
import { useOverlayClose } from "../composables/useOverlayClose";
import EditableNameHeader from "./shared/EditableNameHeader.vue";

const { session, channelRole } = useAuth();
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
  // broadcaster-only - backend omits these for non-broadcasters
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
// >>> bitrate rules - trigger is bitrate, no chat command, runs agent-side
// >>> see agent/src/rules.js
interface ObsRule {
  id: string;
  condition: "below" | "above";
  bitrate_kbps: number;
  action: string;
  target: string;
  value?: number; // only for action 'volume'
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

const token = ref(""); // shown once after (re)generate
const tokenVisible = ref(false);
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
  if (ruleAction.value !== "volume" && !ruleTarget.value.trim()) return true;
  if (ruleAction.value === "volume" && !ruleTarget.value.trim()) return true;
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
  // Don't allow names that clash with existing custom commands
  if (existingCmdNames.value.includes(cmd)) return true;
  return false;
});

const knownSources = ref<string[]>([]);
const pendingSources = ref<Set<number>>(new Set());
const existingCmdNames = ref<string[]>([]); // all custom command names for this channel
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
      // >>> only overwrite the stat panel when this call actually carried real numbers
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
  if (
    !agentConnected.value ||
    !obsConnected.value ||
    !agentStatus.value?.screenshots
  )
    return;
  // >>> sequential, live scene first
  const live = scenes.value.find((s) => s.sceneName === currentScene.value);
  const rest = scenes.value.filter((s) => s.sceneName !== currentScene.value);
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
  if (!agentStatus.value?.screenshots) return;
  const intervalMs =
    Math.max(1, agentStatus.value?.screenshot_interval_sec ?? 5) * 1000;
  refreshAllShots(); // don't wait a full interval for the first paint
  shotTimer = setInterval(refreshAllShots, intervalMs);
}

let pollTimer: ReturnType<typeof setInterval> | null = null;

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

// derived
const agentConnected = computed(() => agentStatus.value?.connected ?? false);
const obsConnected = computed(() => agentStatus.value?.obs_connected ?? false);
const currentScene = computed(() => agentStatus.value?.current_scene ?? "");
const liveScene = computed(
  () => scenes.value.find((s) => s.sceneName === currentScene.value) ?? null,
);
const nonLiveScenes = computed(() =>
  scenes.value.filter((s) => s.sceneName !== currentScene.value),
);

// >>> keep selectedScene glued to what's actually live
watch(currentScene, (name) => {
  if (!name) return;
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
  try {
    const res = await fetch(`${API}/obs/${session.value.channel}`, {
      headers: authHeaders.value,
    });
    if (res.ok) {
      const d = (await res.json()) as AgentStatus;
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
  if (agentConnected.value && obsConnected.value) refreshScenes();
  // >>> load command names in background
  loadExistingCmdNames();
}

async function poll() {
  if (!session.value) return;
  try {
    const res = await fetch(`${API}/obs/${session.value.channel}`, {
      headers: authHeaders.value,
    });
    if (res.ok) {
      const d = (await res.json()) as AgentStatus;
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
  try {
    const res = await fetch(`${API}/obs/${session.value.channel}/scenes`, {
      headers: authHeaders.value,
    });
    if (res.ok) {
      const d = (await res.json()) as {
        scenes: SceneInfo[];
        currentScene: string;
      };
      scenes.value = d.scenes;
      // >>> sync live scene from response, not cached status, so page shows correct scene on load
      if (d.currentScene && agentStatus.value)
        agentStatus.value.current_scene = d.currentScene;
      if (!selectedScene.value)
        selectedScene.value =
          d.currentScene || scenes.value[0]?.sceneName || "";
      if (selectedScene.value) loadSources(selectedScene.value);
      restartShotLoop();
      // >>> preload all source names so isTargetMissing works across scenes
      for (const s of scenes.value) prefetchSourceNames(s.sceneName);
    }
  } catch { }
}

async function prefetchSourceNames(sceneName: string) {
  if (!session.value) return;
  try {
    const res = await fetch(
      `${API}/obs/${session.value.channel}/sources?scene=${encodeURIComponent(sceneName)}`,
      { headers: authHeaders.value },
    );
    if (res.ok) {
      const data = ((await res.json()) as any).sources ?? [];
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

// vvv sources vvv
async function loadSources(sceneName: string) {
  if (!session.value) return;
  selectedScene.value = sceneName;
  sourcesLoading.value = true;
  try {
    const res = await fetch(
      `${API}/obs/${session.value.channel}/sources?scene=${encodeURIComponent(sceneName)}`,
      { headers: authHeaders.value },
    );
    if (res.ok) {
      const rawSources = ((await res.json()) as any).sources ?? [];
      sources.value = rawSources.map((s: any) => ({
        ...s,
        visible: s.sceneItemEnabled,
      }));
    }
  } catch { }
  sourcesLoading.value = false;
}

async function toggleSourceVisible(src: SourceInfo) {
  if (!session.value || pendingSources.value.has(src.sceneItemId)) return;
  pendingSources.value = new Set(pendingSources.value).add(src.sceneItemId);
  try {
    await fetch(`${API}/obs/${session.value.channel}/source/visibility`, {
      method: "POST",
      headers: { ...authHeaders.value, "Content-Type": "application/json" },
      body: JSON.stringify({
        scene: selectedScene.value,
        sceneItemId: src.sceneItemId,
        enabled: !src.visible,
      }),
    });
  } catch { }
  if (selectedScene.value) await loadSources(selectedScene.value);
  const next_ = new Set(pendingSources.value);
  next_.delete(src.sceneItemId);
  pendingSources.value = next_;
}

async function toggleSourceMute(src: SourceInfo & { muted?: boolean }) {
  if (!session.value || pendingSources.value.has(src.sceneItemId)) return;
  pendingSources.value = new Set(pendingSources.value).add(src.sceneItemId);
  try {
    await fetch(`${API}/obs/${session.value.channel}/source/mute`, {
      method: "POST",
      headers: { ...authHeaders.value, "Content-Type": "application/json" },
      body: JSON.stringify({
        source: src.sourceName,
        muted: !(src.muted ?? false),
      }),
    });
  } catch { }
  if (selectedScene.value) await loadSources(selectedScene.value);
  const next_ = new Set(pendingSources.value);
  next_.delete(src.sceneItemId);
  pendingSources.value = next_;
}

// vvv bindings vvv
async function saveBindings() {
  if (!session.value) return;
  bindingsSaving.value = true;
  try {
    // >>> drop blank cmd names so clearing field disables command, not saves empty
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
      actionHint = " <volume>"; // fixed source, volume from chat
    } else if (b.action === "volume") {
      actionHint = ""; // fixed value binding, no chat argument
    } else if (badgeClass === "fixed-type") {
      actionHint = ""; // fixed source action (show/hide/toggle etc.)
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

// vvv rule builder vvv
async function saveRules() {
  if (!session.value) return;
  rulesSaving.value = true;
  try {
    await fetch(`${API}/obs/${session.value.channel}/rules`, {
      method: "PUT",
      headers: { ...authHeaders.value, "Content-Type": "application/json" },
      body: JSON.stringify({ rules: rules.value }),
    });
    rulesSaved.value = true;
    setTimeout(() => {
      rulesSaved.value = false;
    }, 2000);
  } catch { }
  rulesSaving.value = false;
}

function addRule() {
  if (ruleAddDisabled.value) return;
  const rule: ObsRule = {
    id: crypto.randomUUID(),
    condition: ruleCondition.value,
    bitrate_kbps: ruleBitrate.value,
    action: ruleAction.value,
    target: ruleTarget.value.trim(),
    enabled: true,
  };
  if (ruleAction.value === "volume") rule.value = ruleValue.value;
  rules.value = [...rules.value, rule];
  ruleTarget.value = "";
  saveRules();
}

function removeRule(id: string) {
  rules.value = rules.value.filter((r) => r.id !== id);
  saveRules();
}

function toggleRule(rule: ObsRule) {
  rule.enabled = !rule.enabled;
  saveRules();
}

// vvv audio mixer vvv
const audioSources = computed(() =>
  (sources.value as any[]).filter((s) => s.isAudioSource),
);

function volumeToDb(percent: number | undefined): string {
  const mul = Math.max(0, Math.min(100, percent ?? 0)) / 100;
  if (mul <= 0) return "-∞";
  return (20 * Math.log10(mul)).toFixed(1);
}

// >>> local slider override so the poll loop doesn't snap it back
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

async function setSourceVolume(src: any, percent: number) {
  if (!session.value) return;
  try {
    await fetch(`${API}/obs/${session.value.channel}/source/volume`, {
      method: "POST",
      headers: { ...authHeaders.value, "Content-Type": "application/json" },
      body: JSON.stringify({ source: src.sourceName, percent }),
    });
  } catch { }
  if (selectedScene.value) await loadSources(selectedScene.value);
}

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

// vvv lifecycle vvv
onMounted(() => {
  load();
  pollTimer = setInterval(async () => {
    await poll();
    if (agentConnected.value && obsConnected.value && selectedScene.value)
      loadSources(selectedScene.value);
    if (agentConnected.value && obsConnected.value && scenes.value.length === 0)
      refreshScenes();
  }, 5000);
});
onUnmounted(() => {
  if (pollTimer) clearInterval(pollTimer);
  if (shotTimer) clearInterval(shotTimer);
});
watch(
  () => session.value?.channel,
  () => {
    load();
  },
);
</script>

<template>
  <div class="obsconn-page">
    <div class="obsconn-header">
      <div>
        <div class="obsconn-title">OBS Control</div>
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
            <path d="M10 12.5a2.5 2.5 0 100-5 2.5 2.5 0 000 5z" stroke="currentColor" stroke-width="1.5" />
            <path
              d="M16.2 12.3a1.4 1.4 0 00.3 1.5l.05.05a1.65 1.65 0 11-2.35 2.35l-.05-.05a1.4 1.4 0 00-1.5-.3 1.4 1.4 0 00-.85 1.28v.14a1.65 1.65 0 11-3.3 0v-.07a1.4 1.4 0 00-.92-1.28 1.4 1.4 0 00-1.5.3l-.05.05A1.65 1.65 0 113.63 13.9l.05-.05a1.4 1.4 0 00.3-1.5 1.4 1.4 0 00-1.28-.85h-.14a1.65 1.65 0 110-3.3h.07a1.4 1.4 0 001.28-.92 1.4 1.4 0 00-.3-1.5l-.05-.05A1.65 1.65 0 116.09 3.38l.05.05a1.4 1.4 0 001.5.3h.06a1.4 1.4 0 00.85-1.28V2.3a1.65 1.65 0 113.3 0v.07a1.4 1.4 0 00.85 1.28h.06a1.4 1.4 0 001.5-.3l.05-.05a1.65 1.65 0 112.35 2.35l-.05.05a1.4 1.4 0 00-.3 1.5v.06a1.4 1.4 0 001.28.85h.14a1.65 1.65 0 110 3.3h-.07a1.4 1.4 0 00-1.28.85z"
              stroke="currentColor" stroke-width="1.3" />
          </svg>
          <span v-if="!loading && !agentStatus?.paired" class="obc-gear-badge" title="OBS agent not set up yet">!</span>
        </button>
      </div>
    </div>

    <div class="obsconn-body">
      <!-- loading -->
      <template v-if="loading">
        <div class="obc-loading">
          <img src="https://cdn.7tv.app/emote/01G0PEAVDR0008B1SW0M995JQJ/2x.gif" alt="loading"
            class="obc-loading-emote" />
        </div>
      </template>

      <!-- setup prompt, shown til agent + obs are both connected -->
      <!-- full instructions live in the gear panel, broadcaster only -->
      <template v-else-if="!agentConnected || !obsConnected">
        <div class="obc-setup-card obc-setup-compact">
          <template v-if="isBroadcaster">
            <div class="obc-setup-title">
              {{
                agentStatus?.paired
                  ? agentConnected
                    ? "Agent connected - waiting for OBS…"
                    : "Waiting for the agent to connect…"
                  : "OBS agent is not set up yet"
              }}
            </div>
            <div class="obc-setup-hint">
              Click the gear icon above to
              {{
                agentStatus?.paired
                  ? "view your pairing token again or re-download the agent."
                  : "get your pairing token and download the agent."
              }}
            </div>
          </template>
          <template v-else>
            <div class="obc-setup-title">OBS isn't connected yet</div>
            <div class="obc-setup-hint">
              Ask your broadcaster to set it up (gear icon, broadcaster only).
            </div>
          </template>
        </div>
      </template>

      <!-- live controls -->
      <template v-if="agentConnected && obsConnected">
        <!-- Scenes -->
        <div class="ep-field-group">
          <div class="ep-field-label obc-section-label">
            Scenes
            <button class="obc-refresh-btn" @click="refreshScenes" title="Refresh scene list">
              ↻
            </button>
          </div>
          <div class="obc-scenes">
            <div class="obc-scenes-live-row" v-if="liveScene">
              <div class="obc-scene-card obc-scene-card-live active"
                :class="{ picked: liveScene.sceneName === selectedScene }" @click="switchScene(liveScene.sceneName)">
                <div class="obc-scene-thumb">
                  <img v-if="sceneShots[liveScene.sceneName]" :src="sceneShots[liveScene.sceneName]"
                    :alt="liveScene.sceneName" />
                  <div v-else class="obc-scene-thumb-empty">
                    {{ agentStatus?.screenshots ? "…" : "previews off" }}
                  </div>
                </div>
                <div class="obc-scene-name">{{ liveScene.sceneName }}</div>
                <div class="obc-scene-live">live</div>
              </div>
              <div class="obc-live-stats">
                <div class="obc-live-stat" :class="{ bad: bitrateBad }">
                  <span class="obc-live-stat-label">bitrate</span>
                  <span class="obc-live-stat-value">{{
                    bitrateLabel ?? "not streaming"
                    }}</span>
                </div>
                <div class="obc-live-stat">
                  <span class="obc-live-stat-label">preview size</span>
                  <span class="obc-live-stat-value">{{
                    liveShotStats.kb != null
                      ? liveShotStats.kb + " kb"
                      : agentStatus?.screenshots
                        ? "--"
                        : "off"
                  }}</span>
                </div>
                <div class="obc-live-stat">
                  <span class="obc-live-stat-label">preview cpu</span>
                  <span class="obc-live-stat-value">{{
                    liveShotStats.cpuMs != null
                      ? liveShotStats.cpuMs + " ms"
                      : agentStatus?.screenshots
                        ? "--"
                        : "off"
                  }}</span>
                </div>
              </div>
            </div>
            <div class="obc-scenes-others">
              <div v-for="s in nonLiveScenes" :key="s.sceneName" class="obc-scene-card"
                :class="{ picked: s.sceneName === selectedScene }" @click="switchScene(s.sceneName)">
                <div class="obc-scene-thumb">
                  <img v-if="sceneShots[s.sceneName]" :src="sceneShots[s.sceneName]" :alt="s.sceneName" />
                  <div v-else class="obc-scene-thumb-empty">
                    {{ agentStatus?.screenshots ? "…" : "previews off" }}
                  </div>
                </div>
                <div class="obc-scene-name">{{ s.sceneName }}</div>
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
          <div v-if="canForcePreview" class="obc-projector-state">
            Multiview projector: {{ videoMixProjectorOpen ? "open" : "closed" }}
            <span v-if="videoMixProjectorTitle" class="obc-projector-title">"{{ videoMixProjectorTitle }}"</span>
          </div>
        </div>
      </template>

      <!-- sources | audio mixer | command builder, builder still works if obs itself isn't connected -->
      <div v-if="(agentConnected && obsConnected) || agentStatus?.paired" class="obc-boxes-row"
        :class="{ 'obc-boxes-single': !(agentConnected && obsConnected) }">
        <template v-if="agentConnected && obsConnected">
          <!-- Sources -->
          <div class="ep-field-group obc-box">
            <label class="ep-field-label">sources
              <span v-if="selectedScene" class="ep-field-hint">{{
                selectedScene
                }}</span></label>
            <div class="obc-source-list">
              <div v-for="src in sources as any[]" :key="src.sceneItemId" class="obc-source-row">
                <span class="obc-source-name">{{ src.sourceName }}</span>
                <button class="obc-vis-btn" :class="{ on: src.visible }" :disabled="pendingSources.has(src.sceneItemId)"
                  @click="toggleSourceVisible(src)">
                  {{ src.visible ? "visible" : "hidden" }}
                </button>
                <template v-if="src.isAudioSource">
                  <button class="obc-mute-btn" :class="{ muted: src.muted }"
                    :disabled="pendingSources.has(src.sceneItemId)" @click="toggleSourceMute(src)">
                    {{ src.muted ? "muted" : "unmuted" }}
                  </button>
                </template>
              </div>
              <div v-if="!sources.length && !sourcesLoading" class="ep-empty">
                {{
                  selectedScene
                    ? "no sources in this scene"
                    : "pick a scene above"
                }}
              </div>
            </div>
          </div>

          <!-- Audio mixer -->
          <div class="ep-field-group obc-box">
            <label class="ep-field-label">audio mixer
              <span v-if="selectedScene" class="ep-field-hint">{{
                selectedScene
                }}</span></label>
            <div class="obc-mixer-list">
              <div v-for="src in audioSources" :key="src.sceneItemId" class="obc-mixer-row">
                <div class="obc-mixer-top">
                  <span class="obc-source-name">{{ src.sourceName }}</span>
                  <button class="obc-mute-btn" :class="{ muted: src.muted }"
                    :disabled="pendingSources.has(src.sceneItemId)" @click="toggleSourceMute(src)">
                    {{ src.muted ? "muted" : "unmuted" }}
                  </button>
                </div>
                <div class="obc-mixer-slider-row">
                  <input type="range" min="0" max="100" :value="sliderOverride[src.sceneItemId] ??
                    src.volumePercent ??
                    100
                    " class="obc-mixer-slider" @input="
                      onVolumeInput(
                        src,
                        +($event.target as HTMLInputElement).value,
                      )
                      " @change="
                        onVolumeChange(
                          src,
                          +($event.target as HTMLInputElement).value,
                        )
                        " />
                  <span class="obc-mixer-db">{{
                    volumeToDb(
                      sliderOverride[src.sceneItemId] ?? src.volumePercent,
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

        <!-- Command builder / Rule builder -->
        <div v-if="agentStatus?.paired" class="ep-field-group obc-box obc-box-builder">
          <div class="obc-builder-tabs">
            <button type="button" class="obc-builder-tab" :class="{ active: builderView === 'command' }"
              @click="builderView = 'command'">
              command builder
            </button>
            <button type="button" class="obc-builder-tab" :class="{ active: builderView === 'rule' }"
              @click="builderView = 'rule'">
              rule builder
            </button>
          </div>

          <template v-if="builderView === 'command'">
            <!-- Chat command name -->
            <div class="obc-cmd-name-row">
              <span class="obc-cmd-name-prefix">+</span>
              <input v-model="builderCmd" class="obc-cmd-name-input ep-mono"
                :class="{ 'obc-trigger-conflict': existingCmdNames.includes(builderCmd.trim().replace(/^\+/, '').toLowerCase()) }"
                placeholder="command name" maxlength="20"
                :title="existingCmdNames.includes(builderCmd.trim().replace(/^\+/, '').toLowerCase()) ? 'This name is already used by another command' : ''"
                @keydown.enter="!addDisabled && addBuilderCommand()" />
              <span v-if="existingCmdNames.includes(builderCmd.trim().replace(/^\+/, '').toLowerCase())"
                class="obc-cmd-name-conflict">already taken</span>
            </div>

            <div class="obc-label-row">
              <div class="obc-label-col">
                <span class="obc-col-label">action</span>
                <select v-model="builderAction" class="obc-action-select">
                  <option v-for="a in BUILDER_ACTIONS" :key="a.value" :value="a.value">
                    {{ a.label }}
                  </option>
                </select>
              </div>

              <div class="obc-label-col">
                <span class="obc-col-label">target type</span>
                <div class="obc-mode-seg" v-if="builderAction === 'volume'">
                  <button type="button" class="obc-mode-seg-btn" :class="{ active: builderVolMode === 'both' }"
                    @click="builderVolMode = 'both'">
                    src+vol
                  </button>
                  <button type="button" class="obc-mode-seg-btn" :class="{ active: builderVolMode === 'vol_only' }"
                    @click="builderVolMode = 'vol_only'">
                    vol only
                  </button>
                </div>
                <div class="obc-mode-seg" v-else>
                  <button type="button" class="obc-mode-seg-btn" :class="{ active: builderMode === 'specific' }"
                    @click="builderMode = 'specific'">
                    preset
                  </button>
                  <button type="button" class="obc-mode-seg-btn" :class="{ active: builderMode === 'argument' }"
                    @click="builderMode = 'argument'">
                    chat arg
                  </button>
                </div>
              </div>

              <div class="obc-label-col">
                <span class="obc-col-label">target</span>

                <!-- volume: src+vol -> both come from chat -->
                <span v-if="builderAction === 'volume' && builderVolMode === 'both'"
                  class="obc-arg-badge">&lt;source&gt; &lt;vol&gt;</span>

                <!-- volume: vol only -> fixed source, number from chat -->
                <template v-else-if="builderAction === 'volume'">
                  <input v-model="builderTarget" list="obc-src-names" class="obc-target-input"
                    placeholder="source name" />
                </template>

                <!-- non-volume: chat arg -->
                <span v-else-if="builderMode === 'argument'" class="obc-arg-badge">&lt;{{
                  builderAction === "scene" ? "scene" : "source"
                }}&gt;</span>

                <!-- non-volume: preset scene - combo: type or pick -->
                <template v-else-if="builderAction === 'scene'">
                  <input v-model="builderTarget" list="obc-scene-names" class="obc-target-input"
                    placeholder="scene name" />
                  <datalist id="obc-scene-names">
                    <option v-for="s in scenes" :key="s.sceneName" :value="s.sceneName" />
                  </datalist>
                </template>

                <!-- non-volume: preset source - combo: type or pick -->
                <input v-else v-model="builderTarget" list="obc-src-names" class="obc-target-input"
                  placeholder="source name" />
              </div>

              <div class="obc-label-col">
                <span class="obc-col-label">access</span>
                <button type="button" class="access-btn" :class="{
                  'access-mod': builderAccess === 'mod',
                  'access-bc': builderAccess === 'broadcaster',
                }" @click="builderAccess = nextAccess(builderAccess)">
                  <span class="access-arrow">⤹</span>{{ accessLabel(builderAccess)
                  }}<span class="access-arrow">⤴︎</span>
                </button>
              </div>

              <div class="obc-label-col obc-label-col-end">
                <button class="obc-add-btn" :disabled="addDisabled" @click="addBuilderCommand">
                  add
                </button>
              </div>
            </div>
            <datalist id="obc-src-names">
              <option v-for="n in knownSources" :key="n" :value="n" />
            </datalist>

            <div class="obc-table-wrap">
              <table class="obc-table">
                <thead>
                  <tr>
                    <th>trigger</th>
                    <th>action</th>
                    <th>type</th>
                    <th>target</th>
                    <th>access</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  <tr v-if="!unifiedCommands.length">
                    <td colspan="6" class="obc-table-empty">
                      no commands set up yet
                    </td>
                  </tr>
                  <tr v-for="c in unifiedCommands" :key="c.type + (c.index ?? c.action)">
                    <td class="obc-td-trigger ep-mono">
                      +{{ c.command }}
                      <span v-if="c.actionHint" class="cmd-usecase-arg">{{
                        c.actionHint
                        }}</span>
                    </td>
                    <td>
                      {{ c.actionLabel }}
                    </td>
                    <td>
                      <span class="obc-type-badge" :class="c.badgeClass">{{
                        c.badgeText
                        }}</span>
                    </td>
                    <td class="obc-td-target" :class="{
                      'obc-td-target-arg': c.badgeClass === 'arg-type',
                    }">
                      {{ c.targetDisplay }}
                      <span v-if="isTargetMissing(c)" class="obc-target-warn"
                        title="Not found in OBS right now - check the name">!</span>
                    </td>
                    <td>
                      <button class="access-btn access-btn-sm" :class="{
                        'access-mod': c.access === 'mod',
                        'access-bc': c.access === 'broadcaster',
                      }" @click="cycleUnifiedAccess(c)">
                        <span class="access-arrow">⤹</span>{{ accessLabel(c.access)
                        }}<span class="access-arrow">⤴︎</span>
                      </button>
                    </td>
                    <td class="obc-td-delete" @click="removeUnifiedCommand(c)">
                      ×
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>

            <div v-if="builderCmd" class="cmd-usecase">
              <span>+{{ builderCmd }}</span>
              <template v-if="builderMode === 'argument' || builderAction === 'volume'">
                <template v-if="builderAction === 'volume'">
                  <span v-if="builderVolMode === 'both'" class="cmd-usecase-arg">
                    &lt;source&gt; &lt;vol&gt;</span>
                  <span v-else class="cmd-usecase-arg"> &lt;volume&gt;</span>
                </template>

                <span v-else class="cmd-usecase-arg">
                  &lt;{{
                    builderAction === "scene" ? "scene" : "source"
                  }}&gt;</span>
              </template>
            </div>
          </template>

          <!-- rule builder, bitrate is the trigger, runs agent-side -->
          <template v-else>
            <div class="obc-label-row">
              <div class="obc-label-col">
                <span class="obc-col-label">condition</span>
                <div class="obc-mode-seg">
                  <button type="button" class="obc-mode-seg-btn" :class="{ active: ruleCondition === 'below' }"
                    @click="ruleCondition = 'below'">
                    below
                  </button>
                  <button type="button" class="obc-mode-seg-btn" :class="{ active: ruleCondition === 'above' }"
                    @click="ruleCondition = 'above'">
                    above
                  </button>
                </div>
              </div>

              <div class="obc-label-col">
                <span class="obc-col-label">bitrate (kbps)</span>
                <input v-model.number="ruleBitrate" type="number" min="1" class="obc-target-input"
                  style="width: 90px" />
              </div>

              <div class="obc-label-col">
                <span class="obc-col-label">action</span>
                <select v-model="ruleAction" class="obc-action-select">
                  <option v-for="a in BUILDER_ACTIONS" :key="a.value" :value="a.value">
                    {{ a.label }}
                  </option>
                </select>
              </div>

              <div class="obc-label-col">
                <span class="obc-col-label">target</span>
                <input v-model="ruleTarget" :list="ruleAction === 'scene' ? 'obc-scene-names' : 'obc-src-names'
                  " class="obc-target-input" :placeholder="ruleAction === 'scene' ? 'scene name' : 'source name'
                    " />
              </div>

              <div v-if="ruleAction === 'volume'" class="obc-label-col">
                <span class="obc-col-label">volume %</span>
                <input v-model.number="ruleValue" type="number" min="0" max="100" class="obc-target-input"
                  style="width: 60px" />
              </div>

              <div class="obc-label-col obc-label-col-end">
                <button class="obc-add-btn" :disabled="ruleAddDisabled" @click="addRule">
                  add
                </button>
              </div>
            </div>

            <div class="obc-table-wrap">
              <table class="obc-table">
                <thead>
                  <tr>
                    <th>condition</th>
                    <th>action</th>
                    <th>target</th>
                    <th>on</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  <tr v-if="!rules.length">
                    <td colspan="5" class="obc-table-empty">
                      no rules set up yet
                    </td>
                  </tr>
                  <tr v-for="r in rules" :key="r.id">
                    <td class="ep-mono">
                      {{ r.condition }} {{ r.bitrate_kbps }} kbps
                    </td>
                    <td>{{ BUILDER_ACTION_LABEL[r.action] ?? r.action }}</td>
                    <td class="obc-td-target">
                      {{ r.target
                      }}<span v-if="r.action === 'volume'">
                        @ {{ r.value }}%</span>
                    </td>
                    <td>
                      <button class="obc-toggle obc-toggle-sm" :class="{ on: r.enabled }" @click="toggleRule(r)">
                        <span class="obc-toggle-knob"></span>
                      </button>
                    </td>
                    <td class="obc-td-delete" @click="removeRule(r.id)">×</td>
                  </tr>
                </tbody>
              </table>
            </div>
            <div v-if="rulesSaving || rulesSaved" class="obsconn-autosave" style="align-self: flex-start">
              {{ rulesSaving ? "saving…" : "saved" }}
            </div>
          </template>
        </div>
      </div>
    </div>
    <!-- end body -->

    <div v-if="bindingsSaving || bindingsSaved" class="obsconn-autosave">
      {{ bindingsSaving ? "saving…" : "saved" }}
    </div>
  </div>

  <!-- settings panel, broadcaster only -->
  <Teleport to="body">
    <div v-if="showSettings && isBroadcaster" class="ep-overlay"
      v-bind="settingsOverlay.handlers(() => (showSettings = false))">
      <div class="ep-panel obsconn-settings-panel">
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
          <div class="ep-field-group">
            <label class="ep-field-label">Set up the ShyBoti Agent</label>
            <ol class="obc-setup-steps">
              <li>
                <strong>Generate a pairing token</strong>
                <button class="ep-btn-new obc-token-btn" :disabled="generatingToken" @click="generateToken">
                  {{
                    generatingToken
                      ? "generating..."
                      : agentStatus?.paired
                        ? "regenerate token"
                        : "generate token"
                  }}
                </button>
                <div v-if="tokenVisible && token" class="obc-token-box">
                  <code class="obc-token-val">{{ token }}</code>
                  <button class="obc-copy-btn" @click="copyToken">
                    {{ tokenJustCopied ? "copied!" : "copy" }}
                  </button>
                  <button class="obc-dismiss-btn" @click="
                    tokenVisible = false;
                  token = '';
                  " title="I saved it, dismiss">
                    done
                  </button>
                  <div class="obc-token-warn">
                    Copy this before dismissing - it is not stored on the server
                    and cannot be shown again. If you lose it, regenerate a new
                    one (this will disconnect the agent).
                  </div>
                </div>
                <div v-else-if="agentStatus?.paired && !token" class="obc-token-hint">
                  Token already set. Click "regenerate token" to replace it.
                </div>
              </li>
              <li>
                <strong>Download the ShyBoti Agent</strong> - Keeps OBS control local to your PC. Shyboti tells this app
                what to do, and it talks to OBS directly. Requires
                <a href="https://nodejs.org" target="_blank" rel="noopener" class="obc-link">Node.js</a>.
                <div class="obc-dl-row">
                  <a class="ep-btn-cancel obc-dl-btn" :href="`${API}/agent/download/windows`" target="_blank"
                    rel="noopener">
                    Download for Windows (.zip)
                  </a>
                  <a class="ep-btn-cancel obc-dl-btn" :href="`${API}/agent/download/linux`" target="_blank"
                    rel="noopener">
                    Download for Linux (.tar.gz)
                  </a>
                </div>
                <div class="obc-av-note">
                  Extract the zip, then run <code>start.bat</code> (Windows) or
                  <code>start.sh</code> (Linux/Mac)
                </div>
              </li>
              <li>
                <strong>Paste the token</strong> into the agent when prompted, when asked.
              </li>
              <li>
                <strong>Open OBS</strong> The agent connects to OBS locally on
                the same PC
              </li>
            </ol>
            <div v-if="agentStatus?.paired && !agentConnected" class="obc-setup-hint obc-paired-hint">
              Token is set - waiting for the agent start...
            </div>
          </div>

          <div class="ep-field-group">
            <label class="ep-field-label">Connection enabled</label>
            <div class="obc-toggle-row">
              <button class="obc-toggle" :class="{ on: enabledLocal }" @click="enabledLocal = !enabledLocal">
                <span class="obc-toggle-knob"></span>
              </button>
              <span class="obc-toggle-label">{{
                enabledLocal
                  ? "on - agent can relay commands"
                  : "off - agent connections are rejected"
              }}</span>
            </div>
          </div>

          <div class="ep-field-group">
            <label class="ep-field-label">Scene previews</label>
            <div class="obc-toggle-row">
              <button class="obc-toggle" :class="{ on: screenshotsLocal }"
                @click="screenshotsLocal = !screenshotsLocal">
                <span class="obc-toggle-knob"></span>
              </button>
              <span class="obc-toggle-label">{{
                screenshotsLocal
                  ? "on - periodic screenshots of each scene"
                  : "off - no screenshots are taken"
              }}</span>
            </div>
            <div v-if="screenshotsLocal" class="obc-interval-row">
              <span class="ep-field-hint">refresh every</span>
              <input v-model.number="screenshotIntervalLocal" type="number" min="1" max="60"
                class="ep-field-input obc-interval-input" />
              <span class="ep-field-hint">seconds (min 1, to keep this light on OBS)</span>
            </div>
            <div class="ep-field-hint">
              Only you (the broadcaster) can change this - moderators can see
              previews if they're on, but can't turn them on or off.
            </div>
          </div>
        </div>

        <div class="ep-panel-footer">
          <div></div>
          <div class="ep-footer-right">
            <button class="ep-btn-save" :class="{ saved: settingsSaved }" :disabled="settingsSaving"
              @click="saveSettings">
              {{
                settingsSaved
                  ? "saved"
                  : settingsSaving
                    ? "saving"
                    : "save settings"
              }}
            </button>
          </div>
        </div>
      </div>
    </div>
  </Teleport>
</template>

<style scoped>
/* Page chrome (was a modal panel before, now a routed page like ObsView) */
.obsconn-page {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.obsconn-header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
  flex-wrap: wrap;
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

.obc-gear-badge {
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

.obsconn-autosave {
  align-self: flex-end;
  font-size: 10px;
  color: #555;
  padding-top: 4px;
}

.obsconn-settings-panel {
  width: min(560px, 92vw);
}

/* Status bar */
.obc-status-bar {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 7px 10px;
  margin-bottom: 2px;
  border: 1px solid;
  font-size: 11px;
}

.obc-status-dot {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  flex-shrink: 0;
}

.obc-status-text {
  flex: 1;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.04em;
}

.obc-status-version {
  font-size: 9px;
  color: #444;
}

.status-none {
  color: #444;
  border-color: #2a2a30;
  background: transparent;
}

.status-none .obc-status-dot {
  background: #333;
}

.status-offline {
  color: #888;
  border-color: #2a2a3088;
  background: #0d0d1088;
}

.status-offline .obc-status-dot {
  background: #555;
}

.status-partial {
  color: #e5c07b;
  border-color: #e5c07b44;
  background: #e5c07b08;
}

.status-partial .obc-status-dot {
  background: #e5c07b;
}

.status-ready {
  color: #23d18b;
  border-color: #23d18b44;
  background: #23d18b08;
}

.status-ready .obc-status-dot {
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

/* Setup card */
.cmd-usecase-arg {
  color: rgb(from #e5c07b r g b / 80%);
}

.cmd-usecase {
  color: rgb(from #c4a0ff r g b / 80%);
  font-size: 10px;
  padding-left: 10px;
}

.obc-setup-card {
  border: 1px solid #1e1e22;
  padding: 14px 16px;
  background: #0d0d10;
}

.obc-setup-compact {
  padding: 12px 14px;
}

.obc-setup-compact .obc-setup-title {
  margin-bottom: 4px;
}

.obc-setup-title {
  font-size: 12px;
  font-weight: 600;
  color: #ccc;
  margin-bottom: 12px;
}

.obc-setup-steps {
  padding-left: 18px;
  margin: 0 0 10px;
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.obc-setup-steps li {
  font-size: 12px;
  color: #777;
  line-height: 1.6;
}

.obc-setup-steps li strong {
  color: #aaa;
}

.obc-setup-hint {
  font-size: 11px;
  color: #555;
  display: block;
  margin-top: 4px;
}

.obc-paired-hint {
  color: #e5c07b;
  border-top: 1px solid #1e1e22;
  padding-top: 10px;
  margin-top: 4px;
}

.obc-token-btn {
  margin-top: 6px;
  display: block;
}

.obc-dl-btn {
  margin-top: 6px;
  display: inline-block;
  text-decoration: none;
}

.obc-token-box {
  margin-top: 8px;
  padding: 8px 10px;
  background: #0a0a0d;
  border: 1px solid #6f2bff44;
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  align-items: flex-start;
}

.obc-token-val {
  font-family: "Consolas", "Fira Mono", monospace;
  font-size: 11px;
  color: #c4a0ff;
  flex: 1;
  min-width: 0;
  word-break: break-all;
}

.obc-copy-btn {
  height: 24px;
  padding: 0 10px;
  border: 1px solid #6f2bff55;
  background: transparent;
  color: #9d6cff;
  font-size: 11px;
  font-family: inherit;
  cursor: pointer;
  flex-shrink: 0;
  transition: background 0.15s;
}

.obc-copy-btn:hover {
  background: #6f2bff22;
}

.obc-token-warn {
  width: 100%;
  font-size: 10px;
  color: #e5c07b;
  flex-basis: 100%;
  line-height: 1.5;
}

.obc-token-hint {
  font-size: 11px;
  color: #555;
  margin-top: 4px;
}

.obc-dismiss-btn {
  height: 22px;
  padding: 0 10px;
  border: 1px solid #2a2a30;
  background: transparent;
  color: #666;
  font-family: inherit;
  font-size: 10px;
  cursor: pointer;
  flex-shrink: 0;
}

.obc-dismiss-btn:hover {
  border-color: #444;
  color: #aaa;
}

.obc-dl-row {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
  margin-top: 6px;
}

.obc-av-note {
  font-size: 10px;
  color: #555;
  margin-top: 6px;
  line-height: 1.5;
}

.obc-av-note code {
  color: #9d6cff;
  font-family: "Consolas", "Fira Mono", monospace;
}

.obc-link {
  color: #9d6cff;
  text-decoration: none;
}

.obc-link:hover {
  text-decoration: underline;
}

.obc-section-label {
  display: flex;
  align-items: center;
  gap: 8px;
}

.obc-refresh-btn {
  height: 20px;
  padding: 0 7px;
  border: 1px solid #2a2a30;
  background: transparent;
  color: #555;
  font-size: 12px;
  cursor: pointer;
  transition: color 0.15s;
}

.obc-refresh-btn:hover {
  color: #9d6cff;
}

/* Scenes - live scene big & centered above, the rest small & centered below */
.obc-scenes {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 14px;
}

.obc-scenes-live-row {
  display: flex;
  justify-content: center;
  align-items: stretch;
  gap: 14px;
  width: 100%;
  flex-wrap: wrap;
}

.obc-scenes-others {
  display: flex;
  flex-wrap: wrap;
  justify-content: center;
  gap: 10px;
  width: 100%;
}

.obc-scene-card {
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

.obc-scene-card-live {
  width: 500px;
  max-width: 100%;
}

.obc-scene-card:hover {
  border-color: #3a3a44;
  color: #aaa;
}

.obc-scene-card.active {
  border-color: #6f2bff;
  color: #c4a0ff;
}

.obc-scene-card.picked:not(.active) {
  border-color: #2a2a42;
}

.obc-scene-live {
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

.obc-scene-name {
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  padding: 7px 10px 0;
  text-align: center;
}

.obc-scene-thumb {
  width: 100%;
  aspect-ratio: 16/9;
  background: #0a0a0d;
  overflow: hidden;
  display: flex;
  align-items: center;
  justify-content: center;
  border-bottom: 1px solid #1e1e24;
}

.obc-scene-thumb img {
  width: 100%;
  height: 100%;
  object-fit: cover;
  display: block;
}

.obc-scene-thumb-empty {
  font-size: 9px;
  color: #333;
}

.obc-projector-state {
  margin-top: 6px;
  font-size: 11px;
  color: #666;
}

.obc-projector-title {
  color: #666666ab;
  font-style: italic;
}

/* Sources */
.obc-source-list {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.obc-source-row {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
  padding: 5px 8px;
  background: #111217;
  border: 1px solid #1e1e24;
}

.obc-source-name {
  flex: 1;
  font-size: 12px;
  color: #888;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.obc-vis-btn,
.obc-mute-btn {
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

.obc-vis-btn.on {
  border-color: #6f2bff55;
  color: #9d6cff;
  background: #6f2bff0e;
}

.obc-mute-btn.muted {
  border-color: #f1494944;
  color: #f14949;
  background: #f149490a;
}

.obc-vis-btn:hover,
.obc-mute-btn:hover {
  border-color: #444;
  color: #aaa;
}

/* Bindings */
.obc-bind-list {
  display: flex;
  flex-direction: column;
  gap: 4px;
  margin-bottom: 8px;
}

.obc-bind-row,
.obc-add-row {
  display: flex;
  align-items: center;
  gap: 6px;
  flex-wrap: wrap;
  padding: 3px 0;
}

.obc-bind-prefix {
  color: #9d6cff;
  font-weight: 700;
  font-size: 12px;
  flex-shrink: 0;
}

.obc-bind-cmd {
  width: 120px;
  flex: none;
}

.obc-bind-target {
  width: 150px;
  flex: none;
}

.obc-bind-vol {
  width: 64px;
  flex: none;
}

.obc-bind-arrow {
  color: #555;
  font-size: 12px;
  flex-shrink: 0;
}

/* Settings panel: toggles + generic arg commands */
.obc-toggle-row {
  display: flex;
  align-items: center;
  gap: 10px;
}

.obc-toggle {
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

.obc-toggle.on {
  border-color: #6f2bff88;
  background: #6f2bff22;
}

.obc-toggle-knob {
  display: block;
  width: 12px;
  height: 12px;
  background: #555;
  transition:
    transform 0.15s,
    background 0.15s;
}

.obc-toggle.on .obc-toggle-knob {
  background: #9d6cff;
  transform: translateX(14px);
}

.obc-toggle-label {
  font-size: 11px;
  color: #888;
}

.obc-interval-row {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-top: 8px;
}

.obc-interval-input {
  width: 56px;
  flex: none;
  text-align: center;
}

.obc-arg-list {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.obc-arg-row {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
  padding: 3px 0;
}

.obc-arg-label {
  width: 130px;
  flex: none;
  font-size: 11px;
  color: #999;
}

.obc-arg-usage {
  font-size: 10px;
  color: #444;
  font-family: "Consolas", "Fira Mono", monospace;
}

/* center content, boxes end up different heights side by side */
.ep-field-group {
  justify-content: center;
}

.obc-box {
  justify-content: flex-start;
}

/* loading spinner, avoids flashing "not set up" on first load */
.obc-loading {
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 48px 0;
}

.obc-loading-emote {
  width: 48px;
  height: 48px;
  image-rendering: pixelated;
  animation: obc-spin 1.1s linear infinite;
}

@keyframes obc-spin {
  to {
    transform: rotate(360deg);
  }
}

/* Sources | Audio mixer | Command builder */
.obc-boxes-row {
  display: flex;
  flex-wrap: wrap;
  gap: 14px;
  align-items: stretch;
}

.obc-boxes-row.obc-boxes-single {
  display: block;
}

.obc-box {
  padding: 12px 14px;
  border: 1px solid #1e1e22;
  background: #0d0d10;
  flex: 1 1 200px;
  min-width: 200px;
  max-width: 400px;
}

.obc-box-builder {
  flex: 0 0 700px;
  max-width: 700px;
  width: 700px;
}

/* Access-level cycle button - matches CommandsView.vue's access-btn */
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

/* Audio mixer */
.obc-mixer-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.obc-mixer-row {
  padding: 6px 8px;
  background: #111217;
  border: 1px solid #1e1e24;
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.obc-mixer-top {
  display: flex;
  align-items: center;
  gap: 8px;
}

.obc-mixer-slider-row {
  display: flex;
  align-items: center;
  gap: 8px;
}

.obc-mixer-slider {
  flex: 1;
  accent-color: #9d6cff;
  /* Remove browser default white track background */
  background: transparent;
  -webkit-appearance: none;
  height: 4px;
}

.obc-mixer-slider::-webkit-slider-runnable-track {
  background: #2a2a30;
  height: 4px;
  border-radius: 2px;
}

.obc-mixer-slider::-webkit-slider-thumb {
  -webkit-appearance: none;
  width: 12px;
  height: 12px;
  border-radius: 50%;
  background: #9d6cff;
  margin-top: -4px;
  cursor: pointer;
}

.obc-mixer-slider::-moz-range-track {
  background: #2a2a30;
  height: 4px;
  border-radius: 2px;
}

.obc-mixer-slider::-moz-range-thumb {
  width: 12px;
  height: 12px;
  border-radius: 50%;
  background: #9d6cff;
  border: none;
  cursor: pointer;
}

.obc-mixer-db {
  font-size: 10px;
  color: #666;
  font-family: "Consolas", "Fira Mono", monospace;
  width: 56px;
  text-align: right;
  flex-shrink: 0;
}

/* Command builder - single-row form matching the reference demo */
.obc-label-row {
  display: flex;
  align-items: flex-end;
  gap: 10px;
  flex-wrap: wrap;
  padding: 4px 0 12px;
}

.obc-label-col {
  display: flex;
  flex-direction: column;
  gap: 4px;
  flex-shrink: 0;
}

.obc-label-col-end {
  align-self: flex-end;
}

.obc-col-label {
  font-size: 9px;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  color: #555;
  white-space: nowrap;
}

/* builder chat command name header */
.obc-cmd-name-row {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-bottom: 12px;
  padding-bottom: 12px;
  border-bottom: 1px solid #1e1e24;
}

.obc-cmd-name-prefix {
  font-size: 22px;
  font-weight: 700;
  color: #9d6cff;
  flex-shrink: 0;
  line-height: 1;
}

.obc-cmd-name-input {
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

.obc-cmd-name-input::placeholder {
  color: #2a2a3a;
  font-weight: 400;
}

.obc-cmd-name-input:focus {
  border-bottom-color: #9d6cff;
}

.obc-cmd-name-input.obc-trigger-conflict {
  border-bottom-color: #f14949;
  color: #f14949;
}

.obc-cmd-name-conflict {
  font-size: 10px;
  color: #f14949;
  letter-spacing: .04em;
  text-transform: uppercase;
  flex-shrink: 0;
}

.obc-action-select,
.obc-target-select {
  height: 28px;
  padding: 0 6px;
  background: #0a0a0d;
  border: 1px solid #2a2a30;
  color: #ccc;
  font-family: inherit;
  font-size: 11px;
  cursor: pointer;
  max-width: 130px;
  transition: border-color 0.15s;
}

.obc-action-select {
  width: 118px;
}

.obc-target-select {
  width: 118px;
}

.obc-action-select:focus,
.obc-target-select:focus {
  outline: none;
  border-color: #6f2bff88;
}

.obc-target-input {
  height: 28px;
  padding: 0 8px;
  background: #0a0a0d;
  border: 1px solid #2a2a30;
  color: #ccc;
  font-family: inherit;
  font-size: 11px;
  width: 110px;
  transition: border-color 0.15s;
}

.obc-target-input:focus {
  outline: none;
  border-color: #6f2bff88;
}

.obc-mode-seg {
  display: inline-flex;
  border: 1px solid #2a2a30;
  overflow: hidden;
  flex-shrink: 0;
}

.obc-mode-seg-btn {
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

.obc-mode-seg-btn:last-child {
  border-right: none;
}

.obc-mode-seg-btn.active {
  background: #6f2bff15;
  color: #9d6cff;
  font-weight: 600;
}

.obc-mode-seg-btn:hover:not(.active) {
  color: #888;
}

.obc-arg-badge {
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

.obc-add-btn {
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

.obc-add-btn:hover:not(:disabled) {
  background: #6f2bff25;
  border-color: #9d6cff99;
}

.obc-add-btn:disabled {
  opacity: 0.35;
  cursor: not-allowed;
}

.obc-table-wrap {
  max-height: 240px;
  overflow-y: auto;
  border: 1px solid #1e1e24;
}

.obc-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 11px;
}

.obc-table th {
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

.obc-table td {
  padding: 6px 10px;
  color: #888;
  border-bottom: 1px solid #1a1a20;
  white-space: nowrap;
  max-width: 160px;
  overflow: hidden;
  text-overflow: ellipsis;
}

.obc-table tbody tr:hover {
  background: #ffffff03;
}

.obc-table-empty {
  text-align: center;
  color: #444;
  padding: 20px !important;
}

.obc-td-trigger {
  color: #c4a0ff;
  font-weight: 600;
}

.obc-td-target {
  color: #ccc;
}

.obc-td-target-arg {
  color: #e5c07b;
  font-style: italic;
  font-family: "Consolas", "Fira Mono", monospace;
}

.obc-target-warn {
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

.obc-td-delete {
  color: #555;
  cursor: pointer;
  font-size: 13px;
  transition: color 0.15s;
  text-align: center;
  width: 30px;
}

.obc-td-delete:hover {
  color: #f14949;
}

.obc-type-badge {
  display: inline-block;
  font-size: 9px;
  padding: 1px 7px;
  border: 1px solid #2a2a30;
  color: #666;
}

.obc-type-badge.fixed-type {
  border-color: #6f2bff44;
  color: #9d6cff;
}

.obc-type-badge.arg-type {
  border-color: #e5c07b44;
  color: #e5c07b;
}

@media (max-width: 900px) {
  .obc-boxes-row {
    flex-direction: column;
  }

  .obc-box,
  .obc-box-builder {
    max-width: 100%;
    width: 100%;
  }
}

@media (max-width: 680px) {

  .obc-bind-cmd,
  .obc-bind-target {
    width: 100%;
  }

  .obc-arg-label {
    width: 100%;
  }

  .obc-scenes-others {
    gap: 8px;
  }

  .obc-scenes-others .obc-scene-card {
    width: calc(50% - 4px);
  }

  .obc-scenes-live-row {
    flex-direction: column;
    align-items: center;
  }

  .obc-live-stats {
    flex-direction: row;
    flex-wrap: wrap;
    justify-content: center;
    width: 100%;
    min-width: 0;
  }

  .obc-live-stat {
    flex: 1 1 90px;
  }

  .obc-label-row {
    flex-direction: column;
    align-items: stretch;
    gap: 10px;
  }

  .obc-label-col,
  .obc-label-col-end {
    width: 100%;
    align-self: stretch;
  }

  .obc-trigger-wrap,
  .obc-trigger-input,
  .obc-action-select,
  .obc-target-select,
  .obc-target-input {
    width: 100%;
    max-width: none;
  }

  .obc-mode-seg {
    width: 100%;
    display: flex;
  }

  .obc-mode-seg-btn {
    flex: 1;
  }

  .obc-arg-badge {
    width: 100%;
    justify-content: center;
    box-sizing: border-box;
  }

  /* scoped to the builder form only, not the small per-row access button
     inside the results table */
  .obc-label-row .access-btn,
  .obc-add-btn {
    width: 100%;
  }

  /* results table: let it scroll sideways instead of truncating every
     cell down to a couple of characters */
  .obc-table-wrap {
    overflow-x: auto;
  }

  .obc-table {
    min-width: 560px;
  }

  .obc-builder-tabs {
    overflow-x: auto;
  }

  .obc-box-builder {
    padding: 12px;
  }
}

/* Bitrate/preview stats panel next to the live scene */
.obc-live-stats {
  display: flex;
  flex-direction: column;
  justify-content: center;
  gap: 8px;
  min-width: 130px;
  flex-shrink: 0;
}

.obc-live-stat {
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding: 8px 10px;
  border: 1px solid #1e1e24;
  background: #0d0d10;
}

.obc-live-stat-label {
  font-size: 9px;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  color: #555;
}

.obc-live-stat-value {
  font-size: 13px;
  font-family: "Consolas", "Fira Mono", monospace;
  color: #9d6cff;
  font-weight: 600;
}

.obc-live-stat.bad .obc-live-stat-value {
  color: #f14949;
}

/* Command builder / Rule builder tab switch */
.obc-builder-tabs {
  display: flex;
  gap: 2px;
  margin-bottom: 10px;
  border-bottom: 1px solid #1e1e22;
}

.obc-builder-tab {
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

.obc-builder-tab.active {
  color: #9d6cff;
  border-bottom-color: #6f2bff;
}

.obc-builder-tab:hover:not(.active) {
  color: #888;
}

/* small toggle for the rule table's on column */
.obc-toggle-sm {
  width: 26px;
  height: 15px;
}

.obc-toggle-sm .obc-toggle-knob {
  width: 9px;
  height: 9px;
}

.obc-toggle-sm.on .obc-toggle-knob {
  transform: translateX(11px);
}
</style>
