<script setup lang="ts">
// >>> desktop: positioned right-click menu for a table row/selection. on
// mobile this same menu (single-row swatch picker, and the multi-select
// "actions" sheet from SelectionActionBar) renders as a bottom sheet instead
// - see the @media block in the style below.
import { ref, watch, nextTick, onBeforeUnmount } from "vue";
import { iconSvg as iconSvgFor } from "../../composables/icons";

export interface ContextMenuItem {
  key: string;
  label: string;
  icon?: string;
  danger?: boolean;
  onClick: () => void;
}
export interface ContextMenuCooldown {
  key: string;
  label: string;
  // >>> null = mixed values across a multi-selection -> shows an empty "–" field
  value: number | null;
  // >>> fired on Enter or blur, only when the value actually changed
  onSave: (v: number) => void;
}
export interface ContextMenuSwatch {
  label: string;
  current: string;
  // >>> colors already in use elsewhere, offered as quick picks
  used: string[];
  onPick: (hex: string) => void;
}
export interface ContextMenuAccess {
  label: string;
  levels: { key: string; label: string; icon?: string }[];
  // >>> null = mixed across a multi-selection
  current: string | null;
  onPick: (key: string) => void;
}

const props = defineProps<{
  open: boolean;
  x: number;
  y: number;
  items: ContextMenuItem[];
  cooldowns?: ContextMenuCooldown[];
  swatch?: ContextMenuSwatch;
  access?: ContextMenuAccess;
  // >>> shown as a small header when acting on a multi-selection
  title?: string;
}>();
const emit = defineEmits<{ close: [] }>();

const menuEl = ref<HTMLElement | null>(null);
const pos = ref({ left: 0, top: 0 });
// >>> local editable copies so typing doesn't fight the reactive source
const cdDraft = ref<Record<string, string>>({});

function close() {
  // >>> flush any pending cooldown edits before the menu unmounts (a click
  // outside would otherwise close it before the input's @blur fires)
  (props.cooldowns ?? []).forEach(commitCd);
  emit("close");
}

function commitCd(cd: ContextMenuCooldown) {
  const raw = (cdDraft.value[cd.key] ?? "").trim();
  if (raw === "") {
    // >>> empty on a mixed field -> leave it, nothing to apply
    if (cd.value != null) cdDraft.value[cd.key] = String(cd.value);
    return;
  }
  const n = Math.max(0, Math.round(Number(raw)));
  if (!Number.isFinite(n)) return;
  if (n !== (cd.value ?? NaN)) cd.onSave(n);
  cdDraft.value[cd.key] = String(n);
}

function onItem(it: ContextMenuItem) {
  it.onClick();
  close();
}

// >>> the "new colour" chip stays visually empty until it's used; the picked
// colour shows behind the + until the menu closes (or another row is opened)
const newHex = ref("");
function pickColor(hex: string) {
  props.swatch?.onPick(hex);
  close();
}
// >>> native colour input - apply live, keep the menu open, tint the + chip
function onNewColor(hex: string) {
  newHex.value = hex;
  props.swatch?.onPick(hex);
}
function pickAccess(key: string) {
  props.access?.onPick(key);
  close();
}

function onDocMouseDown(e: MouseEvent) {
  if (menuEl.value && !menuEl.value.contains(e.target as Node)) close();
}
function onKey(e: KeyboardEvent) {
  if (e.key === "Escape") close();
}

watch(
  () => props.open,
  (o) => {
    if (o) {
      newHex.value = "";
      cdDraft.value = Object.fromEntries(
        (props.cooldowns ?? []).map((c) => [
          c.key,
          c.value == null ? "" : String(c.value),
        ]),
      );
      nextTick(() => {
        // >>> keep the menu on screen
        const el = menuEl.value;
        const w = el?.offsetWidth ?? 190;
        const h = el?.offsetHeight ?? 200;
        pos.value = {
          left: Math.min(props.x, window.innerWidth - w - 8),
          top: Math.min(props.y, window.innerHeight - h - 8),
        };
      });
      document.addEventListener("mousedown", onDocMouseDown, true);
      document.addEventListener("keydown", onKey, true);
      window.addEventListener("resize", close);
      window.addEventListener("scroll", close, true);
    } else {
      document.removeEventListener("mousedown", onDocMouseDown, true);
      document.removeEventListener("keydown", onKey, true);
      window.removeEventListener("resize", close);
      window.removeEventListener("scroll", close, true);
    }
  },
);

