<template>
  <div class="route-loading">
    <img src="https://cdn.7tv.app/emote/01G0PEAVDR0008B1SW0M995JQJ/2x.gif" alt="loading" class="route-loading-emote" />
  </div>
</template>

<style scoped>
.route-loading {
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 48px 0;
  min-height: 200px;
}

.route-loading-emote {
  width: 48px;
  height: 48px;
  image-rendering: pixelated;
  animation: route-spin 1.1s linear infinite;
}

@keyframes route-spin {
  to {
    transform: rotate(360deg);
  }
}
</style>
