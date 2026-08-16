<script setup lang="ts">
import { ref, computed, onMounted, watch } from "vue";
import { API } from "../api";
import { useAuth } from "../auth";
import { useI18n } from "../i18n";
import { iconSvg as iconSvgFor } from "../composables/icons";
import type { RolePermissions } from "../auth";
import ReauthLink from "./shared/ReauthLink.vue";

const props = defineProps<{ kind: "mod" | "vip" }>();

const { session } = useAuth();
const { t } = useI18n();

const isVip = computed(() => props.kind === "vip");
const badgeLabel = computed(() => (isVip.value ? "VIP" : "MOD"));
const listBase = computed(() => (isVip.value ? "vips" : "mods"));
const rolesBase = computed(() => (isVip.value ? "vip-roles" : "roles"));
const enabledField = computed(() => (isVip.value ? "vipsEnabled" : "modsEnabled"));

// >>> Permission groups for the UI - labels pulled from i18n, same schema for every role tier
const PERM_GROUPS = computed(() => [
  {
    label: t("perm.group.dashboard"),
    perms: [
      {
        key: "dashboard" as keyof Omit<RolePermissions, "modsEnabled">,
        label: t("perm.dashboard"),
        desc: t("perm.dashboard.desc"),
      },
    ],
  },
  {
    label: t("perm.group.commands"),
    perms: [
      {
        key: "commands_view" as keyof Omit<RolePermissions, "modsEnabled">,
        label: t("perm.commands_view"),
        desc: t("perm.commands_view.desc"),
      },
      {
        key: "commands_toggle" as keyof Omit<RolePermissions, "modsEnabled">,
        label: t("perm.commands_toggle"),
        desc: t("perm.commands_toggle.desc"),
      },
      {
        key: "commands_edit" as keyof Omit<RolePermissions, "modsEnabled">,
        label: t("perm.commands_edit"),
        desc: t("perm.commands_edit.desc"),
      },
      {
        key: "commands_delete" as keyof Omit<RolePermissions, "modsEnabled">,
        label: t("perm.commands_delete"),
        desc: t("perm.commands_delete.desc"),
      },
      {
        key: "commands_mod" as keyof Omit<RolePermissions, "modsEnabled">,
        label: t("perm.commands_mod"),
        desc: t("perm.commands_mod.desc"),
      },
    ],
  },
  {
    label: t("perm.group.automations"),
    perms: [
      {
        key: "automations_view" as keyof Omit<RolePermissions, "modsEnabled">,
        label: t("perm.automations_view"),
        desc: t("perm.automations_view.desc"),
      },
      {
        key: "automations_toggle" as keyof Omit<RolePermissions, "modsEnabled">,
        label: t("perm.automations_toggle"),
        desc: t("perm.automations_toggle.desc"),
      },
      {
        key: "automations_edit" as keyof Omit<RolePermissions, "modsEnabled">,
        label: t("perm.automations_edit"),
        desc: t("perm.automations_edit.desc"),
      },
      {
        key: "automations_delete" as keyof Omit<RolePermissions, "modsEnabled">,
        label: t("perm.automations_delete"),
        desc: t("perm.automations_delete.desc"),
      },
    ],
  },
  {
    label: t("perm.group.moderation"),
    perms: [
      {
        key: "moderation_view" as keyof Omit<RolePermissions, "modsEnabled">,
        label: t("perm.moderation_view"),
        desc: t("perm.moderation_view.desc"),
      },
      {
        key: "moderation_manage" as keyof Omit<RolePermissions, "modsEnabled">,
        label: t("perm.moderation_manage"),
        desc: t("perm.moderation_manage.desc"),
      },
    ],
  },
  {
    label: t("perm.group.obs"),
    perms: [
      {
        key: "obs_view" as keyof Omit<RolePermissions, "modsEnabled">,
        label: t("perm.obs_view"),
        desc: t("perm.obs_view.desc"),
      },
      {
        key: "obs_edit" as keyof Omit<RolePermissions, "modsEnabled">,
        label: t("perm.obs_edit"),
        desc: t("perm.obs_edit.desc"),
      },
      {
        key: "obs_force_preview" as keyof Omit<RolePermissions, "modsEnabled">,
        label: t("perm.obs_force_preview"),
        desc: t("perm.obs_force_preview.desc"),
      },
    ],
  },
]);

