<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted } from "vue";
import { API } from "../api";
import { iconSvg as iconSvgFor } from "../composables/icons";
import {
  defaultElement,
  type OverlayElement,
  type OverlayElementType,
} from "../composables/overlayTypes";
import ObsOverlayCanvasStage from "./ObsOverlayCanvasStage.vue";
import ObsOverlayElementGallery from "./ObsOverlayElementGallery.vue";
import ObsOverlayVariablePicker from "./ObsOverlayVariablePicker.vue";

const props = defineProps<{
  channel: string;
  authHeaders: Record<string, string>;
}>();
const emit = defineEmits<{
  close: [];
}>();

const loading = ref(true);
const saving = ref(false);
const overlayId = ref<string | null>(null);
const baseWidth = ref(1920);
const baseHeight = ref(1080);
const pendingElements = ref<OverlayElement[]>([]);
const deletedIds = ref<string[]>([]);
// >>> ids that exist on the server as of the last load - anything else is
// >>> new-this-session and never needs a delete call if removed before Save
const savedIds = ref<Set<string>>(new Set());
const selectedId = ref<string | null>(null);
const dirty = ref(false);

// >>> visual-only brightness slider - never rendered live, same as the old canvas
const stageBrightness = ref(100);
const stageBackground = computed(() => {
  const v = Math.round((stageBrightness.value / 100) * 255);
  return `rgba(${v}, ${v}, ${v}, ${(100 - stageBrightness.value) / 100})`;
});

const selectedElement = computed(
  () => pendingElements.value.find((e) => e.id === selectedId.value) ?? null,
);

function toWireElement(el: OverlayElement) {
  return {
    id: el.id,
    type: el.type,
    x: el.x,
    y: el.y,
    w: el.w,
    h: el.h,
    rotation: el.rotation,
    z_index: el.z_index,
    locked: el.locked,
    visible: el.visible,
    group_id: el.group_id,
    content: el.content,
    style: el.style,
    data: el.data,
  };
}
function fromWireElement(row: any): OverlayElement {
  return {
    id: row.id,
    type: row.type,
    x: row.x,
    y: row.y,
    w: row.w,
    h: row.h,
    rotation: row.rotation,
    z_index: row.z_index,
    locked: !!row.locked,
    visible: !!row.visible,
    group_id: row.group_id ?? null,
    content: row.content ?? "",
    style: (() => {
      try {
        return JSON.parse(row.style);
      } catch {
        return {};
      }
    })(),
    data: (() => {
      try {
        return JSON.parse(row.data);
      } catch {
        return {};
      }
    })(),
  };
}

async function load() {
  loading.value = true;
  try {
    const res = await fetch(`${API}/overlay/${props.channel}`, {
      headers: props.authHeaders,
    });
    if (res.ok) {
      const d = (await res.json()) as { overlay: any; elements: any[] };
      overlayId.value = d.overlay?.id ?? null;
      pendingElements.value = (d.elements ?? []).map(fromWireElement);
      savedIds.value = new Set(pendingElements.value.map((e) => e.id));
      deletedIds.value = [];
      dirty.value = false;
    }
  } catch { }
  // >>> best-effort real canvas size - falls back to 1920x1080 if the agent's offline
  try {
    const vs = await fetch(`${API}/obs/${props.channel}/video-settings`, {
      headers: props.authHeaders,
    });
    if (vs.ok) {
      const d = (await vs.json()) as { baseWidth: number; baseHeight: number };
      if (d.baseWidth) baseWidth.value = d.baseWidth;
      if (d.baseHeight) baseHeight.value = d.baseHeight;
    }
  } catch { }
  loading.value = false;
}

function addElement(type: OverlayElementType) {
  const el = defaultElement(type, baseWidth.value / 2, baseHeight.value / 2);
  el.z_index =
    pendingElements.value.reduce((max, e) => Math.max(max, e.z_index), 0) + 1;
  pendingElements.value = [...pendingElements.value, el];
  selectedId.value = el.id;
  dirty.value = true;
}

function updateElement(id: string, patch: Partial<OverlayElement>) {
  const idx = pendingElements.value.findIndex((e) => e.id === id);
  if (idx === -1) return;
  pendingElements.value = pendingElements.value.map((e, i) =>
    i === idx ? { ...e, ...patch } : e,
  );
  dirty.value = true;
}

function deleteSelected() {
  if (!selectedId.value) return;
  const id = selectedId.value;
  // >>> only rows that actually exist on the server need a delete call
  if (savedIds.value.has(id)) deletedIds.value.push(id);
  pendingElements.value = pendingElements.value.filter((e) => e.id !== id);
  selectedId.value = null;
  dirty.value = true;
}

