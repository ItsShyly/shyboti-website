<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted, nextTick } from "vue";
import type { OverlayElement } from "../composables/overlayTypes";

const props = defineProps<{
  elements: OverlayElement[];
  selectedIds: string[];
  baseWidth: number;
  baseHeight: number;
  backdrop?: "checker" | "white" | "black" | "scene";
  sceneShotUrl?: string | null;
  previewValues?: Record<string, string>;
  snapEnabled?: boolean;
}>();
const emit = defineEmits<{
  select: [id: string | null, additive: boolean];
  "update-element": [id: string, patch: Partial<OverlayElement>];
  "update-elements": [updates: Array<{ id: string; patch: Partial<OverlayElement> }>];
  "delete-element": [id: string];
  // >>> throttled, fired mid-drag/resize/rotate - live update mode pushes these without
  // >>> touching undo history, so OBS can follow along before the mouse is released
  "live-preview": [updates: Array<{ id: string; patch: Partial<OverlayElement> }>];
}>();

// >>> shared throttle for all three live-preview emitters below
const LIVE_PREVIEW_THROTTLE_MS = 700;
let lastLivePreviewAt = 0;
function emitLivePreview(updates: Array<{ id: string; patch: Partial<OverlayElement> }>) {
  const now = Date.now();
  if (now - lastLivePreviewAt < LIVE_PREVIEW_THROTTLE_MS) return;
  lastLivePreviewAt = now;
  emit("live-preview", updates);
}

const stageRef = ref<HTMLElement | null>(null);
const stageStyle = computed(() => {
  const s: Record<string, string> = { aspectRatio: `${props.baseWidth} / ${props.baseHeight}` };
  if (props.backdrop === "white") s.background = "#ffffff";
  else if (props.backdrop === "black") s.background = "#000000";
  return s;
});
const sceneBackdropStyle = computed(() =>
  props.backdrop === "scene" && props.sceneShotUrl
    ? { backgroundImage: `url(${props.sceneShotUrl})` }
    : {},
);
const GRID = 10; // <<< canvas units
const SNAP_PX = 8; // <<< screen-px proximity to trigger element-edge snap

function scale(): number {
  const el = stageRef.value;
  if (!el || !props.baseWidth) return 1;
  return el.getBoundingClientRect().width / props.baseWidth;
}

// >>> front of stack (highest z) rendered last, so it's visually on top - matches layers panel.
// >>> hidden elements are skipped entirely here (matches the real OBS output), not just dimmed -
// >>> toggle them back on from the layers panel, which still lists them regardless
const sortedElements = computed(() =>
  [...props.elements].filter((e) => e.visible).sort((a, b) => a.z_index - b.z_index),
);

function select(id: string | null, additive: boolean) {
  emit("select", id, additive);
}

// vvv snapping vvv
const snapGuides = ref<{ x: number | null; y: number | null }>({ x: null, y: null });
function snapValue(raw: { x: number; y: number; w: number; h: number }, selfId: string, disableSnap: boolean) {
  if (disableSnap || props.snapEnabled === false) {
    snapGuides.value = { x: null, y: null };
    return raw;
  }
  let { x, y, w, h } = raw;
  const s = scale() || 1;
  let snappedX: number | null = null;
  let snappedY: number | null = null;

  const others = props.elements.filter((e) => e.id !== selfId && e.visible);
  const myEdgesX = [x, x + w / 2, x + w];
  const myEdgesY = [y, y + h / 2, y + h];
  for (const other of others) {
    const oEdgesX = [other.x, other.x + other.w / 2, other.x + other.w];
    const oEdgesY = [other.y, other.y + other.h / 2, other.y + other.h];
    for (const mx of myEdgesX) {
      for (const ox of oEdgesX) {
        if (Math.abs((mx - ox) * s) < SNAP_PX) {
          x += ox - mx;
          snappedX = ox;
        }
      }
    }
    for (const my of myEdgesY) {
      for (const oy of oEdgesY) {
        if (Math.abs((my - oy) * s) < SNAP_PX) {
          y += oy - my;
          snappedY = oy;
        }
      }
    }
  }
  snapGuides.value = { x: snappedX, y: snappedY };
  if (snappedX === null) x = Math.round(x / GRID) * GRID;
  if (snappedY === null) y = Math.round(y / GRID) * GRID;
  return { x, y, w, h };
}
// ^^^ snapping ^^^

