<script setup lang="ts">
import { ref, computed, onMounted, watch } from "vue";
import { useRouter } from "vue-router";
import { API } from "../api";
import { useAuth } from "../auth";
import { useI18n } from "../i18n";

const { session, channelRole, adminMode, logout, switchChannel } = useAuth();
const { t } = useI18n();
const router = useRouter();

const isBroadcaster = ref(false);
// >>> default true so real users don't see Remove Bot flash away before channelRole loads
const botPresent = computed(() => channelRole.value?.botPresent ?? true);

// >>> danger zone also unlocks in admin mode, so an admin can act on any channel
const dangerZoneUnlocked = computed(
  () => isBroadcaster.value || (!!session.value?.isAdmin && adminMode.value),
);

// >>> Remove Bot only makes sense if there's a bot to remove
const canRemoveBotCard = computed(
  () => dangerZoneUnlocked.value && botPresent.value,
);

// >>> Prefix
const prefix = ref("+");
const prefixSaving = ref(false);
const prefixSaved = ref(false);
const prefixError = ref("");

// >>> Log opt-out
const optedOut = ref(false);
const optSaving = ref(false);
const optMsg = ref("");

// >>> Vanish hide
const vanishHide = ref(false);
const vanishSaving = ref(false);
const vanishMsg = ref("");

// >>> Name history opt-out
const nameHistOptedOut = ref(false);
const nameHistSaving = ref(false);
const nameHistMsg = ref("");

// >>> 7TV
interface EmoteSetInfo {
  setId: string | null;
  setName: string | null;
  emoteCount?: number;
}
const emoteSet = ref<EmoteSetInfo>({ setId: null, setName: null });
const emoteSetLoading = ref(false);
const emoteSetSaving = ref(false);
const emoteSetError = ref("");
const emoteSetSuccess = ref("");
const emoteInput7tv = ref("");
const emoteInputId = ref("");

// >>> Remove bot
const removeConfirm = ref(false);
const removeRemoving = ref(false);
const removeMsg = ref("");
const removeError = ref("");

// >>> Hidden tips reset
const tipsResetMsg = ref("");

function resetAllHiddenInfos() {
  const prefix = "shyboti_snippet_info_hidden_";
  const toRemove: string[] = [];
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    if (key && key.startsWith(prefix)) toRemove.push(key);
  }
  toRemove.forEach((k) => localStorage.removeItem(k));
  tipsResetMsg.value = "All hidden tips have been restored.";
  setTimeout(() => (tipsResetMsg.value = ""), 3000);
}

async function load() {
  if (!session.value) return;
  isBroadcaster.value = session.value.login === session.value.channel;
  const headers = { Authorization: `Bearer ${session.value.token}` };
  try {
    const [sRes, oRes, nhRes] = await Promise.all([
      fetch(`${API}/settings/${session.value.channel}`, { headers }),
      fetch(`${API}/log-optout`, { headers }),
      fetch(`${API}/name-history-optout`, { headers }),
    ]);
    if (sRes.ok) {
      const d = await sRes.json();
      prefix.value = d.prefix ?? d.settings?.prefix ?? "+";
      vanishHide.value = d.hide_vanish_timeouts ?? false;
    }
    if (oRes.ok) {
      const d = await oRes.json();
      optedOut.value = d.opted_out ?? false;
    }
    if (nhRes.ok) {
      const d = await nhRes.json();
      nameHistOptedOut.value = d.opted_out ?? false;
    }
  } catch { }
}

async function load7tvSet() {
  if (!session.value) return;
  emoteSetLoading.value = true;
  try {
    const res = await fetch(`${API}/settings/7tv/${session.value.channel}`, {
      headers: { Authorization: `Bearer ${session.value.token}` },
    });
    if (res.ok) emoteSet.value = await res.json();
  } catch { }
  emoteSetLoading.value = false;
}

