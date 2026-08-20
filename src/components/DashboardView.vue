<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted, watch } from "vue";
import { useRouter } from "vue-router";
import { API } from "../api";
import { useAuth } from "../auth";
import { useI18n } from "../i18n";
import { iconSvg as iconSvgFor } from "../composables/icons";

const { session, availableChannels } = useAuth();
const router = useRouter();
const { t } = useI18n();

interface ActivityEntry {
  id: number;
  channel: string;
  type:
  | "cmd_added"
  | "cmd_changed"
  | "cmd_removed"
  | "ban"
  | "unban"
  | "timeout"
  | "message_deleted"
  | "timer_added"
  | "timer_changed"
  | "timer_removed"
  | "timer_enabled"
  | "timer_disabled"
  | "trigger_added"
  | "trigger_changed"
  | "trigger_removed"
  | "trigger_enabled"
  | "trigger_disabled"
  | "countdown_added"
  | "countdown_changed"
  | "countdown_removed"
  | "countdown_started"
  | "countdown_stopped"
  | "automod_held"
  | "automod_approved"
  | "automod_denied"
  | "automod_expired"
  | "mod_add"
  | "mod_remove"
  | "vip_add"
  | "vip_remove";
  actor: string;
  target: string;
  detail: string;
  timestamp: number;
}

const activity = ref<ActivityEntry[]>([]);
const loading = ref(false);
const error = ref("");
const liveStatus = ref<"connecting" | "live" | "off">("off");
const ALL_CHANNELS = "__all__";
const viewChannel = ref(session.value?.channel ?? "");
// >>> holds derived type keys, not raw types
const activeTypes = ref<Set<string>>(new Set());

// >>> combines type + actor into one key
function activityKey(e: ActivityEntry): string {
  if (["ban", "timeout", "unban", "message_deleted"].includes(e.type)) {
    if (e.actor === "trigger") return `${e.type}#trigger`;
    if (e.actor === "mod") return `${e.type}#twitch`;
    return `${e.type}#shyboti`;
  }
  if (e.type.startsWith("automod_")) return `${e.type}#twitch`;
  if (["mod_add", "mod_remove", "vip_add", "vip_remove"].includes(e.type))
    return `${e.type}#twitch`;
  return e.type;
}

// >>> only today starts expanded
const collapsedDays = ref<Set<string>>(new Set());

// vvv user popup vvv
interface TwitchUser {
  login: string;
  displayName: string;
  avatar: string;
  createdAt: string;
  ownFollowers: number | null;
  followedAt: string | null;
  subbedSince: string | null;
  subTier: string | null;
  nameHistory: { name: string; lastSeen: string }[];
  paint: {
    id: string;
    name: string;
    imageUrl: string | null;
    shadows: any[];
    stops: any[];
  } | null;
}
const popup = ref<{ entry: ActivityEntry; x: number; y: number } | null>(null);
const popupUser = ref<TwitchUser | null>(null);
const popupLoading = ref(false);
// ^^^ user popup ^^^

let sseSource: EventSource | null = null;
// >>> guards against async work after unmount
let disposed = false;

// >>> keys are type+actor, splits mod chips below
const TYPE_GROUPS = computed(() => [
  {
    label: t("dash.filter.commands"),
    types: ["cmd_added", "cmd_changed", "cmd_removed"] as const,
  },
  {
    label: t("dash.filter.shyboti_moderation"),
    types: [
      "ban#shyboti",
      "unban#shyboti",
      "timeout#shyboti",
      "message_deleted#shyboti",
    ] as const,
  },
  {
    label: t("dash.filter.twitch_moderation"),
    types: [
      "ban#twitch",
      "unban#twitch",
      "timeout#twitch",
      "automod_held#twitch",
      "automod_approved#twitch",
      "automod_denied#twitch",
      "automod_expired#twitch",
      "mod_add#twitch",
      "mod_remove#twitch",
      "vip_add#twitch",
      "vip_remove#twitch",
    ] as const,
  },
  {
    label: t("dash.filter.automations"),
    types: [
      "timer_added",
      "timer_changed",
      "timer_removed",
      "timer_enabled",
      "timer_disabled",
      "trigger_added",
      "trigger_changed",
      "trigger_removed",
      "trigger_enabled",
      "trigger_disabled",
      "countdown_added",
      "countdown_changed",
      "countdown_removed",
      "countdown_started",
      "countdown_stopped",
      "ban#trigger",
      "timeout#trigger",
    ] as const,
  },
]);

function toggleType(t: string) {
  const s = new Set(activeTypes.value);
  if (s.has(t)) s.delete(t);
  else s.add(t);
  activeTypes.value = s;
}

