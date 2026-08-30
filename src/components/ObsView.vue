<script setup lang="ts">
import { ref, computed, onMounted, watch } from "vue";
import { API } from "../api";
import { useAuth } from "../auth";
import { useI18n } from "../i18n";
import { useOverlayClose } from "../composables/useOverlayClose";
import EditableNameHeader from "./shared/EditableNameHeader.vue";
import RefPanel from "./shared/RefPanel.vue";
import { iconSvg as iconSvgFor } from "../composables/icons";

const { session, channelRole } = useAuth();
const { t } = useI18n();

const canEdit = computed(
  () =>
    channelRole.value?.role === "broadcaster" ||
    channelRole.value?.permissions?.automations_edit,
);

interface Widget {
  id: string;
  name: string;
  content: string;
  style: string;
  refresh_ms: number;
  created_at: number;
}

const widgets = ref<Widget[]>([]);
const loading = ref(false);
const saving = ref(false);
const deleteId = ref<string | null>(null);
const copied = ref("");
const saveError = ref("");
const saveSuccess = ref("");

const editOpen = ref(false);
const overlay = useOverlayClose();
const isNew = ref(false);
const editOrigName = ref(""); // <<< old name, needed for the PUT/DELETE
const contentInputEl = ref<HTMLInputElement | null>(null);
const form = ref({
  name: "",
  content: "",
  refresh_ms: 5000,
  style: {
    fontSize: 48,
    color: "#ffffff",
    fontFamily: "sans-serif",
    fontWeight: "bold",
    textAlign: "left",
    stroke: false,
    strokeColor: "#000000",
    shadow: false,
    shadowColor: "rgba(0,0,0,0.8)",
    padding: 8,
    background: "",
  },
});

const previewValue = ref("…");
const previewing = ref(false);

const widgetUrl = (id: string) => `https://obs.shyboti.de/${id}`;

async function load() {
  if (!session.value) return;
  const ch = session.value.channel;
  loading.value = true;
  try {
    const res = await fetch(`${API}/obs-widgets/${ch}`, {
      headers: { Authorization: `Bearer ${session.value.token}` },
    });
    if (res.ok) {
      const d = (await res.json()) as { widgets: Widget[] };
      if (session.value?.channel !== ch) return;
      widgets.value = d.widgets;
    }
  } catch { }
  if (session.value?.channel === ch) loading.value = false;
}

function openNew() {
  isNew.value = true;
  editOrigName.value = "";
  form.value = {
    name: "",
    content: "",
    refresh_ms: 5000,
    style: {
      fontSize: 48,
      color: "#ffffff",
      fontFamily: "sans-serif",
      fontWeight: "bold",
      textAlign: "left",
      stroke: false,
      strokeColor: "#000000",
      shadow: false,
      shadowColor: "rgba(0,0,0,0.8)",
      padding: 8,
      background: "",
    },
  };
  previewValue.value = "…";
  saveError.value = "";
  editOpen.value = true;
}

function openEdit(w: Widget) {
  isNew.value = false;
  editOrigName.value = w.name;
  const s = (() => {
    try {
      return JSON.parse(w.style);
    } catch {
      return {};
    }
  })();
  form.value = {
    name: w.name,
    content: w.content,
    refresh_ms: w.refresh_ms,
    style: {
      fontSize: s.fontSize ?? 48,
      color: s.color ?? "#ffffff",
      fontFamily: s.fontFamily ?? "sans-serif",
      fontWeight: s.fontWeight ?? "bold",
      textAlign: s.textAlign ?? "left",
      stroke: s.stroke ?? false,
      strokeColor: s.strokeColor ?? "#000000",
      shadow: s.shadow ?? false,
      shadowColor: s.shadowColor ?? "rgba(0,0,0,0.8)",
      padding: s.padding ?? 8,
      background: s.background ?? "",
    },
  };
  previewValue.value = "…";
  saveError.value = "";
  editOpen.value = true;
}

