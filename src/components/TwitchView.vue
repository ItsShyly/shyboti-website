<script setup lang="ts">
import { ref, reactive, computed, onMounted, watch } from "vue";
import { API } from "../api";
import { useAuth } from "../auth";
import { useI18n } from "../i18n";
import { useOverlayClose } from "../composables/useOverlayClose";
import { iconSvg as iconSvgFor } from "../composables/icons";

const { session, channelRole, adminMode } = useAuth();
const { t } = useI18n();
const overlay = useOverlayClose();

interface Reward {
  id: string;
  title: string;
  cost: number;
  prompt: string;
  isEnabled: boolean;
  backgroundColor: string;
  userInputRequired: boolean;
  maxRedemptionsPerStream: number | null;
  maxRedemptionsPerUserPerStream: number | null;
  globalCooldown: number | null;
  isInStock: boolean;
  autoFulfill: boolean;
  manageable: boolean;
}

// >>> only "channel points" for now, more twitch tabs land later
type Tab = "channelpoints";
const activeTab = ref<Tab>("channelpoints");

const canManage = computed(
  () =>
    channelRole.value?.role === "broadcaster" ||
    !!(session.value?.isAdmin && adminMode.value),
);

const rewards = ref<Reward[]>([]);
const loading = ref(false);
const error = ref("");
const saving = ref(false);
const deleteConfirm = ref(false);

function errMsg(code: string | undefined): string {
  const key = `cp.error.${code ?? "request_failed"}`;
  const msg = t(key);
  // >>> unknown backend error code - don't leak the raw key/message into the UI
  return msg && msg !== key ? msg : t("cp.error.request_failed");
}

async function load() {
  if (!session.value) return;
  loading.value = true;
  error.value = "";
  try {
    const res = await fetch(`${API}/channelpoints/${session.value.channel}`, {
      headers: { Authorization: `Bearer ${session.value.token}` },
    });
    const data = await res.json();
    if (!res.ok) {
      rewards.value = [];
      error.value = errMsg(data.error);
      return;
    }
    rewards.value = data.rewards ?? [];
  } catch {
    error.value = errMsg("request_failed");
  } finally {
    loading.value = false;
  }
}

onMounted(load);
watch(() => session.value?.channel, load);

// vvv edit panel vvv

const editOpen = ref(false);
const isNew = ref(false);
const editingId = ref<string | null>(null);
const limitsEnabled = ref(false);
const nameError = ref(false);

const DEFAULT_COLOR = "#9146FF";
const form = reactive({
  title: "",
  prompt: "",
  userInputRequired: false,
  cost: 100,
  backgroundColor: DEFAULT_COLOR,
  autoFulfill: false,
  globalCooldown: 0,
  maxRedemptionsPerStream: 0,
  maxRedemptionsPerUserPerStream: 0,
});

function openNew() {
  isNew.value = true;
  editingId.value = null;
  limitsEnabled.value = false;
  nameError.value = false;
  Object.assign(form, {
    title: "",
    prompt: "",
    userInputRequired: false,
    cost: 100,
    backgroundColor: DEFAULT_COLOR,
    autoFulfill: false,
    globalCooldown: 0,
    maxRedemptionsPerStream: 0,
    maxRedemptionsPerUserPerStream: 0,
  });
  editOpen.value = true;
}

function openEdit(r: Reward) {
  if (!r.manageable || !canManage.value) return;
  isNew.value = false;
  editingId.value = r.id;
  deleteConfirm.value = false;
  nameError.value = false;
  limitsEnabled.value = !!(
    r.globalCooldown ||
    r.maxRedemptionsPerStream ||
    r.maxRedemptionsPerUserPerStream
  );
  Object.assign(form, {
    title: r.title,
    prompt: r.prompt,
    userInputRequired: r.userInputRequired,
    cost: r.cost,
    backgroundColor: r.backgroundColor,
    autoFulfill: r.autoFulfill,
    globalCooldown: r.globalCooldown ?? 0,
    maxRedemptionsPerStream: r.maxRedemptionsPerStream ?? 0,
    maxRedemptionsPerUserPerStream: r.maxRedemptionsPerUserPerStream ?? 0,
  });
  editOpen.value = true;
}

function closePanel() {
  editOpen.value = false;
}

// >>> clears the red border once the user changes the conflicting name
watch(() => form.title, () => (nameError.value = false));

const saveDisabled = computed(() => !form.title.trim() || form.cost < 1);