const DEFAULT_MOD_PERMS: Omit<RolePermissions, "modsEnabled"> = {
  dashboard: true,
  commands_view: true,
  commands_toggle: true,
  commands_edit: false,
  commands_delete: false,
  commands_mod: true,
  automations_view: true,
  automations_toggle: true,
  automations_edit: false,
  automations_delete: false,
  moderation_view: true,
  moderation_manage: false,
  obs_view: false,
  obs_edit: false,
  obs_force_preview: false,
};

// >>> VIPs default to no rights - mirrors apiServer.ts's DEFAULT_VIP_PERMS, keep in sync
const DEFAULT_VIP_PERMS: Omit<RolePermissions, "modsEnabled"> = {
  ...Object.fromEntries(
    Object.keys(DEFAULT_MOD_PERMS).map((k) => [k, false]),
  ),
} as Omit<RolePermissions, "modsEnabled">;

const DEFAULT_PERMS = computed(() =>
  isVip.value ? DEFAULT_VIP_PERMS : DEFAULT_MOD_PERMS,
);

// >>> VIPs default off (matches DB default), so the tab doesn't flash "on" before load() resolves
const enabled = ref(!isVip.value);
const globalPerms = ref<Omit<RolePermissions, "modsEnabled">>({
  ...DEFAULT_PERMS.value,
});

// >>> Individual override list (synced membership + per-user overrides)
interface RoleEntry {
  username: string;
  blocked: boolean;
  permissions: Omit<RolePermissions, "modsEnabled"> | null;
}

const items = ref<RoleEntry[]>([]);
const itemsLoading = ref(false);
const expandedItem = ref<string | null>(null);
const searchQuery = ref("");

const filteredItems = computed(() => {
  const q = searchQuery.value.trim().toLowerCase();
  if (!q) return items.value;
  return items.value.filter((i) => i.username.toLowerCase().includes(q));
});

// >>> VIP-only: OAuth scope status + manual sync
const hasScope = ref(true); // >>> optimistic default so the warning doesn't flash before the check resolves
const syncing = ref(false);

// >>> Save state
const saving = ref(false);
const saved = ref(false);
const itemSaving = ref<string | null>(null);

function showSaved() {
  saved.value = true;
  setTimeout(() => (saved.value = false), 2000);
}

// >>> Load
async function load() {
  if (!session.value) return;
  try {
    const res = await fetch(`${API}/${rolesBase.value}/${session.value.channel}`, {
      headers: { Authorization: `Bearer ${session.value.token}` },
    });
    if (!res.ok) return;
    const data = (await res.json()) as {
      modsEnabled?: boolean;
      vipsEnabled?: boolean;
      permissions: Omit<RolePermissions, "modsEnabled">;
    };
    enabled.value =
      (isVip.value ? data.vipsEnabled : data.modsEnabled) ?? !isVip.value;
    Object.assign(globalPerms.value, DEFAULT_PERMS.value, data.permissions);
  } catch { }
}

async function loadItems() {
  if (!session.value) return;
  itemsLoading.value = true;
  try {
    const res = await fetch(`${API}/${listBase.value}/${session.value.channel}`, {
      headers: { Authorization: `Bearer ${session.value.token}` },
    });
    if (!res.ok) return;
    const data = (await res.json()) as { mods?: RoleEntry[]; vips?: RoleEntry[] };
    items.value = (isVip.value ? data.vips : data.mods) ?? [];
  } catch {
  } finally {
    itemsLoading.value = false;
  }
}

async function loadScopeStatus() {
  if (!isVip.value || !session.value) return;
  try {
    const res = await fetch(
      `${API}/vips/${session.value.channel}/scope-status`,
      { headers: { Authorization: `Bearer ${session.value.token}` } },
    );
    if (!res.ok) return;
    const data = (await res.json()) as { hasScope: boolean };
    hasScope.value = data.hasScope;
  } catch { }
}

