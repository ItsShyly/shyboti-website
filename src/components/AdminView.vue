<script setup lang="ts">
import { ref, onMounted } from "vue";
import { useRouter } from "vue-router";
import { API } from "../api";
import { useAuth } from "../auth";
import { useI18n } from "../i18n";

const { session, switchChannel } = useAuth();
const { t } = useI18n();
const router = useRouter();

const channels = ref<string[]>([]);
const loading = ref(false);
const removeConfirm = ref<string | null>(null);
const removing = ref<string | null>(null);
const removeError = ref("");

async function loadChannels() {
  if (!session.value) return;
  loading.value = true;
  try {
    const res = await fetch(`${API}/channels`, {
      headers: { Authorization: `Bearer ${session.value.token}` },
    });
    if (!res.ok) return;
    const data = (await res.json()) as { channels: string[] };
    channels.value = data.channels;
  } catch {
  } finally {
    loading.value = false;
  }
}

async function enterChannel(channel: string) {
  await switchChannel(channel);
  router.push("/dashboard");
}

function clickRemoveBot(channel: string) {
  if (removeConfirm.value !== channel) {
    removeConfirm.value = channel;
    setTimeout(() => {
      if (removeConfirm.value === channel) removeConfirm.value = null;
    }, 8000);
    return;
  }
  doRemoveBot(channel);
}

async function doRemoveBot(channel: string) {
  if (!session.value) return;
  removeConfirm.value = null;
  removing.value = channel;
  removeError.value = "";
  try {
    const res = await fetch(`${API}/bot/leave/${channel}`, {
      method: "POST",
      headers: { Authorization: `Bearer ${session.value.token}` },
    });
    if (!res.ok) throw new Error();
    channels.value = channels.value.filter((c) => c !== channel);
  } catch {
    removeError.value = t("admin.remove_error");
  }
  removing.value = null;
}

onMounted(loadChannels);
</script>

<template>
  <div class="admin-page">
    <div class="admin-header">
      <h2 class="admin-title">{{ t("admin.title") }}</h2>
      <p class="admin-sub">{{ t("admin.sub") }}</p>
    </div>

    <div v-if="removeError" class="admin-error">{{ removeError }}</div>

    <div class="ep-row-list admin-list">
      <div v-if="!loading && channels.length === 0" class="admin-empty">
        {{ t("admin.no_channels") }}
      </div>
      <div v-for="ch in channels" :key="ch" class="ep-list-row">
        <span class="admin-channel-name">#{{ ch }}</span>
        <div class="ep-row-actions">
          <button class="ep-btn-action edit" @click="enterChannel(ch)">
            {{ t("admin.switch") }}
          </button>
          <button
            class="ep-btn-action del"
            :class="{ confirm: removeConfirm === ch }"
            :disabled="removing === ch"
            @click="clickRemoveBot(ch)"
          >
            {{
              removeConfirm === ch
                ? t("admin.remove_confirm")
                : t("admin.remove_bot")
            }}
          </button>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.admin-page {
  display: flex;
  flex-direction: column;
  gap: 20px;
  max-width: 720px;
}

.admin-header {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.admin-title {
  font-size: 20px;
  font-weight: 700;
  margin: 0;
}

.admin-sub {
  font-size: 13px;
  color: #888;
  margin: 0;
}

.admin-error {
  font-size: 12px;
  color: #f14949;
  background: rgba(241, 73, 73, 0.1);
  border: 1px solid #f1494944;
  padding: 8px 12px;
}

.admin-list {
  border: 1px solid #2a2a30;
}

.admin-empty {
  padding: 20px;
  text-align: center;
  color: #666;
  font-size: 13px;
}

.admin-channel-name {
  flex: 1;
  font-size: 13px;
  font-weight: 600;
  color: #e0e0e0;
}
</style>
