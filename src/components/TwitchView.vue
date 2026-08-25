<script setup lang="ts">
import { ref, reactive, computed, onMounted, watch } from "vue";
import { API } from "../api";
import { useAuth } from "../auth";
import { useI18n } from "../i18n";
import { useOverlayClose } from "../composables/useOverlayClose";
import { iconSvg as iconSvgFor } from "../composables/icons";
import ChannelPointActionsEditor from "./shared/ChannelPointActionsEditor.vue";
import TypeaheadInput from "./shared/TypeaheadInput.vue";
import type { TypeaheadItem } from "./shared/TypeaheadInput.vue";
import {
  blankAction,
  actionNeedsInput,
  type RewardAction,
} from "../composables/channelPointActions";

const { session, channelRole, adminMode } = useAuth();
const { t } = useI18n();
const overlay = useOverlayClose();

interface Reward {
  id: string;
  title: string;
  cost: number;
  prompt: string;
  isEnabled: boolean;
  backgroundColor: string;
  userInputRequired: boolean;
  maxRedemptionsPerStream: number | null;
  maxRedemptionsPerUserPerStream: number | null;
  globalCooldown: number | null;
  isInStock: boolean;
  autoFulfill: boolean;
  manageable: boolean;
}

// >>> only "channel points" for now, more twitch tabs land later
type Tab = "channelpoints";
const activeTab = ref<Tab>("channelpoints");

const canManage = computed(
  () =>
    channelRole.value?.role === "broadcaster" ||
    !!(session.value?.isAdmin && adminMode.value),
);

const rewards = ref<Reward[]>([]);
// >>> two groups: ours (fully editable) vs made in twitch's own dashboard (view-only)
const botRewards = computed(() => rewards.value.filter((r) => r.manageable));
const twitchRewards = computed(() => rewards.value.filter((r) => !r.manageable));
const loading = ref(false);
const error = ref("");
const saving = ref(false);
const deleteConfirm = ref(false);

// >>> known codes get a friendly translation - unknown ones show twitch's own
// >>> text (detail) instead of a useless generic message
function errMsg(code: string | undefined, detail?: string): string {
  const key = `cp.error.${code ?? "request_failed"}`;
  const msg = t(key);
  if (msg && msg !== key) return msg;
  return detail || t("cp.error.request_failed");
}

async function load() {
  if (!session.value) return;
  const ch = session.value.channel;
  loading.value = true;
  error.value = "";
  try {
    const res = await fetch(`${API}/channelpoints/${ch}`, {
      headers: { Authorization: `Bearer ${session.value.token}` },
    });
    const data = await res.json();
    // >>> channel switched again while this was in flight - discard
    if (session.value?.channel !== ch) return;
    if (!res.ok) {
      rewards.value = [];
      error.value = errMsg(data.error);
      return;
    }
    rewards.value = data.rewards ?? [];
  } catch {
    if (session.value?.channel === ch) error.value = errMsg("request_failed");
  } finally {
    if (session.value?.channel === ch) loading.value = false;
  }
}

onMounted(load);
watch(() => session.value?.channel, load);

// >>> combined builtin + custom command names, for the run-command picker
const commandNames = ref<string[]>([]);
const channelPrefix = ref("+");

async function loadCommandNames() {
  if (!session.value) return;
  const ch = session.value.channel;
  try {
    const h = { Authorization: `Bearer ${session.value.token}` };
    const [builtinRes, customRes] = await Promise.all([
      fetch(`${API}/commands/${ch}`, { headers: h }),
      fetch(`${API}/custom-commands/${ch}`, { headers: h }),
    ]);
    const names = new Set<string>();
    let prefix = "+";
    if (builtinRes.ok) {
      const d = await builtinRes.json();
      prefix = d.prefix || "+";
      for (const c of d.commands ?? []) if (c?.name) names.add(c.name);
    }
    if (customRes.ok) {
      const d = await customRes.json();
      for (const c of d.commands ?? []) if (c?.name) names.add(c.name);
    }
    // >>> channel switched again while this was in flight - discard
    if (session.value?.channel !== ch) return;
    channelPrefix.value = prefix;
    commandNames.value = [...names].sort();
  } catch {
    if (session.value?.channel === ch) commandNames.value = [];
  }
}
onMounted(loadCommandNames);
watch(() => session.value?.channel, loadCommandNames);

// >>> reward id -> its "while_active" category gate trigger (if any) - shown
// >>> as a row tag, and lets the reward panel edit that same trigger directly
interface CategoryGate {
  name: string;
  category: string;
  state: "activate" | "deactivate";
}
const categoryGates = ref<Record<string, CategoryGate>>({});
async function loadCategoryGates() {
  if (!session.value) return;
  const ch = session.value.channel;
  try {
    const res = await fetch(`${API}/triggers/${ch}`, {
      headers: { Authorization: `Bearer ${session.value.token}` },
    });
    if (!res.ok) return;
    const data = (await res.json()) as { triggers: any[] };
    if (session.value?.channel !== ch) return;
    const map: Record<string, CategoryGate> = {};
    for (const tr of data.triggers ?? []) {
      if (
        tr.event_type === "category" &&
        tr.action_type === "channel_point_reward" &&
        tr.event_category_mode === "while_active" &&
        tr.action_reward_id &&
        tr.required_game
      ) {
        map[tr.action_reward_id] = {
          name: tr.name,
          category: tr.required_game,
          state: tr.action_reward_state === "deactivate" ? "deactivate" : "activate",
        };
      }
    }
    categoryGates.value = map;
  } catch {
    if (session.value?.channel === ch) categoryGates.value = {};
  }
}
onMounted(loadCategoryGates);
watch(() => session.value?.channel, loadCategoryGates);

