<script setup lang="ts">
import { ref, computed, onMounted, watch } from "vue";
import { API } from "../api";
import { useAuth } from "../auth";
import { useI18n } from "../i18n";
import { iconSvg as iconSvgFor } from "../composables/icons";
import type { RolePermissions } from "../auth";
import RoleDefaultsCard from "./RoleDefaultsCard.vue";

const { session } = useAuth();
const { t } = useI18n();

type Perms = Omit<RolePermissions, "modsEnabled">;
type Role = "mod" | "vip" | "custom";
type Filter = "all" | Role | "blocked";

interface RawRoleRow {
  username: string;
  blocked: boolean;
  permissions: Perms | null;
}
interface CustomUserRow {
  username: string;
  permissions: Perms;
}
interface UnifiedEntry {
  key: string;
  username: string;
  role: Role;
  blocked: boolean;
  permissions: Perms | null;
}

const PERM_GROUPS = computed(() => [
  {
    label: t("perm.group.dashboard"),
    perms: [{ key: "dashboard" as keyof Perms, label: t("perm.dashboard") }],
  },
  {
    label: t("perm.group.commands"),
    perms: [
      { key: "commands_view" as keyof Perms, label: t("perm.commands_view") },
      { key: "commands_toggle" as keyof Perms, label: t("perm.commands_toggle") },
      { key: "commands_edit" as keyof Perms, label: t("perm.commands_edit") },
      { key: "commands_delete" as keyof Perms, label: t("perm.commands_delete") },
      { key: "commands_mod" as keyof Perms, label: t("perm.commands_mod") },
      { key: "commands_extras" as keyof Perms, label: t("perm.commands_extras") },
    ],
  },
  {
    label: t("perm.group.automations"),
    perms: [
      { key: "automations_view" as keyof Perms, label: t("perm.automations_view") },
      { key: "automations_toggle" as keyof Perms, label: t("perm.automations_toggle") },
      { key: "automations_edit" as keyof Perms, label: t("perm.automations_edit") },
      { key: "automations_delete" as keyof Perms, label: t("perm.automations_delete") },
    ],
  },
  {
    label: t("perm.group.moderation"),
    perms: [
      { key: "moderation_view" as keyof Perms, label: t("perm.moderation_view") },
      { key: "moderation_manage" as keyof Perms, label: t("perm.moderation_manage") },
    ],
  },
  {
    label: t("perm.group.obs"),
    perms: [
      { key: "obs_view" as keyof Perms, label: t("perm.obs_view") },
      { key: "obs_edit" as keyof Perms, label: t("perm.obs_edit") },
      { key: "obs_force_preview" as keyof Perms, label: t("perm.obs_force_preview") },
    ],
  },
]);

const EMPTY_PERMS: Perms = {
  dashboard: false,
  commands_view: false,
  commands_toggle: false,
  commands_edit: false,
  commands_delete: false,
  commands_mod: false,
  commands_extras: false,
  automations_view: false,
  automations_toggle: false,
  automations_edit: false,
  automations_delete: false,
  moderation_view: false,
  moderation_manage: false,
  obs_view: false,
  obs_edit: false,
  obs_force_preview: false,
};

// >>> read-only snapshot for expand-panel comparisons, RoleDefaultsCard owns the real editable copy
const modDefaults = ref<Perms>({ ...EMPTY_PERMS });
const vipDefaults = ref<Perms>({ ...EMPTY_PERMS });

async function loadDefaultsSnapshot() {
  if (!session.value) return;
  const ch = session.value.channel;
  const headers = { Authorization: `Bearer ${session.value.token}` };
  try {
    const [modRes, vipRes] = await Promise.all([
      fetch(`${API}/roles/${ch}`, { headers }),
      fetch(`${API}/vip-roles/${ch}`, { headers }),
    ]);
    if (session.value?.channel !== ch) return;
    if (modRes.ok) {
      const d = (await modRes.json()) as { permissions: Perms };
      if (session.value?.channel !== ch) return;
      Object.assign(modDefaults.value, EMPTY_PERMS, d.permissions);
    }
    if (vipRes.ok) {
      const d = (await vipRes.json()) as { permissions: Perms };
      if (session.value?.channel !== ch) return;
      Object.assign(vipDefaults.value, EMPTY_PERMS, d.permissions);
    }
  } catch {}
}

