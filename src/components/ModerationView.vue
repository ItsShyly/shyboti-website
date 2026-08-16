<script setup lang="ts">
import { ref, reactive, computed, onMounted, onUnmounted, watch, nextTick } from "vue";
import { API } from "../api";
import { useAuth } from "../auth";
import { useI18n } from "../i18n";
import { useOverlayClose } from "../composables/useOverlayClose";
import { REGEX_REF_GROUPS, looksLikeRegex } from "../composables/regexReference";
import { iconSvg as iconSvgFor } from "../composables/icons";
import RefPanel from "./shared/RefPanel.vue";

const { session, availableChannels, channelRole } = useAuth();
const { t } = useI18n();

const canView = computed(() => channelRole.value?.permissions.moderation_view ?? false);
// >>> default true so real users don't see a false "needs bot" flash before channelRole loads
const botPresent = computed(() => channelRole.value?.botPresent ?? true);
const canManage = computed(
  () => (channelRole.value?.permissions.moderation_manage ?? false) && botPresent.value,
);

interface BlockedTerm { id: number; term: string; action: string; duration: number; is_regex: number; is_active: number; group_id: number | null; reason: string; twitch_term_id: string | null }
interface SpamFilter { id: number; type: string; threshold: number; min_letters: number; options: string; action: string; duration: number; is_active: number; group_id: number | null; reason: string }
interface SpamOptions { emote_target?: "emoji" | "7tv" | "twitch" | "all"; ignore_7tv?: boolean }
interface NukeConfig { id: number; trigger: string; duration: number; label: string; lookback: number; stay_active: number; match_exact: number; is_regex: number; expires_at: number | null; group_id: number | null; action: string; reason: string }

type Tab = "blocked" | "spam" | "nukes";
const activeTab = ref<Tab>("blocked");

const blockedTerms = ref<BlockedTerm[]>([]);
const spamFilters = ref<SpamFilter[]>([]);
const nukes = ref<NukeConfig[]>([]);

const loading = ref(false);
const saving = ref(false);
const error = ref("");
const success = ref("");

function showSuccess(msg: string) { success.value = msg; setTimeout(() => (success.value = ""), 3000) }

// >>> Spam helpers
const SPAM_TYPES = computed(() => [
  { value: "caps", label: t("mod.spam.caps"), hint: t("mod.spam.caps_hint") },
  { value: "links", label: t("mod.spam.links"), hint: t("mod.spam.links_hint") },
  { value: "emoji", label: t("mod.spam.emoji"), hint: t("mod.spam.emoji_hint") },
  { value: "repeat", label: t("mod.spam.repeat"), hint: t("mod.spam.repeat_hint") },
  { value: "flood", label: t("mod.spam.flood"), hint: t("mod.spam.flood_hint") },
]);

function parseOpts(f: SpamFilter): SpamOptions {
  try { return f.options ? JSON.parse(f.options) : {} } catch { return {} }
}

function spamLabel(f: SpamFilter): { name: string; detail: string } {
  const name = SPAM_TYPES.value.find(s => s.value === f.type)?.label ?? f.type;
  const opts = parseOpts(f);
  const m = f.min_letters ?? 0;
  const and = t("mod.spam.and");
  if (f.type === "caps") {
    const minPart = m > 0 ? `min. ${m} ${t("mod.spam.min_letters_hint")} ${and} ` : "";
    const ignorePart = opts.ignore_7tv ? ` · ${t("mod.spam.ignore_7tv")}` : "";
    return { name, detail: `${minPart}≥ ${f.threshold}% Caps${ignorePart}` };
  }
  if (f.type === "emoji") {
    const target = opts.emote_target ?? "emoji";
    const minPart = m > 0 ? `min. ${m} ${t("mod.spam.min_letters_hint")} ${and} ` : "";
    return { name, detail: `${minPart}≥ ${f.threshold} ${t(`mod.spam.target.${target}`)}` };
  }
  if (f.type === "repeat") {
    return { name, detail: m > 0 ? `min. ${m} ${t("mod.spam.min_letters_hint")} ${and} ≥ ${f.threshold}` : `≥ ${f.threshold}` };
  }
  if (f.type === "flood") {
    return { name, detail: `≥ ${f.threshold} ${t("mod.spam.flood_in")} ${m > 0 ? m : 10}s` };
  }
  return { name, detail: `≥ ${f.threshold}` };
}

function fmtDur(s: number) {
  if (s < 60) return `${s}${t("mod.field.secs")}`;
  if (s < 3600) return `${Math.floor(s / 60)}m`;
  return `${Math.floor(s / 3600)}h`;
}

const ACTION_COLORS: Record<string, string> = { delete: "#e5c07b", timeout: "#c792ea", ban: "#f14949", automod: "#9d6cff" };
function actionPillStyle(action: string) {
  const c = ACTION_COLORS[action] ?? "#888";
  return { color: c, borderColor: c + "44", background: c + "11" };
}
function actionLabel(action: string) {
  return action === "delete" ? t("mod.action.delete")
    : action === "timeout" ? t("mod.action.timeout")
      : action === "automod" ? t("mod.action.automod")
        : t("mod.action.ban");
}

// >>> groups are just a shared reason - action/duration always come from the item itself
interface ModGroup { id: number; name: string }
const GROUP_PATH: Record<Tab, string> = { blocked: "blocked-terms", spam: "spam-filters", nukes: "nukes" };
const modGroups: Record<Tab, ModGroup[]> = reactive({ blocked: [], spam: [], nukes: [] });
const openGroups = reactive(new Set<number>());
function toggleGroupOpen(id: number) {
  if (openGroups.has(id)) openGroups.delete(id); else openGroups.add(id);
}

async function fetchGroups(tab: Tab) {
  if (!session.value) return;
  try {
    const res = await fetch(`${API}/moderation/${session.value.channel}/${GROUP_PATH[tab]}/groups`, {
      headers: { Authorization: `Bearer ${session.value.token}` },
    });
    if (res.ok) modGroups[tab] = (await res.json()).items ?? [];
  } catch { }
}

function itemsOf(tab: Tab): { id: number; group_id: number | null; reason: string }[] {
  return tab === "blocked" ? blockedTerms.value : tab === "spam" ? spamFilters.value : nukes.value;
}
function membersOf(tab: Tab, groupId: number) {
  return itemsOf(tab).filter((i) => i.group_id === groupId);
}
function ungroupedOf(tab: Tab) {
  return itemsOf(tab).filter((i) => !i.group_id);
}
// >>> trailing "ungrouped" bucket lets every row template use one v-for regardless of grouping
function sectionsOf(tab: Tab): { group: ModGroup | null; items: any[] }[] {
  return [
    ...modGroups[tab].map((g) => ({ group: g, items: membersOf(tab, g.id) })),
    { group: null, items: ungroupedOf(tab) },
  ];
}
const blockedSections = computed(() => sectionsOf("blocked"));
const spamSections = computed(() => sectionsOf("spam"));
const nukeSections = computed(() => sectionsOf("nukes"));

async function putGroupId(tab: Tab, id: number, groupId: number | null) {
  if (!session.value) return;
  try {
    await fetch(`${API}/moderation/${session.value.channel}/${GROUP_PATH[tab]}/${id}/group`, {
      method: "PUT",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${session.value.token}` },
      body: JSON.stringify({ group_id: groupId }),
    });
  } catch { error.value = t("mod.error.save") }
}

async function removeFromGroup(tab: Tab, id: number) {
  const item = itemsOf(tab).find((i) => i.id === id);
  if (item) item.group_id = null;
  await putGroupId(tab, id, null);
}

// >>> Group create panel - create-only, no editing after the fact
const groupPanelOpen = ref(false);
const groupPanelTab = ref<Tab>("blocked");
const gName = ref("");

function openNewGroup(tab: Tab) {
  groupPanelTab.value = tab;
  gName.value = "";
  groupPanelOpen.value = true;
}

async function saveGroup() {
  if (!session.value || !gName.value) return;
  saving.value = true;
  const ch = session.value.channel;
  const path = GROUP_PATH[groupPanelTab.value];
  const h = { "Content-Type": "application/json", Authorization: `Bearer ${session.value.token}` };
  try {
    const res = await fetch(`${API}/moderation/${ch}/${path}/groups`, {
      method: "POST", headers: h, body: JSON.stringify({ name: gName.value }),
    });
    const data = await res.json();
    modGroups[groupPanelTab.value].push(data.item);
    groupPanelOpen.value = false;
  } catch { error.value = t("mod.error.save") }
  saving.value = false;
}

async function deleteGroup(tab: Tab, id: number) {
  if (!session.value) return;
  try {
    await fetch(`${API}/moderation/${session.value.channel}/${GROUP_PATH[tab]}/groups/${id}`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${session.value.token}` },
    });
    modGroups[tab] = modGroups[tab].filter((g) => g.id !== id);
    for (const item of itemsOf(tab)) if (item.group_id === id) item.group_id = null;
  } catch { error.value = t("mod.error.remove") }
}

