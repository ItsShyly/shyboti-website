<script setup lang="ts">


import { ref, computed, onMounted, onUnmounted, watch } from "vue";
import { API } from "../api";
import { iconSvg as iconSvgFor } from "../composables/icons";

interface SourceTransform {
  positionX: number;
  positionY: number;
  scaleX: number;
  scaleY: number;
  rotation: number;
}
interface PendingEdit {
  visible?: boolean;
  muted?: boolean;
  transform?: SourceTransform;
  baseline: { visible: boolean; muted: boolean; transform: SourceTransform };
}

const props = defineProps<{
  channel: string;
  sceneName: string;
  authHeaders: Record<string, string>;
  editMode: boolean;
  // >>> the parent's full pendingSourceEdits map, so staged-but-not-applied moves/
  // >>> toggles made elsewhere (or in a previous visit to this canvas) still show here
  pendingEdits: Record<string, PendingEdit>;
  selectedId: number | null;
}>();
const emit = defineEmits<{
  close: [];
  "update:selectedId": [id: number | null];
  // >>> mirrors the parent's stageSourceEdit(src, patch, scene) signature exactly
  stage: [src: any, patch: Partial<Pick<PendingEdit, "visible" | "muted" | "transform">>];
}>();

interface CanvasItem {
  sceneItemId: number;
  sourceName: string;
  sceneItemEnabled: boolean;
  isAudioSource: boolean;
  inputKind: string | null;
  muted?: boolean;
  volumePercent?: number;
  positionX?: number;
  positionY?: number;
  scaleX?: number;
  scaleY?: number;
  rotation?: number;
  width?: number;
  height?: number;
  sourceWidth?: number;
  sourceHeight?: number;
}

const items = ref<CanvasItem[]>([]);
const baseWidth = ref(1920);
const baseHeight = ref(1080);
const loading = ref(true);
const stageRef = ref<HTMLElement | null>(null);

function pendingKey(sceneItemId: number): string {
  return `${props.sceneName} ${sceneItemId}`;
}
function pendingFor(sceneItemId: number): PendingEdit | undefined {
  return props.pendingEdits[pendingKey(sceneItemId)];
}


const localTransform = ref<Record<number, SourceTransform>>({});
watch(
  () => props.pendingEdits,
  (edits) => {
    for (const idStr of Object.keys(localTransform.value)) {
      const id = Number(idStr);
      if (!edits[pendingKey(id)]?.transform) {
        const next = { ...localTransform.value };
        delete next[id];
        localTransform.value = next;
      }
    }
  },
  { deep: true },
);


function effective(it: CanvasItem): CanvasItem {
  const local = localTransform.value[it.sceneItemId];
  const p = pendingFor(it.sceneItemId);
  const t = local ?? p?.transform;
  if (!t && p === undefined) return it;
  return {
    ...it,
    sceneItemEnabled: p?.visible ?? it.sceneItemEnabled,
    muted: p?.muted ?? it.muted,
    positionX: t?.positionX ?? it.positionX,
    positionY: t?.positionY ?? it.positionY,
    scaleX: t?.scaleX ?? it.scaleX,
    scaleY: t?.scaleY ?? it.scaleY,
    rotation: t?.rotation ?? it.rotation,
    width: t && it.sourceWidth ? it.sourceWidth * t.scaleX : it.width,
    height: t && it.sourceHeight ? it.sourceHeight * t.scaleY : it.height,
  };
}

const selectedItem = computed(() =>
  items.value.find((i) => i.sceneItemId === props.selectedId) ?? null,
);
function select(id: number | null) {
  emit("update:selectedId", id);
}

async function load() {
  try {
    const [vsRes, srcRes] = await Promise.all([
      fetch(`${API}/obs/${props.channel}/video-settings`, { headers: props.authHeaders }),
      fetch(
        `${API}/obs/${props.channel}/sources?scene=${encodeURIComponent(props.sceneName)}`,
        { headers: props.authHeaders },
      ),
    ]);
    if (vsRes.ok) {
      const d = (await vsRes.json()) as { baseWidth: number; baseHeight: number };
      if (d.baseWidth) baseWidth.value = d.baseWidth;
      if (d.baseHeight) baseHeight.value = d.baseHeight;
    }
    if (srcRes.ok) {
      const d = (await srcRes.json()) as { sources: CanvasItem[] };
      // >>> same reversed-order fix as the main sources list
      items.value = (d.sources ?? []).slice().reverse().map((it) => effective(it));
    }
  } catch { }
  loading.value = false;
}

