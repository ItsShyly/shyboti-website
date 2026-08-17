<script setup lang="ts">
import { ref, computed, onMounted, watch, nextTick } from "vue";
import { useRouter } from "vue-router";
import { API } from "../api";
import { useAuth } from "../auth";
import { useI18n } from "../i18n";
import { iconSvg as iconSvgFor } from "../composables/icons";

const { session, channelRole, adminMode, logout, switchChannel } = useAuth();
const { t } = useI18n();
const router = useRouter();

const isBroadcaster = ref(false);
// default true so real users don't see Remove Bot flash away before channelRole loads
const botPresent = computed(() => channelRole.value?.botPresent ?? true);

// danger zone also unlocks in admin mode, so an admin can act on any channel
const dangerZoneUnlocked = computed(
  () => isBroadcaster.value || (!!session.value?.isAdmin && adminMode.value),
);

// Remove Bot only makes sense if there's a bot to remove
const canRemoveBotCard = computed(
  () => dangerZoneUnlocked.value && botPresent.value,
);

// Prefix
const prefix = ref("+");
const prefixSaving = ref(false);
const prefixSaved = ref(false);
const prefixError = ref("");

// Log opt-out
const optedOut = ref(false);
const optSaving = ref(false);
const optMsg = ref("");

// Vanish hide
const vanishHide = ref(false);
const vanishSaving = ref(false);
const vanishMsg = ref("");

// Name history opt-out
const nameHistOptedOut = ref(false);
const nameHistSaving = ref(false);
const nameHistMsg = ref("");

// 7TV
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

// Remove bot
const removeConfirm = ref(false);
const removeRemoving = ref(false);
const removeMsg = ref("");
const removeError = ref("");

// Hidden tips reset
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

// Delete all data
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

// vvv scrollspy nav vvv
const sections = computed(() => {
  const list: { id: string; label: string }[] = [];
  if (isBroadcaster.value) list.push({ id: "chat", label: "Chat behavior" });
  list.push({ id: "privacy", label: "Privacy" });
  if (isBroadcaster.value)
    list.push({ id: "integrations", label: "Integrations" });
  list.push({ id: "interface", label: "Interface" });
  if (canRemoveBotCard.value || dangerZoneUnlocked.value)
    list.push({ id: "danger", label: "Danger zone" });
  return list;
});

const activeSection = ref("");
const bodyRef = ref<HTMLElement | null>(null);
const sectionEls: Record<string, HTMLElement> = {};
function setSectionRef(id: string) {
  return (el: any) => {
    if (el) sectionEls[id] = el as HTMLElement;
    else delete sectionEls[id];
  };
}

// >>> root:null tracks the page's real scroll container
let observer: IntersectionObserver | null = null;
function setupObserver() {
  observer?.disconnect();
  observer = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        if (entry.isIntersecting) {
          const id = (entry.target as HTMLElement).dataset.sectionId;
          if (id) activeSection.value = id;
        }
      }
    },
    { root: null, rootMargin: "0px 0px -70% 0px", threshold: 0 },
  );
  for (const sec of sections.value) {
    const el = sectionEls[sec.id];
    if (el) observer.observe(el);
  }
  if (!activeSection.value && sections.value.length)
    activeSection.value = sections.value[0]!.id;
}

onMounted(() => nextTick(setupObserver));
watch(sections, () => nextTick(setupObserver));

function scrollToSection(id: string) {
  sectionEls[id]?.scrollIntoView({ behavior: "smooth", block: "start" });
}
// ^^^ scrollspy nav ^^^
</script>

