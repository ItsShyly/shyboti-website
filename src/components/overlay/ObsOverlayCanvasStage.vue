<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted, nextTick } from "vue";
import { iconSvg as iconSvgFor } from "../../composables/icons";
import type { OverlayElement } from "../../composables/overlay/overlayTypes";
import {
  computeCountdown,
  countdownDisplayText,
  formatDuration,
  parseDuration,
  setCurrentSeconds,
  toggleRunningData,
  type CountdownLikeType,
} from "../../composables/overlay/overlayCountdown";

// >>> custom corner-brackets icon (100x100, filled) - doesn't fit the shared 24x24 stroke
// >>> icon set's wrapper, so it's kept local instead of forced into icons.ts
const RESET_ZOOM_ICON = `<svg viewBox="0 0 100 100" width="1em" height="1em" fill="currentColor">
  <path d="M 10,25 H 25 V 10 H 40 V 40 H 10 Z" />
  <path d="M 60,10 H 75 V 25 H 90 V 40 H 60 Z" />
  <path d="M 10,60 H 40 V 90 H 25 V 75 H 10 Z" />
  <path d="M 60,60 H 90 V 75 H 75 V 90 H 60 Z" />
</svg>`;

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
  "select-many": [ids: string[], additive: boolean];
  "update-element": [id: string, patch: Partial<OverlayElement>];
  "update-elements": [updates: Array<{ id: string; patch: Partial<OverlayElement> }>];
  "delete-element": [id: string];
  "delete-selected": [];
  "duplicate-element": [id: string];
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
const GRID = 20; // <<< canvas units - coarse, lowest-priority snap source
const SNAP_PX = 6; // <<< screen-px proximity for real guides (elements + canvas) - a light
// <<< magnet you can drag out of, not a lock, per Photoshop/Figma's smart-guide feel
const GRID_SNAP_PX = 4; // <<< tighter than SNAP_PX - grid never outcompetes a real guide

// >>> layout (unzoomed) scale - offsetWidth ignores the zoom CSS transform, since children
// >>> are positioned in the stage's own local space and get magnified by that transform too
function scale(): number {
  const el = stageRef.value;
  if (!el || !props.baseWidth) return 1;
  return el.offsetWidth / props.baseWidth;
}
// >>> true on-screen px-per-canvas-unit, for converting real mouse coordinates
function effScale(): number {
  return scale() * zoomLevel.value;
}

// vvv zoom & pan vvv
const viewportRef = ref<HTMLElement | null>(null);
const zoomLevel = ref(1);
const panX = ref(0);
const panY = ref(0);
const ZOOM_MIN = 1;
const ZOOM_MAX = 6;
const zoomStyle = computed(() => ({
  transform: `translate(${panX.value}px, ${panY.value}px) scale(${zoomLevel.value})`,
  transformOrigin: "center center",
}));
function clampPan(v: number, axis: "x" | "y"): number {
  const el = stageRef.value;
  const vp = viewportRef.value;
  if (!el || !vp) return v;
  const natural = axis === "x" ? el.offsetWidth : el.offsetHeight;
  const vpSize = axis === "x" ? vp.clientWidth : vp.clientHeight;
  const max = Math.max(0, (natural * zoomLevel.value - vpSize) / 2);
  return Math.max(-max, Math.min(max, v));
}
function setZoom(z: number) {
  zoomLevel.value = Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, z));
  if (zoomLevel.value <= 1) {
    zoomLevel.value = 1;
    panX.value = 0;
    panY.value = 0;
  } else {
    panX.value = clampPan(panX.value, "x");
    panY.value = clampPan(panY.value, "y");
  }
}
function resetZoom() {
  zoomLevel.value = 1;
  panX.value = 0;
  panY.value = 0;
}
function onWheel(e: WheelEvent) {
  e.preventDefault();
  setZoom(zoomLevel.value * (e.deltaY < 0 ? 1.15 : 1 / 1.15));
}
function onZoomKeydown(e: KeyboardEvent) {
  if (!(e.ctrlKey || e.metaKey)) return;
  if (e.key === "+" || e.key === "=") {
    e.preventDefault();
    setZoom(zoomLevel.value * 1.25);
  } else if (e.key === "-" || e.key === "_") {
    e.preventDefault();
    setZoom(zoomLevel.value / 1.25);
  }
}
onMounted(() => window.addEventListener("keydown", onZoomKeydown));
onUnmounted(() => window.removeEventListener("keydown", onZoomKeydown));

