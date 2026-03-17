<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { useRouter, useRoute } from 'vue-router'
import { API } from './api'
import { useAuth } from './auth'
import { useI18n, useLocale, type Locale } from './i18n'

const { session, availableChannels, channelRole, restoreSession, switchChannel, logout, login } = useAuth()
const router = useRouter()
const route  = useRoute()
const { t } = useI18n()
const { locale, setLocale } = useLocale()

const loginShaking = ref(false)
function shakeLogin() {
  if (loginShaking.value) return
  loginShaking.value = true
  setTimeout(() => (loginShaking.value = false), 600)
}

const showChannelMenu = ref(false)
const sidebarOpen = ref(false)

function selectChannel(ch: string) {
  switchChannel(ch)
  showChannelMenu.value = false
}

type NavItem = 'dashboard' | 'commands' | 'logs' | 'moderation' | 'roles' | 'automations' |'more' | 'settings'
const activeRoute = computed(() => route.path.replace('/', '') || 'dashboard')

function nav(to: NavItem) {
  const PUBLIC: NavItem[] = ['logs', 'more']
  if (!PUBLIC.includes(to) && !session.value) { shakeLogin(); return }
  sidebarOpen.value = false
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

  if (route.path === '/' || route.path === '') {
    router.push(session.value ? '/dashboard' : '/')
  }
})

function addBot() { window.location.href = `${API}/auth/add` }
</script>

<template>
  <div class="page">

    <div class="topbar">
      <div class="topbar-brand" @click="session ? router.push('/dashboard') : router.push('/')" style="cursor:pointer">
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
          <span v-else class="logged-in-as hide-mobile">#{{ session.channel }}</span>
          <span class="logged-in-as hide-mobile" style="color:#555">·</span>
          <span class="logged-in-as hide-mobile">{{ session.login }}</span>
          <button class="auth-btn logout-btn hide-mobile" @click="logout(); router.push('/')">{{ t('nav.logout') }}</button>
        </template>
        <button v-else class="auth-btn login-btn" :class="{ shake: loginShaking }" @click="login">
          <span class="hide-mobile">{{ t('nav.login') }}</span>
          <span class="show-mobile">{{ t('nav.login_short') }}</span>
        </button>
        <!-- Language toggle -->
        <div class="lang-switcher">
          <button class="lang-opt" :class="{ active: locale === 'en' }" @click="setLocale('en')">EN</button>
          <span class="lang-sep">|</span>
          <button class="lang-opt" :class="{ active: locale === 'de' }" @click="setLocale('de')">DE</button>
        </div>
        <!-- Hamburger - mobile only -->
        <button class="hamburger show-mobile" @click="sidebarOpen = !sidebarOpen" :class="{ open: sidebarOpen }">
          <span></span><span></span><span></span>
        </button>
      </div>
    </div>

    <div v-if="session && showAddBanner" class="add-banner">
      <span>👋 {{ t('banner.welcome') }}</span>
      <div class="banner-actions">
        <button class="banner-btn add" @click="addBot">{{ t('banner.add') }}</button>
        <button class="banner-dismiss" @click="showAddBanner = false">✕</button>
      </div>
    </div>

    <div class="body">
      <!-- Overlay for mobile sidebar -->
      <div v-if="sidebarOpen" class="sidebar-overlay" @click="sidebarOpen = false"></div>

      <aside class="sidebar" :class="{ 'sidebar-open': sidebarOpen }">
        <!-- Mobile sidebar header -->
        <div class="sidebar-mobile-header show-mobile">
          <template v-if="session">
            <span class="sidebar-user">#{{ session.channel }}</span>
            <button class="sidebar-logout" @click="logout(); router.push('/'); sidebarOpen = false">{{ t('nav.logout') }}</button>
          </template>
        </div>

        <button class="sidebar-btn" :class="{ active: activeRoute === 'dashboard', locked: !session }"
          @click="nav('dashboard')">
          {{ t('nav.dashboard') }} <span v-if="!session" class="lock-icon">🔒</span>
        </button>
        <button class="sidebar-btn" :class="{ active: activeRoute === 'commands', locked: !session }"
          @click="nav('commands')">
          {{ t('nav.commands') }} <span v-if="!session" class="lock-icon">🔒</span>
        </button>
        <button class="sidebar-btn" :class="{ active: activeRoute === 'moderation', locked: !session }"
          @click="nav('moderation')">
          {{ t('nav.moderation') }} <span v-if="!session" class="lock-icon">🔒</span>
        </button>
        <button class="sidebar-btn" :class="{ active: activeRoute === 'automations', locked: !session }"
          @click="nav('automations')">
          {{ t('nav.automations') }} <span v-if="!session" class="lock-icon">🔒</span>
        </button>
        <button v-if="!session || channelRole?.role === 'broadcaster'"
          class="sidebar-btn" :class="{ active: activeRoute === 'roles', locked: !session }"
          @click="nav('roles')">
          {{ t('nav.roles') }} <span v-if="!session" class="lock-icon">🔒</span>
        </button>
        <button class="sidebar-btn" :class="{ active: activeRoute === 'logs' }" @click="nav('logs')">
          {{ t('nav.logs') }}
        </button>
        <button class="sidebar-btn" :class="{ active: activeRoute === 'more' }" @click="nav('more')">
          {{ t('nav.more') }}
        </button>
        <div class="sidebar-spacer"></div>
        <button v-if="!session || channelRole?.role === 'broadcaster'"
          class="sidebar-btn" :class="{ active: activeRoute === 'settings', locked: !session }"
          @click="nav('settings')">
          {{ t('nav.settings') }} <span v-if="!session" class="lock-icon">🔒</span>
        </button>
        <div v-if="session && !availableChannels.includes(session.login)" class="sidebar-bottom">
          <button class="bot-btn add" @click="addBot">{{ t('nav.add_channel') }}</button>
        </div>
      </aside>

      <main class="main-panel">
        <router-view />
        <footer class="site-footer">
          {{ t('footer.copy') }}
          <span class="footer-sep">|</span>
          <router-link to="/privacy" class="footer-link">{{ t('footer.privacy') }}</router-link>
        </footer>
      </main>
    </div>
  </div>