function toggleGroup(types: readonly string[]) {
  const s = new Set(activeTypes.value);
  const allOn = types.every((t) => s.has(t));
  types.forEach((t) => (allOn ? s.delete(t) : s.add(t)));
  activeTypes.value = s;
}

const filteredActivity = computed(() =>
  activeTypes.value.size === 0
    ? activity.value
    : activity.value.filter((e) => activeTypes.value.has(activityKey(e))),
);

watch(
  () => session.value?.channel,
  (ch) => {
    if (ch) {
      viewChannel.value = ch;
      fetchActivity();
    }
  },
);
watch(viewChannel, (newCh, oldCh) => {
  if (newCh !== oldCh) startSSE();
});

async function fetchActivity() {
  if (!session.value) return;
  loading.value = true;
  error.value = "";
  try {
    if (viewChannel.value === ALL_CHANNELS) {
      const all = availableChannels.value.length
        ? availableChannels.value
        : [session.value.channel];
      const results = await Promise.all(
        all.map((ch) =>
          fetch(`${API}/activity/${ch}?limit=80`, {
            headers: { Authorization: `Bearer ${session.value!.token}` },
          })
            .then((r) =>
              r.ok
                ? (r.json() as Promise<{ activity: ActivityEntry[] }>)
                : { activity: [] as ActivityEntry[] },
            )
            .catch(() => ({ activity: [] as ActivityEntry[] })),
        ),
      );
      const merged = results.flatMap((r) => r.activity);
      merged.sort((a, b) => b.timestamp - a.timestamp);
      activity.value = merged.slice(0, 200);
    } else {
      const res = await fetch(`${API}/activity/${viewChannel.value}?limit=80`, {
        headers: { Authorization: `Bearer ${session.value.token}` },
      });
      if (!res.ok) throw new Error();
      const data = (await res.json()) as { activity: ActivityEntry[] };
      activity.value = data.activity;
    }
  } catch {
    error.value = "Could not load activity.";
  }
  loading.value = false;
  // >>> collapse all days except today
  const today = fmtDate(Date.now());
  const days = new Set(filteredActivity.value.map((e) => fmtDate(e.timestamp)));
  collapsedDays.value = new Set([...days].filter((d) => d !== today));
}

onMounted(() => {
  fetchActivity().then(() => { if (!disposed) startSSE(); });
});
onUnmounted(() => {
  disposed = true;
  sseSource?.close();
  sseSource = null;
});

async function startSSE() {
  sseSource?.close();
  sseSource = null;
  if (!session.value?.token) return;
  liveStatus.value = "connecting";
  let ticket: string;
  try {
    const r = await fetch(`${API}/activity/sse-ticket`, {
      method: "POST",
      headers: { Authorization: `Bearer ${session.value.token}` },
    });
    if (!r.ok) {
      liveStatus.value = "off";
      return;
    }
    ticket = ((await r.json()) as { ticket: string }).ticket;
  } catch {
    liveStatus.value = "off";
    return;
  }
  if (disposed) return;

  const ch = viewChannel.value === ALL_CHANNELS ? "" : viewChannel.value;
  const es = new EventSource(
    `${API}/activity/stream?ticket=${ticket}${ch ? `&channel=${ch}` : ""}`,
  );
  sseSource = es;
  es.onopen = () => {
    liveStatus.value = "live";
  };
  es.onerror = () => {
    liveStatus.value = "off";
    es.close();
    setTimeout(() => {
      if (sseSource === es) startSSE();
    }, 5000);
  };
  es.onmessage = (e) => {
    try {
      const entry = JSON.parse(e.data) as ActivityEntry;
      activity.value = [entry, ...activity.value].slice(0, 200);
      // >>> keeps today expanded when new entries arrive
      const todayLabel = fmtDate(Date.now());
      collapsedDays.value.delete(todayLabel);
    } catch { }
  };
}

// vvv grouping & collapse vvv
function fmtTime(ts: number) {
  return new Date(ts).toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
  });
}
function fmtDate(ts: number) {
  const d = new Date(ts);
  const today = new Date();
  if (d.toDateString() === today.toDateString()) return t("dash.today");
  const yest = new Date(today);
  yest.setDate(yest.getDate() - 1);
  if (d.toDateString() === yest.toDateString()) return t("dash.yesterday");
  return d.toLocaleDateString("de-DE", { day: "2-digit", month: "2-digit" });
}
function toggleDay(date: string) {
  const s = new Set(collapsedDays.value);
  s.has(date) ? s.delete(date) : s.add(date);
  collapsedDays.value = s;
}

function groupedActivity() {
  const groups: { date: string; entries: ActivityEntry[] }[] = [];
  let cur = "";
  for (const e of filteredActivity.value) {
    const d = fmtDate(e.timestamp);
    if (d !== cur) {
      cur = d;
      groups.push({ date: d, entries: [] });
    }
    groups[groups.length - 1]!.entries.push(e);
  }
  return groups;
}
// ^^^ grouping & collapse ^^^