// vvv edit panel vvv

const editOpen = ref(false);
const isNew = ref(false);
const editingId = ref<string | null>(null);
const limitsEnabled = ref(false);
// >>> "actions" tab only applies to bot-created rewards being edited, never to a new one
const editTab = ref<"settings" | "actions">("settings");

// vvv category gate - toggles this reward on/off based on the live category vvv
const gateEnabled = ref(false);
const gateCategory = ref("");
const gateDirection = ref<"activate" | "deactivate">("activate");
// >>> the linked trigger's name, once saved once - drives update-vs-create on save
const gateTriggerName = ref<string | null>(null);

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

// >>> creates/updates/deletes the one trigger backing this reward's gate
async function syncCategoryGate(rewardId: string, rewardTitle: string) {
  if (!session.value) return;
  const ch = session.value.channel;
  const auth = { Authorization: `Bearer ${session.value.token}` };
  try {
    if (!gateEnabled.value || !gateCategory.value.trim()) {
      if (gateTriggerName.value) {
        await fetch(`${API}/triggers/${ch}/${gateTriggerName.value}`, {
          method: "DELETE",
          headers: auth,
        });
        gateTriggerName.value = null;
      }
      return;
    }
    const name =
      gateTriggerName.value ||
      `cp-gate-${slugify(rewardTitle) || "reward"}-${Math.random().toString(36).slice(2, 7)}`;
    await fetch(`${API}/triggers/${ch}/${name}`, {
      method: "PUT",
      headers: { ...auth, "Content-Type": "application/json" },
      body: JSON.stringify({
        event_type: "category",
        action_type: "channel_point_reward",
        action_reward_id: rewardId,
        action_reward_state: gateDirection.value,
        event_category_mode: "while_active",
        required_game: gateCategory.value.trim(),
        match_pattern: "",
        match_type: "contains",
        enabled_when: "always",
        condition: "",
        cooldown_sec: 0,
        is_active: 1,
      }),
    });
    gateTriggerName.value = name;
  } catch {}
}
// ^^^ category gate ^^^

// >>> per-field messages, shown inline instead of a generic toast
const nameErrorMsg = ref("");
const promptErrorMsg = ref("");
const costErrorMsg = ref("");
const colorErrorMsg = ref("");
const limitsErrorMsg = ref("");
// >>> catch-all for errors that aren't tied to one field (missing_scope etc)
const panelError = ref("");

function clearFieldErrors() {
  nameErrorMsg.value = "";
  promptErrorMsg.value = "";
  costErrorMsg.value = "";
  colorErrorMsg.value = "";
  limitsErrorMsg.value = "";
  panelError.value = "";
}

const HEX_COLOR_RE = /^#[0-9a-fA-F]{6}$/;

// >>> catches obvious mistakes before hitting twitch at all
function validateForm(): boolean {
  let ok = true;
  if (!HEX_COLOR_RE.test(form.backgroundColor)) {
    colorErrorMsg.value = t("cp.error.invalid_color");
    ok = false;
  }
  if (
    !Number.isSafeInteger(form.cost) ||
    form.cost < 1 ||
    form.cost > 1_000_000_000
  ) {
    costErrorMsg.value = t("cp.error.invalid_cost");
    ok = false;
  }
  if (form.prompt.length > 200) {
    promptErrorMsg.value = t("cp.error.invalid_prompt");
    ok = false;
  }
  if (limitsEnabled.value) {
    const { globalCooldown, maxRedemptionsPerStream, maxRedemptionsPerUserPerStream } = form;
    const badValue = (n: number, max: number) =>
      !Number.isSafeInteger(n) || n < 0 || n > max;
    if (
      badValue(globalCooldown, 604_800) ||
      badValue(maxRedemptionsPerStream, 1_000_000) ||
      badValue(maxRedemptionsPerUserPerStream, 1_000_000)
    ) {
      limitsErrorMsg.value = t("cp.error.invalid_limits");
      ok = false;
    }
  }
  return ok;
}

// >>> maps a backend error code to whichever field it's actually about
function applyBackendError(code: string | undefined, detail?: string) {
  const msg = errMsg(code, detail);
  switch (code) {
    case "duplicate_title":
      nameErrorMsg.value = msg;
      break;
    case "invalid_cost":
      costErrorMsg.value = msg;
      break;
    case "invalid_color":
      colorErrorMsg.value = msg;
      break;
    case "invalid_prompt":
      promptErrorMsg.value = msg;
      break;
    case "invalid_cooldown":
    case "invalid_limits":
      limitsErrorMsg.value = msg;
      break;
    default:
      panelError.value = msg;
  }
}

const DEFAULT_COLOR = "#9146FF";
const form = reactive({
  title: "",
  prompt: "",
  userInputRequired: false,
  cost: 100,
  backgroundColor: DEFAULT_COLOR,
  autoFulfill: false,
  globalCooldown: 0,
  maxRedemptionsPerStream: 0,
  maxRedemptionsPerUserPerStream: 0,
});

function openNew() {
  isNew.value = true;
  editingId.value = null;
  limitsEnabled.value = false;
  clearFieldErrors();
  Object.assign(form, {
    title: "",
    prompt: "",
    userInputRequired: false,
    cost: 100,
    backgroundColor: DEFAULT_COLOR,
    autoFulfill: false,
    globalCooldown: 0,
    maxRedemptionsPerStream: 0,
    maxRedemptionsPerUserPerStream: 0,
  });
  editOpen.value = true;
}

