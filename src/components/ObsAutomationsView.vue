<script setup lang="ts">
import { ref, computed, onMounted, watch } from "vue";
import { API } from "../api";
import { useAuth } from "../auth";
import ObsRuleEditPanel from "./ObsRuleEditPanel.vue";
import type { ObsRule } from "./ObsRuleEditPanel.vue";
import { iconSvg as iconSvgFor } from "../composables/icons";
import { useResizableColumns } from "../composables/useResizableColumns";
import ColumnMenu from "./shared/ColumnMenu.vue";
import RowContextMenu from "./shared/RowContextMenu.vue";
import { useRowContextMenu } from "../composables/useRowContextMenu";
import { useRowSelection } from "../composables/useRowSelection";
import { useConfirm } from "../composables/useConfirm";
import { useTabActive } from "../composables/useTabActive";
import ConfirmDialog from "./shared/ConfirmDialog.vue";
import { useI18n } from "../i18n";

const tabActive = useTabActive();

const { t } = useI18n();
const { session, channelRole } = useAuth();
const { ctxOpen, ctxX, ctxY, ctxItems, ctxCooldowns, ctxTitle, openContext } = useRowContextMenu();

// vvv resizable/draggable columns vvv
const OBSAUTO_COL_LABEL: Record<string, () => string> = {
  trigger: () => t("obsauto.header.trigger"),
  action: () => t("obsauto.header.action"),
  manage: () => t("cmd.sort.actions"),
  switch: () => " ", // >>> nbsp keeps the header cell from collapsing
};
function obsAutoColLabel(key: string): string {
  return OBSAUTO_COL_LABEL[key]?.() ?? key;
}
const {
  columns: obsAutoColumns,
  visibleColumns: obsAutoVisibleColumns,
  hidden: obsAutoHidden,
  setColumnHidden: obsAutoSetColHidden,
  resetHidden: obsAutoResetHidden,
  gridTemplateColumns: obsAutoGridTemplateColumns,
  orderOf: obsAutoOrderOf,
  cellStyle: obsAutoCellStyle,
  setHover: obsAutoSetHover,
  clearHover: obsAutoClearHover,
  resizingIndex: obsAutoResizingIndex,
  startResize: obsAutoStartResize,
  draggingIndex: obsAutoColDraggingIndex,
  dragOverIndex: obsAutoColDragOverIndex,
  onDragStart: obsAutoColDragStart,
  onDragEnterCell: obsAutoColDragEnterCell,
  onDrop: obsAutoColDrop,
  onDragEnd: obsAutoColDragEnd,
} = useResizableColumns("obsauto-row", [
  { key: "trigger", label: "", width: 3, minWidth: 130, flex: true, hideable: false },
  { key: "action", label: "", width: 3, minWidth: 130, flex: true },
  { key: "manage", label: "", width: 160, minWidth: 130 },
  { key: "switch", label: "", width: 46, minWidth: 46, hideable: false },
]);
const obsAutoColItems = computed(() =>
  obsAutoColumns.value
    .filter((c) => c.key !== "trigger")
    .map((c) => ({ key: c.key, label: obsAutoColLabel(c.key), hideable: c.hideable })),
);
function openObsAutoColCtx(e: MouseEvent, key: string, hideable?: boolean) {
  if (hideable === false) return;
  openContext(e, {
    items: [
      { key: "hide", label: t("cols.hide"), icon: "eye-off", onClick: () => obsAutoSetColHidden(key, true) },
    ],
  });
}
// ^^^ resizable/draggable columns ^^^


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

const RULE_ACTION_LABEL = computed<Record<string, string>>(() => ({
  scene: t("obsrule.pill.scene"),
  show: t("obsrule.pill.show"),
  hide: t("obsrule.pill.hide"),
  toggle: t("obsrule.pill.toggle"),
  mute: t("obsrule.pill.mute"),
  unmute: t("obsrule.pill.unmute"),
  mutetoggle: t("obsrule.pill.mutetoggle"),
  volume: t("obsrule.pill.volume"),
  category: t("obsrule.pill.category"),
}));

// >>> no trigger_type means a legacy bitrate-only rule - trigger side only,
// the action side is its own column now
function ruleTrigger(rule: ObsRule): string {
  const type = rule.trigger_type ?? "bitrate";
  if (type === "bitrate")
    return t("obsauto.title.bitrate", {
      condition: rule.condition === "above" ? t("obsrule.cond.above") : t("obsrule.cond.below"),
      kbps: rule.bitrate_kbps ?? 0,
    });
  if (type === "category") return rule.category_name ?? "?";
  return rule.trigger_scene ?? "?";
}

