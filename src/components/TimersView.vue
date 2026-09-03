<script setup lang="ts">
import {
  ref,
  computed,
  onMounted,
  onUnmounted,
  watch,
  inject,
  nextTick,
  type Ref,
} from "vue";
import { API } from "../api";
import { useAuth } from "../auth";
import { useI18n } from "../i18n";
import {
  applyScriptHighlight,
  insertTokenAtCursor,
  setEditorContent,
} from "../composables/useContentEditableScript";
import { useOverlayClose } from "../composables/useOverlayClose";
import { useEscClose } from "../composables/useEscClose";
import { iconSvg as iconSvgFor } from "../composables/icons";
import { useClickAway } from "../composables/useClickAway";
import { useResizableColumns } from "../composables/useResizableColumns";
import EditableNameHeader from "./shared/EditableNameHeader.vue";
import RefPanel from "./shared/RefPanel.vue";
import RowKebabMenu, { type KebabMenuItem } from "./shared/RowKebabMenu.vue";
import RowContextMenu from "./shared/RowContextMenu.vue";
import ColumnMenu from "./shared/ColumnMenu.vue";
import { useRowContextMenu } from "../composables/useRowContextMenu";
import { useRowSelection } from "../composables/useRowSelection";
import { useConfirm } from "../composables/useConfirm";
import { useRowColors } from "../composables/useRowColors";
import { useTabActive } from "../composables/useTabActive";
import ConfirmDialog from "./shared/ConfirmDialog.vue";

const tabActive = useTabActive();

const { session, availableChannels, channelRole } = useAuth();
const { ctxOpen, ctxX, ctxY, ctxItems, ctxCooldowns, ctxSwatch, ctxTitle, openContext } =
  useRowContextMenu();
const { t } = useI18n();
const rowColors = useRowColors(() => session.value?.channel, "timer", "#7c83ff");
const timerBarColors = computed(() =>
  rowColors.usedColors(timers.value.map((x) => x.name)),
);