// >>> real twitch mod/vip badge icons, gray dot fallback if unavailable
const modBadgeUrl = ref("");
const vipBadgeUrl = ref("");

async function loadTwitchBadges() {
  if (!session.value) return;
  const ch = session.value.channel;
  try {
    const res = await fetch(`${API}/twitch/badges/${encodeURIComponent(ch)}`, {
      headers: { Authorization: `Bearer ${session.value.token}` },
    });
    if (!res.ok) return;
    const d = (await res.json()) as any;
    if (session.value?.channel !== ch) return;
    const badgeMap = d?.badgeMap ?? {};
    modBadgeUrl.value = String(badgeMap["moderator/1"]?.image_url_2x ?? badgeMap["moderator/1"]?.image_url_1x ?? "");
    vipBadgeUrl.value = String(badgeMap["vip/1"]?.image_url_2x ?? badgeMap["vip/1"]?.image_url_1x ?? "");
  } catch {}
}

const mods = ref<RawRoleRow[]>([]);
const vips = ref<RawRoleRow[]>([]);
const customUsers = ref<CustomUserRow[]>([]);
const listLoading = ref(false);

async function loadMods() {
  if (!session.value) return;
  const ch = session.value.channel;
  try {
    const res = await fetch(`${API}/mods/${ch}`, {
      headers: { Authorization: `Bearer ${session.value.token}` },
    });
    if (!res.ok) return;
    const data = (await res.json()) as { mods: RawRoleRow[] };
    if (session.value?.channel !== ch) return;
    mods.value = data.mods ?? [];
  } catch {}
}

async function loadVips() {
  if (!session.value) return;
  const ch = session.value.channel;
  try {
    const res = await fetch(`${API}/vips/${ch}`, {
      headers: { Authorization: `Bearer ${session.value.token}` },
    });
    if (!res.ok) return;
    const data = (await res.json()) as { vips: RawRoleRow[] };
    if (session.value?.channel !== ch) return;
    vips.value = data.vips ?? [];
  } catch {}
}

async function loadCustomUsers() {
  if (!session.value) return;
  const ch = session.value.channel;
  try {
    const res = await fetch(`${API}/users/${ch}`, {
      headers: { Authorization: `Bearer ${session.value.token}` },
    });
    if (!res.ok) return;
    const data = (await res.json()) as { users: CustomUserRow[] };
    if (session.value?.channel !== ch) return;
    customUsers.value = data.users ?? [];
  } catch {}
}

async function loadAll() {
  listLoading.value = true;
  await Promise.all([loadDefaultsSnapshot(), loadTwitchBadges(), loadMods(), loadVips(), loadCustomUsers()]);
  listLoading.value = false;
}

function onDefaultsSaved() {
  loadDefaultsSnapshot();
}

const unifiedList = computed<UnifiedEntry[]>(() => {
  const list: UnifiedEntry[] = [
    ...mods.value.map((m) => ({ key: `mod:${m.username}`, username: m.username, role: "mod" as Role, blocked: m.blocked, permissions: m.permissions })),
    ...vips.value.map((v) => ({ key: `vip:${v.username}`, username: v.username, role: "vip" as Role, blocked: v.blocked, permissions: v.permissions })),
    ...customUsers.value.map((u) => ({ key: `custom:${u.username}`, username: u.username, role: "custom" as Role, blocked: false, permissions: u.permissions })),
  ];
  return list.sort((a, b) => a.username.localeCompare(b.username));
});

const counts = computed(() => ({
  all: unifiedList.value.length,
  mod: unifiedList.value.filter((e) => e.role === "mod").length,
  vip: unifiedList.value.filter((e) => e.role === "vip").length,
  custom: unifiedList.value.filter((e) => e.role === "custom").length,
  blocked: unifiedList.value.filter((e) => e.blocked).length,
}));

const activeFilter = ref<Filter>("all");
const searchQuery = ref("");

