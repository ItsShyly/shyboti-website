import { ref, watch } from "vue";
import { API } from "../api";
import { useAuth } from "../auth";

// >>> per-channel row/category dot colours, shared through the bot API so they
// follow the channel, not the browser. scope picks the list ("cmd", "mod",
// "timer", "trigger", "countdown"). localStorage is only a warm-start cache;
// the server is the source of truth.
export function useDashboardColors(
  scope: string,
  channelRef: () => string | undefined,
) {
  const { session } = useAuth();
  const colors = ref<Record<string, string>>({});

  const cacheKey = () => `dash-colors-${scope}-${channelRef() ?? ""}`;
  // >>> pre-API these lived under their own keys - lift them once
  function legacyKey(): string {
    const ch = channelRef() ?? "";
    return scope === "cmd" ? `cmd-cat-colors-${ch}` : `row-colors-${scope}-${ch}`;
  }

  function readCache() {
    try {
      const raw = JSON.parse(localStorage.getItem(cacheKey()) || "{}");
      colors.value = raw && typeof raw === "object" ? raw : {};
    } catch {
      colors.value = {};
    }
  }
  function writeCache() {
    try {
      localStorage.setItem(cacheKey(), JSON.stringify(colors.value));
    } catch {}
  }

  // >>> coalesce writes: a bulk recolour is one PUT, not one per row
  let pending: Record<string, string> = {};
  let timer: ReturnType<typeof setTimeout> | null = null;
  function scheduleFlush() {
    if (timer) clearTimeout(timer);
    timer = setTimeout(flush, 250);
  }
  function flush() {
    timer = null;
    const ch = channelRef();
    const entries = pending;
    pending = {};
    if (!ch || !session.value || !Object.keys(entries).length) return;
    fetch(`${API}/dashboard-colors/${ch}/${scope}`, {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${session.value.token}`,
      },
      body: JSON.stringify({ entries }),
    }).catch(() => {});
  }

  async function fetchRemote() {
    const ch = channelRef();
    if (!ch || !session.value) return;
    try {
      const res = await fetch(`${API}/dashboard-colors/${ch}`, {
        headers: { Authorization: `Bearer ${session.value.token}` },
      });
      if (!res.ok || channelRef() !== ch) return;
      const data = (await res.json()) as {
        colors?: Record<string, Record<string, string>>;
      };
      if (channelRef() !== ch) return;
      const remote = data.colors?.[scope] ?? {};
      if (!Object.keys(remote).length) {
        try {
          const legacy = JSON.parse(localStorage.getItem(legacyKey()) || "{}");
          if (legacy && typeof legacy === "object" && Object.keys(legacy).length) {
            colors.value = legacy;
            writeCache();
            pending = { ...pending, ...legacy };
            scheduleFlush();
            return;
          }
        } catch {}
      }
      colors.value = remote;
      writeCache();
    } catch {}
  }

  function reload() {
    readCache();
    fetchRemote();
  }
  reload();
  watch(channelRef, reload);

  function setColor(key: string, hex: string) {
    colors.value = { ...colors.value, [key]: hex };
    writeCache();
    pending[key] = hex;
    scheduleFlush();
  }

  return { colors, setColor, reload };
}
