// >>> shared live-variables loader so every script editor can show/click-insert the same real counter/var names (used to be OBS-widgets-only)

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
      // >>> best-effort
    }
    loading.value = false;
  }

  function reset() {
    loaded.value = false;
    varRefs.value = [];
  }

  return { varRefs, loaded, loading, load, reset };
}
