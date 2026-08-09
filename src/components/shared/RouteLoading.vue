<template>
  <div class="route-loading">
    <img src="https://cdn.7tv.app/emote/01G0PEAVDR0008B1SW0M995JQJ/2x.gif" alt="loading" class="route-loading-emote" />
    <div class="route-loading-bar-track">
      <div class="route-loading-bar-fill" :style="{ width: progress + '%' }"></div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted, onUnmounted } from 'vue'

const progress = ref(0)
let raf: number | null = null
let start = 0

function tick(now: number) {
  const elapsed = now - start
  progress.value = 90 * (1 - Math.exp(-elapsed / 700))
  raf = requestAnimationFrame(tick)
}

onMounted(() => {
  start = performance.now()
  raf = requestAnimationFrame(tick)
})
onUnmounted(() => {
  if (raf) cancelAnimationFrame(raf)
})
</script>

<style scoped>
.route-loading {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 16px;
  width: 100%;
  min-height: 70vh;
}

.route-loading-emote {
  width: 48px;
  height: 48px;
  image-rendering: pixelated;
}

.route-loading-bar-track {
  width: 120px;
  height: 3px;
  background: #ffd56922;
  overflow: hidden;
}

.route-loading-bar-fill {
  height: 100%;
  background: #ffd569;
  transition: width 0.1s linear;
}
</style>
