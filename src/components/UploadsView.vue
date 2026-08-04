<script setup lang="ts">
import { ref } from 'vue'
import { useRouter } from 'vue-router'
import { useI18n } from '../i18n'
import { useAuth } from '../auth'
import { API } from '../api'

const { t } = useI18n()
const router = useRouter()
const { session } = useAuth()

const showChatterino  = ref(false)
const showToken       = ref(false)
const copied          = ref('')
const uploadToken     = ref('')
const tokenLoading    = ref(false)

function copyText(text: string, key: string) {
  navigator.clipboard.writeText(text).catch(() => {})
  copied.value = key
  setTimeout(() => { if (copied.value === key) copied.value = '' }, 1500)
}

async function openChatterino() {
  showChatterino.value = true
  if (!session.value || uploadToken.value) return
  tokenLoading.value = true
  try {
    const res = await fetch(`${API}/upload-tokens`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${session.value.token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ label: 'Chatterino' }),
    })
    if (res.ok) {
      const data = await res.json() as { token: string }
      uploadToken.value = data.token
    }
  } catch {}
  tokenLoading.value = false
}
</script>

<template>
  <div class="uploads-view">

    <!-- Images card -->
    <div class="service-card" @click="router.push('/images')">
      <div class="card-icon images-icon">
        <svg viewBox="0 0 48 48" fill="none" xmlns="http://www.w3.org/2000/svg">
          <rect x="4" y="8" width="40" height="32" rx="4" stroke="currentColor" stroke-width="2.5"/>
          <path d="M4 32L14 20L22 28L30 18L44 32" stroke="currentColor" stroke-width="2.5" stroke-linejoin="round" stroke-linecap="round"/>
          <circle cx="34" cy="20" r="4" stroke="currentColor" stroke-width="2.5"/>
          <circle cx="38" cy="12" r="7" fill="#6f2bff" opacity="0.9"/>
          <path d="M38 15.5V9M35.5 11.5L38 9L40.5 11.5" stroke="white" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>
        </svg>
      </div>
      <div class="card-body">
        <div class="card-title">{{ t('more.images') }}</div>
        <div class="card-sub">{{ t('more.images.sub') }}</div>
        <div class="card-url">i.shyboti.de/<span class="url-id">id</span></div>
      </div>
      <div class="card-btns">
        <button v-if="session" class="your-btn" @click.stop="router.push('/images?gallery=1')">
          <svg viewBox="0 0 14 14" fill="none" xmlns="http://www.w3.org/2000/svg">
            <rect x="1" y="1" width="5" height="5" rx="0.8" stroke="currentColor" stroke-width="1.4"/>
            <rect x="8" y="1" width="5" height="5" rx="0.8" stroke="currentColor" stroke-width="1.4"/>
            <rect x="1" y="8" width="5" height="5" rx="0.8" stroke="currentColor" stroke-width="1.4"/>
            <rect x="8" y="8" width="5" height="5" rx="0.8" stroke="currentColor" stroke-width="1.4"/>
          </svg>
          {{ t('more.images.your') }}
        </button>
        <button class="chatterino-btn" @click.stop="openChatterino()">
          <svg viewBox="0 0 14 14" fill="none" xmlns="http://www.w3.org/2000/svg">
            <circle cx="7" cy="7" r="6" stroke="currentColor" stroke-width="1.4"/>
            <path d="M7 6v4M7 4.5v.5" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/>
          </svg>
          Chatterino
        </button>
      </div>
    </div>

    <!-- Notes card -->
    <div class="service-card" @click="router.push('/notes')">
      <div class="card-icon notes-icon">
        <svg viewBox="0 0 48 48" fill="none" xmlns="http://www.w3.org/2000/svg">
          <rect x="8" y="4" width="28" height="36" rx="3" stroke="currentColor" stroke-width="2.5"/>
          <path d="M28 4V14H36" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/>
          <path d="M14 20h16M14 26h16M14 32h10" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"/>
          <circle cx="38" cy="38" r="7" fill="#4ec9b0" opacity="0.9"/>
          <path d="M38 41V35M35.5 37.5L38 35L40.5 37.5" stroke="white" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>
        </svg>
      </div>
      <div class="card-body">
        <div class="card-title">{{ t('more.notes') }}</div>
        <div class="card-sub">{{ t('more.notes.sub') }}</div>
        <div class="card-url">n.shyboti.de/<span class="url-id notes-url-id">id</span></div>
      </div>
      <button v-if="session" class="your-btn notes-btn" @click.stop="router.push('/notes?list=1')">
        <svg viewBox="0 0 14 14" fill="none" xmlns="http://www.w3.org/2000/svg">
          <path d="M1 3.5h12M1 7h12M1 10.5h8" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/>
        </svg>
        {{ t('more.notes.your') }}
      </button>
    </div>

  </div>

  <!-- Chatterino popup -->
  <Teleport to="body">
    <div v-if="showChatterino" class="modal-backdrop" @click.self="showChatterino = false; showToken = false">
      <div class="modal">
        <div class="modal-header">
          <span class="modal-title">{{ t('more.chatterino.header') }}</span>
          <button class="modal-close" @click="showChatterino = false">✕</button>
        </div>
        <div class="modal-body">
          <div class="mc-row">
            <span class="mc-label">Request URL</span>
            <code class="mc-val">https://shyboti.de/api/images/upload</code>
            <button class="mc-copy" @click="copyText('https://shyboti.de/api/images/upload', 'url')">{{ copied === 'url' ? '✓' : 'copy' }}</button>
          </div>
          <div class="mc-row">
            <span class="mc-label">Form field</span>
            <code class="mc-val">file</code>
            <button class="mc-copy" @click="copyText('file', 'field')">{{ copied === 'field' ? '✓' : 'copy' }}</button>
          </div>
          <div class="mc-row">
            <span class="mc-label">Image link</span>
            <code class="mc-val">https://i.shyboti.de/{id}</code>
            <button class="mc-copy" @click="copyText('https://i.shyboti.de/{id}', 'link')">{{ copied === 'link' ? '✓' : 'copy' }}</button>
          </div>
          <div class="mc-row">
            <span class="mc-label">Deletion URL</span>
            <code class="mc-val mc-muted">(leave empty)</code>
          </div>
          <div class="mc-divider"></div>
          <div class="mc-bind-hint">{{ t('more.chatterino.bind_hint') }}</div>
          <div class="mc-row">
            <span class="mc-label">Extra headers <span class="mc-optional">optional</span></span>
            <code v-if="!session" class="mc-val mc-muted">Log in to see</code>
            <code v-else-if="tokenLoading" class="mc-val mc-muted">Generating…</code>
            <code v-else class="mc-val mc-token">{{ showToken ? 'Upload-ID: ' + uploadToken : '••••••••••••••••••••••' }}</code>
            <button v-if="session && !tokenLoading" class="mc-eye" @click="showToken = !showToken">
              <svg v-if="!showToken" viewBox="0 0 14 14" fill="none" xmlns="http://www.w3.org/2000/svg">
                <ellipse cx="7" cy="7" rx="5.5" ry="3.5" stroke="currentColor" stroke-width="1.3"/>
                <circle cx="7" cy="7" r="1.5" fill="currentColor"/>
              </svg>
              <svg v-else viewBox="0 0 14 14" fill="none" xmlns="http://www.w3.org/2000/svg">
                <path d="M2 2l10 10M5.5 4.2A5.5 3.5 0 0 1 7 3.5c3 0 5.5 3.5 5.5 3.5s-.8 1.2-2.1 2.2M8.5 9.8A5.3 5.3 0 0 1 7 10.5c-3 0-5.5-3.5-5.5-3.5s.8-1.2 2.1-2.2" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/>
              </svg>
            </button>
            <button v-if="session && !tokenLoading" class="mc-copy" @click="copyText('Upload-ID: ' + uploadToken, 'token')">{{ copied === 'token' ? '✓' : 'copy' }}</button>
          </div>
        </div>
      </div>
    </div>
  </Teleport>
