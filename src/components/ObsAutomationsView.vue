<script setup lang="ts">
import { ref, computed, onMounted, watch } from "vue";
import { API } from "../api";
import { useAuth } from "../auth";
import ObsRuleEditPanel from "./ObsRuleEditPanel.vue";
import type { ObsRule } from "./ObsRuleEditPanel.vue";
import { iconSvg as iconSvgFor } from "../composables/icons";

const { session, channelRole } = useAuth();


const canView = computed(
  () => channelRole.value?.permissions?.obs_view ?? false,
);
const canEdit = computed(
  () => channelRole.value?.permissions?.obs_edit ?? false,
);

const paired = ref(false);
const loading = ref(false);
const rules = ref<ObsRule[]>([]);
const scenes = ref<string[]>([]);
const sources = ref<string[]>([]);
const saving = ref<string | null>(null);
const hasCategoryScope = ref(true); // >>> avoids warning flash before check resolves

const RULE_ACTION_LABEL: Record<string, string> = {
  scene: "scene",
  show: "show",
  hide: "hide",
  toggle: "toggle",
  mute: "mute",
  unmute: "unmute",
  mutetoggle: "mute toggle",
  volume: "volume",
  category: "category",
};

// >>> no trigger_type means a legacy bitrate-only rule
function ruleTitle(rule: ObsRule): string {
  const type = rule.trigger_type ?? "bitrate";
  if (type === "bitrate") return `${rule.condition} ${rule.bitrate_kbps} kbps`;
  if (type === "category") return `${rule.category_name ?? "?"} -> ${rule.target}`;
  return `${rule.trigger_scene ?? "?"} -> ${rule.target}`;
}

// >>> category rule but missing required scope
const hasCategoryRule = computed(() =>
  rules.value.some((r) => r.trigger_type === "category" || r.action === "category"),
);

async function fetchRules() {
  if (!session.value || !canView.value) return;
  loading.value = true;
  try {
    const res = await fetch(`${API}/obs/${session.value.channel}`, {
      headers: { Authorization: `Bearer ${session.value.token}` },
    });
    if (res.ok) {
      const d = (await res.json()) as { paired: boolean; rules?: ObsRule[] };
      paired.value = !!d.paired;
      rules.value = d.rules ?? [];
    }
  } catch { }
  loading.value = false;
}

async function fetchCategoryScope() {
  if (!session.value) return;
  try {
    const res = await fetch(`${API}/obs/${session.value.channel}/category-scope-status`, {
      headers: { Authorization: `Bearer ${session.value.token}` },
    });
    if (res.ok) {
      const d = (await res.json()) as { hasScope: boolean };
      hasCategoryScope.value = d.hasScope;
    }
  } catch { }
}

// >>> edit panel
const editOpen = ref(false);
const editTarget = ref<string | null>(null);

function openEdit(id: string | null) {
  editTarget.value = id;
  editOpen.value = true;
  if (session.value && (!scenes.value.length || !sources.value.length)) {
    fetchSceneSourceLists();
  }
}

async function fetchSceneSourceLists() {
  if (!session.value) return;
  try {
    const r = await fetch(`${API}/obs/${session.value.channel}/scenes`, {
      headers: { Authorization: `Bearer ${session.value.token}` },
    });
    if (r.ok) {
      const d = (await r.json()) as { scenes: { sceneName: string }[] };
      scenes.value = d.scenes.map((s) => s.sceneName);
      if (d.scenes[0]) {
        const sr = await fetch(
          `${API}/obs/${session.value.channel}/sources?scene=${encodeURIComponent(d.scenes[0].sceneName)}`,
          { headers: { Authorization: `Bearer ${session.value.token}` } },
        );
        if (sr.ok) {
          const sd = (await sr.json()) as {
            sources: { sourceName: string }[];
          };
          sources.value = sd.sources.map((s) => s.sourceName);
        }
      }
    }
  } catch { }
}

function onSaved() {
  fetchRules();
}

async function toggleRule(rule: ObsRule) {
  if (!session.value || !canEdit.value) return;
  rule.enabled = !rule.enabled;
  await fetch(`${API}/obs/${session.value.channel}/rules`, {
    method: "PUT",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${session.value.token}`,
    },
    body: JSON.stringify({ rules: rules.value }),
  });
}

async function deleteRule(id: string) {
  if (!session.value) return;
  saving.value = id;
  try {
    const newRules = rules.value.filter((r) => r.id !== id);
    await fetch(`${API}/obs/${session.value.channel}/rules`, {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${session.value.token}`,
      },
      body: JSON.stringify({ rules: newRules }),
    });
    rules.value = newRules;
    if (editOpen.value && editTarget.value === id) editOpen.value = false;
  } catch { }
  saving.value = null;
}