onBeforeUnmount(() => {
  document.removeEventListener("mousedown", onDocMouseDown, true);
  document.removeEventListener("keydown", onKey, true);
  window.removeEventListener("resize", close);
  window.removeEventListener("scroll", close, true);
});
</script>

<template>
  <Teleport to="body">
    <div v-if="open" ref="menuEl" class="ep-ctx-menu" :style="{ left: pos.left + 'px', top: pos.top + 'px' }">
      <div v-if="title" class="ep-ctx-title">{{ title }}</div>
      <button v-for="it in items" :key="it.key" type="button" class="ep-ctx-item" :class="{ danger: it.danger }"
        @click="onItem(it)">
        <span v-if="it.icon" class="ep-ctx-icon" v-html="iconSvgFor(it.icon)"></span>
        {{ it.label }}
      </button>
      <div v-for="cd in cooldowns ?? []" :key="cd.key" class="ep-ctx-cd">
        <label>{{ cd.label }}</label>
        <input type="number" min="0" placeholder="–" v-model="cdDraft[cd.key]"
          @keydown.enter.prevent="commitCd(cd)" @blur="commitCd(cd)" @click.stop />
        <span class="ep-ctx-cd-unit">s</span>
      </div>
      <div v-if="access" class="ep-ctx-access" @click.stop>
        <label>{{ access.label }}</label>
        <div class="ep-ctx-seg">
          <button v-for="lv in access.levels" :key="lv.key" type="button" :title="lv.label"
            :class="{ on: lv.key === access.current }" @click="pickAccess(lv.key)">
            <span v-if="lv.icon" v-html="lv.icon"></span>
            <template v-else>{{ lv.label }}</template>
          </button>
        </div>
      </div>
      <div v-if="swatch" class="ep-ctx-swatch" @click.stop>
        <label>{{ swatch.label }}</label>
        <div class="ep-ctx-swatch-row">
          <button v-for="c in swatch.used" :key="c" type="button" class="ep-ctx-sw"
            :class="{ on: c.toLowerCase() === swatch.current.toLowerCase() }" :style="{ background: c }"
            @click="pickColor(c)"></button>
          <label class="ep-ctx-sw ep-ctx-sw-new" title="New colour"
            :class="{ picked: !!newHex }" :style="newHex ? { background: newHex } : undefined">
            <span class="ep-ctx-sw-plus">+</span>
            <input type="color" :value="newHex || '#6f2bff'"
              @input="newHex = ($event.target as HTMLInputElement).value"
              @change="onNewColor(($event.target as HTMLInputElement).value)" @click.stop />
          </label>
        </div>
      </div>
    </div>
  </Teleport>
</template>

<style scoped>
.ep-ctx-menu {
  position: fixed;
  min-width: 190px;
  background: #1a1a1e;
  border: 1px solid #2a2a30;
  z-index: 200;
  box-shadow: 0 8px 32px rgba(0, 0, 0, 0.6);
  /* >>> dark form controls (number spinners, the native colour picker) */
  color-scheme: dark;
}

.ep-ctx-title {
  padding: 8px 12px;
  border-bottom: 1px solid #232328;
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: #9d6cff;
}

.ep-ctx-item {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  padding: 9px 12px;
  border: none;
  border-bottom: 1px solid #232328;
  background: transparent;
  color: #ccc;
  font-family: inherit;
  font-size: 12px;
  text-align: left;
  cursor: pointer;
}

.ep-ctx-item:hover {
  background: #6f2bff18;
  color: #e0e0e0;
}

