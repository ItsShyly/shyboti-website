<script setup lang="ts">
import { ref, computed, onMounted, watch } from "vue";
import { useRouter } from "vue-router";
import { useAuth } from "../auth";
import { useI18n } from "../i18n";
import { API } from "../api";

const router = useRouter();
const { session, adminMode } = useAuth();
const { t } = useI18n();

// >>> hidden while admin mode is on for someone else's channel - OBS Control
// >>> is treated as the broadcaster's own space, same as Uploads/Images/Notes
const hideAdminRestricted = computed(
  () =>
    !!session.value &&
    adminMode.value &&
    session.value.login !== session.value.channel,
);

// >>> Variables & Counters
interface Counter {
  name: string;
  value: number;
}
interface Var {
  name: string;
  value: string;
}
interface UCounter {
  username: string;
  name: string;
  value: number;
}
interface UVar {
  username: string;
  name: string;
  value: string;
}

const showVars = ref(false);
const varsLoading = ref(false);
const varsError = ref("");
const counters = ref<Counter[]>([]);
const vars = ref<Var[]>([]);
const ucounters = ref<UCounter[]>([]);
const uvars = ref<UVar[]>([]);
const varsTab = ref<"counters" | "vars" | "ucounters" | "uvars">("counters");
const editingKey = ref("");
const editingVal = ref("");
const addingType = ref("");
const addForm = ref({ name: "", value: "", username: "" });
const varSaving = ref(false);

const totalCount = computed(
  () =>
    counters.value.length +
    vars.value.length +
    ucounters.value.length +
    uvars.value.length,
);

async function openVars() {
  showVars.value = true;
  await loadVars();
}

async function loadVars() {
  if (!session.value) return;
  varsLoading.value = true;
  varsError.value = "";
  try {
    const res = await fetch(`${API}/variables/${session.value.channel}`, {
      headers: { Authorization: `Bearer ${session.value.token}` },
    });
    if (!res.ok) throw new Error("Failed to load");
    const data = (await res.json()) as {
      counters: Counter[];
      vars: Var[];
      ucounters: UCounter[];
      uvars: UVar[];
    };
    counters.value = data.counters;
    vars.value = data.vars;
    ucounters.value = data.ucounters;
    uvars.value = data.uvars;
  } catch (e: any) {
    varsError.value = e.message ?? "Error";
  }
  varsLoading.value = false;
}

function startEdit(
  type: string,
  name: string,
  value: string | number,
  username = "",
) {
  editingKey.value = `${type}:${name}:${username}`;
  editingVal.value = String(value);
}

async function saveEdit(type: string, name: string, username = "") {
  if (!session.value) return;
  varSaving.value = true;
  await fetch(`${API}/variables/${session.value.channel}/${type}/${name}`, {
    method: "PUT",
    headers: {
      Authorization: `Bearer ${session.value.token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      value: editingVal.value,
      username: username || undefined,
    }),
  });
  editingKey.value = "";
  await loadVars();
  varSaving.value = false;
}

async function deleteEntry(type: string, name: string, username = "") {
  if (!session.value) return;
  await fetch(`${API}/variables/${session.value.channel}/${type}/${name}`, {
    method: "DELETE",
    headers: {
      Authorization: `Bearer ${session.value.token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ username: username || undefined }),
  });
  await loadVars();
}

