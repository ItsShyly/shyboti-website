<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted, nextTick, watch } from 'vue'
import { API } from '../api'
import { useAuth } from '../auth'

const { session } = useAuth()
const SPANIX = 'https://logs.spanix.team'

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

// cursor: the next date to load (going backwards)
let cursorDate: Date | null = null
let abortCtrl = new AbortController()
let scrollListenerAttached = false

// ── URL state sync ───────────────────────────────────────────────────────────
function buildUrl(msgId: string | null = null) {
  const p = new URLSearchParams()
  if (channel.value.trim())    p.set('channel', channel.value.trim().toLowerCase().replace(/^#/, ''))
  if (userFilter.value.trim()) p.set('user',    userFilter.value.trim())
  if (termFilter.value.trim()) p.set('term',    termFilter.value.trim())
  if (dateFilter.value)        p.set('date',    dateFilter.value)
  const qs   = p.toString() ? '?' + p.toString() : ''
  const hash = msgId ? `#msg-${msgId}` : (window.location.hash.startsWith('#msg-') ? window.location.hash : '')
  return window.location.pathname + qs + hash
}

function pushSearchUrl() {
  history.replaceState(null, '', buildUrl())
}

function pushHash(msgId: string | null) {
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
  const h = window.location.hash
  const m = h.match(/^#msg-(.+)$/)
  return m ? m[1]! : null
}

// ── Longest name width for column alignment ──────────────────────────────────
const nameColWidth = computed(() => {
  if (!msgs.value.length) return 140
  const max = msgs.value.reduce((acc, m) => {
    const name = m.displayName || m.username
    return name.length > acc ? name.length : acc
  }, 0)
  // ~7.5px per char in 600 weight 12px, cap 240px min 80px
  return Math.min(240, Math.max(80, max * 7.8))
})

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

// ── Fetch one day from Spanix ─────────────────────────────────────────────────
async function fetchDay(ch: string, y: number, m: number, d: number, signal: AbortSignal): Promise<LogMsg[]> {
  const u = userFilter.value.trim().toLowerCase()
  const path = u ? `/channel/${ch}/user/${u}/${y}/${m}/${d}` : `/channel/${ch}/${y}/${m}/${d}`
  const res = await fetch(`${SPANIX}${path}?json=true&limit=10000`, { signal })
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

async function loadOlderDay() {
  if (!cursorDate || loadingMore.value || noMore.value) return
  const signal = abortCtrl.signal
  loadingMore.value = true

  const d = cursorDate
  cursorDate = prevDay(d)

  const cutoff = new Date(); cutoff.setFullYear(cutoff.getFullYear() - 2)
  if (d < cutoff) { noMore.value = true; loadingMore.value = false; return }

  try {
    const dayMsgs = await fetchDay(
      channel.value.trim().toLowerCase().replace(/^#/, ''),
      d.getFullYear(), d.getMonth() + 1, d.getDate(), signal
    )
    if (signal.aborted) return

    if (dayMsgs.length === 0) {
      loadingMore.value = false
      loadOlderDay()
      return
    }

    const prevH = bodyRef.value?.scrollHeight ?? 0
    msgs.value = [...dayMsgs, ...msgs.value]
    await nextTick()
    if (bodyRef.value) bodyRef.value.scrollTop += bodyRef.value.scrollHeight - prevH
  } catch {}

  loadingMore.value = false
}

function onScroll() {
  if (!bodyRef.value || loadingMore.value || noMore.value) return
  if (bodyRef.value.scrollTop < 120) loadOlderDay()
}

function attachScrollListener() {
  if (scrollListenerAttached || !bodyRef.value) return
  bodyRef.value.addEventListener('scroll', onScroll, { passive: true })
  scrollListenerAttached = true
}

// ── Main search ──────────────────────────────────────────────────────────────
async function search() {
  if (!channel.value.trim()) { error.value = 'Channel is required.'; return }
  pushSearchUrl()

  abortCtrl.abort(); abortCtrl = new AbortController()
  if (bodyRef.value) { bodyRef.value.removeEventListener('scroll', onScroll); scrollListenerAttached = false }

  loading.value = true; error.value = ''; searched.value = true
  msgs.value = []; noMore.value = false; loadingMore.value = false; highlightId.value = null
  const ch = channel.value.trim().toLowerCase().replace(/^#/, '')
  fetchEmotes(ch)

  if (dateFilter.value) {
    const [y, m, d] = dateFilter.value.split('-').map(Number)
    try { msgs.value = await fetchDay(ch, y!, m!, d!, abortCtrl.signal) } catch {}
    loading.value = false; noMore.value = true
    scrollToBottom(); return
  }

  const today = new Date()
  try {
    msgs.value = await fetchDay(ch, today.getFullYear(), today.getMonth() + 1, today.getDate(), abortCtrl.signal)
  } catch {}
  loading.value = false
  cursorDate = prevDay(today)

  // Check if we should scroll to a hash target
  const hashId = readHashId()
  if (hashId) {
    await nextTick()
    scrollToMsg(hashId, true)
  } else {
    scrollToBottom()
  }
  await nextTick()
  attachScrollListener()
}

function scrollToBottom() {
  nextTick(() => { if (bodyRef.value) bodyRef.value.scrollTop = bodyRef.value.scrollHeight })
}

function scrollToMsg(id: string, highlight = false) {
  nextTick(() => {
    const el = document.getElementById(`log-${id}`)
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'center' })
      if (highlight) {
        highlightId.value = id
        setTimeout(() => { if (highlightId.value === id) highlightId.value = null }, 3000)
      }
    }
  })
}

function shareMsg(m: LogMsg) {
  pushHash(m.id)
  highlightId.value = m.id
  setTimeout(() => { if (highlightId.value === m.id) highlightId.value = null }, 3000)
  // Copy URL to clipboard
  navigator.clipboard.writeText(window.location.href).catch(() => {})
}

onMounted(async () => {
  readUrlState()
  // If no channel from URL, fall back to logged-in channel
  if (!channel.value && session.value?.channel) channel.value = session.value.channel
  // Auto-search if we have a channel (either from URL params or session)
  if (channel.value) await search()
})
onUnmounted(() => {
  abortCtrl.abort()
  if (bodyRef.value) bodyRef.value.removeEventListener('scroll', onScroll)
})

// ── Rendering ────────────────────────────────────────────────────────────────
function fmtTs(ts: string) {
  const d = new Date(ts)
  return d.toLocaleDateString([], { day: '2-digit', month: '2-digit', year: '2-digit' })
    + ' ' + d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })
}

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

    <div class="search-bar">
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

    <div v-if="!searched && !loading" class="logs-empty">Enter a channel and press Search.</div>
    <div v-else-if="loading" class="logs-empty">Searching…</div>
    <div v-else-if="searched && !msgs.length && !loadingMore" class="logs-empty">No messages found.</div>

    <div v-else-if="searched" class="logs-results">
      <div class="logs-count">{{ msgs.length.toLocaleString() }} messages loaded</div>
      <div class="logs-table">
        <div class="logs-thead" :style="{ gridTemplateColumns: `150px ${nameColWidth}px 1fr 24px` }">
          <div>Time</div><div>User</div><div>Message</div><div></div>
        </div>
        <div class="logs-tbody" ref="bodyRef">
          <div class="top-loader" :class="{ visible: loadingMore }">
            <span class="spinner">⟳</span> Loading older messages…
          </div>
          <div v-if="noMore && !dateFilter" class="top-loader no-more">↑ No older logs</div>

          <div
            v-for="m in msgs"
            :key="m.id"
            :id="`log-${m.id}`"
            class="log-row"
            :class="{ highlighted: highlightId === m.id }"
            :style="{ gridTemplateColumns: `150px ${nameColWidth}px 1fr 24px` }"
          >
            <div class="log-time">{{ fmtTs(m.timestamp) }}</div>
            <div class="log-user" :style="{ color: userColor(m) }">{{ m.displayName || m.username }}</div>
            <div class="log-msg" v-html="renderMsg(m.text)"></div>
            <div class="log-share" @click="shareMsg(m)" title="Copy link to this message">
              <svg viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
                <path d="M10 2L14 6L10 10" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
                <path d="M14 6H6C4.34 6 3 7.34 3 9V14" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
              </svg>
            </div>
          </div>
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

.logs-results { display: flex; flex-direction: column; flex: 1; min-height: 0; }
.logs-table   { display: flex; flex-direction: column; flex: 1; min-height: 0; }
.logs-thead   {
  display: grid;
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
  display: grid;
  padding: 5px 14px;
  border-bottom: 1px solid #1a1a1e;
  font-size: 12px;
  align-items: center;
  transition: background .1s;
  position: relative;
}
.log-row:hover { background: #1a1a1e; }
.log-row.highlighted {
  background: rgba(111, 43, 255, 0.12);
  animation: hl-fade 3s ease forwards;
}
@keyframes hl-fade {
  0%   { background: rgba(111, 43, 255, 0.22); }
  100% { background: transparent; }
}

.log-time { color: #444; font-size: 11px; }
.log-user { font-weight: 600; word-break: break-all; padding-right: 8px; }
.log-msg  { color: #ccc; word-break: break-word; line-height: 1.6; }

/* Share button — only visible on row hover */
.log-share {
  display: flex; align-items: center; justify-content: center;
  width: 20px; height: 20px;
  color: #444;
  cursor: pointer;
  opacity: 0;
  transition: opacity .15s, color .15s;
  flex-shrink: 0;
}
.log-row:hover .log-share { opacity: 1; }
.log-share:hover { color: #9d6cff; }
.log-share svg { width: 13px; height: 13px; }

:deep(.chat-emote) { height: 28px; vertical-align: middle; display: inline-block; margin: 0 1px; }
</style>
