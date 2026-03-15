<script setup lang="ts">
import { ref, computed, watch, onMounted, onUnmounted, nextTick } from 'vue'
import { API } from '../api'
import { useAuth } from '../auth'

const { session } = useAuth()

interface LogMsg {
  id: string; text: string; username: string; displayName: string
  channel: string; timestamp: string; tags?: Record<string, string>
}
interface EmoteMap { [name: string]: string }

const channel    = ref('')
const userFilter = ref('')
const termFilter = ref('')
const dateFilter = ref('')

const msgs        = ref<LogMsg[]>([])
const loading     = ref(false)
const loadingMore = ref(false)
const noMore      = ref(false)
const error       = ref('')
const searched    = ref(false)
const emoteMap    = ref<EmoteMap>({})
const bodyRef     = ref<HTMLDivElement | null>(null)
const highlightId = ref<string | null>(null)
const copyToast     = ref(false)
const searchExpanded = ref(true)  // mobile: collapse search after first search

let cursorDate:  Date | null = null
let cursorMonth: { y: number; m: number } | null = null
let abortCtrl = new AbortController()
let scrollListenerAttached = false
let windowScrollAttached  = false

const isMobile = () => window.matchMedia('(max-width: 680px)').matches

// ── URL state sync ───────────────────────────────────────────────────────────
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

// ── Longest name width ───────────────────────────────────────────────────────
// nameColWidth: recalculate only when msgs changes, stored in a plain ref
// so typing in input fields never triggers re-evaluation of 10k+ entries.
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

// ── Emotes ───────────────────────────────────────────────────────────────────
async function fetchEmotes(ch: string) {
  emoteMap.value = {}
  for (const path of [`/emotes/${ch}`, `/emotes/twitch/${ch}`]) {
    try {
      const r = await fetch(`${API}${path}`)
      if (r.ok) { const d = await r.json() as any; for (const e of d.emotes ?? []) emoteMap.value[e.name] = e.url }
    } catch {}
  }
}

// ── Fetch one day (channel mode) ───────────────────────────────────────
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
    const t = termFilter.value.trim().toLowerCase()
    messages = messages.filter(m => m.text.toLowerCase().includes(t))
  }
  return messages
}

// ── Fetch one month (user mode) ───────────────────────────────────────
async function fetchMonth(ch: string, y: number, m: number, signal: AbortSignal): Promise<LogMsg[]> {
  const mm  = String(m).padStart(2, '0')
  const u   = userFilter.value.trim().toLowerCase()
  const params = new URLSearchParams({ channel: ch, user: u, year: String(y), month: mm, limit: '100000' })
  const res = await fetch(`${API}/logs/usermonth?${params}`, { signal })
  if (!res.ok) return []
  const data = await res.json() as any
  let messages: LogMsg[] = data?.messages ?? []
  if (termFilter.value.trim()) {
    const t = termFilter.value.trim().toLowerCase()
    messages = messages.filter(m => m.text.toLowerCase().includes(t))
  }
  return messages
}

function prevDay(d: Date): Date {
  const p = new Date(d); p.setDate(p.getDate() - 1); return p
}
function prevMonth(ym: { y: number; m: number }): { y: number; m: number } {
  return ym.m === 1 ? { y: ym.y - 1, m: 12 } : { y: ym.y, m: ym.m - 1 }
}

// ── Prepend messages while keeping scroll position stable ─────────────────────
async function prependMsgs(newMsgs: LogMsg[]) {
  const body   = bodyRef.value
  const prevST = body?.scrollTop ?? 0
  const prevSH = body?.scrollHeight ?? 0
  msgs.value = [...newMsgs, ...msgs.value]
  await nextTick()
  if (body) body.scrollTop = prevST + (body.scrollHeight - prevSH)
}

// ── Load one older chunk on scroll ────────────────────────────────────────────
// Channel-only → one day at a time. User set → one month at a time.
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
      else { loadingMore.value = false; return loadOlder() }  // skip empty month
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
      else { loadingMore.value = false; return loadOlder() }  // skip empty day
    } catch {}
    loadingMore.value = false
  }
}

