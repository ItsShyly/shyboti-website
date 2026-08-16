<script setup lang="ts">
import { ref, computed, onMounted, watch } from "vue";
import { useRoute } from "vue-router";
import { API } from "../api";
import { useAuth } from "../auth";
import { useI18n } from "../i18n";
import { iconSvg as iconSvgFor } from "../composables/icons";

const { session } = useAuth();
const { t } = useI18n();
const route = useRoute();

// vvv view mode vvv
const view = ref<"write" | "list">("write");

// >>> ?list=1 in url switches straight to list view
onMounted(() => {
  if (route.query.list === "1") {
    view.value = "list";
    loadList();
  }
});
watch(
  () => route.query.list,
  (v) => {
    if (v === "1") {
      view.value = "list";
      loadList();
    }
  },
);

// vvv write state vvv
const noteText = ref("");
const expiry = ref<"1h" | "1d" | "7d" | "30d" | "forever">("7d");
const creating = ref(false);
const createError = ref("");
const lastLink = ref("");
const lastCopied = ref(false);
const textareaRef = ref<HTMLTextAreaElement | null>(null);

// vvv list state vvv
interface SavedNote {
  id: string;
  preview: string;
  size: number;
  created_at: number;
  expires_at: number | null;
}
const notes = ref<SavedNote[]>([]);
const listLoad = ref(false);
const deleteId = ref<string | null>(null);
const recreateId = ref<string | null>(null); // <<< note being restored
const recreateExpiry = ref<"1h" | "1d" | "7d" | "30d" | "forever">("7d");
const recreating = ref<string | null>(null); // <<< id currently in-flight

// vvv derived vvv
const isGuest = computed(() => !session.value);
const charCount = computed(() => noteText.value.length);
const noteUrl = (id: string) => `https://n.shyboti.de/${id}`;

// vvv expiry options, guests capped at 30d vvv
const expiryOptions = computed(() => {
  const base = [
    { value: "1h", label: t("notes.expiry.1h") },
    { value: "1d", label: t("notes.expiry.1d") },
    { value: "7d", label: t("notes.expiry.7d") },
    { value: "30d", label: t("notes.expiry.30d") },
    { value: "forever", label: t("notes.expiry.forever") },
  ];
  return isGuest.value ? base.filter((o) => o.value !== "forever") : base;
});

async function createNote() {
  if (!noteText.value.trim()) return;
  creating.value = true;
  createError.value = "";
  lastLink.value = "";
  try {
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
    };
    if (session.value)
      headers["Authorization"] = `Bearer ${session.value.token}`;
    // >>> clamp for guests
    const effectiveExpiry =
      isGuest.value && expiry.value === "forever" ? "30d" : expiry.value;
    const res = await fetch(`${API}/notes/create`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        content: noteText.value,
        expiry: effectiveExpiry,
      }),
    });
    if (!res.ok) {
      const d = (await res.json()) as any;
      throw new Error(d.error ?? "Create failed");
    }
    const data = (await res.json()) as { id: string };
    lastLink.value = noteUrl(data.id);
  } catch (e: any) {
    createError.value = e.message ?? "Could not create note";
  }
  creating.value = false;
}

async function copyLink(url: string) {
  await navigator.clipboard.writeText(url).catch(() => {});
  lastCopied.value = true;
  setTimeout(() => (lastCopied.value = false), 1800);
}

function newNote() {
  lastLink.value = "";
  createError.value = "";
  noteText.value = "";
  setTimeout(() => textareaRef.value?.focus(), 50);
}

// vvv list vvv
async function loadList() {
  listLoad.value = true;
  try {
    const headers: Record<string, string> = {};
    if (session.value)
      headers["Authorization"] = `Bearer ${session.value.token}`;
    const res = await fetch(`${API}/notes/my`, { headers });
    if (res.ok) notes.value = (await res.json()) as SavedNote[];
  } catch {}
  listLoad.value = false;
}

async function deleteNote(id: string) {
  if (deleteId.value !== id) {
    deleteId.value = id;
    setTimeout(() => {
      if (deleteId.value === id) deleteId.value = null;
    }, 3000);
    return;
  }
  deleteId.value = null;
  try {
    const headers: Record<string, string> = {};
    if (session.value)
      headers["Authorization"] = `Bearer ${session.value.token}`;
    await fetch(`${API}/notes/${id}`, { method: "DELETE", headers });
    notes.value = notes.value.filter((n) => n.id !== id);
  } catch {}
}

