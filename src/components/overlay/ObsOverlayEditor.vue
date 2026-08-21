<script setup lang="ts">
import { ref, computed, watch, onMounted, onUnmounted } from "vue";
import { API } from "../../api";
import { useAuth } from "../../auth";
import { iconSvg as iconSvgFor } from "../../composables/icons";
import {
  defaultElement,
  shapeDefaultStyle,
  newElementId,
  type Overlay,
  type OverlayElement,
  type OverlayElementType,
  type ShapeVariant,
} from "../../composables/overlay/overlayTypes";
import {
  computeCountdown,
  formatDuration,
  parseDuration,
  setCurrentSeconds,
  toggleRunningData,
  type CountdownLikeType,
} from "../../composables/overlay/overlayCountdown";
import ObsOverlayCanvasStage from "./ObsOverlayCanvasStage.vue";
import ObsOverlayElementGallery from "./ObsOverlayElementGallery.vue";
import ObsOverlayVariablePicker from "./ObsOverlayVariablePicker.vue";
import ObsOverlayStylePanel from "./ObsOverlayStylePanel.vue";
import ObsOverlayLayersPanel from "./ObsOverlayLayersPanel.vue";

const props = defineProps<{
  channel: string;
  authHeaders: Record<string, string>;
  scenes: string[];
  currentScene: string;
  initialOverlayId?: string;
  // >>> scene actually clicked, falls back to the current one
  initialScene?: string;
  // >>> only true when we know the OBS connection state
  obsReady?: boolean;
}>();
const emit = defineEmits<{
  close: [];
}>();

const { session } = useAuth();

const loading = ref(true);
const saving = ref(false);
const busy = ref(false); // <<< add/remove/show/hide in flight
const overlays = ref<Overlay[]>([]);
const currentOverlayId = ref<string | null>(null);
const currentOverlay = computed(
  () => overlays.value.find((o) => o.id === currentOverlayId.value) ?? null,
);
const currentAttachment = computed(
  () => currentOverlay.value?.scenes.find((s) => s.scene === activateScene.value) ?? null,
);
const overlayAdded = computed(() => !!currentAttachment.value);
const overlayVisible = computed(() => !!currentAttachment.value?.active);
const activateScene = ref("");
const renaming = ref(false);
const renameDraft = ref("");
const menuOpen = ref(false);

const baseWidth = ref(1920);
const baseHeight = ref(1080);
const pendingElements = ref<OverlayElement[]>([]);
const deletedIds = ref<string[]>([]);
const savedIds = ref<Set<string>>(new Set());
const selectedIds = ref<string[]>([]);
const dirty = ref(false);
const previewValues = ref<Record<string, string>>({});
const snapEnabled = ref(true);

// vvv "saved X ago" ticks without re-saving vvv
const lastSavedAt = ref<number | null>(null);
const clockNow = ref(Date.now());
let clockTimer: ReturnType<typeof setInterval> | null = null;
const lastSavedLabel = computed(() => {
  if (!lastSavedAt.value) return "";
  const secs = Math.max(0, Math.round((clockNow.value - lastSavedAt.value) / 1000));
  if (secs < 5) return "saved just now";
  if (secs < 60) return `saved ${secs}s ago`;
  const mins = Math.round(secs / 60);
  if (mins < 60) return `saved ${mins}m ago`;
  const hours = Math.round(mins / 60);
  return `saved ${hours}h ago`;
});
// ^^^ "saved X ago" ^^^

// >>> editor-only backdrop, never shown in the live render
const stageBackdrop = ref<"checker" | "white" | "black" | "scene">("checker");
const sceneShotUrl = ref<string | null>(null);
async function loadSceneShot() {
  if (!props.obsReady || !props.channel || !activateScene.value) return;
  try {
    const res = await fetch(
      `${API}/obs/${props.channel}/screenshot?scene=${encodeURIComponent(activateScene.value)}&width=800&quality=70`,
      { headers: props.authHeaders },
    );
    if (res.ok) {
      const d = (await res.json()) as { imageData: string | null };
      sceneShotUrl.value = d.imageData || null; // <<< already a full data: URI
    }
  } catch { }
}
function pickBackdrop(b: "checker" | "white" | "black" | "scene") {
  stageBackdrop.value = b;
  if (b === "scene") loadSceneShot();
}
watch(activateScene, () => {
  if (stageBackdrop.value === "scene") loadSceneShot();
});

const selectedElement = computed(() =>
  selectedIds.value.length === 1
    ? pendingElements.value.find((e) => e.id === selectedIds.value[0]) ?? null
    : null,
);

// vvv countdown time field ticks off the same timer vvv
function isCountdownLike(type: string): type is CountdownLikeType {
  return type === "countdown" || type === "countup";
}

// vvv alignment kept top-level since it's used everywhere vvv
function isTextLikeType(type: string): boolean {
  return ["text", "variable-text", "countdown", "countup"].includes(type);
}
const alignOptions = [
  { h: "left", v: "top" },
  { h: "center", v: "top" },
  { h: "right", v: "top" },
  { h: "left", v: "middle" },
  { h: "center", v: "middle" },
  { h: "right", v: "middle" },
  { h: "left", v: "bottom" },
  { h: "center", v: "bottom" },
  { h: "right", v: "bottom" },
] as const;
function setAlign(el: OverlayElement, h: string, v: string) {
  updateElement(el.id, { style: { ...el.style, textAlign: h as any, verticalAlign: v as any } });
}
// ^^^ alignment ^^^
function canToggleRunning(el: OverlayElement): boolean {
  if (el.type === "countup") return true;
  return el.type === "countdown" && (el.data.mode || "duration") !== "target";
}
const countdownFieldFocused = ref<string | null>(null);
const countdownDraft = ref("");
// >>> frozen while focused, avoids fighting the user's typing
function countdownTimeFieldValue(el: OverlayElement): string {
  clockNow.value; // <<< reactive dep, keeps ticking while unfocused
  if (countdownFieldFocused.value === el.id) return countdownDraft.value;
  return formatDuration(computeCountdown(el.type as CountdownLikeType, el.data || {}).seconds);
}
function onCountdownFieldFocus(el: OverlayElement, e: FocusEvent) {
  countdownFieldFocused.value = el.id;
  countdownDraft.value = formatDuration(computeCountdown(el.type as CountdownLikeType, el.data || {}).seconds);
  (e.target as HTMLInputElement).select(); // <<< select-all so typing replaces, not appends
}
function commitCountdownTimeField(el: OverlayElement, e: FocusEvent) {
  countdownFieldFocused.value = null;
  const text = (e.target as HTMLInputElement).value;
  const seconds = parseDuration(text);
  if (seconds === null) return;
  updateElement(el.id, { data: setCurrentSeconds(el.type as CountdownLikeType, el.data || {}, seconds) });
}
function toggleElementRunning(el: OverlayElement) {
  updateElement(el.id, { data: toggleRunningData(el.data || {}) });
}
// ^^^ countdown/countup ^^^

// vvv history (undo/redo) vvv
const historyPast = ref<OverlayElement[][]>([]);
const historyFuture = ref<OverlayElement[][]>([]);
const HISTORY_CAP = 50;
function snapshot(): OverlayElement[] {
  return JSON.parse(JSON.stringify(pendingElements.value));
}
function pushHistory() {
  historyPast.value.push(snapshot());
  if (historyPast.value.length > HISTORY_CAP) historyPast.value.shift();
  historyFuture.value = [];
}
function undo() {
  if (!historyPast.value.length) return;
  const prev = historyPast.value.pop()!;
  historyFuture.value.push(snapshot());
  pendingElements.value = prev;
  selectedIds.value = [];
  dirty.value = true;
}
function redo() {
  if (!historyFuture.value.length) return;
  const next = historyFuture.value.pop()!;
  historyPast.value.push(snapshot());
  pendingElements.value = next;
  selectedIds.value = [];
  dirty.value = true;
}
// ^^^ history ^^^