// ── Walk backwards until targetId is found in msgs ───────────────────────────
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

// ── Main search ──────────────────────────────────────────────────────────────
async function search() {
  if (!channel.value.trim()) { error.value = 'Channel is required.'; return }

  // Read hash BEFORE pushSearchUrl strips it
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
  const today   = new Date()
  const isUser  = !!userFilter.value.trim()

  if (dateFilter.value) {
    // Specific date — just load that single day/month, no scroll-back
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

  if (isUser) {
    // User mode: load current month first
    const y = today.getFullYear(), m = today.getMonth() + 1
    try { msgs.value = await fetchMonth(ch, y, m, abortCtrl.signal) } catch {}
    cursorMonth = prevMonth({ y, m })
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
    // Channel mode: load today first
    try { msgs.value = await fetchDay(ch, today.getFullYear(), today.getMonth() + 1, today.getDate(), abortCtrl.signal) } catch {}
    cursorDate = prevDay(today)
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
  // If content doesn't fill the container, auto-load older days until it does
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
  // Poll until the element exists in the DOM (msgs may still be rendering)
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
  if (isMobile()) document.body.classList.add('logs-open')
  readUrlState()
  if (!channel.value && session.value?.channel) channel.value = session.value.channel
  if (channel.value) await search()
})
onUnmounted(() => {
  document.body.classList.remove('logs-open')
  abortCtrl.abort()
  detachScrollListeners()
})

// ── Rendering ────────────────────────────────────────────────────────────────
function fmtTs(ts: string) {
  const d = new Date(ts)
  return d.toLocaleDateString([], { day: '2-digit', month: '2-digit', year: '2-digit' })
    + ' ' + d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })
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
  | { kind: 'day';  label: string }
  | { kind: 'msg';  msg: LogMsg }

