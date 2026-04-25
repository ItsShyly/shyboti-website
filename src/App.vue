<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted, watch, nextTick, provide, type Ref } from 'vue'
import { useRouter, useRoute } from 'vue-router'
import { API } from './api'
import { useAuth } from './auth'
import { useI18n, useLocale, type Locale } from './i18n'
import SnippetOverlay from './components/SnippetOverlay.vue'

const { session, availableChannels, channelRole, restoreSession, switchChannel, logout, login } = useAuth()
const router = useRouter()
const route = useRoute()
const { t } = useI18n()
const { locale, setLocale } = useLocale()

const loginShaking = ref(false)
function shakeLogin() {
  if (loginShaking.value) return
  loginShaking.value = true
  setTimeout(() => (loginShaking.value = false), 600)
}

const showChannelMenu = ref(false)
const sidebarOpen     = ref(false)

// >>> menuOpen: true = 50/50 split , false = menu hidden, content revealed
const menuOpen = ref(true)

function selectChannel(ch: string) {
  switchChannel(ch)
  showChannelMenu.value = false
}

type NavItem = 'dashboard' | 'commands' | 'logs' | 'moderation' | 'roles' | 'automations' | 'tools' | 'features' | 'settings'
const activeRoute = computed(() => {
  const p = route.path.replace('/', '') || 'dashboard'
  return p === 'more' ? 'tools' : p
})

function nav(to: NavItem) {
  const PUBLIC: NavItem[] = ['logs', 'tools']
  if (!PUBLIC.includes(to) && !session.value) { shakeLogin(); return }
  sidebarOpen.value = false
  router.push('/' + to)
  menuOpen.value = false
}

function showMenu() {
  menuOpen.value = true
}

// === Universal Search ===

interface SearchResult {
  label: string
  sub?: string
  category: string
  action: () => void
  icon?: string
}

const searchQuery        = ref('')
const searchOpen         = ref(false)
const searchInputRef     = ref<HTMLInputElement | null>(null)
const searchInputMobile  = ref<HTMLInputElement | null>(null)
const searchResults      = ref<SearchResult[]>([])
const searchIndex        = ref(0)
let   searchDebounce: ReturnType<typeof setTimeout> | null = null

function focusSearch() {
  searchInputRef.value?.focus()
  searchInputRef.value?.select()
}

function buildStaticIndex(): SearchResult[] {
  return [
    { label: 'Dashboard',       category: 'Page',     icon: '◈', action: () => nav('dashboard') },
    { label: 'Commands',        category: 'Page',     icon: '◈', action: () => nav('commands') },
    { label: 'Moderation',      category: 'Page',     icon: '◈', action: () => nav('moderation') },
    { label: 'Automations',     category: 'Page',     icon: '◈', action: () => nav('automations') },
    { label: 'Timers',          category: 'Page',     icon: '◈', action: () => { router.push('/automations?tab=timers'); menuOpen.value = false }, sub: 'Automations → Timers' },
    { label: 'Triggers',        category: 'Page',     icon: '◈', action: () => { router.push('/automations?tab=triggers'); menuOpen.value = false }, sub: 'Automations → Triggers' },
    { label: 'Countdowns',      category: 'Page',     icon: '◈', action: () => { router.push('/automations?tab=countdowns'); menuOpen.value = false }, sub: 'Automations → Countdowns' },
    { label: 'Roles',           category: 'Page',     icon: '◈', action: () => nav('roles') },
    { label: 'Logs',            category: 'Page',     icon: '◈', action: () => nav('logs') },
    { label: 'Tools',           category: 'Page',     icon: '◈', action: () => nav('tools') },
    { label: 'Features',        category: 'Page',     icon: '◈', action: () => nav('features') },
    { label: 'Settings',        category: 'Page',     icon: '◈', action: () => nav('settings') },
    { label: 'Images',          category: 'Tools',    icon: '🖼', action: () => { router.push('/images'); menuOpen.value = false }, sub: 'Upload and host images' },
    { label: 'Notes',           category: 'Tools',    icon: '📄', action: () => { router.push('/notes'); menuOpen.value = false }, sub: 'Create and share text snippets' },
    { label: 'OBS Widgets',     category: 'Features', icon: '📺', action: () => { router.push('/obs-widgets'); menuOpen.value = false }, sub: 'Live browser sources for OBS' },
    { label: 'Variables & Counters', category: 'Features', icon: '⚙', action: () => { router.push('/features'); menuOpen.value = false }, sub: 'View and edit $counter and $var values' },
    { label: 'Command Prefix',  category: 'Settings', icon: '⚙', action: () => nav('settings'), sub: 'Change the bot command prefix' },
    { label: 'Logs Opt-Out',    category: 'Settings', icon: '⚙', action: () => nav('settings'), sub: 'Control chat log visibility' },
    { label: 'Remove Bot',      category: 'Settings', icon: '⚙', action: () => nav('settings'), sub: 'Remove ShyBoti from your channel' },
    { label: 'Custom Commands', category: 'Commands', icon: '+', action: () => { nav('commands'); nextActiveTab.value = 'Custom' }, sub: 'Your custom +commands' },
    { label: 'New Command',     category: 'Commands', icon: '+', action: () => { nav('commands'); nextActiveTab.value = 'Custom' }, sub: 'Create a new command' },
  ]
}

const nextActiveTab = ref('')

