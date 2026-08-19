<script setup lang="ts">
import { ref, computed, reactive } from "vue";
import { iconSvg as iconSvgFor } from "../composables/icons";
import type { OverlayElement, ShapeVariant } from "../composables/overlayTypes";
import { shapeDefaultStyle } from "../composables/overlayTypes";

const props = defineProps<{
  element: OverlayElement;
}>();
const emit = defineEmits<{
  update: [patch: Partial<OverlayElement>];
}>();

function set(patch: Partial<OverlayElement>) {
  emit("update", patch);
}
function setStyle(patch: Partial<OverlayElement["style"]>) {
  emit("update", { style: { ...props.element.style, ...patch } });
}
function setData(patch: Record<string, any>) {
  emit("update", { data: { ...props.element.data, ...patch } });
}

const num = (e: Event) => Number((e.target as HTMLInputElement).value) || 0;
const str = (e: Event) => (e.target as HTMLInputElement).value;

// vvv background = color swatch + opacity slider, composed into an rgba() string vvv
function parseBackground(bg: string): { hex: string; alpha: number } {
  const m = bg.match(/^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*(?:,\s*([\d.]+)\s*)?\)$/i);
  if (m) {
    const r = Number(m[1]), g = Number(m[2]), b = Number(m[3]);
    const a = m[4] !== undefined ? Number(m[4]) : 1;
    const hex = "#" + [r, g, b].map((n) => n.toString(16).padStart(2, "0")).join("");
    return { hex, alpha: Math.round(a * 100) };
  }
  if (/^#[0-9a-f]{6}$/i.test(bg)) return { hex: bg, alpha: 100 };
  return { hex: "#000000", alpha: 0 };
}
function hexAlphaToRgba(hex: string, alphaPct: number): string {
  const m = hex.match(/^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i);
  if (!m) return "";
  const r = parseInt(m[1]!, 16), g = parseInt(m[2]!, 16), b = parseInt(m[3]!, 16);
  const a = Math.max(0, Math.min(100, alphaPct));
  if (a <= 0) return "";
  if (a >= 100) return `rgb(${r}, ${g}, ${b})`;
  return `rgba(${r}, ${g}, ${b}, ${(a / 100).toFixed(2)})`;
}
const backgroundParsed = computed(() => parseBackground(props.element.style.background || ""));
function setBackgroundHex(hex: string) {
  setStyle({ background: hexAlphaToRgba(hex, backgroundParsed.value.alpha || 100) });
}
function setBackgroundAlpha(alphaPct: number) {
  setStyle({ background: hexAlphaToRgba(backgroundParsed.value.hex, alphaPct) });
}
// ^^^ background ^^^

// vvv solid colors (text/outline/shadow/border) = color swatch + opacity slider too -
// vvv unlike background, alpha 0 must stay truly transparent, never fall back to opaque vvv
type SolidColorKey = "color" | "strokeColor" | "shadowColor" | "borderColor";
function parseSolidColor(value: string | undefined, fallbackHex: string): { hex: string; alpha: number } {
  if (!value) return { hex: fallbackHex, alpha: 100 };
  return parseBackground(value);
}
function hexAlphaToRgbaColor(hex: string, alphaPct: number): string {
  const m = hex.match(/^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i);
  if (!m) return hex;
  const r = parseInt(m[1]!, 16), g = parseInt(m[2]!, 16), b = parseInt(m[3]!, 16);
  const a = Math.max(0, Math.min(100, alphaPct)) / 100;
  return `rgba(${r}, ${g}, ${b}, ${a.toFixed(2)})`;
}
function setSolidColorHex(key: SolidColorKey, fallbackHex: string, hex: string) {
  const current = parseSolidColor(props.element.style[key], fallbackHex);
  setStyle({ [key]: hexAlphaToRgbaColor(hex, current.alpha) });
}
function setSolidColorAlpha(key: SolidColorKey, fallbackHex: string, alphaPct: number) {
  const current = parseSolidColor(props.element.style[key], fallbackHex);
  setStyle({ [key]: hexAlphaToRgbaColor(current.hex, alphaPct) });
}
// ^^^ solid colors ^^^

// >>> aspect-lock keeps w/h ratio fixed while editing either field
const aspectLocked = ref(false);
const aspectRatio = computed(() =>
  props.element.h ? props.element.w / props.element.h : 1,
);
function setW(v: number) {
  if (aspectLocked.value) set({ w: v, h: Math.round(v / aspectRatio.value) });
  else set({ w: v });
}
function setH(v: number) {
  if (aspectLocked.value) set({ h: v, w: Math.round(v * aspectRatio.value) });
  else set({ h: v });
}

