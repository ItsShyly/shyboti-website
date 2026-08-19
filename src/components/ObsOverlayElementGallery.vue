<script setup lang="ts">
import { ref } from "vue";
import { iconSvg as iconSvgFor } from "../composables/icons";
import type { OverlayElementType, ShapeVariant } from "../composables/overlayTypes";

const emit = defineEmits<{
  add: [type: OverlayElementType, variant?: ShapeVariant];
}>();

const entries: { type: OverlayElementType; variant?: ShapeVariant; label: string; icon: string }[] = [
  { type: "text", label: "Text", icon: "file-text" },
  { type: "variable-text", label: "Variable", icon: "refresh-cw" },
  { type: "image", label: "Image", icon: "image" },
  { type: "video", label: "Video", icon: "film" },
  { type: "countdown", label: "Countdown", icon: "clock" },
  { type: "shape", variant: "border", label: "Border", icon: "maximize" },
  { type: "shape", variant: "background-box", label: "Background box", icon: "monitor" },
  { type: "shape", variant: "frame", label: "Frame", icon: "maximize" },
];

const helpOpen = ref(false);
const shortcuts: { keys: string; desc: string }[] = [
  { keys: "Ctrl+S", desc: "Save" },
  { keys: "Ctrl+Z", desc: "Undo" },
  { keys: "Ctrl+Shift+Z", desc: "Redo" },
  { keys: "Ctrl+C / Ctrl+V", desc: "Copy / paste selected" },
  { keys: "Ctrl+D", desc: "Duplicate selected" },
  { keys: "Delete / Backspace", desc: "Delete selected" },
  { keys: "Escape", desc: "Close the editor" },
  { keys: "Click", desc: "Select an element" },
  { keys: "Shift/Ctrl+click", desc: "Add or remove from selection" },
  { keys: "Left-click + drag (empty canvas)", desc: "Marquee-select multiple elements" },
  { keys: "Right-click element", desc: "Context menu - opacity, duplicate, delete, video mute/volume" },
  { keys: "Right-click on multi-selection", desc: "Context menu's Delete/opacity apply to the whole selection" },
  { keys: "Double-click text", desc: "Edit text inline on the canvas" },
  { keys: "Drag corner handle", desc: "Resize (hold Alt to ignore snapping)" },
  { keys: "Ctrl + drag corner handle", desc: "Also scale font-size with the box" },
  { keys: "Select 2+ elements, drag corner", desc: "Group-resize together, keeping relative spacing" },
  { keys: "Drag rotate handle", desc: "Rotate, snaps to 15° (hold Shift for free angle)" },
  { keys: "Alt while dragging/resizing", desc: "Temporarily disable snapping" },
  { keys: "Mouse wheel over canvas", desc: "Zoom in/out" },
  { keys: "Ctrl + / Ctrl -", desc: "Zoom in/out" },
  { keys: "Right-click or middle-click drag", desc: "Pan the canvas when zoomed in" },
  { keys: "Drag the minimap's red rectangle", desc: "Pan by dragging the viewport indicator" },
  { keys: "Countdown format tokens", desc: "{d} {h} {m} {s}, or zero-padded {dd} {hh} {mm} {ss}" },
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
      Help
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
            <span class="ovl-help-key">{{ s.keys }}</span>
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
}

.ovl-help-row {
  display: flex;
  align-items: baseline;
  gap: 12px;
  padding: 7px 0;
  border-bottom: 1px solid #1a1a1e;
}

.ovl-help-row:last-child {
  border-bottom: none;
}

.ovl-help-key {
  flex-shrink: 0;
  width: 190px;
  font-size: 11px;
  color: #ccc;
  font-family: "Consolas", "Fira Mono", monospace;
}

.ovl-help-desc {
  font-size: 12px;
  color: #888;
}
</style>
