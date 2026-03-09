import { ref, readonly } from 'vue'
import { API } from './api'

interface Session {
  login: string
  channel: string
  token: string
}

const session = ref<Session | null>(null)
const availableChannels = ref<string[]>([])

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

  function switchChannel(channel: string) {
    if (!session.value) return
    session.value = { ...session.value, channel }
  }

  async function logout() {
    if (!session.value) return
    await fetch(`${API}/logout`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${session.value.token}` }
    }).catch(() => {})
    session.value = null
    availableChannels.value = []
    localStorage.removeItem('shyboti_token')
  }

  function login() {
    window.location.href = `${API}/auth/login`
  }

  return {
    session: readonly(session),
    availableChannels: readonly(availableChannels),
    restoreSession,
    switchChannel,
    logout,
    login,
  }
}
