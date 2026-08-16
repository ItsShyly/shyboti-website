<script setup lang="ts">
import { ref, computed, onMounted, watch } from "vue";
import { API } from "../api";
import { useAuth } from "../auth";
import { useI18n } from "../i18n";
import type { RolePermissions } from "../auth";

const { session } = useAuth();
const { t } = useI18n();

type Perms = Omit<RolePermissions, "modsEnabled">;

const PERM_GROUPS = computed(() => [
  {
    label: t("perm.group.dashboard"),
    perms: [
      { key: "dashboard" as keyof Perms, label: t("perm.dashboard"), desc: t("perm.dashboard.desc") },
    ],
  },
  {
    label: t("perm.group.commands"),
    perms: [
      { key: "commands_view" as keyof Perms, label: t("perm.commands_view"), desc: t("perm.commands_view.desc") },
      { key: "commands_toggle" as keyof Perms, label: t("perm.commands_toggle"), desc: t("perm.commands_toggle.desc") },
      { key: "commands_edit" as keyof Perms, label: t("perm.commands_edit"), desc: t("perm.commands_edit.desc") },
      { key: "commands_delete" as keyof Perms, label: t("perm.commands_delete"), desc: t("perm.commands_delete.desc") },
      { key: "commands_mod" as keyof Perms, label: t("perm.commands_mod"), desc: t("perm.commands_mod.desc") },
    ],
  },
  {
    label: t("perm.group.automations"),
    perms: [
      { key: "automations_view" as keyof Perms, label: t("perm.automations_view"), desc: t("perm.automations_view.desc") },
      { key: "automations_toggle" as keyof Perms, label: t("perm.automations_toggle"), desc: t("perm.automations_toggle.desc") },
      { key: "automations_edit" as keyof Perms, label: t("perm.automations_edit"), desc: t("perm.automations_edit.desc") },
      { key: "automations_delete" as keyof Perms, label: t("perm.automations_delete"), desc: t("perm.automations_delete.desc") },
    ],
  },
  {
    label: t("perm.group.moderation"),
    perms: [
      { key: "moderation_view" as keyof Perms, label: t("perm.moderation_view"), desc: t("perm.moderation_view.desc") },
      { key: "moderation_manage" as keyof Perms, label: t("perm.moderation_manage"), desc: t("perm.moderation_manage.desc") },
    ],
  },
  {
    label: t("perm.group.obs"),
    perms: [
      { key: "obs_view" as keyof Perms, label: t("perm.obs_view"), desc: t("perm.obs_view.desc") },
      { key: "obs_edit" as keyof Perms, label: t("perm.obs_edit"), desc: t("perm.obs_edit.desc") },
      { key: "obs_force_preview" as keyof Perms, label: t("perm.obs_force_preview"), desc: t("perm.obs_force_preview.desc") },
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

// >>> mod/VIP defaults for the copy-defaults shortcut - one-time snapshot, not a live link
const modDefaults = ref<Perms>({ ...EMPTY_PERMS });
const vipDefaults = ref<Perms>({ ...EMPTY_PERMS });

interface UserEntry {
  username: string;
  permissions: Perms;
}

const users = ref<UserEntry[]>([]);
const usersLoading = ref(false);
const expandedUser = ref<string | null>(null);
const userSaving = ref<string | null>(null);
const deleteConfirm = ref<string | null>(null);

// >>> Add-user form
const newUsername = ref("");
const newPerms = ref<Perms>({ ...EMPTY_PERMS });
const adding = ref(false);
const addError = ref("");

async function loadDefaults() {
  if (!session.value) return;
  const headers = { Authorization: `Bearer ${session.value.token}` };
  try {
    const [modRes, vipRes] = await Promise.all([
      fetch(`${API}/roles/${session.value.channel}`, { headers }),
      fetch(`${API}/vip-roles/${session.value.channel}`, { headers }),
    ]);
    if (modRes.ok) {
      const d = (await modRes.json()) as { permissions: Perms };
      Object.assign(modDefaults.value, EMPTY_PERMS, d.permissions);
    }
    if (vipRes.ok) {
      const d = (await vipRes.json()) as { permissions: Perms };
      Object.assign(vipDefaults.value, EMPTY_PERMS, d.permissions);
    }
  } catch {}
}

async function loadUsers() {
  if (!session.value) return;
  usersLoading.value = true;
  try {
    const res = await fetch(`${API}/users/${session.value.channel}`, {
      headers: { Authorization: `Bearer ${session.value.token}` },
    });
    if (!res.ok) return;
    const data = (await res.json()) as { users: UserEntry[] };
    users.value = data.users;
  } catch {
  } finally {
    usersLoading.value = false;
  }
}

function copyModDefaults() {
  Object.assign(newPerms.value, modDefaults.value);
}
function copyVipDefaults() {
  Object.assign(newPerms.value, vipDefaults.value);
}

async function addUser() {
  if (!session.value) return;
  const username = newUsername.value.trim().toLowerCase();
  if (!username) return;
  adding.value = true;
  addError.value = "";
  try {
    const res = await fetch(`${API}/users/${session.value.channel}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${session.value.token}`,
      },
      body: JSON.stringify({ username, permissions: newPerms.value }),
    });
    if (res.status === 409) {
      addError.value = t("roles.username_placeholder") + " - " + username;
      return;
    }
    if (!res.ok) return;
    newUsername.value = "";
    newPerms.value = { ...EMPTY_PERMS };
    await loadUsers();
  } catch {
  } finally {
    adding.value = false;
  }
}

function toggleExpand(username: string) {
  expandedUser.value = expandedUser.value === username ? null : username;
  deleteConfirm.value = null;
}

async function saveUser(entry: UserEntry) {
  if (!session.value) return;
  userSaving.value = entry.username;
  try {
    await fetch(`${API}/users/${session.value.channel}/${entry.username}`, {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${session.value.token}`,
      },
      body: JSON.stringify({ permissions: entry.permissions }),
    });
  } catch {}
  userSaving.value = null;
}

async function toggleUserPerm(entry: UserEntry, key: keyof Perms) {
  entry.permissions[key] = !entry.permissions[key];
  await saveUser(entry);
}

async function deleteUser(entry: UserEntry) {
  if (deleteConfirm.value !== entry.username) {
    deleteConfirm.value = entry.username;
    return;
  }
  if (!session.value) return;
  userSaving.value = entry.username;
  try {
    await fetch(`${API}/users/${session.value.channel}/${entry.username}`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${session.value.token}` },
    });
    users.value = users.value.filter((u) => u.username !== entry.username);
    if (expandedUser.value === entry.username) expandedUser.value = null;
  } catch {
  } finally {
    userSaving.value = null;
    deleteConfirm.value = null;
  }
}

onMounted(() => {
  loadDefaults();
  loadUsers();
});
watch(
  () => session.value?.channel,
  () => {
    loadDefaults();
    loadUsers();
  },
);
</script>

<template>
  <div class="users-tab">
    <!-- Add user -->
    <div class="section">
      <div class="section-title">{{ t("roles.add_user") }}</div>
      <p class="section-sub">{{ t("roles.users_sub") }}</p>

      <div class="add-row">
        <input v-model="newUsername" class="username-input" :placeholder="t('roles.username_placeholder')"
          @keydown.enter="addUser" />
        <button v-if="newUsername.trim()" class="copy-btn" @click="copyModDefaults">{{ t("roles.copy_mod") }}</button>
        <button v-if="newUsername.trim()" class="copy-btn" @click="copyVipDefaults">{{ t("roles.copy_vip") }}</button>
        <button class="add-btn" :disabled="!newUsername.trim() || adding" @click="addUser">
          {{ t("roles.add_user") }}
        </button>
      </div>
      <div v-if="addError" class="add-error">{{ addError }}</div>

      <div v-if="newUsername.trim()" class="perm-grid">
        <div v-for="group in PERM_GROUPS" :key="group.label" class="perm-group">
          <div class="perm-group-label">{{ group.label }}</div>
          <div class="perm-rows">
            <div v-for="perm in group.perms" :key="perm.key" class="perm-row">
              <div class="perm-info">
                <div class="perm-label">{{ perm.label }}</div>
                <div class="perm-desc">{{ perm.desc }}</div>
              </div>
              <div class="toggle sm" :class="{ on: (newPerms as any)[perm.key] }"
                @click="(newPerms as any)[perm.key] = !(newPerms as any)[perm.key]">
                <div class="toggle-knob"></div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- Existing users -->
    <div class="section">
      <div class="section-title">{{ t("roles.users_title") }}</div>

      <div v-if="usersLoading" class="mods-empty">{{ t("roles.loading") }}</div>
      <div v-else-if="users.length === 0" class="mods-empty">{{ t("roles.no_users") }}</div>

      <div v-else class="mod-list">
        <div v-for="entry in users" :key="entry.username" class="mod-item" :class="{ expanded: expandedUser === entry.username }">
          <div class="mod-header" @click="toggleExpand(entry.username)">
            <span class="mod-dot"></span>
            <span class="mod-name">{{ entry.username }}</span>
            <div class="mod-header-actions" @click.stop>
              <button class="mod-block-btn" @click="deleteUser(entry)" :disabled="userSaving === entry.username">
                {{ deleteConfirm === entry.username ? t("roles.delete_user_sure") : t("roles.delete") }}
              </button>
            </div>
            <span class="mod-chevron">{{ expandedUser === entry.username ? "▲" : "▼" }}</span>
          </div>

          <div v-if="expandedUser === entry.username" class="mod-perms">
            <div class="mod-perm-grid">
              <div v-for="group in PERM_GROUPS" :key="group.label" class="mod-perm-group">
                <div class="perm-group-label">{{ group.label }}</div>
                <div class="perm-rows">
                  <div v-for="perm in group.perms" :key="perm.key" class="perm-row compact">
                    <div class="perm-info">
                      <div class="perm-label">{{ perm.label }}</div>
                    </div>
                    <div class="toggle sm" :class="{ on: (entry.permissions as any)[perm.key] }"
                      @click="toggleUserPerm(entry, perm.key)">
                      <div class="toggle-knob"></div>
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
.users-tab {
  display: flex;
  flex-direction: column;
  gap: 20px;
}

.section {
  background: #1a1a1e;
  border: 1px solid #2a2a30;
  padding: 18px 20px;
}

.section-title {
  font-size: 13px;
  font-weight: 700;
  color: #e0e0e0;
  margin-bottom: 4px;
}

.section-sub {
  font-size: 11px;
  color: #555;
  margin-bottom: 14px;
}

.add-row {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
  margin-bottom: 14px;
}

.username-input {
  flex: 1;
  min-width: 160px;
  height: 32px;
  padding: 0 10px;
  background: #111217;
  border: 1px solid #2a2a30;
  color: #d0d0d0;
  font-family: inherit;
  font-size: 12px;
}

.username-input:focus {
  outline: none;
  border-color: #6f2bff66;
}

.copy-btn {
  height: 32px;
  padding: 0 10px;
  border: 1px solid #2a2a30;
  background: transparent;
  color: #9d6cff;
  font-family: inherit;
  font-size: 11px;
  cursor: pointer;
  white-space: nowrap;
}

.copy-btn:hover {
  background: #6f2bff11;
}

.add-btn {
  height: 32px;
  padding: 0 14px;
  border: none;
  background: #6f2bff;
  color: #fff;
  font-family: inherit;
  font-size: 12px;
  font-weight: 600;
  cursor: pointer;
  white-space: nowrap;
}

.add-btn:hover {
  background: #7f3fff;
}

.add-btn:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}

