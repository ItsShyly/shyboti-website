<script setup lang="ts">
import { ref } from "vue";
import type { OverlayElement } from "../composables/overlayTypes";

const props = defineProps<{
  elements: OverlayElement[];
  selectedId: string | null;
  baseWidth: number;
  baseHeight: number;
}>();
const emit = defineEmits<{
  "update:selectedId": [id: string | null];
  "update-element": [id: string, patch: Partial<OverlayElement>];
}>();

const stageRef = ref<HTMLElement | null>(null);

function scale(): number {
  const el = stageRef.value;
  if (!el || !props.baseWidth) return 1;
  return el.getBoundingClientRect().width / props.baseWidth;
}

function select(id: string | null) {
  emit("update:selectedId", id);
}

// vvv drag-to-move vvv
const dragState = ref<{
  id: string;
  startMouseX: number;
  startMouseY: number;
  startX: number;
  startY: number;
} | null>(null);
const dragPreview = ref<{ id: string; x: number; y: number } | null>(null);

function onItemMouseDown(el: OverlayElement, e: MouseEvent) {
  if ((e.target as HTMLElement).closest(".ovl-handle")) return;
  if (el.locked) return;
  select(el.id);
  e.preventDefault();
  e.stopPropagation();
  dragState.value = {
    id: el.id,
    startMouseX: e.clientX,
    startMouseY: e.clientY,
    startX: el.x,
    startY: el.y,
  };
  window.addEventListener("mousemove", onDragMove);
  window.addEventListener("mouseup", onDragEnd);
}
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
  emit("update-element", d.id, { x: preview.x, y: preview.y });
}
// ^^^ drag-to-move ^^^

// vvv corner resize vvv
type Corner = "tl" | "tr" | "bl" | "br";
const resizeState = ref<{
  id: string;
  corner: Corner;
  anchorX: number;
  anchorY: number;
} | null>(null);
const resizePreview = ref<{
  id: string;
  x: number;
  y: number;
  w: number;
  h: number;
} | null>(null);

function onHandleMouseDown(el: OverlayElement, corner: Corner, e: MouseEvent) {
  if (el.locked) return;
  e.preventDefault();
  e.stopPropagation();
  select(el.id);
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
  emit("update-element", r.id, {
    x: preview.x,
    y: preview.y,
    w: preview.w,
    h: preview.h,
  });
}
// ^^^ corner resize ^^^

function displayStyle(el: OverlayElement) {
  const s = scale();
  if (dragPreview.value?.id === el.id) {
    return {
      left: `${dragPreview.value.x * s}px`,
      top: `${dragPreview.value.y * s}px`,
      width: `${el.w * s}px`,
      height: `${el.h * s}px`,
      transform: el.rotation ? `rotate(${el.rotation}deg)` : undefined,
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
    transform: el.rotation ? `rotate(${el.rotation}deg)` : undefined,
  };
}

function onStageClick(e: MouseEvent) {
  if (e.target === stageRef.value) select(null);
}

defineExpose({ stageRef });
</script>

<template>
  <div ref="stageRef" class="ovl-stage" :style="{ aspectRatio: `${baseWidth} / ${baseHeight}` }"
    @mousedown="onStageClick">
    <div v-for="el in elements" :key="el.id" class="ovl-item" :class="{
      selected: el.id === selectedId,
      hidden_: !el.visible,
      locked: el.locked,
    }" :style="displayStyle(el)" @mousedown="onItemMouseDown(el, $event)">
      <img v-if="el.type === 'image'" :src="el.content" class="ovl-item-img" draggable="false" />
      <div v-else class="ovl-item-text" :style="{
        fontFamily: el.style.fontFamily || 'inherit',
        fontSize: (el.style.fontSize || 32) + 'px',
        color: el.style.color || '#fff',
        textAlign: el.style.textAlign || 'left',
        fontWeight: el.style.fontWeight || 'normal',
      }">
        {{ el.type === 'variable-text' ? (el.content || '(empty variable)') : (el.content || '(empty text)') }}
      </div>
      <span class="ovl-item-label">{{ el.type }}</span>
      <template v-if="el.id === selectedId && !el.locked">
        <span class="ovl-handle tl" @mousedown="onHandleMouseDown(el, 'tl', $event)"></span>
        <span class="ovl-handle tr" @mousedown="onHandleMouseDown(el, 'tr', $event)"></span>
        <span class="ovl-handle bl" @mousedown="onHandleMouseDown(el, 'bl', $event)"></span>
        <span class="ovl-handle br" @mousedown="onHandleMouseDown(el, 'br', $event)"></span>
      </template>
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

.ovl-item {
  position: absolute;
  border: 1px solid rgba(111, 43, 255, 0.5);
  cursor: move;
  transform-origin: 0 0;
  overflow: hidden;
}

.ovl-item.hidden_ {
  border-style: dashed;
  opacity: 0.5;
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

.ovl-item-text {
  width: 100%;
  height: 100%;
  white-space: pre-wrap;
  word-break: break-word;
  overflow: hidden;
  pointer-events: none;
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
</style>
