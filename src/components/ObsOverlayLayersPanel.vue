<script setup lang="ts">
import { computed } from "vue";
import { iconSvg as iconSvgFor } from "../composables/icons";
import type { OverlayElement } from "../composables/overlayTypes";

const props = defineProps<{
  elements: OverlayElement[];
  selectedIds: string[];
}>();
const emit = defineEmits<{
  select: [id: string, additive: boolean];
  "toggle-lock": [id: string];
  "toggle-visible": [id: string];
  reorder: [id: string, dir: "front" | "back" | "forward" | "backward"];
  group: [];
  ungroup: [];
}>();

// >>> front of stack (highest z) at the top of the list
const sorted = computed(() =>
  [...props.elements].sort((a, b) => b.z_index - a.z_index),
);
const canGroup = computed(() => props.selectedIds.length > 1);
const canUngroup = computed(() =>
  props.selectedIds.some(
    (id) => props.elements.find((e) => e.id === id)?.group_id,
  ),
);

function onRowClick(id: string, e: MouseEvent) {
  emit("select", id, e.shiftKey || e.ctrlKey || e.metaKey);
}
</script>

<template>
  <div class="ovl-layers">
    <div class="ovl-layers-title">
      layers
      <div class="ovl-layers-group-actions">
        <button class="ovl-layers-mini-btn" :disabled="!canGroup" title="Group selection" @click="emit('group')">
          group
        </button>
        <button class="ovl-layers-mini-btn" :disabled="!canUngroup" title="Ungroup" @click="emit('ungroup')">
          ungroup
        </button>
      </div>
    </div>
    <div class="ovl-layers-list">
      <div v-for="el in sorted" :key="el.id" class="ovl-layers-row" :class="{
        selected: selectedIds.includes(el.id),
        grouped: !!el.group_id,
      }" @click="onRowClick(el.id, $event)">
        <button class="ovl-layers-icon-btn" :title="el.visible ? 'Hide' : 'Show'"
          @click.stop="emit('toggle-visible', el.id)" v-html="iconSvgFor(el.visible ? 'eye' : 'eye-off')"></button>
        <button class="ovl-layers-icon-btn" :title="el.locked ? 'Unlock' : 'Lock'"
          @click.stop="emit('toggle-lock', el.id)" v-html="iconSvgFor('lock')"
          :class="{ dim: !el.locked }"></button>
        <span class="ovl-layers-type">{{ el.type }}</span>
        <span class="ovl-layers-content">{{ el.content || '—' }}</span>
        <div class="ovl-layers-z-btns">
          <button class="ovl-layers-icon-btn" title="Forward" @click.stop="emit('reorder', el.id, 'forward')"
            v-html="iconSvgFor('chevron-up')"></button>
          <button class="ovl-layers-icon-btn" title="Backward" @click.stop="emit('reorder', el.id, 'backward')"
            v-html="iconSvgFor('chevron-down')"></button>
        </div>
      </div>
      <div v-if="!sorted.length" class="ovl-layers-empty">no elements yet</div>
    </div>
  </div>
</template>

<style scoped>
.ovl-layers {
  display: flex;
  flex-direction: column;
  min-height: 0;
  border-top: 1px solid #1e1e22;
  padding-top: 8px;
  margin-top: 8px;
}

.ovl-layers-title {
  display: flex;
  align-items: center;
  justify-content: space-between;
  font-size: 10px;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  color: #555;
  margin-bottom: 6px;
}

.ovl-layers-group-actions {
  display: flex;
  gap: 4px;
}

.ovl-layers-mini-btn {
  height: 20px;
  padding: 0 6px;
  border: 1px solid #2a2a30;
  background: transparent;
  color: #666;
  font-family: inherit;
  font-size: 9px;
  text-transform: none;
  letter-spacing: 0;
  cursor: pointer;
}

.ovl-layers-mini-btn:hover:not(:disabled) {
  border-color: #6f2bff66;
  color: #9d6cff;
}

.ovl-layers-mini-btn:disabled {
  opacity: 0.35;
  cursor: not-allowed;
}

.ovl-layers-list {
  max-height: 180px;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 1px;
}

.ovl-layers-row {
  display: flex;
  align-items: center;
  gap: 5px;
  padding: 5px 4px;
  background: #111217;
  border-left: 2px solid transparent;
  cursor: pointer;
}

.ovl-layers-row:hover {
  background: #16161c;
}

.ovl-layers-row.selected {
  border-left-color: #f14949;
  background: #f1494911;
}

.ovl-layers-row.grouped {
  border-left-style: dashed;
}

.ovl-layers-icon-btn {
  width: 18px;
  height: 18px;
  flex-shrink: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  border: none;
  background: transparent;
  color: #888;
  cursor: pointer;
  padding: 0;
}

.ovl-layers-icon-btn svg {
  width: 11px;
  height: 11px;
}

.ovl-layers-icon-btn.dim {
  opacity: 0.3;
}

.ovl-layers-icon-btn:hover {
  color: #9d6cff;
}

.ovl-layers-type {
  font-size: 9px;
  color: #9d6cff;
  text-transform: uppercase;
  flex-shrink: 0;
}

.ovl-layers-content {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 10px;
  color: #666;
}

.ovl-layers-z-btns {
  display: flex;
  flex-direction: column;
  flex-shrink: 0;
}

.ovl-layers-z-btns .ovl-layers-icon-btn {
  height: 9px;
}

.ovl-layers-z-btns svg {
  width: 9px;
  height: 9px;
}

.ovl-layers-empty {
  padding: 10px 4px;
  color: #444;
  font-size: 10px;
}
</style>
