<script setup lang="ts">
import { iconSvg as iconSvgFor } from "../composables/icons";
import type { OverlayElementType, ShapeVariant } from "../composables/overlayTypes";

defineProps<{
  templates: string[];
}>();
const emit = defineEmits<{
  add: [type: OverlayElementType, variant?: ShapeVariant];
  "add-template": [name: string];
  "delete-template": [name: string];
}>();

const entries: { type: OverlayElementType; variant?: ShapeVariant; label: string; icon: string }[] = [
  { type: "text", label: "Text", icon: "file-text" },
  { type: "variable-text", label: "Variable", icon: "refresh-cw" },
  { type: "image", label: "Image", icon: "image" },
  { type: "video", label: "Video", icon: "film" },
  { type: "shape", variant: "border", label: "Border", icon: "maximize" },
  { type: "shape", variant: "background-box", label: "Background box", icon: "monitor" },
  { type: "shape", variant: "frame", label: "Frame", icon: "maximize" },
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

    <template v-if="templates.length">
      <div class="ovl-gallery-title">templates</div>
      <div v-for="name in templates" :key="name" class="ovl-gallery-template-row">
        <button class="ovl-gallery-item ovl-gallery-template-btn" @click="emit('add-template', name)">
          <span class="ovl-gallery-icon" v-html="iconSvgFor('copy')"></span>
          {{ name }}
        </button>
        <button class="ovl-gallery-template-del" title="Delete template" @click="emit('delete-template', name)"
          v-html="iconSvgFor('x')"></button>
      </div>
    </template>
  </div>
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

.ovl-gallery-template-row {
  display: flex;
  align-items: center;
}

.ovl-gallery-template-btn {
  flex: 1;
  min-width: 0;
}

.ovl-gallery-template-btn .ovl-gallery-icon {
  color: #4ec9b0;
}

.ovl-gallery-template-del {
  width: 22px;
  height: 34px;
  flex-shrink: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  border: none;
  background: transparent;
  color: #555;
  cursor: pointer;
}

.ovl-gallery-template-del:hover {
  color: #f14949;
}

.ovl-gallery-template-del svg {
  width: 10px;
  height: 10px;
}
</style>
