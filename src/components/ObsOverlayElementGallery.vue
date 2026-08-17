<script setup lang="ts">
import { iconSvg as iconSvgFor } from "../composables/icons";
import type { OverlayElementType } from "../composables/overlayTypes";

defineEmits<{
  add: [type: OverlayElementType];
}>();

const entries: { type: OverlayElementType; label: string; icon: string }[] = [
  { type: "text", label: "Text", icon: "file-text" },
  { type: "variable-text", label: "Variable", icon: "refresh-cw" },
  { type: "image", label: "Image", icon: "image" },
];
</script>

<template>
  <div class="ovl-gallery">
    <div class="ovl-gallery-title">add</div>
    <button v-for="entry in entries" :key="entry.type" class="ovl-gallery-item" @click="$emit('add', entry.type)">
      <span class="ovl-gallery-icon" v-html="iconSvgFor(entry.icon)"></span>
      {{ entry.label }}
    </button>
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
</style>
