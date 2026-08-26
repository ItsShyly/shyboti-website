<script setup lang="ts">
// >>> mobile-only row overflow menu, desktop keeps inline ep-row-actions buttons
import { ref } from "vue";
import { iconSvg as iconSvgFor } from "../../composables/icons";

export interface KebabMenuItem {
  key: string;
  label: string;
  icon?: string;
  onClick: () => void;
  danger?: boolean;
  disabled?: boolean;
}

defineProps<{ items: KebabMenuItem[] }>();
const open = ref(false);

function trigger(item: KebabMenuItem) {
  if (item.disabled) return;
  item.onClick();
  open.value = false;
}
function onBlur() {
  // >>> delay close so tap registers before blur fires
  setTimeout(() => {
    open.value = false;
  }, 150);
}
</script>

<template>
  <div class="ep-kebab">
    <button
      type="button"
      class="ep-kebab-btn"
      title="More actions"
      @click="open = !open"
      @blur="onBlur"
      v-html="iconSvgFor('more-vertical')"
    ></button>
    <div v-if="open" class="ep-kebab-menu">
      <button
        v-for="it in items"
        :key="it.key"
        type="button"
        class="ep-kebab-item"
        :class="{ danger: it.danger, disabled: it.disabled }"
        @mousedown.prevent="trigger(it)"
      >
        <span v-if="it.icon" class="ep-kebab-item-icon" v-html="iconSvgFor(it.icon)"></span>
        {{ it.label }}
      </button>
    </div>
  </div>
</template>

<style scoped>
.ep-kebab {
  position: relative;
  display: none;
}
</style>
