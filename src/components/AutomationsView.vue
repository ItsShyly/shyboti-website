<script setup lang="ts">
import { ref, computed, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import { useI18n } from "../i18n";
import { useAuth } from "../auth";
import TimersView from "./TimersView.vue";
import TriggersView from "./TriggersView.vue";
import CountdownView from "./CountdownView.vue";
import ObsAutomationsView from "./ObsAutomationsView.vue";

type Tab = "timers" | "triggers" | "countdowns" | "obs";
const route = useRoute();
const router = useRouter();
const { t } = useI18n();
const { channelRole } = useAuth();

const canViewObs = computed(
  () => channelRole.value?.permissions?.obs_view ?? false,
);

function parseTab(v: unknown): Tab {
  if (v === "triggers" || v === "countdowns" || v === "obs") return v;
  return "timers";
}

const activeTab = ref<Tab>(parseTab(route.query.tab));
const reloadKey = ref(0);

watch(activeTab, (tab) => {
  router.replace({ path: "/automations", query: { tab } });
});
watch(
  () => route.query.tab,
  (tab) => { activeTab.value = parseTab(tab); },
);
</script>

<template>
  <div class="automations">

    <div class="ep-view-header">
      <div>
        <div class="ep-view-title">{{ t("auto.title") }}</div>
        <div class="ep-view-sub">{{ t('auto.' + activeTab) }}</div>
      </div>
      <div class="ep-view-header-right">
        <button class="ep-btn-reload" @click="reloadKey++" title="Reload">↺</button>
      </div>
    </div>

    <div class="ep-tabs">
      <button class="ep-tab" :class="{ active: activeTab === 'timers' }" @click="activeTab = 'timers'">
        {{ t("auto.timers") }}
      </button>
      <button class="ep-tab" :class="{ active: activeTab === 'triggers' }" @click="activeTab = 'triggers'">
        {{ t("auto.triggers") }}
      </button>
      <button class="ep-tab" :class="{ active: activeTab === 'countdowns' }" @click="activeTab = 'countdowns'">
        {{ t("auto.countdowns") }}
      </button>
      <button v-if="canViewObs" class="ep-tab" :class="{ active: activeTab === 'obs' }" @click="activeTab = 'obs'">
        OBS
      </button>
    </div>

    <div class="auto-body">
      <TimersView v-if="activeTab === 'timers'" :key="'timers-' + reloadKey" />
      <TriggersView v-else-if="activeTab === 'triggers'" :key="'triggers-' + reloadKey" />
      <ObsAutomationsView v-else-if="activeTab === 'obs'" :key="'obs-' + reloadKey" />
      <CountdownView v-else :key="'countdowns-' + reloadKey" />
    </div>

  </div>
</template>

<style scoped>
.automations {
  display: flex;
  flex-direction: column;
  height: 100%;
  gap: 0;
}

/* header-right / reload button come from the shared edit-panel.css */

.auto-body {
  flex: 1;
  display: flex;
  flex-direction: column;
  min-height: 0;
  overflow: hidden;
}
</style>