const { confirmOpen, confirmData, ask: askConfirm, onConfirm, onCancel } = useConfirm();
function askDelete(n: number): Promise<boolean> {
  return askConfirm({
    title: t("confirm.delete_title"),
    message: t("sel.delete_confirm", { n }),
    confirmLabel: t("sel.delete"),
    danger: true,
  });
}
const sel = useRowSelection<Timer>(() => sortedTimers.value, (x) => x.name, {
  isActive: () => tabActive.value,
  onDelete: (items) => bulkDeleteTimers(items),
});
async function setTimerActive(timer: Timer, active: boolean) {
  if (!session.value || !!timer.is_active === active) return;
  const next = active ? 1 : 0;
  await fetch(`${API}/timers/${session.value.channel}/${timer.name}`, {
    method: "PATCH",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${session.value.token}`,
    },
    body: JSON.stringify({ is_active: next }),
  });
  timer.is_active = next;
}
async function bulkDeleteTimers(items: Timer[]) {
  if (!(await askDelete(items.length))) return;
  for (const x of items) await deleteTimer(x.name);
  sel.clear();
}
function timerRowCtx(e: MouseEvent, timer: Timer) {
  if (!(sel.count.value > 1 && sel.isSelected(timer.name)))
    return openTimerCtx(e, timer);
  const items = sel.selectedItems.value;
  const n = items.length;
  openContext(e, {
    title: t("sel.n_selected", { n }),
    items: [
      ...(canEdit.value
        ? [
          { key: "on", label: `${t("sel.activate")} (${n})`, icon: "check",
            onClick: () => { items.forEach((x) => setTimerActive(x, true)); sel.clear(); } },
          { key: "off", label: `${t("sel.deactivate")} (${n})`,
            onClick: () => { items.forEach((x) => setTimerActive(x, false)); sel.clear(); } },
        ]
        : []),
      ...(canDelete.value
        ? [{ key: "del", label: `${t("sel.delete")} (${n})`, icon: "trash", danger: true,
          onClick: () => bulkDeleteTimers(items) }]
        : []),
    ],
    swatch: {
      label: t("cmd.dot_colour"),
      current: "",
      used: timerBarColors.value,
      onPick: (hex: string) => items.forEach((x) => rowColors.setColor(x.name, hex)),
    },
  });
}
// >>> left-click the colour cell -> just the colour picker
function openColorPicker(e: MouseEvent, name: string) {
  openContext(e, {
    swatch: {
      label: t("cmd.dot_colour"),
      current: rowColors.colorOf(name),
      used: timerBarColors.value,
      onPick: (hex: string) => rowColors.setColor(name, hex),
    },
  });
}
function openTimerCtx(e: MouseEvent, timer: Timer) {
  openContext(e, {
    items: canEdit.value
      ? [
          {
            key: "share",
            label: t("timer.share"),
            icon: "corner-up-right",
            onClick: () => openShare(timer.name),
          },
        ]
      : [],
    swatch: {
      label: t("cmd.dot_colour"),
      current: rowColors.colorOf(timer.name),
      used: timerBarColors.value,
      onPick: (hex: string) => rowColors.setColor(timer.name, hex),
    },
  });
}

// vvv resizable/draggable columns vvv
const TIMER_COL_LABEL: Record<string, () => string> = {
  color: () => "",
  name: () => t("timer.field.name"),
  response: () => t("timer.field.response"),
  interval: () => t("timer.field.interval"),
  condition: () => t("timer.field.condition"),
  manage: () => t("cmd.sort.actions"),
  switch: () => " ", // >>> nbsp keeps the header cell from collapsing
};
function timerColLabel(key: string): string {
  return TIMER_COL_LABEL[key]?.() ?? key;
}
const {
  columns: timerColumns,
  visibleColumns: timerVisibleColumns,
  hidden: timerHidden,
  setColumnHidden: timerSetColHidden,
  resetHidden: timerResetHidden,
  gridTemplateColumns: timerGridTemplateColumns,
  orderOf: timerOrderOf,
  cellStyle: timerCellStyle,
  setHover: timerSetHover,
  clearHover: timerClearHover,
  resizingIndex: timerResizingIndex,
  startResize: timerStartResize,
  draggingIndex: timerColDraggingIndex,
  dragOverIndex: timerColDragOverIndex,
  onDragStart: timerColDragStart,
  onDragEnterCell: timerColDragEnterCell,
  onDrop: timerColDrop,
  onDragEnd: timerColDragEnd,
  sortKey: timerSortKey,
  sortDir: timerSortDir,
  applySort: timerApplySort,
  onHeaderPointerDown: timerOnHeaderPointerDown,
  onHeaderClick: timerOnHeaderClick,
} = useResizableColumns("timer-row", [
  { key: "color", label: "", width: 30, minWidth: 26, sortable: true },
  { key: "name", label: "", width: 2, minWidth: 120, flex: true, sortable: true, hideable: false },
  { key: "response", label: "", width: 4, minWidth: 150, flex: true, sortable: true },
  { key: "interval", label: "", width: 150, minWidth: 100 },
  { key: "condition", label: "", width: 190, minWidth: 120 },
  { key: "manage", label: "", width: 150, minWidth: 150 },
  { key: "switch", label: "", width: 50, minWidth: 50, hideable: false },
]);
const timerColItems = computed(() =>
  timerColumns.value
    .filter((c) => c.key !== "name")
    .map((c) => ({
      key: c.key,
      label: c.key === "color" ? t("cols.colour") : timerColLabel(c.key),
      hideable: c.hideable,
    })),
);
function openTimerColCtx(e: MouseEvent, key: string, hideable?: boolean) {
  if (hideable === false) return;
  openContext(e, {
    items: [
      { key: "hide", label: t("cols.hide"), icon: "eye-off", onClick: () => timerSetColHidden(key, true) },
    ],
  });
}
// ^^^ resizable/draggable columns ^^^

// >>> sort rank = the colour's slot in the header colour bar; uncoloured sinks
function timerColorRank(name: string): number | null {
  if (!rowColors.colors.value[name]) return null;
  const i = timerBarColors.value.indexOf(rowColors.colorOf(name).toLowerCase());
  return i < 0 ? null : i;
}
const sortedTimers = computed(() =>
  timerApplySort(
    timers.value.filter((x) => rowColors.matchesFilter(x.name)),
    (ti: Timer, k) =>
      k === "name"
        ? ti.name
        : k === "response"
          ? ti.response
          : k === "color"
            ? timerColorRank(ti.name)
            : null,
  ),
);

// >>> opens edit panel from global search
const searchOpenTimer = inject<Ref<string | null>>(
  "searchOpenTimer",
  ref(null),
);
watch(searchOpenTimer, (name) => {
  if (!name) return;
  searchOpenTimer.value = null;
  const timer = timers.value.find((ti) => ti.name === name);
  if (timer) {
    nextTick(() => openEdit(timer));
  } else {
    load().then(() => {
      const t2 = timers.value.find((ti) => ti.name === name);
      if (t2) openEdit(t2);
    });
  }
});

const canToggle = computed(
  () => channelRole.value?.permissions.automations_toggle ?? false,
);
const canEdit = computed(
  () => channelRole.value?.permissions.automations_edit ?? false,
);
const canDelete = computed(
  () => channelRole.value?.permissions.automations_delete ?? false,
);

interface Timer {
  id: number;
  name: string;
  response: string;
  interval_sec: number;
  min_messages: number;
  enabled_when: string;
  required_game: string;
  condition: string;
  is_active: number;
  last_fired: number;
}

const timers = ref<Timer[]>([]);
const loading = ref(false);
const saving = ref<string | null>(null);
const error = ref("");
const success = ref("");

// >>> live clock for next-fire countdowns
const now = ref(Date.now());
let _clockInterval: ReturnType<typeof setInterval> | null = null;
onUnmounted(() => {
  if (_clockInterval) clearInterval(_clockInterval);
});

function fmtNextFire(timer: Timer): string {
  if (!timer.is_active) return "";
  const fired = timer.last_fired ?? 0;
  const nextMs = fired + timer.interval_sec * 1000;
  const diffMs = nextMs - now.value;
  if (diffMs <= 0) return "firing soon";
  const s = Math.ceil(diffMs / 1000);
  if (s >= 3600)
    return `in ${Math.floor(s / 3600)}h ${Math.floor((s % 3600) / 60)}m`;
  if (s >= 60) return `in ${Math.floor(s / 60)}m ${s % 60}s`;
  return `in ${s}s`;
}

// vvv edit panel vvv
const editOpen = ref(false);
const overlay = useOverlayClose();
const editTimer = ref<Partial<Timer> & { name: string }>({
  name: "",
  response: "",
  interval_sec: 300,
  min_messages: 0,
  enabled_when: "always",
  required_game: "",
  condition: "",
  is_active: 1,
});
const editOrigName = ref(""); // <<< old name, needed to delete on rename
const editorRef = ref<HTMLDivElement | null>(null);

function showSuccess(msg: string) {
  success.value = msg;
  setTimeout(() => (success.value = ""), 3000);
}

function fmtInterval(s: number) {
  if (s >= 3600) return `${Math.round(s / 3600)}h`;
  if (s >= 60) return `${Math.round(s / 60)}m`;
  return `${s}s`;
}

async function load() {
  if (!session.value) return;
  const ch = session.value.channel;
  loading.value = true;
  error.value = "";
  try {
    const res = await fetch(`${API}/timers/${ch}`, {
      headers: { Authorization: `Bearer ${session.value.token}` },
    });
    if (!res.ok) throw new Error();
    const data = (await res.json()) as { timers: Timer[] };
    // >>> channel switched again while this was in flight - discard
    if (session.value?.channel !== ch) return;
    timers.value = data.timers;
  } catch (e: any) {
    if (session.value?.channel === ch)
      error.value = "Could not load timers: " + (e?.message ?? e);
  }
  if (session.value?.channel === ch) loading.value = false;
}

const creatingNew = ref(false);
const newTimerInput = ref<HTMLInputElement | null>(null);

function startCreate() {
  // >>> opens edit panel with a blank timer
  const blank = {
    name: '',
    response: '',
    interval_sec: 300,
    min_messages: 0,
    enabled_when: 'always',
    required_game: '',
    condition: '',
    is_active: 1,
  };
  openEdit({ id: 0, last_fired: 0, ...blank });
}

function cancelCreate() {
  creatingNew.value = false;
}

function openEdit(timer: Timer) {
  error.value = "";
  editOrigName.value = timer.name;
  editTimer.value = { ...timer };
  editOpen.value = true;
  setTimeout(() => {
    if (editorRef.value) setEditorContent(editorRef.value, timer.response);
  }, 50);
}

function onEditorInput() {
  const el = editorRef.value;
  if (!el) return;
  editTimer.value.response = el.innerText.replace(/\n$/, "");
  applyScriptHighlight(el);
}

// >>> inserts token at editor cursor
function insertRefToken(token: string) {
  const el = editorRef.value;
  if (!el) return;
  editTimer.value.response = insertTokenAtCursor(el, token);
}

async function saveTimer() {
  if (!session.value) return;
  const missing: string[] = [];
  if (!editTimer.value.name?.trim()) missing.push(t("timer.field.name"));
  if (!editTimer.value.response?.trim()) missing.push(t("timer.field.response"));
  if (missing.length) {
    error.value = t("edit.missing_fields") + missing.join(", ");
    return;
  }
  saving.value = editTimer.value.name;
  try {
    const name = editTimer.value.name.trim();
    const res = await fetch(`${API}/timers/${session.value.channel}/${name}`, {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${session.value.token}`,
      },
      body: JSON.stringify(editTimer.value),
    });
    if (!res.ok) throw new Error(await res.text());
    // >>> renamed, delete the old duplicate row
    if (editOrigName.value && editOrigName.value !== name) {
      await fetch(
        `${API}/timers/${session.value.channel}/${editOrigName.value}`,
        {
          method: "DELETE",
          headers: { Authorization: `Bearer ${session.value.token}` },
        },
      ).catch(() => { });
    }
    showSuccess(t("timer.save") + "!");
    editOpen.value = false;
    load();
  } catch (e: any) {
    error.value = "Could not save timer: " + (e?.message ?? e);
  } finally {
    saving.value = null;
  }
}