function applyPatch(id: string, patch: Partial<OverlayElement>) {
  const idx = pendingElements.value.findIndex((e) => e.id === id);
  if (idx === -1) return;
  pendingElements.value = pendingElements.value.map((e, i) =>
    i === idx ? { ...e, ...patch } : e,
  );
  dirty.value = true;
}
function updateElement(id: string, patch: Partial<OverlayElement>) {
  pushHistory();
  applyPatch(id, patch);
}
function updateElements(updates: Array<{ id: string; patch: Partial<OverlayElement> }>) {
  pushHistory();
  for (const u of updates) applyPatch(u.id, u.patch);
}

// >>> remote patch skips history so it won't trigger save
function applyRemotePatch(id: string, patch: Record<string, unknown>) {
  const idx = pendingElements.value.findIndex((e) => e.id === id);
  if (idx === -1) return;
  pendingElements.value = pendingElements.value.map((e, i) =>
    i === idx ? { ...e, ...patch } as OverlayElement : e,
  );
}

function toWireElement(el: OverlayElement) {
  return {
    id: el.id,
    type: el.type,
    x: el.x,
    y: el.y,
    w: el.w,
    h: el.h,
    rotation: el.rotation,
    z_index: el.z_index,
    locked: el.locked,
    visible: el.visible,
    group_id: el.group_id,
    content: el.content,
    style: el.style,
    data: el.data,
  };
}
function fromWireElement(row: any): OverlayElement {
  return {
    id: row.id,
    type: row.type,
    x: row.x,
    y: row.y,
    w: row.w,
    h: row.h,
    rotation: row.rotation,
    z_index: row.z_index,
    locked: !!row.locked,
    visible: !!row.visible,
    group_id: row.group_id ?? null,
    content: row.content ?? "",
    style: (() => {
      try {
        return JSON.parse(row.style);
      } catch {
        return {};
      }
    })(),
    data: (() => {
      try {
        return JSON.parse(row.data);
      } catch {
        return {};
      }
    })(),
  };
}

async function loadOverlaysList() {
  try {
    const res = await fetch(`${API}/overlays/${props.channel}`, {
      headers: props.authHeaders,
    });
    if (res.ok) {
      const d = (await res.json()) as { overlays: Overlay[] };
      overlays.value = d.overlays ?? [];
    }
  } catch { }
  if (!currentOverlayId.value || !overlays.value.some((o) => o.id === currentOverlayId.value)) {
    const wanted = props.initialOverlayId;
    const wantedScene = props.initialScene || props.currentScene;
    const attachedToScene = overlays.value.find((o) =>
      o.scenes.some((s) => s.scene === wantedScene),
    );
    currentOverlayId.value =
      (wanted && overlays.value.some((o) => o.id === wanted) ? wanted : null) ??
      attachedToScene?.id ??
      overlays.value[0]?.id ??
      null;
  }
}

async function loadElements() {
  if (!currentOverlayId.value) {
    pendingElements.value = [];
    savedIds.value = new Set();
    return;
  }
  try {
    const res = await fetch(`${API}/overlay/${props.channel}/${currentOverlayId.value}`, {
      headers: props.authHeaders,
    });
    if (res.ok) {
      const d = (await res.json()) as { overlay: any; elements: any[] };
      pendingElements.value = (d.elements ?? []).map(fromWireElement);
      savedIds.value = new Set(pendingElements.value.map((e) => e.id));
      deletedIds.value = [];
      dirty.value = false;
      historyPast.value = [];
      historyFuture.value = [];
      lastSavedAt.value = d.overlay?.updated_at || null;
    }
  } catch { }
  fetchPreviewValues();
}

async function fetchPreviewValues() {
  if (!currentOverlayId.value) return;
  try {
    const res = await fetch(
      `${API}/overlay/${props.channel}/${currentOverlayId.value}/preview-values`,
      { headers: props.authHeaders, cache: "no-store" },
    );
    if (res.ok) previewValues.value = await res.json();
  } catch { }
}

// vvv counters used here, quick +/- from the editor vvv
const usedCounterNames = computed(() => {
  const names = new Set<string>();
  for (const el of pendingElements.value) {
    if (el.type !== "variable-text") continue;
    for (const m of el.content.matchAll(/\$counter\.(\w+)/g)) names.add(m[1]!);
  }
  return [...names].sort();
});
const counterValues = ref<Record<string, number>>({});
async function fetchCounterValues() {
  try {
    const res = await fetch(`${API}/variables/${props.channel}`, {
      headers: props.authHeaders,
      cache: "no-store",
    });
    if (res.ok) {
      const d = (await res.json()) as { counters: { name: string; value: number }[] };
      counterValues.value = Object.fromEntries((d.counters ?? []).map((c) => [c.name, c.value]));
    }
  } catch { }
}
async function bumpCounter(name: string, delta: number) {
  const next = (counterValues.value[name] ?? 0) + delta;
  counterValues.value = { ...counterValues.value, [name]: next };
  try {
    await fetch(`${API}/variables/${props.channel}/counter/${name}`, {
      method: "PUT",
      headers: { ...props.authHeaders, "Content-Type": "application/json" },
      body: JSON.stringify({ value: String(next) }),
    });
  } catch { }
}
// ^^^ counters ^^^

async function load() {
  loading.value = true;
  await loadOverlaysList();
  await loadElements();
  if (!activateScene.value) {
    // >>> only auto-pick a scene when there's good reason
    activateScene.value = props.initialScene || currentOverlay.value?.scenes[0]?.scene || "";
  }
  try {
    const vs = await fetch(`${API}/obs/${props.channel}/video-settings`, {
      headers: props.authHeaders,
    });
    if (vs.ok) {
      const d = (await vs.json()) as { baseWidth: number; baseHeight: number };
      if (d.baseWidth) baseWidth.value = d.baseWidth;
      if (d.baseHeight) baseHeight.value = d.baseHeight;
    }
  } catch { }
  loading.value = false;
}

// vvv switch/create/rename/delete overlays vvv
function confirmDiscardIfDirty(): boolean {
  if (!dirty.value) return true;
  return window.confirm("Discard unsaved changes to this overlay?");
}
function cycleOverlay(dir: 1 | -1) {
  if (!overlays.value.length) return;
  const idx = overlays.value.findIndex((o) => o.id === currentOverlayId.value);
  const next = overlays.value[(idx + dir + overlays.value.length) % overlays.value.length];
  if (next) switchOverlay(next.id);
}
async function switchOverlay(id: string) {
  if (id === currentOverlayId.value) return;
  if (!confirmDiscardIfDirty()) return;
  currentOverlayId.value = id;
  selectedIds.value = [];
  await loadElements();
}
async function createOverlay() {
  try {
    const res = await fetch(`${API}/overlays/${props.channel}`, {
      method: "POST",
      headers: props.authHeaders,
    });
    if (res.ok) {
      const d = (await res.json()) as { overlay: Overlay };
      overlays.value = [...overlays.value, d.overlay];
      currentOverlayId.value = d.overlay.id;
      selectedIds.value = [];
      await loadElements();
    }
  } catch { }
}
function startRename() {
  if (!currentOverlay.value) return;
  renameDraft.value = currentOverlay.value.name;
  renaming.value = true;
}
async function commitRename() {
  const name = renameDraft.value.trim();
  renaming.value = false;
  if (!name || !currentOverlay.value || name === currentOverlay.value.name) return;
  try {
    const res = await fetch(`${API}/overlays/${props.channel}/${currentOverlay.value.id}`, {
      method: "PUT",
      headers: { ...props.authHeaders, "Content-Type": "application/json" },
      body: JSON.stringify({ name }),
    });
    if (res.ok) {
      overlays.value = overlays.value.map((o) =>
        o.id === currentOverlay.value!.id ? { ...o, name } : o,
      );
    }
  } catch { }
}
async function deleteOverlay() {
  if (!currentOverlay.value) return;
  if (!window.confirm(`Delete overlay "${currentOverlay.value.name}"? This can't be undone.`))
    return;
  const id = currentOverlay.value.id;
  try {
    const res = await fetch(`${API}/overlays/${props.channel}/${id}`, {
      method: "DELETE",
      headers: props.authHeaders,
    });
    if (res.ok) {
      overlays.value = overlays.value.filter((o) => o.id !== id);
      currentOverlayId.value = null;
      selectedIds.value = [];
      if (!overlays.value.length) await createOverlay();
      else await loadElements();
    }
  } catch { }
}
// ^^^ switch/create/rename/delete overlays ^^^