// vvv type meta vvv
// >>> icon maps to an svg name, not text
const TYPE_META = computed(
  () =>
    ({
      cmd_added: { icon: "plus", color: "#23d18b", label: t("type.cmd_added") },
      cmd_changed: {
        icon: "edit",
        color: "#e5c07b",
        label: t("type.cmd_changed"),
      },
      cmd_removed: {
        icon: "minus",
        color: "#f14949",
        label: t("type.cmd_removed"),
      },
      ban: { icon: "ban", color: "#f14949", label: t("type.ban") },
      unban: { icon: "check", color: "#4ec9b0", label: t("type.unban") },
      timeout: { icon: "clock", color: "#c792ea", label: t("type.timeout") },
      message_deleted: {
        icon: "trash",
        color: "#e5c07b",
        label: t("type.message_deleted"),
      },
      timer_added: {
        icon: "plus",
        color: "#23d18b",
        label: t("type.timer_added"),
      },
      timer_changed: {
        icon: "edit",
        color: "#e5c07b",
        label: t("type.timer_changed"),
      },
      timer_removed: {
        icon: "minus",
        color: "#f14949",
        label: t("type.timer_removed"),
      },
      timer_enabled: {
        icon: "play",
        color: "#23d18b",
        label: t("type.timer_enabled"),
      },
      timer_disabled: {
        icon: "pause",
        color: "#555555",
        label: t("type.timer_disabled"),
      },
      trigger_added: {
        icon: "plus",
        color: "#4ec9b0",
        label: t("type.trigger_added"),
      },
      trigger_changed: {
        icon: "edit",
        color: "#e5c07b",
        label: t("type.trigger_changed"),
      },
      trigger_removed: {
        icon: "minus",
        color: "#f14949",
        label: t("type.trigger_removed"),
      },
      trigger_enabled: {
        icon: "play",
        color: "#4ec9b0",
        label: t("type.trigger_enabled"),
      },
      trigger_disabled: {
        icon: "pause",
        color: "#555555",
        label: t("type.trigger_disabled"),
      },
      countdown_added: {
        icon: "plus",
        color: "#4ec9b0",
        label: t("type.countdown_added"),
      },
      countdown_changed: {
        icon: "edit",
        color: "#e5c07b",
        label: t("type.countdown_changed"),
      },
      countdown_removed: {
        icon: "minus",
        color: "#f14949",
        label: t("type.countdown_removed"),
      },
      countdown_started: {
        icon: "play",
        color: "#23d18b",
        label: t("type.countdown_started"),
      },
      countdown_stopped: {
        icon: "pause",
        color: "#555555",
        label: t("type.countdown_stopped"),
      },
      automod_held: {
        icon: "alert-triangle",
        color: "#e5c07b",
        label: t("type.automod_held"),
      },
      automod_approved: {
        icon: "check",
        color: "#23d18b",
        label: t("type.automod_approved"),
      },
      automod_denied: {
        icon: "ban",
        color: "#f14949",
        label: t("type.automod_denied"),
      },
      automod_expired: {
        icon: "clock",
        color: "#555555",
        label: t("type.automod_expired"),
      },
      mod_add: {
        icon: "user-plus",
        color: "#9d6cff",
        label: t("type.mod_add"),
      },
      mod_remove: {
        icon: "user-minus",
        color: "#9d6cff",
        label: t("type.mod_remove"),
      },
      vip_add: {
        icon: "user-plus",
        color: "#e0b34d",
        label: t("type.vip_add"),
      },
      vip_remove: {
        icon: "user-minus",
        color: "#e0b34d",
        label: t("type.vip_remove"),
      },
    }) as Record<string, { icon: string; color: string; label: string }>,
);
// ^^^ type meta ^^^

function iconSvg(type: string): string {
  const name = TYPE_META.value[type]?.icon ?? "dot";
  return iconSvgFor(name);
}

// vvv actions vvv
function goToCommand(e: ActivityEntry) {
  const name = e.target.replace(/^\+/, "");
  router.push({ path: "/commands", query: { edit: name } });
}

function goToLogs(e: ActivityEntry) {
  const ch = e.channel;
  const user = e.target;
  router.push({ path: "/logs", query: { channel: ch, user } });
}

function goToAutomations(e: ActivityEntry) {
  const tab = e.type.startsWith("timer")
    ? "timers"
    : e.type.startsWith("trigger")
      ? "triggers"
      : "countdowns";
  router.push({ path: "/automations", query: { tab } });
}

