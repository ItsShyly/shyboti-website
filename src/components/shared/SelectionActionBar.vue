<script setup lang="ts">
// >>> phone-only bottom action bar for a multi-selection. desktop keeps the
// header sub-line count + the right-click bulk menu. actions reuse the exact
// same ContextMenuItem shape the views already build for that menu.
import { useI18n } from "../../i18n";
import { iconSvg as iconSvgFor } from "../../composables/icons";

export interface BarAction {
  key: string;
  label: string;
  icon?: string;
  danger?: boolean;
  onClick: () => void;
}

defineProps<{ count: number; actions: BarAction[] }>();
const emit = defineEmits<{ clear: [] }>();
const { t } = useI18n();
</script>

<template>
  <div v-if="count" class="sel-bar">
    <span class="sel-bar-count">{{ t("sel.n_selected", { n: count }) }}</span>
    <div class="sel-bar-actions">
      <button v-for="a in actions" :key="a.key" type="button" class="sel-bar-btn" :class="{ danger: a.danger }"
        @click="a.onClick()">
        <span v-if="a.icon" v-html="iconSvgFor(a.icon)"></span>{{ a.label }}
      </button>
    </div>
    <button type="button" class="sel-bar-x" :title="t('confirm.cancel')" @click="emit('clear')">✕</button>
  </div>
</template>

<style scoped>
.sel-bar {
  display: none;
}
@media (max-width: 680px) {
  .sel-bar {
    display: flex;
    align-items: center;
    gap: 10px;
    position: fixed;
    left: 0;
    right: 0;
    bottom: calc(58px + env(safe-area-inset-bottom, 0px));
    z-index: 95;
    background: #1a1a1e;
    border-top: 1px solid #6f2bff55;
    padding: 8px 12px;
  }
  .sel-bar-count {
    font-weight: 700;
    font-size: 13px;
    color: #9d6cff;
    flex-shrink: 0;
  }
  .sel-bar-actions {
    display: flex;
    gap: 8px;
    flex: 1;
    overflow-x: auto;
    scrollbar-width: none;
  }
  .sel-bar-actions::-webkit-scrollbar {
    display: none;
  }
  .sel-bar-btn {
    display: inline-flex;
    align-items: center;
    gap: 5px;
    height: 40px;
    padding: 0 14px;
    white-space: nowrap;
    border: 1px solid #3a3a44;
    background: transparent;
    color: #ddd;
    font-family: inherit;
    font-size: 13px;
    cursor: pointer;
  }
  .sel-bar-btn.danger {
    border-color: #f1494966;
    color: #f14949;
  }
  .sel-bar-btn :deep(svg) {
    width: 15px;
    height: 15px;
  }
  .sel-bar-x {
    width: 40px;
    height: 40px;
    flex-shrink: 0;
    border: none;
    background: transparent;
    color: #888;
    font-size: 16px;
    cursor: pointer;
  }
}
</style>
