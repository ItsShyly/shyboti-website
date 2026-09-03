import { ref } from "vue";
import { useDashboardColors } from "./useDashboardColors";

// >>> per-row dot colour + the header colour-filter bar. persistence is shared
// per channel via useDashboardColors (bot API); the filter itself is ephemeral.
// keys are whatever stable id the view passes (command name, item id, ...).
export function useRowColors(
  channelRef: () => string | undefined,
  tableKey: string,
  defaultHex: string,
) {
  const { colors, setColor: persist } = useDashboardColors(tableKey, channelRef);

  function colorOf(id: string): string {
    return colors.value[id] ?? defaultHex;
  }
  function setColor(id: string, hex: string) {
    persist(id, hex);
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
