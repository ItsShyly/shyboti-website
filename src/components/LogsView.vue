<script setup lang="ts">
import {
  ref,
  computed,
  watch,
  onMounted,
  onUnmounted,
  nextTick,
  type VNode,
  type Directive,
} from "vue";
import { useRouter, useRoute } from "vue-router";
import { API } from "../api";
import { useAuth } from "../auth";
import { useI18n } from "../i18n";
import {
  useLogsSearch,
  type LogSearchResult,
} from "../composables/useLogsSearch";
import { VueDatePicker } from "@vuepic/vue-datepicker";
import "@vuepic/vue-datepicker/dist/main.css";
// >>> vue-virtual-scroller removed, rolled our own below
const _rowDomCache = new Map<string, Element>();
const _ROW_CACHE_MAX = 600;

function _applyCachedHtml(el: HTMLElement, id: string, html: string) {
  if (el.dataset.cid === id) return; // <<< same item, nothing to do

  // >>> detach old content into cache
  const oldId = el.dataset.cid;
  if (oldId && el.firstElementChild) {
    _rowDomCache.set(oldId, el.removeChild(el.firstElementChild) as Element);
  }
  while (el.lastChild) el.removeChild(el.lastChild); // <<< clear leftovers

  el.dataset.cid = id;

  // >>> restore from cache or create new
  const cached = _rowDomCache.get(id);
  if (cached) {
    el.appendChild(cached);
  } else {
    el.innerHTML = html;
    if (el.firstElementChild) _rowDomCache.set(id, el.firstElementChild);
  }

  // >>> simple eviction: drop oldest entries
  while (_rowDomCache.size > _ROW_CACHE_MAX) {
    const first = _rowDomCache.keys().next().value;
    if (first === undefined) break;
    _rowDomCache.delete(first);
  }
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars
const vCachedHtml: Directive<HTMLElement, { id: string; html: string }> = {
  mounted(el, { value: { id, html } }) {
    _applyCachedHtml(el, id, html);
  },
  updated(el, { value: { id, html } }) {
    _applyCachedHtml(el, id, html);
  },
  beforeUnmount(el) {
    const id = el.dataset.cid;
    if (id && el.firstElementChild) {
      _rowDomCache.set(id, el.removeChild(el.firstElementChild) as Element);
    }
  },
};

// >>> toggle window.__logsDbg.{rowMount,rowActive,badgeLoad,recycleEvt} in console to debug
const _dbgDefaults = {
  rowMount: false,
  rowActive: false,
  badgeLoad: false,
  emoteLoad: false,
  recycleEvt: false,
};
if (typeof window !== "undefined") {
  (window as any).__logsDbg = Object.assign(
    _dbgDefaults,
    (window as any).__logsDbg ?? {},
  );
}
function dbg(category: keyof typeof _dbgDefaults): boolean {
  return (
    typeof window !== "undefined" && !!(window as any).__logsDbg?.[category]
  );
}

// >>> rowMounted = new row (pool expansion); rowBeforeUpdate/rowUpdated = recycled row on scroll
const _rowMountTimes = new Map<string, number>(); // <<< id -> t0 from rowBecameActive
const _rowUpdateT0 = new Map<string, number>(); // <<< id -> t0 from rowBeforeUpdate
const visibleStartIndex = ref(0);
function rowBecameActive(id: string) {
  _rowMountTimes.set(id, performance.now());
  if (dbg("rowActive")) console.debug(`[scroll:active] ${id}`);
}
function rowMounted(el: Element) {
  const h = el as HTMLElement;
  const id = h.id ?? "?";
  const t0 = _rowMountTimes.get(id);
  if (t0 !== undefined) {
    _rowMountTimes.delete(id);
    if (dbg("rowMount"))
      console.debug(
        `[scroll:mount] ${id} +${(performance.now() - t0).toFixed(1)}ms`,
      );
  } else {
    if (dbg("rowMount")) console.debug(`[scroll:mount] ${id}`);
  }
}
function rowBeforeUpdate(el: Element) {
  if (!dbg("rowMount")) return;
  _rowUpdateT0.set((el as HTMLElement).id ?? "?", performance.now());
}
function rowUpdated(el: Element) {
  if (!dbg("rowMount")) return;
  const id = (el as HTMLElement).id ?? "?";
  const t0 = _rowUpdateT0.get(id);
  if (t0 !== undefined) {
    _rowUpdateT0.delete(id);
    console.debug(
      `[scroll:recycle] ${id} +${(performance.now() - t0).toFixed(1)}ms`,
    );
  }
}

// >>> badge/emote image timing
function badgeLoadStart(src: string) {
  if (dbg("badgeLoad")) _badgeT0.set(src, performance.now());
}
const _badgeT0 = new Map<string, number>();
function badgeLoaded(ev: Event) {
  if (!dbg("badgeLoad")) return;
  const src = (ev.target as HTMLImageElement).src;
  const t0 = _badgeT0.get(src);
  console.debug(
    `[scroll:badge-load] ${src.split("/").pop()} +${t0 !== undefined ? (performance.now() - t0).toFixed(1) + "ms" : "?ms"}`,
  );
  if (t0 !== undefined) _badgeT0.delete(src);
}
function badgeError(ev: Event) {
  if (!dbg("badgeLoad")) return;
  const src = (ev.target as HTMLImageElement).src;
  console.debug(`[scroll:badge-err] ${src.split("/").pop()}`);
  _badgeT0.delete(src);
}

// >>> visibleStartIndex computed in vUpdateWindow - a raw DOM-child-index walk drifted from displayItems under virtualization

// >>> emote load timing via event delegation - emotes are v-html, vue hooks can't reach them
const _emoteT0 = new Map<string, number>(); // <<< src -> t0 when img was parsed into dom
function _onEmoteLoad(ev: Event) {
  if (!dbg("emoteLoad")) return;
  const img = ev.target as HTMLImageElement;
  if (!img.classList.contains("chat-emote")) return;
  const t0 = _emoteT0.get(img.src);
  console.debug(
    `[scroll:emote-load] ${img.alt || img.src.split("/").pop()} +${t0 !== undefined ? (performance.now() - t0).toFixed(1) + "ms" : "?ms"}`,
  );
  if (t0 !== undefined) _emoteT0.delete(img.src);
}
function _onEmoteError(ev: Event) {
  if (!dbg("emoteLoad")) return;
  const img = ev.target as HTMLImageElement;
  if (!img.classList.contains("chat-emote")) return;
  console.debug(`[scroll:emote-err] ${img.alt || img.src.split("/").pop()}`);
  _emoteT0.delete(img.src);
}
// >>> mutationobserver stamps a start time as soon as each chat-emote img enters the dom
let _emoteMutObs: MutationObserver | null = null;
function attachEmoteObserver(container: Element) {
  _emoteMutObs = new MutationObserver((mutations) => {
    if (!dbg("emoteLoad")) return;
    for (const m of mutations) {
      for (const node of m.addedNodes) {
        const imgs =
          node instanceof Element
            ? node.classList.contains("chat-emote")
              ? [node as HTMLImageElement]
              : Array.from(
                node.querySelectorAll<HTMLImageElement>("img.chat-emote"),
              )
            : [];
        for (const img of imgs) _emoteT0.set(img.src, performance.now());
      }
    }
  });
  _emoteMutObs.observe(container, { childList: true, subtree: true });
  container.addEventListener("load", _onEmoteLoad, true);
  container.addEventListener("error", _onEmoteError, true);
}
function detachEmoteObserver(container: Element) {
  _emoteMutObs?.disconnect();
  _emoteMutObs = null;
  container.removeEventListener("load", _onEmoteLoad, true);
  container.removeEventListener("error", _onEmoteError, true);
}

const { session } = useAuth();
const { t } = useI18n();
const router = useRouter();

interface LogMsg {
  id: string;
  text: string;
  username: string;
  displayName: string;
  channel: string;
  timestamp: string;
  tags?: Record<string, string>;
  // >>> present when render=1 is requested
  _rowHtml?: string;
  _eventMeta?: { label: string; icon: string; tone: string } | null;
  _isMod?: boolean;
  _hasReply?: boolean;
}
interface EmoteEntry {
  url: string;
  overlay: boolean;
}
interface EmoteMap {
  [name: string]: EmoteEntry;
}
interface BadgeChip {
  key: string;
  label: string;
  kind: "twitch" | "seventv" | "marker";
  imageUrl?: string;
  title?: string;
}
interface EventMeta {
  label: string;
  icon: string;
  tone: "first" | "sub" | "announce";
}
interface TwitchBadgeAsset {
  imageUrl: string;
  title: string;
}
interface SevenTvBadgeAsset {
  imageUrl: string;
  title: string;
}

// >>> read directly from DOM (not v-model) so typing doesn't trigger a re-render
const channelInputRef = ref<HTMLInputElement | null>(null);
const userInputRef = ref<HTMLInputElement | null>(null);
const termInputRef = ref<HTMLInputElement | null>(null);

// >>> only updated when a search actually runs, for url sync + summary bar
const channel = ref("");
const userFilter = ref("");
const termFilter = ref("");
const dateFilter = ref("");
const dateFrom = ref("");
const dateUntil = ref("");

function readInputs() {
  channel.value =
    channelInputRef.value?.value.trim().toLowerCase().replace(/^#/, "") ||
    channel.value;
  userFilter.value = userInputRef.value?.value.trim() || userFilter.value;
  termFilter.value = termInputRef.value?.value.trim() || termFilter.value;
  dateFilter.value = dateFrom.value;
}

interface AutomodMsg {
  id: string;
  text: string;
  username: string;
  displayName: string;
  channel: string;
  timestamp: string;
  _automod: true;
  _category: string;
  _status: string;
}

// >>> sliding window cap - only the visible slice is mounted, so raising this is memory-only cost
const MSG_MAX_SHOWN = 6000;

// vvv virtual scroller vvv
// >>> only [vWinStart, vWinEnd) of displayItems is rendered; spacers keep scrollHeight correct, ResizeObserver measures real heights
const VIRT_OVERSCAN = 40; // <<< extra rows above/below viewport
const VIRT_EST_H = 28; // <<< estimated px per row before measurement
const vWinStart = ref(0);
const vWinEnd = ref(150);
const vHeightCache = new Map<string, number>(); // <<< item.id -> measured px
let vRO: ResizeObserver | null = null;
let vMutObs: MutationObserver | null = null;
let vRafPending = false;

// >>> prefix sums recomputed only on displayItems change, not per scroll
const prefixSums = computed(() => {
  const items = displayItems.value;
  const total = items.length;
  const pref = new Float64Array(total + 1);
  pref[0] = 0;
  for (let i = 0; i < total; i++) {
    pref[i + 1] = pref[i]! + (vHeightCache.get(items[i]!.id) ?? VIRT_EST_H);
  }
  return pref;
});

// >>> binary search on prefix sums, O(log n)
function findIndexFromOffset(target: number): number {
  const pref = prefixSums.value;
  const total = displayItems.value.length;
  if (total === 0) return 0;
  const clamped = Math.max(0, Math.min(target, pref[total]!));
  let lo = 0,
    hi = total - 1;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (pref[mid + 1]! > clamped) hi = mid;
    else lo = mid + 1;
  }
  return lo;
}

function vUpdateWindow() {
  const body = getBody();
  if (!body) return;
  const items = displayItems.value;
  if (!items.length) {
    vWinStart.value = 0;
    vWinEnd.value = 0;
    visibleStartIndex.value = 0;
    return;
  }

  const scrollTop = body.scrollTop;
  const viewH = body.clientHeight;
  const overscanPx = VIRT_OVERSCAN * VIRT_EST_H;

  const startIdx = findIndexFromOffset(scrollTop - overscanPx);
  const endIdx = Math.min(
    items.length,
    findIndexFromOffset(scrollTop + viewH + overscanPx) + 1,
  );
  const visIdx = findIndexFromOffset(scrollTop);

  // >>> only update if changed - avoids scrollHeight oscillation loop (583px<->611px flicker)
  if (startIdx !== vWinStart.value) vWinStart.value = startIdx;
  if (endIdx !== vWinEnd.value) vWinEnd.value = endIdx;
  if (visIdx !== visibleStartIndex.value) visibleStartIndex.value = visIdx;
}

const vSpacerTop = computed(() => {
  const pref = prefixSums.value;
  return pref[vWinStart.value] ?? 0;
});
const vSpacerBottom = computed(() => {
  const pref = prefixSums.value;
  const total = displayItems.value.length;
  return (pref[total] ?? 0) - (pref[vWinEnd.value] ?? 0);
});

function vRegisterRow(el: HTMLElement) {
  if (vRO && el.dataset?.vitId) vRO.observe(el);
}

function vAttachObserver(el: HTMLElement) {
  vDetachObserver();
  vRO = new ResizeObserver((entries) => {
    let changed = false;
    for (const entry of entries) {
      const target = entry.target as HTMLElement;
      const id = target.dataset.vitId;
      if (!id) continue;
      const h = entry.borderBoxSize?.[0]?.blockSize ?? entry.contentRect.height;
      if (h > 0 && vHeightCache.get(id) !== h) {
        vHeightCache.set(id, h);
        changed = true;
      }
    }
    if (changed && !vRafPending) {
      vRafPending = true;
      requestAnimationFrame(() => {
        vRafPending = false;
        vUpdateWindow();
        // >>> rows can grow after initial scrollToBottom(); keep pinned if user was already at bottom
        const body = getBody();
        if (body && isNearBottom.value) body.scrollTop = body.scrollHeight;
      });
    }
  });

  for (const child of Array.from(el.children))
    vRegisterRow(child as HTMLElement);

  // >>> single mutationobserver measures every row kind via shared data-vit-id - server-rendered rows used to go unmeasured (assumed VIRT_EST_H), which drifted the scroll window
  vMutObs = new MutationObserver((mutations) => {
    for (const m of mutations) {
      for (const node of m.addedNodes) {
        if (node instanceof HTMLElement && node.dataset?.vitId)
          vRO!.observe(node);
      }
      for (const node of m.removedNodes) {
        if (node instanceof HTMLElement && node.dataset?.vitId)
          vRO!.unobserve(node);
      }
    }
  });
  vMutObs.observe(el, { childList: true });
}

function vDetachObserver() {
  vRO?.disconnect();
  vRO = null;
  vMutObs?.disconnect();
  vMutObs = null;
}

const virtualSlice = computed(() =>
  displayItems.value.slice(vWinStart.value, vWinEnd.value),
);

const msgs = ref<LogMsg[]>([]);
const automodMsgs = ref<AutomodMsg[]>([]);
const showAutomod = ref(false); // <<< toggled by user, only shown to broadcaster
const isBroadcaster = ref(false); // <<< true when viewing own channel
const loading = ref(false);
const loadingMore = ref(false);
const loadingNewer = ref(false);
const noMore = ref(false);
const noNewer = ref(true); // <<< true = at the most-recent data
const isNearBottom = ref(true); // <<< false = scrolled up, shows jump-to-newest button
const error = ref("");
const searched = ref(false);
const emoteMap = ref<EmoteMap>({});
const twitchBadgeMap = ref<Map<string, TwitchBadgeAsset>>(new Map());
const sevenTvBadgeMap = ref<Map<string, SevenTvBadgeAsset>>(new Map());
const scrollerRef = ref<HTMLElement | null>(null);
const customScrollbarRef = ref<HTMLElement | null>(null);
const customThumbTop = ref(0);
const customThumbH = ref(40);
const customThumbStyle = computed(() => ({
  top: customThumbTop.value + "px",
  height: customThumbH.value + "px",
}));
const visualsBarRef = ref<HTMLElement | null>(null);
const tableWrapRef = ref<HTMLElement | null>(null);
const tableShellRef = ref<HTMLElement | null>(null);
const isMobileView = ref(false);
const desktopLogWidth = ref<number | null>(null);
function getBody(): HTMLElement | null {
  return scrollerRef.value ?? null;
}
const highlightId = ref<string | null>(null);
const copyToast = ref(false);
const searchExpanded = ref(true);
const direction = ref<"newest" | "oldest">("newest");

let cursorDate: Date | null = null;
let cursorMonth: { y: number; m: number } | null = null;
// >>> cursors for loading newer (trimmed content going forward)
let cursorNewerDate: Date | null = null;
let cursorNewerMonth: { y: number; m: number } | null = null;
let abortCtrl = new AbortController();
let scrollListenerAttached = false;
let rafScrollPending = false;

const loadingOverlayLogoUrl =
  "https://cdn.7tv.app/emote/01G0PEAVDR0008B1SW0M995JQJ/2x.gif";
const domSettling = ref(false);
const pendingPaintJobs = ref(0);
let domSettleToken = 0;
type SearchJobPhase = "idle" | "fetch" | "display" | "visuals";

// >>> in-memory day/month cache; keys include all query params, TTL avoids stale data
const FETCH_CACHE_TTL = 5 * 60 * 1000;
const dayFetchCache = new Map<string, { data: LogMsg[]; ts: number }>();
const monthFetchCache = new Map<string, { data: LogMsg[]; ts: number }>();
const searchJobPhase = ref<SearchJobPhase>("idle");
const activeSearchJob = ref(0);
const visualsPhaseActive = ref(false);

function setSearchJobPhase(phase: SearchJobPhase) {
  if (searchJobPhase.value === phase) return;
  searchJobPhase.value = phase;
  console.debug(`[logs:job] phase=${phase}`, { job: activeSearchJob.value });
}

const isMobile = () => window.matchMedia("(max-width: 680px)").matches;

function syncViewportMode() {
  isMobileView.value = isMobile();
  if (isMobileView.value) desktopLogWidth.value = null;
}

// >>> single-select: 7tv paints and plain-white names are mutually exclusive, not independent toggles
const nameVisual = ref<"7tv" | "white">("7tv");
const hide7tv = computed(() => nameVisual.value === "white");
const plainUsernames = computed(() => nameVisual.value === "white");
const visualsOpen = ref(false);

function formatDateSingle(d: Date | null): string {
  if (!d) return "";
  return d.toISOString().slice(0, 10);
}

// >>> single date picker; dateUntil silently mirrors dateFrom so the range-capable fetch logic still works
const dateSingle = computed({
  get: (): Date | null => {
    if (!dateFrom.value) return null;
    return new Date(dateFrom.value + "T00:00:00");
  },
  set: (val: Date | null) => {
    if (val) {
      const fmt = (d: Date) => d.toISOString().slice(0, 10);
      dateFrom.value = fmt(val);
      dateUntil.value = fmt(val);
    } else {
      dateFrom.value = "";
      dateUntil.value = "";
    }
  },
});

function onDocClickVisuals(e: MouseEvent) {
  if (
    visualsOpen.value &&
    visualsBarRef.value &&
    !visualsBarRef.value.contains(e.target as Node)
  ) {
    visualsOpen.value = false;
  }
}

// >>> /logs/<channel>/<user> path (shorter/shareable); term/from/until stay as query params (optional refinements)
function buildUrl(msgId: string | null = null) {
  const ch = channel.value.trim().toLowerCase().replace(/^#/, "");
  const u = userFilter.value.trim();
  let path = "/logs";
  if (ch) {
    path += `/${encodeURIComponent(ch)}`;
    if (u) path += `/${encodeURIComponent(u)}`;
  }
  const p = new URLSearchParams();
  if (termFilter.value.trim()) p.set("term", termFilter.value.trim());
  if (dateFrom.value) p.set("from", dateFrom.value);
  if (dateUntil.value && dateUntil.value !== dateFrom.value)
    p.set("until", dateUntil.value);
  const qs = p.toString() ? "?" + p.toString() : "";
  const hash = msgId ? `#msg-${msgId}` : "";
  return path + qs + hash;
}

function pushSearchUrl() {
  history.replaceState(null, "", buildUrl());
}

function pushHash(msgId: string) {
  history.replaceState(null, "", buildUrl(msgId));
}

function readUrlState() {
  const segments = window.location.pathname.split("/").filter(Boolean);
  if (segments[0] === "logs") {
    if (segments[1]) channel.value = decodeURIComponent(segments[1]);
    if (segments[2]) userFilter.value = decodeURIComponent(segments[2]);
  }

  const p = new URLSearchParams(window.location.search);
  // >>> legacy ?channel=&user= links still work
  if (!channel.value && p.get("channel")) channel.value = p.get("channel")!;
  if (!userFilter.value && p.get("user")) userFilter.value = p.get("user")!;
  if (p.get("term")) termFilter.value = p.get("term")!;
  // >>> legacy ?date= still supported alongside ?from=&until=
  if (p.get("from")) dateFrom.value = p.get("from")!;
  else if (p.get("date")) dateFrom.value = p.get("date")!;
  if (p.get("until")) dateUntil.value = p.get("until")!;
  else if (dateFrom.value) dateUntil.value = dateFrom.value; // <<< single-date is now the default
  dateFilter.value = dateFrom.value;
}

function readHashId(): string | null {
  const m = window.location.hash.match(/^#msg-(.+)$/);
  return m ? m[1]! : null;
}

// >>> nameColWidth: computed only when msgs changes, never on input typing
const nameColWidth = ref(140);
watch(
  msgs,
  (list: LogMsg[]) => {
    if (!list.length) {
      nameColWidth.value = 140;
      return;
    }
    let max = 0;
    for (const m of list) {
      const len = (m.displayName || m.username).length;
      if (len > max) max = len;
    }
    nameColWidth.value = Math.min(240, Math.max(80, max * 7.8));
    nextTick(updateCustomScrollbar);
  },
  { flush: "post" },
);

// vvv emotes vvv
async function fetchEmotes(ch: string) {
  // >>> accumulate into a plain object, assign ref once - single reactivity trigger + single row-cache bust
  const next: EmoteMap = {};
  for (const path of [`/emotes/${ch}`, `/emotes/twitch/${ch}`]) {
    try {
      const r = await fetch(`${API}${path}`);
      if (r.ok) {
        const d = (await r.json()) as any;
        for (const e of d.emotes ?? [])
          next[e.name] = { url: e.url, overlay: !!e.overlay };
      }
    } catch { }
  }
  emoteMap.value = next;
}

async function fetchTwitchBadges(ch: string) {
  twitchBadgeMap.value = new Map();
  try {
    const r = await fetch(`${API}/twitch/badges/${encodeURIComponent(ch)}`, {
      headers: session.value
        ? { Authorization: `Bearer ${session.value.token}` }
        : {},
    });
    if (!r.ok) return;
    const d = (await r.json()) as any;
    const src = d?.badgeMap ?? {};
    const m = new Map<string, TwitchBadgeAsset>();
    for (const [k, v] of Object.entries(src)) {
      const b = v as any;
      const imageUrl = String(b?.image_url_2x ?? b?.image_url_1x ?? "");
      if (!imageUrl) continue;
      m.set(k, {
        imageUrl,
        title: String(b?.title ?? k),
      });
    }
    twitchBadgeMap.value = m;
    // >>> pre-warm/decode badge images so they paint instantly
    preDecodeUrls(
      Array.from(m.values(), (b) => b.imageUrl),
      "badges",
    );
  } catch { }
}

/* ── Image pre-decode helper ── */
const _preloadedUrls = new Set<string>();
function preDecodeUrls(urls: string[], label?: string) {
  const fresh: string[] = [];
  for (const url of urls) {
    if (_preloadedUrls.has(url)) continue;
    _preloadedUrls.add(url);
    fresh.push(url);
  }
  if (!fresh.length) return;
  if (label)
    console.debug(`[logs:preload] ${label}: decoding ${fresh.length} images`);
  for (const url of fresh) {
    const img = new Image();
    img.src = url;
    img.decode().catch(() => { }); // <<< pre-decode to raster for instant paint later
  }
}

/* ── Eager channel-level image preload (emotes + badges) ── */
let _assetPreloadChannel = "";
async function preloadChannelAssets(ch: string) {
  if (_assetPreloadChannel === ch) return; // <<< already warming this channel
  _assetPreloadChannel = ch;
  try {
    const r = await fetch(
      `${API}/logs/assets?channel=${encodeURIComponent(ch)}`,
    );
    if (!r.ok) return;
    const { urls } = (await r.json()) as { urls: string[] };
    preDecodeUrls(urls, `channel ${ch}`);
  } catch { }
}

/* ── Pre-load images extracted from server-rendered row HTML ── */
const _imgSrcRe = / src="(https:\/\/[^"]+)"/g;
function preloadRowImages(messages: LogMsg[]) {
  const urls: string[] = [];
  for (const m of messages) {
    if (!m._rowHtml) continue;
    _imgSrcRe.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = _imgSrcRe.exec(m._rowHtml))) urls.push(match[1]!);
  }
  preDecodeUrls(urls, "rows");
}

