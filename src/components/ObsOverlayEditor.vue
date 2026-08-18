<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted } from "vue";
import { API } from "../api";
import { iconSvg as iconSvgFor } from "../composables/icons";
import {
  defaultElement,
  defaultVideoWithAudio,
  shapeDefaultStyle,
  newElementId,
  type Overlay,
  type OverlayElement,
  type OverlayElementType,
  type ShapeVariant,
} from "../composables/overlayTypes";
import ObsOverlayCanvasStage from "./ObsOverlayCanvasStage.vue";
import ObsOverlayElementGallery from "./ObsOverlayElementGallery.vue";
import ObsOverlayVariablePicker from "./ObsOverlayVariablePicker.vue";
import ObsOverlayStylePanel from "./ObsOverlayStylePanel.vue";
import ObsOverlayLayersPanel from "./ObsOverlayLayersPanel.vue";

const props = defineProps<{
  channel: string;
  authHeaders: Record<string, string>;
  scenes: string[];
  currentScene: string;
  initialOverlayId?: string;
}>();
const emit = defineEmits<{
  close: [];
}>();

const loading = ref(true);
const saving = ref(false);
const busy = ref(false); // <<< add/remove/show/hide/swap in flight
const overlays = ref<Overlay[]>([]);
const currentOverlayId = ref<string | null>(null);
const currentOverlay = computed(
  () => overlays.value.find((o) => o.id === currentOverlayId.value) ?? null,
);
const overlayAdded = computed(() => !!currentOverlay.value?.obs_input_name);
const overlayVisible = computed(() => !!currentOverlay.value?.active);
const overlayTargetScene = computed(() => currentOverlay.value?.target_scene || "");
const activateScene = ref("");
const renaming = ref(false);
const renameDraft = ref("");

const baseWidth = ref(1920);
const baseHeight = ref(1080);
const pendingElements = ref<OverlayElement[]>([]);
const deletedIds = ref<string[]>([]);
const savedIds = ref<Set<string>>(new Set());
const selectedIds = ref<string[]>([]);
const dirty = ref(false);
const previewValues = ref<Record<string, string>>({});

// >>> editor-only backdrop - never rendered live, just lets you eyeball white vs black text
const stageBackdrop = ref<"checker" | "white" | "black">("checker");

const selectedElement = computed(() =>
  selectedIds.value.length === 1
    ? pendingElements.value.find((e) => e.id === selectedIds.value[0]) ?? null
    : null,
);

// vvv history (undo/redo) vvv
const historyPast = ref<OverlayElement[][]>([]);
const historyFuture = ref<OverlayElement[][]>([]);
const HISTORY_CAP = 50;
function snapshot(): OverlayElement[] {
  return JSON.parse(JSON.stringify(pendingElements.value));
}
function pushHistory() {
  historyPast.value.push(snapshot());
  if (historyPast.value.length > HISTORY_CAP) historyPast.value.shift();
  historyFuture.value = [];
}
function undo() {
  if (!historyPast.value.length) return;
  const prev = historyPast.value.pop()!;
  historyFuture.value.push(snapshot());
  pendingElements.value = prev;
  selectedIds.value = [];
  dirty.value = true;
}
function redo() {
  if (!historyFuture.value.length) return;
  const next = historyFuture.value.pop()!;
  historyPast.value.push(snapshot());
  pendingElements.value = next;
  selectedIds.value = [];
  dirty.value = true;
}
// ^^^ history ^^^

function applyPatch(id: string, patch: Partial<OverlayElement>) {
  const idx = pendingElements.value.findIndex((e) => e.id === id);
  if (idx === -1) return;
  pendingElements.value = pendingElements.value.map((e, i) =>
    i === idx ? { ...e, ...patch } : e,
  );
  dirty.value = true;
}
function updateElement(id: string, patch: Partial<OverlayElement>) {
  pushHistory();
  applyPatch(id, patch);
}
function updateElements(updates: Array<{ id: string; patch: Partial<OverlayElement> }>) {
  pushHistory();
  for (const u of updates) applyPatch(u.id, u.patch);
}

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