async function deleteTimer(name: string) {
  if (!session.value) return;
  saving.value = name;
  try {
    await fetch(`${API}/timers/${session.value.channel}/${name}`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${session.value.token}` },
    });
    timers.value = timers.value.filter((timer) => timer.name !== name);
    if (editOpen.value && editTimer.value.name === name) editOpen.value = false;
  } catch {
    error.value = t("timer.error.delete");
  }
  saving.value = null;
}

async function toggleActive(timer: Timer) {
  if (!session.value) return;
  const next = timer.is_active ? 0 : 1;
  await fetch(`${API}/timers/${session.value.channel}/${timer.name}`, {
    method: "PATCH",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${session.value.token}`,
    },
    body: JSON.stringify({ is_active: next }),
  });
  timer.is_active = next;
}
// ^^^ edit panel ^^^

// vvv share vvv
const shareOpen = ref(false);
useEscClose(() => {
  editOpen.value = false;
  shareOpen.value = false;
});
const shareTimer = ref("");
const shareTarget = ref("");
const shareSaving = ref(false);
const shareSuccess = ref("");
const shareError = ref("");

// >>> mobile kebab menu items, desktop keeps the inline row buttons
function timerKebabItems(timer: Timer): KebabMenuItem[] {
  const items: KebabMenuItem[] = [
    {
      key: "edit",
      label: canEdit.value ? t("timer.edit") : t("timer.view"),
      icon: "edit",
      onClick: () => openEdit(timer),
    },
    {
      key: "share",
      label: t("timer.share"),
      icon: "corner-up-right",
      onClick: () => openShare(timer.name),
    },
  ];
  if (canDelete.value) {
    items.push({
      key: "delete",
      label: t("cmd.delete"),
      icon: "trash",
      danger: true,
      disabled: saving.value === timer.name,
      onClick: () => deleteTimer(timer.name),
    });
  }
  return items;
}