function openEdit(r: Reward) {
  if (!r.manageable || !canManage.value) return;
  isNew.value = false;
  editingId.value = r.id;
  deleteConfirm.value = false;
  editTab.value = "settings";
  clearFieldErrors();
  limitsEnabled.value = !!(
    r.globalCooldown ||
    r.maxRedemptionsPerStream ||
    r.maxRedemptionsPerUserPerStream
  );
  const gate = categoryGates.value[r.id];
  gateEnabled.value = !!gate;
  gateCategory.value = gate?.category ?? "";
  gateDirection.value = gate?.state ?? "activate";
  gateTriggerName.value = gate?.name ?? null;
  Object.assign(form, {
    title: r.title,
    prompt: r.prompt,
    userInputRequired: r.userInputRequired,
    cost: r.cost,
    backgroundColor: r.backgroundColor,
    autoFulfill: r.autoFulfill,
    globalCooldown: r.globalCooldown ?? 0,
    maxRedemptionsPerStream: r.maxRedemptionsPerStream ?? 0,
    maxRedemptionsPerUserPerStream: r.maxRedemptionsPerUserPerStream ?? 0,
  });
  editOpen.value = true;
  loadActionsFor(r); // <<< preloads the actions tab so switching to it is instant
}

function closePanel() {
  editOpen.value = false;
}

// >>> clear each field's red border once the user changes that field
watch(() => form.title, () => (nameErrorMsg.value = ""));
watch(() => form.prompt, () => (promptErrorMsg.value = ""));
watch(() => form.cost, () => (costErrorMsg.value = ""));
watch(() => form.backgroundColor, () => (colorErrorMsg.value = ""));
watch(
  [
    () => form.globalCooldown,
    () => form.maxRedemptionsPerStream,
    () => form.maxRedemptionsPerUserPerStream,
    limitsEnabled,
  ],
  () => (limitsErrorMsg.value = ""),
);

const saveDisabled = computed(() => !form.title.trim() || form.cost < 1);

async function savePanel() {
  if (!session.value || saveDisabled.value) return;
  clearFieldErrors();
  if (!validateForm()) return;
  saving.value = true;
  const body = {
    title: form.title.trim(),
    prompt: form.prompt.trim(),
    userInputRequired: form.userInputRequired,
    cost: form.cost,
    backgroundColor: form.backgroundColor,
    autoFulfill: form.autoFulfill,
    globalCooldown: limitsEnabled.value ? form.globalCooldown : null,
    maxRedemptionsPerStream: limitsEnabled.value
      ? form.maxRedemptionsPerStream
      : null,
    maxRedemptionsPerUserPerStream: limitsEnabled.value
      ? form.maxRedemptionsPerUserPerStream
      : null,
  };
  const h = {
    "Content-Type": "application/json",
    Authorization: `Bearer ${session.value.token}`,
  };
  try {
    const url = isNew.value
      ? `${API}/channelpoints/${session.value.channel}`
      : `${API}/channelpoints/${session.value.channel}/${editingId.value}`;
    const res = await fetch(url, {
      method: isNew.value ? "POST" : "PUT",
      headers: h,
      body: JSON.stringify(body),
    });
    const data = await res.json();
    if (!res.ok) {
      applyBackendError(data.error, data.detail);
      return;
    }
    if (!isNew.value && editingId.value) {
      await syncCategoryGate(editingId.value, form.title.trim());
      await loadCategoryGates();
    }
    editOpen.value = false;
    await load();
  } catch {
    panelError.value = errMsg("request_failed");
  } finally {
    saving.value = false;
  }
}

// >>> shared by the panel's delete button and each row's inline trash icon
async function deleteRewardById(id: string): Promise<string | null> {
  if (!session.value) return "request_failed";
  try {
    const res = await fetch(
      `${API}/channelpoints/${session.value.channel}/${id}`,
      {
        method: "DELETE",
        headers: { Authorization: `Bearer ${session.value.token}` },
      },
    );
    const data = await res.json();
    return res.ok ? null : (data.error ?? "request_failed");
  } catch {
    return "request_failed";
  }
}

function requestDelete() {
  if (!deleteConfirm.value) {
    deleteConfirm.value = true;
    return;
  }
  deleteReward();
}

async function deleteReward() {
  if (!editingId.value) return;
  saving.value = true;
  const err = await deleteRewardById(editingId.value);
  saving.value = false;
  deleteConfirm.value = false;
  if (err) {
    panelError.value = errMsg(err);
    return;
  }
  editOpen.value = false;
  await load();
}

// >>> inline trash icon in the row itself, same confirm-click pattern
const rowDeleteConfirmId = ref<string | null>(null);

function requestRowDelete(r: Reward) {
  if (rowDeleteConfirmId.value !== r.id) {
    rowDeleteConfirmId.value = r.id;
    return;
  }
  deleteRowReward(r.id);
}

async function deleteRowReward(id: string) {
  rowDeleteConfirmId.value = null;
  const err = await deleteRewardById(id);
  if (err) {
    error.value = errMsg(err);
    return;
  }
  await load();
}

