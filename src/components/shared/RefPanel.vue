<script setup lang="ts">
// Shared "variable reference" panel used by every script editor (custom
// commands, OBS widgets, triggers, timers, countdowns). Single source for
// both lists shown:
//   1. the channel's actual counters/vars (fetched live), and
//   2. the static $token documentation (from composables/scriptReference.ts)
// Click any row to insert its token - previously only OBS widgets supported
// click-to-insert, everywhere else the reference list was read-only.
import { onMounted } from 'vue'
import { getRefGroups, renderRefToken } from '../../composables/scriptReference'
import { useVarRefs } from '../../composables/useVarRefs'

const props = withDefaults(defineProps<{ title?: string; context?: 'countdown' }>(), { title: 'Variable Reference' })
defineEmits<{ (e: 'insert', token: string): void }>()

const refGroups = getRefGroups(props.context)
const { varRefs, load } = useVarRefs()
onMounted(load)
</script>

<template>
  <details class="ep-ref-panel">
    <summary class="ep-ref-summary">{{ title }}</summary>
    <div class="ep-ref-content">
      <div v-if="varRefs.length" class="ep-ref-group">
        <div class="ep-ref-group-label">Your Variables</div>
        <div v-for="v in varRefs" :key="v.expr" class="ep-ref-row ep-ref-clickable" @click="$emit('insert', v.expr)">
          <code class="ep-ref-token">{{ v.label }}</code>
          <span class="ep-ref-desc">Click to insert</span>
          <span class="ep-ref-example">{{ v.expr }}</span>
        </div>
      </div>
      <div v-for="g in refGroups" :key="g.label" class="ep-ref-group">
        <div class="ep-ref-group-label">{{ g.label }}</div>
        <div v-for="r in g.items" :key="r.token" class="ep-ref-row ep-ref-clickable" :class="{ 'has-example': !!r.example }"
          @click="$emit('insert', r.token)">
          <code class="ep-ref-token" v-html="renderRefToken(r.token)"></code>
          <span class="ep-ref-desc">{{ r.desc }}</span>
          <span v-if="r.example" class="ep-ref-example">{{ r.example }}</span>
        </div>
      </div>
    </div>
  </details>
</template>