const placeableItems = computed(() =>
  items.value.filter(
    (it) => it.inputKind === "browser_source" && (it.width ?? 0) > 0 && (it.height ?? 0) > 0,
  ),
);

let pollTimer: ReturnType<typeof setInterval> | null = null;
onMounted(() => {
  load();
  pollTimer = setInterval(() => {
    if (!dragState.value && !resizeState.value) load();
  }, 4000);
  window.addEventListener("keydown", onKeydown);
});
onUnmounted(() => {
  if (pollTimer) clearInterval(pollTimer);
  window.removeEventListener("keydown", onKeydown);
});
function onKeydown(e: KeyboardEvent) {
  if (e.key === "Escape") emit("close");
}

// >>> on-screen CSS px per OBS canvas unit, based on however big the stage actually rendered
function scale(): number {
  const el = stageRef.value;
  if (!el || !baseWidth.value) return 1;
  return el.getBoundingClientRect().width / baseWidth.value;
}

function itemStyle(it: CanvasItem) {
  const e = effective(it);
  const s = scale();
  return {
    left: `${(e.positionX ?? 0) * s}px`,
    top: `${(e.positionY ?? 0) * s}px`,
    width: `${(e.width ?? 0) * s}px`,
    height: `${(e.height ?? 0) * s}px`,
    transform: e.rotation ? `rotate(${e.rotation}deg)` : undefined,
  };
}

function currentTransform(it: CanvasItem): SourceTransform {
  const e = effective(it);
  return {
    positionX: e.positionX ?? 0,
    positionY: e.positionY ?? 0,
    scaleX: e.scaleX ?? 1,
    scaleY: e.scaleY ?? 1,
    rotation: e.rotation ?? 0,
  };
}


async function commitTransform(it: CanvasItem, transform: SourceTransform) {
  localTransform.value = { ...localTransform.value, [it.sceneItemId]: transform };
  if (props.editMode) {
    emit("stage", it, { transform });
    return;
  }
  try {
    await fetch(`${API}/obs/${props.channel}/source/transform`, {
      method: "POST",
      headers: { ...props.authHeaders, "Content-Type": "application/json" },
      body: JSON.stringify({ scene: props.sceneName, sceneItemId: it.sceneItemId, transform }),
    });
  } catch { }
}
function toggleVisible(it: CanvasItem) {
  const target = !effective(it).sceneItemEnabled;
  if (props.editMode) {
    emit("stage", it, { visible: target });
    return;
  }
  fetch(`${API}/obs/${props.channel}/source/visibility`, {
    method: "POST",
    headers: { ...props.authHeaders, "Content-Type": "application/json" },
    body: JSON.stringify({ scene: props.sceneName, sceneItemId: it.sceneItemId, enabled: target }),
  }).catch(() => { });
}

// vvv drag-to-move vvv
const dragState = ref<{
  id: number;
  startMouseX: number;
  startMouseY: number;
  startX: number;
  startY: number;
} | null>(null);

function onItemMouseDown(it: CanvasItem, e: MouseEvent) {
  if ((e.target as HTMLElement).closest(".canvas-handle")) return; // <<< handles own their own drag
  // >>> selection only happens via the sidebar now - clicking a box on the canvas
  // >>> does nothing unless it's already the selected one, in which case it drags
  if (it.sceneItemId !== props.selectedId) return;
  e.preventDefault();
  e.stopPropagation();
  const eff = effective(it);
  dragState.value = {
    id: it.sceneItemId,
    startMouseX: e.clientX,
    startMouseY: e.clientY,
    startX: eff.positionX ?? 0,
    startY: eff.positionY ?? 0,
  };
  window.addEventListener("mousemove", onDragMove);
  window.addEventListener("mouseup", onDragEnd);
}
// >>> live drag preview, kept in a local overlay rather than mutating the fetched
// >>> item (which would get clobbered by the next poll/effective() merge)
const dragPreview = ref<{ id: number; x: number; y: number } | null>(null);
function onDragMove(e: MouseEvent) {
  const d = dragState.value;
  if (!d) return;
  const s = scale() || 1;
  dragPreview.value = {
    id: d.id,
    x: d.startX + (e.clientX - d.startMouseX) / s,
    y: d.startY + (e.clientY - d.startMouseY) / s,
  };
}
function onDragEnd() {
  window.removeEventListener("mousemove", onDragMove);
  window.removeEventListener("mouseup", onDragEnd);
  const d = dragState.value;
  dragState.value = null;
  const preview = dragPreview.value;
  dragPreview.value = null;
  if (!d || !preview) return;
  const it = items.value.find((i) => i.sceneItemId === d.id);
  if (!it) return;

  const original = { ...it };
  const transform = { ...currentTransform(original), positionX: preview.x, positionY: preview.y };

  it.positionX = preview.x;
  it.positionY = preview.y;
  commitTransform(original, transform);
}
// ^^^ drag-to-move ^^^