async function recreateNote(id: string) {
  recreating.value = id;
  try {
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
    };
    if (session.value)
      headers["Authorization"] = `Bearer ${session.value.token}`;
    const res = await fetch(`${API}/notes/recreate/${id}`, {
      method: "POST",
      headers,
      body: JSON.stringify({ expiry: recreateExpiry.value }),
    });
    if (!res.ok) throw new Error();
    const data = (await res.json()) as { id: string };
    const expiryMs: Record<string, number> = {
      "1h": 3_600_000,
      "1d": 86_400_000,
      "7d": 604_800_000,
      "30d": 2_592_000_000,
    };
    const now = Date.now();
    notes.value = notes.value.map((n) =>
      n.id === id
        ? {
            ...n,
            id: data.id,
            expires_at:
              recreateExpiry.value === "forever"
                ? null
                : now + expiryMs[recreateExpiry.value]!,
            created_at: now,
          }
        : n,
    );
    recreateId.value = null;
  } catch {
    // >>> leave panel open so user can retry
  }
  recreating.value = null;
}

function fmtDate(ts: number) {
  return new Date(ts).toLocaleDateString([], {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

function fmtExpiry(ts: number | null): string {
  if (!ts) return t("notes.expiry.forever");
  const rem = ts - Date.now();
  if (rem <= 0) return t("notes.expired");
  const d = Math.floor(rem / 86_400_000);
  const h = Math.floor((rem % 86_400_000) / 3_600_000);
  if (d > 0) return `${t("notes.expires_in")} ${d}d`;
  return `${t("notes.expires_in")} ${h}h`;
}

function switchView(v: "write" | "list") {
  view.value = v;
  if (v === "list") loadList();
}
</script>

<template>
  <div class="notes-page">
    <!-- vvv list view vvv -->
    <div v-if="view === 'list'" class="list-view">
      <div class="list-header">
        <button class="back-btn" @click="view = 'write'">
          {{ t("notes.back") }}
        </button>
        <div class="list-title">{{ t("notes.your") }}</div>
        <span class="list-count" v-if="notes.length"
          >{{ notes.length }} / 100</span
        >
      </div>
      <div v-if="listLoad" class="list-empty">{{ t("notes.loading") }}</div>
      <div v-else-if="!notes.length" class="list-empty">
        {{ t("notes.empty") }}
      </div>
      <div v-else class="notes-list">
        <div
          v-for="note in notes"
          :key="note.id"
          class="note-item"
          :class="{
            'is-expired': note.expires_at && note.expires_at < Date.now(),
          }"
        >
          <a
            v-if="!note.expires_at || note.expires_at >= Date.now()"
            :href="noteUrl(note.id)"
            target="_blank"
            rel="noopener"
            class="note-preview"
          >
            {{ note.preview }}
          </a>
          <span v-else class="note-preview note-preview-expired">{{
            note.preview
          }}</span>

          <div class="note-meta">
            <span class="note-size"
              >{{ note.size }} {{ t("notes.chars") }}</span
            >
            <span class="note-dot">·</span>
            <span class="note-created">{{ fmtDate(note.created_at) }}</span>
            <span class="note-dot">·</span>
            <span
              class="note-expiry"
              :class="{
                expired: note.expires_at && note.expires_at < Date.now(),
              }"
            >
              {{ fmtExpiry(note.expires_at) }}
            </span>
          </div>

          <div class="note-actions">
            <code
              v-if="!note.expires_at || note.expires_at >= Date.now()"
              class="note-link-code"
              >n.shyboti.de/{{ note.id }}</code
            >
            <span v-else class="note-link-expired">-</span>

            <template v-if="!note.expires_at || note.expires_at >= Date.now()">
              <button class="copy-btn-sm" @click="copyLink(noteUrl(note.id))">
                {{ t("notes.copy") }}
              </button>
            </template>

            <button
              v-if="note.expires_at && note.expires_at < Date.now()"
              class="restore-btn-sm"
              @click="recreateId = recreateId === note.id ? null : note.id"
            >
              Restore
            </button>

            <button
              class="delete-btn-sm"
              :class="{ confirm: deleteId === note.id }"
              @click="deleteNote(note.id)"
            >
              <template v-if="deleteId === note.id">?</template>
              <span v-else v-html="iconSvgFor('trash')"></span>
            </button>
          </div>

          <div v-if="recreateId === note.id" class="restore-panel">
            <span class="restore-label">New expiry:</span>
            <select v-model="recreateExpiry" class="expiry-select">
              <option value="1h">1 hour</option>
              <option value="1d">1 day</option>
              <option value="7d">7 days</option>
              <option value="30d">30 days</option>
              <option value="forever">Forever</option>
            </select>
            <button
              class="restore-confirm-btn"
              :disabled="recreating === note.id"
              @click="recreateNote(note.id)"
            >
              {{ recreating === note.id ? "…" : "Confirm" }}
            </button>
            <button class="restore-cancel-btn" @click="recreateId = null">
              Cancel
            </button>
          </div>
        </div>
      </div>
    </div>

    <!-- vvv write view vvv -->
    <div v-else class="write-view">
      <div v-if="isGuest" class="guest-banner">
        <span class="guest-icon">ⓘ</span>
        {{ t("notes.guest_note") }}
      </div>

      <div v-if="lastLink" class="result-state">
        <div class="result-box">
          <div class="result-label">{{ t("notes.link") }}</div>
          <div class="result-link-row">
            <code class="result-code">{{ lastLink }}</code>
            <button class="copy-btn" @click="copyLink(lastLink)">
              <span v-if="lastCopied" v-html="iconSvgFor('check')"></span>
              <template v-else>{{ t("notes.copy") }}</template>
            </button>
          </div>
          <button class="new-note-btn" @click="newNote">+ New note</button>
        </div>
      </div>

      <template v-else>
        <textarea
          ref="textareaRef"
          v-model="noteText"
          class="note-editor"
          :placeholder="t('notes.placeholder')"
          spellcheck="false"
        ></textarea>

        <div class="bottom-bar">
          <div class="bottom-left">
            <span class="char-count"
              >{{ charCount.toLocaleString() }} {{ t("notes.chars") }}</span
            >
            <div class="expiry-row">
              <span class="expiry-label">{{ t("notes.expiry") }}:</span>
              <select v-model="expiry" class="expiry-select">
                <option
                  v-for="opt in expiryOptions"
                  :key="opt.value"
                  :value="opt.value"
                >
                  {{ opt.label }}
                </option>
              </select>
            </div>
          </div>
          <div class="bottom-right">
            <button class="your-btn" @click="switchView('list')">
              <svg
                viewBox="0 0 16 16"
                fill="none"
                xmlns="http://www.w3.org/2000/svg"
                class="your-icon"
              >
                <path
                  d="M2 4h12M2 8h12M2 12h8"
                  stroke="currentColor"
                  stroke-width="1.5"
                  stroke-linecap="round"
                />
              </svg>
              {{ t("notes.your") }}
            </button>
            <button
              class="create-btn"
              @click="createNote"
              :disabled="creating || !noteText.trim()"
            >
              {{ creating ? t("notes.creating") : t("notes.create") }}
            </button>
          </div>
        </div>
        <div v-if="createError" class="create-error">{{ createError }}</div>
      </template>
    </div>
  </div>
</template>

<style scoped>
.notes-page {
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 0;
}

/* >>> Guest banner <<< */
.guest-banner {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 14px;
  font-size: 11px;
  color: #888;
  background: rgba(229, 192, 123, 0.06);
  border: 1px solid rgba(229, 192, 123, 0.2);
  border-bottom: none;
  flex-shrink: 0;
}
.guest-icon {
  color: #e5c07b;
  font-size: 13px;
}

/* >>> Write view <<< */
.write-view {
  display: flex;
  flex-direction: column;
  flex: 1;
  min-height: 0;
}

.note-editor {
  flex: 1;
  resize: none;
  background: #111217;
  border: 1px solid #1e1e24;
  border-bottom: none;
  color: #e0e0e0;
  font-family: "Consolas", "Fira Mono", monospace;
  font-size: 13px;
  line-height: 1.7;
  padding: 20px 22px;
  outline: none;
  min-height: 200px;
}
.note-editor::placeholder {
  color: #2a2a35;
}
.note-editor:focus {
  border-color: #6f2bff33;
}

/* >>> Bottom bar <<< */
.bottom-bar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 10px 14px;
  background: #0d0d10;
  border: 1px solid #1e1e24;
  border-top: none;
  flex-shrink: 0;
  flex-wrap: wrap;
}
.bottom-left {
  display: flex;
  align-items: center;
  gap: 14px;
  flex-wrap: wrap;
}
.bottom-right {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-shrink: 0;
}
.char-count {
  font-size: 11px;
  color: #444;
  font-family: "Consolas", "Fira Mono", monospace;
}
.expiry-row {
  display: flex;
  align-items: center;
  gap: 6px;
}
.expiry-label {
  font-size: 11px;
  color: #555;
}
.expiry-select {
  background: #111217;
  border: 1px solid #2a2a30;
  color: #aaa;
  font-family: inherit;
  font-size: 11px;
  padding: 4px 8px;
  outline: none;
  cursor: pointer;
  appearance: none;
}
.expiry-select:focus {
  border-color: #6f2bff55;
}