async function loadAll() {
  await load();
  await load7tvSet();
}
onMounted(loadAll);
watch(() => session.value?.channel, loadAll);

async function savePrefix() {
  if (!session.value || !isBroadcaster.value) return;
  if (!prefix.value.trim()) {
    prefixError.value = t("settings.prefix.error.empty");
    return;
  }
  prefixError.value = "";
  prefixSaving.value = true;
  try {
    const res = await fetch(`${API}/settings/${session.value.channel}`, {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${session.value.token}`,
      },
      body: JSON.stringify({ prefix: prefix.value }),
    });
    if (!res.ok) throw new Error();
    prefixSaved.value = true;
    setTimeout(() => (prefixSaved.value = false), 2000);
  } catch {
    prefixError.value = t("settings.prefix.error.save");
  }
  prefixSaving.value = false;
}

async function toggleOptOut() {
  if (!session.value) return;
  optSaving.value = true;
  optMsg.value = "";
  try {
    await fetch(`${API}/log-optout`, {
      method: optedOut.value ? "DELETE" : "POST",
      headers: { Authorization: `Bearer ${session.value.token}` },
    });
    optedOut.value = !optedOut.value;
    optMsg.value = optedOut.value
      ? t("settings.optout.msg.out")
      : t("settings.optout.msg.in");
    setTimeout(() => (optMsg.value = ""), 3000);
  } catch {
    optMsg.value = t("settings.optout.error");
  }
  optSaving.value = false;
}

async function toggleNameHistOptOut() {
  if (!session.value) return;
  nameHistSaving.value = true;
  nameHistMsg.value = "";
  try {
    await fetch(`${API}/name-history-optout`, {
      method: nameHistOptedOut.value ? "DELETE" : "POST",
      headers: { Authorization: `Bearer ${session.value.token}` },
    });
    nameHistOptedOut.value = !nameHistOptedOut.value;
    nameHistMsg.value = nameHistOptedOut.value
      ? "Previous usernames are now hidden."
      : "Previous usernames are now visible.";
    setTimeout(() => (nameHistMsg.value = ""), 3000);
  } catch {
    nameHistMsg.value = "Failed to update preference.";
  }
  nameHistSaving.value = false;
}

async function saveVanish() {
  if (!session.value || !isBroadcaster.value) return;
  vanishSaving.value = true;
  vanishMsg.value = "";
  try {
    await fetch(`${API}/settings/${session.value.channel}`, {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${session.value.token}`,
      },
      body: JSON.stringify({ hide_vanish_timeouts: vanishHide.value }),
    });
    vanishMsg.value = vanishHide.value
      ? "Vanish timeouts hidden from dashboard."
      : "Vanish timeouts will show in dashboard.";
    setTimeout(() => (vanishMsg.value = ""), 3000);
  } catch {
    vanishMsg.value = "Failed to save.";
  }
  vanishSaving.value = false;
}

async function fetch7tvSet() {
  if (!session.value || !isBroadcaster.value) return;
  const channelName = emoteInput7tv.value.trim().replace(/^#/, "");
  const setId = emoteInputId.value.trim();
  if (!channelName && !setId) return;
  emoteSetSaving.value = true;
  emoteSetError.value = "";
  emoteSetSuccess.value = "";
  try {
    const res = await fetch(`${API}/settings/7tv/${session.value.channel}`, {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${session.value.token}`,
      },
      body: JSON.stringify(channelName ? { channelName } : { setId }),
    });
    const d = (await res.json()) as any;
    if (!res.ok) throw new Error(d.error ?? "Failed");
    emoteSet.value = {
      setId: d.setId,
      setName: d.setName,
      emoteCount: d.emoteCount,
    };
    emoteInput7tv.value = "";
    emoteInputId.value = "";
    emoteSetSuccess.value = `${d.setName ?? d.setId} (${d.emoteCount ?? "?"} ${t("settings.7tv.emotes")})`;
    setTimeout(() => (emoteSetSuccess.value = ""), 4000);
  } catch (e: any) {
    emoteSetError.value = e.message ?? t("settings.7tv.error");
  }
  emoteSetSaving.value = false;
}

async function remove7tvSet() {
  if (!session.value || !isBroadcaster.value) return;
  emoteSetSaving.value = true;
  emoteSetError.value = "";
  emoteSetSuccess.value = "";
  try {
    await fetch(`${API}/settings/7tv/${session.value.channel}`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${session.value.token}` },
    });
    emoteSet.value = { setId: null, setName: null };
  } catch {
    emoteSetError.value = t("settings.7tv.error");
  }
  emoteSetSaving.value = false;
}

