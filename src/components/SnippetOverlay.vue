<script setup lang="ts">
import { ref, watch, onMounted, onUnmounted, inject, type Ref } from 'vue'
import { useSnippet } from '../composables/useSnippet'

const {
  screenshotDrag,
  screenshotRect,
  screenshotToast,
  onSnippetContextMenu,
  onSnippetMouseDown,
  onWindowMouseMove,
  onWindowMouseUp,
  onSnippetImgLoad,
} = useSnippet()

// Injected from App.vue – the .main-panel element ref
const mainPanelRef = inject<Ref<HTMLElement | null>>('mainPanelRef')

function getPanel(): HTMLElement | null {
  return mainPanelRef?.value ?? null
}

// Convert scroll-relative coords → fixed viewport coords for the overlay rect
function toFixed(scrollRel: number, panelScrollPos: number, panelOrigin: number): number {
  return panelOrigin + scrollRel - panelScrollPos
}

function handleMouseDown(e: MouseEvent) {
  const c = getPanel(); if (!c) return
  onSnippetMouseDown(e, c)
}
function handleMouseMove(e: MouseEvent) { onWindowMouseMove(e, getPanel()) }
function handleMouseUp  (e: MouseEvent) { onWindowMouseUp(e,   getPanel()) }
function handleCtxMenu  (e: MouseEvent) { onSnippetContextMenu(e) }

onMounted(() => {
  watch(screenshotDrag, (v) => document.body.classList.toggle('snippet-dragging', v))
  window.addEventListener('mousemove', handleMouseMove)
  window.addEventListener('mouseup',   handleMouseUp)
  const panel = getPanel()
  if (panel) {
    panel.addEventListener('mousedown',   handleMouseDown)
    panel.addEventListener('contextmenu', handleCtxMenu)
  }
})

onUnmounted(() => {
  window.removeEventListener('mousemove', handleMouseMove)
  window.removeEventListener('mouseup',   handleMouseUp)
  const panel = getPanel()
  if (panel) {
    panel.removeEventListener('mousedown',   handleMouseDown)
    panel.removeEventListener('contextmenu', handleCtxMenu)
  }
})

// Compute fixed-position rect for the visual overlay
function fixedRect() {
  const panel = getPanel()
  const sel   = screenshotRect.value
  if (!panel || !sel) return null
  const r = panel.getBoundingClientRect()
  return {
    left:   r.left + sel.x - panel.scrollLeft,
    top:    r.top  + sel.y - panel.scrollTop,
    width:  sel.w,
    height: sel.h,
  }
}
</script>

<template>
  <Teleport to="body">
    <!-- Selection rectangle -->
    <div
      v-if="screenshotRect && screenshotDrag && fixedRect()"
      class="snippet-global-rect"
      :style="{
        left:   fixedRect()!.left   + 'px',
        top:    fixedRect()!.top    + 'px',
        width:  fixedRect()!.width  + 'px',
        height: fixedRect()!.height + 'px',
      }"
    />

    <!-- Toast -->
    <transition name="snippet-toast-fade">
      <div v-if="screenshotToast" class="snippet-toast-global">
        <template v-if="screenshotToast.state === 'uploading'">
          <div class="snippet-toast-uploading">
            <div class="snippet-toast-spinner"></div>
            <div class="snippet-toast-label">Uploading Image...</div>
          </div>
        </template>
        <template v-else>
          <div class="snippet-toast-label copied">Copied to clipboard ✓</div>
          <a :href="screenshotToast.url!" target="_blank" rel="noopener" class="snippet-toast-img-link">
            <div v-if="!screenshotToast.imgReady" class="snippet-toast-img-placeholder">
              <div class="snippet-toast-spinner small"></div>
            </div>
            <img
              :src="screenshotToast.url!"
              class="snippet-toast-img"
              :class="{ hidden: !screenshotToast.imgReady }"
              alt="snippet"
              @load="onSnippetImgLoad"
            />
          </a>
        </template>
      </div>
    </transition>
  </Teleport>
</template>

<style>
/* Unscoped – Teleport children live outside the component tree */
.snippet-global-rect {
  position: fixed;
  pointer-events: none;
  z-index: 9998;
  border: 1.5px solid #9d6cff;
  background: rgba(111, 43, 255, 0.10);
}
.snippet-toast-global {
  position: fixed;
  bottom: 24px; right: 24px;
  z-index: 9999;
  background: #1b1b1f;
  border: 1px solid #6f2bff88;
  box-shadow: 0 4px 24px #00000099;
  display: flex; flex-direction: column; align-items: center;
  gap: 10px; padding: 12px 14px;
  min-width: 160px; max-width: 280px;
  font-family: 'JetBrains Mono', monospace;
}
.snippet-toast-uploading {
  display: flex; flex-direction: column; align-items: center; gap: 10px; padding: 4px 0;
}
.snippet-toast-spinner {
  width: 32px; height: 32px;
  border: 3px solid #2a2a30; border-top-color: #9d6cff;
  border-radius: 50%;
  animation: snippet-spin .8s linear infinite;
  flex-shrink: 0;
}
.snippet-toast-spinner.small { width: 20px; height: 20px; border-width: 2px; }
@keyframes snippet-spin { to { transform: rotate(360deg); } }
.snippet-toast-label {
  font-size: 11px; font-weight: 700; color: #888;
  text-transform: uppercase; letter-spacing: .06em; text-align: center;
}
.snippet-toast-label.copied { color: #9d6cff; }
.snippet-toast-img-link { display: block; }
.snippet-toast-img-placeholder {
  width: 120px; height: 80px;
  background: #111217; border: 1px solid #2a2a30;
  display: flex; align-items: center; justify-content: center;
}
.snippet-toast-img {
  max-width: 252px; max-height: 180px; display: block;
  object-fit: contain; border: 1px solid #2a2a30;
  cursor: pointer; transition: opacity .15s;
}
.snippet-toast-img.hidden { display: none; }
.snippet-toast-img:hover { opacity: .85; }
.snippet-toast-fade-enter-active, .snippet-toast-fade-leave-active { transition: opacity .25s, transform .25s; }
.snippet-toast-fade-enter-from, .snippet-toast-fade-leave-to { opacity: 0; transform: translateY(12px); }
</style>