.add-error {
  font-size: 11px;
  color: #f14949;
  margin-bottom: 10px;
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

.perm-desc {
  font-size: 10px;
  color: #555;
  margin-top: 1px;
}

.toggle {
  width: 38px;
  height: 20px;
  background: #111217;
  cursor: pointer;
  position: relative;
  transition: background 0.2s;
  flex-shrink: 0;
}

.toggle.on {
  background: #6f2bff;
}

.toggle.sm {
  width: 32px;
  height: 18px;
}

.toggle-knob {
  position: absolute;
  top: 3px;
  left: 3px;
  width: 14px;
  height: 14px;
  background: #555;
  transition:
    transform 0.2s,
    background 0.2s;
}

.toggle.sm .toggle-knob {
  width: 12px;
  height: 12px;
}

.toggle.on .toggle-knob {
  transform: translateX(18px);
  background: #fff;
}

.toggle.sm.on .toggle-knob {
  transform: translateX(14px);
}

.mods-empty {
  font-size: 12px;
  color: #555;
  padding: 16px 0 4px;
}

.mod-list {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.mod-item {
  border: 1px solid #222;
  background: #141418;
  transition: border-color 0.15s;
}

.mod-item.expanded {
  border-color: #6f2bff44;
}

.mod-header {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px 14px;
  cursor: pointer;
  user-select: none;
  transition: background 0.1s;
}

.mod-header:hover {
  background: #1c1c22;
}

.mod-dot {
  width: 7px;
  height: 7px;
  flex-shrink: 0;
  background: #23d18b;
}

.mod-name {
  flex: 1;
  font-size: 13px;
  font-weight: 600;
  color: #d0d0d0;
}

.mod-header-actions {
  display: flex;
  gap: 6px;
}

.mod-block-btn {
  height: 24px;
  padding: 0 10px;
  border: 1px solid #f1494944;
  background: transparent;
  color: #f14949;
  font-family: inherit;
  font-size: 10px;
  cursor: pointer;
  transition: background 0.15s;
  white-space: nowrap;
}

.mod-block-btn:hover {
  background: #f1494911;
}

.mod-block-btn:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}

.mod-chevron {
  font-size: 8px;
  color: #444;
}

.mod-perms {
  padding: 12px 14px 14px;
  border-top: 1px solid #222;
  background: #111115;
}

.mod-perm-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(180px, 1fr));
  gap: 10px;
}

.mod-perm-group {
  display: flex;
  flex-direction: column;
  gap: 3px;
}

@media (max-width: 680px) {
  .perm-grid {
    grid-template-columns: 1fr;
  }

  .mod-perm-grid {
    grid-template-columns: 1fr;
  }
}
</style>