async function fetchDay(
  ch: string,
  y: number,
  m: number,
  d: number,
  signal: AbortSignal,
): Promise<LogMsg[]> {
  const mm = String(m).padStart(2, "0");
  const dd = String(d).padStart(2, "0");
  const term = termFilter.value.trim();
  const cacheKey = `${ch}:${y}-${mm}-${dd}:${term}`;
  const hit = dayFetchCache.get(cacheKey);
  if (hit && Date.now() - hit.ts < FETCH_CACHE_TTL) {
    console.debug(`[logs:fetchDay] cache hit ${ch} ${y}-${mm}-${dd}`);
    return hit.data.slice();
  }
  const params = new URLSearchParams({
    channel: ch,
    year: String(y),
    month: mm,
    day: dd,
    limit: "10000",
    render: "0",
  });
  if (term) params.set("q", term);
  const _t0 = performance.now();
  const res = await fetch(`${API}/logs/day?${params}`, { signal });
  if (!res.ok) return [];
  const raw = await res.text();
  const _fetchMs = (performance.now() - _t0) | 0;
  const data = JSON.parse(raw) as any;
  let messages: LogMsg[] = data?.messages ?? [];
  console.debug(
    `[logs:fetchDay] ${ch} ${y}-${mm}-${dd} → ${messages.length} msgs, ${(raw.length / 1024) | 0}KB, ${_fetchMs}ms`,
  );
  if (term) {
    const termLow = term.toLowerCase();
    messages = messages.filter((m) => m.text.toLowerCase().includes(termLow));
  }
  dayFetchCache.set(cacheKey, { data: messages, ts: Date.now() });
  preloadRowImages(messages);
  return messages;
}

async function fetchMonth(
  ch: string,
  y: number,
  m: number,
  signal: AbortSignal,
): Promise<LogMsg[]> {
  const mm = String(m).padStart(2, "0");
  const u = userFilter.value.trim().toLowerCase();
  const term = termFilter.value.trim();
  const cacheKey = `${ch}:${y}-${mm}:${u}:${term}`;
  const hit = monthFetchCache.get(cacheKey);
  if (hit && Date.now() - hit.ts < FETCH_CACHE_TTL) {
    console.debug(
      `[logs:fetchMonth] cache hit ${ch} ${y}-${mm} user=${u || "(all)"}`,
    );
    return hit.data.slice();
  }
  const params = new URLSearchParams({
    channel: ch,
    user: u,
    year: String(y),
    month: mm,
    limit: "100000",
    render: "0",
  });
  const _t0 = performance.now();
  const res = await fetch(`${API}/logs/usermonth?${params}`, { signal });
  if (!res.ok) return [];
  const raw = await res.text();
  const _fetchMs = (performance.now() - _t0) | 0;
  const data = JSON.parse(raw) as any;
  let messages: LogMsg[] = data?.messages ?? [];
  console.debug(
    `[logs:fetchMonth] ${ch} ${y}-${mm} user=${u || "(all)"} → ${messages.length} msgs, ${(raw.length / 1024) | 0}KB, ${_fetchMs}ms`,
  );
  if (term) {
    const termLow = term.toLowerCase();
    messages = messages.filter((m) => m.text.toLowerCase().includes(termLow));
  }
  monthFetchCache.set(cacheKey, { data: messages, ts: Date.now() });
  preloadRowImages(messages);
  return messages;
}

function prevDay(d: Date): Date {
  const p = new Date(d);
  p.setDate(p.getDate() - 1);
  return p;
}
function nextDay(d: Date): Date {
  const n = new Date(d);
  n.setDate(n.getDate() + 1);
  return n;
}
function prevMonth(ym: { y: number; m: number }): { y: number; m: number } {
  return ym.m === 1 ? { y: ym.y - 1, m: 12 } : { y: ym.y, m: ym.m - 1 };
}
function nextMonth(ym: { y: number; m: number }): { y: number; m: number } {
  return ym.m === 12 ? { y: ym.y + 1, m: 1 } : { y: ym.y, m: ym.m + 1 };
}

async function prependMsgs(newMsgs: LogMsg[]) {
  const body = getBody();
  const existingIds = new Set(msgs.value.map((m) => m.id));
  const deduped = newMsgs.filter((m) => !existingIds.has(m.id));
  if (!deduped.length) return;

  // >>> anchor = id + pixel offset of first visible row; a scrollHeight-delta alone under-corrects since far rows are height-estimated until measured, which caused a "stuck at top" reload loop
  let anchorId: string | null = null;
  let anchorOffset = 0;
  if (body) {
    const containerTop = body.getBoundingClientRect().top;
    const rows = body.querySelectorAll<HTMLElement>("[data-vit-id]");
    for (const el of rows) {
      const r = el.getBoundingClientRect();
      if (r.bottom > containerTop) {
        // <<< first row still (at least partially) visible
        anchorId = el.id;
        anchorOffset = r.top - containerTop;
        break;
      }
    }
  }

  // >>> fallback metrics if anchor row was trimmed off
  const preScrollTop = body?.scrollTop ?? 0;
  const preScrollHeight = body?.scrollHeight ?? 0;

  let next = [...deduped, ...msgs.value];
  if (next.length > MSG_MAX_SHOWN) {
    const firstTrimmed = next[MSG_MAX_SHOWN]!;
    const ts = new Date(firstTrimmed.timestamp);
    cursorNewerDate = new Date(ts.getFullYear(), ts.getMonth(), ts.getDate());
    cursorNewerMonth = { y: ts.getFullYear(), m: ts.getMonth() + 1 };
    // >>> evict cached heights for trimmed messages so the map doesn't grow unbounded
    for (const m of next.slice(MSG_MAX_SHOWN)) vHeightCache.delete(m.id);
    next = next.slice(0, MSG_MAX_SHOWN);
    noNewer.value = false;
  }

  // >>> shift vWinStart/vWinEnd by insert count before the reactive update lands, else the next render points at a stale slice - caused a "jumps to the middle" bug
  const shift = deduped.length;
  vWinStart.value += shift;
  vWinEnd.value += shift;

  msgs.value = next;
  await nextTick();
  if (!body) return;

  // >>> ensure anchor row is mounted before re-measuring - the shift estimate can be off by 1-2 when a day separator was inserted
  if (anchorId) {
    const idx = displayItems.value.findIndex(
      (it) => domIdForDisplayItem(it) === anchorId,
    );
    if (idx >= 0) await ensureIndexRendered(idx, 20);
  }

  const anchorEl = anchorId ? document.getElementById(anchorId) : null;
  if (anchorEl) {
    // >>> put the exact same row back at the exact same on-screen offset
    const containerTop = body.getBoundingClientRect().top;
    const newOffset = anchorEl.getBoundingClientRect().top - containerTop;
    body.scrollTop += newOffset - anchorOffset;
  } else {
    // >>> fallback: scrollHeight-delta correction if anchor row got trimmed (rare)
    const postScrollHeight = body.scrollHeight;
    const delta = postScrollHeight - preScrollHeight;
    if (delta !== 0) body.scrollTop = preScrollTop + delta;
  }

  // >>> re-snap window to corrected scroll pos, heals drift from the index-shift estimate
  vUpdateWindow();
  updateCustomScrollbar();
}

async function appendMsgs(newMsgs: LogMsg[]) {
  const body = getBody();
  const existingIds = new Set(msgs.value.map((m) => m.id));
  const deduped = newMsgs.filter((m) => !existingIds.has(m.id));
  if (!deduped.length) return;

  const preScrollTop = body?.scrollTop ?? 0;

  let next = [...msgs.value, ...deduped];
  let trimCount = 0;
  let removedHeight = 0;
  if (next.length > MSG_MAX_SHOWN) {
    trimCount = next.length - MSG_MAX_SHOWN;
    const lastTrimmed = next[trimCount - 1]!;
    const ts = new Date(lastTrimmed.timestamp);
    cursorDate = new Date(ts.getFullYear(), ts.getMonth(), ts.getDate());
    cursorMonth = { y: ts.getFullYear(), m: ts.getMonth() + 1 };
    // >>> track height trimmed off the oldest end - that's exactly how far scrollTop must move up
    for (let i = 0; i < trimCount; i++) {
      const m = next[i]!;
      removedHeight += vHeightCache.get(m.id) ?? VIRT_EST_H;
      vHeightCache.delete(m.id);
    }
    next = next.slice(trimCount);
    noMore.value = false;
  }

  if (trimCount > 0) {
    vWinStart.value = Math.max(0, vWinStart.value - trimCount);
    vWinEnd.value = Math.max(vWinStart.value, vWinEnd.value - trimCount);
  }

  msgs.value = next;
  await nextTick();
  if (!body) return;

  if (trimCount > 0 && removedHeight !== 0) {
    body.scrollTop = Math.max(0, preScrollTop - removedHeight);
  }

  vUpdateWindow();
  updateCustomScrollbar();
  // >>> browser scroll anchoring handles pure appends automatically
}

