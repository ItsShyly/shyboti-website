import { createRouter, createWebHistory } from "vue-router";
import { defineAsyncComponent } from "vue";

import RouteLoading from "../components/shared/RouteLoading.vue";
import { routeLoadSignal } from "../composables/routeLoadSignal";
import { useAuth } from "../auth";

// >>> personal content, not tied to selected channel
const OWN_CHANNEL_ONLY_PATHS = ["/uploads", "/images", "/notes"];

// >>> blocked only when admin mode is on
const ADMIN_MODE_BLOCKED_PATHS = ["/obs-control", "/obs-overlays"];

// >>> adds a spinner + fake delay for route loads
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

// >>> on this domain, bare /<channel> paths ARE the flaschenpost route
const isFlaschenpostDomain =
  typeof window !== "undefined" &&
  window.location.hostname === "flaschenpost.shyboti.de";

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
      component: lazy(
        () => import("../components/overlay/ObsOverlaysView.vue"),
      ),
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
      path: "/admin",
      component: lazy(() => import("../components/AdminView.vue")),
    },
    {
      path: "/privacy",
      component: lazy(() => import("../components/PrivacyView.vue")),
    },
    {
      path: "/flaschenpost/:channel",
      component: lazy(() => import("../components/FlaschenpostView.vue")),
    },
    ...(isFlaschenpostDomain
      ? [
          {
            path: "/:channel",
            component: lazy(() => import("../components/FlaschenpostView.vue")),
          },
        ]
      : []),
    { path: "/:path(.*)", redirect: "/" },
  ],
});

// >>> a redeploy renames chunk hashes - an already-open tab's dynamic
// >>> import() then 404s (server falls back to index.html, wrong MIME type).
// >>> only fix is a hard reload to pick up the new build, once per failure
// >>> so a genuinely broken deploy doesn't reload-loop forever
function reloadOnStaleChunk(err: unknown) {
  const msg = String((err as any)?.message ?? err ?? "");
  if (!/dynamically imported module|fetch dynamically|preload/i.test(msg))
    return;
  if (sessionStorage.getItem("chunk_reload_done")) return;
  sessionStorage.setItem("chunk_reload_done", "1");
  window.location.reload();
}
router.onError(reloadOnStaleChunk);
window.addEventListener("vite:preloadError", (e) =>
  reloadOnStaleChunk((e as any).payload),
);

router.beforeEach((to) => {
  // >>> bare domain (no channel) has nothing to show - bounce to the real dashboard

  // @TODO change to shyboti.de when live
  if (isFlaschenpostDomain && to.path === "/") {
    window.location.href = "https://dev.shyboti.de";
    return false;
  }

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
// >>> a real success means the reload (if any) worked - re-arm the guard
router.afterEach(() => sessionStorage.removeItem("chunk_reload_done"));

export default router;