const filteredList = computed(() => {
  const q = searchQuery.value.trim().toLowerCase();
  return unifiedList.value.filter((e) => {
    if (activeFilter.value === "blocked" && !e.blocked) return false;
    if (activeFilter.value !== "all" && activeFilter.value !== "blocked" && e.role !== activeFilter.value) return false;
    if (q && !e.username.toLowerCase().includes(q)) return false;
    return true;
  });
});

const expandedKey = ref<string | null>(null);
const itemSaving = ref<string | null>(null);
const deleteConfirmKey = ref<string | null>(null);

function toggleExpand(entry: UnifiedEntry) {
  expandedKey.value = expandedKey.value === entry.key ? null : entry.key;
  deleteConfirmKey.value = null;
}

function defaultsFor(role: Role): Perms | null {
  return role === "mod" ? modDefaults.value : role === "vip" ? vipDefaults.value : null;
}

function matchesDefaults(perms: Perms, defaults: Perms): boolean {
  return (Object.keys(defaults) as (keyof Perms)[]).every((k) => perms[k] === defaults[k]);
}

async function saveOverride(entry: UnifiedEntry, blocked: boolean, permissions: Perms | null) {
  if (!session.value) return;
  const base = entry.role === "mod" ? "mods" : "vips";
  itemSaving.value = entry.key;
  try {
    await fetch(`${API}/${base}/${session.value.channel}/${entry.username}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${session.value.token}` },
      body: JSON.stringify({ blocked, permissions }),
    });
    const list = entry.role === "mod" ? mods.value : vips.value;
    const row = list.find((r) => r.username === entry.username);
    if (row) {
      row.blocked = blocked;
      row.permissions = permissions;
    }
  } catch {}
  itemSaving.value = null;
}

async function toggleBlock(entry: UnifiedEntry) {
  const nextBlocked = !entry.blocked;
  await saveOverride(entry, nextBlocked, nextBlocked ? null : entry.permissions);
}

async function resetOverride(entry: UnifiedEntry) {
  await saveOverride(entry, entry.blocked, null);
}

async function saveCustomUser(entry: UnifiedEntry, permissions: Perms) {
  if (!session.value) return;
  itemSaving.value = entry.key;
  try {
    await fetch(`${API}/users/${session.value.channel}/${entry.username}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${session.value.token}` },
      body: JSON.stringify({ permissions }),
    });
    const row = customUsers.value.find((u) => u.username === entry.username);
    if (row) row.permissions = permissions;
  } catch {}
  itemSaving.value = null;
}

async function togglePerm(entry: UnifiedEntry, key: keyof Perms) {
  if (entry.role === "custom") {
    const next = { ...(entry.permissions as Perms), [key]: !(entry.permissions as Perms)[key] };
    await saveCustomUser(entry, next);
    return;
  }
  const defaults = defaultsFor(entry.role) as Perms;
  const next = { ...(entry.permissions ?? defaults), [key]: !(entry.permissions ?? defaults)[key] };
  const collapsed = matchesDefaults(next, defaults) ? null : next;
  await saveOverride(entry, entry.blocked, collapsed);
}

