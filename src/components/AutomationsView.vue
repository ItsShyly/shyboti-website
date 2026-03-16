<script setup lang="ts">
import { ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useI18n } from '../i18n'
import TimersView   from './TimersView.vue'
import TriggersView from './TriggersView.vue'

type Tab = 'timers' | 'triggers'
const route  = useRoute()
const router = useRouter()
const { t } = useI18n()

// Keep tab in sync with ?tab= query param so direct links work
const activeTab = ref<Tab>((route.query.tab as Tab) === 'triggers' ? 'triggers' : 'timers')

watch(activeTab, tab => {
  router.replace({ path: '/automations', query: { tab } })
})
watch(() => route.query.tab, tab => {
  if (tab === 'triggers' || tab === 'timers') activeTab.value = tab
})
</script>

<template>
  <div class="automations">
    <div class="auto-tabs">
      <button class="auto-tab" :class="{ active: activeTab === 'timers' }"   @click="activeTab = 'timers'">{{ t('auto.timers') }}</button>
      <button class="auto-tab" :class="{ active: activeTab === 'triggers' }" @click="activeTab = 'triggers'">{{ t('auto.triggers') }}</button>
    </div>
    <div class="auto-body">
      <TimersView   v-if="activeTab === 'timers'" />
      <TriggersView v-else />
    </div>
  </div>
</template>

<style scoped>
.automations { display: flex; flex-direction: column; height: 100%; }
.auto-tabs   { display: flex; border-bottom: 1px solid #222; flex-shrink: 0; margin-bottom: 16px; }
.auto-tab {
  padding: 8px 24px; border: none; background: transparent;
  color: #555; font-family: inherit; font-size: 13px; font-weight: 600;
  cursor: pointer; border-bottom: 2px solid transparent; margin-bottom: -1px;
  transition: color .15s;
}
.auto-tab:hover { color: #aaa; }
.auto-tab.active { color: #9d6cff; border-bottom-color: #6f2bff; }
.auto-body { flex: 1; display: flex; flex-direction: column; min-height: 0; overflow: hidden; }
</style>
