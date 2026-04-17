<script setup lang="ts">
import { ref, computed, watch, onMounted, onUnmounted, nextTick } from 'vue'
import { useRouter } from 'vue-router'
import { API } from '../api'
import { useAuth } from '../auth'
import { useI18n } from '../i18n'
import { VueDatePicker } from '@vuepic/vue-datepicker'
import '@vuepic/vue-datepicker/dist/main.css'

const { session } = useAuth()
const { t } = useI18n()
const router = useRouter()

interface LogMsg {
  id: string; text: string; username: string; displayName: string
  channel: string; timestamp: string; tags?: Record<string, string>
}
interface EmoteMap { [name: string]: string }
interface BadgeChip {
  key: string
  label: string
  kind: 'twitch' | 'seventv' | 'marker'
  imageUrl?: string
  title?: string
}
interface EventMeta {
  label: string
  icon: string
  tone: 'first' | 'sub' | 'announce'
}
interface TwitchBadgeAsset { imageUrl: string; title: string }
interface SevenTvBadgeAsset { imageUrl: string; title: string }
  
// Input refs - read directly from DOM, not tracked by Vue reactivity.
// This prevents any re-render on every keystroke.
const channelInputRef    = ref<HTMLInputElement | null>(null)
const userInputRef       = ref<HTMLInputElement | null>(null)
const termInputRef       = ref<HTMLInputElement | null>(null)
const dateFromInputRef   = ref<HTMLInputElement | null>(null)
const dateUntilInputRef  = ref<HTMLInputElement | null>(null)

// These are only updated when a search actually runs (for URL sync and summary bar)
const channel    = ref('')
const userFilter = ref('')
const termFilter = ref('')
const dateFilter = ref('')
const dateFrom   = ref('')
const dateUntil  = ref('')

