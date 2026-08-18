<script setup lang="ts">
import { ref, computed, onMounted } from "vue";
import { useAuth } from "../auth";
import { API } from "../api";
import { iconSvg as iconSvgFor } from "../composables/icons";
import type { Overlay } from "../composables/overlayTypes";
import ObsOverlayEditor from "./ObsOverlayEditor.vue";

const { session } = useAuth();
const authHeaders = computed(() =>
  session.value ? { Authorization: `Bearer ${session.value.token}` } : ({} as Record<string, string>),
);

const loading = ref(true);
const overlays = ref<Overlay[]>([]);
const scenes = ref<string[]>([]);
const currentScene = ref("");
const editingId = ref<string | null>(null);

async function load() {
  if (!session.value) return;
  loading.value = true;
  try {
    const [ovRes, scRes] = await Promise.all([
      fetch(`${API}/overlays/${session.value.channel}`, { headers: authHeaders.value }),
      fetch(`${API}/obs/${session.value.channel}/scenes`, { headers: authHeaders.value }),
    ]);
    if (ovRes.ok) {
      const d = (await ovRes.json()) as { overlays: Overlay[] };
      overlays.value = d.overlays ?? [];
    }
    if (scRes.ok) {
      const d = (await scRes.json()) as { scenes: { sceneName: string }[]; currentScene: string };
      scenes.value = (d.scenes ?? []).map((s) => s.sceneName);
      currentScene.value = d.currentScene ?? "";
    }
  } catch { }
  loading.value = false;
}

async function createOverlay() {
  if (!session.value) return;
  try {
    const res = await fetch(`${API}/overlays/${session.value.channel}`, {
      method: "POST",
      headers: authHeaders.value,
    });
    if (res.ok) {
      const d = (await res.json()) as { overlay: Overlay };
      overlays.value = [...overlays.value, d.overlay];
      editingId.value = d.overlay.id;
    }
  } catch { }
}

async function deleteOverlay(o: Overlay) {
  if (!session.value) return;
  if (!window.confirm(`Delete overlay "${o.name}"? This can't be undone.`)) return;
  try {
    const res = await fetch(`${API}/overlays/${session.value.channel}/${o.id}`, {
      method: "DELETE",
      headers: authHeaders.value,
    });
    if (res.ok) overlays.value = overlays.value.filter((x) => x.id !== o.id);
  } catch { }
}

function closeEditor() {
  editingId.value = null;
  load();
}

onMounted(load);
</script>

<template>
  <div class="oov-view">
    <div class="oov-header">
      <h1 class="oov-title">OBS Overlays</h1>
      <button class="oov-new-btn" @click="createOverlay">
        <span v-html="iconSvgFor('plus')"></span> New overlay
      </button>
    </div>

    <div v-if="loading" class="oov-empty">loading…</div>
    <div v-else-if="!overlays.length" class="oov-empty">
      No overlays yet. Create one to get started.
    </div>
    <div v-else class="oov-list">
      <div v-for="o in overlays" :key="o.id" class="oov-row">
        <span class="oov-dot" :class="{ on: o.scenes.some((s) => s.active) }"></span>
        <div class="oov-row-main">
          <div class="oov-row-name">{{ o.name }}</div>
          <div class="oov-row-status">
            <template v-if="o.scenes.length">
              {{ o.scenes.map((s) => `${s.scene}${s.active ? "" : " (hidden)"}`).join(", ") }}
            </template>
            <template v-else>Not added to a scene</template>
          </div>
        </div>
        <button class="oov-icon-btn" title="Edit" @click="editingId = o.id" v-html="iconSvgFor('edit')"></button>
        <button class="oov-icon-btn danger" title="Delete" @click="deleteOverlay(o)"
          v-html="iconSvgFor('trash')"></button>
      </div>
    </div>

    <ObsOverlayEditor v-if="editingId && session" :channel="session.channel" :auth-headers="authHeaders"
      :scenes="scenes" :current-scene="currentScene" :initial-overlay-id="editingId" @close="closeEditor" />
  </div>
</template>

<style scoped>
.oov-view {
  max-width: 720px;
  margin: 0 auto;
  padding: 24px 16px;
}

.oov-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 16px;
}

.oov-title {
  font-size: 18px;
  font-weight: 700;
  color: #e0e0e0;
  margin: 0;
}

.oov-new-btn {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  height: 32px;
  padding: 0 14px;
  border: none;
  background: #6f2bff;
  color: #fff;
  font-family: inherit;
  font-size: 12px;
  font-weight: 600;
  cursor: pointer;
}

.oov-new-btn:hover {
  background: #7f3fff;
}

.oov-new-btn svg {
  width: 12px;
  height: 12px;
}

.oov-empty {
  color: #555;
  font-size: 13px;
  padding: 32px 0;
  text-align: center;
}

.oov-list {
  display: flex;
  flex-direction: column;
  gap: 1px;
}

.oov-row {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 12px;
  background: #111217;
  border: 1px solid #1e1e22;
}

.oov-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: #555;
  flex-shrink: 0;
}

.oov-dot.on {
  background: #4ec9b0;
  box-shadow: 0 0 6px #4ec9b0aa;
}

.oov-row-main {
  flex: 1;
  min-width: 0;
}

.oov-row-name {
  color: #e0e0e0;
  font-size: 13px;
  font-weight: 600;
}

.oov-row-status {
  color: #666;
  font-size: 11px;
  margin-top: 2px;
}

.oov-icon-btn {
  width: 28px;
  height: 28px;
  flex-shrink: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  border: 1px solid #2a2a30;
  background: transparent;
  color: #888;
  cursor: pointer;
}

.oov-icon-btn svg {
  width: 12px;
  height: 12px;
}

.oov-icon-btn:hover {
  border-color: #6f2bff;
  color: #9d6cff;
}

.oov-icon-btn.danger:hover {
  border-color: #f14949;
  color: #f14949;
}
</style>
