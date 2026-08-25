<script setup lang="ts">
// >>> used both as a standalone panel (twitch-created rewards) and as a
// >>> tab inside the settings panel (bot-created rewards) - see TwitchView.vue
import { useI18n } from "../../i18n";
import { iconSvg as iconSvgFor } from "../../composables/icons";
import TypeaheadInput from "./TypeaheadInput.vue";
import {
  blankAction,
  previewCommand,
  type RewardAction,
} from "../../composables/channelPointActions";

const { t } = useI18n();

const props = defineProps<{
  actions: RewardAction[];
  refundOnFailure: boolean;
  alwaysRefund: boolean;
  manageable: boolean;
  needsInputWarning: boolean;
  commandNames: string[];
  channelPrefix: string;
  rewardOptions: { id: string; title: string }[];
}>();
const emit = defineEmits<{
  (e: "update:refundOnFailure", v: boolean): void;
  (e: "update:alwaysRefund", v: boolean): void;
}>();

function addAction() {
  props.actions.push(blankAction());
}
function removeAction(i: number) {
  props.actions.splice(i, 1);
}
function onCommandSelected(a: RewardAction) {
  if (!a.args.trim()) a.args = "{user}";
}
</script>

<template>
  <div>
    <div class="ep-field-group cp-toggle-row" :class="{ 'cp-refund-locked': !manageable }">
      <div>
        <div class="ep-field-label">{{ t("cp.actions.refund_on_failure") }}</div>
        <div class="ep-field-hint">{{ t("cp.actions.refund_on_failure_hint") }}</div>
      </div>
      <button class="ep-switch" :class="{ on: refundOnFailure, disabled: !manageable }"
        @click="manageable && emit('update:refundOnFailure', !refundOnFailure)"><span class="ep-switch-knob"></span></button>
    </div>

    <div class="ep-field-group cp-toggle-row" :class="{ 'cp-refund-locked': !manageable }">
      <div>
        <div class="ep-field-label">{{ t("cp.actions.always_refund") }}</div>
        <div class="ep-field-hint">{{ t("cp.actions.always_refund_hint") }}</div>
      </div>
      <button class="ep-switch" :class="{ on: alwaysRefund, disabled: !manageable }"
        @click="manageable && emit('update:alwaysRefund', !alwaysRefund)"><span class="ep-switch-knob"></span></button>
    </div>

    <div v-if="!manageable" class="ep-field-hint cp-refund-hint">
      {{ t("cp.actions.refund_locked_hint") }}
    </div>

    <hr class="cp-divider" />

    <div v-if="needsInputWarning" class="cp-input-warning">
      <span v-html="iconSvgFor('alert-triangle')"></span>
      <span>{{ t("cp.actions.need_input_warning") }}</span>
    </div>

    <div v-if="!actions.length" class="ep-empty cp-actions-empty">
      {{ t("cp.actions.empty") }}
    </div>

    <div v-for="(a, i) in actions" :key="i" class="cp-action-card">
      <div class="cp-action-card-header">
        <select v-model="a.type" class="ep-field-select">
          <option value="run_command">{{ t("cp.actions.type.run_command") }}</option>
          <option value="create_command">{{ t("cp.actions.type.create_command") }}</option>
          <option value="timeout_self">{{ t("cp.actions.type.timeout_self") }}</option>
          <option value="timeout_input_user">{{ t("cp.actions.type.timeout_input_user") }}</option>
          <option value="say">{{ t("cp.actions.type.say") }}</option>
          <option value="ban">{{ t("cp.actions.type.ban") }}</option>
          <option value="shoutout">{{ t("cp.actions.type.shoutout") }}</option>
          <option value="set_title">{{ t("cp.actions.type.set_title") }}</option>
          <option value="set_category">{{ t("cp.actions.type.set_category") }}</option>
          <option value="channel_point_reward">{{ t("cp.actions.type.channel_point_reward") }}</option>
        </select>
        <button class="ep-btn-action del" @click="removeAction(i)" v-html="iconSvgFor('trash')"></button>
      </div>

      <template v-if="a.type === 'run_command'">
        <div class="ep-field-group">
          <label class="ep-field-label">{{ t("cp.actions.command") }}</label>
          <TypeaheadInput v-model="a.command" :items="commandNames"
            :placeholder="t('cp.actions.command_ph')" @select="onCommandSelected(a)" />
        </div>
        <div v-if="a.command.trim()" class="ep-field-group">
          <label class="ep-field-label">{{ t("cp.actions.args") }}
            <span class="ep-field-hint">{{ t("cp.actions.args_hint") }}</span>
          </label>
          <input v-model="a.args" class="ep-field-input" />
          <div class="ep-field-hint cp-cmd-preview">{{ previewCommand(a, channelPrefix) }}</div>
        </div>
      </template>

      <template v-else-if="a.type === 'create_command'">
        <div class="ep-field-group">
          <label class="ep-field-label">{{ t("cp.actions.name") }}
            <span class="ep-field-hint">{{ t("cp.actions.name_hint") }}</span>
          </label>
          <input v-model="a.name" class="ep-field-input" />
        </div>
        <div class="ep-field-group">
          <label class="ep-field-label">{{ t("cp.actions.response") }}
            <span class="ep-field-hint">{{ t("cp.actions.response_hint") }}</span>
          </label>
          <input v-model="a.response" class="ep-field-input" />
        </div>
      </template>

      <template v-else-if="a.type === 'timeout_self' || a.type === 'timeout_input_user'">
        <div class="ep-field-group">
          <label class="ep-field-label">{{ t("cp.actions.seconds") }}</label>
          <input v-model.number="a.seconds" type="number" min="1" max="1209600" class="ep-field-input" />
        </div>
      </template>

      <template v-else-if="a.type === 'say' || a.type === 'set_title' || a.type === 'set_category'">
        <div class="ep-field-group">
          <label class="ep-field-label">{{ t(`cp.actions.field.${a.type}`) }}
            <span class="ep-field-hint">{{ t("cp.actions.response_hint") }}</span>
          </label>
          <input v-model="a.response" class="ep-field-input" />
        </div>
      </template>

      <template v-else-if="a.type === 'shoutout'">
        <div class="ep-field-group">
          <label class="ep-field-label">{{ t("cp.actions.response") }}
            <span class="ep-field-hint">{{ t("cp.actions.shoutout_hint") }}</span>
          </label>
          <input v-model="a.response" class="ep-field-input" />
        </div>
      </template>

      <template v-else-if="a.type === 'channel_point_reward'">
        <div class="ep-field-group">
          <label class="ep-field-label">{{ t("cp.actions.reward") }}</label>
          <TypeaheadInput :model-value="rewardOptions.find((r) => r.id === a.rewardId)?.title ?? ''"
            :items="rewardOptions.map((r) => r.title)" placeholder="pick a bot-created reward"
            @select="(item: any) => (a.rewardId = rewardOptions.find((r) => r.title === item.label)?.id ?? '')" />
        </div>
        <div class="ep-field-group">
          <label class="ep-field-label">{{ t("cp.actions.reward_state") }}</label>
          <select v-model="a.rewardState" class="ep-field-select">
            <option value="activate">{{ t("cp.actions.reward_state.activate") }}</option>
            <option value="deactivate">{{ t("cp.actions.reward_state.deactivate") }}</option>
          </select>
        </div>
      </template>
    </div>

    <button class="ep-btn-cancel cp-add-action-btn" @click="addAction">
      + {{ t("cp.actions.add") }}
    </button>
  </div>
