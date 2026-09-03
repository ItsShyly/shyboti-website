<script setup lang="ts">
import { ref, watch, computed } from "vue";
import { API } from "../api";
import { useAuth } from "../auth";
import { useOverlayClose } from "../composables/useOverlayClose";
import { useEscClose } from "../composables/useEscClose";
import EditableNameHeader from "./shared/EditableNameHeader.vue";
import TypeaheadInput from "./shared/TypeaheadInput.vue";
import { iconSvg as iconSvgFor } from "../composables/icons";
import { useI18n } from "../i18n";

const { t } = useI18n();

export type ObsAccessLevel = "everyone" | "mod" | "broadcaster";

export interface ObsSceneBind {
  command: string;
  scene: string;
  access?: ObsAccessLevel;
  cooldown?: number;
  userCooldown?: number;
}
export interface ObsSourceBind {
  command: string;
  source: string;
  action: string;
  value?: number;
  access?: ObsAccessLevel;
  cooldown?: number;
  userCooldown?: number;
}
export type ObsArgEntry =
  | string
  | {
    command: string;
    access?: ObsAccessLevel;
    cooldown?: number;
    userCooldown?: number;
  };

type BindKind = "scene" | "source" | "arg";

interface Props {
  open: boolean;
  channel: string;
  // >>> used to pre-fill the form
  sceneBindings: ObsSceneBind[];
  sourceBindings: ObsSourceBind[];
  argCommands: Record<string, ObsArgEntry>;
  // >>> null means creating a new one
  editTarget: { kind: BindKind; command: string } | null;
  prefix: string;
  scenes: string[];
  sources: string[];
}

const props = defineProps<Props>();
const emit = defineEmits<{ (e: "close"): void; (e: "saved"): void }>();

const { session } = useAuth();
const overlay = useOverlayClose();
useEscClose(() => props.open && emit("close"));
const saving = ref(false);
const saved = ref(false);
const error = ref("");
const deleting = ref(false);
const deleteConfirm = ref(false);

// >>> form fields
const fKind = ref<BindKind>("scene");
const fAction = ref("scene");
const fCommand = ref("");
const fTarget = ref("");
const fValue = ref<number | "">("");
const fAccess = ref<ObsAccessLevel>("everyone");
const fCooldown = ref(0);
const fUserCd = ref(0);

const SOURCE_ACTIONS = computed(() => [
  { value: "show", label: t("obsrule.action.show") },
  { value: "hide", label: t("obsrule.action.hide") },
  { value: "toggle", label: t("obsrule.action.toggle") },
  { value: "mute", label: t("obsrule.action.mute") },
  { value: "unmute", label: t("obsrule.action.unmute") },
  { value: "mutetoggle", label: t("obsrule.action.mutetoggle") },
  { value: "volume", label: t("obsrule.action.volume") },
]);

const ARG_ACTIONS = computed(() => [
  { value: "scene", label: t("obsrule.action.scene"), usage: "+cmd <scene name>" },
  { value: "show", label: t("obsrule.action.show"), usage: "+cmd <source>" },
  { value: "hide", label: t("obsrule.action.hide"), usage: "+cmd <source>" },
  { value: "toggle", label: t("obsrule.action.toggle"), usage: "+cmd <source>" },
  { value: "mute", label: t("obsrule.action.mute"), usage: "+cmd <source>" },
  { value: "unmute", label: t("obsrule.action.unmute"), usage: "+cmd <source>" },
  { value: "mutetoggle", label: t("obsrule.action.mutetoggle"), usage: "+cmd <source>" },
  { value: "volume", label: t("obsrule.action.volume"), usage: "+cmd <source> <0-100>" },
]);

const isEdit = computed(() => !!props.editTarget);