let _dynamicCache: SearchResult[] | null = null
async function loadDynamic(): Promise<SearchResult[]> {
  if (_dynamicCache) return _dynamicCache
  if (!session.value) return []
  const results: SearchResult[] = []
  try {
    const [cmdRes, timerRes, trigRes] = await Promise.allSettled([
      fetch(`${API}/commands/${session.value.channel}`,        { headers: { Authorization: `Bearer ${session.value.token}` } }),
      fetch(`${API}/timers/${session.value.channel}`,          { headers: { Authorization: `Bearer ${session.value.token}` } }),
      fetch(`${API}/triggers/${session.value.channel}`,        { headers: { Authorization: `Bearer ${session.value.token}` } }),
    ])
    if (cmdRes.status === 'fulfilled' && cmdRes.value.ok) {
      const d = await cmdRes.value.json() as { commands: { name: string; description: string }[]; prefix: string }
      for (const c of d.commands) {
        const cmdName = c.name
        results.push({ label: `${d.prefix}${cmdName}`, category: 'Command', icon: '+', sub: c.description || undefined,
          action: () => { nav('commands'); setTimeout(() => { searchOpenEdit.value = { name: cmdName, builtIn: true } }, 50) }
        })
      }
    }
    if (timerRes.status === 'fulfilled' && timerRes.value.ok) {
      const d = await timerRes.value.json() as { timers: { name: string; response: string }[] }
      for (const ti of d.timers) {
        const name = ti.name
        results.push({ label: name, category: 'Timer', icon: '⏱', sub: ti.response.slice(0, 50) || undefined,
          action: () => { router.push('/automations?tab=timers'); menuOpen.value = false; nextTick(() => { searchOpenTimer.value = name }) }
        })
      }
    }
    if (trigRes.status === 'fulfilled' && trigRes.value.ok) {
      const d = await trigRes.value.json() as { triggers: { name: string; match_pattern: string }[] }
      for (const tr of d.triggers) {
        const name = tr.name
        results.push({ label: name, category: 'Trigger', icon: '⚡', sub: tr.match_pattern || undefined,
          action: () => { router.push('/automations?tab=triggers'); menuOpen.value = false; nextTick(() => { searchOpenTrigger.value = name }) }
        })
      }
    }
    const ccRes = await fetch(`${API}/custom-commands/${session.value.channel}`, { headers: { Authorization: `Bearer ${session.value.token}` } })
    if (ccRes.ok) {
      const d = await ccRes.json() as { commands: { name: string; description?: string; response?: string }[] }
      for (const c of (d.commands ?? [])) {
        const ccName = c.name
        results.push({ label: `+${ccName}`, category: 'Custom Command', icon: '+', sub: c.description || c.response?.slice(0, 50) || undefined,
          action: () => { nav('commands'); setTimeout(() => { searchOpenEdit.value = { name: ccName, builtIn: false } }, 50) }
        })
      }
    }
  } catch { }
  _dynamicCache = results
  return results
}

watch(() => session.value?.channel, () => { _dynamicCache = null })

async function runSearch(q: string) {
  if (!q.trim()) { searchResults.value = []; searchIndex.value = 0; return }
  const query = q.toLowerCase().trim()
  const all = [...buildStaticIndex(), ...await loadDynamic()]
  const scored = all.map(item => {
    const label = item.label.toLowerCase()
    const sub   = (item.sub ?? '').toLowerCase()
    let score = 0
    if (label === query)              score = 100
    else if (label.startsWith(query)) score = 80
    else if (label.includes(query))   score = 60
    else if (sub.includes(query))     score = 30
    else return null
    return { item, score }
  }).filter(Boolean).sort((a, b) => b!.score - a!.score).slice(0, 12).map(x => x!.item)
  searchResults.value = scored
  searchIndex.value   = 0
}

function onSearchInput() {
  searchOpen.value = true
  if (searchDebounce) clearTimeout(searchDebounce)
  searchDebounce = setTimeout(() => runSearch(searchQuery.value), 120)
}

function onSearchKeydown(e: KeyboardEvent) {
  if (!searchOpen.value || !searchResults.value.length) {
    if (e.key === 'Escape') { searchQuery.value = ''; searchOpen.value = false; searchInputRef.value?.blur(); searchInputMobile.value?.blur() }
    return
  }
  if (e.key === 'ArrowDown')  { e.preventDefault(); searchIndex.value = Math.min(searchIndex.value + 1, searchResults.value.length - 1) }
  if (e.key === 'ArrowUp')    { e.preventDefault(); searchIndex.value = Math.max(searchIndex.value - 1, 0) }
  if (e.key === 'Enter')      { e.preventDefault(); selectResult(searchResults.value[searchIndex.value]!) }
  if (e.key === 'Escape')     { searchQuery.value = ''; searchOpen.value = false; searchInputRef.value?.blur(); searchInputMobile.value?.blur() }
}

function selectResult(r: SearchResult) {
  searchQuery.value = ''
  searchOpen.value  = false
  searchInputRef.value?.blur()
  searchInputMobile.value?.blur()
  searchResults.value = []
  r.action()
}

function onSearchFocus() { searchOpen.value = true; if (searchQuery.value) runSearch(searchQuery.value) }
function onSearchBlur()  { setTimeout(() => { searchOpen.value = false }, 150) }

function onGlobalKeydown(e: KeyboardEvent) {
  if ((e.ctrlKey || e.metaKey) && e.key === 'f') {
    const tag = (document.activeElement as HTMLElement)?.tagName
    const isEditable = (document.activeElement as HTMLElement)?.isContentEditable
    if (tag === 'TEXTAREA' || tag === 'INPUT' || isEditable) return
    e.preventDefault()
    focusSearch()
  }
}

onMounted(() => { document.addEventListener('keydown', onGlobalKeydown) })
onUnmounted(() => { document.removeEventListener('keydown', onGlobalKeydown) })

const groupedResults = computed(() => {
  const groups: Record<string, SearchResult[]> = {}
  for (const r of searchResults.value) {
    if (!groups[r.category]) groups[r.category] = []
    groups[r.category]!.push(r)
  }
  return groups
})
const flatResults = computed(() => searchResults.value)

// === App bootstrap ===

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
    nav('dashboard')
  } else if (status === 'added' && channel) {
    showToast(`✓ ShyBoti added to #${channel}`)
    nav('dashboard')
  } else if (status === 'removed' && channel) {
    showToast(`✓ ShyBoti left #${channel}`)
  }

  if (route.path !== '/' && route.path !== '') {
    menuOpen.value = false
  }
})