// >>> inserts at the content input's cursor
function insertRefToken(token: string) {
  const el = contentInputEl.value;
  const cur = form.value.content;
  if (el && document.activeElement === el && el.selectionStart != null) {
    const start = el.selectionStart,
      end = el.selectionEnd ?? start;
    form.value.content = cur.slice(0, start) + token + cur.slice(end);
    requestAnimationFrame(() => {
      el.focus();
      el.setSelectionRange(start + token.length, start + token.length);
    });
  } else {
    form.value.content = cur + token;
  }
}

async function previewContent() {
  if (!session.value || !form.value.content.trim()) return;
  previewing.value = true;
  try {
    const res = await fetch(
      `${API}/obs-widgets/${session.value.channel}/___preview`,
      {
        method: "PUT",
        headers: {
          Authorization: `Bearer ${session.value.token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          content: form.value.content,
          style: form.value.style,
          refresh_ms: 9999999,
        }),
      },
    );
    if (res.ok) {
      const d = (await res.json()) as { id: string };
      const r2 = await fetch(`${API}/obs/${d.id}/data`);
      if (r2.ok)
        previewValue.value =
          ((await r2.json()) as { value: string }).value || "(empty)";
    }
  } catch { }
  // >>> reuses the real save endpoint for a throwaway eval
  try {
    await fetch(`${API}/obs-widgets/${session.value.channel}/___preview`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${session.value.token}` },
    });
  } catch { }
  previewing.value = false;
}

