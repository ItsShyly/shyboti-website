<script setup lang="ts">
import { ref, onMounted } from "vue";
import { API } from "../../api";

const props = defineProps<{
  channel: string;
  authHeaders: Record<string, string>;
}>();
const emit = defineEmits<{
  insert: [token: string];
}>();

interface NamedValue {
  name: string;
  value: string | number;
}
const counters = ref<NamedValue[]>([]);
const vars = ref<NamedValue[]>([]);
const loading = ref(false);
const open = ref(false);

async function load() {
  loading.value = true;
  try {
    const res = await fetch(`${API}/variables/${props.channel}`, {
      headers: props.authHeaders,
    });
    if (res.ok) {
      const d = (await res.json()) as { counters: NamedValue[]; vars: NamedValue[] };
      counters.value = d.counters ?? [];
      vars.value = d.vars ?? [];
    }
  } catch { }
  loading.value = false;
}

function toggle() {
  open.value = !open.value;
  if (open.value && !counters.value.length && !vars.value.length) load();
}
function pick(token: string) {
  emit("insert", token);
  open.value = false;
}

onMounted(() => { });
</script>

<template>
  <div class="ovl-varpick">
    <button class="ovl-varpick-btn" @click="toggle">Insert variable</button>
    <div v-if="open" class="ovl-varpick-menu">
      <div v-if="loading" class="ovl-varpick-empty">loading…</div>
      <template v-else>
        <div v-if="counters.length" class="ovl-varpick-group">counters</div>
        <button v-for="c in counters" :key="'c' + c.name" class="ovl-varpick-item"
          @click="pick(`$counter.${c.name}`)">
          $counter.{{ c.name }}
        </button>
        <div v-if="vars.length" class="ovl-varpick-group">vars</div>
        <button v-for="v in vars" :key="'v' + v.name" class="ovl-varpick-item" @click="pick(`$var.${v.name}`)">
          $var.{{ v.name }}
        </button>
        <div v-if="!counters.length && !vars.length" class="ovl-varpick-empty">no variables yet</div>
      </template>
    </div>
  </div>
</template>

<style scoped>
.ovl-varpick {
  position: relative;
}

.ovl-varpick-btn {
  height: 28px;
  padding: 0 10px;
  border: 1px solid #6f2bff66;
  background: #6f2bff15;
  color: #9d6cff;
  font-family: inherit;
  font-size: 11px;
  cursor: pointer;
}

.ovl-varpick-btn:hover {
  background: #6f2bff30;
}

.ovl-varpick-menu {
  position: absolute;
  top: calc(100% + 4px);
  left: 0;
  width: 200px;
  max-height: 240px;
  overflow-y: auto;
  scrollbar-width: none;
  background: #1a1a1e;
  border: 1px solid #2a2a30;
  z-index: 50;
  box-shadow: 0 8px 32px rgba(0, 0, 0, 0.6);
}

.ovl-varpick-menu::-webkit-scrollbar {
  display: none;
}

.ovl-varpick-group {
  padding: 6px 10px 3px;
  font-size: 9px;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  color: #555;
}

.ovl-varpick-item {
  display: block;
  width: 100%;
  padding: 6px 10px;
  border: none;
  background: transparent;
  color: #ccc;
  font-family: "Consolas", "Fira Mono", monospace;
  font-size: 11px;
  text-align: left;
  cursor: pointer;
}

.ovl-varpick-item:hover {
  background: #6f2bff18;
  color: #e0e0e0;
}

.ovl-varpick-empty {
  padding: 10px;
  color: #555;
  font-size: 11px;
}
</style>