// >>> Drag a row onto a group header (or the ungrouped zone) to move it
const draggingId = ref<number | null>(null);
function onDragStart(id: number) {
  draggingId.value = id;
}
async function assignGroup(tab: Tab, groupId: number | null) {
  if (!session.value || draggingId.value == null) return;
  const id = draggingId.value;
  draggingId.value = null;
  const item = itemsOf(tab).find((i) => i.id === id);
  if (!item || item.group_id === groupId) return;
  item.group_id = groupId;
  // >>> joining a group overwrites the item's own reason with the group's
  if (groupId != null) item.reason = "";
  await putGroupId(tab, id, groupId);
}

// >>> Share - copy a blocked term/spam filter/nuke/group to another channel
const shareOpen = ref(false);
const shareKind = ref<Tab | "group">("blocked");
const shareGroupTab = ref<Tab>("blocked");
const shareId = ref<number | null>(null);
const shareLabel = ref("");
const shareTarget = ref("");
const shareSaving = ref(false);
const shareSuccess = ref("");
const shareError = ref("");

function openShare(kind: Tab, id: number, label: string) {
  shareKind.value = kind;
  shareId.value = id;
  shareLabel.value = label;
  shareTarget.value = ""; shareSuccess.value = ""; shareError.value = "";
  shareOpen.value = true;
}
function openShareGroup(tab: Tab, id: number, label: string) {
  shareKind.value = "group";
  shareGroupTab.value = tab;
  shareId.value = id;
  shareLabel.value = label;
  shareTarget.value = ""; shareSuccess.value = ""; shareError.value = "";
  shareOpen.value = true;
}
async function doShare() {
  if (!session.value || !shareTarget.value || shareId.value == null) return;
  shareSaving.value = true;
  shareError.value = "";
  try {
    const path = shareKind.value === "group"
      ? `${GROUP_PATH[shareGroupTab.value]}/groups/${shareId.value}/share`
      : `${GROUP_PATH[shareKind.value]}/${shareId.value}/share`;
    const res = await fetch(`${API}/moderation/${session.value.channel}/${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${session.value.token}` },
      body: JSON.stringify({ target_channel: shareTarget.value }),
    });
    if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? "Share failed");
    shareSuccess.value = `Copied to #${shareTarget.value}!`;
    setTimeout(() => { shareOpen.value = false }, 1200);
  } catch (e: any) {
    shareError.value = e.message ?? "Share failed";
  }
  shareSaving.value = false;
}


// >>> Edit panel state
const overlay = useOverlayClose();
const editOpen = ref(false);
const editTab = ref<Tab>("blocked");
const isNew = ref(true);

// >>> item's own Reason field is meaningless once it's in a group
const fGroupId = ref<number | null>(null);
const fGroupName = computed(() =>
  fGroupId.value == null
    ? null
    : (modGroups[editTab.value].find((g) => g.id === fGroupId.value)?.name ?? null),
);

// >>>  blocked term form
const fTerm = ref("");
const fTermAction = ref<"delete" | "timeout" | "ban" | "automod">("delete");
const fTermDur = ref(300);
// >>> no manual toggle anymore - "/pattern/flags" syntax in the term itself is the signal
const fTermIsRegex = computed(() => looksLikeRegex(fTerm.value));
const fTermReason = ref("");
const fTermId = ref<number | null>(null);
const fTermInputEl = ref<HTMLInputElement | null>(null);

// >>>  spam filter form
const fSpamType = ref("caps");
const fSpamThreshold = ref(70);
const fSpamMinLetters = ref(0);
const fSpamEmoteTarget = ref<"emoji" | "7tv" | "twitch" | "all">("emoji");
const fSpamIgnore7tv = ref(false);
const fSpamAction = ref<"delete" | "timeout" | "ban">("delete");
const fSpamDur = ref(300);
const fSpamReason = ref("");
const fSpamId = ref<number | null>(null);

// >>>  nuke form
const fNukeTrigger = ref("");
const fNukeLabel = ref("");
const fNukeDur = ref(600);
const fNukeLookback = ref(30);
const fNukeStay = ref(false);
const fNukeMatchExact = ref(false);
// >>> no manual toggle anymore - "/pattern/flags" syntax in the trigger itself is the signal
const fNukeIsRegex = computed(() => looksLikeRegex(fNukeTrigger.value));
const fNukeExpiry = ref(false);
const fNukeExpiryMins = ref(60);
const fNukeAction = ref<"delete" | "timeout" | "ban">("timeout");
const fNukeReason = ref("");
const fNukeId = ref<number | null>(null);
const fNukeTriggerInputEl = ref<HTMLInputElement | null>(null);

// >>> Regex Reference click-to-insert - works on a plain <input>, not contenteditable
function insertRegexToken(
  el: HTMLInputElement | null,
  valueRef: { value: string },
  token: string,
) {
  if (!el) {
    valueRef.value += token;
    return;
  }
  const start = el.selectionStart ?? valueRef.value.length;
  const end = el.selectionEnd ?? valueRef.value.length;
  valueRef.value = valueRef.value.slice(0, start) + token + valueRef.value.slice(end);
  nextTick(() => {
    el.focus();
    const pos = start + token.length;
    el.setSelectionRange(pos, pos);
  });
}
function insertIntoTerm(token: string) {
  insertRegexToken(fTermInputEl.value, fTerm, token);
}
function insertIntoNukeTrigger(token: string) {
  insertRegexToken(fNukeTriggerInputEl.value, fNukeTrigger, token);
}

// >>> legacy rows (old toggle UI) stored a bare pattern with is_regex=1
function normalizeTermForEdit(raw: string, isRegexFlag: number): string {
  if (!isRegexFlag || looksLikeRegex(raw)) return raw;
  return `/${raw}/i`;
}

function openNewBlocked() {
  editTab.value = "blocked"; isNew.value = true; fTermId.value = null;
  fTerm.value = ""; fTermAction.value = "delete"; fTermDur.value = 300;
  fTermReason.value = ""; fGroupId.value = null;
  editOpen.value = true;
}
function openEditBlocked(term: BlockedTerm) {
  editTab.value = "blocked"; isNew.value = false; fTermId.value = term.id;
  fTerm.value = normalizeTermForEdit(term.term, term.is_regex); fTermAction.value = term.action as any;
  fTermDur.value = term.duration;
  fTermReason.value = term.reason ?? ""; fGroupId.value = term.group_id;
  editOpen.value = true;
}

function openNewSpam() {
  editTab.value = "spam"; isNew.value = true; fSpamId.value = null;
  fSpamType.value = "caps"; fSpamThreshold.value = 70; fSpamMinLetters.value = 0;
  fSpamEmoteTarget.value = "emoji"; fSpamIgnore7tv.value = false;
  fSpamAction.value = "delete"; fSpamDur.value = 300; fSpamReason.value = "";
  fGroupId.value = null;
  editOpen.value = true;
}
function openEditSpam(f: SpamFilter) {
  editTab.value = "spam"; isNew.value = false; fSpamId.value = f.id;
  fSpamType.value = f.type; fSpamThreshold.value = f.threshold;
  fSpamMinLetters.value = f.min_letters ?? 0; fSpamAction.value = f.action as any;
  fSpamDur.value = f.duration; fSpamReason.value = f.reason ?? "";
  fGroupId.value = f.group_id;
  const opts = parseOpts(f);
  fSpamEmoteTarget.value = opts.emote_target ?? "emoji";
  fSpamIgnore7tv.value = opts.ignore_7tv ?? false;
  editOpen.value = true;
}

function openNewNuke() {
  editTab.value = "nukes"; isNew.value = true; fNukeId.value = null;
  fNukeTrigger.value = ""; fNukeLabel.value = ""; fNukeDur.value = 600;
  fNukeLookback.value = 30; fNukeStay.value = false; fNukeMatchExact.value = false;
  fNukeExpiry.value = false; fNukeExpiryMins.value = 60;
  fNukeAction.value = "timeout"; fNukeReason.value = ""; fGroupId.value = null;
  editOpen.value = true;
}
function openEditNuke(n: NukeConfig) {
  editTab.value = "nukes"; isNew.value = false; fNukeId.value = n.id;
  fNukeTrigger.value = normalizeTermForEdit(n.trigger, n.is_regex); fNukeLabel.value = n.label; fNukeDur.value = n.duration;
  fNukeLookback.value = n.lookback ?? 30; fNukeStay.value = !!n.stay_active;
  fNukeMatchExact.value = !!n.match_exact;
  fNukeExpiry.value = !!n.expires_at; fNukeExpiryMins.value = 60;
  fNukeAction.value = (n.action as any) ?? "timeout"; fNukeReason.value = n.reason ?? "";
  fGroupId.value = n.group_id;
  editOpen.value = true;
}


// >>>  API calls
async function load() {
  if (!session.value) return;
  loading.value = true; error.value = "";
  try {
    const h = { Authorization: `Bearer ${session.value.token}` };
    const ch = session.value.channel;
    const [bRes, sRes, nRes] = await Promise.all([
      fetch(`${API}/moderation/${ch}/blocked-terms`, { headers: h }),
      fetch(`${API}/moderation/${ch}/spam-filters`, { headers: h }),
      fetch(`${API}/moderation/${ch}/nukes`, { headers: h }),
    ]);
    if (bRes.ok) blockedTerms.value = (await bRes.json()).items ?? [];
    if (sRes.ok) spamFilters.value = (await sRes.json()).items ?? [];
    if (nRes.ok) nukes.value = (await nRes.json()).items ?? [];
  } catch { error.value = t("mod.error.load") }
  loading.value = false;
}

