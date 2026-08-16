<script setup lang="ts">
// >>> fullscreen scene editor: drag-move + corner-resize scene items on a to-scale
// >>> canvas, with an optional "dim everything except the selected source" spotlight

import { ref, computed, onMounted, onUnmounted } from "vue";
import { API } from "../api";
import { iconSvg as iconSvgFor } from "../composables/icons";

const props = defineProps<{
  channel: string;
  sceneName: string;
  authHeaders: Record<string, string>;
}>();
const emit = defineEmits<{ close: [] }>();

interface CanvasItem {
  sceneItemId: number;
  sourceName: string;
  sceneItemEnabled: boolean;
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
const screenshot = ref<string | null>(null);
const selectedId = ref<number | null>(null);
const dimMode = ref(false);
const loading = ref(true);
const stageRef = ref<HTMLElement | null>(null);

const selectedItem = computed(() =>
  items.value.find((i) => i.sceneItemId === selectedId.value) ?? null,
);

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
      // >>> only items OBS actually gave us a transform for can be placed on the canvas
      items.value = (d.sources ?? []).filter((s) => s.width != null && s.height != null);
    }
  } catch { }
  loading.value = false;
}

async function loadScreenshot() {
  try {
    const res = await fetch(
      `${API}/obs/${props.channel}/screenshot?scene=${encodeURIComponent(props.sceneName)}&width=1280`,
      { headers: props.authHeaders },
    );
    if (res.ok) {
      const d = (await res.json()) as { imageData: string | null };
      if (d.imageData) screenshot.value = `data:image/jpeg;base64,${d.imageData}`;
    }
  } catch { }
}

let pollTimer: ReturnType<typeof setInterval> | null = null;
onMounted(() => {
  load();
  loadScreenshot();
  pollTimer = setInterval(() => {
    if (!dragState.value && !resizeState.value) load();
    loadScreenshot();
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
  const s = scale();
  return {
    left: `${(it.positionX ?? 0) * s}px`,
    top: `${(it.positionY ?? 0) * s}px`,
    width: `${(it.width ?? 0) * s}px`,
    height: `${(it.height ?? 0) * s}px`,
    transform: it.rotation ? `rotate(${it.rotation}deg)` : undefined,
  };
}

async function pushTransform(it: CanvasItem) {
  try {
    await fetch(`${API}/obs/${props.channel}/source/transform`, {
      method: "POST",
      headers: { ...props.authHeaders, "Content-Type": "application/json" },
      body: JSON.stringify({
        scene: props.sceneName,
        sceneItemId: it.sceneItemId,
        transform: {
          positionX: it.positionX,
          positionY: it.positionY,
          scaleX: it.scaleX,
          scaleY: it.scaleY,
          rotation: it.rotation ?? 0,
        },
      }),
    });
  } catch { }
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
  e.preventDefault();
  e.stopPropagation();
  selectedId.value = it.sceneItemId;
  dragState.value = {
    id: it.sceneItemId,
    startMouseX: e.clientX,
    startMouseY: e.clientY,
    startX: it.positionX ?? 0,
    startY: it.positionY ?? 0,
  };
  window.addEventListener("mousemove", onDragMove);
  window.addEventListener("mouseup", onDragEnd);
}
function onDragMove(e: MouseEvent) {
  const d = dragState.value;
  if (!d) return;
  const s = scale() || 1;
  const it = items.value.find((i) => i.sceneItemId === d.id);
  if (!it) return;
  it.positionX = d.startX + (e.clientX - d.startMouseX) / s;
  it.positionY = d.startY + (e.clientY - d.startMouseY) / s;
}
function onDragEnd() {
  window.removeEventListener("mousemove", onDragMove);
  window.removeEventListener("mouseup", onDragEnd);
  const d = dragState.value;
  dragState.value = null;
  if (!d) return;
  const it = items.value.find((i) => i.sceneItemId === d.id);
  if (it) pushTransform(it);
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

function onHandleMouseDown(it: CanvasItem, corner: Corner, e: MouseEvent) {
  e.preventDefault();
  e.stopPropagation();
  selectedId.value = it.sceneItemId;
  const x = it.positionX ?? 0;
  const y = it.positionY ?? 0;
  const w = it.width ?? 0;
  const h = it.height ?? 0;
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
  const it = items.value.find((i) => i.sceneItemId === r.id);
  if (!it || !it.sourceWidth || !it.sourceHeight) return;
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
  it.positionX = newX;
  it.positionY = newY;
  it.width = newW;
  it.height = newH;
  it.scaleX = newW / it.sourceWidth;
  it.scaleY = newH / it.sourceHeight;
}
function onResizeEnd() {
  window.removeEventListener("mousemove", onResizeMove);
  window.removeEventListener("mouseup", onResizeEnd);
  const r = resizeState.value;
  resizeState.value = null;
  if (!r) return;
  const it = items.value.find((i) => i.sceneItemId === r.id);
  if (it) pushTransform(it);
}
// ^^^ corner resize ^^^

function onStageClick(e: MouseEvent) {
  if (e.target === stageRef.value) selectedId.value = null;
}

// >>> spotlight strips around the selected item, in on-screen px
const spotlightRects = computed(() => {
  const it = selectedItem.value;
  const s = scale();
  if (!it || !dimMode.value) return null;
  const left = (it.positionX ?? 0) * s;
  const top = (it.positionY ?? 0) * s;
  const w = (it.width ?? 0) * s;
  const h = (it.height ?? 0) * s;
  return { left, top, w, h };
});
</script>

<template>
  <Teleport to="body">
    <div class="canvas-overlay">
      <div class="canvas-topbar">
        <div class="canvas-topbar-title">{{ sceneName }}</div>
        <div class="canvas-topbar-actions">
          <button class="canvas-dim-btn" :class="{ active: dimMode }" :disabled="!selectedItem"
            title="Dim everything except the selected source" @click="dimMode = !dimMode">
            <span v-html="iconSvgFor('sun')"></span> spotlight
          </button>
          <button class="canvas-close-btn" title="Close (Esc)" @click="emit('close')" v-html="iconSvgFor('x')"></button>
        </div>
      </div>

      <div class="canvas-body">
        <div v-if="loading" class="canvas-loading">loading…</div>
        <div v-else ref="stageRef" class="canvas-stage" :style="{ aspectRatio: `${baseWidth} / ${baseHeight}` }"
          @mousedown="onStageClick">
          <img v-if="screenshot" :src="screenshot" alt="" class="canvas-backdrop" />

          <div v-for="it in items" :key="it.sceneItemId" class="canvas-item"
            :class="{ selected: it.sceneItemId === selectedId, hidden_: !it.sceneItemEnabled }"
            :style="itemStyle(it)" @mousedown="onItemMouseDown(it, $event)">
            <span class="canvas-item-label">{{ it.sourceName }}</span>
            <template v-if="it.sceneItemId === selectedId">
              <span class="canvas-handle tl" @mousedown="onHandleMouseDown(it, 'tl', $event)"></span>
              <span class="canvas-handle tr" @mousedown="onHandleMouseDown(it, 'tr', $event)"></span>
              <span class="canvas-handle bl" @mousedown="onHandleMouseDown(it, 'bl', $event)"></span>
              <span class="canvas-handle br" @mousedown="onHandleMouseDown(it, 'br', $event)"></span>
            </template>
          </div>

          <template v-if="spotlightRects">
            <div class="canvas-spotlight" :style="{ left: 0, top: 0, right: 0, height: spotlightRects.top + 'px' }">
            </div>
            <div class="canvas-spotlight" :style="{
              left: 0,
              top: spotlightRects.top + spotlightRects.h + 'px',
              right: 0,
              bottom: 0,
            }"></div>
            <div class="canvas-spotlight" :style="{
              left: 0,
              top: spotlightRects.top + 'px',
              width: spotlightRects.left + 'px',
              height: spotlightRects.h + 'px',
            }"></div>
            <div class="canvas-spotlight" :style="{
              left: spotlightRects.left + spotlightRects.w + 'px',
              top: spotlightRects.top + 'px',
              right: 0,
              height: spotlightRects.h + 'px',
            }"></div>
          </template>
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
  flex-direction: column;
}

