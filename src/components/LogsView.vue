<script setup lang="ts">
import { ref, onMounted } from 'vue'
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
}

const channel  = ref(session.value?.channel ?? '')
const user     = ref('')
const term     = ref('')
const date     = ref('')          // YYYY-MM-DD or ''
const msgs     = ref<LogMsg[]>([])
const loading  = ref(false)
const error    = ref('')
const searched = ref(false)

async function search() {
  if (!channel.value.trim()) { error.value = 'Channel is required.'; return }
  loading.value = true; error.value = ''; searched.value = true; msgs.value = []
  try {
    const params = new URLSearchParams({ channel: channel.value.trim() })
    if (user.value.trim())  params.set('user',  user.value.trim())
    if (term.value.trim())  params.set('term',  term.value.trim())
    if (date.value.trim())  params.set('date',  date.value.trim())
    const headers: Record<string, string> = {}
    if (session.value) headers['Authorization'] = `Bearer ${session.value.token}`
    const res = await fetch(`${API}/logs/search?${params}`, { headers })
    if (!res.ok) {
      const e = await res.json().catch(() => ({})) as any
      throw new Error(e.error ?? 'Search failed')
    }
    const data = await res.json() as { messages: LogMsg[] }
    msgs.value = data.messages
  } catch (e: any) {
    error.value = e.message ?? 'Search failed.'
  }
  loading.value = false
}

function fmtTs(ts: string) {
  const d = new Date(ts)
  return d.toLocaleDateString([], { day: '2-digit', month: '2-digit', year: '2-digit' })
    + ' ' + d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })
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

    <div v-if="!searched && !loading" class="logs-empty">
      Enter a channel and press Search.
    </div>
    <div v-else-if="loading" class="logs-empty">Searching…</div>
    <div v-else-if="searched && !msgs.length && !error" class="logs-empty">
      No messages found.
    </div>

    <div v-else-if="msgs.length" class="logs-results">
      <div class="logs-count">{{ msgs.length }} message{{ msgs.length !== 1 ? 's' : '' }}</div>
      <div class="logs-table">
        <div class="logs-thead">
          <div>Time</div>
          <div>User</div>
          <div>Message</div>
        </div>
        <div class="logs-tbody">
          <div v-for="m in msgs" :key="m.id" class="log-row">
            <div class="log-time">{{ fmtTs(m.timestamp) }}</div>
            <div class="log-user">{{ m.displayName || m.username }}</div>
            <div class="log-msg">{{ m.text }}</div>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.logs-view { display: flex; flex-direction: column; gap: 16px; height: 100%; }
.logs-header { margin-bottom: 2px; }
.logs-title { font-size: 18px; font-weight: 700; color: #e0e0e0; margin-bottom: 4px; }
.logs-sub   { font-size: 12px; color: #555; }

.search-bar {
  display: flex; align-items: flex-end; gap: 10px; flex-wrap: wrap;
  background: #141418; border: 1px solid #1e1e24; padding: 14px 16px;
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

.logs-error { color: #f14949; font-size: 12px; padding: 8px 14px; background: rgba(241,73,73,.08); border-left: 2px solid #f14949; }
.logs-empty { color: #444; font-size: 13px; padding: 40px; text-align: center; }
.logs-count { font-size: 11px; color: #555; padding: 0 2px 6px; }

.logs-results { display: flex; flex-direction: column; flex: 1; min-height: 0; }
.logs-table  { display: flex; flex-direction: column; flex: 1; min-height: 0; }
.logs-thead  {
  display: grid; grid-template-columns: 150px 140px 1fr;
  padding: 7px 14px; background: #0d0d10; border: 1px solid #1e1e24;
  font-size: 10px; color: #555; text-transform: uppercase; letter-spacing: .06em; flex-shrink: 0;
}
.logs-tbody  { overflow-y: auto; flex: 1; }
.logs-tbody::-webkit-scrollbar { width: 3px; }
.logs-tbody::-webkit-scrollbar-thumb { background: #333; }

.log-row {
  display: grid; grid-template-columns: 150px 140px 1fr;
  padding: 6px 14px; border-bottom: 1px solid #1a1a1e;
  font-size: 12px; transition: background .1s;
}
.log-row:hover { background: #1a1a1e; }
.log-time { color: #444; font-size: 11px; align-self: center; }
.log-user { color: #9d6cff; font-weight: 600; align-self: center; word-break: break-all; }
.log-msg  { color: #ccc; align-self: center; word-break: break-word; }
</style>
