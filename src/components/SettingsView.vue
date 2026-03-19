<script setup lang="ts">
import { ref, onMounted, watch } from 'vue'
import { API } from '../api'
import { useAuth } from '../auth'
import { useI18n } from '../i18n'

const { session } = useAuth()
const { t } = useI18n()

const isBroadcaster = ref(false)

// >>> Prefix (broadcaster only)
const prefix       = ref('+')
const prefixSaving = ref(false)
const prefixSaved  = ref(false)
const prefixError  = ref('')

// >>> Log opt-out (all users)
const optedOut   = ref(false)
const optSaving  = ref(false)
const optMsg     = ref('')

// >>> Vanish hide setting (broadcaster only)
const vanishHide       = ref(false)
const vanishSaving     = ref(false)
const vanishMsg        = ref('')

// >>> Remove bot (broadcaster only)
const removeConfirm  = ref(false)
const removeRemoving = ref(false)
const removeMsg      = ref('')
const removeError    = ref('')

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
  if (!prefix.value.trim()) { prefixError.value = t('settings.prefix.error.empty'); return }
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
  } catch { prefixError.value = t('settings.prefix.error.save') }
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
    optMsg.value = optedOut.value ? t('settings.optout.msg.out') : t('settings.optout.msg.in')
    setTimeout(() => optMsg.value = '', 3000)
  } catch { optMsg.value = t('settings.optout.error') }
  optSaving.value = false
}

// >>> 7TV Emote Set (broadcaster only)
interface EmoteSetInfo { setId: string | null; setName: string | null; emoteCount?: number }
const emoteSet        = ref<EmoteSetInfo>({ setId: null, setName: null })
const emoteSetLoading = ref(false)
const emoteSetSaving  = ref(false)
const emoteSetError   = ref('')
const emoteSetSuccess = ref('')
const emoteInput7tv   = ref('') // >>> channel name input
const emoteInputId    = ref('') // >>> direct set ID input

async function load7tvSet() {
  if (!session.value) return
  emoteSetLoading.value = true
  try {
    const res = await fetch(`${API}/settings/7tv/${session.value.channel}`, {
      headers: { Authorization: `Bearer ${session.value.token}` }
    })
    if (res.ok) emoteSet.value = await res.json()
  } catch {}
  emoteSetLoading.value = false
}

async function fetch7tvSet() {
  if (!session.value || !isBroadcaster.value) return
  const channelName = emoteInput7tv.value.trim().replace(/^#/, '')
  const setId       = emoteInputId.value.trim()
  if (!channelName && !setId) return
  emoteSetSaving.value = true; emoteSetError.value = ''; emoteSetSuccess.value = ''
  try {
    const res = await fetch(`${API}/settings/7tv/${session.value.channel}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.value.token}` },
      body: JSON.stringify(channelName ? { channelName } : { setId }),
    })
    const d = await res.json() as any
    if (!res.ok) throw new Error(d.error ?? 'Failed')
    emoteSet.value    = { setId: d.setId, setName: d.setName, emoteCount: d.emoteCount }
    emoteInput7tv.value = ''; emoteInputId.value = ''
    emoteSetSuccess.value = `${d.setName ?? d.setId} (${d.emoteCount ?? '?'} ${t('settings.7tv.emotes')})`
    setTimeout(() => emoteSetSuccess.value = '', 4000)
  } catch (e: any) { emoteSetError.value = e.message ?? t('settings.7tv.error') }
  emoteSetSaving.value = false
}

async function remove7tvSet() {
  if (!session.value || !isBroadcaster.value) return
  emoteSetSaving.value = true; emoteSetError.value = ''; emoteSetSuccess.value = ''
  try {
    await fetch(`${API}/settings/7tv/${session.value.channel}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${session.value.token}` },
    })
    emoteSet.value = { setId: null, setName: null }
  } catch { emoteSetError.value = t('settings.7tv.error') }
  emoteSetSaving.value = false
}

// >>> Remove bot from channel
function clickRemoveBot() {
  if (!removeConfirm.value) {
    removeConfirm.value = true
    // Auto-cancel after 8s if user does nothing
    setTimeout(() => { removeConfirm.value = false }, 8000)
    return
  }
  doRemoveBot()
}

