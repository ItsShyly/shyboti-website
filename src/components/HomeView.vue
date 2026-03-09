<script setup lang="ts">
import { useAuth } from '../auth'

const { login } = useAuth()

const emit = defineEmits<{ (e: 'navigate', item: string): void }>()


</script>

<template>
  <div class="home">

    <div class="hero">
      <div class="hero-inner">
        <h1 class="hero-title">
          <img
            src="https://cdn.7tv.app/emote/01G0PEAVDR0008B1SW0M995JQJ/2x.gif"
            alt="shy"
            class="hero-emote"
          />
          ShyBoti
        </h1>
        <p class="hero-sub">Ein Twitch-Bot mit ein paar extra features.<br>Login um commands zu verwalten, logs anzuzeigen und settings zu konfigurieren.</p>
        <button class="hero-login" @click="login">Login with Twitch</button>
      </div>
    </div>

  
  </div>
</template>

<style scoped>
/* home fills the entire main-panel height */
.home {
  display: flex; flex-direction: column;
  height: 100%;
}

/* hero takes all remaining space above the grid */
.hero {
  flex: 1;
  display: flex; align-items: center; justify-content: center;
  border-bottom: 1px solid #222;
  padding: 32px 0;
}

.hero-inner {
  display: flex; flex-direction: column;
  align-items: center; text-align: center;
  gap: 20px;
}

.hero-title {
  display: flex; align-items: center; gap: 18px;
  font-size: clamp(40px, 5.5vw, 68px);
  font-weight: 700; color: #bf94ff;
  line-height: 1;
}
.hero-emote {
  width: clamp(44px, 6vw, 72px);
  height: clamp(44px, 6vw, 72px);
  image-rendering: pixelated;
}

.hero-sub {
  font-size: clamp(12px, 1.3vw, 15px);
  color: #666; line-height: 1.9;
}

.hero-login {
  margin-top: 8px;
  height: 44px; padding: 0 32px; border: none;
  background: #6f2bff; color: #fff;
  font-family: inherit; font-size: 14px; font-weight: 600; cursor: pointer;
  transition: background 0.15s;
}
.hero-login:hover { background: #7f3fff; }

/* category grid below the hero */
.category-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(260px, 1fr));
  gap: 10px;
  padding-top: 24px;
}

.cat-card {
  display: flex; align-items: center; gap: 14px;
  padding: 16px 18px;
  background: #2c2c2e; border: 1px solid #333;
  cursor: pointer; transition: background 0.15s, border-color 0.15s;
}
.cat-card:hover { background: #333; border-color: #6f2bff55; }

.cat-icon { font-size: 1.4rem; flex-shrink: 0; }
.cat-body { flex: 1; }
.cat-name { font-size: 13px; font-weight: 700; color: #e0e0e0; margin-bottom: 3px; }
.cat-desc { font-size: 11px; color: #666; line-height: 1.5; }
.cat-lock { font-size: 11px; opacity: 0.35; flex-shrink: 0; }
</style>
