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

const isTextLike = computed(
  () => props.element.type === "text" || props.element.type === "variable-text",
);
const isShape = computed(() => props.element.type === "shape");
const isVideo = computed(() => props.element.type === "video");
const isAudio = computed(() => props.element.type === "audio");
const isImage = computed(() => props.element.type === "image");

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
});
function toggle(key: string) {
  collapsed[key] = !collapsed[key];
}

const alignOptions = [
  { h: "left", v: "top" },
  { h: "center", v: "top" },
  { h: "right", v: "top" },
  { h: "left", v: "middle" },
  { h: "center", v: "middle" },
  { h: "right", v: "middle" },
  { h: "left", v: "bottom" },
  { h: "center", v: "bottom" },
  { h: "right", v: "bottom" },
] as const;
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
          Color
          <input type="color" :value="element.style.color || '#ffffff'" @input="setStyle({ color: str($event) })" />
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
          <input type="color" :value="element.style.strokeColor || '#000000'"
            @input="setStyle({ strokeColor: str($event) })" />
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
          <input type="color" :value="element.style.shadowColor || '#000000'"
            @input="setStyle({ shadowColor: str($event) })" />
        </label>
        <label class="ovl-style-field">
          Padding
          <input type="number" :value="element.style.padding ?? 0" @change="setStyle({ padding: num($event) })" />
        </label>
        <label class="ovl-style-field">
          Alignment
          <div class="ovl-style-align-grid">
            <button v-for="opt in alignOptions" :key="opt.h + opt.v" class="ovl-style-align-btn" :class="{
              active: (element.style.textAlign || 'left') === opt.h && (element.style.verticalAlign || 'top') === opt.v,
            }" :title="`${opt.v} ${opt.h}`"
              @click="setStyle({ textAlign: opt.h, verticalAlign: opt.v })">
              <span class="ovl-style-align-dot"></span>
            </button>
          </div>
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
          <input type="text" :value="element.style.background || ''" placeholder="none, e.g. rgba(0,0,0,0.6)"
            @change="setStyle({ background: str($event) })" />
        </label>
        <div class="ovl-style-grid">
          <label class="ovl-style-num">
            Border w.
            <input type="number" :value="element.style.borderWidth ?? 0"
              @change="setStyle({ borderWidth: num($event) })" />
          </label>
          <label class="ovl-style-num">
            Radius
            <input type="number" :value="element.style.borderRadius ?? 0"
              @change="setStyle({ borderRadius: num($event) })" />
          </label>
        </div>
        <label class="ovl-style-field">
          Border color
          <input type="color" :value="element.style.borderColor || '#ffffff'"
            @input="setStyle({ borderColor: str($event) })" />
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

.ovl-style-align-grid {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 3px;
  width: 84px;
}

.ovl-style-align-btn {
  width: 26px;
  height: 26px;
  display: flex;
  align-items: center;
  justify-content: center;
  border: 1px solid #2a2a30;
  background: #111217;
  cursor: pointer;
}

.ovl-style-align-btn:hover {
  border-color: #6f2bff88;
}

.ovl-style-align-btn.active {
  border-color: #6f2bff;
  background: #6f2bff22;
}

.ovl-style-align-dot {
  width: 5px;
  height: 5px;
  border-radius: 50%;
  background: #666;
}

.ovl-style-align-btn.active .ovl-style-align-dot {
  background: #9d6cff;
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
