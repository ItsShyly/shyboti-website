<script setup lang="ts">
import { ref, computed } from "vue";
import { iconSvg as iconSvgFor } from "../../composables/icons";
import type { OverlayElementType, ShapeVariant } from "../../composables/overlay/overlayTypes";
import { useI18n } from "../../i18n";

const { t } = useI18n();

const emit = defineEmits<{
  add: [type: OverlayElementType, variant?: ShapeVariant];
}>();

const entries = computed<{ type: OverlayElementType; variant?: ShapeVariant; label: string; icon: string }[]>(() => [
  { type: "text", label: t("overlay.gallery.text"), icon: "file-text" },
  { type: "variable-text", label: t("overlay.gallery.variable"), icon: "refresh-cw" },
  { type: "image", label: t("overlay.gallery.image"), icon: "image" },
  { type: "video", label: t("overlay.gallery.video"), icon: "film" },
  { type: "countdown", label: t("overlay.gallery.countdown"), icon: "clock" },
  { type: "countup", label: t("overlay.gallery.countup"), icon: "arrow-up" },
  { type: "shape", variant: "border", label: t("overlay.gallery.border"), icon: "maximize" },
  { type: "shape", variant: "background-box", label: t("overlay.gallery.background_box"), icon: "monitor" },
  { type: "shape", variant: "frame", label: t("overlay.gallery.frame"), icon: "maximize" },
]);

const helpOpen = ref(false);

// >>> no svg ids, duplicate ids break with repeated v-html injection
const MOUSE_PURPLE = "#9d6cff";
const MOUSE_GRAY = "#666";
function mouseIcon(button: "left" | "right" | "middle"): string {
  const leftFill = button === "left" ? MOUSE_PURPLE : "none";
  const rightFill = button === "right" ? MOUSE_PURPLE : "none";
  const wheelFill = button === "middle" ? MOUSE_PURPLE : MOUSE_GRAY;
  return `<svg viewBox="0 0 24 34" width="1em" height="1.4em" fill="none" stroke="${MOUSE_GRAY}" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">
    <rect x="5" y="3" width="6.5" height="9.5" fill="${leftFill}" stroke="none" />
    <rect x="12.5" y="3" width="6.5" height="9.5" fill="${rightFill}" stroke="none" />
    <rect x="4" y="2" width="16" height="30" rx="8" />
    <line x1="12" y1="3" x2="12" y2="13" />
    <line x1="4" y1="13" x2="20" y2="13" />
    <rect x="11" y="5" width="2" height="6" rx="1" fill="${wheelFill}" stroke="none" />
  </svg>`;
}
const MOUSE_LEFT = mouseIcon("left");
const MOUSE_RIGHT = mouseIcon("right");
const MOUSE_MIDDLE = mouseIcon("middle");

// >>> parts render as a keycap, icon, or plain text
interface KeyPart { k?: string; svg?: string; t?: string }
interface Shortcut { parts: KeyPart[]; desc: string }
const CTRL = computed(() => t("overlay.gallery.key_ctrl"));
const ALT = computed(() => t("overlay.gallery.key_alt"));
const shortcuts = computed<Shortcut[]>(() => [
  { parts: [{ k: CTRL.value }, { t: "+" }, { k: "S" }], desc: t("overlay.gallery.sc_save") },
  { parts: [{ k: CTRL.value }, { t: "+" }, { k: "Z" }], desc: t("overlay.gallery.sc_undo") },
  { parts: [{ k: CTRL.value }, { t: "+" }, { k: "Y" }], desc: t("overlay.gallery.sc_redo") },
  {
    parts: [{ k: CTRL.value }, { t: "+" }, { k: "C" }, { t: "/" }, { k: CTRL.value }, { t: "+" }, { k: "V" }],
    desc: t("overlay.gallery.sc_copy_paste"),
  },
  { parts: [{ k: CTRL.value }, { t: "+" }, { k: "D" }], desc: t("overlay.gallery.sc_duplicate") },
  { parts: [{ k: "Delete" }, { t: "/" }, { k: "Backspace" }], desc: t("overlay.gallery.sc_delete") },
  { parts: [{ k: "Escape" }], desc: t("overlay.gallery.sc_close") },
  {
    parts: [{ k: t("overlay.gallery.key_shift") }, { t: "+" }, { svg: MOUSE_LEFT }, { t: "/" }, { k: CTRL.value }, { t: "+" }, { svg: MOUSE_LEFT }],
    desc: t("overlay.gallery.sc_add_remove_selection"),
  },
  {
    parts: [{ svg: MOUSE_LEFT }, { t: t("overlay.gallery.sc_drag_in_canvas") }],
    desc: t("overlay.gallery.sc_multiselect"),
  },
  {
    parts: [{ svg: MOUSE_RIGHT }, { t: t("overlay.gallery.sc_on_element") }],
    desc: t("overlay.gallery.sc_context_menu"),
  },
  {
    parts: [{ k: CTRL.value }, { t: "/" }, { k: ALT.value }, { t: t("overlay.gallery.sc_while_resizing") }],
    desc: t("overlay.gallery.sc_scale_font"),
  },
  { parts: [{ k: ALT.value }, { t: t("overlay.gallery.sc_plus_dragging") }], desc: t("overlay.gallery.sc_disable_snap") },
  { parts: [{ k: t("overlay.gallery.key_mouse_wheel") }, { t: t("overlay.gallery.sc_over_canvas") }], desc: t("overlay.gallery.sc_zoom") },
  {
    parts: [{ k: CTRL.value }, { t: "+" }, { k: "+" }, { t: "/" }, { k: CTRL.value }, { t: "+" }, { k: "-" }],
    desc: t("overlay.gallery.sc_zoom"),
  },
  {
    parts: [{ svg: MOUSE_RIGHT }, { t: "/" }, { svg: MOUSE_MIDDLE }, { t: t("overlay.gallery.sc_drag") }],
    desc: t("overlay.gallery.sc_pan_canvas"),
  },
  {
    parts: [{ k: "1" }, { t: "/" }, { k: "2" }, { t: "/" }, { k: "3" }, { t: "/" }, { k: "4" }],
    desc: t("overlay.gallery.sc_switch_backdrop"),
  },
]);
</script>