function nextZ() {
  return pendingElements.value.reduce((m, e) => Math.max(m, e.z_index), 0) + 1;
}

function addElement(type: OverlayElementType, variant?: ShapeVariant) {
  pushHistory();
  const el = defaultElement(type, baseWidth.value / 2, baseHeight.value / 2);
  if (type === "shape" && variant) {
    el.data = { variant };
    el.style = shapeDefaultStyle(variant);
  }
  el.z_index = nextZ();
  pendingElements.value = [...pendingElements.value, el];
  selectedIds.value = [el.id];
  dirty.value = true;
}

function onSelect(id: string | null, additive: boolean) {
  if (id === null) {
    selectedIds.value = [];
    return;
  }
  if (additive) {
    selectedIds.value = selectedIds.value.includes(id)
      ? selectedIds.value.filter((x) => x !== id)
      : [...selectedIds.value, id];
    return;
  }
  // >>> clicking one member of a group selects the whole group
  const el = pendingElements.value.find((e) => e.id === id);
  if (el?.group_id) {
    selectedIds.value = pendingElements.value
      .filter((e) => e.group_id === el.group_id)
      .map((e) => e.id);
  } else {
    selectedIds.value = [id];
  }
}
// >>> additive adds to selection, otherwise replaces it
function onSelectMany(ids: string[], additive: boolean) {
  if (!additive) {
    selectedIds.value = ids;
    return;
  }
  const set = new Set(selectedIds.value);
  for (const id of ids) set.add(id);
  selectedIds.value = [...set];
}

function deleteSelected() {
  if (!selectedIds.value.length) return;
  pushHistory();
  for (const id of selectedIds.value) {
    if (savedIds.value.has(id)) deletedIds.value.push(id);
  }
  const toDelete = new Set(selectedIds.value);
  pendingElements.value = pendingElements.value.filter((e) => !toDelete.has(e.id));
  selectedIds.value = [];
  dirty.value = true;
}
function deleteOne(id: string) {
  selectedIds.value = [id];
  deleteSelected();
}

function toggleLock(id: string) {
  const el = pendingElements.value.find((e) => e.id === id);
  if (!el) return;
  pushHistory();
  applyPatch(id, { locked: !el.locked });
}
function toggleVisible(id: string) {
  const el = pendingElements.value.find((e) => e.id === id);
  if (!el) return;
  pushHistory();
  applyPatch(id, { visible: !el.visible });
}
function hideAllLayers() {
  // >>> staged edit, watcher saves it when live update is on
  if (!pendingElements.value.some((e) => e.visible)) return;
  updateElements(pendingElements.value.map((e) => ({ id: e.id, patch: { visible: false } })));
}
function showAllLayers() {
  if (!pendingElements.value.some((e) => !e.visible)) return;
  updateElements(pendingElements.value.map((e) => ({ id: e.id, patch: { visible: true } })));
}

function groupSelected() {
  if (selectedIds.value.length < 2) return;
  pushHistory();
  const gid = newElementId();
  const set = new Set(selectedIds.value);
  pendingElements.value = pendingElements.value.map((e) =>
    set.has(e.id) ? { ...e, group_id: gid } : e,
  );
  dirty.value = true;
}
function ungroupSelected() {
  pushHistory();
  const set = new Set(selectedIds.value);
  pendingElements.value = pendingElements.value.map((e) =>
    set.has(e.id) ? { ...e, group_id: null } : e,
  );
  dirty.value = true;
}

// vvv copy/paste/duplicate - remaps ids + internal video<->audio links vvv
const clipboard = ref<OverlayElement[]>([]);
function copySelected() {
  clipboard.value = pendingElements.value
    .filter((e) => selectedIds.value.includes(e.id))
    .map((e) => JSON.parse(JSON.stringify(e)));
}
function pasteFrom(source: OverlayElement[]) {
  if (!source.length) return;
  pushHistory();
  const idMap = new Map<string, string>();
  const gid = source.some((e) => e.group_id) ? newElementId() : null;
  const copies = source.map((e) => {
    const id = newElementId();
    idMap.set(e.id, id);
    return { ...JSON.parse(JSON.stringify(e)), id, x: e.x + 24, y: e.y + 24, group_id: e.group_id ? gid : null };
  });
  for (const c of copies) {
    if (c.data?.linkedVideoId && idMap.has(c.data.linkedVideoId))
      c.data = { ...c.data, linkedVideoId: idMap.get(c.data.linkedVideoId) };
    if (c.data?.linkedAudioId && idMap.has(c.data.linkedAudioId))
      c.data = { ...c.data, linkedAudioId: idMap.get(c.data.linkedAudioId) };
  }
  pendingElements.value = [...pendingElements.value, ...copies];
  selectedIds.value = copies.map((c) => c.id);
  dirty.value = true;
}
function pasteClipboard() {
  pasteFrom(clipboard.value);
}

// vvv OS clipboard paste, falls back to the internal one vvv
function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}
async function pasteImageBlob(blob: Blob) {
  try {
    const dataUrl = await blobToDataUrl(blob);
    const res = await fetch(`${API}/images/upload-base64`, {
      method: "POST",
      headers: { ...props.authHeaders, "Content-Type": "application/json" },
      body: JSON.stringify({ data: dataUrl, filename: "pasted-image.png" }),
    });
    if (!res.ok) return;
    const d = (await res.json()) as { url: string };
    addElement("image");
    if (selectedElement.value) updateElement(selectedElement.value.id, { content: d.url });
  } catch { }
}
function pasteTextAsElement(text: string) {
  addElement("text");
  if (selectedElement.value) updateElement(selectedElement.value.id, { content: text });
}
async function pasteFromSystemClipboard() {
  // >>> in-app copy wins over stale OS clipboard content
  if (clipboard.value.length) {
    pasteClipboard();
    return;
  }
  try {
    const items = await navigator.clipboard.read();
    for (const item of items) {
      const imageType = item.types.find((ty) => ty.startsWith("image/"));
      if (imageType) {
        await pasteImageBlob(await item.getType(imageType));
        return;
      }
    }
    const text = (await navigator.clipboard.readText()).trim();
    if (text) {
      pasteTextAsElement(text);
      return;
    }
  } catch {
    // >>> clipboard unavailable, nothing else to fall back to
  }
}
// ^^^ system clipboard paste ^^^
function duplicateSelected() {
  const sel = pendingElements.value.filter((e) => selectedIds.value.includes(e.id));
  pasteFrom(sel);
}
// >>> duplicates one layer, ignores current selection
function duplicateLayer(id: string) {
  const el = pendingElements.value.find((e) => e.id === id);
  if (el) pasteFrom([el]);
}
// ^^^ copy/paste/duplicate ^^^

