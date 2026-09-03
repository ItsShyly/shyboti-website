import { ref, computed, watch } from "vue";

// >>> per-row dot colour, stored in localStorage per channel. keys are whatever
// stable id the view passes (command name, item id, ...).
export function useRowColors(
  channelRef: () => string | undefined,
  tableKey: string,
  defaultHex: string,
) {
  const colors = ref<Record<string, string>>({});
  function storeKey(): string {
    return `row-colors-${tableKey}-${channelRef() ?? ""}`;
  }
  function load() {
    try {
      const raw = JSON.parse(localStorage.getItem(storeKey()) || "{}");
      colors.value = raw && typeof raw === "object" ? raw : {};
    } catch {
      colors.value = {};
    }
  }
  load();
  watch(channelRef, load);

  function colorOf(id: string): string {
    return colors.value[id] ?? defaultHex;
  }
  function setColor(id: string, hex: string) {
    colors.value = { ...colors.value, [id]: hex };
    try {
      localStorage.setItem(storeKey(), JSON.stringify(colors.value));
    } catch { }
  }
  function usedColors(ids: string[]): string[] {
    return [...new Set(ids.map((id) => colorOf(id).toLowerCase()))];
  }

  // >>> the header filter bar
  const filter = ref<string | null>(null);
  function toggleFilter(hex: string) {
    filter.value = filter.value === hex ? null : hex;
  }
  function matchesFilter(id: string): boolean {
    return !filter.value || colorOf(id).toLowerCase() === filter.value;
  }

  return {
    colors,
    colorOf,
    setColor,
    usedColors,
    filter,
    toggleFilter,
    matchesFilter,
  };
}
