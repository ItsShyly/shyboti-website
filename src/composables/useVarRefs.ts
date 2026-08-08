// composables/useVarRefs.ts
//
// Shared "live variables" loader - fetches the channel's actual counters/vars
// from /variables/:channel so every script editor (custom commands, OBS
// widgets, triggers, timers, countdowns) can show and click-to-insert the
// SAME list of real variable names, instead of only OBS widgets having this
// (which is where it originally lived, as a one-off).

import { ref } from "vue";
import { API } from "../api";
import { useAuth } from "../auth";

export interface LiveVarRef {
  label: string;
  expr: string;
}

export function useVarRefs() {
  const { session } = useAuth();
  const varRefs = ref<LiveVarRef[]>([]);
  const loaded = ref(false);
  const loading = ref(false);

  async function load(force = false) {
    if (!session.value || (loaded.value && !force) || loading.value) return;
    loading.value = true;
    try {
      const res = await fetch(`${API}/variables/${session.value.channel}`, {
        headers: { Authorization: `Bearer ${session.value.token}` },
      });
      if (res.ok) {
        const d = (await res.json()) as {
          counters: { name: string }[];
          vars: { name: string }[];
        };
        varRefs.value = [
          ...d.counters.map((c) => ({
            label: `counter.${c.name}`,
            expr: `$counter.${c.name}.get`,
          })),
          ...d.vars.map((v) => ({
            label: `var.${v.name}`,
            expr: `$var.${v.name}`,
          })),
        ];
        loaded.value = true;
      }
    } catch {
      /* best-effort */
    }
    loading.value = false;
  }

  function reset() {
    loaded.value = false;
    varRefs.value = [];
  }

  return { varRefs, loaded, loading, load, reset };
}
