import { createRouter, createWebHistory } from 'vue-router'

// >>> Eagerly import the most-visited routes to avoid navigation lag on first visit.
// >>> Less-visited routes stay lazy so initial bundle stays small.
import DashboardView   from '../components/DashboardView.vue'
import CommandsView    from '../components/CommandsView.vue'
import AutomationsView from '../components/AutomationsView.vue'
import LogsView        from '../components/LogsView.vue'
import ToolsView       from '../components/ToolsView.vue'

const IS_LOGS_DOMAIN = window.location.hostname === 'logs.shyboti.de'

const router = createRouter({
  history: createWebHistory(import.meta.env.BASE_URL),
  routes: IS_LOGS_DOMAIN
    // >>> logs.shyboti.de: only /logs is available. All other paths redirect to /logs.
    ? [
        { path: '/',          redirect: '/logs' },
        { path: '/logs',      component: LogsView },
        { path: '/:path(.*)', redirect: '/logs' },
      ]
    // >>> dev.shyboti.de (and localhost): full app with all routes
    : [
        { path: '/',            component: () => import('../components/HomeView.vue') },
        { path: '/home',        redirect: '/' },
        { path: '/dashboard',   component: DashboardView },
        { path: '/commands',    component: CommandsView },
        { path: '/logs',        component: LogsView },
        { path: '/tools',       component: ToolsView },
        { path: '/features',    component: () => import('../components/FeaturesView.vue') },
        { path: '/more',        redirect: '/tools' },
        { path: '/images',      component: () => import('../components/ImagesView.vue') },
        { path: '/obs-widgets', component: () => import('../components/ObsView.vue') },
        { path: '/notes',       component: () => import('../components/NotesView.vue') },
        { path: '/moderation',  component: () => import('../components/ModerationView.vue') },
        { path: '/automations', component: AutomationsView },
        { path: '/timers',      redirect: '/automations?tab=timers' },
        { path: '/triggers',    redirect: '/automations?tab=triggers' },
        { path: '/roles',       component: () => import('../components/RolesView.vue') },
        { path: '/settings',    component: () => import('../components/SettingsView.vue') },
        { path: '/privacy',     component: () => import('../components/PrivacyView.vue') },
        { path: '/:path(.*)',   redirect: '/' },
      ],
})

export default router