// vvv corner resize vvv
type Corner = "tl" | "tr" | "bl" | "br";
const resizeState = ref<{
  id: number;
  corner: Corner;
  anchorX: number;
  anchorY: number;
} | null>(null);
const resizePreview = ref<{ id: number; x: number; y: number; w: number; h: number } | null>(null);

function onHandleMouseDown(it: CanvasItem, corner: Corner, e: MouseEvent) {
  e.preventDefault();
  e.stopPropagation();
  select(it.sceneItemId);
  const eff = effective(it);
  const x = eff.positionX ?? 0;
  const y = eff.positionY ?? 0;
  const w = eff.width ?? 0;
  const h = eff.height ?? 0;
  const anchor =
    corner === "tl"
      ? { x: x + w, y: y + h }
      : corner === "tr"
        ? { x, y: y + h }
        : corner === "bl"
          ? { x: x + w, y }
          : { x, y };
  resizeState.value = { id: it.sceneItemId, corner, anchorX: anchor.x, anchorY: anchor.y };
  window.addEventListener("mousemove", onResizeMove);
  window.addEventListener("mouseup", onResizeEnd);
}
function onResizeMove(e: MouseEvent) {
  const r = resizeState.value;
  if (!r) return;
  const s = scale() || 1;
  const stageEl = stageRef.value;
  if (!stageEl) return;
  const rect = stageEl.getBoundingClientRect();
  const mouseX = (e.clientX - rect.left) / s;
  const mouseY = (e.clientY - rect.top) / s;

  const MIN = 10; // <<< canvas units, don't let it invert/collapse
  let newX: number, newY: number, newW: number, newH: number;
  if (r.corner === "tl") {
    newW = Math.max(MIN, r.anchorX - mouseX);
    newH = Math.max(MIN, r.anchorY - mouseY);
    newX = r.anchorX - newW;
    newY = r.anchorY - newH;
  } else if (r.corner === "tr") {
    newW = Math.max(MIN, mouseX - r.anchorX);
    newH = Math.max(MIN, r.anchorY - mouseY);
    newX = r.anchorX;
    newY = r.anchorY - newH;
  } else if (r.corner === "bl") {
    newW = Math.max(MIN, r.anchorX - mouseX);
    newH = Math.max(MIN, mouseY - r.anchorY);
    newX = r.anchorX - newW;
    newY = r.anchorY;
  } else {
    newW = Math.max(MIN, mouseX - r.anchorX);
    newH = Math.max(MIN, mouseY - r.anchorY);
    newX = r.anchorX;
    newY = r.anchorY;
  }
  resizePreview.value = { id: r.id, x: newX, y: newY, w: newW, h: newH };
}
function onResizeEnd() {
  window.removeEventListener("mousemove", onResizeMove);
  window.removeEventListener("mouseup", onResizeEnd);
  const r = resizeState.value;
  resizeState.value = null;
  const preview = resizePreview.value;
  resizePreview.value = null;
  if (!r || !preview) return;
  const it = items.value.find((i) => i.sceneItemId === r.id);
  if (!it || !it.sourceWidth || !it.sourceHeight) return;
  const scaleX = preview.w / it.sourceWidth;
  const scaleY = preview.h / it.sourceHeight;
  // >>> snapshot BEFORE mutating, same reason as onDragEnd
  const original = { ...it };
  const transform = {
    ...currentTransform(original),
    positionX: preview.x,
    positionY: preview.y,
    scaleX,
    scaleY,
  };

  it.positionX = preview.x;
  it.positionY = preview.y;
  it.width = preview.w;
  it.height = preview.h;
  it.scaleX = scaleX;
  it.scaleY = scaleY;
  commitTransform(original, transform);
}
// ^^^ corner resize ^^^

