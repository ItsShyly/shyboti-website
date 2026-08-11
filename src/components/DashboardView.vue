<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted, watch } from "vue";
import { useRouter } from "vue-router";
import { API } from "../api";
import { useAuth } from "../auth";
import { useI18n } from "../i18n";

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
  | "timer_added"
  | "timer_changed"
  | "timer_removed"
  | "timer_enabled"
  | "timer_disabled"
  | "trigger_added"
  | "trigger_changed"
  | "trigger_removed"
  | "trigger_enabled"
  | "trigger_disabled";
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
const activeTypes = ref<Set<string>>(new Set());

// >>> Collapsed day groups - only today open by default
const collapsedDays = ref<Set<string>>(new Set());

// >>> User popup
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

let sseSource: EventSource | null = null;
// >>> fetchActivity()/startSSE() cross an await 
let disposed = false;

const TYPE_GROUPS = computed(() => [
  {
    label: t("dash.filter.commands"),
    types: ["cmd_added", "cmd_changed", "cmd_removed"] as const,
  },
  {
    label: t("dash.filter.moderation"),
    types: ["ban", "unban", "timeout"] as const,
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
    : activity.value.filter((e) => activeTypes.value.has(e.type)),
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
  // >>> Collapse all days except today
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
      // Ensure today is never collapsed when new entries arrive
      const todayLabel = fmtDate(Date.now());
      collapsedDays.value.delete(todayLabel);
    } catch { }
  };
}

// >>> Grouping & collapse
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

// vvv TYPE META vvv
const TYPE_META = computed(
  () =>
    ({
      cmd_added: { icon: "+", color: "#23d18b", label: t("type.cmd_added") },
      cmd_changed: {
        icon: "✎",
        color: "#e5c07b",
        label: t("type.cmd_changed"),
      },
      cmd_removed: {
        icon: "-",
        color: "#f14949",
        label: t("type.cmd_removed"),
      },
      ban: { icon: "⊘", color: "#f14949", label: t("type.ban") },
      unban: { icon: "✓", color: "#4ec9b0", label: t("type.unban") },
      timeout: { icon: "⏱", color: "#c792ea", label: t("type.timeout") },
      timer_added: {
        icon: "+",
        color: "#23d18b",
        label: t("type.timer_added"),
      },
      timer_changed: {
        icon: "✎",
        color: "#e5c07b",
        label: t("type.timer_changed"),
      },
      timer_removed: {
        icon: "-",
        color: "#f14949",
        label: t("type.timer_removed"),
      },
      timer_enabled: {
        icon: "▶",
        color: "#23d18b",
        label: t("type.timer_enabled"),
      },
      timer_disabled: {
        icon: "⏸",
        color: "#555555",
        label: t("type.timer_disabled"),
      },
      trigger_added: {
        icon: "+",
        color: "#4ec9b0",
        label: t("type.trigger_added"),
      },
      trigger_changed: {
        icon: "✎",
        color: "#e5c07b",
        label: t("type.trigger_changed"),
      },
      trigger_removed: {
        icon: "-",
        color: "#f14949",
        label: t("type.trigger_removed"),
      },
      trigger_enabled: {
        icon: "▶",
        color: "#4ec9b0",
        label: t("type.trigger_enabled"),
      },
      trigger_disabled: {
        icon: "⏸",
        color: "#555555",
        label: t("type.trigger_disabled"),
      },
    }) as Record<string, { icon: string; color: string; label: string }>,
);

// >>> Actions

// >>> Navigate to commands view and open the edit panel for this command
function goToCommand(e: ActivityEntry) {
  const name = e.target.replace(/^\+/, "");
  router.push({ path: "/commands", query: { edit: name } });
}

// >>> Open logs filtered to this user around the time of the event
function goToLogs(e: ActivityEntry) {
  const ch = e.channel;
  const user = e.target;
  router.push({ path: "/logs", query: { channel: ch, user } });
}