function readInputs() {
  channel.value    = channelInputRef.value?.value.trim().toLowerCase().replace(/^#/, '') ?? channel.value
  userFilter.value = userInputRef.value?.value.trim() ?? userFilter.value
  termFilter.value = termInputRef.value?.value.trim() ?? termFilter.value
  dateFrom.value   = dateFromInputRef.value?.value ?? dateFrom.value
  dateUntil.value  = dateUntilInputRef.value?.value ?? dateUntil.value
  // Backwards compat: if only "from" is set, dateFilter = single day
  dateFilter.value = dateFrom.value
}

interface AutomodMsg {
  id: string; text: string; username: string; displayName: string
  channel: string; timestamp: string
  _automod: true; _category: string; _status: string
}

const msgs         = ref<LogMsg[]>([])
const automodMsgs  = ref<AutomodMsg[]>([])
const showAutomod  = ref(false)   // toggled by user; only shown to broadcaster
const isBroadcaster = ref(false)  // true when viewing own channel
const loading     = ref(false)
const loadingMore = ref(false)
const noMore      = ref(false)
const error       = ref('')
const searched    = ref(false)
const emoteMap    = ref<EmoteMap>({})
const twitchBadgeMap = ref<Map<string, TwitchBadgeAsset>>(new Map())
const sevenTvBadgeMap = ref<Map<string, SevenTvBadgeAsset>>(new Map())
const bodyRef     = ref<HTMLDivElement | null>(null)
const visualsBarRef = ref<HTMLElement | null>(null)
const highlightId = ref<string | null>(null)
const copyToast     = ref(false)
const searchExpanded = ref(true)
const direction   = ref<'newest' | 'oldest'>('newest')  // sort direction

let cursorDate:  Date | null = null
let cursorMonth: { y: number; m: number } | null = null
let abortCtrl = new AbortController()
let scrollListenerAttached = false
let windowScrollAttached  = false

const VIRTUAL_THRESHOLD = 500
const VIRTUAL_OVERSCAN = 80
const VIRTUAL_ROW_ESTIMATE = 30
const virtualStart = ref(0)
const virtualEnd = ref(0)
const loadingOverlayLogoUrl = 'https://cdn.7tv.app/emote/01G0PEAVDR0008B1SW0M995JQJ/2x.gif'
const domSettling = ref(false)
const pendingPaintJobs = ref(0)
let domSettleToken = 0

const isMobile = () => window.matchMedia('(max-width: 680px)').matches

const hide7tv        = ref(false)
const plainUsernames  = ref(false)
const visualsOpen     = ref(false)

function formatDateRange(dates: Date[] | null): string {
  if (!dates || !dates[0]) return ''
  const fmt = (d: Date) => d.toISOString().slice(0, 10)
  return dates[1] && dates[1].getTime() !== dates[0].getTime()
    ? `${fmt(dates[0])} → ${fmt(dates[1])}`
    : fmt(dates[0])
}

const dateRange = computed({
  get: (): Date[] | null => {
    if (!dateFrom.value) return null
    const from = new Date(dateFrom.value + 'T00:00:00')
    const until = dateUntil.value ? new Date(dateUntil.value + 'T00:00:00') : from
    return [from, until]
  },
  set: (val: Date[] | null) => {
    if (val && val[0]) {
      const fmt = (d: Date) => d.toISOString().slice(0, 10)
      dateFrom.value = fmt(val[0])
      dateUntil.value = val[1] ? fmt(val[1]) : fmt(val[0])
    } else {
      dateFrom.value = ''
      dateUntil.value = ''
    }
  }
})

function onDocClickVisuals(e: MouseEvent) {
  if (visualsOpen.value && visualsBarRef.value && !visualsBarRef.value.contains(e.target as Node)) {
    visualsOpen.value = false
  }
}

// >>> URL state sync
function buildUrl(msgId: string | null = null) {
  const p = new URLSearchParams()
  if (channel.value.trim())    p.set('channel', channel.value.trim().toLowerCase().replace(/^#/, ''))
  if (userFilter.value.trim()) p.set('user',    userFilter.value.trim())
  if (termFilter.value.trim()) p.set('term',    termFilter.value.trim())
  if (dateFrom.value)          p.set('from',    dateFrom.value)
  if (dateUntil.value)         p.set('until',   dateUntil.value)
  const qs   = p.toString() ? '?' + p.toString() : ''
  const hash = msgId ? `#msg-${msgId}` : ''
  return window.location.pathname + qs + hash
}

function pushSearchUrl() {
  history.replaceState(null, '', buildUrl())
}

function pushHash(msgId: string) {
  history.replaceState(null, '', buildUrl(msgId))
}

function readUrlState() {
  const p = new URLSearchParams(window.location.search)
  if (p.get('channel')) channel.value    = p.get('channel')!
  if (p.get('user'))    userFilter.value = p.get('user')!
  if (p.get('term'))    termFilter.value = p.get('term')!
  // Support legacy ?date= and new ?from=&until=
  if (p.get('from'))    dateFrom.value   = p.get('from')!
  else if (p.get('date')) dateFrom.value = p.get('date')!
  if (p.get('until'))   dateUntil.value  = p.get('until')!
  dateFilter.value = dateFrom.value
}

function readHashId(): string | null {
  const m = window.location.hash.match(/^#msg-(.+)$/)
  return m ? m[1]! : null
}

// >>> nameColWidth: computed only when msgs changes, never on input typing
const nameColWidth = ref(140)
watch(msgs, (list: LogMsg[]) => {
  if (!list.length) { nameColWidth.value = 140; return }
  let max = 0
  for (const m of list) {
    const len = (m.displayName || m.username).length
    if (len > max) max = len
  }
  nameColWidth.value = Math.min(240, Math.max(80, max * 7.8))
}, { flush: 'post' })

// >>> Emotes
async function fetchEmotes(ch: string) {
  emoteMap.value = {}
  for (const path of [`/emotes/${ch}`, `/emotes/twitch/${ch}`]) {
    try {
      const r = await fetch(`${API}${path}`)
      if (r.ok) { const d = await r.json() as any; for (const e of d.emotes ?? []) emoteMap.value[e.name] = e.url }
    } catch {}
  }
}

async function fetchTwitchBadges(ch: string) {
  twitchBadgeMap.value = new Map()
  try {
    const r = await fetch(`${API}/twitch/badges/${encodeURIComponent(ch)}`, {
      headers: session.value ? { Authorization: `Bearer ${session.value.token}` } : {}
    })
    if (!r.ok) return
    const d = await r.json() as any
    const src = d?.badgeMap ?? {}
    const m = new Map<string, TwitchBadgeAsset>()
    for (const [k, v] of Object.entries(src)) {
      const b = v as any
      const imageUrl = String(b?.image_url_2x ?? b?.image_url_1x ?? '')
      if (!imageUrl) continue
      m.set(k, {
        imageUrl,
        title: String(b?.title ?? k),
      })
    }
    twitchBadgeMap.value = m
  } catch {}
}

async function fetchDay(ch: string, y: number, m: number, d: number, signal: AbortSignal): Promise<LogMsg[]> {
  const mm  = String(m).padStart(2, '0')
  const dd  = String(d).padStart(2, '0')
  const params = new URLSearchParams({ channel: ch, year: String(y), month: mm, day: dd, limit: '10000' })
  if (termFilter.value.trim()) params.set('q', termFilter.value.trim())
  const _t0 = performance.now()
  const res = await fetch(`${API}/logs/day?${params}`, { signal })
  if (!res.ok) return []
  const raw = await res.text()
  const _fetchMs = performance.now() - _t0 | 0
  const data = JSON.parse(raw) as any
  let messages: LogMsg[] = data?.messages ?? []
  console.debug(`[logs:fetchDay] ${ch} ${y}-${mm}-${dd} → ${messages.length} msgs, ${(raw.length/1024)|0}KB, ${_fetchMs}ms`)
  if (termFilter.value.trim()) {
    const term = termFilter.value.trim().toLowerCase()
    messages = messages.filter(m => m.text.toLowerCase().includes(term))
  }
  return messages
}

async function fetchMonth(ch: string, y: number, m: number, signal: AbortSignal): Promise<LogMsg[]> {
  const mm  = String(m).padStart(2, '0')
  const u   = userFilter.value.trim().toLowerCase()
  const params = new URLSearchParams({ channel: ch, user: u, year: String(y), month: mm, limit: '100000' })
  const _t0 = performance.now()
  const res = await fetch(`${API}/logs/usermonth?${params}`, { signal })
  if (!res.ok) return []
  const raw = await res.text()
  const _fetchMs = performance.now() - _t0 | 0
  const data = JSON.parse(raw) as any
  let messages: LogMsg[] = data?.messages ?? []
  console.debug(`[logs:fetchMonth] ${ch} ${y}-${mm} user=${u||'(all)'} → ${messages.length} msgs, ${(raw.length/1024)|0}KB, ${_fetchMs}ms`)
  if (termFilter.value.trim()) {
    const term = termFilter.value.trim().toLowerCase()
    messages = messages.filter(m => m.text.toLowerCase().includes(term))
  }
  return messages
}

function prevDay(d: Date): Date {
  const p = new Date(d); p.setDate(p.getDate() - 1); return p
}
function prevMonth(ym: { y: number; m: number }): { y: number; m: number } {
  return ym.m === 1 ? { y: ym.y - 1, m: 12 } : { y: ym.y, m: ym.m - 1 }
}

async function prependMsgs(newMsgs: LogMsg[]) {
  const body   = bodyRef.value
  const prevST = body?.scrollTop ?? 0
  const prevSH = body?.scrollHeight ?? 0
  msgs.value = [...newMsgs, ...msgs.value]
  await nextTick()
  if (body) body.scrollTop = prevST + (body.scrollHeight - prevSH)
}

async function loadOlder() {
  if (loadingMore.value || noMore.value) return
  const ch     = channel.value.trim().toLowerCase().replace(/^#/, '')
  const signal = abortCtrl.signal
  const cutoff = new Date(); cutoff.setFullYear(cutoff.getFullYear() - 2)

  if (userFilter.value.trim()) {
    if (!cursorMonth) { noMore.value = true; return }
    loadingMore.value = true
    const cur = cursorMonth
    cursorMonth = prevMonth(cur)
    if (new Date(cur.y, cur.m - 1, 1) < cutoff) { noMore.value = true; loadingMore.value = false; return }
    try {
      const newMsgs = await fetchMonth(ch, cur.y, cur.m, signal)
      if (signal.aborted) { loadingMore.value = false; return }
      if (newMsgs.length > 0) await prependMsgs(newMsgs)
      else { loadingMore.value = false; return loadOlder() }
    } catch {}
    loadingMore.value = false
  } else {
    if (!cursorDate) { noMore.value = true; return }
    loadingMore.value = true
    const d = cursorDate
    cursorDate = prevDay(d)
    if (d < cutoff) { noMore.value = true; loadingMore.value = false; return }
    try {
      const newMsgs = await fetchDay(ch, d.getFullYear(), d.getMonth() + 1, d.getDate(), signal)
      if (signal.aborted) { loadingMore.value = false; return }
      if (newMsgs.length > 0) await prependMsgs(newMsgs)
      else { loadingMore.value = false; return loadOlder() }
    } catch {}
    loadingMore.value = false
  }
}

async function loadUntilMsg(targetId: string): Promise<boolean> {
  const cutoff = new Date(); cutoff.setFullYear(cutoff.getFullYear() - 2)
  const ch     = channel.value.trim().toLowerCase().replace(/^#/, '')
  const signal = abortCtrl.signal
  while (true) {
    if (msgs.value.some(m => m.id === targetId)) return true
    if (signal.aborted) return false
    if (userFilter.value.trim()) {
      if (!cursorMonth) return false
      const cur = cursorMonth
      cursorMonth = prevMonth(cur)
      if (new Date(cur.y, cur.m - 1, 1) < cutoff) { noMore.value = true; return false }
      try {
        const newMsgs = await fetchMonth(ch, cur.y, cur.m, signal)
        if (newMsgs.length > 0) await prependMsgs(newMsgs)
      } catch { return false }
    } else {
      if (!cursorDate || cursorDate < cutoff) { noMore.value = true; return false }
      const d = cursorDate
      cursorDate = prevDay(d)
      try {
        const newMsgs = await fetchDay(ch, d.getFullYear(), d.getMonth() + 1, d.getDate(), signal)
        if (newMsgs.length > 0) await prependMsgs(newMsgs)
      } catch { return false }
    }
  }
}

function onScroll() {
  recalcVirtualWindow()
  if (!bodyRef.value || loadingMore.value || noMore.value) return
  if (bodyRef.value.scrollTop < 120) loadOlder()
}

function recalcVirtualWindow() {
  const body = bodyRef.value
  const total = displayItems.value.length
  if (!body || total === 0) {
    virtualStart.value = 0
    virtualEnd.value = total
    return
  }

  if (!useVirtual.value) {
    virtualStart.value = 0
    virtualEnd.value = total
    return
  }

  const viewportRows = Math.ceil(body.clientHeight / VIRTUAL_ROW_ESTIMATE)
  const firstRow = Math.max(0, Math.floor(body.scrollTop / VIRTUAL_ROW_ESTIMATE) - VIRTUAL_OVERSCAN)
  const endRow = Math.min(total, firstRow + viewportRows + VIRTUAL_OVERSCAN * 2)

  virtualStart.value = firstRow
  virtualEnd.value = endRow
}

function attachScrollListener() {
  if (scrollListenerAttached || !bodyRef.value) return
  bodyRef.value.addEventListener('scroll', onScroll, { passive: true })
  scrollListenerAttached = true
}

function detachScrollListeners() {
  if (bodyRef.value) bodyRef.value.removeEventListener('scroll', onScroll)
  scrollListenerAttached = false
  windowScrollAttached   = false
}

// >>> Fetch automod messages for current day (broadcaster-only)
async function fetchAutomod(ch: string, date?: string) {
  automodMsgs.value = []
  isBroadcaster.value = session.value?.login === ch
  if (!isBroadcaster.value || !session.value) return
  try {
    const d = date ? new Date(date) : new Date()
    const y  = d.getFullYear()
    const mo = String(d.getMonth() + 1).padStart(2, '0')
    const dy = String(d.getDate()).padStart(2, '0')
    const res = await fetch(`${API}/logs/automod/${ch}?year=${y}&month=${mo}&day=${dy}`, {
      headers: { Authorization: `Bearer ${session.value.token}` }
    })
    if (res.ok) {
      const data = await res.json() as { messages: AutomodMsg[] }
      automodMsgs.value = data.messages ?? []
    }
  } catch {}
}

// >>> Fetch the oldest available log date for a channel (for oldest-first mode)
async function fetchOldestDate(ch: string): Promise<Date> {
  try {
    const res = await fetch(`${API}/logs/available/${ch}`, {
      headers: { Authorization: `Bearer ${session.value!.token}` }
    })
    if (res.ok) {
      const data = await res.json() as { months: { year: number; month: number }[] }
      const months = data.months ?? []
      if (months.length) {
        const oldest = months[months.length - 1]! // sorted newest-first, so last = oldest
        return new Date(Date.UTC(oldest.year, oldest.month - 1, 1))
      }
    }
  } catch {}
  // fallback: 2 years ago
  const d = new Date(); d.setFullYear(d.getFullYear() - 2); return d
}

// >>> Main search
async function search() {
  readInputs()
  if (!channel.value.trim()) { error.value = 'Channel is required.'; return }
  const _dbgT0 = performance.now()
  console.debug('[logs:search] started', { channel: channel.value, dateFrom: dateFrom.value, dateUntil: dateUntil.value, user: userFilter.value })

  const hashId = readHashId()
  pushSearchUrl()

  abortCtrl.abort(); abortCtrl = new AbortController()
  detachScrollListeners()

  if (isMobile()) searchExpanded.value = false
  loading.value = true; error.value = ''; searched.value = true
  msgs.value = []; noMore.value = false; loadingMore.value = false; highlightId.value = null
  paintAutoRequested = 0
  virtualStart.value = 0; virtualEnd.value = 0
  cursorDate = null; cursorMonth = null
  const ch = channel.value.trim().toLowerCase().replace(/^#/, '')
  fetchEmotes(ch)
  fetchTwitchBadges(ch)
  fetchAutomod(ch, dateFrom.value || undefined)
  const today   = new Date()
  const isUser  = !!userFilter.value.trim()

  // >>> Date range: fetch each day individually and merge
  if (dateFrom.value) {
    const startDate = new Date(dateFrom.value + 'T00:00:00')
    const endDate   = dateUntil.value ? new Date(dateUntil.value + 'T00:00:00') : startDate
    // Safety: cap range at 90 days
    const maxRange = 90
    const diffDays = Math.round((endDate.getTime() - startDate.getTime()) / 86_400_000)
    if (diffDays < 0) { error.value = 'End date must be after start date.'; loading.value = false; return }
    if (diffDays > maxRange) { error.value = `Date range too large (max ${maxRange} days).`; loading.value = false; return }

    try {
      const allMsgs: LogMsg[] = []
      const d = new Date(startDate)
      while (d <= endDate) {
        if (abortCtrl.signal.aborted) break
        const dayMsgs = isUser
          ? await fetchMonth(ch, d.getFullYear(), d.getMonth() + 1, abortCtrl.signal)
              .then(ms => ms.filter(msg => msg.timestamp.startsWith(d.toISOString().slice(0, 10))))
          : await fetchDay(ch, d.getFullYear(), d.getMonth() + 1, d.getDate(), abortCtrl.signal)
        allMsgs.push(...dayMsgs)
        d.setDate(d.getDate() + 1)
      }
      msgs.value = allMsgs
    } catch {}
    loading.value = false; noMore.value = true
    if (hashId) await scrollToMsg(hashId, true); else scrollToBottom()
    return
  }

  // >>> Oldest-first: find the oldest available date and load from there going forward
  if (direction.value === 'oldest') {
    const startDate = await fetchOldestDate(ch)
    const nextDay = (d: Date) => { const n = new Date(d); n.setDate(n.getDate() + 1); return n }
    const nextMonth = (ym: { y: number; m: number }) =>
      ym.m === 12 ? { y: ym.y + 1, m: 1 } : { y: ym.y, m: ym.m + 1 }

    if (isUser) {
      let cur = { y: startDate.getFullYear(), m: startDate.getMonth() + 1 }
      try { msgs.value = await fetchMonth(ch, cur.y, cur.m, abortCtrl.signal) } catch {}
      // Walk forward until we find messages
      while (!msgs.value.length && !abortCtrl.signal.aborted) {
        cur = nextMonth(cur)
        if (new Date(cur.y, cur.m - 1, 1) > today) break
        try { msgs.value = await fetchMonth(ch, cur.y, cur.m, abortCtrl.signal) } catch {}
      }
      // cursorMonth now points to the NEXT month (for loading newer)
      cursorMonth = nextMonth(cur)
    } else {
      let d = new Date(startDate)
      try { msgs.value = await fetchDay(ch, d.getFullYear(), d.getMonth() + 1, d.getDate(), abortCtrl.signal) } catch {}
      while (!msgs.value.length && d <= today && !abortCtrl.signal.aborted) {
        d = nextDay(d)
        try { msgs.value = await fetchDay(ch, d.getFullYear(), d.getMonth() + 1, d.getDate(), abortCtrl.signal) } catch {}
      }
      cursorDate = nextDay(d)
    }
    loading.value = false
    // Oldest-first: scroll to top (earliest messages)
    nextTick(() => { if (bodyRef.value) bodyRef.value.scrollTop = 0 })
    return
  }

  if (isUser) {
    const y = today.getFullYear(), m = today.getMonth() + 1
    try { msgs.value = await fetchMonth(ch, y, m, abortCtrl.signal) } catch {}
    cursorMonth = prevMonth({ y, m })
    // >>> If current month empty, walk backwards up to 1 year to find logs
    if (!msgs.value.length && !abortCtrl.signal.aborted) {
      const cutoff = new Date(); cutoff.setFullYear(cutoff.getFullYear() - 1)
      while (!msgs.value.length && !abortCtrl.signal.aborted) {
        const cur = cursorMonth
        if (new Date(cur.y, cur.m - 1, 1) < cutoff) break
        cursorMonth = prevMonth(cur)
        try { msgs.value = await fetchMonth(ch, cur.y, cur.m, abortCtrl.signal) } catch {}
      }
    }
    loading.value = false
    if (hashId) {
      if (!msgs.value.some(msg => msg.id === hashId)) {
        const found = await loadUntilMsg(hashId)
        if (found) await scrollToMsg(hashId, true)
        else { scrollToBottom(); error.value = 'Could not find linked message.' }
      } else {
        await scrollToMsg(hashId, true)
      }
    } else {
      scrollToBottom()
    }
  } else {
    try { msgs.value = await fetchDay(ch, today.getFullYear(), today.getMonth() + 1, today.getDate(), abortCtrl.signal) } catch {}
    cursorDate = prevDay(today)
    // >>> If today empty, walk backwards up to 1 year to find logs
    if (!msgs.value.length && !abortCtrl.signal.aborted) {
      const cutoff = new Date(); cutoff.setFullYear(cutoff.getFullYear() - 1)
      while (!msgs.value.length && cursorDate && cursorDate > cutoff && !abortCtrl.signal.aborted) {
        const d = cursorDate
        cursorDate = prevDay(d)
        try { msgs.value = await fetchDay(ch, d.getFullYear(), d.getMonth() + 1, d.getDate(), abortCtrl.signal) } catch {}
      }
    }
    loading.value = false
    if (hashId) {
      if (!msgs.value.some(msg => msg.id === hashId)) {
        const found = await loadUntilMsg(hashId)
        if (found) await scrollToMsg(hashId, true)
        else { scrollToBottom(); error.value = 'Could not find linked message.' }
      } else {
        await scrollToMsg(hashId, true)
      }
    } else {
      scrollToBottom()
    }
  }

  const _dbgTDone = performance.now()
  console.debug(`[logs:search] done — ${msgs.value.length} msgs, virtual=${useVirtual.value}, total=${_dbgTDone - _dbgT0 | 0}ms`)

  await nextTick()
  attachScrollListener()
  recalcVirtualWindow()
  await autoFillIfShort()
}

async function autoFillIfShort() {
  if (noMore.value) return
  await nextTick()
  const body = bodyRef.value; if (!body) return
  let safety = 0
  while (body.scrollHeight <= body.clientHeight + 20 && !noMore.value && safety++ < 10) {
    await loadOlder()
    await nextTick()
  }
}

function scrollToBottom() {
  nextTick(() => { if (bodyRef.value) bodyRef.value.scrollTop = bodyRef.value.scrollHeight })
}

async function scrollToMsg(id: string, highlight = false): Promise<void> {
  if (useVirtual.value) {
    const idx = displayItems.value.findIndex((it) => it.kind !== 'day' && it.msg.id === id)
    if (idx >= 0) {
      const body = bodyRef.value
      if (body) {
        body.scrollTop = Math.max(0, idx * VIRTUAL_ROW_ESTIMATE - body.clientHeight * 0.5)
      }
      recalcVirtualWindow()
      await nextTick()
    }
  }

  const deadline = Date.now() + 3000
  let el: HTMLElement | null = null
  while (Date.now() < deadline) {
    await nextTick()
    await new Promise<void>(r => requestAnimationFrame(() => r()))
    el = document.getElementById(`log-${id}`)
    if (el) break
    await new Promise(r => setTimeout(r, 80))
  }
  if (!el) return
  el.scrollIntoView({ behavior: 'smooth', block: 'center' })
  if (highlight) {
    highlightId.value = id
    setTimeout(() => { if (highlightId.value === id) highlightId.value = null }, 3000)
  }
}

function hasMsg(id: string): boolean {
  return msgs.value.some(m => m.id === id)
}

function jumpToLoadedMessageNow(id: string): boolean {
  const el = document.getElementById(`log-${id}`)
  if (!el) return false
  el.scrollIntoView({ behavior: 'smooth', block: 'center' })
  highlightId.value = id
  setTimeout(() => { if (highlightId.value === id) highlightId.value = null }, 3000)
  return true
}

async function jumpToMessage(id: string): Promise<void> {
  const targetId = (id || '').trim()
  if (!targetId) return

  pushHash(targetId)

  // Fast path: already rendered in DOM
  if (jumpToLoadedMessageNow(targetId)) return

  // Fast path: already in loaded data; wait one render cycle and jump.
  if (hasMsg(targetId)) {
    await nextTick()
    if (jumpToLoadedMessageNow(targetId)) return
    await scrollToMsg(targetId, true)
    return
  }

  // If the target is not loaded yet, keep loading older chunks until found or exhausted.
  let safety = 0
  while (!hasMsg(targetId) && !noMore.value && safety++ < 60) {
    await loadOlder()
    await nextTick()
  }

  await scrollToMsg(targetId, true)
}

async function jumpToReplyParent(m: LogMsg): Promise<void> {
  const parentId = m.tags?.['reply-parent-msg-id']?.trim() ?? ''
  if (!parentId) return
  await jumpToMessage(parentId)
}

function shareMsg(m: LogMsg) {
  pushHash(m.id)
  highlightId.value = m.id
  setTimeout(() => { if (highlightId.value === m.id) highlightId.value = null }, 3000)
  navigator.clipboard.writeText(window.location.href).catch(() => {})
  copyToast.value = true
  setTimeout(() => copyToast.value = false, 2000)
}

onMounted(async () => {
  document.body.classList.add('logs-open')
  // Warm logo decode once so the floating indicator appears instantly.
  const preload = new Image()
  preload.src = loadingOverlayLogoUrl
  readUrlState()
  if (!channel.value && session.value?.channel) {
    channel.value = session.value.channel
    await nextTick()
    if (channelInputRef.value) channelInputRef.value.value = channel.value
  }
  // Populate date inputs from URL state
  await nextTick()
  if (dateFromInputRef.value && dateFrom.value) dateFromInputRef.value.value = dateFrom.value
  if (dateUntilInputRef.value && dateUntil.value) dateUntilInputRef.value.value = dateUntil.value
  window.addEventListener('resize', recalcVirtualWindow)
  document.addEventListener('click', onDocClickVisuals, true)
  if (channel.value) await search()
})
onUnmounted(() => {
  document.body.classList.remove('logs-open')
  document.body.classList.remove('logs-jobs-running')
  abortCtrl.abort()
  detachScrollListeners()
  window.removeEventListener('resize', recalcVirtualWindow)
  document.removeEventListener('click', onDocClickVisuals, true)
  stopPopupDrag()
})

// >>> Rendering
function fmtTs(ts: string) {
  const d = new Date(ts)
  return d.toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', year: '2-digit' })
    + ' ' + d.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit', second: '2-digit' })
}

function fmtTimeOnly(ts: string) {
  const d = new Date(ts)
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
}

function fmtDayLabel(ts: string) {
  const d = new Date(ts)
  return d.toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric' })
}

type DisplayItem =
  | { kind: 'day';     label: string }
  | { kind: 'msg';     msg: LogMsg }
  | { kind: 'automod'; msg: AutomodMsg }

const displayItems = computed<DisplayItem[]>(() => {
  // Merge regular msgs + automod msgs (if enabled), sort by timestamp
  type AnyMsg = (LogMsg | AutomodMsg) & { _automod?: boolean }
  let all: AnyMsg[] = [...msgs.value]
  if (showAutomod.value && isBroadcaster.value) {
    all = [...all, ...automodMsgs.value as any[]]
    all.sort((a, b) => a.timestamp < b.timestamp ? -1 : a.timestamp > b.timestamp ? 1 : 0)
  }
  const items: DisplayItem[] = []
  let lastDay = ''
  for (const m of all) {
    const day = fmtDayLabel(m.timestamp)
    if (day !== lastDay) { items.push({ kind: 'day', label: day }); lastDay = day }
    if ((m as any)._automod) items.push({ kind: 'automod', msg: m as AutomodMsg })
    else                     items.push({ kind: 'msg',     msg: m as LogMsg })
  }
  return items
})

const useVirtual = computed(() => searched.value && displayItems.value.length > VIRTUAL_THRESHOLD)

const visibleDisplayItems = computed<DisplayItem[]>(() => {
  if (!useVirtual.value) return displayItems.value
  return displayItems.value.slice(virtualStart.value, virtualEnd.value)
})

const topSpacerHeight = computed(() => useVirtual.value ? virtualStart.value * VIRTUAL_ROW_ESTIMATE : 0)
const bottomSpacerHeight = computed(() => {
  if (!useVirtual.value) return 0
  return Math.max(0, (displayItems.value.length - virtualEnd.value) * VIRTUAL_ROW_ESTIMATE)
})
const hasRunningJobs = computed(() => loading.value || loadingMore.value || domSettling.value || pendingPaintJobs.value > 0)
const showFloatingFetch = computed(() => hasRunningJobs.value)
let floatingFetchStartedAt: number | null = null

function loadingDebugSnapshot() {
  return {
    loading: loading.value,
    loadingMore: loadingMore.value,
    domSettling: domSettling.value,
    pendingPaintJobs: pendingPaintJobs.value,
    msgs: msgs.value.length,
    displayItems: displayItems.value.length,
    visibleItems: visibleDisplayItems.value.length,
    useVirtual: useVirtual.value,
  }
}

function markDomSettling() {
  const token = ++domSettleToken
  domSettling.value = true
  void nextTick()
    .then(() => new Promise<void>((resolve) => requestAnimationFrame(() => resolve())))
    .then(() => new Promise<void>((resolve) => requestAnimationFrame(() => resolve())))
    .then(() => {
      if (token === domSettleToken) domSettling.value = false
    })
}

function userColor(m: LogMsg): string {
  const tc = m.tags?.['color']
  if (tc && tc !== '') return tc
  const colors = ['#ff7f7f','#ff9f40','#ffcf56','#6dd672','#4ec9b0','#56b6c2','#9d6cff','#c792ea','#f78c6c','#89ddff']
  let h = 0
  for (let i = 0; i < m.username.length; i++) h = (h * 31 + m.username.charCodeAt(i)) & 0xffffffff
  return colors[Math.abs(h) % colors.length]!
}

function userColorByName(username: string): string {
  const colors = ['#ff7f7f','#ff9f40','#ffcf56','#6dd672','#4ec9b0','#56b6c2','#9d6cff','#c792ea','#f78c6c','#89ddff']
  let h = 0
  for (let i = 0; i < username.length; i++) h = (h * 31 + username.charCodeAt(i)) & 0xffffffff
  return colors[Math.abs(h) % colors.length]!
}

function renderMsg(text: string): string {
  const em = emoteMap.value
  if (!Object.keys(em).length) return esc(text)
  return text.split(' ').map(word => {
    const url = em[word]
    return url ? `<img class="chat-emote" src="${url}" alt="${esc(word)}" title="${esc(word)}" loading="lazy">` : esc(word)
  }).join(' ')
}

function renderMsgWithMap(text: string, em: EmoteMap): string {
  if (!Object.keys(em).length) return esc(text)
  return text.split(' ').map(word => {
    const url = em[word]
    return url ? `<img class="chat-emote" src="${url}" alt="${esc(word)}" title="${esc(word)}" loading="lazy">` : esc(word)
  }).join(' ')
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function formatDisplayedMsg(m: LogMsg): string {
  const text = m.text ?? ''
  if (!m.tags?.['reply-parent-msg-id']) return text

  const candidates = [
    m.tags['reply-parent-display-name'],
    m.tags['reply-parent-user-login'],
  ].filter((x): x is string => !!x && !!x.trim())

  for (const raw of candidates) {
    const name = raw.trim().replace(/^@/, '')
    if (!name) continue
    const rx = new RegExp(`^\\s*@?${escapeRegExp(name)}[:;,]?\\s+`, 'i')
    if (rx.test(text)) return text.replace(rx, '')
  }

  return text
}

function renderMsgForMessage(m: LogMsg): string {
  const key = (m.username ?? '').toLowerCase()
  const personal = personalEmoteMaps.value.get(key) ?? {}
  const merged: EmoteMap = { ...emoteMap.value, ...personal }
  return renderMsgWithMap(formatDisplayedMsg(m), merged)
}

function userNameStyle(m: LogMsg): Record<string, string> {
  if (plainUsernames.value) return { color: '#ffffff', '--snippet-fallback-color': '#ffffff', '--snippet-paint-preview': '#ffffff' }
  const fallback = userColor(m)
  const painted = hide7tv.value ? undefined : paintStyles.value.get(m.username?.toLowerCase() ?? '')
  return painted
    ? { ...painted, '--snippet-fallback-color': fallback }
    : { color: fallback, '--snippet-fallback-color': fallback, '--snippet-paint-preview': fallback }
}

function snippetPaintPreview(m: LogMsg): string {
  const painted = paintStyles.value.get(m.username?.toLowerCase() ?? '')
  const preview = painted?.['--snippet-paint-preview']
  if (typeof preview === 'string' && preview.trim()) return preview
  return userColor(m)
}

function isModerationSystemMessage(m: LogMsg): boolean {
  const u = String(m.username ?? '').trim().toLowerCase()
  const t = String(m.text ?? '').trim().toLowerCase()
  if (!u || !t) return false
  return (
    t.startsWith(`${u} has been banned`) ||
    t.startsWith(`${u} has been timed out`) ||
    t.startsWith(`${u} was timed out`) ||
    t.includes(' has been banned') ||
    t.includes(' has been timed out') ||
    t.includes(' was timed out by ')
  )
}

function buildBadgeChips(m: LogMsg): BadgeChip[] {
  const out: BadgeChip[] = []
  const tags = m.tags ?? {}
  const seen = new Set<string>()
  const sources = [tags['badges'] ?? '', tags['source-badges'] ?? '']

  for (const src of sources) {
    const raw = src.split(',').map(x => x.trim()).filter(Boolean)
    for (const entry of raw) {
      const [setId = '', version = ''] = entry.split('/')
      if (!setId || !version) continue
      const k = `${setId}/${version}`
      if (seen.has(k)) continue
      seen.add(k)
      const asset = twitchBadgeMap.value.get(k)
      out.push({
        key: k,
        label: setId,
        kind: 'twitch',
        imageUrl: asset?.imageUrl,
        title: asset?.title ?? `${setId} ${version}`,
      })
    }
  }
  const sev = sevenTvBadgeMap.value.get((m.username ?? '').toLowerCase())
  if (!hide7tv.value && sev?.imageUrl) {
    out.push({ key: '7tv', label: '7TV', kind: 'seventv', imageUrl: sev.imageUrl, title: sev.title })
  }
  return out
}

function getEventMeta(m: LogMsg): EventMeta | null {
  const tags = m.tags ?? {}
  if (tags['first-msg'] === '1') {
    return { label: 'First Message', icon: '✦', tone: 'first' }
  }
  const msgId = String(tags['msg-id'] ?? '').toLowerCase()
  if (msgId === 'sub' || msgId === 'resub') {
    return { label: 'Subscribed', icon: '★', tone: 'sub' }
  }
  if (msgId === 'subgift') {
    return { label: 'Gift Subscription', icon: '★', tone: 'sub' }
  }
  if (msgId === 'submysterygift') {
    return { label: 'Community Gift', icon: '★', tone: 'sub' }
  }
  if (msgId === 'announcement') {
    return { label: 'Announcement', icon: '📣', tone: 'announce' }
  }
  return null
}

function isHighlightedEvent(m: LogMsg): boolean {
  return getEventMeta(m) !== null
}

function eventToneClass(m: LogMsg): string {
  const meta = getEventMeta(m)
  return meta ? `tone-${meta.tone}` : ''
}

function esc(s: string) {
  return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;')
}

// >>> 7TV paint: fetched via backend /twitch/user which resolves Twitch ID → 7TV
// >>> Keyed by lowercase username. null = no paint, undefined = not fetched yet.
const paintCache  = new Map<string, { stops: any[]; shadows: any[]; imageUrl: string | null; color?: number | null; angle?: number | null; function?: string | null; repeat?: boolean } | null>()
const paintStyles = ref<Map<string, Record<string, string>>>(new Map())
const personalEmoteMaps = ref<Map<string, EmoteMap>>(new Map())
const PAINT_MAX_CONCURRENT = 4
const PAINT_AUTO_LIMIT = 32
let paintConcurrent = 0
const paintQueue: string[] = []
let paintAutoRequested = 0

function intToRgba(c: number): string {
  const r = (c >>> 24) & 0xff
  const g = (c >>> 16) & 0xff
  const b = (c >>> 8)  & 0xff
  const a = (c & 0xff) / 255
  return `rgba(${r},${g},${b},${a.toFixed(3)})`
}

function intToOpaqueOnDark(c: number): string {
  const r = (c >>> 24) & 0xff
  const g = (c >>> 16) & 0xff
  const b = (c >>> 8)  & 0xff
  const a = (c & 0xff) / 255
  // Match snippet background (#0d0d10) so translucent paints keep their true hue.
  const bgR = 13
  const bgG = 13
  const bgB = 16
  const outR = Math.round(r * a + bgR * (1 - a))
  const outG = Math.round(g * a + bgG * (1 - a))
  const outB = Math.round(b * a + bgB * (1 - a))
  return `rgb(${outR}, ${outG}, ${outB})`
}

function colorAlphaByte(c: number): number {
  return c & 0xff
}

function buildPaintStyle(paint: { imageUrl: string | null; stops: { at: number; color: number }[]; shadows: any[]; color?: number | null; angle?: number | null; function?: string | null; repeat?: boolean }, fallbackColor?: string): Record<string, string> {
  const styles: Record<string, string> = {}
  const stopsArr = Array.isArray(paint.stops) ? paint.stops : []
  const firstStopColor = stopsArr[0]?.color ?? 0
  const normStops = stopsArr.length >= 2
    ? stopsArr
    : stopsArr.length === 1
      ? [{ at: 0, color: firstStopColor }, { at: 1, color: firstStopColor }]
      : []

  if (normStops.length >= 2) {
    const stops = normStops.map(s => `${intToRgba(s.color)} ${Math.round((s.at ?? 0) * 100)}%`).join(', ')
    const angle = Number.isFinite(paint.angle as number) ? Number(paint.angle) : 90
    const fn = paint.repeat ? 'repeating-linear-gradient' : 'linear-gradient'
    const bestStop = normStops.reduce((best, cur) => colorAlphaByte(cur.color) > colorAlphaByte(best.color) ? cur : best)
    styles['--snippet-paint-preview'] = intToOpaqueOnDark(bestStop.color)
    styles['backgroundImage'] = `${fn}(${angle}deg, ${stops})`
    styles['backgroundClip'] = 'text'
    styles['WebkitBackgroundClip'] = 'text'
    styles['color'] = 'transparent'
    styles['WebkitTextFillColor'] = 'transparent'
    styles['lineHeight'] = '1.1rem'
  } else if (paint.imageUrl) {
    if (paint.color !== null && paint.color !== undefined) {
      styles['--snippet-paint-preview'] = intToOpaqueOnDark(paint.color)
    } else if (fallbackColor) {
      styles['--snippet-paint-preview'] = fallbackColor
    }
    styles['backgroundImage'] = `url(${paint.imageUrl})`
    styles['backgroundSize'] = 'cover'
    styles['backgroundPosition'] = 'center center'
    if (paint.color !== null && paint.color !== undefined) styles['backgroundColor'] = intToRgba(paint.color)
    styles['backgroundClip'] = 'text'
    styles['WebkitBackgroundClip'] = 'text'
    styles['color'] = 'transparent'
    styles['WebkitTextFillColor'] = 'transparent'
    styles['lineHeight'] = '1.1rem'
  } else if (paint.color !== null && paint.color !== undefined) {
    styles['--snippet-paint-preview'] = intToOpaqueOnDark(paint.color)
    styles['color'] = intToRgba(paint.color)
  } else if (fallbackColor) {
    // Some 7TV paints are glow-only and provide no fill stops/color.
    styles['--snippet-paint-preview'] = fallbackColor
    styles['color'] = fallbackColor
  }
  if (paint.shadows?.length) {
    styles['filter'] = paint.shadows
      .map(s => `drop-shadow(${s.x_offset ?? 0}px ${s.y_offset ?? 0}px ${s.radius ?? 0}px ${intToRgba(s.color)})`)
      .join(' ')
  }
  return styles
}

function drainPaintQueue() {
  while (paintConcurrent < PAINT_MAX_CONCURRENT && paintQueue.length > 0) {
    const next = paintQueue.shift()
    if (!next) break
    paintConcurrent += 1
    pendingPaintJobs.value += 1
    void fetchPaint(next).finally(() => {
      paintConcurrent = Math.max(0, paintConcurrent - 1)
      pendingPaintJobs.value = Math.max(0, pendingPaintJobs.value - 1)
      drainPaintQueue()
    })
  }
}

async function fetchPaint(key: string) {
  try {
    const res = await fetch(`${API}/twitch/user/${encodeURIComponent(key)}`, {
      headers: session.value ? { Authorization: `Bearer ${session.value.token}` } : {}
    })
    if (!res.ok) {
      paintCache.delete(key)
      return
    }
    const data = await res.json() as {
      paint?: any
      sevenTv?: {
        hasAccount?: boolean
        hasPersonalSet?: boolean
        badge?: { id?: string; url?: string; tooltip?: string | null }
      }
      personalEmotes?: Array<{ id: string; name: string; url: string }>
      twitchUserEmotes?: Array<{ id: string; name: string; url: string }>
    }
    if (data.paint) {
      paintCache.set(key, data.paint)
      const newMap = new Map(paintStyles.value)
      newMap.set(key, buildPaintStyle(data.paint, userColorByName(key)))
      paintStyles.value = newMap
    }
    const sevBadgeUrl = String(data.sevenTv?.badge?.url ?? '').trim()
    if (sevBadgeUrl) {
      const next = new Map(sevenTvBadgeMap.value)
      next.set(key, {
        imageUrl: sevBadgeUrl,
        title: String(data.sevenTv?.badge?.tooltip ?? '7TV Badge'),
      })
      sevenTvBadgeMap.value = next
    }
    const hasSevenTvPersonal = Array.isArray(data.personalEmotes) && data.personalEmotes.length > 0
    const hasTwitchUser = Array.isArray(data.twitchUserEmotes) && data.twitchUserEmotes.length > 0
    if (hasSevenTvPersonal || hasTwitchUser) {
      const p: EmoteMap = {}
      for (const e of data.personalEmotes ?? []) {
        if (e?.name && e?.url) p[e.name] = e.url
      }
      for (const e of data.twitchUserEmotes ?? []) {
        if (e?.name && e?.url) p[e.name] = e.url
      }
      const next = new Map(personalEmoteMaps.value)
      next.set(key, p)
      personalEmoteMaps.value = next
    }
  } catch {
    paintCache.delete(key)
  }
}

async function ensurePaint(username: string) {
  const key = username.toLowerCase()
  if (paintCache.has(key)) return
  paintCache.set(key, null) // mark queued/fetching to avoid duplicate requests
  paintQueue.push(key)
  drainPaintQueue()
}

watch(visibleDisplayItems, (list) => {
  if (paintAutoRequested >= PAINT_AUTO_LIMIT) return
  const seen = new Set<string>()
  for (const item of list) {
    if (item.kind !== 'msg') continue
    if (paintAutoRequested >= PAINT_AUTO_LIMIT) break
    const u = item.msg.username?.toLowerCase()
    if (u && !seen.has(u) && !paintCache.has(u)) {
      seen.add(u)
      paintAutoRequested += 1
      ensurePaint(u)
    }
  }
}, { flush: 'post' })

watch(displayItems, async () => {
  const _t0 = performance.now()
  recalcVirtualWindow()
  await nextTick()
  const _t1 = performance.now()
  console.debug(`[logs:displayItems] recalcVirtualWindow=${(_t1-_t0)|0}ms, items=${displayItems.value.length}, virtual=${useVirtual.value}, visible=${visibleDisplayItems.value.length}`)
  markDomSettling()
}, { flush: 'post' })

watch(paintStyles, () => {
  // Avoid retriggering DOM settling for each background paint update.
  if (loading.value || loadingMore.value) markDomSettling()
}, { flush: 'post' })

watch(hasRunningJobs, (running) => {
  document.body.classList.toggle('logs-jobs-running', running)
}, { immediate: true })

watch([loading, loadingMore, domSettling, pendingPaintJobs], ([l, lm, ds, pp], [prevL, prevLm, prevDs, prevPp]) => {
  if (l === prevL && lm === prevLm && ds === prevDs && pp === prevPp) return
  console.debug('[logs:loading-state]', loadingDebugSnapshot())
}, { flush: 'sync' })

watch(showFloatingFetch, (visible, prevVisible) => {
  if (visible && !prevVisible) {
    floatingFetchStartedAt = performance.now()
    console.debug('[logs:overlay] show', loadingDebugSnapshot())
    return
  }
  if (!visible && prevVisible) {
    const elapsed = floatingFetchStartedAt == null ? 0 : ((performance.now() - floatingFetchStartedAt) | 0)
    floatingFetchStartedAt = null
    console.debug(`[logs:overlay] hide after ${elapsed}ms`, loadingDebugSnapshot())
  }
}, { immediate: true })

// >>> User popup
interface TwitchUser {
  login: string; displayName: string; avatar: string
  createdAt: string
  ownFollowers: number | null
  followedAt:  string | null
  subbedSince: string | null
  subTier:     string | null
  nameHistory: { name: string; lastSeen: string }[]
  paint: { id: string; name: string; imageUrl: string | null; shadows: any[]; stops: any[]; color?: number | null; angle?: number | null; function?: string | null; repeat?: boolean } | null
  botInChannel: boolean
}
const popup        = ref<{ username: string; channel: string; x: number; y: number } | null>(null)
const popupUser    = ref<TwitchUser | null>(null)
const popupLoading = ref(false)
const popupDragging = ref(false)
let popupDragStartX = 0
let popupDragStartY = 0
let popupStartX = 0
let popupStartY = 0

function onPopupDragMove(evt: MouseEvent) {
  if (!popupDragging.value || !popup.value) return
  const dx = evt.clientX - popupDragStartX
  const dy = evt.clientY - popupDragStartY
  const nextX = popupStartX + dx
  const nextY = popupStartY + dy
  const maxX = Math.max(0, window.innerWidth - 240)
  const maxY = Math.max(0, window.innerHeight - 120)
  popup.value = {
    ...popup.value,
    x: Math.min(maxX, Math.max(0, nextX)),
    y: Math.min(maxY, Math.max(0, nextY)),
  }
}

function stopPopupDrag() {
  popupDragging.value = false
  window.removeEventListener('mousemove', onPopupDragMove)
  window.removeEventListener('mouseup', stopPopupDrag)
}

function startPopupDrag(evt: MouseEvent) {
  if (!popup.value) return
  popupDragging.value = true
  popupDragStartX = evt.clientX
  popupDragStartY = evt.clientY
  popupStartX = popup.value.x
  popupStartY = popup.value.y
  window.addEventListener('mousemove', onPopupDragMove)
  window.addEventListener('mouseup', stopPopupDrag)
  evt.preventDefault()
}

function openUserPopup(username: string, ch: string, evt: MouseEvent) {
  evt.stopPropagation()
  popup.value     = { username, channel: ch, x: evt.clientX, y: evt.clientY }
  popupUser.value = null
  popupLoading.value = true
  fetch(`${API}/twitch/user/${encodeURIComponent(username.toLowerCase())}?channel=${encodeURIComponent(ch)}`, {
    headers: session.value ? { Authorization: `Bearer ${session.value.token}` } : {}
  })
    .then(r => r.ok ? r.json() as Promise<TwitchUser> : Promise.reject())
    .then(u => { popupUser.value = u })
    .catch(() => {})
    .finally(() => { popupLoading.value = false })
}

function closePopup() { popup.value = null; popupUser.value = null }

function openUsercardPopout(username: string, ch: string) {
  window.open(`https://www.twitch.tv/popout/${ch}/viewercard/${username}`, '_blank', 'width=340,height=560')
}

function goToLogsForUser(username: string, ch: string) {
  channel.value    = ch
  userFilter.value = username
  if (channelInputRef.value) channelInputRef.value.value = ch
  if (userInputRef.value)    userInputRef.value.value    = username
  closePopup()
  search()
}

function fmtFollowers(n: number): string {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1).replace(/.0$/, '') + 'M'
  if (n >= 1_000)     return (n / 1_000).toFixed(1).replace(/.0$/, '') + 'K'
  return String(n)
}
function fmtJoined(iso: string): string {
  return new Date(iso).toLocaleDateString([], { day: '2-digit', month: 'short', year: 'numeric' })
}
function fmtDuration(iso: string): string {
  const ms     = Date.now() - new Date(iso).getTime()
  const days   = Math.floor(ms / 86_400_000)
  const months = Math.floor(days / 30.44)
  const years  = Math.floor(months / 12)
  const remMo  = months % 12
  if (years > 0 && remMo > 0) return `${years}y ${remMo}mo`
  if (years > 0)              return `${years}y`
  if (months > 0)             return `${months}mo`
  return `${days}d`
}
function subTierLabel(tier: string): string {
  return tier === '3000' ? 'Tier 3' : tier === '2000' ? 'Tier 2' : 'Tier 1'
}
function paintNameStyle(paint: { imageUrl: string | null; stops: { at: number; color: number }[]; shadows: any[]; color?: number | null; angle?: number | null; function?: string | null; repeat?: boolean }): Record<string, string> {
  return buildPaintStyle(paint)
}
</script>

<template>
  <div class="logs-view" @click="closePopup">
    <div class="logs-header">
      <div class="logs-title">{{ t('logs.title') }}</div>
      <div class="logs-sub">{{ t('logs.sub') }}</div>
    </div>

    <!-- Mobile: collapsed summary bar -->
    <div class="search-summary show-mobile" @click="searchExpanded = !searchExpanded">
      <span class="summary-text">
        <span class="summary-ch">#{{ channel || '?' }}</span>
        <span v-if="userFilter" class="summary-tag">@{{ userFilter }}</span>
        <span v-if="termFilter" class="summary-tag">"{{ termFilter }}"</span>
        <span v-if="dateFrom" class="summary-tag">{{ dateFrom }}{{ dateUntil && dateUntil !== dateFrom ? ' → ' + dateUntil : '' }}</span>
      </span>
      <span class="summary-chevron">{{ searchExpanded ? '▲' : '▼' }}</span>
    </div>

    <div class="search-bar-wrapper">
      <div class="search-bar" :class="{ 'search-bar-collapsed': !searchExpanded }">
        <div class="search-bar-content">
          <div class="field-wrap">
            <label class="field-lbl">{{ t('logs.field.channel') }}</label>
            <input
              ref="channelInputRef"
              :value="channel"
              class="field-input"
              placeholder="channelname"
              @input="channel = ($event.target as HTMLInputElement).value"
              @keydown.enter="search"
              autocomplete="off"
              spellcheck="false"
            />
          </div>
          <div class="field-wrap">
            <label class="field-lbl">{{ t('logs.field.user') }} <span class="opt">{{ t('logs.field.optional') }}</span></label>
            <input
              ref="userInputRef"
              :value="userFilter"
              class="field-input"
              placeholder="username"
              @input="userFilter = ($event.target as HTMLInputElement).value"
              @keydown.enter="search"
              autocomplete="off"
              spellcheck="false"
            />
          </div>
          <div class="field-wrap">
            <label class="field-lbl">{{ t('logs.field.term') }} <span class="opt">{{ t('logs.field.optional') }}</span></label>
            <input
              ref="termInputRef"
              :value="termFilter"
              class="field-input"
              placeholder="search term"
              @input="termFilter = ($event.target as HTMLInputElement).value"
              @keydown.enter="search"
              autocomplete="off"
              spellcheck="false"
            />
          </div>
          <div class="field-wrap">
            <label class="field-lbl">Date range <span class="opt">{{ t('logs.field.optional') }}</span></label>
            <VueDatePicker
              v-model="dateRange"
              range
              no-time-picker
              :multi-calendars="false"
              dark
              auto-apply
              :format="formatDateRange"
              placeholder="Pick a date range"
              class="dp-logs"
              :teleport="true"
            />
          </div>
          <div class="field-wrap">
            <label class="field-lbl">Direction</label>
            <div class="dir-toggle">
              <button class="dir-btn" :class="{ active: direction === 'newest' }" @click="direction = 'newest'">↓ Newest</button>
              <button class="dir-btn" :class="{ active: direction === 'oldest' }" @click="direction = 'oldest'">↑ Oldest</button>
            </div>
          </div>
              <!-- Visuals bar -->
          <div class="field-wrap visuals-bar" ref="visualsBarRef">
            <label class="field-lbl hide-mobile">Visuals</label>
            <button class="visuals-toggle hide-mobile" :class="{ open: visualsOpen }" @click.stop="visualsOpen = !visualsOpen">
              Visuals {{ visualsOpen ? '▲' : '▼' }}
            </button>
            <div class="visuals-panel" :class="{ 'visuals-panel-open': visualsOpen }" @click.stop>
              <button class="dir-btn" :class="{ active: !hide7tv }" @click="hide7tv = !hide7tv" title="Toggle 7TV paints & badges">7TV</button>
              <button class="dir-btn" :class="{ active: plainUsernames }" @click="plainUsernames = !plainUsernames" title="Show all usernames in white">White names</button>
            </div>
          </div>
          <button class="search-btn" @click="search" :disabled="loading">
            {{ loading ? '…' : t('logs.search') }}
          </button>
        </div>
      </div>
      <div class="snippet-info" v-if="false"><!-- moved to global SnippetOverlay --></div>
    </div>

    <!-- Automod toggle -->
    <div v-if="searched && isBroadcaster && automodMsgs.length > 0" class="automod-bar">
      <button class="automod-toggle" :class="{ active: showAutomod }" @click="showAutomod = !showAutomod">
        ⚠ AutoMod ({{ automodMsgs.length }}) {{ showAutomod ? '- click to hide' : '- click to show' }}
      </button>
    </div>

    <div v-if="error" class="logs-error">{{ error }}</div>

    <!-- Copy toast -->
    <transition name="toast-fade">
      <div v-if="copyToast" class="copy-toast">{{ t('logs.copied') }}</div>
    </transition>

    <div v-if="!searched && !loading" class="logs-empty">{{ t('logs.empty') }}</div>
    <div v-else-if="loading" class="logs-empty">{{ t('logs.searching') }}</div>
    <div v-else-if="searched && !msgs.length && !loadingMore" class="logs-empty">{{ t('logs.no_results') }}</div>

    <div v-else-if="searched" class="logs-results">
      <div class="logs-count">{{ msgs.length.toLocaleString() }} {{ t('logs.count') }}</div>
      <div class="logs-table" :style="{ '--user-width': nameColWidth + 'px' }">
        <div class="logs-thead">
          <div>{{ t('logs.col.time') }}</div>
          <div>{{ t('logs.col.user') }}</div>
          <div>{{ t('logs.col.msg') }}</div>
        </div>
        <div class="logs-tbody" ref="bodyRef">
          <div class="top-loader" v-show="loadingMore">
            <span class="spinner">⟳</span> {{ t('logs.load_older') }}
          </div>
          <div v-if="noMore && !userFilter && !termFilter && !dateFilter" class="top-loader no-more">{{ t('logs.no_older') }}</div>

          <div v-if="useVirtual" :style="{ height: topSpacerHeight + 'px' }"></div>

          <!-- Selection rectangle is now handled globally by SnippetOverlay -->

          <template v-for="item in visibleDisplayItems" :key="item.kind === 'day' ? 'day-' + item.label : item.msg.id">
            <div v-if="item.kind === 'day'" class="log-day-sep">{{ item.label }}</div>

            <div
              v-else-if="item.kind === 'automod'"
              class="log-row log-row-automod"
            >
              <div class="log-time">{{ fmtTs(item.msg.timestamp) }}</div>
              <div class="log-time-short">{{ fmtTimeOnly(item.msg.timestamp) }}</div>
              <div class="log-user log-automod-badge">⚠ AutoMod</div>
              <div class="log-msg">
                <span class="automod-user">{{ item.msg.username }}</span>:
                <span class="automod-text">{{ item.msg.text }}</span>
                <span class="automod-category">[{{ item.msg._category }}]</span>
                <span class="automod-status" :class="item.msg._status">{{ item.msg._status }}</span>
              </div>
            </div>

            <div
              v-else
              :id="`log-${item.msg.id}`"
              class="log-row-outer"
              :class="{ highlighted: highlightId === item.msg.id, 'log-row-reply': !!item.msg.tags?.['reply-parent-msg-body'], 'log-row-event': isHighlightedEvent(item.msg) }"
            >
              <div class="log-row">
                <div class="log-time-col">
                  <div v-if="getEventMeta(item.msg)" class="log-event-label" :class="eventToneClass(item.msg)">
                    <span class="log-event-icon">{{ getEventMeta(item.msg)!.icon }}</span>
                    <span>{{ getEventMeta(item.msg)!.label }}</span>
                  </div>
                  <div class="log-time">{{ fmtTs(item.msg.timestamp) }}</div>
                  <div class="log-time-short">{{ fmtTimeOnly(item.msg.timestamp) }}</div>
                </div>
                <div v-if="!isModerationSystemMessage(item.msg) && buildBadgeChips(item.msg).length" class="log-badges">
                  <template
                    v-for="b in buildBadgeChips(item.msg)"
                    :key="`${item.msg.id}-${b.kind}-${b.key}`"
                  >
                    <img
                      v-if="b.imageUrl"
                      class="badge-img"
                      :src="b.imageUrl"
                      :alt="b.title || b.label"
                      :title="b.title || b.label"
                      loading="lazy"
                    />
                    <span v-else class="badge-fallback" :title="b.title || b.label">{{ b.label }}</span>
                  </template>
                </div>
                <div
                  v-if="!isModerationSystemMessage(item.msg)"
                  class="log-user"
                  :data-snippet-paint="snippetPaintPreview(item.msg)"
                  :style="userNameStyle(item.msg)"
                  :class="{ 'log-user-clickable': true }"
                  @click.stop="openUserPopup(item.msg.username, channel || item.msg.channel?.replace('#',''), $event)"
                >{{ item.msg.displayName || item.msg.username }}</div>
                <div
                  class="log-msg-wrap"
                  :class="{ 'has-reply': !!item.msg.tags?.['reply-parent-msg-body'], 'is-system-mod': isModerationSystemMessage(item.msg) }"
                >
                  <div v-if="!isModerationSystemMessage(item.msg)" class="log-mobile-msgline">
                    <span v-if="buildBadgeChips(item.msg).length" class="log-mobile-badges">
                      <template
                        v-for="b in buildBadgeChips(item.msg)"
                        :key="`mob-${item.msg.id}-${b.kind}-${b.key}`"
                      >
                        <img
                          v-if="b.imageUrl"
                          class="badge-img"
                          :src="b.imageUrl"
                          :alt="b.title || b.label"
                          :title="b.title || b.label"
                          loading="lazy"
                        />
                        <span v-else class="badge-fallback" :title="b.title || b.label">{{ b.label }}</span>
                      </template>
                    </span>
                    <span
                      class="log-mobile-user"
                      :data-snippet-paint="snippetPaintPreview(item.msg)"
                      :style="userNameStyle(item.msg)"
                    >{{ item.msg.displayName || item.msg.username }}</span><span class="log-mobile-user-colon">:</span>
                    <span class="log-mobile-msg" v-html="renderMsgForMessage(item.msg)"></span>
                  </div>
                  <div
                    v-if="item.msg.tags?.['reply-parent-msg-body']"
                    class="reply-context"
                    :class="{ 'reply-context-link': !!item.msg.tags?.['reply-parent-msg-id'] }"
                    :title="item.msg.tags?.['reply-parent-msg-id'] ? 'Jump to replied message' : undefined"
                    @click.stop="jumpToReplyParent(item.msg)"
                  >
                    <span class="reply-icon">⮣</span>
                    <span class="reply-parent-user">@{{ item.msg.tags['reply-parent-display-name'] || item.msg.tags['reply-parent-user-login'] || '?' }}:</span>
                    <span class="reply-parent-body">{{ item.msg.tags['reply-parent-msg-body'] }}</span>
                  </div>
                  <div class="log-msg" v-html="renderMsgForMessage(item.msg)"></div>
                </div>
                <div class="log-share" @click="shareMsg(item.msg)" title="Copy link">
                  <svg viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
                    <path d="M10 2L14 6L10 10" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
                    <path d="M14 6H6C4.34 6 3 7.34 3 9V14" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
                  </svg>
                </div>
              </div>
            </div>
          </template>

          <div v-if="useVirtual" :style="{ height: bottomSpacerHeight + 'px' }"></div>
        </div>
      </div>
    </div>

    <!-- Screenshot toast moved to global SnippetOverlay -->

    <!-- User popup -->
    <div v-if="popup" class="user-popup" :style="{ top: popup.y + 'px', left: popup.x + 'px' }" @click.stop>
      <div class="popup-header" @mousedown.stop="startPopupDrag">
        <div class="popup-avatar-wrap">
          <img v-if="popupUser?.avatar" :src="popupUser.avatar" class="popup-avatar" />
          <div v-else class="popup-avatar-placeholder">{{ popup.username[0]?.toUpperCase() }}</div>
        </div>
        <div class="popup-title-block">
          <div class="popup-name">{{ popupUser?.displayName ?? popup.username }}</div>
          <div class="popup-sub">in #{{ popup.channel }}</div>
        </div>
        <button class="popup-close" @mousedown.stop @click="closePopup">✕</button>
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
              <span class="stat-val">{{ fmtFollowers(popupUser.ownFollowers!) }}</span>
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
                <template v-if="popupUser.followedAt">Following for {{ fmtDuration(popupUser.followedAt) }}</template>
                <template v-else>Not following</template>
              </span>
            </div>
            <div class="popup-rel" :class="popupUser.subbedSince ? 'rel-yes' : 'rel-no'">
              <span class="rel-icon">★</span>
              <span class="rel-label">
                <template v-if="popupUser.subbedSince">{{ subTierLabel(popupUser.subTier ?? '1000') }} · {{ fmtDuration(popupUser.subbedSince) }}</template>
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
        <div v-else class="popup-loading" style="color:#555">Could not load profile.</div>
      </div>
      <div class="popup-actions">
        <button class="popup-btn" @click="goToLogsForUser(popup.username, popup.channel)">Logs</button>
        <button class="popup-btn" @click="openUsercardPopout(popup.username, popup.channel)">↗ Twitch</button>
      </div>
    </div>

    <div class="logs-fetch-floating" :class="{ visible: showFloatingFetch }" aria-live="polite" :aria-busy="showFloatingFetch ? 'true' : 'false'">
      <img class="logs-fetch-logo" :src="loadingOverlayLogoUrl" alt="ShyBoti loading" loading="eager" decoding="async" fetchpriority="high" />
      <span class="logs-fetch-text">logs getting displayed...</span>
    </div>
  </div>
</template>

<style scoped>
.logs-view   { display: flex; flex-direction: column; gap: 16px; height: 100%; min-height: 0; margin: -20px; padding: 20px; }
.logs-header { flex-shrink: 0; }
.logs-title  { font-size: 18px; font-weight: 700; color: #e0e0e0; margin-bottom: 4px; }
.logs-sub    { font-size: 12px; color: #555; }

.search-bar-wrapper { display: flex; gap: 12px; align-items: flex-start; flex-shrink: 0; }
.search-bar  { display: flex; align-items: flex-end; gap: 10px; flex-wrap: wrap; background: #141418; padding: 14px 16px; flex-shrink: 0; flex: 1; }
.search-bar-content { display: flex; align-items: flex-end; gap: 10px; flex-wrap: wrap; }
.field-wrap  { display: flex; flex-direction: column; gap: 4px; }
.snippet-info { display: flex; flex-direction: column; gap: 4px; flex-shrink: 0; align-items: center; }
.snippet-gif-wrap { position: relative; cursor: pointer; display: inline-block; }
.snippet-gif { display: block; max-height: 60px; max-width: 180px; border: 1px solid #2a2a30; }
.snippet-hover-overlay {
  position: absolute; inset: 0;
  background: rgba(13, 13, 16, 0.78);
  display: flex; align-items: center; justify-content: center;
  font-size: 11px; font-weight: 700; color: #9d6cff;
  pointer-events: none;
  letter-spacing: .04em;
}

.field-lbl   { font-size: 10px; font-weight: 700; color: #555; text-transform: uppercase; letter-spacing: .06em; display: flex; gap: 5px; align-items: center; }
.opt         { font-size: 9px; color: #383838; font-weight: 400; text-transform: none; }
.field-input { background: #0d0d10; border: 1px solid #2a2a30; color: #e0e0e0; font-family: inherit; font-size: 12px; padding: 7px 10px; outline: none; width: 160px; transition: border-color .15s; }
.field-input:focus { border-color: #6f2bff55; }
.date-input  { width: 140px; color-scheme: dark; }
.date-range-wrap { display: flex; align-items: center; gap: 6px; }
.date-range-sep  { color: #555; font-size: 12px; flex-shrink: 0; }
.search-btn  { height: 34px; padding: 0 20px; background: #6f2bff; border: none; color: #fff; font-family: inherit; font-size: 12px; font-weight: 700; cursor: pointer; align-self: flex-end; transition: background .15s; }
.search-btn:hover:not(:disabled) { background: #7f3fff; }
.search-btn:disabled { opacity: .4; cursor: default; }

.logs-error  { color: #f14949; font-size: 12px; padding: 8px 14px; background: rgba(241,73,73,.08); border-left: 2px solid #f14949; flex-shrink: 0; }
.logs-empty  { color: #444; font-size: 13px; padding: 40px; text-align: center; }
.logs-count  { font-size: 11px; color: #555; padding: 0 2px 4px; flex-shrink: 0; }

.copy-toast {
  position: fixed; bottom: 24px; left: 50%; transform: translateX(-50%);
  background: #1e2a1e; border: 1px solid #23d18b55; color: #23d18b;
  font-size: 12px; padding: 8px 18px; pointer-events: none; z-index: 9999;
}
.toast-fade-enter-active, .toast-fade-leave-active { transition: opacity .2s, transform .2s; }
.toast-fade-enter-from, .toast-fade-leave-to { opacity: 0; transform: translateX(-50%) translateY(8px); }

.logs-results { display: flex; flex-direction: column; flex: 1; min-height: 0; }
.logs-table   { display: flex; flex-direction: column; flex: 1; min-height: 0; }
.logs-thead {
  display: grid;
  grid-template-columns: 120px var(--user-width, 140px) 1fr;
  align-items: baseline;
  padding: 7px 0  14px;
  background: #0d0d10;
  border: 1px solid #1e1e24;
  font-size: 10px;
  color: #555;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  flex-shrink: 0;
  justify-items: center;
  
}


.logs-tbody   { overflow-y: auto; flex: 1; position: relative; }
.logs-tbody::-webkit-scrollbar { width: 3px; }
.logs-tbody::-webkit-scrollbar-thumb { background: #333; }
.tbody-selecting { cursor: crosshair !important; user-select: none !important; }

.top-loader  { text-align: center; font-size: 11px; color: #555; padding: 8px; }
.top-loader.no-more { color: #333; }
.spinner     { display: inline-block; animation: spin 1s linear infinite; }
@keyframes spin { to { transform: rotate(360deg); } }

.log-row-outer {
  border-bottom: 1px solid #1a1a1e;
  transition: background .1s; position: relative;
}
.log-row-outer:hover { background: #1a1a1e; }
.log-row-outer.highlighted { animation: hl-fade 3s ease forwards; }
.log-row-outer.log-row-event {
  background: linear-gradient(90deg, rgba(200, 50, 200, 0.16), rgba(200, 50, 200, 0.02) 45%, transparent 80%);
  border-left: 2px solid #c832c8;
}
.log-row-outer.log-row-event:hover {
  background: linear-gradient(90deg, rgba(200, 50, 200, 0.24), rgba(200, 50, 200, 0.08) 50%, rgba(26, 26, 30, 0.9) 100%);
}
.log-row-outer.log-row-event .log-row { align-items: center; }
@keyframes hl-fade {
  0%   { background: rgba(111,43,255,.25); }
  100% { background: transparent; }
}

.log-row {
  display: flex; align-items: baseline; gap: 0;
  padding: 3px 14px;
  font-size: 12px;
}

.log-time-col { display: flex; flex-direction: column; align-items: flex-start; flex-shrink: 0; margin-right: 10px; min-width: 120px; }
.log-event-label {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 0 6px;
  height: 15px;
  font-size: 9px;
  font-weight: 800;
  letter-spacing: .03em;
  text-transform: uppercase;
  margin-bottom: 2px;
  border: 1px solid transparent;
  white-space: nowrap;
}
.log-event-icon { font-size: 10px; line-height: 1; }
.log-event-label.tone-first { background: rgba(200, 50, 200, 0.16); border-color: rgba(200, 50, 200, 0.55); color: #f4c2f4; }
.log-event-label.tone-sub { background: rgba(255, 208, 69, 0.14); border-color: rgba(255, 208, 69, 0.45); color: #ffdd7d; }
.log-event-label.tone-announce { background: rgba(93, 171, 255, 0.12); border-color: rgba(93, 171, 255, 0.45); color: #a8d3ff; }
.log-time       { color: #444; font-size: 11px; flex-shrink: 0; }
.log-time-short { display: none; }
.log-day-sep    { display: none; }
.log-badges { display: inline-flex; align-items: center; gap: 4px; margin-right: 6px; flex-shrink: 0; }
.badge-img { display: block; width: 18px; height: 18px; }
.badge-fallback { font-size: 10px; color: #888; }
.log-user { font-weight: 600; white-space: nowrap; flex-shrink: 0; padding-right: 0; }
.log-user::after { content: ':'; color: #555; margin-right: 5px; }
.log-msg-wrap { flex: 1; min-width: 0; display: flex; flex-direction: column; position: relative; }
.log-msg-wrap.has-reply { padding-top: 16px; }
.log-mobile-msgline { display: none; }
.log-msg-wrap.is-system-mod .log-msg {
  color: #d0a7a7;
  font-style: italic;
}
.log-msg  { flex: 1; color: #ccc; word-break: break-word; line-height: 1.6; min-width: 0; }

/* Reply thread indicator */
.reply-context {
  position: absolute; left: 0; right: 0; top: 0;
  display: flex; align-items: center; gap: 4px;
  font-size: 10px; color: #555; padding: 2px 0 3px;
  line-height: 1.25;
  white-space: nowrap; overflow: hidden;
}
.reply-context-link { cursor: pointer; }
.reply-context-link:hover { color: #7f7f7f; }
.reply-icon { color: #444; font-size: 11px; flex-shrink: 0; }
.reply-parent-user { color: #777; font-weight: 600; flex-shrink: 0; }
.reply-parent-body { color: #444; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }

.log-share {
  display: flex; align-items: center; justify-content: center;
  width: 20px; height: 20px; color: #444; cursor: pointer;
  opacity: 0; transition: opacity .15s, color .15s; flex-shrink: 0; margin-left: 6px;
}
.log-row-outer:hover .log-share { opacity: 1; }
.log-share:hover { color: #9d6cff; }
.log-share svg { width: 13px; height: 13px; }

.log-user-clickable { cursor: pointer; }
.log-user-clickable:hover { opacity: 0.8; text-decoration: underline dotted; }

:deep(.chat-emote) { height: 28px; vertical-align: middle; display: inline-block; margin: 0 1px; }

/* User popup */
.user-popup {
  position: fixed; z-index: 200;
  background: #1b1b1f; border: 1px solid #2a2a30;
  width: 300px; box-shadow: 0 8px 32px #00000088;
  transform: translate(-50%, 12px); overflow: hidden;
}
.popup-header { display: flex; align-items: center; gap: 10px; padding: 12px 12px 10px; border-bottom: 1px solid #1e1e22; cursor: move; user-select: none; }
.popup-avatar-wrap { flex-shrink: 0; }
.popup-avatar { width: 40px; height: 40px; border-radius: 50%; display: block; border: 2px solid #2a2a30; }
.popup-avatar-placeholder { width: 40px; height: 40px; border-radius: 50%; background: #2a1a55; border: 2px solid #6f2bff44; display: flex; align-items: center; justify-content: center; font-size: 16px; font-weight: 700; color: #9d6cff; }
.popup-title-block { flex: 1; min-width: 0; }
.popup-name  { font-size: 13px; font-weight: 700; color: #e0e0e0; margin-bottom: 2px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.popup-sub   { font-size: 11px; color: #555; }
.popup-close { background: none; border: none; color: #444; font-size: 13px; cursor: pointer; padding: 0 2px; line-height: 1; flex-shrink: 0; }
.popup-close:hover { color: #aaa; }
.popup-body  { padding: 12px 14px; min-height: 72px; display: flex; flex-direction: column; gap: 10px; }
.popup-loading { font-size: 12px; color: #555; text-align: center; padding: 16px 0; }
.popup-stats { display: flex; gap: 20px; }
.popup-stat  { display: flex; flex-direction: column; gap: 2px; }
.stat-val    { font-size: 13px; font-weight: 700; color: #e0e0e0; }
.stat-lbl    { font-size: 10px; color: #555; text-transform: uppercase; letter-spacing: .05em; }
.popup-relations { display: flex; flex-direction: column; gap: 4px; }
.popup-no-bot { font-size: 10px; color: #555; font-style: italic; padding: 4px 0; }
.popup-rel   { display: flex; align-items: center; gap: 7px; padding: 5px 8px; font-size: 12px; }
.popup-rel.rel-yes { background: #1a2a1a; color: #23d18b; }
.popup-rel.rel-no  { background: #1e1e22; color: #444; }
.rel-icon { font-size: 11px; flex-shrink: 0; }
.rel-label { flex: 1; }
.popup-names { display: flex; flex-direction: column; gap: 3px; }
.popup-names-label { font-size: 10px; color: #555; text-transform: uppercase; letter-spacing: .05em; margin-bottom: 2px; }
.popup-name-row { display: flex; justify-content: space-between; align-items: center; padding: 3px 0; border-bottom: 1px solid #1e1e22; }
.popup-name-row:last-child { border-bottom: none; }
.name-val { font-size: 12px; color: #aaa; }
.name-when { font-size: 10px; color: #444; }
.popup-paint { display: flex; flex-direction: column; gap: 4px; }
.popup-paint-label { font-size: 10px; color: #555; text-transform: uppercase; letter-spacing: .05em; }
.popup-paint-display { padding: 6px 8px; background: #111217; border: 1px solid #1e1e22; }
.popup-paint-name { font-size: 14px; font-weight: 700; font-family: inherit; }
.popup-actions { display: flex; gap: 1px; border-top: 1px solid #1e1e22; }
.popup-btn { flex: 1; height: 32px; border: none; border-right: 1px solid #1e1e22; background: #141418; color: #888; font-family: inherit; font-size: 11px; cursor: pointer; transition: background .15s, color .15s; }
.popup-btn:last-child { border-right: none; }
.popup-btn:hover { background: #1e1e24; color: #9d6cff; }

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
  transition: opacity .16s ease, transform .16s ease, visibility .16s ease;
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
  letter-spacing: .03em;
  color: #f2d3ff;
  text-transform: lowercase;
}
@keyframes logs-fetch-spin {
  to { transform: rotate(360deg); }
}

/* Direction toggle */
.dir-toggle { display: flex; gap: 0; }
.dir-btn {
  height: 34px; padding: 0 12px; border: 1px solid #2a2a30; background: #0d0d10;
  color: #555; font-family: inherit; font-size: 11px; font-weight: 600; cursor: pointer;
  transition: color .15s, background .15s;
}
.dir-btn:first-child { border-right: none; }
.dir-btn:hover { color: #aaa; }
.dir-btn.active { background: #1a1a24; color: #9d6cff; border-color: #6f2bff55; }

/* Visuals bar — desktop dropdown */
.visuals-bar { position: relative; flex-shrink: 0; flex-direction: column; gap: 4px; }
.visuals-toggle {
  height: 34px; padding: 0 14px; border: 1px solid #9d6cff44;
  background: rgba(157,108,255,.06); color: #9d6cff;
  font-family: inherit; font-size: 11px; font-weight: 600; cursor: pointer;
  transition: background .15s; white-space: nowrap;
}
.visuals-toggle:hover { background: rgba(157,108,255,.14); }
.visuals-toggle.open  { background: rgba(157,108,255,.18); border-color: #9d6cff88; }
.visuals-panel {
  display: none; flex-direction: column; gap: 2px;
  position: absolute; top: calc(100% + 4px); left: 0;
  background: #1a1a1e; border: 1px solid #2a2a30;
  padding: 6px; min-width: 110px;
  box-shadow: 0 4px 16px rgba(0,0,0,.55); z-index: 30;
}
.visuals-panel .dir-btn { border-right: 1px solid #2a2a30 !important; }
.visuals-panel-open { display: flex !important; }

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
  --dp-highlight-color: rgba(111,43,255,.12);
  --dp-range-between-dates-background-color: rgba(111,43,255,.15);
  --dp-range-between-dates-text-color: #e0e0e0;
  --dp-range-between-border-color: rgba(111,43,255,.15);
  --dp-font-family: 'JetBrains Mono', monospace;
  --dp-font-size: 12px;
  --dp-cell-size: 30px;
}
.dp-logs .dp__input {
  background: #0d0d10; border: 1px solid #2a2a30; color: #e0e0e0;
  font-family: 'JetBrains Mono', monospace; font-size: 12px;
  padding: 7px 10px; height: auto; border-radius: 0;
  min-width: 200px;
}
.dp-logs .dp__input:focus { border-color: #6f2bff55; outline: none; }
.dp-logs .dp__input_icon { display: none; }
.dp-logs .dp__input_icon_pad { padding-left: 10px; }
.dp-logs .dp__clear_icon { color: #555; right: 6px; }

/* AutoMod bar */
.automod-bar { flex-shrink: 0; }
.automod-toggle {
  height: 28px; padding: 0 14px; border: 1px solid #e5c07b44;
  background: rgba(229,192,123,.06); color: #e5c07b;
  font-family: inherit; font-size: 11px; font-weight: 600; cursor: pointer;
  transition: background .15s;
}
.automod-toggle:hover { background: rgba(229,192,123,.14); }
.automod-toggle.active { background: rgba(229,192,123,.18); border-color: #e5c07b88; }

/* AutoMod log rows */
.log-row-automod { background: rgba(229,192,123,.05); border-left: 2px solid #e5c07b44; }
.log-row-automod:hover { background: rgba(229,192,123,.09); }
.log-automod-badge { color: #e5c07b !important; font-size: 10px; font-weight: 700; text-transform: uppercase; letter-spacing: .04em; }
.log-automod-badge::after { display: none; }
.automod-user { color: #e5c07b; font-weight: 600; }
.automod-text { color: #888; font-style: italic; }
.automod-category { font-size: 10px; color: #555; margin-left: 6px; }
.automod-status { font-size: 10px; font-weight: 700; margin-left: 4px; padding: 1px 5px; }
.automod-status.held     { color: #e5c07b; background: rgba(229,192,123,.15); }
.automod-status.approved { color: #23d18b; background: rgba(35,209,139,.1); }
.automod-status.denied   { color: #f14949; background: rgba(241,73,73,.1); }

.search-summary { display: none; }

@media (max-width: 680px) {
  .logs-view {
    height: calc(100dvh - 52px - 5px);
    overflow: hidden;
    gap: 0;
    margin: -30px;
  }
  .logs-header { padding: 10px 14px 6px; flex-shrink: 0; }
  .logs-title  { font-size: 15px; margin-bottom: 2px; }

  .search-summary {
    display: flex; align-items: center; justify-content: space-between;
    padding: 7px 14px; background: #141418; border-bottom: 1px solid #1e1e24;
    cursor: pointer; flex-shrink: 0; user-select: none;
  }
  .summary-text  { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; font-size: 11px; }
  .summary-ch    { color: #9d6cff; font-weight: 700; }
  .summary-tag   { color: #888; background: #1e1e24; padding: 1px 6px; }
  .summary-chevron { font-size: 9px; color: #555; flex-shrink: 0; }

  .search-bar-wrapper {
    flex-direction: column; gap: 8px; align-items: center;
  }
  .search-bar {
    flex-direction: column; align-items: stretch; gap: 8px;
    padding: 10px 14px; flex-shrink: 0;
    overflow: hidden; transition: max-height .2s ease, padding .2s ease;
    max-height: 400px;
    width: 100%
  }
  .search-bar-content { flex-direction: column; align-items: stretch; gap: 8px; }
  .search-bar-collapsed { max-height: 0 !important; padding: 0 14px !important; }
  .field-input { width: 100% !important; }
  .date-input  { width: 100% !important; }
  .dp-logs .dp__input { min-width: 0; width: 100%; }
  .search-btn  { width: 100%; }
  .snippet-info { display: none !important; }
  /* Visuals: always show inline on mobile, no dropdown */
  .visuals-toggle { display: none !important; }
  .visuals-panel  { display: flex !important; position: static; background: none; border: none; padding: 0; box-shadow: none; flex-direction: row; min-width: 0; }

  .logs-results { flex: 1; min-height: 0; display: flex; flex-direction: column; }
  .logs-table   { flex: 1; min-height: 0; display: flex; flex-direction: column; }
  .logs-thead   { display: none !important; }
  .logs-tbody   { flex: 1; min-height: 0; overflow-y: auto; -webkit-overflow-scrolling: touch; }

  .log-day-sep {
    display: block;
    padding: 6px 12px 3px;
    font-size: 10px; font-weight: 700;
    color: #555; letter-spacing: .05em;
    border-top: 1px solid #1e1e24;
    background: #0d0d10;
    position: sticky; top: -2px; z-index: 1;
  }

  .log-row {
    display: flex !important;
    flex-wrap: nowrap;
    align-items: baseline;
    gap: 5px;
    padding: 3px 12px;
    grid-template-columns: unset !important;
  }
  .log-time-col { min-width: auto; margin-right: 0; }
  .log-event-label { display: none; }
  .log-time       { display: none; }
  .log-time-short { display: block; flex-shrink: 0; color: #555; font-size: 11px; white-space: nowrap; }
  .log-badges { display: none; }
  .log-user  { display: none; }
  .log-msg-wrap { flex: 1; min-width: 0; display: block; }
  .log-msg-wrap:not(.is-system-mod) > .log-msg { display: none; }
  .log-mobile-msgline { display: block; font-size: 12px; color: #ccc; line-height: 1.6; word-break: break-word; }
  .log-mobile-badges { display: inline-flex; align-items: center; gap: 3px; margin-right: 4px; vertical-align: middle; }
  .log-mobile-badges .badge-img { width: 16px; height: 16px; }
  .log-mobile-user { font-weight: 600; vertical-align: baseline; }
  .log-mobile-user-colon { color: #555; margin-right: 5px; }
  .log-mobile-msg { display: inline; }
  .log-msg { font-size: 12px; min-width: 0; word-break: break-word; }
  .log-share { flex-shrink: 0; opacity: 0.5 !important; }
}
</style>