// vvv add/remove/show/hide/swap apply immediately, not staged vvv
// >>> other overlay already attached to the picked scene
const occupantOverlay = computed(() =>
  overlays.value.find(
    (o) => o.id !== currentOverlayId.value && o.scenes.some((s) => s.scene === activateScene.value),
  ),
);
async function addToScene() {
  if (busy.value || !currentOverlay.value) return;
  busy.value = true;
  try {
    const res = await fetch(
      `${API}/overlay/${props.channel}/${currentOverlay.value.id}/add-to-scene`,
      {
        method: "POST",
        headers: { ...props.authHeaders, "Content-Type": "application/json" },
        body: JSON.stringify({ scene: activateScene.value }),
      },
    );
    if (res.ok) await loadOverlaysList();
  } catch { }
  busy.value = false;
  menuOpen.value = false;
}
// >>> copies overlay so the scene can diverge, not share
async function duplicateToScene() {
  if (busy.value || !currentOverlay.value || !activateScene.value) return;
  busy.value = true;
  try {
    const dupRes = await fetch(
      `${API}/overlays/${props.channel}/${currentOverlay.value.id}/duplicate`,
      { method: "POST", headers: props.authHeaders },
    );
    if (dupRes.ok) {
      const d = (await dupRes.json()) as { overlay: Overlay };
      const addRes = await fetch(`${API}/overlay/${props.channel}/${d.overlay.id}/add-to-scene`, {
        method: "POST",
        headers: { ...props.authHeaders, "Content-Type": "application/json" },
        body: JSON.stringify({ scene: activateScene.value }),
      });
      if (addRes.ok) {
        currentOverlayId.value = d.overlay.id;
        selectedIds.value = [];
        await loadOverlaysList();
        await loadElements();
      }
    }
  } catch { }
  busy.value = false;
}
async function removeFromScene() {
  if (busy.value || !currentOverlay.value) return;
  busy.value = true;
  try {
    const res = await fetch(
      `${API}/overlay/${props.channel}/${currentOverlay.value.id}/remove-from-scene`,
      {
        method: "POST",
        headers: { ...props.authHeaders, "Content-Type": "application/json" },
        body: JSON.stringify({ scene: activateScene.value }),
      },
    );
    if (res.ok) await loadOverlaysList();
  } catch { }
  busy.value = false;
  menuOpen.value = false;
}
async function toggleVisibility() {
  if (busy.value || !currentOverlay.value) return;
  busy.value = true;
  const action = overlayVisible.value ? "hide" : "show";
  try {
    const res = await fetch(
      `${API}/overlay/${props.channel}/${currentOverlay.value.id}/${action}`,
      {
        method: "POST",
        headers: { ...props.authHeaders, "Content-Type": "application/json" },
        body: JSON.stringify({ scene: activateScene.value }),
      },
    );
    if (res.ok) await loadOverlaysList();
  } catch { }
  busy.value = false;
  menuOpen.value = false;
}
async function swapIn() {
  if (busy.value || !currentOverlay.value) return;
  busy.value = true;
  try {
    const res = await fetch(`${API}/overlay/${props.channel}/${currentOverlay.value.id}/swap`, {
      method: "POST",
      headers: { ...props.authHeaders, "Content-Type": "application/json" },
      body: JSON.stringify({ scene: activateScene.value }),
    });
    if (res.ok) await loadOverlaysList();
  } catch { }
  busy.value = false;
  menuOpen.value = false;
}
// ^^^ add/remove/show/hide/swap ^^^

function insertVariableToken(token: string) {
  if (!selectedElement.value) return;
  updateElement(selectedElement.value.id, { content: token });
}

async function save(opts: { silent?: boolean } = {}) {
  if (!currentOverlayId.value || saving.value) return;
  saving.value = true;
  try {
    // >>> skip refresh, live-preview already pushed the final position
    const skipRefresh = !!opts.silent && Date.now() - lastLivePreviewAt < 1500;
    const res = await fetch(
      `${API}/overlay/${props.channel}/${currentOverlayId.value}/elements/bulk`,
      {
        method: "PUT",
        headers: { ...props.authHeaders, "Content-Type": "application/json" },
        body: JSON.stringify({
          elements: pendingElements.value.map(toWireElement),
          deletedIds: deletedIds.value,
          skipRefresh,
        }),
      },
    );
    if (res.ok) {
      lastSavedAt.value = Date.now();
      if (opts.silent) {
        // >>> don't reload mid-edit, that wipes undo history
        savedIds.value = new Set(pendingElements.value.map((e) => e.id));
        deletedIds.value = [];
        dirty.value = false;
      } else {
        await loadElements();
      }
    }
  } catch { }
  saving.value = false;
}

// vvv live update auto-saves on every change vvv
const liveUpdate = ref(false);
// >>> throttle with trailing edge, pure debounce never fires
const LIVE_THROTTLE_MS = 800;
let liveUpdateLastSaveAt = 0;
let liveUpdateTimer: ReturnType<typeof setTimeout> | null = null;
function scheduleLiveSave() {
  if (!liveUpdate.value || !dirty.value) return;
  const elapsed = Date.now() - liveUpdateLastSaveAt;
  if (liveUpdateTimer) clearTimeout(liveUpdateTimer);
  if (elapsed >= LIVE_THROTTLE_MS) {
    liveUpdateLastSaveAt = Date.now();
    save({ silent: true });
  } else {
    liveUpdateTimer = setTimeout(() => {
      liveUpdateLastSaveAt = Date.now();
      save({ silent: true });
    }, LIVE_THROTTLE_MS - elapsed);
  }
}
watch(pendingElements, scheduleLiveSave, { deep: true });
watch(
  () => !!props.obsReady && overlayVisible.value,
  (ok) => {
    if (!ok) liveUpdate.value = false;
  },
);
// >>> force a real save on turn-on so source reloads
async function toggleLiveUpdate() {
  const turningOn = !liveUpdate.value;
  liveUpdate.value = turningOn;
  if (turningOn) await save();
}

// >>> broadcast-only push, doesn't touch undo or the DB
let livePreviewSending = false;
// >>> lets the trailing save skip an unneeded refresh
let lastLivePreviewAt = 0;
async function onLivePreview(updates: Array<{ id: string; patch: Partial<OverlayElement> }>) {
  lastLivePreviewAt = Date.now();
  if (!liveUpdate.value || !currentOverlayId.value || livePreviewSending) return;
  livePreviewSending = true;
  try {
    await fetch(
      `${API}/overlay/${props.channel}/${currentOverlayId.value}/live-patch`,
      {
        method: "POST",
        headers: { ...props.authHeaders, "Content-Type": "application/json" },
        body: JSON.stringify({ updates }),
      },
    );
  } catch { }
  livePreviewSending = false;
}
// ^^^ live update ^^^

// vvv video stop/start/restart, always live regardless of the Live Update toggle vvv
const canvasStageRef = ref<InstanceType<typeof ObsOverlayCanvasStage> | null>(null);
async function broadcastVideoCommand(id: string, cmd: "play" | "pause" | "restart") {
  if (!currentOverlayId.value) return;
  try {
    await fetch(
      `${API}/overlay/${props.channel}/${currentOverlayId.value}/video-command`,
      {
        method: "POST",
        headers: { ...props.authHeaders, "Content-Type": "application/json" },
        body: JSON.stringify({ id, cmd }),
      },
    );
  } catch { }
}
function onVideoCommand(id: string, cmd: "play" | "pause" | "restart") {
  canvasStageRef.value?.applyVideoCommand(id, cmd);
  broadcastVideoCommand(id, cmd);
}
function toggleVideoPlay(el: OverlayElement) {
  const nowPaused = el.data.paused !== true;
  updateElement(el.id, { data: { ...el.data, paused: nowPaused } });
  onVideoCommand(el.id, nowPaused ? "pause" : "play");
}
function restartVideo(el: OverlayElement) {
  onVideoCommand(el.id, "restart");
}
// ^^^ video stop/start/restart ^^^