<template>
  <div class="settings">
    <header class="settings-header">
      <h1 class="settings-title">{{ t("settings.title") }}</h1>
      <p class="settings-sub">
        Manage settings for <span class="chan">#{{ session?.channel }}</span>.
      </p>
    </header>

    <div class="settings-layout">
      <div class="settings-body" ref="bodyRef">
        <!-- Chat behavior (broadcaster only) -->
        <section v-if="isBroadcaster" class="settings-section" data-section-id="chat" :ref="setSectionRef('chat')">
          <h2 class="section-title">Chat behavior</h2>
          <div class="setting-list">
            <div class="setting-row">
              <div class="setting-info">
                <div class="setting-label">Command prefix</div>
                <div class="setting-desc">
                  Used before commands, e.g. <code class="code">{{ prefix || "+" }}</code>ping.
                </div>
                <div v-if="prefixError" class="field-error">{{ prefixError }}</div>
              </div>
              <div class="setting-control prefix-control">
                <input v-model="prefix" class="prefix-input" maxlength="3" placeholder="+" @keydown.enter="savePrefix"
                  spellcheck="false" />
                <button class="btn btn-primary" @click="savePrefix" :disabled="prefixSaving || !prefix">
                  {{
                    prefixSaving
                      ? t("settings.saving")
                      : prefixSaved
                        ? t("settings.saved")
                        : t("settings.prefix.save")
                  }}
                </button>
              </div>
            </div>

            <div class="setting-row">
              <div class="setting-info">
                <div class="setting-label">Hide vanish timeouts</div>
                <div class="setting-desc">
                  Hides short timeouts from the dashboard when the user typed a
                  vanish command.
                </div>
                <div class="setting-desc-detects">
                  Detects <code class="code">!v</code>
                  <code class="code">!vanish</code>
                  <code class="code">+v</code>
                  <code class="code">+vanish</code>
                </div>
                <div v-if="vanishMsg" class="status-msg ok">{{ vanishMsg }}</div>
              </div>
              <div class="setting-control">
                <button class="btn btn-toggle" :class="{ active: vanishHide }" @click="
                  vanishHide = !vanishHide;
                saveVanish();
                " :disabled="vanishSaving">
                  {{ vanishSaving ? "..." : vanishHide ? "Disable" : "Enable" }}
                </button>
              </div>
            </div>
          </div>
        </section>

        <!-- Privacy -->
        <section class="settings-section" data-section-id="privacy" :ref="setSectionRef('privacy')">
          <h2 class="section-title">Privacy</h2>
          <div class="setting-list">
            <div class="setting-row">
              <div class="setting-info">
                <div class="setting-label">Chat log visibility</div>
                <div class="setting-desc">{{ t("settings.optout.sub") }}</div>
                <div v-if="optMsg" class="status-msg ok">{{ optMsg }}</div>
              </div>
              <div class="setting-control">
                <button class="btn btn-toggle" :class="{ active: optedOut }" @click="toggleOptOut"
                  :disabled="optSaving">
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

            <div class="setting-row">
              <div class="setting-info">
                <div class="setting-label">Previous usernames</div>
                <div class="setting-desc">
                  Hide your previous Twitch usernames from being shown on other
                  users' screens.
                </div>
                <div v-if="nameHistMsg" class="status-msg ok">{{ nameHistMsg }}</div>
              </div>
              <div class="setting-control">
                <button class="btn btn-toggle" :class="{ active: nameHistOptedOut }" @click="toggleNameHistOptOut"
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
          </div>
        </section>

        <!-- Integrations (broadcaster only) -->
        <section v-if="isBroadcaster" class="settings-section" data-section-id="integrations"
          :ref="setSectionRef('integrations')">
          <h2 class="section-title">Integrations</h2>
          <div class="integration-panel">
            <div class="integration-header">
              <div class="integration-title">7TV Emote Set</div>
              <div class="integration-desc">{{ t("settings.7tv.sub") }}</div>
            </div>
            <div class="integration-body">
              <div v-if="emoteSetLoading" class="loading">Loading...</div>
              <template v-else>
                <div v-if="emoteSet.setId" class="emote-current">
                  <span class="emote-name">
                    {{ emoteSet.setName ?? emoteSet.setId }}
                  </span>
                  <span class="emote-meta">
                    {{ emoteSet.setId }} · {{ emoteSet.emoteCount }}
                    {{ t("settings.7tv.emotes") }}
                  </span>
                  <button class="btn btn-remove" @click="remove7tvSet" :disabled="emoteSetSaving">
                    {{
                      emoteSetSaving
                        ? t("settings.7tv.removing")
                        : t("settings.7tv.remove")
                    }}
                  </button>
                </div>
                <div v-else class="emote-none">
                  {{ t("settings.7tv.none") }}
                </div>

                <div class="emote-form-row">
                  <button class="btn btn-fetch" :disabled="emoteSetSaving" @click="
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
                  <span class="emote-lbl">by channel name</span>
                </div>

                <div class="emote-form-row">
                  <input v-model="emoteInputId" class="field-sm" :placeholder="t('settings.7tv.by_id.ph')"
                    @keydown.enter="
                      emoteInput7tv = '';
                    fetch7tvSet();
                    " :disabled="emoteSetSaving" />
                  <button class="btn btn-fetch" :disabled="emoteSetSaving || !emoteInputId.trim()" @click="
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

                <div v-if="emoteSetError" class="status-msg err">
                  {{ emoteSetError }}
                </div>
                <div v-if="emoteSetSuccess" class="status-msg ok">
                  <span class="status-icon" v-html="iconSvgFor('check')"></span>{{ emoteSetSuccess }}
                </div>
              </template>
            </div>
          </div>
        </section>

        <!-- Interface -->
        <section class="settings-section" data-section-id="interface" :ref="setSectionRef('interface')">
          <h2 class="section-title">Interface</h2>
          <div class="setting-list">
            <div class="setting-row">
              <div class="setting-info">
                <div class="setting-label">Hidden tips</div>
                <div class="setting-desc">
                  Restore all info tips you've dismissed (e.g. the snippet hint in
                  Logs).
                </div>
                <div v-if="tipsResetMsg" class="status-msg ok">{{ tipsResetMsg }}</div>
              </div>
              <div class="setting-control">
                <button class="btn btn-secondary" @click="resetAllHiddenInfos">
                  Show hidden tips
                </button>
              </div>
            </div>
          </div>
        </section>

        <!-- Danger zone -->
        <section v-if="canRemoveBotCard || dangerZoneUnlocked" class="settings-section danger-section"
          data-section-id="danger" :ref="setSectionRef('danger')">
          <h2 class="section-title danger-title">Danger zone</h2>
          <div class="danger-list">
            <div v-if="canRemoveBotCard" class="danger-row warning">
              <div class="danger-info">
                <div class="danger-label">Remove bot from channel</div>
                <div class="danger-desc">{{ t("settings.remove.sub") }}</div>
                <div v-if="removeMsg" class="status-msg ok">{{ removeMsg }}</div>
                <div v-if="removeError" class="status-msg err">{{ removeError }}</div>
                <div v-if="removeConfirm" class="confirm-inline">
                  <span>
                    Remove from <strong>#{{ session?.channel }}</strong>?
                    {{ t("settings.remove.confirm2") }}
                  </span>
                  <button class="btn btn-confirm-no" @click="removeConfirm = false">
                    {{ t("settings.remove.no") }}
                  </button>
                  <button class="btn btn-confirm-yes" @click="doRemoveBot">
                    {{ t("settings.remove.yes") }}
                  </button>
                </div>
              </div>
              <div class="danger-control">
                <button class="btn btn-danger-warn" @click="clickRemoveBot" :disabled="removeRemoving">
                  {{
                    removeRemoving
                      ? t("settings.remove.removing")
                      : t("settings.remove.btn")
                  }}
                </button>
              </div>
            </div>

            <div v-if="dangerZoneUnlocked" class="danger-row delete">
              <div class="danger-info">
                <div class="danger-label">Delete all channel data</div>
                <div class="danger-desc">
                  {{ t("settings.delete.sub") }}
                  <strong>#{{ session?.channel }}</strong>.
                </div>
                <div v-if="deleteError" class="status-msg err">{{ deleteError }}</div>
                <div class="delete-confirm">
                  <span>Type <strong>DELETE</strong> to confirm.</span>
                  <input v-model="deleteConfirmInput" class="delete-input" type="text" placeholder="DELETE"
                    :disabled="deleting" />
                </div>
              </div>
              <div class="danger-control">
                <button class="btn btn-danger-delete" :disabled="!deleteConfirmValid || deleting"
                  @click="doDeleteAllData">
                  {{
                    deleting
                      ? t("settings.delete.deleting")
                      : t("settings.delete.btn")
                  }}
                </button>
              </div>
            </div>
          </div>
        </section>
      </div>

      <nav class="settings-nav">
        <button v-for="sec in sections" :key="sec.id" class="nav-item" :class="{ active: activeSection === sec.id }"
          @click="scrollToSection(sec.id)">
          <span class="nav-square" :class="{ on: activeSection === sec.id }"></span>
          <span class="nav-label">{{ sec.label }}</span>
        </button>
      </nav>
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
  border-bottom: 1px solid #222;
  padding-bottom: 16px;
}