async function toggleEnabled(r: Reward) {
  if (!r.manageable || !canManage.value || !session.value) return;
  const next = !r.isEnabled;
  r.isEnabled = next; // <<< optimistic, reverted on failure below
  try {
    const res = await fetch(
      `${API}/channelpoints/${session.value.channel}/${r.id}`,
      {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${session.value.token}`,
        },
        body: JSON.stringify({ isEnabled: next }),
      },
    );
    if (!res.ok) throw new Error();
  } catch {
    r.isEnabled = !next;
    error.value = errMsg("request_failed");
  }
}

function reload() {
  load();
}

// vvv shyboti actions - standalone panel for twitch-created, tab for bot-created vvv

// >>> "actions" panel is only the standalone flow now (twitch-created rewards);
// >>> bot-created rewards get the same state via the settings panel's actions tab
const actionsOpen = ref(false);
const actionsReward = ref<Reward | null>(null);
const actionsList = ref<RewardAction[]>([]);
const refundOnFailure = ref(false);
const alwaysRefund = ref(false);
const actionsLoading = ref(false);
const actionsSaving = ref(false);
const actionsError = ref("");

// >>> actions live as channel_triggers rows (event_type "channel_point_reward"),
// >>> not in channel_point_rules anymore - these convert between the two shapes
function triggerToRewardAction(tr: any): RewardAction {
  const base = { ...blankAction(), _triggerName: tr.name as string };
  switch (tr.action_type) {
    case "run_command":
      return { ...base, type: "run_command", command: tr.response ?? "", args: tr.action_extra ?? "" };
    case "create_command":
      return { ...base, type: "create_command", response: tr.response ?? "", name: tr.action_extra ?? "" };
    case "timeout":
      return { ...base, type: "timeout_self", seconds: parseInt(tr.response) || 600 };
    case "timeout_input_user":
      return { ...base, type: "timeout_input_user", seconds: parseInt(tr.response) || 600 };
    case "shoutout":
      return { ...base, type: "shoutout", response: tr.response ?? "" };
    case "set_title":
      return { ...base, type: "set_title", response: tr.response ?? "" };
    case "set_category":
      return { ...base, type: "set_category", response: tr.response ?? "" };
    case "channel_point_reward":
      return {
        ...base,
        type: "channel_point_reward",
        rewardId: tr.action_reward_id ?? "",
        rewardState: tr.action_reward_state === "deactivate" ? "deactivate" : "activate",
      };
    case "ban":
      return { ...base, type: "ban" };
    default:
      return { ...base, type: "say", response: tr.response ?? "" };
  }
}

function rewardActionToTriggerFields(a: RewardAction) {
  const blank = { action_extra: "", action_reward_id: "", action_reward_state: "activate" as const };
  switch (a.type) {
    case "run_command":
      return { action_type: "run_command", response: a.command, ...blank, action_extra: a.args };
    case "create_command":
      return { action_type: "create_command", response: a.response, ...blank, action_extra: a.name };
    case "timeout_self":
      return { action_type: "timeout", response: String(a.seconds), ...blank };
    case "timeout_input_user":
      return { action_type: "timeout_input_user", response: String(a.seconds), ...blank };
    case "say":
      return { action_type: "say", response: a.response, ...blank };
    case "ban":
      return { action_type: "ban", response: "", ...blank };
    case "shoutout":
      return { action_type: "shoutout", response: a.response, ...blank };
    case "set_title":
      return { action_type: "set_title", response: a.response, ...blank };
    case "set_category":
      return { action_type: "set_category", response: a.response, ...blank };
    case "channel_point_reward":
      return {
        action_type: "channel_point_reward",
        response: "",
        action_extra: "",
        action_reward_id: a.rewardId,
        action_reward_state: a.rewardState,
      };
  }
}

// >>> trigger names this reward's actions were saved under - diffed on the
// >>> next save to know which ones got removed from the list
const linkedTriggerNames = ref<string[]>([]);

// >>> shared by openEdit (bot-created, tab) and openActions (twitch-created, standalone)
async function loadActionsFor(r: Reward) {
  if (!session.value) return;
  actionsReward.value = r;
  actionsError.value = "";
  actionsList.value = [];
  refundOnFailure.value = false;
  alwaysRefund.value = false;
  linkedTriggerNames.value = [];
  actionsLoading.value = true;
  try {
    const h = { Authorization: `Bearer ${session.value.token}` };
    const [rulesRes, triggersRes] = await Promise.all([
      fetch(`${API}/channelpoints/${session.value.channel}/${r.id}/rules`, { headers: h }),
      fetch(`${API}/triggers/${session.value.channel}`, { headers: h }),
    ]);
    const data = await rulesRes.json();
    if (!rulesRes.ok) {
      actionsError.value = errMsg(data.error);
      return;
    }
    refundOnFailure.value = !!data.refundOnFailure;
    alwaysRefund.value = !!data.alwaysRefund;

    if (triggersRes.ok) {
      const td = (await triggersRes.json()) as { triggers: any[] };
      const linked = (td.triggers ?? []).filter(
        (tr) => tr.event_type === "channel_point_reward" && tr.event_reward_id === r.id,
      );
      actionsList.value = linked.map(triggerToRewardAction);
      linkedTriggerNames.value = linked.map((tr) => tr.name);
    }
  } catch {
    actionsError.value = errMsg("request_failed");
  } finally {
    actionsLoading.value = false;
  }
}

function openActions(r: Reward) {
  if (!canManage.value) return;
  actionsOpen.value = true;
  loadActionsFor(r);
}

function closeActions() {
  actionsOpen.value = false;
}

// >>> can't enable it via API for rewards twitch's own dashboard made
const needsInputWarning = computed(() => {
  const r = actionsReward.value;
  if (!r || r.userInputRequired || r.manageable) return false;
  return actionsList.value.some(actionNeedsInput);
});

// >>> auto-enables "require text input" on the reward itself once an action needs it
async function ensureUserInputEnabled() {
  const r = actionsReward.value;
  if (!r || !r.manageable || r.userInputRequired || !session.value) return;
  if (!actionsList.value.some(actionNeedsInput)) return;
  try {
    const res = await fetch(
      `${API}/channelpoints/${session.value.channel}/${r.id}`,
      {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${session.value.token}`,
        },
        body: JSON.stringify({ userInputRequired: true }),
      },
    );
    if (res.ok) r.userInputRequired = true; // <<< same object ref as in rewards.value
  } catch {}
}
watch(actionsList, ensureUserInputEnabled, { deep: true });