// >>> countdown renders as styled text too - reuses typography/text-styling/border sections
const isTextLike = computed(() =>
  ["text", "variable-text", "countdown", "countup"].includes(props.element.type),
);
const isShape = computed(() => props.element.type === "shape");
const isVideo = computed(() => props.element.type === "video");
const isAudio = computed(() => props.element.type === "audio");
const isImage = computed(() => props.element.type === "image");
const isCountdown = computed(() => props.element.type === "countdown");

// >>> datetime-local wants local "YYYY-MM-DDTHH:mm", stored as ISO
function isoToLocalInput(iso: string): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
function localInputToIso(v: string): string {
  if (!v) return "";
  const d = new Date(v);
  return isNaN(d.getTime()) ? "" : d.toISOString();
}

const shapeVariant = computed<ShapeVariant>(
  () => props.element.data.variant ?? "border",
);
function setVariant(variant: ShapeVariant) {
  setData({ variant });
  setStyle(shapeDefaultStyle(variant));
}

// >>> position&size + border&background start collapsed, everything else stays open
const collapsed = reactive<Record<string, boolean>>({
  position: true,
  border: true,
  typography: true,
  color: true,
  countdown: true,
});
function toggle(key: string) {
  collapsed[key] = !collapsed[key];
}
</script>