.settings-title {
  font-size: 18px;
  font-weight: 700;
  margin: 0;
  color: #e0e0e0;
}

.settings-sub {
  color: #555;
  margin: 4px 0 0;
  font-size: 12px;
}

.chan {
  color: #9d6cff;
}

.settings-layout {
  display: flex;
  align-items: flex-start;
  gap: 40px;
}

.settings-body {
  flex: 1;
  max-width: 560px;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 36px;
}

.settings-nav {
  flex-shrink: 0;
  width: 170px;
  display: flex;
  flex-direction: column;
  gap: 2px;
  position: sticky;
  top: 0;
}

.nav-item {
  display: flex;
  align-items: center;
  gap: 9px;
  padding: 6px 4px;
  border: none;
  background: transparent;
  color: #555;
  font-family: inherit;
  font-size: 11px;
  font-weight: 600;
  text-align: left;
  cursor: pointer;
}

.nav-item:hover {
  color: #aaa;
}

.nav-item.active {
  color: #9d6cff;
}

.nav-square {
  width: 8px;
  height: 8px;
  flex-shrink: 0;
  border: 1px solid #333;
  background: transparent;
}

.nav-square.on {
  background: #6f2bff;
  border-color: #9d6cff;
}

.nav-label {
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

@media (max-width: 860px) {
  .settings-layout {
    flex-direction: column-reverse;
    gap: 20px;
  }

  .settings-nav {
    width: 100%;
    flex-direction: row;
    flex-wrap: wrap;
    gap: 4px 16px;
    position: static;
  }

  .settings-body {
    max-width: none;
  }
}

.settings-section {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.section-title {
  font-size: 11px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  color: #555;
  margin: 0;
}

.section-title.danger-title {
  color: #f14949;
}

.setting-list {
  display: flex;
  flex-direction: column;
  border: 1px solid #2a2a30;
  background: #1a1a1e;
}

.setting-row {
  display: flex;
  align-items: flex-start;
  gap: 24px;
  padding: 12px 14px;
  border-bottom: 1px solid #1e1e1e;
}

.setting-row:last-child {
  border-bottom: none;
}

.setting-info {
  flex: 1;
  min-width: 0;
}

.setting-label {
  font-weight: 700;
  font-size: 13px;
  color: #ccc;
  margin-bottom: 3px;
}

.setting-desc {
  color: #555;
  font-size: 11px;
  line-height: 1.5;
  margin-bottom: 5px;
}

.setting-desc-detects {
  color: #444;
  font-size: 10px;
}

.code {
  font-family: "Consolas", "Fira Mono", monospace;
  color: #9d6cff;
  background: rgba(111, 43, 255, 0.1);
  padding: 1px 5px;
}

.setting-control {
  flex-shrink: 0;
  display: flex;
  align-items: center;
  gap: 8px;
}

.prefix-control {
  gap: 10px;
  align-items: center;
}

.prefix-input {
  width: 46px;
  height: 34px;
  background: #111217;
  border: 1px solid #2a2a30;
  color: #e0e0e0;
  text-align: center;
  font-family: "Consolas", "Fira Mono", monospace;
  font-size: 16px;
  font-weight: 700;
  outline: none;
}

.prefix-input:focus {
  border-color: #6f2bff88;
}

.btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  height: 34px;
  padding: 0 16px;
  border: 1px solid #2a2a30;
  background: transparent;
  color: #888;
  font-family: inherit;
  font-size: 11px;
  font-weight: 600;
  cursor: pointer;
  transition: all 0.15s;
  white-space: nowrap;
}

.btn:hover:not(:disabled) {
  border-color: #555;
  color: #e0e0e0;
}

.btn:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}

