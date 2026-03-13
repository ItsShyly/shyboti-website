<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted, watch } from 'vue'
import { API } from '../api'
import { useAuth } from '../auth'

const { session, availableChannels } = useAuth()

interface ActivityEntry {
  id:        number
  channel:   string
  type:      'cmd_added' | 'cmd_changed' | 'cmd_removed' | 'ban' | 'unban' | 'timeout'
  actor:     string
  target:    string
  detail:    string
  timestamp: number
}

const activity    = ref<ActivityEntry[]>([])
const loading     = ref(false)
const error       = ref('')
const liveStatus  = ref<'connecting' | 'live' | 'off'>('off')
const ALL_CHANNELS = '__all__'
const viewChannel  = ref(session.value?.channel ?? '')
const activeTypes  = ref<Set<string>>(new Set()) // empty = show all

let sseSource: EventSource | null = null

const ALL_TYPES = ['cmd_added','cmd_changed','cmd_removed','ban','unban','timeout'] as const

function toggleType(t: string) {
  const s = new Set(activeTypes.value)
  if (s.has(t)) s.delete(t); else s.add(t)
  activeTypes.value = s
}

const filteredActivity = computed(() =>
  activeTypes.value.size === 0
    ? activity.value
    : activity.value.filter(e => activeTypes.value.has(e.type))
)

watch(() => session.value?.channel, ch => { if (ch) { viewChannel.value = ch; fetchActivity() } })
watch(viewChannel, () => { startSSE() })

async function fetchActivity() {
  if (!session.value) return
  loading.value = true; error.value = ''
  try {
    if (viewChannel.value === ALL_CHANNELS) {
      const all = availableChannels.value.length ? availableChannels.value : [session.value.channel]
      const results = await Promise.all(all.map(ch =>
        fetch(`${API}/activity/${ch}?limit=80`, { headers: { Authorization: `Bearer ${session.value!.token}` } })
          .then(r => r.ok ? r.json() as Promise<{ activity: ActivityEntry[] }> : { activity: [] as ActivityEntry[] })
          .catch(() => ({ activity: [] as ActivityEntry[] }))
      ))
      const merged = results.flatMap(r => r.activity)
      merged.sort((a, b) => b.timestamp - a.timestamp)
      activity.value = merged.slice(0, 200)
    } else {
      const res = await fetch(`${API}/activity/${viewChannel.value}?limit=80`, {
        headers: { Authorization: `Bearer ${session.value.token}` }
      })
      if (!res.ok) throw new Error()
      const data = await res.json() as { activity: ActivityEntry[] }
      activity.value = data.activity
    }
  } catch { error.value = 'Could not load activity.' }
  loading.value = false
}

onMounted(() => { fetchActivity(); startSSE() })
onUnmounted(() => { sseSource?.close(); sseSource = null })

async function startSSE() {
  sseSource?.close()
  sseSource = null
  if (!session.value?.token) return

  liveStatus.value = 'connecting'
  const ch = viewChannel.value === ALL_CHANNELS ? null : viewChannel.value

  // Exchange session token for a short-lived ticket — token never goes in the URL
  let ticket: string
  try {
    const r = await fetch(`${API}/activity/sse-ticket`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${session.value.token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ channel: ch }),
    })
    if (!r.ok) { liveStatus.value = 'off'; return }
    const data = await r.json() as { ticket: string }
    ticket = data.ticket
  } catch { liveStatus.value = 'off'; return }

  const streamUrl = `${API}/activity/stream?ticket=${ticket}${ch ? `&channel=${ch}` : ''}`
  const es = new EventSource(streamUrl)
  sseSource = es

  es.onopen = () => { liveStatus.value = 'live' }
  es.onerror = () => {
    liveStatus.value = 'off'
    setTimeout(() => { if (sseSource === es) startSSE() }, 5000)
  }
  es.onmessage = (e) => {
    try {
      const entry = JSON.parse(e.data) as ActivityEntry
      activity.value = [entry, ...activity.value].slice(0, 200)
    } catch {}
  }
}

