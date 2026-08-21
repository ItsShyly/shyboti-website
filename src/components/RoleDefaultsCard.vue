<script setup lang="ts">
import { ref, computed, onMounted, watch } from "vue";
import { API } from "../api";
import { useAuth } from "../auth";
import { useI18n } from "../i18n";
import { iconSvg as iconSvgFor } from "../composables/icons";
import type { RolePermissions } from "../auth";
import ReauthLink from "./shared/ReauthLink.vue";

const props = defineProps<{ kind: "mod" | "vip" }>();
const emit = defineEmits<{ saved: [] }>();

const { session } = useAuth();
const { t } = useI18n();

const isVip = computed(() => props.kind === "vip");
const badgeLabel = computed(() => (isVip.value ? "VIP" : "MOD"));
const rolesBase = computed(() => (isVip.value ? "vip-roles" : "roles"));
const enabledField = computed(() => (isVip.value ? "vipsEnabled" : "modsEnabled"));

type Perms = Omit<RolePermissions, "modsEnabled">;

const PERM_GROUPS = computed(() => [
  {
    label: t("perm.group.dashboard"),
    perms: [{ key: "dashboard" as keyof Perms, label: t("perm.dashboard"), desc: t("perm.dashboard.desc") }],
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

const DEFAULT_MOD_PERMS: Perms = {
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

// >>> mirrors apiServer.ts defaults, keep in sync
const DEFAULT_VIP_PERMS: Perms = {
  ...Object.fromEntries(Object.keys(DEFAULT_MOD_PERMS).map((k) => [k, false])),
} as Perms;

const DEFAULT_PERMS = computed(() => (isVip.value ? DEFAULT_VIP_PERMS : DEFAULT_MOD_PERMS));

const open = ref(false);
const enabled = ref(!isVip.value);
const globalPerms = ref<Perms>({ ...DEFAULT_PERMS.value });

const hasScope = ref(true); // >>> avoids warning flash before check resolves
const syncing = ref(false);

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
      permissions: Perms;
    };
    enabled.value = (isVip.value ? data.vipsEnabled : data.modsEnabled) ?? !isVip.value;
    Object.assign(globalPerms.value, DEFAULT_PERMS.value, data.permissions);
  } catch {}
}

async function loadScopeStatus() {
  if (!isVip.value || !session.value) return;
  try {
    const res = await fetch(`${API}/vips/${session.value.channel}/scope-status`, {
      headers: { Authorization: `Bearer ${session.value.token}` },
    });
    if (!res.ok) return;
    const data = (await res.json()) as { hasScope: boolean };
    hasScope.value = data.hasScope;
  } catch {}
}

async function save() {
  if (!session.value) return;
  try {
    const body: Record<string, unknown> = { ...globalPerms.value };
    body[enabledField.value] = enabled.value;
    await fetch(`${API}/${rolesBase.value}/${session.value.channel}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${session.value.token}` },
      body: JSON.stringify(body),
    });
    emit("saved");
  } catch {}
}

async function syncNow() {
  if (!session.value) return;
  syncing.value = true;
  try {
    await fetch(`${API}/vips/sync/${session.value.channel}`, {
      method: "POST",
      headers: { Authorization: `Bearer ${session.value.token}` },
    });
    await loadScopeStatus();
    emit("saved");
  } catch {}
  syncing.value = false;
}

function reload() {
  load();
  loadScopeStatus();
}

onMounted(reload);
watch(() => session.value?.channel, reload);
</script>