// >>> Save global
async function save() {
  if (!session.value) return;
  saving.value = true;
  try {
    const body: Record<string, unknown> = { ...globalPerms.value };
    body[enabledField.value] = enabled.value;
    await fetch(`${API}/${rolesBase.value}/${session.value.channel}`, {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${session.value.token}`,
      },
      body: JSON.stringify(body),
    });
    showSaved();
  } catch { }
  saving.value = false;
}

async function syncNow() {
  if (!session.value) return;
  syncing.value = true;
  try {
    await fetch(`${API}/vips/sync/${session.value.channel}`, {
      method: "POST",
      headers: { Authorization: `Bearer ${session.value.token}` },
    });
    await Promise.all([loadItems(), loadScopeStatus()]);
  } catch { }
  syncing.value = false;
}

// >>> Per-item
function toggleExpand(username: string) {
  expandedItem.value = expandedItem.value === username ? null : username;
}

async function saveItemOverride(item: RoleEntry) {
  if (!session.value) return;
  itemSaving.value = item.username;
  try {
    await fetch(
      `${API}/${listBase.value}/${session.value.channel}/${item.username}`,
      {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${session.value.token}`,
        },
        body: JSON.stringify({
          blocked: item.blocked,
          permissions: item.permissions,
        }),
      },
    );
  } catch { }
  itemSaving.value = null;
}

async function blockItem(item: RoleEntry) {
  item.blocked = !item.blocked;
  if (item.blocked) item.permissions = null;
  await saveItemOverride(item);
}

function setItemOverride(item: RoleEntry) {
  if (!item.permissions) {
    item.permissions = { ...globalPerms.value };
  }
}

async function clearItemOverride(item: RoleEntry) {
  item.permissions = null;
  item.blocked = false;
  await saveItemOverride(item);
}

// >>> override matching global defaults exactly isn't real - drop to null so it keeps tracking global changes
function matchesGlobal(
  perms: Omit<RolePermissions, "modsEnabled">,
): boolean {
  return (Object.keys(globalPerms.value) as (keyof typeof perms)[]).every(
    (k) => perms[k] === globalPerms.value[k],
  );
}

async function toggleItemPerm(
  item: RoleEntry,
  key: keyof Omit<RolePermissions, "modsEnabled">,
) {
  if (!item.permissions) setItemOverride(item);
  item.permissions![key] = !item.permissions![key];
  if (matchesGlobal(item.permissions!)) {
    item.permissions = null;
  }
  await saveItemOverride(item);
}

function reload() {
  load();
  loadItems();
  loadScopeStatus();
}

onMounted(reload);
watch(() => props.kind, reload);
watch(() => session.value?.channel, reload);
</script>

