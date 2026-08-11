<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted } from "vue";
import { API } from "../api";
import { useAuth } from "../auth";
import { useI18n } from "../i18n";
import { useOverlayClose } from "../composables/useOverlayClose";

const { session, channelRole } = useAuth();
const { t } = useI18n();

const canView = computed(() => channelRole.value?.permissions.moderation_view ?? false);
const canManage = computed(() => channelRole.value?.permissions.moderation_manage ?? false);

interface BlockedTerm { id: number; term: string; action: string; duration: number; is_regex: number }
interface SpamFilter { id: number; type: string; threshold: number; min_letters: number; options: string; action: string; duration: number }
interface SpamOptions { emote_target?: "emoji" | "7tv" | "twitch" | "all"; ignore_7tv?: boolean }
interface NukeConfig { id: number; trigger: string; duration: number; label: string; lookback: number; stay_active: number; match_exact: number; is_regex: number; expires_at: number | null }

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

const ACTION_COLORS: Record<string, string> = { delete: "#e5c07b", timeout: "#c792ea", ban: "#f14949" };


// >>> Edit panel state
const overlay = useOverlayClose();
const editOpen = ref(false);
const editTab = ref<Tab>("blocked");
const isNew = ref(true);

// >>>  blocked term form
const fTerm = ref("");
const fTermAction = ref<"delete" | "timeout" | "ban">("delete");
const fTermDur = ref(300);
const fTermRegex = ref(false);
const fTermId = ref<number | null>(null);

// >>>  spam filter form
const fSpamType = ref("caps");
const fSpamThreshold = ref(70);
const fSpamMinLetters = ref(0);
const fSpamEmoteTarget = ref<"emoji" | "7tv" | "twitch" | "all">("emoji");
const fSpamIgnore7tv = ref(false);
const fSpamAction = ref<"delete" | "timeout" | "ban">("delete");
const fSpamDur = ref(300);
const fSpamId = ref<number | null>(null);

// >>>  nuke form
const fNukeTrigger = ref("");
const fNukeLabel = ref("");
const fNukeDur = ref(600);
const fNukeLookback = ref(30);
const fNukeStay = ref(false);
const fNukeMatchExact = ref(false);
const fNukeIsRegex = ref(false);
const fNukeExpiry = ref(false);
const fNukeExpiryMins = ref(60);
const fNukeId = ref<number | null>(null);

function openNewBlocked() {
  editTab.value = "blocked"; isNew.value = true; fTermId.value = null;
  fTerm.value = ""; fTermAction.value = "delete"; fTermDur.value = 300; fTermRegex.value = false;
  editOpen.value = true;
}
function openEditBlocked(term: BlockedTerm) {
  editTab.value = "blocked"; isNew.value = false; fTermId.value = term.id;
  fTerm.value = term.term; fTermAction.value = term.action as any;
  fTermDur.value = term.duration; fTermRegex.value = !!term.is_regex;
  editOpen.value = true;
}

function openNewSpam() {
  editTab.value = "spam"; isNew.value = true; fSpamId.value = null;
  fSpamType.value = "caps"; fSpamThreshold.value = 70; fSpamMinLetters.value = 0;
  fSpamEmoteTarget.value = "emoji"; fSpamIgnore7tv.value = false;
  fSpamAction.value = "delete"; fSpamDur.value = 300;
  editOpen.value = true;
}
function openEditSpam(f: SpamFilter) {
  editTab.value = "spam"; isNew.value = false; fSpamId.value = f.id;
  fSpamType.value = f.type; fSpamThreshold.value = f.threshold;
  fSpamMinLetters.value = f.min_letters ?? 0; fSpamAction.value = f.action as any;
  fSpamDur.value = f.duration;
  const opts = parseOpts(f);
  fSpamEmoteTarget.value = opts.emote_target ?? "emoji";
  fSpamIgnore7tv.value = opts.ignore_7tv ?? false;
  editOpen.value = true;
}