// vvv pan-drag - right or middle button only; left click is reserved for marquee-select vvv
const panState = ref<{
  startX: number;
  startY: number;
  startPanX: number;
  startPanY: number;
} | null>(null);
function onStageMouseDown(e: MouseEvent) {
  if (e.target !== stageRef.value) return; // items own their own mousedown (they stopPropagation)
  if (e.button === 0) {
    startMarquee(e);
    return;
  }
  if (e.button === 1) e.preventDefault(); // stop middle-click autoscroll
  panState.value = {
    startX: e.clientX,
    startY: e.clientY,
    startPanX: panX.value,
    startPanY: panY.value,
  };
  window.addEventListener("mousemove", onPanMove);
  window.addEventListener("mouseup", onPanEnd);
}
function onPanMove(e: MouseEvent) {
  const p = panState.value;
  if (!p) return;
  const dx = e.clientX - p.startX;
  const dy = e.clientY - p.startY;
  panX.value = clampPan(p.startPanX + dx, "x");
  panY.value = clampPan(p.startPanY + dy, "y");
}
function onPanEnd() {
  window.removeEventListener("mousemove", onPanMove);
  window.removeEventListener("mouseup", onPanEnd);
  panState.value = null;
}
// ^^^ pan-drag ^^^

// vvv left-click drag on empty canvas - marquee/rectangle multiselect vvv
const marqueeState = ref<{ startX: number; startY: number; additive: boolean } | null>(null);
const marqueeCurrent = ref<{ x: number; y: number } | null>(null);
function stageCanvasPoint(e: MouseEvent): { x: number; y: number } | null {
  const stageEl = stageRef.value;
  if (!stageEl) return null;
  const rect = stageEl.getBoundingClientRect();
  const s = effScale() || 1;
  return { x: (e.clientX - rect.left) / s, y: (e.clientY - rect.top) / s };
}
function startMarquee(e: MouseEvent) {
  const p = stageCanvasPoint(e);
  if (!p) return;
  marqueeState.value = { startX: p.x, startY: p.y, additive: e.shiftKey || e.ctrlKey || e.metaKey };
  marqueeCurrent.value = p;
  window.addEventListener("mousemove", onMarqueeMove);
  window.addEventListener("mouseup", onMarqueeEnd);
}
function onMarqueeMove(e: MouseEvent) {
  if (!marqueeState.value) return;
  marqueeCurrent.value = stageCanvasPoint(e);
}
function onMarqueeEnd() {
  window.removeEventListener("mousemove", onMarqueeMove);
  window.removeEventListener("mouseup", onMarqueeEnd);
  const m = marqueeState.value;
  const cur = marqueeCurrent.value;
  marqueeState.value = null;
  marqueeCurrent.value = null;
  if (!m || !cur) return;

  const x1 = Math.min(m.startX, cur.x);
  const x2 = Math.max(m.startX, cur.x);
  const y1 = Math.min(m.startY, cur.y);
  const y2 = Math.max(m.startY, cur.y);
  // >>> too small to be a drag - treat like a plain click (deselect, unless additive)
  if (x2 - x1 < 3 && y2 - y1 < 3) {
    if (!m.additive) select(null, false);
    return;
  }
  const hitIds = props.elements
    .filter((el) => el.visible && el.x < x2 && el.x + el.w > x1 && el.y < y2 && el.y + el.h > y1)
    .map((el) => el.id);
  if (!hitIds.length) {
    if (!m.additive) select(null, false);
    return;
  }
  emit("select-many", hitIds, m.additive);
}
const marqueeStyle = computed(() => {
  const m = marqueeState.value;
  const cur = marqueeCurrent.value;
  if (!m || !cur) return null;
  const s = scale() || 1;
  const x1 = Math.min(m.startX, cur.x);
  const x2 = Math.max(m.startX, cur.x);
  const y1 = Math.min(m.startY, cur.y);
  const y2 = Math.max(m.startY, cur.y);
  return {
    left: `${x1 * s}px`,
    top: `${y1 * s}px`,
    width: `${(x2 - x1) * s}px`,
    height: `${(y2 - y1) * s}px`,
  };
});
// ^^^ marquee-select ^^^

// vvv drag the minimap's red rectangle to pan - inverse of minimapViewportStyle's math vvv
const minimapDragState = ref<{ startX: number; startY: number; startPanX: number; startPanY: number } | null>(null);
function onMinimapRectMouseDown(e: MouseEvent) {
  e.preventDefault();
  e.stopPropagation();
  minimapDragState.value = {
    startX: e.clientX,
    startY: e.clientY,
    startPanX: panX.value,
    startPanY: panY.value,
  };
  window.addEventListener("mousemove", onMinimapRectMove);
  window.addEventListener("mouseup", onMinimapRectEnd);
}
function onMinimapRectMove(e: MouseEvent) {
  const d = minimapDragState.value;
  const el = stageRef.value;
  if (!d || !el) return;
  // >>> 1 minimap px represents (naturalWidth*zoom/MINIMAP_W) real content px - drag moves
  // >>> the window that direction, so pan moves the opposite way
  const factor = (el.offsetWidth * zoomLevel.value) / MINIMAP_W;
  panX.value = clampPan(d.startPanX - (e.clientX - d.startX) * factor, "x");
  panY.value = clampPan(d.startPanY - (e.clientY - d.startY) * factor, "y");
}
function onMinimapRectEnd() {
  window.removeEventListener("mousemove", onMinimapRectMove);
  window.removeEventListener("mouseup", onMinimapRectEnd);
  minimapDragState.value = null;
}
// ^^^ minimap rect drag ^^^

