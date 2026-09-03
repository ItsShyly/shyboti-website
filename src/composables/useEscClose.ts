import { onActivated, onDeactivated, onMounted, onUnmounted } from "vue";

// >>> the edit drawer lost its backdrop (docked next to the table now), so
// there's no click-outside - Esc closes it instead. handles KeepAlive'd views.
export function useEscClose(close: () => void) {
  function onKey(e: KeyboardEvent) {
    if (e.key === "Escape") close();
  }
  onMounted(() => window.addEventListener("keydown", onKey));
  onUnmounted(() => window.removeEventListener("keydown", onKey));
  onActivated(() => window.addEventListener("keydown", onKey));
  onDeactivated(() => window.removeEventListener("keydown", onKey));
}
