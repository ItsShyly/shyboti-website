<script setup lang="ts">
// >>> phone-only bottom bar for a multi-selection. "Actions" opens the exact
// same bulk menu (RowContextMenu, rendered as a bottom sheet on mobile) the
// view already builds for desktop right-click - so delete/recolour/access/
// move-to-group etc. are never missing on mobile, just one tap further in.
import { useI18n } from "../../i18n";
import { iconSvg as iconSvgFor } from "../../composables/icons";

defineProps<{ count: number }>();
const emit = defineEmits<{ clear: []; more: [MouseEvent] }>();
const { t } = useI18n();
</script>

<template>
  <div v-if="count" class="sel-bar">
    <span class="sel-bar-count">{{ t("sel.n_selected", { n: count }) }}</span>
    <button type="button" class="sel-bar-more" @click="emit('more', $event)">
      <span v-html="iconSvgFor('more-vertical')"></span>{{ t("sel.actions") }}
    </button>
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
    flex: 1;
  }
  .sel-bar-more {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    height: 40px;
    padding: 0 16px;
    border: 1px solid #6f2bff66;
    background: #6f2bff15;
    color: #c4a0ff;
    font-family: inherit;
    font-size: 13px;
    font-weight: 600;
    cursor: pointer;
  }
  .sel-bar-more :deep(svg) {
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
