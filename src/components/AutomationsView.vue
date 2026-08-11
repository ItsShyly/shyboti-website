<script setup lang="ts">
import { ref, computed } from "vue";
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

// >>> Derived directly from the route on every read/write
const activeTab = computed<Tab>({
  get: () => parseTab(route.query.tab),
  set: (tab) => {
    router.replace({ path: "/automations", query: { tab } });
  },
});

// >>> Each sub-view exposes { header, reload, create } via defineExpose
const timersRef = ref<any>(null);
const triggersRef = ref<any>(null);
const countdownsRef = ref<any>(null);
const obsRef = ref<any>(null);

const activeChild = computed(() => {
  if (activeTab.value === "timers") return timersRef.value;
  if (activeTab.value === "triggers") return triggersRef.value;
  if (activeTab.value === "obs") return obsRef.value;
  return countdownsRef.value;
});
</script>

<template>
  <div class="automations ep-view">

    <div class="ep-view-header">
      <div>
        <div class="ep-view-title">{{ t("auto.title") }}</div>
        <div class="ep-view-sub">
          <template v-if="activeChild?.header">{{ activeChild.header.count }} {{ activeChild.header.countLabel
          }}</template>
          <template v-else>&mdash;</template>
        </div>
      </div>
      <div class="ep-view-header-right">
        <div id="auto-sync-slot"></div>
        <button class="ep-btn-reload" @click="activeChild?.reload?.()" title="Reload">↺</button>
        <button class="ep-btn-new" :disabled="!activeChild?.header?.canCreate" @click="activeChild?.create?.()">
          {{ activeChild?.header?.createLabel ?? '+ New' }}
        </button>
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
      <TimersView v-if="activeTab === 'timers'" key="timers" ref="timersRef" />
      <TriggersView v-else-if="activeTab === 'triggers'" key="triggers" ref="triggersRef" />
      <ObsAutomationsView v-else-if="activeTab === 'obs'" key="obs" ref="obsRef" />
      <CountdownView v-else key="countdowns" ref="countdownsRef" />
    </div>

  </div>
</template>

<style scoped>
/* .automations layout (flex column, gap, height) comes from shared.css */

.auto-body {
  flex: 1;
  display: flex;
  flex-direction: column;
  min-height: 0;
  overflow: hidden;
}
</style>