// >>> fill form on open
watch(
  // >>> docked panel stays open - re-fill when the target row changes too
  () => [props.open, props.editTarget?.kind, props.editTarget?.command],
  () => {
    if (!props.open) return;
    deleteConfirm.value = false;
    saved.value = false;
    error.value = "";
    if (!props.editTarget) {
      fKind.value = "scene";
      fAction.value = "scene";
      fCommand.value = "";
      fTarget.value = "";
      fValue.value = "";
      fAccess.value = "everyone";
      fCooldown.value = 0;
      fUserCd.value = 0;
      return;
    }
    const { kind, command } = props.editTarget;
    fKind.value = kind;
    fCommand.value = command;
    if (kind === "scene") {
      const b = props.sceneBindings.find((x) => x.command === command);
      fAction.value = "scene";
      fTarget.value = b?.scene ?? "";
      fAccess.value = (b?.access as ObsAccessLevel) ?? "everyone";
      fCooldown.value = b?.cooldown ?? 0;
      fUserCd.value = b?.userCooldown ?? 0;
      fValue.value = "";
    } else if (kind === "source") {
      const b = props.sourceBindings.find((x) => x.command === command);
      fAction.value = b?.action ?? "show";
      fTarget.value = b?.source ?? "";
      fValue.value = b?.value ?? "";
      fAccess.value = (b?.access as ObsAccessLevel) ?? "everyone";
      fCooldown.value = b?.cooldown ?? 0;
      fUserCd.value = b?.userCooldown ?? 0;
    } else {
      // >>> find which action maps to this command
      const match = Object.entries(props.argCommands).find(
        ([, e]) => (typeof e === "string" ? e : e.command) === command,
      );
      fAction.value = match?.[0] ?? "scene";
      const e = match?.[1];
      fAccess.value =
        typeof e === "string"
          ? "everyone"
          : ((e?.access as ObsAccessLevel) ?? "everyone");
      fCooldown.value = typeof e === "string" ? 0 : (e?.cooldown ?? 0);
      fUserCd.value = typeof e === "string" ? 0 : (e?.userCooldown ?? 0);
      fTarget.value = "";
      fValue.value = "";
    }
  },
);

// >>> reset action when kind tab changes
watch(fKind, (k) => {
  if (k === "scene") fAction.value = "scene";
  if (k === "source") fAction.value = "show";
  if (k === "arg") fAction.value = "scene";
  fTarget.value = "";
  fValue.value = "";
});

async function save() {
  if (!session.value) return;
  if (missingFields.value.length) {
    error.value = t("obscmd.missing_prefix") + " " + missingFields.value.join(", ");
    return;
  }
  error.value = "";
  saving.value = true;
  try {
    // >>> clone lists before mutating them
    const newScenes = props.sceneBindings.map((b) => ({ ...b }));
    const newSources = props.sourceBindings.map((b) => ({ ...b }));
    const newArgs = { ...props.argCommands };

    const cmd = fCommand.value.trim().replace(/^\+/, "").toLowerCase();

    if (fKind.value === "scene") {
      const idx = newScenes.findIndex(
        (b) => b.command === (isEdit.value ? props.editTarget!.command : cmd),
      );
      const entry: ObsSceneBind = {
        command: cmd,
        scene: fTarget.value.trim(),
        access: fAccess.value,
        cooldown: fCooldown.value,
        userCooldown: fUserCd.value,
      };
      if (idx >= 0) newScenes[idx] = entry;
      else newScenes.push(entry);
    } else if (fKind.value === "source") {
      const idx = newSources.findIndex(
        (b) => b.command === (isEdit.value ? props.editTarget!.command : cmd),
      );
      const entry: ObsSourceBind = {
        command: cmd,
        source: fTarget.value.trim(),
        action: fAction.value,
        access: fAccess.value,
        cooldown: fCooldown.value,
        userCooldown: fUserCd.value,
      };
      if (fAction.value === "volume" && fValue.value !== "")
        entry.value = Number(fValue.value);
      if (idx >= 0) newSources[idx] = entry;
      else newSources.push(entry);
    } else {
      // >>> drop old key first, action may've changed
      if (isEdit.value) {
        const oldKey = Object.entries(props.argCommands).find(
          ([, e]) =>
            (typeof e === "string" ? e : e.command) ===
            props.editTarget!.command,
        )?.[0];
        if (oldKey) delete newArgs[oldKey];
      }
      newArgs[fAction.value] = {
        command: cmd,
        access: fAccess.value,
        cooldown: fCooldown.value,
        userCooldown: fUserCd.value,
      };
    }

    await fetch(`${API}/obs/${props.channel}/bindings`, {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${session.value.token}`,
      },
      body: JSON.stringify({
        scene_bindings: newScenes,
        source_bindings: newSources,
        arg_commands: newArgs,
      }),
    });
    saved.value = true;
    setTimeout(() => {
      saved.value = false;
    }, 2000);
    emit("saved");
  } catch { }
  saving.value = false;
}

async function deleteCmd() {
  if (!session.value || !isEdit.value) return;
  if (!deleteConfirm.value) {
    deleteConfirm.value = true;
    setTimeout(() => {
      deleteConfirm.value = false;
    }, 3000);
    return;
  }
  deleteConfirm.value = false;
  deleting.value = true;
  try {
    const newScenes = props.sceneBindings.filter(
      (b) => b.command !== props.editTarget!.command,
    );
    const newSources = props.sourceBindings.filter(
      (b) => b.command !== props.editTarget!.command,
    );
    const newArgs = { ...props.argCommands };
    const oldKey = Object.entries(props.argCommands).find(
      ([, e]) =>
        (typeof e === "string" ? e : e.command) === props.editTarget!.command,
    )?.[0];
    if (oldKey) delete newArgs[oldKey];

    await fetch(`${API}/obs/${props.channel}/bindings`, {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${session.value.token}`,
      },
      body: JSON.stringify({
        scene_bindings: newScenes,
        source_bindings: newSources,
        arg_commands: newArgs,
      }),
    });
    emit("saved");
    emit("close");
  } catch { }
  deleting.value = false;
}