async function savePanel() {
  if (!session.value || saveDisabled.value) return;
  saving.value = true;
  error.value = "";
  nameError.value = false;
  const body = {
    title: form.title.trim(),
    prompt: form.prompt.trim(),
    userInputRequired: form.userInputRequired,
    cost: form.cost,
    backgroundColor: form.backgroundColor,
    autoFulfill: form.autoFulfill,
    globalCooldown: limitsEnabled.value ? form.globalCooldown : null,
    maxRedemptionsPerStream: limitsEnabled.value
      ? form.maxRedemptionsPerStream
      : null,
    maxRedemptionsPerUserPerStream: limitsEnabled.value
      ? form.maxRedemptionsPerUserPerStream
      : null,
  };
  const h = {
    "Content-Type": "application/json",
    Authorization: `Bearer ${session.value.token}`,
  };
  try {
    const url = isNew.value
      ? `${API}/channelpoints/${session.value.channel}`
      : `${API}/channelpoints/${session.value.channel}/${editingId.value}`;
    const res = await fetch(url, {
      method: isNew.value ? "POST" : "PUT",
      headers: h,
      body: JSON.stringify(body),
    });
    const data = await res.json();
    if (!res.ok) {
      error.value = errMsg(data.error);
      if (data.error === "duplicate_title") nameError.value = true;
      return;
    }
    editOpen.value = false;
    await load();
  } catch {
    error.value = errMsg("request_failed");
  } finally {
    saving.value = false;
  }
}

function requestDelete() {
  if (!deleteConfirm.value) {
    deleteConfirm.value = true;
    return;
  }
  deleteReward();
}

async function deleteReward() {
  if (!session.value || !editingId.value) return;
  saving.value = true;
  try {
    const res = await fetch(
      `${API}/channelpoints/${session.value.channel}/${editingId.value}`,
      {
        method: "DELETE",
        headers: { Authorization: `Bearer ${session.value.token}` },
      },
    );
    const data = await res.json();
    if (!res.ok) {
      error.value = errMsg(data.error);
      return;
    }
    editOpen.value = false;
    await load();
  } catch {
    error.value = errMsg("request_failed");
  } finally {
    saving.value = false;
    deleteConfirm.value = false;
  }
}