</template>

<style scoped>
.uploads-view { display: flex; flex-wrap: wrap; gap: 20px; align-content: flex-start; }

.service-card {
  position: relative; background: #1a1a1e; border: 1px solid #2a2a30;
  width: 280px; display: flex; flex-direction: column; gap: 0;
  cursor: pointer; transition: border-color .2s, transform .15s; overflow: hidden;
}
.service-card:hover { border-color: #3a3a44; transform: translateY(-2px); }
.service-card:active { transform: translateY(0); }

.card-icon {
  height: 140px; display: flex; align-items: center; justify-content: center;
  background: #111217; border-bottom: 1px solid #2a2a30;
}
.card-icon svg { width: 72px; height: 72px; }
.images-icon { color: #9d6cff; }
.notes-icon  { color: #4ec9b0; }

.card-body { padding: 16px 18px 10px; display: flex; flex-direction: column; gap: 5px; }
.card-title { font-size: 18px; font-weight: 700; color: #e0e0e0; }
.card-sub   { font-size: 12px; color: #555; }
.card-url   { font-family: 'Consolas','Fira Mono',monospace; font-size: 11px; color: #444; margin-top: 4px; }
.url-id { color: #9d6cff; }
.notes-url-id { color: #4ec9b0; }

.card-btns { display: flex; align-items: center; gap: 8px; margin: 0 12px 14px; flex-wrap: wrap; }
.card-btns .your-btn { margin: 0; }

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

.chatterino-btn {
  display: flex; align-items: center; gap: 5px; height: 32px; padding: 0 10px;
  border: 1px solid #2a2a30; background: transparent;
  color: #555; font-family: inherit; font-size: 10px; font-weight: 600; cursor: pointer;
}
.chatterino-btn:hover { border-color: #9d6cff55; color: #9d6cff; background: rgba(111,43,255,.06); }
.chatterino-btn svg { width: 11px; height: 11px; flex-shrink: 0; }

.modal-backdrop {
  position: fixed; inset: 0; z-index: 9999; background: rgba(0,0,0,.6);
  display: flex; align-items: center; justify-content: center;
}
.modal {
  background: #141418; border: 1px solid #2a2a30;
  width: min(480px, 95vw); display: flex; flex-direction: column;
}
.modal-header {
  display: flex; align-items: center; justify-content: space-between;
  padding: 14px 18px; border-bottom: 1px solid #1e1e24;
}
.modal-title { font-size: 13px; font-weight: 700; color: #e0e0e0; }
.modal-close { width: 24px; height: 24px; border: none; background: transparent; color: #555; font-size: 12px; cursor: pointer; }
.modal-close:hover { color: #e0e0e0; }
.modal-body { padding: 16px 18px; display: flex; flex-direction: column; gap: 8px; }
.mc-row { display: flex; align-items: center; gap: 8px; min-height: 24px; }
.mc-label { font-size: 10px; color: #555; width: 100px; flex-shrink: 0; display: flex; align-items: center; gap: 5px; }
.mc-optional { font-size: 9px; color: #333; background: #1a1a20; padding: 1px 5px; }
.mc-val { flex: 1; font-family: 'Consolas','Fira Mono',monospace; font-size: 11px; color: #9d6cff; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.mc-muted { color: #3a3a44; }
.mc-token { color: #e5c07b; font-size: 10px; }
.mc-copy { height: 20px; padding: 0 8px; border: 1px solid #2a2a3055; background: transparent; color: #555; font-family: inherit; font-size: 9px; cursor: pointer; flex-shrink: 0; white-space: nowrap; }
.mc-copy:hover { background: #6f2bff18; color: #9d6cff; border-color: #6f2bff44; }
.mc-eye { width: 22px; height: 20px; border: 1px solid #2a2a30; background: transparent; color: #555; cursor: pointer; flex-shrink: 0; display: flex; align-items: center; justify-content: center; padding: 0; }
.mc-eye:hover { color: #9d6cff; border-color: #6f2bff44; }
.mc-eye svg { width: 12px; height: 12px; }
.mc-divider { height: 1px; background: #1e1e24; margin: 4px 0; }
.mc-bind-hint { font-size: 10px; color: #666; padding: 2px 0 4px; }

@media (max-width: 680px) {
  .uploads-view { gap: 14px; }
  .service-card { width: 100%; }
}
</style>
