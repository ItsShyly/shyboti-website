<script setup lang="ts">
import { ref } from "vue";
import { iconSvg as iconSvgFor } from "../../composables/icons";
import type { OverlayElementType, ShapeVariant } from "../../composables/overlay/overlayTypes";

const emit = defineEmits<{
  add: [type: OverlayElementType, variant?: ShapeVariant];
}>();

const entries: { type: OverlayElementType; variant?: ShapeVariant; label: string; icon: string }[] = [
  { type: "text", label: "Text", icon: "file-text" },
  { type: "variable-text", label: "Variable", icon: "refresh-cw" },
  { type: "image", label: "Image", icon: "image" },
  { type: "video", label: "Video", icon: "film" },
  { type: "countdown", label: "Countdown", icon: "clock" },
  { type: "countup", label: "Countup", icon: "arrow-up" },
  { type: "shape", variant: "border", label: "Border", icon: "maximize" },
  { type: "shape", variant: "background-box", label: "Background box", icon: "monitor" },
  { type: "shape", variant: "frame", label: "Frame", icon: "maximize" },
];

const helpOpen = ref(false);

// >>> mouse icon with the referenced button filled in the site's accent purple - built by
// >>> hand like RESET_ZOOM_ICON in ObsOverlayCanvasStage.vue, doesn't fit the shared 24x24
// >>> stroke icon set. No <clipPath>/ids - this gets injected via v-html potentially several
// >>> times on the same page, and duplicate SVG ids across instances can misrender.
const MOUSE_PURPLE = "#9d6cff";
const MOUSE_GRAY = "#666";
function mouseIcon(button: "left" | "right" | "middle"): string {
  const leftFill = button === "left" ? MOUSE_PURPLE : "none";
  const rightFill = button === "right" ? MOUSE_PURPLE : "none";
  const wheelFill = button === "middle" ? MOUSE_PURPLE : MOUSE_GRAY;
  return `<svg viewBox="0 0 24 34" width="1em" height="1.4em" fill="none" stroke="${MOUSE_GRAY}" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">
    <rect x="5" y="3" width="6.5" height="9.5" fill="${leftFill}" stroke="none" />
    <rect x="12.5" y="3" width="6.5" height="9.5" fill="${rightFill}" stroke="none" />
    <rect x="4" y="2" width="16" height="30" rx="8" />
    <line x1="12" y1="3" x2="12" y2="13" />
    <line x1="4" y1="13" x2="20" y2="13" />
    <rect x="11" y="5" width="2" height="6" rx="1" fill="${wheelFill}" stroke="none" />
  </svg>`;
}
const MOUSE_LEFT = mouseIcon("left");
const MOUSE_RIGHT = mouseIcon("right");
const MOUSE_MIDDLE = mouseIcon("middle");

// >>> each row's key column is built from parts - {k} renders as a bracket/keycap chip,
// >>> {svg} renders a raw icon (e.g. a mouse-button symbol), {t} is plain connecting text
interface KeyPart { k?: string; svg?: string; t?: string }
interface Shortcut { parts: KeyPart[]; desc: string }
const shortcuts: Shortcut[] = [
  { parts: [{ k: "Ctrl" }, { t: "+" }, { k: "S" }], desc: "Save" },
  { parts: [{ k: "Ctrl" }, { t: "+" }, { k: "Z" }], desc: "Undo" },
  { parts: [{ k: "Ctrl" }, { t: "+" }, { k: "Shift" }, { t: "+" }, { k: "Z" }], desc: "Redo" },
  {
    parts: [{ k: "Ctrl" }, { t: "+" }, { k: "C" }, { t: "/" }, { k: "Ctrl" }, { t: "+" }, { k: "V" }],
    desc: "Copy / paste selected or clipboard",
  },
  { parts: [{ k: "Ctrl" }, { t: "+" }, { k: "D" }], desc: "Duplicate selected" },
  { parts: [{ k: "Delete" }, { t: "/" }, { k: "Backspace" }], desc: "Delete selected" },
  { parts: [{ k: "Escape" }], desc: "Close the editor" },
  {
    parts: [{ k: "Shift" }, { t: "+" }, { svg: MOUSE_LEFT }, { t: "/" }, { k: "Ctrl" }, { t: "+" }, { svg: MOUSE_LEFT }],
    desc: "Add/remove from selection",
  },
  {
    parts: [{ svg: MOUSE_LEFT }, { t: " + drag in canvas" }],
    desc: "multi-select elements",
  },
  {
    parts: [{ svg: MOUSE_RIGHT }, { t: " on an element" }],
    desc: "Context menu",
  },
  {
    parts: [{ k: "Ctrl" }, { t: "/" }, { k: "Alt" }, { t: "while resizing" }],
    desc: "Also scale font-size with the box",
  },
  { parts: [{ k: "Alt" }, { t: "+ dragging" }], desc: "Temporarily disable snapping" },
  { parts: [{ k: "Mouse wheel" }, { t: " over canvas" }], desc: "Zoom in/out" },
  {
    parts: [{ k: "Ctrl" }, { t: "+" }, { k: "+" }, { t: "/" }, { k: "Ctrl" }, { t: "+" }, { k: "-" }],
    desc: "Zoom in/out",
  },
  {
    parts: [{ svg: MOUSE_RIGHT }, { t: "/" }, { svg: MOUSE_MIDDLE }, { t: " drag" }],
    desc: "Pan the canvas when zoomed in",
  },
  {
    parts: [{ k: "1" }, { t: "/" }, { k: "2" }, { t: "/" }, { k: "3" }, { t: "/" }, { k: "4" }],
    desc: "Switch canvas backdrop (checker/white/black/scene screenshot)",
  },
];
</script>

