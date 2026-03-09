import { ref, readonly } from 'vue'
import { API } from './api'

interface Session {
  login: string
  channel: string
  token: string
}

export interface RolePermissions {
  canToggleCommands: boolean
  canEditCooldowns: boolean
  canManage7TV: boolean
}

export interface ChannelRole {
  role: 'broadcaster' | 'mod'
  permissions: RolePermissions
}

const session = ref<Session | null>(null)
const availableChannels = ref<string[]>([])
const channelRole = ref<ChannelRole | null>(null)

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
      await fetchChannels()
      await fetchRole(data.channel)
    } catch {
      session.value = null
      localStorage.removeItem('shyboti_token')
    }
  }

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
      if (!res.ok) return
      channelRole.value = await res.json() as ChannelRole
    } catch {}
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
