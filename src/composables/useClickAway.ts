import { watch, onUnmounted, type Ref, type WatchSource } from "vue";

// >>> closes a popup on outside-click / Esc while it's open. `el` is the
// wrapper that counts as "inside".
export function useClickAway(
  isOpen: WatchSource<boolean>,
  el: Ref<HTMLElement | null>,
  close: () => void,
) {
  function onDown(e: MouseEvent) {
    if (el.value && !el.value.contains(e.target as Node)) close();
  }
  function onEsc(e: KeyboardEvent) {
    if (e.key === "Escape") close();
  }
  function stop() {
    window.removeEventListener("mousedown", onDown);
    window.removeEventListener("keydown", onEsc);
  }
  watch(isOpen, (open) => {
    stop();
    // >>> next tick so the click that opened it doesn't immediately close it
    if (open) setTimeout(() => {
      window.addEventListener("mousedown", onDown);
      window.addEventListener("keydown", onEsc);
    });
  });
  onUnmounted(stop);
}
