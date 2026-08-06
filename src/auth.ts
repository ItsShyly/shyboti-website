import { ref, readonly } from 'vue'
import { API } from './api'

interface Session {
  login: string
  channel: string
  token: string
}

export interface RolePermissions {
  modsEnabled: boolean
  // Dashboard
  dashboard: boolean
  // Commands
  commands_view: boolean
  commands_toggle: boolean
  commands_edit: boolean
  commands_delete: boolean
  // Automations (Timers + Triggers)
  automations_view: boolean
  automations_toggle: boolean
  automations_edit: boolean
  automations_delete: boolean
  // Logs
  logs_view: boolean
  // Moderation
  moderation_view: boolean
  moderation_manage: boolean
  // OBS
  obs_view: boolean
  obs_edit: boolean
  obs_force_preview: boolean
}

export interface ChannelRole {
  role: 'broadcaster' | 'mod'
  permissions: RolePermissions
}

const session = ref<Session | null>(null)
const availableChannels = ref<string[]>([])
const channelRole = ref<ChannelRole | null>(null)
let accessRefreshTimer: ReturnType<typeof setInterval> | null = null
let accessRefreshBound = false

async function fetchChannels() {
  if (!session.value) return
  try {
    const res = await fetch(`${API}/channels`, {
      headers: { Authorization: `Bearer ${session.value.token}` }
    })
    if (!res.ok) return
    const data = await res.json() as { channels: string[] }
    availableChannels.value = data.channels
  } catch {}
}

async function fetchRole(channel: string) {
  if (!session.value) return
  try {
    const res = await fetch(`${API}/role/${channel}`, {
      headers: { Authorization: `Bearer ${session.value.token}` }
    })
    if (!res.ok) {
      channelRole.value = null
      return
    }
    channelRole.value = await res.json() as ChannelRole
  } catch {
    channelRole.value = null
  }
}

async function refreshAccessState() {
  if (!session.value) return
  await fetchChannels()
  if (!session.value) return

  const current = session.value.channel
  const next = availableChannels.value.includes(current)
    ? current
    : (availableChannels.value.includes(session.value.login) ? session.value.login : availableChannels.value[0])

  if (next && next !== current) {
    session.value = { ...session.value, channel: next }
    await fetchRole(next)
    return
  }

  if (current) await fetchRole(current)
}

function stopAccessRefresh() {
  if (accessRefreshTimer) {
    clearInterval(accessRefreshTimer)
    accessRefreshTimer = null
  }
}

function startAccessRefresh() {
  stopAccessRefresh()
  accessRefreshTimer = setInterval(() => { refreshAccessState().catch(() => {}) }, 30_000)

  if (!accessRefreshBound && typeof window !== 'undefined') {
    const kick = () => { refreshAccessState().catch(() => {}) }
    window.addEventListener('focus', kick)
    document.addEventListener('visibilitychange', () => {
      if (!document.hidden) kick()
    })
    accessRefreshBound = true
  }
}

export function useAuth() {
  async function restoreSession(token: string) {
    try {
      const res = await fetch(`${API}/me`, {
        headers: { Authorization: `Bearer ${token}` }
      })
      if (!res.ok) throw new Error()
      const data = await res.json() as { login: string; channel: string }
      session.value = { login: data.login, channel: data.channel, token }
      localStorage.setItem('shyboti_token', token)
      await refreshAccessState()
      startAccessRefresh()
    } catch {
      session.value = null
      availableChannels.value = []
      channelRole.value = null
      stopAccessRefresh()
      localStorage.removeItem('shyboti_token')
    }
  }

  async function switchChannel(channel: string) {
    if (!session.value) return
    session.value = { ...session.value, channel }
    await fetchRole(channel)
  }

  async function logout() {
    if (!session.value) return
    await fetch(`${API}/logout`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${session.value.token}` }
    }).catch(() => {})
    session.value = null
    availableChannels.value = []
    channelRole.value = null
    stopAccessRefresh()
    localStorage.removeItem('shyboti_token')
  }

  function login() {
    window.location.href = `${API}/auth/login`
  }

  return {
    session: readonly(session),
    availableChannels: readonly(availableChannels),
    channelRole: readonly(channelRole),
    restoreSession,
    switchChannel,
    logout,
    login,
  }
}