<template>
  <div class="ovl-gallery">
    <div class="ovl-gallery-title">{{ t('overlay.gallery.add') }}</div>
    <button v-for="entry in entries" :key="entry.label" class="ovl-gallery-item"
      @click="emit('add', entry.type, entry.variant)">
      <span class="ovl-gallery-icon" v-html="iconSvgFor(entry.icon)"></span>
      {{ entry.label }}
    </button>

    <button class="ovl-gallery-item ovl-gallery-help" @click="helpOpen = true">
      <span class="ovl-gallery-icon" v-html="iconSvgFor('info')"></span>
      {{ t('overlay.gallery.shortcuts') }}
    </button>
  </div>

  <Teleport to="body">
    <div v-if="helpOpen" class="ovl-help-backdrop" @mousedown.self="helpOpen = false">
      <div class="ovl-help-modal">
        <div class="ovl-help-header">
          <div class="ovl-help-title">{{ t('overlay.gallery.shortcuts_title') }}</div>
          <button class="ovl-help-close" @click="helpOpen = false" v-html="iconSvgFor('x')"></button>
        </div>
        <div class="ovl-help-list">
          <div v-for="s in shortcuts" :key="s.desc" class="ovl-help-row">
            <span class="ovl-help-key">
              <template v-for="(p, pi) in s.parts" :key="pi">
                <span v-if="p.k" class="ovl-key-chip">{{ p.k }}</span>
                <span v-else-if="p.svg" class="ovl-key-icon" v-html="p.svg"></span>
                <span v-else class="ovl-key-text">{{ p.t }}</span>
              </template>
            </span>
            <span class="ovl-help-desc">{{ s.desc }}</span>
          </div>
        </div>
      </div>
    </div>
  </Teleport>
</template>

<style scoped>
.ovl-gallery {
  width: 160px;
  flex-shrink: 0;
  border-right: 1px solid #1e1e22;
  display: flex;
  flex-direction: column;
  padding: 4px;
  overflow-y: auto;
  scrollbar-width: none;
}

.ovl-gallery::-webkit-scrollbar {
  display: none;
}

.ovl-gallery-title {
  padding: 8px 8px 6px;
  font-size: 10px;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  color: #555;
}

.ovl-gallery-item {
  display: flex;
  align-items: center;
  gap: 8px;
  height: 34px;
  padding: 0 8px;
  border: none;
  background: transparent;
  color: #ccc;
  font-family: inherit;
  font-size: 12px;
  text-align: left;
  cursor: pointer;
  width: 100%;
}

.ovl-gallery-item:hover {
  background: #111217;
  color: #9d6cff;
}

.ovl-gallery-icon {
  display: inline-flex;
  flex-shrink: 0;
  color: #6f2bff;
}

.ovl-gallery-help {
  margin-top: auto;
  border-top: 1px solid #1e1e22;
  color: #888;
}

.ovl-help-backdrop {
  position: fixed;
  inset: 0;
  z-index: 4000;
  background: rgba(0, 0, 0, 0.6);
  display: flex;
  align-items: center;
  justify-content: center;
}

.ovl-help-modal {
  width: 480px;
  max-width: 90vw;
  max-height: 80vh;
  display: flex;
  flex-direction: column;
  background: #141418;
  border: 1px solid #2a2a30;
  box-shadow: 0 12px 48px rgba(0, 0, 0, 0.6);
}

.ovl-help-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 14px 16px;
  border-bottom: 1px solid #1e1e22;
}

.ovl-help-title {
  font-size: 12px;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  color: #9d6cff;
}

.ovl-help-close {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 24px;
  height: 24px;
  border: none;
  background: transparent;
  color: #888;
  cursor: pointer;
}

.ovl-help-close:hover {
  color: #e0e0e0;
}

.ovl-help-list {
  overflow-y: auto;
  padding: 8px 16px 16px;
  scrollbar-width: none;
}

.ovl-help-list::-webkit-scrollbar {
  display: none;
}

.ovl-help-row {
  display: flex;
  align-items: baseline;
  gap: 12px;
  padding: 8px 0;
  border-bottom: 1px solid #1a1a1e;
}

.ovl-help-row:last-child {
  border-bottom: none;
}

.ovl-help-key {
  flex-shrink: 0;
  width: 190px;
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 3px;
}

.ovl-key-chip {
  display: inline-flex;
  align-items: center;
  padding: 2px 6px;
  font-size: 10px;
  color: #e0e0e0;
  font-family: "Consolas", "Fira Mono", monospace;
  background: #1c1c22;
  border: 1px solid #2e2e36;
  border-bottom: 2px solid #333340;
  border-radius: 4px;
  box-shadow: 0 1px 0 rgba(0, 0, 0, 0.4);
}

.ovl-key-icon {
  display: inline-flex;
  align-items: center;
  flex-shrink: 0;
}

.ovl-key-icon svg {
  width: 15px;
  height: auto;
}

.ovl-key-text {
  font-size: 11px;
  color: #666;
  white-space: pre;
}

.ovl-help-desc {
  font-size: 12px;
  color: #888;
}
</style>