// vvv live cursor share, per-user opt-in vvv
const liveCursor = ref(false);
// >>> random color per session, stays consistent while editing
const myCursorColor = `hsl(${Math.floor(Math.random() * 360)}, 75%, 60%)`;
let cursorSending = false;
function onCursorMove(x: number, y: number) {
  if (!liveCursor.value || !currentOverlayId.value || cursorSending) return;
  cursorSending = true;
  fetch(`${API}/overlay/${props.channel}/${currentOverlayId.value}/live-cursor`, {
    method: "POST",
    headers: { ...props.authHeaders, "Content-Type": "application/json" },
    body: JSON.stringify({ x, y, color: myCursorColor }),
  })
    .catch(() => { })
    .finally(() => (cursorSending = false));
}
function sendCursorLeave() {
  if (!currentOverlayId.value) return;
  fetch(`${API}/overlay/${props.channel}/${currentOverlayId.value}/live-cursor-leave`, {
    method: "POST",
    headers: props.authHeaders,
  }).catch(() => { });
}
function toggleLiveCursor() {
  if (!liveUpdate.value) return;
  liveCursor.value = !liveCursor.value;
  if (!liveCursor.value) sendCursorLeave();
}
watch(liveUpdate, (on) => {
  if (!on && liveCursor.value) {
    liveCursor.value = false;
    sendCursorLeave();
  }
});
// ^^^ live cursor share ^^^

// vvv multi-editor sync, other sessions on same overlay vvv
let editStream: EventSource | null = null;
function connectEditStream() {
  editStream?.close();
  editStream = null;
  if (!currentOverlayId.value) return;
  editStream = new EventSource(`${API}/obs/overlay/${currentOverlayId.value}/live-stream`);
  editStream.onmessage = (ev) => {
    if (!ev.data) return;
    let msg: any;
    try {
      msg = JSON.parse(ev.data);
    } catch {
      return;
    }
    if (!msg.by || msg.by === session.value?.login) return; // <<< ignore our own broadcasts
    if (msg.updates) {
      for (const u of msg.updates as Array<{ id: string; patch: Record<string, unknown> }>) {
        applyRemotePatch(u.id, u.patch);
      }
    } else if (msg.saved) {
      // >>> only refetch if nothing unsaved locally
      if (!dirty.value) loadElements();
    }
  };
}
watch(currentOverlayId, connectEditStream);
// ^^^ multi-editor sync ^^^

function discard() {
  loadElements();
  selectedIds.value = [];
}

// vvv confirm before closing with unsaved changes vvv
const closeConfirmOpen = ref(false);
function requestClose() {
  if (dirty.value) closeConfirmOpen.value = true;
  else emit("close");
}
async function saveAndClose() {
  closeConfirmOpen.value = false;
  await save();
  emit("close");
}
function discardAndClose() {
  closeConfirmOpen.value = false;
  emit("close");
}
// ^^^ confirm before closing ^^^

function onKeydown(e: KeyboardEvent) {
  if (e.key === "Escape") {
    if (closeConfirmOpen.value) closeConfirmOpen.value = false;
    else requestClose();
    return;
  }
  const mod = e.ctrlKey || e.metaKey;
  // >>> Ctrl+S works even in a focused field
  if (mod && e.key.toLowerCase() === "s") {
    e.preventDefault();
    save();
    return;
  }
  const target = e.target as HTMLElement;
  const isEditable =
    target.tagName === "INPUT" ||
    target.tagName === "TEXTAREA" ||
    target.tagName === "SELECT" ||
    target.isContentEditable;
  if (isEditable) return;
  if (mod && e.key.toLowerCase() === "y") {
    e.preventDefault();
    redo();
  } else if (mod && e.key.toLowerCase() === "z") {
    e.preventDefault();
    undo();
  } else if (mod && e.key.toLowerCase() === "c") {
    e.preventDefault();
    copySelected();
  } else if (mod && e.key.toLowerCase() === "v") {
    e.preventDefault();
    pasteFromSystemClipboard();
  } else if (mod && e.key.toLowerCase() === "d") {
    e.preventDefault();
    duplicateSelected();
  } else if (e.key === "Delete" || e.key === "Backspace") {
    e.preventDefault();
    deleteSelected();
  } else if (!mod && e.key === "1") {
    e.preventDefault();
    pickBackdrop("checker");
  } else if (!mod && e.key === "2") {
    e.preventDefault();
    pickBackdrop("white");
  } else if (!mod && e.key === "3") {
    e.preventDefault();
    pickBackdrop("black");
  } else if (!mod && e.key === "4" && props.obsReady) {
    e.preventDefault();
    pickBackdrop("scene");
  }
}
let previewTimer: ReturnType<typeof setInterval> | null = null;
function onWindowMousedownForMenu(e: MouseEvent) {
  if (!menuOpen.value) return;
  if (!(e.target as HTMLElement).closest(".ovl-activate-menu")) menuOpen.value = false;
}
onMounted(() => {
  load();
  fetchCounterValues();
  window.addEventListener("keydown", onKeydown);
  // >>> capture phase, bubble would never see canvas clicks
  window.addEventListener("mousedown", onWindowMousedownForMenu, true);
  previewTimer = setInterval(() => {
    fetchPreviewValues();
    fetchCounterValues();
  }, 5000);
  clockTimer = setInterval(() => (clockNow.value = Date.now()), 1000);
});
onUnmounted(() => {
  window.removeEventListener("keydown", onKeydown);
  if (clockTimer) clearInterval(clockTimer);
  window.removeEventListener("mousedown", onWindowMousedownForMenu, true);
  if (previewTimer) clearInterval(previewTimer);
  if (liveUpdateTimer) clearTimeout(liveUpdateTimer);
  if (liveCursor.value) sendCursorLeave();
  editStream?.close();
});
</script>

