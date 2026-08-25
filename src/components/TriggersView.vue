<script setup lang="ts">
import {
  ref,
  computed,
  onMounted,
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
import TypeaheadInput from "./shared/TypeaheadInput.vue";
import type { TypeaheadItem } from "./shared/TypeaheadInput.vue";

const { session, availableChannels, channelRole } = useAuth();
const { t } = useI18n();

// >>> opens edit panel from global search
const searchOpenTrigger = inject<Ref<string | null>>(
  "searchOpenTrigger",
  ref(null),
);
watch(searchOpenTrigger, (name) => {
  if (!name) return;
  searchOpenTrigger.value = null;
  const tr = triggers.value.find((t) => t.name === name);
  if (tr) {
    nextTick(() => openEdit(tr));
  } else {
    load().then(() => {
      const t2 = triggers.value.find((t) => t.name === name);
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

interface Trigger {
  id: number;
  name: string;
  event_type: string;
  match_pattern: string;
  match_type: string;
  response: string;
  action_type: string;
  enabled_when: string;
  required_game: string;
  condition: string;
  cooldown_sec: number;
  is_active: number;
  event_reward_id: string;
  action_reward_id: string;
  action_reward_state: string;
  linked_command: string;
  action_extra: string;
  event_category_mode: string;
}

const triggers = ref<Trigger[]>([]);
const loading = ref(false);
const saving = ref<string | null>(null);
const error = ref("");
const success = ref("");

// >>> all rewards (bot + twitch-created) - the event side can watch redemptions
// >>> on any reward, only the action side is limited to ones we can toggle
const rewardOptions = ref<
  { id: string; title: string; manageable: boolean; userInputRequired: boolean }[]
>([]);
const rewardTitleById = computed(() =>
  Object.fromEntries(rewardOptions.value.map((r) => [r.id, r.title])),
);
// >>> only bot-created rewards can actually be toggled via the api
const manageableRewardOptions = computed(() =>
  rewardOptions.value.filter((r) => r.manageable),
);
async function loadRewards() {
  if (!session.value) return;
  try {
    const res = await fetch(`${API}/channelpoints/${session.value.channel}`, {
      headers: { Authorization: `Bearer ${session.value.token}` },
    });
    if (!res.ok) return;
    const data = await res.json();
    rewardOptions.value = (data.rewards ?? []).map((r: any) => ({
      id: r.id,
      title: r.title,
      manageable: !!r.manageable,
      userInputRequired: !!r.userInputRequired,
    }));
  } catch {
    rewardOptions.value = [];
  }
}

// >>> combined builtin + custom command names, for the run/create-command pickers
const commandNames = ref<string[]>([]);
async function loadCommandNames() {
  if (!session.value) return;
  try {
    const h = { Authorization: `Bearer ${session.value.token}` };
    const [builtinRes, customRes] = await Promise.all([
      fetch(`${API}/commands/${session.value.channel}`, { headers: h }),
      fetch(`${API}/custom-commands/${session.value.channel}`, { headers: h }),
    ]);
    const names = new Set<string>();
    if (builtinRes.ok) {
      const d = await builtinRes.json();
      for (const c of d.commands ?? []) if (c?.name) names.add(c.name);
    }
    if (customRes.ok) {
      const d = await customRes.json();
      for (const c of d.commands ?? []) if (c?.name) names.add(c.name);
    }
    commandNames.value = [...names].sort();
  } catch {
    commandNames.value = [];
  }
}

const editOpen = ref(false);
const editTab = ref<"settings" | "advanced">("settings");
const isNew = ref(false);
const editOrigName = ref(""); // <<< old name, needed to delete on rename
const overlay = useOverlayClose();
const editorRef = ref<HTMLDivElement | null>(null);
const editTrigger = ref<Partial<Trigger> & { name: string }>({
  name: "",
  event_type: "message",
  match_pattern: "",
  match_type: "contains",
  response: "",
  action_type: "say",
  enabled_when: "always",
  required_game: "",
  condition: "",
  cooldown_sec: 30,
  is_active: 1,
  event_reward_id: "",
  action_reward_id: "",
  action_reward_state: "activate",
  linked_command: "",
  action_extra: "",
  event_category_mode: "",
});

// >>> static, not translated on purpose
const EVENT_TYPES = [
  {
    value: "message",
    label: "Chat message",
    hint: "Any message matching the pattern",
  },
  {
    value: "command",
    label: "Command used",
    hint: "When a specific command is triggered",
  },
  {
    value: "follow",
    label: "Follow",
    hint: "New follower (requires EventSub)",
  },
  { value: "sub", label: "Sub / Resub", hint: "Subscription event" },
  { value: "bits", label: "Bits cheer", hint: "Bits donation event" },
  { value: "raid", label: "Raid", hint: "Incoming raid" },
  {
    value: "schedule",
    label: "Schedule",
    hint: "At a specific time (cron-like)",
  },
  {
    value: "category",
    label: "Category",
    hint: "Stream category/game changed",
  },
  {
    value: "channel_point_reward",
    label: "Channel Point Reward",
    hint: "A specific reward gets redeemed",
  },
];

const MATCH_TYPES = [
  { value: "contains", label: "contains" },
  { value: "exact", label: "exact match" },
  { value: "starts", label: "starts with" },
  { value: "ends", label: "ends with" },
  { value: "regex", label: "regex" },
];

// >>> "" fires once (normal path), "while_active" keeps the reward synced and
// >>> reverts it when the category changes away
const CATEGORY_MODES = [
  { value: "", label: "trigger.gate.once" },
  { value: "while_active", label: "trigger.gate.while_active" },
];

async function fetchCategories(query: string): Promise<TypeaheadItem[]> {
  if (!session.value) return [];
  try {
    const res = await fetch(
      `${API}/obs/twitch/categories?q=${encodeURIComponent(query)}`,
      { headers: { Authorization: `Bearer ${session.value.token}` } },
    );
    if (!res.ok) return [];
    const d = (await res.json()) as {
      categories: { id: string; name: string; box_art_url: string }[];
    };
    return (d.categories ?? []).map((c) => ({
      id: c.id,
      label: c.name,
      iconUrl: c.box_art_url,
    }));
  } catch {
    return [];
  }
}

// >>> stale mode would otherwise linger once the combo it applies to breaks
watch(
  () => [editTrigger.value.event_type, editTrigger.value.action_type],
  () => {
    if (
      editTrigger.value.event_category_mode &&
      !(
        editTrigger.value.event_type === "category" &&
        editTrigger.value.action_type === "channel_point_reward"
      )
    )
      editTrigger.value.event_category_mode = "";
  },
);

const ACTION_TYPES = [
  { value: "say", label: "Send message" },
  { value: "set_title", label: "Set stream title" },
  { value: "set_category", label: "Set stream category" },
  { value: "timeout", label: "Timeout user" },
  { value: "ban", label: "Ban user" },
  { value: "mod", label: "Mod user" },
  { value: "shoutout", label: "Shoutout" },
  { value: "run_command", label: "Run a command" },
  { value: "create_command", label: "Create a command" },
  { value: "channel_point_reward", label: "Channel Point Reward" },
];

function showSuccess(msg: string) {
  success.value = msg;
  setTimeout(() => (success.value = ""), 3000);
}

async function load() {
  if (!session.value) return;
  loading.value = true;
  error.value = "";
  try {
    const res = await fetch(`${API}/triggers/${session.value.channel}`, {
      headers: { Authorization: `Bearer ${session.value.token}` },
    });
    if (!res.ok) throw new Error();
    const data = (await res.json()) as { triggers: Trigger[] };
    triggers.value = data.triggers;
  } catch (e: any) {
    error.value = "Could not load triggers: " + (e?.message ?? e);
  }
  loading.value = false;
}

function openNew() {
  error.value = "";
  editTab.value = "settings";
  isNew.value = true;
  editOrigName.value = "";
  editTrigger.value = {
    name: "",
    event_type: "message",
    match_pattern: "",
    match_type: "contains",
    response: "",
    action_type: "say",
    enabled_when: "always",
    required_game: "",
    condition: "",
    cooldown_sec: 30,
    is_active: 1,
    event_reward_id: "",
    action_reward_id: "",
    action_reward_state: "activate",
    linked_command: "",
    action_extra: "",
    event_category_mode: "",
  };
  editOpen.value = true;
  setTimeout(() => {
    if (editorRef.value) setEditorContent(editorRef.value, "");
  }, 50);
}

function openEdit(trigger: Trigger) {
  error.value = "";
  editTab.value = "settings";
  isNew.value = false;
  editOrigName.value = trigger.name;
  editTrigger.value = { ...trigger };
  editOpen.value = true;
  setTimeout(() => {
    if (editorRef.value) setEditorContent(editorRef.value, trigger.response);
  }, 50);
}

function onEditorInput() {
  const el = editorRef.value;
  if (!el) return;
  editTrigger.value.response = el.innerText.replace(/\n$/, "");
  applyScriptHighlight(el);
}

// >>> say/create_command swap to different DOM nodes, editorRef needs re-populating
watch(
  () => editTrigger.value.action_type,
  () => {
    nextTick(() => {
      if (editorRef.value) setEditorContent(editorRef.value, editTrigger.value.response ?? "");
    });
  },
);

// >>> inserts token at editor cursor
function insertRefToken(token: string) {
  const el = editorRef.value;
  if (!el) return;
  editTrigger.value.response = insertTokenAtCursor(el, token);
}

// >>> matches the server's own rule for what counts as a "keyword" trigger
function isKeywordTrigger(): boolean {
  return (
    (editTrigger.value.event_type ?? "message") === "message" &&
    editTrigger.value.action_type === "run_command"
  );
}

// >>> "while_active" category+reward triggers auto-revert instead of firing once
function isCategoryGate(): boolean {
  return (
    editTrigger.value.event_type === "category" &&
    editTrigger.value.action_type === "channel_point_reward" &&
    editTrigger.value.event_category_mode === "while_active"
  );
}

// >>> trigger's own name is meaningless/auto-generated for these - hide the
// >>> name input and show what it's actually tied to instead
function isAutoNamed(): boolean {
  return (
    isKeywordTrigger() ||
    editTrigger.value.action_type === "channel_point_reward" ||
    editTrigger.value.event_type === "channel_point_reward"
  );
}

// >>> chat-message triggers have no "redeemer input" - the match itself is the message
function placeholderHint(): string {
  return editTrigger.value.event_type === "message"
    ? t("trigger.field.placeholder_hint_msg")
    : t("trigger.field.placeholder_hint");
}

// >>> true wherever the current action's text field(s) actually use {input}
function currentActionUsesInput(): boolean {
  const at = editTrigger.value.action_type;
  if (at === "run_command") return (editTrigger.value.action_extra ?? "").includes("{input}");
  if (at === "create_command")
    return (
      (editTrigger.value.action_extra ?? "").includes("{input}") ||
      (editTrigger.value.response ?? "").includes("{input}")
    );
  if (at === "channel_point_reward") return false;
  return (editTrigger.value.response ?? "").includes("{input}");
}

// >>> {input} is empty for a twitch-created reward with input collection off
function needsInputWarning(): boolean {
  if (editTrigger.value.event_type !== "channel_point_reward") return false;
  const r = rewardOptions.value.find((r) => r.id === editTrigger.value.event_reward_id);
  if (!r || r.manageable || r.userInputRequired) return false;
  return currentActionUsesInput();
}

function autoNamedTagLabel(): string {
  if (isKeywordTrigger()) return "+" + (editTrigger.value.response ?? "");
  const rid =
    editTrigger.value.action_reward_id || editTrigger.value.event_reward_id || "";
  return rewardTitleById.value[rid] ?? t("trigger.field.reward");
}

async function saveTrigger() {
  if (!session.value) return;
  // >>> auto-named triggers (keyword/reward-tied) don't need a name, generated below
  if (isAutoNamed() && !editTrigger.value.name?.trim()) {
    let base = "trig";
    if (isKeywordTrigger()) {
      const slug = (editTrigger.value.response ?? "")
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-+|-+$/g, "");
      base = `kw-${slug || "cmd"}`;
    } else {
      const rid =
        editTrigger.value.action_reward_id ||
        editTrigger.value.event_reward_id ||
        "";
      const slug = (rewardTitleById.value[rid] ?? "")
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-+|-+$/g, "");
      base = `cp-${slug || "reward"}`;
    }
    editTrigger.value.name = `${base}-${Math.random().toString(36).slice(2, 7)}`;
  }
  const missing: string[] = [];
  if (!editTrigger.value.name?.trim()) missing.push(t("trigger.field.name"));
  const responseOptional = ["shoutout", "channel_point_reward", "create_command"].includes(
    editTrigger.value.action_type ?? "",
  );
  if (!editTrigger.value.response?.trim() && !responseOptional)
    missing.push(t("trigger.field.response"));
  if (
    editTrigger.value.action_type === "channel_point_reward" &&
    !editTrigger.value.action_reward_id
  )
    missing.push(t("trigger.field.reward"));
  if (
    editTrigger.value.event_type === "channel_point_reward" &&
    !editTrigger.value.event_reward_id
  )
    missing.push(t("trigger.field.reward"));
  if (
    editTrigger.value.event_type === "category" &&
    !editTrigger.value.required_game?.trim()
  )
    missing.push(t("trigger.field.category"));
  if (missing.length) {
    error.value = t("edit.missing_fields") + missing.join(", ");
    return;
  }
  saving.value = editTrigger.value.name;
  try {
    const name = editTrigger.value.name.trim();
    const res = await fetch(
      `${API}/triggers/${session.value.channel}/${name}`,
      {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${session.value.token}`,
        },
        body: JSON.stringify(editTrigger.value),
      },
    );
    if (!res.ok) throw new Error(await res.text());
    // >>> renamed, delete the old duplicate row
    if (!isNew.value && editOrigName.value && editOrigName.value !== name) {
      await fetch(
        `${API}/triggers/${session.value.channel}/${editOrigName.value}`,
        {
          method: "DELETE",
          headers: { Authorization: `Bearer ${session.value.token}` },
        },
      ).catch(() => { });
    }
    showSuccess(t("trigger.save") + "!");
    editOpen.value = false;
    load();
  } catch (e: any) {
    error.value = "Could not save trigger: " + (e?.message ?? e);
  } finally {
    saving.value = null;
  }
}

async function deleteTrigger(name: string) {
  if (!session.value) return;
  saving.value = name;
  try {
    await fetch(`${API}/triggers/${session.value.channel}/${name}`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${session.value.token}` },
    });
    triggers.value = triggers.value.filter((trigger) => trigger.name !== name);
    if (editOpen.value && editTrigger.value.name === name)
      editOpen.value = false;
  } catch {
    error.value = "Could not delete trigger.";
  }
  saving.value = null;
}

async function toggleActive(trigger: Trigger) {
  if (!session.value) return;
  const next = trigger.is_active ? 0 : 1;
  await fetch(`${API}/triggers/${session.value.channel}/${trigger.name}`, {
    method: "PATCH",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${session.value.token}`,
    },
    body: JSON.stringify({ is_active: next }),
  });
  trigger.is_active = next;
}

// vvv share vvv
const shareOpen = ref(false);
const shareTrigger = ref("");
const shareTarget = ref("");
const shareSaving = ref(false);
const shareSuccess = ref("");
const shareError = ref("");

function openShare(name: string) {
  shareTrigger.value = name;
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
      `${API}/triggers/${session.value.channel}/${shareTrigger.value}/share`,
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
      `${API}/trigger-sync/${session.value.channel}/import`,
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
    syncMsg.value = `Imported ${data.count} triggers from #${syncFrom.value}.`;
    await load();
  } catch (e: any) {
    syncMsg.value = e.message ?? "Import failed";
  }
  syncImporting.value = false;
}

async function fetchSync() {
  if (!session.value) return;
  try {
    const res = await fetch(`${API}/trigger-sync/${session.value.channel}`, {
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
    await fetch(`${API}/trigger-sync/${session.value.channel}`, {
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
    await fetch(`${API}/trigger-sync/${session.value.channel}`, {
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
    const res = await fetch(
      `${API}/trigger-sync/${session.value.channel}/run`,
      {
        method: "POST",
        headers: { Authorization: `Bearer ${session.value.token}` },
      },
    );
    const data = (await res.json()) as { count?: number; error?: string };
    if (!res.ok) throw new Error(data.error);
    syncMsg.value = `Synced ${data.count} triggers from #${syncConf.value?.sync_from}.`;
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
  loadRewards();
  loadCommandNames();
});
watch(
  () => session.value?.channel,
  () => {
    load();
    fetchSync();
    loadRewards();
    loadCommandNames();
  },
);

function eventLabel(v: string) {
  return EVENT_TYPES.find((e) => e.value === v)?.label ?? v;
}
function actionLabel(v: string) {
  return ACTION_TYPES.find((a) => a.value === v)?.label ?? v;
}
function matchLabel(v: string) {
  return MATCH_TYPES.find((m) => m.value === v)?.label ?? v;
}

const needsPattern = (ev: string) => ["message", "command"].includes(ev);

// >>> header stuff lives in AutomationsView, exposed for it
defineExpose({
  header: computed(() => ({
    count: triggers.value.length,
    countLabel: t("auto.triggers"),
    createLabel: t("trigger.new"),
    canCreate: canEdit.value,
  })),
  reload: () => {
    load();
    fetchSync();
  },
  create: () => {
    canEdit.value && openNew();
  },
  close: () => {
    editOpen.value = false;
    shareOpen.value = false;
  },
});
</script>

<template>
  <div class="ep-view">
    <Teleport to="#auto-sync-slot-triggers">
      <div class="ep-sync-wrap">
        <button v-if="syncConf?.is_active" class="ep-sync-indicator" @click="syncOpen = !syncOpen"
          :title="`${t('trigger.sync.active')} #${syncConf.sync_from}`">
          <span class="ep-sync-dot"></span>{{ t("trigger.sync.active") }} #{{ syncConf.sync_from }}
          <span class="ep-sync-chevron" :class="{ open: syncOpen }"></span>
        </button>
        <button v-else class="ep-sync-config-btn" @click="syncOpen = !syncOpen">
          {{ t("trigger.sync.config") }} <span class="ep-sync-chevron" :class="{ open: syncOpen }"></span>
        </button>
        <div v-if="syncOpen" class="ep-sync-panel">
          <div class="ep-sync-modes">
            <button class="ep-sync-mode-btn" :class="{ active: syncMode === 'ongoing' }"
              @click="syncMode = 'ongoing'">Sync (ongoing)</button>
            <button class="ep-sync-mode-btn" :class="{ active: syncMode === 'import' }"
              @click="syncMode = 'import'">Import (one-time)</button>
          </div>
          <div class="ep-sync-row">
            <select v-model="syncFrom" class="ep-field-select-sm">
              <option value="">{{ syncMode === 'import' ? t("trigger.sync.select") : (syncConf?.is_active ?
                t("trigger.sync.change") : t("trigger.sync.select")) }}</option>
              <option v-for="ch in availableChannels.filter((c) => c !== session?.channel)" :key="ch" :value="ch">#{{ ch }}</option>
            </select>
            <button v-if="syncMode === 'import'" class="ep-sync-save-btn" @click="runImport"
              :disabled="syncImporting || !syncFrom">
              {{ syncImporting ? '…' : 'Import' }}
            </button>
            <button v-else class="ep-sync-save-btn" @click="saveSync" :disabled="syncSaving || !syncFrom">
              {{ syncSaving ? '…' : syncConf?.is_active ? t('trigger.sync.update') : t('trigger.sync.enable') }}
            </button>
          </div>
          <div v-if="syncMode === 'ongoing' && syncConf?.is_active" class="ep-sync-row">
            <button class="ep-sync-run-btn" @click="runSync" :disabled="syncRunning">{{ syncRunning ? '…' :
              t("trigger.sync.pull") }}</button>
            <button class="ep-sync-stop-btn" @click="stopSync">{{ t("trigger.sync.stop") }}</button>
          </div>
          <div v-if="syncMode === 'ongoing' && syncConf?.last_synced" class="ep-sync-last">{{ t("trigger.sync.last") }} {{ new Date(syncConf.last_synced).toLocaleString() }}</div>
          <div v-if="syncMsg" class="ep-sync-msg" :class="{ err: syncMsg.includes('fail') || syncMsg.includes('Error') }">{{ syncMsg }}</div>
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
    <div v-else-if="!triggers.length" class="ep-empty">
      {{ t("trigger.empty") }}
    </div>

    <div v-else class="ep-row-list">
      <div v-for="trigger in triggers" :key="trigger.id" class="ep-list-row trigger-row"
        :class="{ inactive: !trigger.is_active }">
        <div class="trigger-toggle-wrap">
          <button class="ep-switch" :class="{ on: trigger.is_active, off: !trigger.is_active, disabled: !canToggle }"
            @click="canToggle && toggleActive(trigger)"><span class="ep-switch-knob"></span></button>
        </div>
        <div class="trigger-info" @click="openEdit(trigger)">
          <div v-if="trigger.linked_command" class="trigger-name">
            <span class="ep-meta-pill linked-command"><span v-html="iconSvgFor('link')"></span> +{{ trigger.linked_command }}</span>
          </div>
          <div v-else class="trigger-name">{{ trigger.name }}</div>
          <div class="trigger-meta">
            <span class="ep-meta-pill event">{{
              eventLabel(trigger.event_type)
              }}</span>
            <span v-if="trigger.match_pattern" class="ep-meta-pill pattern">{{ matchLabel(trigger.match_type) }}: "{{
              trigger.match_pattern.slice(0, 20)
            }}{{ trigger.match_pattern.length > 20 ? "…" : "" }}"</span>
            <span class="ep-meta-pill action"><span v-html="iconSvgFor('arrow-right')"></span> {{ actionLabel(trigger.action_type) }}</span>
            <span v-if="trigger.enabled_when !== 'always'" class="ep-meta-pill when">{{ trigger.enabled_when }}</span>
            <span v-if="trigger.required_game" class="ep-meta-pill game">{{ trigger.required_game }}</span>
            <span v-if="trigger.cooldown_sec" class="ep-meta-pill cd"><span v-html="iconSvgFor('clock')"></span> {{ trigger.cooldown_sec }}s cd</span>
          </div>
          <div class="trigger-response">
            {{ trigger.response.slice(0, 80)
            }}{{ trigger.response.length > 80 ? "…" : "" }}
          </div>
        </div>
        <div class="ep-row-actions">
          <button class="ep-btn-action edit" @click.stop="canEdit && openEdit(trigger)" :class="{ disabled: !canEdit }">
            {{ canEdit ? t("trigger.edit") : t("trigger.view") }}
          </button>
          <button class="ep-btn-action share" @click.stop="openShare(trigger.name)" title="Copy to another channel">
            <span v-html="iconSvgFor('corner-up-right')"></span>
          </button>
          <button v-if="canDelete" class="ep-btn-action del" @click.stop="deleteTrigger(trigger.name)"
            :disabled="saving === trigger.name">
            <span v-html="iconSvgFor('trash')"></span>
          </button>
        </div>
      </div>
    </div>

    <Teleport to="body">
      <div v-if="editOpen" class="ep-overlay" v-bind="overlay.handlers(() => (editOpen = false))">
        <div class="ep-panel">
          <div class="ep-panel-header">
            <div>
              <div class="ep-panel-title">
                {{ isNew ? t("trigger.edit_new") : t("trigger.edit_title") }}
                <span v-if="isAutoNamed()" class="ep-meta-pill linked-command">
                  <span v-html="iconSvgFor(isKeywordTrigger() ? 'link' : 'zap')"></span>
                  {{ autoNamedTagLabel() }}
                </span>
                <EditableNameHeader v-else v-model="editTrigger.name" :orig-name="editOrigName"
                  placeholder="hype-train" />
              </div>
              <div class="ep-panel-sub">#{{ session?.channel }}</div>
            </div>
            <button class="ep-panel-close" @click="editOpen = false" v-html="iconSvgFor('x')"></button>
          </div>

          <div class="ep-panel-body">
            <div v-if="error" class="ep-toast error">{{ error }}</div>

            <div class="ep-tabs">
              <button class="ep-tab" :class="{ active: editTab === 'settings' }"
                @click="editTab = 'settings'">{{ t("edit.tab_response") }}</button>
              <button class="ep-tab" :class="{ active: editTab === 'advanced' }"
                @click="editTab = 'advanced'">{{ t("edit.tab_behavior") }}</button>
            </div>

            <template v-if="editTab === 'settings'">
            <div class="ep-field-group">
              <label class="ep-field-label">{{
                t("trigger.field.event")
                }}</label>
              <div class="event-grid">
                <button v-for="e in EVENT_TYPES" :key="e.value" class="event-btn"
                  :class="{ active: editTrigger.event_type === e.value }" @click="editTrigger.event_type = e.value"
                  :title="e.hint">
                  {{ e.label }}
                </button>
              </div>
            </div>

            <div v-if="needsPattern(editTrigger.event_type ?? 'message')" class="ep-field-group">
              <label class="ep-field-label">{{
                t("trigger.field.match")
                }}</label>
              <div class="match-row">
                <select v-model="editTrigger.match_type" class="ep-field-select match-type">
                  <option v-for="m in MATCH_TYPES" :key="m.value" :value="m.value">
                    {{ m.label }}
                  </option>
                </select>
                <input v-model="editTrigger.match_pattern" class="ep-field-input" placeholder="!lurk or hello" />
              </div>
            </div>

            <div v-if="editTrigger.event_type === 'channel_point_reward'" class="ep-field-group">
              <label class="ep-field-label">{{ t("trigger.field.reward") }}</label>
              <TypeaheadInput :model-value="rewardTitleById[editTrigger.event_reward_id ?? ''] ?? ''"
                :items="rewardOptions.map((r) => r.title)" placeholder="pick a reward"
                @select="(item: any) => (editTrigger.event_reward_id = rewardOptions.find((r) => r.title === item.label)?.id ?? '')" />
            </div>

            <div v-if="editTrigger.event_type === 'category'" class="ep-field-group">
              <label class="ep-field-label">{{ t("trigger.field.category") }}</label>
              <TypeaheadInput :model-value="editTrigger.required_game ?? ''" :fetch-items="fetchCategories"
                :min-chars="1" placeholder="Just Chatting"
                @update:model-value="(v: string) => (editTrigger.required_game = v)"
                @select="(item: any) => (editTrigger.required_game = item.label)" />
            </div>

            <div class="ep-field-group">
              <label class="ep-field-label">{{
                t("trigger.field.action")
                }}</label>
              <div class="action-grid">
                <button v-for="a in ACTION_TYPES" :key="a.value" class="action-btn"
                  :class="{ active: editTrigger.action_type === a.value }" @click="editTrigger.action_type = a.value">
                  {{ a.label }}
                </button>
              </div>
            </div>

            <template v-if="editTrigger.action_type === 'channel_point_reward'">
              <div class="ep-field-group">
                <label class="ep-field-label">{{ t("trigger.field.reward") }}</label>
                <TypeaheadInput :model-value="rewardTitleById[editTrigger.action_reward_id ?? ''] ?? ''"
                  :items="manageableRewardOptions.map((r) => r.title)" placeholder="pick a bot-created reward"
                  @select="(item: any) => (editTrigger.action_reward_id = manageableRewardOptions.find((r) => r.title === item.label)?.id ?? '')" />
              </div>
              <div class="ep-field-group">
                <label class="ep-field-label">{{ t("trigger.field.reward_state") }}</label>
                <div class="action-grid">
                  <button class="action-btn" :class="{ active: editTrigger.action_reward_state === 'activate' }"
                    @click="editTrigger.action_reward_state = 'activate'">{{ t("trigger.reward_state.activate") }}</button>
                  <button class="action-btn" :class="{ active: editTrigger.action_reward_state === 'deactivate' }"
                    @click="editTrigger.action_reward_state = 'deactivate'">{{ t("trigger.reward_state.deactivate") }}</button>
                </div>
              </div>
              <div v-if="editTrigger.event_type === 'category'" class="ep-field-group">
                <label class="ep-field-label">{{ t("trigger.field.gate_mode") }}</label>
                <div class="action-grid">
                  <button v-for="m in CATEGORY_MODES" :key="m.value" class="action-btn"
                    :class="{ active: editTrigger.event_category_mode === m.value }"
                    @click="editTrigger.event_category_mode = m.value">
                    {{ t(m.label) }}
                  </button>
                </div>
                <div v-if="isCategoryGate()" class="ep-field-hint">{{ t("trigger.gate.hint") }}</div>
              </div>
            </template>

            <template v-else-if="editTrigger.action_type === 'run_command'">
              <div class="ep-field-group">
                <label class="ep-field-label">{{ t("trigger.field.command") }}</label>
                <TypeaheadInput :model-value="editTrigger.response ?? ''" :items="commandNames" placeholder="shoutout"
                  @update:model-value="(v: string) => (editTrigger.response = v)" />
              </div>
              <div class="ep-field-group">
                <label class="ep-field-label">{{ t("trigger.field.args") }}
                  <span class="ep-field-hint">{{ placeholderHint() }}</span>
                </label>
                <input v-model="editTrigger.action_extra" class="ep-field-input" />
              </div>
              <div v-if="needsInputWarning()" class="cp-input-warning">
                <span v-html="iconSvgFor('alert-triangle')"></span>
                <span>{{ t("cp.actions.need_input_warning") }}</span>
              </div>
            </template>

            <template v-else-if="editTrigger.action_type === 'create_command'">
              <div class="ep-field-group">
                <label class="ep-field-label">{{ t("trigger.field.command_name") }}
                  <span class="ep-field-hint">{{ placeholderHint() }}</span>
                </label>
                <input v-model="editTrigger.action_extra" class="ep-field-input" placeholder="{user}" />
              </div>
              <div class="ep-field-group">
                <label class="ep-field-label">{{ t("trigger.field.command_response") }}
                  <span class="ep-field-hint">{{ placeholderHint() }}</span>
                </label>
                <div ref="editorRef" class="ep-script-editor" contenteditable="true" spellcheck="false"
                  data-placeholder="$user.mention just got a new command! PogChamp" @input="onEditorInput"></div>
                <RefPanel :title="t('edit.var_ref')" @insert="insertRefToken" />
              </div>
              <div v-if="needsInputWarning()" class="cp-input-warning">
                <span v-html="iconSvgFor('alert-triangle')"></span>
                <span>{{ t("cp.actions.need_input_warning") }}</span>
              </div>
            </template>

            <div v-else class="ep-field-group">
              <label class="ep-field-label">
                {{
                  editTrigger.action_type === "say"
                    ? t("trigger.field.response")
                    : t("trigger.field.value")
                }}
                <span class="ep-field-hint">{{
                  editTrigger.action_type === "shoutout"
                    ? "Optional - who to shout out. Leave blank to shout out whoever/whatever triggered this (the raider, for raids)."
                    : editTrigger.event_type === "channel_point_reward"
                      ? t("trigger.field.resp_hint_cp")
                      : t("trigger.field.resp_hint")
                  }}</span>
              </label>
              <div ref="editorRef" class="ep-script-editor" contenteditable="true" spellcheck="false"
                :data-placeholder="editTrigger.action_type === 'shoutout' ? 'leave blank for the raider, or e.g. $user.name' : '$user.mention just triggered this! PogChamp'"
                @input="onEditorInput"></div>
              <RefPanel :title="t('edit.var_ref')" @insert="insertRefToken" />
              <div v-if="needsInputWarning()" class="cp-input-warning">
                <span v-html="iconSvgFor('alert-triangle')"></span>
                <span>{{ t("cp.actions.need_input_warning") }}</span>
              </div>
            </div>
            </template>

            <template v-if="editTab === 'advanced'">
            <div class="ep-row-3">
              <div class="ep-field-group">
                <label class="ep-field-label">{{
                  t("trigger.field.active_when")
                  }}</label>
                <select v-model="editTrigger.enabled_when" class="ep-field-select">
                  <option value="always">{{ t("trigger.when.always") }}</option>
                  <option value="online">{{ t("trigger.when.online") }}</option>
                  <option value="offline">
                    {{ t("trigger.when.offline") }}
                  </option>
                </select>
              </div>
              <div v-if="editTrigger.event_type !== 'category'" class="ep-field-group">
                <label class="ep-field-label">{{
                  t("trigger.field.game")
                  }}</label>
                <input v-model="editTrigger.required_game" class="ep-field-input" placeholder="optional" />
              </div>
              <div class="ep-field-group">
                <label class="ep-field-label">{{ t("trigger.field.cd") }}
                  <span class="ep-field-hint">s</span></label>
                <input v-model.number="editTrigger.cooldown_sec" type="number" min="0" class="ep-field-input" />
              </div>
            </div>

            <div class="ep-field-group">
              <label class="ep-field-label">{{ t("trigger.field.condition") }}
                <span class="ep-field-hint">{{
                  t("trigger.field.cond_hint")
                  }}</span></label>
              <input v-model="editTrigger.condition" class="ep-field-input ep-mono"
                placeholder="$channel.game == Just Chatting" />
            </div>
            </template>

            <div class="ep-panel-footer">
              <button v-if="!isNew && canDelete" class="ep-btn-delete" @click="
                deleteTrigger(editOrigName);
              editOpen = false;
              ">
                {{ t("trigger.delete") }}
              </button>
              <div v-else></div>
              <div class="ep-footer-right">
                <button class="ep-btn-cancel" @click="editOpen = false">
                  {{ t("trigger.cancel") }}
                </button>
                <button class="ep-btn-save" @click="saveTrigger" :disabled="!!saving">
                  {{ saving ? t("trigger.saving") : t("trigger.save") }}
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </Teleport>

    <Teleport to="body">
      <div v-if="shareOpen" class="ep-modal-overlay" @click.self="shareOpen = false">
        <div class="ep-modal">
          <div class="ep-modal-title">
            {{ t("trigger.share.title") }}
            <span class="ep-modal-name">{{ shareTrigger }}</span>
          </div>
          <div class="ep-modal-sub">{{ t("trigger.share.sub") }}</div>
          <select v-model="shareTarget" class="ep-field-select-sm" style="width: 100%; margin-top: 12px">
            <option value="">{{ t("trigger.share.select") }}</option>
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
              {{ t("trigger.cancel") }}
            </button>
            <button class="ep-btn-save" @click="doShare" :disabled="shareSaving || !shareTarget">
              {{
                shareSaving
                  ? t("trigger.share.copying")
                  : t("trigger.share.btn")
              }}
            </button>
          </div>
        </div>
      </div>
    </Teleport>
  </div>
</template>

<style scoped>
.cp-input-warning {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  font-size: 11px;
  color: #e5c07b;
  background: rgba(229, 192, 123, 0.08);
  border-left: 2px solid #e5c07b;
  padding: 8px 10px;
}

.cp-input-warning svg {
  flex-shrink: 0;
  margin-top: 1px;
}

.view-header-left {
  display: flex;
  align-items: center;
  gap: 12px;
  flex-wrap: wrap;
}

.trigger-toggle-wrap {
  flex-shrink: 0;
}

.trigger-info {
  flex: 1;
  cursor: pointer;
  min-width: 0;
}

.trigger-name {
  font-size: 13px;
  font-weight: 600;
  color: #e0e0e0;
  margin-bottom: 4px;
}

.trigger-meta {
  display: flex;
  gap: 6px;
  flex-wrap: wrap;
  margin-bottom: 4px;
}

.trigger-response {
  font-size: 11px;
  color: #555;
  font-family: "Consolas", "Fira Mono", monospace;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.ep-meta-pill.event {
  color: #569cd6;
  border-color: #569cd644;
  background: #569cd611;
}

.ep-meta-pill.pattern {
  color: #e5c07b;
  border-color: #e5c07b44;
  background: #e5c07b11;
  font-family: monospace;
}

.ep-meta-pill.action {
  color: #4ec9b0;
  border-color: #4ec9b044;
  background: #4ec9b011;
}

.ep-meta-pill.linked-command {
  color: #9d6cff;
  border-color: #9d6cff44;
  background: #9d6cff11;
  font-family: monospace;
}

.ep-meta-pill.cd {
  color: #c792ea;
  border-color: #c792ea44;
  background: #c792ea11;
}

.event-grid,
.action-grid {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
}

.event-btn,
.action-btn {
  height: 28px;
  padding: 0 12px;
  border: 1px solid #2a2a30;
  background: #111217;
  color: #666;
  font-family: inherit;
  font-size: 11px;
  cursor: pointer;
  transition: all 0.15s;
}

.event-btn:hover,
.action-btn:hover {
  color: #aaa;
  border-color: #444;
}

.event-btn.active {
  color: #569cd6;
  border-color: #569cd666;
  background: #569cd615;
}

.action-btn.active {
  color: #23d18b;
  border-color: #23d18b66;
  background: #23d18b15;
}

.match-row {
  display: flex;
  gap: 8px;
  align-items: flex-start;
}

.match-type {
  width: 140px;
  flex-shrink: 0;
  height: 36px; /* >>> matches input height */
}

.match-row .ep-field-input {
  flex: 1;
  height: 36px;
  font-size: 13px;
}

@media (max-width: 680px) {
  .ep-panel-body {
    padding: 14px 16px;
  }

  .match-row {
    flex-direction: column;
    gap: 6px;
  }

  .match-type {
    width: 100% !important;
  }

  .event-grid,
  .action-btn,
  .action-grid {
    flex-wrap: wrap;
  }

  .event-btn,
  .action-btn {
    flex: 1;
    min-width: 80px;
  }

  .trigger-row {
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
}
</style>