<template>
  <div class="ovl-gallery">
    <div class="ovl-gallery-title">add</div>
    <button v-for="entry in entries" :key="entry.label" class="ovl-gallery-item"
      @click="emit('add', entry.type, entry.variant)">
      <span class="ovl-gallery-icon" v-html="iconSvgFor(entry.icon)"></span>
      {{ entry.label }}
    </button>

    <button class="ovl-gallery-item ovl-gallery-help" @click="helpOpen = true">
      <span class="ovl-gallery-icon" v-html="iconSvgFor('info')"></span>
      Shortcuts
    </button>
  </div>

  <Teleport to="body">
    <div v-if="helpOpen" class="ovl-help-backdrop" @mousedown.self="helpOpen = false">
      <div class="ovl-help-modal">
        <div class="ovl-help-header">
          <div class="ovl-help-title">keyboard &amp; mouse shortcuts</div>
          <button class="ovl-help-close" @click="helpOpen = false" v-html="iconSvgFor('x')"></button>
        </div>
        <div class="ovl-help-list">
          <div v-for="s in shortcuts" :key="s.desc" class="ovl-help-row">
            <span class="ovl-help-key">
              <template v-for="(p, pi) in s.parts" :key="pi">
                <span v-if="p.k" class="ovl-key-chip">{{ p.k }}</span>
                <span v-else-if="p.svg" class="ovl-key-icon" v-html="p.svg"></span>
                <span v-else class="ovl-key-text">{{ p.t }}</span>
              </template>
            </span>
            <span class="ovl-help-desc">{{ s.desc }}</span>
          </div>
        </div>
      </div>
    </div>
  </Teleport>
</template>

<style scoped>
.ovl-gallery {
  width: 160px;
  flex-shrink: 0;
  border-right: 1px solid #1e1e22;
  display: flex;
  flex-direction: column;
  padding: 4px;
  overflow-y: auto;
  scrollbar-width: none;
}

.ovl-gallery::-webkit-scrollbar {
  display: none;
}

.ovl-gallery-title {
  padding: 8px 8px 6px;
  font-size: 10px;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  color: #555;
}

.ovl-gallery-item {
  display: flex;
  align-items: center;
  gap: 8px;
  height: 34px;
  padding: 0 8px;
  border: none;
  background: transparent;
  color: #ccc;
  font-family: inherit;
  font-size: 12px;
  text-align: left;
  cursor: pointer;
  width: 100%;
}

.ovl-gallery-item:hover {
  background: #111217;
  color: #9d6cff;
}

.ovl-gallery-icon {
  display: inline-flex;
  flex-shrink: 0;
  color: #6f2bff;
}

.ovl-gallery-help {
  margin-top: auto;
  border-top: 1px solid #1e1e22;
  color: #888;
}

.ovl-help-backdrop {
  position: fixed;
  inset: 0;
  z-index: 4000;
  background: rgba(0, 0, 0, 0.6);
  display: flex;
  align-items: center;
  justify-content: center;
}

.ovl-help-modal {
  width: 480px;
  max-width: 90vw;
  max-height: 80vh;
  display: flex;
  flex-direction: column;
  background: #141418;
  border: 1px solid #2a2a30;
  box-shadow: 0 12px 48px rgba(0, 0, 0, 0.6);
}

.ovl-help-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 14px 16px;
  border-bottom: 1px solid #1e1e22;
}

.ovl-help-title {
  font-size: 12px;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  color: #9d6cff;
}

.ovl-help-close {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 24px;
  height: 24px;
  border: none;
  background: transparent;
  color: #888;
  cursor: pointer;
}

.ovl-help-close:hover {
  color: #e0e0e0;
}

.ovl-help-list {
  overflow-y: auto;
  padding: 8px 16px 16px;
  scrollbar-width: none;
}

.ovl-help-list::-webkit-scrollbar {
  display: none;
}

.ovl-help-row {
  display: flex;
  align-items: baseline;
  gap: 12px;
  padding: 8px 0;
  border-bottom: 1px solid #1a1a1e;
}

.ovl-help-row:last-child {
  border-bottom: none;
}

.ovl-help-key {
  flex-shrink: 0;
  width: 190px;
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 3px;
}

.ovl-key-chip {
  display: inline-flex;
  align-items: center;
  padding: 2px 6px;
  font-size: 10px;
  color: #e0e0e0;
  font-family: "Consolas", "Fira Mono", monospace;
  background: #1c1c22;
  border: 1px solid #2e2e36;
  border-bottom: 2px solid #333340;
  border-radius: 4px;
  box-shadow: 0 1px 0 rgba(0, 0, 0, 0.4);
}

.ovl-key-icon {
  display: inline-flex;
  align-items: center;
  flex-shrink: 0;
}

.ovl-key-icon svg {
  width: 15px;
  height: auto;
}

.ovl-key-text {
  font-size: 11px;
  color: #666;
  white-space: pre;
}

.ovl-help-desc {
  font-size: 12px;
  color: #888;
}
</style>