<template>
  <Teleport to="body">
    <div class="ovl-overlay">
      <div class="ovl-modal">
        <div class="ovl-topbar">
          <div class="ovl-switcher">
            <button class="ovl-switcher-nav" title="Previous overlay" :disabled="overlays.length < 2"
              @click="cycleOverlay(-1)" v-html="iconSvgFor('chevron-left')"></button>
            <input v-if="renaming" v-model="renameDraft" class="ovl-switcher-input" autofocus
              @blur="commitRename" @keydown.enter="commitRename"
              @keydown.esc="renaming = false" />
            <button v-else class="ovl-switcher-label" :title="`${overlays.length} overlay(s) - click to rename`"
              @click="startRename">
              {{ currentOverlay?.name || "Stream Overlay" }}
            </button>
            <button class="ovl-switcher-nav" title="Next overlay" :disabled="overlays.length < 2"
              @click="cycleOverlay(1)" v-html="iconSvgFor('chevron-right')"></button>
            <button class="ovl-switcher-nav" title="New overlay" @click="createOverlay"
              v-html="iconSvgFor('plus')"></button>
            <button class="ovl-switcher-nav" title="Delete this overlay" :disabled="overlays.length < 2"
              @click="deleteOverlay" v-html="iconSvgFor('trash')"></button>
          </div>
          <div class="ovl-topbar-actions">
            <div class="ovl-backdrop-swatches" title="Canvas backdrop (editor-only, never rendered live)">
              <button v-for="b in (['checker', 'white', 'black'] as const)" :key="b" class="ovl-backdrop-swatch"
                :class="[b, { active: stageBackdrop === b }]" :title="b" @click="pickBackdrop(b)"></button>
              <button v-if="obsReady" class="ovl-backdrop-swatch scene"
                :class="{ active: stageBackdrop === 'scene' }" title="preview the real scene behind the canvas"
                @click="pickBackdrop('scene')" v-html="iconSvgFor('monitor')"></button>
            </div>
            <button class="ovl-btn-cancel" :class="{ on: snapEnabled }" @click="snapEnabled = !snapEnabled"
              :title="snapEnabled ? 'Snapping on - click to disable' : 'Snapping off - click to enable'">
              <span v-html="iconSvgFor('maximize')"></span> Snap
            </button>
            <button class="ovl-btn-cancel" :disabled="!historyPast.length" @click="undo" title="Undo (Ctrl+Z)">
              <span v-html="iconSvgFor('corner-up-left')"></span>
            </button>
            <button class="ovl-btn-cancel" :disabled="!historyFuture.length" @click="redo" title="Redo (Ctrl+Y)">
              <span v-html="iconSvgFor('corner-up-right')"></span>
            </button>
            <button v-if="obsReady && overlayVisible" class="ovl-btn-cancel" :class="{ on: liveUpdate }"
              @click="toggleLiveUpdate"
              title="Auto-save every change as you make it, not just when you click Save">
              Live Update
            </button>
            <button v-if="obsReady && overlayVisible" class="ovl-btn-cancel ovl-btn-icon-only"
              :class="{ on: liveCursor }" :disabled="!liveUpdate" @click="toggleLiveCursor"
              :title="liveUpdate ? 'Show your cursor + name live on stream' : 'Turn on Live Update first'">
              <span v-html="iconSvgFor('mouse-pointer')"></span>
            </button>
            <button class="ovl-btn-cancel" :disabled="!dirty || saving" @click="discard">Discard</button>
            <button class="ovl-btn-save" :disabled="!dirty || saving" @click="save()">
              {{ saving ? "Saving…" : "Save" }}
            </button>
            <button class="ovl-close-btn" title="Close (Esc)" @click="requestClose" v-html="iconSvgFor('x')"></button>
          </div>
        </div>

        <!-- >>> pinned, stays visible like OBS's own safe area -->
        <div class="ovl-activate-bar">
          <span class="ovl-activate-dot" :class="{ on: overlayVisible }"></span>
          <span class="ovl-activate-status">
            <template v-if="overlayAdded">{{ overlayVisible ? "Visible in OBS - " : "Added, hidden - " }}{{
              activateScene }}</template>
            <template v-else-if="occupantOverlay">“{{ occupantOverlay.name }}” is on this scene</template>
            <template v-else>Not added to {{ activateScene || "a scene" }}</template>
            <span v-if="lastSavedLabel" class="ovl-activate-saved">{{ lastSavedLabel }}</span>
          </span>
          <span v-if="currentOverlay && currentOverlay.scenes.length > 1" class="ovl-activate-count">
            on {{ currentOverlay.scenes.length }} scenes
          </span>
          <select v-model="activateScene" class="ovl-activate-select">
            <option value="" disabled>pick scene</option>
            <option v-for="s in scenes" :key="s" :value="s">{{ s }}</option>
          </select>
          <template v-if="!overlayAdded">
            <button v-if="occupantOverlay" class="ovl-activate-btn" :disabled="busy || !activateScene"
              :title="`Replaces “${occupantOverlay.name}”, currently attached to this scene`" @click="swapIn">
              {{ busy ? "…" : "Swap in" }}
            </button>
            <template v-else>
              <button class="ovl-activate-btn" :disabled="busy || !activateScene" @click="addToScene">
                {{ busy ? "…" : "Add to scene" }}
              </button>
              <button v-if="pendingElements.length" class="ovl-activate-btn" :disabled="busy || !activateScene"
                title="Make an independent copy of this overlay and attach the copy to this scene"
                @click="duplicateToScene">
                Duplicate to this scene
              </button>
            </template>
          </template>
          <div v-else class="ovl-activate-menu">
            <button class="ovl-activate-btn" :disabled="busy" @click="menuOpen = !menuOpen">
              {{ busy ? "…" : "Manage" }} <span v-html="iconSvgFor('chevron-down')"></span>
            </button>
            <div v-if="menuOpen" class="ovl-activate-menu-list">
              <button v-if="obsReady" @click="toggleVisibility">
                {{ overlayVisible ? "Hide overlay source" : "Show overlay source" }}
              </button>
              <button @click="removeFromScene">Remove from scene</button>
            </div>
          </div>
        </div>

        <div class="ovl-content">
          <ObsOverlayElementGallery @add="addElement" />

          <div class="ovl-body">
            <div v-if="loading" class="ovl-loading">loading…</div>
            <ObsOverlayCanvasStage v-else ref="canvasStageRef" :elements="pendingElements"
              :selected-ids="selectedIds" :base-width="baseWidth" :base-height="baseHeight" :backdrop="stageBackdrop"
              :scene-shot-url="sceneShotUrl" :preview-values="previewValues" :snap-enabled="snapEnabled"
              @select="onSelect" @select-many="onSelectMany" @update-element="updateElement"
              @update-elements="updateElements" @delete-element="deleteOne" @delete-selected="deleteSelected"
              @duplicate-element="duplicateSelected" @live-preview="onLivePreview" @cursor-move="onCursorMove"
              @video-command="onVideoCommand" />
          </div>

          <div class="ovl-props">
            <template v-if="selectedElement">
              <div class="ovl-props-title">properties</div>
              <div class="ovl-props-type">{{ selectedElement.type }}</div>

              <div v-if="isCountdownLike(selectedElement.type)" class="ovl-props-countdown-top">
                <input class="ovl-props-time-input" type="text" :value="countdownTimeFieldValue(selectedElement)"
                  @focus="onCountdownFieldFocus(selectedElement, $event)"
                  @input="countdownDraft = ($event.target as HTMLInputElement).value"
                  @blur="commitCountdownTimeField(selectedElement, $event)"
                  @keydown.enter="($event.target as HTMLInputElement).blur()" />
                <button v-if="canToggleRunning(selectedElement)" class="ep-btn-cancel"
                  @click="toggleElementRunning(selectedElement)">
                  {{ selectedElement.data.running !== false ? "Stop" : "Start" }}
                </button>
              </div>

              <template v-if="!['shape', 'audio', 'countdown', 'countup'].includes(selectedElement.type)">
                <label class="ovl-props-label">
                  {{ selectedElement.type === "image" || selectedElement.type === "video" ? "Media URL" : "Content" }}
                </label>
                <textarea v-if="selectedElement.type === 'text' || selectedElement.type === 'variable-text'"
                  class="ovl-props-textarea" :value="selectedElement.content" :placeholder="selectedElement.type === 'variable-text'
                    ? 'e.g. $counter.wins'
                    : 'Text to show'
                    "
                  @input="updateElement(selectedElement.id, { content: ($event.target as HTMLTextAreaElement).value })" />
                <input v-else class="ovl-props-input" :value="selectedElement.content" placeholder="https://…"
                  @input="updateElement(selectedElement.id, { content: ($event.target as HTMLInputElement).value })" />

                <ObsOverlayVariablePicker v-if="selectedElement.type === 'variable-text'" :channel="channel"
                  :auth-headers="authHeaders" @insert="insertVariableToken" />

                <div v-if="selectedElement.type === 'video'" class="ovl-video-controls">
                  <button class="ep-btn-cancel" @click="toggleVideoPlay(selectedElement)">
                    {{ selectedElement.data.paused === true ? "Start" : "Stop" }}
                  </button>
                  <button class="ep-btn-cancel" @click="restartVideo(selectedElement)">Restart</button>
                </div>
              </template>

              <!-- >>> global, stays visible, not in a collapsible -->
              <label class="ovl-props-label ovl-opacity-label">
                Opacity
                <div class="ovl-opacity-row">
                  <input type="range" min="0" max="100" :value="selectedElement.style.opacity ?? 100"
                    @input="updateElement(selectedElement.id, { style: { ...selectedElement.style, opacity: Number(($event.target as HTMLInputElement).value) } })" />
                  <span class="ovl-opacity-pct">{{ selectedElement.style.opacity ?? 100 }}%</span>
                </div>
              </label>

              <!-- >>> alignment stays visible, not in a collapsible -->
              <label v-if="isTextLikeType(selectedElement.type)" class="ovl-props-label ovl-align-label">
                Alignment
                <div class="ovl-align-grid">
                  <button v-for="opt in alignOptions" :key="opt.h + opt.v" class="ovl-align-btn" :class="{
                    active: (selectedElement.style.textAlign || 'left') === opt.h && (selectedElement.style.verticalAlign || 'top') === opt.v,
                  }" :title="`${opt.v} ${opt.h}`" @click="setAlign(selectedElement, opt.h, opt.v)">
                    <span class="ovl-align-dot"></span>
                  </button>
                </div>
              </label>

              <ObsOverlayStylePanel :element="selectedElement!"
                @update="(patch) => updateElement(selectedElement!.id, patch)" />
            </template>
            <div v-else-if="selectedIds.length > 1" class="ovl-props-empty">
              {{ selectedIds.length }} elements selected.
              <button class="ovl-btn-delete" @click="deleteSelected">
                <span v-html="iconSvgFor('trash')"></span> Delete all
              </button>
            </div>
            <div v-else class="ovl-props-empty">Select an element, or add one from the gallery.</div>

            <ObsOverlayLayersPanel :elements="pendingElements" :selected-ids="selectedIds" @select="onSelect"
              @toggle-lock="toggleLock" @toggle-visible="toggleVisible" @update-elements="updateElements"
              @hide-all="hideAllLayers" @show-all="showAllLayers" @delete="deleteOne"
              @duplicate="duplicateLayer" @group="groupSelected" @ungroup="ungroupSelected" />

            <div v-if="usedCounterNames.length" class="ovl-counters">
              <div class="ovl-counters-title">counters</div>
              <div v-for="name in usedCounterNames" :key="name" class="ovl-counters-row">
                <span class="ovl-counters-name">${{ name }}</span>
                <span class="ovl-counters-value">{{ counterValues[name] ?? 0 }}</span>
                <button class="ovl-counters-btn" title="Decrease" @click="bumpCounter(name, -1)">−</button>
                <button class="ovl-counters-btn" title="Increase" @click="bumpCounter(name, 1)">+</button>
              </div>
            </div>
          </div>
        </div>
      </div>

      <div v-if="closeConfirmOpen" class="ovl-close-confirm-backdrop" @mousedown.self="closeConfirmOpen = false">
        <div class="ovl-close-confirm">
          <div class="ovl-close-confirm-title">Close without saving?</div>
          <div class="ovl-close-confirm-body">You have unsaved changes. Save them before closing, or discard them?</div>
          <div class="ovl-close-confirm-actions">
            <button class="ovl-btn-cancel" @click="closeConfirmOpen = false">Cancel</button>
            <button class="ovl-btn-delete" @click="discardAndClose">Discard</button>
            <button class="ovl-btn-save" :disabled="saving" @click="saveAndClose">
              {{ saving ? "Saving…" : "Save & close" }}
            </button>
          </div>
        </div>
      </div>
    </div>
  </Teleport>
