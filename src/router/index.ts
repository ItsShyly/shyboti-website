import { createRouter, createWebHistory } from 'vue-router'

const router = createRouter({
  history: createWebHistory(import.meta.env.BASE_URL),
  routes: [
    { path: '/',            component: () => import('../components/HomeView.vue') },
    { path: '/home',        redirect: '/' },
    { path: '/dashboard',   component: () => import('../components/DashboardView.vue') },
    { path: '/commands',    component: () => import('../components/CommandsView.vue') },
    { path: '/logs',        component: () => import('../components/LogsView.vue') },
    { path: '/moderation',  component: () => import('../components/ModerationView.vue') },
    { path: '/automations', component: () => import('../components/AutomationsView.vue') },
    { path: '/timers',      redirect: '/automations?tab=timers' },
    { path: '/triggers',    redirect: '/automations?tab=triggers' },
    { path: '/roles',       component: () => import('../components/RolesView.vue') },
    { path: '/settings',    component: () => import('../components/SettingsView.vue') },
    { path: '/:path(.*)',   redirect: '/' },
  ],
})

export default router
