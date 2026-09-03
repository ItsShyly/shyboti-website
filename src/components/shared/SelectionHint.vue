<script setup lang="ts">
// >>> replaces the header count line while rows are selected. no layout shift.
// >>> bulk actions live in the right-click menu; this is just count + clear.
import { useI18n } from "../../i18n";

defineProps<{ count: number }>();
const emit = defineEmits<{ clear: [] }>();
const { t } = useI18n();
</script>

<template>
  <span class="sel-hint">
    <b>{{ t("sel.n_selected", { n: count }) }}</b>
    <span class="sel-hint-more">· {{ t("sel.hint") }}</span>
    <button type="button" class="sel-hint-x" :title="t('confirm.cancel')" @click="emit('clear')">✕</button>
  </span>
</template>

<style scoped>
.sel-hint {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  color: #9d6cff;
}
.sel-hint b {
  font-weight: 600;
}
.sel-hint-more {
  color: #555;
}
.sel-hint-x {
  border: none;
  background: transparent;
  color: #777;
  font-size: 11px;
  cursor: pointer;
  padding: 0 2px;
}
.sel-hint-x:hover {
  color: #e0e0e0;
}
</style>