async function save() {
  if (!session.value || !form.value.name.trim()) return;
  saving.value = true;
  saveError.value = "";
  try {
    const name = form.value.name.trim();
    const res = await fetch(
      `${API}/obs-widgets/${session.value.channel}/${encodeURIComponent(name)}`,
      {
        method: "PUT",
        headers: {
          Authorization: `Bearer ${session.value.token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          content: form.value.content,
          style: form.value.style,
          refresh_ms: form.value.refresh_ms,
        }),
      },
    );
    if (!res.ok) {
      const d = (await res.json()) as any;
      throw new Error(d.error ?? "Save failed");
    }

    if (!isNew.value && editOrigName.value && editOrigName.value !== name) {
      await fetch(
        `${API}/obs-widgets/${session.value.channel}/${encodeURIComponent(editOrigName.value)}`,
        {
          method: "DELETE",
          headers: { Authorization: `Bearer ${session.value.token}` },
        },
      ).catch(() => { });
    }
    saveSuccess.value = "Saved!";
    setTimeout(() => (saveSuccess.value = ""), 2000);
    editOpen.value = false;
    load();
  } catch (e: any) {
    saveError.value = e.message ?? "Failed";
  }
  saving.value = false;
}

async function deleteWidget(id: string, name: string) {
  if (deleteId.value !== id) {
    deleteId.value = id;
    setTimeout(() => {
      if (deleteId.value === id) deleteId.value = null;
    }, 3000);
    return;
  }
  deleteId.value = null;
  if (!session.value) return;
  await fetch(
    `${API}/obs-widgets/${session.value.channel}/${encodeURIComponent(name)}`,
    {
      method: "DELETE",
      headers: { Authorization: `Bearer ${session.value.token}` },
    },
  );
  widgets.value = widgets.value.filter((w) => w.id !== id);
}

function copyUrl(id: string, key: string) {
  navigator.clipboard.writeText(widgetUrl(id)).catch(() => { });
  copied.value = key;
  setTimeout(() => {
    if (copied.value === key) copied.value = "";
  }, 1500);
}

function fmtDate(ts: number) {
  return new Date(ts).toLocaleDateString([], {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

const previewStyle = computed(() => {
  const s = form.value.style;
  const shadows: string[] = [];
  if (s.stroke) {
    const c = s.strokeColor;
    shadows.push(
      `-2px -2px 0 ${c}`,
      `2px -2px 0 ${c}`,
      `-2px 2px 0 ${c}`,
      `2px 2px 0 ${c}`,
    );
  }
  return {
    fontFamily: s.fontFamily,
    fontSize: `${s.fontSize}px`,
    color: s.color,
    fontWeight: s.fontWeight,
    textAlign: s.textAlign as any,
    textShadow: shadows.join(", ") || undefined,
    filter: s.shadow ? `drop-shadow(2px 2px 4px ${s.shadowColor})` : undefined,
    padding: `${s.padding}px`,
    background: s.background || "transparent",
  };
});

const FONT_FAMILIES = [
  { label: "Sans-serif", value: "sans-serif" },
  { label: "Monospace", value: "monospace" },
  { label: "Serif", value: "serif" },
  { label: "Impact", value: "Impact, fantasy" },
  { label: "Arial", value: "Arial, sans-serif" },
  { label: "Courier", value: '"Courier New", monospace' },
];

onMounted(load);
watch(() => session.value?.channel, load);
</script>

<template>
  <div class="ep-view">
    <div class="ep-view-header">
      <div>
        <div class="ep-view-title">{{ t("obs.title") }}</div>
        <div class="ep-view-sub">{{ widgets.length }} widget{{ widgets.length === 1 ? '' : 's' }}</div>
      </div>
      <div class="ep-view-header-right">
        <button class="ep-btn-reload" @click="load" :title="t('obs.reload')" v-html="iconSvgFor('refresh-cw')"></button>
        <button class="ep-btn-new" @click="openNew" :disabled="!canEdit">
          + {{ t("obs.new") }}
        </button>
      </div>
    </div>

    <div v-if="saveSuccess" class="ep-toast success">{{ saveSuccess }}</div>

    <div v-if="loading" class="ep-row-list">
      <div class="ep-skeleton-row" v-for="i in 6" :key="i">
        <div class="ep-skeleton-block ep-skeleton-square"></div>
        <div class="ep-skeleton-lines">
          <div class="ep-skeleton-block ep-skeleton-line title"></div>
          <div class="ep-skeleton-block ep-skeleton-line meta"></div>
        </div>
        <div class="ep-skeleton-actions">
          <div class="ep-skeleton-block ep-skeleton-btn"></div>
          <div class="ep-skeleton-block ep-skeleton-btn icon"></div>
        </div>
      </div>
    </div>
    <div v-else-if="!widgets.length" class="ep-empty">
      {{ t("obs.empty") }}<br />
      <span class="empty-hint">{{ t("obs.empty.hint") }}</span>
    </div>

    <div v-else class="ep-row-list">
      <div v-for="w in widgets" :key="w.id" class="ep-row-grid widget-row">
        <div class="ep-row-cell-center">
          <div class="widget-icon">
            <svg viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg">
              <rect x="1" y="3" width="18" height="12" rx="2" stroke="currentColor" stroke-width="1.5" />
              <path d="M7 18h6M10 15v3" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" />
            </svg>
          </div>
        </div>
        <div class="widget-info ep-row-cell-hover" @click="canEdit && openEdit(w)">
          <div class="widget-name">{{ w.name }}</div>
          <code class="widget-content">{{ w.content.slice(0, 60)
          }}{{ w.content.length > 60 ? "…" : "" }}</code>
          <div class="widget-meta">
            <span v-html="iconSvgFor('refresh-cw')"></span> {{ t('obs.every') }} {{ w.refresh_ms / 1000 }}s · {{
              fmtDate(w.created_at) }}
          </div>
        </div>
        <div class="widget-actions">
          <div class="url-row">
            <code class="widget-url">obs.shyboti.de/{{ w.id }}</code>
            <button class="copy-btn" @click="copyUrl(w.id, w.id)">
              <span v-if="copied === w.id" v-html="iconSvgFor('check')"></span>
              <template v-else>{{ t("obs.copy") }}</template>
            </button>
          </div>
          <div class="row-btns">
            <button class="ep-btn-action edit" @click="canEdit && openEdit(w)">
              {{ t("obs.edit") }}
            </button>
            <button class="ep-btn-action del" :class="{ confirm: deleteId === w.id }"
              @click="deleteWidget(w.id, w.name)">
              <template v-if="deleteId === w.id">{{ t("obs.delete.confirm") }}</template>
              <span v-else v-html="iconSvgFor('x')"></span>
            </button>
          </div>
        </div>
      </div>
    </div>

    <Teleport to="body">
      <div v-if="editOpen" class="ep-overlay" v-bind="overlay.handlers(() => (editOpen = false))">
        <div class="ep-panel">
          <div class="ep-panel-header">
            <div>
              <div class="ep-panel-title">
                <template v-if="isNew">{{ t("obs.panel.new") }}</template>
                <template v-else>
                  {{ t("obs.panel.edit") }}
                  <EditableNameHeader v-model="form.name" :orig-name="editOrigName" placeholder="kills-counter" />
                </template>
              </div>
              <div class="ep-panel-sub">#{{ session?.channel }}</div>
            </div>
            <button class="ep-panel-close" @click="editOpen = false" v-html="iconSvgFor('x')"></button>
          </div>

          <div class="ep-panel-body">
            <!-- >>> renames happen via the header title -->
            <div v-if="isNew" class="ep-field-group">
              <label class="ep-field-label">{{ t("obs.panel.name") }}
                <span class="ep-field-hint">{{
                  t("obs.panel.name.hint")
                  }}</span></label>
              <input v-model="form.name" class="ep-field-input" placeholder="kills-counter" />
            </div>

            <div class="ep-field-group">
              <label class="ep-field-label">{{ t("obs.panel.content") }}
                <span class="ep-field-hint">{{
                  t("obs.panel.content.hint")
                  }}</span></label>
              <input ref="contentInputEl" v-model="form.content" class="ep-field-input ep-mono"
                placeholder="$counter.kills.get" />
            </div>

            <!-- >>> click a row to insert into content above -->
            <RefPanel :title="t('obs.panel.ref')" @insert="insertRefToken" />

            <div class="preview-section">
              <div class="preview-bar">
                <span class="ep-field-label">{{ t("obs.panel.preview") }}</span>
                <button class="preview-btn" @click="previewContent" :disabled="previewing || !form.content.trim()">
                  {{
                    previewing
                      ? t("obs.panel.preview.eval")
                      : t("obs.panel.preview.run")
                  }}
                </button>
              </div>
              <div class="preview-box" :style="{ background: form.style.background || '#111217' }">
                <div class="preview-val" :style="previewStyle">
                  {{ previewValue }}
                </div>
              </div>
            </div>

            <div class="ep-field-group">
              <label class="ep-field-label">{{ t("obs.panel.refresh") }}</label>
              <div class="refresh-row">
                <button v-for="ms in [1000, 2000, 5000, 10000, 30000]" :key="ms" class="ms-btn"
                  :class="{ active: form.refresh_ms === ms }" @click="form.refresh_ms = ms">
                  {{ ms >= 1000 ? `${ms / 1000}s` : `${ms}ms` }}
                </button>
                <input v-model.number="form.refresh_ms" type="number" min="500" class="ep-field-input ms-custom" />
              </div>
            </div>

            <div class="obs-cache-hint">{{ t("obs.panel.cache.hint") }}</div>

            <div class="style-section">
              <div class="style-title">{{ t("obs.panel.style") }}</div>
              <div class="style-grid">
                <div class="ep-field-group">
                  <label class="ep-field-label">{{
                    t("obs.panel.size")
                    }}</label>
                  <input v-model.number="form.style.fontSize" type="number" min="8" max="200" class="ep-field-input" />
                </div>
                <div class="ep-field-group">
                  <label class="ep-field-label">{{
                    t("obs.panel.color")
                    }}</label>
                  <div class="color-row">
                    <input type="color" v-model="form.style.color" class="color-pick" />
                    <input v-model="form.style.color" class="ep-field-input" placeholder="#ffffff" />
                  </div>
                </div>
                <div class="ep-field-group">
                  <label class="ep-field-label">{{
                    t("obs.panel.font")
                    }}</label>
                  <select v-model="form.style.fontFamily" class="ep-field-select">
                    <option v-for="f in FONT_FAMILIES" :key="f.value" :value="f.value">
                      {{ f.label }}
                    </option>
                  </select>
                </div>
                <div class="ep-field-group">
                  <label class="ep-field-label">{{
                    t("obs.panel.weight")
                    }}</label>
                  <select v-model="form.style.fontWeight" class="ep-field-select">
                    <option value="normal">
                      {{ t("obs.panel.weight.normal") }}
                    </option>
                    <option value="bold">
                      {{ t("obs.panel.weight.bold") }}
                    </option>
                    <option value="900">
                      {{ t("obs.panel.weight.black") }}
                    </option>
                  </select>
                </div>
                <div class="ep-field-group">
                  <label class="ep-field-label">{{
                    t("obs.panel.align")
                    }}</label>
                  <select v-model="form.style.textAlign" class="ep-field-select">
                    <option value="left">
                      {{ t("obs.panel.align.left") }}
                    </option>
                    <option value="center">
                      {{ t("obs.panel.align.center") }}
                    </option>
                    <option value="right">
                      {{ t("obs.panel.align.right") }}
                    </option>
                  </select>
                </div>
                <div class="ep-field-group">
                  <label class="ep-field-label">{{
                    t("obs.panel.padding")
                    }}</label>
                  <input v-model.number="form.style.padding" type="number" min="0" class="ep-field-input" />
                </div>
              </div>
              <div class="toggle-row">
                <label class="toggle-label"><input type="checkbox" v-model="form.style.stroke" />
                  {{ t("obs.panel.stroke") }}</label>
                <input v-if="form.style.stroke" type="color" v-model="form.style.strokeColor" class="color-pick" />
              </div>
              <div class="toggle-row">
                <label class="toggle-label"><input type="checkbox" v-model="form.style.shadow" />
                  {{ t("obs.panel.shadow") }}</label>
              </div>
              <div class="ep-field-group">
                <label class="ep-field-label">{{ t("obs.panel.bg") }}
                  <span class="ep-field-hint">{{
                    t("obs.panel.bg.hint")
                    }}</span></label>
                <div class="color-row">
                  <input type="color" v-model="form.style.background" class="color-pick" />
                  <input v-model="form.style.background" class="ep-field-input" placeholder="transparent" />
                  <button class="clear-btn" @click="form.style.background = ''">
                    {{ t("obs.panel.bg.clear") }}
                  </button>
                </div>
              </div>
            </div>
          </div>

          <div class="ep-panel-footer">
            <div v-if="saveError" class="save-error">{{ saveError }}</div>
            <div v-else></div>
            <div class="ep-footer-right">
              <button class="ep-btn-cancel" @click="editOpen = false">
                {{ t("obs.panel.cancel") }}
              </button>
              <button class="ep-btn-save" @click="save" :disabled="saving || !form.name.trim() || !form.content.trim()">
                {{ saving ? t("obs.panel.saving") : t("obs.panel.save") }}
              </button>
            </div>
          </div>
        </div>
      </div>
    </Teleport>
  </div>
</template>

<style scoped>
.empty-hint {
  color: #333;
  font-size: 11px;
}

.widget-row {
  grid-template-columns: 44px 1fr auto;
}

.widget-icon {
  width: 28px;
  flex-shrink: 0;
  color: #9d6cff;
  opacity: 0.7;
}

.widget-icon svg {
  width: 22px;
  height: 22px;
}

.widget-info {
  display: flex;
  flex-direction: column;
  justify-content: center;
  gap: 2px;
  min-width: 0;
  padding: 0 6px;
}

.widget-name {
  font-size: 13px;
  font-weight: 600;
  color: #e0e0e0;
  margin-bottom: 3px;
}

.widget-content {
  font-family: "Consolas", "Fira Mono", monospace;
  font-size: 11px;
  color: #9d6cff;
  display: block;
  margin-bottom: 3px;
}

.widget-meta {
  font-size: 10px;
  color: #444;
}

.widget-actions {
  display: flex;
  flex-direction: column;
  gap: 6px;
  align-items: flex-end;
  flex-shrink: 0;
}

.url-row {
  display: flex;
  align-items: center;
  gap: 6px;
}

.widget-url {
  font-family: "Consolas", "Fira Mono", monospace;
  font-size: 10px;
  color: #555;
}

.copy-btn {
  height: 22px;
  padding: 0 10px;
  border: 1px solid #6f2bff44;
  background: transparent;
  color: #9d6cff;
  font-family: inherit;
  font-size: 10px;
  cursor: pointer;
  white-space: nowrap;
}

.copy-btn:hover {
  background: #6f2bff18;
}

.row-btns {
  display: flex;
  gap: 5px;
}

.save-error {
  font-size: 11px;
  color: #f14949;
}

.preview-section {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.preview-bar {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.preview-btn {
  height: 24px;
  padding: 0 12px;
  border: 1px solid #6f2bff44;
  background: transparent;
  color: #9d6cff;
  font-family: inherit;
  font-size: 11px;
  cursor: pointer;
}

.preview-btn:hover:not(:disabled) {
  background: #6f2bff18;
}

.preview-btn:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}

.preview-box {
  min-height: 52px;
  padding: 12px;
  display: flex;
  align-items: center;
  border: 1px solid #2a2a30;
}

.preview-val {
  max-width: 100%;
  word-break: break-word;
}

.refresh-row {
  display: flex;
  align-items: center;
  gap: 5px;
  flex-wrap: wrap;
}

.ms-btn {
  height: 30px;
  padding: 0 10px;
  border: 1px solid #2a2a30;
  background: transparent;
  color: #666;
  font-family: inherit;
  font-size: 11px;
  cursor: pointer;
}

.ms-btn:hover {
  border-color: #6f2bff44;
  color: #9d6cff;
}

.ms-btn.active {
  border-color: #6f2bff;
  color: #9d6cff;
  background: #6f2bff18;
}

.ms-custom {
  width: 70px;
  flex-shrink: 0;
}

.style-section {
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 12px;
  background: #111217;
  border: 1px solid #1e1e24;
}

.style-title {
  font-size: 10px;
  font-weight: 700;
  color: #555;
  text-transform: uppercase;
  letter-spacing: 0.06em;
}

.style-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 10px;
}

.color-row {
  display: flex;
  align-items: center;
  gap: 6px;
}

.color-pick {
  width: 32px;
  height: 32px;
  border: 1px solid #2a2a30;
  padding: 2px;
  background: #111217;
  cursor: pointer;
  flex-shrink: 0;
}

.color-row .ep-field-input {
  flex: 1;
}

.toggle-row {
  display: flex;
  align-items: center;
  gap: 8px;
}

.toggle-label {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 12px;
  color: #888;
  cursor: pointer;
  user-select: none;
}

.toggle-label input[type="checkbox"] {
  width: 14px;
  height: 14px;
  accent-color: #9d6cff;
  cursor: pointer;
}

.clear-btn {
  height: 32px;
  padding: 0 10px;
  border: 1px solid #2a2a30;
  background: transparent;
  color: #555;
  font-family: inherit;
  font-size: 11px;
  cursor: pointer;
  flex-shrink: 0;
}

.clear-btn:hover {
  color: #e0e0e0;
  border-color: #444;
}

.obs-cache-hint {
  font-size: 11px;
  color: #555;
  background: #111217;
  border: 1px solid #1e1e24;
  padding: 8px 12px;
  line-height: 1.6;
}

@media (max-width: 680px) {
  .style-grid {
    grid-template-columns: 1fr;
  }

  .widget-row {
    grid-template-columns: 36px 1fr;
  }

  .widget-actions {
    grid-column: 1 / -1;
    align-items: flex-start;
    width: 100%;
  }
}
</style>
