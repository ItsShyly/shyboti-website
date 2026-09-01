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
import { iconSvg as iconSvgFor } from "../composables/icons";
import { useResizableColumns } from "../composables/useResizableColumns";
import EditableNameHeader from "./shared/EditableNameHeader.vue";
import RefPanel from "./shared/RefPanel.vue";
import RowKebabMenu, { type KebabMenuItem } from "./shared/RowKebabMenu.vue";

const { session, availableChannels, channelRole } = useAuth();
const { t } = useI18n();

// vvv resizable/draggable columns vvv
const COUNTDOWN_COL_LABEL: Record<string, () => string> = {
  controls: () => t("countdown.header.controls"),
  name: () => t("countdown.field.name"),
  status: () => t("countdown.header.status"),
  duration: () => t("countdown.field.seconds"),
  manage: () => t("cmd.sort.actions"),
  switch: () => " ", // >>> nbsp keeps the header cell from collapsing
};
function countdownColLabel(key: string): string {
  return COUNTDOWN_COL_LABEL[key]?.() ?? key;
}
const {
  columns: countdownColumns,
  gridTemplateColumns: countdownGridTemplateColumns,
  orderOf: countdownOrderOf,
  cellStyle: countdownCellStyle,
  setHover: countdownSetHover,
  clearHover: countdownClearHover,
  resizingIndex: countdownResizingIndex,
  startResize: countdownStartResize,
  draggingIndex: countdownColDraggingIndex,
  dragOverIndex: countdownColDragOverIndex,
  onDragStart: countdownColDragStart,
  onDragEnterCell: countdownColDragEnterCell,
  onDrop: countdownColDrop,
  onDragEnd: countdownColDragEnd,
} = useResizableColumns("countdown-row", [
  { key: "controls", label: "", width: 160, minWidth: 120 },
  { key: "name", label: "", width: 2, minWidth: 120, flex: true },
  { key: "status", label: "", width: 140, minWidth: 100 },
  { key: "duration", label: "", width: 240, minWidth: 150 },
  { key: "manage", label: "", width: 150, minWidth: 120 },
  { key: "switch", label: "", width: 50, minWidth: 50 },
]);
// ^^^ resizable/draggable columns ^^^

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

// vvv edit panel vvv
const editOpen = ref(false);
const isNew = ref(false);
const editOrigName = ref(""); // <<< old name, needed to delete on rename
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
// >>> tracks last focused message editor
const activeField = ref<"msg_start" | "msg_tick" | "msg_end">("msg_start");
const FIELD_REFS = {
  msg_start: startEditorRef,
  msg_tick: tickEditorRef,
  msg_end: endEditorRef,
};
// ^^^ edit panel ^^^

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
  void tick.value; // <<< subscribes to tick, forces rerun every second
  if (cd.status !== "running" || !cd.started_at)
    return fmtDuration(cd.duration_sec);
  const elapsed = Math.floor((Date.now() - cd.started_at) / 1000);
  const rem = Math.max(0, cd.duration_sec - elapsed);
  return fmtDuration(rem);
}

// vvv tick, recompute remaining every second vvv
const tick = ref(0);
let tickInterval: ReturnType<typeof setInterval> | null = null;
let pollInterval: ReturnType<typeof setInterval> | null = null;

onMounted(() => {
  tickInterval = setInterval(() => {
    tick.value++;
    // >>> mirrors backend auto-idle, avoids a reload
    for (const cd of countdowns.value) {
      if (cd.status !== "running" || !cd.started_at) continue;
      const elapsed = Math.floor((Date.now() - cd.started_at) / 1000);
      if (elapsed >= cd.duration_sec) {
        cd.status = "idle";
        cd.started_at = null;
      }
    }
  }, 1000);
  // >>> polls too, catches external countdown triggers
  pollInterval = setInterval(load, 5000);
  load();
});
onUnmounted(() => {
  if (tickInterval) clearInterval(tickInterval);
  if (pollInterval) clearInterval(pollInterval);
});
watch(() => session.value?.channel, load);
// ^^^ tick ^^^