// >>> only mod-type entries carry a real username
const USER_TARGET_TYPES = new Set([
  "ban",
  "unban",
  "timeout",
  "message_deleted",
  "automod_held",
  "automod_approved",
  "automod_denied",
  "automod_expired",
  "mod_add",
  "mod_remove",
  "vip_add",
  "vip_remove",
]);

function onTargetClick(e: ActivityEntry, evt: MouseEvent) {
  evt.stopPropagation();
  if (!e.target) return;
  if (USER_TARGET_TYPES.has(e.type)) {
    openUserPopup(e.target, e.channel, evt);
  } else if (e.type.startsWith("cmd_")) {
    goToCommand(e);
  } else if (
    e.type.startsWith("timer") ||
    e.type.startsWith("trigger") ||
    e.type.startsWith("countdown")
  ) {
    goToAutomations(e);
  }
}

// >>> works for any entry with a username
function openUserPopup(username: string, channel: string, evt: MouseEvent) {
  evt.stopPropagation();
  const fakeEntry = { channel } as ActivityEntry;
  popup.value = {
    entry: { ...fakeEntry, target: username } as ActivityEntry,
    x: evt.clientX,
    y: evt.clientY,
  };
  popupUser.value = null;
  popupLoading.value = true;
  fetch(
    `${API}/twitch/user/${encodeURIComponent(username.toLowerCase())}?channel=${encodeURIComponent(channel)}`,
    {
      headers: session.value
        ? { Authorization: `Bearer ${session.value.token}` }
        : {},
    },
  )
    .then((r) => (r.ok ? (r.json() as Promise<TwitchUser>) : Promise.reject()))
    .then((u) => {
      popupUser.value = u;
    })
    .catch(() => { })
    .finally(() => {
      popupLoading.value = false;
    });
}

function openUsercardPopout(username: string, channel: string) {
  window.open(
    `https://www.twitch.tv/popout/${channel}/viewercard/${username}`,
    "_blank",
    "width=340,height=560",
  );
}

function closePopup() {
  popup.value = null;
  popupUser.value = null;
}

function fmtFollowers(n: number): string {
  if (n >= 1_000_000)
    return (n / 1_000_000).toFixed(1).replace(/\.0$/, "") + "M";
  if (n >= 1_000) return (n / 1_000).toFixed(1).replace(/\.0$/, "") + "K";
  return String(n);
}