<template>
  <div class="roles-group">
    <span v-if="saved" class="autosave-indicator"><span v-html="iconSvgFor('check')"></span> {{ t("roles.saved") }}</span>

    <!-- Master enable/disable -->
    <div class="section">
      <div class="master-row">
        <div class="master-info">
          <div class="section-title">
            <span class="badge mod">{{ badgeLabel }}</span>
            {{ isVip ? t("roles.vip_access") : t("roles.mod_access") }}
          </div>
          <p class="section-sub">{{ isVip ? t("roles.vip_sub") : t("roles.mod_sub") }}</p>
        </div>
        <div class="toggle" :class="{ on: enabled }" @click="
          enabled = !enabled;
        save();
        ">
          <div class="toggle-knob"></div>
        </div>
      </div>

      <!-- Permission grid - dimmed when disabled -->
      <div class="perm-grid" :class="{ dimmed: !enabled }">
        <div v-for="group in PERM_GROUPS" :key="group.label" class="perm-group">
          <div class="perm-group-label">{{ group.label }}</div>
          <div class="perm-rows">
            <div v-for="perm in group.perms" :key="perm.key" class="perm-row">
              <div class="perm-info">
                <div class="perm-label">{{ perm.label }}</div>
                <div class="perm-desc">{{ perm.desc }}</div>
              </div>
              <div class="toggle sm" :class="{ on: enabled && (globalPerms as any)[perm.key] }" @click="
                enabled &&
                ((globalPerms as any)[perm.key] = !(globalPerms as any)[
                  perm.key
                ]);
              enabled && save();
              ">
                <div class="toggle-knob"></div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- VIP scope re-auth warning -->
    <div v-if="isVip && !hasScope" class="scope-warning">
      {{ t("roles.scope_warning_pre") }}<ReauthLink>{{ t("roles.scope_warning_link") }}</ReauthLink>{{
        t("roles.scope_warning_post") }}
    </div>

    <!-- Individual overrides -->
    <div class="section">
      <div class="section-title-row">
        <div>
          <div class="section-title">
            <span class="badge mod">{{ badgeLabel }}S</span>
            {{ t("roles.overrides") }}
          </div>
          <p class="section-sub">{{ t("roles.overrides_sub") }}</p>
        </div>
        <button v-if="isVip" class="sync-btn" @click="syncNow" :disabled="syncing">
          {{ syncing ? t("roles.syncing") : t("roles.sync") }}
        </button>
      </div>

      <input v-if="items.length || searchQuery" v-model="searchQuery" class="search-input"
        :placeholder="t('roles.search_placeholder')" />

      <div v-if="itemsLoading" class="mod-list">
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
      <div v-else-if="items.length === 0" class="mods-empty">
        {{ isVip ? t("roles.no_vips") : t("roles.no_mods") }}
      </div>
      <div v-else-if="filteredItems.length === 0" class="mods-empty">
        {{ t("roles.no_users") }}
      </div>

      <div v-else class="mod-list">
        <div v-for="item in filteredItems" :key="item.username" class="mod-item" :class="{
          expanded: expandedItem === item.username,
          blocked: item.blocked,
          overridden: !item.blocked && item.permissions !== null,
        }">
          <!-- Header row -->
          <div class="mod-header" @click="toggleExpand(item.username)">
            <span class="mod-dot" :class="{
              blocked: item.blocked,
              override: !item.blocked && item.permissions !== null,
            }"></span>
            <span class="mod-name">{{ item.username }}</span>
            <span class="mod-badge" v-if="item.blocked">{{ t("roles.badge.blocked") }}</span>
            <span class="mod-badge override" v-else-if="item.permissions !== null">{{ t("roles.badge.custom")
              }}</span>
            <span class="mod-badge default" v-else>{{ t("roles.badge.default") }}</span>
            <div class="mod-header-actions" @click.stop>
              <button class="mod-block-btn" :class="{ 'mod-block-btn-allow': item.blocked }" @click="blockItem(item)"
                :disabled="itemSaving === item.username">
                {{ item.blocked ? t("roles.unblock") : t("roles.block") }}
              </button>
            </div>
            <span class="mod-chevron" v-html="iconSvgFor(expandedItem === item.username ? 'chevron-up' : 'chevron-down')"></span>
          </div>

          <!-- Expanded permission overrides -->
          <div v-if="expandedItem === item.username && !item.blocked" class="mod-perms">
            <div class="mod-perms-header">
              <span class="mod-perms-sub">{{
                item.permissions !== null ? t("roles.custom_perms") : t("roles.using_default")
                }}</span>
              <button v-if="item.permissions !== null" class="reset-btn" @click="clearItemOverride(item)"
                :disabled="itemSaving === item.username">
                <span v-html="iconSvgFor('refresh-cw')"></span> {{ t("roles.reset") }}
              </button>
            </div>

            <div class="mod-perm-grid">
              <div v-for="group in PERM_GROUPS" :key="group.label" class="mod-perm-group">
                <div class="perm-group-label">{{ group.label }}</div>
                <div class="perm-rows">
                  <div v-for="perm in group.perms" :key="perm.key" class="perm-row compact">
                    <div class="perm-info">
                      <div class="perm-label">{{ perm.label }}</div>
                    </div>
                    <div class="toggle-wrap">
                      <span class="default-val" :class="{ active: (globalPerms as any)[perm.key] }">
                        {{ (globalPerms as any)[perm.key] ? t("roles.default_on") : t("roles.default_off") }}
                      </span>
                      <div class="toggle sm"
                        :class="{ on: (item.permissions as any)?.[perm.key] ?? (globalPerms as any)[perm.key] }"
                        @click="toggleItemPerm(item, perm.key)">
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
  </div>
</template>

<style scoped>
.roles-group {
  display: flex;
  flex-direction: column;
  gap: 20px;
}

.autosave-indicator {
  align-self: flex-end;
  font-size: 11px;
  color: #23d18b;
  padding: 4px 10px;
  background: rgba(35, 209, 139, 0.08);
  border: 1px solid rgba(35, 209, 139, 0.3);
}

.section {
  background: #1a1a1e;
  border: 1px solid #2a2a30;
  padding: 18px 20px;
}

.section-title-row {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
}

