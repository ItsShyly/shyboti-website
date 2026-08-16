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
import { iconSvg as iconSvgFor } from "../composables/icons";
import EditableNameHeader from "./shared/EditableNameHeader.vue";
import RefPanel from "./shared/RefPanel.vue";

const { session, availableChannels, channelRole } = useAuth();
const { t } = useI18n();

// >>> Open edit panel from global search
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

// >>> Live clock for next-fire countdowns
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
const editOrigName = ref(""); // <<< name before rename, so we know which row to delete
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
  loading.value = true;
  error.value = "";
  try {
    const res = await fetch(`${API}/timers/${session.value.channel}`, {
      headers: { Authorization: `Bearer ${session.value.token}` },
    });
    if (!res.ok) throw new Error();
    const data = (await res.json()) as { timers: Timer[] };
    timers.value = data.timers;
  } catch (e: any) {
    error.value = "Could not load timers: " + (e?.message ?? e);
  }
  loading.value = false;
}

const creatingNew = ref(false);
const newTimerInput = ref<HTMLInputElement | null>(null);

function startCreate() {
  // >>> Open the edit panel directly with a blank timer
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

// >>> Reference panel click-to-insert - inserts at the response editor's cursor
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
    // >>> renamed, old-named row is now a stale duplicate, delete it
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
    error.value = "Could not delete timer.";
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

// vvv share vvv
const shareOpen = ref(false);
const shareTimer = ref("");
const shareTarget = ref("");
const shareSaving = ref(false);
const shareSuccess = ref("");
const shareError = ref("");

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

// vvv sync vvv
const syncConf = ref<{
  sync_from: string;
  is_active: number;
  last_synced: number;
} | null>(null);
const syncOpen = ref(false);
const syncFrom = ref("");
const syncSaving = ref(false);
const syncRunning = ref(false);
const syncMsg = ref("");

async function fetchSync() {
  if (!session.value) return;
  try {
    const res = await fetch(`${API}/timer-sync/${session.value.channel}`, {
      headers: { Authorization: `Bearer ${session.value.token}` },
    });
    const data = (await res.json()) as { sync: any };
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
    syncMsg.value = "Failed to save.";
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
    syncMsg.value = "Sync stopped.";
  } catch {
    syncMsg.value = "Failed.";
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

// >>> Header (title/count/create) lives in AutomationsView.vue - expose what it needs
defineExpose({
  header: computed(() => ({
    count: timers.value.length,
    countLabel: t("auto.timers"),
    createLabel: t("timer.new"),
    canCreate: canEdit.value,
  })),
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
});
</script>

<template>
  <div class="ep-view">
    <Teleport to="#auto-sync-slot-timers">
      <div class="ep-sync-wrap">
        <button v-if="syncConf?.is_active" class="ep-sync-indicator" @click="syncOpen = !syncOpen"
          :title="`${t('timer.sync.active')} #${syncConf.sync_from}`">
          <span class="ep-sync-dot"></span>{{ t("timer.sync.active") }} #{{ syncConf.sync_from }}
          <span class="ep-sync-chevron" :class="{ open: syncOpen }"></span>
        </button>
        <button v-else class="ep-sync-config-btn" @click="syncOpen = !syncOpen">
          {{ t("timer.sync.config") }} <span class="ep-sync-chevron" :class="{ open: syncOpen }"></span>
        </button>
        <div v-if="syncOpen" class="ep-sync-panel">
          <div class="ep-sync-modes">
            <button class="ep-sync-mode-btn active">Sync (ongoing)</button>
            <button class="ep-sync-mode-btn" @click="syncOpen = false">Import (one-time)</button>
          </div>
          <div class="ep-sync-row">
            <select v-model="syncFrom" class="ep-field-select-sm">
              <option value="">{{ syncConf?.is_active ? t("timer.sync.change") : t("timer.sync.select") }}</option>
              <option v-for="ch in availableChannels.filter((c) => c !== session?.channel)" :key="ch" :value="ch">#{{ ch }}</option>
            </select>
            <button class="ep-sync-save-btn" @click="saveSync" :disabled="syncSaving || !syncFrom">
              {{ syncSaving ? '…' : syncConf?.is_active ? t('timer.sync.update') : t('timer.sync.enable') }}
            </button>
          </div>
          <div v-if="syncConf?.is_active" class="ep-sync-row">
            <button class="ep-sync-run-btn" @click="runSync" :disabled="syncRunning">{{ syncRunning ? '…' :
              t("timer.sync.pull") }}</button>
            <button class="ep-sync-stop-btn" @click="stopSync">{{ t("timer.sync.stop") }}</button>
          </div>
          <div v-if="syncConf?.last_synced" class="ep-sync-last">{{ t("timer.sync.last") }} {{ new Date(syncConf.last_synced).toLocaleString() }}</div>
          <div v-if="syncMsg" class="ep-sync-msg" :class="{ err: syncMsg.includes('fail') || syncMsg.includes('Error') }">{{ syncMsg }}</div>
        </div>
      </div>
    </Teleport>

    <div v-if="success" class="ep-toast success">{{ success }}</div>
    <div v-if="error" class="ep-toast error">{{ error }}</div>

    <div v-if="loading" class="ep-empty">{{ t("timer.loading") }}</div>
    <div v-else-if="!timers.length" class="ep-empty">
      {{ t("timer.empty") }}
    </div>

    <div v-else class="ep-row-list">
      <div v-for="timer in timers" :key="timer.id" class="ep-list-row timer-row"
        :class="{ inactive: !timer.is_active }">
        <div class="timer-toggle-wrap">
          <button class="square" :class="{ on: timer.is_active, off: !timer.is_active, disabled: !canToggle }"
            @click="canToggle && toggleActive(timer)" :title="timer.is_active ? 'Disable' : 'Enable'"></button>
        </div>
        <div class="timer-info" @click="openEdit(timer)">
          <div class="timer-name">{{ timer.name }}</div>
          <div class="timer-meta">
            <span class="ep-meta-pill interval"><span v-html="iconSvgFor('clock')"></span> {{ fmtInterval(timer.interval_sec) }}</span>
            <span v-if="timer.min_messages" class="ep-meta-pill msgs"><span v-html="iconSvgFor('message-circle')"></span> {{ timer.min_messages }}+ msgs</span>
            <span v-if="timer.enabled_when !== 'always'" class="ep-meta-pill when">{{ timer.enabled_when }}</span>
            <span v-if="timer.required_game" class="ep-meta-pill game">{{ timer.required_game }}</span>
            <span v-if="timer.condition" class="ep-meta-pill cond">if …</span>
          </div>
          <div class="timer-response">
            {{ timer.response.slice(0, 80)
            }}{{ timer.response.length > 80 ? "…" : "" }}
          </div>
          <div v-if="timer.is_active" class="timer-next">
            {{ fmtNextFire(timer) }}
          </div>
        </div>
        <div class="ep-row-actions">
          <button class="ep-btn-action edit" @click.stop="canEdit && openEdit(timer)" :class="{ disabled: !canEdit }">
            {{ canEdit ? t("timer.edit") : t("timer.view") }}
          </button>
          <button class="ep-btn-action share" @click.stop="openShare(timer.name)" :title="t('timer.share')">
            <span v-html="iconSvgFor('corner-up-right')"></span>
          </button>
          <button v-if="canDelete" class="ep-btn-action del" @click.stop="deleteTimer(timer.name)"
            :disabled="saving === timer.name">
            <span v-html="iconSvgFor('trash')"></span>
          </button>
        </div>
      </div>
    </div>

    <!-- >>> edit panel -->
    <Teleport to="body">
      <div v-if="editOpen" class="ep-overlay" v-bind="overlay.handlers(() => (editOpen = false))">
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
  </div>
</template>

<style scoped>
.view-header-left {
  display: flex;
  align-items: center;
  gap: 12px;
  flex-wrap: wrap;
}

.timer-toggle-wrap {
  flex-shrink: 0;
}

.timer-info {
  flex: 1;
  cursor: pointer;
  min-width: 0;
}

.timer-name {
  font-size: 13px;
  font-weight: 600;
  color: #e0e0e0;
  margin-bottom: 4px;
}

.timer-meta {
  display: flex;
  gap: 6px;
  flex-wrap: wrap;
  margin-bottom: 4px;
}

.timer-response {
  font-size: 11px;
  color: #555;
  font-family: "Consolas", "Fira Mono", monospace;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.timer-next {
  font-size: 10px;
  color: #9d6cff88;
  margin-top: 2px;
  font-family: "Consolas", "Fira Mono", monospace;
}

.ep-meta-pill.msgs {
  color: #4ec9b0;
  border-color: #4ec9b044;
  background: #4ec9b011;
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

  .ep-row-actions {
    gap: 4px;
  }

  .ep-btn-action {
    padding: 0 8px;
    font-size: 10px;
  }

  .ep-sync-row {
    flex-wrap: wrap;
  }

  .new-timer-input {
    width: 120px;
  }
}
</style>