</template>

<style scoped>
.ovl-overlay {
  position: fixed;
  inset: 0;
  z-index: 2000;
  background: rgba(0, 0, 0, 0.85);
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 24px;
}

.ovl-modal {
  width: 100%;
  max-width: 1600px;
  height: 100%;
  max-height: 920px;
  background: #0a0a0d;
  border: 1px solid #2a2a30;
  display: flex;
  flex-direction: column;
}

.ovl-topbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 12px 16px;
  flex-shrink: 0;
  border-bottom: 1px solid #1e1e22;
}

.ovl-switcher {
  display: flex;
  align-items: center;
  gap: 4px;
}

.ovl-switcher-nav {
  width: 24px;
  height: 24px;
  display: flex;
  align-items: center;
  justify-content: center;
  border: 1px solid #2a2a30;
  background: #111217;
  color: #888;
  cursor: pointer;
  flex-shrink: 0;
}

.ovl-switcher-nav svg {
  width: 11px;
  height: 11px;
}

.ovl-switcher-nav:hover:not(:disabled) {
  border-color: #6f2bff;
  color: #9d6cff;
}

.ovl-switcher-nav:disabled {
  opacity: 0.35;
  cursor: not-allowed;
}

.ovl-switcher-label,
.ovl-switcher-input {
  height: 24px;
  padding: 0 8px;
  color: #e0e0e0;
  font-weight: 700;
  font-size: 13px;
  font-family: inherit;
  border: 1px solid transparent;
  background: transparent;
  cursor: pointer;
  max-width: 220px;
  text-overflow: ellipsis;
  overflow: hidden;
  white-space: nowrap;
}

.ovl-switcher-label:hover {
  border-color: #2a2a30;
}

.ovl-switcher-input {
  border-color: #6f2bff88;
  background: #111217;
  cursor: text;
  outline: none;
}

.ovl-topbar-actions {
  display: flex;
  align-items: center;
  gap: 8px;
}

.ovl-activate-bar {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 8px 16px;
  flex-shrink: 0;
  border-bottom: 1px solid #1e1e22;
  background: #0d0d10;
}

.ovl-activate-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: #555;
  flex-shrink: 0;
}

.ovl-activate-dot.on {
  background: #4ec9b0;
  box-shadow: 0 0 6px #4ec9b0aa;
}

.ovl-activate-status {
  color: #888;
  font-size: 12px;
  margin-right: auto;
}

.ovl-activate-saved {
  margin-left: 8px;
  color: #666;
  opacity: 0.6;
  font-size: 10px;
}

.ovl-counters {
  border-top: 1px solid #1e1e22;
  padding-top: 8px;
  margin-top: 8px;
}

.ovl-counters-title {
  font-size: 10px;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  color: #555;
  margin-bottom: 6px;
}

.ovl-counters-row {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 4px 4px;
}

.ovl-counters-name {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 10px;
  color: #9d6cff;
  font-family: "Consolas", "Fira Mono", monospace;
}

.ovl-counters-value {
  flex-shrink: 0;
  font-size: 12px;
  color: #e0e0e0;
  min-width: 24px;
  text-align: right;
}

.ovl-counters-btn {
  width: 20px;
  height: 20px;
  flex-shrink: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  border: 1px solid #2a2a30;
  background: #111217;
  color: #888;
  font-size: 13px;
  line-height: 1;
  cursor: pointer;
}

.ovl-counters-btn:hover {
  border-color: #6f2bff;
  color: #9d6cff;
}

.ovl-activate-select {
  height: 30px;
  padding: 0 8px;
  border: 1px solid #2a2a30;
  background: #111217;
  color: #ccc;
  font-family: inherit;
  font-size: 12px;
}

.ovl-activate-select:disabled {
  opacity: 0.6;
}

.ovl-activate-btn {
  height: 30px;
  padding: 0 16px;
  border: 1px solid #2a2a30;
  background: #111217;
  color: #ccc;
  font-family: inherit;
  font-size: 12px;
  font-weight: 600;
  cursor: pointer;
}

.ovl-activate-btn:hover:not(:disabled) {
  border-color: #6f2bff;
  color: #9d6cff;
}

.ovl-activate-btn.on {
  background: #f1494922;
  border-color: #f1494966;
  color: #f68f8f;
}

.ovl-activate-btn.on:hover:not(:disabled) {
  border-color: #f14949;
  color: #f14949;
}

.ovl-activate-btn:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}

.ovl-activate-count {
  color: #555;
  font-size: 11px;
  flex-shrink: 0;
}

.ovl-activate-menu {
  position: relative;
  flex-shrink: 0;
}

.ovl-activate-menu .ovl-activate-btn {
  display: inline-flex;
  align-items: center;
  gap: 4px;
}

