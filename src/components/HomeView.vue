<script setup lang="ts">
import { useAuth } from '../auth'
import { useI18n } from '../i18n'

const { login } = useAuth()
const { t } = useI18n()
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
        <p class="hero-sub" style="white-space: pre-line">{{ t('home.sub') }}</p>
        <button class="hero-login" @click="login">{{ t('home.login') }}</button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.home { display: flex; flex-direction: column; height: 100%; }
.hero { flex: 1; display: flex; align-items: center; justify-content: center; border-bottom: 1px solid #222; padding: 32px 0; }
.hero-inner { display: flex; flex-direction: column; align-items: center; text-align: center; gap: 20px; }
.hero-title {
  display: flex; align-items: center; gap: 18px;
  font-size: clamp(40px, 5.5vw, 68px); font-weight: 700; color: #ffd569; line-height: 1;
}
.hero-emote { width: clamp(44px, 6vw, 72px); height: clamp(44px, 6vw, 72px); image-rendering: pixelated; }
.hero-sub { font-size: clamp(12px, 1.3vw, 15px); color: #666; line-height: 1.9; }
.hero-login {
  margin-top: 8px; height: 44px; padding: 0 32px; border: none;
  background: #6f2bff; color: #fff; font-family: inherit; font-size: 14px; font-weight: 600; cursor: pointer;
  transition: background 0.15s;
}
.hero-login:hover { background: #7f3fff; }
</style>