.section-title {
  display: flex;
  align-items: center;
  gap: 8px;
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

.badge {
  font-size: 9px;
  font-weight: 700;
  padding: 2px 6px;
  letter-spacing: 0.05em;
}

.badge.mod {
  background: #6f2bff22;
  color: #9d6cff;
  border: 1px solid #6f2bff44;
}

.master-row {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 16px;
  padding-bottom: 14px;
  margin-bottom: 14px;
  border-bottom: 1px solid #222;
}

.master-info {
  flex: 1;
}

.master-info .section-sub {
  margin-top: 4px;
}

.perm-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(220px, 1fr));
  gap: 12px;
  transition: opacity 0.2s;
}

.perm-grid.dimmed {
  opacity: 0.3;
  pointer-events: none;
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

.scope-warning {
  font-size: 11px;
  color: #e5c07b;
  background: rgba(229, 192, 123, 0.08);
  border-left: 2px solid #e5c07b;
  padding: 8px 10px;
}

.sync-btn {
  height: 28px;
  padding: 0 12px;
  border: 1px solid #6f2bff44;
  background: transparent;
  color: #9d6cff;
  font-family: inherit;
  font-size: 11px;
  cursor: pointer;
  flex-shrink: 0;
}

.sync-btn:hover {
  background: #6f2bff11;
}

.sync-btn:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}

.search-input {
  width: 100%;
  height: 30px;
  padding: 0 10px;
  margin-top: 10px;
  background: #111217;
  border: 1px solid #2a2a30;
  color: #d0d0d0;
  font-family: inherit;
  font-size: 12px;
}

.search-input:focus {
  outline: none;
  border-color: #6f2bff66;
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
  margin-top: 14px;
}

.mod-item {
  border: 1px solid #222;
  background: #141418;
  transition: border-color 0.15s;
}

.mod-item.expanded {
  border-color: #6f2bff44;
}

.mod-item.blocked {
  border-color: #f1494933;
  opacity: 0.8;
}

.mod-item.overridden {
  border-color: #e5c07b33;
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
  transition: background 0.2s;
}

.mod-dot.blocked {
  background: #f14949;
}

.mod-dot.override {
  background: #e5c07b;
}

.mod-name {
  flex: 1;
  font-size: 13px;
  font-weight: 600;
  color: #d0d0d0;
}

.mod-badge {
  font-size: 9px;
  font-weight: 700;
  padding: 2px 6px;
  letter-spacing: 0.04em;
  background: #23d18b15;
  color: #23d18b;
  border: 1px solid #23d18b33;
}

.mod-badge.default {
  background: #11111a;
  color: #444;
  border-color: #222;
}

.mod-badge.override {
  background: #e5c07b15;
  color: #e5c07b;
  border-color: #e5c07b33;
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
}

.mod-block-btn:hover {
  background: #f1494911;
}

.mod-block-btn.mod-block-btn-allow {
  border-color: #23d18b44;
  color: #23d18b;
}

.mod-block-btn.mod-block-btn-allow:hover {
  background: #23d18b11;
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

.mod-perms-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 12px;
}

.mod-perms-sub {
  font-size: 11px;
  color: #555;
}

.reset-btn,
.override-btn {
  height: 24px;
  padding: 0 10px;
  border: 1px solid #2a2a30;
  background: transparent;
  font-family: inherit;
  font-size: 10px;
  cursor: pointer;
}

.reset-btn {
  color: #e5c07b;
  border-color: #e5c07b33;
}

.reset-btn:hover {
  background: #e5c07b11;
}

.override-btn {
  color: #9d6cff;
  border-color: #6f2bff44;
}

.override-btn:hover {
  background: #6f2bff11;
}

.reset-btn:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}

.mod-perm-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(180px, 1fr));
  gap: 10px;
}

.mod-perm-grid.dimmed {
  opacity: 0.5;
  pointer-events: none;
}

.mod-perm-group {
  display: flex;
  flex-direction: column;
  gap: 3px;
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

@media (max-width: 680px) {
  .perm-grid {
    grid-template-columns: 1fr;
  }

  .mod-perm-grid {
    grid-template-columns: 1fr;
  }

  .master-row {
    flex-direction: column;
  }

  .section-title-row {
    flex-direction: column;
    align-items: stretch;
  }
}
</style>