// vvv drag-to-move (moves every selected element together) vvv
const dragState = ref<{
  id: string;
  startMouseX: number;
  startMouseY: number;
  origins: Record<string, { x: number; y: number }>;
} | null>(null);
const dragPreview = ref<Record<string, { x: number; y: number }>>({});

function onItemMouseDown(el: OverlayElement, e: MouseEvent) {
  if ((e.target as HTMLElement).closest(".ovl-handle")) return;
  if (editingId.value === el.id) return;
  if (el.locked) return;
  const additive = e.shiftKey || e.ctrlKey || e.metaKey;
  if (!props.selectedIds.includes(el.id) || additive) select(el.id, additive);
  e.preventDefault();
  e.stopPropagation();

  const movingIds = props.selectedIds.includes(el.id) && !additive
    ? props.selectedIds
    : [el.id];
  const origins: Record<string, { x: number; y: number }> = {};
  for (const id of movingIds) {
    const it = props.elements.find((e2) => e2.id === id);
    if (it) origins[id] = { x: it.x, y: it.y };
  }
  dragState.value = { id: el.id, startMouseX: e.clientX, startMouseY: e.clientY, origins };
  window.addEventListener("mousemove", onDragMove);
  window.addEventListener("mouseup", onDragEnd);
}
function onDragMove(e: MouseEvent) {
  const d = dragState.value;
  if (!d) return;
  const s = scale() || 1;
  const dx = (e.clientX - d.startMouseX) / s;
  const dy = (e.clientY - d.startMouseY) / s;
  const primary = props.elements.find((el) => el.id === d.id);
  const primaryOrigin = d.origins[d.id];
  if (!primary || !primaryOrigin) return;

  const snapped = snapValue(
    { x: primaryOrigin.x + dx, y: primaryOrigin.y + dy, w: primary.w, h: primary.h },
    d.id,
    e.altKey,
  );
  const appliedDx = snapped.x - primaryOrigin.x;
  const appliedDy = snapped.y - primaryOrigin.y;

  const preview: Record<string, { x: number; y: number }> = {};
  for (const [id, origin] of Object.entries(d.origins)) {
    preview[id] = { x: origin.x + appliedDx, y: origin.y + appliedDy };
  }
  dragPreview.value = preview;
  emitLivePreview(
    Object.entries(preview).map(([id, pos]) => ({ id, patch: pos })),
  );
}
function onDragEnd() {
  window.removeEventListener("mousemove", onDragMove);
  window.removeEventListener("mouseup", onDragEnd);
  const d = dragState.value;
  dragState.value = null;
  const preview = dragPreview.value;
  dragPreview.value = {};
  snapGuides.value = { x: null, y: null };
  if (!d) return;
  const updates = Object.entries(preview).map(([id, pos]) => ({
    id,
    patch: { x: pos.x, y: pos.y },
  }));
  if (updates.length) emit("update-elements", updates);
}
// ^^^ drag-to-move ^^^

// vvv corner resize (single-selection only) vvv
type Corner = "tl" | "tr" | "bl" | "br";
const resizeState = ref<{
  id: string;
  corner: Corner;
  anchorX: number;
  anchorY: number;
} | null>(null);
const resizePreview = ref<{ id: string; x: number; y: number; w: number; h: number } | null>(null);

function onHandleMouseDown(el: OverlayElement, corner: Corner, e: MouseEvent) {
  if (el.locked) return;
  e.preventDefault();
  e.stopPropagation();
  const anchor =
    corner === "tl"
      ? { x: el.x + el.w, y: el.y + el.h }
      : corner === "tr"
        ? { x: el.x, y: el.y + el.h }
        : corner === "bl"
          ? { x: el.x + el.w, y: el.y }
          : { x: el.x, y: el.y };
  resizeState.value = { id: el.id, corner, anchorX: anchor.x, anchorY: anchor.y };
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

  const MIN = 10;
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
  if (!e.altKey) {
    newW = Math.round(newW / GRID) * GRID;
    newH = Math.round(newH / GRID) * GRID;
  }
  resizePreview.value = { id: r.id, x: newX, y: newY, w: newW, h: newH };
  emitLivePreview([{ id: r.id, patch: { x: newX, y: newY, w: newW, h: newH } }]);
}
function onResizeEnd() {
  window.removeEventListener("mousemove", onResizeMove);
  window.removeEventListener("mouseup", onResizeEnd);
  const r = resizeState.value;
  resizeState.value = null;
  const preview = resizePreview.value;
  resizePreview.value = null;
  if (!r || !preview) return;
  emit("update-element", r.id, { x: preview.x, y: preview.y, w: preview.w, h: preview.h });
}
// ^^^ corner resize ^^^

