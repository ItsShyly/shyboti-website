import { ref, computed } from "vue";

export interface ColumnDef {
  key: string;
  label: string;
  // >>> px for a fixed column, fr-weight for a flex column
  width: number;
  minWidth?: number;
  // >>> shares leftover row width proportionally instead of a fixed px, so text
  // columns scale with the viewport and don't over/underflow on other monitors
  flex?: boolean;
  // >>> a short click on the header toggles sort on this column (asc -> desc -> off)
  sortable?: boolean;
}

// >>> shared engine behind every resizable/draggable table header - header
// drives width+order, rows read the same state, so a row's cell can never
// drift out of sync with its own column
export function useResizableColumns(tableId: string, defaults: ColumnDef[]) {
  // >>> v3: flex-column widths are fr-weights now + column sets were reshuffled;
  // any older saved layout is incompatible
  const storageKey = `ep-table-cols-${tableId}-v3`;

  function load(): ColumnDef[] {
    const fresh = () => defaults.map((c) => ({ ...c }));
    try {
      const raw = localStorage.getItem(storageKey);
      if (!raw) return fresh();
      const saved = JSON.parse(raw) as { key: string; width: number }[];
      // >>> column set changed in code - saved order/widths are stale, reset
      const savedKeys = new Set(saved.map((s) => s.key));
      if (
        savedKeys.size !== defaults.length ||
        defaults.some((d) => !savedKeys.has(d.key))
      )
        return fresh();
      const byKey = new Map(defaults.map((c) => [c.key, c]));
      const restored = saved
        .map((s) => {
          const def = byKey.get(s.key);
          return def ? { ...def, width: s.width } : null;
        })
        .filter((c): c is ColumnDef => c !== null);
      return restored.length === defaults.length ? restored : fresh();
    } catch {
      return fresh();
    }
  }

  const columns = ref<ColumnDef[]>(load());

  // vvv sort state - persisted separately from the column layout vvv
  const sortStorageKey = `ep-table-sort-${tableId}-v1`;
  function loadSort(): { key: string | null; dir: "asc" | "desc" } {
    try {
      const s = JSON.parse(localStorage.getItem(sortStorageKey) || "null");
      if (s && defaults.some((d) => d.key === s.key && d.sortable))
        return { key: s.key, dir: s.dir === "desc" ? "desc" : "asc" };
    } catch { }
    return { key: null, dir: "asc" };
  }
  const _s = loadSort();
  const sortKey = ref<string | null>(_s.key);
  const sortDir = ref<"asc" | "desc">(_s.dir);
  function persistSort() {
    try {
      localStorage.setItem(
        sortStorageKey,
        JSON.stringify({ key: sortKey.value, dir: sortDir.value }),
      );
    } catch { }
  }
  function toggleSort(key: string) {
    if (!columns.value.find((c) => c.key === key)?.sortable) return;
    if (sortKey.value !== key) {
      sortKey.value = key;
      sortDir.value = "asc";
    } else if (sortDir.value === "asc") {
      sortDir.value = "desc";
    } else {
      sortKey.value = null;
      sortDir.value = "asc";
    }
    persistSort();
  }
  // >>> stable sort: nullish values sink, numbers compare numerically, strings
  // use a natural (numeric-aware) locale compare
  function applySort<T>(rows: readonly T[], get: (row: T, key: string) => unknown): T[] {
    const arr = rows.slice();
    const k = sortKey.value;
    if (!k) return arr;
    const dir = sortDir.value === "asc" ? 1 : -1;
    return arr.sort((a, b) => {
      const av = get(a, k) as string | number | null | undefined;
      const bv = get(b, k) as string | number | null | undefined;
      if (av == null && bv == null) return 0;
      if (av == null) return 1;
      if (bv == null) return -1;
      if (typeof av === "number" && typeof bv === "number") return (av - bv) * dir;
      return (
        String(av).localeCompare(String(bv), undefined, {
          numeric: true,
          sensitivity: "base",
        }) * dir
      );
    });
  }
  // ^^^ sort state ^^^

  function persist() {
    try {
      localStorage.setItem(
        storageKey,
        JSON.stringify(columns.value.map((c) => ({ key: c.key, width: c.width }))),
      );
    } catch { }
  }

  // >>> per-column px while a drag is in progress, [] otherwise. during a drag
  // every track is a hard px so the boundary tracks the cursor 1:1 instead of
  // fr-redistributing under it (that felt laggy/rubber-bandy)
  const livePx = ref<number[]>([]);

  // >>> flex columns split the leftover width by fr-weight (minWidth floor still
  // applies); fixed columns stay px. no flex column set -> old behavior, last
  // column absorbs the slack
  const gridTemplateColumns = computed(() => {
    const cols = columns.value;
    if (livePx.value.length === cols.length) {
      return livePx.value.map((w) => `${w}px`).join(" ");
    }
    const anyFlex = cols.some((c) => c.flex);
    return cols
      .map((c, i) => {
        const min = c.minWidth ?? 60;
        if (c.flex) return `minmax(${min}px, ${Math.max(c.width, 1)}fr)`;
        if (!anyFlex && i === cols.length - 1)
          return `minmax(${c.width}px, 1fr)`;
        return `${c.width}px`;
      })
      .join(" ");
  });

  // >>> current display position of a column, by its stable key - drives
  // the CSS `order` on that column's header cell AND every row's matching
  // cell, so dragging the header reorders every row's cells at once
  function orderOf(key: string): number {
    const i = columns.value.findIndex((c) => c.key === key);
    return i === -1 ? 999 : i;
  }

  // vvv column hover - hovering a header cell highlights that column in
  // every row, not just the header cell itself vvv
  const hoveredKey = ref<string | null>(null);
  function setHover(key: string) {
    hoveredKey.value = key;
  }
  function clearHover() {
    hoveredKey.value = null;
  }
  // >>> merges the order (position) with a hover highlight - use this on
  // every row cell instead of a bare `{ order: orderOf(key) }` so the
  // whole column lights up together when its header is hovered
  function cellStyle(key: string): { order: number; background?: string } {
    return {
      order: orderOf(key),
      background: hoveredKey.value === key ? "rgba(111, 43, 255, 0.08)" : undefined,
    };
  }
  // ^^^ column hover ^^^

  // vvv drag-resize (mousedown on the handle at a header cell's right edge) vvv
  // >>> the dragged column trades width with its right-hand neighbour, in raw px,
  // so the total row width never changes and the cursor tracks 1:1. on mouseup
  // the pixel widths get baked back into the model (flex cols keep their px value
  // as an fr-weight - only the ratio matters). moves are rAF-coalesced so a fast
  // drag can't outrun the frame rate.
  const resizingIndex = ref<number | null>(null);
  let resizeStartX = 0;
  let resizeStartPx: number[] = [];
  let resizeClientX = 0;
  let resizeRaf = 0;

  function startResize(index: number, e: MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    if (index >= columns.value.length - 1) return; // <<< no neighbour to trade with
    const headerEl = (e.target as HTMLElement).closest(
      ".ep-row-header",
    ) as HTMLElement | null;
    const cells = headerEl
      ? (Array.from(
          headerEl.querySelectorAll(".ep-row-header-cell"),
        ) as HTMLElement[])
      : [];
    const measured = columns.value.map(
      (c, i) => cells[i]?.getBoundingClientRect().width ?? c.width,
    );
    if (measured.length !== columns.value.length || measured.some((w) => w < 1))
      return; // <<< couldn't measure, don't start a broken drag
    resizeStartX = e.clientX;
    resizeClientX = e.clientX;
    resizeStartPx = measured;
    livePx.value = measured.slice();
    resizingIndex.value = index;
    window.addEventListener("mousemove", onResizeMove);
    window.addEventListener("mouseup", stopResize);
  }
  function applyResize() {
    const i = resizingIndex.value;
    if (i == null) return;
    const minA = columns.value[i]?.minWidth ?? 60;
    const minB = columns.value[i + 1]?.minWidth ?? 60;
    const pair = resizeStartPx[i]! + resizeStartPx[i + 1]!;
    let a = Math.round(resizeStartPx[i]! + (resizeClientX - resizeStartX));
    a = Math.max(minA, Math.min(a, pair - minB));
    const next = resizeStartPx.slice();
    next[i] = a;
    next[i + 1] = pair - a;
    livePx.value = next;
  }
  function onResizeMove(e: MouseEvent) {
    resizeClientX = e.clientX;
    if (resizeRaf) return;
    resizeRaf = requestAnimationFrame(() => {
      resizeRaf = 0;
      applyResize();
    });
  }
  function stopResize() {
    if (resizeRaf) {
      cancelAnimationFrame(resizeRaf);
      resizeRaf = 0;
    }
    window.removeEventListener("mousemove", onResizeMove);
    window.removeEventListener("mouseup", stopResize);
    if (livePx.value.length === columns.value.length) {
      const px = livePx.value;
      columns.value.forEach((c, i) => {
        c.width = px[i]!;
      });
    }
    livePx.value = [];
    resizingIndex.value = null;
    persist();
  }
  // ^^^ drag-resize ^^^

  // vvv drag-reorder (native HTML5 drag on the header cell itself) vvv
  const draggingIndex = ref<number | null>(null);
  const dragOverIndex = ref<number | null>(null);

  // >>> tell a real reorder-drag apart from a plain click - a short click (barely
  // moved, released quickly, no drag fired) on a sortable header toggles its sort
  let hdrDownX = 0;
  let hdrDownY = 0;
  let hdrDownT = 0;
  let hdrDidDrag = false;
  function onHeaderPointerDown(e: MouseEvent) {
    hdrDownX = e.clientX;
    hdrDownY = e.clientY;
    hdrDownT = Date.now();
    hdrDidDrag = false;
  }
  function onHeaderClick(index: number, e: MouseEvent) {
    if (hdrDidDrag || draggingIndex.value !== null || resizingIndex.value !== null)
      return;
    if (
      Math.abs(e.clientX - hdrDownX) > 5 ||
      Math.abs(e.clientY - hdrDownY) > 5 ||
      Date.now() - hdrDownT > 500
    )
      return;
    const key = columns.value[index]?.key;
    if (key) toggleSort(key);
  }

  function onDragStart(index: number) {
    hdrDidDrag = true;
    draggingIndex.value = index;
  }
  function onDragEnterCell(index: number) {
    if (draggingIndex.value == null) return;
    dragOverIndex.value = index;
  }
  function onDrop(index: number) {
    if (draggingIndex.value == null || draggingIndex.value === index) {
      draggingIndex.value = null;
      dragOverIndex.value = null;
      return;
    }
    const [moved] = columns.value.splice(draggingIndex.value, 1);
    columns.value.splice(index, 0, moved!);
    draggingIndex.value = null;
    dragOverIndex.value = null;
    persist();
  }
  function onDragEnd() {
    draggingIndex.value = null;
    dragOverIndex.value = null;
  }
  // ^^^ drag-reorder ^^^

  function resetColumns() {
    columns.value = defaults.map((c) => ({ ...c }));
    try {
      localStorage.removeItem(storageKey);
    } catch { }
  }

  return {
    columns,
    gridTemplateColumns,
    orderOf,
    hoveredKey,
    setHover,
    clearHover,
    cellStyle,
    resizingIndex,
    startResize,
    draggingIndex,
    dragOverIndex,
    onDragStart,
    onDragEnterCell,
    onDrop,
    onDragEnd,
    resetColumns,
    sortKey,
    sortDir,
    toggleSort,
    applySort,
    onHeaderPointerDown,
    onHeaderClick,
  };
}