async function savePanel() {
  if (!session.value) return;
  saving.value = true;
  try {
    const h = { Authorization: `Bearer ${session.value.token}`, "Content-Type": "application/json" };
    const ch = session.value.channel;

    // >>> once an item is in a group, its own reason is meaningless (group.name wins) - clear it on save
    const reasonUnlessGrouped = (r: string) => (fGroupId.value != null ? "" : r.trim());

    if (editTab.value === "blocked") {
      if (isNew.value) {
        const res = await fetch(`${API}/moderation/${ch}/blocked-terms`, {
          method: "POST", headers: h,
          body: JSON.stringify({ term: fTerm.value.trim(), action: fTermAction.value, duration: fTermDur.value, is_regex: fTermIsRegex.value ? 1 : 0, reason: reasonUnlessGrouped(fTermReason.value) }),
        });
        if (!res.ok) throw new Error();
        const data = await res.json();
        blockedTerms.value.push(data.item);
      } else {
        // >>> backend has no PATCH for blocked terms, so delete+recreate is the pattern
        await fetch(`${API}/moderation/${ch}/blocked-terms/${fTermId.value}`, { method: "DELETE", headers: h });
        const res = await fetch(`${API}/moderation/${ch}/blocked-terms`, {
          method: "POST", headers: h,
          body: JSON.stringify({ term: fTerm.value.trim(), action: fTermAction.value, duration: fTermDur.value, is_regex: fTermIsRegex.value ? 1 : 0, reason: reasonUnlessGrouped(fTermReason.value) }),
        });
        if (!res.ok) throw new Error();
        const data = await res.json();
        if (fGroupId.value != null) await putGroupId("blocked", data.item.id, fGroupId.value);
        data.item.group_id = fGroupId.value;
        blockedTerms.value = blockedTerms.value.filter(t => t.id !== fTermId.value);
        blockedTerms.value.push(data.item);
      }
      showSuccess(t("mod.success.added"));
    }

    if (editTab.value === "spam") {
      const body = {
        type: fSpamType.value,
        threshold: fSpamThreshold.value,
        min_letters: fSpamMinLetters.value,
        options: JSON.stringify({
          ...(fSpamType.value === "emoji" ? { emote_target: fSpamEmoteTarget.value } : {}),
          ...(fSpamType.value === "caps" ? { ignore_7tv: fSpamIgnore7tv.value } : {}),
        }),
        action: fSpamAction.value,
        duration: fSpamDur.value,
        reason: reasonUnlessGrouped(fSpamReason.value),
      };
      if (isNew.value) {
        const res = await fetch(`${API}/moderation/${ch}/spam-filters`, { method: "POST", headers: h, body: JSON.stringify(body) });
        if (!res.ok) throw new Error();
        const data = await res.json();
        spamFilters.value.push(data.item);
      } else {
        // >>> backend has no PATCH for spam filters, so delete+recreate is the pattern -
        // >>> that loses group_id, so restore it with a follow-up call when grouped
        await fetch(`${API}/moderation/${ch}/spam-filters/${fSpamId.value}`, { method: "DELETE", headers: h });
        const res = await fetch(`${API}/moderation/${ch}/spam-filters`, { method: "POST", headers: h, body: JSON.stringify(body) });
        if (!res.ok) throw new Error();
        const data = await res.json();
        if (fGroupId.value != null) await putGroupId("spam", data.item.id, fGroupId.value);
        data.item.group_id = fGroupId.value;
        spamFilters.value = spamFilters.value.filter(f => f.id !== fSpamId.value);
        spamFilters.value.push(data.item);
      }
      showSuccess(t("mod.success.spam_added"));
    }

    if (editTab.value === "nukes") {
      const body = {
        trigger: fNukeTrigger.value.trim(),
        duration: fNukeDur.value,
        label: fNukeLabel.value || fNukeTrigger.value.trim(),
        lookback: fNukeLookback.value,
        stay_active: fNukeStay.value ? 1 : 0,
        match_exact: fNukeMatchExact.value ? 1 : 0,
        is_regex: fNukeIsRegex.value ? 1 : 0,
        expires_at: fNukeStay.value && fNukeExpiry.value ? Date.now() + fNukeExpiryMins.value * 60_000 : null,
        action: fNukeAction.value,
        reason: reasonUnlessGrouped(fNukeReason.value),
      };
      if (isNew.value) {
        const res = await fetch(`${API}/moderation/${ch}/nukes`, { method: "POST", headers: h, body: JSON.stringify(body) });
        if (!res.ok) throw new Error();
        const data = await res.json();
        nukes.value.push(data.item);
      } else {
        await fetch(`${API}/moderation/${ch}/nukes/${fNukeId.value}`, { method: "PUT", headers: h, body: JSON.stringify(body) });
        await load();
      }
      showSuccess(t("mod.success.nuke_created"));
    }

    editOpen.value = false;
  } catch { error.value = t("mod.error.add_term") }
  saving.value = false;
}

async function deleteFromPanel() {
  if (!session.value) return;
  saving.value = true;
  try {
    const h = { Authorization: `Bearer ${session.value.token}` };
    const ch = session.value.channel;
    if (editTab.value === "blocked" && fTermId.value) {
      await fetch(`${API}/moderation/${ch}/blocked-terms/${fTermId.value}`, { method: "DELETE", headers: h });
      blockedTerms.value = blockedTerms.value.filter(t => t.id !== fTermId.value);
    }
    if (editTab.value === "spam" && fSpamId.value) {
      await fetch(`${API}/moderation/${ch}/spam-filters/${fSpamId.value}`, { method: "DELETE", headers: h });
      spamFilters.value = spamFilters.value.filter(f => f.id !== fSpamId.value);
    }
    if (editTab.value === "nukes" && fNukeId.value) {
      await fetch(`${API}/moderation/${ch}/nukes/${fNukeId.value}`, { method: "DELETE", headers: h });
      nukes.value = nukes.value.filter(n => n.id !== fNukeId.value);
    }
    showSuccess(t("mod.success.removed"));
    editOpen.value = false;
  } catch { error.value = t("mod.error.remove") }
  saving.value = false;
}

// >>> quick delete straight from the row
async function deleteRow(kind: Tab, id: number) {
  if (!session.value) return;
  try {
    const h = { Authorization: `Bearer ${session.value.token}` };
    const ch = session.value.channel;
    if (kind === "blocked") {
      await fetch(`${API}/moderation/${ch}/blocked-terms/${id}`, { method: "DELETE", headers: h });
      blockedTerms.value = blockedTerms.value.filter(t => t.id !== id);
    } else if (kind === "spam") {
      await fetch(`${API}/moderation/${ch}/spam-filters/${id}`, { method: "DELETE", headers: h });
      spamFilters.value = spamFilters.value.filter(f => f.id !== id);
    } else {
      await fetch(`${API}/moderation/${ch}/nukes/${id}`, { method: "DELETE", headers: h });
      nukes.value = nukes.value.filter(n => n.id !== id);
    }
    showSuccess(t("mod.success.removed"));
  } catch { error.value = t("mod.error.remove") }
}

async function toggleActive(kind: "blocked" | "spam", item: BlockedTerm | SpamFilter) {
  if (!session.value || !canManage.value) return;
  const next = item.is_active ? 0 : 1;
  item.is_active = next;
  try {
    const ch = session.value.channel;
    const path = kind === "blocked" ? "blocked-terms" : "spam-filters";
    await fetch(`${API}/moderation/${ch}/${path}/${item.id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${session.value.token}` },
      body: JSON.stringify({ is_active: !!next }),
    });
  } catch {
    item.is_active = next ? 0 : 1;
    error.value = t("mod.error.save");
  }
}

const deleteConfirmPanel = ref(false);
function requestDelete() {
  if (!deleteConfirmPanel.value) {
    deleteConfirmPanel.value = true;
    setTimeout(() => { deleteConfirmPanel.value = false }, 3000);
    return;
  }
  deleteConfirmPanel.value = false;
  deleteFromPanel();
}

// >>> nuke fire
const nukeLookbackOverride = ref<Record<number, number>>({});
const nukeConfirm = ref<number | null>(null);

async function fireNuke(id: number) {
  if (nukeConfirm.value !== id) {
    nukeConfirm.value = id;
    setTimeout(() => { if (nukeConfirm.value === id) nukeConfirm.value = null }, 4000);
    return;
  }
  nukeConfirm.value = null;
  const nuke = nukes.value.find(n => n.id === id);
  if (!nuke || !session.value) return;
  const lookback = nukeLookbackOverride.value[id] ?? nuke.lookback ?? 30;
  try {
    const res = await fetch(`${API}/moderation/${session.value.channel}/nukes/${id}/fire?lookback=${lookback}`, {
      method: "POST", headers: { Authorization: `Bearer ${session.value.token}` },
    });
    const data = (await res.json()) as any;
    showSuccess(`${t("mod.nuke.fired")} ${data.affected ?? 0} ${t("mod.nuke.users_timed_out")}`);
  } catch { error.value = t("mod.error.fire_nuke") }
}

