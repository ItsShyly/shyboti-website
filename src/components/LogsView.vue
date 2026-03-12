<script setup lang="ts">
import { ref, nextTick, onMounted } from 'vue'
import { API } from '../api'
import { useAuth } from '../auth'

const { session } = useAuth()

interface LogMsg {
  id:          string
  text:        string
  username:    string
  displayName: string
  channel:     string
  timestamp:   string
  tags?:       Record<string, string>
}

interface EmoteMap { [name: string]: string }   // name → url

const channel    = ref(session.value?.channel ?? '')
const user       = ref('')
const term       = ref('')
const date       = ref('')
const msgs       = ref<LogMsg[]>([])
const loading    = ref(false)
const loadingMore = ref(false)
const error      = ref('')
const searched   = ref(false)
const totalFound = ref(0)
const emoteMap   = ref<EmoteMap>({})
const bodyRef    = ref<HTMLDivElement | null>(null)

// ── Emote fetching ─────────────────────────────────────────────────────────
async function fetchEmotes(ch: string) {
  emoteMap.value = {}
  const clean = ch.replace(/^#/, '').toLowerCase()
  try {
    // 7TV via bot API proxy
    const r7 = await fetch(`${API}/emotes/${clean}`)
    if (r7.ok) {
      const d = await r7.json() as { emotes: { name: string; url: string }[] }
      for (const e of d.emotes) emoteMap.value[e.name] = e.url
    }
  } catch {}
  try {
    // Twitch global + channel emotes
    const rt = await fetch(`${API}/emotes/twitch/${clean}`)
    if (rt.ok) {
      const d = await rt.json() as { emotes: { name: string; url: string }[] }
      for (const e of d.emotes) emoteMap.value[e.name] = e.url
    }
  } catch {}
}

// ── Search ─────────────────────────────────────────────────────────────────
async function search() {
  if (!channel.value.trim()) { error.value = 'Channel is required.'; return }
  loading.value = true; error.value = ''; searched.value = true
  msgs.value = []; totalFound.value = 0

  // Fetch emotes for the channel in background
  fetchEmotes(channel.value.trim())

  await doSearch(false)
  loading.value = false
  scrollToBottom()
}

async function doSearch(more: boolean) {
  const params = new URLSearchParams({ channel: channel.value.trim(), stream: 'true' })
  if (user.value.trim())  params.set('user',   user.value.trim())
  if (term.value.trim())  params.set('term',   term.value.trim())
  if (date.value.trim())  params.set('date',   date.value.trim())
  if (more) params.set('offset', String(msgs.value.length))
  const headers: Record<string, string> = {}
  if (session.value) headers['Authorization'] = `Bearer ${session.value.token}`
  try {
    const res = await fetch(`${API}/logs/search?${params}`, { headers })
    if (!res.ok) {
      const e = await res.json().catch(() => ({})) as any
      throw new Error(e.error ?? 'Search failed')
    }
    const data = await res.json() as { messages: LogMsg[]; total?: number; hasMore?: boolean }
    if (more) {
      msgs.value = [...data.messages, ...msgs.value]  // prepend older messages at top
    } else {
      msgs.value = data.messages
    }
    totalFound.value = data.total ?? msgs.value.length
  } catch (e: any) {
    error.value = e.message ?? 'Search failed.'
  }
}

async function loadMore() {
  loadingMore.value = true
  const prevHeight = bodyRef.value?.scrollHeight ?? 0
  await doSearch(true)
  loadingMore.value = false
  // Keep scroll position stable after prepending
  await nextTick()
  if (bodyRef.value) {
    bodyRef.value.scrollTop = bodyRef.value.scrollHeight - prevHeight
  }
}

function scrollToBottom() {
  nextTick(() => {
    if (bodyRef.value) bodyRef.value.scrollTop = bodyRef.value.scrollHeight
  })
}

// ── Rendering ──────────────────────────────────────────────────────────────
function fmtTs(ts: string) {
  const d = new Date(ts)
  return d.toLocaleDateString([], { day: '2-digit', month: '2-digit', year: '2-digit' })
    + ' ' + d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })
}

function userColor(m: LogMsg): string {
  // Use Twitch color from tags if available, else deterministic color from username
  const tc = m.tags?.['color']
  if (tc && tc !== '') return tc
  const colors = ['#ff7f7f','#ff9f40','#ffcf56','#6dd672','#4ec9b0','#56b6c2','#9d6cff','#c792ea','#f78c6c','#89ddff']
  let h = 0
  for (let i = 0; i < m.username.length; i++) h = (h * 31 + m.username.charCodeAt(i)) & 0xffffffff
  return colors[Math.abs(h) % colors.length]!
}

function renderMsg(text: string): string {
  const em = emoteMap.value
  if (Object.keys(em).length === 0) return esc(text)
  // Split on spaces, render emotes as images
  return text.split(' ').map(word => {
    const url = em[word]
    if (url) return `<img class="chat-emote" src="${url}" alt="${esc(word)}" title="${esc(word)}" loading="lazy" />`
    return esc(word)
  }).join(' ')
}

function esc(s: string) {
  return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;')
}

