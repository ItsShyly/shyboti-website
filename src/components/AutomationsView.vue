<script setup lang="ts">
import { ref, computed, watch, nextTick } from "vue";
import { useRoute, useRouter } from "vue-router";
import { useI18n } from "../i18n";
import { useAuth } from "../auth";
import { iconSvg as iconSvgFor } from "../composables/icons";
import TimersView from "./TimersView.vue";
import TriggersView from "./TriggersView.vue";
import CountdownView from "./CountdownView.vue";
import ObsAutomationsView from "./ObsAutomationsView.vue";
import SelectionHint from "./shared/SelectionHint.vue";

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

// >>> tab lives in the route, not local state
const activeTab = computed<Tab>({
  get: () => parseTab(route.query.tab),
  set: (tab) => {
    router.replace({ path: "/automations", query: { tab } });
  },
});

// >>> each tab exposes header/reload/create for the toolbar
const timersRef = ref<any>(null);
const triggersRef = ref<any>(null);
const countdownsRef = ref<any>(null);
const obsRef = ref<any>(null);

// >>> set after render, not read live during render
const activeChild = ref<any>(null);
watch(
  [activeTab, timersRef, triggersRef, countdownsRef, obsRef],
  ([tab]) => {
    if (tab === "timers") activeChild.value = timersRef.value;
    else if (tab === "triggers") activeChild.value = triggersRef.value;
    else if (tab === "obs") activeChild.value = obsRef.value;
    else activeChild.value = countdownsRef.value;
  },
  { immediate: true, flush: "post" },
);

// >>> close open panel before the tab unmounts
async function switchTab(tab: Tab) {
  activeChild.value?.close?.();
  await nextTick();
  activeTab.value = tab;
}
</script>

<template>
  <div class="automations ep-view" :class="{ 'ep-panel-docked': !!activeChild?.panelOpen }">

    <div class="ep-view-header">
      <div>
        <div class="ep-view-title">{{ t("auto.title") }}</div>
        <div class="ep-view-sub">
          <SelectionHint v-if="activeChild?.selCount" :count="activeChild.selCount" @clear="activeChild.clearSel()" />
          <template v-else-if="activeChild?.header">{{ activeChild.header.count }} {{ activeChild.header.countLabel
          }}</template>
          <template v-else>&mdash;</template>
        </div>
        <!-- >>> the active tab teleports its colour filter bar here -->
        <div id="auto-color-bar"></div>
      </div>
      <div class="ep-view-header-right">
        <!-- >>> the active tab teleports its column/sync menu here -->
        <div id="auto-header-tools"></div>
        <button class="ep-btn-reload icon-only" @click="activeChild?.reload?.()" :title="t('auto.reload')" v-html="iconSvgFor('refresh-cw')"></button>
        <button class="ep-btn-new" :disabled="!activeChild?.header?.canCreate" @click="activeChild?.create?.()">
          + {{ activeChild?.header?.createLabel ?? t('auto.new') }}
        </button>
      </div>
    </div>

    <div class="ep-tabs">
      <button class="ep-tab" :class="{ active: activeTab === 'timers' }" @click="switchTab('timers')">
        {{ t("auto.timers") }}
      </button>
      <button class="ep-tab" :class="{ active: activeTab === 'triggers' }" @click="switchTab('triggers')">
        {{ t("auto.triggers") }}
      </button>
      <button class="ep-tab" :class="{ active: activeTab === 'countdowns' }" @click="switchTab('countdowns')">
        {{ t("auto.countdowns") }}
      </button>
      <button v-if="canViewObs" class="ep-tab" :class="{ active: activeTab === 'obs' }" @click="switchTab('obs')">
        OBS
      </button>
    </div>

    <div class="auto-body">
      <!-- >>> keepalive: avoids Teleport+unmount crash, see CLAUDE.md -->
      <KeepAlive>
        <TimersView v-if="activeTab === 'timers'" key="timers" ref="timersRef" />
        <TriggersView v-else-if="activeTab === 'triggers'" key="triggers" ref="triggersRef" />
        <ObsAutomationsView v-else-if="activeTab === 'obs'" key="obs" ref="obsRef" />
        <CountdownView v-else key="countdowns" ref="countdownsRef" />
      </KeepAlive>
    </div>

  </div>
</template>

<style scoped>
/* >>> layout comes from shared.css */

.auto-body {
  flex: 1;
  display: flex;
  flex-direction: column;
  min-height: 0;
  overflow: hidden;
}
</style>
