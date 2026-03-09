<script setup lang="ts">
import { ref, onMounted, watch } from 'vue'
import { API } from '../api'
import { useAuth } from '../auth'

const { session } = useAuth()

interface LogEntry {
  user: string
  channel: string
  message: string
  timestamp: number
}

const logs    = ref<LogEntry[]>([])
const search  = ref('')
const loading = ref(false)
const error   = ref('')

async function fetchLogs() {
  if (!session.value) return
  loading.value = true
  error.value   = ''
  try {
    const params = new URLSearchParams({ limit: '200' })
    if (search.value.trim()) params.set('search', search.value.trim())
    const res = await fetch(`${API}/logs?${params}`, {
      headers: { Authorization: `Bearer ${session.value.token}` }
    })
    if (!res.ok) throw new Error()
    const data = await res.json() as { logs: LogEntry[] }
    logs.value = data.logs
  } catch {
    error.value = 'Could not load logs.'
  } finally {
    loading.value = false
  }
}

let debounce: ReturnType<typeof setTimeout>
watch(search, () => {
  clearTimeout(debounce)
  debounce = setTimeout(fetchLogs, 350)
})

onMounted(fetchLogs)

function fmt(ts: number) {
  return new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })
}

function fmtDate(ts: number) {
  return new Date(ts).toLocaleDateString([], { day: '2-digit', month: '2-digit' })
}
</script>

<template>
  <div class="dashboard">
    <div class="dash-header">
      <h2 class="dash-title">Dashboard</h2>
      <p class="dash-sub">Latest activity in <span class="chan">#{{ session?.channel }}</span></p>
    </div>

    <div class="log-toolbar">
      <div class="log-search-wrap">
        <svg class="log-search-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
          <circle cx="11" cy="11" r="7"/><line x1="16.5" y1="16.5" x2="22" y2="22"/>
        </svg>
        <input v-model="search" class="log-search" placeholder="Filter messages…" />
      </div>
      <button class="refresh-btn" @click="fetchLogs" :disabled="loading">
        {{ loading ? '…' : '↺ Refresh' }}
      </button>
    </div>

    <div v-if="error" class="log-error">{{ error }}</div>
    <div v-else-if="loading && logs.length === 0" class="log-empty">Loading…</div>
    <div v-else-if="logs.length === 0" class="log-empty">No messages found.</div>

    <div v-else class="log-table">
      <div class="log-thead">
        <div>Time</div>
        <div>User</div>
        <div>Message</div>
      </div>
      <div class="log-tbody">
        <div v-for="(log, i) in logs" :key="i" class="log-row">
          <div class="log-time">
            <span class="log-date">{{ fmtDate(log.timestamp) }}</span>
            <span>{{ fmt(log.timestamp) }}</span>
          </div>
          <div class="log-user">{{ log.user }}</div>
          <div class="log-msg">{{ log.message }}</div>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.dashboard { display: flex; flex-direction: column; gap: 16px; }

.dash-header { margin-bottom: 4px; }
.dash-title  { font-size: 20px; font-weight: 700; color: #e0e0e0; margin-bottom: 4px; }
.dash-sub    { font-size: 13px; color: #666; }
.chan        { color: #9d6cff; }

.log-toolbar { display: flex; gap: 10px; align-items: center; }
.log-search-wrap {
  position: relative; flex: 1; height: 36px;
  background: #2c2c2e; display: flex; align-items: center;
}
.log-search-icon {
  position: absolute; left: 10px; width: 16px; height: 16px;
  color: #666; pointer-events: none;
}
.log-search {
  width: 100%; height: 100%; background: transparent; border: none; outline: none;
  color: #fff; font-family: inherit; font-size: 13px; padding: 0 12px 0 34px;
}
.log-search::placeholder { color: #555; }

.refresh-btn {
  height: 36px; padding: 0 14px; border: 1px solid #3a3a3a;
  background: transparent; color: #aaa; font-family: inherit;
  font-size: 13px; cursor: pointer; white-space: nowrap;
}
.refresh-btn:hover:not(:disabled) { background: #2c2c2e; color: #fff; }
.refresh-btn:disabled { opacity: 0.4; cursor: default; }

.log-error { color: #f14949; font-size: 13px; padding: 12px; }
.log-empty { color: #555; font-size: 13px; padding: 40px; text-align: center; }

.log-table { background: #1b1b1d; overflow: hidden; }
.log-thead {
  display: grid; grid-template-columns: 110px 140px 1fr;
  padding: 8px 16px; border-bottom: 1px solid #2a2a2a;
  font-size: 11px; color: #666; letter-spacing: 0.06em; text-transform: uppercase;
}
.log-tbody { max-height: calc(100vh - 320px); overflow-y: auto; }
.log-tbody::-webkit-scrollbar { width: 3px; }
.log-tbody::-webkit-scrollbar-thumb { background: #333; }

.log-row {
  display: grid; grid-template-columns: 110px 140px 1fr;
  padding: 6px 16px; border-bottom: 1px solid #222;
  font-size: 12px; transition: background 0.1s;
}
.log-row:hover { background: #222; }

.log-time  { display: flex; flex-direction: column; gap: 1px; color: #555; }
.log-date  { font-size: 10px; }
.log-user  { color: #9d6cff; font-weight: 600; align-self: center; word-break: break-all; }
.log-msg   { color: #ccc; align-self: center; word-break: break-word; }
</style>