.your-btn {
  display: flex;
  align-items: center;
  gap: 6px;
  height: 32px;
  padding: 0 12px;
  border: 1px solid #2a2a30;
  background: transparent;
  color: #888;
  font-family: inherit;
  font-size: 11px;
  cursor: pointer;
  transition: all 0.15s;
}
.your-btn:hover {
  border-color: #9d6cff55;
  color: #9d6cff;
  background: rgba(111, 43, 255, 0.06);
}
.your-icon {
  width: 13px;
  height: 13px;
  flex-shrink: 0;
}
.create-btn {
  height: 32px;
  padding: 0 18px;
  border: none;
  background: #6f2bff;
  color: #fff;
  font-family: inherit;
  font-size: 12px;
  font-weight: 600;
  cursor: pointer;
  transition: background 0.15s;
}
.create-btn:hover:not(:disabled) {
  background: #7f3fff;
}
.create-btn:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}

.create-error {
  padding: 7px 14px;
  font-size: 11px;
  color: #f14949;
  background: rgba(241, 73, 73, 0.08);
  border: 1px solid #f1494933;
  border-top: none;
  flex-shrink: 0;
}

/* >>> Result state <<< */
.result-state {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 40px;
}
.result-box {
  display: flex;
  flex-direction: column;
  gap: 14px;
  align-items: center;
  background: #141418;
  border: 1px solid #2a2a30;
  padding: 32px 40px;
  max-width: 500px;
  width: 100%;
}
.result-label {
  font-size: 11px;
  font-weight: 600;
  color: #555;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  align-self: flex-start;
}
.result-link-row {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
}
.result-code {
  flex: 1;
  font-family: "Consolas", "Fira Mono", monospace;
  font-size: 13px;
  color: #9d6cff;
  background: #0d0d10;
  border: 1px solid #2a2a30;
  padding: 8px 12px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.copy-btn {
  height: 34px;
  padding: 0 14px;
  border: 1px solid #6f2bff55;
  background: #6f2bff18;
  color: #9d6cff;
  font-family: inherit;
  font-size: 11px;
  cursor: pointer;
  flex-shrink: 0;
  transition: background 0.15s;
  white-space: nowrap;
}
.copy-btn:hover {
  background: #6f2bff30;
}
.new-note-btn {
  height: 30px;
  padding: 0 14px;
  border: 1px solid #2a2a30;
  background: transparent;
  color: #666;
  font-family: inherit;
  font-size: 11px;
  cursor: pointer;
  align-self: flex-start;
  transition: all 0.15s;
}
.new-note-btn:hover {
  color: #e0e0e0;
  border-color: #444;
}

/* >>> List view <<< */
.list-view {
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 0;
}
.list-header {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 0 0 14px;
  border-bottom: 1px solid #222;
  flex-shrink: 0;
  margin-bottom: 16px;
}
.back-btn {
  height: 28px;
  padding: 0 10px;
  border: 1px solid #2a2a30;
  background: transparent;
  color: #666;
  font-family: inherit;
  font-size: 11px;
  cursor: pointer;
}
.back-btn:hover {
  color: #e0e0e0;
  border-color: #444;
}
.list-title {
  font-size: 16px;
  font-weight: 700;
  color: #e0e0e0;
  flex: 1;
}
.list-count {
  font-size: 11px;
  color: #555;
}
.list-empty {
  color: #444;
  font-size: 13px;
  padding: 40px;
  text-align: center;
}

.notes-list {
  display: flex;
  flex-direction: column;
  gap: 2px;
  overflow-y: auto;
  flex: 1;
}
.note-item {
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: 12px 14px;
  background: #141418;
  border-bottom: 1px solid #1a1a1e;
  transition: background 0.1s;
}
.note-item:hover {
  background: #1c1c20;
}

.note-preview {
  font-family: "Consolas", "Fira Mono", monospace;
  font-size: 12px;
  color: #ccc;
  text-decoration: none;
  display: block;
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
  transition: color 0.1s;
}
.note-preview:hover {
  color: #9d6cff;
}

.note-meta {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 10px;
  color: #444;
}
.note-dot {
  color: #2a2a30;
}
.note-expiry.expired {
  color: #f14949;
}

.note-actions {
  display: flex;
  align-items: center;
  gap: 6px;
}
.note-link-code {
  font-family: "Consolas", "Fira Mono", monospace;
  font-size: 10px;
  color: #9d6cff;
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.copy-btn-sm {
  height: 20px;
  padding: 0 7px;
  border: 1px solid #6f2bff44;
  background: transparent;
  color: #9d6cff;
  font-family: inherit;
  font-size: 9px;
  cursor: pointer;
  flex-shrink: 0;
}
.copy-btn-sm:hover {
  background: #6f2bff18;
}
.delete-btn-sm {
  width: 22px;
  height: 22px;
  border: 1px solid #f1494933;
  background: transparent;
  color: #f14949;
  font-size: 11px;
  cursor: pointer;
  flex-shrink: 0;
  display: flex;
  align-items: center;
  justify-content: center;
}
.delete-btn-sm:hover {
  background: rgba(241, 73, 73, 0.12);
}
.delete-btn-sm.confirm {
  border-color: #f14949;
  background: rgba(241, 73, 73, 0.2);
  font-weight: 700;
}

/* Expired note styles */
.note-item.is-expired {
  opacity: 0.7;
}
.note-preview-expired {
  color: #555;
  cursor: default;
  font-family: "Consolas", "Fira Mono", monospace;
  font-size: 12px;
  display: block;
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
}
.note-link-expired {
  font-family: "Consolas", "Fira Mono", monospace;
  font-size: 12px;
  color: #333;
  flex: 1;
}

.restore-btn-sm {
  height: 20px;
  padding: 0 8px;
  border: 1px solid #9d6cff44;
  background: transparent;
  color: #9d6cff;
  font-family: inherit;
  font-size: 9px;
  cursor: pointer;
  flex-shrink: 0;
  transition: background 0.15s;
}
.restore-btn-sm:hover {
  background: #6f2bff18;
}

.restore-panel {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
  margin-top: 6px;
  padding: 8px 10px;
  background: #0d0d10;
  border: 1px solid #2a2a30;
  animation: fadeIn 0.15s ease;
}
@keyframes fadeIn {
  from {
    opacity: 0;
    transform: translateY(-4px);
  }
  to {
    opacity: 1;
    transform: none;
  }
}
.restore-label {
  font-size: 10px;
  color: #666;
  flex-shrink: 0;
}
.restore-confirm-btn {
  height: 24px;
  padding: 0 12px;
  border: none;
  background: #6f2bff;
  color: #fff;
  font-family: inherit;
  font-size: 10px;
  cursor: pointer;
  flex-shrink: 0;
}
.restore-confirm-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
.restore-confirm-btn:not(:disabled):hover {
  background: #7f3fff;
}
.restore-cancel-btn {
  height: 24px;
  padding: 0 10px;
  border: 1px solid #2a2a30;
  background: transparent;
  color: #555;
  font-family: inherit;
  font-size: 10px;
  cursor: pointer;
  flex-shrink: 0;
}
.restore-cancel-btn:hover {
  color: #aaa;
  border-color: #444;
}
</style>
