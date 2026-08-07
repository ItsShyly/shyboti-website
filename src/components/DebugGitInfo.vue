<script setup lang="ts">
import { ref, onMounted, onUnmounted } from 'vue'
import { API } from '../api'

interface GitInfo {
  hash: string
  message: string
  count: string
}

interface DebugInfo {
  backend: GitInfo
  frontend: GitInfo
}

const debugInfo = ref<DebugInfo | null>(null)
const loading = ref(true)

onMounted(async () => {
  try {
    const res = await fetch(`${API}/debug/git-info`)
    if (res.ok) {
      debugInfo.value = await res.json()
    }
  } catch {}
  loading.value = false
})

// --- minimize + drag ---
// Panel and the floating restore button each keep their own free-floating
// position once dragged (null = still sitting at its default fixed corner).
const minimized = ref(false)
const panelPos = ref<{ x: number; y: number } | null>(null)
const btnPos    = ref<{ x: number; y: number } | null>(null)

let dragTarget: 'panel' | 'btn' | null = null
let dragOffset = { x: 0, y: 0 }
let dragMoved = false

function startDrag(e: PointerEvent, target: 'panel' | 'btn') {
  // >>> Only left-click/primary touch starts a drag - and skip elements
  // >>> explicitly marked as their own controls (the minimize button).
  if (e.button !== undefined && e.button !== 0) return
  const el = (e.currentTarget as HTMLElement)
  const rect = el.getBoundingClientRect()
  dragTarget = target
  dragOffset = { x: e.clientX - rect.left, y: e.clientY - rect.top }
  dragMoved = false
  window.addEventListener('pointermove', onDrag)
  window.addEventListener('pointerup', stopDrag)
}

function onDrag(e: PointerEvent) {
  if (!dragTarget) return
  dragMoved = true
  const pos = {
    x: Math.max(0, Math.min(window.innerWidth - 20, e.clientX - dragOffset.x)),
    y: Math.max(0, Math.min(window.innerHeight - 20, e.clientY - dragOffset.y)),
  }
  if (dragTarget === 'panel') panelPos.value = pos
  else btnPos.value = pos
}

function stopDrag() {
  // >>> A drag with no real movement is just a click - let the floating
  // >>> button's own @click handle restoring the panel in that case.
  dragTarget = null
  window.removeEventListener('pointermove', onDrag)
  window.removeEventListener('pointerup', stopDrag)
}

function restoreIfNotDragged() {
  if (!dragMoved) minimized.value = false
}

onUnmounted(() => {
  window.removeEventListener('pointermove', onDrag)
  window.removeEventListener('pointerup', stopDrag)
})
</script>

<template>
  <div
    v-if="minimized"
    class="debug-fab"
    :style="btnPos ? { left: btnPos.x + 'px', top: btnPos.y + 'px', right: 'auto', bottom: 'auto' } : {}"
    title="Show debug info"
    @pointerdown="startDrag($event, 'btn')"
    @click="restoreIfNotDragged"
  >+</div>

  <div
    v-else-if="debugInfo"
    class="debug-git-info"
    :style="panelPos ? { left: panelPos.x + 'px', top: panelPos.y + 'px', right: 'auto', bottom: 'auto' } : {}"
  >
    <div class="debug-title-row" @pointerdown="startDrag($event, 'panel')">
      <div class="debug-title">🔧 Debug Info</div>
      <button class="debug-min-btn" title="Minimize" @pointerdown.stop @click="minimized = true">−</button>
    </div>
    <div class="debug-repo">
      <div class="debug-label">Backend</div>
      <div class="debug-hash">#{{ debugInfo.backend.count }}: {{ debugInfo.backend.hash }}</div>
      <div class="debug-message">{{ debugInfo.backend.message }}</div>
    </div>
    <div class="debug-repo">
      <div class="debug-label">Frontend</div>
      <div class="debug-hash">#{{ debugInfo.frontend.count }}: {{ debugInfo.frontend.hash }}</div>
      <div class="debug-message">{{ debugInfo.frontend.message }}</div>
    </div>
  </div>

  <div
    v-else-if="!loading"
    class="debug-git-info"
    :style="panelPos ? { left: panelPos.x + 'px', top: panelPos.y + 'px', right: 'auto', bottom: 'auto' } : {}"
  >
    <div class="debug-title-row" @pointerdown="startDrag($event, 'panel')">
      <div class="debug-title">🔧 Debug</div>
      <button class="debug-min-btn" title="Minimize" @pointerdown.stop @click="minimized = true">−</button>
    </div>
    <div class="debug-error">Git info unavailable</div>
  </div>
</template>

<style scoped>
.debug-git-info {
  position: fixed;
  bottom: 16px;
  right: 16px;
  background: #1a1a1e;
  border: 1px solid #2a2a30;
  border-radius: 4px;
  padding: 12px;
  font-size: 11px;
  color: #888;
  font-family: 'Consolas', 'Fira Mono', 'Courier New', monospace;
  max-width: 320px;
  z-index: 9999;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.3);
}

.debug-title {
  color: #f1494944;
  font-weight: 700;
  font-size: 12px;
}

.debug-title-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  margin-bottom: 8px;
  cursor: move;
  user-select: none;
  touch-action: none;
}

.debug-min-btn {
  width: 18px; height: 18px; flex-shrink: 0;
  display: flex; align-items: center; justify-content: center;
  border: 1px solid #2a2a30; background: transparent; color: #666;
  cursor: pointer; font-size: 13px; line-height: 1; font-family: inherit;
  transition: all .15s;
}
.debug-min-btn:hover { border-color: #f1494955; color: #f14949; }

.debug-fab {
  position: fixed;
  bottom: 16px;
  right: 16px;
  width: 34px; height: 34px;
  display: flex; align-items: center; justify-content: center;
  background: #1a1a1e;
  border: 1px solid #2a2a30;
  border-radius: 50%;
  color: #f1494988;
  font-size: 18px;
  font-weight: 700;
  cursor: pointer;
  user-select: none;
  touch-action: none;
  z-index: 9999;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.3);
  transition: color .15s, border-color .15s;
}
.debug-fab:hover { color: #f14949; border-color: #f1494955; }

.debug-repo {
  margin-bottom: 8px;
  padding-bottom: 8px;
  border-bottom: 1px solid #2a2a30;
}

.debug-repo:last-child {
  border-bottom: none;
  margin-bottom: 0;
  padding-bottom: 0;
}

.debug-label {
  color: #9d6cff;
  font-weight: 600;
  margin-bottom: 2px;
}

.debug-hash {
  color: #6cff9d;
  font-weight: 600;
  margin-bottom: 2px;
  word-break: break-all;
}

.debug-message {
  color: #888;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  margin-top: 2px;
}

.debug-error {
  color: #f14949;
}
</style>
