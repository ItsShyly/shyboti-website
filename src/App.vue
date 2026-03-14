<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { useRouter, useRoute } from 'vue-router'
import { API } from './api'
import { useAuth } from './auth'

const { session, availableChannels, channelRole, restoreSession, switchChannel, logout, login } = useAuth()
const router = useRouter()
const route  = useRoute()

const loginShaking = ref(false)
function shakeLogin() {
  if (loginShaking.value) return
  loginShaking.value = true
  setTimeout(() => (loginShaking.value = false), 600)
}

const showChannelMenu = ref(false)
function selectChannel(ch: string) {
  switchChannel(ch)
  showChannelMenu.value = false
}

type NavItem = 'dashboard' | 'commands' | 'logs' | 'moderation' | 'roles' | 'timers' | 'triggers'
const activeRoute = computed(() => route.path.replace('/', '') || 'dashboard')

function nav(to: NavItem) {
  const PUBLIC: NavItem[] = ['logs']
  if (!PUBLIC.includes(to) && !session.value) { shakeLogin(); return }
  router.push('/' + to)
}


const showAddBanner = ref(false)
const toast = ref('')
function showToast(msg: string) {
  toast.value = msg
  setTimeout(() => (toast.value = ''), 5000)
}

onMounted(async () => {
  const params  = new URLSearchParams(window.location.search)
  const token   = params.get('token') ?? localStorage.getItem('shyboti_token') ?? null
  const status  = params.get('status')
  const channel = params.get('channel')

  if (params.has('token') || params.has('status'))
    window.history.replaceState({}, '', window.location.pathname)

  if (token) await restoreSession(token)

  if (status === 'loggedin' && channel) {
    showToast(`Logged in as ${channel}`)
    showAddBanner.value = !availableChannels.value.includes(channel)
    router.push('/dashboard')
  } else if (status === 'added' && channel) {
    showToast(`✓ ShyBoti added to #${channel}`)
    router.push('/dashboard')
  } else if (status === 'removed' && channel) {
    showToast(`✓ ShyBoti left #${channel}`)
  }

  // Default route: logged in → dashboard, logged out → home
  if (route.path === '/' || route.path === '') {
    router.push(session.value ? '/dashboard' : '/home')
  }
})

function addBot() { window.location.href = `${API}/auth/add` }
</script>

<template>
  <div class="page">

    <div class="topbar">
      <div class="topbar-brand" @click="router.push('/dashboard')" style="cursor:pointer">
        <img src="https://cdn.7tv.app/emote/01G0PEAVDR0008B1SW0M995JQJ/1x.gif" alt="shy" class="brand-emote" />
        <span class="brand-name">ShyBoti</span>
      </div>
      <div class="topbar-right">
        <span v-if="toast" class="toast">{{ toast }}</span>
        <template v-if="session">
          <div class="channel-switcher" v-if="availableChannels.length > 1">
            <button class="channel-btn" @click="showChannelMenu = !showChannelMenu">
              #{{ session.channel }} ▾
            </button>
            <div v-if="showChannelMenu" class="channel-menu">
              <button v-for="ch in availableChannels" :key="ch"
                class="channel-menu-item" :class="{ active: ch === session.channel }"
                @click="selectChannel(ch)">#{{ ch }}</button>
            </div>
          </div>
          <span v-else class="logged-in-as">#{{ session.channel }}</span>
          <span class="logged-in-as" style="color:#555">·</span>
          <span class="logged-in-as">{{ session.login }}</span>
          <button class="auth-btn logout-btn" @click="logout">Log out</button>
        </template>
        <button v-else class="auth-btn login-btn" :class="{ shake: loginShaking }" @click="login">
          Login with Twitch
        </button>
      </div>
    </div>

    <div v-if="session && showAddBanner" class="add-banner">
      <span>👋 Welcome! Add ShyBoti to your channel to get started.</span>
      <div class="banner-actions">
        <button class="banner-btn add" @click="addBot">+ Add ShyBoti</button>
        <button class="banner-dismiss" @click="showAddBanner = false">✕</button>
      </div>
    </div>

    <div class="body">
      <aside class="sidebar">
        <button class="sidebar-btn" :class="{ active: activeRoute === 'dashboard', locked: !session }"
          @click="nav('dashboard')">
          Dashboard <span v-if="!session" class="lock-icon">🔒</span>
        </button>
        <button class="sidebar-btn" :class="{ active: activeRoute === 'commands', locked: !session }"
          @click="nav('commands')">
          Commands <span v-if="!session" class="lock-icon">🔒</span>
        </button>
        <button class="sidebar-btn" :class="{ active: activeRoute === 'moderation', locked: !session }"
          @click="nav('moderation')">
          Moderation <span v-if="!session" class="lock-icon">🔒</span>
        </button>
        <button class="sidebar-btn" :class="{ active: activeRoute === 'timers', locked: !session }"
          @click="nav('timers')">
          Timers <span v-if="!session" class="lock-icon">🔒</span>
        </button>
        <button class="sidebar-btn" :class="{ active: activeRoute === 'triggers', locked: !session }"
          @click="nav('triggers')">
          Triggers <span v-if="!session" class="lock-icon">🔒</span>
        </button>
        <button class="sidebar-btn" :class="{ active: activeRoute === 'logs' }" @click="nav('logs')">
          Logs
        </button>
        <button v-if="!session || channelRole?.role === 'broadcaster'"
          class="sidebar-btn" :class="{ active: activeRoute === 'roles', locked: !session }"
          @click="nav('roles')">
          Roles <span v-if="!session" class="lock-icon">🔒</span>
        </button>
        <div v-if="session && !availableChannels.includes(session.login)" class="sidebar-bottom">
          <button class="bot-btn add" @click="addBot">+ Add to your channel</button>
        </div>
      </aside>

      <main class="main-panel">
        <router-view />
      </main>
    </div>
  </div>