function fmtTime(ts: number) {
  return new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
}
function fmtDate(ts: number) {
  const d = new Date(ts)
  const today = new Date()
  if (d.toDateString() === today.toDateString()) return 'Today'
  const yest  = new Date(today); yest.setDate(yest.getDate() - 1)
  if (d.toDateString() === yest.toDateString()) return 'Yesterday'
  return d.toLocaleDateString([], { day: '2-digit', month: 'short' })
}

const TYPE_META: Record<string, { icon: string; color: string; label: string }> = {
  cmd_added:   { icon: '+',  color: '#23d18b', label: 'Command added'   },
  cmd_changed: { icon: '✎',  color: '#e5c07b', label: 'Command changed' },
  cmd_removed: { icon: '−',  color: '#f14949', label: 'Command removed' },
  ban:         { icon: '⊘',  color: '#f14949', label: 'Banned'          },
  unban:       { icon: '✓',  color: '#4ec9b0', label: 'Unbanned'        },
  timeout:     { icon: '⏱', color: '#c792ea', label: 'Timed out'       },
}

function groupedActivity() {
  const groups: { date: string; entries: ActivityEntry[] }[] = []
  let cur = ''
  for (const e of filteredActivity.value) {
    const d = fmtDate(e.timestamp)
    if (d !== cur) { cur = d; groups.push({ date: d, entries: [] }) }
    groups[groups.length - 1]!.entries.push(e)
  }
  return groups
}
</script>

<template>
  <div class="dash">
    <div class="dash-header">
      <div>
        <div class="dash-title">Dashboard</div>
        <div class="dash-sub">Activity feed for
          <select class="chan-select" v-model="viewChannel" @change="fetchActivity">
            <option v-if="availableChannels.length > 1" :value="ALL_CHANNELS">All channels</option>
            <option v-for="ch in (availableChannels.length ? availableChannels : [session?.channel ?? ''])" :key="ch" :value="ch">#{{ ch }}</option>
          </select>
        </div>
      </div>
      <div class="dash-header-right">
        <span class="live-dot" :class="liveStatus" :title="liveStatus === 'live' ? 'Live' : liveStatus === 'connecting' ? 'Connecting…' : 'Offline'"></span>
        <button class="refresh-btn" @click="fetchActivity" :disabled="loading">{{ loading ? '…' : '↺' }}</button>
      </div>
    </div>

    <!-- Type filter chips -->
    <div class="type-filters">
      <button v-for="t in ALL_TYPES" :key="t"
        class="type-chip"
        :class="{ active: activeTypes.has(t) }"
        :style="{ '--chip-color': TYPE_META[t]?.color }"
        @click="toggleType(t)">
        <span class="chip-icon">{{ TYPE_META[t]?.icon }}</span> {{ TYPE_META[t]?.label }}
      </button>
      <button v-if="activeTypes.size > 0" class="type-chip clear-chip" @click="activeTypes.clear()">✕ Clear</button>
    </div>

    <div v-if="error" class="feed-empty err">{{ error }}</div>
    <div v-else-if="loading && !activity.length" class="feed-empty">Loading…</div>
    <div v-else-if="!filteredActivity.length" class="feed-empty">{{ activity.length ? 'No matching activity.' : 'No activity yet.' }}</div>

    <div v-else class="feed">
      <template v-for="group in groupedActivity()" :key="group.date">
        <div class="feed-date-label">{{ group.date }}</div>
        <div v-for="e in group.entries" :key="e.id" class="feed-row">
          <div class="feed-icon" :style="{ color: TYPE_META[e.type]?.color, borderColor: TYPE_META[e.type]?.color + '44' }">
            {{ TYPE_META[e.type]?.icon ?? '•' }}
          </div>
          <div class="feed-body">
            <span class="feed-type" :style="{ color: TYPE_META[e.type]?.color }">{{ TYPE_META[e.type]?.label }}</span>
            <span class="feed-target">{{ e.target }}</span>
            <span v-if="e.detail" class="feed-detail">{{ e.detail }}</span>
            <span v-if="viewChannel === ALL_CHANNELS" class="feed-ch">#{{ e.channel }}</span>
          </div>
          <div class="feed-right">
            <span class="feed-actor">{{ e.actor }}</span>
            <span class="feed-time">{{ fmtTime(e.timestamp) }}</span>
          </div>
        </div>
      </template>
    </div>
  </div>
