<script setup lang="ts">
// >>> shared ref panel: click-to-insert used to be OBS-only, now everywhere
import { onMounted } from "vue";
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
    // >>> override the script-variable groups entirely (e.g. Regex Reference)
    groups?: RefGroup[];
    // >>> "Your Variables" only makes sense for the scripting language, not e.g. regex
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
</script>

<template>
  <details class="ep-ref-panel">
    <summary class="ep-ref-summary">{{ title }}</summary>
    <div class="ep-ref-content">
      <div v-if="showVars && varRefs.length" class="ep-ref-group">
        <div class="ep-ref-group-label">Your Variables</div>
        <div
          v-for="v in varRefs"
          :key="v.expr"
          class="ep-ref-row ep-ref-clickable"
          @click="$emit('insert', v.expr)"
        >
          <code class="ep-ref-token">{{ v.label }}</code>
          <span class="ep-ref-desc">Click to insert</span>
          <span class="ep-ref-example">{{ v.expr }}</span>
        </div>
      </div>
      <div v-for="g in refGroups" :key="g.label" class="ep-ref-group">
        <div class="ep-ref-group-label">{{ g.label }}</div>
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
      </div>
    </div>
  </details>
</template>