function fmtJoined(iso: string): string {
  return new Date(iso).toLocaleDateString([], {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

// >>> formats how long ago, e.g. 2y 3mo
function fmtDuration(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  const days = Math.floor(ms / 86_400_000);
  const months = Math.floor(days / 30.44);
  const years = Math.floor(months / 12);
  const remMo = months % 12;
  if (years > 0 && remMo > 0) return `${years}y ${remMo}mo`;
  if (years > 0) return `${years}y`;
  if (months > 0) return `${months}mo`;
  return `${days}d`;
}

function subTierLabel(tier: string): string {
  return tier === "3000" ? "Tier 3" : tier === "2000" ? "Tier 2" : "Tier 1";
}

// >>> builds css style for a 7tv paint name
function paintNameStyle(paint: {
  imageUrl: string | null;
  stops: { at: number; color: number }[];
  shadows: any[];
}): Record<string, string> {
  const styles: Record<string, string> = {};
  // >>> convert 7tv int32 color to rgba
  function intToRgba(c: number): string {
    const r = (c >>> 24) & 0xff;
    const g = (c >>> 16) & 0xff;
    const b = (c >>> 8) & 0xff;
    const a = (c & 0xff) / 255;
    return `rgba(${r},${g},${b},${a.toFixed(3)})`;
  }
  if (paint.stops?.length >= 2) {
    const stops = paint.stops
      .map((s) => `${intToRgba(s.color)} ${Math.round(s.at * 100)}%`)
      .join(", ");
    styles["background"] = `linear-gradient(90deg, ${stops})`;
    styles["background-clip"] = "text";
    styles["-webkit-background-clip"] = "text";
    styles["color"] = "transparent";
    styles["-webkit-text-fill-color"] = "transparent";
  } else if (paint.imageUrl) {
    styles["background"] = `url(${paint.imageUrl}) center/cover`;
    styles["background-clip"] = "text";
    styles["-webkit-background-clip"] = "text";
    styles["color"] = "transparent";
    styles["-webkit-text-fill-color"] = "transparent";
  }
  if (paint.shadows?.length) {
    styles["filter"] = paint.shadows
      .map(
        (s) =>
          `drop-shadow(${s.x_offset ?? 0}px ${s.y_offset ?? 0}px ${s.radius ?? 0}px ${intToRgba(s.color)})`,
      )
      .join(" ");
  }
  return styles;
}

// >>> backend format: [category] text — reason
interface ParsedDetail {
  category: string | null;
  reason: string | null;
  text: string;
}
function parseDetail(e: ActivityEntry): ParsedDetail {
  let raw = e.detail || "";
  // >>> native timeouts store plain seconds, no category
  if (e.type === "timeout" && raw && !raw.startsWith("[")) {
    const s = parseInt(raw);
    if (!isNaN(s)) {
      const text =
        s >= 3600
          ? `${Math.round(s / 3600)}h timeout`
          : s >= 60
            ? `${Math.round(s / 60)}m timeout`
            : `${s}s timeout`;
      return { category: null, reason: null, text };
    }
  }
  const catMatch = raw.match(/^\[([^\]]+)\]\s*/);
  const category = catMatch ? catMatch[1]! : null;
  if (catMatch) raw = raw.slice(catMatch[0].length);
  const dashIdx = raw.indexOf(" — ");
  if (dashIdx >= 0) {
    return {
      category,
      reason: raw.slice(dashIdx + 3),
      text: raw.slice(0, dashIdx),
    };
  }
  return { category, reason: null, text: raw };
}

// >>> 'mod' means actor unknown, else show name
function fmtActor(actor: string) {
  return actor === "mod"
    ? t("dash.filter.moderation") === "Moderation"
      ? "a mod"
      : "ein Mod"
    : actor;
}
// ^^^ actions ^^^
</script>

<template>
  <div class="dash" @click="closePopup">
    <div class="dash-header">
      <div>
        <div class="dash-title">{{ t("dash.title") }}</div>
      </div>
      <div class="dash-header-right">
        <span class="live-dot" :class="liveStatus" :title="liveStatus === 'live'
          ? 'Live'
          : liveStatus === 'connecting'
            ? 'Connecting…'
            : 'Offline'
          "></span>
        <button class="ep-btn-reload" @click="fetchActivity" title="Reload" v-html="iconSvgFor('refresh-cw')"></button>

      </div>
    </div>

    <div class="type-filters">
      <button v-for="group in TYPE_GROUPS" :key="group.label" class="group-chip"
        :class="{ active: group.types.every((t) => activeTypes.has(t)) }" @click="toggleGroup(group.types)">
        {{ group.label }}
      </button>
      <button v-if="activeTypes.size > 0" class="clear-chip" @click="activeTypes = new Set()">
        <span v-html="iconSvgFor('x')"></span> {{ t("dash.filter.clear") }}
      </button>
    </div>

    <div v-if="error" class="feed-empty err">{{ error }}</div>
    <div v-else-if="loading && !activity.length" class="feed">
      <div class="ep-skeleton-row feed-skeleton-row" v-for="i in 10" :key="i">
        <div class="ep-skeleton-block ep-skeleton-square"></div>
        <div class="ep-skeleton-lines">
          <div class="ep-skeleton-block ep-skeleton-line title"></div>
        </div>
      </div>
    </div>
    <div v-else-if="!filteredActivity.length" class="feed-empty">
      {{ activity.length ? "No matching activity." : "No activity yet." }}
    </div>

    <div v-else class="feed">
      <template v-for="group in groupedActivity()" :key="group.date">
        <div class="feed-day-header" @click.stop="toggleDay(group.date)">
          <span class="day-chevron" v-html="iconSvgFor(collapsedDays.has(group.date) ? 'chevron-right' : 'chevron-down')"></span>
          <span class="day-label">{{ group.date }}</span>
          <span class="day-count">{{ group.entries.length }}</span>
        </div>

        <template v-if="!collapsedDays.has(group.date)">
          <div v-for="e in group.entries" :key="e.id" class="feed-row">
            <div class="feed-icon" :style="{ color: TYPE_META[e.type]?.color }" v-html="iconSvg(e.type)"></div>

            <div class="feed-body">
              <span class="feed-type" :style="{ color: TYPE_META[e.type]?.color }">{{ TYPE_META[e.type]?.label }}</span>

              <span class="feed-target" :class="{ 'mod-target': !!e.target }" @click.stop="
                e.target && onTargetClick(e, $event)
                ">{{ e.target }}</span>

              <span class="feed-by" v-if="e.actor">by {{ fmtActor(e.actor) }}</span>

              <span v-if="parseDetail(e).category" class="ep-meta-pill cond">{{ parseDetail(e).category }}</span>
              <span v-if="parseDetail(e).reason" class="ep-meta-pill when">{{ parseDetail(e).reason }}</span>
              <span v-if="parseDetail(e).text" class="feed-detail">· {{ parseDetail(e).text }}</span>

              <span v-if="viewChannel === ALL_CHANNELS" class="feed-ch">#{{ e.channel }}</span>
            </div>

            <div class="feed-right">
              <div class="feed-actions">
                <button v-if="USER_TARGET_TYPES.has(e.type)" class="act-btn" title="View user logs"
                  @click.stop="goToLogs(e)">
                  logs
                </button>
                <button v-if="
                  ['cmd_added', 'cmd_changed', 'cmd_removed'].includes(e.type)
                " class="act-btn" title="Edit command" @click.stop="goToCommand(e)">
                  edit
                </button>
                <button v-if="
                  e.type.startsWith('timer') || e.type.startsWith('trigger') || e.type.startsWith('countdown')
                " class="act-btn" title="View in Automations" @click.stop="goToAutomations(e)">
                  <span v-html="iconSvgFor('refresh-cw')"></span> auto
                </button>
              </div>
              <span class="feed-time">{{ fmtTime(e.timestamp) }}</span>
            </div>
          </div>
        </template>
      </template>
    </div>

    <div v-if="popup" class="user-popup" :style="{ top: popup.y + 'px', left: popup.x + 'px' }" @click.stop>
      <div class="popup-header">
        <div class="popup-avatar-wrap">
          <img v-if="popupUser?.avatar" :src="popupUser.avatar" class="popup-avatar" />
          <div v-else class="popup-avatar-placeholder">
            {{ popup.entry.target[0]?.toUpperCase() }}
          </div>
        </div>
        <div class="popup-title-block">
          <div class="popup-name">
            {{ popupUser?.displayName ?? popup.entry.target }}
          </div>
          <div class="popup-sub">in #{{ popup.entry.channel }}</div>
        </div>
        <button class="popup-close" @click="closePopup" v-html="iconSvgFor('x')"></button>
      </div>

      <div class="popup-body">
        <div v-if="popupLoading" class="popup-loading">Loading…</div>
        <template v-else-if="popupUser">
          <div class="popup-stats">
            <div class="popup-stat">
              <span class="stat-val">{{ fmtJoined(popupUser.createdAt) }}</span>
              <span class="stat-lbl">account created</span>
            </div>
            <div v-if="popupUser.ownFollowers !== null" class="popup-stat">
              <span class="stat-val">{{
                fmtFollowers(popupUser.ownFollowers)
                }}</span>
              <span class="stat-lbl">followers</span>
            </div>
          </div>
          <div class="popup-relations">
            <div class="popup-rel" :class="popupUser.followedAt ? 'rel-yes' : 'rel-no'">
              <span class="rel-icon" v-html="iconSvgFor('heart')"></span>
              <span class="rel-label">
                <template v-if="popupUser.followedAt">Following for
                  {{ fmtDuration(popupUser.followedAt) }}</template>
                <template v-else>Not following</template>
              </span>
            </div>
            <div class="popup-rel" :class="popupUser.subbedSince ? 'rel-yes' : 'rel-no'">
              <span class="rel-icon" v-html="iconSvgFor('star')"></span>
              <span class="rel-label">
                <template v-if="popupUser.subbedSince">
                  {{ subTierLabel(popupUser.subTier ?? "1000") }} ·
                  {{ fmtDuration(popupUser.subbedSince) }}
                </template>
                <template v-else>Not subscribed</template>
              </span>
            </div>
          </div>

          <div v-if="popupUser?.paint" class="popup-paint">
            <div class="popup-paint-label">7TV Paint</div>
            <div class="popup-paint-display">
              <span class="popup-paint-name" :style="paintNameStyle(popupUser.paint)">{{ popupUser.paint.name }}</span>
            </div>
          </div>

          <div v-if="popupUser.nameHistory?.length" class="popup-names">
            <div class="popup-names-label">Previous names</div>
            <div v-for="n in popupUser.nameHistory" :key="n.name" class="popup-name-row">
              <span class="name-val">{{ n.name }}</span>
              <span v-if="n.lastSeen" class="name-when">{{ fmtDuration(n.lastSeen) }} ago</span>
            </div>
          </div>
        </template>
        <div v-else class="popup-loading" style="color: #555">
          Could not load profile.
        </div>
      </div>

      <div class="popup-actions">
        <button class="popup-btn" @click="
          goToLogs(popup.entry);
        closePopup();
        ">
          Logs
        </button>
        <button class="popup-btn" @click="openUsercardPopout(popup.entry.target, popup.entry.channel)">
          <span v-html="iconSvgFor('external-link')"></span> Twitch
        </button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.dash {
  display: flex;
  flex-direction: column;
  gap: 16px;
  height: 100%;
  position: relative;
}

.dash-header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
}

.dash-title {
  font-size: 18px;
  font-weight: 700;
  color: #e0e0e0;
  margin-bottom: 4px;
}

.dash-sub {
  font-size: 12px;
  color: #555;
  display: flex;
  align-items: center;
  gap: 6px;
}

.chan-select {
  background: #111217;
  border: 1px solid #2a2a30;
  color: #9d6cff;
  font-family: inherit;
  font-size: 12px;
  padding: 2px 6px;
  outline: none;
  cursor: pointer;
}

.chan-fixed {
  color: #9d6cff;
  font-weight: 600;
}

.dash-header-right {
  display: flex;
  align-items: center;
  gap: 10px;
}

.live-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  flex-shrink: 0;
}