async function setNukeExpiry(nuke: NukeConfig, mins: number | null) {
  if (!session.value) return;
  const expires_at = mins ? Date.now() + mins * 60_000 : null;
  try {
    await fetch(`${API}/moderation/${session.value.channel}/nukes/${nuke.id}`, {
      method: "PUT",
      headers: { Authorization: `Bearer ${session.value.token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ expires_at }),
    });
    nuke.expires_at = expires_at;
    showSuccess(mins ? `${t("mod.nuke.expire_in")} ${mins} ${t("mod.nuke.min")}.` : t("mod.nuke.expiry_cleared"));
  } catch { error.value = t("mod.error.set_expiry") }
}

function nukeExpiresIn(n: NukeConfig): string | null {
  if (!n.expires_at) return null;
  const rem = n.expires_at - Date.now();
  if (rem <= 0) return t("mod.nuke.expired");
  const m = Math.floor(rem / 60_000);
  const h = Math.floor(m / 60);
  return h > 0 ? `${h}h ${m % 60}${t("mod.nuke.min")}` : `${m}${t("mod.nuke.min")}`;
}

const saveDisabled = computed(() => {
  if (editTab.value === "blocked") return !fTerm.value.trim();
  if (editTab.value === "nukes") return !fNukeTrigger.value.trim();
  return false;
});

// >>> Sync/Import - one config per tab (blocked terms/spam filters/nukes sync independently)
interface ModSyncConf { sync_from: string; is_active: number; last_synced: number }
interface ModSyncState { conf: ModSyncConf | null; open: boolean; from: string; saving: boolean; running: boolean; msg: string }
function freshModSync(): ModSyncState { return { conf: null, open: false, from: "", saving: false, running: false, msg: "" } }
const modSync: Record<Tab, ModSyncState> = reactive({ blocked: freshModSync(), spam: freshModSync(), nukes: freshModSync() });
const curSync = computed(() => modSync[activeTab.value]);

async function fetchModSync(tab: Tab) {
  if (!session.value) return;
  try {
    const res = await fetch(`${API}/mod-sync/${tab}/${session.value.channel}`, {
      headers: { Authorization: `Bearer ${session.value.token}` },
    });
    const data = await res.json();
    modSync[tab].conf = data.sync;
    modSync[tab].from = data.sync?.sync_from ?? "";
  } catch { }
}
async function saveModSync(tab: Tab) {
  if (!session.value || !modSync[tab].from) return;
  modSync[tab].saving = true;
  try {
    await fetch(`${API}/mod-sync/${tab}/${session.value.channel}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${session.value.token}` },
      body: JSON.stringify({ sync_from: modSync[tab].from, is_active: true }),
    });
    await fetchModSync(tab);
  } catch {
    modSync[tab].msg = "Failed to save.";
  }
  modSync[tab].saving = false;
}
async function stopModSync(tab: Tab) {
  if (!session.value || !modSync[tab].conf) return;
  modSync[tab].saving = true;
  try {
    await fetch(`${API}/mod-sync/${tab}/${session.value.channel}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${session.value.token}` },
      body: JSON.stringify({ sync_from: modSync[tab].conf!.sync_from, is_active: false }),
    });
    modSync[tab].conf = { ...modSync[tab].conf!, is_active: 0 };
    modSync[tab].msg = "Sync stopped.";
  } catch {
    modSync[tab].msg = "Failed.";
  }
  modSync[tab].saving = false;
}
async function runModSync(tab: Tab) {
  if (!session.value) return;
  modSync[tab].running = true;
  modSync[tab].msg = "";
  try {
    const res = await fetch(`${API}/mod-sync/${tab}/${session.value.channel}/run`, {
      method: "POST",
      headers: { Authorization: `Bearer ${session.value.token}` },
    });
    const data = await res.json();
    modSync[tab].msg = `Synced ${data.count} from #${modSync[tab].conf?.sync_from}.`;
    await load();
  } catch (e: any) {
    modSync[tab].msg = e?.message ?? "Sync failed";
  }
  modSync[tab].running = false;
}

// >>> SSE
const reloading = ref(false);
async function reload() { reloading.value = true; await load(); reloading.value = false }

let _sseSource: EventSource | null = null;
// >>> guards the fetch's post-await callback firing after unmount
let _sseDisposed = false;
function startModSSE() {
  _sseSource?.close();
  if (!session.value?.token) return;
  fetch(`${API}/activity/sse-ticket`, { method: "POST", headers: { Authorization: `Bearer ${session.value.token}` } })
    .then(r => r.ok ? (r.json() as Promise<{ ticket: string }>) : Promise.reject())
    .then(({ ticket }) => {
      if (_sseDisposed) return;
      const ch = session.value?.channel ?? "";
      const es = new EventSource(`${API}/activity/stream?ticket=${ticket}&channel=${ch}`);
      _sseSource = es;
      es.onmessage = (e) => {
        try { const ev = JSON.parse(e.data) as { type: string }; if (["ban", "timeout", "unban"].includes(ev.type)) load() } catch { }
      };
      es.onerror = () => { es.close(); if (!_sseDisposed) setTimeout(startModSSE, 10_000) };
    }).catch(() => { });
}

function loadAll() {
  load();
  startModSSE();
  fetchModSync("blocked");
  fetchModSync("spam");
  fetchModSync("nukes");
  fetchGroups("blocked");
  fetchGroups("spam");
  fetchGroups("nukes");
}

onMounted(loadAll);
watch(() => session.value?.channel, loadAll);
onUnmounted(() => { _sseDisposed = true; _sseSource?.close() });
</script>

<template>
  <div class="ep-view">
    <div class="ep-view-header">
      <div>
        <div class="ep-view-title">{{ t("mod.title") }}</div>
        <div class="ep-view-sub">
          <template v-if="activeTab === 'blocked'">{{ blockedTerms.length }} {{ t('mod.tab.blocked') }}</template>
          <template v-else-if="activeTab === 'spam'">{{ spamFilters.length }} {{ t('mod.tab.spam') }}</template>
          <template v-else>{{ nukes.length }} {{ t('mod.tab.nukes') }}</template>
        </div>
      </div>
      <div class="ep-view-header-right">
        <div v-if="botPresent" class="ep-sync-wrap">
          <button v-if="curSync.conf?.is_active" class="ep-sync-indicator" @click="curSync.open = !curSync.open"
            :title="`${t('mod.sync.active')} #${curSync.conf.sync_from}`">
            <span class="ep-sync-dot"></span>{{ t("mod.sync.active") }} #{{ curSync.conf.sync_from }}
            <span class="ep-sync-chevron" :class="{ open: curSync.open }"></span>
          </button>
          <button v-else class="ep-sync-config-btn" @click="curSync.open = !curSync.open">
            {{ t("mod.sync.config") }} <span class="ep-sync-chevron" :class="{ open: curSync.open }"></span>
          </button>
          <div v-if="curSync.open" class="ep-sync-panel">
            <div class="ep-sync-modes">
              <button class="ep-sync-mode-btn active">Sync (ongoing)</button>
              <button class="ep-sync-mode-btn" @click="curSync.open = false">Import (one-time)</button>
            </div>
            <div class="ep-sync-row">
              <select v-model="curSync.from" class="ep-field-select-sm">
                <option value="">{{ curSync.conf?.is_active ? t("mod.sync.change") : t("mod.sync.select") }}</option>
                <option v-for="ch in availableChannels.filter((c) => c !== session?.channel)" :key="ch" :value="ch">#{{
                  ch }}</option>
              </select>
              <button class="ep-sync-save-btn" @click="saveModSync(activeTab)"
                :disabled="curSync.saving || !curSync.from">
                {{ curSync.saving ? '…' : curSync.conf?.is_active ? t('mod.sync.update') : t('mod.sync.enable') }}
              </button>
            </div>
            <div class="ep-sync-row">
              <button v-if="curSync.conf?.is_active" class="ep-sync-run-btn" @click="runModSync(activeTab)"
                :disabled="curSync.running">{{ curSync.running ? '…' : t('mod.sync.pull') }}</button>
              <button v-if="curSync.conf?.is_active" class="ep-sync-stop-btn" @click="stopModSync(activeTab)">{{
                t('mod.sync.stop') }}</button>
            </div>
            <div v-if="curSync.conf?.last_synced" class="ep-sync-last">{{ t('mod.sync.last') }} {{ new
              Date(curSync.conf.last_synced).toLocaleString() }}</div>
            <div v-if="curSync.msg" class="ep-sync-msg"
              :class="{ err: curSync.msg.includes('fail') || curSync.msg.includes('Error') }">
              {{ curSync.msg }}
            </div>
          </div>
        </div>
        <button class="ep-btn-reload" @click="reload" :disabled="reloading" title="Reload">
          <template v-if="reloading">…</template>
          <span v-else v-html="iconSvgFor('refresh-cw')"></span>
        </button>
        <button v-if="canManage" class="ep-btn-cancel" @click="openNewGroup(activeTab)">
          + {{ t("mod.group.new") }}
        </button>
        <button class="ep-btn-new" @click="
          activeTab === 'blocked' ? openNewBlocked() :
            activeTab === 'spam' ? openNewSpam() : openNewNuke()
          " :disabled="!canManage">
          + {{ t("mod.add") }}
        </button>
      </div>
    </div>

    <div v-if="error" class="ep-toast error">{{ error }}</div>
    <div v-if="success" class="ep-toast success">{{ success }}</div>

    <div class="ep-tabs">
      <button v-for="tab in ['blocked', 'spam', 'nukes'] as Tab[]" :key="tab" class="ep-tab"
        :class="{ active: activeTab === tab }" @click="activeTab = tab">
        {{ tab === 'blocked' ? t('mod.tab.blocked') : tab === 'spam' ? t('mod.tab.spam') : t('mod.tab.nukes') }}
      </button>
    </div>

    <div v-if="loading" class="ep-empty">{{ t("mod.loading") }}</div>

    <!-- vvv blocked terms list vvv -->
    <template v-else-if="activeTab === 'blocked'">
      <div v-if="!blockedTerms.length && !modGroups.blocked.length" class="ep-empty">{{ botPresent ?
        t("mod.empty.blocked") : t("mod.no_bot") }}</div>
      <template v-else>
        <template v-for="section in blockedSections" :key="section.group?.id ?? 'ungrouped'">
          <div class="mod-section" @dragover.prevent
            @drop="assignGroup('blocked', section.group ? section.group.id : null)">
            <div v-if="section.group" class="mod-group-header">
              <span class="mod-group-chevron" :class="{ open: openGroups.has(section.group.id) }"
                @click="toggleGroupOpen(section.group.id)"></span>
              <span class="mod-group-name" @click="toggleGroupOpen(section.group.id)">{{ t("mod.group.reason_prefix")
              }}{{ section.group.name }}</span>
              <span class="mod-group-count">{{ section.items.length }}</span>
              <div v-if="canManage" class="ep-row-actions">
                <button class="ep-btn-action share" :title="t('mod.share')"
                  @click.stop="openShareGroup('blocked', section.group.id, section.group.name)" v-html="iconSvgFor('corner-up-right')"></button>
                <button class="ep-btn-action del" @click.stop="deleteGroup('blocked', section.group.id)" v-html="iconSvgFor('trash')"></button>
              </div>
            </div>
            <div v-if="!section.group || openGroups.has(section.group.id)" class="ep-row-list"
              :class="{ 'mod-group-members': section.group }">
              <div v-for="term in section.items" :key="term.id" class="ep-list-row mod-item-row"
                :class="{ inactive: !term.is_active }" draggable="true" @dragstart="onDragStart(term.id)">
                <div class="timer-toggle-wrap">
                  <button class="square" :class="{ on: term.is_active, off: !term.is_active, disabled: !canManage }"
                    @click="toggleActive('blocked', term)" :title="term.is_active ? 'Disable' : 'Enable'"></button>
                </div>
                <div class="mod-item-main">
                  <div class="mod-item-title">
                    <span v-if="term.is_regex" class="item-badge regex-badge">{{ t("mod.badge.regex") }}</span>
                    <span v-if="term.action === 'automod'" class="item-badge"
                      :class="term.twitch_term_id ? 'automod-synced-badge' : 'automod-pending-badge'"
                      :title="term.twitch_term_id ? t('mod.badge.automod_synced_hint') : t('mod.badge.automod_pending_hint')">
                      {{ term.twitch_term_id ? t("mod.badge.automod_synced") : t("mod.badge.automod_pending") }}
                    </span>
                    <span class="item-term">{{ term.term }}</span>
                  </div>
                  <div class="mod-item-meta">
                    <span class="item-action ep-meta-pill" :style="actionPillStyle(term.action)">{{
                      actionLabel(term.action) }}</span>
                    <span v-if="term.action !== 'delete' && term.action !== 'automod'" class="item-dur">{{
                      fmtDur(term.duration) }}</span>
                  </div>
                </div>
                <div class="ep-row-actions">
                  <button v-if="canManage && term.group_id" class="ep-btn-action" title="Remove from group"
                    @click.stop="removeFromGroup('blocked', term.id)" v-html="iconSvgFor('corner-up-left')"></button>
                  <button v-if="canManage" class="ep-btn-action edit" @click="openEditBlocked(term)">{{ t("mod.edit")
                  }}</button>
                  <button v-if="canManage" class="ep-btn-action share" :title="t('mod.share')"
                    @click.stop="openShare('blocked', term.id, term.term)" v-html="iconSvgFor('corner-up-right')"></button>
                  <button v-if="canManage" class="ep-btn-action del"
                    @click.stop="deleteRow('blocked', term.id)" v-html="iconSvgFor('trash')"></button>
                </div>
              </div>
            </div>
          </div>
        </template>
      </template>
    </template>

    <!-- vvv spam filters list vvv -->
    <template v-else-if="activeTab === 'spam'">
      <div v-if="!spamFilters.length && !modGroups.spam.length" class="ep-empty">{{ botPresent ? t("mod.empty.spam") :
        t("mod.no_bot") }}</div>
      <template v-else>
        <template v-for="section in spamSections" :key="section.group?.id ?? 'ungrouped'">
          <div class="mod-section" @dragover.prevent
            @drop="assignGroup('spam', section.group ? section.group.id : null)">
            <div v-if="section.group" class="mod-group-header">
              <span class="mod-group-chevron" :class="{ open: openGroups.has(section.group.id) }"
                @click="toggleGroupOpen(section.group.id)"></span>
              <span class="mod-group-name" @click="toggleGroupOpen(section.group.id)">{{ t("mod.group.reason_prefix")
              }}{{ section.group.name }}</span>
              <span class="mod-group-count">{{ section.items.length }}</span>
              <div v-if="canManage" class="ep-row-actions">
                <button class="ep-btn-action share" :title="t('mod.share')"
                  @click.stop="openShareGroup('spam', section.group.id, section.group.name)" v-html="iconSvgFor('corner-up-right')"></button>
                <button class="ep-btn-action del" @click.stop="deleteGroup('spam', section.group.id)" v-html="iconSvgFor('trash')"></button>
              </div>
            </div>
            <div v-if="!section.group || openGroups.has(section.group.id)" class="ep-row-list"
              :class="{ 'mod-group-members': section.group }">
              <div v-for="f in section.items" :key="f.id" class="ep-list-row mod-item-row"
                :class="{ inactive: !f.is_active }" draggable="true" @dragstart="onDragStart(f.id)">
                <div class="timer-toggle-wrap">
                  <button class="square" :class="{ on: f.is_active, off: !f.is_active, disabled: !canManage }"
                    @click="toggleActive('spam', f)" :title="f.is_active ? 'Disable' : 'Enable'"></button>
                </div>
                <div class="mod-item-main">
                  <div class="spam-label">
                    <span class="spam-name">{{ spamLabel(f).name }}</span>
                    <span class="spam-detail">· {{ spamLabel(f).detail }}</span>
                  </div>
                  <div class="mod-item-meta">
                    <span class="item-action ep-meta-pill" :style="actionPillStyle(f.action)">{{ actionLabel(f.action)
                    }}</span>
                    <span v-if="f.action !== 'delete'" class="item-dur">{{ fmtDur(f.duration) }}</span>
                  </div>
                </div>
                <div class="ep-row-actions">
                  <button v-if="canManage && f.group_id" class="ep-btn-action" title="Remove from group"
                    @click.stop="removeFromGroup('spam', f.id)" v-html="iconSvgFor('corner-up-left')"></button>
                  <button v-if="canManage" class="ep-btn-action edit" @click="openEditSpam(f)">{{ t("mod.edit")
                  }}</button>
                  <button v-if="canManage" class="ep-btn-action share" :title="t('mod.share')"
                    @click.stop="openShare('spam', f.id, spamLabel(f).name)" v-html="iconSvgFor('corner-up-right')"></button>
                  <button v-if="canManage" class="ep-btn-action del" @click.stop="deleteRow('spam', f.id)" v-html="iconSvgFor('trash')"></button>
                </div>
              </div>
            </div>
          </div>
        </template>
      </template>
    </template>

    <!-- vvv nukes list vvv -->
    <template v-else-if="activeTab === 'nukes'">
      <div v-if="!nukes.length && !modGroups.nukes.length" class="ep-empty">{{ botPresent ? t("mod.empty.nukes") :
        t("mod.no_bot") }}</div>
      <template v-else>
        <template v-for="section in nukeSections" :key="section.group?.id ?? 'ungrouped'">
          <div class="mod-section" @dragover.prevent
            @drop="assignGroup('nukes', section.group ? section.group.id : null)">
            <div v-if="section.group" class="mod-group-header">
              <span class="mod-group-chevron" :class="{ open: openGroups.has(section.group.id) }"
                @click="toggleGroupOpen(section.group.id)"></span>
              <span class="mod-group-name" @click="toggleGroupOpen(section.group.id)">{{ t("mod.group.reason_prefix")
              }}{{ section.group.name }}</span>
              <span class="mod-group-count">{{ section.items.length }}</span>
              <div v-if="canManage" class="ep-row-actions">
                <button class="ep-btn-action share" :title="t('mod.share')"
                  @click.stop="openShareGroup('nukes', section.group.id, section.group.name)" v-html="iconSvgFor('corner-up-right')"></button>
                <button class="ep-btn-action del" @click.stop="deleteGroup('nukes', section.group.id)" v-html="iconSvgFor('trash')"></button>
              </div>
            </div>
            <div v-if="!section.group || openGroups.has(section.group.id)" class="ep-row-list"
              :class="{ 'mod-group-members': section.group }">
              <div v-for="n in section.items" :key="n.id" class="ep-list-row nuke-item-row" draggable="true"
                @dragstart="onDragStart(n.id)">
                <div class="nuke-row-badges">
                  <span v-if="n.stay_active" class="item-badge stay-badge" :title="t('mod.nuke.stay_hint')">{{
                    t("mod.badge.stay") }}</span>
                  <span v-if="n.is_regex" class="item-badge regex-badge" :title="t('mod.nuke.regex_hint')">{{
                    t("mod.badge.regex") }}</span>
                  <span v-if="n.match_exact" class="item-badge exact-badge" :title="t('mod.nuke.exact_hint')">{{
                    t("mod.badge.exact") }}</span>
                </div>
                <span class="item-label">{{ n.label }}</span>
                <span class="item-term nuke-trigger">{{ n.trigger }}</span>
                <span class="item-action ep-meta-pill" :style="actionPillStyle(n.action)">{{ actionLabel(n.action)
                }}</span>
                <span v-if="n.action !== 'delete'" class="item-dur">{{ fmtDur(n.duration) }}</span>
                <div class="lookback-wrap">
                  <span class="lookback-lbl" v-html="iconSvgFor('corner-down-left')"></span>
                  <input type="number" min="1" max="1440" :value="nukeLookbackOverride[n.id] ?? n.lookback ?? 30"
                    @input="nukeLookbackOverride[n.id] = parseInt(($event.target as HTMLInputElement).value)"
                    class="ep-field-input lookback-input" :title="t('mod.nuke.lookback')" />
                  <span class="lookback-hint">{{ t("mod.nuke.min") }}</span>
                </div>
                <div v-if="n.stay_active" class="expiry-wrap">
                  <span v-if="n.expires_at" class="expiry-badge"
                    :class="{ expired: nukeExpiresIn(n) === t('mod.nuke.expired') }">
                    {{ nukeExpiresIn(n) === t("mod.nuke.expired") ? t("mod.nuke.expired") : `${t("mod.nuke.expires")}
                    ${nukeExpiresIn(n)}` }}
                    <button v-if="canManage" class="expiry-clear" @click="setNukeExpiry(n, null)" v-html="iconSvgFor('x')"></button>
                  </span>
                  <select v-else-if="canManage" class="ep-field-select-sm expiry-select"
                    @change="setNukeExpiry(n, parseInt(($event.target as HTMLSelectElement).value))"
                    :title="t('mod.nuke.expiry')">
                    <option value="0">{{ t("mod.nuke.set_expiry") }}</option>
                    <option value="15">{{ t("mod.nuke.expiry_15") }}</option>
                    <option value="30">{{ t("mod.nuke.expiry_30") }}</option>
                    <option value="60">{{ t("mod.nuke.expiry_1h") }}</option>
                    <option value="120">{{ t("mod.nuke.expiry_2h") }}</option>
                    <option value="240">{{ t("mod.nuke.expiry_4h") }}</option>
                    <option value="480">{{ t("mod.nuke.expiry_8h") }}</option>
                  </select>
                </div>
                <div class="ep-row-actions">
                  <button v-if="canManage && n.group_id" class="ep-btn-action" title="Remove from group"
                    @click.stop="removeFromGroup('nukes', n.id)" v-html="iconSvgFor('corner-up-left')"></button>
                  <button v-if="canManage" class="nuke-fire-btn" :class="{ confirm: nukeConfirm === n.id }"
                    @click="fireNuke(n.id)">
                    <template v-if="nukeConfirm === n.id"><span v-html="iconSvgFor('alert-triangle')"></span> {{ t("mod.nuke.sure") }}</template>
                    <template v-else><span v-html="iconSvgFor('zap')"></span> {{ t("mod.nuke.fire") }}</template>
                  </button>
                  <button v-if="canManage" class="ep-btn-action edit" @click="openEditNuke(n)">{{ t("mod.edit")
                  }}</button>
                  <button v-if="canManage" class="ep-btn-action share" :title="t('mod.share')"
                    @click.stop="openShare('nukes', n.id, n.label)" v-html="iconSvgFor('corner-up-right')"></button>
                  <button v-if="canManage" class="ep-btn-action del" @click.stop="deleteRow('nukes', n.id)" v-html="iconSvgFor('trash')"></button>
                </div>
              </div>
            </div>
          </div>
        </template>
      </template>
    </template>
  </div>


  <!-- vvv edit panel vvv -->
  <Teleport to="body">
    <div v-if="editOpen" class="ep-overlay" v-bind="overlay.handlers(() => editOpen = false)">
      <div class="ep-panel">

        <div class="ep-panel-header">
          <div>
            <div class="ep-panel-title">
              {{ isNew ? t("mod.panel.new") : t("mod.panel.edit") }}
              <span class="ep-panel-tab-label">
                {{ editTab === 'blocked' ? t('mod.tab.blocked') : editTab === 'spam' ? t('mod.tab.spam') :
                  t('mod.tab.nukes') }}
              </span>
            </div>
            <div class="ep-panel-sub">#{{ session?.channel }}</div>
          </div>
          <button class="ep-panel-close" @click="editOpen = false" v-html="iconSvgFor('x')"></button>
        </div>

        <div class="ep-panel-body">

          <!-- vvv blocked term form vvv -->
          <template v-if="editTab === 'blocked'">
            <div class="ep-field-group">
              <label class="ep-field-label">
                {{ t("mod.field.term") }}
                <span v-if="fTermIsRegex" class="item-badge regex-badge">{{ t("mod.badge.regex") }}</span>
              </label>
              <input ref="fTermInputEl" v-model="fTerm" class="ep-field-input" :class="{ 'ep-mono': fTermIsRegex }"
                :placeholder="t('mod.field.term_ph')" />
            </div>
            <RefPanel :title="t('mod.regex_ref')" :groups="REGEX_REF_GROUPS" :show-vars="false"
              @insert="insertIntoTerm" />
            <div class="ep-field-group">
              <label class="ep-field-label">{{ t("mod.field.action") }}</label>
              <select v-model="fTermAction" class="ep-field-select">
                <option value="delete">{{ t("mod.action.delete") }}</option>
                <option value="timeout">{{ t("mod.action.timeout") }}</option>
                <option value="ban">{{ t("mod.action.ban") }}</option>
                <option value="automod">{{ t("mod.action.automod") }}</option>
              </select>
            </div>
            <div v-if="fTermAction === 'automod'" class="ep-field-hint">
              {{ t("mod.action.automod_hint") }}
            </div>
            <div v-if="fTermAction === 'automod' && fTermIsRegex" class="ep-warning">
              {{ t("mod.action.automod_regex_warning") }}
            </div>
            <div v-if="fTermAction !== 'delete' && fTermAction !== 'automod'" class="ep-field-group">
              <label class="ep-field-label">{{ t("mod.field.duration") }} <span class="ep-field-hint">s</span></label>
              <input v-model.number="fTermDur" type="number" min="1" class="ep-field-input" />
            </div>
            <div v-if="fGroupId" class="ep-field-group">
              <label class="ep-field-label">{{ t("mod.field.reason") }}</label>
              <div class="ep-field-hint">{{ t("mod.field.reason_from_group") }} "{{ fGroupName }}"</div>
            </div>
            <div v-else class="ep-field-group">
              <label class="ep-field-label">{{ t("mod.field.reason") }} <span class="ep-field-hint">{{
                t("mod.field.reason_hint") }}</span></label>
              <input v-model="fTermReason" class="ep-field-input" />
            </div>
          </template>

          <!-- vvv spam filter form vvv -->
          <template v-if="editTab === 'spam'">
            <div class="ep-field-group">
              <label class="ep-field-label">{{ t("mod.field.spam_type") }}</label>
              <select v-model="fSpamType" class="ep-field-select">
                <option v-for="s in SPAM_TYPES" :key="s.value" :value="s.value">{{ s.label }}</option>
              </select>
            </div>
            <template v-if="fSpamType === 'emoji'">
              <div class="ep-field-group">
                <label class="ep-field-label">{{ t("mod.spam.emote_target") }}</label>
                <select v-model="fSpamEmoteTarget" class="ep-field-select">
                  <option value="emoji">{{ t("mod.spam.target.emoji") }}</option>
                  <option value="7tv">{{ t("mod.spam.target.7tv") }}</option>
                  <option value="twitch">{{ t("mod.spam.target.twitch") }}</option>
                  <option value="all">{{ t("mod.spam.target.all") }}</option>
                </select>
              </div>
            </template>
            <template v-if="fSpamType === 'caps'">
              <div class="ep-field-group">
                <label class="ep-field-label">{{ t("mod.field.type") }}</label>
                <label class="ep-toggle-label">
                  <div class="ep-toggle-btn" :class="{ on: fSpamIgnore7tv }" @click="fSpamIgnore7tv = !fSpamIgnore7tv">
                    <span class="ep-toggle-knob"></span>
                  </div>
                  <span class="toggle-text">{{ t("mod.spam.ignore_7tv") }}</span>
                </label>
              </div>
            </template>
            <div class="ep-row-2">
              <template v-if="['caps', 'repeat', 'emoji'].includes(fSpamType)">
                <div class="ep-field-group">
                  <label class="ep-field-label">{{ t("mod.spam.min_letters_hint") }} <span
                      class="ep-field-hint">min</span></label>
                  <input v-model.number="fSpamMinLetters" type="number" min="0" class="ep-field-input" />
                </div>
                <div class="ep-field-group">
                  <label class="ep-field-label">
                    {{fSpamType === 'caps' ? '% Caps' : SPAM_TYPES.find(s => s.value === fSpamType)?.hint}}
                    <span class="ep-field-hint">≥</span>
                  </label>
                  <input v-model.number="fSpamThreshold" type="number" min="1" class="ep-field-input" />
                </div>
              </template>
              <template v-else-if="fSpamType === 'flood'">
                <div class="ep-field-group">
                  <label class="ep-field-label">{{ t("mod.spam.flood_msgs") }} <span
                      class="ep-field-hint">≥</span></label>
                  <input v-model.number="fSpamThreshold" type="number" min="1" class="ep-field-input" />
                </div>
                <div class="ep-field-group">
                  <label class="ep-field-label">{{ t("mod.spam.flood_in") }} <span
                      class="ep-field-hint">s</span></label>
                  <input v-model.number="fSpamMinLetters" type="number" min="1" class="ep-field-input"
                    placeholder="10" />
                </div>
              </template>
              <template v-else>
                <div class="ep-field-group">
                  <label class="ep-field-label">{{SPAM_TYPES.find(s => s.value === fSpamType)?.hint}} <span
                      class="ep-field-hint">≥</span></label>
                  <input v-model.number="fSpamThreshold" type="number" min="1" class="ep-field-input" />
                </div>
              </template>
            </div>
            <div class="ep-field-group">
              <label class="ep-field-label">{{ t("mod.field.action") }}</label>
              <select v-model="fSpamAction" class="ep-field-select">
                <option value="delete">{{ t("mod.action.delete") }}</option>
                <option value="timeout">{{ t("mod.action.timeout") }}</option>
                <option value="ban">{{ t("mod.action.ban") }}</option>
              </select>
            </div>
            <div v-if="fSpamAction !== 'delete'" class="ep-field-group">
              <label class="ep-field-label">{{ t("mod.field.duration") }} <span class="ep-field-hint">s</span></label>
              <input v-model.number="fSpamDur" type="number" min="1" class="ep-field-input" />
            </div>
            <div v-if="fGroupId" class="ep-field-group">
              <label class="ep-field-label">{{ t("mod.field.reason") }}</label>
              <div class="ep-field-hint">{{ t("mod.field.reason_from_group") }} "{{ fGroupName }}"</div>
            </div>
            <div v-else class="ep-field-group">
              <label class="ep-field-label">{{ t("mod.field.reason") }} <span class="ep-field-hint">{{
                t("mod.field.reason_hint") }}</span></label>
              <input v-model="fSpamReason" class="ep-field-input" />
            </div>
          </template>

          <!-- vvv nuke form vvv -->
          <template v-if="editTab === 'nukes'">
            <div class="ep-field-group">
              <label class="ep-field-label">
                {{ t("mod.nuke.trigger_ph") }}
                <span v-if="fNukeIsRegex" class="item-badge regex-badge">{{ t("mod.badge.regex") }}</span>
              </label>
              <input ref="fNukeTriggerInputEl" v-model="fNukeTrigger" class="ep-field-input"
                :class="{ 'ep-mono': fNukeIsRegex }" :placeholder="t('mod.nuke.trigger_input_ph')" />
            </div>
            <RefPanel :title="t('mod.regex_ref')" :groups="REGEX_REF_GROUPS" :show-vars="false"
              @insert="insertIntoNukeTrigger" />
            <div class="ep-field-group">
              <label class="ep-field-label">{{ t("mod.nuke.label") }} <span class="ep-field-hint">optional display
                  name</span></label>
              <input v-model="fNukeLabel" class="ep-field-input" :placeholder="fNukeTrigger || t('mod.nuke.label')" />
            </div>
            <div class="ep-field-group">
              <label class="ep-field-label">{{ t("mod.field.action") }}</label>
              <select v-model="fNukeAction" class="ep-field-select">
                <option value="delete">{{ t("mod.action.delete") }}</option>
                <option value="timeout">{{ t("mod.action.timeout") }}</option>
                <option value="ban">{{ t("mod.action.ban") }}</option>
              </select>
            </div>
            <div class="ep-row-2">
              <div v-if="fNukeAction !== 'delete'" class="ep-field-group">
                <label class="ep-field-label">{{ t("mod.field.duration") }} <span class="ep-field-hint">s</span></label>
                <input v-model.number="fNukeDur" type="number" min="1" class="ep-field-input" />
              </div>
              <div class="ep-field-group">
                <label class="ep-field-label">{{ t("mod.nuke.lookback") }} <span class="ep-field-hint">{{
                  t("mod.nuke.min") }}</span></label>
                <input v-model.number="fNukeLookback" type="number" min="1" max="1440" class="ep-field-input" />
              </div>
            </div>
            <div v-if="fGroupId" class="ep-field-group">
              <label class="ep-field-label">{{ t("mod.field.reason") }}</label>
              <div class="ep-field-hint">{{ t("mod.field.reason_from_group") }} "{{ fGroupName }}"</div>
            </div>
            <div v-else class="ep-field-group">
              <label class="ep-field-label">{{ t("mod.field.reason") }} <span class="ep-field-hint">{{
                t("mod.field.reason_hint") }}</span></label>
              <input v-model="fNukeReason" class="ep-field-input" />
            </div>
            <div class="ep-field-group">
              <label class="ep-field-label">{{ t("mod.field.options") }}</label>
              <div class="toggle-row-group">
                <label class="ep-toggle-label">
                  <div class="ep-toggle-btn" :class="{ on: fNukeStay }" @click="fNukeStay = !fNukeStay">
                    <span class="ep-toggle-knob"></span>
                  </div>
                  <span class="toggle-text">{{ t("mod.nuke.stay") }}</span>
                  <span class="info-icon" :title="t('mod.nuke.stay_hint')" v-html="iconSvgFor('info')"></span>
                </label>
                <label class="ep-toggle-label" :class="{ dimmed: fNukeIsRegex }">
                  <div class="ep-toggle-btn" :class="{ on: fNukeMatchExact && !fNukeIsRegex }"
                    @click="!fNukeIsRegex && (fNukeMatchExact = !fNukeMatchExact)">
                    <span class="ep-toggle-knob"></span>
                  </div>
                  <span class="toggle-text">{{ t("mod.nuke.exact") }}</span>
                  <span class="info-icon" :title="t('mod.nuke.exact_hint')" v-html="iconSvgFor('info')"></span>
                </label>
                <label class="ep-toggle-label" :class="{ dimmed: !fNukeStay }">
                  <div class="ep-toggle-btn" :class="{ on: fNukeExpiry && fNukeStay }"
                    @click="fNukeStay && (fNukeExpiry = !fNukeExpiry)">
                    <span class="ep-toggle-knob"></span>
                  </div>
                  <span class="toggle-text">{{ t("mod.nuke.expiry") }}</span>
                  <span class="info-icon" :title="t('mod.nuke.expiry_hint')" v-html="iconSvgFor('info')"></span>
                </label>
              </div>
            </div>
            <div v-if="fNukeExpiry && fNukeStay" class="ep-field-group">
              <label class="ep-field-label">{{ t("mod.nuke.expiry") }} <span class="ep-field-hint">{{ t("mod.nuke.min")
              }}</span></label>
              <input v-model.number="fNukeExpiryMins" type="number" min="1" class="ep-field-input" />
            </div>
          </template>

        </div>

        <div class="ep-panel-footer">
          <button v-if="!isNew" class="ep-btn-delete" :class="{ confirm: deleteConfirmPanel }" @click="requestDelete"
            :disabled="saving">
            {{ saving ? '…' : deleteConfirmPanel ? t('mod.panel.sure') : t('mod.panel.delete') }}
          </button>
          <div v-else></div>
          <div class="ep-footer-right">
            <button class="ep-btn-cancel" @click="editOpen = false">{{ t("mod.panel.cancel") }}</button>
            <button class="ep-btn-save" @click="savePanel" :disabled="saving || saveDisabled">
              {{ saving ? '…' : t("mod.panel.save") }}
            </button>
          </div>
        </div>

      </div>
    </div>
  </Teleport>

  <!-- vvv group panel vvv -->
  <Teleport to="body">
    <div v-if="groupPanelOpen" class="ep-overlay" @click.self="groupPanelOpen = false">
      <div class="ep-panel">
        <div class="ep-panel-header">
          <div>
            <div class="ep-panel-title">
              {{ t("mod.group.new") }}
              <span class="ep-panel-tab-label">
                {{ groupPanelTab === 'blocked' ? t('mod.tab.blocked') : groupPanelTab === 'spam' ? t('mod.tab.spam') :
                  t('mod.tab.nukes') }}
              </span>
            </div>
            <div class="ep-panel-sub">#{{ session?.channel }}</div>
          </div>
          <button class="ep-panel-close" @click="groupPanelOpen = false" v-html="iconSvgFor('x')"></button>
        </div>
        <div class="ep-panel-body">
          <div class="ep-field-group">
            <label class="ep-field-label">{{ t("mod.group.name") }}</label>
            <input v-model="gName" class="ep-field-input" :placeholder="t('mod.group.name_placeholder')" />
          </div>
        </div>
        <div class="ep-panel-footer">
          <div></div>
          <div class="ep-footer-right">
            <button class="ep-btn-cancel" @click="groupPanelOpen = false">{{ t("mod.panel.cancel") }}</button>
            <button class="ep-btn-save" @click="saveGroup" :disabled="saving || !gName">
              {{ saving ? '…' : t("mod.panel.save") }}
            </button>
          </div>
        </div>
      </div>
    </div>
  </Teleport>

  <!-- vvv share modal vvv -->
  <Teleport to="body">
    <div v-if="shareOpen" class="ep-modal-overlay" @click.self="shareOpen = false">
      <div class="ep-modal">
        <div class="ep-modal-title">
          {{ t("mod.share.title") }}
          <span class="ep-modal-name">{{ shareLabel }}</span>
        </div>
        <div class="ep-modal-sub">{{ t("mod.share.sub") }}</div>
        <select v-model="shareTarget" class="ep-field-select-sm" style="width: 100%; margin-top: 12px">
          <option value="">{{ t("mod.share.select") }}</option>
          <option v-for="ch in availableChannels.filter((c) => c !== session?.channel)" :key="ch" :value="ch">#{{ ch
          }}</option>
        </select>
        <div v-if="shareError" class="ep-modal-msg err">{{ shareError }}</div>
        <div v-if="shareSuccess" class="ep-modal-msg ok">{{ shareSuccess }}</div>
        <div class="ep-modal-footer">
          <button class="ep-btn-cancel" @click="shareOpen = false">{{ t("mod.panel.cancel") }}</button>
          <button class="ep-btn-save" @click="doShare" :disabled="shareSaving || !shareTarget">
            {{ shareSaving ? t("mod.share.copying") : t("mod.share.btn") }}
          </button>
        </div>
      </div>
    </div>
  </Teleport>