function insertVariableToken(token: string) {
  if (!selectedElement.value) return;
  updateElement(selectedElement.value.id, {
    content: (selectedElement.value.content || "") + token,
  });
}

async function save() {
  saving.value = true;
  try {
    const res = await fetch(`${API}/overlay/${props.channel}/elements/bulk`, {
      method: "PUT",
      headers: { ...props.authHeaders, "Content-Type": "application/json" },
      body: JSON.stringify({
        elements: pendingElements.value.map(toWireElement),
        deletedIds: deletedIds.value,
      }),
    });
    if (res.ok) {
      await load();
    }
  } catch { }
  saving.value = false;
}

function discard() {
  load();
  selectedId.value = null;
}

function onKeydown(e: KeyboardEvent) {
  if (e.key === "Escape") emit("close");
}
onMounted(() => {
  load();
  window.addEventListener("keydown", onKeydown);
});
onUnmounted(() => {
  window.removeEventListener("keydown", onKeydown);
});

const overlayUrl = computed(() =>
  overlayId.value ? `https://obs.shyboti.de/overlay/${overlayId.value}` : "",
);
</script>

<template>
  <Teleport to="body">
    <div class="ovl-overlay">
      <div class="ovl-modal">
        <div class="ovl-topbar">
          <div class="ovl-topbar-title">Stream Overlay</div>
          <div class="ovl-topbar-actions">
            <div class="ovl-brightness">
              <span v-html="iconSvgFor('moon')"></span>
              <input type="range" min="0" max="100" v-model.number="stageBrightness"
                title="Canvas brightness (editor-only, never rendered live)" />
              <span v-html="iconSvgFor('sun')"></span>
            </div>
            <button class="ovl-btn-cancel" :disabled="!dirty || saving" @click="discard">Discard</button>
            <button class="ovl-btn-save" :disabled="!dirty || saving" @click="save">
              {{ saving ? "Saving…" : "Save" }}
            </button>
            <button class="ovl-close-btn" title="Close (Esc)" @click="emit('close')" v-html="iconSvgFor('x')"></button>
          </div>
        </div>

        <div class="ovl-content">
          <ObsOverlayElementGallery @add="addElement" />

          <div class="ovl-body">
            <div v-if="loading" class="ovl-loading">loading…</div>
            <ObsOverlayCanvasStage v-else :elements="pendingElements" v-model:selected-id="selectedId"
              :base-width="baseWidth" :base-height="baseHeight" :style="{ background: stageBackground }"
              @update-element="updateElement" />
          </div>

          <div class="ovl-props">
            <div class="ovl-props-title">properties</div>
            <template v-if="selectedElement">
              <div class="ovl-props-type">{{ selectedElement.type }}</div>

              <label class="ovl-props-label">
                {{ selectedElement.type === "image" ? "Image URL" : "Content" }}
              </label>
              <textarea v-if="selectedElement.type !== 'image'" class="ovl-props-textarea"
                :value="selectedElement.content" :placeholder="selectedElement.type === 'variable-text'
                  ? 'e.g. $counter.wins'
                  : 'Text to show'
                  " @input="updateElement(selectedElement.id, { content: ($event.target as HTMLTextAreaElement).value })" />
              <input v-else class="ovl-props-input" :value="selectedElement.content" placeholder="https://…"
                @input="updateElement(selectedElement.id, { content: ($event.target as HTMLInputElement).value })" />

              <ObsOverlayVariablePicker v-if="selectedElement.type === 'variable-text'" :channel="channel"
                :auth-headers="authHeaders" @insert="insertVariableToken" />

              <div class="ovl-props-row">
                <label class="ovl-props-check">
                  <input type="checkbox" :checked="selectedElement.visible"
                    @change="updateElement(selectedElement.id, { visible: ($event.target as HTMLInputElement).checked })" />
                  visible
                </label>
                <label class="ovl-props-check">
                  <input type="checkbox" :checked="selectedElement.locked"
                    @change="updateElement(selectedElement.id, { locked: ($event.target as HTMLInputElement).checked })" />
                  locked
                </label>
              </div>

              <button class="ovl-btn-delete" @click="deleteSelected">
                <span v-html="iconSvgFor('trash')"></span> Delete
              </button>
            </template>
            <div v-else class="ovl-props-empty">Select an element, or add one from the gallery.</div>

            <div v-if="overlayUrl" class="ovl-url-box">
              <div class="ovl-props-label">Overlay page (add as a Browser Source in OBS)</div>
              <code class="ovl-url">{{ overlayUrl }}</code>
            </div>
          </div>
        </div>
      </div>
    </div>
  </Teleport>