</template>

<style>
@import url('https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;600;700&display=swap');
*, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
html, body { height: 100%; }
body { background: #02030a; color: #fff; font-family: 'JetBrains Mono', monospace; font-size: 13px; }
.page { height: 100vh; display: flex; flex-direction: column; overflow: hidden; }

.topbar { height: 52px; flex-shrink: 0; background: #0e0e12; border-bottom: 1px solid #1e1e24; display: flex; align-items: center; padding: 0 32px; gap: 16px; }
.topbar-brand { display: flex; align-items: center; gap: 8px; flex: 1; }
.brand-emote  { width: 28px; height: 28px; image-rendering: pixelated; }
.brand-name   { font-size: 1rem; font-weight: 700; color: #bf94ff; letter-spacing: 0.04em; }
.topbar-right { display: flex; align-items: center; gap: 12px; }
.logged-in-as { font-size: 12px; color: #9d6cff; font-weight: 600; }

.channel-switcher { position: relative; }
.channel-btn { height: 30px; padding: 0 12px; border: 1px solid #333; background: #1e1e26; color: #9d6cff; font-family: inherit; font-size: 12px; font-weight: 600; cursor: pointer; }
.channel-btn:hover { background: #252530; border-color: #6f2bff55; }
.channel-menu { position: absolute; top: calc(100% + 6px); right: 0; background: #1b1b1d; border: 1px solid #2a2a30; min-width: 160px; z-index: 100; display: flex; flex-direction: column; box-shadow: 0 8px 24px #00000066; }
.channel-menu-item { padding: 9px 16px; border: none; background: transparent; color: #888; font-family: inherit; font-size: 12px; text-align: left; cursor: pointer; transition: background 0.1s, color 0.1s; }
.channel-menu-item:hover { background: #222; color: #fff; }
.channel-menu-item.active { color: #9d6cff; font-weight: 700; }

.toast { font-size: 12px; color: #23d18b; background: #0e2a1e; border: 1px solid #23d18b44; padding: 4px 12px; }
.auth-btn { height: 34px; padding: 0 16px; border: none; font-family: inherit; font-size: 12px; font-weight: 600; cursor: pointer; }
.login-btn { background: #6f2bff; color: #fff; }
.login-btn:hover { background: #7f3fff; }
.logout-btn { background: #2c2c2e; color: #aaa; border: 1px solid #333; }
.logout-btn:hover { background: #3a3a3e; color: #fff; }
@keyframes shake { 0%{transform:translateX(0)} 15%{transform:translateX(-5px)} 30%{transform:translateX(5px)} 45%{transform:translateX(-4px)} 60%{transform:translateX(4px)} 75%{transform:translateX(-2px)} 90%{transform:translateX(2px)} 100%{transform:translateX(0)} }
.shake { animation: shake 0.6s ease; }

.add-banner { background: #1a1025; border-bottom: 1px solid #6f2bff44; padding: 10px 32px; display: flex; align-items: center; justify-content: space-between; gap: 12px; font-size: 13px; color: #ccc; flex-shrink: 0; }
.banner-actions { display: flex; align-items: center; gap: 8px; }
.banner-btn.add { height: 32px; padding: 0 16px; background: #6f2bff; border: none; color: #fff; font-family: inherit; font-size: 12px; cursor: pointer; }
.banner-btn.add:hover { background: #7f3fff; }
.banner-dismiss { background: transparent; border: none; color: #666; font-size: 14px; cursor: pointer; padding: 0 6px; }
.banner-dismiss:hover { color: #aaa; }

.body { display: flex; flex: 1; padding: 24px 32px; gap: 24px; min-height: 0; }

.sidebar { width: 200px; flex-shrink: 0; background: #1b1b1d; display: flex; flex-direction: column; padding: 8px 0; }
.sidebar-btn { display: flex; align-items: center; justify-content: space-between; width: 100%; padding: 10px 20px; border: none; background: transparent; color: #777; text-align: left; font-family: inherit; font-size: 13px; cursor: pointer; transition: color 0.1s, background 0.1s; letter-spacing: 0.01em; }
.sidebar-btn:hover { color: #fff; background: #222; }
.sidebar-btn.active { color: #9d6cff; font-weight: 700; background: rgba(111,43,255,.08); border-left: 2px solid #6f2bff; }
.sidebar-btn.locked { opacity: 0.45; }
.sidebar-btn.locked:hover { opacity: 0.75; }
.lock-icon { font-size: 10px; opacity: 0.6; }
.sidebar-bottom { margin-top: auto; padding: 16px; display: flex; flex-direction: column; gap: 8px; border-top: 1px solid #222; }
.bot-btn { width: 100%; height: 32px; border: none; font-family: inherit; font-size: 12px; cursor: pointer; }
.bot-btn.add { background: #6f2bff; color: #fff; }
.bot-btn.add:hover { background: #7f3fff; }

.main-panel { flex: 1; background: #1b1b1d; padding: 24px; display: flex; flex-direction: column; overflow-y: auto; min-height: 0; }
</style>