onMounted(() => {
  if (session.value?.channel) channel.value = session.value.channel
})
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
        <input v-model="user" class="field-input" placeholder="username" @keydown.enter="search" />
      </div>
      <div class="field-wrap">
        <label class="field-lbl">Term <span class="opt">optional</span></label>
        <input v-model="term" class="field-input" placeholder="search term" @keydown.enter="search" />
      </div>
      <div class="field-wrap">
        <label class="field-lbl">Date <span class="opt">optional</span></label>
        <input v-model="date" class="field-input date-input" type="date" @keydown.enter="search" />
      </div>
      <button class="search-btn" @click="search" :disabled="loading">
        {{ loading ? '…' : 'Search' }}
      </button>
    </div>

    <div v-if="error" class="logs-error">{{ error }}</div>

    <div v-if="!searched && !loading" class="logs-empty">Enter a channel and press Search.</div>
    <div v-else-if="loading" class="logs-empty">Searching…</div>
    <div v-else-if="searched && !msgs.length && !error" class="logs-empty">No messages found.</div>

    <div v-else-if="msgs.length" class="logs-results">
      <div class="logs-top-bar">
        <span class="logs-count">{{ totalFound.toLocaleString() }} message{{ totalFound !== 1 ? 's' : '' }}</span>
        <button v-if="!date && msgs.length < totalFound" class="load-more-btn" @click="loadMore" :disabled="loadingMore">
          {{ loadingMore ? '…' : '↑ Load older' }}
        </button>
      </div>

      <div class="logs-table">
        <div class="logs-thead">
          <div>Time</div>
          <div>User</div>
          <div>Message</div>
        </div>
        <div class="logs-tbody" ref="bodyRef">
          <div v-if="loadingMore" class="load-indicator">Loading older messages…</div>
          <div v-for="m in msgs" :key="m.id" class="log-row">
            <div class="log-time">{{ fmtTs(m.timestamp) }}</div>
            <div class="log-user" :style="{ color: userColor(m) }">{{ m.displayName || m.username }}</div>
            <div class="log-msg" v-html="renderMsg(m.text)"></div>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.logs-view { display: flex; flex-direction: column; gap: 16px; height: 100%; min-height: 0; }
.logs-header { margin-bottom: 2px; flex-shrink: 0; }
.logs-title { font-size: 18px; font-weight: 700; color: #e0e0e0; margin-bottom: 4px; }
.logs-sub   { font-size: 12px; color: #555; }

.search-bar {
  display: flex; align-items: flex-end; gap: 10px; flex-wrap: wrap;
  background: #141418; border: 1px solid #1e1e24; padding: 14px 16px; flex-shrink: 0;
}
.field-wrap  { display: flex; flex-direction: column; gap: 4px; }
.field-lbl   { font-size: 10px; font-weight: 700; color: #555; text-transform: uppercase; letter-spacing: .06em; display: flex; gap: 5px; align-items: center; }
.opt         { font-size: 9px; color: #383838; font-weight: 400; text-transform: none; }
.field-input {
  background: #0d0d10; border: 1px solid #2a2a30; color: #e0e0e0;
  font-family: inherit; font-size: 12px; padding: 7px 10px; outline: none;
  width: 160px; transition: border-color .15s;
}
.field-input:focus { border-color: #6f2bff55; }
.date-input  { width: 140px; color-scheme: dark; }
.search-btn {
  height: 34px; padding: 0 20px; background: #6f2bff; border: none;
  color: #fff; font-family: inherit; font-size: 12px; font-weight: 700;
  cursor: pointer; align-self: flex-end; transition: background .15s; white-space: nowrap;
}
.search-btn:hover:not(:disabled) { background: #7f3fff; }
.search-btn:disabled { opacity: .4; cursor: default; }

.logs-error { color: #f14949; font-size: 12px; padding: 8px 14px; background: rgba(241,73,73,.08); border-left: 2px solid #f14949; flex-shrink: 0; }
.logs-empty { color: #444; font-size: 13px; padding: 40px; text-align: center; }

.logs-top-bar { display: flex; align-items: center; justify-content: space-between; padding: 0 2px 6px; flex-shrink: 0; }
.logs-count   { font-size: 11px; color: #555; }
.load-more-btn { height: 26px; padding: 0 12px; border: 1px solid #2a2a30; background: transparent; color: #666; font-family: inherit; font-size: 11px; cursor: pointer; }
.load-more-btn:hover:not(:disabled) { color: #fff; border-color: #555; }
.load-more-btn:disabled { opacity: .4; cursor: default; }

.logs-results { display: flex; flex-direction: column; flex: 1; min-height: 0; }
.logs-table   { display: flex; flex-direction: column; flex: 1; min-height: 0; }
.logs-thead   {
  display: grid; grid-template-columns: 150px 140px 1fr;
  padding: 7px 14px; background: #0d0d10; border: 1px solid #1e1e24;
  font-size: 10px; color: #555; text-transform: uppercase; letter-spacing: .06em; flex-shrink: 0;
}
.logs-tbody {
  overflow-y: auto; flex: 1;
  display: flex; flex-direction: column;
}
.logs-tbody::-webkit-scrollbar { width: 3px; }
.logs-tbody::-webkit-scrollbar-thumb { background: #333; }

.load-indicator { text-align: center; font-size: 11px; color: #555; padding: 8px; }

.log-row {
  display: grid; grid-template-columns: 150px 140px 1fr;
  padding: 5px 14px; border-bottom: 1px solid #1a1a1e;
  font-size: 12px; transition: background .1s; align-items: center;
}
.log-row:hover { background: #1a1a1e; }
.log-time { color: #444; font-size: 11px; }
.log-user { font-weight: 600; word-break: break-all; }
.log-msg  { color: #ccc; word-break: break-word; line-height: 1.6; }
:deep(.chat-emote) { height: 28px; vertical-align: middle; display: inline-block; margin: 0 1px; }
</style>