// vvv rotate handle (photoshop-style) vvv
const rotateState = ref<{ id: string } | null>(null);
const rotatePreview = ref<{ id: string; rotation: number } | null>(null);
function onRotateMouseDown(el: OverlayElement, e: MouseEvent) {
  if (el.locked) return;
  e.preventDefault();
  e.stopPropagation();
  rotateState.value = { id: el.id };
  window.addEventListener("mousemove", onRotateMove);
  window.addEventListener("mouseup", onRotateEnd);
}
function onRotateMove(e: MouseEvent) {
  const r = rotateState.value;
  const stageEl = stageRef.value;
  if (!r || !stageEl) return;
  const el = props.elements.find((x) => x.id === r.id);
  if (!el) return;
  const s = scale() || 1;
  const rect = stageEl.getBoundingClientRect();
  const centerX = rect.left + (el.x + el.w / 2) * s;
  const centerY = rect.top + (el.y + el.h / 2) * s;
  let angle = Math.atan2(e.clientY - centerY, e.clientX - centerX) * (180 / Math.PI) + 90;
  if (!e.shiftKey) angle = Math.round(angle / 15) * 15; // <<< snap to 15deg, hold shift for free rotation
  angle = ((angle % 360) + 360) % 360;
  rotatePreview.value = { id: r.id, rotation: angle };
  emitLivePreview([{ id: r.id, patch: { rotation: angle } }]);
}
function onRotateEnd() {
  window.removeEventListener("mousemove", onRotateMove);
  window.removeEventListener("mouseup", onRotateEnd);
  const r = rotateState.value;
  rotateState.value = null;
  const preview = rotatePreview.value;
  rotatePreview.value = null;
  if (!r || !preview) return;
  emit("update-element", r.id, { rotation: preview.rotation });
}
// ^^^ rotate handle ^^^

// >>> canvas-space px (borders/font/radius) need to shrink with the display scale too,
// >>> or they look proportionally huge next to a box that IS shrunk (mismatched vs real OBS 1:1)
function shapeStyle(el: OverlayElement) {
  const s = scale() || 1;
  return {
    background: el.style.background || "transparent",
    border: el.style.borderWidth
      ? `${el.style.borderWidth * s}px ${el.style.borderStyle || "solid"} ${el.style.borderColor || "#fff"}`
      : "none",
    borderRadius: (el.style.borderRadius || 0) * s + "px",
  };
}
function textStyle(el: OverlayElement) {
  const s = scale() || 1;
  return {
    fontFamily: el.style.fontFamily || "inherit",
    fontSize: (el.style.fontSize || 32) * s + "px",
    letterSpacing: (el.style.letterSpacing || 0) * s + "px",
    color: el.style.color || "#fff",
    textAlign: el.style.textAlign || "left",
    fontWeight: el.style.fontWeight || "normal",
    background: el.style.background || "transparent",
    border: el.style.borderWidth
      ? `${el.style.borderWidth * s}px ${el.style.borderStyle || "solid"} ${el.style.borderColor || "#fff"}`
      : "none",
    borderRadius: (el.style.borderRadius || 0) * s + "px",
    padding: (el.style.padding || 0) * s + "px",
    display: "flex",
    alignItems:
      el.style.verticalAlign === "middle" ? "center" : el.style.verticalAlign === "bottom" ? "flex-end" : "flex-start",
    justifyContent:
      el.style.textAlign === "center" ? "center" : el.style.textAlign === "right" ? "flex-end" : "flex-start",
  };
}