function openShare(name: string) {
  shareTimer.value = name;
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
      `${API}/timers/${session.value.channel}/${shareTimer.value}/share`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${session.value.token}`,
        },
        body: JSON.stringify({ target_channel: shareTarget.value }),
      },
    );
    if (!res.ok) throw new Error(((await res.json()) as any).error ?? "Failed");
    shareSuccess.value = `Copied to #${shareTarget.value}!`;
    setTimeout(() => {
      shareOpen.value = false;
    }, 1500);
  } catch (e: any) {
    shareError.value = e.message ?? "Share failed";
  }
  shareSaving.value = false;
}
// ^^^ share ^^^

// vvv sync vvv
const syncConf = ref<{
  sync_from: string;
  is_active: number;
  last_synced: number;
} | null>(null);
const syncOpen = ref(false);
const syncMode = ref<"ongoing" | "import">("ongoing");
const syncWrapEl = ref<HTMLElement | null>(null);
function openSync(mode: "ongoing" | "import") {
  syncMode.value = mode;
  syncOpen.value = true;
}
useClickAway(() => syncOpen.value, syncWrapEl, () => (syncOpen.value = false));
const syncFrom = ref("");
const syncSaving = ref(false);
const syncRunning = ref(false);
const syncImporting = ref(false);
const syncMsg = ref("");

async function runImport() {
  if (!session.value || !syncFrom.value) return;
  syncImporting.value = true;
  syncMsg.value = "";
  try {
    const res = await fetch(
      `${API}/timer-sync/${session.value.channel}/import`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${session.value.token}`,
        },
        body: JSON.stringify({ from: syncFrom.value }),
      },
    );
    const data = (await res.json()) as { count?: number; error?: string };
    if (!res.ok) throw new Error(data.error);
    syncMsg.value = `Imported ${data.count} timers from #${syncFrom.value}.`;
    await load();
  } catch (e: any) {
    syncMsg.value = e.message ?? "Import failed";
  }
  syncImporting.value = false;
}

async function fetchSync() {
  if (!session.value) return;
  const ch = session.value.channel;
  try {
    const res = await fetch(`${API}/timer-sync/${ch}`, {
      headers: { Authorization: `Bearer ${session.value.token}` },
    });
    const data = (await res.json()) as { sync: any };
    if (session.value?.channel !== ch) return;
    syncConf.value = data.sync;
    syncFrom.value = data.sync?.sync_from ?? "";
  } catch { }
}
async function saveSync() {
  if (!session.value || !syncFrom.value) return;
  syncSaving.value = true;
  try {
    await fetch(`${API}/timer-sync/${session.value.channel}`, {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${session.value.token}`,
      },
      body: JSON.stringify({ sync_from: syncFrom.value, is_active: true }),
    });
    await fetchSync();
    await runSync();
  } catch {
    syncMsg.value = t("timer.sync.error_save");
  }
  syncSaving.value = false;
}
async function stopSync() {
  if (!session.value || !syncConf.value) return;
  syncSaving.value = true;
  try {
    await fetch(`${API}/timer-sync/${session.value.channel}`, {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${session.value.token}`,
      },
      body: JSON.stringify({
        sync_from: syncConf.value.sync_from,
        is_active: false,
      }),
    });
    syncConf.value = { ...syncConf.value, is_active: 0 };
    syncMsg.value = t("timer.sync.stopped");
  } catch {
    syncMsg.value = t("timer.sync.error");
  }
  syncSaving.value = false;
}
async function runSync() {
  if (!session.value) return;
  syncRunning.value = true;
  syncMsg.value = "";
  try {
    const res = await fetch(`${API}/timer-sync/${session.value.channel}/run`, {
      method: "POST",
      headers: { Authorization: `Bearer ${session.value.token}` },
    });
    const data = (await res.json()) as { count?: number; error?: string };
    if (!res.ok) throw new Error(data.error);
    syncMsg.value = `Synced ${data.count} timers from #${syncConf.value?.sync_from}.`;
    await load();
  } catch (e: any) {
    syncMsg.value = e.message ?? "Sync failed";
  }
  syncRunning.value = false;
}
// ^^^ sync ^^^

