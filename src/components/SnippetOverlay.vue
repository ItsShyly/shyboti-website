<script setup lang="ts">
import { ref, watch, onMounted, onUnmounted, inject, computed, type Ref } from 'vue'
import { useRoute } from 'vue-router'
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
const route = useRoute()

// Only activate snippet tool on the logs route
const snippetEnabled = computed(() => route.path === '/logs')
const captureFlashRect = ref<{ left: number; top: number; width: number; height: number } | null>(null)
const captureFlashVisible = ref(false)
let captureFlashTimer: ReturnType<typeof setTimeout> | null = null

function getPanel(): HTMLElement | null {
  return mainPanelRef?.value ?? null
}

// Convert scroll-relative coords → fixed viewport coords for the overlay rect
function toFixed(scrollRel: number, panelScrollPos: number, panelOrigin: number): number {
  return panelOrigin + scrollRel - panelScrollPos
}

function handleMouseDown(e: MouseEvent) {
  if (!snippetEnabled.value) return
  const c = getPanel(); if (!c) return
  onSnippetMouseDown(e, c)
}
function handleMouseMove(e: MouseEvent) {
  if (!snippetEnabled.value && !screenshotDrag.value) return
  onWindowMouseMove(e, getPanel())
}
function handleMouseUp  (e: MouseEvent) {
  if (!snippetEnabled.value && !screenshotDrag.value) return
  const shouldFlash = screenshotDrag.value
  const rectBeforeRelease = shouldFlash ? fixedRect() : null
  onWindowMouseUp(e, getPanel())
  if (shouldFlash && rectBeforeRelease && rectBeforeRelease.width >= 10 && rectBeforeRelease.height >= 10) {
    triggerCaptureFlash(rectBeforeRelease)
  }
}
function handleCtxMenu  (e: MouseEvent) {
  if (!snippetEnabled.value) return
  onSnippetContextMenu(e)
}

let panel: HTMLElement | null = null

function triggerCaptureFlash(rect: { left: number; top: number; width: number; height: number }) {
  captureFlashRect.value = rect
  captureFlashVisible.value = false
  if (captureFlashTimer) {
    clearTimeout(captureFlashTimer)
    captureFlashTimer = null
  }

  requestAnimationFrame(() => {
    captureFlashVisible.value = true
    captureFlashTimer = setTimeout(() => {
      captureFlashVisible.value = false
      captureFlashRect.value = null
      captureFlashTimer = null
    }, 260)
  })
}

onMounted(() => {
  watch(screenshotDrag, (v) => document.body.classList.toggle('snippet-dragging', v))
  window.addEventListener('mousemove', handleMouseMove)
  window.addEventListener('mouseup',   handleMouseUp)
  
  // Watch for panel ref changes to attach/detach listeners
  watch(() => mainPanelRef?.value, (newPanel) => {
    // Detach from old panel
    if (panel) {
      panel.removeEventListener('mousedown',   handleMouseDown)
      panel.removeEventListener('contextmenu', handleCtxMenu)
    }
    // Attach to new panel
    panel = newPanel || null
    if (panel) {
      panel.addEventListener('mousedown',   handleMouseDown)
      panel.addEventListener('contextmenu', handleCtxMenu)
    }
  }, { immediate: true })
  
  // When navigating away from logs mid-drag, cancel the drag
  watch(snippetEnabled, (enabled) => {
    if (!enabled && screenshotDrag.value) {
      screenshotDrag.value = false
      screenshotRect.value = null
    }
  })
})

onUnmounted(() => {
  window.removeEventListener('mousemove', handleMouseMove)
  window.removeEventListener('mouseup',   handleMouseUp)
  if (captureFlashTimer) {
    clearTimeout(captureFlashTimer)
    captureFlashTimer = null
  }
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

    <div
      v-if="captureFlashVisible && captureFlashRect"
      class="snippet-global-rect snippet-global-rect-flash"
      :style="{
        left:   captureFlashRect.left   + 'px',
        top:    captureFlashRect.top    + 'px',
        width:  captureFlashRect.width  + 'px',
        height: captureFlashRect.height + 'px',
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
.snippet-global-rect-flash {
  animation: snippet-capture-flash 260ms ease-out forwards;
}
@keyframes snippet-capture-flash {
  0% {
    background: rgba(111, 43, 255, 0.12);
    border-color: rgba(157, 108, 255, 0.85);
    box-shadow: 0 0 0 0 rgba(157, 108, 255, 0.45);
  }
  35% {
    background: rgba(111, 43, 255, 0.32);
    border-color: rgba(199, 173, 255, 0.95);
    box-shadow: 0 0 0 6px rgba(157, 108, 255, 0.18);
  }
  100% {
    background: rgba(111, 43, 255, 0);
    border-color: rgba(157, 108, 255, 0);
    box-shadow: 0 0 0 10px rgba(157, 108, 255, 0);
  }
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