const missingFields = computed(() => {
  const missing: string[] = [];
  if (!fCommand.value.trim()) missing.push(t("obscmd.missing.command"));
  if ((fKind.value === "scene" || fKind.value === "source") && !fTarget.value.trim())
    missing.push(fKind.value === "scene" ? t("obscmd.missing.scene") : t("obscmd.missing.source"));
  return missing;
});
</script>

<template>
  <Teleport to="body">
    <div v-if="open" class="ep-overlay ep-overlay--dock" v-bind="overlay.handlers(() => emit('close'))">
      <div class="ep-panel obs-ep-panel">
        <div class="ep-panel-header">
          <div>
            <div class="ep-panel-title">
              {{ isEdit ? t('obscmd.title_edit') : t('obscmd.title_new') }}
              <EditableNameHeader v-model="fCommand" :orig-name="editTarget?.command ?? ''" :prefix="prefix"
                :placeholder="t('obscmd.name_ph')" />
            </div>
            <div class="ep-panel-sub">#{{ channel }}</div>
          </div>
          <button class="ep-panel-close" @click="emit('close')" v-html="iconSvgFor('x')"></button>
        </div>

        <div class="ep-panel-body">
          <div v-if="error" class="ep-toast error">{{ error }}</div>
          <div class="ep-field-group">
            <div class="obs-kind-tabs">
              <button class="obs-kind-tab" :class="{ active: fKind === 'scene' }" @click="fKind = 'scene'"
                :disabled="isEdit">
                {{ t('obscmd.tab.fixed_scene') }}
              </button>
              <button class="obs-kind-tab" :class="{ active: fKind === 'source' }" @click="fKind = 'source'"
                :disabled="isEdit">
                {{ t('obscmd.tab.fixed_source') }}
              </button>
              <button class="obs-kind-tab" :class="{ active: fKind === 'arg' }" @click="fKind = 'arg'"
                :disabled="isEdit">
                {{ t('obscmd.tab.chat_arg') }}
              </button>
            </div>
            <div class="ep-field-hint">
              <template v-if="fKind === 'scene'">{{ t('obscmd.hint.scene') }}</template>
              <template v-else-if="fKind === 'source'">{{ t('obscmd.hint.source') }}</template>
              <template v-else>{{ t('obscmd.hint.arg') }}
                {{ t('obscmd.hint.arg_example') }} <code class="ep-mono">+scene cam</code>.</template>
            </div>
          </div>

          <div v-if="fKind !== 'scene'" class="ep-field-group">
            <label class="ep-field-label">{{ t('obscmd.action_label') }}</label>
            <select v-model="fAction" class="ep-field-select">
              <option v-if="fKind === 'source'" v-for="a in SOURCE_ACTIONS" :key="a.value" :value="a.value">
                {{ a.label }}
              </option>
              <option v-if="fKind === 'arg'" v-for="a in ARG_ACTIONS" :key="a.value" :value="a.value">
                {{ a.label }}
              </option>
            </select>
          </div>

          <div v-if="fKind !== 'arg'" class="ep-field-group">
            <label class="ep-field-label">{{ fKind === "scene" ? t('obscmd.scene_label') : t('obscmd.source_label') }}
            </label>
            <TypeaheadInput v-model="fTarget" :items="fKind === 'scene' ? scenes : sources"
              :placeholder="fKind === 'scene' ? t('obscmd.scene_name_ph') : t('obscmd.source_name_ph')" mono />
          </div>

          <div v-if="fKind === 'source' && fAction === 'volume'" class="ep-field-group">
            <label class="ep-field-label">{{ t('obscmd.fixed_volume_label') }}
              <span class="ep-field-hint">{{ t('obscmd.fixed_volume_hint') }}</span></label>
            <input v-model.number="fValue" type="number" min="0" max="100" class="ep-field-input"
              :placeholder="t('obscmd.volume_ph')" />
          </div>

          <div v-if="fKind === 'arg'" class="ep-field-group">
            <label class="ep-field-label">{{ t('obscmd.usage_label') }}</label>
            <div class="obs-usage-preview ep-mono">
              {{ prefix }}{{ fCommand || "cmd" }}
              {{
                ARG_ACTIONS.find((a) => a.value === fAction)?.usage.replace(
                  "+cmd ",
                  "",
                )
              }}
            </div>
          </div>

          <div class="ep-field-group">
            <label class="ep-field-label">{{ t('obscmd.access_label') }}</label>
            <div class="obs-access-row">
              <button class="obs-access-btn" :class="{ active: fAccess === 'everyone' }" @click="fAccess = 'everyone'">
                {{ t('obscmd.access.everyone') }}
              </button>
              <button class="obs-access-btn" :class="{ active: fAccess === 'mod' }" @click="fAccess = 'mod'">
                {{ t('obscmd.access.mod') }}
              </button>
              <button class="obs-access-btn" :class="{ active: fAccess === 'broadcaster' }"
                @click="fAccess = 'broadcaster'">
                {{ t('obscmd.access.broadcaster') }}
              </button>
            </div>
          </div>

          <div class="ep-row-3">
            <div class="ep-field-group ep-sm">
              <label class="ep-field-label">{{ t('obscmd.global_cooldown') }} <span class="ep-field-hint">s</span></label>
              <input v-model.number="fCooldown" type="number" min="0" class="ep-field-input" />
            </div>
            <div class="ep-field-group ep-sm">
              <label class="ep-field-label">{{ t('obscmd.user_cooldown') }} <span class="ep-field-hint">s</span></label>
              <input v-model.number="fUserCd" type="number" min="0" class="ep-field-input" />
            </div>
          </div>
        </div>

        <div class="ep-panel-footer">
          <button v-if="isEdit" class="ep-btn-delete" :class="{ confirm: deleteConfirm }" :disabled="deleting"
            @click="deleteCmd">
            {{ deleting ? "…" : deleteConfirm ? t('obscmd.delete_confirm') : t('obscmd.delete') }}
          </button>
          <div v-else></div>
          <div class="ep-footer-right">
            <button class="ep-btn-cancel" @click="emit('close')">{{ t('obscmd.cancel') }}</button>
            <button class="ep-btn-save" :disabled="saving" @click="save">
              <template v-if="saved"><span v-html="iconSvgFor('check')"></span> {{ t('obscmd.saved') }}</template>
              <template v-else>{{ saving ? "…" : t('obscmd.save') }}</template>
            </button>
          </div>
        </div>
      </div>
    </div>
  </Teleport>
