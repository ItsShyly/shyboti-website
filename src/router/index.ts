import { createRouter, createWebHistory } from 'vue-router'

const router = createRouter({
  history: createWebHistory(import.meta.env.BASE_URL),
  routes: [
    { path: '/',            redirect: '/home' },
    { path: '/home',        component: () => import('../components/HomeView.vue') },
    { path: '/dashboard',   component: () => import('../components/DashboardView.vue') },
    { path: '/commands',    component: () => import('../components/CommandsView.vue') },
    { path: '/logs',        component: () => import('../components/LogsView.vue') },
    { path: '/moderation',  component: () => import('../components/ModerationView.vue') },
    { path: '/roles',       component: () => import('../components/RolesView.vue') },
    { path: '/:path(.*)',   redirect: '/dashboard' },
  ],
})

export default router