</template>

<style>
@import url('https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;600;700&display=swap');
*, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
html, body { height: 100%; overflow: hidden; }
body { background: #0e0e12; color: #fff; font-family: 'JetBrains Mono', monospace; font-size: 13px; }
.page { height: 100vh; display: flex; flex-direction: column; overflow: hidden; }

/*  Topbar  */
.topbar { height: 52px; flex-shrink: 0; background: #0e0e12; border-bottom: 1px solid #1e1e24; display: flex; align-items: center; padding: 0 20px; gap: 12px; }
.topbar-brand { display: flex; align-items: center; gap: 8px; flex: 1; min-width: 0; }
.brand-emote  { width: 28px; height: 28px; flex-shrink: 0; image-rendering: pixelated; }
.brand-name   { font-size: 1rem; font-weight: 700; color: #bf94ff; letter-spacing: 0.04em; white-space: nowrap; }
.topbar-right { display: flex; align-items: center; gap: 10px; flex-shrink: 0; }
.logged-in-as { font-size: 12px; color: #9d6cff; font-weight: 600; white-space: nowrap; }

.channel-switcher { position: relative; }
.channel-btn { height: 30px; padding: 0 12px; border: 1px solid #333; background: #1e1e26; color: #9d6cff; font-family: inherit; font-size: 12px; font-weight: 600; cursor: pointer; }
.channel-btn:hover { background: #252530; border-color: #6f2bff55; }
.channel-menu { position: absolute; top: calc(100% + 6px); right: 0; background: #1b1b1d; border: 1px solid #2a2a30; min-width: 160px; z-index: 200; display: flex; flex-direction: column; box-shadow: 0 8px 24px #00000066; }
.channel-menu-item { padding: 9px 16px; border: none; background: transparent; color: #888; font-family: inherit; font-size: 12px; text-align: left; cursor: pointer; transition: background 0.1s, color 0.1s; }
.channel-menu-item:hover { background: #222; color: #fff; }
.channel-menu-item.active { color: #9d6cff; font-weight: 700; }

.toast { font-size: 11px; color: #23d18b; background: #0e2a1e; border: 1px solid #23d18b44; padding: 4px 10px; max-width: 200px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.auth-btn { height: 34px; padding: 0 14px; border: none; font-family: inherit; font-size: 12px; font-weight: 600; cursor: pointer; white-space: nowrap; }
.login-btn { background: #6f2bff; color: #fff; }
.login-btn:hover { background: #7f3fff; }
.logout-btn { background: #2c2c2e; color: #aaa; border: 1px solid #333; }
.logout-btn:hover { background: #3a3a3e; color: #fff; }
.lang-switcher { display: flex; align-items: center; gap: 2px; flex-shrink: 0; border: 1px solid #2a2a30; padding: 0 2px; height: 28px; }
.lang-sep { color: #333; font-size: 10px; }
.lang-opt { height: 22px; padding: 0 7px; border: none; background: transparent; color: #555; font-family: inherit; font-size: 11px; font-weight: 700; cursor: pointer; letter-spacing: .04em; transition: color .15s, background .15s; }
.lang-opt:hover { color: #aaa; }
.lang-opt.active { color: #9d6cff; background: #6f2bff18; }
@keyframes shake { 0%{transform:translateX(0)} 15%{transform:translateX(-5px)} 30%{transform:translateX(5px)} 45%{transform:translateX(-4px)} 60%{transform:translateX(4px)} 75%{transform:translateX(-2px)} 90%{transform:translateX(2px)} 100%{transform:translateX(0)} }
.shake { animation: shake 0.6s ease; }

/*  Hamburger  */
.hamburger { display: flex; flex-direction: column; justify-content: center; gap: 5px; width: 36px; height: 36px; padding: 0 6px; background: transparent; border: 1px solid #2a2a30; cursor: pointer; flex-shrink: 0; }
.hamburger span { display: block; height: 2px; background: #888; transition: transform .2s, opacity .2s, background .2s; }
.hamburger.open span:nth-child(1) { transform: translateY(7px) rotate(45deg); background: #9d6cff; }
.hamburger.open span:nth-child(2) { opacity: 0; }
.hamburger.open span:nth-child(3) { transform: translateY(-7px) rotate(-45deg); background: #9d6cff; }

/*  Banner  */
.add-banner { background: #1a1025; border-bottom: 1px solid #6f2bff44; padding: 8px 16px; display: flex; align-items: center; justify-content: space-between; gap: 10px; font-size: 12px; color: #ccc; flex-shrink: 0; }
.banner-actions { display: flex; align-items: center; gap: 8px; flex-shrink: 0; }
.banner-btn.add { height: 30px; padding: 0 12px; background: #6f2bff; border: none; color: #fff; font-family: inherit; font-size: 11px; cursor: pointer; }
.banner-btn.add:hover { background: #7f3fff; }
.banner-dismiss { background: transparent; border: none; color: #666; font-size: 14px; cursor: pointer; padding: 0 4px; }
.banner-dismiss:hover { color: #aaa; }

/*  Body / Layout  */
.body { display: flex; flex: 1; min-height: 0; overflow: hidden; position: relative; }

/*  Sidebar overlay (mobile)  */
.sidebar-overlay { position: fixed; inset: 0; background: rgba(0,0,0,.6); z-index: 99; }

/*  Sidebar  */
.sidebar { width: 200px; flex-shrink: 0; background: #0e0e12; display: flex; flex-direction: column; padding: 8px 0; border-right: 1px solid #1e1e24; overflow-y: auto; scrollbar-width: none; transition: transform .25s ease; }
.sidebar::-webkit-scrollbar { display: none; }
.sidebar-spacer { flex: 1; }
.sidebar-btn { display: flex; align-items: center; justify-content: space-between; width: 100%; padding: 11px 20px; border: none; background: transparent; color: #777; text-align: left; font-family: inherit; font-size: 13px; cursor: pointer; transition: color 0.1s, background 0.1s; letter-spacing: 0.01em; }
.sidebar-btn:hover { color: #fff; background: #16161a; }
.sidebar-btn.active { color: #9d6cff; font-weight: 700; background: rgba(111,43,255,.08); border-left: 2px solid #6f2bff; }
.sidebar-btn.locked { opacity: 0.45; }
.sidebar-btn.locked:hover { opacity: 0.75; }
.lock-icon { font-size: 10px; opacity: 0.6; }
.sidebar-bottom { padding: 12px 16px; border-top: 1px solid #1e1e24; }
.bot-btn { width: 100%; height: 32px; border: none; font-family: inherit; font-size: 12px; cursor: pointer; }
.bot-btn.add { background: #6f2bff; color: #fff; }
.bot-btn.add:hover { background: #7f3fff; }

/* Mobile sidebar header */
.sidebar-mobile-header { display: flex; align-items: center; justify-content: space-between; padding: 12px 20px 8px; border-bottom: 1px solid #1e1e24; margin-bottom: 4px; }
.sidebar-user { font-size: 12px; color: #9d6cff; font-weight: 600; }
.sidebar-logout { background: transparent; border: 1px solid #333; color: #888; font-family: inherit; font-size: 11px; padding: 4px 10px; cursor: pointer; }
.sidebar-logout:hover { color: #fff; border-color: #555; }

/*  Main panel  */
.main-panel { flex: 1; background: #141418; padding: 20px; display: flex; flex-direction: column; overflow-y: auto; min-height: 0; min-width: 0; scrollbar-width: none; }
.main-panel::-webkit-scrollbar { display: none; }

.site-footer { margin-top: auto; padding: 20px 0 4px; font-size: 11px; color: #333; display: flex; align-items: center; gap: 8px; flex-shrink: 0; }
.footer-sep  { color: #2a2a30; }
.footer-link { color: #555; text-decoration: none; transition: color .15s; }
.footer-link:hover { color: #9d6cff; }

/*  Responsive helpers  */
.hide-mobile  { }
.show-mobile  { display: none; }

/* Logs page: prevent outer scroll on mobile */
@media (max-width: 680px) {
  body.logs-open,
  body.logs-open .page,
  body.logs-open .main-panel { overflow: hidden !important; height: 100%; }
}

/*  Mobile (≤ 680px)  */
@media (max-width: 680px) {
  html, body { overflow: auto; }
  .page { height: auto; min-height: 100vh; overflow: visible; }

  .topbar { padding: 0 14px; gap: 8px; }
  .brand-name { font-size: 14px; }

  .hide-mobile { display: none !important; }
  .show-mobile { display: flex !important; }

  .add-banner { padding: 8px 14px; font-size: 11px; }

  .body { overflow: visible; flex-direction: column; }

  /* Sidebar: slide-in drawer from right */
  .sidebar {
    position: fixed; top: 52px; right: 0; bottom: 0;
    width: 240px; z-index: 100;
    transform: translateX(100%);
    border-left: 1px solid #2a2a30;
    box-shadow: -4px 0 24px #00000066;
  }
  .sidebar.sidebar-open { transform: translateX(0); }

  .main-panel { padding: 14px; flex: none; min-height: calc(100vh - 52px); }
}

/*  Tablet (681px – 960px)  */
@media (min-width: 681px) and (max-width: 960px) {
  .topbar { padding: 0 16px; }
  .sidebar { width: 170px; }
  .sidebar-btn { padding: 10px 14px; font-size: 12px; }
  .main-panel { padding: 16px; }
}
</style>