const displayItems = computed<DisplayItem[]>(() => {
  const items: DisplayItem[] = []
  let lastDay = ''
  for (const m of msgs.value) {
    const day = fmtDayLabel(m.timestamp)
    if (day !== lastDay) {
      items.push({ kind: 'day', label: day })
      lastDay = day
    }
    items.push({ kind: 'msg', msg: m })
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
</script>

<template>
  <div class="logs-view">
    <div class="logs-header">
      <div class="logs-title">Logs</div>
      <div class="logs-sub">Search chat history via Spanix</div>
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

    <div class="search-bar" :class="{ 'search-bar-collapsed': !searchExpanded }">
      <div class="field-wrap">
        <label class="field-lbl">Channel</label>
        <input v-model="channel" class="field-input" placeholder="channelname" @keydown.enter="search" />
      </div>
      <div class="field-wrap">
        <label class="field-lbl">User <span class="opt">optional</span></label>
        <input v-model="userFilter" class="field-input" placeholder="username" @keydown.enter="search" />
      </div>
      <div class="field-wrap">
        <label class="field-lbl">Term <span class="opt">optional</span></label>
        <input v-model="termFilter" class="field-input" placeholder="search term" @keydown.enter="search" />
      </div>
      <div class="field-wrap">
        <label class="field-lbl">Date <span class="opt">optional</span></label>
        <input v-model="dateFilter" class="field-input date-input" type="date" @keydown.enter="search" />
      </div>
      <button class="search-btn" @click="search" :disabled="loading">
        {{ loading ? '…' : 'Search' }}
      </button>
    </div>

    <div v-if="error" class="logs-error">{{ error }}</div>

    <!-- Copy toast -->
    <transition name="toast-fade">
      <div v-if="copyToast" class="copy-toast">✓ Copied to clipboard</div>
    </transition>

    <div v-if="!searched && !loading" class="logs-empty">Enter a channel and press Search.</div>
    <div v-else-if="loading" class="logs-empty">Searching…</div>
    <div v-else-if="searched && !msgs.length && !loadingMore" class="logs-empty">No messages found.</div>

    <div v-else-if="searched" class="logs-results">
      <div class="logs-count">{{ msgs.length.toLocaleString() }} messages loaded</div>
      <div class="logs-table">
        <div class="logs-thead">
          <div>Time</div><div>User</div><div>Message</div>
        </div>
        <div class="logs-tbody" ref="bodyRef">
          <div class="top-loader" :class="{ visible: loadingMore }">
            <span class="spinner">⟳</span> Loading older messages…
          </div>
          <div v-if="noMore && !userFilter && !termFilter && !dateFilter" class="top-loader no-more">↑ No older logs</div>

          <template v-for="item in displayItems" :key="item.kind === 'day' ? 'day-' + item.label : item.msg.id">
            <!-- Day separator -->
            <div v-if="item.kind === 'day'" class="log-day-sep">{{ item.label }}</div>

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
              <div class="log-user" :style="{ color: userColor(item.msg) }">{{ item.msg.displayName || item.msg.username }}</div>
              <div class="log-msg" v-html="renderMsg(item.msg.text)"></div>
              <div class="log-share" @click="shareMsg(item.msg)" title="Copy link to this message">
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

/* Copy toast */
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

.top-loader  { text-align: center; font-size: 11px; color: #555; padding: 8px; display: none; }
.top-loader.visible { display: block; }
.top-loader.no-more { display: block; color: #333; }
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
.log-time-short { display: none; } /* shown only on mobile */
.log-day-sep    { display: none; } /* shown only on mobile */
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

:deep(.chat-emote) { height: 28px; vertical-align: middle; display: inline-block; margin: 0 1px; }

/* ── Mobile summary bar (hidden on desktop) ── */
.search-summary { display: none; }

@media (max-width: 680px) {
  /* Fixed-height layout — page does NOT scroll, only .logs-tbody scrolls */
  .logs-view {
    height: calc(100vh - 52px); /* full viewport minus topbar */
    overflow: hidden;
    gap: 0;
  }
  .logs-header { padding: 10px 14px 6px; flex-shrink: 0; }
  .logs-title  { font-size: 15px; margin-bottom: 2px; }

  /* Summary bar: always visible, tap to expand/collapse search */
  .search-summary {
    display: flex; align-items: center; justify-content: space-between;
    padding: 7px 14px; background: #141418; border-bottom: 1px solid #1e1e24;
    cursor: pointer; flex-shrink: 0; user-select: none;
  }
  .summary-text  { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; font-size: 11px; }
  .summary-ch    { color: #9d6cff; font-weight: 700; }
  .summary-tag   { color: #888; background: #1e1e24; padding: 1px 6px; }
  .summary-chevron { font-size: 9px; color: #555; flex-shrink: 0; }

  /* Search bar: expand/collapse */
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

  /* Results take all remaining space, tbody scrolls */
  .logs-results { flex: 1; min-height: 0; display: flex; flex-direction: column; }
  .logs-table   { flex: 1; min-height: 0; display: flex; flex-direction: column; }
  .logs-thead   { display: none !important; }
  .logs-tbody   { flex: 1; overflow-y: auto; -webkit-overflow-scrolling: touch; }

  /* Day separator */
  .log-day-sep {
    display: block;
    padding: 6px 12px 3px;
    font-size: 10px; font-weight: 700;
    color: #555; letter-spacing: .05em;
    border-top: 1px solid #1e1e24;
    background: #0d0d10;
    position: sticky; top: 0; z-index: 1;
  }

  /* Rows: HH:MM Username: message (Chatterino style) */
  .log-row {
    display: flex !important;
    flex-wrap: nowrap;
    align-items: baseline;
    gap: 5px;
    padding: 3px 12px;
    grid-template-columns: unset !important;
  }
  .log-time       { display: none; }                      /* hide full timestamp */
  .log-time-short { display: block; flex-shrink: 0; color: #555; font-size: 11px; white-space: nowrap; }
  .log-user  { flex-shrink: 0; font-size: 12px; padding-right: 0; white-space: nowrap; }
  .log-msg   { flex: 1; font-size: 12px; min-width: 0; word-break: break-word; }
  .log-share { flex-shrink: 0; opacity: 0.5 !important; }
}
</style>