async function deleteCustomUser(entry: UnifiedEntry) {
  if (deleteConfirmKey.value !== entry.key) {
    deleteConfirmKey.value = entry.key;
    return;
  }
  if (!session.value) return;
  itemSaving.value = entry.key;
  try {
    await fetch(`${API}/users/${session.value.channel}/${entry.username}`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${session.value.token}` },
    });
    customUsers.value = customUsers.value.filter((u) => u.username !== entry.username);
    if (expandedKey.value === entry.key) expandedKey.value = null;
  } catch {
  } finally {
    itemSaving.value = null;
    deleteConfirmKey.value = null;
  }
}

// >>> add box always creates a tier-3 custom user, mods/vips only come from twitch sync
const newUsername = ref("");
const newPerms = ref<Perms>({ ...EMPTY_PERMS });
const adding = ref(false);
const addError = ref("");

function copyModDefaults() {
  Object.assign(newPerms.value, modDefaults.value);
}
function copyVipDefaults() {
  Object.assign(newPerms.value, vipDefaults.value);
}

async function addCustomUser() {
  if (!session.value) return;
  const username = newUsername.value.trim().toLowerCase();
  if (!username) return;
  addError.value = "";

  if (mods.value.some((m) => m.username === username)) {
    addError.value = t("roles.already_mod");
    return;
  }
  if (vips.value.some((v) => v.username === username)) {
    addError.value = t("roles.already_vip");
    return;
  }

  adding.value = true;
  try {
    const res = await fetch(`${API}/users/${session.value.channel}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${session.value.token}` },
      body: JSON.stringify({ username, permissions: newPerms.value }),
    });
    if (res.status === 409) {
      addError.value = t("roles.username_placeholder") + " - " + username;
      return;
    }
    if (!res.ok) return;
    newUsername.value = "";
    newPerms.value = { ...EMPTY_PERMS };
    await loadCustomUsers();
  } catch {
  } finally {
    adding.value = false;
  }
}

onMounted(loadAll);
watch(() => session.value?.channel, loadAll);
</script>

<template>
  <div class="roles">
    <div class="roles-header">
      <div>
        <h2 class="roles-title">{{ t("roles.title") }}</h2>
        <p class="roles-sub">
          {{ t("roles.sub") }} <span class="chan">#{{ session?.channel }}</span>.
        </p>
      </div>
    </div>

    <div class="defaults-row">
      <RoleDefaultsCard kind="mod" @saved="onDefaultsSaved" />
      <RoleDefaultsCard kind="vip" @saved="onDefaultsSaved" />
      <RoleDefaultsCard kind="chatter" @saved="onDefaultsSaved" />
    </div>

    <div class="users-section">
      <div class="users-header">
        <div>
          <div class="users-title">{{ t("roles.all_users_title") }}</div>
          <p class="users-sub">{{ t("roles.all_users_sub") }}</p>
        </div>
      </div>

      <div class="add-box">
        <div class="add-row">
          <input v-model="newUsername" class="input username-input" :placeholder="t('roles.username_placeholder')" @keydown.enter="addCustomUser" />
          <button v-if="newUsername.trim()" class="btn btn-secondary" @click="copyModDefaults">{{ t("roles.copy_mod") }}</button>
          <button v-if="newUsername.trim()" class="btn btn-secondary" @click="copyVipDefaults">{{ t("roles.copy_vip") }}</button>
          <button class="btn btn-primary" :disabled="!newUsername.trim() || adding" @click="addCustomUser">
            {{ t("roles.add_user") }}
          </button>
        </div>
        <p class="add-sub">{{ t("roles.users_sub") }}</p>
        <div v-if="addError" class="add-error">{{ addError }}</div>

        <div v-if="newUsername.trim()" class="perm-grid">
          <div v-for="group in PERM_GROUPS" :key="group.label" class="perm-group">
            <div class="perm-group-label">{{ group.label }}</div>
            <div class="perm-rows">
              <div v-for="perm in group.perms" :key="perm.key" class="perm-row compact">
                <div class="perm-info">
                  <div class="perm-label">{{ perm.label }}</div>
                </div>
                <div class="ep-switch sm" :class="{ on: (newPerms as any)[perm.key] }" @click="(newPerms as any)[perm.key] = !(newPerms as any)[perm.key]">
                  <div class="ep-switch-knob"></div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      <div class="filter-bar">
        <button class="filter-btn" :class="{ active: activeFilter === 'all' }" @click="activeFilter = 'all'">
          {{ t("roles.filter_all") }} <span class="filter-count">{{ counts.all }}</span>
        </button>
        <button class="filter-btn" :class="{ active: activeFilter === 'mod' }" @click="activeFilter = 'mod'">
          {{ t("roles.filter_mods") }} <span class="filter-count">{{ counts.mod }}</span>
        </button>
        <button class="filter-btn" :class="{ active: activeFilter === 'vip' }" @click="activeFilter = 'vip'">
          {{ t("roles.filter_vips") }} <span class="filter-count">{{ counts.vip }}</span>
        </button>
        <button class="filter-btn" :class="{ active: activeFilter === 'custom' }" @click="activeFilter = 'custom'">
          {{ t("roles.filter_custom") }} <span class="filter-count">{{ counts.custom }}</span>
        </button>
        <button class="filter-btn" :class="{ active: activeFilter === 'blocked' }" @click="activeFilter = 'blocked'">
          {{ t("roles.filter_blocked") }} <span class="filter-count">{{ counts.blocked }}</span>
        </button>
      </div>

      <input v-if="unifiedList.length" v-model="searchQuery" class="input search-input" :placeholder="t('roles.search_placeholder')" />

      <div v-if="listLoading" class="user-list">
        <div class="ep-skeleton-row" v-for="i in 6" :key="i">
          <div class="ep-skeleton-block ep-skeleton-square"></div>
          <div class="ep-skeleton-lines">
            <div class="ep-skeleton-block ep-skeleton-line title"></div>
          </div>
          <div class="ep-skeleton-actions">
            <div class="ep-skeleton-block ep-skeleton-btn"></div>
          </div>
        </div>
      </div>
      <div v-else-if="unifiedList.length === 0" class="empty">{{ t("roles.no_users") }}</div>
      <div v-else-if="filteredList.length === 0" class="empty">{{ t("roles.no_results") }}</div>

      <div v-else class="user-list">
        <div
          v-for="entry in filteredList"
          :key="entry.key"
          class="user-item"
          :class="{ expanded: expandedKey === entry.key, blocked: entry.blocked, overridden: !entry.blocked && entry.permissions !== null }"
        >
          <div class="user-row" @click="toggleExpand(entry)">
            <img v-if="!entry.blocked && entry.role === 'mod' && modBadgeUrl" class="role-badge-icon" :src="modBadgeUrl" alt="" />
            <img v-else-if="!entry.blocked && entry.role === 'vip' && vipBadgeUrl" class="role-badge-icon" :src="vipBadgeUrl" alt="" />
            <span v-else class="user-dot" :class="entry.blocked ? 'blocked' : 'gray'"></span>
            <span class="user-name">{{ entry.username }}</span>
            <div class="user-badges">
              <span v-if="entry.blocked" class="user-badge blocked">{{ t("roles.badge.blocked") }}</span>
              <span v-else-if="entry.role === 'custom'" class="user-badge custom">{{ t("roles.role_custom") }}</span>
              <span v-else-if="entry.permissions !== null" class="user-badge custom">{{ t("roles.badge.custom") }}</span>
            </div>
            <div class="user-actions" @click.stop>
              <button v-if="entry.role !== 'custom'" class="btn btn-danger sm" :class="{ 'btn-allow': entry.blocked }" @click="toggleBlock(entry)" :disabled="itemSaving === entry.key">
                {{ entry.blocked ? t("roles.unblock") : t("roles.block") }}
              </button>
              <button v-else class="btn btn-danger sm" @click="deleteCustomUser(entry)" :disabled="itemSaving === entry.key">
                {{ deleteConfirmKey === entry.key ? t("roles.delete_user_sure") : t("roles.delete") }}
              </button>
            </div>
            <span class="user-chevron" v-html="iconSvgFor(expandedKey === entry.key ? 'chevron-up' : 'chevron-down')"></span>
          </div>

          <div v-if="expandedKey === entry.key && !entry.blocked" class="user-perms">
            <div class="user-perms-header">
              <span class="user-perms-sub">
                {{ entry.role === "custom" ? t("roles.custom_perms") : entry.permissions !== null ? t("roles.custom_perms") : t("roles.using_default") }}
              </span>
              <button v-if="entry.role !== 'custom' && entry.permissions !== null" class="reset-btn" @click="resetOverride(entry)" :disabled="itemSaving === entry.key">
                <span v-html="iconSvgFor('refresh-cw')"></span> {{ t("roles.reset") }}
              </button>
            </div>

            <div class="perm-grid">
              <div v-for="group in PERM_GROUPS" :key="group.label" class="perm-group">
                <div class="perm-group-label">{{ group.label }}</div>
                <div class="perm-rows">
                  <div v-for="perm in group.perms" :key="perm.key" class="perm-row compact">
                    <div class="perm-info">
                      <div class="perm-label">{{ perm.label }}</div>
                    </div>
                    <div class="toggle-wrap">
                      <span
                        v-if="entry.role !== 'custom'"
                        class="default-val"
                        :class="{ active: (defaultsFor(entry.role) as any)[perm.key] }"
                      >
                        {{ (defaultsFor(entry.role) as any)[perm.key] ? t("roles.default_on") : t("roles.default_off") }}
                      </span>
                      <div
                        class="ep-switch sm"
                        :class="{ on: entry.role === 'custom' ? (entry.permissions as any)[perm.key] : (entry.permissions as any)?.[perm.key] ?? (defaultsFor(entry.role) as any)[perm.key] }"
                        @click="togglePerm(entry, perm.key)"
                      >
                        <div class="ep-switch-knob"></div>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.roles {
  display: flex;
  flex-direction: column;
  gap: 20px;
}

.roles-header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 16px;
  padding-bottom: 16px;
  border-bottom: 1px solid #222;
}

.roles-title {
  font-size: 18px;
  font-weight: 700;
  color: #e0e0e0;
  margin-bottom: 4px;
}

.roles-sub {
  font-size: 12px;
  color: #666;
}

.chan {
  color: #9d6cff;
}

.defaults-row {
  display: grid;
  grid-template-columns: 1fr 1fr 1fr;
  gap: 12px;
  position: relative;
}

.users-section {
  background: #1a1a1e;
  border: 1px solid #2a2a30;
  padding: 18px 20px;
  display: flex;
  flex-direction: column;
  gap: 14px;
}

.users-header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  flex-wrap: wrap;
  gap: 12px;
}

.users-title {
  font-size: 14px;
  font-weight: 700;
  color: #e0e0e0;
  margin-bottom: 4px;
}

.users-sub {
  font-size: 11px;
  color: #555;
}

.add-box {
  border: 1px solid #222;
  background: #141418;
  padding: 14px;
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.add-row {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
}

.add-sub {
  font-size: 11px;
  color: #555;
}

.add-error {
  font-size: 11px;
  color: #f14949;
}

.input {
  background: #111217;
  border: 1px solid #2a2a30;
  color: #d0d0d0;
  font-size: 12px;
  padding: 0 10px;
  outline: none;
  font-family: inherit;
  height: 32px;
  transition: border-color 0.15s;
}

.input:focus {
  border-color: #6f2bff66;
}

.username-input {
  flex: 1;
  min-width: 160px;
}

.search-input {
  width: 100%;
  height: 40px;
  font-size: 13px;
  padding: 0 14px;
}

.btn {
  padding: 0 14px;
  height: 32px;
  border: 1px solid;
  font-size: 11px;
  font-weight: 600;
  cursor: pointer;
  font-family: inherit;
  transition: background 0.15s, border-color 0.15s, color 0.15s;
  display: inline-flex;
  align-items: center;
  gap: 4px;
  white-space: nowrap;
}

.btn.sm {
  height: 24px;
  padding: 0 10px;
  font-size: 10px;
}

.btn-primary {
  background: #6f2bff;
  border-color: #6f2bff;
  color: #fff;
}

.btn-primary:hover {
  background: #7c3cff;
}

.btn-primary:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}

.btn-secondary {
  background: transparent;
  border-color: #2a2a30;
  color: #9d6cff;
}

.btn-secondary:hover {
  background: #6f2bff11;
}

.btn-danger {
  background: transparent;
  border-color: rgba(241, 73, 73, 0.44);
  color: #f14949;
}

.btn-danger:hover {
  background: rgba(241, 73, 73, 0.08);
}

.btn-danger.btn-allow {
  border-color: rgba(35, 209, 139, 0.44);
  color: #23d18b;
}

.btn-danger.btn-allow:hover {
  background: rgba(35, 209, 139, 0.08);
}

.btn:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}

.perm-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(220px, 1fr));
  gap: 12px;
}

.perm-group {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.perm-group-label {
  font-size: 9px;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.08em;
  color: #9d6cff;
  margin-bottom: 4px;
}

.perm-rows {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.perm-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 8px 10px;
  background: #222226;
  transition: background 0.1s;
}

.perm-row:hover {
  background: #28282e;
}

.perm-row.compact {
  padding: 6px 10px;
}

.perm-info {
  flex: 1;
  min-width: 0;
}

.perm-label {
  font-size: 12px;
  font-weight: 600;
  color: #d0d0d0;
}

.ep-switch.sm {
  width: 32px;
  height: 18px;
}

.ep-switch.sm .ep-switch-knob {
  width: 12px;
  height: 12px;
}

.ep-switch.sm.on .ep-switch-knob {
  transform: translateX(14px);
}

.filter-bar {
  display: flex;
  gap: 4px;
  flex-wrap: wrap;
}

.filter-btn {
  height: 26px;
  padding: 0 12px;
  border: 1px solid #2a2a30;
  background: transparent;
  color: #555;
  font-size: 10px;
  font-weight: 600;
  cursor: pointer;
  font-family: inherit;
  transition: all 0.15s;
}

.filter-btn:hover {
  color: #e0e0e0;
  border-color: #444;
}

.filter-btn.active {
  background: #6f2bff1f;
  border-color: #6f2bff66;
  color: #9d6cff;
}

.filter-count {
  display: inline-block;
  margin-left: 4px;
  font-size: 9px;
  background: rgba(255, 255, 255, 0.08);
  padding: 0 5px;
}

.empty {
  text-align: center;
  color: #3a3a50;
  font-size: 12px;
  padding: 24px 0;
}

.user-list {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.user-item {
  border: 1px solid #1e1e22;
  background: #141418;
  transition: border-color 0.15s;
}

.user-item.expanded {
  border-color: #6f2bff66;
}

.user-item.blocked {
  border-color: rgba(241, 73, 73, 0.4);
  opacity: 0.85;
}

.user-item.overridden {
  border-color: rgba(229, 192, 123, 0.4);
}

.user-row {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px 14px;
  cursor: pointer;
  user-select: none;
  transition: background 0.1s;
}

.user-row:hover {
  background: #1c1c22;
}

.user-dot {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: #3a3a50;
  flex-shrink: 0;
}

.user-dot.gray {
  background: #3a3a50;
}

.user-dot.blocked {
  background: #f14949;
}

.role-badge-icon {
  width: 16px;
  height: 16px;
  flex-shrink: 0;
}

.user-name {
  flex: 1;
  font-size: 13px;
  font-weight: 600;
  color: #d0d0d0;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.user-badges {
  display: flex;
  gap: 6px;
  flex-wrap: wrap;
}

.user-badge {
  font-size: 9px;
  font-weight: 700;
  padding: 2px 6px;
  letter-spacing: 0.04em;
  text-transform: uppercase;
  background: #11111a;
  color: #555;
  border: 1px solid #222;
}

.user-badge.custom {
  background: rgba(229, 192, 123, 0.13);
  color: #e5c07b;
  border-color: rgba(229, 192, 123, 0.4);
}

.user-badge.blocked {
  background: rgba(241, 73, 73, 0.13);
  color: #f14949;
  border-color: rgba(241, 73, 73, 0.4);
}

.user-actions {
  display: flex;
  gap: 6px;
}

.user-chevron {
  font-size: 10px;
  color: #3a3a50;
  transition: transform 0.15s;
  flex-shrink: 0;
}

.user-item.expanded .user-chevron {
  transform: rotate(180deg);
}

.user-perms {
  padding: 12px 14px 14px;
  border-top: 1px solid #1e1e22;
  background: #111115;
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.user-perms-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  flex-wrap: wrap;
  gap: 8px;
}

.user-perms-sub {
  font-size: 11px;
  color: #555;
}

.reset-btn {
  height: 24px;
  padding: 0 10px;
  border: 1px solid rgba(229, 192, 123, 0.33);
  background: transparent;
  color: #e5c07b;
  font-size: 10px;
  cursor: pointer;
  font-family: inherit;
  transition: all 0.15s;
}

.reset-btn:hover {
  background: rgba(229, 192, 123, 0.08);
}

.reset-btn:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}

.toggle-wrap {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-shrink: 0;
}

.default-val {
  font-size: 9px;
  color: #333;
  white-space: nowrap;
}

.default-val.active {
  color: #555;
}

@media (max-width: 800px) {
  .defaults-row {
    grid-template-columns: 1fr;
  }
}

@media (max-width: 680px) {
  .roles-header {
    flex-direction: column;
    align-items: stretch;
  }

  .perm-grid {
    grid-template-columns: 1fr;
  }

  .users-header {
    flex-direction: column;
    align-items: stretch;
  }
}
</style>
