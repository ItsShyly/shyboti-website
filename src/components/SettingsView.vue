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

    <div class="cards-grid">
      <!-- >>> broadcaster only -->
      <div class="card" v-if="isBroadcaster">
        <div class="card-header">
          <div class="card-title">{{ t("settings.prefix.title") }}</div>
          <div class="card-sub">
            {{ t("settings.prefix.sub") }} <code class="code">{{ prefix }}</code>command.
          </div>
        </div>
        <div class="card-body">
          <div class="prefix-row">
            <input v-model="prefix" class="prefix-input" maxlength="3" placeholder="+" @keydown.enter="savePrefix"
              spellcheck="false" />
            <span class="prefix-preview"><span class="pre">{{ prefix || "+" }}</span>ping</span>
          </div>
          <div v-if="prefixError" class="field-error">{{ prefixError }}</div>
          <div class="section-note">{{ t("settings.prefix.note") }}</div>
        </div>
        <div class="card-footer">
          <button class="save-btn" @click="savePrefix" :disabled="prefixSaving || !prefix">
            {{
              prefixSaved
                ? t("settings.saved")
                : prefixSaving
                  ? t("settings.saving")
                  : t("settings.prefix.save")
            }}
          </button>
        </div>
      </div>

      <div class="card">
        <div class="card-header">
          <div class="card-title">{{ t("settings.optout.title") }}</div>
          <div class="card-sub">{{ t("settings.optout.sub") }}</div>
        </div>
        <div class="card-body">
          <div class="toggle-row">
            <div class="status-dot" :class="{ active: !optedOut }"></div>
            <span class="status-text">{{
              optedOut
                ? t("settings.optout.hidden")
                : t("settings.optout.visible")
            }}</span>
            <div class="spacer"></div>
            <span class="status-badge" :class="optedOut ? 'badge-off' : 'badge-on'">
              {{
                optedOut
                  ? t("settings.optout.badge.out")
                  : t("settings.optout.badge.in")
              }}
            </span>
          </div>
          <div v-if="optMsg" class="card-msg ok">{{ optMsg }}</div>
        </div>
        <div class="card-footer">
          <button class="toggle-btn" :class="{ 'toggle-btn-on': optedOut }" @click="toggleOptOut" :disabled="optSaving">
            {{
              optSaving
                ? "..."
                : optedOut
                  ? t("settings.optout.btn.in")
                  : t("settings.optout.btn.out")
            }}
          </button>
        </div>
      </div>

      <div class="card">
        <div class="card-header">
          <div class="card-title">Previous Usernames</div>
          <div class="card-sub">
            Hide your previous Twitch usernames from being shown on other users'
            screens.
          </div>
        </div>
        <div class="card-body">
          <div class="toggle-row">
            <div class="status-dot" :class="{ active: !nameHistOptedOut }"></div>
            <span class="status-text">{{
              nameHistOptedOut ? "Name history hidden" : "Name history visible"
              }}</span>
            <div class="spacer"></div>
            <span class="status-badge" :class="nameHistOptedOut ? 'badge-off' : 'badge-on'">
              {{ nameHistOptedOut ? "Hidden" : "Visible" }}
            </span>
          </div>
          <div v-if="nameHistMsg" class="card-msg ok">{{ nameHistMsg }}</div>
        </div>
        <div class="card-footer">
          <button class="toggle-btn" :class="{ 'toggle-btn-on': nameHistOptedOut }" @click="toggleNameHistOptOut"
            :disabled="nameHistSaving">
            {{
              nameHistSaving
                ? "..."
                : nameHistOptedOut
                  ? "Show Names"
                  : "Hide Names"
            }}
          </button>
        </div>
      </div>

      <!-- >>> broadcaster only -->
      <div class="card" v-if="isBroadcaster">
        <div class="card-header">
          <div class="card-title">Hide Vanish Timeouts</div>
          <div class="card-sub">
            Hides short timeouts from the dashboard when the user typed a vanish
            command.
          </div>
        </div>
        <div class="card-body">
          <div class="toggle-row">
            <div class="status-dot" :class="{ active: vanishHide }"></div>
            <span class="status-text">{{
              vanishHide ? "Vanish timeouts hidden" : "All timeouts visible"
              }}</span>
            <div class="spacer"></div>
            <span class="status-badge" :class="vanishHide ? 'badge-on' : 'badge-off'">
              {{ vanishHide ? "ON" : "OFF" }}
            </span>
          </div>
          <div class="section-note">
            Detects: <code class="code">!v</code>
            <code class="code">!vanish</code> <code class="code">+v</code>
            <code class="code">+vanish</code>
          </div>
          <div v-if="vanishMsg" class="card-msg ok">{{ vanishMsg }}</div>
        </div>
        <div class="card-footer">
          <button class="toggle-btn" :class="{ 'toggle-btn-on': vanishHide }" @click="
            vanishHide = !vanishHide;
          saveVanish();
          " :disabled="vanishSaving">
            {{ vanishSaving ? "..." : vanishHide ? "Disable" : "Enable" }}
          </button>
        </div>
      </div>

      <!-- >>> broadcaster only, spans 2 cols -->
      <div class="card card-wide" v-if="isBroadcaster">
        <div class="card-header">
          <div class="card-icon card-icon-7tv">&#10022;</div>
          <div class="card-title">{{ t("settings.7tv.title") }}</div>
          <div class="card-sub">{{ t("settings.7tv.sub") }}</div>
        </div>
        <div class="card-body">
          <div v-if="emoteSetLoading" class="card-loading">Loading...</div>
          <template v-else>
            <div v-if="emoteSet.setId" class="emote-current">
              <span class="emote-name">{{
                emoteSet.setName ?? emoteSet.setId
                }}</span>
              <span class="emote-id">{{ emoteSet.setId }}</span>
              <span v-if="emoteSet.emoteCount" class="emote-count">{{ emoteSet.emoteCount }} {{ t("settings.7tv.emotes")
                }}</span>
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
            <div v-if="emoteSetError" class="card-msg err">
              {{ emoteSetError }}
            </div>
            <div v-if="emoteSetSuccess" class="card-msg ok">
              &#10003; {{ emoteSetSuccess }}
            </div>
          </template>
        </div>
      </div>

      <!-- >>> broadcaster or admin-mode admin - warning, less severe than delete -->
      <div class="card card-warning" v-if="canRemoveBotCard">
        <div class="card-header">
          <div class="card-icon card-icon-warning">&#9888;</div>
          <div class="card-title">{{ t("settings.remove.title") }}</div>
          <div class="card-sub">{{ t("settings.remove.sub") }}</div>
        </div>
        <div class="card-body">
          <div v-if="removeMsg" class="card-msg ok">{{ removeMsg }}</div>
          <div v-if="removeError" class="card-msg err">{{ removeError }}</div>
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
        </div>
        <div class="card-footer" v-if="!removeMsg">
          <button class="remove-btn warn-btn" @click="clickRemoveBot" :disabled="removeRemoving">
            {{
              removeRemoving
                ? t("settings.remove.removing")
                : t("settings.remove.btn")
            }}
          </button>
        </div>
      </div>

      <!-- >>> broadcaster or admin-mode admin -->
      <div class="card card-danger" v-if="dangerZoneUnlocked">
        <div class="card-header">
          <div class="card-icon card-icon-danger">&#9888;</div>
          <div class="card-title">{{ t("settings.delete.title") }}</div>
          <div class="card-sub">
            {{ t("settings.delete.sub") }}<strong>#{{ session?.channel }}</strong>.
          </div>
        </div>
        <div class="card-body">
          <div v-if="deleteError" class="card-msg err">{{ deleteError }}</div>
          <div class="confirm-text">
            {{ t("settings.delete.type_prompt") }}<strong>DELETE</strong>
          </div>
          <input
            v-model="deleteConfirmInput"
            class="delete-confirm-input"
            type="text"
            placeholder="DELETE"
            :disabled="deleting"
          />
        </div>
        <div class="card-footer">
          <button
            class="remove-btn"
            :disabled="!deleteConfirmValid || deleting"
            @click="doDeleteAllData"
          >
            {{
              deleting
                ? t("settings.delete.deleting")
                : t("settings.delete.btn")
            }}
          </button>
        </div>
      </div>

      <div class="card">
        <div class="card-header">
          <div class="card-title">Hidden Tips</div>
          <div class="card-sub">
            Restore all info tips you've dismissed (e.g. the snippet hint in
            Logs).
          </div>
        </div>
        <div class="card-body">
          <div v-if="tipsResetMsg" class="card-msg ok">{{ tipsResetMsg }}</div>
          <div v-else class="section-note">
            Tips that you've hidden via "Don't show again" will reappear.
          </div>
        </div>
        <div class="card-footer">
          <button class="toggle-btn" @click="resetAllHiddenInfos">
            Show all hidden Infos again
          </button>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