.ovl-activate-menu .ovl-activate-btn svg {
  width: 10px;
  height: 10px;
}

.ovl-activate-menu-list {
  position: absolute;
  top: calc(100% + 4px);
  right: 0;
  min-width: 190px;
  background: #1a1a1e;
  border: 1px solid #2a2a30;
  box-shadow: 0 8px 32px rgba(0, 0, 0, 0.6);
  z-index: 50;
}

.ovl-activate-menu-list button {
  display: block;
  width: 100%;
  padding: 8px 12px;
  border: none;
  background: transparent;
  color: #ccc;
  font-family: inherit;
  font-size: 12px;
  text-align: left;
  cursor: pointer;
}

.ovl-activate-menu-list button:hover {
  background: #6f2bff18;
  color: #e0e0e0;
}

.ovl-backdrop-swatches {
  display: flex;
  align-items: center;
  gap: 4px;
  height: 30px;
  padding: 0 8px;
  border: 1px solid #2a2a30;
  background: #111217;
}

.ovl-backdrop-swatch {
  width: 16px;
  height: 16px;
  border: 1px solid #444;
  cursor: pointer;
  padding: 0;
}

.ovl-backdrop-swatch.checker {
  background: repeating-conic-gradient(#1a1a1e 0% 25%, #2a2a30 0% 50%) 50% / 8px 8px;
}

.ovl-backdrop-swatch.white {
  background: #ffffff;
}

.ovl-backdrop-swatch.black {
  background: #000000;
}

.ovl-backdrop-swatch.scene {
  width: auto;
  height: 16px;
  padding: 0 3px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: #0d0d10;
  color: #888;
}

.ovl-backdrop-swatch.scene svg {
  width: 10px;
  height: 10px;
}

.ovl-backdrop-swatch.active {
  border-color: #6f2bff;
  outline: 1px solid #6f2bff;
}

.ovl-btn-save {
  height: 30px;
  padding: 0 16px;
  border: none;
  background: #6f2bff;
  color: #fff;
  font-family: inherit;
  font-size: 12px;
  font-weight: 600;
  cursor: pointer;
}

.ovl-btn-save:hover:not(:disabled) {
  background: #7f3fff;
}

.ovl-btn-save:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}

.ovl-btn-cancel {
  height: 30px;
  padding: 0 14px;
  border: 1px solid #333;
  background: transparent;
  color: #888;
  font-family: inherit;
  font-size: 12px;
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  gap: 6px;
}

.ovl-btn-cancel svg {
  width: 12px;
  height: 12px;
}

.ovl-btn-cancel:hover:not(:disabled) {
  border-color: #555;
  color: #e0e0e0;
}

.ovl-btn-cancel.on {
  border-color: #6f2bff88;
  color: #9d6cff;
  background: #6f2bff15;
}

.ovl-btn-cancel:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}

.ovl-btn-icon-only {
  padding: 0 8px;
}

.ovl-btn-icon-only svg {
  width: 14px;
  height: 14px;
}

.ovl-close-btn {
  width: 30px;
  height: 30px;
  border: 1px solid #2a2a30;
  background: #111217;
  color: #888;
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
}

.ovl-close-btn:hover {
  color: #f14949;
  border-color: #f1494966;
}

.ovl-content {
  flex: 1;
  display: flex;
  min-height: 0;
}

.ovl-body {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 16px;
  min-width: 0;
  min-height: 0;
}

.ovl-loading {
  color: #555;
  font-size: 13px;
}

.ovl-props {
  width: 270px;
  flex-shrink: 0;
  border-left: 1px solid #1e1e22;
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 10px 12px;
  overflow-y: auto;
  scrollbar-width: none;
}

.ovl-props::-webkit-scrollbar {
  display: none;
}

.ovl-props-title {
  font-size: 10px;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  color: #555;
}

.ovl-props-type {
  font-size: 11px;
  color: #9d6cff;
  text-transform: uppercase;
  letter-spacing: 0.04em;
}

.ovl-props-countdown-top {
  display: flex;
  gap: 6px;
}

.ovl-video-controls {
  display: flex;
  gap: 6px;
  margin-top: 6px;
}

.ovl-video-controls button {
  flex: 1;
}

.ovl-props-time-input {
  flex: 1;
  min-width: 0;
  background: #111217;
  border: 1px solid #2a2a30;
  color: #e0e0e0;
  font-family: "Consolas", "Fira Mono", monospace;
  font-size: 14px;
  text-align: center;
  padding: 6px 8px;
  outline: none;
}

.ovl-props-time-input:focus {
  border-color: #6f2bff88;
}

.ovl-props-label {
  font-size: 10px;
  color: #666;
  text-transform: uppercase;
  letter-spacing: 0.04em;
}

.ovl-align-label {
  display: flex;
  flex-direction: column;
  gap: 5px;
}

.ovl-opacity-label {
  display: flex;
  flex-direction: column;
  gap: 5px;
}

.ovl-opacity-row {
  display: flex;
  align-items: center;
  gap: 8px;
}

.ovl-opacity-row input[type="range"] {
  flex: 1;
}

.ovl-opacity-pct {
  font-size: 11px;
  color: #999;
  width: 32px;
  text-align: right;
}

.ovl-align-grid {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 3px;
  width: 84px;
}

.ovl-align-btn {
  width: 26px;
  height: 26px;
  display: flex;
  align-items: center;
  justify-content: center;
  border: 1px solid #2a2a30;
  background: #111217;
  cursor: pointer;
}

.ovl-align-btn:hover {
  border-color: #6f2bff88;
}

.ovl-align-btn.active {
  border-color: #6f2bff;
  background: #6f2bff22;
}

.ovl-align-dot {
  width: 5px;
  height: 5px;
  border-radius: 50%;
  background: #666;
}

.ovl-align-btn.active .ovl-align-dot {
  background: #9d6cff;
}

.ovl-props-textarea,
.ovl-props-input {
  background: #111217;
  border: 1px solid #2a2a30;
  color: #e0e0e0;
  font-family: inherit;
  font-size: 12px;
  padding: 7px 8px;
  outline: none;
  width: 100%;
  box-sizing: border-box;
}

.ovl-props-textarea {
  min-height: 50px;
  resize: vertical;
}

.ovl-props-textarea:focus,
.ovl-props-input:focus {
  border-color: #6f2bff88;
}

.ovl-btn-delete {
  display: flex;
  align-items: center;
  gap: 6px;
  height: 30px;
  padding: 0 12px;
  border: 1px solid #f1494944;
  background: transparent;
  color: #f14949;
  font-family: inherit;
  font-size: 11px;
  cursor: pointer;
  align-self: flex-start;
}

.ovl-btn-delete:hover {
  background: #f1494911;
}

.ovl-btn-delete svg {
  width: 12px;
  height: 12px;
}

.ovl-props-empty {
  color: #555;
  font-size: 11px;
  line-height: 1.6;
  display: flex;
  flex-direction: column;
  gap: 8px;
  align-items: flex-start;
}

.ovl-close-confirm-backdrop {
  position: fixed;
  inset: 0;
  z-index: 2100;
  background: rgba(0, 0, 0, 0.6);
  display: flex;
  align-items: center;
  justify-content: center;
}

.ovl-close-confirm {
  width: 320px;
  background: #16161a;
  border: 1px solid #2a2a30;
  box-shadow: 0 12px 48px rgba(0, 0, 0, 0.7);
  padding: 18px;
}

.ovl-close-confirm-title {
  color: #e0e0e0;
  font-weight: 700;
  font-size: 14px;
  margin-bottom: 8px;
}

.ovl-close-confirm-body {
  color: #888;
  font-size: 12px;
  line-height: 1.5;
  margin-bottom: 16px;
}

.ovl-close-confirm-actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
}

</style>
