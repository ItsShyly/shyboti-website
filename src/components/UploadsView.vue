<script setup lang="ts">
import { ref } from "vue";
import { useRouter } from "vue-router";
import { useI18n } from "../i18n";
import { useAuth } from "../auth";
import { API } from "../api";
import { iconSvg as iconSvgFor } from "../composables/icons";

const { t } = useI18n();
const router = useRouter();
const { session } = useAuth();

const showChatterino = ref(false);
const showToken = ref(false);
const copied = ref("");
const uploadToken = ref("");
const tokenLoading = ref(false);

function copyText(text: string, key: string) {
  navigator.clipboard.writeText(text).catch(() => { });
  copied.value = key;
  setTimeout(() => {
    if (copied.value === key) copied.value = "";
  }, 1500);
}

async function openChatterino() {
  showChatterino.value = true;
  if (!session.value || uploadToken.value) return;
  tokenLoading.value = true;
  try {
    const res = await fetch(`${API}/upload-tokens`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${session.value.token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ label: "Chatterino" }),
    });
    if (res.ok) {
      const data = (await res.json()) as { token: string };
      uploadToken.value = data.token;
    }
  } catch { }
  tokenLoading.value = false;
}
</script>

<template>
  <div class="uploads-view">
    <div class="tool-row" @click="router.push('/images')">
      <div class="tool-main">
        <span class="tool-name">{{ t("uploads.images") }}</span>
        <span class="tool-sub">{{ t("uploads.images.sub") }}</span>
      </div>
      <span class="tool-url">i.shyboti.de/<span class="url-id">id</span></span>
      <div class="tool-actions">
        <button v-if="session" class="tool-action" @click.stop="router.push('/images?gallery=1')">
          {{ t("uploads.images.your") }}
        </button>
        <button class="tool-action" @click.stop="openChatterino()">
          Chatterino
        </button>
      </div>
    </div>

    <div class="tool-row" @click="router.push('/notes')">
      <div class="tool-main">
        <span class="tool-name">{{ t("uploads.notes") }}</span>
        <span class="tool-sub">{{ t("uploads.notes.sub") }}</span>
      </div>
      <span class="tool-url">n.shyboti.de/<span class="url-id">id</span></span>
      <div class="tool-actions">
        <button v-if="session" class="tool-action" @click.stop="router.push('/notes?list=1')">
          {{ t("uploads.notes.your") }}
        </button>
      </div>
    </div>
  </div>

  <Teleport to="body">
    <div v-if="showChatterino" class="modal-backdrop" @click.self="
      showChatterino = false;
    showToken = false;
    ">
      <div class="modal">
        <div class="modal-header">
          <span class="modal-title">{{ t("uploads.chatterino.header") }}</span>
          <button class="modal-close" @click="showChatterino = false" v-html="iconSvgFor('x')"></button>
        </div>
        <div class="modal-body">
          <div class="mc-row">
            <span class="mc-label">Request URL</span>
            <code class="mc-val">https://shyboti.de/api/images/upload</code>
            <button class="mc-copy" @click="copyText('https://shyboti.de/api/images/upload', 'url')">
              <span v-if="copied === 'url'" v-html="iconSvgFor('check')"></span>
              <template v-else>copy</template>
            </button>
          </div>
          <div class="mc-row">
            <span class="mc-label">Form field</span>
            <code class="mc-val">file</code>
            <button class="mc-copy" @click="copyText('file', 'field')">
              <span v-if="copied === 'field'" v-html="iconSvgFor('check')"></span>
              <template v-else>copy</template>
            </button>
          </div>
          <div class="mc-row">
            <span class="mc-label">Image link</span>
            <code class="mc-val">https://i.shyboti.de/{id}</code>
            <button class="mc-copy" @click="copyText('https://i.shyboti.de/{id}', 'link')">
              <span v-if="copied === 'link'" v-html="iconSvgFor('check')"></span>
              <template v-else>copy</template>
            </button>
          </div>
          <div class="mc-row">
            <span class="mc-label">Deletion URL</span>
            <code class="mc-val mc-muted">(leave empty)</code>
          </div>
          <div class="mc-divider"></div>
          <div class="mc-bind-hint">{{ t("uploads.chatterino.bind_hint") }}</div>
          <div class="mc-row">
            <span class="mc-label">Extra headers <span class="mc-optional">optional</span></span>
            <code v-if="!session" class="mc-val mc-muted">Log in to see</code>
            <code v-else-if="tokenLoading" class="mc-val mc-muted">Generating…</code>
            <code v-else class="mc-val mc-token">{{
              showToken ? "Upload-ID: " + uploadToken : "••••••••••••••••••••••"
            }}</code>
            <button v-if="session && !tokenLoading" class="mc-eye" @click="showToken = !showToken">
              <svg v-if="!showToken" viewBox="0 0 14 14" fill="none" xmlns="http://www.w3.org/2000/svg">
                <ellipse cx="7" cy="7" rx="5.5" ry="3.5" stroke="currentColor" stroke-width="1.3" />
                <circle cx="7" cy="7" r="1.5" fill="currentColor" />
              </svg>
              <svg v-else viewBox="0 0 14 14" fill="none" xmlns="http://www.w3.org/2000/svg">
                <path
                  d="M2 2l10 10M5.5 4.2A5.5 3.5 0 0 1 7 3.5c3 0 5.5 3.5 5.5 3.5s-.8 1.2-2.1 2.2M8.5 9.8A5.3 5.3 0 0 1 7 10.5c-3 0-5.5-3.5-5.5-3.5s.8-1.2 2.1-2.2"
                  stroke="currentColor" stroke-width="1.3" stroke-linecap="round" />
              </svg>
            </button>
            <button v-if="session && !tokenLoading" class="mc-copy"
              @click="copyText('Upload-ID: ' + uploadToken, 'token')">
              <span v-if="copied === 'token'" v-html="iconSvgFor('check')"></span>
              <template v-else>copy</template>
            </button>
          </div>
        </div>
      </div>
    </div>
  </Teleport>