function addBot() { window.location.href = `${API}/auth/add` }

const KEEP_ALIVE_ROUTES = ['DashboardView', 'CommandsView', 'AutomationsView']

provide('nextActiveTab', nextActiveTab)

const mainPanelRef = ref<HTMLElement | null>(null)
provide('mainPanelRef', mainPanelRef)

const searchOpenEdit = ref<{ name: string; builtIn: boolean } | null>(null)
provide('searchOpenEdit', searchOpenEdit)

const searchOpenTimer   = ref<string | null>(null)
const searchOpenTrigger = ref<string | null>(null)
provide('searchOpenTimer',   searchOpenTimer)
provide('searchOpenTrigger', searchOpenTrigger)
</script>

<template>
  <div class="page">

    <!-- ─── MOBILE TOPBAR (only visible on mobile via CSS) ─── -->
    <div class="mobile-topbar">
      <div class="topbar-brand" @click="router.push(session ? '/dashboard' : '/')" style="cursor:pointer">
        <img src="https://cdn.7tv.app/emote/01G0PEAVDR0008B1SW0M995JQJ/2x.gif" alt="shy" class="brand-emote" />
        <span class="brand-name">ShyBoti</span>
      </div>
      <div class="mobile-topbar-right">
        <div class="lang-switcher">
          <button class="lang-opt" :class="{ active: locale === 'en' }" @click="setLocale('en')">EN</button>
          <span class="lang-sep">|</span>
          <button class="lang-opt" :class="{ active: locale === 'de' }" @click="setLocale('de')">DE</button>
        </div>
        <button class="hamburger" @click="sidebarOpen = !sidebarOpen" :class="{ open: sidebarOpen }">
          <span></span><span></span><span></span>
        </button>
      </div>
    </div>

    <!-- ─── MOBILE SIDEBAR ─── -->
    <div v-if="sidebarOpen" class="sidebar-overlay" @click="sidebarOpen = false"></div>
    <aside class="mobile-sidebar" :class="{ 'sidebar-open': sidebarOpen }">
      <div class="sidebar-mobile-header">
        <template v-if="session">
          <span class="sidebar-user">#{{ session.channel }}</span>
          <button class="sidebar-logout" @click="logout(); router.push('/'); sidebarOpen = false">{{ t('nav.logout') }}</button>
        </template>
        <template v-else>
          <button class="sidebar-login-btn" :class="{ shake: loginShaking }" @click="login; sidebarOpen = false">{{ t('nav.login') }}</button>
        </template>
      </div>

      <!-- Mobile search -->
      <div class="sidebar-search" :class="{ open: searchOpen && flatResults.length > 0 }">
        <svg class="search-icon" viewBox="0 0 16 16" fill="none">
          <circle cx="7" cy="7" r="4.5" stroke="currentColor" stroke-width="1.5"/>
          <path d="M10.5 10.5L14 14" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
        </svg>
        <input
          ref="searchInputMobile"
          v-model="searchQuery"
          class="search-input"
          placeholder="Search…"
          @input="onSearchInput"
          @keydown="onSearchKeydown"
          @focus="onSearchFocus"
          @blur="onSearchBlur"
          autocomplete="off" spellcheck="false"
        />
        <button v-if="searchQuery" class="search-clear" @mousedown.prevent="searchQuery = ''; searchResults = []; searchOpen = false">✕</button>
        <div v-if="searchOpen && flatResults.length > 0" class="search-results">
          <template v-for="(items, category) in groupedResults" :key="category">
            <div class="result-group-label">{{ category }}</div>
            <button v-for="(r, idx) in items" :key="r.label + idx" class="result-item"
              :class="{ active: flatResults.indexOf(r) === searchIndex }"
              @mousedown.prevent="selectResult(r); sidebarOpen = false">
              <span class="result-icon">{{ r.icon }}</span>
              <span class="result-label">{{ r.label }}</span>
              <span v-if="r.sub" class="result-sub">{{ r.sub }}</span>
            </button>
          </template>
        </div>
        <div v-else-if="searchOpen && searchQuery.trim() && !flatResults.length" class="search-results search-empty">
          No results for "{{ searchQuery }}"
        </div>
      </div>

      <button class="sidebar-btn" :class="{ active: activeRoute === 'dashboard', locked: !session }" @click="nav('dashboard')">
        {{ t('nav.dashboard') }} <span v-if="!session" class="lock-icon">🔒</span>
      </button>
      <button class="sidebar-btn" :class="{ active: activeRoute === 'commands', locked: !session }" @click="nav('commands')">
        {{ t('nav.commands') }} <span v-if="!session" class="lock-icon">🔒</span>
      </button>
      <button class="sidebar-btn" :class="{ active: activeRoute === 'moderation', locked: !session }" @click="nav('moderation')">
        {{ t('nav.moderation') }} <span v-if="!session" class="lock-icon">🔒</span>
      </button>
      <button class="sidebar-btn" :class="{ active: activeRoute === 'automations', locked: !session }" @click="nav('automations')">
        {{ t('nav.automations') }} <span v-if="!session" class="lock-icon">🔒</span>
      </button>
      <button v-if="!session || channelRole?.role === 'broadcaster'"
        class="sidebar-btn" :class="{ active: activeRoute === 'roles', locked: !session }" @click="nav('roles')">
        {{ t('nav.roles') }} <span v-if="!session" class="lock-icon">🔒</span>
      </button>
      <button class="sidebar-btn" :class="{ active: activeRoute === 'features', locked: !session }" @click="nav('features')">
        Features <span v-if="!session" class="lock-icon">🔒</span>
      </button>
      <div class="sidebar-divider"></div>
      <button class="sidebar-btn" :class="{ active: activeRoute === 'logs' }" @click="nav('logs')">
        {{ t('nav.logs') }}
      </button>
      <button class="sidebar-btn" :class="{ active: activeRoute === 'tools' }" @click="nav('tools')">
        Tools
      </button>
      <div class="sidebar-spacer"></div>
      <button v-if="!session || channelRole?.role === 'broadcaster'"
        class="sidebar-btn" :class="{ active: activeRoute === 'settings', locked: !session }" @click="nav('settings')">
        {{ t('nav.settings') }} <span v-if="!session" class="lock-icon">🔒</span>
      </button>
      <div v-if="session && !availableChannels.includes(session.login)" class="sidebar-bottom">
        <button class="bot-btn add" @click="addBot">{{ t('nav.add_channel') }}</button>
      </div>
    </aside>

    <!-- ─── Floating search bar — desktop only ─── -->
    <div class="float-search desktop-only" :class="{ 'results-open': searchOpen && flatResults.length > 0 }">
      <svg class="search-icon" viewBox="0 0 16 16" fill="none">
        <circle cx="7" cy="7" r="4.5" stroke="currentColor" stroke-width="1.5"/>
        <path d="M10.5 10.5L14 14" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
      </svg>
      <input
        ref="searchInputRef"
        v-model="searchQuery"
        class="search-input"
        placeholder="Search… (Ctrl+F)"
        @input="onSearchInput"
        @keydown="onSearchKeydown"
        @focus="onSearchFocus"
        @blur="onSearchBlur"
        autocomplete="off" spellcheck="false"
      />
      <kbd v-if="!searchQuery" class="search-kbd">Ctrl+F</kbd>
      <button v-if="searchQuery" class="search-clear" @mousedown.prevent="searchQuery = ''; searchResults = []; searchOpen = false">✕</button>
      <div v-if="searchOpen && flatResults.length > 0" class="search-results">
        <template v-for="(items, category) in groupedResults" :key="category">
          <div class="result-group-label">{{ category }}</div>
          <button v-for="(r, idx) in items" :key="r.label + idx" class="result-item"
            :class="{ active: flatResults.indexOf(r) === searchIndex }"
            @mousedown.prevent="selectResult(r)">
            <span class="result-icon">{{ r.icon }}</span>
            <span class="result-label">{{ r.label }}</span>
            <span v-if="r.sub" class="result-sub">{{ r.sub }}</span>
          </button>
        </template>
      </div>
      <div v-else-if="searchOpen && searchQuery.trim() && !flatResults.length" class="search-results search-empty">
        No results for "{{ searchQuery }}"
      </div>
    </div>

    <!-- ─── Show-menu chevron — desktop only ─── -->
    <button class="show-menu-btn desktop-only" :class="{ visible: !menuOpen }" @click="showMenu" title="Show menu">▾</button>

    <!-- ─── Main stage: desktop split-screen ─── -->
    <div class="stage">

      <div class="content-panel" ref="mainPanelRef">
        <SnippetOverlay />
        <RouterView v-slot="{ Component }">
          <KeepAlive :include="KEEP_ALIVE_ROUTES">
            <component :is="Component" />
          </KeepAlive>
        </RouterView>
        <footer class="site-footer">
          {{ t('footer.copy') }}
          <span class="footer-sep">|</span>
          <router-link to="/privacy" class="footer-link">{{ t('footer.privacy') }}</router-link>
        </footer>
      </div>

      <!-- ─── Navbar panel (upper half, desktop) ─── -->
      <div class="navbar-panel desktop-only" :class="{ 'menu-open': menuOpen, 'menu-closed': !menuOpen }">
        <div class="topbar">
          <div class="topbar-brand-placeholder"></div>
          <div class="topbar-right">
            <div class="lang-switcher">
              <button class="lang-opt" :class="{ active: locale === 'en' }" @click="setLocale('en')">EN</button>
              <span class="lang-sep">|</span>
              <button class="lang-opt" :class="{ active: locale === 'de' }" @click="setLocale('de')">DE</button>
            </div>
          </div>
        </div>

        <div class="menu-buttons-container">
          <button class="menu-btn" :class="{ active: activeRoute === 'dashboard', locked: !session }" @click="nav('dashboard')">
            <span v-if="!session" class="lock-icon">🔒</span>
            <span>{{ t('nav.dashboard') }}</span>
          </button>
          <button class="menu-btn" :class="{ active: activeRoute === 'commands', locked: !session }" @click="nav('commands')">
            <span v-if="!session" class="lock-icon">🔒</span>
            <span>{{ t('nav.commands') }}</span>
          </button>
          <button class="menu-btn" :class="{ active: activeRoute === 'moderation', locked: !session }" @click="nav('moderation')">
            <span v-if="!session" class="lock-icon">🔒</span>
            <span>{{ t('nav.moderation') }}</span>
          </button>
          <button class="menu-btn" :class="{ active: activeRoute === 'automations', locked: !session }" @click="nav('automations')">
            <span v-if="!session" class="lock-icon">🔒</span>
            <span>{{ t('nav.automations') }}</span>
          </button>
          <button v-if="!session || channelRole?.role === 'broadcaster'"
            class="menu-btn" :class="{ active: activeRoute === 'roles', locked: !session }" @click="nav('roles')">
            <span v-if="!session" class="lock-icon">🔒</span>
            <span>{{ t('nav.roles') }}</span>
          </button>
          <button class="menu-btn" :class="{ active: activeRoute === 'features', locked: !session }" @click="nav('features')">
            <span v-if="!session" class="lock-icon">🔒</span>
            <span>Features</span>
          </button>
          <button class="menu-btn" :class="{ active: activeRoute === 'logs' }" @click="nav('logs')">
            {{ t('nav.logs') }}
          </button>
          <button class="menu-btn" :class="{ active: activeRoute === 'tools' }" @click="nav('tools')">
            Tools
          </button>
          <button v-if="!session || channelRole?.role === 'broadcaster'"
            class="menu-btn" :class="{ active: activeRoute === 'settings', locked: !session }" @click="nav('settings')">
            <span v-if="!session" class="lock-icon">🔒</span>
            <span>{{ t('nav.settings') }}</span>
          </button>
        </div>

        <div v-if="session && showAddBanner" class="add-banner">
          <span>👋 {{ t('banner.welcome') }}</span>
          <div class="banner-actions">
            <button class="banner-btn add" @click="addBot">{{ t('banner.add') }}</button>
            <button class="banner-dismiss" @click="showAddBanner = false">✕</button>
          </div>
        </div>
      </div>

      <!-- ─── Menu-selection panel (lower half, desktop) ─── -->
      <div class="menu-selection desktop-only" :class="{ 'menu-open': menuOpen, 'menu-closed': !menuOpen }">
        <div class="lower-half-content" :class="{ 'logged-out': !session }">
          <div class="big-logo">
            <img src="https://cdn.7tv.app/emote/01G0PEAVDR0008B1SW0M995JQJ/2x.gif" alt="shy" class="big-emote" />
            <span class="big-brand-name">ShyBoti</span>
          </div>
          <div v-if="!session" class="login-area">
            <button class="auth-btn login-btn" :class="{ shake: loginShaking }" @click="login">
              {{ t('nav.login') }}
            </button>
          </div>
          <div v-if="!session" class="logged-in-message">
            <p class="sub-message">Gain access to all features and bot control of your or other channels with access by logging in.</p>
          </div>
          <div v-else class="logged-in-message">
            <div class="login-line">
              <span class="managing-label">Logged in as</span>
              <div class="user-identity-chip">
                <span class="identity-name">{{ session.login }}</span>
                <span class="identity-sep">|</span>
                <button class="identity-logout" @click="logout(); router.push('/')" title="Log out">
                  <svg viewBox="0 0 16 16" fill="none" width="13" height="13">
                    <path d="M6 2H3a1 1 0 0 0-1 1v10a1 1 0 0 0 1 1h3" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
                    <path d="M11 11l3-3-3-3" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
                    <path d="M14 8H6" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
                  </svg>
                </button>
              </div>
            </div>
            <div class="managing-line">
              <span class="managing-label">Managing:</span>
              <div class="channel-switcher-inline" v-if="availableChannels.length > 1">
                <button class="channel-btn-inline" @click="showChannelMenu = !showChannelMenu">
                  #{{ session.channel }} ▾
                </button>
                <div v-if="showChannelMenu" class="channel-menu channel-menu-inline">
                  <button v-for="ch in availableChannels" :key="ch" class="channel-menu-item"
                    :class="{ active: ch === session.channel }" @click="selectChannel(ch)">#{{ ch }}</button>
                </div>
              </div>
              <span v-else class="channel-name-static">#{{ session.channel }}</span>
            </div>
            <p class="sub-message">Use the menu above to navigate.</p>
            <button v-if="!availableChannels.includes(session.login)" class="add-channel-btn" @click="addBot">
              {{ t('nav.add_channel') }}
            </button>
          </div>
        </div>
      </div>

    </div><!-- /stage -->

    <span v-if="toast" class="toast toast-float">{{ toast }}</span>
  </div>