onMounted(() => {
  load();
  fetchSync();
  _clockInterval = setInterval(() => (now.value = Date.now()), 1000);
});
watch(
  () => session.value?.channel,
  () => {
    load();
    fetchSync();
  },
);

// >>> header stuff lives in AutomationsView, exposed for it
defineExpose({
  header: computed(() => ({
    count: timers.value.length,
    countLabel: t("auto.timers"),
    createLabel: t("timer.new"),
    canCreate: canEdit.value,
  })),
  // >>> drives the docked-panel shift on the parent's outer .ep-view
  panelOpen: editOpen,
  reload: () => {
    load();
    fetchSync();
  },
  create: () => {
    canEdit.value && startCreate();
  },
  close: () => {
    editOpen.value = false;
    shareOpen.value = false;
  },
  // >>> selection hint shows in the parent's header sub-line
  selCount: sel.count,
  clearSel: sel.clear,
});
</script>

<template>
  <div class="ep-view">
    <Teleport to="#auto-color-bar" :disabled="!tabActive">
      <div v-if="timerBarColors.length > 1" class="cmd-color-bar" :class="{ dim: rowColors.filter.value }">
        <button v-for="c in timerBarColors" :key="c" type="button" class="cmd-color-sw"
          :class="{ active: rowColors.filter.value === c }" :style="{ background: c }"
          :title="t('cmd.filter_by_colour')" @click="rowColors.toggleFilter(c)"></button>
        <button v-if="rowColors.filter.value" type="button" class="cmd-color-clear"
          @click="rowColors.filter.value = null">{{ t('cmd.filter_clear') }}</button>
      </div>
    </Teleport>
    <Teleport to="#auto-header-tools" :disabled="!tabActive">
      <div class="ep-sync-wrap" ref="syncWrapEl">
        <ColumnMenu :columns="timerColItems" :hidden="timerHidden" :has-extra="true" :extra-label="t('cols.import')"
          @set="(k: string, h: boolean) => timerSetColHidden(k, h)" @show-all="timerResetHidden()">
          <button type="button" class="col-menu-item" @click="openSync('import')">
            <span v-html="iconSvgFor('download')"></span>{{ t('cols.import_once') }}
          </button>
          <button type="button" class="col-menu-item" @click="openSync('ongoing')">
            <span v-if="syncConf?.is_active" class="ep-sync-dot"></span>
            <span v-else v-html="iconSvgFor('refresh-cw')"></span>{{ t('cols.import_auto') }}
          </button>
        </ColumnMenu>
        <div v-if="syncOpen" class="ep-sync-panel">
          <div class="ep-sync-panel-title">
            {{ syncMode === 'import' ? t('cols.import_once') : t('cols.import_auto') }}
          </div>
          <div class="ep-sync-row">
            <select v-model="syncFrom" class="ep-field-select-sm">
              <option value="">{{ syncMode === 'import' ? t("timer.sync.select") : (syncConf?.is_active ?
                t("timer.sync.change") : t("timer.sync.select")) }}</option>
              <option v-for="ch in availableChannels.filter((c) => c !== session?.channel)" :key="ch" :value="ch">#{{ ch
                }}</option>
            </select>
            <button v-if="syncMode === 'import'" class="ep-sync-save-btn" @click="runImport"
              :disabled="syncImporting || !syncFrom">
              {{ syncImporting ? '…' : 'Import' }}
            </button>
            <button v-else class="ep-sync-save-btn" @click="saveSync" :disabled="syncSaving || !syncFrom">
              {{ syncSaving ? '…' : syncConf?.is_active ? t('timer.sync.update') : t('timer.sync.enable') }}
            </button>
          </div>
          <div v-if="syncMode === 'ongoing' && syncConf?.is_active" class="ep-sync-row">
            <button class="ep-sync-run-btn" @click="runSync" :disabled="syncRunning">{{ syncRunning ? '…' :
              t("timer.sync.pull") }}</button>
            <button class="ep-sync-stop-btn" @click="stopSync">{{ t("timer.sync.stop") }}</button>
          </div>
          <div v-if="syncMode === 'ongoing' && syncConf?.last_synced" class="ep-sync-last">{{ t("timer.sync.last") }} {{
            new Date(syncConf.last_synced).toLocaleString() }}</div>
          <div v-if="syncMsg" class="ep-sync-msg"
            :class="{ err: syncMsg.includes('fail') || syncMsg.includes('Error') }">{{ syncMsg }}</div>
        </div>
      </div>
    </Teleport>

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
    <div v-else-if="!timers.length" class="ep-empty">
      {{ t("timer.empty") }}
    </div>

    <div v-else class="timer-table">
      <div class="ep-row-header timer-row" :style="{ gridTemplateColumns: timerGridTemplateColumns }">
        <div v-for="(col, i) in timerVisibleColumns" :key="col.key" class="ep-row-header-cell"
          :class="{ dragging: timerColDraggingIndex === i, 'drag-over': timerColDragOverIndex === i,
            sortable: col.sortable, 'sort-active': timerSortKey === col.key }"
          :style="{ order: i }" draggable="true" @mousedown="timerOnHeaderPointerDown"
          @contextmenu.prevent="openTimerColCtx($event, col.key, col.hideable)"
          @click="timerOnHeaderClick(i, $event)" @dragstart="timerColDragStart(i)"
          @dragenter.prevent="timerColDragEnterCell(i)" @dragover.prevent @drop="timerColDrop(i)"
          @dragend="timerColDragEnd()" @mouseenter="timerSetHover(col.key)" @mouseleave="timerClearHover()">
          {{ timerColLabel(col.key) }}
          <span v-if="col.sortable" class="ep-sort-arrow" v-html="timerSortKey === col.key
            ? iconSvgFor(timerSortDir === 'asc' ? 'chevron-up' : 'chevron-down')
            : iconSvgFor('chevrons-up-down')"></span>
          <span class="ep-col-resize-handle" :class="{ resizing: timerResizingIndex === i }"
            @mousedown="timerStartResize(i, $event)" @click.stop @dragstart.stop.prevent></span>
        </div>
      </div>
      <div class="ep-row-list">
        <div v-for="timer in sortedTimers" :key="timer.id" class="ep-row-grid timer-row"
          :data-sel-key="timer.name"
          :style="{ gridTemplateColumns: timerGridTemplateColumns }" :class="{
            inactive: !timer.is_active,
            editing: editOpen && !!editOrigName && editOrigName === timer.name,
            selected: sel.isSelected(timer.name),
          }" @pointerdown="sel.onRowPointerDown($event, timer.name)"
          @click.capture="sel.onRowClickCapture($event, timer.name)"
          @contextmenu.prevent="timerRowCtx($event, timer)">
          <div class="ep-cell-color ep-cell-color--pick" data-no-sel :style="timerCellStyle('color')"
            @click.stop="openColorPicker($event, timer.name)">
            <span class="row-color-dot" :style="{ background: rowColors.colorOf(timer.name) }"></span>
          </div>
          <div class="ep-cell-name ep-row-cell-hover" :style="timerCellStyle('name')" @click="openEdit(timer)">
            <span class="timer-name-text">{{ timer.name }}</span>
          </div>
          <div class="ep-cell-text timer-resp-cell ep-row-cell-hover" :style="timerCellStyle('response')"
            @click="openEdit(timer)">
            <span class="timer-response">{{ timer.response.slice(0, 60)
              }}{{ timer.response.length > 60 ? "…" : "" }}</span>
            <span v-if="timer.is_active" class="timer-next">{{ fmtNextFire(timer) }}</span>
          </div>
          <div class="ep-cell-tags ep-row-cell-hover" :style="timerCellStyle('interval')" @click="openEdit(timer)">
            <span class="ep-tag cooldown"><span v-html="iconSvgFor('clock')"></span> {{ fmtInterval(timer.interval_sec)
              }}</span>
            <span v-if="timer.min_messages" class="ep-tag cooldown user"><span
                v-html="iconSvgFor('message-circle')"></span> {{
                  timer.min_messages }}+</span>
          </div>
          <div class="ep-cell-tags ep-row-cell-hover" :style="timerCellStyle('condition')" @click="openEdit(timer)">
            <span v-if="timer.enabled_when !== 'always'" class="ep-tag condition">{{ timer.enabled_when }}</span>
            <span v-if="timer.required_game" class="ep-tag condition">{{ timer.required_game }}</span>
            <span v-if="timer.condition" class="ep-tag condition">if …</span>
          </div>
          <div class="ep-row-actions" :style="timerCellStyle('manage')">
            <button class="ep-btn-action edit" @click.stop="canEdit && openEdit(timer)" :class="{ disabled: !canEdit }">
              {{ canEdit ? t("timer.edit") : t("timer.view") }}
            </button>
            <button v-if="canDelete" class="ep-btn-action del" @click.stop="deleteTimer(timer.name)"
              :disabled="saving === timer.name">
              <span v-html="iconSvgFor('trash')"></span>
            </button>
          </div>
          <div class="ep-row-cell-center ep-row-cell-end" :style="timerCellStyle('switch')">
            <button class="ep-switch" :class="{ on: timer.is_active, off: !timer.is_active, disabled: !canToggle }"
              @click.stop="canToggle && toggleActive(timer)" :title="timer.is_active ? 'Disable' : 'Enable'"><span
                class="ep-switch-knob"></span></button>
          </div>
          <RowKebabMenu :items="timerKebabItems(timer)" @click.stop />
        </div>
      </div>
    </div>

    <!-- >>> edit panel -->
    <Teleport to="body">
      <div v-if="editOpen" class="ep-overlay ep-overlay--dock" v-bind="overlay.handlers(() => (editOpen = false))">
        <div class="ep-panel">
          <div class="ep-panel-header">
            <div>
              <div class="ep-panel-title">
                {{ t("timer.edit_title") }}
                <EditableNameHeader v-model="editTimer.name" :orig-name="editOrigName" placeholder="welcome" />
              </div>
              <div class="ep-panel-sub">#{{ session?.channel }}</div>
            </div>
            <button class="ep-panel-close" @click="editOpen = false" v-html="iconSvgFor('x')"></button>
          </div>

          <div class="ep-panel-body">
            <div v-if="error" class="ep-toast error">{{ error }}</div>
            <div class="ep-field-group">
              <label class="ep-field-label">{{ t("timer.field.response") }}
                <span class="ep-field-hint">{{
                  t("timer.field.resp_hint")
                  }}</span></label>
              <div ref="editorRef" class="ep-script-editor" contenteditable="true" spellcheck="false"
                data-placeholder="Hello chat! $channel.viewers viewers right now." @input="onEditorInput"></div>
              <RefPanel :title="t('edit.var_ref')" @insert="insertRefToken" />
            </div>

            <div class="ep-row-2">
              <div class="ep-field-group">
                <label class="ep-field-label">{{
                  t("timer.field.interval")
                  }}</label>
                <div class="interval-row">
                  <input v-model.number="editTimer.interval_sec" type="number" min="30" class="ep-field-input" />
                  <span class="ep-field-hint">{{ t("timer.field.interval_hint") }} ·
                    {{ fmtInterval(editTimer.interval_sec ?? 300) }}</span>
                </div>
              </div>
              <div class="ep-field-group">
                <label class="ep-field-label">{{ t("timer.field.min_msgs") }}
                  <span class="ep-field-hint">{{
                    t("timer.field.min_msgs_hint")
                    }}</span></label>
                <input v-model.number="editTimer.min_messages" type="number" min="0" class="ep-field-input" />
              </div>
            </div>

            <div class="ep-row-3">
              <div class="ep-field-group">
                <label class="ep-field-label">{{
                  t("timer.field.active_when")
                  }}</label>
                <select v-model="editTimer.enabled_when" class="ep-field-select">
                  <option value="always">{{ t("timer.when.always") }}</option>
                  <option value="online">{{ t("timer.when.online") }}</option>
                  <option value="offline">{{ t("timer.when.offline") }}</option>
                </select>
              </div>
              <div class="ep-field-group">
                <label class="ep-field-label">{{ t("timer.field.game") }}
                  <span class="ep-field-hint">{{
                    t("timer.field.game_hint")
                    }}</span></label>
                <input v-model="editTimer.required_game" class="ep-field-input" placeholder="Just Chatting" />
              </div>
            </div>

            <div class="ep-field-group">
              <label class="ep-field-label">{{ t("timer.field.condition") }}
                <span class="ep-field-hint">{{
                  t("timer.field.cond_hint")
                  }}</span></label>
              <input v-model="editTimer.condition" class="ep-field-input ep-mono" placeholder="$channel.viewers > 10" />
            </div>

            <div class="ep-panel-footer">
              <button v-if="canDelete" class="ep-btn-delete" @click="
                deleteTimer(editOrigName);
              editOpen = false;
              ">
                {{ t("timer.delete") }}
              </button>
              <div v-else></div>
              <div class="ep-footer-right">
                <button class="ep-btn-cancel" @click="editOpen = false">
                  {{ t("timer.cancel") }}
                </button>
                <button class="ep-btn-save" @click="saveTimer" :disabled="!!saving">
                  {{ saving ? t("timer.saving") : t("timer.save") }}
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </Teleport>

    <!-- >>> share modal -->
    <Teleport to="body">
      <div v-if="shareOpen" class="ep-modal-overlay" @click.self="shareOpen = false">
        <div class="ep-modal">
          <div class="ep-modal-title">
            {{ t("timer.share.title") }}
            <span class="ep-modal-name">{{ shareTimer }}</span>
          </div>
          <div class="ep-modal-sub">{{ t("timer.share.sub") }}</div>
          <select v-model="shareTarget" class="ep-field-select-sm" style="width: 100%; margin-top: 12px">
            <option value="">{{ t("timer.share.select") }}</option>
            <option v-for="ch in availableChannels.filter(
              (c) => c !== session?.channel,
            )" :key="ch" :value="ch">
              #{{ ch }}
            </option>
          </select>
          <div v-if="shareError" class="ep-modal-msg err">{{ shareError }}</div>
          <div v-if="shareSuccess" class="ep-modal-msg ok">
            {{ shareSuccess }}
          </div>
          <div class="ep-modal-footer">
            <button class="ep-btn-cancel" @click="shareOpen = false">
              {{ t("timer.cancel") }}
            </button>
            <button class="ep-btn-save" @click="doShare" :disabled="shareSaving || !shareTarget">
              {{
                shareSaving ? t("timer.share.copying") : t("timer.share.btn")
              }}
            </button>
          </div>
        </div>
      </div>
    </Teleport>

    <RowContextMenu :open="ctxOpen" :x="ctxX" :y="ctxY" :items="ctxItems" :cooldowns="ctxCooldowns" :swatch="ctxSwatch"
      :title="ctxTitle" @close="ctxOpen = false" />
    <ConfirmDialog :open="confirmOpen" :title="confirmData.title" :message="confirmData.message"
      :confirm-label="confirmData.confirmLabel" :danger="confirmData.danger" @confirm="onConfirm" @cancel="onCancel" />
  </div>