function slugify(s: string): string {
  return s.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
}

async function saveActions() {
  if (!session.value || !actionsReward.value) return;
  actionsSaving.value = true;
  actionsError.value = "";
  const channel = session.value.channel;
  const token = session.value.token;
  const reward = actionsReward.value;
  try {
    const rulesRes = await fetch(`${API}/channelpoints/${channel}/${reward.id}/rules`, {
      method: "PUT",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({
        refundOnFailure: refundOnFailure.value,
        alwaysRefund: alwaysRefund.value,
        rewardTitle: reward.title,
      }),
    });
    if (!rulesRes.ok) {
      const data = await rulesRes.json().catch(() => ({}));
      actionsError.value = errMsg(data.error);
      return;
    }

    // >>> delete trigger rows for actions removed from the list
    const stillLinked = new Set(actionsList.value.map((a) => a._triggerName).filter(Boolean));
    for (const name of linkedTriggerNames.value) {
      if (stillLinked.has(name)) continue;
      await fetch(`${API}/triggers/${channel}/${name}`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${token}` },
      }).catch(() => {});
    }

    // >>> upsert each action as its own trigger row
    for (const a of actionsList.value) {
      const name = a._triggerName || `cp-${slugify(reward.title) || "reward"}-${Math.random().toString(36).slice(2, 7)}`;
      const fields = rewardActionToTriggerFields(a);
      const res = await fetch(`${API}/triggers/${channel}/${name}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          event_type: "channel_point_reward",
          event_reward_id: reward.id,
          match_pattern: "",
          match_type: "contains",
          enabled_when: "always",
          required_game: "",
          condition: "",
          cooldown_sec: 0,
          is_active: 1,
          ...fields,
        }),
      });
      if (!res.ok) throw new Error(await res.text());
      a._triggerName = name;
    }
    linkedTriggerNames.value = actionsList.value.map((a) => a._triggerName!);

    // >>> closes whichever context triggered the save (standalone panel or edit-panel tab)
    actionsOpen.value = false;
    editOpen.value = false;
  } catch {
    actionsError.value = errMsg("request_failed");
  } finally {
    actionsSaving.value = false;
  }
}

// ^^^ shyboti actions ^^^
</script>