.canvas-topbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 12px 16px;
  flex-shrink: 0;
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

.canvas-dim-btn {
  display: flex;
  align-items: center;
  gap: 6px;
  height: 30px;
  padding: 0 12px;
  border: 1px solid #2a2a30;
  background: #111217;
  color: #888;
  font-family: inherit;
  font-size: 11px;
  cursor: pointer;
}
.canvas-dim-btn:disabled {
  opacity: 0.35;
  cursor: not-allowed;
}
.canvas-dim-btn.active {
  border-color: #e5c07b;
  color: #e5c07b;
  background: #e5c07b15;
}
.canvas-dim-btn svg {
  width: 12px;
  height: 12px;
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

.canvas-body {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 12px 24px 24px;
  min-height: 0;
}

.canvas-loading {
  color: #555;
  font-size: 13px;
}

.canvas-stage {
  position: relative;
  max-width: 100%;
  max-height: 100%;
  width: min(100%, calc((100vh - 90px) * 16 / 9));
  background: #000;
  overflow: hidden;
  border: 1px solid #2a2a30;
  user-select: none;
}

.canvas-backdrop {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  object-fit: cover;
  pointer-events: none;
  opacity: 0.9;
}

.canvas-item {
  position: absolute;
  border: 1px dashed rgba(157, 108, 255, 0.6);
  cursor: move;
  transform-origin: 0 0;
}
.canvas-item.hidden_ {
  border-style: dotted;
  opacity: 0.5;
}
.canvas-item.selected {
  border: 2px solid #f14949;
}
.canvas-item-label {
  position: absolute;
  top: -18px;
  left: -1px;
  font-size: 10px;
  color: #e0e0e0;
  background: #000000cc;
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

.canvas-spotlight {
  position: absolute;
  background: rgba(255, 255, 255, 0.8);
  pointer-events: none;
}
</style>
