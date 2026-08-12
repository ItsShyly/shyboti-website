<script setup lang="ts">
import { ref } from "vue";
import { useAuth } from "../auth";
import { useI18n } from "../i18n";
import RoleGroupTab from "./RoleGroupTab.vue";
import RolesUsersTab from "./RolesUsersTab.vue";

type Tab = "mods" | "vips" | "users";

const { session } = useAuth();
const { t } = useI18n();

const activeTab = ref<Tab>("mods");
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

    <div class="ep-tabs">
      <button class="ep-tab" :class="{ active: activeTab === 'mods' }" @click="activeTab = 'mods'">
        {{ t("roles.mod_access") }}
      </button>
      <button class="ep-tab" :class="{ active: activeTab === 'vips' }" @click="activeTab = 'vips'">
        {{ t("roles.vip_access") }}
      </button>
      <button class="ep-tab" :class="{ active: activeTab === 'users' }" @click="activeTab = 'users'">
        {{ t("roles.users_title") }}
      </button>
    </div>

    <RoleGroupTab v-if="activeTab === 'mods'" kind="mod" />
    <RoleGroupTab v-else-if="activeTab === 'vips'" kind="vip" />
    <RolesUsersTab v-else />
  </div>
</template>

<style scoped>
.roles {
  display: flex;
  flex-direction: column;
  gap: 16px;
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

@media (max-width: 680px) {
  .roles-header {
    flex-direction: column;
    align-items: stretch;
  }
}
</style>