async function load() {
  if (!session.value) return;
  const ch = session.value.channel;
  loading.value = true;
  error.value = "";
  try {
    const res = await fetch(`${API}/countdowns/${ch}`, {
      headers: { Authorization: `Bearer ${session.value.token}` },
    });
    const data = await res.json().catch(() => null);
    if (!res.ok) throw new Error(data?.error ?? `Load failed (${res.status})`);
    // >>> channel switched again while this was in flight - discard
    if (session.value?.channel !== ch) return;
    countdowns.value = (data as { countdowns: Countdown[] })?.countdowns ?? [];
  } catch (e: any) {
    if (session.value?.channel === ch)
      error.value = e.message ?? "Could not load countdowns.";
  }
  if (session.value?.channel === ch) loading.value = false;
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

// >>> inserts into last focused message editor
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
    // >>> excludes id and non-db fields
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
    // >>> renamed, delete the old duplicate row
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
    error.value = t("countdown.error.delete");
  }
  saving.value = null;
}

// vvv share vvv
const shareOpen = ref(false);
const shareCountdown = ref("");
const shareTarget = ref("");
const shareSaving = ref(false);
const shareSuccess = ref("");
const shareError = ref("");

// >>> mobile kebab menu items, desktop keeps the inline row buttons
function countdownKebabItems(cd: Countdown): KebabMenuItem[] {
  const items: KebabMenuItem[] = [
    {
      key: "edit",
      label: canEdit.value ? t("countdown.edit") : t("countdown.view"),
      icon: "edit",
      onClick: () => openEdit(cd),
    },
  ];
  if (canEdit.value) {
    items.push({
      key: "share",
      label: t("countdown.share"),
      icon: "corner-up-right",
      onClick: () => openShare(cd.name),
    });
  }
  if (canDelete.value) {
    items.push({
      key: "delete",
      label: t("cmd.delete"),
      icon: "trash",
      danger: true,
      disabled: saving.value === cd.name,
      onClick: () => deleteCountdown(cd.name),
    });
  }
  return items;
}