function clickRemoveBot() {
  if (!removeConfirm.value) {
    removeConfirm.value = true;
    setTimeout(() => {
      removeConfirm.value = false;
    }, 8000);
    return;
  }
  doRemoveBot();
}

async function doRemoveBot() {
  if (!session.value || !canRemoveBotCard.value) return;
  removeConfirm.value = false;
  removeRemoving.value = true;
  removeError.value = "";
  try {
    const res = await fetch(`${API}/bot/leave/${session.value.channel}`, {
      method: "POST",
      headers: { Authorization: `Bearer ${session.value.token}` },
    });
    if (!res.ok) throw new Error();
    removeMsg.value = t("settings.remove.done");
  } catch {
    removeError.value = t("settings.remove.error");
  }
  removeRemoving.value = false;
}

// >>> Delete all data
const deleteConfirmInput = ref("");
const deleting = ref(false);
const deleteError = ref("");
const deleteConfirmValid = computed(
  () => deleteConfirmInput.value.trim() === "DELETE",
);

async function doDeleteAllData() {
  if (
    !session.value ||
    !dangerZoneUnlocked.value ||
    !deleteConfirmValid.value
  )
    return;
  const wasSelf = session.value.login === session.value.channel;
  const targetChannel = session.value.channel;
  deleting.value = true;
  deleteError.value = "";
  try {
    const res = await fetch(`${API}/account/delete/${targetChannel}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${session.value.token}`,
      },
      body: JSON.stringify({ confirm: deleteConfirmInput.value.trim() }),
    });
    if (!res.ok) throw new Error();
    if (wasSelf) {
      await logout();
      router.push("/");
    } else {
      await switchChannel(session.value.login);
      router.push("/dashboard");
    }
  } catch {
    deleteError.value = t("settings.delete.error");
  }
  deleting.value = false;
}
</script>