// vvv minimap - only shown while zoomed, shows the full canvas + a red viewport rectangle vvv
const MINIMAP_W = 160;
const minimapInnerStyle = computed(() => ({
  width: `${MINIMAP_W}px`,
  height: `${(MINIMAP_W * props.baseHeight) / (props.baseWidth || 1)}px`,
}));
function minimapElStyle(el: OverlayElement) {
  const s = MINIMAP_W / (props.baseWidth || 1);
  return {
    left: `${el.x * s}px`,
    top: `${el.y * s}px`,
    width: `${Math.max(1, el.w * s)}px`,
    height: `${Math.max(1, el.h * s)}px`,
  };
}
function minimapViewportStyle() {
  const stageEl = stageRef.value;
  const vp = viewportRef.value;
  if (!stageEl || !vp || !props.baseWidth) return {};
  const stageRect = stageEl.getBoundingClientRect();
  const vpRect = vp.getBoundingClientRect();
  const es = effScale();
  if (!es) return {};
  const left = (vpRect.left - stageRect.left) / es;
  const top = (vpRect.top - stageRect.top) / es;
  const w = vpRect.width / es;
  const h = vpRect.height / es;
  const mmScale = MINIMAP_W / props.baseWidth;
  const clampedLeft = Math.max(0, Math.min(props.baseWidth, left));
  const clampedTop = Math.max(0, Math.min(props.baseHeight, top));
  const clampedW = Math.max(0, Math.min(props.baseWidth - clampedLeft, w - (clampedLeft - left)));
  const clampedH = Math.max(0, Math.min(props.baseHeight - clampedTop, h - (clampedTop - top)));
  return {
    left: `${clampedLeft * mmScale}px`,
    top: `${clampedTop * mmScale}px`,
    width: `${clampedW * mmScale}px`,
    height: `${clampedH * mmScale}px`,
  };
}
// ^^^ minimap ^^^
// ^^^ zoom & pan ^^^

// >>> front of stack (highest z) rendered last, so it's visually on top - matches layers panel.
// >>> hidden elements are skipped entirely here (matches the real OBS output), not just dimmed -
// >>> toggle them back on from the layers panel, which still lists them regardless
const sortedElements = computed(() =>
  [...props.elements].filter((e) => e.visible).sort((a, b) => a.z_index - b.z_index),
);

function select(id: string | null, additive: boolean) {
  emit("select", id, additive);
}

