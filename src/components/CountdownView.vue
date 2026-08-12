<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted, watch, nextTick } from "vue";
import { API } from "../api";
import { useAuth } from "../auth";
import { useI18n } from "../i18n";
import {
  applyScriptHighlight,
  insertTokenAtCursor,
  setEditorContent,
} from "../composables/useContentEditableScript";
import { useOverlayClose } from "../composables/useOverlayClose";
import EditableNameHeader from "./shared/EditableNameHeader.vue";
import RefPanel from "./shared/RefPanel.vue";

const { session, channelRole } = useAuth();
const { t } = useI18n();

const canToggle = computed(
  () => channelRole.value?.permissions.automations_toggle ?? false,
);
const canEdit = computed(
  () => channelRole.value?.permissions.automations_edit ?? false,
);
const canDelete = computed(
  () => channelRole.value?.permissions.automations_delete ?? false,
);

interface Countdown {
  id: number;
  name: string;
  duration_sec: number;
  msg_start: string;
  msg_tick: string;
  tick_every_sec: number;
  msg_end: string;
  enabled_when: string;
  condition: string;
  is_active: number;
  status: "idle" | "running" | "finished";
  started_at: number | null;
}

const countdowns = ref<Countdown[]>([]);
const loading = ref(false);
const saving = ref<string | null>(null);
const error = ref("");
const success = ref("");

// >>> Edit panel <<<
const editOpen = ref(false);
const isNew = ref(false);
const editOrigName = ref(""); // <<< name before rename, so we know which row to delete
const overlay = useOverlayClose();
const editCountdown = ref<Partial<Countdown> & { name: string }>({
  name: "",
  duration_sec: 60,
  msg_start: "",
  msg_tick: "",
  tick_every_sec: 10,
  msg_end: "",
  enabled_when: "always",
  condition: "",
  is_active: 1,
});

const startEditorRef = ref<HTMLDivElement | null>(null);
const tickEditorRef = ref<HTMLDivElement | null>(null);
const endEditorRef = ref<HTMLDivElement | null>(null);
// >>> ref panel inserts into whichever message editor was last focused
const activeField = ref<"msg_start" | "msg_tick" | "msg_end">("msg_start");
const FIELD_REFS = {
  msg_start: startEditorRef,
  msg_tick: tickEditorRef,
  msg_end: endEditorRef,
};

function showSuccess(msg: string) {
  success.value = msg;
  setTimeout(() => (success.value = ""), 3000);
}

function fmtDuration(s: number) {
  if (s >= 3600)
    return `${Math.floor(s / 3600)}h ${Math.floor((s % 3600) / 60)}m`;
  if (s >= 60) return `${Math.floor(s / 60)}m ${s % 60}s`;
  return `${s}s`;
}

function fmtRemaining(cd: Countdown): string {
  void tick.value; // subscribe to tick so Vue re-runs this on every second
  if (cd.status !== "running" || !cd.started_at)
    return fmtDuration(cd.duration_sec);
  const elapsed = Math.floor((Date.now() - cd.started_at) / 1000);
  const rem = Math.max(0, cd.duration_sec - elapsed);
  return fmtDuration(rem);
}

// >>> Tick: recompute remaining every second <<<
const tick = ref(0);
let tickInterval: ReturnType<typeof setInterval> | null = null;
let pollInterval: ReturnType<typeof setInterval> | null = null;

onMounted(() => {
  tickInterval = setInterval(() => {
    tick.value++;
    // >>> backend auto-idles a finished countdown, mirror that locally so ui updates without a reload
    for (const cd of countdowns.value) {
      if (cd.status !== "running" || !cd.started_at) continue;
      const elapsed = Math.floor((Date.now() - cd.started_at) / 1000);
      if (elapsed >= cd.duration_sec) {
        cd.status = "idle";
        cd.started_at = null;
      }
    }
  }, 1000);
  // >>> poll too, so external triggers like $countdown.x.start show up here
  pollInterval = setInterval(load, 5000);
  load();
});
onUnmounted(() => {
  if (tickInterval) clearInterval(tickInterval);
  if (pollInterval) clearInterval(pollInterval);
});
watch(() => session.value?.channel, load);