<template>
  <div class="ovl-style-panel">
    <!-- vvv transform - applies to every element, auto-collapsed vvv -->
    <button class="ovl-style-section-title" @click="toggle('position')">
      <span v-html="iconSvgFor(collapsed.position ? 'chevron-right' : 'chevron-down')"></span>
      position &amp; size
    </button>
    <div v-if="!collapsed.position" class="ovl-style-grid">
      <label class="ovl-style-num">
        X
        <input type="number" :value="Math.round(element.x)" @change="set({ x: num($event) })" />
      </label>
      <label class="ovl-style-num">
        Y
        <input type="number" :value="Math.round(element.y)" @change="set({ y: num($event) })" />
      </label>
      <label class="ovl-style-num">
        W
        <input type="number" :value="Math.round(element.w)" @change="setW(num($event))" />
      </label>
      <label class="ovl-style-num">
        H
        <input type="number" :value="Math.round(element.h)" @change="setH(num($event))" />
      </label>
      <label class="ovl-style-num">
        Rotation
        <input type="number" :value="Math.round(element.rotation)" @change="set({ rotation: num($event) })" />
      </label>
      <label class="ovl-style-check">
        <div class="ep-toggle-btn" :class="{ on: aspectLocked }" @click="aspectLocked = !aspectLocked">
          <span class="ep-toggle-knob"></span>
        </div>
        lock aspect
      </label>
    </div>

    <!-- vvv typography + box alignment - text/variable-text only, auto-collapsed vvv -->
    <template v-if="isTextLike">
      <button class="ovl-style-section-title" @click="toggle('typography')">
        <span v-html="iconSvgFor(collapsed.typography ? 'chevron-right' : 'chevron-down')"></span>
        typography
      </button>
      <template v-if="!collapsed.typography">
        <label class="ovl-style-field">
          Font family
          <input type="text" :value="element.style.fontFamily || ''" placeholder="inherit"
            @change="setStyle({ fontFamily: str($event) })" />
        </label>
        <div class="ovl-style-grid">
          <label class="ovl-style-num">
            Size
            <input type="number" :value="element.style.fontSize ?? 32"
              @change="setStyle({ fontSize: num($event) })" />
          </label>
          <label class="ovl-style-num">
            Letter sp.
            <input type="number" :value="element.style.letterSpacing ?? 0"
              @change="setStyle({ letterSpacing: num($event) })" />
          </label>
        </div>
        <label class="ovl-style-field">
          Weight
          <select :value="element.style.fontWeight || 'normal'" @change="setStyle({ fontWeight: str($event) })">
            <option value="normal">normal</option>
            <option value="bold">bold</option>
            <option value="300">light</option>
            <option value="900">black</option>
          </select>
        </label>
        <label class="ovl-style-field">
          Padding
          <input type="number" :value="element.style.padding ?? 0" @input="setStyle({ padding: num($event) })" />
        </label>
      </template>

      <!-- vvv color is a distinct concern from font shape - own section, auto-collapsed vvv -->
      <button class="ovl-style-section-title" @click="toggle('color')">
        <span v-html="iconSvgFor(collapsed.color ? 'chevron-right' : 'chevron-down')"></span>
        text styling
      </button>
      <template v-if="!collapsed.color">
        <label class="ovl-style-field">
          Text color
          <div class="ovl-style-bg-row">
            <input type="color" :value="parseSolidColor(element.style.color, '#ffffff').hex"
              @input="setSolidColorHex('color', '#ffffff', ($event.target as HTMLInputElement).value)" />
            <input type="range" min="0" max="100" :value="parseSolidColor(element.style.color, '#ffffff').alpha"
              title="opacity"
              @input="setSolidColorAlpha('color', '#ffffff', Number(($event.target as HTMLInputElement).value))" />
            <span class="ovl-style-bg-pct">{{ parseSolidColor(element.style.color, '#ffffff').alpha }}%</span>
          </div>
        </label>
        <label class="ovl-style-check">
          <div class="ep-toggle-btn" :class="{ on: !!element.style.stroke }"
            @click="setStyle({ stroke: !element.style.stroke })">
            <span class="ep-toggle-knob"></span>
          </div>
          outline
        </label>
        <label v-if="element.style.stroke" class="ovl-style-field">
          Outline color
          <div class="ovl-style-bg-row">
            <input type="color" :value="parseSolidColor(element.style.strokeColor, '#000000').hex"
              @input="setSolidColorHex('strokeColor', '#000000', ($event.target as HTMLInputElement).value)" />
            <input type="range" min="0" max="100"
              :value="parseSolidColor(element.style.strokeColor, '#000000').alpha" title="opacity"
              @input="setSolidColorAlpha('strokeColor', '#000000', Number(($event.target as HTMLInputElement).value))" />
            <span class="ovl-style-bg-pct">{{ parseSolidColor(element.style.strokeColor, '#000000').alpha }}%</span>
          </div>
        </label>
        <label class="ovl-style-check">
          <div class="ep-toggle-btn" :class="{ on: !!element.style.shadow }"
            @click="setStyle({ shadow: !element.style.shadow })">
            <span class="ep-toggle-knob"></span>
          </div>
          drop shadow
        </label>
        <label v-if="element.style.shadow" class="ovl-style-field">
          Shadow color
          <div class="ovl-style-bg-row">
            <input type="color" :value="parseSolidColor(element.style.shadowColor, '#000000').hex"
              @input="setSolidColorHex('shadowColor', '#000000', ($event.target as HTMLInputElement).value)" />
            <input type="range" min="0" max="100"
              :value="parseSolidColor(element.style.shadowColor, '#000000').alpha" title="opacity"
              @input="setSolidColorAlpha('shadowColor', '#000000', Number(($event.target as HTMLInputElement).value))" />
            <span class="ovl-style-bg-pct">{{ parseSolidColor(element.style.shadowColor, '#000000').alpha }}%</span>
          </div>
        </label>
      </template>
    </template>

    <!-- vvv countdown - target/duration mode, auto-collapsed. The current time itself is set
    from the properties panel above or by double-clicking the element on the canvas, not here vvv -->
    <template v-if="isCountdown">
      <button class="ovl-style-section-title" @click="toggle('countdown')">
        <span v-html="iconSvgFor(collapsed.countdown ? 'chevron-right' : 'chevron-down')"></span>
        countdown
      </button>
      <template v-if="!collapsed.countdown">
        <label class="ovl-style-field">
          Mode
          <select :value="element.data.mode || 'duration'" @change="setData({ mode: str($event) })">
            <option value="duration">Duration</option>
            <option value="target">Target date/time</option>
          </select>
        </label>
        <template v-if="(element.data.mode || 'duration') === 'duration'">
          <label class="ovl-style-num">
            Minutes
            <input type="number" min="0" step="0.5" :value="(element.data.durationSec ?? 300) / 60"
              @change="setData({ durationSec: Math.max(0, num($event) * 60) })" />
          </label>
          <label class="ovl-style-check">
            <div class="ep-toggle-btn" :class="{ on: element.data.repeat !== false }"
              @click="setData({ repeat: element.data.repeat === false })">
              <span class="ep-toggle-knob"></span>
            </div>
            repeat when it reaches zero
          </label>
        </template>
        <label v-else class="ovl-style-field">
          Target date &amp; time
          <input type="datetime-local" class="ovl-style-datetime"
            :value="isoToLocalInput(element.data.targetIso || '')"
            @change="setData({ targetIso: localInputToIso(($event.target as HTMLInputElement).value) })" />
        </label>
        <label class="ovl-style-field">
          Text when done
          <input type="text" :value="element.data.doneText || ''" placeholder="leave empty for 00:00"
            @change="setData({ doneText: str($event) })" />
        </label>
      </template>
    </template>

    <!-- vvv shape - variant only vvv -->
    <template v-if="isShape">
      <div class="ovl-style-section-title-static">shape</div>
      <div class="ovl-style-grid-2">
        <button v-for="v in (['border', 'background-box', 'frame'] as ShapeVariant[])" :key="v"
          class="ovl-style-variant-btn" :class="{ active: shapeVariant === v }" @click="setVariant(v)">
          {{ v }}
        </button>
      </div>
    </template>

    <!-- vvv border+background - shape/image/video/text, auto-collapsed vvv -->
    <template v-if="isShape || isImage || isVideo || isTextLike">
      <button class="ovl-style-section-title" @click="toggle('border')">
        <span v-html="iconSvgFor(collapsed.border ? 'chevron-right' : 'chevron-down')"></span>
        border &amp; background
      </button>
      <template v-if="!collapsed.border">
        <label class="ovl-style-field">
          Background
          <div class="ovl-style-bg-row">
            <input type="color" :value="backgroundParsed.hex"
              @input="setBackgroundHex(($event.target as HTMLInputElement).value)" />
            <input type="range" min="0" max="100" :value="backgroundParsed.alpha" title="opacity"
              @input="setBackgroundAlpha(Number(($event.target as HTMLInputElement).value))" />
            <span class="ovl-style-bg-pct">{{ backgroundParsed.alpha }}%</span>
          </div>
        </label>
        <label class="ovl-style-field">
          Border w.
          <div class="ovl-style-bg-row">
            <input type="number" min="0" max="40" :value="element.style.borderWidth ?? 0"
              @input="setStyle({ borderWidth: num($event) })" />
            <input type="range" min="0" max="40" :value="element.style.borderWidth ?? 0"
              @input="setStyle({ borderWidth: num($event) })" />
          </div>
        </label>
        <label class="ovl-style-field">
          Radius
          <div class="ovl-style-bg-row">
            <input type="number" min="0" max="200" :value="element.style.borderRadius ?? 0"
              @input="setStyle({ borderRadius: num($event) })" />
            <input type="range" min="0" max="200" :value="element.style.borderRadius ?? 0"
              @input="setStyle({ borderRadius: num($event) })" />
          </div>
        </label>
        <label class="ovl-style-field">
          Border color
          <div class="ovl-style-bg-row">
            <input type="color" :value="parseSolidColor(element.style.borderColor, '#ffffff').hex"
              @input="setSolidColorHex('borderColor', '#ffffff', ($event.target as HTMLInputElement).value)" />
            <input type="range" min="0" max="100" :value="parseSolidColor(element.style.borderColor, '#ffffff').alpha"
              title="opacity"
              @input="setSolidColorAlpha('borderColor', '#ffffff', Number(($event.target as HTMLInputElement).value))" />
            <span class="ovl-style-bg-pct">{{ parseSolidColor(element.style.borderColor, '#ffffff').alpha }}%</span>
          </div>
        </label>
        <label class="ovl-style-field">
          Border style
          <select :value="element.style.borderStyle || 'solid'"
            @change="setStyle({ borderStyle: str($event) as any })">
            <option value="solid">solid</option>
            <option value="dashed">dashed</option>
            <option value="dotted">dotted</option>
          </select>
        </label>
      </template>
    </template>

    <!-- vvv audio - just the mute toggle for its linked video vvv -->
    <template v-if="isAudio">
      <div class="ovl-style-section-title-static">audio</div>
      <label class="ovl-style-check">
        <div class="ep-toggle-btn" :class="{ on: element.data.muted !== false }"
          @click="setData({ muted: element.data.muted === false })">
          <span class="ep-toggle-knob"></span>
        </div>
        muted
      </label>
    </template>
  </div>