</template>

<style scoped>
.chan {
  color: #9d6cff
}

.nuke-hint {
  font-size: 11px;
  color: #555;
  padding: 6px 0
}

.nuke-hint strong {
  color: #888;
  font-weight: 600
}

/* Groups */
.mod-section {
  display: flex;
  flex-direction: column;
}

.mod-group-header {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px 14px;
  background: #1c1c20;
  border-bottom: 1px solid #1e1e1e;
  cursor: pointer;
}

.mod-group-chevron {
  width: 6px;
  height: 6px;
  border-right: 1.5px solid #888;
  border-bottom: 1.5px solid #888;
  transform: rotate(-45deg);
  transition: transform 0.15s;
  flex-shrink: 0;
}

.mod-group-chevron.open {
  transform: rotate(45deg);
}

.mod-group-name {
  font-size: 13px;
  font-weight: 600;
  color: #e0e0e0;
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.mod-group-count {
  font-size: 10px;
  color: #555;
  flex-shrink: 0;
}

.mod-group-members {
  border-left: 2px solid #2a2a30;
  margin-left: 20px;
}

/* list rows */
.mod-item-row {
  gap: 10px
}

.nuke-item-row {
  flex-wrap: wrap;
  gap: 8px;
  align-items: center
}

.item-term {
  font-size: 12px;
  color: #e0e0e0;
  font-family: "Consolas", "Fira Mono", monospace;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.timer-toggle-wrap {
  flex-shrink: 0;
}

.mod-item-main {
  display: flex;
  flex-direction: column;
  gap: 4px;
  flex: 1;
  min-width: 0;
}

.mod-item-title {
  display: flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
}

.mod-item-meta {
  display: flex;
  align-items: center;
  gap: 8px;
}

.item-label {
  font-size: 12px;
  color: #e0e0e0;
  font-weight: 600;
  min-width: 80px
}

.item-action {
  flex-shrink: 0
}

.item-dur {
  font-size: 11px;
  color: #555;
  flex-shrink: 0
}

.nuke-trigger {
  color: #555;
  flex: 1
}

.spam-label {
  display: flex;
  align-items: center;
  gap: 6px;
  min-width: 0
}

.spam-name {
  font-size: 12px;
  font-weight: 700;
  color: #c792ea;
  white-space: nowrap
}

.spam-detail {
  font-size: 12px;
  color: #888
}

/* badges */
.item-badge {
  font-size: 9px;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  padding: 1px 5px;
  flex-shrink: 0
}

.stay-badge {
  color: #23d18b;
  background: rgba(35, 209, 139, 0.12);
  border: 1px solid rgba(35, 209, 139, 0.3)
}

.regex-badge {
  color: #c792ea;
  background: rgba(199, 146, 234, 0.12);
  border: 1px solid rgba(199, 146, 234, 0.3)
}

.automod-synced-badge {
  color: #23d18b;
  background: rgba(35, 209, 139, 0.12);
  border: 1px solid rgba(35, 209, 139, 0.3)
}

.automod-pending-badge {
  color: #e5c07b;
  background: rgba(229, 192, 123, 0.12);
  border: 1px solid rgba(229, 192, 123, 0.3)
}

.exact-badge {
  color: #e5c07b;
  background: rgba(229, 192, 123, 0.12);
  border: 1px solid rgba(229, 192, 123, 0.3)
}

.nuke-row-badges {
  display: flex;
  gap: 4px
}

/* nuke list row specifics */
.lookback-wrap {
  display: flex;
  align-items: center;
  gap: 5px
}

.lookback-lbl {
  font-size: 12px;
  color: #555
}

.lookback-hint {
  font-size: 10px;
  color: #444
}

.lookback-input {
  width: 56px !important;
  height: 28px !important;
  padding: 4px 6px !important;
  font-size: 12px !important
}

.expiry-wrap {
  display: flex;
  align-items: center
}

.expiry-badge {
  font-size: 10px;
  color: #23d18b;
  background: rgba(35, 209, 139, 0.1);
  border: 1px solid rgba(35, 209, 139, 0.3);
  padding: 2px 7px;
  display: flex;
  align-items: center;
  gap: 5px
}

.expiry-badge.expired {
  color: #f14949;
  background: rgba(241, 73, 73, 0.1);
  border-color: rgba(241, 73, 73, 0.3)
}

.expiry-clear {
  background: none;
  border: none;
  color: inherit;
  cursor: pointer;
  font-size: 10px;
  padding: 0;
  opacity: 0.6
}

.expiry-clear:hover {
  opacity: 1
}

.expiry-select {
  width: auto !important
}

.nuke-fire-btn {
  height: 28px;
  padding: 0 12px;
  background: rgba(241, 73, 73, 0.15);
  border: 1px solid #f1494966;
  color: #f14949;
  font-family: inherit;
  font-size: 11px;
  font-weight: 700;
  cursor: pointer;
  transition: background 0.15s, border-color 0.15s;
}

.nuke-fire-btn:hover {
  background: rgba(241, 73, 73, 0.3)
}

.nuke-fire-btn.confirm {
  background: rgba(241, 73, 73, 0.35);
  border-color: #f14949;
  animation: pulse-red 0.6s infinite alternate
}

@keyframes pulse-red {
  from {
    box-shadow: 0 0 0 0 rgba(241, 73, 73, 0.4)
  }

  to {
    box-shadow: 0 0 0 4px rgba(241, 73, 73, 0)
  }
}

/* panel */
.ep-panel-tab-label {
  color: #9d6cff;
  font-size: 13px;
  font-weight: 700;
  margin-left: 6px;
}

/* toggles in the panel */
.toggle-row-group {
  display: flex;
  flex-direction: column;
  gap: 10px
}

.ep-warning {
  font-size: 11px;
  color: #e5c07b;
  background: rgba(229, 192, 123, 0.08);
  border-left: 2px solid #e5c07b;
  padding: 8px 10px;
}

.ep-toggle-label {
  display: flex;
  align-items: center;
  gap: 10px;
  cursor: pointer;
  user-select: none
}

.ep-toggle-label.dimmed {
  opacity: 0.35;
  pointer-events: none
}

.toggle-text {
  font-size: 12px;
  color: #888
}

.info-icon {
  font-size: 11px;
  color: #444;
  cursor: help
}

.info-icon:hover {
  color: #9d6cff
}

@media (max-width: 680px) {
  .ep-tabs {
    overflow-x: auto
  }

  .nuke-item-row {
    gap: 6px
  }

  .ep-row-actions {
    gap: 4px
  }

  .ep-btn-action {
    padding: 0 8px;
    font-size: 10px
  }
}
</style>
