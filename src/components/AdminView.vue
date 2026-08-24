<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted, watch } from "vue";
import { useRouter } from "vue-router";
import { API } from "../api";
import { useAuth } from "../auth";
import { iconSvg } from "../composables/icons";

const { session } = useAuth();
const router = useRouter();

// >>> bounce non-admins the moment session resolves, empty until then
watch(
  session,
  (s) => {
    if (s && !s.isAdmin) router.replace("/dashboard");
  },
  { immediate: true },
);

interface Bug {
  id: number;
  channel: string;
  username: string;
  message: string;
  status: "open" | "done";
  created_at: number;
}

const bugs = ref<Bug[]>([]);
const loading = ref(false);
const filter = ref<"open" | "done" | "all">("open");
const deleteId = ref<number | null>(null);

interface Health {
  uptimeSeconds: number;
  ircConnected: boolean;
  configDbBytes: number;
  gamesDbBytes: number;
}
const health = ref<Health | null>(null);
let healthTimer: ReturnType<typeof setInterval> | null = null;

async function loadHealth() {
  if (!session.value?.isAdmin) return;
  try {
    const res = await fetch(`${API}/admin/health`, {
      headers: authHeaders(),
    });
    if (res.ok) health.value = (await res.json()) as Health;
  } catch {}
}