async function doRemoveBot() {
  if (!session.value || !isBroadcaster.value) return
  removeConfirm.value = false
  removeRemoving.value = true
  removeError.value = ''
  try {
    const res = await fetch(`${API}/bot/leave/${session.value.channel}`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${session.value.token}` },
    })
    if (!res.ok) throw new Error()
    removeMsg.value = t('settings.remove.done')
  } catch { removeError.value = t('settings.remove.error') }
  removeRemoving.value = false
}

async function loadAll() { await load(); await load7tvSet() }
onMounted(loadAll)
watch(() => session.value?.channel, loadAll)
</script>

<template>
  <div class="settings">
    <div class="settings-header">
      <h2 class="settings-title">{{ t('settings.title') }}</h2>
      <p class="settings-sub">{{ t('settings.sub') }} <span class="chan">#{{ session?.channel }}</span>.</p>
    </div>

    <!-- >>> Command prefix - broadcaster only -->
    <div class="section" v-if="isBroadcaster">
      <div class="section-head">
        <div>
          <div class="section-title">{{ t('settings.prefix.title') }}</div>
          <div class="section-sub">{{ t('settings.prefix.sub') }} <code class="code">{{ prefix }}</code>command.</div>
        </div>

      </div>
      <div class="prefix-row">
        <input v-model="prefix" class="prefix-input" maxlength="3" placeholder="+" @keydown.enter="savePrefix" spellcheck="false" />
        <div class="prefix-preview">
          <span class="prefix-example"><span class="pre">{{ prefix || '+' }}</span>ping</span>
          <span class="prefix-hint">{{ t('settings.prefix.how') }}</span>
        </div>
        <button class="save-btn" @click="savePrefix" :disabled="prefixSaving || !prefix">
          {{ prefixSaved ? t('settings.saved') : prefixSaving ? t('settings.saving') : t('settings.prefix.save') }}
        </button>
      </div>
      <div v-if="prefixError" class="field-error">{{ prefixError }}</div>
      <div class="section-note">{{ t('settings.prefix.note') }}</div>
    </div>

    <!-- >>> Log opt-out - all users -->
    <div class="section">
      <div class="section-head">
        <div>
          <div class="section-title">{{ t('settings.optout.title') }}</div>
          <div class="section-sub">{{ t('settings.optout.sub') }}</div>
        </div>
        <span class="badge" :class="optedOut ? 'out' : 'in'">{{ optedOut ? t('settings.optout.badge.out') : t('settings.optout.badge.in') }}</span>
      </div>
      <div class="opt-row">
        <div class="opt-status">
          <div class="opt-dot" :class="{ out: optedOut }"></div>
          <span class="opt-label" :class="{ out: optedOut }">{{ optedOut ? t('settings.optout.hidden') : t('settings.optout.visible') }}</span>
        </div>
        <button class="opt-btn" :class="{ out: optedOut }" @click="toggleOptOut" :disabled="optSaving">
          {{ optSaving ? '…' : optedOut ? t('settings.optout.btn.in') : t('settings.optout.btn.out') }}
        </button>
      </div>
      <div v-if="optMsg" class="opt-msg">{{ optMsg }}</div>
    </div>

    <!-- >>> 7TV Emote Set - broadcaster only -->
    <div class="section" v-if="isBroadcaster">
      <div class="section-head">
        <div>
          <div class="section-title">{{ t('settings.7tv.title') }}</div>
          <div class="section-sub">{{ t('settings.7tv.sub') }}</div>
        </div>

      </div>

      <div v-if="emoteSetLoading" class="section-loading">Loading…</div>
      <template v-else>
        <!-- >>> Current set -->
        <div v-if="emoteSet.setId" class="emote-set-current">
          <div class="emote-set-info">
            <span class="emote-set-name">{{ emoteSet.setName ?? emoteSet.setId }}</span>
            <span class="emote-set-id">{{ emoteSet.setId }}</span>
            <span v-if="emoteSet.emoteCount" class="emote-set-count">{{ emoteSet.emoteCount }} {{ t('settings.7tv.emotes') }}</span>
          </div>
          <button class="remove-set-btn" @click="remove7tvSet" :disabled="emoteSetSaving">
            {{ emoteSetSaving ? t('settings.7tv.removing') : t('settings.7tv.remove') }}
          </button>
        </div>
        <div v-else class="emote-set-none">{{ t('settings.7tv.none') }}</div>

        <!-- >>> Auto-fetch from own channel -->
        <div class="emote-input-row">
          <span class="emote-input-label">{{ t('settings.7tv.by_channel') }}</span>
          <button class="fetch-btn" @click="emoteInput7tv = session?.channel ?? ''; emoteInputId = ''; fetch7tvSet()" :disabled="emoteSetSaving">
            {{ emoteSetSaving ? t('settings.7tv.fetching') : t('settings.7tv.fetch') }}
          </button>
        </div>
        <!-- >>> Set by direct ID -->
        <div class="emote-input-row">
          <span class="emote-input-label">{{ t('settings.7tv.by_id') }}</span>
          <input
            v-model="emoteInputId"
            class="field-input-sm"
            :placeholder="t('settings.7tv.by_id.ph')"
            @keydown.enter="emoteInput7tv = ''; fetch7tvSet()"
            :disabled="emoteSetSaving"
          />
          <button class="fetch-btn" @click="emoteInput7tv = ''; fetch7tvSet()" :disabled="emoteSetSaving || !emoteInputId.trim()">
            {{ emoteSetSaving ? t('settings.7tv.fetching') : t('settings.7tv.fetch') }}
          </button>
        </div>

        <div v-if="emoteSetError"   class="set-msg err">{{ emoteSetError }}</div>
        <div v-if="emoteSetSuccess" class="set-msg ok">✓ {{ emoteSetSuccess }}</div>
      </template>
    </div>

    <!-- >>> Remove Bot - broadcaster only -->
    <div class="section danger-section" v-if="isBroadcaster">
      <div class="section-head">
        <div>
          <div class="section-title">{{ t('settings.remove.title') }}</div>
          <div class="section-sub">{{ t('settings.remove.sub') }}</div>
        </div>

      </div>

      <div v-if="removeMsg" class="opt-msg">{{ removeMsg }}</div>
      <div v-else-if="removeError" class="field-error">{{ removeError }}</div>

      <!-- Normal state - show remove button -->
      <div v-if="!removeConfirm && !removeMsg" class="remove-row">
        <button class="remove-btn" @click="clickRemoveBot" :disabled="removeRemoving">
          {{ removeRemoving ? t('settings.remove.removing') : t('settings.remove.btn') }}
        </button>
      </div>

      <!-- Confirm dialog - shown after first click -->
      <div v-if="removeConfirm" class="confirm-box">
        <div class="confirm-text">
          {{ t('settings.remove.confirm') }}<strong>#{{ session?.channel }}</strong>?
          {{ t('settings.remove.confirm2') }}
        </div>
        <div class="confirm-actions">
          <button class="confirm-no"  @click="removeConfirm = false">{{ t('settings.remove.no') }}</button>
          <button class="confirm-yes" @click="doRemoveBot">{{ t('settings.remove.yes') }}</button>
        </div>
      </div>
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
.danger-section { border-color: #f1494933; background: #1c1215; }

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

/* 7TV card */
.section-loading { font-size: 12px; color: #555; padding: 8px 0; }
.emote-set-current { display: flex; align-items: center; justify-content: space-between; gap: 12px; background: #111217; border: 1px solid #2a2a30; padding: 10px 14px; margin-bottom: 12px; }
.emote-set-info    { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; min-width: 0; }
.emote-set-name    { font-size: 13px; font-weight: 700; color: #e0e0e0; }
.emote-set-id      { font-size: 10px; color: #555; font-family: monospace; }
.emote-set-count   { font-size: 11px; color: #9d6cff; background: rgba(111,43,255,.1); padding: 1px 7px; }
.emote-set-none    { font-size: 12px; color: #555; padding: 6px 0 10px; }
.remove-set-btn    { height: 28px; padding: 0 12px; border: 1px solid #f1494944; background: transparent; color: #f14949; font-family: inherit; font-size: 11px; cursor: pointer; flex-shrink: 0; }
.remove-set-btn:hover:not(:disabled) { background: rgba(241,73,73,.1); }
.remove-set-btn:disabled { opacity: .4; cursor: not-allowed; }
.emote-input-row   { display: flex; align-items: center; gap: 8px; margin-bottom: 8px; flex-wrap: wrap; }
.emote-input-label { font-size: 11px; color: #666; white-space: nowrap; min-width: 120px; }
.field-input-sm    { height: 32px; background: #111217; border: 1px solid #2a2a30; color: #e0e0e0; font-family: inherit; font-size: 12px; padding: 0 10px; outline: none; flex: 1; min-width: 140px; }
.field-input-sm:focus { border-color: #6f2bff55; }
.field-input-sm:disabled { opacity: .4; }
.fetch-btn         { height: 32px; padding: 0 14px; border: 1px solid #6f2bff55; background: transparent; color: #9d6cff; font-family: inherit; font-size: 11px; font-weight: 600; cursor: pointer; flex-shrink: 0; white-space: nowrap; }
.fetch-btn:hover:not(:disabled) { background: rgba(111,43,255,.12); }
.fetch-btn:disabled { opacity: .4; cursor: not-allowed; }
.set-msg    { font-size: 11px; margin-top: 6px; padding: 5px 10px; }
.set-msg.ok  { color: #23d18b; background: rgba(35,209,139,.08); border-left: 2px solid #23d18b; }
.set-msg.err { color: #f14949; background: rgba(241,73,73,.08); border-left: 2px solid #f14949; }

/* Remove bot section */
.remove-row { display: flex; }
.remove-btn {
  height: 36px; padding: 0 18px; border: 1px solid #f1494966;
  background: transparent; color: #f14949; font-family: inherit; font-size: 12px; font-weight: 600;
  cursor: pointer; transition: background .15s, border-color .15s;
}
.remove-btn:hover:not(:disabled) { background: rgba(241,73,73,.12); border-color: #f14949; }
.remove-btn:disabled { opacity: .4; cursor: not-allowed; }

.confirm-box {
  background: rgba(241,73,73,.06); border: 1px solid #f1494944;
  padding: 14px 16px; display: flex; flex-direction: column; gap: 12px;
}
.confirm-text { font-size: 12px; color: #ccc; line-height: 1.6; }
.confirm-text strong { color: #9d6cff; }
.confirm-actions { display: flex; gap: 10px; }
.confirm-no {
  height: 34px; padding: 0 16px; border: 1px solid #2a2a30;
  background: transparent; color: #888; font-family: inherit; font-size: 12px; cursor: pointer;
}
.confirm-no:hover { border-color: #555; color: #e0e0e0; }
.confirm-yes {
  height: 34px; padding: 0 16px; border: none;
  background: #f14949; color: #fff; font-family: inherit; font-size: 12px; font-weight: 700; cursor: pointer;
}
.confirm-yes:hover { background: #ff5a5a; }
</style>
