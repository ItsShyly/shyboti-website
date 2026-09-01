<script setup lang="ts">
import {
  ref,
  computed,
  onMounted,
  onUnmounted,
  watch,
  nextTick,
  provide,
  type Ref,
} from "vue";
import { useRouter, useRoute } from "vue-router";
import { API } from "./api";
import { useAuth } from "./auth";
import { useI18n, useLocale, type Locale } from "./i18n";
import SnippetOverlay from "./components/SnippetOverlay.vue";
import { useLogsSearch } from "./composables/useLogsSearch";
import { iconSvg, ICONS } from "./composables/icons";

const {
  session,
  availableChannels,
  adminOnlyChannels,
  ownChannelHasBot,
  channelRole,
  adminMode,
  toggleAdminMode,
  restoreSession,
  switchChannel,
  logout,
  login,
} = useAuth();
const router = useRouter();
const route = useRoute();

// >>> fully standalone page, no dashboard chrome (own full-viewport styling)
// >>> on flaschenpost.shyboti.de every path (bare /<channel>) is this page
const isStandalonePage = computed(
  () =>
    route.path.startsWith("/flaschenpost/") ||
    window.location.hostname === "flaschenpost.shyboti.de",
);
const { t } = useI18n();
const { locale, setLocale } = useLocale();

const loginShaking = ref(false);
function shakeLogin() {
  if (loginShaking.value) return;
  loginShaking.value = true;
  setTimeout(() => (loginShaking.value = false), 600);
}

const showChannelMenu = ref(false);
const sidebarOpen = ref(false);

// >>> purple = viewing another channel
const viewingOtherChannel = computed(
  () => !!session.value && session.value.login !== session.value.channel,
);

// >>> red accent for admin mode on other channels
const viewingAsAdmin = computed(
  () =>
    !!session.value &&
    adminMode.value &&
    session.value.login !== session.value.channel,
);

// >>> hide admin-only channels unless admin mode on
const visibleChannels = computed(() =>
  adminMode.value
    ? availableChannels.value
    : availableChannels.value.filter(
      (c) => !adminOnlyChannels.value.includes(c),
    ),
);

function selectChannel(ch: string) {
  switchChannel(ch);
  showChannelMenu.value = false;
}

type NavItem =
  | "dashboard"
  | "commands"
  | "logs"
  | "moderation"
  | "roles"
  | "automations"
  | "twitch"
  | "uploads"
  | "tools"
  | "settings";
const activeRoute = computed(() => {
  return route.path.replace("/", "") || "dashboard";
});

function nav(to: NavItem) {
  const PUBLIC: NavItem[] = ["logs", "uploads"];
  if (!PUBLIC.includes(to) && !session.value) {
    shakeLogin();
    return;
  }
  sidebarOpen.value = false;
  router.push("/" + to);
}

// vvv universal search vvv

interface SearchResult {
  label: string;
  sub?: string;
  category: string;
  action: () => void;
  icon?: string;
}

const searchQuery = ref("");
const searchOpen = ref(false);
const searchInputDesktop = ref<HTMLInputElement | null>(null);
const searchInputMobile = ref<HTMLInputElement | null>(null);
const searchResults = ref<SearchResult[]>([]);

// vvv logs in-page search scope vvv
// >>> logs page scopes search to loaded messages
const {
  query: logsQuery,
  results: logsSearchResults,
  activeIndex: logsActiveIndex,
  matchCount: logsMatchCount,
  matchIndex: logsMatchIndex,
  requestJump: logsRequestJump,
  reset: logsSearchReset,
} = useLogsSearch();
const onLogsPage = computed(() => route.path.startsWith("/logs"));
const logsScopeDismissed = ref(false);
const showLogsChip = computed(
  () => onLogsPage.value && !logsScopeDismissed.value,
);

function dismissLogsChip() {
  logsScopeDismissed.value = true;
  logsSearchReset();
  if (searchQuery.value.trim()) runSearch(searchQuery.value);
}

watch(onLogsPage, (isLogs, wasLogs) => {
  if (isLogs === wasLogs) return;
  logsScopeDismissed.value = false;
  logsSearchReset();
  searchQuery.value = "";
  searchResults.value = [];
  searchOpen.value = false;
});

function focusSearch() {
  const desktop = searchInputDesktop.value;
  const mobile = searchInputMobile.value;
  // >>> offsetParent tells us which input is visible
  if (desktop && desktop.offsetParent !== null) {
    desktop.focus();
    desktop.select();
  } else if (mobile) {
    mobile.focus();
    mobile.select();
  }
}
const searchIndex = ref(0);
let searchDebounce: ReturnType<typeof setTimeout> | null = null;

function buildStaticIndex(): SearchResult[] {
  const items: SearchResult[] = [
    {
      label: "Dashboard",
      category: "Page",
      icon: "dot",
      action: () => router.push("/dashboard"),
    },
    {
      label: "Commands",
      category: "Page",
      icon: "dot",
      action: () => router.push("/commands"),
    },
    {
      label: "Moderation",
      category: "Page",
      icon: "dot",
      action: () => router.push("/moderation"),
    },
    {
      label: "Automations",
      category: "Page",
      icon: "dot",
      action: () => router.push("/automations"),
    },
    {
      label: "Twitch",
      category: "Page",
      icon: "dot",
      action: () => router.push("/twitch"),
    },
    {
      label: "Channel Points",
      category: "Page",
      icon: "dot",
      action: () => router.push("/twitch"),
      sub: "Twitch → Channel Points",
    },
    {
      label: "Timers",
      category: "Page",
      icon: "dot",
      action: () => router.push("/automations?tab=timers"),
      sub: "Automations → Timers",
    },
    {
      label: "Triggers",
      category: "Page",
      icon: "dot",
      action: () => router.push("/automations?tab=triggers"),
      sub: "Automations → Triggers",
    },
    {
      label: "Countdowns",
      category: "Page",
      icon: "dot",
      action: () => router.push("/automations?tab=countdowns"),
      sub: "Automations → Countdowns",
    },
    {
      label: "Roles",
      category: "Page",
      icon: "dot",
      action: () => router.push("/roles"),
    },
    {
      label: "Logs",
      category: "Page",
      icon: "dot",
      action: () => router.push("/logs"),
    },
    {
      label: "Uploads",
      category: "Page",
      icon: "dot",
      action: () => router.push("/uploads"),
    },
    {
      label: "Tools",
      category: "Page",
      icon: "dot",
      action: () => router.push("/tools"),
    },
    {
      label: "Settings",
      category: "Page",
      icon: "dot",
      action: () => router.push("/settings"),
    },
    {
      label: "Images",
      category: "Uploads",
      icon: "image",
      action: () => router.push("/images"),
      sub: "Upload and host images",
    },
    {
      label: "Notes",
      category: "Uploads",
      icon: "file-text",
      action: () => router.push("/notes"),
      sub: "Create and share text snippets",
    },
    {
      label: "OBS Widgets",
      category: "Tools",
      icon: "monitor",
      action: () => router.push("/obs-widgets"),
      sub: "Simple browser sources for OBS containing text and/or Variables",
    },
    {
      label: "OBS Control",
      category: "Tools",
      icon: "monitor",
      action: () => router.push("/obs-control"),
      sub: "Switch scenes and control sources live",
    },
    {
      label: "Variables & Counters",
      category: "Tools",
      icon: "settings",
      action: () => router.push("/tools"),
      sub: "View and edit $counter and $var values",
    },
    {
      label: "Command Prefix",
      category: "Settings",
      icon: "settings",
      action: () => router.push("/settings"),
      sub: "Change the bot command prefix",
    },
    {
      label: "Logs Opt-Out",
      category: "Settings",
      icon: "settings",
      action: () => router.push("/settings"),
      sub: "Control chat log visibility",
    },
    {
      label: "Remove Bot",
      category: "Settings",
      icon: "settings",
      action: () => router.push("/settings"),
      sub: "Remove ShyBoti from your channel",
    },
    {
      label: "Custom Commands",
      category: "Commands",
      icon: "+",
      action: () => {
        router.push("/commands");
        nextActiveTab.value = "Custom";
      },
      sub: "Your custom +commands",
    },
    {
      label: "New Command",
      category: "Commands",
      icon: "+",
      action: () => {
        router.push("/commands");
        nextActiveTab.value = "Custom";
      },
      sub: "Create a new command",
    },
  ];

  // >>> hide personal content from search too
  let result = items;
  if (viewingOtherChannel.value) {
    result = result.filter(
      (i) => !["Uploads", "Images", "Notes"].includes(i.label),
    );
  }
  // >>> keep search in sync with route block
  if (adminMode.value && viewingOtherChannel.value) {
    result = result.filter((i) => i.label !== "OBS Control");
  }
  return result;
}