</template>

<style>
@import url('https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;600;700&display=swap');
*, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
html, body { height: 100%; overflow: hidden; }
body { background: #0e0e12; color: #fff; font-family: 'JetBrains Mono', monospace; font-size: 13px; }
body.snippet-dragging, body.snippet-dragging * { cursor: crosshair !important; user-select: none !important; }

/* ─── Page root ─── */
.page { height: 100vh; display: flex; flex-direction: column; overflow: hidden; position: relative; }

/* ─── Mobile topbar — hidden on desktop ─── */
.mobile-topbar { display: none; }

/* ─── Mobile sidebar — hidden on desktop ─── */
.mobile-sidebar { display: none; }
.sidebar-overlay { display: none; }

/* ─── desktop-only: shown by default, hidden on mobile ─── */
.desktop-only { display: flex; }

/* ─── Stage: fills remaining height ─── */
.stage { flex: 1; min-height: 0; position: relative; overflow: hidden; }

/* ─── Content panel ─── */
.content-panel {
  position: absolute; inset: 0;
  background: #141418; padding: 20px;
  display: flex; flex-direction: column;
  overflow-y: auto; scrollbar-width: none; z-index: 0;
}
.content-panel::-webkit-scrollbar { display: none; }

/* ─── Navbar panel: top half ─── */
.navbar-panel {
  position: absolute; left: 0; right: 0; top: 0; height: 50%;
  background: #0e0e12; border-bottom: 1px solid #1e1e24;
  flex-direction: column; z-index: 10;
  transform: translateY(0);
  transition: transform 0.45s cubic-bezier(0.77, 0, 0.175, 1), opacity 0.35s ease;
  overflow-y: auto; scrollbar-width: none;
}
.navbar-panel::-webkit-scrollbar { display: none; }
.navbar-panel.menu-closed { transform: translateY(-100%); pointer-events: none; visibility: hidden; }

.menu-buttons-container {
  display: flex; flex-wrap: wrap; justify-content: center;
  align-content: center; gap: 14px; padding: 20px 25% 30px; flex: 1;
}

/* ─── Menu-selection panel: lower half ─── */
.menu-selection {
  position: absolute; left: 0; right: 0; bottom: 0; height: 50%;
  background: #0e0e12; border-top: 1px solid #1e1e24;
  align-items: center; justify-content: center; z-index: 10;
  transform: translateY(0);
  transition: transform 0.45s cubic-bezier(0.77, 0, 0.175, 1), opacity 0.35s ease;
}
.menu-selection.menu-closed { transform: translateY(100%); pointer-events: none; visibility: hidden; }

.lower-half-content { text-align: center; padding: 20px; width: 100%; }
.big-logo { display: flex; flex-direction: column; align-items: center; gap: 12px; margin-bottom: 32px; }
.big-emote { width: 80px; height: 80px; image-rendering: pixelated; }
.big-brand-name { font-size: 2.2rem; font-weight: 800; color: #ffd569; letter-spacing: 0.08em; }

.login-btn {
  background: #6f2bff; color: #aaa; border: 1px solid #333;
  padding: 12px 24px; font-family: inherit; font-size: 1rem; font-weight: 700;
  display: inline-flex; align-items: center; gap: 12px; cursor: pointer;
}
.login-btn:hover { background: #3a3a3e; color: #fff; }

.logged-in-message { display: flex; flex-direction: column; align-items: center; gap: 8px; }
.login-line, .managing-line {
  display: flex; align-items: center; justify-content: center; gap: 10px; height: 30px;
}
.managing-label { font-size: 11px; color: #555; white-space: nowrap; line-height: 30px; }
.channel-name-static {
  height: 30px; line-height: 30px; padding: 0 12px;
  border: 1px solid #6f2bff55; background: #1e1e26;
  color: #9d6cff; font-weight: 700; font-size: 12px;
}
.channel-switcher-inline { position: relative; }
.channel-btn-inline {
  height: 30px; padding: 0 12px;
  border: 1px solid #6f2bff55; background: #1e1e26;
  color: #9d6cff; font-family: inherit; font-size: 12px; font-weight: 700; cursor: pointer;
}
.channel-btn-inline:hover { background: #252530; border-color: #9d6cff88; }
.channel-menu-inline { left: 50%; transform: translateX(-50%); top: calc(100% + 6px); }
.add-channel-btn {
  margin-top: 20px; height: 36px; padding: 0 20px;
  background: #6f2bff22; border: 1px solid #6f2bff66;
  color: #9d6cff; font-family: inherit; font-size: 0.85rem; font-weight: 600; cursor: pointer;
  transition: background .15s, border-color .15s;
}
.add-channel-btn:hover { background: #6f2bff44; border-color: #9d6cffaa; color: #fff; }
.sub-message { font-size: 0.8rem; color: #777; margin-top: 8px; }

@keyframes shake {
  0%   { transform: translateX(0) }  15%  { transform: translateX(-5px) }
  30%  { transform: translateX(5px) } 45%  { transform: translateX(-4px) }
  60%  { transform: translateX(4px) } 75%  { transform: translateX(-2px) }
  90%  { transform: translateX(2px) } 100% { transform: translateX(0) }
}
.shake { animation: shake 0.6s ease; }

/* ─── Topbar inside desktop navbar panel ─── */
.topbar { height: 52px; flex-shrink: 0; display: flex; align-items: center; padding: 0 20px; gap: 10px; }
.topbar-brand-placeholder { width: 120px; }
.topbar-right { display: flex; align-items: center; gap: 10px; flex-shrink: 0; margin-left: auto; }

/* ─── Menu buttons ─── */
.menu-btn {
  width: 180px; height: 110px;
  display: flex; align-items: center; justify-content: center; gap: 8px;
  background: rgba(255,255,255,0.04); color: #777;
  font-family: inherit; font-size: 13px; cursor: pointer;
  letter-spacing: .01em; padding: 11px 20px;
  border: 1px solid #222;
  transition: color .1s, background .1s, border-color .15s; position: relative;
}
.menu-btn:hover { color: #fff; background: #16161a; border-color: #333; }
.menu-btn.active { color: #9d6cff; font-weight: 700; background: rgba(111,43,255,.08); border: 2px solid #6f2bff; }
.menu-btn.locked { opacity: 0.4; background: rgba(255,255,255,0.02); }
.menu-btn.locked:hover { opacity: 0.7; }
.lock-icon { font-size: 1.8em; filter: grayscale(100%); position: absolute; opacity: 0.5; }

/* ─── Floating search bar ─── */
.float-search {
  position: fixed; top: 10px; left: 50%; transform: translateX(-50%);
  width: min(440px, 90vw); height: 36px;
  background: #111217; border: 1px solid #2a2a30;
  align-items: center; z-index: 1000;
  transition: border-color .15s; box-shadow: 0 4px 24px rgba(0,0,0,.5);
}
.float-search:focus-within { border-color: #6f2bff66; }
.float-search .search-icon { position: absolute; left: 10px; width: 14px; height: 14px; color: #555; pointer-events: none; }
.float-search .search-input { flex: 1; height: 100%; background: transparent; border: none; outline: none; color: #e0e0e0; font-family: inherit; font-size: 12px; padding: 0 8px 0 32px; min-width: 0; }
.float-search .search-input::placeholder { color: #444; }
.float-search .search-kbd { font-size: 9px; color: #333; border: 1px solid #2a2a30; padding: 1px 5px; margin-right: 6px; flex-shrink: 0; pointer-events: none; background: #0e0e12; }
.float-search .search-clear { background: transparent; border: none; color: #555; font-size: 11px; cursor: pointer; padding: 0 10px; height: 100%; }
.float-search .search-clear:hover { color: #e0e0e0; }

.search-results {
  position: absolute; top: calc(100% + 4px); left: -1px; right: -1px;
  background: #1a1a1e; border: 1px solid #2a2a30; z-index: 9999;
  max-height: 400px; overflow-y: auto;
  box-shadow: 0 8px 32px rgba(0,0,0,.7); scrollbar-width: none;
}
.search-results::-webkit-scrollbar { display: none; }
.search-empty { padding: 14px 16px; color: #555; font-size: 12px; }
.result-group-label { padding: 6px 12px 3px; font-size: 9px; font-weight: 700; text-transform: uppercase; letter-spacing: .08em; color: #555; border-top: 1px solid #1e1e24; }
.result-group-label:first-child { border-top: none; }
.result-item { display: flex; align-items: center; gap: 8px; width: 100%; padding: 7px 12px; border: none; background: transparent; color: #ccc; font-family: inherit; font-size: 12px; text-align: left; cursor: pointer; transition: background .1s; }
.result-item:hover, .result-item.active { background: #6f2bff18; color: #e0e0e0; }
.result-icon  { width: 16px; flex-shrink: 0; text-align: center; font-size: 11px; color: #9d6cff; }
.result-label { font-weight: 600; flex-shrink: 0; }
.result-sub   { font-size: 10px; color: #555; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; flex: 1; }

/* ─── Show-menu chevron ─── */
.show-menu-btn {
  position: fixed; top: 43px; left: 50%;
  transform: translateX(-50%) translateY(-8px);
  width: 40px; height: 22px; background: #111217; border: 1px solid #2a2a30;
  color: #555; font-size: 16px; cursor: pointer;
  align-items: center; justify-content: center;
  z-index: 999; opacity: 0; pointer-events: none;
  transition: opacity 0.25s ease, transform 0.25s ease, color 0.15s; line-height: 1;
}
.show-menu-btn.visible { opacity: 1; pointer-events: auto; transform: translateX(-50%) translateY(0); }
.show-menu-btn:hover { color: #9d6cff; border-color: #6f2bff55; }

/* ─── Auth / shared UI ─── */
.auth-btn { height: 34px; padding: 0 14px; border: none; font-family: inherit; font-size: 12px; font-weight: 600; cursor: pointer; white-space: nowrap; }
.user-identity-chip { display: inline-flex; align-items: center; height: 30px; border: 1px solid #333; background: #1e1e26; overflow: hidden; }
.identity-name { padding: 0 10px; font-size: 12px; font-weight: 600; color: #9d6cff; white-space: nowrap; line-height: 30px; }
.identity-sep { color: #2a2a30; font-size: 11px; line-height: 30px; }
.identity-logout { display: flex; align-items: center; justify-content: center; width: 32px; height: 30px; background: transparent; border: none; border-left: 1px solid #2a2a30; color: #555; cursor: pointer; transition: background .15s, color .15s; flex-shrink: 0; }
.identity-logout:hover { background: #2c1a1a; color: #ff6b6b; }

.lang-switcher { display: flex; align-items: center; gap: 2px; flex-shrink: 0; border: 1px solid #2a2a30; padding: 0 2px; height: 28px; }
.lang-sep  { color: #333; font-size: 10px; }
.lang-opt  { height: 22px; padding: 0 7px; border: none; background: transparent; color: #555; font-family: inherit; font-size: 11px; font-weight: 700; cursor: pointer; letter-spacing: .04em; }
.lang-opt:hover  { color: #aaa; }
.lang-opt.active { color: #9d6cff; background: #6f2bff18; }

.channel-switcher { position: relative; }
.channel-btn { height: 30px; padding: 0 12px; border: 1px solid #333; background: #1e1e26; color: #9d6cff; font-family: inherit; font-size: 12px; font-weight: 600; cursor: pointer; }
.channel-btn:hover { background: #252530; border-color: #6f2bff55; }
.channel-menu { position: absolute; top: calc(100% + 6px); right: 0; background: #1b1b1d; border: 1px solid #2a2a30; min-width: 160px; z-index: 200; display: flex; flex-direction: column; box-shadow: 0 8px 24px #00000066; }
.channel-menu-item { padding: 9px 16px; border: none; background: transparent; color: #888; font-family: inherit; font-size: 12px; text-align: left; cursor: pointer; }
.channel-menu-item:hover { background: #222; color: #fff; }
.channel-menu-item.active { color: #9d6cff; font-weight: 700; }

.add-banner { background: #1a1025; border-bottom: 1px solid #6f2bff44; padding: 8px 16px; display: flex; align-items: center; justify-content: space-between; gap: 10px; font-size: 12px; color: #ccc; flex-shrink: 0; }
.banner-actions { display: flex; align-items: center; gap: 8px; flex-shrink: 0; }
.banner-btn.add { height: 30px; padding: 0 12px; background: #6f2bff; border: none; color: #fff; font-family: inherit; font-size: 11px; cursor: pointer; }
.banner-btn.add:hover { background: #7f3fff; }
.banner-dismiss { background: transparent; border: none; color: #666; font-size: 14px; cursor: pointer; padding: 0 4px; }
.banner-dismiss:hover { color: #aaa; }

.toast { font-size: 11px; color: #23d18b; background: #0e2a1e; border: 1px solid #23d18b44; padding: 4px 10px; max-width: 200px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.toast-float { position: fixed; bottom: 16px; right: 16px; z-index: 1001; }

/* ─── Footer ─── */
.site-footer { margin-top: auto; padding: 20px 0 4px; font-size: 11px; color: #333; display: flex; align-items: center; gap: 8px; flex-shrink: 0; }
.footer-sep  { color: #2a2a30; }
.footer-link { color: #555; text-decoration: none; transition: color .15s; }
.footer-link:hover { color: #9d6cff; }

/* ═══════════════════════════════════════════════
   MOBILE  ≤ 680px  —  sidebar + hamburger layout
   ═══════════════════════════════════════════════ */
@media (max-width: 680px) {
  html, body { overflow: auto; }
  .page { height: auto; min-height: 100vh; overflow: visible; }

  /* Hide all desktop-only elements */
  .desktop-only { display: none !important; }

  .lock-icon {  margin-left: 170px; }

  /* Show mobile topbar */
  .mobile-topbar {
    display: flex; align-items: center; justify-content: space-between;
    height: 52px; flex-shrink: 0;
    background: #0e0e12; padding: 0 12px; gap: 8px;
    position: sticky; top: 0; z-index: 100;
  }
  .topbar-brand { display: flex; align-items: center; gap: 8px; }
  .brand-emote  { width: 32px; height: 32px; image-rendering: pixelated; }
  .brand-name   { font-size: 13px; font-weight: 700; color: #ffd569; letter-spacing: 0.04em; }
  .mobile-topbar-right { display: flex; align-items: center; gap: 8px; }

  /* Hamburger */
  .hamburger { display: flex; flex-direction: column; justify-content: center; gap: 5px; width: 36px; height: 36px; padding: 0 6px; background: transparent; border: 1px solid #2a2a30; cursor: pointer; flex-shrink: 0; }
  .hamburger span { display: block; height: 2px; background: #888; transition: transform .2s, opacity .2s; }
  .hamburger.open span:nth-child(1) { transform: translateY(7px) rotate(45deg); background: #9d6cff; }
  .hamburger.open span:nth-child(2) { opacity: 0; }
  .hamburger.open span:nth-child(3) { transform: translateY(-7px) rotate(-45deg); background: #9d6cff; }

  /* Sidebar overlay */
  .sidebar-overlay { display: block; position: fixed; inset: 0; background: rgba(0,0,0,.6); z-index: 99; }

  /* Sidebar */
  .mobile-sidebar {
    display: flex; flex-direction: column;
    position: fixed; top: 52px; right: 0; bottom: 0; width: 240px;
    background: #0e0e12; z-index: 100;
    border-left: 1px solid #2a2a30;
    box-shadow: -4px 0 24px #00000066;
    transform: translateX(100%);
    transition: transform .25s ease;
    overflow-y: auto; scrollbar-width: none;
  }
  .mobile-sidebar::-webkit-scrollbar { display: none; }
  .mobile-sidebar.sidebar-open { transform: translateX(0); }

  .sidebar-mobile-header { display: flex; align-items: center; justify-content: space-between; padding: 12px 16px 8px; border-bottom: 1px solid #1e1e24; margin-bottom: 4px; flex-shrink: 0; }
  .sidebar-user { font-size: 12px; color: #9d6cff; font-weight: 600; }
  .sidebar-logout { background: transparent; border: 1px solid #333; color: #888; font-family: inherit; font-size: 11px; padding: 4px 10px; cursor: pointer; }
  .sidebar-logout:hover { color: #fff; border-color: #555; }
  .sidebar-login-btn { height: 28px; padding: 0 12px; background: #6f2bff; border: none; color: #fff; font-family: inherit; font-size: 11px; font-weight: 600; cursor: pointer; }

  /* Sidebar search */
  .sidebar-search {
    display: flex; position: relative; margin: 8px 12px 4px; height: 36px;
    background: #111217; border: 1px solid #2a2a30; align-items: center; flex-shrink: 0;
  }
  .sidebar-search:focus-within { border-color: #6f2bff66; }
  .sidebar-search .search-icon { position: absolute; left: 9px; width: 13px; height: 13px; color: #555; pointer-events: none; }
  .sidebar-search .search-input { flex: 1; height: 100%; background: transparent; border: none; outline: none; color: #e0e0e0; font-family: inherit; font-size: 12px; padding: 0 8px 0 28px; }
  .sidebar-search .search-input::placeholder { color: #444; }
  .sidebar-search .search-clear { background: transparent; border: none; color: #555; font-size: 11px; cursor: pointer; padding: 0 8px; height: 100%; }
  .sidebar-search .search-results { position: absolute; top: calc(100% + 2px); left: -1px; right: -1px; background: #1a1a1e; border: 1px solid #2a2a30; z-index: 9999; max-height: 320px; overflow-y: auto; box-shadow: 0 8px 24px rgba(0,0,0,.6); scrollbar-width: none; }
  .sidebar-search .search-results::-webkit-scrollbar { display: none; }

  /* Sidebar nav buttons */
  .sidebar-btn { display: flex; align-items: center; justify-content: space-between; width: 100%; padding: 11px 20px; border: none; background: transparent; color: #777; text-align: left; font-family: inherit; font-size: 13px; cursor: pointer; transition: color .1s, background .1s; letter-spacing: .01em; }
  .sidebar-btn:hover { color: #fff; background: #16161a; }
  .sidebar-btn.active { color: #9d6cff; font-weight: 700; background: rgba(111,43,255,.08); border-left: 2px solid #6f2bff; }
  .sidebar-btn.locked { opacity: 0.45; }
  .sidebar-divider { height: 1px; background: #1e1e24; margin: 6px 14px; flex-shrink: 0; }
  .sidebar-spacer { flex: 1; }
  .sidebar-bottom { padding: 12px 16px; border-top: 1px solid #1e1e24; }
  .bot-btn { width: 100%; height: 32px; border: none; font-family: inherit; font-size: 12px; cursor: pointer; }
  .bot-btn.add { background: #6f2bff; color: #fff; }
  .bot-btn.add:hover { background: #7f3fff; }

  /* Main panel fills screen below topbar */
  .stage { display: block; height: auto; position: static; overflow: visible; }
  .content-panel {
    position: static; inset: auto;
    min-height: calc(100dvh - 52px);
    padding: 14px; padding-bottom: 38px;
    overflow-y: visible;
  }

  /* Footer pinned */
  .site-footer { position: fixed; bottom: 0; left: 0; right: 0; padding: 6px 14px; background: #141418; border-top: 1px solid #1e1e24; justify-content: center; z-index: 50; margin-top: 0; }

  body.logs-open { overflow: hidden !important; height: 100dvh !important; }
  body.logs-open .page { overflow: hidden !important; height: 100dvh !important; min-height: 0 !important; }
  body.logs-open .stage { height: calc(100dvh - 52px) !important; display: flex; flex-direction: column; }
  body.logs-open .content-panel { position: absolute !important; inset: 0 !important; overflow: hidden !important; padding-bottom: 0 !important; min-height: 0 !important; }
}

@media (min-width: 681px) and (max-width: 960px) {
  .menu-btn { width: 150px; height: 95px; }
}
</style>
