<script setup lang="ts">
import { ref, watch, computed, nextTick } from "vue";
import { API } from "../api";
import { useAuth } from "../auth";
import { useOverlayClose } from "../composables/useOverlayClose";
import TypeaheadInput from "./shared/TypeaheadInput.vue";
import type { TypeaheadItem } from "./shared/TypeaheadInput.vue";
import ReauthLink from "./shared/ReauthLink.vue";
import { iconSvg as iconSvgFor } from "../composables/icons";


export interface ObsRule {
  id: string;
  trigger_type?: "bitrate" | "category" | "scene";
  // >>> bitrate fields
  condition?: "below" | "above";
  bitrate_kbps?: number;
  // >>> category fields
  category_id?: string;
  category_name?: string;
  // >>> scene fields
  trigger_scene?: string;

  action: string;
  target: string;
  target_category_id?: string;
  value?: number;
  chat_message_enabled?: boolean;
  chat_message?: string; // <<< supports $scene / $category placeholders
  enabled: boolean;
}

interface Props {
  open: boolean;
  channel: string;
  // >>> needed to rebuild the full array on save
  rules: ObsRule[];
  // >>> null means creating a new one
  editTarget: string | null;
  scenes: string[];
  sources: string[];
  hasCategoryScope: boolean;
}

const props = defineProps<Props>();
const emit = defineEmits<{ (e: "close"): void; (e: "saved"): void }>();

const { session } = useAuth();
const overlay = useOverlayClose();
const saving = ref(false);
const saved = ref(false);
const error = ref("");
const deleting = ref(false);
const deleteConfirm = ref(false);

const TRIGGER_TABS: { value: "bitrate" | "category" | "scene"; label: string }[] = [
  { value: "bitrate", label: "bitrate" },
  { value: "category", label: "category" },
  { value: "scene", label: "scene" },
];

const SOURCE_ACTIONS = [
  { value: "scene", label: "switch scene" },
  { value: "show", label: "show source" },
  { value: "hide", label: "hide source" },
  { value: "toggle", label: "toggle visibility" },
  { value: "mute", label: "mute source" },
  { value: "unmute", label: "unmute source" },
  { value: "mutetoggle", label: "toggle mute" },
  { value: "volume", label: "set volume" },
];

const RULE_ACTIONS = computed(() =>
  fTriggerType.value === "scene"
    ? [{ value: "category", label: "change category" }, ...SOURCE_ACTIONS]
    : SOURCE_ACTIONS,
);

const isEdit = computed(() => !!props.editTarget);

// >>> form fields
const fTriggerType = ref<"bitrate" | "category" | "scene">("bitrate");
const fCondition = ref<"below" | "above">("below");
const fBitrate = ref(2500);
const fCategoryId = ref("");
const fCategoryName = ref("");
const fTriggerScene = ref("");
const fAction = ref("scene");
const fTarget = ref("");
const fTargetCategoryId = ref("");
const fTargetCategoryName = ref("");
const fValue = ref<number | "">("");
const fEnabled = ref(true);
const fChatMsgEnabled = ref(false);
const fChatMsg = ref("");

function defaultChatMessage(action: string): string {
  if (action === "scene") return "Scene changed to $scene";
  if (action === "category") return "Category changed to $category";
  return "";
}
function toggleChatMessage() {
  fChatMsgEnabled.value = !fChatMsgEnabled.value;
  if (fChatMsgEnabled.value && !fChatMsg.value.trim()) {
    // >>> only prefill if empty
    fChatMsg.value = defaultChatMessage(fAction.value);
  }
}

// >>> guards watchers while form is being bulk-filled
let populating = false;

watch(fAction, (a) => {
  if (populating) return;
  fTarget.value = "";
  fValue.value = "";
  if (a !== "category") {
    fTargetCategoryId.value = "";
    fTargetCategoryName.value = "";
  }
});

// >>> fill form on open
watch(
  () => props.open,
  async (open) => {
    if (!open) return;
    error.value = "";
    populating = true;
    deleteConfirm.value = false;
    saved.value = false;
    if (!props.editTarget) {
      fTriggerType.value = "bitrate";
      fCondition.value = "below";
      fBitrate.value = 2500;
      fCategoryId.value = "";
      fCategoryName.value = "";
      fTriggerScene.value = "";
      fAction.value = "scene";
      fTarget.value = "";
      fTargetCategoryId.value = "";
      fTargetCategoryName.value = "";
      fValue.value = "";
      fEnabled.value = true;
      fChatMsgEnabled.value = false;
      fChatMsg.value = "";
    } else {
      const r = props.rules.find((x) => x.id === props.editTarget);
      if (r) {
        fTriggerType.value = r.trigger_type ?? "bitrate";
        fCondition.value = r.condition ?? "below";
        fBitrate.value = r.bitrate_kbps ?? 2500;
        fCategoryId.value = r.category_id ?? "";
        fCategoryName.value = r.category_name ?? "";
        fTriggerScene.value = r.trigger_scene ?? "";
        fAction.value = r.action;
        fTargetCategoryId.value = r.action === "category" ? (r.target_category_id ?? "") : "";
        fTargetCategoryName.value = r.action === "category" ? r.target : "";
        fTarget.value = r.action === "category" ? "" : r.target;
        fValue.value = r.value ?? "";
        fEnabled.value = r.enabled;
        fChatMsgEnabled.value = r.chat_message_enabled ?? false;
        fChatMsg.value = r.chat_message ?? "";
      }
    }
    await nextTick(); // <<< wait for the DOM patch before unguarding
    populating = false;
  },
);