<template>
  <div class="settings">
    <div class="settings-header">
      <h2 class="settings-title">{{ t("settings.title") }}</h2>
      <p class="settings-sub">
        {{ t("settings.sub") }} <span class="chan">#{{ session?.channel }}</span>.
      </p>
    </div>

    <div class="settings-list">
      <div class="setting-row" v-if="isBroadcaster">
        <div class="setting-info">
          <div class="setting-label">{{ t("settings.prefix.title") }}</div>
          <div class="setting-desc">
            {{ t("settings.prefix.sub") }} <code class="code">{{ prefix }}</code>command.
          </div>
        </div>
        <div class="setting-control">
          <input v-model="prefix" class="prefix-input" maxlength="3" placeholder="+" @keydown.enter="savePrefix"
            spellcheck="false" />
          <span class="prefix-preview"><span class="pre">{{ prefix || "+" }}</span>ping</span>
          <button class="save-btn" @click="savePrefix" :disabled="prefixSaving || !prefix">
            <template v-if="prefixSaved">{{ t("settings.saved") }}</template>
            <template v-else-if="prefixSaving">{{ t("settings.saving") }}</template>
            <template v-else>{{ t("settings.prefix.save") }}</template>
          </button>
        </div>
      </div>
      <div v-if="prefixError" class="field-error">{{ prefixError }}</div>

      <div class="setting-row">
        <div class="setting-info">
          <div class="setting-label">{{ t("settings.optout.title") }}</div>
          <div class="setting-desc">{{ t("settings.optout.sub") }}</div>
        </div>
        <div class="setting-control">
          <span v-if="optMsg" class="setting-msg">{{ optMsg }}</span>
          <button class="ep-toggle-btn" :class="{ on: !optedOut }" @click="toggleOptOut" :disabled="optSaving">
            <span class="ep-toggle-knob"></span>
          </button>
        </div>
      </div>

      <div class="setting-row">
        <div class="setting-info">
          <div class="setting-label">Previous Usernames</div>
          <div class="setting-desc">
            Hide your previous Twitch usernames from being shown on other
            users' screens.
          </div>
        </div>
        <div class="setting-control">
          <span v-if="nameHistMsg" class="setting-msg">{{ nameHistMsg }}</span>
          <button class="ep-toggle-btn" :class="{ on: !nameHistOptedOut }" @click="toggleNameHistOptOut"
            :disabled="nameHistSaving">
            <span class="ep-toggle-knob"></span>
          </button>
        </div>
      </div>

      <div class="setting-row" v-if="isBroadcaster">
        <div class="setting-info">
          <div class="setting-label">Hide Vanish Timeouts</div>
          <div class="setting-desc">
            Hides short timeouts from the dashboard when the user typed
            <code class="code">!v</code>, <code class="code">!vanish</code>,
            <code class="code">+v</code> or <code class="code">+vanish</code>.
          </div>
        </div>
        <div class="setting-control">
          <span v-if="vanishMsg" class="setting-msg">{{ vanishMsg }}</span>
          <button class="ep-toggle-btn" :class="{ on: vanishHide }" @click="
            vanishHide = !vanishHide;
          saveVanish();
          " :disabled="vanishSaving">
            <span class="ep-toggle-knob"></span>
          </button>
        </div>
      </div>

      <div class="setting-block" v-if="isBroadcaster">
        <div class="setting-info">
          <div class="setting-label">{{ t("settings.7tv.title") }}</div>
          <div class="setting-desc">{{ t("settings.7tv.sub") }}</div>
        </div>
        <div class="setting-body">
          <div v-if="emoteSetLoading" class="block-loading">Loading...</div>
          <template v-else>
            <div v-if="emoteSet.setId" class="emote-current">
              <span class="emote-name">{{
                emoteSet.setName ?? emoteSet.setId
                }}</span>
              <span class="emote-id">{{ emoteSet.setId }}</span>
              <span v-if="emoteSet.emoteCount" class="emote-count">{{ emoteSet.emoteCount }} {{
                t("settings.7tv.emotes") }}</span>
              <button class="danger-sm" @click="remove7tvSet" :disabled="emoteSetSaving">
                {{
                  emoteSetSaving
                    ? t("settings.7tv.removing")
                    : t("settings.7tv.remove")
                }}
              </button>
            </div>
            <div v-else class="emote-none">{{ t("settings.7tv.none") }}</div>
            <div class="emote-row">
              <span class="emote-lbl">{{ t("settings.7tv.by_channel") }}</span>
              <button class="fetch-btn" :disabled="emoteSetSaving" @click="
                emoteInput7tv = session?.channel ?? '';
              emoteInputId = '';
              fetch7tvSet();
              ">
                {{
                  emoteSetSaving
                    ? t("settings.7tv.fetching")
                    : t("settings.7tv.fetch")
                }}
              </button>
            </div>
            <div class="emote-row">
              <span class="emote-lbl">{{ t("settings.7tv.by_id") }}</span>
              <input v-model="emoteInputId" class="field-sm" :placeholder="t('settings.7tv.by_id.ph')" @keydown.enter="
                emoteInput7tv = '';
              fetch7tvSet();
              " :disabled="emoteSetSaving" />
              <button class="fetch-btn" :disabled="emoteSetSaving || !emoteInputId.trim()" @click="
                emoteInput7tv = '';
              fetch7tvSet();
              ">
                {{
                  emoteSetSaving
                    ? t("settings.7tv.fetching")
                    : t("settings.7tv.fetch")
                }}
              </button>
            </div>
            <div v-if="emoteSetError" class="setting-msg err">
              {{ emoteSetError }}
            </div>
            <div v-if="emoteSetSuccess" class="setting-msg ok">
              {{ emoteSetSuccess }}
            </div>
          </template>
        </div>
      </div>

      <div class="setting-row">
        <div class="setting-info">
          <div class="setting-label">Hidden Tips</div>
          <div class="setting-desc">
            {{
              tipsResetMsg ||
              "Restore all info tips you've dismissed (e.g. the snippet hint in Logs)."
            }}
          </div>
        </div>
        <div class="setting-control">
          <button class="ep-btn-cancel" @click="resetAllHiddenInfos">
            Show all hidden Infos again
          </button>
        </div>
      </div>
    </div>

    <div class="danger-zone" v-if="canRemoveBotCard || dangerZoneUnlocked">
      <div class="danger-zone-title">Danger zone</div>

      <template v-if="canRemoveBotCard">
        <div class="danger-row">
          <div class="setting-info">
            <div class="setting-label warn">{{ t("settings.remove.title") }}</div>
            <div class="setting-desc">{{ t("settings.remove.sub") }}</div>
          </div>
          <div class="setting-control">
            <span v-if="removeMsg" class="setting-msg ok">{{ removeMsg }}</span>
            <span v-if="removeError" class="setting-msg err">{{ removeError }}</span>
            <button v-if="!removeMsg" class="remove-btn warn-btn" @click="clickRemoveBot" :disabled="removeRemoving">
              {{
                removeRemoving
                  ? t("settings.remove.removing")
                  : t("settings.remove.btn")
              }}
            </button>
          </div>
        </div>
        <div v-if="removeConfirm" class="confirm-box confirm-box-warning">
          <div class="confirm-text">
            {{ t("settings.remove.confirm")
            }}<strong>#{{ session?.channel }}</strong>?
            {{ t("settings.remove.confirm2") }}
          </div>
          <div class="confirm-actions">
            <button class="confirm-no" @click="removeConfirm = false">
              {{ t("settings.remove.no") }}
            </button>
            <button class="confirm-yes confirm-yes-warning" @click="doRemoveBot">
              {{ t("settings.remove.yes") }}
            </button>
          </div>
        </div>
      </template>

      <div class="danger-row" v-if="dangerZoneUnlocked">
        <div class="setting-info">
          <div class="setting-label danger">{{ t("settings.delete.title") }}</div>
          <div class="setting-desc">
            {{ t("settings.delete.sub") }}<strong>#{{ session?.channel }}</strong>.
            {{ t("settings.delete.type_prompt") }}<strong>DELETE</strong>
          </div>
        </div>
        <div class="setting-control delete-control">
          <input v-model="deleteConfirmInput" class="delete-confirm-input" type="text" placeholder="DELETE"
            :disabled="deleting" />
          <button class="remove-btn" :disabled="!deleteConfirmValid || deleting" @click="doDeleteAllData">
            {{
              deleting ? t("settings.delete.deleting") : t("settings.delete.btn")
            }}
          </button>
        </div>
      </div>
      <div v-if="deleteError" class="field-error">{{ deleteError }}</div>
    </div>
  </div>
