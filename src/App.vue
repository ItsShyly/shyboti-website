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
  router.push('/' + to)
  // Reveal content — animate menu away
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
    if (e.key === 'Escape') { searchQuery.value = ''; searchOpen.value = false; searchInputRef.value?.blur() }
    return
  }
  if (e.key === 'ArrowDown')  { e.preventDefault(); searchIndex.value = Math.min(searchIndex.value + 1, searchResults.value.length - 1) }
  if (e.key === 'ArrowUp')    { e.preventDefault(); searchIndex.value = Math.max(searchIndex.value - 1, 0) }
  if (e.key === 'Enter')      { e.preventDefault(); selectResult(searchResults.value[searchIndex.value]!) }
  if (e.key === 'Escape')     { searchQuery.value = ''; searchOpen.value = false; searchInputRef.value?.blur() }
}

function selectResult(r: SearchResult) {
  searchQuery.value = ''
  searchOpen.value  = false
  searchInputRef.value?.blur()
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

  // If already on a real route (deep-link), skip menu and show content
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

    <!-- ─── Floating search bar — always on top, never moves ─── -->
    <div class="float-search" :class="{ 'results-open': searchOpen && flatResults.length > 0 }">
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
        autocomplete="off"
        spellcheck="false"
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

    <!-- ─── Show-menu chevron — visible only when menu is hidden ─── -->
    <button
      class="show-menu-btn"
      :class="{ visible: !menuOpen }"
      @click="showMenu"
      title="Show menu"
    >▾</button>

    <!-- ─── Main stage: stacks .navbar-panel on top of .content-panel ─── -->
    <div class="stage">

      <!-- Content panel: always present behind, revealed when menu closes -->
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

      <!-- ─── Navbar panel (upper half when menu open) ─── -->
      <div class="navbar-panel" :class="{ 'menu-open': menuOpen, 'menu-closed': !menuOpen }">
        <div class="topbar">
          <div class="topbar-brand-placeholder"></div> <!-- empty placeholder for alignment -->
          <div class="topbar-right">
            <div class="lang-switcher">
              <button class="lang-opt" :class="{ active: locale === 'en' }" @click="setLocale('en')">EN</button>
              <span class="lang-sep">|</span>
              <button class="lang-opt" :class="{ active: locale === 'de' }" @click="setLocale('de')">DE</button>
            </div>
          </div>
        </div>

        <!-- Menu buttons (previously in .menu-selection) -->
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

      <!-- ─── Menu-selection panel (lower half) – now with big logo and login button ─── -->
      <div class="menu-selection" :class="{ 'menu-open': menuOpen, 'menu-closed': !menuOpen }">
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
            <p class="sub-message">Gain access to all features and bot control of your or other channels with access by logging in.
            </p>
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
            <button v-if="!availableChannels.includes(session.login)"
              class="add-channel-btn" @click="addBot">
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
body {
  background: #0e0e12;
  color: #fff;
  font-family: 'JetBrains Mono', monospace;
  font-size: 13px;
}
body.snippet-dragging,
body.snippet-dragging * { cursor: crosshair !important; user-select: none !important; }

/* ─── Page root ─── */
.page {
  height: 100vh;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  position: relative;
}

/* ─── Stage: fills remaining height, stacks layers ─── */
.stage {
  flex: 1;
  min-height: 0;
  position: relative;
  overflow: hidden;
}

/* ─── Content panel: always fills the stage behind the menu ─── */
.content-panel {
  position: absolute;
  inset: 0;
  background: #141418;
  padding: 20px;
  display: flex;
  flex-direction: column;
  overflow-y: auto;
  scrollbar-width: none;
  z-index: 0;
}
.content-panel::-webkit-scrollbar { display: none; }

/* ─── Navbar panel: top half, slides out upward when menu closes ─── */
.navbar-panel {
  position: absolute;
  left: 0; right: 0; top: 0;
  height: 50%;
  background: #0e0e12;
  border-bottom: 1px solid #1e1e24;
  display: flex;
  flex-direction: column;
  z-index: 10;
  transform: translateY(0);
  transition: transform 0.45s cubic-bezier(0.77, 0, 0.175, 1),
              opacity   0.35s ease;
  overflow-y: auto;
  scrollbar-width: none;
}
.navbar-panel::-webkit-scrollbar { display: none; }
.navbar-panel.menu-closed {
  transform: translateY(-100%);
  pointer-events: none;
}

/* Menu buttons inside navbar panel */
.menu-buttons-container {
  display: flex;
  flex-wrap: wrap;
  justify-content: center;
  align-content: flex-start;
  gap: 14px;
  padding: 20px 10% 30px;
  flex: 1;
  align-content: center;
}

/* ─── Menu-selection panel (lower half) ─── */
.menu-selection {
  position: absolute;
  left: 0; right: 0; bottom: 0;
  height: 50%;
  background: #0e0e12;
  border-top: 1px solid #1e1e24;
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 10;
  transform: translateY(0);
  transition: transform 0.45s cubic-bezier(0.77, 0, 0.175, 1),
              opacity   0.35s ease;
}
.menu-selection.menu-closed {
  transform: translateY(100%);
  pointer-events: none;
}

/* Content inside lower half */
.lower-half-content {
  text-align: center;
  padding: 20px;
  width: 100%;
}
.big-logo {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 12px;
  margin-bottom: 32px;
}
.big-emote {
  width: 80px;
  height: 80px;
  image-rendering: pixelated;
}
.big-brand-name {
  font-size: 2.2rem;
  font-weight: 800;
  color: #ffd569;
  letter-spacing: 0.08em;
}

.login-btn {
  background: #6f2bff;
  color: #aaa; 
  border: 1px solid #333;
  padding: 12px 24px;
  font-family: inherit;
  font-size: 1rem;
  font-weight: 700;
  display: inline-flex;
  align-items: center;
  gap: 12px;
  cursor: pointer;
}
.login-btn:hover {
  background: #3a3a3e; 
  color: #fff;
}

.logged-in-message {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
}
/* Each row: label on the left, value element on the right — both same height */
.login-line,
.managing-line {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 10px;
  height: 30px;  /* fixed row height so both rows are identical */
}
.managing-label {
  font-size: 11px;
  color: #555;
  white-space: nowrap;
  line-height: 30px;
}
/* The value side of each row — chip and channel button share these rules */
.channel-name-static {
  height: 30px; line-height: 30px;
  padding: 0 12px;
  border: 1px solid #6f2bff55; background: #1e1e26;
  color: #9d6cff; font-weight: 700; font-size: 12px;
}
.channel-switcher-inline { position: relative; }
.channel-btn-inline {
  height: 30px; padding: 0 12px;
  border: 1px solid #6f2bff55; background: #1e1e26;
  color: #9d6cff; font-family: inherit; font-size: 12px;
  font-weight: 700; cursor: pointer;
}
.channel-btn-inline:hover { background: #252530; border-color: #9d6cff88; }
.channel-menu-inline { left: 50%; transform: translateX(-50%); top: calc(100% + 6px); }
.add-channel-btn {
  margin-top: 20px;
  height: 36px; padding: 0 20px;
  background: #6f2bff22; border: 1px solid #6f2bff66;
  color: #9d6cff; font-family: inherit; font-size: 0.85rem;
  font-weight: 600; cursor: pointer;
  transition: background .15s, border-color .15s;
}
.add-channel-btn:hover { background: #6f2bff44; border-color: #9d6cffaa; color: #fff; }
.sub-message {
  font-size: 0.8rem;
  color: #777;
  margin-top: 8px;
}
/* Shake animation for login button */
@keyframes shake {
  0%   { transform: translateX(0) }
  15%  { transform: translateX(-5px) }
  30%  { transform: translateX(5px) }
  45%  { transform: translateX(-4px) }
  60%  { transform: translateX(4px) }
  75%  { transform: translateX(-2px) }
  90%  { transform: translateX(2px) }
  100% { transform: translateX(0) }
}
.shake { animation: shake 0.6s ease; }

/* ─── Topbar inside navbar panel ─── */
.topbar {
  height: 52px;
  flex-shrink: 0;
  display: flex;
  align-items: center;
  padding: 0 20px;
  gap: 10px;
}
.topbar-brand-placeholder {
  width: 120px;
}
.topbar-right {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-shrink: 0;
  margin-left: auto;
}
.logged-in-as {
  font-size: 12px;
  color: #9d6cff;
  font-weight: 600;
  white-space: nowrap;
}

/* ─── Menu buttons styling (unchanged) ─── */
.menu-btn {
  width: 180px;
  height: 110px;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  background: rgba(255,255,255,0.04);
  color: #777;
  font-family: inherit;
  font-size: 13px;
  cursor: pointer;
  letter-spacing: .01em;
  padding: 11px 20px;
  border: 1px solid #222;
  transition: color .1s, background .1s, border-color .15s;
  position: relative;
}
.menu-btn:hover { color: #fff; background: #16161a; border-color: #333; }
.menu-btn.active {
  color: #9d6cff;
  font-weight: 700;
  background: rgba(111,43,255,.08);
  border: 2px solid #6f2bff;
}
.menu-btn.locked { opacity: 0.4; background: rgba(255,255,255,0.02); }
.menu-btn.locked:hover { opacity: 0.7; }
.menu-btn-add { background: #6f2bff22; border-color: #6f2bff55; color: #9d6cff; }
.menu-btn-add:hover { background: #6f2bff33; }
.lock-icon {
  font-size: 1.8em;
  filter: grayscale(100%);
  position: absolute;
  opacity: 0.5;
}

/* ─── Floating search bar (unchanged positioning) ─── */
.float-search {
  position: fixed;
  top: 10px;
  left: 50%;
  transform: translateX(-50%);
  width: min(440px, 90vw);
  height: 36px;
  background: #111217;
  border: 1px solid #2a2a30;
  display: flex;
  align-items: center;
  z-index: 1000;
  transition: border-color .15s;
  box-shadow: 0 4px 24px rgba(0,0,0,.5);
}
.float-search:focus-within { border-color: #6f2bff66; }
.float-search .search-icon {
  position: absolute;
  left: 10px;
  width: 14px; height: 14px;
  color: #555;
  pointer-events: none;
}
.float-search .search-input {
  flex: 1; height: 100%;
  background: transparent; border: none; outline: none;
  color: #e0e0e0; font-family: inherit; font-size: 12px;
  padding: 0 8px 0 32px; min-width: 0;
}
.float-search .search-input::placeholder { color: #444; }
.float-search .search-kbd {
  font-size: 9px; color: #333; border: 1px solid #2a2a30;
  padding: 1px 5px; margin-right: 6px; flex-shrink: 0;
  pointer-events: none; background: #0e0e12;
}
.float-search .search-clear {
  background: transparent; border: none; color: #555;
  font-size: 11px; cursor: pointer; padding: 0 10px; height: 100%;
}
.float-search .search-clear:hover { color: #e0e0e0; }

.search-results {
  position: absolute;
  top: calc(100% + 4px);
  left: -1px; right: -1px;
  background: #1a1a1e;
  border: 1px solid #2a2a30;
  z-index: 9999;
  max-height: 400px;
  overflow-y: auto;
  box-shadow: 0 8px 32px rgba(0,0,0,.7);
  scrollbar-width: none;
}
.search-results::-webkit-scrollbar { display: none; }
.search-empty { padding: 14px 16px; color: #555; font-size: 12px; }
.result-group-label {
  padding: 6px 12px 3px;
  font-size: 9px; font-weight: 700;
  text-transform: uppercase; letter-spacing: .08em; color: #555;
  border-top: 1px solid #1e1e24;
}
.result-group-label:first-child { border-top: none; }
.result-item {
  display: flex; align-items: center; gap: 8px;
  width: 100%; padding: 7px 12px; border: none;
  background: transparent; color: #ccc;
  font-family: inherit; font-size: 12px;
  text-align: left; cursor: pointer; transition: background .1s;
}
.result-item:hover, .result-item.active { background: #6f2bff18; color: #e0e0e0; }
.result-icon  { width: 16px; flex-shrink: 0; text-align: center; font-size: 11px; color: #9d6cff; }
.result-label { font-weight: 600; flex-shrink: 0; }
.result-sub   { font-size: 10px; color: #555; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; flex: 1; }

/* ─── Show-menu chevron (unchanged) ─── */
.show-menu-btn {
  position: fixed;
  top: 54px;
  left: 50%;
  transform: translateX(-50%) translateY(-8px);
  width: 40px; height: 22px;
  background: #111217;
  border: 1px solid #2a2a30;
  color: #555;
  font-size: 16px;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 999;
  opacity: 0;
  pointer-events: none;
  transition: opacity 0.25s ease, transform 0.25s ease, color 0.15s;
  line-height: 1;
}
.show-menu-btn.visible {
  opacity: 1;
  pointer-events: auto;
  transform: translateX(-50%) translateY(0);
}
.show-menu-btn:hover { color: #9d6cff; border-color: #6f2bff55; }

/* ─── Auth / UI elements (unchanged except login btn removed) ─── */
.auth-btn {
  height: 34px; padding: 0 14px; border: none;
  font-family: inherit; font-size: 12px; font-weight: 600;
  cursor: pointer; white-space: nowrap;
}
.user-identity-chip {
  display: inline-flex; align-items: center;
  height: 30px;
  border: 1px solid #333; background: #1e1e26;
  overflow: hidden;
}
.identity-name {
  padding: 0 10px;
  font-size: 12px; font-weight: 600;
  color: #9d6cff; white-space: nowrap;
  line-height: 30px;
}
.identity-sep {
  color: #2a2a30; font-size: 11px; line-height: 30px;
}
.identity-logout {
  display: flex; align-items: center; justify-content: center;
  width: 32px; height: 30px;
  background: transparent; border: none; border-left: 1px solid #2a2a30;
  color: #555; cursor: pointer;
  transition: background .15s, color .15s;
  flex-shrink: 0;
}
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

/* ─── Responsive adjustments ─── */
.hide-mobile { display: initial; }
.show-mobile { display: none; }

@media (max-width: 680px) {
  .float-search { top: 6px; width: calc(100vw - 80px); }
  .show-menu-btn { top: 50px; }

  .menu-btn { width: 130px; height: 80px; font-size: 11px; }
  .menu-buttons-container {    
    display: flex;
    flex-wrap: wrap;
    justify-content: center;
    align-content: center;
    gap: 14px;
    padding: 30px 25% 30px;
    flex: 1; }

  .content-panel { padding: 14px; padding-bottom: 38px; }

  .site-footer {
    position: fixed; bottom: 0; left: 0; right: 0;
    padding: 6px 14px; background: #141418;
    border-top: 1px solid #1e1e24;
    justify-content: center; z-index: 50; margin-top: 0;
  }

  .hide-mobile { display: none !important; }
  .show-mobile { display: flex !important; }

  body.logs-open .content-panel { overflow: hidden !important; }
  
  .big-emote { width: 60px; height: 60px; }
  .big-brand-name { font-size: 1.6rem; }
  .login-twitch-btn { padding: 8px 18px; font-size: 0.9rem; }
}

@media (min-width: 681px) and (max-width: 960px) {
  .menu-btn { width: 150px; height: 95px; }
}
</style>