// >>> not a watcher, only runs on manual click
function selectTrigger(type: "bitrate" | "category" | "scene") {
  fTriggerType.value = type;
  // >>> scene triggers usually just change category
  fAction.value = type === "scene" ? "category" : "scene";
  fTarget.value = "";
}
watch(fAction, (a) => {
  if (populating) return;
  fTarget.value = "";
  fValue.value = "";
  if (a !== "category") {
    fTargetCategoryId.value = "";
    fTargetCategoryName.value = "";
  }
});

// >>> not sure if this works but yea
const needsCategoryScope = computed(
  () => (fTriggerType.value === "category" || fAction.value === "category") && !props.hasCategoryScope,
);

function onCategorySelect(item: TypeaheadItem) {
  fCategoryId.value = item.id ?? "";
  fCategoryName.value = item.label;
}
function onTargetCategorySelect(item: TypeaheadItem) {
  fTargetCategoryId.value = item.id ?? "";
  fTargetCategoryName.value = item.label;
}

async function fetchCategories(query: string): Promise<TypeaheadItem[]> {
  if (!session.value) return [];
  try {
    const res = await fetch(
      `${API}/obs/twitch/categories?q=${encodeURIComponent(query)}`,
      { headers: { Authorization: `Bearer ${session.value.token}` } },
    );
    if (!res.ok) return [];
    const d = (await res.json()) as {
      categories: { id: string; name: string; box_art_url: string }[];
    };
    return (d.categories ?? []).map((c) => ({ id: c.id, label: c.name, iconUrl: c.box_art_url }));
  } catch {
    return [];
  }
}