// >>> picks the tab to open after nav
const nextActiveTab = ref("");

let _dynamicCache: SearchResult[] | null = null;
async function loadDynamic(): Promise<SearchResult[]> {
  if (_dynamicCache) return _dynamicCache;
  if (!session.value) return [];
  const results: SearchResult[] = [];
  try {
    const [cmdRes, timerRes, trigRes] = await Promise.allSettled([
      fetch(`${API}/commands/${session.value.channel}`, {
        headers: { Authorization: `Bearer ${session.value.token}` },
      }),
      fetch(`${API}/timers/${session.value.channel}`, {
        headers: { Authorization: `Bearer ${session.value.token}` },
      }),
      fetch(`${API}/triggers/${session.value.channel}`, {
        headers: { Authorization: `Bearer ${session.value.token}` },
      }),
    ]);
    if (cmdRes.status === "fulfilled" && cmdRes.value.ok) {
      const d = (await cmdRes.value.json()) as {
        commands: { name: string; description: string }[];
        prefix: string;
      };
      for (const c of d.commands) {
        const cmdName = c.name;
        results.push({
          label: `${d.prefix}${cmdName}`,
          category: "Command",
          icon: "+",
          sub: c.description || undefined,
          action: () => {
            router.push("/commands").then(() => {
              setTimeout(() => {
                searchOpenEdit.value = { name: cmdName, builtIn: true };
              }, 50);
            });
          },
        });
      }
    }
    if (timerRes.status === "fulfilled" && timerRes.value.ok) {
      const d = (await timerRes.value.json()) as {
        timers: { name: string; response: string }[];
      };
      for (const ti of d.timers) {
        const name = ti.name;
        results.push({
          label: name,
          category: "Timer",
          icon: "clock",
          sub: ti.response.slice(0, 50) || undefined,
          action: () => {
            router.push("/automations?tab=timers");
            nextTick(() => {
              searchOpenTimer.value = name;
            });
          },
        });
      }
    }
    if (trigRes.status === "fulfilled" && trigRes.value.ok) {
      const d = (await trigRes.value.json()) as {
        triggers: { name: string; match_pattern: string }[];
      };
      for (const tr of d.triggers) {
        const name = tr.name;
        results.push({
          label: name,
          category: "Trigger",
          icon: "zap",
          sub: tr.match_pattern || undefined,
          action: () => {
            router.push("/automations?tab=triggers");
            nextTick(() => {
              searchOpenTrigger.value = name;
            });
          },
        });
      }
    }
    // >>> custom commands need a separate fetch
    const ccRes = await fetch(
      `${API}/custom-commands/${session.value.channel}`,
      { headers: { Authorization: `Bearer ${session.value.token}` } },
    );
    if (ccRes.ok) {
      const d = (await ccRes.json()) as {
        commands: { name: string; description?: string; response?: string }[];
      };
      for (const c of d.commands ?? []) {
        const ccName = c.name;
        results.push({
          label: `+${ccName}`,
          category: "Custom Command",
          icon: "+",
          sub: c.description || c.response?.slice(0, 50) || undefined,
          action: () => {
            router.push("/commands").then(() => {
              setTimeout(() => {
                searchOpenEdit.value = { name: ccName, builtIn: false };
              }, 50);
            });
          },
        });
      }
    }
  } catch { }
  _dynamicCache = results;
  return results;
}

// >>> reset cache on channel switch
watch(
  () => session.value?.channel,
  () => {
    _dynamicCache = null;
  },
);

async function runSearch(q: string) {
  if (!q.trim()) {
    searchResults.value = [];
    searchIndex.value = 0;
    return;
  }
  const query = q.toLowerCase().trim();
  const static_ = buildStaticIndex();
  const dynamic = await loadDynamic();
  const all = [...static_, ...dynamic];
  const scored = all
    .map((item) => {
      const label = item.label.toLowerCase();
      const sub = (item.sub ?? "").toLowerCase();
      let score = 0;
      if (label === query) score = 100;
      else if (label.startsWith(query)) score = 80;
      else if (label.includes(query)) score = 60;
      else if (sub.includes(query)) score = 30;
      else return null;
      return { item, score };
    })
    .filter(Boolean)
    .sort((a, b) => b!.score - a!.score)
    .slice(0, 12)
    .map((x) => x!.item);
  searchResults.value = scored;
  searchIndex.value = 0;
}

function onSearchInput() {
  if (showLogsChip.value) {
    // >>> logs mode skips the global search index
    logsQuery.value = searchQuery.value;
    searchOpen.value = true;
    searchResults.value = [];
    return;
  }
  searchOpen.value = true;
  if (searchDebounce) clearTimeout(searchDebounce);
  searchDebounce = setTimeout(() => runSearch(searchQuery.value), 120);
}

function onSearchKeydown(e: KeyboardEvent) {
  if (showLogsChip.value) {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      if (!logsSearchResults.value.length) return;
      logsActiveIndex.value = Math.min(
        logsActiveIndex.value + 1,
        logsSearchResults.value.length - 1,
      );
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      if (!logsSearchResults.value.length) return;
      logsActiveIndex.value = Math.max(logsActiveIndex.value - 1, 0);
    } else if (e.key === "Enter") {
      e.preventDefault();
      const target = logsSearchResults.value[logsActiveIndex.value];
      if (target) logsRequestJump(target.id);
    } else if (e.key === "Escape") {
      searchQuery.value = "";
      logsQuery.value = "";
      searchInputDesktop.value?.blur();
      searchInputMobile.value?.blur();
    }
    return;
  }
  if (!searchOpen.value || !searchResults.value.length) {
    if (e.key === "Escape") {
      searchQuery.value = "";
      searchOpen.value = false;
      searchInputDesktop.value?.blur();
      searchInputMobile.value?.blur();
    }
    return;
  }
  if (e.key === "ArrowDown") {
    e.preventDefault();
    searchIndex.value = Math.min(
      searchIndex.value + 1,
      searchResults.value.length - 1,
    );
  }
  if (e.key === "ArrowUp") {
    e.preventDefault();
    searchIndex.value = Math.max(searchIndex.value - 1, 0);
  }
  if (e.key === "Enter") {
    e.preventDefault();
    selectResult(searchResults.value[searchIndex.value]!);
  }
  if (e.key === "Escape") {
    searchQuery.value = "";
    searchOpen.value = false;
    searchInputDesktop.value?.blur();
    searchInputMobile.value?.blur();
  }
}

