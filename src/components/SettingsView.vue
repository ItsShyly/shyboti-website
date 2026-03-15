<script setup lang="ts">
import { ref, onMounted, watch } from 'vue'
import { API } from '../api'
import { useAuth } from '../auth'

const { session } = useAuth()

const isBroadcaster = ref(false)

// ── Prefix (broadcaster only) ─────────────────────────────────────────────────
const prefix       = ref('+')
const prefixSaving = ref(false)
const prefixSaved  = ref(false)
const prefixError  = ref('')

// ── Log opt-out (all users) ───────────────────────────────────────────────────
const optedOut   = ref(false)
const optSaving  = ref(false)
const optMsg     = ref('')

async function load() {
  if (!session.value) return
  isBroadcaster.value = session.value.login === session.value.channel

  const headers = { Authorization: `Bearer ${session.value.token}` }
  try {
    const [sRes, oRes] = await Promise.all([
      fetch(`${API}/settings/${session.value.channel}`, { headers }),
      fetch(`${API}/log-optout`, { headers }),
    ])
    if (sRes.ok) { const d = await sRes.json(); prefix.value = d.settings?.prefix ?? '+' }
    if (oRes.ok) { const d = await oRes.json(); optedOut.value = d.opted_out ?? false }
  } catch {}
}

async function savePrefix() {
  if (!session.value || !isBroadcaster.value) return
  if (!prefix.value.trim()) { prefixError.value = 'Prefix cannot be empty'; return }
  prefixError.value = ''
  prefixSaving.value = true
  try {
    const res = await fetch(`${API}/settings/${session.value.channel}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.value.token}` },
      body: JSON.stringify({ prefix: prefix.value }),
    })
    if (!res.ok) throw new Error()
    prefixSaved.value = true
    setTimeout(() => prefixSaved.value = false, 2000)
  } catch { prefixError.value = 'Could not save prefix.' }
  prefixSaving.value = false
}

async function toggleOptOut() {
  if (!session.value) return
  optSaving.value = true
  optMsg.value = ''
  try {
    await fetch(`${API}/log-optout`, {
      method: optedOut.value ? 'DELETE' : 'POST',
      headers: { Authorization: `Bearer ${session.value.token}` },
    })
    optedOut.value = !optedOut.value
    optMsg.value = optedOut.value ? 'You are now opted out.' : 'You have opted back in.'
    setTimeout(() => optMsg.value = '', 3000)
  } catch { optMsg.value = 'Something went wrong.' }
  optSaving.value = false
}

onMounted(load)
watch(() => session.value?.channel, load)
</script>

<template>
  <div class="settings">
    <div class="settings-header">
      <h2 class="settings-title">Settings</h2>
      <p class="settings-sub">Channel and account settings for <span class="chan">#{{ session?.channel }}</span>.</p>
    </div>

    <!-- Command prefix — broadcaster only -->
    <div class="section" v-if="isBroadcaster">
      <div class="section-head">
        <div>
          <div class="section-title">Command Prefix</div>
          <div class="section-sub">The character(s) used to trigger bot commands in chat. Currently <code class="code">{{ prefix }}</code>command.</div>
        </div>
        <span class="badge bc">Broadcaster only</span>
      </div>
      <div class="prefix-row">
        <input
          v-model="prefix"
          class="prefix-input"
          maxlength="3"
          placeholder="+"
          @keydown.enter="savePrefix"
          spellcheck="false"
        />
        <div class="prefix-preview">
          <span class="prefix-example"><span class="pre">{{ prefix || '+' }}</span>ping</span>
          <span class="prefix-hint">how commands look in chat</span>
        </div>
        <button class="save-btn" @click="savePrefix" :disabled="prefixSaving || !prefix">
          {{ prefixSaved ? '✓ Saved' : prefixSaving ? 'Saving…' : 'Save prefix' }}
        </button>
      </div>
      <div v-if="prefixError" class="field-error">{{ prefixError }}</div>
      <div class="section-note">⚠ Changing the prefix will affect all commands immediately. Make sure to tell your chat!</div>
    </div>

    <!-- Log opt-out — all users -->
    <div class="section">
      <div class="section-head">
        <div>
          <div class="section-title">Chat Logs Opt-Out</div>
          <div class="section-sub">
            Control whether your username and messages appear in the bot's log viewer.
            When opted out, your name is replaced with <code class="code">OptedOutUser</code> and your messages with <code class="code">&lt;message hidden&gt;</code>.
          </div>
        </div>
        <span class="badge" :class="optedOut ? 'out' : 'in'">{{ optedOut ? 'Opted out' : 'Visible' }}</span>
      </div>

      <div class="opt-row">
        <div class="opt-status">
          <div class="opt-dot" :class="{ out: optedOut }"></div>
          <span v-if="optedOut" class="opt-label out">Your messages are anonymized in all log views.</span>
          <span v-else class="opt-label">Your username and messages are visible in log views.</span>
        </div>
        <button class="opt-btn" :class="{ out: optedOut }" @click="toggleOptOut" :disabled="optSaving">
          {{ optSaving ? '…' : optedOut ? 'Opt back in' : 'Opt out of logs' }}
        </button>
      </div>
      <div v-if="optMsg" class="opt-msg">{{ optMsg }}</div>
    </div>
  </div>