</template>

<style scoped>
.settings {
  display: flex;
  flex-direction: column;
  gap: 24px;
}

.settings-header {
  padding-bottom: 16px;
  border-bottom: 1px solid #222;
}

.settings-title {
  font-size: 18px;
  font-weight: 700;
  color: #e0e0e0;
  margin-bottom: 4px;
}

.settings-sub {
  font-size: 12px;
  color: #666;
}

.chan {
  color: #9d6cff;
}

.settings-list {
  display: flex;
  flex-direction: column;
}

.setting-row,
.setting-block {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 20px;
  padding: 14px 4px;
  border-bottom: 1px solid #1e1e24;
  flex-wrap: wrap;
}

.setting-block {
  align-items: flex-start;
  flex-direction: column;
}

.setting-info {
  display: flex;
  flex-direction: column;
  gap: 3px;
  min-width: 220px;
}

.setting-label {
  font-size: 13px;
  font-weight: 700;
  color: #ccc;
}

.setting-label.warn {
  color: #f59e0b;
}

.setting-label.danger {
  color: #f14949;
}

.setting-desc {
  font-size: 11px;
  color: #555;
  line-height: 1.5;
}

.setting-control {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-shrink: 0;
}

.setting-body {
  width: 100%;
  display: flex;
  flex-direction: column;
  gap: 10px;
  margin-top: 4px;
}

