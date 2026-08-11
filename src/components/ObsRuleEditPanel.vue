<script setup lang="ts">
import { ref, watch, computed } from "vue";
import { API } from "../api";
import { useAuth } from "../auth";
import { useOverlayClose } from "../composables/useOverlayClose";

export interface ObsRule {
  id: string;
  condition: "below" | "above";
  bitrate_kbps: number;
  action: string;
  target: string;
  value?: number;
  enabled: boolean;
}

interface Props {
  open: boolean;
  channel: string;
  // >>> pass the current rule list in so we can build the full array back on save
  rules: ObsRule[];
  // >>> which rule to open for editing (null = create new)
  editTarget: string | null;
  scenes: string[];
  sources: string[];
}

const props = defineProps<Props>();
const emit = defineEmits<{ (e: "close"): void; (e: "saved"): void }>();

const { session } = useAuth();
const overlay = useOverlayClose();
const saving = ref(false);
const saved = ref(false);
const deleting = ref(false);
const deleteConfirm = ref(false);

const RULE_ACTIONS = [
  { value: "scene", label: "switch scene" },
  { value: "show", label: "show source" },
  { value: "hide", label: "hide source" },
  { value: "toggle", label: "toggle visibility" },
  { value: "mute", label: "mute source" },
  { value: "unmute", label: "unmute source" },
  { value: "mutetoggle", label: "toggle mute" },
  { value: "volume", label: "set volume" },
];

const isEdit = computed(() => !!props.editTarget);

// >>> form state
const fCondition = ref<"below" | "above">("below");
const fBitrate = ref(2500);
const fAction = ref("scene");
const fTarget = ref("");
const fValue = ref<number | "">("");
const fEnabled = ref(true);

// >>> populate form when opening
watch(
  () => props.open,
  (open) => {
    if (!open) return;
    deleteConfirm.value = false;
    saved.value = false;
    if (!props.editTarget) {
      fCondition.value = "below";
      fBitrate.value = 2500;
      fAction.value = "scene";
      fTarget.value = "";
      fValue.value = "";
      fEnabled.value = true;
      return;
    }
    const r = props.rules.find((x) => x.id === props.editTarget);
    if (!r) return;
    fCondition.value = r.condition;
    fBitrate.value = r.bitrate_kbps;
    fAction.value = r.action;
    fTarget.value = r.target;
    fValue.value = r.value ?? "";
    fEnabled.value = r.enabled;
  },
);

watch(fAction, () => {
  fTarget.value = "";
  fValue.value = "";
});

// >>> save
async function save() {
  if (!session.value) return;
  saving.value = true;
  try {
    const newRules = props.rules.map((r) => ({ ...r }));
    const entry: ObsRule = {
      id: isEdit.value ? props.editTarget! : crypto.randomUUID(),
      condition: fCondition.value,
      bitrate_kbps: fBitrate.value,
      action: fAction.value,
      target: fTarget.value.trim(),
      enabled: fEnabled.value,
    };
    if (fAction.value === "volume" && fValue.value !== "")
      entry.value = Number(fValue.value);

    const idx = newRules.findIndex((r) => r.id === entry.id);
    if (idx >= 0) newRules[idx] = entry;
    else newRules.push(entry);

    await fetch(`${API}/obs/${props.channel}/rules`, {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${session.value.token}`,
      },
      body: JSON.stringify({ rules: newRules }),
    });
    saved.value = true;
    setTimeout(() => {
      saved.value = false;
    }, 2000);
    emit("saved");
  } catch { }
  saving.value = false;
}

// >>> delete
async function deleteRule() {
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
    const newRules = props.rules.filter((r) => r.id !== props.editTarget);
    await fetch(`${API}/obs/${props.channel}/rules`, {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${session.value.token}`,
      },
      body: JSON.stringify({ rules: newRules }),
    });
    emit("saved");
    emit("close");
  } catch { }
  deleting.value = false;
}

// >>> validation
const saveDisabled = computed(() => {
  if (!fBitrate.value || fBitrate.value <= 0) return true;
  if (!fTarget.value.trim()) return true;
  return false;
});
</script>

