import {
  ref,
  computed,
  onActivated,
  onDeactivated,
  onMounted,
  onUnmounted,
} from "vue";

// >>> drag / Ctrl / Alt / Shift row multi-select for the list views. plain
// click still falls through to the row's own handler (open editor).
export function useRowSelection<T>(
  orderedItems: () => T[],
  keyOf: (t: T) => string,
  opts: {
    // >>> Delete on a non-empty selection calls this (the view's bulk-delete,
    // which pops its own confirm dialog)
    onDelete?: (items: T[]) => void;
    // >>> only handle Ctrl+A / Delete while this instance's tab is on screen
    isActive?: () => boolean;
  } = {},
) {
  const selected = ref<Set<string>>(new Set());
  const anchor = ref<string | null>(null);

  let downKey: string | null = null;
  let downX = 0;
  let downY = 0;
  let dragging = false;
  // >>> per-gesture state: key order cached at drag start (list can't change
  // mid-drag), last row we were over, and rAF-coalesced move handling so a
  // fast mousemove doesn't rebuild the Set + re-render every row per event
  let dragKeys: string[] = [];
  let lastOverKey: string | null = null;
  let pendingMove: PointerEvent | null = null;
  let rafId = 0;

  function keys(): string[] {
    return orderedItems().map(keyOf);
  }
  function rangeIn(ks: string[], a: string, b: string): string[] {
    const i = ks.indexOf(a);
    const j = ks.indexOf(b);
    if (i < 0 || j < 0) return [b];
    return ks.slice(Math.min(i, j), Math.max(i, j) + 1);
  }
  function rangeKeys(a: string, b: string): string[] {
    return rangeIn(keys(), a, b);
  }

  function processMove() {
    rafId = 0;
    const e = pendingMove;
    pendingMove = null;
    if (!e || !downKey) return;
    if (!dragging && Math.hypot(e.clientX - downX, e.clientY - downY) < 5) return;
    if (!dragging) {
      dragging = true;
      dragKeys = keys();
      anchor.value = downKey;
      lastOverKey = downKey;
      selected.value = new Set([downKey]);
      document.body.style.userSelect = "none";
      window.getSelection()?.removeAllRanges();
    }
    const el = document.elementFromPoint(e.clientX, e.clientY) as HTMLElement | null;
    const k = el?.closest("[data-sel-key]")?.getAttribute("data-sel-key");
    // >>> only touch reactive state when we crossed into a different row
    if (!k || k === lastOverKey) return;
    lastOverKey = k;
    selected.value = new Set(rangeIn(dragKeys, downKey, k));
  }
  function onMove(e: PointerEvent) {
    if (!downKey) return;
    pendingMove = e;
    if (!rafId) rafId = requestAnimationFrame(processMove);
  }
  function onUp() {
    window.removeEventListener("pointermove", onMove);
    window.removeEventListener("pointerup", onUp);
    window.removeEventListener("dragstart", onNativeDrag, true);
    if (rafId) cancelAnimationFrame(rafId);
    rafId = 0;
    pendingMove = null;
    dragKeys = [];
    lastOverKey = null;
    document.body.style.userSelect = "";
    downKey = null;
  }
  // >>> a native HTML5 drag started (e.g. row drag-to-group) - bail on select
  function onNativeDrag() {
    dragging = false;
    onUp();
  }

  function onRowPointerDown(e: PointerEvent, key: string) {
    if (e.button !== 0) return;
    if (
      (e.target as HTMLElement).closest(
        "button, input, a, select, textarea, .ep-switch, [data-no-sel]",
      )
    )
      return;
    // >>> a modifier is held (range / toggle) - stop the browser also
    // selecting text from the shift-click / drag
    if (e.shiftKey || e.ctrlKey || e.metaKey || e.altKey) {
      e.preventDefault();
      window.getSelection()?.removeAllRanges();
    }
    downKey = key;
    downX = e.clientX;
    downY = e.clientY;
    dragging = false;
    window.addEventListener("pointermove", onMove, { passive: true });
    window.addEventListener("pointerup", onUp);
    window.addEventListener("dragstart", onNativeDrag, true);
  }

  // >>> bound with @click.capture on the row - returns true when it consumed the
  // click (the caller then stops it reaching the cell's open-editor handler)
  function onRowClickCapture(e: MouseEvent, key: string): void {
    if (consume(e, key)) {
      e.stopPropagation();
      e.preventDefault();
    }
  }
  function consume(e: MouseEvent, key: string): boolean {
    // >>> a click on a row control (switch, edit, kebab...) - leave selection alone
    if (
      !dragging &&
      (e.target as HTMLElement).closest(
        "button, input, a, select, textarea, .ep-switch, [data-no-sel]",
      )
    )
      return false;
    if (dragging) {
      dragging = false;
      return true;
    }
    if (e.shiftKey && anchor.value) {
      selected.value = new Set(rangeKeys(anchor.value, key));
      window.getSelection()?.removeAllRanges();
      return true;
    }
    if (e.ctrlKey || e.metaKey || e.altKey) {
      const s = new Set(selected.value);
      s.has(key) ? s.delete(key) : s.add(key);
      selected.value = s;
      anchor.value = key;
      window.getSelection()?.removeAllRanges();
      return true;
    }
    // >>> plain click: drop the selection, let the editor open
    if (selected.value.size) selected.value = new Set();
    anchor.value = key;
    return false;
  }

  function clear() {
    selected.value = new Set();
    anchor.value = null;
  }
  function isSelected(k: string): boolean {
    return selected.value.has(k);
  }
  const count = computed(() => selected.value.size);
  const selectedItems = computed(() =>
    orderedItems().filter((t) => selected.value.has(keyOf(t))),
  );

  function onKey(e: KeyboardEvent) {
    if (opts.isActive && !opts.isActive()) return;
    if (e.key === "Escape" && selected.value.size) {
      clear();
      return;
    }
    const ae = document.activeElement as HTMLElement | null;
    if (
      ae &&
      (/^(INPUT|TEXTAREA|SELECT)$/.test(ae.tagName) || ae.isContentEditable)
    )
      return;
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "a") {
      const all = new Set(orderedItems().map(keyOf));
      if (all.size) {
        e.preventDefault();
        selected.value = all;
        anchor.value = null;
        window.getSelection()?.removeAllRanges();
      }
      return;
    }
    if (e.key === "Delete" && selected.value.size && opts.onDelete) {
      e.preventDefault();
      opts.onDelete(
        orderedItems().filter((t) => selected.value.has(keyOf(t))),
      );
    }
  }
  // >>> click anywhere that isn't a row / the row menu / a dialog -> deselect
  function onDocDown(e: MouseEvent) {
    if (!selected.value.size) return;
    const el = e.target as HTMLElement | null;
    if (
      el?.closest(
        "[data-sel-key], .ep-ctx-menu, .cd-overlay, .col-menu-panel, .ep-sync-panel, .ep-panel",
      )
    )
      return;
    clear();
  }
  function bind() {
    window.addEventListener("keydown", onKey);
    window.addEventListener("pointerdown", onDocDown, true);
  }
  function unbind() {
    window.removeEventListener("keydown", onKey);
    window.removeEventListener("pointerdown", onDocDown, true);
  }
  onMounted(bind);
  onUnmounted(() => {
    unbind();
    onUp();
  });
  onActivated(bind);
  onDeactivated(() => {
    unbind();
    clear();
  });

  return {
    selected,
    count,
    isSelected,
    selectedItems,
    anchor,
    clear,
    onRowPointerDown,
    onRowClickCapture,
  };
}