async function loadOverlaysList() {
  try {
    const res = await fetch(`${API}/overlays/${props.channel}`, {
      headers: props.authHeaders,
    });
    if (res.ok) {
      const d = (await res.json()) as { overlays: Overlay[] };
      overlays.value = d.overlays ?? [];
    }
  } catch { }
  if (!currentOverlayId.value || !overlays.value.some((o) => o.id === currentOverlayId.value)) {
    const wanted = props.initialOverlayId;
    const attachedToScene = overlays.value.find(
      (o) => o.obs_input_name && o.target_scene === props.currentScene,
    );
    currentOverlayId.value =
      (wanted && overlays.value.some((o) => o.id === wanted) ? wanted : null) ??
      attachedToScene?.id ??
      overlays.value[0]?.id ??
      null;
  }
}

async function loadElements() {
  if (!currentOverlayId.value) {
    pendingElements.value = [];
    savedIds.value = new Set();
    return;
  }
  try {
    const res = await fetch(`${API}/overlay/${props.channel}/${currentOverlayId.value}`, {
      headers: props.authHeaders,
    });
    if (res.ok) {
      const d = (await res.json()) as { overlay: any; elements: any[] };
      pendingElements.value = (d.elements ?? []).map(fromWireElement);
      savedIds.value = new Set(pendingElements.value.map((e) => e.id));
      deletedIds.value = [];
      dirty.value = false;
      historyPast.value = [];
      historyFuture.value = [];
    }
  } catch { }
  fetchPreviewValues();
}

async function fetchPreviewValues() {
  if (!currentOverlayId.value) return;
  try {
    const res = await fetch(
      `${API}/overlay/${props.channel}/${currentOverlayId.value}/preview-values`,
      { headers: props.authHeaders },
    );
    if (res.ok) previewValues.value = await res.json();
  } catch { }
}