<template>
  <div class="ep-view">
    <div class="ep-view-header">
      <div>
        <div class="ep-view-title">{{ t("twitch.title") }}</div>
        <div class="ep-view-sub">{{ rewards.length }} {{ t("cp.tab") }}</div>
      </div>
      <div class="ep-view-header-right">
        <button class="ep-btn-reload" title="Reload" @click="reload" v-html="iconSvgFor('refresh-cw')"></button>
        <button class="ep-btn-new" :disabled="!canManage" @click="openNew">
          + {{ t("cp.new") }}
        </button>
      </div>
    </div>

    <div v-if="error" class="ep-toast error">{{ error }}</div>

    <div class="ep-tabs">
      <button class="ep-tab" :class="{ active: activeTab === 'channelpoints' }">
        {{ t("cp.tab") }}
      </button>
    </div>

    <div class="cp-explain">
      <span v-html="iconSvgFor('info')"></span>
      <span>{{ t("cp.explain") }}</span>
    </div>

    <div class="cp-scroll">
      <div v-if="loading" class="ep-row-list">
        <div class="ep-skeleton-row" v-for="i in 4" :key="i">
          <div class="ep-skeleton-block ep-skeleton-square"></div>
          <div class="ep-skeleton-lines">
            <div class="ep-skeleton-block ep-skeleton-line title"></div>
            <div class="ep-skeleton-block ep-skeleton-line meta"></div>
          </div>
          <div class="ep-skeleton-actions">
            <div class="ep-skeleton-block ep-skeleton-btn icon"></div>
          </div>
        </div>
      </div>

      <div v-else-if="!rewards.length" class="ep-empty">{{ t("cp.empty") }}</div>

      <template v-else>
        <div v-if="botRewards.length" class="cp-group">
          <div class="cp-group-header">
            <span>{{ t("cp.group.bot") }}</span>
            <span class="cp-group-count">{{ botRewards.length }}</span>
          </div>
          <div class="ep-row-list">
            <div v-for="r in botRewards" :key="r.id" class="ep-list-row cp-row" :class="{ inactive: !r.isEnabled }">
              <div class="cp-swatch" :style="{ background: r.backgroundColor }"></div>
              <div class="cp-main">
                <div class="cp-title-row">
                  <span class="cp-title">{{ r.title }}</span>
                </div>
                <div class="cp-cost">
                  <span class="cp-cost-dot"></span>
                  <span>{{ r.cost }}</span>
                  <span v-if="categoryGates[r.id]" class="ep-meta-pill game">
                    {{ t("cp.gate.only_active_on") }} {{ categoryGates[r.id]?.category }}
                  </span>
                </div>
              </div>
              <div class="ep-row-actions">
                <button class="ep-switch" :class="{ on: r.isEnabled, off: !r.isEnabled, disabled: !canManage }"
                  :title="t('cp.enabled')" @click="toggleEnabled(r)"><span class="ep-switch-knob"></span></button>
                <div class="cp-action-slot">
                  <button v-if="canManage" class="ep-btn-action edit" @click="openEdit(r)">{{ t("cp.edit") }}</button>
                  <button v-if="canManage" class="ep-btn-action del" :class="{ confirm: rowDeleteConfirmId === r.id }"
                    :title="t('cp.panel.delete')" @click="requestRowDelete(r)" v-html="iconSvgFor('trash')"></button>
                </div>
              </div>
            </div>
          </div>
        </div>

        <div v-if="twitchRewards.length" class="cp-group">
          <div class="cp-group-header">
            <span>{{ t("cp.group.twitch") }}</span>
            <span class="cp-group-count">{{ twitchRewards.length }}</span>
          </div>
          <div class="ep-row-list">
            <div v-for="r in twitchRewards" :key="r.id" class="ep-list-row cp-row" :class="{ inactive: !r.isEnabled }">
              <div class="cp-swatch" :style="{ background: r.backgroundColor }"></div>
              <div class="cp-main">
                <div class="cp-title-row">
                  <span class="cp-title">{{ r.title }}</span>
                </div>
                <div class="cp-cost">
                  <span class="cp-cost-dot"></span>
                  <span>{{ r.cost }}</span>
                  <span v-if="categoryGates[r.id]" class="ep-meta-pill game">
                    {{ t("cp.gate.only_active_on") }} {{ categoryGates[r.id]?.category }}
                  </span>
                </div>
              </div>
              <div class="ep-row-actions">
                <button class="ep-switch" :class="{ on: r.isEnabled, off: !r.isEnabled, disabled: true }"
                  :title="t('cp.locked_hint')"><span class="ep-switch-knob"></span></button>
                <div class="cp-action-slot">
                  <button v-if="canManage" class="ep-btn-action actions" @click="openActions(r)">{{ t("cp.actions.btn") }}</button>
                  <button class="ep-btn-action locked" disabled :title="t('cp.locked_hint')"
                    v-html="iconSvgFor('lock')"></button>
                </div>
              </div>
            </div>
          </div>
        </div>
      </template>
    </div>

    <!-- vvv edit panel vvv -->
    <Teleport to="body">
      <div v-if="editOpen" class="ep-overlay" v-bind="overlay.handlers(closePanel)">
        <div class="ep-panel">

          <div class="ep-panel-header">
            <div>
              <div class="ep-panel-title">{{ isNew ? t("cp.panel.new") : t("cp.panel.edit") }}</div>
              <div class="ep-panel-sub">#{{ session?.channel }}</div>
            </div>
            <button class="ep-panel-close" @click="closePanel" v-html="iconSvgFor('x')"></button>
          </div>

          <div v-if="!isNew" class="ep-tabs">
            <button class="ep-tab" :class="{ active: editTab === 'settings' }" @click="editTab = 'settings'">
              {{ t("cp.panel.tab.settings") }}
            </button>
            <button class="ep-tab" :class="{ active: editTab === 'actions' }" @click="editTab = 'actions'">
              {{ t("cp.panel.tab.actions") }}
            </button>
          </div>

          <div class="ep-panel-body">

            <div v-if="panelError && (isNew || editTab === 'settings')" class="cp-panel-error">{{ panelError }}</div>
            <div v-if="actionsError && !isNew && editTab === 'actions'" class="cp-panel-error">{{ actionsError }}</div>

            <ChannelPointActionsEditor v-if="!isNew && editTab === 'actions'" :actions="actionsList"
              :refund-on-failure="refundOnFailure" :always-refund="alwaysRefund" :manageable="true"
              :needs-input-warning="needsInputWarning" :command-names="commandNames" :channel-prefix="channelPrefix"
              :reward-options="botRewards.map((r) => ({ id: r.id, title: r.title }))"
              @update:refund-on-failure="refundOnFailure = $event" @update:always-refund="alwaysRefund = $event" />

            <template v-else>

            <div class="ep-field-group">
              <label class="ep-field-label">{{ t("cp.field.title") }}
                <span class="ep-field-hint">{{ form.title.length }}/45</span>
              </label>
              <input v-model="form.title" maxlength="45" class="ep-field-input"
                :class="{ 'cp-field-invalid': nameErrorMsg }" :placeholder="t('cp.field.title_ph')" />
              <div v-if="nameErrorMsg" class="cp-field-error">{{ nameErrorMsg }}</div>
            </div>

            <div class="ep-field-group">
              <label class="ep-field-label">{{ t("cp.field.prompt") }}
                <span class="ep-field-hint">{{ t("cp.field.prompt_hint") }} · {{ form.prompt.length }}/200</span>
              </label>
              <textarea v-model="form.prompt" maxlength="200" class="ep-field-input cp-textarea"
                :class="{ 'cp-field-invalid': promptErrorMsg }"></textarea>
              <div v-if="promptErrorMsg" class="cp-field-error">{{ promptErrorMsg }}</div>
            </div>

            <div class="ep-field-group cp-toggle-row">
              <div>
                <div class="ep-field-label">{{ t("cp.field.user_input") }}</div>
                <div class="ep-field-hint">{{ t("cp.field.user_input_hint") }}</div>
              </div>
              <button class="ep-switch" :class="{ on: form.userInputRequired }"
                @click="form.userInputRequired = !form.userInputRequired"><span class="ep-switch-knob"></span></button>
            </div>

            <div class="ep-field-group">
              <label class="ep-field-label">{{ t("cp.field.cost") }}</label>
              <input v-model.number="form.cost" type="number" min="1" max="1000000000" class="ep-field-input"
                :class="{ 'cp-field-invalid': costErrorMsg }" />
              <div v-if="costErrorMsg" class="cp-field-error">{{ costErrorMsg }}</div>
            </div>

            <div class="ep-field-group">
              <label class="ep-field-label">{{ t("cp.field.color") }}</label>
              <div class="cp-color-row">
                <input type="color" v-model="form.backgroundColor" class="cp-color-pick" />
                <input v-model="form.backgroundColor" class="ep-field-input"
                  :class="{ 'cp-field-invalid': colorErrorMsg }" placeholder="#9146FF" />
              </div>
              <div v-if="colorErrorMsg" class="cp-field-error">{{ colorErrorMsg }}</div>
              <div v-else class="ep-field-hint">{{ t("cp.field.color_hint") }}</div>
            </div>

            <div class="ep-field-group cp-toggle-row">
              <div>
                <div class="ep-field-label">{{ t("cp.field.skip_queue") }}</div>
                <div class="ep-field-hint">{{ t("cp.field.skip_queue_hint") }}</div>
              </div>
              <button class="ep-switch" :class="{ on: form.autoFulfill }"
                @click="form.autoFulfill = !form.autoFulfill"><span class="ep-switch-knob"></span></button>
            </div>

            <div class="ep-field-group">
              <div class="cp-toggle-row">
                <div>
                  <div class="ep-field-label">{{ t("cp.field.limits") }}</div>
                  <div class="ep-field-hint">{{ t("cp.field.limits_hint") }}</div>
                </div>
                <button class="ep-switch" :class="{ on: limitsEnabled }"
                  @click="limitsEnabled = !limitsEnabled"><span class="ep-switch-knob"></span></button>
              </div>

              <div v-if="limitsEnabled" class="cp-limits-box" :class="{ 'cp-field-invalid': limitsErrorMsg }">
                <div class="ep-field-group">
                  <label class="ep-field-label">{{ t("cp.field.cooldown") }}
                    <span class="ep-field-hint">{{ t("cp.field.cooldown_hint") }}</span>
                  </label>
                  <input v-model.number="form.globalCooldown" type="number" min="0" class="ep-field-input" />
                </div>
                <div class="ep-field-group">
                  <label class="ep-field-label">{{ t("cp.field.max_stream") }}
                    <span class="ep-field-hint">{{ t("cp.field.max_stream_hint") }}</span>
                  </label>
                  <input v-model.number="form.maxRedemptionsPerStream" type="number" min="0" class="ep-field-input" />
                </div>
                <div class="ep-field-group">
                  <label class="ep-field-label">{{ t("cp.field.max_user") }}
                    <span class="ep-field-hint">{{ t("cp.field.max_user_hint") }}</span>
                  </label>
                  <input v-model.number="form.maxRedemptionsPerUserPerStream" type="number" min="0"
                    class="ep-field-input" />
                </div>
                <div v-if="limitsErrorMsg" class="cp-field-error">{{ limitsErrorMsg }}</div>
              </div>
            </div>

            <div v-if="!isNew" class="ep-field-group cp-toggle-row">
              <div>
                <div class="ep-field-label">{{ t("cp.field.category_gate") }}</div>
                <div class="ep-field-hint">{{ t("cp.field.category_gate_hint") }}</div>
              </div>
              <button class="ep-switch" :class="{ on: gateEnabled }"
                @click="gateEnabled = !gateEnabled"><span class="ep-switch-knob"></span></button>
            </div>
            <template v-if="!isNew && gateEnabled">
              <div class="ep-field-group">
                <label class="ep-field-label">{{ t("trigger.field.category") }}</label>
                <TypeaheadInput :model-value="gateCategory" :fetch-items="fetchCategories" :min-chars="1"
                  placeholder="Just Chatting" @update:model-value="(v: string) => (gateCategory = v)"
                  @select="(item: any) => (gateCategory = item.label)" />
              </div>
              <div class="ep-field-group">
                <label class="ep-field-label">{{ t("trigger.field.reward_state") }}</label>
                <select v-model="gateDirection" class="ep-field-select">
                  <option value="activate">{{ t("trigger.reward_state.activate") }}</option>
                  <option value="deactivate">{{ t("trigger.reward_state.deactivate") }}</option>
                </select>
              </div>
            </template>

            </template>

          </div>

          <div class="ep-panel-footer">
            <button v-if="!isNew && editTab === 'settings'" class="ep-btn-delete" :class="{ confirm: deleteConfirm }"
              @click="requestDelete" :disabled="saving">
              {{ saving ? '…' : deleteConfirm ? t('cp.panel.sure') : t('cp.panel.delete') }}
            </button>
            <div v-else></div>
            <div class="ep-footer-right">
              <button class="ep-btn-cancel" @click="closePanel">{{ t("cp.panel.cancel") }}</button>
              <button v-if="!isNew && editTab === 'actions'" class="ep-btn-save" @click="saveActions"
                :disabled="actionsSaving">
                {{ actionsSaving ? '…' : t("cp.panel.save") }}
              </button>
              <button v-else class="ep-btn-save" @click="savePanel" :disabled="saving || saveDisabled">
                {{ saving ? '…' : t("cp.panel.save") }}
              </button>
            </div>
          </div>

        </div>
      </div>
    </Teleport>
    <!-- ^^^ edit panel ^^^ -->

    <!-- vvv shyboti actions panel vvv -->
    <Teleport to="body">
      <div v-if="actionsOpen" class="ep-overlay" v-bind="overlay.handlers(closeActions)">
        <div class="ep-panel">

          <div class="ep-panel-header">
            <div>
              <div class="ep-panel-title">{{ t("cp.actions.panel_title") }}</div>
              <div class="ep-panel-sub">{{ actionsReward?.title }}</div>
            </div>
            <button class="ep-panel-close" @click="closeActions" v-html="iconSvgFor('x')"></button>
          </div>

          <div class="ep-panel-body">

            <div v-if="actionsError" class="cp-panel-error">{{ actionsError }}</div>

            <ChannelPointActionsEditor :actions="actionsList" :refund-on-failure="refundOnFailure"
              :always-refund="alwaysRefund" :manageable="!!actionsReward?.manageable"
              :needs-input-warning="needsInputWarning" :command-names="commandNames" :channel-prefix="channelPrefix"
              :reward-options="botRewards.map((r) => ({ id: r.id, title: r.title }))"
              @update:refund-on-failure="refundOnFailure = $event" @update:always-refund="alwaysRefund = $event" />

          </div>

          <div class="ep-panel-footer">
            <div></div>
            <div class="ep-footer-right">
              <button class="ep-btn-cancel" @click="closeActions">{{ t("cp.panel.cancel") }}</button>
              <button class="ep-btn-save" @click="saveActions" :disabled="actionsSaving">
                {{ actionsSaving ? '…' : t("cp.panel.save") }}
              </button>
            </div>
          </div>

        </div>
      </div>
    </Teleport>
    <!-- ^^^ shyboti actions panel ^^^ -->

  </div>
