<script setup lang="ts">
// >>> header menu: a show/hide checklist for the table's columns, plus an
// optional slot below a divider (used for the sync/import entries)
import { ref, onBeforeUnmount } from "vue";
import { iconSvg as iconSvgFor } from "../../composables/icons";
import { useI18n } from "../../i18n";

interface Col {
  key: string;
  label: string;
  hideable?: boolean;
}
const props = defineProps<{
  columns: Col[];
  hidden: Set<string>;
  // >>> a slot is provided (sync/import) -> show it below the divider
  hasExtra?: boolean;
  extraLabel?: string;
}>();
const emit = defineEmits<{
  (e: "set", key: string, hide: boolean): void;
  (e: "show-all"): void;
}>();

const { t } = useI18n();
const open = ref(false);

function toggle() {
  open.value = !open.value;
  if (open.value) {
    setTimeout(() => {
      window.addEventListener("mousedown", onOutside);
      window.addEventListener("keydown", onEsc);
    });
  } else stop();
}
function stop() {
  window.removeEventListener("mousedown", onOutside);
  window.removeEventListener("keydown", onEsc);
}
const rootEl = ref<HTMLElement | null>(null);
function onOutside(e: MouseEvent) {
  if (rootEl.value && !rootEl.value.contains(e.target as Node)) close();
}
function onEsc(e: KeyboardEvent) {
  if (e.key === "Escape") close();
}
function close() {
  open.value = false;
  stop();
}
onBeforeUnmount(stop);

function onCheck(c: Col) {
  if (c.hideable === false) return;
  // >>> checkbox flipped: new hidden state is the opposite of the current one
  emit("set", c.key, !props.hidden.has(c.key));
}
// >>> wipe every table's saved widths / order / sort / hidden set (this
// browser only) and reload
function resetTables() {
  try {
    for (const k of Object.keys(localStorage))
      if (k.startsWith("ep-table-cols-") || k.startsWith("ep-table-sort-"))
        localStorage.removeItem(k);
  } catch { }
  window.location.reload();
}
</script>

<template>
  <div ref="rootEl" class="col-menu" :class="{ 'no-extra': !hasExtra }">
    <button type="button" class="col-menu-trigger" :class="{ open }" @click="toggle"
      :title="hasExtra ? t('cols.menu') : t('cols.columns')">
      <span v-html="iconSvgFor('sliders')"></span>
      <span v-if="!hasExtra" class="col-menu-label">{{ t('cols.columns') }}</span>
    </button>
    <div v-if="open" class="col-menu-panel" @click.stop>
      <!-- >>> column show/hide is meaningless on the phone card layout -->
      <div class="col-menu-columns-only">
        <div class="col-menu-section">{{ t('cols.columns') }}</div>
        <label v-for="c in columns" :key="c.key" class="col-menu-row" :class="{ locked: c.hideable === false }">
          <input type="checkbox" :checked="!hidden.has(c.key)" :disabled="c.hideable === false" @change="onCheck(c)" />
          <span>{{ c.label }}</span>
        </label>
        <button type="button" class="col-menu-showall" @click="emit('show-all'); close()">
          {{ t('cols.show_all') }}
        </button>
        <button type="button" class="col-menu-showall col-menu-reset" @click="resetTables">
          {{ t('cols.reset') }} <span class="col-menu-local">· {{ t('cols.local_only') }}</span>
        </button>
      </div>

      <div v-if="hasExtra" class="col-menu-extra">
        <div class="col-menu-divider">{{ extraLabel ?? t('cols.import') }}</div>
        <div @click="close()">
          <slot />
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.col-menu {
  position: relative;
  display: inline-flex;
}
@media (max-width: 680px) {
  /* >>> column show/hide doesn't apply to the mobile card layout - the
     trigger disappears entirely unless it also carries Import/sync */
  .col-menu.no-extra {
    display: none;
  }
  .col-menu-columns-only {
    display: none;
  }
}
.col-menu-trigger {
  height: 32px;
  padding: 0 10px;
  border: 1px solid #2a2a30;
  background: transparent;
  color: #888;
  font-family: inherit;
  font-size: 12px;
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  gap: 6px;
}
.col-menu-trigger:hover,
.col-menu-trigger.open {
  color: #9d6cff;
  border-color: #6f2bff44;
}
.col-menu-trigger :deep(svg) {
  width: 14px;
  height: 14px;
}
.col-menu-panel {
  position: absolute;
  top: calc(100% + 6px);
  right: 0;
  min-width: 210px;
  background: #1a1a1e;
  border: 1px solid #2a2a30;
  padding: 6px;
  z-index: 60;
  box-shadow: 0 8px 32px rgba(0, 0, 0, 0.6);
  display: flex;
  flex-direction: column;
}
.col-menu-section,
.col-menu-divider {
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: #555;
  padding: 8px 8px 4px;
}
.col-menu-row {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 8px;
  font-size: 12px;
  color: #ccc;
  cursor: pointer;
}
.col-menu-row:hover {
  background: #6f2bff18;
}
.col-menu-row.locked {
  color: #666;
  cursor: default;
}
/* >>> fully custom square checkbox, no radius */
.col-menu-row input[type="checkbox"] {
  appearance: none;
  -webkit-appearance: none;
  margin: 0;
  width: 15px;
  height: 15px;
  flex-shrink: 0;
  border: 1px solid #3a3a42;
  background: #0d0d10;
  cursor: pointer;
  display: grid;
  place-content: center;
}
.col-menu-row input[type="checkbox"]:checked {
  background: #6f2bff;
  border-color: #6f2bff;
}
.col-menu-row input[type="checkbox"]:checked::after {
  content: "";
  width: 4px;
  height: 8px;
  border: solid #fff;
  border-width: 0 2px 2px 0;
  transform: translateY(-1px) rotate(45deg);
}
.col-menu-row input[type="checkbox"]:disabled {
  opacity: 0.4;
  cursor: default;
}
.col-menu-showall {
  margin-top: 2px;
  border: none;
  background: transparent;
  color: #9d6cff;
  font-family: inherit;
  font-size: 11px;
  text-align: left;
  padding: 8px;
  cursor: pointer;
}
.col-menu-showall:hover {
  background: #6f2bff18;
}
.col-menu-reset {
  color: #888;
  border-top: 1px solid #232328;
  margin-top: 4px;
}
.col-menu-reset:hover {
  color: #f14949;
  background: rgba(241, 73, 73, 0.08);
}
.col-menu-local {
  color: #555;
  font-size: 10px;
}
.col-menu-divider {
  margin-top: 4px;
  border-top: 1px solid #232328;
}
:slotted(.col-menu-item) {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  padding: 8px;
  border: none;
  background: transparent;
  color: #ccc;
  font-family: inherit;
  font-size: 12px;
  text-align: left;
  cursor: pointer;
}
:slotted(.col-menu-item:hover) {
  background: #6f2bff18;
}
:slotted(.ep-sync-dot) {
  flex-shrink: 0;
}
</style>