/* ── Page shell ─────────────────────────────────────────────────────────────── */
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

/* ── Card grid ──────────────────────────────────────────────────────────────── */
.cards-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
  gap: 16px;
  align-items: stretch;
  /* cards in the same row grow to equal height */
}

/* ── Card shell ─────────────────────────────────────────────────────────────── */
/* Every card is header / body / footer  three zones, same padding, perfectly
   aligned across the grid because all cards share the same CSS structure.      */
.card {
  background: #1a1a1e;
  border: 1px solid #1e1e24;
  display: flex;
  flex-direction: column;
  transition: border-color 0.15s;
  overflow: hidden;
}

.card:hover {
  border-color: #2a2a36;
}

.card-wide {
  grid-column: span 2;
}

.card-danger {
  border-color: #f1494922;
  background: #1a1014;
}

.card-danger:hover {
  border-color: #f1494944;
}

.card-warning {
  border-color: #f59e0b22;
  background: #1a1610;
}

.card-warning:hover {
  border-color: #f59e0b44;
}

/* ── Zone 1: header ─────────────────────────────────────────────────────────── */
.card-header {
  padding: 20px 20px 16px;
  border-bottom: 1px solid #1e1e24;
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.card-icon {
  font-size: 18px;
  color: #9d6cff;
  line-height: 1;
  margin-bottom: 4px;
}

.card-icon-7tv {
  color: #9d6cff;
}

.card-icon-danger {
  color: #f14949;
}

.card-icon-warning {
  color: #f59e0b;
}

.card-title {
  font-size: 13px;
  font-weight: 700;
  color: #e0e0e0;
}

.card-sub {
  font-size: 11px;
  color: #555;
  line-height: 1.55;
}

/* ── Zone 2: body ───────────────────────────────────────────────────────────── */
.card-body {
  padding: 16px 20px;
  display: flex;
  flex-direction: column;
  gap: 12px;
  flex: 1;
  /* grows so all cards in a row reach the same total height */
}

/* ── Zone 3: footer ─────────────────────────────────────────────────────────── */
.card-footer {
  padding: 12px 20px;
  border-top: 1px solid #1e1e24;
  display: flex;
  justify-content: flex-end;
  align-items: center;
  min-height: 56px;
  /* fixed height keeps footers on the same baseline */
}

/* ── Shared micro-components ────────────────────────────────────────────────── */
.code {
  font-family: "Consolas", "Fira Mono", monospace;
  color: #9d6cff;
  font-size: 11px;
  background: rgba(111, 43, 255, 0.1);
  padding: 1px 5px;
}

/* Status row used by toggle cards */
.toggle-row {
  display: flex;
  align-items: center;
  gap: 8px;
}

.status-dot {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: #2a2a30;
  flex-shrink: 0;
  transition: background 0.25s;
}

.status-dot.active {
  background: #23d18b;
}

.status-text {
  font-size: 12px;
  color: #777;
}

.spacer {
  flex: 1;
}

.status-badge {
  font-size: 9px;
  font-weight: 700;
  padding: 2px 8px;
  letter-spacing: 0.06em;
  white-space: nowrap;
}

.badge-on {
  color: #23d18b;
  background: rgba(35, 209, 139, 0.1);
  border: 1px solid rgba(35, 209, 139, 0.28);
}

.badge-off {
  color: #555;
  background: rgba(85, 85, 85, 0.1);
  border: 1px solid rgba(85, 85, 85, 0.25);
}

.section-note {
  font-size: 11px;
  color: #555;
  line-height: 1.5;
  background: rgba(229, 192, 123, 0.04);
  border-left: 2px solid #e5c07b2a;
  padding: 5px 8px;
}

.card-loading {
  font-size: 12px;
  color: #555;
}

.card-msg {
  font-size: 11px;
  padding: 5px 10px;
  line-height: 1.4;
}

.card-msg.ok {
  color: #23d18b;
  background: rgba(35, 209, 139, 0.06);
  border-left: 2px solid #23d18b;
}

.card-msg.err {
  color: #f14949;
  background: rgba(241, 73, 73, 0.06);
  border-left: 2px solid #f14949;
}

.field-error {
  font-size: 11px;
  color: #f14949;
}

/* ── Prefix card ────────────────────────────────────────────────────────────── */
.prefix-row {
  display: flex;
  align-items: center;
  gap: 14px;
}

.prefix-input {
  width: 54px;
  background: #0d0d10;
  border: 1px solid #2a2a30;
  color: #e0e0e0;
  font-family: "Consolas", "Fira Mono", monospace;
  font-size: 22px;
  font-weight: 700;
  padding: 6px 10px;
  outline: none;
  text-align: center;
}

.prefix-input:focus {
  border-color: #6f2bff88;
}

.prefix-preview {
  font-family: "Consolas", "Fira Mono", monospace;
  font-size: 14px;
  color: #888;
}

.prefix-preview .pre {
  color: #9d6cff;
  font-weight: 700;
}

/* ── Buttons  same height everywhere ──────────────────────────────────────── */
.save-btn {
  height: 34px;
  padding: 0 20px;
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

.toggle-btn {
  height: 34px;
  padding: 0 18px;
  border: 1px solid #2a2a30;
  background: transparent;
  color: #888;
  font-family: inherit;
  font-size: 11px;
  cursor: pointer;
  transition: all 0.15s;
}

.toggle-btn:hover:not(:disabled) {
  border-color: #9d6cff55;
  color: #9d6cff;
}

.toggle-btn.toggle-btn-on {
  border-color: #23d18b44;
  color: #23d18b;
  background: rgba(35, 209, 139, 0.06);
}

.toggle-btn.toggle-btn-on:hover:not(:disabled) {
  background: rgba(35, 209, 139, 0.14);
}

.toggle-btn:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}

.remove-btn {
  height: 34px;
  padding: 0 20px;
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

.delete-confirm-input {
  width: 100%;
  max-width: 220px;
  margin-top: 8px;
  background: #0d0d10;
  border: 1px solid #f1494944;
  color: #e0e0e0;
  font-family: "Consolas", "Fira Mono", monospace;
  font-size: 14px;
  padding: 8px 10px;
  outline: none;
  box-sizing: border-box;
}

.delete-confirm-input:focus {
  border-color: #f14949;
}

/* ── 7TV card internals ─────────────────────────────────────────────────────── */
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
  height: 32px;
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
  height: 32px;
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
  height: 28px;
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

/* ── Confirm dialog ─────────────────────────────────────────────────────────── */
.confirm-box {
  background: rgba(241, 73, 73, 0.04);
  border: 1px solid #f1494930;
  padding: 12px;
  display: flex;
  flex-direction: column;
  gap: 10px;
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

/* ── Responsive ─────────────────────────────────────────────────────────────── */
@media (max-width: 860px) {
  .card-wide {
    grid-column: span 1;
  }
}

@media (max-width: 520px) {
  .cards-grid {
    grid-template-columns: 1fr;
  }
}
</style>
