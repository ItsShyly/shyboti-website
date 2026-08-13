<script setup lang="ts">
// >>> local mode filters items client-side; remote mode debounces fetchItems()
import { ref, computed, watch } from "vue";

export interface TypeaheadItem {
  id?: string;
  label: string;
  sub?: string;
  iconUrl?: string;
}

const props = withDefaults(
  defineProps<{
    modelValue: string;
    items?: string[];
    fetchItems?: (query: string) => Promise<TypeaheadItem[]>;
    placeholder?: string;
    minChars?: number;
    disabled?: boolean;
    mono?: boolean;
  }>(),
  { items: () => [], minChars: 0, disabled: false, mono: false },
);

const emit = defineEmits<{
  (e: "update:modelValue", v: string): void;
  (e: "select", item: TypeaheadItem): void;
}>();

const query = ref(props.modelValue);
watch(
  () => props.modelValue,
  (v) => {
    if (v !== query.value) query.value = v;
  },
);

const open = ref(false);
const loading = ref(false);
const activeIndex = ref(0);
const remoteResults = ref<TypeaheadItem[]>([]);
let reqId = 0;
let debounceTimer: ReturnType<typeof setTimeout> | null = null;

const isRemote = computed(() => !!props.fetchItems);

const localResults = computed<TypeaheadItem[]>(() => {
  const q = query.value.trim().toLowerCase();
  const src = props.items ?? [];
  if (!q) return src.slice(0, 20).map((s) => ({ label: s }));
  const starts: TypeaheadItem[] = [];
  const includes: TypeaheadItem[] = [];
  for (const s of src) {
    const l = s.toLowerCase();
    if (l.startsWith(q)) starts.push({ label: s });
    else if (l.includes(q)) includes.push({ label: s });
  }
  return [...starts, ...includes].slice(0, 20);
});

const results = computed(() =>
  isRemote.value ? remoteResults.value : localResults.value,
);

function onInput() {
  emit("update:modelValue", query.value);
  activeIndex.value = 0;
  open.value = true;
  if (!isRemote.value) return;
  const q = query.value.trim();
  if (debounceTimer) clearTimeout(debounceTimer);
  if (q.length < props.minChars) {
    remoteResults.value = [];
    return;
  }
  debounceTimer = setTimeout(async () => {
    const myReq = ++reqId;
    loading.value = true;
    try {
      const r = await props.fetchItems!(q);
      if (myReq === reqId) remoteResults.value = r;
    } catch {
      if (myReq === reqId) remoteResults.value = [];
    }
    if (myReq === reqId) loading.value = false;
  }, 220);
}

function onFocus() {
  open.value = true;
  if (
    isRemote.value &&
    query.value.trim().length >= props.minChars &&
    !remoteResults.value.length
  ) {
    onInput();
  }
}
function onBlur() {
  // >>> delay close so a dropdown click (mousedown) registers before blur
  setTimeout(() => {
    open.value = false;
  }, 150);
}

function selectItem(item: TypeaheadItem) {
  query.value = item.label;
  emit("update:modelValue", item.label);
  emit("select", item);
  open.value = false;
}

function onKeydown(e: KeyboardEvent) {
  if (!open.value || !results.value.length) {
    if (e.key === "Escape") {
      open.value = false;
      (e.target as HTMLElement).blur();
    }
    return;
  }
  if (e.key === "ArrowDown") {
    e.preventDefault();
    activeIndex.value = Math.min(activeIndex.value + 1, results.value.length - 1);
  } else if (e.key === "ArrowUp") {
    e.preventDefault();
    activeIndex.value = Math.max(activeIndex.value - 1, 0);
  } else if (e.key === "Enter") {
    e.preventDefault();
    const item = results.value[activeIndex.value];
    if (item) selectItem(item);
  } else if (e.key === "Escape") {
    open.value = false;
    (e.target as HTMLElement).blur();
  }
}
</script>

<template>
  <div class="ep-typeahead">
    <input
      v-model="query"
      class="ep-field-input"
      :class="{ 'ep-mono': mono }"
      :placeholder="placeholder"
      :disabled="disabled"
      autocomplete="off"
      spellcheck="false"
      @input="onInput"
      @focus="onFocus"
      @blur="onBlur"
      @keydown="onKeydown"
    />
    <div v-if="open" class="ep-typeahead-dropdown">
      <div v-if="loading" class="ep-typeahead-empty">searching…</div>
      <template v-else-if="results.length">
        <button
          v-for="(item, idx) in results"
          :key="item.id ?? item.label"
          type="button"
          class="ep-typeahead-item"
          :class="{ active: idx === activeIndex }"
          @mousedown.prevent="selectItem(item)"
          @mouseenter="activeIndex = idx"
        >
          <img v-if="item.iconUrl" :src="item.iconUrl" class="ep-typeahead-icon" alt="" />
          <span class="ep-typeahead-label">{{ item.label }}</span>
          <span v-if="item.sub" class="ep-typeahead-sub">{{ item.sub }}</span>
        </button>
      </template>
      <div v-else class="ep-typeahead-empty">
        {{ isRemote ? (query.trim() ? "no matches" : "type to search") : "no matches" }}
      </div>
    </div>
  </div>
</template>

<style scoped>
.ep-typeahead {
  position: relative;
}
</style>