</template>

<style scoped>
.settings { display: flex; flex-direction: column; gap: 20px; }

.settings-header { padding-bottom: 16px; border-bottom: 1px solid #222; }
.settings-title  { font-size: 18px; font-weight: 700; color: #e0e0e0; margin-bottom: 4px; }
.settings-sub    { font-size: 12px; color: #666; }
.chan            { color: #9d6cff; }

.section { background: #1a1a1e; border: 1px solid #2a2a30; padding: 20px; display: flex; flex-direction: column; gap: 14px; }

.section-head  { display: flex; align-items: flex-start; justify-content: space-between; gap: 16px; }
.section-title { font-size: 14px; font-weight: 700; color: #e0e0e0; margin-bottom: 4px; }
.section-sub   { font-size: 12px; color: #666; max-width: 520px; line-height: 1.5; }
.code { font-family: 'Consolas','Fira Mono',monospace; color: #9d6cff; font-size: 12px; background: rgba(111,43,255,.1); padding: 1px 5px; }

.badge { font-size: 9px; font-weight: 700; padding: 3px 8px; letter-spacing: .05em; white-space: nowrap; flex-shrink: 0; }
.badge.bc  { background: #f1494922; color: #f14949; border: 1px solid #f1494944; }
.badge.in  { background: #23d18b15; color: #23d18b; border: 1px solid #23d18b44; }
.badge.out { background: #55555515; color: #888;    border: 1px solid #55555544; }

/* Prefix section */
.prefix-row { display: flex; align-items: center; gap: 14px; }
.prefix-input {
  width: 60px; background: #0d0d10; border: 1px solid #2a2a30;
  color: #e0e0e0; font-family: 'Consolas','Fira Mono',monospace;
  font-size: 20px; font-weight: 700; padding: 8px 12px;
  outline: none; text-align: center;
}
.prefix-input:focus { border-color: #6f2bff88; }
.prefix-preview { display: flex; flex-direction: column; gap: 2px; }
.prefix-example { font-family: 'Consolas','Fira Mono',monospace; font-size: 14px; color: #aaa; }
.prefix-example .pre { color: #9d6cff; font-weight: 700; }
.prefix-hint { font-size: 10px; color: #444; }
.save-btn {
  height: 36px; padding: 0 18px; border: none; background: #6f2bff;
  color: #fff; font-family: inherit; font-size: 12px; font-weight: 600;
  cursor: pointer; transition: background .15s; margin-left: auto;
}
.save-btn:hover:not(:disabled) { background: #7f3fff; }
.save-btn:disabled { opacity: .4; cursor: not-allowed; }
.field-error { font-size: 11px; color: #f14949; }
.section-note { font-size: 11px; color: #555; background: rgba(229,192,123,.06); border-left: 2px solid #e5c07b44; padding: 6px 10px; }

/* Opt-out section */
.opt-row { display: flex; align-items: center; justify-content: space-between; gap: 16px; }
.opt-status { display: flex; align-items: center; gap: 10px; }
.opt-dot { width: 8px; height: 8px; border-radius: 50%; background: #23d18b; flex-shrink: 0; transition: background .3s; }
.opt-dot.out { background: #555; }
.opt-label { font-size: 12px; color: #888; }
.opt-label.out { color: #555; }
.opt-btn {
  height: 34px; padding: 0 16px; border: 1px solid #2a2a30;
  background: transparent; color: #888; font-family: inherit; font-size: 11px;
  cursor: pointer; white-space: nowrap; transition: all .15s; flex-shrink: 0;
}
.opt-btn:hover:not(:disabled) { border-color: #f14949; color: #f14949; }
.opt-btn.out { border-color: #23d18b44; color: #23d18b; background: rgba(35,209,139,.06); }
.opt-btn.out:hover:not(:disabled) { background: rgba(35,209,139,.15); }
.opt-btn:disabled { opacity: .4; cursor: not-allowed; }
.opt-msg { font-size: 11px; color: #23d18b; }
</style>
