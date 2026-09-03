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
  // >>> false = can't be hidden (identity column, the blank switch column)
  hideable?: boolean;
}

// >>> shared engine behind every resizable/draggable table header - header
// drives width+order+visibility, rows read the same state, so a row's cell can
// never drift out of sync with its own column
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

  // vvv hidden columns - persisted separately from the layout vvv
  const hiddenStorageKey = `ep-table-cols-hidden-${tableId}-v1`;
  function loadHidden(): Set<string> {
    try {
      const raw = JSON.parse(localStorage.getItem(hiddenStorageKey) || "[]");
      if (!Array.isArray(raw)) return new Set();
      const valid = new Set(
        defaults.filter((d) => d.hideable !== false).map((d) => d.key),
      );
      return new Set((raw as string[]).filter((k) => valid.has(k)));
    } catch {
      return new Set();
    }
  }
  const hidden = ref<Set<string>>(loadHidden());
  function persistHidden() {
    try {
      localStorage.setItem(hiddenStorageKey, JSON.stringify([...hidden.value]));
    } catch { }
  }
  function isHideable(key: string): boolean {
    return columns.value.find((c) => c.key === key)?.hideable !== false;
  }
  function setColumnHidden(key: string, hide: boolean) {
    if (hide && !isHideable(key)) return;
    const next = new Set(hidden.value);
    if (hide) next.add(key);
    else next.delete(key);
    hidden.value = next;
    persistHidden();
  }
  function resetHidden() {
    hidden.value = new Set();
    persistHidden();
  }
  // >>> the columns actually rendered - header loops this, grid tracks this
  const visibleColumns = computed(() =>
    columns.value.filter((c) => !hidden.value.has(c.key)),
  );
  // ^^^ hidden columns ^^^

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

  // >>> per-visible-column px while a drag is in progress, [] otherwise. during a
  // drag every track is a hard px so the boundary tracks the cursor 1:1 instead
  // of fr-redistributing under it (that felt laggy/rubber-bandy)
  const livePx = ref<number[]>([]);

  // >>> flex columns split the leftover width by fr-weight (minWidth floor still
  // applies); fixed columns stay px. no flex column set -> old behavior, last
  // column absorbs the slack. built from VISIBLE columns only.
  const gridTemplateColumns = computed(() => {
    const cols = visibleColumns.value;
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

  // >>> display position of a column among the VISIBLE ones, by its stable key -
  // drives the CSS `order` on that column's header cell AND every row's matching
  // cell. hidden columns get 999 (their cell is display:none anyway).
  function orderOf(key: string): number {
    const i = visibleColumns.value.findIndex((c) => c.key === key);
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
  // >>> merges the order (position), a hover highlight, and hidden-ness - use
  // this on every row cell instead of a bare `{ order: orderOf(key) }` so the
  // whole column lights up together, and hiding a column just drops its cells
  function cellStyle(key: string): {
    order: number;
    background?: string;
    display?: string;
  } {
    return {
      order: orderOf(key),
      background: hoveredKey.value === key ? "rgba(111, 43, 255, 0.08)" : undefined,
      display: hidden.value.has(key) ? "none" : undefined,
    };
  }
  // ^^^ column hover ^^^

  // >>> visible-index -> full-columns-array index
  function realIndex(visIdx: number): number {
    const col = visibleColumns.value[visIdx];
    return col ? columns.value.indexOf(col) : -1;
  }

  // vvv drag-resize (mousedown on the handle at a header cell's right edge) vvv
  // >>> the dragged column trades width with its right-hand VISIBLE neighbour, in
  // raw px, so the total row width never changes and the cursor tracks 1:1. on
  // mouseup the pixel widths get baked back into the model (flex cols keep their
  // px value as an fr-weight - only the ratio matters). moves are rAF-coalesced.
  const resizingIndex = ref<number | null>(null);
  let resizeStartX = 0;
  let resizeStartPx: number[] = [];
  let resizeClientX = 0;
  let resizeRaf = 0;

  function startResize(index: number, e: MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    if (index >= visibleColumns.value.length - 1) return; // <<< no neighbour to trade with
    const headerEl = (e.target as HTMLElement).closest(
      ".ep-row-header",
    ) as HTMLElement | null;
    const cells = headerEl
      ? (Array.from(
          headerEl.querySelectorAll(".ep-row-header-cell"),
        ) as HTMLElement[])
      : [];
    const measured = visibleColumns.value.map(
      (c, i) => cells[i]?.getBoundingClientRect().width ?? c.width,
    );
    if (
      measured.length !== visibleColumns.value.length ||
      measured.some((w) => w < 1)
    )
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
    const vis = visibleColumns.value;
    const minA = vis[i]?.minWidth ?? 60;
    const minB = vis[i + 1]?.minWidth ?? 60;
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
    if (livePx.value.length === visibleColumns.value.length) {
      const px = livePx.value;
      visibleColumns.value.forEach((c, i) => {
        c.width = px[i]!;
      });
    }
    livePx.value = [];
    resizingIndex.value = null;
    persist();
  }
  // ^^^ drag-resize ^^^

  // vvv drag-reorder (native HTML5 drag on the header cell itself) vvv
  // >>> draggingIndex / dragOverIndex are VISIBLE indices (template matches them
  // against the header loop index); translated to the full array only on drop
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
    const key = visibleColumns.value[index]?.key;
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
    const visFrom = draggingIndex.value;
    if (visFrom == null || visFrom === index) {
      draggingIndex.value = null;
      dragOverIndex.value = null;
      return;
    }
    const vis = visibleColumns.value;
    const movedCol = vis[visFrom];
    const targetCol = vis[index];
    if (movedCol && targetCol) {
      const arr = columns.value;
      arr.splice(arr.indexOf(movedCol), 1);
      const anchor = arr.indexOf(targetCol);
      arr.splice(index > visFrom ? anchor + 1 : anchor, 0, movedCol);
      persist();
    }
    draggingIndex.value = null;
    dragOverIndex.value = null;
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
    resetHidden();
  }

  return {
    columns,
    visibleColumns,
    hidden,
    setColumnHidden,
    resetHidden,
    isHideable,
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
