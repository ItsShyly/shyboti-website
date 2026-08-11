<script setup lang="ts">
import { ref, computed, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import { useI18n } from "../i18n";
import { useAuth } from "../auth";
import TimersView from "./TimersView.vue";
import TriggersView from "./TriggersView.vue";
import CountdownView from "./CountdownView.vue";
import ObsAutomationsView from "./ObsAutomationsView.vue";

// >>> Tab type extended with countdown + obs <<<
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
  (tab) => {
    activeTab.value = parseTab(tab);
  },
);
</script>

<template>
  <div class="automations">
    <div class="auto-tabs">
      <button
        class="auto-tab"
        :class="{ active: activeTab === 'timers' }"
        @click="activeTab = 'timers'"
      >
        {{ t("auto.timers") }}
      </button>
      <button
        class="auto-tab"
        :class="{ active: activeTab === 'triggers' }"
        @click="activeTab = 'triggers'"
      >
        {{ t("auto.triggers") }}
      </button>
      <button
        class="auto-tab"
        :class="{ active: activeTab === 'countdowns' }"
        @click="activeTab = 'countdowns'"
      >
        {{ t("auto.countdowns") }}
      </button>
      <button
        v-if="canViewObs"
        class="auto-tab"
        :class="{ active: activeTab === 'obs' }"
        @click="activeTab = 'obs'"
      >
        OBS
      </button>
      <button class="auto-tab reload-tab" @click="reloadKey++" title="Reload">
        ↺
      </button>
    </div>
    <div class="auto-body">
      <TimersView v-if="activeTab === 'timers'" :key="'timers-' + reloadKey" />
      <TriggersView
        v-else-if="activeTab === 'triggers'"
        :key="'triggers-' + reloadKey"
      />
      <ObsAutomationsView
        v-else-if="activeTab === 'obs'"
        :key="'obs-' + reloadKey"
      />
      <CountdownView v-else :key="'countdowns-' + reloadKey" />
    </div>
  </div>
</template>

<style scoped>
.automations {
  display: flex;
  flex-direction: column;
  height: 100%;
}
.auto-tabs {
  display: flex;
  border-bottom: 1px solid #222;
  flex-shrink: 0;
  margin-bottom: 16px;
}
.auto-tab {
  padding: 8px 24px;
  border: none;
  background: transparent;
  color: #555;
  font-family: inherit;
  font-size: 13px;
  font-weight: 600;
  cursor: pointer;
  border-bottom: 2px solid transparent;
  margin-bottom: -1px;
  transition: color 0.15s;
}
.auto-tab:hover {
  color: #aaa;
}
.auto-tab.active {
  color: #9d6cff;
  border-bottom-color: #6f2bff;
}
.reload-tab {
  margin-left: auto;
  font-size: 14px;
  padding: 4px 14px;
}
.auto-body {
  flex: 1;
  display: flex;
  flex-direction: column;
  min-height: 0;
  overflow: hidden;
}
</style>