</template>

<style scoped>
/* >>> layout comes from shared.css, only channel-points-specific bits here */

.cp-explain {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  padding: 10px 12px;
  margin-bottom: 12px;
  background: #1a1a1e;
  border: 1px solid #2a2a30;
  font-size: 13px;
  color: #999;
  border-radius: 0;
}

.cp-explain svg {
  flex-shrink: 0;
  margin-top: 2px;
}

/* >>> flex items default to min-height:auto, which refuses to shrink below
   content - that let this page grow past main-panel and scroll past the
   footer instead of scrolling internally. Both overrides are needed. */
.ep-view {
  min-height: 0;
}

.cp-scroll {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  scrollbar-width: none;
}

.cp-scroll::-webkit-scrollbar {
  display: none;
}

.cp-row {
  display: grid;
  grid-template-columns: 40px 1fr auto;
  align-items: center;
  gap: 12px;
}

.cp-row.inactive {
  opacity: 0.55;
}

.cp-swatch {
  width: 40px;
  height: 40px;
  border-radius: 0;
  flex-shrink: 0;
}

.cp-main {
  display: flex;
  flex-direction: column;
  gap: 4px;
  min-width: 0;
}

.cp-title-row {
  display: flex;
  align-items: center;
  gap: 6px;
}

.cp-title {
  font-size: 14px;
  font-weight: 600;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.cp-cost {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 13px;
  color: #999;
}

.cp-cost-dot {
  width: 12px;
  height: 12px;
  border: 2px solid #a970ff;
  border-radius: 50%;
}

.cp-group {
  margin-bottom: 20px;
}

.cp-group-header {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 4px;
  font-size: 12px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.03em;
  color: #999;
}

.cp-group-count {
  color: #666;
  font-weight: 400;
  text-transform: none;
  letter-spacing: 0;
}

/* >>> fixed width so the enable switch lines up across both groups,
   regardless of "Edit" vs the longer locked label */
.cp-action-slot {
  display: flex;
  justify-content: flex-end;
  align-items: center;
  gap: 6px;
  width: 220px;
  flex-shrink: 0;
  flex-wrap: nowrap;
}

.ep-btn-action.actions {
  border-color: #4ec9b044;
  color: #4ec9b0;
}

.ep-btn-action.actions:hover {
  background: rgba(78, 201, 176, 0.1);
}

.ep-btn-action.locked {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 30px;
  padding: 0;
  border-color: #333;
  color: #777;
}

.cp-field-invalid {
  border-color: #f1494966 !important;
  background: #1c1215 !important;
}

.cp-field-error {
  font-size: 11px;
  color: #f14949;
  margin-top: 4px;
}

.cp-textarea {
  resize: vertical;
  min-height: 60px;
}

.cp-toggle-row {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  gap: 12px;
}

.cp-color-row {
  display: flex;
  gap: 8px;
  align-items: center;
}

.cp-color-pick {
  width: 36px;
  height: 32px;
  padding: 0;
  border: none;
  background: none;
  cursor: pointer;
  border-radius: 0;
}

.cp-limits-box {
  margin-top: 10px;
  padding: 10px;
  background: #1a1a1e;
  border: 1px solid transparent;
  border-radius: 0;
}

.cp-panel-error {
  font-size: 12px;
  color: #f14949;
  background: #1c1215;
  border: 1px solid #f1494944;
  padding: 8px 10px;
  margin-bottom: 14px;
}

/* >>> refund/action-card/command-preview styles now live in
   ChannelPointActionsEditor.vue, which owns that markup */
</style>