// >>> drag/resize preview overrides effective() while actively dragging
function displayStyle(it: CanvasItem) {
  const s = scale();
  if (dragPreview.value?.id === it.sceneItemId) {
    const e = effective(it);
    return {
      left: `${dragPreview.value.x * s}px`,
      top: `${dragPreview.value.y * s}px`,
      width: `${(e.width ?? 0) * s}px`,
      height: `${(e.height ?? 0) * s}px`,
      transform: e.rotation ? `rotate(${e.rotation}deg)` : undefined,
    };
  }
  if (resizePreview.value?.id === it.sceneItemId) {
    const p = resizePreview.value;
    return {
      left: `${p.x * s}px`,
      top: `${p.y * s}px`,
      width: `${p.w * s}px`,
      height: `${p.h * s}px`,
    };
  }
  return itemStyle(it);
}

function onStageClick(e: MouseEvent) {
  if (e.target === stageRef.value) select(null);
}
</script>

<template>
  <Teleport to="body">
    <div class="canvas-overlay">
      <div class="canvas-modal">
        <div class="canvas-topbar">
          <div class="canvas-topbar-title">{{ sceneName }}</div>
          <div class="canvas-topbar-actions">
            <button class="canvas-close-btn" title="Close (Esc)" @click="emit('close')"
              v-html="iconSvgFor('x')"></button>
          </div>
        </div>

        <div class="canvas-content">
          <div class="canvas-body">
            <div v-if="loading" class="canvas-loading">loading…</div>
            <div v-else-if="!placeableItems.length" class="canvas-loading">
              No browser sources in this scene yet.<br />
              <span class="canvas-loading-hint">
                Only browser sources can be laid out here - other source types (webcam,
                capture, etc.) can still be shown/hidden from the sidebar. If browser
                sources you added aren't showing up, your OBS agent may need updating
                (re-download it and restart it) to support the layout editor.
              </span>
            </div>
            <div v-else ref="stageRef" class="canvas-stage" :style="{ aspectRatio: `${baseWidth} / ${baseHeight}` }"
              @mousedown="onStageClick">
              <div v-for="it in placeableItems" :key="it.sceneItemId" class="canvas-item" :class="{
                selected: it.sceneItemId === selectedId,
                hidden_: !effective(it).sceneItemEnabled,
              }" :style="displayStyle(it)" @mousedown="onItemMouseDown(it, $event)">
                <span class="canvas-item-label">{{ it.sourceName }}</span>
                <template v-if="it.sceneItemId === selectedId">
                  <span class="canvas-handle tl" @mousedown="onHandleMouseDown(it, 'tl', $event)"></span>
                  <span class="canvas-handle tr" @mousedown="onHandleMouseDown(it, 'tr', $event)"></span>
                  <span class="canvas-handle bl" @mousedown="onHandleMouseDown(it, 'bl', $event)"></span>
                  <span class="canvas-handle br" @mousedown="onHandleMouseDown(it, 'br', $event)"></span>
                </template>
              </div>
            </div>
          </div>

          <div class="canvas-sidebar">
            <div class="canvas-sidebar-title">sources</div>
            <div class="canvas-sidebar-list">
              <div v-for="it in items" :key="it.sceneItemId" class="canvas-sidebar-row"
                :class="{ selected: it.sceneItemId === selectedId }" @click="select(it.sceneItemId)">
                <span class="canvas-sidebar-name">{{ it.sourceName }}</span>
                <button class="canvas-sidebar-vis" :class="{ on: effective(it).sceneItemEnabled }"
                  @click.stop="toggleVisible(it)">
                  {{ effective(it).sceneItemEnabled ? "visible" : "hidden" }}
                </button>
              </div>
              <div v-if="!items.length && !loading" class="canvas-sidebar-empty">no sources</div>
            </div>
          </div>
        </div>
      </div>
    </div>
  </Teleport>
