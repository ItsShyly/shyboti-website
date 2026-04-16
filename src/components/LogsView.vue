<script setup lang="ts">
import { ref, computed, watch, onMounted, onUnmounted, nextTick } from 'vue'
import { useRouter } from 'vue-router'
import { API } from '../api'
import { useAuth } from '../auth'
import { useI18n } from '../i18n'

const { session } = useAuth()
const { t } = useI18n()
const router = useRouter()

interface LogMsg {
  id: string; text: string; username: string; displayName: string
  channel: string; timestamp: string; tags?: Record<string, string>
}
interface EmoteMap { [name: string]: string }

// Input refs - read directly from DOM, not tracked by Vue reactivity.
// This prevents any re-render on every keystroke.
const channelInputRef    = ref<HTMLInputElement | null>(null)
const userInputRef       = ref<HTMLInputElement | null>(null)
const termInputRef       = ref<HTMLInputElement | null>(null)
const dateInputRef       = ref<HTMLInputElement | null>(null)

// These are only updated when a search actually runs (for URL sync and summary bar)
const channel    = ref('')
const userFilter = ref('')
const termFilter = ref('')
const dateFilter = ref('')

function readInputs() {
  channel.value    = channelInputRef.value?.value.trim().toLowerCase().replace(/^#/, '') ?? channel.value
  userFilter.value = userInputRef.value?.value.trim() ?? userFilter.value
  termFilter.value = termInputRef.value?.value.trim() ?? termFilter.value
  dateFilter.value = dateInputRef.value?.value ?? dateFilter.value
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
const bodyRef     = ref<HTMLDivElement | null>(null)
const highlightId = ref<string | null>(null)
const copyToast     = ref(false)
const searchExpanded = ref(true)
const direction   = ref<'newest' | 'oldest'>('newest')  // sort direction

let cursorDate:  Date | null = null
let cursorMonth: { y: number; m: number } | null = null
let abortCtrl = new AbortController()
let scrollListenerAttached = false
let windowScrollAttached  = false

const isMobile = () => window.matchMedia('(max-width: 680px)').matches

// >>> URL state sync
function buildUrl(msgId: string | null = null) {
  const p = new URLSearchParams()
  if (channel.value.trim())    p.set('channel', channel.value.trim().toLowerCase().replace(/^#/, ''))
  if (userFilter.value.trim()) p.set('user',    userFilter.value.trim())
  if (termFilter.value.trim()) p.set('term',    termFilter.value.trim())
  if (dateFilter.value)        p.set('date',    dateFilter.value)
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
  if (p.get('date'))    dateFilter.value = p.get('date')!
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

async function fetchDay(ch: string, y: number, m: number, d: number, signal: AbortSignal): Promise<LogMsg[]> {
  const mm  = String(m).padStart(2, '0')
  const dd  = String(d).padStart(2, '0')
  const params = new URLSearchParams({ channel: ch, year: String(y), month: mm, day: dd, limit: '10000' })
  if (termFilter.value.trim()) params.set('q', termFilter.value.trim())
  const res = await fetch(`${API}/logs/day?${params}`, { signal })
  if (!res.ok) return []
  const data = await res.json() as any
  let messages: LogMsg[] = data?.messages ?? []
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
  const res = await fetch(`${API}/logs/usermonth?${params}`, { signal })
  if (!res.ok) return []
  const data = await res.json() as any
  let messages: LogMsg[] = data?.messages ?? []
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
  if (!bodyRef.value || loadingMore.value || noMore.value) return
  if (bodyRef.value.scrollTop < 120) loadOlder()
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

  const hashId = readHashId()
  pushSearchUrl()

  abortCtrl.abort(); abortCtrl = new AbortController()
  detachScrollListeners()

  if (isMobile()) searchExpanded.value = false
  loading.value = true; error.value = ''; searched.value = true
  msgs.value = []; noMore.value = false; loadingMore.value = false; highlightId.value = null
  cursorDate = null; cursorMonth = null
  const ch = channel.value.trim().toLowerCase().replace(/^#/, '')
  fetchEmotes(ch)
  fetchAutomod(ch, dateFilter.value || undefined)
  const today   = new Date()
  const isUser  = !!userFilter.value.trim()

  if (dateFilter.value) {
    const [y, m, d] = dateFilter.value.split('-').map(Number)
    try {
      msgs.value = isUser
        ? await fetchMonth(ch, y!, m!, abortCtrl.signal).then(ms => ms.filter(msg => msg.timestamp.startsWith(dateFilter.value)))
        : await fetchDay(ch, y!, m!, d!, abortCtrl.signal)
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

  await nextTick()
  attachScrollListener()
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

function shareMsg(m: LogMsg) {
  pushHash(m.id)
  highlightId.value = m.id
  setTimeout(() => { if (highlightId.value === m.id) highlightId.value = null }, 3000)
  navigator.clipboard.writeText(window.location.href).catch(() => {})
  copyToast.value = true
  setTimeout(() => copyToast.value = false, 2000)
}

onMounted(async () => {
  readUrlState()
  if (!channel.value && session.value?.channel) {
    channel.value = session.value.channel
    // Also update the DOM input directly since it uses :value not v-model
    await nextTick()
    if (channelInputRef.value) channelInputRef.value.value = channel.value
  }
  if (channel.value) await search()
})
onUnmounted(() => {
  document.body.classList.remove('logs-open')
  abortCtrl.abort()
  detachScrollListeners()
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

function userColor(m: LogMsg): string {
  const tc = m.tags?.['color']
  if (tc && tc !== '') return tc
  const colors = ['#ff7f7f','#ff9f40','#ffcf56','#6dd672','#4ec9b0','#56b6c2','#9d6cff','#c792ea','#f78c6c','#89ddff']
  let h = 0
  for (let i = 0; i < m.username.length; i++) h = (h * 31 + m.username.charCodeAt(i)) & 0xffffffff
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

function esc(s: string) {
  return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;')
}

// >>> 7TV paint: fetched via backend /twitch/user which resolves Twitch ID → 7TV
// >>> Keyed by lowercase username. null = no paint, undefined = not fetched yet.
const paintCache  = new Map<string, { stops: any[]; shadows: any[]; imageUrl: string | null } | null>()
const paintStyles = ref<Map<string, Record<string, string>>>(new Map())

function intToRgba(c: number): string {
  const r = (c >>> 24) & 0xff
  const g = (c >>> 16) & 0xff
  const b = (c >>> 8)  & 0xff
  const a = (c & 0xff) / 255
  return `rgba(${r},${g},${b},${a.toFixed(3)})`
}

function buildPaintStyle(paint: { imageUrl: string | null; stops: { at: number; color: number }[]; shadows: any[] }): Record<string, string> {
  const styles: Record<string, string> = {}
  if (paint.stops?.length >= 2) {
    const stops = paint.stops.map(s => `${intToRgba(s.color)} ${Math.round(s.at * 100)}%`).join(', ')
    styles['background'] = `linear-gradient(90deg, ${stops})`
    styles['background-clip'] = 'text'
    styles['-webkit-background-clip'] = 'text'
    styles['color'] = 'transparent'
    styles['-webkit-text-fill-color'] = 'transparent'
  } else if (paint.imageUrl) {
    styles['background'] = `url(${paint.imageUrl}) center/cover`
    styles['background-clip'] = 'text'
    styles['-webkit-background-clip'] = 'text'
    styles['color'] = 'transparent'
    styles['-webkit-text-fill-color'] = 'transparent'
  }
  if (paint.shadows?.length) {
    styles['filter'] = paint.shadows
      .map(s => `drop-shadow(${s.x_offset ?? 0}px ${s.y_offset ?? 0}px ${s.radius ?? 0}px ${intToRgba(s.color)})`)
      .join(' ')
  }
  return styles
}

async function ensurePaint(username: string) {
  const key = username.toLowerCase()
  if (paintCache.has(key)) return
  paintCache.set(key, null) // >>> mark as fetching to avoid duplicate requests
  try {
    // >>> Use our backend which resolves Twitch login → Twitch ID → 7TV paint
    const res = await fetch(`${API}/twitch/user/${encodeURIComponent(key)}`, {
      headers: session.value ? { Authorization: `Bearer ${session.value.token}` } : {}
    })
    if (!res.ok) return
    const data = await res.json() as { paint?: any }
    if (data.paint) {
      paintCache.set(key, data.paint)
      const newMap = new Map(paintStyles.value)
      newMap.set(username, buildPaintStyle(data.paint))
      paintStyles.value = newMap
    }
  } catch {}
}

// >>> Watch msgs and prefetch paints for visible usernames
watch(msgs, (list) => {
  const seen = new Set<string>()
  for (const m of list) {
    const u = m.username?.toLowerCase()
    if (u && !seen.has(u) && !paintCache.has(u)) {
      seen.add(u)
      ensurePaint(u)
    }
  }
}, { flush: 'post' })

// >>> User popup (same as DashboardView)
interface TwitchUser {
  login: string; displayName: string; avatar: string
  createdAt: string
  ownFollowers: number | null
  followedAt:  string | null
  subbedSince: string | null
  subTier:     string | null
  nameHistory: { name: string; lastSeen: string }[]
  paint: { id: string; name: string; imageUrl: string | null; shadows: any[]; stops: any[] } | null
  botInChannel: boolean
}
const popup        = ref<{ username: string; channel: string; x: number; y: number } | null>(null)
const popupUser    = ref<TwitchUser | null>(null)
const popupLoading = ref(false)

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
function paintNameStyle(paint: { imageUrl: string | null; stops: { at: number; color: number }[]; shadows: any[] }): Record<string, string> {
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
        <span v-if="dateFilter" class="summary-tag">{{ dateFilter }}</span>
      </span>
      <span class="summary-chevron">{{ searchExpanded ? '▲' : '▼' }}</span>
    </div>

    <!-- >>> Search fields use lazy updates (no v-model on reactive computeds)
         Each input uses :value + @change to avoid triggering Vue reactivity on every keystroke,
         which would otherwise cause lag when msgs array is large. -->
    <div class="search-bar" :class="{ 'search-bar-collapsed': !searchExpanded }">
      <div class="field-wrap">
        <label class="field-lbl">{{ t('logs.field.channel') }}</label>
        <input
          ref="channelInputRef"
          :value="channel"
          class="field-input"
          placeholder="channelname"
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
          @keydown.enter="search"
          autocomplete="off"
          spellcheck="false"
        />
      </div>
      <div class="field-wrap">
        <label class="field-lbl">{{ t('logs.field.date') }} <span class="opt">{{ t('logs.field.optional') }}</span></label>
        <input
          ref="dateInputRef"
          :value="dateFilter"
          class="field-input date-input"
          type="date"
          @keydown.enter="search"
        />
      </div>
      <div class="field-wrap">
        <label class="field-lbl">Direction</label>
        <div class="dir-toggle">
          <button class="dir-btn" :class="{ active: direction === 'newest' }" @click="direction = 'newest'">↓ Newest</button>
          <button class="dir-btn" :class="{ active: direction === 'oldest' }" @click="direction = 'oldest'">↑ Oldest</button>
        </div>
      </div>
      <button class="search-btn" @click="search" :disabled="loading">
        {{ loading ? '…' : t('logs.search') }}
      </button>
    </div>

    <!-- Automod toggle - only for broadcaster viewing own channel after a search -->
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
      <div class="logs-table">
        <div class="logs-thead">
          <div>{{ t('logs.col.time') }}</div><div>{{ t('logs.col.user') }}</div><div>{{ t('logs.col.msg') }}</div>
        </div>
        <div class="logs-tbody" ref="bodyRef">
          <!-- >>> loadingMore indicator: v-show keeps the DOM node alive so it never
               re-renders the parent search-bar or causes input fields to lose focus -->
          <div class="top-loader" v-show="loadingMore">
            <span class="spinner">⟳</span> {{ t('logs.load_older') }}
          </div>
          <div v-if="noMore && !userFilter && !termFilter && !dateFilter" class="top-loader no-more">{{ t('logs.no_older') }}</div>

          <template v-for="item in displayItems" :key="item.kind === 'day' ? 'day-' + item.label : item.msg.id">
            <!-- Day separator -->
            <div v-if="item.kind === 'day'" class="log-day-sep">{{ item.label }}</div>

            <!-- AutoMod row -->
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

            <!-- Message row -->
            <div
              v-else
              :id="`log-${item.msg.id}`"
              v-memo="[item.msg.id, highlightId === item.msg.id]"
              class="log-row"
              :class="{ highlighted: highlightId === item.msg.id }"
            >
              <div class="log-time">{{ fmtTs(item.msg.timestamp) }}</div>
              <div class="log-time-short">{{ fmtTimeOnly(item.msg.timestamp) }}</div>
              <div
                class="log-user"
                :style="paintStyles.get(item.msg.username) ?? { color: userColor(item.msg) }"
                :class="{ 'log-user-clickable': true }"
                @click.stop="openUserPopup(item.msg.username, channel || item.msg.channel?.replace('#',''), $event)"
              >{{ item.msg.displayName || item.msg.username }}</div>
              <div class="log-msg" v-html="renderMsg(item.msg.text)"></div>
              <div class="log-share" @click="shareMsg(item.msg)" title="Copy link">
                <svg viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
                  <path d="M10 2L14 6L10 10" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
                  <path d="M14 6H6C4.34 6 3 7.34 3 9V14" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
                </svg>
              </div>
            </div>
          </template>
        </div>
      </div>
    </div>
    <!-- User popup -->
    <div v-if="popup" class="user-popup" :style="{ top: popup.y + 'px', left: popup.x + 'px' }" @click.stop>
      <div class="popup-header">
        <div class="popup-avatar-wrap">
          <img v-if="popupUser?.avatar" :src="popupUser.avatar" class="popup-avatar" />
          <div v-else class="popup-avatar-placeholder">{{ popup.username[0]?.toUpperCase() }}</div>
        </div>
        <div class="popup-title-block">
          <div class="popup-name">{{ popupUser?.displayName ?? popup.username }}</div>
          <div class="popup-sub">in #{{ popup.channel }}</div>
        </div>
        <button class="popup-close" @click="closePopup">✕</button>
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
  </div>
</template>

<style scoped>
.logs-view   { display: flex; flex-direction: column; gap: 16px; height: 100%; min-height: 0; }
.logs-header { flex-shrink: 0; }
.logs-title  { font-size: 18px; font-weight: 700; color: #e0e0e0; margin-bottom: 4px; }
.logs-sub    { font-size: 12px; color: #555; }

.search-bar  { display: flex; align-items: flex-end; gap: 10px; flex-wrap: wrap; background: #141418; border: 1px solid #1e1e24; padding: 14px 16px; flex-shrink: 0; }
.field-wrap  { display: flex; flex-direction: column; gap: 4px; }
.field-lbl   { font-size: 10px; font-weight: 700; color: #555; text-transform: uppercase; letter-spacing: .06em; display: flex; gap: 5px; align-items: center; }
.opt         { font-size: 9px; color: #383838; font-weight: 400; text-transform: none; }
.field-input { background: #0d0d10; border: 1px solid #2a2a30; color: #e0e0e0; font-family: inherit; font-size: 12px; padding: 7px 10px; outline: none; width: 160px; transition: border-color .15s; }
.field-input:focus { border-color: #6f2bff55; }
.date-input  { width: 140px; color-scheme: dark; }
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
.logs-thead   {
  display: flex; gap: 12px;
  padding: 7px 14px; background: #0d0d10; border: 1px solid #1e1e24;
  font-size: 10px; color: #555; text-transform: uppercase; letter-spacing: .06em; flex-shrink: 0;
}
.logs-tbody   { overflow-y: auto; flex: 1; }
.logs-tbody::-webkit-scrollbar { width: 3px; }
.logs-tbody::-webkit-scrollbar-thumb { background: #333; }

.top-loader  { text-align: center; font-size: 11px; color: #555; padding: 8px; }
.top-loader.no-more { color: #333; }
.spinner     { display: inline-block; animation: spin 1s linear infinite; }
@keyframes spin { to { transform: rotate(360deg); } }

.log-row {
  display: flex; align-items: baseline; gap: 0;
  padding: 3px 14px;
  border-bottom: 1px solid #1a1a1e; font-size: 12px;
  transition: background .1s; position: relative;
}
.log-row:hover { background: #1a1a1e; }
.log-row.highlighted { animation: hl-fade 3s ease forwards; }
@keyframes hl-fade {
  0%   { background: rgba(111,43,255,.25); }
  100% { background: transparent; }
}

.log-time       { color: #444; font-size: 11px; flex-shrink: 0; margin-right: 10px; }
.log-time-short { display: none; }
.log-day-sep    { display: none; }
.log-user { font-weight: 600; white-space: nowrap; flex-shrink: 0; padding-right: 0; }
.log-user::after { content: ':'; color: #555; margin-right: 5px; }
.log-msg  { flex: 1; color: #ccc; word-break: break-word; line-height: 1.6; min-width: 0; }

.log-share {
  display: flex; align-items: center; justify-content: center;
  width: 20px; height: 20px; color: #444; cursor: pointer;
  opacity: 0; transition: opacity .15s, color .15s; flex-shrink: 0; margin-left: 6px;
}
.log-row:hover .log-share { opacity: 1; }
.log-share:hover { color: #9d6cff; }
.log-share svg { width: 13px; height: 13px; }

.log-user-clickable { cursor: pointer; }
.log-user-clickable:hover { opacity: 0.8; text-decoration: underline dotted; }

:deep(.chat-emote) { height: 28px; vertical-align: middle; display: inline-block; margin: 0 1px; }

/* User popup - identical to DashboardView */
.user-popup {
  position: fixed; z-index: 200;
  background: #1b1b1f; border: 1px solid #2a2a30;
  width: 300px; box-shadow: 0 8px 32px #00000088;
  transform: translate(-50%, 12px); overflow: hidden;
}
.popup-header { display: flex; align-items: center; gap: 10px; padding: 12px 12px 10px; border-bottom: 1px solid #1e1e22; }
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
    height: calc(100vh - 52px);
    overflow: hidden;
    gap: 0;
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

  .search-bar {
    flex-direction: column; align-items: stretch; gap: 8px;
    padding: 10px 14px; flex-shrink: 0;
    overflow: hidden; transition: max-height .2s ease, padding .2s ease;
    max-height: 400px;
  }
  .search-bar-collapsed { max-height: 0 !important; padding: 0 14px !important; }
  .field-input { width: 100% !important; }
  .date-input  { width: 100% !important; }
  .search-btn  { width: 100%; }

  .logs-results { flex: 1; min-height: 0; display: flex; flex-direction: column; }
  .logs-table   { flex: 1; min-height: 0; display: flex; flex-direction: column; }
  .logs-thead   { display: none !important; }
  .logs-tbody   { flex: 1; overflow-y: auto; -webkit-overflow-scrolling: touch; }

  .log-day-sep {
    display: block;
    padding: 6px 12px 3px;
    font-size: 10px; font-weight: 700;
    color: #555; letter-spacing: .05em;
    border-top: 1px solid #1e1e24;
    background: #0d0d10;
    position: sticky; top: 0; z-index: 1;
  }

  .log-row {
    display: flex !important;
    flex-wrap: nowrap;
    align-items: baseline;
    gap: 5px;
    padding: 3px 12px;
    grid-template-columns: unset !important;
  }
  .log-time       { display: none; }
  .log-time-short { display: block; flex-shrink: 0; color: #555; font-size: 11px; white-space: nowrap; }
  .log-user  { flex-shrink: 0; font-size: 12px; padding-right: 0; white-space: nowrap; }
  .log-msg   { flex: 1; font-size: 12px; min-width: 0; word-break: break-word; }
  .log-share { flex-shrink: 0; opacity: 0.5 !important; }
}
</style>