function selectResult(r: SearchResult) {
  searchQuery.value = "";
  searchOpen.value = false;
  searchInputDesktop.value?.blur();
  searchInputMobile.value?.blur();
  searchResults.value = [];
  r.action();
}

function selectLogsResult(r: { id: string; label: string; sub: string }) {
  logsRequestJump(r.id);
  searchOpen.value = false;
  searchInputDesktop.value?.blur();
  searchInputMobile.value?.blur();
}

function onSearchFocus() {
  if (showLogsChip.value) return;
  searchOpen.value = true;
  if (searchQuery.value) runSearch(searchQuery.value);
}
function onSearchBlur() {
  setTimeout(() => {
    searchOpen.value = false;
  }, 150);
}

// >>> ctrl+f focuses search
function onGlobalKeydown(e: KeyboardEvent) {
  if ((e.ctrlKey || e.metaKey) && e.key === "f") {
    // >>> don't steal focus if already typing somewhere
    const tag = (document.activeElement as HTMLElement)?.tagName;
    const isEditable = (document.activeElement as HTMLElement)
      ?.isContentEditable;
    if (tag === "TEXTAREA" || tag === "INPUT" || isEditable) return;
    e.preventDefault();
    focusSearch();
  }
}

onMounted(() => {
  document.addEventListener("keydown", onGlobalKeydown);
});
onUnmounted(() => {
  document.removeEventListener("keydown", onGlobalKeydown);
});

const groupedResults = computed(() => {
  const groups: Record<string, SearchResult[]> = {};
  for (const r of searchResults.value) {
    if (!groups[r.category]) groups[r.category] = [];
    groups[r.category]!.push(r);
  }
  return groups;
});

const flatResults = computed(() => searchResults.value);

const showAddBanner = ref(false);
const reAuthUrl = ref<string | null>(null);
const toast = ref("");

// vvv scope re-auth banner vvv
// >>> re-auth link authorizes the clicker, not the broadcaster
const missingScopes = ref<string[]>([]);
const isOwnChannel = computed(
  () => !!session.value && session.value.login === session.value.channel,
);
async function loadScopeStatus() {
  if (!session.value) {
    missingScopes.value = [];
    return;
  }
  try {
    const res = await fetch(
      `${API}/auth/scope-status/${session.value.channel}`,
      { headers: { Authorization: `Bearer ${session.value.token}` } },
    );
    if (!res.ok) {
      missingScopes.value = [];
      return;
    }
    const d = (await res.json()) as { missingScopes: string[] };
    missingScopes.value = d.missingScopes ?? [];
  } catch {
    missingScopes.value = [];
  }
}
watch(
  () => session.value?.channel,
  () => loadScopeStatus(),
);
// ^^^ scope re-auth banner ^^^

// vvv bot re-auth banner (admin only) vvv
async function loadBotReauthStatus() {
  if (!session.value?.isAdmin) {
    reAuthUrl.value = null;
    return;
  }
  try {
    const res = await fetch(`${API}/auth/reauth-status`);
    if (!res.ok) {
      reAuthUrl.value = null;
      return;
    }
    const d = (await res.json()) as { reAuthUrl: string | null };
    reAuthUrl.value = d.reAuthUrl;
  } catch {
    reAuthUrl.value = null;
  }
}
watch(
  () => session.value?.isAdmin,
  () => loadBotReauthStatus(),
);
// ^^^ bot re-auth banner ^^^
function showToast(msg: string) {
  toast.value = msg;
  setTimeout(() => (toast.value = ""), 5000);
}

onMounted(async () => {
  const params = new URLSearchParams(window.location.search);
  const token =
    params.get("token") ?? localStorage.getItem("shyboti_token") ?? null;
  const status = params.get("status");
  const channel = params.get("channel");

  if (params.has("token") || params.has("status"))
    window.history.replaceState({}, "", window.location.pathname);

  if (token) await restoreSession(token);

  if (status === "loggedin" && channel) {
    showToast(`Logged in as ${channel}`);
    showAddBanner.value = !ownChannelHasBot.value;
    router.push("/dashboard");
  } else if (status === "added" && channel) {
    showToast(`ShyBoti added to #${channel}`);
    router.push("/dashboard");
  } else if (status === "reauthed" && channel) {
    showToast(`Re-authorized #${channel}`);
    router.push("/dashboard");
  } else if (status === "removed" && channel) {
    showToast(`ShyBoti left #${channel}`);
  }

  // >>> route.path can still be the router's stale "/" default here since
  // >>> main.ts doesn't await router.isReady() before mount - wait for the
  // >>> real initial navigation to resolve before trusting this path check
  await router.isReady();
  if (route.path === "/" || route.path === "") {
    router.push(session.value ? "/dashboard" : "/");
  }
});

function addBot() {
  window.location.href = `${API}/auth/add`;
}

// >>> keepalive dodges a vue router crash bug
const KEEP_ALIVE_ROUTES = ["LogsView", "AutomationsView"];

provide("nextActiveTab", nextActiveTab);

// >>> shared so overlay knows what to capture
const mainPanelRef = ref<HTMLElement | null>(null);
provide("mainPanelRef", mainPanelRef);

// >>> opens a command's edit panel from search
const searchOpenEdit = ref<{ name: string; builtIn: boolean } | null>(null);
provide("searchOpenEdit", searchOpenEdit);

// >>> same idea for timers/triggers
const searchOpenTimer = ref<string | null>(null);
const searchOpenTrigger = ref<string | null>(null);
provide("searchOpenTimer", searchOpenTimer);
provide("searchOpenTrigger", searchOpenTrigger);

</script>