</template>

<style scoped>
.ovl-overlay {
  position: fixed;
  inset: 0;
  z-index: 2000;
  background: rgba(0, 0, 0, 0.85);
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 24px;
}

.ovl-modal {
  width: 100%;
  max-width: 1500px;
  height: 100%;
  max-height: 900px;
  background: #0a0a0d;
  border: 1px solid #2a2a30;
  display: flex;
  flex-direction: column;
}

.ovl-topbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 12px 16px;
  flex-shrink: 0;
  border-bottom: 1px solid #1e1e22;
}

.ovl-topbar-title {
  color: #e0e0e0;
  font-weight: 700;
  font-size: 14px;
}

.ovl-topbar-actions {
  display: flex;
  align-items: center;
  gap: 8px;
}

.ovl-brightness {
  display: flex;
  align-items: center;
  gap: 6px;
  height: 30px;
  padding: 0 12px;
  border: 1px solid #2a2a30;
  background: #111217;
  color: #666;
}

.ovl-brightness svg {
  width: 12px;
  height: 12px;
  flex-shrink: 0;
}

.ovl-brightness input[type="range"] {
  width: 90px;
  accent-color: #6f2bff;
  cursor: pointer;
}

.ovl-btn-save {
  height: 30px;
  padding: 0 16px;
  border: none;
  background: #6f2bff;
  color: #fff;
  font-family: inherit;
  font-size: 12px;
  font-weight: 600;
  cursor: pointer;
}

.ovl-btn-save:hover:not(:disabled) {
  background: #7f3fff;
}

.ovl-btn-save:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}

.ovl-btn-cancel {
  height: 30px;
  padding: 0 14px;
  border: 1px solid #333;
  background: transparent;
  color: #888;
  font-family: inherit;
  font-size: 12px;
  cursor: pointer;
}

.ovl-btn-cancel:hover:not(:disabled) {
  border-color: #555;
  color: #e0e0e0;
}

.ovl-btn-cancel:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}

.ovl-close-btn {
  width: 30px;
  height: 30px;
  border: 1px solid #2a2a30;
  background: #111217;
  color: #888;
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
}

.ovl-close-btn:hover {
  color: #f14949;
  border-color: #f1494966;
}

.ovl-content {
  flex: 1;
  display: flex;
  min-height: 0;
}

.ovl-body {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 16px;
  min-width: 0;
  min-height: 0;
}

.ovl-loading {
  color: #555;
  font-size: 13px;
}

.ovl-props {
  width: 260px;
  flex-shrink: 0;
  border-left: 1px solid #1e1e22;
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 10px 12px;
  overflow-y: auto;
}

.ovl-props-title {
  font-size: 10px;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  color: #555;
}

.ovl-props-type {
  font-size: 11px;
  color: #9d6cff;
  text-transform: uppercase;
  letter-spacing: 0.04em;
}

.ovl-props-label {
  font-size: 10px;
  color: #666;
  text-transform: uppercase;
  letter-spacing: 0.04em;
}

.ovl-props-textarea,
.ovl-props-input {
  background: #111217;
  border: 1px solid #2a2a30;
  color: #e0e0e0;
  font-family: inherit;
  font-size: 12px;
  padding: 7px 8px;
  outline: none;
  width: 100%;
  box-sizing: border-box;
}

.ovl-props-textarea {
  min-height: 60px;
  resize: vertical;
}

.ovl-props-textarea:focus,
.ovl-props-input:focus {
  border-color: #6f2bff88;
}

.ovl-props-row {
  display: flex;
  gap: 12px;
}

.ovl-props-check {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 11px;
  color: #ccc;
  cursor: pointer;
}

.ovl-btn-delete {
  display: flex;
  align-items: center;
  gap: 6px;
  height: 30px;
  padding: 0 12px;
  border: 1px solid #f1494944;
  background: transparent;
  color: #f14949;
  font-family: inherit;
  font-size: 11px;
  cursor: pointer;
  align-self: flex-start;
}

.ovl-btn-delete:hover {
  background: #f1494911;
}

.ovl-btn-delete svg {
  width: 12px;
  height: 12px;
}

.ovl-props-empty {
  color: #555;
  font-size: 11px;
  line-height: 1.6;
}

.ovl-url-box {
  margin-top: auto;
  padding-top: 10px;
  border-top: 1px solid #1e1e22;
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.ovl-url {
  font-family: "Consolas", "Fira Mono", monospace;
  font-size: 10px;
  color: #4ec9b0;
  word-break: break-all;
}
</style>