</template>

<style scoped>
.uploads-view {
  display: flex;
  flex-direction: column;
  max-width: 560px;
}

.tool-row {
  display: flex;
  align-items: center;
  gap: 14px;
  padding: 12px 14px;
  background: #1a1a1e;
  border: 1px solid #2a2a30;
  border-bottom: none;
  cursor: pointer;
  transition: background 0.1s;
  flex-wrap: wrap;
}

.tool-row:last-child {
  border-bottom: 1px solid #2a2a30;
}

.tool-row:hover {
  background: #1e1e22;
}

.tool-main {
  display: flex;
  align-items: baseline;
  gap: 10px;
  flex: 1;
  min-width: 160px;
}

.tool-name {
  font-size: 13px;
  font-weight: 700;
  color: #e0e0e0;
  flex-shrink: 0;
}

.tool-sub {
  font-size: 11px;
  color: #555;
}

.tool-url {
  font-family: "Consolas", "Fira Mono", monospace;
  font-size: 11px;
  color: #444;
  flex-shrink: 0;
}

.url-id {
  color: #9d6cff;
}

.tool-actions {
  display: flex;
  gap: 8px;
  flex-shrink: 0;
}

.tool-action {
  height: 26px;
  padding: 0 10px;
  border: 1px solid #2a2a30;
  background: transparent;
  color: #888;
  font-family: inherit;
  font-size: 11px;
  cursor: pointer;
}

.tool-action:hover {
  border-color: #6f2bff55;
  color: #9d6cff;
  background: #6f2bff0c;
}

.modal-backdrop {
  position: fixed;
  inset: 0;
  z-index: 9999;
  background: rgba(0, 0, 0, 0.6);
  display: flex;
  align-items: center;
  justify-content: center;
}

.modal {
  background: #141418;
  border: 1px solid #2a2a30;
  width: min(480px, 95vw);
  display: flex;
  flex-direction: column;
}

.modal-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 14px 18px;
  border-bottom: 1px solid #1e1e24;
}

.modal-title {
  font-size: 13px;
  font-weight: 700;
  color: #e0e0e0;
}

.modal-close {
  width: 24px;
  height: 24px;
  border: none;
  background: transparent;
  color: #555;
  font-size: 12px;
  cursor: pointer;
}

.modal-close:hover {
  color: #e0e0e0;
}

.modal-body {
  padding: 16px 18px;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.mc-row {
  display: flex;
  align-items: center;
  gap: 8px;
  min-height: 24px;
}

.mc-label {
  font-size: 10px;
  color: #555;
  width: 100px;
  flex-shrink: 0;
  display: flex;
  align-items: center;
  gap: 5px;
}

.mc-optional {
  font-size: 9px;
  color: #333;
  background: #1a1a20;
  padding: 1px 5px;
}

.mc-val {
  flex: 1;
  font-family: "Consolas", "Fira Mono", monospace;
  font-size: 11px;
  color: #9d6cff;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.mc-muted {
  color: #3a3a44;
}

.mc-token {
  color: #e5c07b;
  font-size: 10px;
}

.mc-copy {
  height: 20px;
  padding: 0 8px;
  border: 1px solid #2a2a3055;
  background: transparent;
  color: #555;
  font-family: inherit;
  font-size: 9px;
  cursor: pointer;
  flex-shrink: 0;
  white-space: nowrap;
}

.mc-copy:hover {
  background: #6f2bff18;
  color: #9d6cff;
  border-color: #6f2bff44;
}

.mc-eye {
  width: 22px;
  height: 20px;
  border: 1px solid #2a2a30;
  background: transparent;
  color: #555;
  cursor: pointer;
  flex-shrink: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 0;
}

.mc-eye:hover {
  color: #9d6cff;
  border-color: #6f2bff44;
}

.mc-eye svg {
  width: 12px;
  height: 12px;
}

.mc-divider {
  height: 1px;
  background: #1e1e24;
  margin: 4px 0;
}

.mc-bind-hint {
  font-size: 10px;
  color: #666;
  padding: 2px 0 4px;
}

@media (max-width: 680px) {
  .tool-row {
    flex-direction: column;
    align-items: flex-start;
    gap: 8px;
  }
}
</style>