.setting-msg {
  font-size: 11px;
  color: #23d18b;
}

.setting-msg.ok {
  color: #23d18b;
}

.setting-msg.err {
  color: #f14949;
}

.code {
  font-family: "Consolas", "Fira Mono", monospace;
  color: #9d6cff;
  font-size: 11px;
  background: rgba(111, 43, 255, 0.1);
  padding: 1px 5px;
}

.field-error {
  font-size: 11px;
  color: #f14949;
  padding: 0 4px 10px;
}

/* Prefix */
.prefix-input {
  width: 46px;
  background: #0d0d10;
  border: 1px solid #2a2a30;
  color: #e0e0e0;
  font-family: "Consolas", "Fira Mono", monospace;
  font-size: 16px;
  font-weight: 700;
  padding: 5px 8px;
  outline: none;
  text-align: center;
}

.prefix-input:focus {
  border-color: #6f2bff88;
}

.prefix-preview {
  font-family: "Consolas", "Fira Mono", monospace;
  font-size: 12px;
  color: #888;
}

.prefix-preview .pre {
  color: #9d6cff;
  font-weight: 700;
}

.save-btn {
  height: 30px;
  padding: 0 16px;
  border: none;
  background: #6f2bff;
  color: #fff;
  font-family: inherit;
  font-size: 11px;
  font-weight: 600;
  cursor: pointer;
  transition: background 0.15s;
}

.save-btn:hover:not(:disabled) {
  background: #7f3fff;
}

.save-btn:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}

.remove-btn {
  height: 30px;
  padding: 0 16px;
  border: 1px solid #f1494966;
  background: transparent;
  color: #f14949;
  font-family: inherit;
  font-size: 11px;
  font-weight: 600;
  cursor: pointer;
  transition:
    background 0.15s,
    border-color 0.15s;
}

.remove-btn:hover:not(:disabled) {
  background: rgba(241, 73, 73, 0.1);
  border-color: #f14949;
}

.remove-btn:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}

.warn-btn {
  border-color: #f59e0b66;
  color: #f59e0b;
}

.warn-btn:hover:not(:disabled) {
  background: rgba(245, 158, 11, 0.1);
  border-color: #f59e0b;
}

.delete-control {
  flex-wrap: wrap;
}

.delete-confirm-input {
  width: 120px;
  background: #0d0d10;
  border: 1px solid #f1494944;
  color: #e0e0e0;
  font-family: "Consolas", "Fira Mono", monospace;
  font-size: 12px;
  padding: 6px 8px;
  outline: none;
  box-sizing: border-box;
}

.delete-confirm-input:focus {
  border-color: #f14949;
}

/* 7TV block internals */
.block-loading {
  font-size: 12px;
  color: #555;
}

.emote-current {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
  background: #0d0d10;
  border: 1px solid #1e1e24;
  padding: 8px 12px;
}