function displayStyle(el: OverlayElement) {
  const s = scale();
  const rotation = rotatePreview.value?.id === el.id ? rotatePreview.value.rotation : el.rotation;
  const dp = dragPreview.value[el.id];
  if (dp) {
    return {
      left: `${dp.x * s}px`,
      top: `${dp.y * s}px`,
      width: `${el.w * s}px`,
      height: `${el.h * s}px`,
      transform: rotation ? `rotate(${rotation}deg)` : undefined,
    };
  }
  if (resizePreview.value?.id === el.id) {
    const p = resizePreview.value;
    return {
      left: `${p.x * s}px`,
      top: `${p.y * s}px`,
      width: `${p.w * s}px`,
      height: `${p.h * s}px`,
    };
  }
  return {
    left: `${el.x * s}px`,
    top: `${el.y * s}px`,
    width: `${el.w * s}px`,
    height: `${el.h * s}px`,
    transform: rotation ? `rotate(${rotation}deg)` : undefined,
  };
}

function onStageClick(e: MouseEvent) {
  if (e.target === stageRef.value) select(null, false);
}

// vvv double-click to edit text content directly on the canvas vvv
const editingId = ref<string | null>(null);
function startEdit(el: OverlayElement) {
  if (el.locked || (el.type !== "text" && el.type !== "variable-text")) return;
  editingId.value = el.id;
  nextTick(() => {
    const node = stageRef.value?.querySelector(
      `[data-edit-id="${el.id}"]`,
    ) as HTMLElement | null;
    if (!node) return;
    node.textContent = el.content;
    node.focus();
    const range = document.createRange();
    range.selectNodeContents(node);
    range.collapse(false);
    const sel = window.getSelection();
    sel?.removeAllRanges();
    sel?.addRange(range);
  });
}
function commitEdit(el: OverlayElement) {
  if (editingId.value !== el.id) return;
  const node = stageRef.value?.querySelector(
    `[data-edit-id="${el.id}"]`,
  ) as HTMLElement | null;
  const text = node?.textContent ?? el.content;
  editingId.value = null;
  if (text !== el.content) emit("update-element", el.id, { content: text });
}
// >>> live update while still typing - throttled push, doesn't touch pendingElements so
// >>> the caret never gets fought by a re-render (only commitEdit does that, on blur)
function onTextEditInput(el: OverlayElement) {
  const node = stageRef.value?.querySelector(
    `[data-edit-id="${el.id}"]`,
  ) as HTMLElement | null;
  if (!node) return;
  emitLivePreview([{ id: el.id, patch: { content: node.textContent ?? "" } }]);
}
function displayText(el: OverlayElement) {
  if (el.type === "variable-text") {
    const resolved = props.previewValues?.[el.id];
    return resolved || el.content || "(empty variable)";
  }
  return el.content || "(empty text)";
}
// ^^^ double-click to edit ^^^

// vvv right-click context menu vvv
const contextMenu = ref<{ x: number; y: number; id: string } | null>(null);
const contextMenuElement = computed(() =>
  contextMenu.value ? props.elements.find((e) => e.id === contextMenu.value!.id) ?? null : null,
);
function onItemContextMenu(el: OverlayElement, e: MouseEvent) {
  e.preventDefault();
  e.stopPropagation();
  if (!props.selectedIds.includes(el.id)) select(el.id, false);
  contextMenu.value = { x: e.clientX, y: e.clientY, id: el.id };
}
function ctxDelete() {
  if (contextMenu.value) emit("delete-element", contextMenu.value.id);
  contextMenu.value = null;
}
// >>> video's own mixer - mute/volume live on the video element itself, no separate audio widget
function ctxToggleMute() {
  const el = contextMenuElement.value;
  if (!el) return;
  emit("update-element", el.id, { data: { ...el.data, muted: el.data.muted === false } });
}
function ctxSetVolume(v: number) {
  const el = contextMenuElement.value;
  if (!el) return;
  emit("update-element", el.id, { data: { ...el.data, volume: v } });
}
function onWindowMousedown(e: MouseEvent) {
  if (!contextMenu.value) return;
  if (!(e.target as HTMLElement).closest(".ovl-ctx-menu")) contextMenu.value = null;
}
// >>> capture phase - item mousedown handlers call stopPropagation(), which would
// >>> otherwise stop this from ever seeing the click and closing the menu
onMounted(() => window.addEventListener("mousedown", onWindowMousedown, true));
onUnmounted(() => window.removeEventListener("mousedown", onWindowMousedown, true));
// ^^^ context menu ^^^