async function load() {
  if (!session.value) return;
  loading.value = true;
  error.value = "";
  try {
    const res = await fetch(`${API}/countdowns/${session.value.channel}`, {
      headers: { Authorization: `Bearer ${session.value.token}` },
    });
    const data = await res.json().catch(() => null);
    if (!res.ok) throw new Error(data?.error ?? `Load failed (${res.status})`);
    countdowns.value = (data as { countdowns: Countdown[] })?.countdowns ?? [];
  } catch (e: any) {
    error.value = e.message ?? "Could not load countdowns.";
  }
  loading.value = false;
}

function openNew() {
  error.value = "";
  isNew.value = true;
  editOrigName.value = "";
  editCountdown.value = {
    name: "",
    duration_sec: 60,
    msg_start: "",
    msg_tick: "",
    tick_every_sec: 10,
    msg_end: "",
    enabled_when: "always",
    condition: "",
    is_active: 1,
  };
  editOpen.value = true;
  activeField.value = "msg_start";
  setTimeout(() => {
    initEditors();
  }, 50);
}

function openEdit(cd: Countdown) {
  error.value = "";
  isNew.value = false;
  editOrigName.value = cd.name;
  editCountdown.value = { ...cd };
  editOpen.value = true;
  activeField.value = "msg_start";
  setTimeout(() => {
    initEditors();
  }, 50);
}

function initEditors() {
  for (const [ref_, field] of [
    [startEditorRef.value, "msg_start"],
    [tickEditorRef.value, "msg_tick"],
    [endEditorRef.value, "msg_end"],
  ] as [HTMLDivElement | null, keyof typeof editCountdown.value][]) {
    if (ref_) {
      const val = String(editCountdown.value[field] ?? "");
      setEditorContent(ref_, val);
    }
  }
}

function onEditorInput(
  el: HTMLDivElement | null,
  field: "msg_start" | "msg_tick" | "msg_end",
) {
  if (!el) return;
  editCountdown.value[field] = el.innerText.replace(/\n$/, "");
  applyScriptHighlight(el);
}

// >>> inserts into whichever message editor was last focused
function insertRefToken(token: string) {
  const el = FIELD_REFS[activeField.value].value;
  if (!el) return;
  editCountdown.value[activeField.value] = insertTokenAtCursor(el, token);
}

const isBroadcaster = computed(() => channelRole.value?.role === "broadcaster");

