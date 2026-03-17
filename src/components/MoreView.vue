<script setup lang="ts">
import { useRouter } from 'vue-router'
import { useI18n } from '../i18n'

const { t } = useI18n()
const router = useRouter()
</script>

<template>
  <div class="more-view">

    <!-- >>> Images card <<< -->
    <div class="service-card" @click="router.push('/images')">
      <!-- Icon -->
      <div class="card-icon images-icon">
        <svg viewBox="0 0 48 48" fill="none" xmlns="http://www.w3.org/2000/svg">
          <!-- Frame -->
          <rect x="4" y="8" width="40" height="32" rx="4" stroke="currentColor" stroke-width="2.5"/>
          <!-- Mountain -->
          <path d="M4 32L14 20L22 28L30 18L44 32" stroke="currentColor" stroke-width="2.5" stroke-linejoin="round" stroke-linecap="round"/>
          <!-- Sun -->
          <circle cx="34" cy="20" r="4" stroke="currentColor" stroke-width="2.5"/>
          <!-- Upload arrow (top-right corner overlay) -->
          <circle cx="38" cy="12" r="7" fill="#6f2bff" opacity="0.9"/>
          <path d="M38 15.5V9M35.5 11.5L38 9L40.5 11.5" stroke="white" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>
        </svg>
      </div>

      <div class="card-body">
        <div class="card-title">{{ t('more.images') }}</div>
        <div class="card-sub">{{ t('more.images.sub') }}</div>
        <div class="card-url">i.shyboti.de/<span class="url-id">id</span></div>
      </div>

      <button class="your-btn" @click.stop="router.push('/images?gallery=1')">
        <svg viewBox="0 0 14 14" fill="none" xmlns="http://www.w3.org/2000/svg">
          <rect x="1" y="1" width="5" height="5" rx="0.8" stroke="currentColor" stroke-width="1.4"/>
          <rect x="8" y="1" width="5" height="5" rx="0.8" stroke="currentColor" stroke-width="1.4"/>
          <rect x="1" y="8" width="5" height="5" rx="0.8" stroke="currentColor" stroke-width="1.4"/>
          <rect x="8" y="8" width="5" height="5" rx="0.8" stroke="currentColor" stroke-width="1.4"/>
        </svg>
        {{ t('more.images.your') }}
      </button>
    </div>

    <!-- >>> Notes card <<< -->
    <div class="service-card" @click="router.push('/notes')">
      <!-- Icon -->
      <div class="card-icon notes-icon">
        <svg viewBox="0 0 48 48" fill="none" xmlns="http://www.w3.org/2000/svg">
          <!-- Page -->
          <rect x="8" y="4" width="28" height="36" rx="3" stroke="currentColor" stroke-width="2.5"/>
          <!-- Fold corner -->
          <path d="M28 4V14H36" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/>
          <!-- Lines -->
          <path d="M14 20h16M14 26h16M14 32h10" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"/>
          <!-- Share arrow (top-right corner overlay) -->
          <circle cx="38" cy="38" r="7" fill="#4ec9b0" opacity="0.9"/>
          <path d="M38 41V35M35.5 37.5L38 35L40.5 37.5" stroke="white" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>
        </svg>
      </div>

      <div class="card-body">
        <div class="card-title">{{ t('more.notes') }}</div>
        <div class="card-sub">{{ t('more.notes.sub') }}</div>
        <div class="card-url">n.shyboti.de/<span class="url-id">id</span></div>
      </div>

      <button class="your-btn notes-btn" @click.stop="router.push('/notes?list=1')">
        <svg viewBox="0 0 14 14" fill="none" xmlns="http://www.w3.org/2000/svg">
          <path d="M1 3.5h12M1 7h12M1 10.5h8" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/>
        </svg>
        {{ t('more.notes.your') }}
      </button>
    </div>

  </div>
</template>

<style scoped>
.more-view {
  display: flex; flex-wrap: wrap; gap: 20px; align-content: flex-start;
}

/* >>> Service card <<< */
.service-card {
  position: relative;
  background: #1a1a1e; border: 1px solid #2a2a30;
  width: 280px; display: flex; flex-direction: column; gap: 0;
  cursor: pointer; transition: border-color .2s, transform .15s;
  overflow: hidden;
}
.service-card:hover { border-color: #3a3a44; transform: translateY(-2px); }
.service-card:active { transform: translateY(0); }

/* >>> Icon area <<< */
.card-icon {
  height: 140px; display: flex; align-items: center; justify-content: center;
  background: #111217; border-bottom: 1px solid #2a2a30;
}
.card-icon svg { width: 72px; height: 72px; }
.images-icon { color: #9d6cff; }
.notes-icon  { color: #4ec9b0; }

/* >>> Body <<< */
.card-body {
  padding: 16px 18px 10px; display: flex; flex-direction: column; gap: 5px;
}
.card-title { font-size: 18px; font-weight: 700; color: #e0e0e0; }
.card-sub   { font-size: 12px; color: #555; }
.card-url   {
  font-family: 'Consolas','Fira Mono',monospace; font-size: 11px;
  color: #444; margin-top: 4px;
}
.url-id { color: #9d6cff; }
.notes-icon ~ .card-body .url-id { color: #4ec9b0; }

/* >>> "Your files/notes" button <<< */
.your-btn {
  display: flex; align-items: center; gap: 7px;
  margin: 0 12px 14px; height: 32px; padding: 0 12px;
  border: 1px solid #9d6cff44; background: rgba(111,43,255,.06);
  color: #9d6cff; font-family: inherit; font-size: 11px; font-weight: 600;
  cursor: pointer; transition: all .15s; align-self: flex-start;
}
.your-btn:hover { background: rgba(111,43,255,.16); border-color: #9d6cff88; }
.your-btn svg { width: 13px; height: 13px; flex-shrink: 0; }
.notes-btn { border-color: #4ec9b044; color: #4ec9b0; background: rgba(78,201,176,.06); }
.notes-btn:hover { background: rgba(78,201,176,.16); border-color: #4ec9b088; }

@media (max-width: 680px) {
  .more-view { gap: 14px; }
  .service-card { width: 100%; }
}
</style>
