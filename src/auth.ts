import { ref, readonly } from "vue";
import { API } from "./api";

interface Session {
  login: string;
  channel: string;
  token: string;
  isAdmin: boolean;
}

export interface RolePermissions {
  modsEnabled: boolean;
  // vvv Dashboard vvv
  dashboard: boolean;
  // vvv Commands vvv
  commands_view: boolean;
  commands_toggle: boolean;
  commands_edit: boolean;
  commands_delete: boolean;
  commands_mod: boolean;
  // vvv Automations vvv
  automations_view: boolean;
  automations_toggle: boolean;
  automations_edit: boolean;
  automations_delete: boolean;
  // vvv Moderation vvv
  moderation_view: boolean;
  moderation_manage: boolean;
  // vvv OBS vvv
  obs_view: boolean;
  obs_edit: boolean;
  obs_force_preview: boolean;
  // vvv Channel Points vvv
  channelpoints_view: boolean;
  channelpoints_edit: boolean;
}

export interface ChannelRole {
  role: "broadcaster" | "mod" | "vip" | "user";
  permissions: RolePermissions;
  botPresent: boolean;
}

const session = ref<Session | null>(null);
const availableChannels = ref<string[]>([]);
// >>> admin-only channels drive the red/purple badge
const adminOnlyChannels = ref<string[]>([]);
// >>> bot presence in the logged-in user's channel
const ownChannelHasBot = ref(true);
const channelRole = ref<ChannelRole | null>(null);

// >>> local toggle for admin mode state
const adminMode = ref(
  typeof window !== "undefined" &&
    localStorage.getItem("shyboti_admin_mode") === "1",
);
let accessRefreshTimer: ReturnType<typeof setInterval> | null = null;
let accessRefreshBound = false;

async function fetchChannels() {
  if (!session.value) return;
  try {
    const res = await fetch(`${API}/channels`, {
      headers: { Authorization: `Bearer ${session.value.token}` },
    });
    if (!res.ok) return;
    const data = (await res.json()) as {
      channels: string[];
      adminOnly?: string[];
      ownChannelHasBot?: boolean;
    };
    availableChannels.value = data.channels;
    adminOnlyChannels.value = data.adminOnly ?? [];
    ownChannelHasBot.value = data.ownChannelHasBot ?? true;
  } catch {}
}

async function fetchRole(channel: string) {
  if (!session.value) return;
  try {
    const res = await fetch(`${API}/role/${channel}`, {
      headers: { Authorization: `Bearer ${session.value.token}` },
    });
    if (!res.ok) {
      channelRole.value = null;
      return;
    }
    channelRole.value = (await res.json()) as ChannelRole;
  } catch {
    channelRole.value = null;
  }
}

async function refreshAccessState() {
  if (!session.value) return;
  await fetchChannels();
  if (!session.value) return;

  const current = session.value.channel;
  const next = availableChannels.value.includes(current)
    ? current
    : availableChannels.value.includes(session.value.login)
      ? session.value.login
      : availableChannels.value[0];

  if (next && next !== current) {
    session.value = { ...session.value, channel: next };
    await fetchRole(next);
    return;
  }

  if (current) await fetchRole(current);
}

function stopAccessRefresh() {
  if (accessRefreshTimer) {
    clearInterval(accessRefreshTimer);
    accessRefreshTimer = null;
  }
}

function startAccessRefresh() {
  stopAccessRefresh();
  accessRefreshTimer = setInterval(() => {
    refreshAccessState().catch(() => {});
  }, 30_000);

  if (!accessRefreshBound && typeof window !== "undefined") {
    const kick = () => {
      refreshAccessState().catch(() => {});
    };
    window.addEventListener("focus", kick);
    document.addEventListener("visibilitychange", () => {
      if (!document.hidden) kick();
    });
    accessRefreshBound = true;
  }
}

export function useAuth() {
  async function restoreSession(token: string) {
    try {
      const res = await fetch(`${API}/me`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) throw new Error();
      const data = (await res.json()) as {
        login: string;
        channel: string;
        isAdmin: boolean;
      };
      // >>> the server session only remembers the channel from login time -
      // >>> restore whatever channel was last viewed instead, so a reload
      // >>> doesn't bounce back to the own channel after switching away.
      // refreshAccessState() below re-validates this against availableChannels.
      const lastChannel = localStorage.getItem("shyboti_last_channel");
      session.value = {
        login: data.login,
        channel: lastChannel || data.channel,
        token,
        isAdmin: data.isAdmin,
      };
      localStorage.setItem("shyboti_token", token);
      await refreshAccessState();
      startAccessRefresh();
    } catch {
      session.value = null;
      availableChannels.value = [];
      adminOnlyChannels.value = [];
      channelRole.value = null;
      stopAccessRefresh();
      localStorage.removeItem("shyboti_token");
    }
  }

  async function switchChannel(channel: string) {
    if (!session.value) return;
    session.value = { ...session.value, channel };
    localStorage.setItem("shyboti_last_channel", channel);
    await fetchRole(channel);
  }

  async function logout() {
    if (!session.value) return;
    await fetch(`${API}/logout`, {
      method: "POST",
      headers: { Authorization: `Bearer ${session.value.token}` },
    }).catch(() => {});
    session.value = null;
    availableChannels.value = [];
    adminOnlyChannels.value = [];
    channelRole.value = null;
    adminMode.value = false;
    localStorage.removeItem("shyboti_admin_mode");
    stopAccessRefresh();
    localStorage.removeItem("shyboti_token");
    localStorage.removeItem("shyboti_last_channel");
  }

  function login() {
    window.location.href = `${API}/auth/login`;
  }

  function toggleAdminMode() {
    if (!session.value?.isAdmin) return;
    adminMode.value = !adminMode.value;
    localStorage.setItem("shyboti_admin_mode", adminMode.value ? "1" : "0");
    // >>> snap back to own channel when admin mode turns off
    if (!adminMode.value && session.value.channel !== session.value.login) {
      switchChannel(session.value.login);
    }
  }

  return {
    session: readonly(session),
    availableChannels: readonly(availableChannels),
    adminOnlyChannels: readonly(adminOnlyChannels),
    ownChannelHasBot: readonly(ownChannelHasBot),
    channelRole: readonly(channelRole),
    adminMode: readonly(adminMode),
    toggleAdminMode,
    restoreSession,
    switchChannel,
    logout,
    login,
  };
}