async function addEntry() {
  if (!session.value || !addForm.value.name.trim()) return;
  varSaving.value = true;
  await fetch(`${API}/variables/${session.value.channel}/${addingType.value}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${session.value.token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      name: addForm.value.name.trim(),
      value: addForm.value.value,
      username: addForm.value.username || undefined,
    }),
  });
  addingType.value = "";
  addForm.value = { name: "", value: "", username: "" };
  await loadVars();
  varSaving.value = false;
}
</script>

<template>
  <div class="tools-view">
    <!-- OBS Widgets card -->
    <div class="service-card" @click="router.push('/obs-widgets')">
      <div class="card-icon obs-icon">
        <svg viewBox="0 0 48 48" fill="none" xmlns="http://www.w3.org/2000/svg">
          <rect x="4" y="6" width="40" height="28" rx="4" stroke="currentColor" stroke-width="2.5" />
          <path d="M16 34v6M32 34v6M12 40h24" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" />
          <circle cx="36" cy="14" r="4" fill="#f14949" opacity="0.9" />
          <path d="M10 18h16M10 24h10" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" opacity="0.6" />
        </svg>
      </div>
      <div class="card-body">
        <div class="card-title">{{ t("feat.obs.title") }}</div>
        <div class="card-sub">{{ t("feat.obs.sub") }}</div>
        <div class="card-url">
          obs.shyboti.de/<span class="url-id obs-url-id">id</span>
        </div>
      </div>
    </div>

    <!-- Variables & Counters card -->
    <div class="service-card" @click="openVars">
      <div class="card-icon vars-icon">
        <svg viewBox="0 0 48 48" fill="none" xmlns="http://www.w3.org/2000/svg">
          <rect x="4" y="8" width="18" height="10" rx="2" stroke="currentColor" stroke-width="2.5" />
          <rect x="4" y="26" width="18" height="10" rx="2" stroke="currentColor" stroke-width="2.5" />
          <path d="M26 13h18M26 31h12" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" />
          <path d="M40 27l4 4-4 4" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"
            stroke-linejoin="round" />
        </svg>
      </div>
      <div class="card-body">
        <div class="card-title">{{ t("feat.vars.title") }}</div>
        <div class="card-sub">{{ t("feat.vars.sub") }}</div>
      </div>
    </div>

    <!-- OBS Control card -->
    <div v-if="!hideAdminRestricted" class="service-card"
      @click="session && router.push('/obs-control')">
      <div class="card-icon obsconn-icon">
        <svg viewBox="0 0 48 48" fill="none" xmlns="http://www.w3.org/2000/svg">
          <rect x="4" y="10" width="40" height="26" rx="3" stroke="currentColor" stroke-width="2.5" />
          <circle cx="24" cy="23" r="7" stroke="currentColor" stroke-width="2.5" />
          <path d="M14 40h20" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" />
          <circle cx="38" cy="10" r="7" fill="#9d6cff" opacity="0.9" />
          <path d="M35 10h6M38 7v6" stroke="#141418" stroke-width="1.8" stroke-linecap="round"
            stroke-linejoin="round" />
        </svg>
      </div>
      <div class="card-body">
        <div class="card-title">OBS Control</div>
        <div class="card-sub">Switch scenes and control sources from chat</div>
      </div>
    </div>
  </div>

  <!-- Variables & Counters modal -->
  <Teleport to="body">
    <div v-if="showVars" class="vars-backdrop" @click.self="showVars = false">
      <div class="vars-modal">
        <div class="vars-header">
          <span class="vars-title">{{ t("feat.vars.modal.title") }}</span>
          <button class="vars-close" @click="showVars = false">✕</button>
        </div>
        <div class="vars-tabs">
          <button class="vars-tab" :class="{ active: varsTab === 'counters' }" @click="varsTab = 'counters'">
            {{ t("feat.vars.tab.counters") }}
            <span v-if="counters.length">({{ counters.length }})</span>
          </button>
          <button class="vars-tab" :class="{ active: varsTab === 'vars' }" @click="varsTab = 'vars'">
            {{ t("feat.vars.tab.vars") }}
            <span v-if="vars.length">({{ vars.length }})</span>
          </button>
          <button class="vars-tab" :class="{ active: varsTab === 'ucounters' }" @click="varsTab = 'ucounters'">
            {{ t("feat.vars.tab.ucounters") }}
            <span v-if="ucounters.length">({{ ucounters.length }})</span>
          </button>
          <button class="vars-tab" :class="{ active: varsTab === 'uvars' }" @click="varsTab = 'uvars'">
            {{ t("feat.vars.tab.uvars") }}
            <span v-if="uvars.length">({{ uvars.length }})</span>
          </button>
        </div>

        <div class="vars-body">
          <div v-if="varsLoading" class="vars-empty">
            {{ t("feat.vars.loading") }}
          </div>
          <div v-else-if="varsError" class="vars-empty" style="color: #f14949">
            {{ varsError }}
          </div>

          <table v-else-if="varsTab === 'counters'" class="vars-table">
            <thead>
              <tr>
                <th>{{ t("feat.vars.col.name") }}</th>
                <th>{{ t("feat.vars.col.value") }}</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              <tr v-if="!counters.length">
                <td colspan="3" class="vars-empty">
                  {{ t("feat.vars.empty.counters") }}
                </td>
              </tr>
              <tr v-for="c in counters" :key="c.name">
                <td class="vars-name">$counter.{{ c.name }}</td>
                <td>
                  <template v-if="editingKey === 'counter:' + c.name + ':'">
                    <input class="vars-edit-input" v-model="editingVal" type="number"
                      @keydown.enter="saveEdit('counter', c.name)" @keydown.esc="editingKey = ''" />
                    <button class="vars-btn-sm save" @click="saveEdit('counter', c.name)" :disabled="varSaving">
                      {{ t("feat.vars.save") }}
                    </button>
                    <button class="vars-btn-sm" @click="editingKey = ''">
                      {{ t("feat.vars.cancel") }}
                    </button>
                  </template>
                  <span v-else class="vars-val">{{ c.value }}</span>
                </td>
                <td style="white-space: nowrap">
                  <button v-if="editingKey !== 'counter:' + c.name + ':'" class="vars-btn-sm"
                    @click="startEdit('counter', c.name, c.value)">
                    {{ t("feat.vars.edit") }}
                  </button>
                  <button class="vars-btn-sm del" @click="deleteEntry('counter', c.name)">
                    {{ t("feat.vars.delete") }}
                  </button>
                </td>
              </tr>
            </tbody>
          </table>

          <table v-else-if="varsTab === 'vars'" class="vars-table">
            <thead>
              <tr>
                <th>{{ t("feat.vars.col.name") }}</th>
                <th>{{ t("feat.vars.col.value") }}</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              <tr v-if="!vars.length">
                <td colspan="3" class="vars-empty">
                  {{ t("feat.vars.empty.vars") }}
                </td>
              </tr>
              <tr v-for="v in vars" :key="v.name">
                <td class="vars-name">$var.{{ v.name }}</td>
                <td>
                  <template v-if="editingKey === 'var:' + v.name + ':'">
                    <input class="vars-edit-input" v-model="editingVal" @keydown.enter="saveEdit('var', v.name)"
                      @keydown.esc="editingKey = ''" />
                    <button class="vars-btn-sm save" @click="saveEdit('var', v.name)" :disabled="varSaving">
                      {{ t("feat.vars.save") }}
                    </button>
                    <button class="vars-btn-sm" @click="editingKey = ''">
                      {{ t("feat.vars.cancel") }}
                    </button>
                  </template>
                  <span v-else class="vars-val">{{
                    v.value || "(empty)"
                  }}</span>
                </td>
                <td style="white-space: nowrap">
                  <button v-if="editingKey !== 'var:' + v.name + ':'" class="vars-btn-sm"
                    @click="startEdit('var', v.name, v.value)">
                    {{ t("feat.vars.edit") }}
                  </button>
                  <button class="vars-btn-sm del" @click="deleteEntry('var', v.name)">
                    {{ t("feat.vars.delete") }}
                  </button>
                </td>
              </tr>
            </tbody>
          </table>

          <table v-else-if="varsTab === 'ucounters'" class="vars-table">
            <thead>
              <tr>
                <th>{{ t("feat.vars.col.name") }}</th>
                <th>{{ t("feat.vars.col.user") }}</th>
                <th>{{ t("feat.vars.col.value") }}</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              <tr v-if="!ucounters.length">
                <td colspan="4" class="vars-empty">
                  {{ t("feat.vars.empty.ucounters") }}
                </td>
              </tr>
              <tr v-for="c in ucounters" :key="c.name + c.username">
                <td class="vars-name">$ucounter.{{ c.name }}</td>
                <td style="color: #888; font-size: 11px">{{ c.username }}</td>
                <td>
                  <template v-if="
                    editingKey === 'ucounter:' + c.name + ':' + c.username
                  ">
                    <input class="vars-edit-input" v-model="editingVal" type="number"
                      @keydown.enter="saveEdit('ucounter', c.name, c.username)" @keydown.esc="editingKey = ''" />
                    <button class="vars-btn-sm save" @click="saveEdit('ucounter', c.name, c.username)"
                      :disabled="varSaving">
                      {{ t("feat.vars.save") }}
                    </button>
                    <button class="vars-btn-sm" @click="editingKey = ''">
                      {{ t("feat.vars.cancel") }}
                    </button>
                  </template>
                  <span v-else class="vars-val">{{ c.value }}</span>
                </td>
                <td style="white-space: nowrap">
                  <button v-if="
                    editingKey !== 'ucounter:' + c.name + ':' + c.username
                  " class="vars-btn-sm" @click="startEdit('ucounter', c.name, c.value, c.username)">
                    {{ t("feat.vars.edit") }}
                  </button>
                  <button class="vars-btn-sm del" @click="deleteEntry('ucounter', c.name, c.username)">
                    {{ t("feat.vars.delete") }}
                  </button>
                </td>
              </tr>
            </tbody>
          </table>

          <table v-else-if="varsTab === 'uvars'" class="vars-table">
            <thead>
              <tr>
                <th>{{ t("feat.vars.col.name") }}</th>
                <th>{{ t("feat.vars.col.user") }}</th>
                <th>{{ t("feat.vars.col.value") }}</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              <tr v-if="!uvars.length">
                <td colspan="4" class="vars-empty">
                  {{ t("feat.vars.empty.uvars") }}
                </td>
              </tr>
              <tr v-for="v in uvars" :key="v.name + v.username">
                <td class="vars-name">$uvar.{{ v.name }}</td>
                <td style="color: #888; font-size: 11px">{{ v.username }}</td>
                <td>
                  <template v-if="editingKey === 'uvar:' + v.name + ':' + v.username">
                    <input class="vars-edit-input" v-model="editingVal"
                      @keydown.enter="saveEdit('uvar', v.name, v.username)" @keydown.esc="editingKey = ''" />
                    <button class="vars-btn-sm save" @click="saveEdit('uvar', v.name, v.username)"
                      :disabled="varSaving">
                      {{ t("feat.vars.save") }}
                    </button>
                    <button class="vars-btn-sm" @click="editingKey = ''">
                      {{ t("feat.vars.cancel") }}
                    </button>
                  </template>
                  <span v-else class="vars-val">{{
                    v.value || "(empty)"
                  }}</span>
                </td>
                <td style="white-space: nowrap">
                  <button v-if="editingKey !== 'uvar:' + v.name + ':' + v.username" class="vars-btn-sm"
                    @click="startEdit('uvar', v.name, v.value, v.username)">
                    {{ t("feat.vars.edit") }}
                  </button>
                  <button class="vars-btn-sm del" @click="deleteEntry('uvar', v.name, v.username)">
                    {{ t("feat.vars.delete") }}
                  </button>
                </td>
              </tr>
            </tbody>
          </table>
        </div>

        <div class="vars-footer">
          <template v-if="!addingType">
            <button class="vars-add-btn" @click="
              addingType = varsTab
                .replace('s', '')
                .replace('counter', 'counter')
                .replace('var', 'var')
              ">
              + {{
                varsTab === "counters"
                  ? t("feat.vars.add.counter")
                  : varsTab === "vars"
                    ? t("feat.vars.add.var")
                    : varsTab === "ucounters"
                      ? t("feat.vars.add.ucounter")
                      : t("feat.vars.add.uvar")
              }}
            </button>
          </template>
          <div v-else class="vars-add-form">
            <input class="vars-add-input" v-model="addForm.name" :placeholder="t('feat.vars.add.placeholder.name')" />
            <input class="vars-add-input" v-model="addForm.value" :placeholder="addingType.includes('counter')
              ? '0'
              : t('feat.vars.add.placeholder.value')
              " style="width: 100px" />
            <input v-if="addingType.includes('u')" class="vars-add-input" v-model="addForm.username"
              :placeholder="t('feat.vars.add.placeholder.user')" style="width: 110px" />
            <button class="vars-add-submit" @click="addEntry" :disabled="varSaving || !addForm.name.trim()">
              {{ t("feat.vars.add.btn") }}
            </button>
            <button class="vars-add-cancel" @click="addingType = ''">
              {{ t("feat.vars.cancel") }}
            </button>
          </div>
        </div>
      </div>
    </div>
  </Teleport>
</template>

<style scoped>
.tools-view {
  display: flex;
  flex-wrap: wrap;
  gap: 20px;
  align-content: flex-start;
}

.service-card {
  position: relative;
  background: #1a1a1e;
  border: 1px solid #2a2a30;
  width: 280px;
  display: flex;
  flex-direction: column;
  gap: 0;
  cursor: pointer;
  transition:
    border-color 0.2s,
    transform 0.15s;
  overflow: hidden;
}

.service-card:hover {
  border-color: #3a3a44;
  transform: translateY(-2px);
}

.service-card:active {
  transform: translateY(0);
}

.card-icon {
  height: 140px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: #111217;
  border-bottom: 1px solid #2a2a30;
}

.card-icon svg {
  width: 72px;
  height: 72px;
}

.obs-icon {
  color: #f14949;
}

.vars-icon {
  color: #e5c07b;
}

.obsconn-icon {
  color: #9d6cff;
}

.obsconn-locked-hint {
  font-size: 10px;
  color: #444;
  padding: 0 18px 14px;
}

.card-body {
  padding: 16px 18px 10px;
  display: flex;
  flex-direction: column;
  gap: 5px;
}

.card-title {
  font-size: 18px;
  font-weight: 700;
  color: #e0e0e0;
}

.card-sub {
  font-size: 12px;
  color: #555;
}

.card-url {
  font-family: "Consolas", "Fira Mono", monospace;
  font-size: 11px;
  color: #444;
  margin-top: 4px;
}

.obs-url-id {
  color: #f14949;
}

.obs-btn {
  border-color: #f1494944;
  color: #f14949;
  background: rgba(241, 73, 73, 0.06);
}

.obs-btn:hover {
  background: rgba(241, 73, 73, 0.16);
  border-color: #f1494988;
}

.vars-btn {
  border-color: #e5c07b44;
  color: #e5c07b;
  background: rgba(229, 192, 123, 0.06);
}

.vars-btn:hover {
  background: rgba(229, 192, 123, 0.16);
  border-color: #e5c07b88;
}

.obsconn-btn {
  border-color: #9d6cff44;
  color: #9d6cff;
  background: rgba(157, 108, 255, 0.06);
}

.obsconn-btn:hover {
  background: rgba(157, 108, 255, 0.16);
  border-color: #9d6cff88;
}

.vars-backdrop {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.8);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 1000;
}

.vars-modal {
  background: #141418;
  border: 1px solid #2a2a30;
  width: min(720px, 95vw);
  height: min(600px, 90vh);
  display: flex;
  flex-direction: column;
}

.vars-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 12px 16px;
  border-bottom: 1px solid #1e1e24;
  flex-shrink: 0;
}

.vars-title {
  font-size: 14px;
  font-weight: 700;
  color: #e0e0e0;
}

.vars-close {
  background: none;
  border: none;
  color: #555;
  font-size: 18px;
  cursor: pointer;
  width: 28px;
  height: 28px;
  display: flex;
  align-items: center;
  justify-content: center;
}

.vars-close:hover {
  color: #e0e0e0;
}

.vars-tabs {
  display: flex;
  border-bottom: 1px solid #1e1e24;
  flex-shrink: 0;
}

.vars-tab {
  padding: 8px 16px;
  font-size: 11px;
  font-weight: 700;
  color: #555;
  background: none;
  border: none;
  cursor: pointer;
  border-bottom: 2px solid transparent;
  text-transform: uppercase;
  letter-spacing: 0.05em;
}

.vars-tab.active {
  color: #9d6cff;
  border-bottom-color: #9d6cff;
}

.vars-tab:hover:not(.active) {
  color: #888;
}

.vars-body {
  flex: 1;
  overflow-y: auto;
  min-height: 0;
}

.vars-table {
  width: 100%;
  border-collapse: collapse;
}

.vars-table th {
  text-align: left;
  font-size: 10px;
  color: #444;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  padding: 8px 14px;
  border-bottom: 1px solid #1e1e24;
  background: #0d0d10;
  position: sticky;
  top: 0;
}

.vars-table td {
  padding: 6px 14px;
  border-bottom: 1px solid #111317;
  font-size: 12px;
  color: #ccc;
}

.vars-table tr:hover td {
  background: #1a1a1e;
}

.vars-name {
  font-family: "Consolas", "Fira Mono", monospace;
  color: #9d6cff;
}

.vars-val {
  font-family: "Consolas", "Fira Mono", monospace;
  color: #e5c07b;
}

.vars-edit-input {
  background: #0d0d10;
  border: 1px solid #6f2bff55;
  color: #e5c07b;
  font-family: "Consolas", "Fira Mono", monospace;
  font-size: 12px;
  padding: 2px 6px;
  width: 120px;
  outline: none;
}

.vars-btn-sm {
  height: 22px;
  padding: 0 8px;
  font-size: 10px;
  font-family: inherit;
  border: 1px solid #2a2a30;
  background: transparent;
  color: #888;
  cursor: pointer;
  margin-left: 4px;
}

.vars-btn-sm:hover {
  border-color: #6f2bff44;
  color: #9d6cff;
  background: #6f2bff0c;
}

.vars-btn-sm.del:hover {
  border-color: #f1494944;
  color: #f14949;
  background: rgba(241, 73, 73, 0.06);
}

.vars-btn-sm.save {
  border-color: #6f2bff44;
  color: #9d6cff;
}

.vars-empty {
  padding: 32px;
  text-align: center;
  color: #444;
  font-size: 13px;
}

.vars-footer {
  padding: 10px 14px;
  border-top: 1px solid #1e1e24;
  flex-shrink: 0;
  display: flex;
  gap: 8px;
  align-items: center;
  flex-wrap: wrap;
}

.vars-add-btn {
  height: 26px;
  padding: 0 12px;
  border: 1px solid #6f2bff44;
  background: transparent;
  color: #9d6cff;
  font-family: inherit;
  font-size: 11px;
  cursor: pointer;
}

.vars-add-btn:hover {
  background: #6f2bff0c;
}

.vars-add-form {
  display: flex;
  gap: 6px;
  align-items: center;
  flex-wrap: wrap;
}

.vars-add-input {
  height: 26px;
  background: #0d0d10;
  border: 1px solid #2a2a30;
  color: #e0e0e0;
  font-family: inherit;
  font-size: 11px;
  padding: 0 8px;
  outline: none;
  width: 130px;
}

.vars-add-input:focus {
  border-color: #6f2bff55;
}

.vars-add-submit {
  height: 26px;
  padding: 0 12px;
  border: none;
  background: #6f2bff;
  color: #fff;
  font-family: inherit;
  font-size: 11px;
  font-weight: 700;
  cursor: pointer;
}

.vars-add-submit:disabled {
  opacity: 0.5;
  cursor: default;
}

.vars-add-cancel {
  height: 26px;
  padding: 0 10px;
  border: 1px solid #2a2a30;
  background: transparent;
  color: #666;
  font-family: inherit;
  font-size: 11px;
  cursor: pointer;
}

@media (max-width: 680px) {
  .tools-view {
    gap: 14px;
  }

  .service-card {
    width: 100%;
  }
}
</style>