</template>

<style scoped>
.view-header-left {
  display: flex;
  align-items: center;
  gap: 12px;
  flex-wrap: wrap;
}

/* >>> single wrapper for header+list - .ep-view puts a 16px gap between its
   own direct children, which would otherwise split the header from the rows */
.timer-table {
  display: flex;
  flex-direction: column;
  flex: 1;
  min-height: 0;
  overflow: hidden;
}

.timer-table>.ep-row-list {
  flex: 1;
  min-height: 0;
}

.timer-row {
  grid-template-columns: 30px 160px 1fr 150px 190px auto;
}

.timer-name-text {
  font-size: 13px;
  font-weight: 600;
  color: #e0e0e0;
}

.timer-resp-cell {
  flex-direction: column;
  align-items: flex-start;
  justify-content: center;
  gap: 2px;
}

.timer-response {
  font-size: 11px;
  color: #888;
  font-family: "Consolas", "Fira Mono", monospace;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  max-width: 100%;
}

.timer-next {
  font-size: 10px;
  color: #9d6cff88;
  font-family: "Consolas", "Fira Mono", monospace;
}

.interval-row {
  display: flex;
  align-items: center;
  gap: 8px;
}

.interval-row .ep-field-input {
  flex: 1;
}

.new-timer-row {
  display: flex;
  align-items: center;
  gap: 6px;
}

.new-timer-input {
  height: 32px;
  padding: 0 10px;
  background: #111217;
  border: 1px solid #6f2bff55;
  color: #e0e0e0;
  font-family: inherit;
  font-size: 13px;
  outline: none;
  width: 160px;
}

.new-timer-input:focus {
  border-color: #9d6cff;
}

.new-timer-input-conflict {
  border-color: #f1494966 !important;
  background: #1c1215 !important;
}

.new-timer-cancel {
  height: 32px;
  width: 32px;
  border: 1px solid #333;
  background: transparent;
  color: #666;
  font-size: 12px;
  cursor: pointer;
}

.new-timer-cancel:hover {
  color: #e0e0e0;
  border-color: #555;
}

.new-timer-error {
  font-size: 11px;
  color: #f14949;
}


@media (max-width: 680px) {
  .ep-panel-body {
    padding: 14px 16px;
  }

  .timer-row {
    padding: 10px 10px;
    gap: 8px;
  }

  /* >>> edit/share/delete move into the kebab on phone */
  .timer-row>.ep-row-actions {
    display: none;
  }

  .ep-sync-row {
    flex-wrap: wrap;
  }

  .new-timer-input {
    width: 120px;
  }
}
</style>