// >>> Navigate to automations for timer/trigger events
function goToAutomations(e: ActivityEntry) {
  const tab = e.type.startsWith("timer") ? "timers" : "triggers";
  router.push({ path: "/automations", query: { tab } });
}

// >>> Open user popup - works for any entry with a target username
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

// >>> How long ago an ISO date was, e.g. "2y 3m" or "4 months"
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

// >>> Build CSS style for a 7TV paint name display
function paintNameStyle(paint: {
  imageUrl: string | null;
  stops: { at: number; color: number }[];
  shadows: any[];
}): Record<string, string> {
  const styles: Record<string, string> = {};
  // Convert 7TV int32 color to rgba
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

// >>> Format detail nicely
function fmtDetail(e: ActivityEntry): string {
  if (e.type === "timeout" && e.detail) {
    const s = parseInt(e.detail);
    if (!isNaN(s)) {
      if (s >= 3600) return `${Math.round(s / 3600)}h timeout`;
      if (s >= 60) return `${Math.round(s / 60)}m timeout`;
      return `${s}s timeout`;
    }
  }
  return e.detail || "";
}

// >>> Actor display - 'mod' is generic (Twitch chat event, actor unknown), otherwise show name
function fmtActor(actor: string) {
  return actor === "mod"
    ? t("dash.filter.moderation") === "Moderation"
      ? "a mod"
      : "ein Mod"
    : actor;
}
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
        <button class="ep-btn-reload" @click="fetchActivity" title="Reload">↺</button>

      </div>
    </div>

    <!-- Type filter chips grouped -->
    <div class="type-filters">
      <button v-for="group in TYPE_GROUPS" :key="group.label" class="group-chip"
        :class="{ active: group.types.every((t) => activeTypes.has(t)) }" @click="toggleGroup(group.types)">
        {{ group.label }}
      </button>
      <button v-if="activeTypes.size > 0" class="clear-chip" @click="activeTypes = new Set()">
        {{ t("dash.filter.clear") }}
      </button>
    </div>

    <div v-if="error" class="feed-empty err">{{ error }}</div>
    <div v-else-if="loading && !activity.length" class="feed-empty">
      Loading…
    </div>
    <div v-else-if="!filteredActivity.length" class="feed-empty">
      {{ activity.length ? "No matching activity." : "No activity yet." }}
    </div>

    <div v-else class="feed">
      <template v-for="group in groupedActivity()" :key="group.date">
        <!-- Day header - clickable to collapse -->
        <div class="feed-day-header" @click.stop="toggleDay(group.date)">
          <span class="day-chevron">{{
            collapsedDays.has(group.date) ? "▶" : "▼"
          }}</span>
          <span class="day-label">{{ group.date }}</span>
          <span class="day-count">{{ group.entries.length }}</span>
        </div>

        <!-- Entries -->
        <template v-if="!collapsedDays.has(group.date)">
          <div v-for="e in group.entries" :key="e.id" class="feed-row">
            <div class="feed-icon" :style="{
              color: TYPE_META[e.type]?.color,
              borderColor: TYPE_META[e.type]?.color + '44',
            }">
              {{ TYPE_META[e.type]?.icon ?? "•" }}
            </div>

            <div class="feed-body">
              <span class="feed-type" :style="{ color: TYPE_META[e.type]?.color }">{{ TYPE_META[e.type]?.label }}</span>

              <!-- Target: clickable to open user popup -->
              <span class="feed-target" :class="{ 'mod-target': !!e.target }" @click.stop="
                e.target && openUserPopup(e.target, e.channel, $event)
                ">{{ e.target }}</span>

              <!-- by actor (only if not 'mod' for cmd events) -->
              <span class="feed-by" v-if="e.actor">by {{ fmtActor(e.actor) }}</span>

              <!-- detail (reason / duration) -->
              <span v-if="fmtDetail(e)" class="feed-detail">· {{ fmtDetail(e) }}</span>

              <span v-if="viewChannel === ALL_CHANNELS" class="feed-ch">#{{ e.channel }}</span>
            </div>

            <div class="feed-right">
              <!-- Action buttons -->
              <div class="feed-actions">
                <!-- Log link for ban/timeout/unban -->
                <button v-if="['ban', 'timeout', 'unban'].includes(e.type)" class="act-btn" title="View user logs"
                  @click.stop="goToLogs(e)">
                  logs
                </button>
                <!-- Edit command for cmd events -->
                <button v-if="
                  ['cmd_added', 'cmd_changed', 'cmd_removed'].includes(e.type)
                " class="act-btn" title="Edit command" @click.stop="goToCommand(e)">
                  edit
                </button>
                <!-- Go to automations for timer/trigger events -->
                <button v-if="
                  e.type.startsWith('timer') || e.type.startsWith('trigger')
                " class="act-btn" title="View in Automations" @click.stop="goToAutomations(e)">
                  ↻ auto
                </button>
              </div>
              <span class="feed-time">{{ fmtTime(e.timestamp) }}</span>
            </div>
          </div>
        </template>
      </template>
    </div>

    <!-- User popup -->
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
        <button class="popup-close" @click="closePopup">✕</button>
      </div>

      <!-- Profile body -->
      <div class="popup-body">
        <div v-if="popupLoading" class="popup-loading">Loading…</div>
        <template v-else-if="popupUser">
          <div class="popup-stats">
            <!-- Account age -->
            <div class="popup-stat">
              <span class="stat-val">{{ fmtJoined(popupUser.createdAt) }}</span>
              <span class="stat-lbl">account created</span>
            </div>
            <!-- Own channel followers -->
            <div v-if="popupUser.ownFollowers !== null" class="popup-stat">
              <span class="stat-val">{{
                fmtFollowers(popupUser.ownFollowers)
              }}</span>
              <span class="stat-lbl">followers</span>
            </div>
          </div>
          <!-- Follow / Sub relationship rows -->
          <div class="popup-relations">
            <div class="popup-rel" :class="popupUser.followedAt ? 'rel-yes' : 'rel-no'">
              <span class="rel-icon">{{
                popupUser.followedAt ? "♥" : "♥"
              }}</span>
              <span class="rel-label">
                <template v-if="popupUser.followedAt">Following for
                  {{ fmtDuration(popupUser.followedAt) }}</template>
                <template v-else>Not following</template>
              </span>
            </div>
            <div class="popup-rel" :class="popupUser.subbedSince ? 'rel-yes' : 'rel-no'">
              <span class="rel-icon">{{
                popupUser.subbedSince ? "★" : "★"
              }}</span>
              <span class="rel-label">
                <template v-if="popupUser.subbedSince">
                  {{ subTierLabel(popupUser.subTier ?? "1000") }} ·
                  {{ fmtDuration(popupUser.subbedSince) }}
                </template>
                <template v-else>Not subscribed</template>
              </span>
            </div>
          </div>

          <!-- Paint cosmetic -->
          <div v-if="popupUser?.paint" class="popup-paint">
            <div class="popup-paint-label">7TV Paint</div>
            <div class="popup-paint-display">
              <span class="popup-paint-name" :style="paintNameStyle(popupUser.paint)">{{ popupUser.paint.name }}</span>
            </div>
          </div>

          <!-- Name history -->
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
          ↗ Twitch
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
}

/* Day header */
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

/* Feed rows */
.feed-row {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 8px 14px;
  background: #141418;
  border-bottom: 1px solid #1e1e1e;
  transition: background 0.1s;
}

.feed-row:hover {
  background: #1c1c20;
}

.feed-row:hover .feed-actions {
  opacity: 1;
}

.feed-icon {
  width: 28px;
  height: 28px;
  flex-shrink: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 14px;
  border: 1px solid;
  font-weight: 700;
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

/* User popup */
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

/* 7TV Paint */
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