onMounted(() => {
  fetchRules();
  fetchCategoryScope();
});
// >>> refetch on channel switch or view-permission change
watch(
  [() => session.value?.channel, canView],
  () => {
    fetchRules();
    fetchCategoryScope();
  },
);

// >>> header stuff lives in AutomationsView, exposed for it
defineExpose({
  header: computed(() => ({
    count: rules.value.length,
    countLabel: "OBS rules",
    createLabel: "New rule",
    canCreate: canEdit.value && paired.value,
  })),
  reload: fetchRules,
  create: () => {
    canEdit.value && paired.value && openEdit(null);
  },
});
</script>

<template>
  <div class="ep-view">
    <div v-if="loading" class="ep-row-list">
      <div class="ep-skeleton-row" v-for="i in 6" :key="i">
        <div class="ep-skeleton-block ep-skeleton-square"></div>
        <div class="ep-skeleton-lines">
          <div class="ep-skeleton-block ep-skeleton-line title"></div>
          <div class="ep-skeleton-block ep-skeleton-line meta"></div>
          <div class="ep-skeleton-block ep-skeleton-line body"></div>
        </div>
        <div class="ep-skeleton-actions">
          <div class="ep-skeleton-block ep-skeleton-btn"></div>
          <div class="ep-skeleton-block ep-skeleton-btn icon"></div>
        </div>
      </div>
    </div>
    <div v-else-if="!paired" class="ep-empty">
      OBS isn't set up yet - set up the agent on the
      <router-link to="/obs-control" class="obs-rule-link">OBS control</router-link> page first.
    </div>
    <template v-else>
      <div v-if="!rules.length" class="ep-empty">
        No obs automations yet. Create one to get started.
      </div>

      <div v-else class="ep-row-list">
        <div v-for="rule in rules" :key="rule.id" class="ep-list-row" :class="{ inactive: !rule.enabled }">
          <div class="timer-toggle-wrap">
            <button class="ep-switch" :class="{ on: rule.enabled, off: !rule.enabled, disabled: !canEdit }"
              @click="canEdit && toggleRule(rule)" :title="rule.enabled ? 'Disable' : 'Enable'"><span class="ep-switch-knob"></span></button>
          </div>
          <div class="timer-info" @click="canEdit && openEdit(rule.id)">
            <div class="timer-name">{{ ruleTitle(rule) }}</div>
            <div class="timer-meta">
              <span class="ep-meta-pill interval">{{ RULE_ACTION_LABEL[rule.action] ?? rule.action }}</span>
              <span class="ep-meta-pill when">{{ rule.target }}<template
                  v-if="rule.action === 'volume' && rule.value !== undefined"> @ {{ rule.value }}%</template></span>
            </div>
          </div>
          <div class="ep-row-actions">
            <button class="ep-btn-action edit" @click.stop="canEdit && openEdit(rule.id)"
              :class="{ disabled: !canEdit }">
              {{ canEdit ? "edit" : "view" }}
            </button>
            <button v-if="canEdit" class="ep-btn-action del" @click.stop="deleteRule(rule.id)"
              :disabled="saving === rule.id" v-html="iconSvgFor('x')">
            </button>
          </div>
        </div>
      </div>
    </template>
  </div>

  <ObsRuleEditPanel :open="editOpen" :channel="session?.channel ?? ''" :rules="rules" :editTarget="editTarget"
    :scenes="scenes" :sources="sources" :hasCategoryScope="hasCategoryScope" @close="editOpen = false"
    @saved="onSaved" />
</template>

<style scoped>
.view-header-left {
  display: flex;
  align-items: center;
  gap: 12px;
  flex-wrap: wrap;
}

.timer-toggle-wrap {
  flex-shrink: 0;
}

.timer-info {
  flex: 1;
  cursor: pointer;
  min-width: 0;
}

.timer-name {
  font-size: 13px;
  font-weight: 600;
  color: #e0e0e0;
  margin-bottom: 4px;
  font-family: "Consolas", "Fira Mono", monospace;
}

.timer-meta {
  display: flex;
  gap: 6px;
  flex-wrap: wrap;
}

.obs-rule-link {
  color: #9d6cff;
  text-decoration: none;
}

.obs-rule-link:hover {
  text-decoration: underline;
}

.obs-scope-warning {
  font-size: 11px;
  color: #e5c07b;
  background: rgba(229, 192, 123, 0.08);
  border-left: 2px solid #e5c07b;
  padding: 8px 10px;
  margin-bottom: 12px;
  line-height: 1.5;
}

@media (max-width: 680px) {
  .ep-row-actions {
    gap: 4px;
  }

  .ep-btn-action {
    padding: 0 8px;
    font-size: 10px;
  }
}
</style>