.live-dot.live {
  background: #23d18b;
  box-shadow: 0 0 6px #23d18b88;
  animation: pulse-live 2s ease-in-out infinite;
}

.live-dot.connecting {
  background: #e5c07b;
}

.live-dot.off {
  background: #333;
}

@keyframes pulse-live {

  0%,
  100% {
    opacity: 1;
  }

  50% {
    opacity: 0.4;
  }
}

.feed-empty {
  color: #444;
  font-size: 13px;
  padding: 40px;
  text-align: center;
}

.feed-empty.err {
  color: #f14949;
}

.type-filters {
  display: flex;
  gap: 6px;
  align-items: center;
  padding: 2px 0 4px;
  flex-shrink: 0;
}

.group-chip {
  height: 26px;
  padding: 0 14px;
  border: 1px solid #2a2a30;
  background: transparent;
  color: #666;
  font-family: inherit;
  font-size: 11px;
  font-weight: 600;
  cursor: pointer;
  transition:
    color 0.15s,
    border-color 0.15s,
    background 0.15s;
}

.group-chip:hover {
  color: #ccc;
  border-color: #555;
}

.group-chip.active {
  color: #9d6cff;
  border-color: #6f2bff88;
  background: #6f2bff15;
}

.clear-chip {
  height: 22px;
  padding: 0 9px;
  border: 1px solid #222;
  background: transparent;
  color: #444;
  font-family: inherit;
  font-size: 10px;
  cursor: pointer;
  margin-left: 2px;
  transition: color 0.15s;
}