<template>
  <RouterView v-if="isStandalonePage" />
  <div v-else class="page">
    <div class="topbar" :class="{ 'other-channel': viewingOtherChannel, 'admin-channel': viewingAsAdmin }">
      <div class="topbar-brand" @click="session ? router.push('/dashboard') : router.push('/')" style="cursor: pointer">
        <img src="/loading.gif" alt="shy" class="brand-emote" />
        <span class="brand-name">ShyBoti</span>
      </div>

      <!-- >>> universal search bar, desktop only -->
      <div class="search-wrap hide-mobile" :class="{
        open: searchOpen && searchResults.length > 0,
        'has-chip': showLogsChip,
      }">
        <svg v-if="!showLogsChip" class="search-icon" viewBox="0 0 16 16" fill="none"
          xmlns="http://www.w3.org/2000/svg">
          <circle cx="7" cy="7" r="4.5" stroke="currentColor" stroke-width="1.5" />
          <path d="M10.5 10.5L14 14" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" />
        </svg>
        <span v-if="showLogsChip" class="search-scope-chip">
          in logs
          <button class="chip-x" @mousedown.prevent="dismissLogsChip" title="Search everywhere instead">
            <span v-html="iconSvg('x')"></span>
          </button>
        </span>
        <input ref="searchInputDesktop" v-model="searchQuery" class="search-input" :placeholder="showLogsChip ? 'Find in loaded messages…' : 'Search… (Ctrl+F)'
          " @input="onSearchInput" @keydown="onSearchKeydown" @focus="onSearchFocus" @blur="onSearchBlur"
          autocomplete="off" spellcheck="false" />
        <span v-if="showLogsChip && logsQuery" class="search-match-nav">
          <span class="search-match-count">{{
            logsMatchCount ? `${logsMatchIndex}/${logsMatchCount}` : "0 matches"
          }}</span>
          <button v-if="logsMatchCount" class="search-match-step" title="Previous match (Shift+Enter)"
            @mousedown.prevent="logsRequestJump(-1)">
            <span v-html="iconSvg('chevron-up')"></span>
          </button>
          <button v-if="logsMatchCount" class="search-match-step" title="Next match (Enter)"
            @mousedown.prevent="logsRequestJump(1)">
            <span v-html="iconSvg('chevron-down')"></span>
          </button>
        </span>
        <kbd v-if="!searchQuery && !showLogsChip" class="search-kbd">Ctrl+F</kbd>
        <button v-if="searchQuery" class="search-clear" @mousedown.prevent="
          searchQuery = '';
        logsQuery = '';
        searchResults = [];
        searchOpen = false;
        ">
          <span v-html="iconSvg('x')"></span>
        </button>

        <!-- >>> results dropdown -->
        <div v-if="showLogsChip && searchOpen && logsSearchResults.length > 0" class="search-results">
          <div class="result-group-label">Messages</div>
          <button v-for="(r, idx) in logsSearchResults" :key="r.id" class="result-item"
            :class="{ active: logsActiveIndex === idx }" @mousedown.prevent="selectLogsResult(r)">
            <span class="result-label">{{ r.label }}</span>
            <span v-if="r.sub" class="result-sub">{{ r.sub }}</span>
          </button>
        </div>
        <div v-else-if="
          showLogsChip &&
          searchOpen &&
          searchQuery.trim() &&
          !logsSearchResults.length
        " class="search-results search-empty">
          No matching messages in the loaded logs
        </div>
        <div v-else-if="!showLogsChip && searchOpen && flatResults.length > 0" class="search-results">
          <template v-for="(items, category) in groupedResults" :key="category">
            <div class="result-group-label">{{ category }}</div>
            <button v-for="(r, idx) in items" :key="r.label + idx" class="result-item"
              :class="{ active: flatResults.indexOf(r) === searchIndex }" @mousedown.prevent="selectResult(r)">
              <span v-if="r.icon && r.icon in ICONS" class="result-icon" v-html="iconSvg(r.icon)"></span>
              <span v-else class="result-icon">{{ r.icon }}</span>
              <span class="result-label">{{ r.label }}</span>
              <span v-if="r.sub" class="result-sub">{{ r.sub }}</span>
            </button>
          </template>
        </div>
        <div v-else-if="
          !showLogsChip &&
          searchOpen &&
          searchQuery.trim() &&
          !flatResults.length
        " class="search-results search-empty">
          No results for "{{ searchQuery }}"
        </div>
      </div>

      <div class="topbar-right">
        <div class="lang-switcher">
          <button class="lang-opt" :class="{ active: locale === 'en' }" @click="setLocale('en')">
            EN
          </button>
          <span class="lang-sep">|</span>
          <button class="lang-opt" :class="{ active: locale === 'de' }" @click="setLocale('de')">
            DE
          </button>
        </div>
        <template v-if="session">
          <div class="channel-switcher" v-if="visibleChannels.length > 1">
            <div class="channel-btn-wrap"
              :class="{ 'other-channel': viewingOtherChannel, 'admin-channel': viewingAsAdmin }">
              <button class="channel-btn"
                :class="{ 'other-channel': viewingOtherChannel, 'admin-channel': viewingAsAdmin }"
                @click="showChannelMenu = !showChannelMenu">
                #{{ session.channel }}
                <span class="channel-btn-caret" v-html="iconSvg('chevron-down')"></span>
              </button>
            </div>
            <div v-if="showChannelMenu" class="channel-menu">
              <button v-for="ch in visibleChannels" :key="ch" class="channel-menu-item"
                :class="{ active: ch === session.channel, 'admin-channel': adminMode && ch !== session.login }"
                @click="selectChannel(ch)">
                #{{ ch }}
              </button>
            </div>
          </div>
          <span v-else class="logged-in-as hide-mobile"
            :class="{ 'other-channel': viewingOtherChannel, 'admin-channel': viewingAsAdmin }">#{{
              session.channel }}</span>
          <button class="auth-btn logout-btn hide-mobile" @click="
            logout();
          router.push('/');
          ">
            {{ t("nav.logout") }}
          </button>
        </template>
        <button v-else class="auth-btn login-btn" :class="{ shake: loginShaking }" @click="login">
          <span class="hide-mobile">{{ t("nav.login") }}</span>
          <span class="show-mobile">{{ t("nav.login_short") }}</span>
        </button>
        <button class="hamburger show-mobile" @click="sidebarOpen = !sidebarOpen" :class="{ open: sidebarOpen }">
          <span></span><span></span><span></span>
        </button>
      </div>
    </div>

    <div v-if="session && showAddBanner" class="add-banner">
      <span class="banner-icon" v-html="iconSvg('smile')"></span>
      <span>{{ t("banner.welcome") }}</span>
      <div class="banner-actions">
        <button class="banner-btn add" @click="addBot">
          + {{ t("banner.add") }}
        </button>
        <button class="banner-dismiss" @click="showAddBanner = false"><span v-html="iconSvg('x')"></span></button>
      </div>
    </div>

    <div v-if="session && missingScopes.length > 0" class="add-banner reauth-banner">
      <span class="banner-icon" v-html="iconSvg('alert-triangle')"></span>
      <span>{{ isOwnChannel ? t("banner.reauth_own") : t("banner.reauth_other") }}</span>
      <div class="banner-actions">
        <a v-if="isOwnChannel" :href="`${API}/auth/add`" class="banner-btn reauth">
          {{ t("banner.reauth_btn") }}
        </a>
      </div>
    </div>

    <div v-if="session?.isAdmin && reAuthUrl" class="add-banner reauth-banner">
      <span class="banner-icon" v-html="iconSvg('alert-triangle')"></span>
      <span>{{ t("banner.bot_reauth") }}</span>
      <div class="banner-actions">
        <a :href="reAuthUrl" class="banner-btn reauth">
          {{ t("banner.reauth_btn") }}
        </a>
      </div>
    </div>

    <div class="body">
      <div v-if="sidebarOpen" class="sidebar-overlay" @click="sidebarOpen = false"></div>

      <aside class="sidebar" :class="{ 'sidebar-open': sidebarOpen }">
        <div class="sidebar-mobile-header show-mobile">
          <template v-if="session">
            <span class="sidebar-user">#{{ session.channel }}</span>
            <button class="sidebar-logout" @click="
              logout();
            router.push('/');
            sidebarOpen = false;
            ">
              {{ t("nav.logout") }}
            </button>
          </template>
        </div>

        <!-- >>> search bar inside sidebar, mobile only -->
        <div class="sidebar-search show-mobile" :class="{
          open: searchOpen && searchResults.length > 0,
          'has-chip': showLogsChip,
        }">
          <svg v-if="!showLogsChip" class="search-icon" viewBox="0 0 16 16" fill="none"
            xmlns="http://www.w3.org/2000/svg">
            <circle cx="7" cy="7" r="4.5" stroke="currentColor" stroke-width="1.5" />
            <path d="M10.5 10.5L14 14" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" />
          </svg>
          <span v-if="showLogsChip" class="search-scope-chip">
            in logs
            <button class="chip-x" @mousedown.prevent="dismissLogsChip" title="Search everywhere instead">
              <span v-html="iconSvg('x')"></span>
            </button>
          </span>
          <input ref="searchInputMobile" v-model="searchQuery" class="search-input"
            :placeholder="showLogsChip ? 'Find in loaded messages…' : 'Search…'" @input="onSearchInput"
            @keydown="onSearchKeydown" @focus="onSearchFocus" @blur="onSearchBlur" autocomplete="off"
            spellcheck="false" />
          <span v-if="showLogsChip && logsQuery" class="search-match-nav">
            <span class="search-match-count">{{
              logsMatchCount ? `${logsMatchIndex}/${logsMatchCount}` : "0"
            }}</span>
            <button v-if="logsMatchCount" class="search-match-step" title="Previous match"
              @mousedown.prevent="logsRequestJump(-1)">
              <span v-html="iconSvg('chevron-up')"></span>
            </button>
            <button v-if="logsMatchCount" class="search-match-step" title="Next match"
              @mousedown.prevent="logsRequestJump(1)">
              <span v-html="iconSvg('chevron-down')"></span>
            </button>
          </span>
          <button v-if="searchQuery" class="search-clear" @mousedown.prevent="
            searchQuery = '';
          logsQuery = '';
          searchResults = [];
          searchOpen = false;
          ">
            <span v-html="iconSvg('x')"></span>
          </button>
          <!-- >>> results dropdown -->
          <div v-if="showLogsChip && searchOpen && logsSearchResults.length > 0" class="search-results">
            <div class="result-group-label">Messages</div>
            <button v-for="(r, idx) in logsSearchResults" :key="r.id" class="result-item"
              :class="{ active: logsActiveIndex === idx }" @mousedown.prevent="
                selectLogsResult(r);
              sidebarOpen = false;
              ">
              <span class="result-label">{{ r.label }}</span>
              <span v-if="r.sub" class="result-sub">{{ r.sub }}</span>
            </button>
          </div>
          <div v-else-if="
            showLogsChip &&
            searchOpen &&
            searchQuery.trim() &&
            !logsSearchResults.length
          " class="search-results search-empty">
            No matching messages in the loaded logs
          </div>
          <div v-else-if="!showLogsChip && searchOpen && flatResults.length > 0" class="search-results">
            <template v-for="(items, category) in groupedResults" :key="category">
              <div class="result-group-label">{{ category }}</div>
              <button v-for="(r, idx) in items" :key="r.label + idx" class="result-item"
                :class="{ active: flatResults.indexOf(r) === searchIndex }" @mousedown.prevent="
                  selectResult(r);
                sidebarOpen = false;
                ">
                <span v-if="r.icon && r.icon in ICONS" class="result-icon" v-html="iconSvg(r.icon)"></span>
                <span v-else class="result-icon">{{ r.icon }}</span>
                <span class="result-label">{{ r.label }}</span>
                <span v-if="r.sub" class="result-sub">{{ r.sub }}</span>
              </button>
            </template>
          </div>
          <div v-else-if="
            !showLogsChip &&
            searchOpen &&
            searchQuery.trim() &&
            !flatResults.length
          " class="search-results search-empty">
            No results for "{{ searchQuery }}"
          </div>
        </div>

        <button class="sidebar-btn" :class="{ active: activeRoute === 'dashboard', locked: !session }"
          @click="nav('dashboard')">
          {{ t("nav.dashboard") }}
          <span v-if="!session" class="lock-icon" v-html="iconSvg('lock')"></span>
        </button>
        <button class="sidebar-btn" :class="{ active: activeRoute === 'commands', locked: !session }"
          @click="nav('commands')">
          {{ t("nav.commands") }}
          <span v-if="!session" class="lock-icon" v-html="iconSvg('lock')"></span>
        </button>
        <button class="sidebar-btn" :class="{ active: activeRoute === 'moderation', locked: !session }"
          @click="nav('moderation')">
          {{ t("nav.moderation") }}
          <span v-if="!session" class="lock-icon" v-html="iconSvg('lock')"></span>
        </button>
        <button class="sidebar-btn" :class="{ active: activeRoute === 'automations', locked: !session }"
          @click="nav('automations')">
          {{ t("nav.automations") }}
          <span v-if="!session" class="lock-icon" v-html="iconSvg('lock')"></span>
        </button>
        <button class="sidebar-btn" :class="{ active: activeRoute === 'twitch', locked: !session }"
          @click="nav('twitch')">
          {{ t("nav.twitch") }}
          <span v-if="!session" class="lock-icon" v-html="iconSvg('lock')"></span>
        </button>
        <button v-if="!session || channelRole?.role === 'broadcaster' || (session.isAdmin && adminMode)"
          class="sidebar-btn" :class="{ active: activeRoute === 'roles', locked: !session }" @click="nav('roles')">
          {{ t("nav.roles") }} <span v-if="!session" class="lock-icon" v-html="iconSvg('lock')"></span>
        </button>
        <button class="sidebar-btn" :class="{ active: activeRoute === 'tools', locked: !session }"
          @click="nav('tools')">
          Tools <span v-if="!session" class="lock-icon" v-html="iconSvg('lock')"></span>
        </button>

        <div class="sidebar-divider"></div>

        <button class="sidebar-btn" :class="{ active: activeRoute === 'logs' }" @click="nav('logs')">
          {{ t("nav.logs") }}
        </button>
        <button v-if="!viewingOtherChannel" class="sidebar-btn" :class="{ active: activeRoute === 'uploads' }"
          @click="nav('uploads')">
          Uploads
        </button>

        <div class="sidebar-spacer"></div>

        <button v-if="session?.isAdmin" class="sidebar-btn admin-nav-btn" :class="{ active: adminMode }"
          @click="router.push('/admin')">
          {{ t("nav.admin") }}
          <span class="ep-switch admin-mode-switch" :class="{ on: adminMode }" @click.stop="toggleAdminMode()">
            <span class="ep-switch-knob"></span>
          </span>
        </button>
        <button v-if="!session || channelRole?.role === 'broadcaster' || (session.isAdmin && adminMode)"
          class="sidebar-btn" :class="{ active: activeRoute === 'settings', locked: !session }"
          @click="nav('settings')">
          {{ t("nav.settings") }}
          <span v-if="!session" class="lock-icon" v-html="iconSvg('lock')"></span>
        </button>
        <div v-if="session && !ownChannelHasBot" class="sidebar-bottom">
          <button class="bot-btn add" @click="addBot">
            + {{ t("nav.add_channel") }}
          </button>
        </div>
      </aside>

      <main class="main-panel" ref="mainPanelRef">
        <SnippetOverlay />
        <RouterView v-slot="{ Component }">
          <KeepAlive :include="KEEP_ALIVE_ROUTES">
            <component :is="Component" />
          </KeepAlive>
        </RouterView>
        <footer class="site-footer">
          {{ t("footer.copy") }}
          <span class="footer-sep">|</span>
          <router-link to="/privacy" class="footer-link">{{
            t("footer.privacy")
          }}</router-link>
        </footer>
      </main>
    </div>
    <span v-if="toast" class="toast toast-float"><span class="toast-icon" v-html="iconSvg('check')"></span>{{ toast
    }}</span>
  </div>