// >>> category rule but missing required scope
const hasCategoryRule = computed(() =>
  rules.value.some((r) => r.trigger_type === "category" || r.action === "category"),
);

async function fetchRules() {
  if (!session.value || !canView.value) return;
  const ch = session.value.channel;
  loading.value = true;
  try {
    const res = await fetch(`${API}/obs/${ch}`, {
      headers: { Authorization: `Bearer ${session.value.token}` },
    });
    if (res.ok) {
      const d = (await res.json()) as { paired: boolean; rules?: ObsRule[] };
      if (session.value?.channel !== ch) return;
      paired.value = !!d.paired;
      rules.value = d.rules ?? [];
    }
  } catch { }
  if (session.value?.channel === ch) loading.value = false;
}

async function fetchCategoryScope() {
  if (!session.value) return;
  const ch = session.value.channel;
  try {
    const res = await fetch(`${API}/obs/${ch}/category-scope-status`, {
      headers: { Authorization: `Bearer ${session.value.token}` },
    });
    if (res.ok) {
      const d = (await res.json()) as { hasScope: boolean };
      if (session.value?.channel !== ch) return;
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

const { confirmOpen, confirmData, ask: askConfirm, onConfirm, onCancel } = useConfirm();
const sel = useRowSelection<ObsRule>(() => rules.value, (x) => x.id, {
  isActive: () => tabActive.value,
  onDelete: (items) => bulkDeleteRules(items),
});
async function putRules() {
  if (!session.value) return;
  await fetch(`${API}/obs/${session.value.channel}/rules`, {
    method: "PUT",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${session.value.token}`,
    },
    body: JSON.stringify({ rules: rules.value }),
  });
}
async function bulkRulesEnabled(items: ObsRule[], enabled: boolean) {
  items.forEach((r) => (r.enabled = enabled));
  await putRules();
  sel.clear();
}
async function bulkDeleteRules(items: ObsRule[]) {
  if (
    !(await askConfirm({
      title: t("confirm.delete_title"),
      message: t("sel.delete_confirm", { n: items.length }),
      confirmLabel: t("sel.delete"),
      danger: true,
    }))
  )
    return;
  const ids = new Set(items.map((r) => r.id));
  rules.value = rules.value.filter((r) => !ids.has(r.id));
  await putRules();
  sel.clear();
}
function ruleRowCtx(e: MouseEvent, rule: ObsRule) {
  if (!canEdit.value || !(sel.count.value > 1 && sel.isSelected(rule.id))) return;
  const items = sel.selectedItems.value;
  const n = items.length;
  openContext(e, {
    title: t("sel.n_selected", { n }),
    items: [
      { key: "on", label: `${t("sel.activate")} (${n})`, icon: "check",
        onClick: () => bulkRulesEnabled(items, true) },
      { key: "off", label: `${t("sel.deactivate")} (${n})`,
        onClick: () => bulkRulesEnabled(items, false) },
      { key: "del", label: `${t("sel.delete")} (${n})`, icon: "trash", danger: true,
        onClick: () => bulkDeleteRules(items) },
    ],
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
    countLabel: t("obsauto.count_label"),
    createLabel: t("obsauto.create_label"),
    canCreate: canEdit.value && paired.value,
  })),
  // >>> drives the docked-panel shift on the parent's outer .ep-view
  panelOpen: editOpen,
  reload: fetchRules,
  create: () => {
    canEdit.value && paired.value && openEdit(null);
  },
  // >>> selection hint shows in the parent's header sub-line
  selCount: sel.count,
  clearSel: sel.clear,
});
</script>

<template>
  <div class="ep-view">
    <Teleport to="#auto-header-tools" :disabled="!tabActive">
      <ColumnMenu :columns="obsAutoColItems" :hidden="obsAutoHidden"
        @set="(k: string, h: boolean) => obsAutoSetColHidden(k, h)" @show-all="obsAutoResetHidden()" />
    </Teleport>
    <RowContextMenu :open="ctxOpen" :x="ctxX" :y="ctxY" :items="ctxItems" :cooldowns="ctxCooldowns" :title="ctxTitle"
      @close="ctxOpen = false" />
    <ConfirmDialog :open="confirmOpen" :title="confirmData.title" :message="confirmData.message"
      :confirm-label="confirmData.confirmLabel" :danger="confirmData.danger" @confirm="onConfirm" @cancel="onCancel" />
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
      {{ t('obsauto.not_paired_pre') }}
      <router-link to="/obs-control" class="obs-rule-link">{{ t('obsauto.not_paired_link') }}</router-link> {{
        t('obsauto.not_paired_post') }}
    </div>
    <template v-else>
      <div v-if="!rules.length" class="ep-empty">
        {{ t('obsauto.empty') }}
      </div>

      <template v-else>
        <div class="obsauto-table">
          <div class="ep-row-header obsauto-row" :style="{ gridTemplateColumns: obsAutoGridTemplateColumns }">
            <div v-for="(col, i) in obsAutoVisibleColumns" :key="col.key" class="ep-row-header-cell"
              :class="{ dragging: obsAutoColDraggingIndex === i, 'drag-over': obsAutoColDragOverIndex === i }"
              :style="{ order: i }" draggable="true" @dragstart="obsAutoColDragStart(i)"
              @contextmenu.prevent="openObsAutoColCtx($event, col.key, col.hideable)"
              @dragenter.prevent="obsAutoColDragEnterCell(i)" @dragover.prevent @drop="obsAutoColDrop(i)"
              @dragend="obsAutoColDragEnd()" @mouseenter="obsAutoSetHover(col.key)" @mouseleave="obsAutoClearHover()">
              {{ obsAutoColLabel(col.key) }}
              <span class="ep-col-resize-handle" :class="{ resizing: obsAutoResizingIndex === i }"
                @mousedown="obsAutoStartResize(i, $event)" @click.stop @dragstart.stop.prevent></span>
            </div>
          </div>
          <div class="ep-row-list">
            <div v-for="rule in rules" :key="rule.id" class="ep-row-grid obsauto-row" :data-sel-key="rule.id"
              :style="{ gridTemplateColumns: obsAutoGridTemplateColumns }"
              :class="{ inactive: !rule.enabled, selected: sel.isSelected(rule.id) }"
              @pointerdown="sel.onRowPointerDown($event, rule.id)"
              @click.capture="sel.onRowClickCapture($event, rule.id)"
              @contextmenu.prevent="ruleRowCtx($event, rule)">
              <!-- >>> both cells open the same edit panel -->
              <div class="obsauto-trigger ep-row-cell-hover" :style="obsAutoCellStyle('trigger')"
                @click="canEdit && openEdit(rule.id)">
                <span class="obsauto-title">{{ ruleTrigger(rule) }}</span>
              </div>
              <div class="ep-cell-tags ep-row-cell-hover" :style="obsAutoCellStyle('action')"
                @click="canEdit && openEdit(rule.id)">
                <span class="ep-tag action">{{ RULE_ACTION_LABEL[rule.action] ?? rule.action }}</span>
                <span class="ep-tag condition">{{ rule.target }}<template
                    v-if="rule.action === 'volume' && rule.value !== undefined"> @ {{ rule.value }}%</template></span>
              </div>
              <div class="ep-row-actions" :style="obsAutoCellStyle('manage')">
                <button class="ep-btn-action edit" @click.stop="canEdit && openEdit(rule.id)"
                  :class="{ disabled: !canEdit }">
                  {{ canEdit ? t('obsauto.edit_btn') : t('obsauto.view_btn') }}
                </button>
                <button v-if="canEdit" class="ep-btn-action del" @click.stop="deleteRule(rule.id)"
                  :disabled="saving === rule.id" v-html="iconSvgFor('x')">
                </button>
              </div>
              <div class="ep-row-cell-center ep-row-cell-end" :style="obsAutoCellStyle('switch')">
                <button class="ep-switch" :class="{ on: rule.enabled, off: !rule.enabled, disabled: !canEdit }"
                  @click.stop="canEdit && toggleRule(rule)"
                  :title="rule.enabled ? t('obsauto.disable_title') : t('obsauto.enable_title')"><span
                    class="ep-switch-knob"></span></button>
              </div>
            </div>
          </div>
        </div>
      </template>
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

.obsauto-table {
  display: flex;
  flex-direction: column;
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  scrollbar-width: none;
}
.obsauto-table::-webkit-scrollbar {
  display: none;
}

.obsauto-row {
  grid-template-columns: minmax(180px, 1fr) minmax(180px, 1fr) 180px 50px;
}

.obsauto-trigger {
  display: flex;
  align-items: center;
  padding-left: 10px;
}

.obsauto-title {
  font-size: 13px;
  font-weight: 600;
  color: #e0e0e0;
  font-family: "Consolas", "Fira Mono", monospace;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  min-width: 0;
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