.btn-primary {
  background: #6f2bff;
  border-color: #6f2bff;
  color: #fff;
}

.btn-primary:hover:not(:disabled) {
  background: #7f3fff;
  border-color: #7f3fff;
}

.btn-toggle {
  min-width: 66px;
}

.btn-toggle.active {
  background: rgba(35, 209, 139, 0.1);
  border-color: rgba(35, 209, 139, 0.4);
  color: #23d18b;
}

.btn-secondary {
  border-color: #2a2a30;
}

.btn-remove {
  border-color: rgba(241, 73, 73, 0.4);
  color: #f14949;
  height: 28px;
  padding: 0 10px;
  font-size: 10px;
  margin-left: auto;
}

.btn-remove:hover:not(:disabled) {
  background: rgba(241, 73, 73, 0.1);
  border-color: #f14949;
}

.btn-fetch {
  border-color: rgba(111, 43, 255, 0.4);
  color: #9d6cff;
  height: 28px;
  padding: 0 12px;
  font-size: 10px;
}

.btn-fetch:hover:not(:disabled) {
  background: rgba(111, 43, 255, 0.1);
  border-color: #9d6cff;
}

.btn-danger-warn {
  border-color: rgba(229, 192, 123, 0.5);
  color: #e5c07b;
}

.btn-danger-warn:hover:not(:disabled) {
  background: rgba(229, 192, 123, 0.1);
  border-color: #e5c07b;
}