function openNewNuke() {
  editTab.value = "nukes"; isNew.value = true; fNukeId.value = null;
  fNukeTrigger.value = ""; fNukeLabel.value = ""; fNukeDur.value = 600;
  fNukeLookback.value = 30; fNukeStay.value = false; fNukeMatchExact.value = false;
  fNukeIsRegex.value = false; fNukeExpiry.value = false; fNukeExpiryMins.value = 60;
  editOpen.value = true;
}
function openEditNuke(n: NukeConfig) {
  editTab.value = "nukes"; isNew.value = false; fNukeId.value = n.id;
  fNukeTrigger.value = n.trigger; fNukeLabel.value = n.label; fNukeDur.value = n.duration;
  fNukeLookback.value = n.lookback ?? 30; fNukeStay.value = !!n.stay_active;
  fNukeMatchExact.value = !!n.match_exact; fNukeIsRegex.value = !!n.is_regex;
  fNukeExpiry.value = !!n.expires_at; fNukeExpiryMins.value = 60;
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

    if (editTab.value === "blocked") {
      if (isNew.value) {
        const res = await fetch(`${API}/moderation/${ch}/blocked-terms`, {
          method: "POST", headers: h,
          body: JSON.stringify({ term: fTerm.value.trim(), action: fTermAction.value, duration: fTermDur.value, is_regex: fTermRegex.value ? 1 : 0 }),
        });
        if (!res.ok) throw new Error();
        const data = await res.json();
        blockedTerms.value.push(data.item);
      } else {
        // >>> backend has no PATCH for blocked terms, so delete+recreate is the pattern
        await fetch(`${API}/moderation/${ch}/blocked-terms/${fTermId.value}`, { method: "DELETE", headers: h });
        const res = await fetch(`${API}/moderation/${ch}/blocked-terms`, {
          method: "POST", headers: h,
          body: JSON.stringify({ term: fTerm.value.trim(), action: fTermAction.value, duration: fTermDur.value, is_regex: fTermRegex.value ? 1 : 0 }),
        });
        if (!res.ok) throw new Error();
        const data = await res.json();
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
      };
      if (isNew.value) {
        const res = await fetch(`${API}/moderation/${ch}/spam-filters`, { method: "POST", headers: h, body: JSON.stringify(body) });
        if (!res.ok) throw new Error();
        const data = await res.json();
        spamFilters.value.push(data.item);
      } else {
        await fetch(`${API}/moderation/${ch}/spam-filters/${fSpamId.value}`, { method: "DELETE", headers: h });
        const res = await fetch(`${API}/moderation/${ch}/spam-filters`, { method: "POST", headers: h, body: JSON.stringify(body) });
        if (!res.ok) throw new Error();
        const data = await res.json();
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

// >>> SSE
const reloading = ref(false);
async function reload() { reloading.value = true; await load(); reloading.value = false }

let _sseSource: EventSource | null = null;
function startModSSE() {
  _sseSource?.close();
  if (!session.value?.token) return;
  fetch(`${API}/activity/sse-ticket`, { method: "POST", headers: { Authorization: `Bearer ${session.value.token}` } })
    .then(r => r.ok ? (r.json() as Promise<{ ticket: string }>) : Promise.reject())
    .then(({ ticket }) => {
      const ch = session.value?.channel ?? "";
      const es = new EventSource(`${API}/activity/stream?ticket=${ticket}&channel=${ch}`);
      _sseSource = es;
      es.onmessage = (e) => {
        try { const ev = JSON.parse(e.data) as { type: string }; if (["ban", "timeout", "unban"].includes(ev.type)) load() } catch { }
      };
      es.onerror = () => { es.close(); setTimeout(startModSSE, 10_000) };
    }).catch(() => { });
}

onMounted(() => { load(); startModSSE() });
onUnmounted(() => { _sseSource?.close() });
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
        <button class="ep-btn-reload" @click="reload" :disabled="reloading" title="Reload">{{ reloading ? '…' : '↺' }}</button>
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

    <!-- Blocked Terms list -->
    <template v-else-if="activeTab === 'blocked'">
      <div v-if="!blockedTerms.length" class="ep-empty">{{ t("mod.empty.blocked") }}</div>
      <div v-else class="ep-row-list">
        <div v-for="term in blockedTerms" :key="term.id" class="ep-list-row mod-item-row">
          <span v-if="term.is_regex" class="item-badge regex-badge">{{ t("mod.badge.regex") }}</span>
          <span class="item-term">{{ term.term }}</span>
          <span class="item-action" :style="{ color: ACTION_COLORS[term.action] }">
            {{ term.action === 'delete' ? t('mod.action.delete') : term.action === 'timeout' ? t('mod.action.timeout') :
              t('mod.action.ban') }}
          </span>
          <span v-if="term.action !== 'delete'" class="item-dur">{{ fmtDur(term.duration) }}</span>
          <div class="ep-row-actions">
            <button v-if="canManage" class="ep-btn-action edit" @click="openEditBlocked(term)">{{ t("mod.edit")
            }}</button>
          </div>
        </div>
      </div>
    </template>

    <!-- Spam Filters list -->
    <template v-else-if="activeTab === 'spam'">
      <div v-if="!spamFilters.length" class="ep-empty">{{ t("mod.empty.spam") }}</div>
      <div v-else class="ep-row-list">
        <div v-for="f in spamFilters" :key="f.id" class="ep-list-row mod-item-row">
          <div class="spam-label">
            <span class="spam-name">{{ spamLabel(f).name }}</span>
            <span class="spam-detail">· {{ spamLabel(f).detail }}</span>
          </div>
          <span class="item-action" :style="{ color: ACTION_COLORS[f.action] }">
            {{ f.action === 'delete' ? t('mod.action.delete') : f.action === 'timeout' ? t('mod.action.timeout') :
              t('mod.action.ban') }}
          </span>
          <span v-if="f.action !== 'delete'" class="item-dur">{{ fmtDur(f.duration) }}</span>
          <div class="ep-row-actions">
            <button v-if="canManage" class="ep-btn-action edit" @click="openEditSpam(f)">{{ t("mod.edit") }}</button>
          </div>
        </div>
      </div>
    </template>

    <!-- Nukes list -->
    <template v-else-if="activeTab === 'nukes'">
      <div v-if="!nukes.length" class="ep-empty">{{ t("mod.empty.nukes") }}</div>
      <div v-else class="ep-row-list">
        <div v-for="n in nukes" :key="n.id" class="ep-list-row nuke-item-row">
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
          <span class="item-dur">{{ fmtDur(n.duration) }}</span>
          <!-- Lookback override -->
          <div class="lookback-wrap">
            <span class="lookback-lbl">↩</span>
            <input type="number" min="1" max="1440" :value="nukeLookbackOverride[n.id] ?? n.lookback ?? 30"
              @input="nukeLookbackOverride[n.id] = parseInt(($event.target as HTMLInputElement).value)"
              class="ep-field-input lookback-input" :title="t('mod.nuke.lookback')" />
            <span class="lookback-hint">{{ t("mod.nuke.min") }}</span>
          </div>
          <!-- Expiry -->
          <div v-if="n.stay_active" class="expiry-wrap">
            <span v-if="n.expires_at" class="expiry-badge"
              :class="{ expired: nukeExpiresIn(n) === t('mod.nuke.expired') }">
              {{ nukeExpiresIn(n) === t("mod.nuke.expired") ? t("mod.nuke.expired") : `${t("mod.nuke.expires")}
              ${nukeExpiresIn(n)}` }}
              <button v-if="canManage" class="expiry-clear" @click="setNukeExpiry(n, null)">✕</button>
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
            <button v-if="canManage" class="nuke-fire-btn" :class="{ confirm: nukeConfirm === n.id }"
              @click="fireNuke(n.id)">
              {{ nukeConfirm === n.id ? t("mod.nuke.sure") : t("mod.nuke.fire") }}
            </button>
            <button v-if="canManage" class="ep-btn-action edit" @click="openEditNuke(n)">{{ t("mod.edit") }}</button>
          </div>
        </div>
      </div>
    </template>
  </div>


  <!-- Edit panel -->
  <Teleport to="body">
    <div v-if="editOpen" class="ep-overlay" v-bind="overlay.handlers(() => editOpen = false)">
      <div class="ep-panel">

        <!-- Header -->
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
          <button class="ep-panel-close" @click="editOpen = false">✕</button>
        </div>

        <div class="ep-panel-body">

          <!-- BLOCKED TERM FORM -->
          <template v-if="editTab === 'blocked'">
            <div class="ep-field-group">
              <label class="ep-field-label">{{ t("mod.field.term") }}</label>
              <input v-model="fTerm" class="ep-field-input" :class="{ 'ep-mono': fTermRegex }"
                :placeholder="fTermRegex ? t('mod.field.term_re') : t('mod.field.term')" />
            </div>
            <div class="ep-field-group">
              <label class="ep-field-label">{{ t("mod.field.type") }}</label>
              <div class="toggle-row-group">
                <label class="ep-toggle-label">
                  <div class="ep-toggle-btn" :class="{ on: fTermRegex }" @click="fTermRegex = !fTermRegex">
                    <span class="ep-toggle-knob"></span>
                  </div>
                  <span class="toggle-text">{{ t("mod.nuke.regex") }}</span>
                  <span class="info-icon" :title="t('mod.nuke.regex_hint')">ⓘ</span>
                </label>
              </div>
            </div>
            <div class="ep-field-group">
              <label class="ep-field-label">{{ t("mod.field.action") }}</label>
              <select v-model="fTermAction" class="ep-field-select">
                <option value="delete">{{ t("mod.action.delete") }}</option>
                <option value="timeout">{{ t("mod.action.timeout") }}</option>
                <option value="ban">{{ t("mod.action.ban") }}</option>
              </select>
            </div>
            <div v-if="fTermAction !== 'delete'" class="ep-field-group">
              <label class="ep-field-label">{{ t("mod.field.duration") }} <span class="ep-field-hint">s</span></label>
              <input v-model.number="fTermDur" type="number" min="1" class="ep-field-input" />
            </div>
          </template>

          <!-- SPAM FILTER FORM -->
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
          </template>

          <!-- NUKE FORM -->
          <template v-if="editTab === 'nukes'">
            <div class="ep-field-group">
              <label class="ep-field-label">{{ t("mod.nuke.trigger_ph") }}</label>
              <input v-model="fNukeTrigger" class="ep-field-input" :class="{ 'ep-mono': fNukeIsRegex }"
                :placeholder="fNukeIsRegex ? t('mod.nuke.trigger_re_ph') : t('mod.nuke.trigger_ph')" />
            </div>
            <div class="ep-field-group">
              <label class="ep-field-label">{{ t("mod.nuke.label") }} <span class="ep-field-hint">optional display
                  name</span></label>
              <input v-model="fNukeLabel" class="ep-field-input" :placeholder="fNukeTrigger || t('mod.nuke.label')" />
            </div>
            <div class="ep-row-2">
              <div class="ep-field-group">
                <label class="ep-field-label">{{ t("mod.nuke.timeout") }} <span class="ep-field-hint">s</span></label>
                <input v-model.number="fNukeDur" type="number" min="1" class="ep-field-input" />
              </div>
              <div class="ep-field-group">
                <label class="ep-field-label">{{ t("mod.nuke.lookback") }} <span class="ep-field-hint">{{
                  t("mod.nuke.min") }}</span></label>
                <input v-model.number="fNukeLookback" type="number" min="1" max="1440" class="ep-field-input" />
              </div>
            </div>
            <div class="ep-field-group">
              <label class="ep-field-label">{{ t("mod.field.options") }}</label>
              <div class="toggle-row-group">
                <label class="ep-toggle-label">
                  <div class="ep-toggle-btn" :class="{ on: fNukeStay }" @click="fNukeStay = !fNukeStay">
                    <span class="ep-toggle-knob"></span>
                  </div>
                  <span class="toggle-text">{{ t("mod.nuke.stay") }}</span>
                  <span class="info-icon" :title="t('mod.nuke.stay_hint')">ⓘ</span>
                </label>
                <label class="ep-toggle-label" :class="{ dimmed: fNukeIsRegex }">
                  <div class="ep-toggle-btn" :class="{ on: fNukeMatchExact && !fNukeIsRegex }"
                    @click="!fNukeIsRegex && (fNukeMatchExact = !fNukeMatchExact)">
                    <span class="ep-toggle-knob"></span>
                  </div>
                  <span class="toggle-text">{{ t("mod.nuke.exact") }}</span>
                  <span class="info-icon" :title="t('mod.nuke.exact_hint')">ⓘ</span>
                </label>
                <label class="ep-toggle-label">
                  <div class="ep-toggle-btn" :class="{ on: fNukeIsRegex }"
                    @click="fNukeIsRegex = !fNukeIsRegex; fNukeIsRegex && (fNukeMatchExact = false)">
                    <span class="ep-toggle-knob"></span>
                  </div>
                  <span class="toggle-text">{{ t("mod.nuke.regex") }}</span>
                  <span class="info-icon" :title="t('mod.nuke.regex_hint')">ⓘ</span>
                </label>
                <label class="ep-toggle-label" :class="{ dimmed: !fNukeStay }">
                  <div class="ep-toggle-btn" :class="{ on: fNukeExpiry && fNukeStay }"
                    @click="fNukeStay && (fNukeExpiry = !fNukeExpiry)">
                    <span class="ep-toggle-knob"></span>
                  </div>
                  <span class="toggle-text">{{ t("mod.nuke.expiry") }}</span>
                  <span class="info-icon" :title="t('mod.nuke.expiry_hint')">ⓘ</span>
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
  flex: 1;
  font-size: 12px;
  color: #e0e0e0;
  font-family: "Consolas", "Fira Mono", monospace;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.item-label {
  font-size: 12px;
  color: #e0e0e0;
  font-weight: 600;
  min-width: 80px
}

.item-action {
  font-size: 11px;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.04em;
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
  flex: 1;
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