async function saveCountdown() {
  if (!session.value) return;
  if (!canEdit.value && !isBroadcaster.value) return;
  if (!editCountdown.value.name?.trim()) {
    error.value = t("edit.missing_fields") + t("countdown.field.name");
    return;
  }
  saving.value = editCountdown.value.name;
  error.value = "";
  try {
    // >>> Build the body explicitly - exclude 'id' and non-DB fields
    const body = {
      duration_sec: editCountdown.value.duration_sec ?? 60,
      msg_start: editCountdown.value.msg_start ?? "",
      msg_tick: editCountdown.value.msg_tick ?? "",
      tick_every_sec: editCountdown.value.tick_every_sec ?? 10,
      msg_end: editCountdown.value.msg_end ?? "",
      enabled_when: editCountdown.value.enabled_when ?? "always",
      condition: editCountdown.value.condition ?? "",
      is_active: editCountdown.value.is_active ?? 1,
    };
    const name = editCountdown.value.name.trim();
    const res = await fetch(
      `${API}/countdowns/${session.value.channel}/${encodeURIComponent(name)}`,
      {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${session.value.token}`,
        },
        body: JSON.stringify(body),
      },
    );
    if (!res.ok) {
      const errData = await res
        .json()
        .catch(() => ({ error: `HTTP ${res.status}` }));
      throw new Error(errData.error ?? `Save failed (${res.status})`);
    }
    // >>> renamed, old-named row is now a stale duplicate, delete it
    if (!isNew.value && editOrigName.value && editOrigName.value !== name) {
      await fetch(
        `${API}/countdowns/${session.value.channel}/${encodeURIComponent(editOrigName.value)}`,
        {
          method: "DELETE",
          headers: { Authorization: `Bearer ${session.value.token}` },
        },
      ).catch(() => { });
    }
    showSuccess(t("countdown.save") + "!");
    editOpen.value = false;
    await load();
  } catch (e: any) {
    error.value = e.message ?? "Could not save countdown.";
  } finally {
    saving.value = null;
  }
}

async function deleteCountdown(name: string) {
  if (!session.value) return;
  saving.value = name;
  try {
    await fetch(
      `${API}/countdowns/${session.value.channel}/${encodeURIComponent(name)}`,
      {
        method: "DELETE",
        headers: { Authorization: `Bearer ${session.value.token}` },
      },
    );
    countdowns.value = countdowns.value.filter((c) => c.name !== name);
    if (editOpen.value && editCountdown.value.name === name)
      editOpen.value = false;
  } catch {
    error.value = "Could not delete countdown.";
  }
  saving.value = null;
}

async function controlCountdown(
  name: string,
  action: "start" | "stop" | "reset",
) {
  if (!session.value) return;
  try {
    const res = await fetch(
      `${API}/countdowns/${session.value.channel}/${encodeURIComponent(name)}/${action}`,
      {
        method: "POST",
        headers: { Authorization: `Bearer ${session.value.token}` },
      },
    );
    if (res.ok) {
      const data = (await res.json()) as any;
      const cd = countdowns.value.find((c) => c.name === name);
      if (cd) {
        cd.status =
          data.status ??
          (action === "start"
            ? "running"
            : action === "reset"
              ? "idle"
              : "idle");
        cd.started_at =
          data.started_at ?? (action === "start" ? Date.now() : null);
      }
    }
  } catch { }
}

// >>> Header (title/count/create) lives in AutomationsView.vue - expose what it needs
defineExpose({
  header: computed(() => ({
    count: countdowns.value.length,
    countLabel: t("auto.countdowns"),
    createLabel: t("countdown.new"),
    canCreate: canEdit.value || isBroadcaster.value,
  })),
  reload: load,
  create: () => {
    (canEdit.value || isBroadcaster.value) && openNew();
  },
  close: () => {
    editOpen.value = false;
  },
});
</script>

<template>
  <div class="ep-view">
    <div v-if="success" class="ep-toast success">{{ success }}</div>
    <div v-if="error" class="ep-toast error">{{ error }}</div>

    <div v-if="loading" class="ep-empty">{{ t("countdown.loading") }}</div>
    <div v-else-if="!countdowns.length" class="ep-empty">
      {{ t("countdown.empty") }}
    </div>

    <div v-else class="ep-row-list">
      <div v-for="cd in countdowns" :key="cd.id" class="ep-list-row countdown-row" :class="{ inactive: !cd.is_active }">
        <!-- Status indicator -->
        <div class="cd-status-dot" :class="cd.status ?? 'idle'"></div>

        <!-- Main info -->
        <div class="cd-info" @click="openEdit(cd)">
          <div class="cd-name">{{ cd.name }}</div>
          <div class="cd-meta">
            <span class="ep-meta-pill dur">⏱ {{ fmtDuration(cd.duration_sec) }}</span>
            <span v-if="cd.tick_every_sec" class="ep-meta-pill tick">↻ {{ t("countdown.field.tick_every") }}
              {{ cd.tick_every_sec }}s</span>
            <span v-if="cd.enabled_when !== 'always'" class="ep-meta-pill when">{{ cd.enabled_when }}</span>
            <span v-if="cd.condition" class="ep-meta-pill cond">if …</span>
          </div>
          <!-- Running countdown: show live remaining -->
          <div v-if="cd.status === 'running'" class="cd-remaining">
            {{ fmtRemaining(cd) }} {{ t("countdown.status.running") }}
          </div>
          <div v-else-if="cd.status === 'finished'" class="cd-remaining finished">
            {{ t("countdown.status.finished") }}
          </div>
          <div v-else class="cd-remaining idle">
            {{ t("countdown.status.idle") }}
          </div>
        </div>

        <!-- Controls -->
        <div class="cd-controls">
          <button v-if="canToggle" class="ctrl-btn start" :class="{ active: cd.status === 'running' }" @click.stop="
            controlCountdown(
              cd.name,
              cd.status === 'running' ? 'stop' : 'start',
            )
            " :title="cd.status === 'running'
                ? t('countdown.action.stop')
                : t('countdown.action.start')
              ">
            {{
              cd.status === "running"
                ? t("countdown.action.stop")
                : t("countdown.action.start")
            }}
          </button>
          <button v-if="canToggle" class="ctrl-btn reset" @click.stop="controlCountdown(cd.name, 'reset')"
            :title="t('countdown.action.reset')">
            {{ t("countdown.action.reset") }}
          </button>
        </div>

        <!-- Edit / Delete -->
        <div class="ep-row-actions">
          <button class="ep-btn-action edit" @click.stop="canEdit && openEdit(cd)" :class="{ disabled: !canEdit }">
            {{ canEdit ? t("countdown.edit") : t("countdown.view") }}
          </button>
          <button v-if="canDelete" class="ep-btn-action del" @click.stop="deleteCountdown(cd.name)"
            :disabled="saving === cd.name">
            ✕
          </button>
        </div>
      </div>
    </div>

    <!-- >>> Edit panel <<< -->
    <Teleport to="body">
      <div v-if="editOpen" class="ep-overlay" v-bind="overlay.handlers(() => (editOpen = false))">
        <div class="ep-panel">
          <div class="ep-panel-header">
            <div>
              <div class="ep-panel-title">
                {{ isNew ? t("countdown.edit_new") : t("countdown.edit_title") }}
                <EditableNameHeader v-model="editCountdown.name" :orig-name="editOrigName" placeholder="hype" />
              </div>
              <div class="ep-panel-sub">#{{ session?.channel }}</div>
            </div>
            <button class="ep-panel-close" @click="editOpen = false">✕</button>
          </div>

          <div class="ep-panel-body">
            <div v-if="error" class="ep-toast error">{{ error }}</div>
            <div class="ep-field-group">
              <label class="ep-field-label">{{ t("countdown.field.seconds") }}
                <span class="ep-field-hint">{{
                  t("countdown.field.secs_hint")
                  }}</span></label>
              <div class="dur-row">
                <input v-model.number="editCountdown.duration_sec" type="number" min="1" class="ep-field-input" />
                <span class="ep-field-hint">= {{ fmtDuration(editCountdown.duration_sec ?? 60) }}</span>
              </div>
            </div>

            <!-- On start message -->
            <div class="ep-field-group">
              <label class="ep-field-label">{{ t("countdown.field.msg_start") }}
                <span class="ep-field-hint">{{
                  t("countdown.field.resp_hint")
                  }}</span></label>
              <div ref="startEditorRef" class="ep-script-editor" contenteditable="true" spellcheck="false"
                data-placeholder="Countdown gestartet! $countdown.hype.remaining Sekunden verbleiben."
                @focus="activeField = 'msg_start'" @input="onEditorInput(startEditorRef, 'msg_start')"></div>
            </div>

            <!-- Tick -->
            <div class="ep-row-2">
              <div class="ep-field-group">
                <label class="ep-field-label">{{ t("countdown.field.msg_tick") }}
                  <span class="ep-field-hint">{{
                    t("countdown.field.tick_hint")
                    }}</span></label>
                <div ref="tickEditorRef" class="ep-script-editor" contenteditable="true" spellcheck="false"
                  data-placeholder="Noch $countdown.hype.remaining Sekunden!" @focus="activeField = 'msg_tick'"
                  @input="onEditorInput(tickEditorRef, 'msg_tick')"></div>
              </div>
              <div class="ep-field-group ep-sm">
                <label class="ep-field-label">{{ t("countdown.field.tick_every") }}
                  <span class="ep-field-hint">s</span></label>
                <input v-model.number="editCountdown.tick_every_sec" type="number" min="1" class="ep-field-input" />
              </div>
            </div>

            <!-- On finish message -->
            <div class="ep-field-group">
              <label class="ep-field-label">{{ t("countdown.field.msg_end") }}
                <span class="ep-field-hint">{{
                  t("countdown.field.resp_hint")
                  }}</span></label>
              <div ref="endEditorRef" class="ep-script-editor" contenteditable="true" spellcheck="false"
                data-placeholder="Zeit ist abgelaufen! PogChamp" @focus="activeField = 'msg_end'"
                @input="onEditorInput(endEditorRef, 'msg_end')"></div>
            </div>

            <!-- Variable reference - inserts into whichever message field was last focused -->
            <RefPanel :title="`${t('edit.var_ref')} · → ${activeField.replace('msg_', '')}`" context="countdown"
              @insert="insertRefToken" />

            <!-- Conditions -->
            <div class="ep-row-2">
              <div class="ep-field-group">
                <label class="ep-field-label">{{
                  t("countdown.field.active_when")
                  }}</label>
                <select v-model="editCountdown.enabled_when" class="ep-field-select">
                  <option value="always">
                    {{ t("countdown.when.always") }}
                  </option>
                  <option value="online">
                    {{ t("countdown.when.online") }}
                  </option>
                  <option value="offline">
                    {{ t("countdown.when.offline") }}
                  </option>
                </select>
              </div>
              <div class="ep-field-group">
                <label class="ep-field-label">{{ t("countdown.field.condition") }}
                  <span class="ep-field-hint">{{
                    t("countdown.field.cond_hint")
                    }}</span></label>
                <input v-model="editCountdown.condition" class="ep-field-input ep-mono"
                  placeholder="$channel.viewers > 10" />
              </div>
            </div>

            <div class="ep-panel-footer">
              <button v-if="!isNew && canDelete" class="ep-btn-delete" @click="
                deleteCountdown(editOrigName);
              editOpen = false;
              ">
                {{ t("countdown.delete") }}
              </button>
              <div v-else></div>
              <div class="ep-footer-right">
                <button class="ep-btn-cancel" @click="editOpen = false">
                  {{ t("countdown.cancel") }}
                </button>
                <button class="ep-btn-save" @click="saveCountdown" :disabled="!!saving">
                  {{ saving ? t("countdown.saving") : t("countdown.save") }}
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </Teleport>
  </div>
</template>

<style scoped>
.cd-status-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  flex-shrink: 0;
  background: #333;
  transition: background 0.3s;
}

.cd-status-dot.running {
  background: #23d18b;
  box-shadow: 0 0 6px #23d18b88;
  animation: pulse-dot 1.2s ease-in-out infinite;
}

.cd-status-dot.finished {
  background: #f14949;
}

.cd-status-dot.idle {
  background: #444;
}

@keyframes pulse-dot {

  0%,
  100% {
    opacity: 1;
  }

  50% {
    opacity: 0.4;
  }
}

.cd-info {
  flex: 1;
  cursor: pointer;
  min-width: 0;
}

.cd-name {
  font-size: 13px;
  font-weight: 600;
  color: #e0e0e0;
  margin-bottom: 4px;
}

.cd-meta {
  display: flex;
  gap: 6px;
  flex-wrap: wrap;
  margin-bottom: 4px;
}

.cd-remaining {
  font-size: 11px;
  font-family: "Consolas", "Fira Mono", monospace;
  color: #555;
}

.cd-remaining.finished {
  color: #f14949;
}

.cd-remaining.idle {
  color: #444;
}

.ep-meta-pill.tick {
  color: #4ec9b0;
  border-color: #4ec9b044;
  background: #4ec9b011;
}

.cd-controls {
  display: flex;
  gap: 5px;
  flex-shrink: 0;
}

.ctrl-btn {
  height: 28px;
  padding: 0 10px;
  border: 1px solid #2a2a30;
  background: transparent;
  color: #666;
  font-family: inherit;
  font-size: 11px;
  cursor: pointer;
  transition: all 0.15s;
}

.ctrl-btn.start {
  border-color: #23d18b44;
  color: #23d18b;
}

.ctrl-btn.start:hover {
  background: rgba(35, 209, 139, 0.1);
}

.ctrl-btn.start.active {
  border-color: #f1494944;
  color: #f14949;
  background: rgba(241, 73, 73, 0.08);
}

.ctrl-btn.start.active:hover {
  background: rgba(241, 73, 73, 0.18);
}

.ctrl-btn.reset {
  border-color: #e5c07b33;
  color: #888;
}

.ctrl-btn.reset:hover {
  border-color: #e5c07b66;
  color: #e5c07b;
  background: rgba(229, 192, 123, 0.08);
}

.dur-row {
  display: flex;
  align-items: center;
  gap: 8px;
}

.dur-row .ep-field-input {
  flex: 1;
}

@media (max-width: 680px) {
  .countdown-row {
    flex-wrap: wrap;
    gap: 8px;
  }

  .cd-controls {
    gap: 4px;
  }
}
</style>