async function toggleEnabled(r: Reward) {
  if (!r.manageable || !canManage.value || !session.value) return;
  const next = !r.isEnabled;
  r.isEnabled = next; // <<< optimistic, reverted on failure below
  try {
    const res = await fetch(
      `${API}/channelpoints/${session.value.channel}/${r.id}`,
      {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${session.value.token}`,
        },
        body: JSON.stringify({ isEnabled: next }),
      },
    );
    if (!res.ok) throw new Error();
  } catch {
    r.isEnabled = !next;
    error.value = errMsg("request_failed");
  }
}

function reload() {
  load();
}
</script>

<template>
  <div class="ep-view">
    <div class="ep-view-header">
      <div>
        <div class="ep-view-title">{{ t("twitch.title") }}</div>
        <div class="ep-view-sub">{{ rewards.length }} {{ t("cp.tab") }}</div>
      </div>
      <div class="ep-view-header-right">
        <button class="ep-btn-reload" title="Reload" @click="reload" v-html="iconSvgFor('refresh-cw')"></button>
        <button class="ep-btn-new" :disabled="!canManage" @click="openNew">
          + {{ t("cp.new") }}
        </button>
      </div>
    </div>

    <div v-if="error" class="ep-toast error">{{ error }}</div>

    <div class="ep-tabs">
      <button class="ep-tab" :class="{ active: activeTab === 'channelpoints' }">
        {{ t("cp.tab") }}
      </button>
    </div>

    <div class="cp-explain">
      <span v-html="iconSvgFor('info')"></span>
      <span>{{ t("cp.explain") }}</span>
    </div>

    <div v-if="loading" class="ep-row-list">
      <div class="ep-skeleton-row" v-for="i in 4" :key="i">
        <div class="ep-skeleton-block ep-skeleton-square"></div>
        <div class="ep-skeleton-lines">
          <div class="ep-skeleton-block ep-skeleton-line title"></div>
          <div class="ep-skeleton-block ep-skeleton-line meta"></div>
        </div>
        <div class="ep-skeleton-actions">
          <div class="ep-skeleton-block ep-skeleton-btn icon"></div>
        </div>
      </div>
    </div>

    <div v-else-if="!rewards.length" class="ep-empty">{{ t("cp.empty") }}</div>

    <div v-else class="ep-row-list">
      <div v-for="r in rewards" :key="r.id" class="ep-list-row cp-row" :class="{ inactive: !r.isEnabled }">
        <div class="cp-swatch" :style="{ background: r.backgroundColor }"></div>
        <div class="cp-main">
          <div class="cp-title-row">
            <span class="cp-title">{{ r.title }}</span>
            <span v-if="!r.manageable" class="item-badge cp-locked-badge" :title="t('cp.locked_hint')"
              v-html="iconSvgFor('lock')"></span>
          </div>
          <div class="cp-cost">
            <span class="cp-cost-dot"></span>
            <span>{{ r.cost }}</span>
          </div>
        </div>
        <div class="ep-row-actions">
          <button class="ep-switch"
            :class="{ on: r.isEnabled, off: !r.isEnabled, disabled: !r.manageable || !canManage }"
            :title="t('cp.enabled')" @click="toggleEnabled(r)"><span class="ep-switch-knob"></span></button>
          <button v-if="r.manageable && canManage" class="ep-btn-action edit" @click="openEdit(r)">{{ t("cp.edit") }}</button>
          <span v-else-if="!r.manageable" class="cp-locked-label">{{ t("cp.locked") }}</span>
        </div>
      </div>
    </div>

    <!-- vvv edit panel vvv -->
    <Teleport to="body">
      <div v-if="editOpen" class="ep-overlay" v-bind="overlay.handlers(closePanel)">
        <div class="ep-panel">

          <div class="ep-panel-header">
            <div>
              <div class="ep-panel-title">{{ isNew ? t("cp.panel.new") : t("cp.panel.edit") }}</div>
              <div class="ep-panel-sub">#{{ session?.channel }}</div>
            </div>
            <button class="ep-panel-close" @click="closePanel" v-html="iconSvgFor('x')"></button>
          </div>

          <div class="ep-panel-body">

            <div class="ep-field-group">
              <label class="ep-field-label">{{ t("cp.field.title") }}
                <span class="ep-field-hint">{{ form.title.length }}/45</span>
              </label>
              <input v-model="form.title" maxlength="45" class="ep-field-input" :class="{ 'cp-field-invalid': nameError }"
                :placeholder="t('cp.field.title_ph')" />
              <div v-if="nameError" class="cp-field-error">{{ t("cp.error.duplicate_title") }}</div>
            </div>

            <div class="ep-field-group">
              <label class="ep-field-label">{{ t("cp.field.prompt") }}
                <span class="ep-field-hint">{{ t("cp.field.prompt_hint") }} · {{ form.prompt.length }}/200</span>
              </label>
              <textarea v-model="form.prompt" maxlength="200" class="ep-field-input cp-textarea"></textarea>
            </div>

            <div class="ep-field-group cp-toggle-row">
              <div>
                <div class="ep-field-label">{{ t("cp.field.user_input") }}</div>
                <div class="ep-field-hint">{{ t("cp.field.user_input_hint") }}</div>
              </div>
              <button class="ep-switch" :class="{ on: form.userInputRequired }"
                @click="form.userInputRequired = !form.userInputRequired"><span class="ep-switch-knob"></span></button>
            </div>

            <div class="ep-field-group">
              <label class="ep-field-label">{{ t("cp.field.cost") }}</label>
              <input v-model.number="form.cost" type="number" min="1" class="ep-field-input" />
            </div>

            <div class="ep-field-group">
              <label class="ep-field-label">{{ t("cp.field.color") }}</label>
              <div class="cp-color-row">
                <input type="color" v-model="form.backgroundColor" class="cp-color-pick" />
                <input v-model="form.backgroundColor" class="ep-field-input" placeholder="#9146FF" />
              </div>
              <div class="ep-field-hint">{{ t("cp.field.color_hint") }}</div>
            </div>

            <div class="ep-field-group cp-toggle-row">
              <div>
                <div class="ep-field-label">{{ t("cp.field.skip_queue") }}</div>
                <div class="ep-field-hint">{{ t("cp.field.skip_queue_hint") }}</div>
              </div>
              <button class="ep-switch" :class="{ on: form.autoFulfill }"
                @click="form.autoFulfill = !form.autoFulfill"><span class="ep-switch-knob"></span></button>
            </div>

            <div class="ep-field-group">
              <div class="cp-toggle-row">
                <div>
                  <div class="ep-field-label">{{ t("cp.field.limits") }}</div>
                  <div class="ep-field-hint">{{ t("cp.field.limits_hint") }}</div>
                </div>
                <button class="ep-switch" :class="{ on: limitsEnabled }"
                  @click="limitsEnabled = !limitsEnabled"><span class="ep-switch-knob"></span></button>
              </div>

              <div v-if="limitsEnabled" class="cp-limits-box">
                <div class="ep-field-group">
                  <label class="ep-field-label">{{ t("cp.field.cooldown") }}
                    <span class="ep-field-hint">{{ t("cp.field.cooldown_hint") }}</span>
                  </label>
                  <input v-model.number="form.globalCooldown" type="number" min="0" class="ep-field-input" />
                </div>
                <div class="ep-field-group">
                  <label class="ep-field-label">{{ t("cp.field.max_stream") }}
                    <span class="ep-field-hint">{{ t("cp.field.max_stream_hint") }}</span>
                  </label>
                  <input v-model.number="form.maxRedemptionsPerStream" type="number" min="0" class="ep-field-input" />
                </div>
                <div class="ep-field-group">
                  <label class="ep-field-label">{{ t("cp.field.max_user") }}
                    <span class="ep-field-hint">{{ t("cp.field.max_user_hint") }}</span>
                  </label>
                  <input v-model.number="form.maxRedemptionsPerUserPerStream" type="number" min="0"
                    class="ep-field-input" />
                </div>
              </div>
            </div>

          </div>

          <div class="ep-panel-footer">
            <button v-if="!isNew" class="ep-btn-delete" :class="{ confirm: deleteConfirm }" @click="requestDelete"
              :disabled="saving">
              {{ saving ? '…' : deleteConfirm ? t('cp.panel.sure') : t('cp.panel.delete') }}
            </button>
            <div v-else></div>
            <div class="ep-footer-right">
              <button class="ep-btn-cancel" @click="closePanel">{{ t("cp.panel.cancel") }}</button>
              <button class="ep-btn-save" @click="savePanel" :disabled="saving || saveDisabled">
                {{ saving ? '…' : t("cp.panel.save") }}
              </button>
            </div>
          </div>

        </div>
      </div>
    </Teleport>
    <!-- ^^^ edit panel ^^^ -->

  </div>
</template>

<style scoped>
/* >>> layout comes from shared.css, only channel-points-specific bits here */

.cp-explain {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  padding: 10px 12px;
  margin-bottom: 12px;
  background: #1a1a1e;
  border: 1px solid #2a2a30;
  font-size: 13px;
  color: #999;
  border-radius: 0;
}

.cp-explain svg {
  flex-shrink: 0;
  margin-top: 2px;
}

.cp-row {
  display: grid;
  grid-template-columns: 40px 1fr auto;
  align-items: center;
  gap: 12px;
}

.cp-row.inactive {
  opacity: 0.55;
}

.cp-swatch {
  width: 40px;
  height: 40px;
  border-radius: 0;
  flex-shrink: 0;
}

.cp-main {
  display: flex;
  flex-direction: column;
  gap: 4px;
  min-width: 0;
}

.cp-title-row {
  display: flex;
  align-items: center;
  gap: 6px;
}

.cp-title {
  font-size: 14px;
  font-weight: 600;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.cp-locked-badge {
  display: inline-flex;
  color: #999;
}

.cp-cost {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 13px;
  color: #999;
}

.cp-cost-dot {
  width: 12px;
  height: 12px;
  border: 2px solid #a970ff;
  border-radius: 50%;
}

.cp-locked-label {
  font-size: 12px;
  color: #999;
  padding: 0 6px;
}

.cp-field-invalid {
  border-color: #f1494966 !important;
  background: #1c1215 !important;
}

.cp-field-error {
  font-size: 11px;
  color: #f14949;
  margin-top: 4px;
}

.cp-textarea {
  resize: vertical;
  min-height: 60px;
}

.cp-toggle-row {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  gap: 12px;
}

.cp-color-row {
  display: flex;
  gap: 8px;
  align-items: center;
}

.cp-color-pick {
  width: 36px;
  height: 32px;
  padding: 0;
  border: none;
  background: none;
  cursor: pointer;
  border-radius: 0;
}

.cp-limits-box {
  margin-top: 10px;
  padding: 10px;
  background: #1a1a1e;
  border-radius: 0;
}
</style>
