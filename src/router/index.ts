import { createRouter, createWebHistory } from 'vue-router'

// >>> Eagerly import the most-visited routes to avoid navigation lag on first visit.
// >>> Less-visited routes stay lazy so initial bundle stays small.
import DashboardView   from '../components/DashboardView.vue'
import CommandsView    from '../components/CommandsView.vue'
import AutomationsView from '../components/AutomationsView.vue'
import LogsView        from '../components/LogsView.vue'
import UploadsView     from '../components/UploadsView.vue'


const router = createRouter({
  history: createWebHistory(import.meta.env.BASE_URL),
  routes: [
    { path: '/',            component: () => import('../components/HomeView.vue') },
    { path: '/home',        redirect: '/' },
    { path: '/dashboard',   component: DashboardView },
    { path: '/commands',    component: CommandsView },
    // channel/user are now path segments (/logs/channel/user) instead of
    // query params - shorter, easier to share/type. Both optional so /logs
    // alone still works. Legacy ?channel=&user= links are still read by
    // LogsView for backwards compatibility.
    { path: '/logs/:channel?/:user?', component: LogsView },
    { path: '/uploads',     component: UploadsView },
    { path: '/tools',       component: () => import('../components/ToolsView.vue') },
    { path: '/more',        redirect: '/uploads' },
    { path: '/images',      component: () => import('../components/ImagesView.vue') },
    { path: '/obs-widgets', component: () => import('../components/ObsView.vue') },
    { path: '/obs-connection', component: () => import('../components/ObsConnectionView.vue') },
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