.btn-danger-delete {
  border-color: rgba(241, 73, 73, 0.55);
  color: #f14949;
}

.btn-danger-delete:hover:not(:disabled) {
  background: rgba(241, 73, 73, 0.1);
  border-color: #f14949;
}

.btn-confirm-no {
  border-color: #2a2a30;
  color: #888;
}

.btn-confirm-no:hover:not(:disabled) {
  border-color: #555;
}

.btn-confirm-yes {
  border-color: #f14949;
  background: #f14949;
  color: #fff;
}

.btn-confirm-yes:hover:not(:disabled) {
  background: #ff5a5a;
}

.field-error {
  color: #f14949;
  font-size: 11px;
  margin-top: 4px;
}

.status-msg {
  display: flex;
  align-items: center;
  gap: 5px;
  font-size: 11px;
  margin-top: 6px;
  padding: 4px 8px;
}

.status-icon {
  display: inline-flex;
  flex-shrink: 0;
  width: 11px;
  height: 11px;
}

.status-icon :deep(svg) {
  width: 100%;
  height: 100%;
}

.status-msg.ok {
  color: #23d18b;
  background: rgba(35, 209, 139, 0.06);
  border-left: 2px solid #23d18b;
}

.status-msg.err {
  color: #f14949;
  background: rgba(241, 73, 73, 0.06);
  border-left: 2px solid #f14949;
}

.integration-panel {
  border: 1px solid #2a2a30;
  background: #1a1a1e;
}

.integration-header {
  padding: 12px 14px;
  border-bottom: 1px solid #1e1e1e;
}

.integration-title {
  font-weight: 700;
  font-size: 13px;
  color: #ccc;
}

.integration-desc {
  color: #555;
  font-size: 11px;
  margin-top: 3px;
}

.integration-body {
  padding: 14px;
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.loading,
.emote-none {
  color: #555;
  font-size: 12px;
}

.emote-current {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 10px;
  background: #111217;
  border: 1px solid #1e1e24;
  padding: 8px 12px;
}

.emote-name {
  font-weight: 700;
  color: #e0e0e0;
  font-size: 12px;
}

.emote-meta {
  color: #555;
  font-size: 11px;
}

.emote-form-row {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
}

.emote-lbl {
  color: #555;
  font-size: 11px;
}

.field-sm {
  height: 30px;
  min-width: 160px;
  flex: 1;
  background: #111217;
  border: 1px solid #2a2a30;
  color: #e0e0e0;
  font-family: inherit;
  padding: 0 10px;
  font-size: 12px;
  outline: none;
}

.field-sm:focus {
  border-color: #6f2bff88;
}

.field-sm:disabled {
  opacity: 0.4;
}

.danger-list {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.danger-row {
  display: flex;
  align-items: flex-start;
  gap: 24px;
  padding: 14px;
  border: 1px solid;
}

.danger-row.warning {
  border-color: rgba(229, 192, 123, 0.2);
  background: #1a1610;
}

.danger-row.delete {
  border-color: rgba(241, 73, 73, 0.2);
  background: #1a1014;
}

.danger-info {
  flex: 1;
}

.danger-label {
  font-weight: 700;
  font-size: 13px;
  color: #ccc;
}

.danger-desc {
  color: #555;
  font-size: 11px;
  margin-top: 3px;
}

.danger-control {
  flex-shrink: 0;
  display: flex;
  align-items: center;
}

.confirm-inline {
  margin-top: 10px;
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
  font-size: 11px;
  color: #888;
}

.confirm-inline strong {
  color: #e5c07b;
}

.delete-confirm {
  margin-top: 10px;
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
  font-size: 11px;
  color: #888;
}

.delete-confirm strong {
  color: #f14949;
}

.delete-input {
  height: 34px;
  width: 120px;
  background: #111217;
  border: 1px solid rgba(241, 73, 73, 0.5);
  color: #e0e0e0;
  font-family: "Consolas", "Fira Mono", monospace;
  padding: 0 10px;
  font-size: 12px;
  outline: none;
}

.delete-input:focus {
  border-color: #f14949;
}

@media (max-width: 640px) {

  .setting-row,
  .danger-row {
    flex-direction: column;
    gap: 10px;
  }

  .setting-control,
  .danger-control {
    align-self: flex-end;
  }
}
</style>