.emote-name {
  font-size: 12px;
  font-weight: 700;
  color: #e0e0e0;
}

.emote-id {
  font-size: 10px;
  color: #555;
  font-family: monospace;
}

.emote-count {
  font-size: 11px;
  color: #9d6cff;
  background: rgba(111, 43, 255, 0.1);
  padding: 1px 6px;
}

.emote-none {
  font-size: 12px;
  color: #555;
}

.emote-row {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}

.emote-lbl {
  font-size: 11px;
  color: #666;
  min-width: 130px;
  white-space: nowrap;
}

.field-sm {
  height: 30px;
  flex: 1;
  min-width: 100px;
  background: #0d0d10;
  border: 1px solid #2a2a30;
  color: #e0e0e0;
  font-family: inherit;
  font-size: 11px;
  padding: 0 8px;
  outline: none;
}

.field-sm:focus {
  border-color: #6f2bff55;
}

.field-sm:disabled {
  opacity: 0.4;
}

.fetch-btn {
  height: 30px;
  padding: 0 14px;
  border: 1px solid #6f2bff44;
  background: transparent;
  color: #9d6cff;
  font-family: inherit;
  font-size: 11px;
  font-weight: 600;
  cursor: pointer;
  white-space: nowrap;
}

.fetch-btn:hover:not(:disabled) {
  background: rgba(111, 43, 255, 0.1);
}

.fetch-btn:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}

.danger-sm {
  height: 26px;
  padding: 0 10px;
  border: 1px solid #f1494944;
  background: transparent;
  color: #f14949;
  font-family: inherit;
  font-size: 10px;
  cursor: pointer;
  margin-left: auto;
}

.danger-sm:hover:not(:disabled) {
  background: rgba(241, 73, 73, 0.1);
}

.danger-sm:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}

/* Danger zone */
.danger-zone {
  display: flex;
  flex-direction: column;
  border: 1px solid #f1494930;
  background: #180f12;
  padding: 4px 16px;
}

.danger-zone-title {
  font-size: 10px;
  font-weight: 700;
  color: #f14949;
  text-transform: uppercase;
  letter-spacing: 0.08em;
  padding: 10px 0;
}

.danger-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 20px;
  padding: 12px 0;
  border-top: 1px solid #f1494920;
  flex-wrap: wrap;
}

/* Confirm dialog */
.confirm-box {
  background: rgba(241, 73, 73, 0.04);
  border: 1px solid #f1494930;
  padding: 12px;
  display: flex;
  flex-direction: column;
  gap: 10px;
  margin-bottom: 12px;
}

.confirm-text {
  font-size: 12px;
  color: #ccc;
  line-height: 1.6;
}

.confirm-text strong {
  color: #9d6cff;
}

.confirm-actions {
  display: flex;
  gap: 8px;
}

.confirm-no {
  height: 32px;
  padding: 0 14px;
  border: 1px solid #2a2a30;
  background: transparent;
  color: #888;
  font-family: inherit;
  font-size: 12px;
  cursor: pointer;
}

.confirm-no:hover {
  border-color: #555;
  color: #e0e0e0;
}

.confirm-yes {
  height: 32px;
  padding: 0 14px;
  border: none;
  background: #f14949;
  color: #fff;
  font-family: inherit;
  font-size: 12px;
  font-weight: 700;
  cursor: pointer;
}

.confirm-yes:hover {
  background: #ff5a5a;
}

.confirm-box-warning {
  background: rgba(245, 158, 11, 0.04);
  border-color: #f59e0b30;
}

.confirm-yes-warning {
  background: #f59e0b;
}

.confirm-yes-warning:hover {
  background: #ffb02e;
}

@media (max-width: 600px) {

  .setting-row,
  .setting-block,
  .danger-row {
    flex-direction: column;
    align-items: flex-start;
  }

  .setting-control {
    width: 100%;
  }
}
</style>