.ep-ctx-item.danger {
  color: #f14949;
}

.ep-ctx-item.danger:hover {
  background: rgba(241, 73, 73, 0.1);
}

.ep-ctx-icon {
  display: inline-flex;
  flex-shrink: 0;
}

.ep-ctx-cd {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 12px;
  border-bottom: 1px solid #232328;
  font-size: 12px;
  color: #999;
}

.ep-ctx-cd:last-child {
  border-bottom: none;
}

.ep-ctx-cd label {
  flex: 1;
}

.ep-ctx-cd input {
  width: 56px;
  height: 26px;
  padding: 2px 6px;
  background: #101014;
  border: 1px solid #2a2a30;
  color: #e0e0e0;
  font-family: inherit;
  font-size: 12px;
}

.ep-ctx-cd-unit {
  color: #555;
}

.ep-ctx-access {
  padding: 8px 12px;
  font-size: 12px;
  color: #999;
}
.ep-ctx-access label {
  display: block;
  margin-bottom: 6px;
}
.ep-ctx-seg {
  display: flex;
  border: 1px solid #2a2a30;
}
.ep-ctx-seg button {
  flex: 1;
  height: 28px;
  border: none;
  background: #0d0d10;
  color: #777;
  font-family: inherit;
  font-size: 11px;
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  justify-content: center;
}
.ep-ctx-seg button :deep(svg) {
  width: 14px;
  height: 14px;
}
.ep-ctx-seg button + button {
  border-left: 1px solid #2a2a30;
}
.ep-ctx-seg button.on {
  background: rgba(111, 43, 255, 0.18);
  color: #c4a0ff;
}

.ep-ctx-swatch {
  padding: 8px 12px;
  font-size: 12px;
  color: #999;
}
.ep-ctx-swatch label {
  display: block;
  margin-bottom: 6px;
}
.ep-ctx-swatch-row {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}
.ep-ctx-sw {
  width: 18px;
  height: 18px;
  border: 1px solid #2a2a30;
  padding: 0;
  cursor: pointer;
}
.ep-ctx-sw.on {
  outline: 2px solid #fff;
  outline-offset: -1px;
}
.ep-ctx-sw-new {
  position: relative;
  overflow: hidden;
  border: 1px solid #3a3a42;
  background: #0d0d10;
}
.ep-ctx-sw-plus {
  display: grid;
  place-content: center;
  width: 100%;
  height: 100%;
  color: #888;
  font-size: 12px;
  line-height: 1;
}
.ep-ctx-sw-new.picked .ep-ctx-sw-plus {
  color: rgba(255, 255, 255, 0.85);
  mix-blend-mode: difference;
}
.ep-ctx-sw-new input {
  position: absolute;
  inset: 0;
  opacity: 0;
  cursor: pointer;
  /* >>> the native picker's own swatch never paints, only our chip does */
  color-scheme: dark;
}

@media (max-width: 680px) {
  /* >>> bottom sheet instead of a positioned popup - fixed at the pointer
     coordinates would either sit under a thumb or clip off a small screen */
  .ep-ctx-menu {
    left: 0 !important;
    right: 0;
    top: auto !important;
    bottom: 0;
    width: 100%;
    max-height: 70vh;
    overflow-y: auto;
    border-left: none;
    border-right: none;
    border-bottom: none;
    padding-bottom: env(safe-area-inset-bottom, 0px);
  }
  .ep-ctx-item {
    padding: 14px 16px;
    font-size: 14px;
  }
  .ep-ctx-cd,
  .ep-ctx-access,
  .ep-ctx-swatch {
    padding: 12px 16px;
  }
  .ep-ctx-cd input {
    width: 64px;
    height: 34px;
    font-size: 14px;
  }
  .ep-ctx-seg button {
    height: 38px;
  }
  .ep-ctx-sw,
  .ep-ctx-sw-new {
    width: 26px;
    height: 26px;
  }
}
</style>