</template>

<style scoped>
/* >>> scoped styles don't cross component boundaries, so these are
   duplicated from TwitchView.vue's own scoped style */
.cp-toggle-row {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  gap: 12px;
}

.cp-refund-locked {
  opacity: 0.45;
}

.cp-refund-hint {
  color: #e5c07b;
  margin: -6px 0 14px;
}

.cp-divider {
  border: none;
  border-top: 1px solid #2a2a30;
  margin: 4px 0 18px;
}

.cp-input-warning {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  font-size: 11px;
  color: #e5c07b;
  background: rgba(229, 192, 123, 0.08);
  border-left: 2px solid #e5c07b;
  padding: 8px 10px;
  margin-bottom: 14px;
}

.cp-input-warning svg {
  flex-shrink: 0;
  margin-top: 1px;
}

.cp-actions-empty {
  padding: 20px;
  margin-bottom: 12px;
}

.cp-action-card {
  background: #1a1a1e;
  border: 1px solid #2a2a30;
  padding: 12px;
  margin-bottom: 10px;
  border-radius: 0;
}

.cp-action-card-header {
  display: flex;
  gap: 8px;
  margin-bottom: 12px;
}

.cp-action-card-header .ep-field-select {
  flex: 1;
}

.cp-add-action-btn {
  width: 100%;
  margin-top: 4px;
}

.cp-cmd-preview {
  font-family: monospace;
  margin-top: 4px;
}
</style>