function openShare(name: string) {
  shareCountdown.value = name;
  shareTarget.value = "";
  shareSuccess.value = "";
  shareError.value = "";
  shareOpen.value = true;
}
async function doShare() {
  if (!session.value || !shareTarget.value) return;
  shareSaving.value = true;
  shareError.value = "";
  try {
    const res = await fetch(
      `${API}/countdowns/${session.value.channel}/${encodeURIComponent(shareCountdown.value)}/share`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${session.value.token}` },
        body: JSON.stringify({ target_channel: shareTarget.value }),
      },
    );
    if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error);
    shareSuccess.value = `Copied to #${shareTarget.value}!`;
    setTimeout(() => { shareOpen.value = false }, 1200);
  } catch (e: any) {
    shareError.value = e.message ?? "Share failed";
  }
  shareSaving.value = false;
}
// ^^^ share ^^^

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

// >>> no PATCH route, so re-PUT the whole row with the flipped flag
async function toggleActive(cd: Countdown) {
  if (!session.value || !canToggle.value) return;
  const next = cd.is_active ? 0 : 1;
  try {
    const res = await fetch(
      `${API}/countdowns/${session.value.channel}/${encodeURIComponent(cd.name)}`,
      {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${session.value.token}`,
        },
        body: JSON.stringify({
          duration_sec: cd.duration_sec,
          msg_start: cd.msg_start,
          msg_tick: cd.msg_tick,
          tick_every_sec: cd.tick_every_sec,
          msg_end: cd.msg_end,
          enabled_when: cd.enabled_when,
          condition: cd.condition,
          is_active: next,
        }),
      },
    );
    if (res.ok) cd.is_active = next;
  } catch { }
}

// >>> header stuff lives in AutomationsView, exposed for it
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

    <div v-if="loading" class="ep-row-list">
      <div class="ep-skeleton-row" v-for="i in 6" :key="i">
        <div class="ep-skeleton-block ep-skeleton-square"></div>
        <div class="ep-skeleton-lines">
          <div class="ep-skeleton-block ep-skeleton-line title"></div>
          <div class="ep-skeleton-block ep-skeleton-line meta"></div>
          <div class="ep-skeleton-block ep-skeleton-line body"></div>
        </div>
        <div class="ep-skeleton-actions">
          <div class="ep-skeleton-block ep-skeleton-btn"></div>
          <div class="ep-skeleton-block ep-skeleton-btn icon"></div>
        </div>
      </div>
    </div>
    <div v-else-if="!countdowns.length" class="ep-empty">
      {{ t("countdown.empty") }}
    </div>

    <div v-else class="countdown-table">
      <div class="ep-row-header countdown-row" :style="{ gridTemplateColumns: countdownGridTemplateColumns }">
        <div v-for="(col, i) in countdownColumns" :key="col.key" class="ep-row-header-cell"
          :class="{ dragging: countdownColDraggingIndex === i, 'drag-over': countdownColDragOverIndex === i }"
          :style="{ order: i }" draggable="true" @dragstart="countdownColDragStart(i)"
          @dragenter.prevent="countdownColDragEnterCell(i)" @dragover.prevent @drop="countdownColDrop(i)"
          @dragend="countdownColDragEnd()" @mouseenter="countdownSetHover(col.key)" @mouseleave="countdownClearHover()">
          {{ countdownColLabel(col.key) }}
          <span class="ep-col-resize-handle" :class="{ resizing: countdownResizingIndex === i }"
            @mousedown="countdownStartResize(i, $event)" @click.stop @dragstart.stop.prevent></span>
        </div>
      </div>
      <div class="ep-row-list">
      <div v-for="cd in countdowns" :key="cd.id" class="ep-row-grid countdown-row"
        :style="{ gridTemplateColumns: countdownGridTemplateColumns }" :class="{ inactive: !cd.is_active }">
        <div class="ep-cell-name" :style="countdownCellStyle('name')">
          <span class="cd-status-dot" :class="cd.status ?? 'idle'"></span>
          <span class="cd-name-text">{{ cd.name }}</span>
        </div>

        <div class="ep-cell-text ep-row-cell-hover" :style="countdownCellStyle('status')"
          @click="openEdit(cd)">
          <span v-if="cd.status === 'running'" class="cd-remaining">
            {{ fmtRemaining(cd) }} {{ t("countdown.status.running") }}
          </span>
          <span v-else-if="cd.status === 'finished'" class="cd-remaining finished">
            {{ t("countdown.status.finished") }}
          </span>
          <span v-else class="cd-remaining idle">
            {{ t("countdown.status.idle") }}
          </span>
        </div>

        <div class="ep-cell-tags ep-row-cell-hover" :style="countdownCellStyle('duration')"
          @click="openEdit(cd)">
          <span class="ep-tag cooldown"><span v-html="iconSvgFor('clock')"></span> {{ fmtDuration(cd.duration_sec)
          }}</span>
          <span v-if="cd.tick_every_sec" class="ep-tag cooldown user"><span v-html="iconSvgFor('refresh-cw')"></span> {{
            cd.tick_every_sec }}s</span>
          <span v-if="cd.enabled_when !== 'always'" class="ep-tag condition">{{ cd.enabled_when }}</span>
          <span v-if="cd.condition" class="ep-tag condition">if …</span>
        </div>

        <div class="cd-controls" :style="countdownCellStyle('controls')">
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
            <span v-html="iconSvgFor('refresh-cw')"></span> {{ t("countdown.action.reset") }}
          </button>
        </div>

        <div class="ep-row-actions" :style="countdownCellStyle('manage')">
          <button class="ep-btn-action edit" @click.stop="canEdit && openEdit(cd)" :class="{ disabled: !canEdit }">
            {{ canEdit ? t("countdown.edit") : t("countdown.view") }}
          </button>
          <button v-if="canEdit" class="ep-btn-action share" @click.stop="openShare(cd.name)"
            :title="t('countdown.share')">
            <span v-html="iconSvgFor('corner-up-right')"></span>
          </button>
          <button v-if="canDelete" class="ep-btn-action del" @click.stop="deleteCountdown(cd.name)"
            :disabled="saving === cd.name">
            <span v-html="iconSvgFor('trash')"></span>
          </button>
        </div>
        <div class="ep-row-cell-center ep-row-cell-end" :style="countdownCellStyle('switch')">
          <button class="ep-switch" :class="{ on: cd.is_active, off: !cd.is_active, disabled: !canToggle }"
            @click.stop="toggleActive(cd)" :title="cd.is_active ? 'Disable' : 'Enable'"><span
              class="ep-switch-knob"></span></button>
        </div>
        <RowKebabMenu :items="countdownKebabItems(cd)" @click.stop />
      </div>
      </div>
    </div>

    <!-- vvv edit panel vvv -->
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
            <button class="ep-panel-close" @click="editOpen = false" v-html="iconSvgFor('x')"></button>
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

            <div class="ep-field-group">
              <label class="ep-field-label">{{ t("countdown.field.msg_start") }}
                <span class="ep-field-hint">{{
                  t("countdown.field.resp_hint")
                  }}</span></label>
              <div ref="startEditorRef" class="ep-script-editor" contenteditable="true" spellcheck="false"
                :data-placeholder="t('countdown.placeholder.msg_start')" @focus="activeField = 'msg_start'"
                @input="onEditorInput(startEditorRef, 'msg_start')"></div>
            </div>

            <div class="ep-row-2">
              <div class="ep-field-group">
                <label class="ep-field-label">{{ t("countdown.field.msg_tick") }}
                  <span class="ep-field-hint">{{
                    t("countdown.field.tick_hint")
                    }}</span></label>
                <div ref="tickEditorRef" class="ep-script-editor" contenteditable="true" spellcheck="false"
                  :data-placeholder="t('countdown.placeholder.msg_tick')" @focus="activeField = 'msg_tick'"
                  @input="onEditorInput(tickEditorRef, 'msg_tick')"></div>
              </div>
              <div class="ep-field-group ep-sm">
                <label class="ep-field-label">{{ t("countdown.field.tick_every") }}
                  <span class="ep-field-hint">s</span></label>
                <input v-model.number="editCountdown.tick_every_sec" type="number" min="1" class="ep-field-input" />
              </div>
            </div>

            <div class="ep-field-group">
              <label class="ep-field-label">{{ t("countdown.field.msg_end") }}
                <span class="ep-field-hint">{{
                  t("countdown.field.resp_hint")
                  }}</span></label>
              <div ref="endEditorRef" class="ep-script-editor" contenteditable="true" spellcheck="false"
                :data-placeholder="t('countdown.placeholder.msg_end')" @focus="activeField = 'msg_end'"
                @input="onEditorInput(endEditorRef, 'msg_end')"></div>
            </div>

            <!-- >>> targets last focused field -->
            <RefPanel :title="`${t('edit.var_ref')} · → ${activeField.replace('msg_', '')}`" context="countdown"
              @insert="insertRefToken" />

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
    <!-- ^^^ edit panel ^^^ -->

    <!-- vvv share modal vvv -->
    <Teleport to="body">
      <div v-if="shareOpen" class="ep-modal-overlay" @click.self="shareOpen = false">
        <div class="ep-modal">
          <div class="ep-modal-title">
            {{ t("countdown.share.title") }}
            <span class="ep-modal-name">{{ shareCountdown }}</span>
          </div>
          <div class="ep-modal-sub">{{ t("countdown.share.sub") }}</div>
          <select v-model="shareTarget" class="ep-field-select-sm" style="width: 100%; margin-top: 12px">
            <option value="">{{ t("countdown.share.select") }}</option>
            <option v-for="ch in availableChannels.filter((c) => c !== session?.channel)" :key="ch" :value="ch">#{{
              ch }}</option>
          </select>
          <div v-if="shareError" class="ep-modal-msg err">{{ shareError }}</div>
          <div v-if="shareSuccess" class="ep-modal-msg ok">{{ shareSuccess }}</div>
          <div class="ep-modal-footer">
            <button class="ep-btn-cancel" @click="shareOpen = false">{{ t("countdown.cancel") }}</button>
            <button class="ep-btn-save" @click="doShare" :disabled="shareSaving || !shareTarget">
              {{ shareSaving ? t("countdown.share.copying") : t("countdown.share.btn") }}
            </button>
          </div>
        </div>
      </div>
    </Teleport>
    <!-- ^^^ share modal ^^^ -->
  </div>
</template>

<style scoped>
/* >>> single wrapper for header+list - .ep-view puts a 16px gap between its
   own direct children, which would otherwise split the header from the rows */
.countdown-table {
  display: flex;
  flex-direction: column;
  flex: 1;
  min-height: 0;
  overflow: hidden;
}
.countdown-table > .ep-row-list {
  flex: 1;
  min-height: 0;
}

.countdown-row {
  grid-template-columns: 160px minmax(120px, 1fr) 140px 240px 150px 50px;
}

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

.cd-name-text {
  font-size: 13px;
  font-weight: 600;
  color: #e0e0e0;
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

.cd-controls {
  display: flex;
  align-items: center;
  gap: 5px;
  flex-shrink: 0;
  padding-left: 10px;
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
  .cd-name-text {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .cd-controls {
    gap: 4px;
  }

  /* >>> edit/share/delete move into the kebab on phone */
  .countdown-row>.ep-row-actions {
    display: none;
  }
}
</style>