function fmtUptime(s: number): string {
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  if (d > 0) return `${d}d ${h}h`;
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

function fmtBytes(b: number): string {
  return `${(b / 1024 / 1024).toFixed(1)} MB`;
}

// >>> admins list is display-only here - add/remove happens directly in the db
const admins = ref<string[]>([]);

async function loadAdmins() {
  if (!session.value?.isAdmin) return;
  try {
    const res = await fetch(`${API}/admin/admins`, { headers: authHeaders() });
    if (res.ok) {
      const data = (await res.json()) as { admins: string[] };
      admins.value = data.admins;
    }
  } catch {}
}

const devGateUsers = ref<string[]>([]);
const newDevGateName = ref("");
const addDevGateError = ref("");
const removeDevGateId = ref<string | null>(null);

async function loadDevGate() {
  if (!session.value?.isAdmin) return;
  try {
    const res = await fetch(`${API}/admin/devgate`, {
      headers: authHeaders(),
    });
    if (res.ok) {
      const data = (await res.json()) as { users: string[] };
      devGateUsers.value = data.users;
    }
  } catch {}
}

async function addDevGateUser() {
  const username = newDevGateName.value.trim().toLowerCase();
  if (!username) return;
  addDevGateError.value = "";
  try {
    const res = await fetch(`${API}/admin/devgate`, {
      method: "POST",
      headers: { ...authHeaders(), "Content-Type": "application/json" },
      body: JSON.stringify({ username }),
    });
    if (!res.ok) {
      const d = (await res.json()) as any;
      throw new Error(d.error ?? "Could not add user");
    }
    newDevGateName.value = "";
    await loadDevGate();
    loadAudit();
  } catch (e: any) {
    addDevGateError.value = e.message ?? "Could not add user";
  }
}

async function removeDevGateUser(username: string) {
  if (removeDevGateId.value !== username) {
    removeDevGateId.value = username;
    setTimeout(() => {
      if (removeDevGateId.value === username) removeDevGateId.value = null;
    }, 3000);
    return;
  }
  removeDevGateId.value = null;
  try {
    await fetch(`${API}/admin/devgate/${username}`, {
      method: "DELETE",
      headers: authHeaders(),
    });
    devGateUsers.value = devGateUsers.value.filter((a) => a !== username);
    loadAudit();
  } catch {}
}

interface AuditEntry {
  id: number;
  actor: string;
  action: string;
  target: string;
  created_at: number;
}
const auditEntries = ref<AuditEntry[]>([]);

async function loadAudit() {
  if (!session.value?.isAdmin) return;
  try {
    const res = await fetch(`${API}/admin/audit`, { headers: authHeaders() });
    if (res.ok) {
      const data = (await res.json()) as { entries: AuditEntry[] };
      auditEntries.value = data.entries;
    }
  } catch {}
}

const filtered = computed(() => {
  if (filter.value === "all") return bugs.value;
  return bugs.value.filter((b) => b.status === filter.value);
});
const openCount = computed(
  () => bugs.value.filter((b) => b.status === "open").length,
);

function authHeaders(): Record<string, string> {
  return session.value
    ? { Authorization: `Bearer ${session.value.token}` }
    : {};
}

async function loadBugs() {
  if (!session.value?.isAdmin) return;
  loading.value = true;
  try {
    const res = await fetch(`${API}/admin/bugs`, { headers: authHeaders() });
    if (res.ok) {
      const data = (await res.json()) as { bugs: Bug[] };
      bugs.value = data.bugs;
    }
  } catch {}
  loading.value = false;
}

async function toggleStatus(bug: Bug) {
  const next = bug.status === "open" ? "done" : "open";
  bug.status = next;
  try {
    await fetch(`${API}/admin/bugs/${bug.id}`, {
      method: "PATCH",
      headers: { ...authHeaders(), "Content-Type": "application/json" },
      body: JSON.stringify({ status: next }),
    });
    loadAudit();
  } catch {}
}

async function deleteBug(id: number) {
  if (deleteId.value !== id) {
    deleteId.value = id;
    setTimeout(() => {
      if (deleteId.value === id) deleteId.value = null;
    }, 3000);
    return;
  }
  deleteId.value = null;
  bugs.value = bugs.value.filter((b) => b.id !== id);
  try {
    await fetch(`${API}/admin/bugs/${id}`, {
      method: "DELETE",
      headers: authHeaders(),
    });
    loadAudit();
  } catch {}
}

function fmtDate(ts: number) {
  return new Date(ts).toLocaleString("de-DE", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

onMounted(() => {
  loadBugs();
  loadHealth();
  loadAdmins();
  loadDevGate();
  loadAudit();
  healthTimer = setInterval(loadHealth, 30_000);
});
onUnmounted(() => {
  if (healthTimer) clearInterval(healthTimer);
});
watch(
  () => session.value?.isAdmin,
  (v) => {
    if (v) {
      loadBugs();
      loadHealth();
      loadAdmins();
      loadDevGate();
      loadAudit();
    }
  },
);
</script>

<template>
  <div v-if="session?.isAdmin" class="admin-page">
    <div v-if="health" class="health-tile">
      <div class="health-stat">
        <span class="health-dot" :class="{ on: health.ircConnected }"></span>
        {{ health.ircConnected ? "IRC verbunden" : "IRC getrennt" }}
      </div>
      <div class="health-stat">Uptime: {{ fmtUptime(health.uptimeSeconds) }}</div>
      <div class="health-stat">
        DB: {{ fmtBytes(health.configDbBytes) }} / {{ fmtBytes(health.gamesDbBytes) }}
      </div>
    </div>

    <div class="admins-tile">
      <div class="admins-title">Admins</div>
      <div class="admins-list">
        <div v-for="a in admins" :key="a" class="admin-pill readonly">
          {{ a }}
        </div>
      </div>
    </div>

    <div class="admins-tile">
      <div class="admins-title">Dev Access</div>
      <div class="admins-list">
        <div v-for="u in devGateUsers" :key="u" class="admin-pill">
          {{ u }}
          <button class="admin-pill-remove" :class="{ confirm: removeDevGateId === u }" @click="removeDevGateUser(u)">
            <template v-if="removeDevGateId === u">?</template>
            <span v-else>×</span>
          </button>
        </div>
      </div>
      <form class="admin-add-form" @submit.prevent="addDevGateUser">
        <input v-model="newDevGateName" class="admin-add-input" placeholder="Twitch-Login…" />
        <button type="submit" class="admin-add-btn">+</button>
      </form>
      <div v-if="addDevGateError" class="admin-add-error">{{ addDevGateError }}</div>
    </div>

    <div class="admin-header">
      <div class="admin-title">Admin</div>
      <div class="admin-tabs">
        <button class="admin-tab" :class="{ active: filter === 'open' }" @click="filter = 'open'">
          Offen<span v-if="openCount" class="tab-count">{{ openCount }}</span>
        </button>
        <button class="admin-tab" :class="{ active: filter === 'done' }" @click="filter = 'done'">
          Erledigt
        </button>
        <button class="admin-tab" :class="{ active: filter === 'all' }" @click="filter = 'all'">
          Alle
        </button>
      </div>
    </div>

    <div v-if="loading" class="admin-empty">Lädt…</div>
    <div v-else-if="!filtered.length" class="admin-empty">Keine Bugs.</div>
    <div v-else class="bug-list">
      <div v-for="bug in filtered" :key="bug.id" class="bug-item" :class="{ done: bug.status === 'done' }">
        <button class="bug-check" :class="{ on: bug.status === 'done' }" @click="toggleStatus(bug)">
          <span v-if="bug.status === 'done'" v-html="iconSvg('check')"></span>
        </button>
        <div class="bug-body">
          <div class="bug-message">{{ bug.message }}</div>
          <div class="bug-meta">
            <span>#{{ bug.channel }}</span>
            <span class="bug-dot">·</span>
            <span>{{ bug.username }}</span>
            <span class="bug-dot">·</span>
            <span>{{ fmtDate(bug.created_at) }}</span>
          </div>
        </div>
        <button class="bug-delete" :class="{ confirm: deleteId === bug.id }" @click="deleteBug(bug.id)">
          <template v-if="deleteId === bug.id">?</template>
          <span v-else v-html="iconSvg('trash')"></span>
        </button>
      </div>
    </div>

    <details v-if="auditEntries.length" class="audit-tile">
      <summary class="audit-summary">Audit-Log ({{ auditEntries.length }})</summary>
      <div class="audit-list">
        <div v-for="entry in auditEntries" :key="entry.id" class="audit-row">
          <span class="audit-actor">{{ entry.actor }}</span>
          <span class="audit-action">{{ entry.action }}</span>
          <span class="audit-target">{{ entry.target }}</span>
          <span class="audit-time">{{ fmtDate(entry.created_at) }}</span>
        </div>
      </div>
    </details>
  </div>
</template>

<style scoped>
.audit-tile {
  margin-top: 10px;
  flex-shrink: 0;
  border-top: 1px solid #222;
  padding-top: 10px;
}
.audit-summary {
  font-size: 11px;
  color: #666;
  cursor: pointer;
  user-select: none;
}
.audit-list {
  display: flex;
  flex-direction: column;
  gap: 2px;
  max-height: 200px;
  overflow-y: auto;
  margin-top: 8px;
}
.audit-row {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 5px 8px;
  font-size: 10px;
  color: #777;
  background: #141418;
  border-bottom: 1px solid #1a1a1e;
}
.audit-actor {
  color: #9d6cff;
  flex-shrink: 0;
}
.audit-action {
  color: #ccc;
  flex-shrink: 0;
}
.audit-target {
  color: #666;
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.audit-time {
  color: #444;
  flex-shrink: 0;
}

.admin-page {
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 0;
}

.health-tile {
  display: flex;
  align-items: center;
  gap: 20px;
  padding: 10px 14px;
  margin-bottom: 14px;
  background: #141418;
  border: 1px solid #2a2a30;
  font-size: 11px;
  color: #999;
  flex-shrink: 0;
  flex-wrap: wrap;
}
.health-stat {
  display: flex;
  align-items: center;
  gap: 6px;
}
.health-dot {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: #f14949;
  flex-shrink: 0;
}
.health-dot.on {
  background: #4caf50;
}

.admins-tile {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 10px 14px;
  margin-bottom: 14px;
  background: #141418;
  border: 1px solid #2a2a30;
  flex-shrink: 0;
  flex-wrap: wrap;
}
.admins-title {
  font-size: 11px;
  font-weight: 600;
  color: #666;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  flex-shrink: 0;
}
.admins-list {
  display: flex;
  align-items: center;
  gap: 6px;
  flex-wrap: wrap;
}
.admin-pill {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 3px 4px 3px 8px;
  font-size: 11px;
  color: #9d6cff;
  background: rgba(111, 43, 255, 0.1);
  border: 1px solid #6f2bff44;
}
.admin-pill.readonly {
  padding: 3px 8px;
}
.admin-pill-remove {
  width: 15px;
  height: 15px;
  border: none;
  background: transparent;
  color: #f14949;
  font-size: 12px;
  line-height: 1;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
}
.admin-pill-remove:hover {
  background: rgba(241, 73, 73, 0.15);
}
.admin-pill-remove.confirm {
  background: rgba(241, 73, 73, 0.25);
  font-weight: 700;
}
.admin-add-form {
  display: flex;
  gap: 6px;
  margin-left: auto;
  flex-shrink: 0;
}
.admin-add-input {
  height: 26px;
  padding: 0 8px;
  border: 1px solid #2a2a30;
  background: #0d0d10;
  color: #e0e0e0;
  font-family: inherit;
  font-size: 11px;
  outline: none;
  width: 130px;
}
.admin-add-input:focus {
  border-color: #6f2bff55;
}
.admin-add-btn {
  width: 26px;
  height: 26px;
  border: none;
  background: #6f2bff;
  color: #fff;
  font-size: 13px;
  cursor: pointer;
  transition: background 0.15s;
}
.admin-add-btn:hover {
  background: #7f3fff;
}
.admin-add-error {
  width: 100%;
  font-size: 10px;
  color: #f14949;
}

.admin-header {
  display: flex;
  align-items: center;
  gap: 20px;
  padding-bottom: 14px;
  border-bottom: 1px solid #222;
  margin-bottom: 16px;
  flex-shrink: 0;
}
.admin-title {
  font-size: 16px;
  font-weight: 700;
  color: #e0e0e0;
}
.admin-tabs {
  display: flex;
  gap: 4px;
}
.admin-tab {
  display: flex;
  align-items: center;
  gap: 6px;
  height: 28px;
  padding: 0 10px;
  border: 1px solid #2a2a30;
  background: transparent;
  color: #777;
  font-family: inherit;
  font-size: 11px;
  cursor: pointer;
  transition: all 0.15s;
}
.admin-tab:hover {
  color: #ccc;
  border-color: #444;
}
.admin-tab.active {
  color: #9d6cff;
  border-color: #6f2bff55;
  background: rgba(111, 43, 255, 0.08);
}
.tab-count {
  font-size: 9px;
  color: #f14949;
  background: rgba(241, 73, 73, 0.15);
  padding: 1px 5px;
}

.admin-empty {
  color: #444;
  font-size: 13px;
  padding: 40px;
  text-align: center;
}

.bug-list {
  display: flex;
  flex-direction: column;
  gap: 2px;
  overflow-y: auto;
  flex: 1;
}
.bug-item {
  display: flex;
  align-items: flex-start;
  gap: 10px;
  padding: 12px 14px;
  background: #141418;
  border-bottom: 1px solid #1a1a1e;
  transition: background 0.1s;
}
.bug-item:hover {
  background: #1c1c20;
}
.bug-item.done {
  opacity: 0.5;
}

.bug-check {
  width: 18px;
  height: 18px;
  border: 1px solid #2a2a30;
  background: #0d0d10;
  cursor: pointer;
  flex-shrink: 0;
  margin-top: 1px;
  display: flex;
  align-items: center;
  justify-content: center;
  color: #fff;
  transition: all 0.15s;
}
.bug-check.on {
  background: #6f2bff;
  border-color: #6f2bff;
}

.bug-body {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.bug-message {
  font-size: 13px;
  color: #ccc;
  word-break: break-word;
}
.bug-item.done .bug-message {
  text-decoration: line-through;
}
.bug-meta {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 10px;
  color: #555;
}
.bug-dot {
  color: #2a2a30;
}

.bug-delete {
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
.bug-delete:hover {
  background: rgba(241, 73, 73, 0.12);
}
.bug-delete.confirm {
  border-color: #f14949;
  background: rgba(241, 73, 73, 0.2);
  font-weight: 700;
}
</style>