const guideStyleX = computed(() => {
  if (snapGuides.value.x === null) return null;
  return { left: `${snapGuides.value.x * scale()}px` };
});
const guideStyleY = computed(() => {
  if (snapGuides.value.y === null) return null;
  return { top: `${snapGuides.value.y * scale()}px` };
});

defineExpose({ stageRef });
</script>

<template>
  <div ref="stageRef" class="ovl-stage" :style="stageStyle" @mousedown="onStageClick">
    <div v-if="backdrop === 'scene' && sceneShotUrl" class="ovl-scene-backdrop" :style="sceneBackdropStyle"></div>
    <div v-if="guideStyleX" class="ovl-guide ovl-guide-v" :style="guideStyleX"></div>
    <div v-if="guideStyleY" class="ovl-guide ovl-guide-h" :style="guideStyleY"></div>

    <div v-for="el in sortedElements" :key="el.id" class="ovl-item" :class="{
      selected: selectedIds.includes(el.id),
      locked: el.locked,
    }" :style="displayStyle(el)" @mousedown="onItemMouseDown(el, $event)"
      @contextmenu="onItemContextMenu(el, $event)">
      <img v-if="el.type === 'image'" :src="el.content" class="ovl-item-img" draggable="false" />
      <video v-else-if="el.type === 'video'" :src="el.content" class="ovl-item-img" muted></video>
      <div v-else-if="el.type === 'audio'" class="ovl-item-audio">
        {{ el.data.muted !== false ? "🔇" : "🔊" }}
      </div>
      <div v-else-if="el.type === 'shape'" class="ovl-item-shape" :style="shapeStyle(el)"></div>
      <div v-else class="ovl-item-text" :style="textStyle(el)" @dblclick.stop="startEdit(el)">
        <div v-if="editingId === el.id" class="ovl-item-text-edit" contenteditable="true" :data-edit-id="el.id"
          @mousedown.stop @blur="commitEdit(el)" @input="onTextEditInput(el)"
          @keydown.enter.prevent="($event.target as HTMLElement).blur()"></div>
        <span v-else>{{ displayText(el) }}</span>
      </div>
      <span class="ovl-item-label">{{ el.type }}</span>
      <template v-if="selectedIds.length === 1 && el.id === selectedIds[0] && !el.locked">
        <span class="ovl-handle tl" @mousedown="onHandleMouseDown(el, 'tl', $event)"></span>
        <span class="ovl-handle tr" @mousedown="onHandleMouseDown(el, 'tr', $event)"></span>
        <span class="ovl-handle bl" @mousedown="onHandleMouseDown(el, 'bl', $event)"></span>
        <span class="ovl-handle br" @mousedown="onHandleMouseDown(el, 'br', $event)"></span>
        <span class="ovl-rotate-handle" title="Drag to rotate (hold Shift for free angle)"
          @mousedown="onRotateMouseDown(el, $event)">
          <span class="ovl-rotate-stem"></span>
          <span class="ovl-rotate-knob"></span>
        </span>
      </template>
    </div>

    <div v-if="contextMenu" class="ovl-ctx-menu" :style="{ left: contextMenu.x + 'px', top: contextMenu.y + 'px' }"
      @mousedown.stop>
      <template v-if="contextMenuElement?.type === 'video'">
        <button @click="ctxToggleMute">{{ contextMenuElement.data.muted !== false ? "Unmute" : "Mute" }}</button>
        <div class="ovl-ctx-volume">
          <span>Vol</span>
          <input type="range" min="0" max="100" :value="contextMenuElement.data.volume ?? 100"
            @input="ctxSetVolume(Number(($event.target as HTMLInputElement).value))" />
          <span>{{ contextMenuElement.data.volume ?? 100 }}%</span>
        </div>
        <div class="ovl-ctx-sep"></div>
      </template>
      <button class="danger" @click="ctxDelete">Delete</button>
    </div>
  </div>