// vvv snapping - Photoshop/Figma-style: every candidate line (other elements' edges+center,
// vvv the canvas's own edges+center, then grid as a last resort) competes on screen-px distance,
// vvv closest one under the threshold wins per axis - not "whichever was checked last" vvv
const snapGuides = ref<{ x: number | null; y: number | null }>({ x: null, y: null });
function closestSnap(
  myPoints: number[],
  targets: number[],
  s: number,
): { my: number; target: number; dist: number } | null {
  let best: { my: number; target: number; dist: number } | null = null;
  for (const my of myPoints) {
    for (const target of targets) {
      const dist = Math.abs(my - target) * s;
      if (dist < SNAP_PX && (!best || dist < best.dist)) best = { my, target, dist };
    }
  }
  return best;
}
function snapValue(raw: { x: number; y: number; w: number; h: number }, selfId: string, disableSnap: boolean) {
  if (disableSnap || props.snapEnabled === false) {
    snapGuides.value = { x: null, y: null };
    return raw;
  }
  let { x, y, w, h } = raw;
  const s = effScale() || 1;

  const others = props.elements.filter((e) => e.id !== selfId && e.visible);
  const targetsX = [0, props.baseWidth / 2, props.baseWidth];
  const targetsY = [0, props.baseHeight / 2, props.baseHeight];
  for (const other of others) {
    targetsX.push(other.x, other.x + other.w / 2, other.x + other.w);
    targetsY.push(other.y, other.y + other.h / 2, other.y + other.h);
  }

  let snappedX: number | null = null;
  let snappedY: number | null = null;

  const bestX = closestSnap([x, x + w / 2, x + w], targetsX, s);
  if (bestX) {
    x += bestX.target - bestX.my;
    snappedX = bestX.target;
  }
  const bestY = closestSnap([y, y + h / 2, y + h], targetsY, s);
  if (bestY) {
    y += bestY.target - bestY.my;
    snappedY = bestY.target;
  }

  // >>> grid is a coarser, lower-priority fallback - only when no real guide matched, and with
  // >>> its own tighter threshold so it never outcompetes an element/canvas guide
  if (snappedX === null) {
    const gridX = Math.round(x / GRID) * GRID;
    if (Math.abs((x - gridX) * s) < GRID_SNAP_PX) {
      x = gridX;
      snappedX = gridX;
    }
  }
  if (snappedY === null) {
    const gridY = Math.round(y / GRID) * GRID;
    if (Math.abs((y - gridY) * s) < GRID_SNAP_PX) {
      y = gridY;
      snappedY = gridY;
    }
  }
  snapGuides.value = { x: snappedX, y: snappedY };
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
  const s = effScale() || 1;
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

// vvv corner resize - single element; hold Ctrl to also scale font-size with the box vvv
type Corner = "tl" | "tr" | "bl" | "br";
function cornerAnchor(box: { x: number; y: number; w: number; h: number }, corner: Corner) {
  return corner === "tl"
    ? { x: box.x + box.w, y: box.y + box.h }
    : corner === "tr"
      ? { x: box.x, y: box.y + box.h }
      : corner === "bl"
        ? { x: box.x + box.w, y: box.y }
        : { x: box.x, y: box.y };
}
function resizeFromAnchor(anchorX: number, anchorY: number, corner: Corner, mouseX: number, mouseY: number) {
  const MIN = 10;
  let x: number, y: number, w: number, h: number;
  if (corner === "tl") {
    w = Math.max(MIN, anchorX - mouseX);
    h = Math.max(MIN, anchorY - mouseY);
    x = anchorX - w;
    y = anchorY - h;
  } else if (corner === "tr") {
    w = Math.max(MIN, mouseX - anchorX);
    h = Math.max(MIN, anchorY - mouseY);
    x = anchorX;
    y = anchorY - h;
  } else if (corner === "bl") {
    w = Math.max(MIN, anchorX - mouseX);
    h = Math.max(MIN, mouseY - anchorY);
    x = anchorX - w;
    y = anchorY;
  } else {
    w = Math.max(MIN, mouseX - anchorX);
    h = Math.max(MIN, mouseY - anchorY);
    x = anchorX;
    y = anchorY;
  }
  return { x, y, w, h };
}
function gridSnapSize(w: number, h: number, s: number, e: MouseEvent): { w: number; h: number } {
  if (props.snapEnabled === false || e.altKey) return { w, h };
  const gridW = Math.round(w / GRID) * GRID;
  if (Math.abs((w - gridW) * s) < GRID_SNAP_PX) w = gridW;
  const gridH = Math.round(h / GRID) * GRID;
  if (Math.abs((h - gridH) * s) < GRID_SNAP_PX) h = gridH;
  return { w, h };
}

const resizeState = ref<{
  id: string;
  corner: Corner;
  anchorX: number;
  anchorY: number;
  startW: number;
  startH: number;
  startFontSize?: number;
} | null>(null);
const resizePreview = ref<{ id: string; x: number; y: number; w: number; h: number; fontSize?: number } | null>(null);

function onHandleMouseDown(el: OverlayElement, corner: Corner, e: MouseEvent) {
  if (el.locked) return;
  e.preventDefault();
  e.stopPropagation();
  const anchor = cornerAnchor(el, corner);
  resizeState.value = {
    id: el.id,
    corner,
    anchorX: anchor.x,
    anchorY: anchor.y,
    startW: el.w,
    startH: el.h,
    startFontSize: el.style.fontSize,
  };
  window.addEventListener("mousemove", onResizeMove);
  window.addEventListener("mouseup", onResizeEnd);
}
function onResizeMove(e: MouseEvent) {
  const r = resizeState.value;
  const stageEl = stageRef.value;
  if (!r || !stageEl) return;
  const s = effScale() || 1;
  const rect = stageEl.getBoundingClientRect();
  const mouseX = (e.clientX - rect.left) / s;
  const mouseY = (e.clientY - rect.top) / s;

  let { x: newX, y: newY, w: newW, h: newH } = resizeFromAnchor(r.anchorX, r.anchorY, r.corner, mouseX, mouseY);
  ({ w: newW, h: newH } = gridSnapSize(newW, newH, s, e));

  const preview: typeof resizePreview.value = { id: r.id, x: newX, y: newY, w: newW, h: newH };
  if ((e.ctrlKey || e.metaKey || e.altKey) && r.startFontSize) {
    preview.fontSize = Math.max(4, Math.round(r.startFontSize * ((newW / r.startW + newH / r.startH) / 2)));
  }
  resizePreview.value = preview;

  const patch: Partial<OverlayElement> = { x: newX, y: newY, w: newW, h: newH };
  if (preview.fontSize !== undefined) {
    const el = props.elements.find((e2) => e2.id === r.id);
    patch.style = { ...(el?.style ?? {}), fontSize: preview.fontSize };
  }
  emitLivePreview([{ id: r.id, patch }]);
}
function onResizeEnd() {
  window.removeEventListener("mousemove", onResizeMove);
  window.removeEventListener("mouseup", onResizeEnd);
  const r = resizeState.value;
  resizeState.value = null;
  const preview = resizePreview.value;
  resizePreview.value = null;
  if (!r || !preview) return;
  const patch: Partial<OverlayElement> = { x: preview.x, y: preview.y, w: preview.w, h: preview.h };
  if (preview.fontSize !== undefined) {
    const el = props.elements.find((e) => e.id === r.id);
    patch.style = { ...(el?.style ?? {}), fontSize: preview.fontSize };
  }
  emit("update-element", r.id, patch);
}
// ^^^ corner resize ^^^

// vvv group resize (2+ selected) - one bounding-box transform, every member's x/y/w/h scales
// vvv relative to that box so relative spacing/position (e.g. text inside a background) holds.
// vvv same Ctrl-to-scale-font-size rule as single-element resize vvv
interface GroupResizeMember {
  id: string;
  x: number;
  y: number;
  w: number;
  h: number;
  fontSize?: number;
}
const selectionBounds = computed(() => {
  if (props.selectedIds.length < 2) return null;
  const sel = props.elements.filter((e) => props.selectedIds.includes(e.id));
  if (!sel.length) return null;
  const x1 = Math.min(...sel.map((e) => e.x));
  const y1 = Math.min(...sel.map((e) => e.y));
  const x2 = Math.max(...sel.map((e) => e.x + e.w));
  const y2 = Math.max(...sel.map((e) => e.y + e.h));
  return { x: x1, y: y1, w: x2 - x1, h: y2 - y1 };
});
const groupResizeState = ref<{
  corner: Corner;
  anchorX: number;
  anchorY: number;
  startBox: { x: number; y: number; w: number; h: number };
  members: GroupResizeMember[];
} | null>(null);
const groupResizePreview = ref<Record<string, { x: number; y: number; w: number; h: number; fontSize?: number }>>({});
const groupResizeLiveBox = ref<{ x: number; y: number; w: number; h: number } | null>(null);

function onGroupHandleMouseDown(corner: Corner, e: MouseEvent) {
  const box = selectionBounds.value;
  if (!box) return;
  const members = props.elements.filter((el) => props.selectedIds.includes(el.id) && !el.locked);
  if (!members.length) return;
  e.preventDefault();
  e.stopPropagation();
  const anchor = cornerAnchor(box, corner);
  groupResizeState.value = {
    corner,
    anchorX: anchor.x,
    anchorY: anchor.y,
    startBox: { ...box },
    members: members.map((el) => ({ id: el.id, x: el.x, y: el.y, w: el.w, h: el.h, fontSize: el.style.fontSize })),
  };
  window.addEventListener("mousemove", onGroupResizeMove);
  window.addEventListener("mouseup", onGroupResizeEnd);
}
function onGroupResizeMove(e: MouseEvent) {
  const r = groupResizeState.value;
  const stageEl = stageRef.value;
  if (!r || !stageEl) return;
  const s = effScale() || 1;
  const rect = stageEl.getBoundingClientRect();
  const mouseX = (e.clientX - rect.left) / s;
  const mouseY = (e.clientY - rect.top) / s;

  let { x: boxX, y: boxY, w: boxW, h: boxH } = resizeFromAnchor(r.anchorX, r.anchorY, r.corner, mouseX, mouseY);
  ({ w: boxW, h: boxH } = gridSnapSize(boxW, boxH, s, e));
  groupResizeLiveBox.value = { x: boxX, y: boxY, w: boxW, h: boxH };

  const sx = boxW / r.startBox.w;
  const sy = boxH / r.startBox.h;
  const scaleFont = e.ctrlKey || e.metaKey || e.altKey;
  const preview: Record<string, { x: number; y: number; w: number; h: number; fontSize?: number }> = {};
  for (const m of r.members) {
    const entry: { x: number; y: number; w: number; h: number; fontSize?: number } = {
      x: boxX + (m.x - r.startBox.x) * sx,
      y: boxY + (m.y - r.startBox.y) * sy,
      w: Math.max(4, m.w * sx),
      h: Math.max(4, m.h * sy),
    };
    if (scaleFont && m.fontSize) entry.fontSize = Math.max(4, Math.round(m.fontSize * ((sx + sy) / 2)));
    preview[m.id] = entry;
  }
  groupResizePreview.value = preview;
  emitLivePreview(
    Object.entries(preview).map(([id, p]) => {
      const patch: Partial<OverlayElement> = { x: p.x, y: p.y, w: p.w, h: p.h };
      if (p.fontSize !== undefined) {
        const el = props.elements.find((e2) => e2.id === id);
        patch.style = { ...(el?.style ?? {}), fontSize: p.fontSize };
      }
      return { id, patch };
    }),
  );
}
function onGroupResizeEnd() {
  window.removeEventListener("mousemove", onGroupResizeMove);
  window.removeEventListener("mouseup", onGroupResizeEnd);
  const preview = groupResizePreview.value;
  groupResizeState.value = null;
  groupResizePreview.value = {};
  groupResizeLiveBox.value = null;
  const updates = Object.entries(preview).map(([id, p]) => {
    const patch: Partial<OverlayElement> = { x: p.x, y: p.y, w: p.w, h: p.h };
    if (p.fontSize !== undefined) {
      const el = props.elements.find((e2) => e2.id === id);
      patch.style = { ...(el?.style ?? {}), fontSize: p.fontSize };
    }
    return { id, patch };
  });
  if (updates.length) emit("update-elements", updates);
}
const groupBoxStyle = computed(() => {
  const box = groupResizeLiveBox.value || selectionBounds.value;
  if (!box) return {};
  const s = scale();
  return { left: `${box.x * s}px`, top: `${box.y * s}px`, width: `${box.w * s}px`, height: `${box.h * s}px` };
});
// ^^^ group resize ^^^

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
  const s = effScale() || 1;
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
  // >>> Ctrl-held resize (single or group) live-scales font-size - read from whichever
  // >>> preview is active so the text visibly grows with the box during the drag
  const liveFontSize =
    resizePreview.value?.id === el.id && resizePreview.value.fontSize !== undefined
      ? resizePreview.value.fontSize
      : (groupResizePreview.value[el.id]?.fontSize ?? el.style.fontSize);
  return {
    fontFamily: el.style.fontFamily || "inherit",
    fontSize: (liveFontSize || 32) * s + "px",
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

// vvv countdown/countup - ticks locally in the editor for preview, no server round-trip needed
// vvv since it's pure math off accumulated/running state; the live render page ticks itself too vvv
const countdownTick = ref(0);
let countdownTimer: ReturnType<typeof setInterval> | null = null;
onMounted(() => (countdownTimer = setInterval(() => countdownTick.value++, 1000)));
onUnmounted(() => {
  if (countdownTimer) clearInterval(countdownTimer);
});
function isCountdownLike(type: string): type is CountdownLikeType {
  return type === "countdown" || type === "countup";
}
function countdownCanvasText(el: OverlayElement): string {
  countdownTick.value; // <<< reactive dependency - re-renders this cell every tick
  if (countdownEditId.value === el.id) return countdownEditDraft.value; // <<< frozen while editing
  return countdownDisplayText(el.type as CountdownLikeType, el.data || {});
}

// vvv double-click a countdown/countup to type in a new current value directly - the clock
// vvv keeps running underneath, only the DISPLAYED value freezes until commit vvv
const countdownEditId = ref<string | null>(null);
const countdownEditDraft = ref("");
function startCountdownEdit(el: OverlayElement) {
  if (el.locked) return;
  countdownEditId.value = el.id;
  const { seconds } = computeCountdown(el.type as CountdownLikeType, el.data || {});
  countdownEditDraft.value = formatDuration(seconds);
  nextTick(() => {
    const node = stageRef.value?.querySelector(`[data-cd-edit-id="${el.id}"]`) as HTMLElement | null;
    if (!node) return;
    node.textContent = countdownEditDraft.value;
    node.focus();
    // >>> select the whole prefilled value (not collapsed at the end) - it's a time field,
    // >>> so typing should replace it outright, not append onto the old digits
    const range = document.createRange();
    range.selectNodeContents(node);
    const sel = window.getSelection();
    sel?.removeAllRanges();
    sel?.addRange(range);
  });
}
function commitCountdownEdit(el: OverlayElement) {
  if (countdownEditId.value !== el.id) return;
  const node = stageRef.value?.querySelector(`[data-cd-edit-id="${el.id}"]`) as HTMLElement | null;
  const text = node?.textContent ?? countdownEditDraft.value;
  countdownEditId.value = null;
  const seconds = parseDuration(text);
  if (seconds !== null) {
    emit("update-element", el.id, {
      data: setCurrentSeconds(el.type as CountdownLikeType, el.data || {}, seconds),
    });
  }
}
// ^^^ double-click edit ^^^
// ^^^ countdown/countup ^^^

function displayStyle(el: OverlayElement) {
  const s = scale();
  const rotation = rotatePreview.value?.id === el.id ? rotatePreview.value.rotation : el.rotation;
  const opacity = el.style.opacity !== undefined ? Math.max(0, Math.min(100, el.style.opacity)) / 100 : undefined;
  const dp = dragPreview.value[el.id];
  if (dp) {
    return {
      left: `${dp.x * s}px`,
      top: `${dp.y * s}px`,
      width: `${el.w * s}px`,
      height: `${el.h * s}px`,
      transform: rotation ? `rotate(${rotation}deg)` : undefined,
      opacity,
    };
  }
  if (resizePreview.value?.id === el.id) {
    const p = resizePreview.value;
    return {
      left: `${p.x * s}px`,
      top: `${p.y * s}px`,
      width: `${p.w * s}px`,
      height: `${p.h * s}px`,
      opacity,
    };
  }
  const gp = groupResizePreview.value[el.id];
  if (gp) {
    return {
      left: `${gp.x * s}px`,
      top: `${gp.y * s}px`,
      width: `${gp.w * s}px`,
      height: `${gp.h * s}px`,
      transform: rotation ? `rotate(${rotation}deg)` : undefined,
      opacity,
    };
  }
  return {
    left: `${el.x * s}px`,
    top: `${el.y * s}px`,
    width: `${el.w * s}px`,
    height: `${el.h * s}px`,
    transform: rotation ? `rotate(${rotation}deg)` : undefined,
    opacity,
  };
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
  const cm = contextMenu.value;
  contextMenu.value = null;
  if (!cm) return;
  // >>> right-clicking a member of an existing multi-selection deletes the whole selection,
  // >>> not just the one under the cursor
  if (props.selectedIds.length > 1 && props.selectedIds.includes(cm.id)) emit("delete-selected");
  else emit("delete-element", cm.id);
}
function ctxDuplicate() {
  if (contextMenu.value) emit("duplicate-element", contextMenu.value.id);
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
// >>> applies to the whole multi-selection when the right-clicked element is part of one,
// >>> same rule as ctxDelete/ctxDuplicate
function ctxSetOpacity(v: number) {
  const cm = contextMenu.value;
  if (!cm) return;
  const ids = props.selectedIds.length > 1 && props.selectedIds.includes(cm.id) ? props.selectedIds : [cm.id];
  if (ids.length === 1) {
    const el = props.elements.find((e) => e.id === ids[0]);
    if (el) emit("update-element", el.id, { style: { ...el.style, opacity: v } });
    return;
  }
  emit(
    "update-elements",
    ids
      .map((id) => props.elements.find((e) => e.id === id))
      .filter((e): e is OverlayElement => !!e)
      .map((e) => ({ id: e.id, patch: { style: { ...e.style, opacity: v } } })),
  );
}
// >>> countdown-duration or countup only - target-mode countdown always ticks toward the date
function ctxCanToggleRunning(el: OverlayElement | null): boolean {
  if (!el) return false;
  if (el.type === "countup") return true;
  return el.type === "countdown" && (el.data.mode || "duration") !== "target";
}
function ctxToggleRunning() {
  const el = contextMenuElement.value;
  if (!el) return;
  emit("update-element", el.id, { data: toggleRunningData(el.data || {}) });
}
// >>> lock also applies to the whole multi-selection, same rule as delete/duplicate/opacity
function ctxToggleLock() {
  const cm = contextMenu.value;
  if (!cm) return;
  const el = props.elements.find((e) => e.id === cm.id);
  if (!el) return;
  const newLocked = !el.locked;
  const ids = props.selectedIds.length > 1 && props.selectedIds.includes(cm.id) ? props.selectedIds : [cm.id];
  if (ids.length === 1) {
    emit("update-element", cm.id, { locked: newLocked });
    return;
  }
  emit("update-elements", ids.map((id) => ({ id, patch: { locked: newLocked } })));
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
  <div ref="viewportRef" class="ovl-stage-viewport" @wheel="onWheel">
  <div ref="stageRef" class="ovl-stage" :style="[stageStyle, zoomStyle]" @mousedown="onStageMouseDown"
    @contextmenu.prevent>
    <div v-if="backdrop === 'scene' && sceneShotUrl" class="ovl-scene-backdrop" :style="sceneBackdropStyle"></div>
    <div v-if="guideStyleX" class="ovl-guide ovl-guide-v" :style="guideStyleX"></div>
    <div v-if="guideStyleY" class="ovl-guide ovl-guide-h" :style="guideStyleY"></div>
    <div v-if="marqueeStyle" class="ovl-marquee" :style="marqueeStyle"></div>

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
      <div v-else-if="isCountdownLike(el.type)" class="ovl-item-text" :style="textStyle(el)"
        @dblclick.stop="startCountdownEdit(el)">
        <div v-if="countdownEditId === el.id" class="ovl-item-text-edit" contenteditable="true"
          :data-cd-edit-id="el.id" @mousedown.stop @blur="commitCountdownEdit(el)"
          @keydown.enter.prevent="($event.target as HTMLElement).blur()"></div>
        <span v-else>{{ countdownCanvasText(el) }}</span>
      </div>
      <div v-else class="ovl-item-text" :style="textStyle(el)" @dblclick.stop="startEdit(el)">
        <div v-if="editingId === el.id" class="ovl-item-text-edit" contenteditable="true" :data-edit-id="el.id"
          @mousedown.stop @blur="commitEdit(el)" @input="onTextEditInput(el)"
          @keydown.enter.prevent="($event.target as HTMLElement).blur()"></div>
        <span v-else>{{ displayText(el) }}</span>
      </div>
      <span class="ovl-item-label">{{ el.type }}</span>
      <template v-if="selectedIds.length === 1 && el.id === selectedIds[0] && !el.locked">
        <span class="ovl-handle tl" title="Drag to resize (hold Ctrl or Alt to also scale font-size)"
          @mousedown="onHandleMouseDown(el, 'tl', $event)"></span>
        <span class="ovl-handle tr" title="Drag to resize (hold Ctrl or Alt to also scale font-size)"
          @mousedown="onHandleMouseDown(el, 'tr', $event)"></span>
        <span class="ovl-handle bl" title="Drag to resize (hold Ctrl or Alt to also scale font-size)"
          @mousedown="onHandleMouseDown(el, 'bl', $event)"></span>
        <span class="ovl-handle br" title="Drag to resize (hold Ctrl or Alt to also scale font-size)"
          @mousedown="onHandleMouseDown(el, 'br', $event)"></span>
        <span class="ovl-rotate-handle" title="Drag to rotate (hold Shift for free angle)"
          @mousedown="onRotateMouseDown(el, $event)">
          <span class="ovl-rotate-stem"></span>
          <span class="ovl-rotate-knob"></span>
        </span>
      </template>
    </div>

    <div v-if="selectionBounds" class="ovl-group-box" :style="groupBoxStyle">
      <span class="ovl-handle tl" title="Drag to resize the group (hold Ctrl or Alt to also scale font-size)"
        @mousedown="onGroupHandleMouseDown('tl', $event)"></span>
      <span class="ovl-handle tr" title="Drag to resize the group (hold Ctrl or Alt to also scale font-size)"
        @mousedown="onGroupHandleMouseDown('tr', $event)"></span>
      <span class="ovl-handle bl" title="Drag to resize the group (hold Ctrl or Alt to also scale font-size)"
        @mousedown="onGroupHandleMouseDown('bl', $event)"></span>
      <span class="ovl-handle br" title="Drag to resize the group (hold Ctrl or Alt to also scale font-size)"
        @mousedown="onGroupHandleMouseDown('br', $event)"></span>
    </div>
  </div>

  <!-- sibling of the transformed stage - a transformed ancestor becomes the containing
       block for position:fixed descendants, which would misplace this -->
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
    <template v-if="ctxCanToggleRunning(contextMenuElement)">
      <button @click="ctxToggleRunning">
        {{ contextMenuElement?.data.running !== false ? "Stop" : "Start" }}
      </button>
      <div class="ovl-ctx-sep"></div>
    </template>
    <button @click="ctxToggleLock">{{ contextMenuElement?.locked ? "Unlock" : "Lock" }}</button>
    <div class="ovl-ctx-volume">
      <span>Opac</span>
      <input type="range" min="0" max="100" :value="contextMenuElement?.style.opacity ?? 100"
        @input="ctxSetOpacity(Number(($event.target as HTMLInputElement).value))" />
      <span>{{ contextMenuElement?.style.opacity ?? 100 }}%</span>
    </div>
    <div class="ovl-ctx-sep"></div>
    <button @click="ctxDuplicate">Duplicate</button>
    <button class="danger" @click="ctxDelete">Delete</button>
  </div>

  <div v-if="zoomLevel > 1" class="ovl-minimap">
    <div class="ovl-minimap-inner" :style="minimapInnerStyle">
      <div v-for="el in sortedElements" :key="'mm' + el.id" class="ovl-minimap-el" :style="minimapElStyle(el)"></div>
      <div class="ovl-minimap-viewport" :style="minimapViewportStyle()" @mousedown="onMinimapRectMouseDown"></div>
    </div>
    <button class="ovl-minimap-reset" title="Reset zoom" @click="resetZoom" v-html="RESET_ZOOM_ICON"></button>
  </div>
  </div>
</template>

<style scoped>
.ovl-stage-viewport {
  position: relative;
  width: 100%;
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  overflow: hidden;
}

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

.ovl-marquee {
  position: absolute;
  border: 1px solid #6f2bff;
  background: #6f2bff15;
  z-index: 4;
  pointer-events: none;
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
  background: transparent;
  -webkit-appearance: none;
  height: 4px;
  cursor: pointer;
}

.ovl-ctx-volume input[type="range"]::-webkit-slider-runnable-track {
  background: #2a2a30;
  height: 4px;
  border-radius: 2px;
}

.ovl-ctx-volume input[type="range"]::-webkit-slider-thumb {
  -webkit-appearance: none;
  width: 12px;
  height: 12px;
  border-radius: 50%;
  background: #9d6cff;
  margin-top: -4px;
  cursor: pointer;
}

.ovl-ctx-volume input[type="range"]::-moz-range-track {
  background: #2a2a30;
  height: 4px;
  border-radius: 2px;
}

.ovl-ctx-volume input[type="range"]::-moz-range-thumb {
  width: 12px;
  height: 12px;
  border-radius: 50%;
  background: #9d6cff;
  border: none;
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

.ovl-group-box {
  position: absolute;
  border: 1px dashed #9d6cff;
  pointer-events: none;
  z-index: 2;
}

.ovl-group-box .ovl-handle {
  pointer-events: auto;
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

.ovl-minimap {
  position: absolute;
  right: 10px;
  bottom: 10px;
  display: flex;
  align-items: flex-end;
  gap: 4px;
  z-index: 10;
}

.ovl-minimap-inner {
  position: relative;
  background: #0d0d10cc;
  border: 1px solid #2a2a30;
  box-shadow: 0 4px 16px rgba(0, 0, 0, 0.5);
  overflow: hidden;
}

.ovl-minimap-el {
  position: absolute;
  background: #6f2bff88;
  border: 1px solid #9d6cffaa;
  pointer-events: none;
}

.ovl-minimap-viewport {
  position: absolute;
  border: 1.5px solid #f14949;
  background: #f1494915;
  cursor: grab;
}

.ovl-minimap-viewport:active {
  cursor: grabbing;
}

.ovl-minimap-reset {
  width: 22px;
  height: 22px;
  flex-shrink: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  background: #1a1a1e;
  border: 1px solid #2a2a30;
  color: #ccc;
  cursor: pointer;
}

.ovl-minimap-reset:hover {
  border-color: #6f2bff88;
  color: #9d6cff;
}

.ovl-minimap-reset svg {
  width: 12px;
  height: 12px;
}
</style>
