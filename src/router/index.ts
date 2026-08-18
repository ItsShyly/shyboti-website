import { createRouter, createWebHistory } from "vue-router";
import { defineAsyncComponent } from "vue";

import RouteLoading from "../components/shared/RouteLoading.vue";
import { routeLoadSignal } from "../composables/routeLoadSignal";
import { useAuth } from "../auth";

// >>> Personal content (owned by the logged-in user, not scoped to whichever channel is currently selected)
const OWN_CHANNEL_ONLY_PATHS = ["/uploads", "/images", "/notes"];

// >>> Additionally off-limits specifically while admin-moded via admin mode
const ADMIN_MODE_BLOCKED_PATHS = ["/obs-control", "/obs-overlays"];

// >>> defineAsyncComponent for navigation
function lazy(loader: () => Promise<any>) {
  return defineAsyncComponent({
    loader: async () => {
      const mod = await loader();
      routeLoadSignal.value++;
      await new Promise((r) => setTimeout(r, 100));
      return mod;
    },
    loadingComponent: RouteLoading,
    delay: 0,
  });
}

const router = createRouter({
  history: createWebHistory(import.meta.env.BASE_URL),
  routes: [
    { path: "/", component: lazy(() => import("../components/HomeView.vue")) },
    { path: "/home", redirect: "/" },
    {
      path: "/dashboard",
      component: lazy(() => import("../components/DashboardView.vue")),
    },
    {
      path: "/commands",
      component: lazy(() => import("../components/CommandsView.vue")),
    },

    {
      path: "/logs/:channel?/:user?",
      component: lazy(() => import("../components/LogsView.vue")),
    },
    {
      path: "/uploads",
      component: lazy(() => import("../components/UploadsView.vue")),
    },
    {
      path: "/tools",
      component: lazy(() => import("../components/ToolsView.vue")),
    },
    {
      path: "/images",
      component: lazy(() => import("../components/ImagesView.vue")),
    },
    {
      path: "/obs-widgets",
      component: lazy(() => import("../components/ObsView.vue")),
    },
    {
      path: "/obs-control",
      component: lazy(() => import("../components/ObsControlView.vue")),
    },
    {
      path: "/obs-overlays",
      component: lazy(() => import("../components/ObsOverlaysView.vue")),
    },
    {
      path: "/notes",
      component: lazy(() => import("../components/NotesView.vue")),
    },
    {
      path: "/moderation",
      component: lazy(() => import("../components/ModerationView.vue")),
    },
    {
      path: "/automations",
      component: lazy(() => import("../components/AutomationsView.vue")),
    },
    { path: "/timers", redirect: "/automations?tab=timers" },
    { path: "/triggers", redirect: "/automations?tab=triggers" },
    {
      path: "/roles",
      component: lazy(() => import("../components/RolesView.vue")),
    },
    {
      path: "/settings",
      component: lazy(() => import("../components/SettingsView.vue")),
    },
    {
      path: "/privacy",
      component: lazy(() => import("../components/PrivacyView.vue")),
    },
    { path: "/:path(.*)", redirect: "/" },
  ],
});

router.beforeEach((to) => {
  const { session, adminMode } = useAuth();
  const viewingOtherChannel =
    !!session.value && session.value.login !== session.value.channel;

  if (OWN_CHANNEL_ONLY_PATHS.includes(to.path) && viewingOtherChannel) {
    return "/dashboard";
  }
  if (
    ADMIN_MODE_BLOCKED_PATHS.includes(to.path) &&
    adminMode.value &&
    viewingOtherChannel
  ) {
    return "/dashboard";
  }
  return true;
});

export default router;