async function load() {
  loading.value = true;
  await loadOverlaysList();
  await loadElements();
  if (!activateScene.value) {
    activateScene.value = overlayTargetScene.value || props.currentScene || props.scenes[0] || "";
  }
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

// vvv switch/create/rename/delete overlays vvv
function confirmDiscardIfDirty(): boolean {
  if (!dirty.value) return true;
  return window.confirm("Discard unsaved changes to this overlay?");
}
function cycleOverlay(dir: 1 | -1) {
  if (!overlays.value.length) return;
  const idx = overlays.value.findIndex((o) => o.id === currentOverlayId.value);
  const next = overlays.value[(idx + dir + overlays.value.length) % overlays.value.length];
  if (next) switchOverlay(next.id);
}
async function switchOverlay(id: string) {
  if (id === currentOverlayId.value) return;
  if (!confirmDiscardIfDirty()) return;
  currentOverlayId.value = id;
  selectedIds.value = [];
  await loadElements();
}
async function createOverlay() {
  try {
    const res = await fetch(`${API}/overlays/${props.channel}`, {
      method: "POST",
      headers: props.authHeaders,
    });
    if (res.ok) {
      const d = (await res.json()) as { overlay: Overlay };
      overlays.value = [...overlays.value, d.overlay];
      currentOverlayId.value = d.overlay.id;
      selectedIds.value = [];
      await loadElements();
    }
  } catch { }
}
function startRename() {
  if (!currentOverlay.value) return;
  renameDraft.value = currentOverlay.value.name;
  renaming.value = true;
}
async function commitRename() {
  const name = renameDraft.value.trim();
  renaming.value = false;
  if (!name || !currentOverlay.value || name === currentOverlay.value.name) return;
  try {
    const res = await fetch(`${API}/overlays/${props.channel}/${currentOverlay.value.id}`, {
      method: "PUT",
      headers: { ...props.authHeaders, "Content-Type": "application/json" },
      body: JSON.stringify({ name }),
    });
    if (res.ok) {
      overlays.value = overlays.value.map((o) =>
        o.id === currentOverlay.value!.id ? { ...o, name } : o,
      );
    }
  } catch { }
}
async function deleteOverlay() {
  if (!currentOverlay.value) return;
  if (!window.confirm(`Delete overlay "${currentOverlay.value.name}"? This can't be undone.`))
    return;
  const id = currentOverlay.value.id;
  try {
    const res = await fetch(`${API}/overlays/${props.channel}/${id}`, {
      method: "DELETE",
      headers: props.authHeaders,
    });
    if (res.ok) {
      overlays.value = overlays.value.filter((o) => o.id !== id);
      currentOverlayId.value = null;
      selectedIds.value = [];
      if (!overlays.value.length) await createOverlay();
      else await loadElements();
    }
  } catch { }
}
// ^^^ switch/create/rename/delete overlays ^^^

function nextZ() {
  return pendingElements.value.reduce((m, e) => Math.max(m, e.z_index), 0) + 1;
}

function addElement(type: OverlayElementType, variant?: ShapeVariant) {
  pushHistory();
  if (type === "video") {
    const [video, audio] = defaultVideoWithAudio(baseWidth.value / 2, baseHeight.value / 2);
    video.z_index = nextZ();
    audio.z_index = video.z_index + 1;
    pendingElements.value = [...pendingElements.value, video, audio];
    selectedIds.value = [video.id];
    dirty.value = true;
    return;
  }
  const el = defaultElement(type, baseWidth.value / 2, baseHeight.value / 2);
  if (type === "shape" && variant) {
    el.data = { variant };
    el.style = shapeDefaultStyle(variant);
  }
  el.z_index = nextZ();
  pendingElements.value = [...pendingElements.value, el];
  selectedIds.value = [el.id];
  dirty.value = true;
}

function onSelect(id: string | null, additive: boolean) {
  if (id === null) {
    selectedIds.value = [];
    return;
  }
  if (additive) {
    selectedIds.value = selectedIds.value.includes(id)
      ? selectedIds.value.filter((x) => x !== id)
      : [...selectedIds.value, id];
    return;
  }
  // >>> clicking one member of a group selects the whole group
  const el = pendingElements.value.find((e) => e.id === id);
  if (el?.group_id) {
    selectedIds.value = pendingElements.value
      .filter((e) => e.group_id === el.group_id)
      .map((e) => e.id);
  } else {
    selectedIds.value = [id];
  }
}

function deleteSelected() {
  if (!selectedIds.value.length) return;
  pushHistory();
  for (const id of selectedIds.value) {
    if (savedIds.value.has(id)) deletedIds.value.push(id);
  }
  const toDelete = new Set(selectedIds.value);
  pendingElements.value = pendingElements.value.filter((e) => !toDelete.has(e.id));
  selectedIds.value = [];
  dirty.value = true;
}
function deleteOne(id: string) {
  selectedIds.value = [id];
  deleteSelected();
}

function toggleLock(id: string) {
  const el = pendingElements.value.find((e) => e.id === id);
  if (!el) return;
  pushHistory();
  applyPatch(id, { locked: !el.locked });
}
function toggleVisible(id: string) {
  const el = pendingElements.value.find((e) => e.id === id);
  if (!el) return;
  pushHistory();
  applyPatch(id, { visible: !el.visible });
}

function groupSelected() {
  if (selectedIds.value.length < 2) return;
  pushHistory();
  const gid = newElementId();
  const set = new Set(selectedIds.value);
  pendingElements.value = pendingElements.value.map((e) =>
    set.has(e.id) ? { ...e, group_id: gid } : e,
  );
  dirty.value = true;
}
function ungroupSelected() {
  pushHistory();
  const set = new Set(selectedIds.value);
  pendingElements.value = pendingElements.value.map((e) =>
    set.has(e.id) ? { ...e, group_id: null } : e,
  );
  dirty.value = true;
}

// vvv copy/paste/duplicate - remaps ids + internal video<->audio links vvv
const clipboard = ref<OverlayElement[]>([]);
function copySelected() {
  clipboard.value = pendingElements.value
    .filter((e) => selectedIds.value.includes(e.id))
    .map((e) => JSON.parse(JSON.stringify(e)));
}
function pasteFrom(source: OverlayElement[]) {
  if (!source.length) return;
  pushHistory();
  const idMap = new Map<string, string>();
  const gid = source.some((e) => e.group_id) ? newElementId() : null;
  const copies = source.map((e) => {
    const id = newElementId();
    idMap.set(e.id, id);
    return { ...JSON.parse(JSON.stringify(e)), id, x: e.x + 24, y: e.y + 24, group_id: e.group_id ? gid : null };
  });
  for (const c of copies) {
    if (c.data?.linkedVideoId && idMap.has(c.data.linkedVideoId))
      c.data = { ...c.data, linkedVideoId: idMap.get(c.data.linkedVideoId) };
    if (c.data?.linkedAudioId && idMap.has(c.data.linkedAudioId))
      c.data = { ...c.data, linkedAudioId: idMap.get(c.data.linkedAudioId) };
  }
  pendingElements.value = [...pendingElements.value, ...copies];
  selectedIds.value = copies.map((c) => c.id);
  dirty.value = true;
}
function pasteClipboard() {
  pasteFrom(clipboard.value);
}
function duplicateSelected() {
  const sel = pendingElements.value.filter((e) => selectedIds.value.includes(e.id));
  pasteFrom(sel);
}
// ^^^ copy/paste/duplicate ^^^

// vvv add/remove/show/hide/swap - immediate, not part of the staged/Save flow vvv
// >>> whichever OTHER overlay is currently attached to the picked scene, if any
const occupantOverlay = computed(() =>
  overlays.value.find(
    (o) =>
      o.id !== currentOverlayId.value && o.obs_input_name && o.target_scene === activateScene.value,
  ),
);
async function addToScene() {
  if (busy.value || !currentOverlay.value) return;
  busy.value = true;
  try {
    const res = await fetch(
      `${API}/overlay/${props.channel}/${currentOverlay.value.id}/add-to-scene`,
      {
        method: "POST",
        headers: { ...props.authHeaders, "Content-Type": "application/json" },
        body: JSON.stringify({ scene: activateScene.value }),
      },
    );
    if (res.ok) await loadOverlaysList();
  } catch { }
  busy.value = false;
}
async function removeFromScene() {
  if (busy.value || !currentOverlay.value) return;
  busy.value = true;
  try {
    const res = await fetch(
      `${API}/overlay/${props.channel}/${currentOverlay.value.id}/remove-from-scene`,
      { method: "POST", headers: props.authHeaders },
    );
    if (res.ok) await loadOverlaysList();
  } catch { }
  busy.value = false;
}
async function toggleVisibility() {
  if (busy.value || !currentOverlay.value) return;
  busy.value = true;
  const action = overlayVisible.value ? "hide" : "show";
  try {
    const res = await fetch(
      `${API}/overlay/${props.channel}/${currentOverlay.value.id}/${action}`,
      { method: "POST", headers: props.authHeaders },
    );
    if (res.ok) await loadOverlaysList();
  } catch { }
  busy.value = false;
}
async function swapIn() {
  if (busy.value || !currentOverlay.value) return;
  busy.value = true;
  try {
    const res = await fetch(`${API}/overlay/${props.channel}/${currentOverlay.value.id}/swap`, {
      method: "POST",
      headers: { ...props.authHeaders, "Content-Type": "application/json" },
      body: JSON.stringify({ scene: activateScene.value }),
    });
    if (res.ok) await loadOverlaysList();
  } catch { }
  busy.value = false;
}
// ^^^ add/remove/show/hide/swap ^^^

function insertVariableToken(token: string) {
  if (!selectedElement.value) return;
  updateElement(selectedElement.value.id, {
    content: (selectedElement.value.content || "") + token,
  });
}

async function save() {
  if (!currentOverlayId.value) return;
  saving.value = true;
  try {
    const res = await fetch(
      `${API}/overlay/${props.channel}/${currentOverlayId.value}/elements/bulk`,
      {
        method: "PUT",
        headers: { ...props.authHeaders, "Content-Type": "application/json" },
        body: JSON.stringify({
          elements: pendingElements.value.map(toWireElement),
          deletedIds: deletedIds.value,
        }),
      },
    );
    if (res.ok) {
      await loadElements();
    }
  } catch { }
  saving.value = false;
}

function discard() {
  loadElements();
  selectedIds.value = [];
}

function onKeydown(e: KeyboardEvent) {
  if (e.key === "Escape") {
    emit("close");
    return;
  }
  const target = e.target as HTMLElement;
  const isEditable =
    target.tagName === "INPUT" ||
    target.tagName === "TEXTAREA" ||
    target.tagName === "SELECT" ||
    target.isContentEditable;
  if (isEditable) return;
  const mod = e.ctrlKey || e.metaKey;
  if (mod && e.key.toLowerCase() === "z" && e.shiftKey) {
    e.preventDefault();
    redo();
  } else if (mod && e.key.toLowerCase() === "z") {
    e.preventDefault();
    undo();
  } else if (mod && e.key.toLowerCase() === "c") {
    e.preventDefault();
    copySelected();
  } else if (mod && e.key.toLowerCase() === "v") {
    e.preventDefault();
    pasteClipboard();
  } else if (mod && e.key.toLowerCase() === "d") {
    e.preventDefault();
    duplicateSelected();
  } else if (e.key === "Delete" || e.key === "Backspace") {
    e.preventDefault();
    deleteSelected();
  }
}
let previewTimer: ReturnType<typeof setInterval> | null = null;
onMounted(() => {
  load();
  window.addEventListener("keydown", onKeydown);
  previewTimer = setInterval(fetchPreviewValues, 5000);
});
onUnmounted(() => {
  window.removeEventListener("keydown", onKeydown);
  if (previewTimer) clearInterval(previewTimer);
});
</script>

<template>
  <Teleport to="body">
    <div class="ovl-overlay">
      <div class="ovl-modal">
        <div class="ovl-topbar">
          <div class="ovl-switcher">
            <button class="ovl-switcher-nav" title="Previous overlay" :disabled="overlays.length < 2"
              @click="cycleOverlay(-1)" v-html="iconSvgFor('chevron-left')"></button>
            <input v-if="renaming" v-model="renameDraft" class="ovl-switcher-input" autofocus
              @blur="commitRename" @keydown.enter="commitRename"
              @keydown.esc="renaming = false" />
            <button v-else class="ovl-switcher-label" :title="`${overlays.length} overlay(s) - click to rename`"
              @click="startRename">
              {{ currentOverlay?.name || "Stream Overlay" }}
            </button>
            <button class="ovl-switcher-nav" title="Next overlay" :disabled="overlays.length < 2"
              @click="cycleOverlay(1)" v-html="iconSvgFor('chevron-right')"></button>
            <button class="ovl-switcher-nav" title="New overlay" @click="createOverlay"
              v-html="iconSvgFor('plus')"></button>
            <button class="ovl-switcher-nav" title="Delete this overlay" :disabled="overlays.length < 2"
              @click="deleteOverlay" v-html="iconSvgFor('trash')"></button>
          </div>
          <div class="ovl-topbar-actions">
            <div class="ovl-backdrop-swatches" title="Canvas backdrop (editor-only, never rendered live)">
              <button v-for="b in (['checker', 'white', 'black'] as const)" :key="b" class="ovl-backdrop-swatch"
                :class="[b, { active: stageBackdrop === b }]" :title="b" @click="stageBackdrop = b"></button>
            </div>
            <button class="ovl-btn-cancel" :disabled="!historyPast.length" @click="undo" title="Undo (Ctrl+Z)">
              <span v-html="iconSvgFor('corner-up-left')"></span>
            </button>
            <button class="ovl-btn-cancel" :disabled="!historyFuture.length" @click="redo" title="Redo (Ctrl+Shift+Z)">
              <span v-html="iconSvgFor('corner-up-right')"></span>
            </button>
            <button class="ovl-btn-cancel" :disabled="!dirty || saving" @click="discard">Discard</button>
            <button class="ovl-btn-save" :disabled="!dirty || saving" @click="save">
              {{ saving ? "Saving…" : "Save" }}
            </button>
            <button class="ovl-close-btn" title="Close (Esc)" @click="emit('close')" v-html="iconSvgFor('x')"></button>
          </div>
        </div>

        <!-- >>> pinned, stays visible in full-screen just like OBS's own safe-area bar -->
        <div class="ovl-activate-bar">
          <span class="ovl-activate-dot" :class="{ on: overlayVisible }"></span>
          <span class="ovl-activate-status">
            <template v-if="overlayAdded">{{ overlayVisible ? "Live in OBS - " : "Added, hidden - " }}{{
              overlayTargetScene }}</template>
            <template v-else>Not added to any scene yet</template>
          </span>
          <select v-model="activateScene" class="ovl-activate-select" :disabled="overlayAdded">
            <option v-for="s in scenes" :key="s" :value="s">{{ s }}</option>
          </select>
          <template v-if="!overlayAdded">
            <button v-if="occupantOverlay" class="ovl-activate-btn" :disabled="busy || !activateScene"
              :title="`Replaces “${occupantOverlay.name}”, currently attached to this scene`" @click="swapIn">
              {{ busy ? "…" : `Swap in (replaces "${occupantOverlay.name}")` }}
            </button>
            <button v-else class="ovl-activate-btn" :disabled="busy || !activateScene" @click="addToScene">
              {{ busy ? "…" : "Add to scene" }}
            </button>
          </template>
          <template v-else>
            <button class="ovl-activate-btn" :class="{ on: overlayVisible }" :disabled="busy"
              @click="toggleVisibility">
              {{ busy ? "…" : overlayVisible ? "Hide" : "Show" }}
            </button>
            <button class="ovl-activate-btn" :disabled="busy" @click="removeFromScene">
              {{ busy ? "…" : "Remove from scene" }}
            </button>
          </template>
        </div>

        <div class="ovl-content">
          <ObsOverlayElementGallery @add="addElement" />

          <div class="ovl-body">
            <div v-if="loading" class="ovl-loading">loading…</div>
            <ObsOverlayCanvasStage v-else :elements="pendingElements" :selected-ids="selectedIds"
              :base-width="baseWidth" :base-height="baseHeight" :backdrop="stageBackdrop"
              :preview-values="previewValues" @select="onSelect" @update-element="updateElement"
              @update-elements="updateElements" @delete-element="deleteOne" />
          </div>

          <div class="ovl-props">
            <template v-if="selectedElement">
              <div class="ovl-props-title">properties</div>
              <div class="ovl-props-type">{{ selectedElement.type }}</div>

              <template v-if="!['shape', 'audio'].includes(selectedElement.type)">
                <label class="ovl-props-label">
                  {{ selectedElement.type === "image" || selectedElement.type === "video" ? "Media URL" : "Content" }}
                </label>
                <textarea v-if="selectedElement.type === 'text' || selectedElement.type === 'variable-text'"
                  class="ovl-props-textarea" :value="selectedElement.content" :placeholder="selectedElement.type === 'variable-text'
                    ? 'e.g. $counter.wins'
                    : 'Text to show'
                    "
                  @input="updateElement(selectedElement.id, { content: ($event.target as HTMLTextAreaElement).value })" />
                <input v-else class="ovl-props-input" :value="selectedElement.content" placeholder="https://…"
                  @input="updateElement(selectedElement.id, { content: ($event.target as HTMLInputElement).value })" />

                <ObsOverlayVariablePicker v-if="selectedElement.type === 'variable-text'" :channel="channel"
                  :auth-headers="authHeaders" @insert="insertVariableToken" />
              </template>

              <ObsOverlayStylePanel :element="selectedElement!"
                @update="(patch) => updateElement(selectedElement!.id, patch)" />

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
            <div v-else-if="selectedIds.length > 1" class="ovl-props-empty">
              {{ selectedIds.length }} elements selected.
              <button class="ovl-btn-delete" @click="deleteSelected">
                <span v-html="iconSvgFor('trash')"></span> Delete all
              </button>
            </div>
            <div v-else class="ovl-props-empty">Select an element, or add one from the gallery.</div>

            <ObsOverlayLayersPanel :elements="pendingElements" :selected-ids="selectedIds" @select="onSelect"
              @toggle-lock="toggleLock" @toggle-visible="toggleVisible" @update-elements="updateElements"
              @group="groupSelected" @ungroup="ungroupSelected" />
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
  max-width: 1600px;
  height: 100%;
  max-height: 920px;
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

.ovl-switcher {
  display: flex;
  align-items: center;
  gap: 4px;
}

.ovl-switcher-nav {
  width: 24px;
  height: 24px;
  display: flex;
  align-items: center;
  justify-content: center;
  border: 1px solid #2a2a30;
  background: #111217;
  color: #888;
  cursor: pointer;
  flex-shrink: 0;
}

.ovl-switcher-nav svg {
  width: 11px;
  height: 11px;
}

.ovl-switcher-nav:hover:not(:disabled) {
  border-color: #6f2bff;
  color: #9d6cff;
}

.ovl-switcher-nav:disabled {
  opacity: 0.35;
  cursor: not-allowed;
}

.ovl-switcher-label,
.ovl-switcher-input {
  height: 24px;
  padding: 0 8px;
  color: #e0e0e0;
  font-weight: 700;
  font-size: 13px;
  font-family: inherit;
  border: 1px solid transparent;
  background: transparent;
  cursor: pointer;
  max-width: 220px;
  text-overflow: ellipsis;
  overflow: hidden;
  white-space: nowrap;
}

.ovl-switcher-label:hover {
  border-color: #2a2a30;
}

.ovl-switcher-input {
  border-color: #6f2bff88;
  background: #111217;
  cursor: text;
  outline: none;
}

.ovl-topbar-actions {
  display: flex;
  align-items: center;
  gap: 8px;
}

.ovl-activate-bar {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 8px 16px;
  flex-shrink: 0;
  border-bottom: 1px solid #1e1e22;
  background: #0d0d10;
}

.ovl-activate-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: #555;
  flex-shrink: 0;
}