</template>

<style scoped>
.canvas-overlay {
  position: fixed;
  inset: 0;
  z-index: 2000;
  background: rgba(0, 0, 0, 0.85);
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 24px;
}

.canvas-modal {
  width: 100%;
  max-width: 1400px;
  height: 100%;
  max-height: 900px;
  background: #0a0a0d;
  border: 1px solid #2a2a30;
  display: flex;
  flex-direction: column;
}

.canvas-topbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 12px 16px;
  flex-shrink: 0;
  border-bottom: 1px solid #1e1e22;
}

.canvas-topbar-title {
  color: #e0e0e0;
  font-weight: 700;
  font-size: 14px;
}

.canvas-topbar-actions {
  display: flex;
  align-items: center;
  gap: 8px;
}

.canvas-close-btn {
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

.canvas-close-btn:hover {
  color: #f14949;
  border-color: #f1494966;
}

.canvas-content {
  flex: 1;
  display: flex;
  min-height: 0;
}

.canvas-body {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 16px;
  min-width: 0;
  min-height: 0;
}

.canvas-loading {
  color: #555;
  font-size: 13px;
  text-align: center;
  padding: 20px;
}

.canvas-loading-hint {
  display: inline-block;
  margin-top: 8px;
  font-size: 11px;
  color: #444;
  max-width: 420px;
}


.canvas-stage {
  position: relative;
  width: 100%;
  max-height: 100%;
  max-width: 100%;
  background: #fff;
  overflow: hidden;
  border: 1px solid #2a2a30;
  user-select: none;
}

.canvas-item {
  position: absolute;
  border: 1px solid #6f2bff;
  background: rgba(111, 43, 255, 0.12);
  cursor: move;
  transform-origin: 0 0;
  z-index: 3;
}

.canvas-item.hidden_ {
  border-style: dashed;
  background: rgba(0, 0, 0, 0.05);
  opacity: 0.6;
}

.canvas-item.selected {
  border: 2px solid #f14949;
  background: rgba(241, 73, 73, 0.1);
}

.canvas-item-label {
  position: absolute;
  top: -18px;
  left: -1px;
  font-size: 10px;
  color: #fff;
  background: #6f2bff;
  padding: 1px 5px;
  white-space: nowrap;
  pointer-events: none;
}

.canvas-handle {
  position: absolute;
  width: 10px;
  height: 10px;
  background: #f14949;
  border: 1px solid #fff;
  z-index: 2;
}

.canvas-handle.tl {
  top: -5px;
  left: -5px;
  cursor: nwse-resize;
}

.canvas-handle.tr {
  top: -5px;
  right: -5px;
  cursor: nesw-resize;
}

.canvas-handle.bl {
  bottom: -5px;
  left: -5px;
  cursor: nesw-resize;
}

.canvas-handle.br {
  bottom: -5px;
  right: -5px;
  cursor: nwse-resize;
}


.canvas-sidebar {
  width: 220px;
  flex-shrink: 0;
  border-left: 1px solid #1e1e22;
  display: flex;
  flex-direction: column;
  min-height: 0;
}

.canvas-sidebar-title {
  padding: 10px 12px;
  font-size: 10px;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  color: #555;
  border-bottom: 1px solid #1e1e22;
  flex-shrink: 0;
}

.canvas-sidebar-list {
  flex: 1;
  overflow-y: auto;
}

.canvas-sidebar-row {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 8px 12px;
  border-bottom: 1px solid #1a1a1e;
  cursor: pointer;
}

.canvas-sidebar-row:hover {
  background: #111217;
}

.canvas-sidebar-row.selected {
  border-left: 2px solid #f14949;
  background: #f1494911;
}

.canvas-sidebar-name {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 12px;
  color: #ccc;
}

.canvas-sidebar-vis {
  height: 22px;
  padding: 0 8px;
  border: 1px solid #2a2a30;
  background: #111217;
  color: #666;
  font-family: inherit;
  font-size: 10px;
  cursor: pointer;
  flex-shrink: 0;
}

.canvas-sidebar-vis.on {
  border-color: #6f2bff66;
  color: #9d6cff;
}

.canvas-sidebar-empty {
  padding: 16px 12px;
  color: #444;
  font-size: 11px;
}
</style>