<template>
  <Teleport to="body">
    <div v-if="open" class="ep-overlay" v-bind="overlay.handlers(() => emit('close'))">
      <div class="ep-panel obs-ep-panel">
        <div class="ep-panel-header">
          <div>
            <div class="ep-panel-title">{{ isEdit ? "Edit Rule" : "New Rule" }}</div>
            <div class="ep-panel-sub">#{{ channel }} · bitrate-triggered</div>
          </div>
          <button class="ep-panel-close" @click="emit('close')">✕</button>
        </div>

        <div class="ep-panel-body">
          <!-- condition -->
          <div class="ep-field-group">
            <label class="ep-field-label">Condition</label>
            <div class="obs-kind-tabs">
              <button class="obs-kind-tab" :class="{ active: fCondition === 'below' }" @click="fCondition = 'below'">
                below
              </button>
              <button class="obs-kind-tab" :class="{ active: fCondition === 'above' }" @click="fCondition = 'above'">
                above
              </button>
            </div>
          </div>

          <!-- bitrate threshold -->
          <div class="ep-field-group">
            <label class="ep-field-label">Bitrate threshold <span class="ep-field-hint">kbps</span></label>
            <input v-model.number="fBitrate" type="number" min="1" class="ep-field-input" />
          </div>

          <!-- action -->
          <div class="ep-field-group">
            <label class="ep-field-label">Action</label>
            <select v-model="fAction" class="ep-field-select">
              <option v-for="a in RULE_ACTIONS" :key="a.value" :value="a.value">{{ a.label }}</option>
            </select>
          </div>

          <!-- target -->
          <div class="ep-field-group">
            <label class="ep-field-label">{{ fAction === "scene" ? "Scene" : "Source" }}
              <span class="ep-field-hint">type or pick</span></label>
            <input v-model="fTarget" class="ep-field-input ep-mono"
              :placeholder="fAction === 'scene' ? 'Scene name' : 'Source name'"
              :list="fAction === 'scene' ? 'obs-rule-scenes' : 'obs-rule-sources'" />
            <datalist id="obs-rule-scenes">
              <option v-for="s in scenes" :key="s" :value="s" />
            </datalist>
            <datalist id="obs-rule-sources">
              <option v-for="s in sources" :key="s" :value="s" />
            </datalist>
          </div>

          <!-- volume value -->
          <div v-if="fAction === 'volume'" class="ep-field-group">
            <label class="ep-field-label">Volume <span class="ep-field-hint">0–100</span></label>
            <input v-model.number="fValue" type="number" min="0" max="100" class="ep-field-input"
              placeholder="e.g. 50" />
          </div>

          <!-- enabled -->
          <div class="ep-field-group">
            <label class="ep-field-label">Enabled</label>
            <div class="obc-toggle-row">
              <button class="ep-toggle-btn" :class="{ on: fEnabled }" @click="fEnabled = !fEnabled">
                <span class="ep-toggle-knob"></span>
              </button>
              <span class="obc-toggle-label">{{ fEnabled ? "active" : "disabled" }}</span>
            </div>
          </div>
        </div>

        <div class="ep-panel-footer">
          <button v-if="isEdit" class="ep-btn-delete" :class="{ confirm: deleteConfirm }" :disabled="deleting"
            @click="deleteRule">
            {{ deleting ? "…" : deleteConfirm ? "Sure?" : "Delete" }}
          </button>
          <div v-else></div>
          <div class="ep-footer-right">
            <button class="ep-btn-cancel" @click="emit('close')">Cancel</button>
            <button class="ep-btn-save" :disabled="saving || saveDisabled" @click="save">
              {{ saved ? "saved ✓" : saving ? "…" : "Save" }}
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
  height: 32px;
  border: 1px solid #2a2a30;
  background: #0d0d10;
  color: #555;
  font-family: inherit;
  font-size: 11px;
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

.obs-kind-tab:hover:not(.active) {
  color: #aaa;
  border-color: #3a3a44;
}

.obc-toggle-row {
  display: flex;
  align-items: center;
  gap: 10px;
}

.obc-toggle-label {
  font-size: 11px;
  color: #888;
}

code.ep-mono {
  font-family: "Consolas", "Fira Mono", monospace;
  color: #9d6cff;
  font-size: 11px;
}
</style>