.clear-chip:hover {
  color: #aaa;
  border-color: #555;
}

.feed {
  display: flex;
  flex-direction: column;
  gap: 1px;
  overflow-y: auto;
  flex: 1;
  scrollbar-width: none;
}

.feed::-webkit-scrollbar {
  display: none;
}

/* >>> day header */
.feed-day-header {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 9px 14px;
  background: #0f0f13;
  border-top: 1px solid #1e1e22;
  border-bottom: 1px solid #1e1e22;
  cursor: pointer;
  user-select: none;
  position: sticky;
  top: 0;
  z-index: 2;
  transition: background 0.1s;
}

.feed-day-header:hover {
  background: #141418;
}

.feed-day-header:first-child {
  border-top: none;
}

.day-chevron {
  font-size: 9px;
  color: #444;
  width: 10px;
}

.day-label {
  font-size: 10px;
  color: #555;
  text-transform: uppercase;
  letter-spacing: 0.08em;
  flex: 1;
}

.day-count {
  font-size: 10px;
  color: #333;
  background: #1e1e24;
  padding: 1px 6px;
}

/* >>> feed rows */
.feed-row {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 8px 14px;
  background: #141418;
  border-bottom: 1px solid #1e1e1e;
  transition: background 0.1s;
}

.feed-skeleton-row {
  padding: 8px 14px;
  background: #141418;
}

.feed-row:hover {
  background: #1c1c20;
}

.feed-row:hover .feed-actions {
  opacity: 1;
}

.feed-icon {
  width: 24px;
  height: 24px;
  flex-shrink: 0;
  display: flex;
  align-items: center;
  justify-content: center;
}

.feed-icon svg {
  width: 10px;
  height: 10px;
}

.feed-body {
  flex: 1;
  display: flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
  flex-wrap: wrap;
}

.feed-type {
  font-size: 11px;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  flex-shrink: 0;
}

.feed-target {
  font-size: 12px;
  color: #e0e0e0;
  font-weight: 600;
}

.feed-target.mod-target {
  cursor: pointer;
  border-bottom: 1px dashed #444;
}

.feed-target.mod-target:hover {
  color: #9d6cff;
  border-bottom-color: #9d6cff;
}

.feed-by {
  font-size: 11px;
  color: #444;
}

.feed-detail {
  font-size: 11px;
  color: #555;
}

.feed-ch {
  font-size: 10px;
  color: #6f2bff;
  background: #6f2bff15;
  padding: 1px 5px;
}

.feed-right {
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  gap: 4px;
  flex-shrink: 0;
}

.feed-time {
  font-size: 10px;
  color: #444;
}

.feed-actions {
  display: flex;
  gap: 4px;
  opacity: 0;
  transition: opacity 0.15s;
}

