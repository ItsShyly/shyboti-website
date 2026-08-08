<script setup lang="ts">
// Click-to-rename header used by every script editor panel (custom commands,
// triggers, timers, countdowns, OBS widgets). Click the name to turn it into
// an input; blur/Enter/Esc commits and falls back to origName if left blank.
import { ref, nextTick } from "vue";

const props = withDefaults(
  defineProps<{
    modelValue: string;
    origName: string;
    placeholder?: string;
    prefix?: string;
    disabled?: boolean;
  }>(),
  { placeholder: "", prefix: "", disabled: false },
);

const emit = defineEmits<{ (e: "update:modelValue", v: string): void }>();

const editing = ref(false);
const inputEl = ref<HTMLInputElement | null>(null);

function start() {
  if (props.disabled) return;
  editing.value = true;
  nextTick(() => {
    inputEl.value?.focus();
    inputEl.value?.select();
  });
}
function stop() {
  editing.value = false;
  if (!props.modelValue.trim()) emit("update:modelValue", props.origName);
}

defineExpose({ start });
</script>

<template>
  <span v-if="disabled" class="ep-name-static"
    >{{ prefix }}{{ modelValue || origName }}</span
  >
  <span
    v-else-if="!editing"
    class="ep-name-editable"
    title="Click to rename"
    @click="start"
    >{{ prefix }}{{ modelValue || origName
    }}<span class="ep-name-edit-icon">✎</span></span
  >
  <span v-else class="ep-name-rename-wrap">
    <span v-if="prefix" class="ep-name-prefix">{{ prefix }}</span>
    <input
      ref="inputEl"
      :value="modelValue"
      class="ep-name-rename-input"
      :placeholder="placeholder"
      @input="
        emit('update:modelValue', ($event.target as HTMLInputElement).value)
      "
      @blur="stop"
      @keydown.enter="stop"
      @keydown.esc="stop"
    />
  </span>
</template>