</template>

<style scoped>
.obs-ep-panel {
  width: min(520px, 94vw);
}

.obs-kind-tabs {
  display: flex;
  gap: 0;
}

.obs-kind-tab {
  flex: 1;
  height: 36px;
  border: 1px solid #2a2a30;
  background: #111217;
  color: #555;
  font-family: inherit;
  font-size: 12px;
  font-weight: 600;
  cursor: pointer;
  transition: all 0.15s;
  margin-right: -1px;
}

.obs-kind-tab.active {
  border-color: #6f2bff88;
  background: rgba(111, 43, 255, 0.12);
  color: #c4a0ff;
  z-index: 1;
  position: relative;
}

.obs-kind-tab:hover:not(.active):not(:disabled) {
  color: #aaa;
  border-color: #3a3a44;
}

.obs-kind-tab:disabled {
  opacity: 0.35;
  cursor: not-allowed;
}

.obs-usage-preview {
  padding: 8px 12px;
  background: #0a0a0d;
  border: 1px solid #1e1e24;
  color: #e5c07b;
  font-size: 13px;
  height: 36px;
  display: flex;
  align-items: center;
  box-sizing: border-box;
}

.obs-access-row {
  display: flex;
  gap: 0;
}

.obs-access-btn {
  flex: 1;
  height: 36px;
  border: 1px solid #2a2a30;
  background: #111217;
  color: #555;
  font-family: inherit;
  font-size: 12px;
  cursor: pointer;
  transition: all 0.15s;
  margin-right: -1px;
}

.obs-access-btn.active {
  border-color: #6f2bff88;
  background: rgba(111, 43, 255, 0.12);
  color: #c4a0ff;
  z-index: 1;
  position: relative;
}

.obs-access-btn:hover:not(.active) {
  color: #aaa;
}

code.ep-mono {
  font-family: "Consolas", "Fira Mono", monospace;
  color: #9d6cff;
  font-size: 11px;
}
</style>