async function loadOlder() {
  if (loadingMore.value || noMore.value) return;
  const ch = channel.value.trim().toLowerCase().replace(/^#/, "");
  const signal = abortCtrl.signal;
  const cutoff = new Date();
  cutoff.setFullYear(cutoff.getFullYear() - 2);

  if (userFilter.value.trim()) {
    if (!cursorMonth) {
      noMore.value = true;
      return;
    }
    const cur = cursorMonth;
    if (new Date(cur.y, cur.m - 1, 1) < cutoff) {
      noMore.value = true;
      return;
    }
    loadingMore.value = true;
    await nextTick();
    try {
      const full = await fetchMonth(ch, cur.y, cur.m, signal);
      if (signal.aborted) {
        loadingMore.value = false;
        return;
      }
      cursorMonth = prevMonth(cur);
      if (full.length > 0) await prependMsgs(full);
      else {
        loadingMore.value = false;
        return loadOlder();
      }
    } catch { }
    loadingMore.value = false;
  } else {
    if (!cursorDate) {
      noMore.value = true;
      return;
    }
    const d = cursorDate;
    if (d < cutoff) {
      noMore.value = true;
      return;
    }
    loadingMore.value = true;
    await nextTick();
    try {
      const full = await fetchDay(
        ch,
        d.getFullYear(),
        d.getMonth() + 1,
        d.getDate(),
        signal,
      );
      if (signal.aborted) {
        loadingMore.value = false;
        return;
      }
      cursorDate = prevDay(d);
      if (full.length > 0) await prependMsgs(full);
      else {
        loadingMore.value = false;
        return loadOlder();
      }
    } catch { }
    loadingMore.value = false;
  }
  // >>> guard: keep scrollTop past the trigger threshold so mobile doesn't immediately re-fire loadOlder
  await nextTick();
  const body = getBody();
  if (body && body.scrollTop < 180) body.scrollTop = 180;
}

async function loadNewer() {
  if (loadingNewer.value || noNewer.value) return;
  const ch = channel.value.trim().toLowerCase().replace(/^#/, "");
  const signal = abortCtrl.signal;
  const today = new Date();
  today.setHours(23, 59, 59, 999);

  if (userFilter.value.trim()) {
    if (!cursorNewerMonth) {
      noNewer.value = true;
      return;
    }
    loadingNewer.value = true;
    const cur = cursorNewerMonth;
    cursorNewerMonth = nextMonth(cur);
    if (new Date(cur.y, cur.m - 1, 1) > today) {
      noNewer.value = true;
      loadingNewer.value = false;
      return;
    }
    try {
      const newMsgs = await fetchMonth(ch, cur.y, cur.m, signal);
      if (signal.aborted) {
        loadingNewer.value = false;
        return;
      }
      if (newMsgs.length > 0) await appendMsgs(newMsgs);
      else {
        loadingNewer.value = false;
        return loadNewer();
      }
    } catch { }
    loadingNewer.value = false;
    if (new Date(cursorNewerMonth.y, cursorNewerMonth.m - 1, 1) > today)
      noNewer.value = true;
  } else {
    if (!cursorNewerDate) {
      noNewer.value = true;
      return;
    }
    loadingNewer.value = true;
    const d = cursorNewerDate;
    cursorNewerDate = nextDay(d);
    if (d > today) {
      noNewer.value = true;
      loadingNewer.value = false;
      return;
    }
    try {
      const newMsgs = await fetchDay(
        ch,
        d.getFullYear(),
        d.getMonth() + 1,
        d.getDate(),
        signal,
      );
      if (signal.aborted) {
        loadingNewer.value = false;
        return;
      }
      if (newMsgs.length > 0) await appendMsgs(newMsgs);
      else {
        loadingNewer.value = false;
        return loadNewer();
      }
    } catch { }
    loadingNewer.value = false;
    if (cursorNewerDate > today) noNewer.value = true;
  }
}

async function loadUntilMsg(targetId: string): Promise<boolean> {
  const cutoff = new Date();
  cutoff.setFullYear(cutoff.getFullYear() - 2);
  const ch = channel.value.trim().toLowerCase().replace(/^#/, "");
  const signal = abortCtrl.signal;
  while (true) {
    if (msgs.value.some((m) => m.id === targetId)) return true;
    if (signal.aborted) return false;
    if (userFilter.value.trim()) {
      if (!cursorMonth) return false;
      const cur = cursorMonth;
      cursorMonth = prevMonth(cur);
      if (new Date(cur.y, cur.m - 1, 1) < cutoff) {
        noMore.value = true;
        return false;
      }
      try {
        const newMsgs = await fetchMonth(ch, cur.y, cur.m, signal);
        if (newMsgs.length > 0) await prependMsgs(newMsgs);
      } catch {
        return false;
      }
    } else {
      if (!cursorDate || cursorDate < cutoff) {
        noMore.value = true;
        return false;
      }
      const d = cursorDate;
      cursorDate = prevDay(d);
      try {
        const newMsgs = await fetchDay(
          ch,
          d.getFullYear(),
          d.getMonth() + 1,
          d.getDate(),
          signal,
        );
        if (newMsgs.length > 0) await prependMsgs(newMsgs);
      } catch {
        return false;
      }
    }
  }
}

async function loadDayForCurrentFilters(
  ch: string,
  d: Date,
): Promise<LogMsg[]> {
  if (userFilter.value.trim()) {
    const monthMsgs = await fetchMonth(
      ch,
      d.getFullYear(),
      d.getMonth() + 1,
      abortCtrl.signal,
    );
    const dayKey = d.toISOString().slice(0, 10);
    return monthMsgs.filter((msg) => msg.timestamp.startsWith(dayKey));
  }
  return fetchDay(
    ch,
    d.getFullYear(),
    d.getMonth() + 1,
    d.getDate(),
    abortCtrl.signal,
  );
}

async function jumpOneDayUp() {
  if (isMobileView.value) return;
  const ch = channel.value.trim().toLowerCase().replace(/^#/, "");
  if (!ch) return;
  const baseLabel = viewportDayLabel.value;
  if (!baseLabel) return;
  const base = parseDayLabel(baseLabel);
  if (!base) return;

  let target = new Date(base);
  target.setDate(target.getDate() - 1);
  let targetLabel = fmtDayFromDate(target);

  let targetIndex = displayItems.value.findIndex(
    (it) => it.kind === "day" && it.label === targetLabel,
  );
  if (targetIndex < 0) {
    // >>> walk backward through empty days until one has messages, else the button silently did nothing on a quiet day
    const cutoff = new Date();
    cutoff.setFullYear(cutoff.getFullYear() - 2);
    let safety = 0;
    while (targetIndex < 0 && target >= cutoff && safety++ < 400) {
      const dayMsgs = await loadDayForCurrentFilters(ch, target);
      if (dayMsgs.length) {
        await prependMsgs(dayMsgs);
        await nextTick();
        targetIndex = displayItems.value.findIndex(
          (it) => it.kind === "day" && it.label === targetLabel,
        );
        // >>> keep loadOlder()'s cursor in sync with what this jump walked past, so scroll-back doesn't re-fetch the same empty days
        if (!userFilter.value.trim()) {
          const dayBefore = new Date(target);
          dayBefore.setDate(dayBefore.getDate() - 1);
          if (!cursorDate || dayBefore < cursorDate) cursorDate = dayBefore;
        }
        break;
      }
      target = prevDay(target);
      targetLabel = fmtDayFromDate(target);
      targetIndex = displayItems.value.findIndex(
        (it) => it.kind === "day" && it.label === targetLabel,
      );
    }
  }

  // >>> after prepend the target day isn't in the render window yet; ensureIndexRendered() widens it first
  if (targetIndex >= 0) await scrollToDisplayIndexAsync(targetIndex);
}

let _resizeStartX = 0;
let _resizeStartW = 0;
function onResizeMove(ev: PointerEvent) {
  const wrap = tableWrapRef.value;
  if (!wrap) return;
  const maxW = Math.max(460, wrap.clientWidth - 18);
  const minW = 320;
  const next = Math.max(
    minW,
    Math.min(maxW, _resizeStartW + (ev.clientX - _resizeStartX)),
  );
  desktopLogWidth.value = next;
}

function endResizeDrag() {
  window.removeEventListener("pointermove", onResizeMove);
  window.removeEventListener("pointerup", endResizeDrag);
  document.body.style.userSelect = "";
}

function startResizeDrag(ev: PointerEvent) {
  if (isMobileView.value) return;
  ev.preventDefault();
  ev.stopPropagation();
  const shell = tableShellRef.value;
  if (!shell) return;
  _resizeStartX = ev.clientX;
  _resizeStartW = shell.offsetWidth;
  desktopLogWidth.value = shell.offsetWidth;
  document.body.style.userSelect = "none";
  window.addEventListener("pointermove", onResizeMove);
  window.addEventListener("pointerup", endResizeDrag);
}

let wheelScrollActive = false;
let wheelIdleTimer: number | null = null;
function scheduleWheelIdleCheck() {
  if (wheelIdleTimer !== null) window.clearTimeout(wheelIdleTimer);
  wheelIdleTimer = window.setTimeout(() => {
    wheelIdleTimer = null;
    wheelScrollActive = false;
    checkPaints();
  }, 120);
}

function onWheel() {
  wheelScrollActive = true;
  scheduleWheelIdleCheck();
}

function onScroll() {
  if (rafScrollPending) return;
  rafScrollPending = true;
  requestAnimationFrame(() => {
    rafScrollPending = false;
    const body = getBody();
    if (!body) return;
    const distFromBottom =
      body.scrollHeight - body.clientHeight - body.scrollTop;
    isNearBottom.value = distFromBottom < 200;
    if (!loadingMore.value && !noMore.value && body.scrollTop < 120)
      loadOlder();
    if (!loadingNewer.value && !noNewer.value && distFromBottom < 120)
      loadNewer();
    // >>> oldest-first mode is reversed: hitting bottom means going further back in time
    if (direction.value === "oldest") {
      if (!loadingNewer.value && !noNewer.value && body.scrollTop < 120)
        loadNewer();
      if (!loadingMore.value && !noMore.value && distFromBottom < 120)
        loadOlder();
    }
    vUpdateWindow();
    updateCustomScrollbar();
    if (!wheelScrollActive) checkPaints();
  });
}

// vvv Custom scrollbar vvv
function updateCustomScrollbar() {
  const body = getBody();
  const bar = customScrollbarRef.value;
  if (!body || !bar) return;
  const trackH = bar.clientHeight;
  const ratio =
    body.scrollHeight > 0 ? body.clientHeight / body.scrollHeight : 1;
  const thumbH = Math.max(28, ratio * trackH);
  const maxScroll = body.scrollHeight - body.clientHeight;
  const top =
    maxScroll > 0 ? (body.scrollTop / maxScroll) * (trackH - thumbH) : 0;
  customThumbTop.value = top;
  customThumbH.value = thumbH;
}

function onCustomScrollbarTrackPointerDown(ev: PointerEvent) {
  if (ev.button !== 0) return;
  const body = getBody();
  const bar = customScrollbarRef.value;
  if (!body || !bar) return;
  const rect = bar.getBoundingClientRect();
  const trackH = rect.height;
  const thumbH = customThumbH.value;
  const clickY = ev.clientY - rect.top;
  // >>> clicking the thumb itself shouldn't jump - let onThumbDragStart handle it
  if (clickY >= customThumbTop.value && clickY <= customThumbTop.value + thumbH)
    return;
  const newTop = Math.max(0, Math.min(trackH - thumbH, clickY - thumbH / 2));
  const maxScroll = body.scrollHeight - body.clientHeight;
  body.scrollTop =
    maxScroll > 0 ? (newTop / Math.max(1, trackH - thumbH)) * maxScroll : 0;
  ev.preventDefault();
}

let _thumbDragStartY = 0;
let _thumbDragStartST = 0;

function onThumbDragStart(ev: PointerEvent) {
  if (ev.button !== 0) return;
  const body = getBody();
  if (!body) return;
  _thumbDragStartY = ev.clientY;
  _thumbDragStartST = body.scrollTop;
  (ev.currentTarget as HTMLElement).setPointerCapture(ev.pointerId);
  window.addEventListener("pointermove", onThumbDragMove);
  window.addEventListener("pointerup", onThumbDragEnd, { once: true });
  ev.preventDefault();
}

function onThumbDragMove(ev: PointerEvent) {
  const body = getBody();
  const bar = customScrollbarRef.value;
  if (!body || !bar) return;
  const trackH = bar.clientHeight;
  const thumbH = customThumbH.value;
  const maxThumb = trackH - thumbH;
  const maxScroll = body.scrollHeight - body.clientHeight;
  const dy = ev.clientY - _thumbDragStartY;
  const ratio = maxThumb > 0 ? dy / maxThumb : 0;
  body.scrollTop = _thumbDragStartST + ratio * maxScroll;
}

function onThumbDragEnd() {
  window.removeEventListener("pointermove", onThumbDragMove);
}
// vvv /Custom scrollbar vvv

function attachScrollListener() {
  if (scrollListenerAttached) return;
  const body = getBody();
  if (!body) return;
  body.addEventListener("scroll", onScroll, { passive: true });
  body.addEventListener("wheel", onWheel, { passive: true });
  scrollListenerAttached = true;
}

function detachScrollListeners() {
  const body = getBody();
  if (body) {
    body.removeEventListener("scroll", onScroll);
    body.removeEventListener("wheel", onWheel);
  }
  if (wheelIdleTimer !== null) {
    window.clearTimeout(wheelIdleTimer);
    wheelIdleTimer = null;
  }
  wheelScrollActive = false;
  scrollListenerAttached = false;
}

// >>> Fetch automod messages for current day (broadcaster-only)
async function fetchAutomod(ch: string, date?: string) {
  automodMsgs.value = [];
  isBroadcaster.value = session.value?.login === ch;
  if (!isBroadcaster.value || !session.value) return;
  try {
    const d = date ? new Date(date) : new Date();
    const y = d.getFullYear();
    const mo = String(d.getMonth() + 1).padStart(2, "0");
    const dy = String(d.getDate()).padStart(2, "0");
    const res = await fetch(
      `${API}/logs/automod/${ch}?year=${y}&month=${mo}&day=${dy}`,
      {
        headers: { Authorization: `Bearer ${session.value.token}` },
      },
    );
    if (res.ok) {
      const data = (await res.json()) as { messages: AutomodMsg[] };
      automodMsgs.value = data.messages ?? [];
    }
  } catch { }
}

// >>> Fetch the oldest available log date for a channel (for oldest-first mode)
async function fetchOldestDate(ch: string): Promise<Date> {
  try {
    const res = await fetch(`${API}/logs/available/${ch}`, {
      headers: { Authorization: `Bearer ${session.value!.token}` },
    });
    if (res.ok) {
      const data = (await res.json()) as {
        months: { year: number; month: number }[];
      };
      const months = data.months ?? [];
      if (months.length) {
        const oldest = months[months.length - 1]!; // <<< sorted newest-first, so last = oldest
        return new Date(Date.UTC(oldest.year, oldest.month - 1, 1));
      }
    }
  } catch { }
  // >>> fallback: 2 years ago
  const d = new Date();
  d.setFullYear(d.getFullYear() - 2);
  return d;
}

// vvv main search vvv
async function search() {
  readInputs();
  if (!channel.value.trim()) {
    error.value = "Channel is required.";
    return;
  }
  activeSearchJob.value += 1;
  visualsPhaseActive.value = false;
  setSearchJobPhase("fetch");
  const _dbgT0 = performance.now();
  console.debug("[logs:search] started", {
    channel: channel.value,
    dateFrom: dateFrom.value,
    dateUntil: dateUntil.value,
    user: userFilter.value,
  });

  const hashId = readHashId();
  pushSearchUrl();

  abortCtrl.abort();
  abortCtrl = new AbortController();
  detachScrollListeners();

  if (isMobile()) searchExpanded.value = false;
  loading.value = true;
  error.value = "";
  searched.value = true;
  msgs.value = [];
  noMore.value = false;
  loadingMore.value = false;
  highlightId.value = null;
  noNewer.value = true;
  loadingNewer.value = false;
  isNearBottom.value = true;
  _rowCache.clear(); // <<< ensure badges re-track twitchBadgeMap on first render
  vHeightCache.clear();
  vWinStart.value = 0;
  vWinEnd.value = 150;
  paintQueue.length = 0;
  pendingPaintJobs.value = 0;
  paintConcurrent = 0;
  paintAutoRequested = 0;
  bulkFetchDone = false;
  cursorDate = null;
  cursorMonth = null;
  cursorNewerDate = null;
  cursorNewerMonth = null;
  const ch = channel.value.trim().toLowerCase().replace(/^#/, "");
  preloadChannelAssets(ch);
  fetchEmotes(ch);
  fetchTwitchBadges(ch);
  fetchAutomod(ch, dateFrom.value || undefined);
  const today = new Date();
  const isUser = !!userFilter.value.trim();

  // >>> date range: fetch each day individually and merge
  if (dateFrom.value) {
    const startDate = new Date(dateFrom.value + "T00:00:00");
    const endDate = dateUntil.value
      ? new Date(dateUntil.value + "T00:00:00")
      : startDate;
    // >>> safety cap: max 90 day range
    const maxRange = 90;
    const diffDays = Math.round(
      (endDate.getTime() - startDate.getTime()) / 86_400_000,
    );
    if (diffDays < 0) {
      error.value = "End date must be after start date.";
      loading.value = false;
      return;
    }
    if (diffDays > maxRange) {
      error.value = `Date range too large (max ${maxRange} days).`;
      loading.value = false;
      return;
    }

    try {
      // >>> fetch days concurrently (capped) instead of serially - each hits its own cache key so it's safe to parallelize
      const RANGE_FETCH_CONCURRENCY = 6;
      const days: Date[] = [];
      for (
        const d = new Date(startDate);
        d <= endDate;
        d.setDate(d.getDate() + 1)
      )
        days.push(new Date(d));

      const results: LogMsg[][] = new Array(days.length);
      let cursor = 0;
      async function worker() {
        while (cursor < days.length) {
          const i = cursor++;
          if (abortCtrl.signal.aborted) return;
          const d = days[i]!;
          results[i] = isUser
            ? await fetchMonth(
              ch,
              d.getFullYear(),
              d.getMonth() + 1,
              abortCtrl.signal,
            ).then((ms) =>
              ms.filter((msg) =>
                msg.timestamp.startsWith(d.toISOString().slice(0, 10)),
              ),
            )
            : await fetchDay(
              ch,
              d.getFullYear(),
              d.getMonth() + 1,
              d.getDate(),
              abortCtrl.signal,
            );
        }
      }
      await Promise.all(
        Array.from(
          { length: Math.min(RANGE_FETCH_CONCURRENCY, days.length) },
          worker,
        ),
      );
      msgs.value = results.flat();
    } catch { }
    loading.value = false;
    noMore.value = true;
    await nextTick();
    // >>> must attach scroll listener here or the virtual window/scrollbar/jump-to-newest never update after a date search (view looked "stuck")
    attachScrollListener();
    vUpdateWindow();
    updateCustomScrollbar();
    if (hashId) await jumpToMessage(hashId);
    else scrollToBottom();
    return;
  }

  // >>> Oldest-first: find the oldest available date and load from there going forward
  if (direction.value === "oldest") {
    const startDate = await fetchOldestDate(ch);
    const nextDay = (d: Date) => {
      const n = new Date(d);
      n.setDate(n.getDate() + 1);
      return n;
    };
    const nextMonth = (ym: { y: number; m: number }) =>
      ym.m === 12 ? { y: ym.y + 1, m: 1 } : { y: ym.y, m: ym.m + 1 };

    if (isUser) {
      let cur = { y: startDate.getFullYear(), m: startDate.getMonth() + 1 };
      try {
        msgs.value = await fetchMonth(ch, cur.y, cur.m, abortCtrl.signal);
      } catch { }
      // >>> walk forward until we find messages
      while (!msgs.value.length && !abortCtrl.signal.aborted) {
        cur = nextMonth(cur);
        if (new Date(cur.y, cur.m - 1, 1) > today) break;
        try {
          msgs.value = await fetchMonth(ch, cur.y, cur.m, abortCtrl.signal);
        } catch { }
      }
      // >>> cursorMonth now points to the next month, for loading newer
      cursorMonth = nextMonth(cur);
    } else {
      let d = new Date(startDate);
      try {
        msgs.value = await fetchDay(
          ch,
          d.getFullYear(),
          d.getMonth() + 1,
          d.getDate(),
          abortCtrl.signal,
        );
      } catch { }
      while (!msgs.value.length && d <= today && !abortCtrl.signal.aborted) {
        d = nextDay(d);
        try {
          msgs.value = await fetchDay(
            ch,
            d.getFullYear(),
            d.getMonth() + 1,
            d.getDate(),
            abortCtrl.signal,
          );
        } catch { }
      }
      cursorDate = nextDay(d);
    }
    loading.value = false;
    await nextTick();
    attachScrollListener();
    vUpdateWindow();
    updateCustomScrollbar();
    // >>> oldest-first: scroll to top (earliest messages)
    nextTick(() => {
      const b = getBody();
      if (b) b.scrollTop = 0;
      vUpdateWindow();
    });
    return;
  }

  if (isUser) {
    const y = today.getFullYear(),
      m = today.getMonth() + 1;
    let _raw: LogMsg[] = [];
    try {
      _raw = await fetchMonth(ch, y, m, abortCtrl.signal);
    } catch { }
    msgs.value = _raw;
    cursorMonth = prevMonth({ y, m });
    // >>> If current month empty, walk backwards up to 1 year to find logs
    if (!msgs.value.length && !abortCtrl.signal.aborted) {
      const cutoff = new Date();
      cutoff.setFullYear(cutoff.getFullYear() - 1);
      while (!msgs.value.length && cursorMonth && !abortCtrl.signal.aborted) {
        const cur: { y: number; m: number } = cursorMonth!;
        if (new Date(cur.y, cur.m - 1, 1) < cutoff) break;
        cursorMonth = prevMonth(cur);
        let _wr: LogMsg[] = [];
        try {
          _wr = await fetchMonth(ch, cur.y, cur.m, abortCtrl.signal);
        } catch { }
        msgs.value = _wr;
      }
    }
    loading.value = false;
    if (hashId) {
      if (!msgs.value.some((msg) => msg.id === hashId)) {
        const found = await loadUntilMsg(hashId);
        if (found) await jumpToMessage(hashId);
        else {
          scrollToBottom();
          error.value = "Could not find linked message.";
        }
      } else {
        await jumpToMessage(hashId);
      }
    } else {
      scrollToBottom();
    }
  } else {
    let _raw: LogMsg[] = [];
    try {
      _raw = await fetchDay(
        ch,
        today.getFullYear(),
        today.getMonth() + 1,
        today.getDate(),
        abortCtrl.signal,
      );
    } catch { }
    msgs.value = _raw;
    cursorDate = prevDay(today);
    // >>> If today empty, walk backwards up to 1 year to find logs
    if (!msgs.value.length && !abortCtrl.signal.aborted) {
      const cutoff = new Date();
      cutoff.setFullYear(cutoff.getFullYear() - 1);
      while (
        !msgs.value.length &&
        cursorDate &&
        cursorDate > cutoff &&
        !abortCtrl.signal.aborted
      ) {
        const d: Date = cursorDate!;
        cursorDate = prevDay(d);
        let _wr: LogMsg[] = [];
        try {
          _wr = await fetchDay(
            ch,
            d.getFullYear(),
            d.getMonth() + 1,
            d.getDate(),
            abortCtrl.signal,
          );
        } catch { }
        msgs.value = _wr;
      }
    }
    loading.value = false;
    if (hashId) {
      if (!msgs.value.some((msg) => msg.id === hashId)) {
        const found = await loadUntilMsg(hashId);
        if (found) await jumpToMessage(hashId);
        else {
          scrollToBottom();
          error.value = "Could not find linked message.";
        }
      } else {
        await jumpToMessage(hashId);
      }
    } else {
      scrollToBottom();
    }
  }

  const _dbgTDone = performance.now();
  console.debug(
    `[logs:search] done - ${msgs.value.length} msgs, total=${(_dbgTDone - _dbgT0) | 0}ms`,
  );

  await nextTick();
  attachScrollListener();
  await autoFillIfShort();
  if (direction.value === "newest" && !hashId) scrollToBottom();
}

async function autoFillIfShort() {
  if (noMore.value) return;
  await nextTick();
  const body = getBody();
  if (!body) return;
  let safety = 0;
  while (
    body.scrollHeight <= body.clientHeight + 20 &&
    !noMore.value &&
    safety++ < 10
  ) {
    await loadOlder();
    await nextTick();
  }
}

async function setDirection(d: "newest" | "oldest") {
  if (d === direction.value) return;
  if (!searched.value) {
    // >>> nothing loaded yet, let the next search() use it
    direction.value = d;
    return;
  }

  const canReverseInPlace = d === "oldest" ? noMore.value : noNewer.value;
  if (!canReverseInPlace) {
    direction.value = d;
    await search();
    return;
  }

  direction.value = d;
  // >>> heights stay valid per-id after reversal, but the window needs a full reset (cumulative positions changed)
  vHeightCache.clear();
  vWinStart.value = 0;
  vWinEnd.value = Math.min(150, displayItems.value.length);
  await nextTick();
  const body = getBody();
  if (body) {
    if (d === "oldest") {
      body.scrollTop = 0;
    } else {
      body.scrollTop = body.scrollHeight;
    }
  }
  await nextTick();
  vUpdateWindow();
  updateCustomScrollbar();
}

function scrollToBottom() {
  nextTick(() => {
    const b = getBody();
    if (!b) return;
    let i = 0;
    const settle = () => {
      b.scrollTop = b.scrollHeight;
      if (++i < 8) requestAnimationFrame(settle);
    };
    settle();
  });
}

async function jumpToNewest() {
  await search();
}

async function scrollToMsg(id: string, highlight = false): Promise<void> {
  // >>> target row may exist in msgs but be virtualized out - widen the window before searching the dom, else this silently no-ops
  const idx = displayItems.value.findIndex(
    (it) => it.kind !== "day" && (it as any).msg?.id === id,
  );
  if (idx >= 0) await ensureIndexRendered(idx);
  await nextTick();
  const el = document.getElementById(`log-${id}`);
  if (!el) return;
  el.scrollIntoView({ behavior: "smooth", block: "center" });
  vUpdateWindow();
  if (highlight) {
    highlightId.value = id;
    setTimeout(() => {
      if (highlightId.value === id) highlightId.value = null;
    }, 3000);
  }
}

function hasMsg(id: string): boolean {
  return msgs.value.some((m) => m.id === id);
}

async function jumpToMessage(id: string): Promise<void> {
  const targetId = (id || "").trim();
  if (!targetId) return;

  pushHash(targetId);

  if (hasMsg(targetId)) {
    await scrollToMsg(targetId, true);
    return;
  }

  // >>> keep loading older chunks until target is found or exhausted
  let safety = 0;
  while (!hasMsg(targetId) && !noMore.value && safety++ < 60) {
    await loadOlder();
    await nextTick();
  }

  await scrollToMsg(targetId, true);
}

async function jumpToReplyParent(m: LogMsg): Promise<void> {
  const parentId = m.tags?.["reply-parent-msg-id"]?.trim() ?? "";
  if (!parentId) return;
  await jumpToMessage(parentId);
}

function shareMsg(m: LogMsg) {
  pushHash(m.id);
  highlightId.value = m.id;
  setTimeout(() => {
    if (highlightId.value === m.id) highlightId.value = null;
  }, 3000);
  navigator.clipboard.writeText(window.location.href).catch(() => { });
  copyToast.value = true;
  setTimeout(() => (copyToast.value = false), 2000);
}

onMounted(async () => {
  document.body.classList.add("logs-open");
  // >>> warm logo decode once so the indicator appears instantly
  const preload = new Image();
  preload.src = loadingOverlayLogoUrl;
  readUrlState();
  if (!channel.value && session.value?.channel)
    channel.value = session.value.channel;
  // >>> inputs are read from DOM not v-model; must also write DOM here, or readInputs() reads back an empty value over channel.value -> false "Channel is required"
  await nextTick();
  if (channelInputRef.value) channelInputRef.value.value = channel.value;
  if (userInputRef.value) userInputRef.value.value = userFilter.value;
  if (termInputRef.value) termInputRef.value.value = termFilter.value;
  syncViewportMode();
  window.addEventListener("resize", syncViewportMode);
  document.addEventListener("click", onDocClickVisuals, true);
  if (channel.value) await search();
});
onUnmounted(() => {
  document.body.classList.remove("logs-open");
  document.body.classList.remove("logs-jobs-running");
  abortCtrl.abort();
  detachScrollListeners();
  endResizeDrag();
  window.removeEventListener("resize", syncViewportMode);
  document.removeEventListener("click", onDocClickVisuals, true);
  stopPopupDrag();
  const scrollerEl = getBody();
  if (scrollerEl) detachEmoteObserver(scrollerEl);
  vDetachObserver();
  if (_paintStyleEl) {
    _paintStyleEl.remove();
    _paintStyleEl = null;
  }
  _rowDomCache.clear();
});

// >>> attach/detach emote observer + event delegation whenever the scroller mounts
watch(scrollerRef, (newVal, oldVal) => {
  if (oldVal) {
    const el = oldVal as HTMLElement | null;
    if (el) {
      detachEmoteObserver(el);
      el.removeEventListener("click", onRowClick);
    }
    vDetachObserver();
  }
  if (newVal) {
    const el = newVal as HTMLElement | null;
    if (el) {
      attachEmoteObserver(el);
      el.addEventListener("click", onRowClick);
      vAttachObserver(el);
      nextTick(() => vUpdateWindow());
    }
  }
});

// >>> event delegation - v-html rows have no vue handlers, but this also covers client-rendered rows via shared css classes
function onRowClick(e: MouseEvent) {
  const t = e.target as HTMLElement;

  const userEl = t.closest(
    ".log-user-clickable[data-username]",
  ) as HTMLElement | null;
  if (userEl) {
    e.stopPropagation();
    openUserPopup(
      userEl.dataset.username!,
      userEl.dataset.channel || channel.value,
      e,
    );
    return;
  }

  const shareEl = t.closest(".log-share[data-msg-id]") as HTMLElement | null;
  if (shareEl) {
    e.stopPropagation();
    const msg = msgs.value.find((m) => m.id === shareEl.dataset.msgId);
    if (msg) shareMsg(msg);
    return;
  }

  const replyEl = t.closest(
    ".reply-context-link[data-reply-parent-id]",
  ) as HTMLElement | null;
  if (replyEl) {
    e.stopPropagation();
    jumpToMessage(replyEl.dataset.replyParentId!);
    return;
  }
}

// >>> paint styles applied via a <style> sheet (not inline) so v-html rows update too
let _paintStyleEl: HTMLStyleElement | null = null;

function jsToCssProp(prop: string): string {
  if (prop.startsWith("--")) return prop;
  if (prop.startsWith("Webkit"))
    return (
      "-webkit-" +
      prop
        .slice(6)
        .replace(/([A-Z])/g, "-$1")
        .toLowerCase()
    );
  return prop.replace(/([A-Z])/g, "-$1").toLowerCase();
}

// >>> paint css watcher registered below, after paintStyles is declared

// vvv rendering vvv
function fmtTs(ts: string) {
  const d = new Date(ts);
  return (
    d.toLocaleDateString("de-DE", {
      day: "2-digit",
      month: "2-digit",
      year: "2-digit",
    }) +
    " " +
    d.toLocaleTimeString("de-DE", {
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    })
  );
}

function fmtTimeOnly(ts: string) {
  const d = new Date(ts);
  return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function automodTagLabel(status: string): string {
  const label = status === "held" ? "Hold" : status.charAt(0).toUpperCase() + status.slice(1);
  return `Automod: ${label}`;
}

function fmtDayLabel(ts: string) {
  const d = new Date(ts);
  return d.toLocaleDateString("de-DE", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  });
}

type DisplayItem =
  | { kind: "day"; id: string; label: string }
  | { kind: "msg"; id: string; msg: LogMsg }
  | { kind: "automod"; id: string; msg: AutomodMsg };

function domIdForDisplayItem(it: DisplayItem): string {
  return it.kind === "day" ? `day-${it.id}` : `log-${it.msg.id}`;
}

// >>> merge sorted arrays instead of a full sort
function buildItems(
  messages: (LogMsg | AutomodMsg)[],
  _: any[],
): DisplayItem[] {
  const items: DisplayItem[] = [];
  let lastDay = "";
  const seenIds = new Set<string>();
  const seenDays = new Set<string>(); // <<< guards against duplicate separators if msgs aren't perfectly sorted
  for (const m of messages) {
    const msgId = m.id || `${m.timestamp}:${m.username}`;
    if (seenIds.has(msgId)) continue;
    seenIds.add(msgId);
    const day = fmtDayLabel(m.timestamp);
    if (day !== lastDay) {
      lastDay = day;
      if (!seenDays.has(day)) {
        seenDays.add(day);
        items.push({ kind: "day", id: `day-${day}`, label: day });
      }
    }
    if ((m as any)._automod) {
      items.push({ kind: "automod", id: msgId, msg: m as AutomodMsg });
    } else {
      items.push({ kind: "msg", id: msgId, msg: m as LogMsg });
    }
  }
  return items;
}

const displayItems = computed<DisplayItem[]>(() => {
  let regular = msgs.value;
  // >>> oldest-first mode: reverse so newest is at the top
  if (direction.value === "oldest") regular = [...regular].reverse();
  const automod = automodMsgs.value;
  if (!showAutomod.value || !isBroadcaster.value) {
    return buildItems(regular, []);
  }
  // >>> merge two sorted arrays by timestamp
  const merged: (LogMsg | AutomodMsg)[] = [];
  let i = 0,
    j = 0;
  while (i < regular.length && j < automod.length) {
    if (regular[i]!.timestamp <= automod[j]!.timestamp) {
      merged.push(regular[i++]!);
    } else {
      merged.push(automod[j++]!);
    }
  }
  while (i < regular.length) merged.push(regular[i++]!);
  while (j < automod.length) merged.push(automod[j++]!);
  return buildItems(merged, []);
});

type TimelineMarker = {
  key: string;
  color: string;
  topPct: number;
  index: number;
  anchorId: string;
  thin?: boolean;
  title: string;
};

function fmtDayFromDate(d: Date): string {
  const dd = String(d.getDate()).padStart(2, "0");
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const yyyy = String(d.getFullYear());
  return `${dd}.${mm}.${yyyy}`;
}

function parseDayLabel(label: string): Date | null {
  const m = /^(\d{2})\.(\d{2})\.(\d{4})$/.exec(label.trim());
  if (!m) return null;
  const d = new Date(Number(m[3]), Number(m[2]) - 1, Number(m[1]));
  return isNaN(d.getTime()) ? null : d;
}

function dayLabelForIndex(idx: number): string | null {
  const list = displayItems.value;
  const i0 = Math.max(0, Math.min(idx, list.length - 1));
  // >>> scan backward for a day separator; else derive from the message timestamp
  for (let i = i0; i >= 0; i--) {
    const it = list[i]!;
    if (it.kind === "day") return it.label;
  }
  // >>> no separator found above, use the timestamp of the item at idx
  const fallback = list[i0];
  if (fallback && fallback.kind !== "day" && fallback.msg)
    return fmtDayLabel(fallback.msg.timestamp);
  return null;
}

const viewportDayLabel = computed(() =>
  dayLabelForIndex(visibleStartIndex.value),
);
const jumpTargetDayLabel = computed(() => {
  const base = viewportDayLabel.value;
  if (!base) return null;
  const d = parseDayLabel(base);
  if (!d) return null;
  d.setDate(d.getDate() - 1);
  return fmtDayFromDate(d);
});

const tableShellStyle = computed(() => {
  if (isMobileView.value || desktopLogWidth.value === null) return {};
  return { width: `${desktopLogWidth.value}px`, flex: "0 0 auto" };
});

const timelineMarkers = computed<TimelineMarker[]>(() => {
  if (isMobileView.value) return [];
  const list = displayItems.value;
  if (!list.length) return [];
  const count = list.length;
  const out: TimelineMarker[] = [];

  for (let i = 0; i < count; i++) {
    const it = list[i]!;
    const topPct = (i / count) * 100;

    if (it.kind === "day") {
      out.push({
        key: `day-${i}`,
        color: "#3a3a3a",
        topPct,
        index: i,
        anchorId: `day-${it.id}`,
        thin: true,
        title: `Day: ${it.label}`,
      });
      continue;
    }

    if (it.kind === "automod") {
      out.push({
        key: `automod-${i}`,
        color: "#7a7a7a",
        topPct,
        index: i,
        anchorId: `log-${it.msg.id}`,
        title: "Ban/timeout (AutoMod)",
      });
      continue;
    }

    const msg = it.msg;
    const tags = msg.tags ?? {};
    const mid = String(tags["msg-id"] ?? "").toLowerCase();
    const isSub =
      mid === "sub" ||
      mid === "resub" ||
      mid === "subgift" ||
      mid === "submysterygift";
    const isFirst = tags["first-msg"] === "1";
    const isMod = !!msg._isMod;

    if (isSub)
      out.push({
        key: `sub-${i}`,
        color: "#755ebc",
        topPct,
        index: i,
        anchorId: `log-${msg.id}`,
        title: "Subscription event",
      });
    else if (isFirst)
      out.push({
        key: `first-${i}`,
        color: "#c832c8",
        topPct,
        index: i,
        anchorId: `log-${msg.id}`,
        title: "First-time chatter",
      });
    else if (isMod)
      out.push({
        key: `mod-${i}`,
        color: "#454545",
        topPct,
        index: i,
        anchorId: `log-${msg.id}`,
        title: "Ban/timeout message",
      });
  }

  return out;
});

// >>> widens the render window so a given index is guaranteed mounted, for deep-links/jump-to-day/timeline jumps
async function ensureIndexRendered(targetIndex: number, pad = 20) {
  const total = displayItems.value.length;
  if (targetIndex < 0 || targetIndex >= total) return;
  if (targetIndex >= vWinStart.value && targetIndex < vWinEnd.value) return;
  vWinStart.value = Math.max(0, targetIndex - pad);
  vWinEnd.value = Math.min(total, targetIndex + pad + 1);
  await nextTick();
}

function scrollToDisplayIndex(idx: number) {
  const item = displayItems.value[idx];
  if (!item) return;
  const elId = domIdForDisplayItem(item);
  const el = document.getElementById(elId);
  if (el) el.scrollIntoView({ block: "start" });
}

async function scrollToDisplayIndexAsync(idx: number) {
  await ensureIndexRendered(idx);
  await nextTick();
  scrollToDisplayIndex(idx);
  vUpdateWindow();
}

async function jumpToTimelineMarker(marker: TimelineMarker) {
  await scrollToDisplayIndexAsync(marker.index);
  await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
  const el = document.getElementById(marker.anchorId);
  if (el) el.scrollIntoView({ behavior: "smooth", block: "center" });
}

// >>> paint loading is background-only, must not block ui phase or overlay
const hasRunningJobs = computed(
  () => loading.value || loadingMore.value || domSettling.value,
);
const showFloatingFetch = computed(() => hasRunningJobs.value);
let floatingFetchStartedAt: number | null = null;

function loadingDebugSnapshot() {
  return {
    loading: loading.value,
    loadingMore: loadingMore.value,
    domSettling: domSettling.value,
    pendingPaintJobs: pendingPaintJobs.value,
    phase: searchJobPhase.value,
    msgs: msgs.value.length,
    displayItems: displayItems.value.length,
  };
}

function markDomSettling() {
  const token = ++domSettleToken;
  domSettling.value = true;
  void nextTick()
    .then(
      () =>
        new Promise<void>((resolve) => requestAnimationFrame(() => resolve())),
    )
    .then(
      () =>
        new Promise<void>((resolve) => requestAnimationFrame(() => resolve())),
    )
    .then(() => {
      if (token === domSettleToken) domSettling.value = false;
    });
}

function userColor(m: LogMsg): string {
  const tc = m.tags?.["color"];
  if (tc && tc !== "") return tc;
  const colors = [
    "#ff7f7f",
    "#ff9f40",
    "#ffcf56",
    "#6dd672",
    "#4ec9b0",
    "#56b6c2",
    "#9d6cff",
    "#c792ea",
    "#f78c6c",
    "#89ddff",
  ];
  let h = 0;
  for (let i = 0; i < m.username.length; i++)
    h = (h * 31 + m.username.charCodeAt(i)) & 0xffffffff;
  return colors[Math.abs(h) % colors.length]!;
}

function userColorByName(username: string): string {
  const colors = [
    "#ff7f7f",
    "#ff9f40",
    "#ffcf56",
    "#6dd672",
    "#4ec9b0",
    "#56b6c2",
    "#9d6cff",
    "#c792ea",
    "#f78c6c",
    "#89ddff",
  ];
  let h = 0;
  for (let i = 0; i < username.length; i++)
    h = (h * 31 + username.charCodeAt(i)) & 0xffffffff;
  return colors[Math.abs(h) % colors.length]!;
}

function renderMsg(text: string): string {
  return renderMsgWithMap(text, emoteMap.value);
}

// >>> overlay (zero-width) emotes stack absolutely over the preceding base emote via .emote-stack
function renderMsgWithMap(text: string, em: EmoteMap): string {
  if (!Object.keys(em).length) return esc(text);

  // >>> tokenize into words/whitespace runs, preserving spaces for natural output
  const tokens = text.split(/( +)/);

  // >>> build rendered pieces first, then assemble stacks
  type Piece = { html: string; isOverlay: boolean; isEmote: boolean };
  const pieces: Piece[] = [];

  for (const tok of tokens) {
    if (!tok) continue;
    // >>> whitespace token, keep as-is
    if (/^ +$/.test(tok)) {
      pieces.push({ html: tok, isOverlay: false, isEmote: false });
      continue;
    }
    const entry = em[tok];
    if (!entry) {
      pieces.push({ html: esc(tok), isOverlay: false, isEmote: false });
      continue;
    }
    const cls = entry.overlay ? "chat-emote emote-overlay" : "chat-emote";
    const img = `<img class="${cls}" src="${entry.url}" alt="${esc(tok)}" title="${esc(tok)}" fetchpriority="high">`;
    pieces.push({ html: img, isOverlay: entry.overlay, isEmote: true });
  }

  // >>> overlays immediately after a base (whitespace ignored) get wrapped into .emote-stack; that whitespace is consumed
  let out = "";
  let i = 0;
  while (i < pieces.length) {
    const p = pieces[i]!;
    // >>> base emote: look ahead for overlays
    if (p.isEmote && !p.isOverlay) {
      // >>> collect overlays that follow, skipping whitespace-only gaps
      let j = i + 1;
      const overlays: string[] = [];
      while (j < pieces.length) {
        const next = pieces[j]!;
        if (!next.isEmote && /^ +$/.test(next.html)) {
          j++;
          continue;
        } // skip whitespace
        if (next.isEmote && next.isOverlay) {
          overlays.push(next.html);
          j++;
          continue;
        }
        break;
      }
      if (overlays.length) {
        out += `<span class="emote-stack">${p.html}${overlays.join("")}</span>`;
        i = j;
        continue;
      }
    }
    out += p.html;
    i++;
  }
  return out;
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function formatDisplayedMsg(m: LogMsg): string {
  const text = m.text ?? "";
  if (!m.tags?.["reply-parent-msg-id"]) return text;

  const candidates = [
    m.tags["reply-parent-display-name"],
    m.tags["reply-parent-user-login"],
  ].filter((x): x is string => !!x && !!x.trim());

  for (const raw of candidates) {
    const name = raw.trim().replace(/^@/, "");
    if (!name) continue;
    const rx = new RegExp(`^\\s*@?${escapeRegExp(name)}[:;,]?\\s+`, "i");
    if (rx.test(text)) return text.replace(rx, "");
  }

  return text;
}

function renderMsgForMessage(m: LogMsg): string {
  const key = (m.username ?? "").toLowerCase();
  const personal = personalEmoteMaps.value.get(key) ?? {};
  const merged: EmoteMap = { ...emoteMap.value, ...personal };
  return renderMsgWithMap(formatDisplayedMsg(m), merged);
}

function userNameStyle(m: LogMsg): Record<string, string> {
  if (plainUsernames.value)
    return {
      color: "#ffffff",
      "--snippet-fallback-color": "#ffffff",
      "--snippet-paint-preview": "#ffffff",
    };
  const fallback = userColor(m);
  const painted = hide7tv.value
    ? undefined
    : paintStyles.value.get(m.username?.toLowerCase() ?? "");
  return painted
    ? { ...painted, "--snippet-fallback-color": fallback }
    : {
      color: fallback,
      "--snippet-fallback-color": fallback,
      "--snippet-paint-preview": fallback,
    };
}

function snippetPaintPreview(m: LogMsg): string {
  const painted = paintStyles.value.get(m.username?.toLowerCase() ?? "");
  const preview = painted?.["--snippet-paint-preview"];
  if (typeof preview === "string" && preview.trim()) return preview;
  return userColor(m);
}

function isModerationSystemMessage(m: LogMsg): boolean {
  const u = String(m.username ?? "")
    .trim()
    .toLowerCase();
  const t = String(m.text ?? "")
    .trim()
    .toLowerCase();
  if (!u || !t) return false;
  return (
    t.startsWith(`${u} has been banned`) ||
    t.startsWith(`${u} has been timed out`) ||
    t.startsWith(`${u} was timed out`) ||
    t.includes(" has been banned") ||
    t.includes(" has been timed out") ||
    t.includes(" was timed out by ")
  );
}

function buildBadgeChips(m: LogMsg): BadgeChip[] {
  const out: BadgeChip[] = [];
  const tags = m.tags ?? {};
  const seen = new Set<string>();
  const sources = [tags["badges"] ?? "", tags["source-badges"] ?? ""];

  for (const src of sources) {
    const raw = src
      .split(",")
      .map((x) => x.trim())
      .filter(Boolean);
    for (const entry of raw) {
      const [setId = "", version = ""] = entry.split("/");
      if (!setId || !version) continue;
      const k = `${setId}/${version}`;
      if (seen.has(k)) continue;
      seen.add(k);
      const asset = twitchBadgeMap.value.get(k);
      out.push({
        key: k,
        label: setId,
        kind: "twitch",
        imageUrl: asset?.imageUrl,
        title: asset?.title ?? `${setId} ${version}`,
      });
    }
  }
  const sev = sevenTvBadgeMap.value.get((m.username ?? "").toLowerCase());
  if (!hide7tv.value && sev?.imageUrl) {
    out.push({
      key: "7tv",
      label: "7TV",
      kind: "seventv",
      imageUrl: sev.imageUrl,
      title: sev.title,
    });
  }
  return out;
}

function getEventMeta(m: LogMsg): EventMeta | null {
  const tags = m.tags ?? {};
  if (tags["first-msg"] === "1") {
    return { label: "First Message", icon: "✦", tone: "first" };
  }
  const msgId = String(tags["msg-id"] ?? "").toLowerCase();
  if (msgId === "sub" || msgId === "resub") {
    return { label: "Subscribed", icon: "★", tone: "sub" };
  }
  if (msgId === "subgift") {
    return { label: "Gift Subscription", icon: "★", tone: "sub" };
  }
  if (msgId === "submysterygift") {
    return { label: "Community Gift", icon: "★", tone: "sub" };
  }
  if (msgId === "announcement") {
    return { label: "Announcement", icon: "📣", tone: "announce" };
  }
  return null;
}

function isHighlightedEvent(m: LogMsg): boolean {
  return getEventMeta(m) !== null;
}

function eventToneClass(m: LogMsg): string {
  const meta = getEventMeta(m);
  return meta ? `tone-${meta.tone}` : "";
}

// >>> per-row render cache: badge/paint/html derivation is expensive and runs 2x/row (desktop+mobile); cache by id, bust on data change

interface RowData {
  html: string;
  badges: BadgeChip[];
  nameStyle: Record<string, string>;
  isMod: boolean;
  eventMeta: EventMeta | null;
  paintPreview: string;
}

const _rowCache = new Map<string, RowData>();
// >>> bumped on every cache invalidation so getRowData always has a reactive dep - without it, a nameColWidth re-render can lose the twitchBadgeMap dependency and badges won't reappear
const _rowCacheVersion = ref(0);
// >>> watch registered below, after paintStyles/personalEmoteMaps are declared

function getRowData(m: LogMsg): RowData {
  _rowCacheVersion.value; // <<< forces re-render when cache is cleared
  const key = m.id ?? `${m.timestamp}:${m.username}`;
  const cached = _rowCache.get(key);
  if (cached) return cached; // <<< O(1) path, no reactive access beyond _rowCacheVersion
  const d: RowData = {
    html: renderMsgForMessage(m),
    badges: buildBadgeChips(m),
    nameStyle: userNameStyle(m),
    isMod: isModerationSystemMessage(m),
    eventMeta: getEventMeta(m),
    paintPreview: snippetPaintPreview(m),
  };
  _rowCache.set(key, d);
  return d;
}

function esc(s: string) {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

// >>> 7tv paint via /twitch/user (resolves twitch id -> 7tv); keyed by lowercase username, null=no paint, undefined=not fetched
const paintCache = new Map<
  string,
  {
    stops: any[];
    shadows: any[];
    imageUrl: string | null;
    color?: number | null;
    angle?: number | null;
    function?: string | null;
    repeat?: boolean;
  } | null
>();
const paintStyles = ref<Map<string, Record<string, string>>>(new Map());
const personalEmoteMaps = ref<Map<string, EmoteMap>>(new Map());

// >>> bust row cache on any visual dep change; these maps are replaced atomically so a shallow watch is enough
watch(
  [
    emoteMap,
    personalEmoteMaps,
    paintStyles,
    twitchBadgeMap,
    sevenTvBadgeMap,
    hide7tv,
    plainUsernames,
  ],
  () => {
    _rowCache.clear();
    _rowCacheVersion.value++;
  },
);

// >>> Paint CSS watcher (registered here because paintStyles must be declared first).
watch([paintStyles, plainUsernames, hide7tv], () => {
  if (!_paintStyleEl) {
    _paintStyleEl = document.createElement("style");
    _paintStyleEl.id = "logs-dynamic-paints";
    document.head.appendChild(_paintStyleEl);
  }

  if (plainUsernames.value) {
    _paintStyleEl.textContent =
      ".logs-tbody [data-paint-user]{color:#ffffff !important;background-image:none !important;-webkit-text-fill-color:#ffffff !important;filter:none !important;--snippet-paint-preview:#ffffff !important;--snippet-fallback-color:#ffffff !important}";
    return;
  }

  if (hide7tv.value) {
    _paintStyleEl.textContent = "";
    return;
  }

  let css = "";
  for (const [username, style] of paintStyles.value) {
    const sel = `.logs-tbody [data-paint-user="${CSS.escape(username)}"]`;
    let rules = "";
    for (const [prop, val] of Object.entries(style)) {
      rules += `${jsToCssProp(prop)}:${val} !important;`;
    }
    css += `${sel}{${rules}}\n`;
  }
  _paintStyleEl.textContent = css;
});

const PAINT_MAX_CONCURRENT = 16; // <<< network bound, not cpu bound
const PAINT_AUTO_LIMIT = 80; // <<< covers a large viewport's worth of unique users
let paintConcurrent = 0;
const paintQueue: Array<{ key: string; jobId: number }> = [];
let paintAutoRequested = 0;

function intToRgba(c: number): string {
  const r = (c >>> 24) & 0xff;
  const g = (c >>> 16) & 0xff;
  const b = (c >>> 8) & 0xff;
  const a = (c & 0xff) / 255;
  return `rgba(${r},${g},${b},${a.toFixed(3)})`;
}

function intToOpaqueOnDark(c: number): string {
  const r = (c >>> 24) & 0xff;
  const g = (c >>> 16) & 0xff;
  const b = (c >>> 8) & 0xff;
  const a = (c & 0xff) / 255;
  // >>> match snippet bg (#0d0d10) so translucent paints keep their true hue
  const bgR = 13;
  const bgG = 13;
  const bgB = 16;
  const outR = Math.round(r * a + bgR * (1 - a));
  const outG = Math.round(g * a + bgG * (1 - a));
  const outB = Math.round(b * a + bgB * (1 - a));
  return `rgb(${outR}, ${outG}, ${outB})`;
}

function colorAlphaByte(c: number): number {
  return c & 0xff;
}

function buildPaintStyle(
  paint: {
    imageUrl: string | null;
    stops: { at: number; color: number }[];
    shadows: any[];
    color?: number | null;
    angle?: number | null;
    function?: string | null;
    repeat?: boolean;
  },
  fallbackColor?: string,
): Record<string, string> {
  const styles: Record<string, string> = {};
  const stopsArr = Array.isArray(paint.stops) ? paint.stops : [];
  const firstStopColor = stopsArr[0]?.color ?? 0;
  const normStops =
    stopsArr.length >= 2
      ? stopsArr
      : stopsArr.length === 1
        ? [
          { at: 0, color: firstStopColor },
          { at: 1, color: firstStopColor },
        ]
        : [];

  if (normStops.length >= 2) {
    const stops = normStops
      .map((s) => `${intToRgba(s.color)} ${Math.round((s.at ?? 0) * 100)}%`)
      .join(", ");
    const angle = Number.isFinite(paint.angle as number)
      ? Number(paint.angle)
      : 90;
    const fn = paint.repeat ? "repeating-linear-gradient" : "linear-gradient";
    const bestStop = normStops.reduce((best, cur) =>
      colorAlphaByte(cur.color) > colorAlphaByte(best.color) ? cur : best,
    );
    styles["--snippet-paint-preview"] = intToOpaqueOnDark(bestStop.color);
    styles["backgroundImage"] = `${fn}(${angle}deg, ${stops})`;
    styles["backgroundClip"] = "text";
    styles["WebkitBackgroundClip"] = "text";
    styles["color"] = "transparent";
    styles["WebkitTextFillColor"] = "transparent";
    styles["lineHeight"] = "1.1rem";
  } else if (paint.imageUrl) {
    if (paint.color !== null && paint.color !== undefined) {
      styles["--snippet-paint-preview"] = intToOpaqueOnDark(paint.color);
    } else if (fallbackColor) {
      styles["--snippet-paint-preview"] = fallbackColor;
    }
    styles["backgroundImage"] = `url(${paint.imageUrl})`;
    styles["backgroundSize"] = "cover";
    styles["backgroundPosition"] = "center center";
    if (paint.color !== null && paint.color !== undefined)
      styles["backgroundColor"] = intToRgba(paint.color);
    styles["backgroundClip"] = "text";
    styles["WebkitBackgroundClip"] = "text";
    styles["color"] = "transparent";
    styles["WebkitTextFillColor"] = "transparent";
    styles["lineHeight"] = "1.1rem";
  } else if (paint.color !== null && paint.color !== undefined) {
    styles["--snippet-paint-preview"] = intToOpaqueOnDark(paint.color);
    styles["color"] = intToRgba(paint.color);
  } else if (fallbackColor) {
    // >>> some 7tv paints are glow-only, no fill stops/color
    styles["--snippet-paint-preview"] = fallbackColor;
    styles["color"] = fallbackColor;
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

function drainPaintQueue() {
  while (paintConcurrent < PAINT_MAX_CONCURRENT && paintQueue.length > 0) {
    const next = paintQueue.shift();
    if (!next) break;
    paintConcurrent += 1;
    pendingPaintJobs.value += 1;
    void fetchPaint(next.key, next.jobId).finally(() => {
      paintConcurrent = Math.max(0, paintConcurrent - 1);
      pendingPaintJobs.value = Math.max(0, pendingPaintJobs.value - 1);
      drainPaintQueue();
    });
  }
}

// >>> writes into plain accumulator maps (no reactivity); call commitCosmetics() once after the loop for one atomic update
function applyCosmetic(
  key: string,
  data: {
    paint?: any;
    sevenTv?: {
      badge?: { id?: string; url?: string; tooltip?: string | null } | null;
    };
    personalEmotes?: Array<{
      id: string;
      name: string;
      url: string;
      overlay?: boolean;
    }>;
    twitchUserEmotes?: Array<{
      id: string;
      name: string;
      url: string;
      overlay?: boolean;
    }>;
  },
  acc: {
    paints: Map<string, Record<string, string>>;
    badges: Map<string, { imageUrl: string; title: string }>;
    emotes: Map<string, EmoteMap>;
  },
) {
  if (data.paint) {
    paintCache.set(key, data.paint);
    acc.paints.set(key, buildPaintStyle(data.paint, userColorByName(key)));
  } else {
    if (!paintCache.has(key)) paintCache.set(key, null);
  }
  const sevBadgeUrl = String(data.sevenTv?.badge?.url ?? "").trim();
  if (sevBadgeUrl) {
    acc.badges.set(key, {
      imageUrl: sevBadgeUrl,
      title: String(data.sevenTv?.badge?.tooltip ?? "7TV Badge"),
    });
  }
  const hasPersonal =
    Array.isArray(data.personalEmotes) && data.personalEmotes.length > 0;
  const hasTwitchUser =
    Array.isArray(data.twitchUserEmotes) && data.twitchUserEmotes.length > 0;
  if (hasPersonal || hasTwitchUser) {
    const p: EmoteMap = {};
    for (const e of data.personalEmotes ?? []) {
      if (e?.name && e?.url) p[e.name] = { url: e.url, overlay: !!e.overlay };
    }
    for (const e of data.twitchUserEmotes ?? []) {
      if (e?.name && e?.url) p[e.name] = { url: e.url, overlay: false };
    }
    acc.emotes.set(key, p);
  }
}

// >>> writes accumulated cosmetics in one batch, one dom re-render
function commitCosmetics(acc: {
  paints: Map<string, Record<string, string>>;
  badges: Map<string, { imageUrl: string; title: string }>;
  emotes: Map<string, EmoteMap>;
}) {
  if (acc.paints.size) {
    const m = new Map(paintStyles.value);
    acc.paints.forEach((v, k) => m.set(k, v));
    paintStyles.value = m;
  }
  if (acc.badges.size) {
    const m = new Map(sevenTvBadgeMap.value);
    acc.badges.forEach((v, k) => m.set(k, v));
    sevenTvBadgeMap.value = m;
    // >>> pre-warm browser image cache for 7tv badges
    if (typeof requestIdleCallback !== "undefined") {
      requestIdleCallback(
        () => {
          acc.badges.forEach((b) => {
            new Image().src = b.imageUrl;
          });
        },
        { timeout: 2000 },
      );
    } else {
      setTimeout(() => {
        acc.badges.forEach((b) => {
          new Image().src = b.imageUrl;
        });
      }, 100);
    }
  }
  if (acc.emotes.size) {
    const m = new Map(personalEmoteMaps.value);
    acc.emotes.forEach((v, k) => m.set(k, v));
    personalEmoteMaps.value = m;
  }
}

function makeAcc() {
  return {
    paints: new Map<string, Record<string, string>>(),
    badges: new Map<string, { imageUrl: string; title: string }>(),
    emotes: new Map<string, EmoteMap>(),
  };
}

// >>> bulk-fetches cosmetics for many users at once, applying results as they arrive
async function fetchBulkCosmetics(logins: string[], jobId: number) {
  if (logins.length === 0) return;
  const CHUNK = 80; // <<< 7tv gql aliases per request, keep below size limit
  for (let i = 0; i < logins.length; i += CHUNK) {
    if (jobId !== activeSearchJob.value) return;
    const chunk = logins.slice(i, i + CHUNK);
    try {
      const res = await fetch(`${API}/twitch/users/cosmetics`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(session.value
            ? { Authorization: `Bearer ${session.value.token}` }
            : {}),
        },
        body: JSON.stringify({
          logins: chunk,
          channel: channel.value || undefined,
        }),
      });
      if (!res.ok || jobId !== activeSearchJob.value) continue;
      const data = (await res.json()) as { results: Record<string, any> };
      if (jobId !== activeSearchJob.value) continue;
      // >>> accumulate all changes, commit once - single re-render for the whole chunk
      const acc = makeAcc();
      for (const [login, cosmetic] of Object.entries(data.results ?? {})) {
        applyCosmetic(login, cosmetic, acc);
      }
      commitCosmetics(acc);
    } catch {
      // >>> non-fatal: fall back to per-user queue for this chunk
      for (const login of chunk) ensurePaint(login);
    }
  }
}

async function fetchPaint(key: string, jobId: number) {
  if (jobId !== activeSearchJob.value) return;
  try {
    const res = await fetch(`${API}/twitch/user/${encodeURIComponent(key)}`, {
      headers: session.value
        ? { Authorization: `Bearer ${session.value.token}` }
        : {},
    });
    if (!res.ok) {
      paintCache.delete(key);
      return;
    }
    const data = (await res.json()) as {
      paint?: any;
      sevenTv?: {
        badge?: { id?: string; url?: string; tooltip?: string | null } | null;
      };
      personalEmotes?: Array<{
        id: string;
        name: string;
        url: string;
        overlay?: boolean;
      }>;
      twitchUserEmotes?: Array<{
        id: string;
        name: string;
        url: string;
        overlay?: boolean;
      }>;
    };
    if (jobId !== activeSearchJob.value) return;
    const acc = makeAcc();
    applyCosmetic(key, data, acc);
    commitCosmetics(acc);
  } catch {
    paintCache.delete(key);
  }
}

async function ensurePaint(username: string) {
  const key = username.toLowerCase();
  if (paintCache.has(key)) return;
  paintCache.set(key, null); // <<< mark queued/fetching
  paintQueue.push({ key, jobId: activeSearchJob.value });
  drainPaintQueue();
}

// >>> initial load bulk-fetches all users; on scroll, new users trickle into the per-user queue
let bulkFetchDone = false;
function checkPaints(bulk = false) {
  if (!visualsPhaseActive.value) return;
  const list = displayItems.value;
  const seen = new Set<string>();
  const newUsers: string[] = [];
  for (let i = list.length - 1; i >= 0; i--) {
    const item = list[i]!;
    if (item.kind !== "msg") continue;
    const u = item.msg.username?.toLowerCase();
    if (u && !seen.has(u) && !paintCache.has(u)) {
      seen.add(u);
      newUsers.push(u);
      // >>> pre-mark as queued so concurrent calls don't double-enqueue
      paintCache.set(u, null);
    }
  }
  if (newUsers.length === 0) return;

  if (bulk || !bulkFetchDone) {
    // >>> initial load: send all at once
    bulkFetchDone = true;
    paintAutoRequested += newUsers.length;
    void fetchBulkCosmetics(newUsers, activeSearchJob.value);
  } else {
    // >>> scroll: only enqueue newly visible users, capped at PAINT_AUTO_LIMIT
    for (const u of newUsers) {
      if (paintAutoRequested >= PAINT_AUTO_LIMIT) break;
      paintAutoRequested++;
      paintQueue.push({ key: u, jobId: activeSearchJob.value });
    }
    drainPaintQueue();
  }
}

let displayItemsTimer: number | null = null;
watch(
  displayItems,
  () => {
    if (displayItemsTimer) clearTimeout(displayItemsTimer);
    displayItemsTimer = window.setTimeout(() => {
      displayItemsTimer = null;
      vUpdateWindow();
      if (!loading.value && !loadingMore.value) markDomSettling();
    }, 16);
  },
  { flush: "post" },
);

watch(
  loading,
  (isLoading) => {
    if (isLoading) {
      visualsPhaseActive.value = false;
      setSearchJobPhase("fetch");
      return;
    }
    const jobId = activeSearchJob.value;
    setSearchJobPhase("display");
    void nextTick()
      .then(
        () =>
          new Promise<void>((resolve) =>
            requestAnimationFrame(() => resolve()),
          ),
      )
      .then(
        () =>
          new Promise<void>((resolve) =>
            requestAnimationFrame(() => resolve()),
          ),
      )
      .then(() => {
        if (jobId !== activeSearchJob.value) return;
        visualsPhaseActive.value = true;
        setSearchJobPhase("visuals");
        checkPaints(true); // <<< bulk=true sends all users in one request
      });
  },
  { flush: "post" },
);

watch(
  paintStyles,
  () => {
    // >>> avoid retriggering dom settling for each background paint update
    if (loading.value || loadingMore.value) markDomSettling();
  },
  { flush: "post" },
);

watch(
  hasRunningJobs,
  (running) => {
    document.body.classList.toggle("logs-jobs-running", running);
    if (!running) setSearchJobPhase("idle");
  },
  { immediate: true },
);

// >>> in-page find, driven by useLogsSearch; matches run over already-fetched msgs (no per-keystroke request), jump only on enter/select
const logsSearch = useLogsSearch();

const searchMatchResults = computed<LogSearchResult[]>(() => {
  const q = logsSearch.query.value.trim().toLowerCase();
  if (!q) return [];
  const out: LogSearchResult[] = [];
  for (const it of displayItems.value) {
    if (it.kind !== "msg") continue;
    const m = it.msg;
    const hay =
      `${m.text ?? ""} ${m.displayName ?? ""} ${m.username ?? ""}`.toLowerCase();
    if (!hay.includes(q)) continue;
    const text = (m.text || "").replace(/\s+/g, " ").trim();
    const snippet = text
      ? text.length > 120
        ? text.slice(0, 120) + "…"
        : text
      : "(no text)";
    out.push({
      id: m.id,
      label: m.displayName || m.username || m.channel,
      sub: snippet,
    });
  }
  return out;
});
const searchMatchIds = computed<string[]>(() =>
  searchMatchResults.value.map((item) => item.id),
);
const searchMatchSet = computed(() => new Set(searchMatchIds.value));
const searchCurrentId = computed<string | null>(() => {
  const idx = logsSearch.activeIndex.value;
  const ids = searchMatchIds.value;
  return idx >= 0 && idx < ids.length ? (ids[idx] ?? null) : null;
});

async function jumpToSearchMatch(id: string | null) {
  if (!id) return;
  logsSearch.matchIndex.value = searchMatchIds.value.indexOf(id) + 1;
  await scrollToMsg(id, false);
}

watch(
  searchMatchResults,
  (results) => {
    logsSearch.results.value = results;
    logsSearch.matchCount.value = results.length;
    logsSearch.activeIndex.value = 0;
    logsSearch.matchIndex.value = 0;
  },
  { flush: "post" },
);

watch(
  () => logsSearch.query.value,
  (q) => {
    if (!q.trim()) {
      logsSearch.results.value = [];
      logsSearch.matchCount.value = 0;
      logsSearch.activeIndex.value = 0;
      logsSearch.matchIndex.value = 0;
    }
  },
  { flush: "post" },
);

// >>> enter/shift+enter (or explicit next/previous) from the nav search bar
watch(
  () => logsSearch.jumpToken.value,
  () => {
    const ids = searchMatchIds.value;
    if (!ids.length) return;

    const requestedId = logsSearch.jumpId.value;
    if (requestedId) {
      const idx = ids.indexOf(requestedId);
      if (idx >= 0) {
        logsSearch.activeIndex.value = idx;
        void jumpToSearchMatch(requestedId);
        return;
      }
    }

    const dir = logsSearch.jumpDirection.value;
    const base =
      logsSearch.activeIndex.value < 0 ? 0 : logsSearch.activeIndex.value;
    let next = base + dir;
    if (next < 0) next = ids.length - 1;
    if (next >= ids.length) next = 0;
    logsSearch.activeIndex.value = next;
    logsSearch.matchIndex.value = next + 1;
    void jumpToSearchMatch(ids[next] ?? null);
  },
);

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
    color?: number | null;
    angle?: number | null;
    function?: string | null;
    repeat?: boolean;
  } | null;
  botInChannel: boolean;
}
const popup = ref<{
  username: string;
  channel: string;
  x: number;
  y: number;
} | null>(null);
const popupUser = ref<TwitchUser | null>(null);
const popupLoading = ref(false);
const popupDragging = ref(false);
let popupDragStartX = 0;
let popupDragStartY = 0;
let popupStartX = 0;
let popupStartY = 0;

function onPopupDragMove(evt: MouseEvent) {
  if (!popupDragging.value || !popup.value) return;
  const dx = evt.clientX - popupDragStartX;
  const dy = evt.clientY - popupDragStartY;
  const nextX = popupStartX + dx;
  const nextY = popupStartY + dy;
  const maxX = Math.max(0, window.innerWidth - 240);
  const maxY = Math.max(0, window.innerHeight - 120);
  popup.value = {
    ...popup.value,
    x: Math.min(maxX, Math.max(0, nextX)),
    y: Math.min(maxY, Math.max(0, nextY)),
  };
}

function stopPopupDrag() {
  popupDragging.value = false;
  window.removeEventListener("mousemove", onPopupDragMove);
  window.removeEventListener("mouseup", stopPopupDrag);
}

function startPopupDrag(evt: MouseEvent) {
  if (!popup.value) return;
  popupDragging.value = true;
  popupDragStartX = evt.clientX;
  popupDragStartY = evt.clientY;
  popupStartX = popup.value.x;
  popupStartY = popup.value.y;
  window.addEventListener("mousemove", onPopupDragMove);
  window.addEventListener("mouseup", stopPopupDrag);
  evt.preventDefault();
}

function openUserPopup(username: string, ch: string, evt: MouseEvent) {
  evt.stopPropagation();
  popup.value = { username, channel: ch, x: evt.clientX, y: evt.clientY };
  popupUser.value = null;
  popupLoading.value = true;
  fetch(
    `${API}/twitch/user/${encodeURIComponent(username.toLowerCase())}?channel=${encodeURIComponent(ch)}`,
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

function closePopup() {
  popup.value = null;
  popupUser.value = null;
}

function openUsercardPopout(username: string, ch: string) {
  window.open(
    `https://www.twitch.tv/popout/${ch}/viewercard/${username}`,
    "_blank",
    "width=340,height=560",
  );
}

function goToLogsForUser(username: string, ch: string) {
  channel.value = ch;
  userFilter.value = username;
  if (channelInputRef.value) channelInputRef.value.value = ch;
  if (userInputRef.value) userInputRef.value.value = username;
  closePopup();
  search();
}

function fmtFollowers(n: number): string {
  if (n >= 1_000_000)
    return (n / 1_000_000).toFixed(1).replace(/.0$/, "") + "M";
  if (n >= 1_000) return (n / 1_000).toFixed(1).replace(/.0$/, "") + "K";
  return String(n);
}
function fmtJoined(iso: string): string {
  return new Date(iso).toLocaleDateString([], {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}
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
function paintNameStyle(paint: {
  imageUrl: string | null;
  stops: { at: number; color: number }[];
  shadows: any[];
  color?: number | null;
  angle?: number | null;
  function?: string | null;
  repeat?: boolean;
}): Record<string, string> {
  return buildPaintStyle(paint);
}
</script>

<template>
  <div class="logs-view" @click="closePopup">
    <div class="logs-header">
      <div class="logs-title">{{ t("logs.title") }}</div>
      <div class="logs-sub">{{ t("logs.sub") }}</div>
    </div>

    <!-- >>> mobile: collapsed summary bar -->
    <div class="search-summary show-mobile" @click="searchExpanded = !searchExpanded">
      <span class="summary-text">
        <span class="summary-ch">#{{ channel || "?" }}</span>
        <span v-if="userFilter" class="summary-tag">@{{ userFilter }}</span>
        <span v-if="termFilter" class="summary-tag">"{{ termFilter }}"</span>
        <span v-if="dateFrom" class="summary-tag">{{ dateFrom
        }}{{
            dateUntil && dateUntil !== dateFrom ? " → " + dateUntil : ""
          }}</span>
      </span>
      <span class="summary-chevron">{{ searchExpanded ? "▲" : "▼" }}</span>
    </div>

    <div class="search-bar-wrapper">
      <div class="search-bar" :class="{ 'search-bar-collapsed': !searchExpanded }">
        <div class="search-bar-content">
          <div class="field-wrap">
            <label class="field-lbl">{{ t("logs.field.channel") }}</label>
            <input ref="channelInputRef" class="field-input" placeholder="channelname" @keydown.enter="search"
              autocomplete="off" spellcheck="false" />
          </div>
          <div class="field-wrap">
            <label class="field-lbl">{{ t("logs.field.user") }}
              <span class="opt">{{ t("logs.field.optional") }}</span></label>
            <input ref="userInputRef" class="field-input" placeholder="username" @keydown.enter="search"
              autocomplete="off" spellcheck="false" />
          </div>
          <div class="field-wrap">
            <label class="field-lbl">{{ t("logs.field.term") }}
              <span class="opt">{{ t("logs.field.optional") }}</span></label>
            <input ref="termInputRef" class="field-input" placeholder="search term" @keydown.enter="search"
              autocomplete="off" spellcheck="false" />
          </div>
          <div class="field-wrap">
            <label class="field-lbl">Date
              <span class="opt">{{ t("logs.field.optional") }}</span></label>
            <VueDatePicker v-model="dateSingle" no-time-picker dark auto-apply :format="formatDateSingle"
              placeholder="Any date" class="dp-logs dp-logs-single" :teleport="true" />
          </div>
          <!-- >>> sort + visuals merged into one dropdown so the bar doesn't sprawl -->
          <div class="field-wrap visuals-bar" ref="visualsBarRef">
            <label class="field-lbl hide-mobile">Options</label>
            <button class="visuals-toggle hide-mobile" :class="{ open: visualsOpen }"
              @click.stop="visualsOpen = !visualsOpen">
              Options {{ visualsOpen ? "▲" : "▼" }}
            </button>
            <div class="visuals-panel" :class="{ 'visuals-panel-open': visualsOpen }" @click.stop>
              <div class="options-group">
                <span class="options-group-lbl show-mobile">Sort</span>
                <button class="dir-btn" :class="{ active: direction === 'newest' }" @click="setDirection('newest')">
                  &#8595; Newest
                </button>
                <button class="dir-btn" :class="{ active: direction === 'oldest' }" @click="setDirection('oldest')">
                  &#8593; Oldest
                </button>
              </div>
              <div class="options-group">
                <span class="options-group-lbl show-mobile">Visuals</span>
                <button class="dir-btn" :class="{ active: nameVisual === '7tv' }" @click="nameVisual = '7tv'"
                  title="Show 7TV paints & badges">
                  7TV
                </button>
                <button class="dir-btn" :class="{ active: nameVisual === 'white' }" @click="nameVisual = 'white'"
                  title="Show all usernames in white">
                  White names
                </button>
              </div>
            </div>
          </div>
          <button class="search-btn" @click="search" :disabled="loading">
            {{ loading ? "…" : t("logs.search") }}
          </button>
        </div>
      </div>
      <div class="snippet-info" v-if="false">
        <!-- >>> moved to global SnippetOverlay -->
      </div>
    </div>

    <div v-if="searched && isBroadcaster && automodMsgs.length > 0" class="automod-bar">
      <button class="automod-toggle" :class="{ active: showAutomod }" @click="showAutomod = !showAutomod">
        ⚠ AutoMod ({{ automodMsgs.length }})
        {{ showAutomod ? "- click to hide" : "- click to show" }}
      </button>
    </div>

    <div v-if="error" class="logs-error">{{ error }}</div>

    <transition name="toast-fade">
      <div v-if="copyToast" class="copy-toast">{{ t("logs.copied") }}</div>
    </transition>

    <div v-if="!searched && !loading" class="logs-empty">
      {{ t("logs.empty") }}
    </div>
    <div v-else-if="loading" class="logs-empty">{{ t("logs.searching") }}</div>
    <div v-else-if="searched && !msgs.length && !loadingMore" class="logs-empty">
      {{ t("logs.no_results") }}
    </div>

    <div v-else-if="searched" class="logs-results">
      <div class="logs-count">
        {{ msgs.length.toLocaleString() }} {{ t("logs.count") }}
      </div>
      <div class="logs-table-wrap" ref="tableWrapRef">
        <div class="logs-table-shell" ref="tableShellRef" :style="tableShellStyle">
          <div class="logs-table" :style="{ '--user-width': nameColWidth + 'px' }">
            <div class="logs-thead">
              <div>{{ t("logs.col.time") }}</div>
              <div>{{ t("logs.col.user") }}</div>
              <div>{{ t("logs.col.msg") }}</div>
            </div>
            <div v-if="!isMobileView" class="day-jump-bar">
              <button class="day-jump-btn" @click="jumpOneDayUp">
                ↑ jump to {{ jumpTargetDayLabel || "..." }}
              </button>
            </div>
            <div class="logs-tbody-wrap">
              <!-- >>> pinned header always reflects viewportDayLabel - relying on in-flow rows' position:sticky broke once the day separator scrolled outside the render window -->
              <div v-if="viewportDayLabel" class="pinned-day-header">
                {{ viewportDayLabel }}
              </div>
              <div class="logs-tbody" ref="scrollerRef">
                <div v-if="loadingMore" class="top-loader">
                  <span class="spinner">⟳</span> {{ t("logs.load_older") }}
                </div>
                <div v-if="noMore && !userFilter && !termFilter && !dateFilter" class="top-loader no-more">
                  {{ t("logs.no_older") }}
                </div>

                <!-- >>> spacer for items above rendered slice -->
                <div :style="{ height: vSpacerTop + 'px', flexShrink: 0 }" aria-hidden="true"></div>

                <template v-for="item in virtualSlice" :key="item.id">
                  <div v-if="item.kind === 'day'" :id="`day-${item.id}`" :data-vit-id="item.id" class="log-day-sep">
                    {{ item.label }}
                  </div>

                  <div v-else-if="item.kind === 'automod'" :id="`log-${item.msg.id}`" :data-vit-id="item.id"
                    class="log-row-outer log-row-automod">
                    <div class="log-row">
                      <div class="log-time-col">
                        <div class="log-event-label tone-automod">
                          <span class="log-event-icon">⚠</span>
                          <span>{{ automodTagLabel(item.msg._status) }}</span>
                        </div>
                        <div class="log-time">{{ fmtTs(item.msg.timestamp) }}</div>
                        <div class="log-time-short">
                          {{ fmtTimeOnly(item.msg.timestamp) }}
                        </div>
                      </div>
                      <div class="log-user">{{ item.msg.username }}</div>
                      <div class="log-msg-wrap">
                        <div class="log-msg">{{ item.msg.text }}</div>
                      </div>
                    </div>
                  </div>

                  <!-- >>> server pre-rendered row: fast path, single v-html, no per-row reactive work -->
                  <div v-else-if="item.msg?._rowHtml" :id="`log-${item.msg.id}`" :data-vit-id="item.id"
                    class="log-row-outer" :class="{
                      highlighted: highlightId === item.msg.id,
                      'log-row-reply': item.msg._hasReply,
                      'log-row-event': !!item.msg._eventMeta,
                      'search-match': searchMatchSet.has(item.msg.id),
                      'search-current': searchCurrentId === item.msg.id,
                    }" v-cached-html="{ id: item.msg.id, html: item.msg._rowHtml }"></div>

                  <!-- >>> client-rendered fallback when server didn't pre-render -->
                  <div v-else :id="`log-${item.msg.id}`" :data-vit-id="item.id" class="log-row-outer" :class="{
                    highlighted: highlightId === item.msg.id,
                    'log-row-reply':
                      !!item.msg.tags?.['reply-parent-msg-body'],
                    'log-row-event': getRowData(item.msg).eventMeta !== null,
                    'search-match': searchMatchSet.has(item.msg.id),
                    'search-current': searchCurrentId === item.msg.id,
                  }" @vnodeMounted="(vn: VNode) => rowMounted(vn.el as Element)" @vnodeBeforeUpdate="
                      (vn: VNode) => rowBeforeUpdate(vn.el as Element)
                    " @vnodeUpdated="(vn: VNode) => rowUpdated(vn.el as Element)">
                    <div class="log-row">
                      <div class="log-time-col">
                        <div v-if="getRowData(item.msg).eventMeta" class="log-event-label"
                          :class="`tone-${getRowData(item.msg).eventMeta!.tone}`">
                          <span class="log-event-icon">{{
                            getRowData(item.msg).eventMeta!.icon
                          }}</span>
                          <span>{{
                            getRowData(item.msg).eventMeta!.label
                          }}</span>
                        </div>
                        <div class="log-time">
                          {{ fmtTs(item.msg.timestamp) }}
                        </div>
                        <div class="log-time-short">
                          {{ fmtTimeOnly(item.msg.timestamp) }}
                        </div>
                      </div>
                      <div v-if="
                        !getRowData(item.msg).isMod &&
                        getRowData(item.msg).badges.length
                      " class="log-badges">
                        <template v-for="b in getRowData(item.msg).badges" :key="`${item.msg.id}-${b.kind}-${b.key}`">
                          <img v-if="b.imageUrl" class="badge-img" fetchpriority="high" :src="b.imageUrl"
                            :alt="b.title || b.label" :title="b.title || b.label"
                            @vnodeMounted="() => badgeLoadStart(b.imageUrl!)" @vnodeBeforeUpdate="
                              () => badgeLoadStart(b.imageUrl!)
                            " @load="badgeLoaded" @error="badgeError" />
                          <span v-else class="badge-fallback" :title="b.title || b.label">{{ b.label }}</span>
                        </template>
                      </div>
                      <div v-if="!getRowData(item.msg).isMod" class="log-user"
                        :data-snippet-paint="getRowData(item.msg).paintPreview" :style="getRowData(item.msg).nameStyle"
                        :class="{ 'log-user-clickable': true }" @click.stop="
                          openUserPopup(
                            item.msg.username,
                            channel || item.msg.channel?.replace('#', ''),
                            $event,
                          )
                          ">
                        {{ item.msg.displayName || item.msg.username }}
                      </div>
                      <div class="log-msg-wrap" :class="{
                        'has-reply':
                          !!item.msg.tags?.['reply-parent-msg-body'],
                        'is-system-mod': getRowData(item.msg).isMod,
                      }">
                        <div v-if="!getRowData(item.msg).isMod" class="log-mobile-msgline">
                          <span v-if="getRowData(item.msg).badges.length" class="log-mobile-badges">
                            <template v-for="b in getRowData(item.msg).badges"
                              :key="`mob-${item.msg.id}-${b.kind}-${b.key}`">
                              <img v-if="b.imageUrl" class="badge-img" :src="b.imageUrl" :alt="b.title || b.label"
                                :title="b.title || b.label" />
                              <span v-else class="badge-fallback" :title="b.title || b.label">{{ b.label }}</span>
                            </template>
                          </span>
                          <span class="log-mobile-user" :data-snippet-paint="getRowData(item.msg).paintPreview
                            " :style="getRowData(item.msg).nameStyle">{{
                              item.msg.displayName || item.msg.username
                            }}</span><span class="log-mobile-user-colon">:</span>
                          <span class="log-mobile-msg" v-html="getRowData(item.msg).html"></span>
                        </div>
                        <div v-if="item.msg.tags?.['reply-parent-msg-body']" class="reply-context" :class="{
                          'reply-context-link':
                            !!item.msg.tags?.['reply-parent-msg-id'],
                        }" :title="item.msg.tags?.['reply-parent-msg-id']
                              ? 'Jump to replied message'
                              : undefined
                            " @click.stop="jumpToReplyParent(item.msg)">
                          <span class="reply-icon">⮣</span>
                          <span class="reply-parent-user">@{{
                            item.msg.tags["reply-parent-display-name"] ||
                            item.msg.tags["reply-parent-user-login"] ||
                            "?"
                          }}:</span>
                          <span class="reply-parent-body">{{
                            item.msg.tags["reply-parent-msg-body"]
                          }}</span>
                        </div>
                        <div class="log-msg" v-html="getRowData(item.msg).html"></div>
                      </div>
                      <div class="log-share" @click="shareMsg(item.msg)" title="Copy link">
                        <svg viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
                          <path d="M10 2L14 6L10 10" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"
                            stroke-linejoin="round" />
                          <path d="M14 6H6C4.34 6 3 7.34 3 9V14" stroke="currentColor" stroke-width="1.5"
                            stroke-linecap="round" stroke-linejoin="round" />
                        </svg>
                      </div>
                    </div>
                  </div>
                </template>

                <!-- >>> spacer for items below rendered slice -->
                <div :style="{ height: vSpacerBottom + 'px', flexShrink: 0 }" aria-hidden="true"></div>

                <div class="top-loader" v-show="loadingNewer">
                  <span class="spinner">⟳</span> {{ t("logs.load_newer") }}
                </div>
              </div>
              <!-- >>> custom scrollbar overlay, desktop only -->
              <div v-if="!isMobileView" class="logs-custom-scrollbar" ref="customScrollbarRef"
                @pointerdown.stop="onCustomScrollbarTrackPointerDown">
                <div class="logs-custom-thumb" :style="customThumbStyle" @pointerdown.stop.prevent="onThumbDragStart">
                </div>
              </div>
            </div>
          </div>

          <!-- >>> jump-to-newest pill, appears when scrolled up -->
          <transition name="jump-fade">
            <button v-if="searched && !isNearBottom" class="jump-to-newest-btn" @click="jumpToNewest">
              {{ t("logs.jump_to_newest") }}
            </button>
          </transition>

          <div v-if="!isMobileView" class="event-rail" aria-hidden="true">
            <button v-for="m in timelineMarkers" :key="m.key" class="event-marker" :class="{ thin: !!m.thin }"
              :title="m.title" :style="{ top: m.topPct + '%', background: m.color }"
              @click.stop="jumpToTimelineMarker(m)"></button>
          </div>
        </div>
        <button v-if="!isMobileView" class="logs-resize-handle" title="Drag to resize logs panel"
          @pointerdown="startResizeDrag"></button>
      </div>
    </div>

    <!-- >>> screenshot toast moved to global SnippetOverlay -->

    <div v-if="popup" class="user-popup" :style="{ top: popup.y + 'px', left: popup.x + 'px' }" @click.stop>
      <div class="popup-header" @mousedown.stop="startPopupDrag">
        <div class="popup-avatar-wrap">
          <img v-if="popupUser?.avatar" :src="popupUser.avatar" class="popup-avatar" />
          <div v-else class="popup-avatar-placeholder">
            {{ popup.username[0]?.toUpperCase() }}
          </div>
        </div>
        <div class="popup-title-block">
          <div class="popup-name">
            {{ popupUser?.displayName ?? popup.username }}
          </div>
          <div class="popup-sub">in #{{ popup.channel }}</div>
        </div>
        <button class="popup-close" @mousedown.stop @click="closePopup">
          ✕
        </button>
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
                fmtFollowers(popupUser.ownFollowers!)
              }}</span>
              <span class="stat-lbl">followers</span>
            </div>
          </div>
          <div class="popup-relations">
            <div v-if="!popupUser.botInChannel" class="popup-no-bot">
              ShyBoti not in #{{ popup?.channel }} - follow/sub info unavailable
            </div>
            <template v-else>
              <div class="popup-rel" :class="popupUser.followedAt ? 'rel-yes' : 'rel-no'">
                <span class="rel-icon">♥</span>
                <span class="rel-label">
                  <template v-if="popupUser.followedAt">Following for
                    {{ fmtDuration(popupUser.followedAt) }}</template>
                  <template v-else>Not following</template>
                </span>
              </div>
              <div class="popup-rel" :class="popupUser.subbedSince ? 'rel-yes' : 'rel-no'">
                <span class="rel-icon">★</span>
                <span class="rel-label">
                  <template v-if="popupUser.subbedSince">{{ subTierLabel(popupUser.subTier ?? "1000") }} ·
                    {{ fmtDuration(popupUser.subbedSince) }}</template>
                  <template v-else>Not subscribed</template>
                </span>
              </div>
            </template>
          </div>
          <div v-if="popupUser.paint" class="popup-paint">
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
        <button class="popup-btn" @click="goToLogsForUser(popup.username, popup.channel)">
          Logs
        </button>
        <button class="popup-btn" @click="openUsercardPopout(popup.username, popup.channel)">
          ↗ Twitch
        </button>
      </div>
    </div>

    <div class="logs-fetch-floating" :class="{ visible: showFloatingFetch }" aria-live="polite"
      :aria-busy="showFloatingFetch ? 'true' : 'false'">
      <img class="logs-fetch-logo" :src="loadingOverlayLogoUrl" alt="ShyBoti loading" loading="eager" decoding="async"
        fetchpriority="high" />
      <span class="logs-fetch-text">logs getting displayed...</span>
    </div>
  </div>
</template>

<style scoped>
.logs-view {
  display: flex;
  flex-direction: column;
  gap: 16px;
  height: 100%;
  min-height: 0;
  margin: -20px;
  padding: 20px;
}

.logs-header {
  flex-shrink: 0;
}

.logs-title {
  font-size: 18px;
  font-weight: 700;
  color: #e0e0e0;
  margin-bottom: 4px;
}

.logs-sub {
  font-size: 12px;
  color: #555;
}

.search-bar-wrapper {
  display: flex;
  gap: 12px;
  align-items: flex-start;
  flex-shrink: 0;
}

.search-bar {
  display: flex;
  align-items: flex-end;
  gap: 10px;
  flex-wrap: wrap;
  background: #141418;
  padding: 14px 16px;
  flex-shrink: 0;
  flex: 1;
}

.search-bar-content {
  display: flex;
  align-items: flex-end;
  gap: 10px;
  flex-wrap: wrap;
}

.field-wrap {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.snippet-info {
  display: flex;
  flex-direction: column;
  gap: 4px;
  flex-shrink: 0;
  align-items: center;
}

.snippet-gif-wrap {
  position: relative;
  cursor: pointer;
  display: inline-block;
}

.snippet-gif {
  display: block;
  max-height: 60px;
  max-width: 180px;
  border: 1px solid #2a2a30;
}

.snippet-hover-overlay {
  position: absolute;
  inset: 0;
  background: rgba(13, 13, 16, 0.78);
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 11px;
  font-weight: 700;
  color: #9d6cff;
  pointer-events: none;
  letter-spacing: 0.04em;
}

.field-lbl {
  font-size: 10px;
  font-weight: 700;
  color: #555;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  display: flex;
  gap: 5px;
  align-items: center;
}

.opt {
  font-size: 9px;
  color: #383838;
  font-weight: 400;
  text-transform: none;
}

.field-input {
  background: #0d0d10;
  border: 1px solid #2a2a30;
  color: #e0e0e0;
  font-family: inherit;
  font-size: 12px;
  padding: 7px 10px;
  outline: none;
  width: 160px;
  transition: border-color 0.15s;
}

.field-input:focus {
  border-color: #6f2bff55;
}

.search-btn {
  height: 34px;
  padding: 0 20px;
  background: #6f2bff;
  border: none;
  color: #fff;
  font-family: inherit;
  font-size: 12px;
  font-weight: 700;
  cursor: pointer;
  align-self: flex-end;
  transition: background 0.15s;
}

.search-btn:hover:not(:disabled) {
  background: #7f3fff;
}

.search-btn:disabled {
  opacity: 0.4;
  cursor: default;
}

.logs-error {
  color: #f14949;
  font-size: 12px;
  padding: 8px 14px;
  background: rgba(241, 73, 49, 0.08);
  border-left: 2px solid #f14949;
  flex-shrink: 0;
}

.logs-empty {
  color: #444;
  font-size: 13px;
  padding: 40px;
  text-align: center;
}

.logs-count {
  font-size: 11px;
  color: #555;
  padding: 0 2px 4px;
  flex-shrink: 0;
}

.copy-toast {
  position: fixed;
  bottom: 24px;
  left: 50%;
  transform: translateX(-50%);
  background: #1e2a1e;
  border: 1px solid #23d18b55;
  color: #23d18b;
  font-size: 12px;
  padding: 8px 18px;
  pointer-events: none;
  z-index: 9999;
}

.toast-fade-enter-active,
.toast-fade-leave-active {
  transition:
    opacity 0.2s,
    transform 0.2s;
}

.toast-fade-enter-from,
.toast-fade-leave-to {
  opacity: 0;
  transform: translateX(-50%) translateY(8px);
}

.logs-results {
  display: flex;
  flex-direction: column;
  flex: 1;
  min-height: 0;
}

.logs-table-wrap {
  display: flex;
  align-items: stretch;
  gap: 0;
  flex: 1;
  min-height: 0;
  overflow: hidden;
}

.logs-table-shell {
  position: relative;
  display: flex;
  flex-direction: column;
  flex: 1;
  min-width: 0;
  min-height: 0;
}

.logs-table {
  display: flex;
  flex-direction: column;
  flex: 1;
  min-height: 0;
  min-width: 0;
}

.logs-thead {
  display: grid;
  grid-template-columns: 120px var(--user-width, 140px) 1fr;
  align-items: baseline;
  padding: 7px 0 14px;
  background: #0d0d10;
  border: 0;
  font-size: 10px;
  color: #555;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  flex-shrink: 0;
  justify-items: center;
  position: relative;
}

.logs-thead> :nth-child(3) {
  position: absolute;
  left: 50%;
  top: 50%;
  transform: translate(-50%, -50%);
}

.day-jump-bar {
  position: sticky;
  top: 0;
  z-index: 4;
  background: #101015;
  border-bottom: 0;
}

.day-jump-btn {
  width: 100%;
  height: 100%;
  padding: 10px 0;
  background: #6f2bff14;
  border: 0;
  color: #555;
  font-size: 11px;
  font-weight: 600;
  cursor: pointer;
  transition:
    color 0.15s,
    border-color 0.15s,
    background 0.15s;
}

.day-jump-btn:hover {
  color: #d2d2df;
  background: rgba(152, 101, 255, 0.473);
}

.logs-tbody-wrap {
  display: flex;
  flex: 1;
  min-height: 0;
  position: relative;
}

.pinned-day-header {
  position: absolute;
  top: 0;
  left: 0;
  right: 14px;
  /* 14px = width of the custom scrollbar track */
  padding: 6px 12px 3px;
  font-size: 10px;
  font-weight: 700;
  color: #555;
  letter-spacing: 0.05em;
  background: #101015;
  border-bottom: 1px solid #1e1e24;
  z-index: 5;
  pointer-events: none;
}

.logs-tbody {
  overflow-y: scroll;
  overflow-anchor: auto;
  flex: 1;
  position: relative;
  min-height: 0;
  scrollbar-width: none;
}

.logs-tbody::-webkit-scrollbar {
  width: 0;
  height: 0;
}

.logs-custom-scrollbar {
  width: 14px;
  flex-shrink: 0;
  background: rgba(21, 21, 26, 0.92);
  position: relative;
  pointer-events: all;
  cursor: pointer;
  user-select: none;
  border-left: 1px solid #1e1e26;
}

.logs-custom-thumb {
  position: absolute;
  left: 2px;
  width: calc(100% - 4px);
  background: rgba(104, 104, 118, 0.88);
  border-radius: 3px;
  pointer-events: all;
  cursor: grab;
  transition: background 0.1s;
  min-height: 28px;
}

.logs-custom-thumb:hover {
  background: rgba(140, 140, 160, 0.95);
}

.logs-custom-thumb:active {
  cursor: grabbing;
}

.event-rail {
  position: absolute;
  top: 50px;
  bottom: 0;
  right: 2px;
  width: 10px;
  background: rgba(255, 255, 255, 0.04);
  border-radius: 0;
  pointer-events: none;
  z-index: 2;
}

.event-marker {
  position: absolute;
  left: 0;
  width: 100%;
  height: 5px;
  border: 0;
  padding: 0;
  margin: 0;
  transform: translateY(-50%);
  border-radius: 0;
  cursor: pointer;
  pointer-events: auto;
}

.event-marker.thin {
  height: 2px;
  border-radius: 2px;
}

.logs-resize-handle {
  width: 14px;
  border: none;
  border-left: 1px solid #22222b;
  background:
    radial-gradient(circle, #6b6b78 1.2px, transparent 1.3px) center 4px / 6px 6px repeat-y,
    #121217;
  cursor: ew-resize;
  touch-action: none;
  flex-shrink: 0;
}

.logs-resize-handle:hover {
  background:
    radial-gradient(circle, #9a9aab 1.2px, transparent 1.3px) center 4px / 6px 6px repeat-y,
    #17171d;
}

.top-loader {
  position: sticky;
  top: 0;
  z-index: 4;
  text-align: center;
  font-size: 11px;
  color: #9d6cff;
  padding: 8px 12px;
  background: #0e0e12;
  border-bottom: 1px solid #1e1e24;
}

.top-loader.no-more {
  color: #333;
  background: transparent;
  border-bottom: none;
  position: static;
}

.spinner {
  display: inline-block;
  animation: spin 1s linear infinite;
}

@keyframes spin {
  to {
    transform: rotate(360deg);
  }
}

/* Jump-to-newest pill */
.jump-to-newest-btn {
  position: absolute;
  bottom: 12px;
  left: 50%;
  transform: translateX(-50%);
  z-index: 20;
  padding: 5px 14px;
  background: #7c3aed;
  color: #fff;
  border: none;
  border-radius: 999px;
  font-size: 12px;
  font-weight: 600;
  cursor: pointer;
  white-space: nowrap;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.5);
  transition:
    background 0.15s,
    opacity 0.15s;
}

.jump-to-newest-btn:hover {
  background: #6d28d9;
}

.jump-fade-enter-active,
.jump-fade-leave-active {
  transition:
    opacity 0.2s,
    transform 0.2s;
}

.jump-fade-enter-from,
.jump-fade-leave-to {
  opacity: 0;
  transform: translateX(-50%) translateY(6px);
}

.log-row-outer {
  border-bottom: 1px solid #1a1a1e;
  transition: background 0.1s;
  position: relative;
}

.log-row-outer:hover {
  background: #1a1a1e;
}

.log-row-outer.highlighted {
  animation: hl-fade 3s ease forwards;
}

.log-row-outer.log-row-event {
  background: linear-gradient(90deg,
      rgba(200, 50, 200, 0.16),
      rgba(200, 50, 200, 0.02) 45%,
      transparent 80%);
  border-left: 2px solid #c832c8;
}

.log-row-outer.log-row-event:hover {
  background: linear-gradient(90deg,
      rgba(200, 50, 200, 0.24),
      rgba(200, 50, 200, 0.08) 50%,
      rgba(26, 26, 30, 0.9) 100%);
}

.log-row-outer.log-row-event :deep(.log-row) {
  align-items: center;
}

@keyframes hl-fade {
  0% {
    background: rgba(111, 43, 255, 0.25);
  }

  100% {
    background: transparent;
  }
}

/* In-page search: every match gets a subtle tint, the active one is stronger. */
.log-row-outer.search-match {
  background: rgba(255, 214, 10, 0.05);
  border-left: 2px solid rgba(255, 214, 10, 0.32);
}

.log-row-outer.search-match:hover {
  background: rgba(255, 214, 10, 0.09);
}

.log-row-outer.search-current {
  background: rgba(255, 214, 10, 0.16) !important;
  border-left-color: #ffd60a !important;
}

.log-row-outer.search-current:hover {
  background: rgba(255, 214, 10, 0.2) !important;
}

:deep(.log-row) {
  display: flex;
  align-items: baseline;
  gap: 0;
  padding: 3px 14px;
  font-size: 12px;
}

:deep(.log-time-col) {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  flex-shrink: 0;
  margin-right: 10px;
  min-width: 120px;
}

:deep(.log-event-label) {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 0 6px;
  height: 15px;
  font-size: 9px;
  font-weight: 800;
  letter-spacing: 0.03em;
  text-transform: uppercase;
  margin-bottom: 2px;
  border: 1px solid transparent;
  white-space: nowrap;
}

:deep(.log-event-icon) {
  font-size: 10px;
  line-height: 1;
}

:deep(.log-event-label.tone-first) {
  background: rgba(200, 50, 200, 0.16);
  border-color: rgba(200, 50, 200, 0.55);
  color: #f4c2f4;
}

:deep(.log-event-label.tone-sub) {
  background: rgba(255, 208, 69, 0.14);
  border-color: rgba(255, 208, 69, 0.45);
  color: #ffdd7d;
}

:deep(.log-event-label.tone-announce) {
  background: rgba(93, 171, 255, 0.12);
  border-color: rgba(93, 171, 255, 0.45);
  color: #a8d3ff;
}

:deep(.log-time) {
  color: #444;
  font-size: 11px;
  flex-shrink: 0;
}

:deep(.log-time-short) {
  display: none;
}

:deep(.log-day-sep) {
  display: block;
  padding: 6px 12px 3px;
  font-size: 10px;
  font-weight: 700;
  color: #555;
  letter-spacing: 0.05em;
  border-top: 1px solid #1e1e24;
  background: #0d0d10;
}

:deep(.log-badges) {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  margin-right: 6px;
  flex-shrink: 0;
}

:deep(.badge-img) {
  display: block;
  width: 18px;
  height: 18px;
}

:deep(.badge-fallback) {
  font-size: 10px;
  color: #888;
}

:deep(.log-user) {
  font-weight: 600;
  white-space: nowrap;
  flex-shrink: 0;
  padding-right: 0;
}

:deep(.log-user)::after {
  content: ":";
  color: #555;
  margin-right: 5px;
}

:deep(.log-msg-wrap) {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  position: relative;
}

:deep(.log-msg-wrap.has-reply) {
  padding-top: 16px;
}

:deep(.log-mobile-msgline) {
  display: none;
}

:deep(.log-msg-wrap.is-system-mod .log-msg) {
  color: #898989;
  font-style: italic;
}

:deep(.log-msg) {
  flex: 1;
  color: #ccc;
  word-break: break-word;
  line-height: 1.6;
  min-width: 0;
}

/* Reply thread indicator */
:deep(.reply-context) {
  position: absolute;
  left: 0;
  right: 0;
  top: 0;
  display: flex;
  align-items: center;
  gap: 4px;
  font-size: 10px;
  color: #555;
  padding: 2px 0 3px;
  line-height: 1.25;
  white-space: nowrap;
  overflow: hidden;
}

:deep(.reply-context-link) {
  cursor: pointer;
}

:deep(.reply-context-link):hover {
  color: #7f7f7f;
}

:deep(.reply-icon) {
  color: #444;
  font-size: 11px;
  flex-shrink: 0;
}

:deep(.reply-parent-user) {
  color: #777;
  font-weight: 600;
  flex-shrink: 0;
}

:deep(.reply-parent-body) {
  color: #444;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

:deep(.log-share) {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 20px;
  height: 20px;
  color: #444;
  cursor: pointer;
  opacity: 0;
  transition:
    opacity 0.15s,
    color 0.15s;
  flex-shrink: 0;
  margin-left: 6px;
}

.log-row-outer:hover :deep(.log-share) {
  opacity: 1;
}

:deep(.log-share):hover {
  color: #9d6cff;
}

:deep(.log-share svg) {
  width: 13px;
  height: 13px;
}

:deep(.log-user-clickable) {
  cursor: pointer;
}

:deep(.log-user-clickable):hover {
  opacity: 0.8;
  text-decoration: underline dotted;
}

:deep(.chat-emote) {
  height: 28px;
  vertical-align: middle;
  display: inline-block;
  margin: 0 1px;
  /* Prevent broken-image flicker while src is fetching */
  color: transparent;
}

/* Zero-width / overlay emote stacking */
:deep(.emote-stack) {
  display: inline-block;
  position: relative;
  /* width is set by the base emote naturally */
  vertical-align: middle;
  margin: 0 1px;
}

:deep(.emote-stack .chat-emote) {
  margin: 0;
  display: block;
}

:deep(.emote-stack .emote-overlay) {
  position: absolute;
  top: 50%;
  left: 50%;
  transform: translate(-50%, -50%);
  /* Overlay is same height as base; center it exactly */
  height: 28px;
  pointer-events: none;
  margin: 0;
}

/* User popup */
.user-popup {
  position: fixed;
  z-index: 200;
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
  cursor: move;
  user-select: none;
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

.popup-no-bot {
  font-size: 10px;
  color: #555;
  font-style: italic;
  padding: 4px 0;
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

.logs-fetch-floating {
  position: fixed;
  right: 18px;
  bottom: 16px;
  z-index: 320;
  display: inline-flex;
  align-items: center;
  gap: 9px;
  padding: 8px 12px;
  background: rgba(17, 18, 24, 0.95);
  border: 1px solid #c832c855;
  box-shadow: 0 10px 28px rgba(0, 0, 0, 0.45);
  backdrop-filter: blur(2px);
  pointer-events: none;
  opacity: 0;
  transform: translateY(6px);
  visibility: hidden;
  transition:
    opacity 0.16s ease,
    transform 0.16s ease,
    visibility 0.16s ease;
}

.logs-fetch-floating.visible {
  opacity: 1;
  transform: translateY(0);
  visibility: visible;
}

.logs-fetch-logo {
  width: 18px;
  height: 18px;
  border-radius: 50%;
  animation: logs-fetch-spin 1s linear infinite;
  transform-origin: center center;
}

.logs-fetch-text {
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.03em;
  color: #f2d3ff;
  text-transform: lowercase;
}

@keyframes logs-fetch-spin {
  to {
    transform: rotate(360deg);
  }
}

/* Direction toggle */
.dir-toggle {
  display: flex;
  gap: 0;
}

.dir-btn {
  height: 34px;
  width: 96px;
  padding: 0 8px;
  border: 1px solid #2a2a30;
  background: #0d0d10;
  color: #555;
  font-family: inherit;
  font-size: 11px;
  font-weight: 600;
  cursor: pointer;
  text-align: center;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  transition:
    color 0.15s,
    background 0.15s;
}

.dir-btn:first-child {
  border-right: none;
}

.dir-btn:hover {
  color: #aaa;
}

.dir-btn.active {
  background: #1a1a24;
  color: #9d6cff;
  border-color: #6f2bff55;
}

/* Visuals bar - desktop dropdown */
.visuals-bar {
  position: relative;
  flex-shrink: 0;
  flex-direction: column;
  gap: 4px;
}

.visuals-toggle {
  height: 34px;
  padding: 0 14px;
  border: 1px solid #9d6cff44;
  background: rgba(157, 108, 255, 0.06);
  color: #9d6cff;
  font-family: inherit;
  font-size: 11px;
  font-weight: 600;
  cursor: pointer;
  transition: background 0.15s;
  white-space: nowrap;
}

.visuals-toggle:hover {
  background: rgba(157, 108, 255, 0.14);
}

.visuals-toggle.open {
  background: rgba(157, 108, 255, 0.18);
  border-color: #9d6cff88;
}

.visuals-panel {
  display: none;
  flex-direction: column;
  gap: 2px;
  position: absolute;
  top: calc(100% + 4px);
  left: 0;
  background: #1a1a1e;
  border: 1px solid #2a2a30;
  padding: 6px;
  min-width: 110px;
  box-shadow: 0 4px 16px rgba(0, 0, 0, 0.55);
  z-index: 30;
}

.visuals-panel .dir-btn {
  border-right: 1px solid #2a2a30 !important;
}

.visuals-panel-open {
  display: flex !important;
}

.options-group {
  display: flex;
  flex-direction: row;
  gap: 0;
  flex-wrap: wrap;
}

.options-group+.options-group {
  margin-top: 4px;
  padding-top: 4px;
  border-top: 1px solid #2a2a30;
}

.options-group-lbl {
  font-size: 9px;
  font-weight: 700;
  color: #444;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  padding: 0 4px 2px;
  width: 100%;
}

/* VueDatePicker dark theme overrides */
.dp__theme_dark {
  --dp-background-color: #0d0d10;
  --dp-text-color: #e0e0e0;
  --dp-hover-color: #1e1e24;
  --dp-hover-text-color: #fff;
  --dp-primary-color: #6f2bff;
  --dp-primary-text-color: #fff;
  --dp-secondary-color: #1e1e24;
  --dp-border-color: #2a2a30;
  --dp-menu-border-color: #2a2a30;
  --dp-border-color-hover: #9d6cff55;
  --dp-icon-color: #9d6cff;
  --dp-highlight-color: rgba(111, 43, 255, 0.12);
  --dp-range-between-dates-background-color: rgba(111, 43, 255, 0.15);
  --dp-range-between-dates-text-color: #e0e0e0;
  --dp-range-between-border-color: rgba(111, 43, 255, 0.15);
  --dp-font-family: "JetBrains Mono", monospace;
  --dp-font-size: 12px;
  --dp-cell-size: 30px;
}

.dp-logs .dp__input {
  background: #0d0d10;
  border: 1px solid #2a2a30;
  color: #e0e0e0;
  font-family: "JetBrains Mono", monospace;
  font-size: 12px;
  padding: 7px 10px;
  height: auto;
  border-radius: 0;
  min-width: 200px;
}

.dp-logs-single .dp__input {
  min-width: 140px;
}

.dp-logs .dp__input:focus {
  border-color: #6f2bff55;
  outline: none;
}

.dp-logs .dp__input_icon {
  display: none;
}

.dp-logs .dp__input_icon_pad {
  padding-left: 10px;
}

.dp-logs .dp__clear_icon {
  color: #555;
  right: 6px;
}

/* AutoMod bar */
.automod-bar {
  flex-shrink: 0;
}

.automod-toggle {
  height: 28px;
  padding: 0 14px;
  border: 1px solid #e5c07b44;
  background: rgba(229, 192, 123, 0.06);
  color: #e5c07b;
  font-family: inherit;
  font-size: 11px;
  font-weight: 600;
  cursor: pointer;
  transition: background 0.15s;
}

.automod-toggle:hover {
  background: rgba(229, 192, 123, 0.14);
}

.automod-toggle.active {
  background: rgba(229, 192, 123, 0.18);
  border-color: #e5c07b88;
}

/* AutoMod log rows - same log-event-label pattern as first-message/sub, amber tone */
.log-row-automod {
  background: rgba(229, 192, 123, 0.05);
  border-left: 2px solid #e5c07b44;
}

.log-row-automod:hover {
  background: rgba(229, 192, 123, 0.09);
}

.log-row-automod :deep(.log-row) {
  align-items: center;
}

:deep(.log-event-label.tone-automod) {
  background: rgba(229, 192, 123, 0.16);
  border-color: rgba(229, 192, 123, 0.55);
  color: #e5c07b;
}

.search-summary {
  display: none;
}

@media (max-width: 680px) {
  .logs-view {
    height: calc(100dvh - 52px - 5px);
    overflow: hidden;
    gap: 0;
    margin: -30px;
  }

  .logs-header {
    padding: 10px 14px 6px;
    flex-shrink: 0;
  }

  .logs-title {
    font-size: 15px;
    margin-bottom: 2px;
  }

  .search-summary {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 7px 14px;
    background: #141418;
    border-bottom: 1px solid #1e1e24;
    cursor: pointer;
    flex-shrink: 0;
    user-select: none;
  }

  .summary-text {
    display: flex;
    align-items: center;
    gap: 8px;
    flex-wrap: wrap;
    font-size: 11px;
  }

  .summary-ch {
    color: #9d6cff;
    font-weight: 700;
  }

  .summary-tag {
    color: #888;
    background: #1e1e24;
    padding: 1px 6px;
  }

  .summary-chevron {
    font-size: 9px;
    color: #555;
    flex-shrink: 0;
  }

  .search-bar-wrapper {
    flex-direction: column;
    gap: 8px;
    align-items: center;
  }

  .search-bar {
    flex-direction: column;
    align-items: stretch;
    gap: 8px;
    padding: 10px 14px;
    flex-shrink: 0;
    overflow: hidden;
    transition:
      max-height 0.2s ease,
      padding 0.2s ease;
    max-height: 400px;
    width: 100%;
  }

  .search-bar-content {
    flex-direction: column;
    align-items: stretch;
    gap: 8px;
  }

  .search-bar-collapsed {
    max-height: 0 !important;
    padding: 0 14px !important;
  }

  .field-input {
    width: 100% !important;
  }

  .dp-logs .dp__input {
    min-width: 0;
    width: 100%;
  }

  .search-btn {
    width: 100%;
  }

  .snippet-info {
    display: none !important;
  }

  /* Visuals: always show inline on mobile, no dropdown */
  .visuals-toggle {
    display: none !important;
  }

  .visuals-panel {
    display: flex !important;
    position: static;
    background: none;
    border: none;
    padding: 0;
    box-shadow: none;
    flex-direction: row;
    min-width: 0;
    flex-wrap: wrap;
    gap: 6px;
  }

  /* Bigger touch targets on mobile */
  .dir-btn {
    height: 40px;
    width: auto !important;
    min-width: 72px;
    padding: 0 14px;
    font-size: 13px;
  }

  .options-group {
    gap: 6px;
  }

  .logs-results {
    flex: 1;
    min-height: 0;
    display: flex;
    flex-direction: column;
  }

  .logs-table-wrap {
    flex: 1;
    min-height: 0;
    display: block;
  }

  .logs-table-shell {
    width: 100% !important;
    min-height: 0;
  }

  .logs-table {
    flex: 1;
    min-height: 0;
    display: flex;
    flex-direction: column;
  }

  .day-jump-bar,
  .event-rail,
  .logs-resize-handle {
    display: none !important;
  }

  .logs-thead {
    display: none !important;
  }

  .logs-tbody {
    flex: 1;
    min-height: 0;
    overflow-y: auto;
    -webkit-overflow-scrolling: touch;
  }

  :deep(.log-day-sep) {
    display: block;
    padding: 6px 12px 3px;
    font-size: 10px;
    font-weight: 700;
    color: #555;
    letter-spacing: 0.05em;
    border-top: 1px solid #1e1e24;
    background: #0d0d10;
  }

  .pinned-day-header {
    right: 0;
  }

  :deep(.log-row) {
    display: flex !important;
    flex-wrap: nowrap;
    align-items: baseline;
    gap: 5px;
    padding: 3px 12px;
    grid-template-columns: unset !important;
  }

  :deep(.log-time-col) {
    min-width: auto;
    margin-right: 0;
  }

  :deep(.log-event-label) {
    display: none;
  }

  :deep(.log-time) {
    display: none;
  }

  :deep(.log-time-short) {
    display: block;
    flex-shrink: 0;
    color: #555;
    font-size: 11px;
    white-space: nowrap;
  }

  :deep(.log-badges) {
    display: none;
  }

  :deep(.log-user) {
    display: none;
  }

  :deep(.log-msg-wrap) {
    flex: 1;
    min-width: 0;
    display: block;
  }

  :deep(.log-msg-wrap:not(.is-system-mod) > .log-msg) {
    display: none;
  }

  :deep(.log-mobile-msgline) {
    display: block;
    font-size: 12px;
    color: #ccc;
    line-height: 1.6;
    word-break: break-word;
  }

  :deep(.log-mobile-badges) {
    display: inline-flex;
    align-items: center;
    gap: 3px;
    margin-right: 4px;
    vertical-align: middle;
  }

  :deep(.log-mobile-badges .badge-img) {
    width: 16px;
    height: 16px;
  }

  :deep(.log-mobile-user) {
    font-weight: 600;
    vertical-align: baseline;
  }

  :deep(.log-mobile-user-colon) {
    color: #555;
    margin-right: 5px;
  }

  :deep(.log-mobile-msg) {
    display: inline;
  }

  :deep(.log-msg) {
    font-size: 12px;
    min-width: 0;
    word-break: break-word;
  }

  :deep(.log-share) {
    flex-shrink: 0;
    opacity: 0.5 !important;
  }
}
</style>