</template>

<style scoped>
.ovl-stage {
  position: relative;
  width: 100%;
  max-height: 100%;
  max-width: 100%;
  background: repeating-conic-gradient(#1a1a1e 0% 25%, #141418 0% 50%) 50% / 20px 20px;
  overflow: hidden;
  border: 1px solid #2a2a30;
  user-select: none;
}

.ovl-guide {
  position: absolute;
  background: #f14949;
  z-index: 5;
  pointer-events: none;
}

.ovl-guide-v {
  top: 0;
  bottom: 0;
  width: 1px;
}

.ovl-guide-h {
  left: 0;
  right: 0;
  height: 1px;
}

.ovl-scene-backdrop {
  position: absolute;
  inset: 0;
  opacity: 0.5;
  background-size: cover;
  background-position: center;
  pointer-events: none;
}

.ovl-item {
  position: absolute;
  border: 1px solid transparent;
  cursor: move;
  transform-origin: 0 0;
}

.ovl-item.locked {
  cursor: not-allowed;
}

.ovl-item.selected {
  border: 2px solid #f14949;
}

.ovl-item-img {
  width: 100%;
  height: 100%;
  object-fit: contain;
  pointer-events: none;
}

.ovl-item-audio {
  width: 100%;
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(0, 0, 0, 0.5);
  font-size: 20px;
  pointer-events: none;
}

.ovl-item-shape {
  width: 100%;
  height: 100%;
  box-sizing: border-box;
  pointer-events: none;
}

.ovl-item-text {
  width: 100%;
  height: 100%;
  white-space: pre;
  overflow: hidden;
  box-sizing: border-box;
}

.ovl-item-text-edit {
  pointer-events: auto;
  outline: none;
  cursor: text;
  min-width: 4px;
  white-space: pre-wrap;
  word-break: break-word;
}

.ovl-ctx-menu {
  position: fixed;
  z-index: 3000;
  background: #1a1a1e;
  border: 1px solid #2a2a30;
  box-shadow: 0 8px 32px rgba(0, 0, 0, 0.6);
  min-width: 120px;
}

.ovl-ctx-menu button {
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

.ovl-ctx-menu button:hover {
  background: #6f2bff18;
  color: #e0e0e0;
}

.ovl-ctx-menu button.danger {
  color: #f14949;
}

.ovl-ctx-menu button.danger:hover {
  background: #f1494915;
  color: #f14949;
}

.ovl-ctx-sep {
  height: 1px;
  background: #2a2a30;
  margin: 2px 0;
}

.ovl-ctx-volume {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 6px 12px;
  font-size: 11px;
  color: #888;
}

.ovl-ctx-volume input[type="range"] {
  flex: 1;
  accent-color: #6f2bff;
  cursor: pointer;
}

.ovl-item-label {
  position: absolute;
  top: -18px;
  left: -1px;
  font-size: 10px;
  color: #fff;
  background: #6f2bff;
  padding: 1px 5px;
  white-space: nowrap;
  pointer-events: none;
  z-index: 1;
}

.ovl-handle {
  position: absolute;
  width: 10px;
  height: 10px;
  background: #f14949;
  border: 1px solid #fff;
  z-index: 2;
}

.ovl-handle.tl {
  top: -5px;
  left: -5px;
  cursor: nwse-resize;
}

.ovl-handle.tr {
  top: -5px;
  right: -5px;
  cursor: nesw-resize;
}

.ovl-handle.bl {
  bottom: -5px;
  left: -5px;
  cursor: nesw-resize;
}

.ovl-handle.br {
  bottom: -5px;
  right: -5px;
  cursor: nwse-resize;
}

.ovl-rotate-handle {
  position: absolute;
  top: -28px;
  left: 50%;
  transform: translateX(-50%);
  width: 12px;
  height: 24px;
  display: flex;
  flex-direction: column;
  align-items: center;
  cursor: grab;
  z-index: 3;
}

.ovl-rotate-stem {
  width: 1px;
  height: 14px;
  background: #f14949;
}

.ovl-rotate-knob {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: #f14949;
  border: 1px solid #fff;
}
</style>