<template>
  <details class="ep-details defaults-card" :open="open">
    <summary @click.prevent="open = !open">
      <span class="badge" :class="isVip ? 'badge-vip' : 'badge-mod'">{{ badgeLabel }}</span>
      {{ isVip ? t("roles.vip_access") : t("roles.mod_access") }}
      <div class="card-toggle" @click.stop>
        <div class="ep-switch" :class="{ on: enabled }" @click="enabled = !enabled; save();">
          <div class="ep-switch-knob"></div>
        </div>
      </div>
      <span class="ep-details-icon closed" v-html="iconSvgFor('chevron-right')"></span>
      <span class="ep-details-icon open" v-html="iconSvgFor('chevron-down')"></span>
    </summary>
    <div class="ep-details-body">
      <p class="card-sub">{{ isVip ? t("roles.vip_sub") : t("roles.mod_sub") }}</p>

      <div v-if="isVip && !hasScope" class="scope-warning">
        {{ t("roles.scope_warning_pre") }}<ReauthLink>{{ t("roles.scope_warning_link") }}</ReauthLink>{{ t("roles.scope_warning_post") }}
      </div>
      <button v-if="isVip" class="sync-btn" @click.stop="syncNow" :disabled="syncing">
        {{ syncing ? t("roles.syncing") : t("roles.sync") }}
      </button>

      <div class="perm-grid" :class="{ dimmed: !enabled }">
        <div v-for="group in PERM_GROUPS" :key="group.label" class="perm-group">
          <div class="perm-group-label">{{ group.label }}</div>
          <div class="perm-rows">
            <div v-for="perm in group.perms" :key="perm.key" class="perm-row">
              <div class="perm-info">
                <div class="perm-label">{{ perm.label }}</div>
                <div class="perm-desc">{{ perm.desc }}</div>
              </div>
              <div
                class="ep-switch sm"
                :class="{ on: enabled && (globalPerms as any)[perm.key] }"
                @click.stop="enabled && ((globalPerms as any)[perm.key] = !(globalPerms as any)[perm.key]); enabled && save();"
              >
                <div class="ep-switch-knob"></div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  </details>
</template>

<style scoped>
.defaults-card {
  background: #1a1a1e;
  border: 1px solid #2a2a30;
}

.defaults-card summary {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 16px 18px;
  cursor: pointer;
  user-select: none;
  font-size: 13px;
  font-weight: 700;
  color: #e0e0e0;
  list-style: none;
}

.defaults-card summary::-webkit-details-marker {
  display: none;
}

.card-toggle {
  margin-left: auto;
  display: flex;
  align-items: center;
}

.ep-details-icon {
  font-size: 10px;
  color: #555;
  display: none;
}

.defaults-card[open] .ep-details-icon.closed {
  display: none;
}

.defaults-card:not([open]) .ep-details-icon.closed {
  display: inline-flex;
}

.defaults-card[open] .ep-details-icon.open {
  display: inline-flex;
}

.ep-details-body {
  padding: 0 18px 18px;
  display: flex;
  flex-direction: column;
  gap: 12px;
  border-top: 1px solid #222;
  padding-top: 14px;
}

.card-sub {
  font-size: 11px;
  color: #555;
}

.badge {
  font-size: 9px;
  font-weight: 700;
  padding: 2px 6px;
  letter-spacing: 0.05em;
}

.badge-mod {
  background: #6f2bff22;
  color: #9d6cff;
  border: 1px solid #6f2bff44;
}

.badge-vip {
  background: rgba(229, 192, 123, 0.13);
  color: #e5c07b;
  border: 1px solid rgba(229, 192, 123, 0.4);
}

.scope-warning {
  font-size: 11px;
  color: #e5c07b;
  background: rgba(229, 192, 123, 0.08);
  border-left: 2px solid #e5c07b;
  padding: 8px 10px;
}

.sync-btn {
  align-self: flex-start;
  height: 28px;
  padding: 0 12px;
  border: 1px solid #6f2bff44;
  background: transparent;
  color: #9d6cff;
  font-family: inherit;
  font-size: 11px;
  cursor: pointer;
}

.sync-btn:hover {
  background: #6f2bff11;
}

.sync-btn:disabled {
  opacity: 0.4;
  cursor: not-allowed;
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

@media (max-width: 680px) {
  .perm-grid {
    grid-template-columns: 1fr;
  }
}
</style>