.act-btn {
  height: 18px;
  padding: 0 7px;
  border: 1px solid #2a2a30;
  background: transparent;
  color: #555;
  font-family: inherit;
  font-size: 10px;
  cursor: pointer;
  transition:
    color 0.1s,
    border-color 0.1s;
}

.act-btn:hover {
  color: #9d6cff;
  border-color: #9d6cff44;
}

/* >>> user popup */
.user-popup {
  position: fixed;
  z-index: 100;
  background: #1b1b1f;
  border: 1px solid #2a2a30;
  width: 300px;
  box-shadow: 0 8px 32px #00000088;
  transform: translate(-50%, 12px);
  overflow: hidden;
}

.popup-header {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 12px 12px 10px;
  border-bottom: 1px solid #1e1e22;
}

.popup-avatar-wrap {
  flex-shrink: 0;
}

.popup-avatar {
  width: 40px;
  height: 40px;
  border-radius: 50%;
  display: block;
  border: 2px solid #2a2a30;
}

.popup-avatar-placeholder {
  width: 40px;
  height: 40px;
  border-radius: 50%;
  background: #2a1a55;
  border: 2px solid #6f2bff44;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 16px;
  font-weight: 700;
  color: #9d6cff;
}

.popup-title-block {
  flex: 1;
  min-width: 0;
}

.popup-name {
  font-size: 13px;
  font-weight: 700;
  color: #e0e0e0;
  margin-bottom: 2px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.popup-sub {
  font-size: 11px;
  color: #555;
}

.popup-close {
  background: none;
  border: none;
  color: #444;
  font-size: 13px;
  cursor: pointer;
  padding: 0 2px;
  line-height: 1;
  flex-shrink: 0;
}

.popup-close:hover {
  color: #aaa;
}

.popup-body {
  padding: 12px 14px;
  min-height: 72px;
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.popup-loading {
  font-size: 12px;
  color: #555;
  text-align: center;
  padding: 16px 0;
}

.popup-desc {
  font-size: 11px;
  color: #888;
  line-height: 1.5;
  max-height: 52px;
  overflow: hidden;
  display: -webkit-box;
  -webkit-line-clamp: 3;
  -webkit-box-orient: vertical;
}

.popup-stats {
  display: flex;
  gap: 20px;
}

.popup-stat {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.stat-val {
  font-size: 13px;
  font-weight: 700;
  color: #e0e0e0;
}

.stat-lbl {
  font-size: 10px;
  color: #555;
  text-transform: uppercase;
  letter-spacing: 0.05em;
}

.popup-relations {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.popup-rel {
  display: flex;
  align-items: center;
  gap: 7px;
  padding: 5px 8px;
  font-size: 12px;
}

.popup-rel.rel-yes {
  background: #1a2a1a;
  color: #23d18b;
}

.popup-rel.rel-no {
  background: #1e1e22;
  color: #444;
}

.rel-icon {
  font-size: 11px;
  flex-shrink: 0;
}

.rel-label {
  flex: 1;
}

.popup-names {
  display: flex;
  flex-direction: column;
  gap: 3px;
}

.popup-names-label {
  font-size: 10px;
  color: #555;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  margin-bottom: 2px;
}

.popup-name-row {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 3px 0;
  border-bottom: 1px solid #1e1e22;
}

.popup-name-row:last-child {
  border-bottom: none;
}

.name-val {
  font-size: 12px;
  color: #aaa;
}

.name-when {
  font-size: 10px;
  color: #444;
}

/* >>> 7tv paint */
.popup-paint {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.popup-paint-label {
  font-size: 10px;
  color: #555;
  text-transform: uppercase;
  letter-spacing: 0.05em;
}

.popup-paint-display {
  padding: 6px 8px;
  background: #111217;
  border: 1px solid #1e1e22;
}

.popup-paint-name {
  font-size: 14px;
  font-weight: 700;
  font-family: inherit;
}

.popup-actions {
  display: flex;
  gap: 1px;
  border-top: 1px solid #1e1e22;
}

.popup-btn {
  flex: 1;
  height: 32px;
  border: none;
  border-right: 1px solid #1e1e22;
  background: #141418;
  color: #888;
  font-family: inherit;
  font-size: 11px;
  cursor: pointer;
  transition:
    background 0.15s,
    color 0.15s;
}

.popup-btn:last-child {
  border-right: none;
}

.popup-btn:hover {
  background: #1e1e24;
  color: #9d6cff;
}

@media (max-width: 680px) {
  .dash-header {
    flex-wrap: wrap;
    gap: 8px;
  }

  .type-filters {
    flex-wrap: wrap;
  }

  .feed-body {
    font-size: 11px;
  }

  .feed-right {
    align-items: flex-end;
  }

  .user-popup {
    width: calc(100vw - 20px);
    transform: translate(-50%, 10px);
    left: 50% !important;
  }
}
</style>