async function save() {
  if (!session.value) return;
  if (missingFields.value.length) {
    error.value = "Missing: " + missingFields.value.join(", ");
    return;
  }
  saving.value = true;
  try {
    const newRules = props.rules.map((r) => ({ ...r }));
    const entry: ObsRule = {
      id: isEdit.value ? props.editTarget! : crypto.randomUUID(),
      trigger_type: fTriggerType.value,
      action: fAction.value,
      target: fAction.value === "category" ? fTargetCategoryName.value.trim() : fTarget.value.trim(),
      enabled: fEnabled.value,
    };
    if (fTriggerType.value === "bitrate") {
      entry.condition = fCondition.value;
      entry.bitrate_kbps = fBitrate.value;
    } else if (fTriggerType.value === "category") {
      entry.category_id = fCategoryId.value;
      entry.category_name = fCategoryName.value;
    } else if (fTriggerType.value === "scene") {
      entry.trigger_scene = fTriggerScene.value.trim();
    }
    if (fAction.value === "category") entry.target_category_id = fTargetCategoryId.value;
    if (fAction.value === "volume" && fValue.value !== "")
      entry.value = Number(fValue.value);
    if (fChatMsgEnabled.value && fChatMsg.value.trim()) {
      entry.chat_message_enabled = true;
      entry.chat_message = fChatMsg.value.trim();
    }

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

const missingFields = computed(() => {
  const missing: string[] = [];
  if (fTriggerType.value === "bitrate" && (!fBitrate.value || fBitrate.value <= 0)) missing.push("Bitrate threshold");
  if (fTriggerType.value === "category" && !fCategoryId.value) missing.push("Category");
  if (fTriggerType.value === "scene" && !fTriggerScene.value.trim()) missing.push("Scene name");
  if (fAction.value === "category" && !fTargetCategoryId.value) missing.push("Target category");
  if (fAction.value !== "category" && !fTarget.value.trim()) missing.push("Target");
  return missing;
});
</script>

<template>
  <Teleport to="body">
    <div v-if="open" class="ep-overlay" v-bind="overlay.handlers(() => emit('close'))">
      <div class="ep-panel obs-ep-panel">
        <div class="ep-panel-header">
          <div>
            <div class="ep-panel-title">{{ isEdit ? "Edit Rule" : "New Rule" }}</div>
            <div class="ep-panel-sub">#{{ channel }}</div>
          </div>
          <button class="ep-panel-close" @click="emit('close')" v-html="iconSvgFor('x')"></button>
        </div>

        <div class="ep-panel-body">
          <div v-if="error" class="ep-toast error">{{ error }}</div>
          <div class="ep-field-group">
            <label class="ep-field-label">Trigger</label>
            <div class="obs-kind-tabs">
              <button v-for="t in TRIGGER_TABS" :key="t.value" class="obs-kind-tab"
                :class="{ active: fTriggerType === t.value }" @click="selectTrigger(t.value)">
                {{ t.label }}
              </button>
            </div>
          </div>

          <template v-if="fTriggerType === 'bitrate'">
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
            <div class="ep-field-group">
              <label class="ep-field-label">Bitrate threshold <span class="ep-field-hint">kbps</span></label>
              <input v-model.number="fBitrate" type="number" min="1" class="ep-field-input" />
            </div>
          </template>

          <div v-else-if="fTriggerType === 'category'" class="ep-field-group">
            <label class="ep-field-label">Category</label>
            <TypeaheadInput v-model="fCategoryName" :fetch-items="fetchCategories" :min-chars="1"
              placeholder="Search a Twitch category..." @select="onCategorySelect" />
          </div>

          <div v-else class="ep-field-group">
            <label class="ep-field-label">Scene <span class="ep-field-hint">fires when OBS switches to
                this</span></label>
            <TypeaheadInput v-model="fTriggerScene" :items="scenes" placeholder="Scene name" mono />
          </div>

          <div class="ep-field-group">
            <label class="ep-field-label">Action</label>
            <select v-model="fAction" class="ep-field-select">
              <option v-for="a in RULE_ACTIONS" :key="a.value" :value="a.value">{{ a.label }}</option>
            </select>
          </div>

          <div v-if="fAction === 'category'" class="ep-field-group">
            <label class="ep-field-label">New category</label>
            <TypeaheadInput v-model="fTargetCategoryName" :fetch-items="fetchCategories" :min-chars="1"
              placeholder="Search a Twitch category..." @select="onTargetCategorySelect" />
          </div>

          <div v-else class="ep-field-group">
            <label class="ep-field-label">
              {{ fAction === "scene" && fTriggerType === "scene" ? "Switch to scene" : fAction === "scene" ? "Scene" :
                "Source" }}
            </label>
            <TypeaheadInput v-model="fTarget" :items="fAction === 'scene' ? scenes : sources"
              :placeholder="fAction === 'scene' ? 'Scene name' : 'Source name'" mono />
          </div>

          <div v-if="fAction === 'volume'" class="ep-field-group">
            <label class="ep-field-label">Volume <span class="ep-field-hint">0-100</span></label>
            <input v-model.number="fValue" type="number" min="0" max="100" class="ep-field-input"
              placeholder="e.g. 50" />
          </div>

          <div class="ep-field-group">
            <label class="ep-field-label">Chat message</label>
            <div class="obs-toggle-row">
              <button class="ep-toggle-btn" :class="{ on: fChatMsgEnabled }" @click="toggleChatMessage">
                <span class="ep-toggle-knob"></span>
              </button>
              <span class="obs-toggle-label">{{ fChatMsgEnabled ? "send a message when this fires" : "off" }}</span>
            </div>
            <textarea v-if="fChatMsgEnabled" v-model="fChatMsg" class="ep-field-input obs-chat-msg-input" rows="2"
              placeholder="Scene changed to $scene"></textarea>
          </div>

          <div class="ep-field-group">
            <label class="ep-field-label">Enabled</label>
            <div class="obs-toggle-row">
              <button class="ep-toggle-btn" :class="{ on: fEnabled }" @click="fEnabled = !fEnabled">
                <span class="ep-toggle-knob"></span>
              </button>
              <span class="obs-toggle-label">{{ fEnabled ? "active" : "disabled" }}</span>
            </div>
          </div>
        </div>

        <div v-if="needsCategoryScope" class="ep-panel-body" style="padding-top: 0">
          <div class="obs-scope-warning">
            Your stored Twitch token doesn't have permission to change the category yet, so this
            rule won't actually fire until <ReauthLink fallback="the broadcaster re-authorizes">you
              re-authorize</ReauthLink>.
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
            <button class="ep-btn-save" :disabled="saving" @click="save">
              <template v-if="saved"><span v-html="iconSvgFor('check')"></span> saved</template>
              <template v-else>{{ saving ? "…" : "Save" }}</template>
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

.obs-toggle-row {
  display: flex;
  align-items: center;
  gap: 10px;
}

.obs-chat-msg-input {
  margin-top: 8px;
  resize: vertical;
  min-height: 44px;
  font-family: inherit;
}

.obs-toggle-label {
  font-size: 11px;
  color: #888;
}

.obs-scope-warning {
  font-size: 10px;
  color: #e5c07b;
  background: rgba(229, 192, 123, 0.08);
  border-left: 2px solid #e5c07b;
  padding: 6px 8px;
  margin-top: 6px;
  line-height: 1.5;
}

code.ep-mono {
  font-family: "Consolas", "Fira Mono", monospace;
  color: #9d6cff;
  font-size: 11px;
}
</style>
