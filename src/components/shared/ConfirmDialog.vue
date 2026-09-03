<script setup lang="ts">
import { watch } from "vue";
import { useI18n } from "../../i18n";

const props = defineProps<{
  open: boolean;
  title?: string;
  message?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  danger?: boolean;
}>();
const emit = defineEmits<{ confirm: []; cancel: [] }>();
const { t } = useI18n();

function onKey(e: KeyboardEvent) {
  if (!props.open) return;
  if (e.key === "Escape") emit("cancel");
  if (e.key === "Enter") emit("confirm");
}
watch(
  () => props.open,
  (o) => {
    if (o) window.addEventListener("keydown", onKey);
    else window.removeEventListener("keydown", onKey);
  },
);
</script>

<template>
  <Teleport to="body">
    <div v-if="open" class="cd-overlay" @mousedown.self="emit('cancel')">
      <div class="cd-box" role="alertdialog" aria-modal="true">
        <div v-if="title" class="cd-title">{{ title }}</div>
        <div class="cd-msg">{{ message }}</div>
        <div class="cd-actions">
          <button type="button" class="cd-btn cd-cancel" @click="emit('cancel')">
            {{ cancelLabel ?? t("confirm.cancel") }}
          </button>
          <button type="button" class="cd-btn cd-confirm" :class="{ danger }" @click="emit('confirm')">
            {{ confirmLabel ?? t("confirm.ok") }}
          </button>
        </div>
      </div>
    </div>
  </Teleport>
</template>

<style scoped>
.cd-overlay {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.6);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 2000;
}
.cd-box {
  width: 340px;
  max-width: calc(100vw - 32px);
  background: #1a1a1e;
  border: 1px solid #2a2a30;
  padding: 20px;
  box-shadow: 0 12px 48px rgba(0, 0, 0, 0.6);
}
.cd-title {
  font-size: 13px;
  font-weight: 700;
  color: #e0e0e0;
  margin-bottom: 8px;
}
.cd-msg {
  font-size: 12px;
  color: #aaa;
  line-height: 1.6;
}
.cd-actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  margin-top: 18px;
}
.cd-btn {
  height: 32px;
  padding: 0 14px;
  border: 1px solid #333;
  background: transparent;
  color: #888;
  font-family: inherit;
  font-size: 12px;
  cursor: pointer;
}
.cd-cancel:hover {
  border-color: #555;
  color: #e0e0e0;
}
.cd-confirm {
  border-color: #6f2bff66;
  color: #9d6cff;
}
.cd-confirm:hover {
  background: #6f2bff22;
}
.cd-confirm.danger {
  border-color: #f1494966;
  color: #f14949;
}
.cd-confirm.danger:hover {
  background: #f1494915;
}
</style>
