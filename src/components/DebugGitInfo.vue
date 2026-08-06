<script setup lang="ts">
import { ref, onMounted } from 'vue'
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
</script>

<template>
  <div v-if="debugInfo" class="debug-git-info">
    <div class="debug-title">🔧 Debug Info</div>
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
  <div v-else-if="!loading" class="debug-git-info">
    <div class="debug-title">🔧 Debug</div>
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
  margin-bottom: 8px;
  font-size: 12px;
}

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