.ovl-activate-dot.on {
  background: #4ec9b0;
  box-shadow: 0 0 6px #4ec9b0aa;
}

.ovl-activate-status {
  color: #888;
  font-size: 12px;
  margin-right: auto;
}

.ovl-activate-select {
  height: 30px;
  padding: 0 8px;
  border: 1px solid #2a2a30;
  background: #111217;
  color: #ccc;
  font-family: inherit;
  font-size: 12px;
}

.ovl-activate-select:disabled {
  opacity: 0.6;
}

.ovl-activate-btn {
  height: 30px;
  padding: 0 16px;
  border: 1px solid #2a2a30;
  background: #111217;
  color: #ccc;
  font-family: inherit;
  font-size: 12px;
  font-weight: 600;
  cursor: pointer;
}

.ovl-activate-btn:hover:not(:disabled) {
  border-color: #6f2bff;
  color: #9d6cff;
}

.ovl-activate-btn.on {
  background: #f1494922;
  border-color: #f1494966;
  color: #f68f8f;
}

.ovl-activate-btn.on:hover:not(:disabled) {
  border-color: #f14949;
  color: #f14949;
}

.ovl-activate-btn:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}

.ovl-backdrop-swatches {
  display: flex;
  align-items: center;
  gap: 4px;
  height: 30px;
  padding: 0 8px;
  border: 1px solid #2a2a30;
  background: #111217;
}

.ovl-backdrop-swatch {
  width: 16px;
  height: 16px;
  border: 1px solid #444;
  cursor: pointer;
  padding: 0;
}

.ovl-backdrop-swatch.checker {
  background: repeating-conic-gradient(#1a1a1e 0% 25%, #2a2a30 0% 50%) 50% / 8px 8px;
}

.ovl-backdrop-swatch.white {
  background: #ffffff;
}

.ovl-backdrop-swatch.black {
  background: #000000;
}

.ovl-backdrop-swatch.active {
  border-color: #6f2bff;
  outline: 1px solid #6f2bff;
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
  display: inline-flex;
  align-items: center;
  gap: 6px;
}

.ovl-btn-cancel svg {
  width: 12px;
  height: 12px;
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
  width: 270px;
  flex-shrink: 0;
  border-left: 1px solid #1e1e22;
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 10px 12px;
  overflow-y: auto;
  scrollbar-width: none;
}

.ovl-props::-webkit-scrollbar {
  display: none;
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
  min-height: 50px;
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
  display: flex;
  flex-direction: column;
  gap: 8px;
  align-items: flex-start;
}

</style>