</template>

<style>
@font-face {
  font-family: "JetBrains Mono";
  font-style: normal;
  font-weight: 400 700;
  font-display: swap;
  src: url("/fonts/jetbrains-mono.woff2") format("woff2");
}

*,
*::before,
*::after {
  box-sizing: border-box;
  margin: 0;
  padding: 0;
}

html,
body {
  height: 100%;
  overflow: hidden;
}

body {
  background: #0e0e12;
  color: #fff;
  font-family: "JetBrains Mono", monospace;
  font-size: 13px;
}

.page {
  height: 100vh;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

body.snippet-dragging,
body.snippet-dragging * {
  cursor: crosshair !important;
  user-select: none !important;
}

/* vvv topbar vvv */
.topbar {
  height: 52px;
  flex-shrink: 0;
  background: #0e0e12;
  border-bottom: 1px solid #1e1e24;
  display: flex;
  align-items: center;
  padding: 0 16px;
  gap: 10px;
  position: relative;
}

.topbar.other-channel::after {
  content: "";
  position: absolute;
  left: 0;
  right: 0;
  bottom: -2px;
  height: 5px;
  background: #9d6cff;
}

/* >>> red overrides purple for admin-mode danger */
.topbar.admin-channel::after {
  background: #f14949;
}

.topbar-brand {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-shrink: 0;
  min-width: 0;
}

.brand-emote {
  width: 36px;
  height: 36px;
  flex-shrink: 0;
  image-rendering: pixelated;
}

.brand-name {
  font-size: 1rem;
  font-weight: 700;
  color: #ffd569;
  letter-spacing: 0.04em;
  white-space: nowrap;
}

.topbar-right {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-shrink: 0;
  margin-left: auto;
}

.logged-in-as {
  position: relative;
  display: inline-flex;
  align-items: center;
  height: 30px;
  padding: 0 12px;
  border: 1px solid #333;
  background: #1e1e26;
  font-size: 12px;
  color: #9d6cff;
  font-weight: 600;
  white-space: nowrap;
  box-sizing: border-box;
}

/* >>> shown when no channel switcher present */
.logged-in-as.other-channel {
  z-index: 0;
  border-color: #9d6cff;
  background: #1e1e26;
}

/* >>> extends backdrop down to topbar edge */
.logged-in-as.other-channel::after {
  content: "";
  position: absolute;
  z-index: -1;
  left: -4px;
  right: -4px;
  top: -4px;
  bottom: -15px;
  background: #9d6cff;
}

.logged-in-as.admin-channel {
  border-color: #f14949;
  color: #f14949;
}

.logged-in-as.admin-channel::after {
  background: #f14949;
}

.logged-in-float {
  position: fixed;
  bottom: 36px;
  right: 10px;
  z-index: 60;
  pointer-events: none;
  font-size: 11px;
  color: #9d6cff;
  font-weight: 600;
  white-space: nowrap;
  background: #160d2e;
  border: 1px solid #9d6cff44;
  padding: 4px 10px;
  max-width: 200px;
  overflow: hidden;
  text-overflow: ellipsis;
}

/* vvv search bar vvv */
.search-wrap {
  position: absolute;
  left: 50%;
  transform: translateX(-50%);
  width: min(420px, 40vw);
  display: flex;
  align-items: center;
  height: 34px;
  background: #1a1a1e;
  border: 1px solid #2a2a30;
  transition: border-color 0.15s;
  z-index: 10;
}

.search-wrap:focus-within {
  border-color: #6f2bff66;
}

.search-icon {
  position: absolute;
  left: 9px;
  width: 14px;
  height: 14px;
  color: #555;
  pointer-events: none;
  flex-shrink: 0;
}

.search-input {
  flex: 1;
  height: 100%;
  background: transparent;
  border: none;
  outline: none;
  color: #e0e0e0;
  font-family: inherit;
  font-size: 12px;
  padding: 0 8px 0 30px;
  min-width: 0;
}

.search-input::placeholder {
  color: #444;
}

.search-kbd {
  font-size: 9px;
  color: #333;
  border: 1px solid #2a2a30;
  padding: 1px 5px;
  margin-right: 6px;
  flex-shrink: 0;
  pointer-events: none;
  background: #111217;
}

.search-clear {
  background: transparent;
  border: none;
  color: #555;
  cursor: pointer;
  padding: 0 8px;
  height: 100%;
  flex-shrink: 0;
  display: inline-flex;
  align-items: center;
}

.search-clear svg {
  width: 11px;
  height: 11px;
}

.search-clear:hover {
  color: #e0e0e0;
}

/* vvv logs search chip vvv */
.search-wrap.has-chip .search-input {
  padding-left: 8px;
}

.search-scope-chip {
  display: flex;
  align-items: center;
  gap: 5px;
  height: 21px;
  padding: 0 6px 0 9px;
  background: rgba(157, 108, 255, 0.16);
  border: 1px solid #9d6cff66;
  color: #c9aaff;
  font-size: 10px;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  margin-left: 8px;
  flex-shrink: 0;
  white-space: nowrap;
}

.chip-x {
  background: transparent;
  border: none;
  color: #c9aaff;
  cursor: pointer;
  padding: 0 2px;
  line-height: 1;
  display: inline-flex;
  align-items: center;
}

.chip-x svg {
  width: 10px;
  height: 10px;
}

.chip-x:hover {
  color: #fff;
}

.search-match-nav {
  display: flex;
  align-items: center;
  gap: 2px;
  margin-right: 4px;
  flex-shrink: 0;
}

.search-match-count {
  font-size: 10px;
  color: #666;
  white-space: nowrap;
}

.search-match-step svg {
  width: 9px;
  height: 9px;
}

.search-match-step {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 16px;
  height: 16px;
  padding: 0;
  border: none;
  background: transparent;
  color: #666;
  font-size: 8px;
  cursor: pointer;
  line-height: 1;
}

.search-match-step:hover {
  color: #c9aaff;
}

.search-results {
  position: absolute;
  top: calc(100% + 4px);
  left: -1px;
  right: -1px;
  background: #1a1a1e;
  border: 1px solid #2a2a30;
  z-index: 9999;
  max-height: 400px;
  overflow-y: auto;
  box-shadow: 0 8px 32px rgba(0, 0, 0, 0.6);
  scrollbar-width: none;
}

.search-results::-webkit-scrollbar {
  display: none;
}

.search-empty {
  padding: 14px 16px;
  color: #555;
  font-size: 12px;
}

.result-group-label {
  padding: 6px 12px 3px;
  font-size: 9px;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.08em;
  color: #555;
  border-top: 1px solid #1e1e24;
}

.result-group-label:first-child {
  border-top: none;
}

.result-item {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  padding: 7px 12px;
  border: none;
  background: transparent;
  color: #ccc;
  font-family: inherit;
  font-size: 12px;
  text-align: left;
  cursor: pointer;
  transition: background 0.1s;
}

.result-item:hover,
.result-item.active {
  background: #6f2bff18;
  color: #e0e0e0;
}

.result-icon {
  width: 16px;
  flex-shrink: 0;
  text-align: center;
  font-size: 11px;
  color: #9d6cff;
  display: inline-flex;
  align-items: center;
  justify-content: center;
}

.result-icon svg {
  width: 13px;
  height: 13px;
}

.result-label {
  font-weight: 600;
  flex-shrink: 0;
}

.result-sub {
  font-size: 10px;
  color: #555;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  flex: 1;
}

/* vvv channel switcher vvv */
.channel-switcher {
  position: relative;
}

.channel-btn {
  height: 30px;
  padding: 0 12px;
  border: 1px solid #333;
  background: #1e1e26;
  color: #9d6cff;
  font-family: inherit;
  font-size: 12px;
  font-weight: 600;
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  gap: 4px;
}

.channel-btn-caret {
  display: inline-flex;
}

.channel-btn-caret svg {
  width: 10px;
  height: 10px;
}

.channel-btn:hover {
  background: #252530;
  border-color: #6f2bff55;
}

.channel-btn.other-channel {
  border-color: #9d6cff;
}

.channel-btn.admin-channel {
  border-color: #f14949;
  color: #f14949;
}

/* >>> isolates stacking so the menu z-index still works */
.channel-btn-wrap {
  position: relative;
}

.channel-btn-wrap.other-channel {
  z-index: 0;
}

/* >>> extends backdrop down to topbar edge */
.channel-btn-wrap.other-channel::after {
  content: "";
  position: absolute;
  z-index: -1;
  left: -3px;
  right: -3px;
  top: -3px;
  bottom: -15px;
  background: #9d6cff;
}

.channel-btn-wrap.admin-channel::after {
  background: #f14949;
}

.channel-menu {
  position: absolute;
  top: calc(100% + 6px);
  right: 0;
  background: #1b1b1d;
  border: 1px solid #2a2a30;
  min-width: 160px;
  z-index: 200;
  display: flex;
  flex-direction: column;
  box-shadow: 0 8px 24px #00000066;
}

.channel-menu-item {
  padding: 9px 16px;
  border: none;
  background: transparent;
  color: #888;
  font-family: inherit;
  font-size: 12px;
  text-align: left;
  cursor: pointer;
}

.channel-menu-item:hover {
  background: #222;
  color: #fff;
}

.channel-menu-item.admin-channel {
  color: #f14949;
}

.channel-menu-item.active {
  color: #9d6cff;
  font-weight: 700;
}

.toast {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  font-size: 11px;
  color: #23d18b;
  background: #0e2a1e;
  border: 1px solid #23d18b44;
  padding: 4px 10px;
  max-width: 200px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.toast-icon {
  display: inline-flex;
  flex-shrink: 0;
  width: 12px;
  height: 12px;
}

.toast-icon svg {
  width: 100%;
  height: 100%;
}

.toast-float {
  position: fixed;
  bottom: 68px;
  right: 10px;
  z-index: 61;
}

.auth-btn {
  height: 34px;
  padding: 0 14px;
  border: none;
  font-family: inherit;
  font-size: 12px;
  font-weight: 600;
  cursor: pointer;
  white-space: nowrap;
}

.login-btn {
  background: #6f2bff;
  color: #fff;
}

.login-btn:hover {
  background: #7f3fff;
}

.logout-btn {
  background: #2c2c2e;
  color: #aaa;
  border: 1px solid #333;
}

.logout-btn:hover {
  background: #3a3a3e;
  color: #fff;
}

.lang-switcher {
  display: flex;
  align-items: center;
  gap: 2px;
  flex-shrink: 0;
  border: 1px solid #2a2a30;
  padding: 0 2px;
  height: 28px;
}

.lang-sep {
  color: #333;
  font-size: 10px;
}

.lang-opt {
  height: 22px;
  padding: 0 7px;
  border: none;
  background: transparent;
  color: #555;
  font-family: inherit;
  font-size: 11px;
  font-weight: 700;
  cursor: pointer;
  letter-spacing: 0.04em;
}

.lang-opt:hover {
  color: #aaa;
}

.lang-opt.active {
  color: #9d6cff;
  background: #6f2bff18;
}

@keyframes shake {
  0% {
    transform: translateX(0);
  }

  15% {
    transform: translateX(-5px);
  }

  30% {
    transform: translateX(5px);
  }

  45% {
    transform: translateX(-4px);
  }

  60% {
    transform: translateX(4px);
  }

  75% {
    transform: translateX(-2px);
  }

  90% {
    transform: translateX(2px);
  }

  100% {
    transform: translateX(0);
  }
}

.shake {
  animation: shake 0.6s ease;
}

/* vvv hamburger vvv */
.hamburger {
  display: flex;
  flex-direction: column;
  justify-content: center;
  gap: 5px;
  width: 36px;
  height: 36px;
  padding: 0 6px;
  background: transparent;
  border: 1px solid #2a2a30;
  cursor: pointer;
  flex-shrink: 0;
}

.hamburger span {
  display: block;
  height: 2px;
  background: #888;
  transition:
    transform 0.2s,
    opacity 0.2s,
    background 0.2s;
}

.hamburger.open span:nth-child(1) {
  transform: translateY(7px) rotate(45deg);
  background: #9d6cff;
}

.hamburger.open span:nth-child(2) {
  opacity: 0;
}

.hamburger.open span:nth-child(3) {
  transform: translateY(-7px) rotate(-45deg);
  background: #9d6cff;
}

/* vvv banner vvv */
.add-banner {
  background: #1a1025;
  border-bottom: 1px solid #6f2bff44;
  padding: 8px 16px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  font-size: 12px;
  color: #ccc;
  flex-shrink: 0;
}

.banner-actions {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-shrink: 0;
}

.banner-btn.add {
  height: 30px;
  padding: 0 12px;
  background: #6f2bff;
  border: none;
  color: #fff;
  font-family: inherit;
  font-size: 11px;
  cursor: pointer;
}

.banner-btn.add:hover {
  background: #7f3fff;
}

.banner-dismiss {
  background: transparent;
  border: none;
  color: #666;
  cursor: pointer;
  padding: 0 4px;
  display: inline-flex;
  align-items: center;
}

.banner-dismiss svg {
  width: 13px;
  height: 13px;
}

.banner-icon {
  display: inline-flex;
  flex-shrink: 0;
}

.banner-icon svg {
  width: 15px;
  height: 15px;
}

.banner-dismiss:hover {
  color: #aaa;
}

.reauth-banner {
  background: #241b0a;
  border-bottom: 1px solid #e5c07b44;
  color: #e5c07b;
}

.banner-btn.reauth {
  display: inline-flex;
  align-items: center;
  height: 30px;
  padding: 0 12px;
  background: #e5c07b;
  border: none;
  color: #1a1408;
  font-family: inherit;
  font-size: 11px;
  font-weight: 700;
  text-decoration: none;
  cursor: pointer;
}

.banner-btn.reauth:hover {
  background: #f0cd8a;
}

/* vvv body layout vvv */
.body {
  display: flex;
  flex: 1;
  min-height: 0;
  overflow: hidden;
  position: relative;
}

.sidebar-overlay {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.6);
  z-index: 99;
}

/* vvv sidebar vvv */
.sidebar {
  width: 200px;
  flex-shrink: 0;
  background: #0e0e12;
  display: flex;
  flex-direction: column;
  padding: 8px 0;
  border-right: 1px solid #1e1e24;
  overflow-y: auto;
  scrollbar-width: none;
  transition: transform 0.25s ease;
}

.sidebar::-webkit-scrollbar {
  display: none;
}

.sidebar-spacer {
  flex: 1;
}

.sidebar-btn {
  display: flex;
  align-items: center;
  justify-content: space-between;
  width: 100%;
  padding: 11px 20px;
  border: none;
  background: transparent;
  color: #777;
  text-align: left;
  font-family: inherit;
  font-size: 13px;
  cursor: pointer;
  transition:
    color 0.1s,
    background 0.1s;
  letter-spacing: 0.01em;
}

.sidebar-btn:hover {
  color: #fff;
  background: #16161a;
}

.sidebar-btn.active {
  color: #9d6cff;
  font-weight: 700;
  background: rgba(111, 43, 255, 0.08);
  border-left: 2px solid #6f2bff;
}

.admin-nav-btn {
  color: #d15a5a;
}

.admin-nav-btn.active {
  color: #f14949;
  background: rgba(241, 73, 73, 0.08);
  border-left: 2px solid #f14949;
}

.admin-mode-switch.on {
  background: #f1494933;
  border-color: #f1494988;
}

.admin-mode-switch.on .ep-switch-knob {
  background: #f14949;
}

.sidebar-btn.locked {
  opacity: 0.45;
}

.sidebar-btn.locked:hover {
  opacity: 0.75;
}

.lock-icon {
  display: inline-flex;
  opacity: 0.6;
}

.lock-icon svg {
  width: 10px;
  height: 10px;
}

.sidebar-divider {
  height: 1px;
  background: #1e1e24;
  margin: 6px 14px;
  flex-shrink: 0;
}

.sidebar-bottom {
  padding: 12px 16px;
  border-top: 1px solid #1e1e24;
}

.bot-btn {
  width: 100%;
  height: 32px;
  border: none;
  font-family: inherit;
  font-size: 12px;
  cursor: pointer;
}

.bot-btn.add {
  background: #6f2bff;
  color: #fff;
}

.bot-btn.add:hover {
  background: #7f3fff;
}

/* vvv mobile search in sidebar vvv */
.sidebar-search {
  display: none;
  /* >>> shown/hidden via responsive class */
  position: relative;
  margin: 8px 12px 4px;
  height: 36px;
  background: #111217;
  border: 1px solid #2a2a30;
  align-items: center;
}

.sidebar-search:focus-within {
  border-color: #6f2bff66;
}

.sidebar-search .search-icon {
  position: absolute;
  left: 9px;
  width: 13px;
  height: 13px;
  color: #555;
  pointer-events: none;
}

.sidebar-search .search-input {
  flex: 1;
  height: 100%;
  background: transparent;
  border: none;
  outline: none;
  color: #e0e0e0;
  font-family: inherit;
  font-size: 12px;
  padding: 0 8px 0 28px;
}

.sidebar-search.has-chip .search-input {
  padding-left: 8px;
}

.sidebar-search .search-scope-chip {
  margin-left: 6px;
}

.sidebar-search .search-input::placeholder {
  color: #444;
}

.sidebar-search .search-clear {
  background: transparent;
  border: none;
  color: #555;
  font-size: 11px;
  cursor: pointer;
  padding: 0 8px;
  height: 100%;
}

.sidebar-search .search-clear:hover {
  color: #e0e0e0;
}

.sidebar-search .search-results {
  position: absolute;
  top: calc(100% + 2px);
  left: -1px;
  right: -1px;
  background: #1a1a1e;
  border: 1px solid #2a2a30;
  z-index: 9999;
  max-height: 320px;
  overflow-y: auto;
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.6);
  scrollbar-width: none;
}