</template>

<style scoped>
.dash { display: flex; flex-direction: column; gap: 16px; height: 100%; }

.dash-header { display: flex; align-items: flex-start; justify-content: space-between; }
.dash-title  { font-size: 18px; font-weight: 700; color: #e0e0e0; margin-bottom: 4px; }
.dash-sub    { font-size: 12px; color: #555; display: flex; align-items: center; gap: 6px; }
.chan-select { background: #111217; border: 1px solid #2a2a30; color: #9d6cff; font-family: inherit; font-size: 12px; padding: 2px 6px; outline: none; cursor: pointer; }

.dash-header-right { display: flex; align-items: center; gap: 10px; }
.live-dot { width: 8px; height: 8px; border-radius: 50%; flex-shrink: 0; }
.live-dot.live        { background: #23d18b; box-shadow: 0 0 6px #23d18b88; animation: pulse-live 2s ease-in-out infinite; }
.live-dot.connecting  { background: #e5c07b; }
.live-dot.off         { background: #333; }
@keyframes pulse-live { 0%, 100% { opacity: 1; } 50% { opacity: .4; } }
.refresh-btn { height: 30px; padding: 0 12px; border: 1px solid #2a2a30; background: transparent; color: #666; font-family: inherit; font-size: 13px; cursor: pointer; }
.refresh-btn:hover:not(:disabled) { color: #fff; border-color: #555; }
.refresh-btn:disabled { opacity: 0.3; }

.feed-empty { color: #444; font-size: 13px; padding: 40px; text-align: center; }

.type-filters { display: flex; gap: 6px; flex-wrap: wrap; padding: 2px 0 4px; flex-shrink: 0; }
.type-chip {
  display: flex; align-items: center; gap: 5px;
  height: 26px; padding: 0 10px; border: 1px solid #2a2a30;
  background: transparent; color: #555; font-family: inherit; font-size: 11px; font-weight: 600;
  cursor: pointer; transition: color .15s, border-color .15s, background .15s;
}
.type-chip:hover { color: #aaa; border-color: #444; }
.type-chip.active {
  color: var(--chip-color, #9d6cff);
  border-color: var(--chip-color, #9d6cff);
  background: color-mix(in srgb, var(--chip-color, #9d6cff) 10%, transparent);
}
.chip-icon { font-size: 12px; }
.clear-chip { color: #444; border-color: #222; }
.clear-chip:hover { color: #aaa; border-color: #555; }
.feed-empty.err { color: #f14949; }

.feed { display: flex; flex-direction: column; gap: 1px; overflow-y: auto; flex: 1; }

.feed-date-label { font-size: 10px; color: #444; text-transform: uppercase; letter-spacing: .08em; padding: 12px 14px 4px; border-top: 1px solid #1e1e22; margin-top: 4px; }
.feed-date-label:first-child { border-top: none; margin-top: 0; }

.feed-row {
  display: flex; align-items: center; gap: 12px;
  padding: 8px 14px; background: #141418;
  border-bottom: 1px solid #1e1e1e; transition: background .1s;
}
.feed-row:hover { background: #1c1c20; }

.feed-icon {
  width: 28px; height: 28px; flex-shrink: 0; display: flex; align-items: center; justify-content: center;
  font-size: 14px; border: 1px solid; font-weight: 700;
}

.feed-body  { flex: 1; display: flex; align-items: center; gap: 8px; min-width: 0; flex-wrap: wrap; }
.feed-type  { font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: .04em; flex-shrink: 0; }
.feed-target { font-size: 12px; color: #e0e0e0; font-weight: 600; }
.feed-detail { font-size: 11px; color: #555; word-break: break-all; }
.feed-ch     { font-size: 10px; color: #6f2bff; background: #6f2bff15; padding: 1px 5px; }

.feed-right { display: flex; flex-direction: column; align-items: flex-end; gap: 2px; flex-shrink: 0; }
.feed-actor { font-size: 11px; color: #666; }
.feed-time  { font-size: 10px; color: #444; }
</style>
