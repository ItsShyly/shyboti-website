<script setup lang="ts">
// >>> click-to-insert used to be OBS-only, now shared
import { computed, onMounted, ref } from "vue";
import {
  getRefGroups,
  renderRefToken,
  type RefGroup,
} from "../../composables/scriptReference";
import { useVarRefs } from "../../composables/useVarRefs";

const props = withDefaults(
  defineProps<{
    title?: string;
    context?: "countdown";
    // >>> override the variable groups entirely, e.g. regex
    groups?: RefGroup[];
    // >>> hide "your variables" outside scripting contexts
    showVars?: boolean;
  }>(),
  { title: "Variable Reference", showVars: true },
);
defineEmits<{ (e: "insert", token: string): void }>();

const refGroups = props.groups ?? getRefGroups(props.context);
const { varRefs, load } = useVarRefs();
onMounted(() => {
  if (props.showVars) load();
});

// >>> filter groups/vars by token or description
const search = ref("");
const filteredVarRefs = computed(() => {
  const q = search.value.trim().toLowerCase();
  if (!q) return varRefs.value;
  return varRefs.value.filter((v) => v.label.toLowerCase().includes(q));
});
const filteredGroups = computed(() => {
  const q = search.value.trim().toLowerCase();
  if (!q) return refGroups;
  return refGroups
    .map((g) => ({
      label: g.label,
      items: g.items.filter(
        (i) =>
          i.token.toLowerCase().includes(q) || i.desc.toLowerCase().includes(q),
      ),
    }))
    .filter((g) => g.items.length);
});
</script>

<template>
  <details class="ep-ref-panel">
    <summary class="ep-ref-summary">{{ title }}</summary>
    <div class="ep-ref-content">
      <div class="ep-ref-search-row">
        <input
          v-model="search"
          class="ep-ref-search"
          type="text"
          placeholder="Filter references…"
        />
      </div>
      <div class="ep-ref-groups">
        <details v-if="showVars && filteredVarRefs.length" class="ep-ref-group" open>
          <summary class="ep-ref-group-label">Your Variables</summary>
          <div
            v-for="v in filteredVarRefs"
            :key="v.expr"
            class="ep-ref-row ep-ref-clickable"
            @click="$emit('insert', v.expr)"
          >
            <code class="ep-ref-token">{{ v.label }}</code>
            <span class="ep-ref-desc">Click to insert</span>
            <span class="ep-ref-example">{{ v.expr }}</span>
          </div>
        </details>
        <details v-for="g in filteredGroups" :key="g.label" class="ep-ref-group">
          <summary class="ep-ref-group-label">{{ g.label }}</summary>
          <div
            v-for="r in g.items"
            :key="r.token"
            class="ep-ref-row ep-ref-clickable"
            :class="{ 'has-example': !!r.example }"
            @click="$emit('insert', r.token)"
          >
            <code class="ep-ref-token" v-html="renderRefToken(r.token)"></code>
            <span class="ep-ref-desc">{{ r.desc }}</span>
            <span v-if="r.example" class="ep-ref-example">{{ r.example }}</span>
          </div>
        </details>
      </div>
    </div>
  </details>
</template>

<style scoped>
.ep-ref-search-row {
  padding: 0 2px 8px;
}
.ep-ref-search {
  width: 100%;
  background: #111217;
  border: 1px solid #2a2a30;
  color: #e0e0e0;
  font-size: 11px;
  padding: 5px 8px;
  outline: none;
  box-sizing: border-box;
}
.ep-ref-groups {
  max-height: 280px;
  overflow-y: auto;
  scrollbar-width: thin;
}
.ep-ref-group {
  border-bottom: 1px solid #1e1e22;
}
.ep-ref-group:last-child {
  border-bottom: none;
}
.ep-ref-group > summary.ep-ref-group-label {
  cursor: pointer;
  list-style: none;
  display: flex;
  align-items: center;
  gap: 6px;
  margin-bottom: 0;
  padding: 6px 2px;
}
.ep-ref-group > summary.ep-ref-group-label::-webkit-details-marker {
  display: none;
}
.ep-ref-group > summary.ep-ref-group-label::before {
  content: "▶";
  font-size: 8px;
  color: #555;
  transition: transform 0.15s;
}
.ep-ref-group[open] > summary.ep-ref-group-label::before {
  transform: rotate(90deg);
}
.ep-ref-group > :not(summary) {
  padding-bottom: 6px;
}
</style>