.sidebar-search .search-results::-webkit-scrollbar {
  display: none;
}

/* vvv mobile sidebar header vvv */
.sidebar-mobile-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 12px 20px 8px;
  border-bottom: 1px solid #1e1e24;
  margin-bottom: 4px;
}

.sidebar-user {
  font-size: 12px;
  color: #9d6cff;
  font-weight: 600;
}

.sidebar-logout {
  background: transparent;
  border: 1px solid #333;
  color: #888;
  font-family: inherit;
  font-size: 11px;
  padding: 4px 10px;
  cursor: pointer;
}

.sidebar-logout:hover {
  color: #fff;
  border-color: #555;
}

/* vvv main panel vvv */
.main-panel {
  flex: 1;
  background: #141418;
  padding: 20px;
  display: flex;
  flex-direction: column;
  overflow-y: auto;
  overflow-x: hidden;
  min-height: 0;
  min-width: 0;
  scrollbar-width: none;
}

.main-panel::-webkit-scrollbar {
  display: none;
}

.site-footer {
  margin-top: auto;
  padding: 20px 0 4px;
  font-size: 11px;
  color: #333;
  display: flex;
  align-items: center;
  gap: 8px;
  flex-shrink: 0;
}

.footer-sep {
  color: #2a2a30;
}