</template>

<style scoped>
.ovl-style-panel {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.ovl-style-section-title,
.ovl-style-section-title-static {
  font-size: 10px;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  color: #555;
  margin-top: 8px;
}

.ovl-style-section-title {
  display: flex;
  align-items: center;
  gap: 4px;
  width: 100%;
  border: none;
  background: transparent;
  padding: 0;
  font-family: inherit;
  cursor: pointer;
}

.ovl-style-section-title:hover {
  color: #9d6cff;
}

.ovl-style-section-title svg {
  width: 10px;
  height: 10px;
  flex-shrink: 0;
}

.ovl-style-section-title:first-child,
.ovl-style-section-title-static:first-child {
  margin-top: 0;
}

.ovl-style-field,
.ovl-style-num {
  display: flex;
  flex-direction: column;
  gap: 3px;
  font-size: 10px;
  color: #888;
}

.ovl-style-field input[type="text"],
.ovl-style-field input[type="number"],
.ovl-style-field select,
.ovl-style-num input[type="number"] {
  background: #111217;
  border: 1px solid #2a2a30;
  color: #e0e0e0;
  font-family: inherit;
  font-size: 12px;
  padding: 5px 7px;
  outline: none;
  width: 100%;
  box-sizing: border-box;
}

.ovl-style-field input[type="color"] {
  width: 100%;
  height: 28px;
  background: #111217;
  border: 1px solid #2a2a30;
  padding: 2px;
  cursor: pointer;
  -webkit-appearance: none;
  appearance: none;
}

.ovl-style-field input[type="color"]::-webkit-color-swatch-wrapper {
  padding: 0;
}

.ovl-style-field input[type="color"]::-webkit-color-swatch {
  border: none;
  border-radius: 1px;
}

.ovl-style-field input[type="color"]::-moz-color-swatch {
  border: none;
}

.ovl-style-bg-row {
  display: flex;
  align-items: center;
  gap: 6px;
}

.ovl-style-bg-row input[type="color"] {
  width: 32px;
  flex-shrink: 0;
}

.ovl-style-bg-row input[type="number"] {
  width: 48px;
  flex-shrink: 0;
}

.ovl-style-bg-row input[type="range"] {
  flex: 1;
  accent-color: #6f2bff;
  background: transparent;
  -webkit-appearance: none;
  height: 4px;
  cursor: pointer;
}

.ovl-style-bg-row input[type="range"]::-webkit-slider-runnable-track {
  background: #2a2a30;
  height: 4px;
  border-radius: 2px;
}

.ovl-style-bg-row input[type="range"]::-webkit-slider-thumb {
  -webkit-appearance: none;
  width: 12px;
  height: 12px;
  border-radius: 50%;
  background: #9d6cff;
  margin-top: -4px;
  cursor: pointer;
}

.ovl-style-bg-row input[type="range"]::-moz-range-track {
  background: #2a2a30;
  height: 4px;
  border-radius: 2px;
}

.ovl-style-bg-row input[type="range"]::-moz-range-thumb {
  width: 12px;
  height: 12px;
  border-radius: 50%;
  background: #9d6cff;
  border: none;
  cursor: pointer;
}

.ovl-style-hint {
  font-size: 9px;
  color: #555;
}

.ovl-style-datetime {
  color-scheme: dark;
}

.ovl-style-datetime::-webkit-calendar-picker-indicator {
  filter: invert(0.6);
  cursor: pointer;
}

.ovl-style-datetime::-webkit-datetime-edit-fields-wrapper,
.ovl-style-datetime::-webkit-datetime-edit-text,
.ovl-style-datetime::-webkit-datetime-edit-year-field,
.ovl-style-datetime::-webkit-datetime-edit-month-field,
.ovl-style-datetime::-webkit-datetime-edit-day-field,
.ovl-style-datetime::-webkit-datetime-edit-hour-field,
.ovl-style-datetime::-webkit-datetime-edit-minute-field,
.ovl-style-datetime::-webkit-datetime-edit-ampm-field {
  color: #e0e0e0;
}

.ovl-style-bg-pct {
  flex-shrink: 0;
  width: 30px;
  text-align: right;
  font-size: 10px;
  color: #888;
}

.ovl-style-field input:focus,
.ovl-style-field select:focus,
.ovl-style-num input:focus {
  border-color: #6f2bff88;
}

.ovl-style-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 6px;
  align-items: end;
}

.ovl-style-grid-2 {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 6px;
}

.ovl-style-check {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 11px;
  color: #ccc;
  cursor: pointer;
}

.ovl-style-variant-btn {
  height: 28px;
  border: 1px solid #2a2a30;
  background: #111217;
  color: #888;
  font-family: inherit;
  font-size: 10px;
  cursor: pointer;
}

.ovl-style-variant-btn.active {
  border-color: #6f2bff88;
  color: #9d6cff;
  background: #6f2bff15;
}
</style>