.footer-link {
  color: #555;
  text-decoration: none;
  transition: color 0.15s;
}

.footer-link:hover {
  color: #9d6cff;
}

/* vvv responsive vvv */
.hide-mobile {}

.show-mobile {
  display: none;
}

@media (max-width: 680px) {
  body.logs-open {
    overflow: hidden !important;
    height: 100dvh !important;
  }

  body.logs-open .page {
    overflow: hidden !important;
    height: 100dvh !important;
    min-height: 0 !important;
    display: flex;
    flex-direction: column;
  }

  body.logs-open .main-panel {
    overflow: hidden !important;
    height: calc(100dvh - 52px) !important;
    min-height: 0 !important;
    padding-bottom: 38px !important;
    flex: none;
  }
}

@media (max-width: 680px) {

  html,
  body {
    overflow: auto;
  }

  .page {
    height: auto;
    min-height: 100vh;
    overflow: visible;
  }

  .topbar {
    padding: 0 10px;
    gap: 6px;
  }

  .brand-name {
    font-size: 13px;
  }

  .hide-mobile {
    display: none !important;
  }

  .show-mobile {
    display: flex !important;
  }

  .add-banner {
    padding: 8px 14px;
    font-size: 11px;
  }

  .body {
    overflow: visible;
    flex-direction: column;
  }

  .search-kbd {
    display: none;
  }

  .sidebar {
    position: fixed;
    top: 52px;
    right: 0;
    bottom: 0;
    width: 240px;
    z-index: 100;
    transform: translateX(100%);
    border-left: 1px solid #2a2a30;
    box-shadow: -4px 0 24px #00000066;
  }

  .sidebar.sidebar-open {
    transform: translateX(0);
  }

  .main-panel {
    padding: 14px;
    flex: none;
    min-height: calc(100dvh - 52px);
    padding-bottom: 38px;
  }

  .site-footer {
    position: fixed;
    bottom: 0;
    left: 0;
    right: 0;
    padding: 6px 14px;
    background: #141418;
    border-top: 1px solid #1e1e24;
    justify-content: center;
    z-index: 50;
    margin-top: 0;
  }
}

@media (min-width: 681px) and (max-width: 960px) {
  .topbar {
    padding: 0 12px;
    gap: 8px;
  }

  .sidebar {
    width: 170px;
  }

  .sidebar-btn {
    padding: 10px 14px;
    font-size: 12px;
  }

  .main-panel {
    padding: 16px;
  }

  .search-wrap {
    max-width: 300px;
  }
}

</style>
