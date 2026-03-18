<script setup lang="ts">
import { ref, computed } from 'vue'
import { useRouter } from 'vue-router'
import { useI18n } from '../i18n'
import { useAuth } from '../auth'
import { API } from '../api'

const { t } = useI18n()
const router = useRouter()
const { session } = useAuth()

const showChatterino = ref(false)
const showToken      = ref(false)
const copied         = ref('')
const uploadToken    = ref('')
const tokenLoading   = ref(false)

// >>> Variables & Counters
interface Counter { name: string; value: number }
interface Var     { name: string; value: string }
interface UCounter { username: string; name: string; value: number }
interface UVar     { username: string; name: string; value: string }

const showVars     = ref(false)
const varsLoading  = ref(false)
const varsError    = ref('')
const counters     = ref<Counter[]>([])
const vars         = ref<Var[]>([])
const ucounters    = ref<UCounter[]>([])
const uvars        = ref<UVar[]>([])
const varsTab      = ref<'counters' | 'vars' | 'ucounters' | 'uvars'>('counters')
const editingKey   = ref('')       // "type:name[:username]"
const editingVal   = ref('')
const addingType   = ref('')
const addForm      = ref({ name: '', value: '', username: '' })
const varSaving    = ref(false)

const totalCount = computed(() =>
  counters.value.length + vars.value.length + ucounters.value.length + uvars.value.length
)

async function openVars() {
  showVars.value = true
  await loadVars()
}

async function loadVars() {
  if (!session.value) return
  varsLoading.value = true; varsError.value = ''
  try {
    const res = await fetch(`${API}/variables/${session.value.channel}`, {
      headers: { Authorization: `Bearer ${session.value.token}` }
    })
    if (!res.ok) throw new Error('Failed to load')
    const data = await res.json() as { counters: Counter[]; vars: Var[]; ucounters: UCounter[]; uvars: UVar[] }
    counters.value  = data.counters
    vars.value      = data.vars
    ucounters.value = data.ucounters
    uvars.value     = data.uvars
  } catch (e: any) { varsError.value = e.message ?? 'Error' }
  varsLoading.value = false
}

function startEdit(type: string, name: string, value: string | number, username = '') {
  editingKey.value = `${type}:${name}:${username}`
  editingVal.value = String(value)
}

async function saveEdit(type: string, name: string, username = '') {
  if (!session.value) return
  varSaving.value = true
  await fetch(`${API}/variables/${session.value.channel}/${type}/${name}`, {
    method: 'PUT',
    headers: { Authorization: `Bearer ${session.value.token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ value: editingVal.value, username: username || undefined }),
  })
  editingKey.value = ''
  await loadVars()
  varSaving.value = false
}

async function deleteEntry(type: string, name: string, username = '') {
  if (!session.value) return
  await fetch(`${API}/variables/${session.value.channel}/${type}/${name}`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${session.value.token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: username || undefined }),
  })
  await loadVars()
}

async function addEntry() {
  if (!session.value || !addForm.value.name.trim()) return
  varSaving.value = true
  await fetch(`${API}/variables/${session.value.channel}/${addingType.value}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${session.value.token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name:     addForm.value.name.trim(),
      value:    addForm.value.value,
      username: addForm.value.username || undefined,
    }),
  })
  addingType.value = ''
  addForm.value = { name: '', value: '', username: '' }
  await loadVars()
  varSaving.value = false
}

function copyText(text: string, key: string) {
  navigator.clipboard.writeText(text).catch(() => {})
  copied.value = key
  setTimeout(() => { if (copied.value === key) copied.value = '' }, 1500)
}

async function openChatterino() {
  showChatterino.value = true
  if (!session.value || uploadToken.value) return
  // >>> Generate a permanent storage ID on first open (uses session only to prove identity, result is safe to share)
  tokenLoading.value = true
  try {
    const res = await fetch(`${API}/upload-tokens`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${session.value.token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ label: 'Chatterino' }),
    })
    if (res.ok) {
      const data = await res.json() as { token: string }
      uploadToken.value = data.token
    }
  } catch {}
  tokenLoading.value = false
}
</script>

<template>
  <div class="more-view">

    <!-- >>> Images card <<< -->
    <div class="service-card" @click="router.push('/images')">
      <!-- Icon -->
      <div class="card-icon images-icon">
        <svg viewBox="0 0 48 48" fill="none" xmlns="http://www.w3.org/2000/svg">
          <!-- Frame -->
          <rect x="4" y="8" width="40" height="32" rx="4" stroke="currentColor" stroke-width="2.5"/>
          <!-- Mountain -->
          <path d="M4 32L14 20L22 28L30 18L44 32" stroke="currentColor" stroke-width="2.5" stroke-linejoin="round" stroke-linecap="round"/>
          <!-- Sun -->
          <circle cx="34" cy="20" r="4" stroke="currentColor" stroke-width="2.5"/>
          <!-- Upload arrow (top-right corner overlay) -->
          <circle cx="38" cy="12" r="7" fill="#6f2bff" opacity="0.9"/>
          <path d="M38 15.5V9M35.5 11.5L38 9L40.5 11.5" stroke="white" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>
        </svg>
      </div>

      <div class="card-body">
        <div class="card-title">{{ t('more.images') }}</div>
        <div class="card-sub">{{ t('more.images.sub') }}</div>
        <div class="card-url">i.shyboti.de/<span class="url-id">id</span></div>
      </div>

      <div class="card-btns">
      <button class="your-btn" @click.stop="router.push('/images?gallery=1')">
        <svg viewBox="0 0 14 14" fill="none" xmlns="http://www.w3.org/2000/svg">
          <rect x="1" y="1" width="5" height="5" rx="0.8" stroke="currentColor" stroke-width="1.4"/>
          <rect x="8" y="1" width="5" height="5" rx="0.8" stroke="currentColor" stroke-width="1.4"/>
          <rect x="1" y="8" width="5" height="5" rx="0.8" stroke="currentColor" stroke-width="1.4"/>
          <rect x="8" y="8" width="5" height="5" rx="0.8" stroke="currentColor" stroke-width="1.4"/>
        </svg>
          {{ t('more.images.your') }}
        </button>
        <button class="chatterino-btn" @click.stop="openChatterino()">
          <svg viewBox="0 0 14 14" fill="none" xmlns="http://www.w3.org/2000/svg">
            <circle cx="7" cy="7" r="6" stroke="currentColor" stroke-width="1.4"/>
            <path d="M7 6v4M7 4.5v.5" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/>
          </svg>
          Chatterino
        </button>
      </div>
    </div>

    <!-- >>> Notes card <<< -->
    <div class="service-card" @click="router.push('/notes')">
      <!-- Icon -->
      <div class="card-icon notes-icon">
        <svg viewBox="0 0 48 48" fill="none" xmlns="http://www.w3.org/2000/svg">
          <!-- Page -->
          <rect x="8" y="4" width="28" height="36" rx="3" stroke="currentColor" stroke-width="2.5"/>
          <!-- Fold corner -->
          <path d="M28 4V14H36" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/>
          <!-- Lines -->
          <path d="M14 20h16M14 26h16M14 32h10" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"/>
          <!-- Share arrow (top-right corner overlay) -->
          <circle cx="38" cy="38" r="7" fill="#4ec9b0" opacity="0.9"/>
          <path d="M38 41V35M35.5 37.5L38 35L40.5 37.5" stroke="white" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>
        </svg>
      </div>

      <div class="card-body">
        <div class="card-title">{{ t('more.notes') }}</div>
        <div class="card-sub">{{ t('more.notes.sub') }}</div>
        <div class="card-url">n.shyboti.de/<span class="url-id">id</span></div>
      </div>

      <button class="your-btn notes-btn" @click.stop="router.push('/notes?list=1')">
        <svg viewBox="0 0 14 14" fill="none" xmlns="http://www.w3.org/2000/svg">
          <path d="M1 3.5h12M1 7h12M1 10.5h8" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/>
        </svg>
        {{ t('more.notes.your') }}
      </button>
    </div>

        <!-- OBS Browser Sources card (logged-in only) -->
    <div v-if="session" class="service-card" @click="router.push('/obs-widgets')">
      <div class="card-icon obs-icon">
        <svg viewBox="0 0 48 48" fill="none" xmlns="http://www.w3.org/2000/svg">
          <!-- Monitor -->
          <rect x="4" y="6" width="40" height="28" rx="4" stroke="currentColor" stroke-width="2.5"/>
          <!-- Stand -->
          <path d="M16 34v6M32 34v6M12 40h24" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"/>
          <!-- Live dot -->
          <circle cx="36" cy="14" r="4" fill="#f14949" opacity="0.9"/>
          <!-- Counter text lines -->
          <path d="M10 18h16M10 24h10" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" opacity="0.6"/>
        </svg>
      </div>
      <div class="card-body">
        <div class="card-title">OBS Widgets</div>
        <div class="card-sub">Live browser sources for OBS</div>
        <div class="card-url">obs.shyboti.de/<span class="url-id obs-id">id</span></div>
      </div>
      <button class="your-btn obs-btn" @click.stop="router.push('/obs-widgets')">
        <svg viewBox="0 0 14 14" fill="none" xmlns="http://www.w3.org/2000/svg">
          <rect x="1" y="1" width="12" height="9" rx="1.5" stroke="currentColor" stroke-width="1.4"/>
          <path d="M4 13h6M7 10v3" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/>
        </svg>
        Manage
      </button>
    </div>

    <!-- >>> Variables & Counters card (logged-in only) <<< -->
    <div v-if="session" class="service-card" @click="openVars">
      <div class="card-icon vars-icon">
        <svg viewBox="0 0 48 48" fill="none" xmlns="http://www.w3.org/2000/svg">
          <rect x="4" y="8" width="18" height="10" rx="2" stroke="currentColor" stroke-width="2.5"/>
          <rect x="4" y="26" width="18" height="10" rx="2" stroke="currentColor" stroke-width="2.5"/>
          <path d="M26 13h18M26 31h12" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"/>
          <path d="M40 27l4 4-4 4" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/>
        </svg>
      </div>
      <div class="card-body">
        <div class="card-title">Variables &amp; Counters</div>
        <div class="card-sub">View and edit your $counter and $var values</div>
        <div class="card-url" v-if="totalCount > 0">{{ totalCount }} entr{{ totalCount === 1 ? 'y' : 'ies' }}</div>
        <div class="card-url" v-else style="color:#444">No entries yet</div>
      </div>
    </div>

  </div>

  <!-- Variables & Counters modal -->
  <Teleport to="body">
    <div v-if="showVars" class="vars-backdrop" @click.self="showVars = false">
      <div class="vars-modal">
        <div class="vars-header">
          <span class="vars-title">Variables &amp; Counters</span>
          <button class="vars-close" @click="showVars = false">✕</button>
        </div>
        <div class="vars-tabs">
          <button class="vars-tab" :class="{ active: varsTab === 'counters' }" @click="varsTab = 'counters'">
            Counters <span v-if="counters.length">({{ counters.length }})</span>
          </button>
          <button class="vars-tab" :class="{ active: varsTab === 'vars' }" @click="varsTab = 'vars'">
            Vars <span v-if="vars.length">({{ vars.length }})</span>
          </button>
          <button class="vars-tab" :class="{ active: varsTab === 'ucounters' }" @click="varsTab = 'ucounters'">
            User Counters <span v-if="ucounters.length">({{ ucounters.length }})</span>
          </button>
          <button class="vars-tab" :class="{ active: varsTab === 'uvars' }" @click="varsTab = 'uvars'">
            User Vars <span v-if="uvars.length">({{ uvars.length }})</span>
          </button>
        </div>

        <div class="vars-body">
          <div v-if="varsLoading" class="vars-empty">Loading…</div>
          <div v-else-if="varsError" class="vars-empty" style="color:#f14949">{{ varsError }}</div>

          <!-- Counters -->
          <table v-else-if="varsTab === 'counters'" class="vars-table">
            <thead><tr><th>Name</th><th>Value</th><th></th></tr></thead>
            <tbody>
              <tr v-if="!counters.length"><td colspan="3" class="vars-empty">No counters yet</td></tr>
              <tr v-for="c in counters" :key="c.name">
                <td class="vars-name">$counter.{{ c.name }}</td>
                <td>
                  <template v-if="editingKey === 'counter:' + c.name + ':'">
                    <input class="vars-edit-input" v-model="editingVal" type="number" @keydown.enter="saveEdit('counter', c.name)" @keydown.esc="editingKey = ''" />
                    <button class="vars-btn save" @click="saveEdit('counter', c.name)" :disabled="varSaving">Save</button>
                    <button class="vars-btn" @click="editingKey = ''">Cancel</button>
                  </template>
                  <span v-else class="vars-val">{{ c.value }}</span>
                </td>
                <td style="white-space:nowrap">
                  <button v-if="editingKey !== 'counter:' + c.name + ':'" class="vars-btn" @click="startEdit('counter', c.name, c.value)">Edit</button>
                  <button class="vars-btn del" @click="deleteEntry('counter', c.name)">✕</button>
                </td>
              </tr>
            </tbody>
          </table>

          <!-- Vars -->
          <table v-else-if="varsTab === 'vars'" class="vars-table">
            <thead><tr><th>Name</th><th>Value</th><th></th></tr></thead>
            <tbody>
              <tr v-if="!vars.length"><td colspan="3" class="vars-empty">No vars yet</td></tr>
              <tr v-for="v in vars" :key="v.name">
                <td class="vars-name">$var.{{ v.name }}</td>
                <td>
                  <template v-if="editingKey === 'var:' + v.name + ':'">
                    <input class="vars-edit-input" v-model="editingVal" @keydown.enter="saveEdit('var', v.name)" @keydown.esc="editingKey = ''" />
                    <button class="vars-btn save" @click="saveEdit('var', v.name)" :disabled="varSaving">Save</button>
                    <button class="vars-btn" @click="editingKey = ''">Cancel</button>
                  </template>
                  <span v-else class="vars-val">{{ v.value || '(empty)' }}</span>
                </td>
                <td style="white-space:nowrap">
                  <button v-if="editingKey !== 'var:' + v.name + ':'" class="vars-btn" @click="startEdit('var', v.name, v.value)">Edit</button>
                  <button class="vars-btn del" @click="deleteEntry('var', v.name)">✕</button>
                </td>
              </tr>
            </tbody>
          </table>

          <!-- User Counters -->
          <table v-else-if="varsTab === 'ucounters'" class="vars-table">
            <thead><tr><th>Name</th><th>User</th><th>Value</th><th></th></tr></thead>
            <tbody>
              <tr v-if="!ucounters.length"><td colspan="4" class="vars-empty">No user counters yet</td></tr>
              <tr v-for="c in ucounters" :key="c.name + c.username">
                <td class="vars-name">$ucounter.{{ c.name }}</td>
                <td style="color:#888;font-size:11px">{{ c.username }}</td>
                <td>
                  <template v-if="editingKey === 'ucounter:' + c.name + ':' + c.username">
                    <input class="vars-edit-input" v-model="editingVal" type="number" @keydown.enter="saveEdit('ucounter', c.name, c.username)" @keydown.esc="editingKey = ''" />
                    <button class="vars-btn save" @click="saveEdit('ucounter', c.name, c.username)" :disabled="varSaving">Save</button>
                    <button class="vars-btn" @click="editingKey = ''">Cancel</button>
                  </template>
                  <span v-else class="vars-val">{{ c.value }}</span>
                </td>
                <td style="white-space:nowrap">
                  <button v-if="editingKey !== 'ucounter:' + c.name + ':' + c.username" class="vars-btn" @click="startEdit('ucounter', c.name, c.value, c.username)">Edit</button>
                  <button class="vars-btn del" @click="deleteEntry('ucounter', c.name, c.username)">✕</button>
                </td>
              </tr>
            </tbody>
          </table>

          <!-- User Vars -->
          <table v-else-if="varsTab === 'uvars'" class="vars-table">
            <thead><tr><th>Name</th><th>User</th><th>Value</th><th></th></tr></thead>
            <tbody>
              <tr v-if="!uvars.length"><td colspan="4" class="vars-empty">No user vars yet</td></tr>
              <tr v-for="v in uvars" :key="v.name + v.username">
                <td class="vars-name">$uvar.{{ v.name }}</td>
                <td style="color:#888;font-size:11px">{{ v.username }}</td>
                <td>
                  <template v-if="editingKey === 'uvar:' + v.name + ':' + v.username">
                    <input class="vars-edit-input" v-model="editingVal" @keydown.enter="saveEdit('uvar', v.name, v.username)" @keydown.esc="editingKey = ''" />
                    <button class="vars-btn save" @click="saveEdit('uvar', v.name, v.username)" :disabled="varSaving">Save</button>
                    <button class="vars-btn" @click="editingKey = ''">Cancel</button>
                  </template>
                  <span v-else class="vars-val">{{ v.value || '(empty)' }}</span>
                </td>
                <td style="white-space:nowrap">
                  <button v-if="editingKey !== 'uvar:' + v.name + ':' + v.username" class="vars-btn" @click="startEdit('uvar', v.name, v.value, v.username)">Edit</button>
                  <button class="vars-btn del" @click="deleteEntry('uvar', v.name, v.username)">✕</button>
                </td>
              </tr>
            </tbody>
          </table>
        </div>

        <div class="vars-footer">
          <template v-if="!addingType">
            <button class="vars-add-btn" @click="addingType = varsTab.replace('s','').replace('counter','counter').replace('var','var')">
              + Add {{ varsTab === 'counters' ? 'Counter' : varsTab === 'vars' ? 'Var' : varsTab === 'ucounters' ? 'User Counter' : 'User Var' }}
            </button>
          </template>
          <div v-else class="vars-add-form">
            <input class="vars-add-input" v-model="addForm.name" placeholder="name" />
            <input class="vars-add-input" v-model="addForm.value" :placeholder="addingType.includes('counter') ? '0' : 'value'" style="width:100px" />
            <input v-if="addingType.includes('u')" class="vars-add-input" v-model="addForm.username" placeholder="username" style="width:110px" />
            <button class="vars-add-submit" @click="addEntry" :disabled="varSaving || !addForm.name.trim()">Add</button>
            <button class="vars-add-cancel" @click="addingType = ''">Cancel</button>
          </div>
        </div>
      </div>
    </div>
  </Teleport>

  <!-- Chatterino popup -->
  <Teleport to="body">
    <div v-if="showChatterino" class="modal-backdrop" @click.self="showChatterino = false; showToken = false">
      <div class="modal">
        <div class="modal-header">
          <span class="modal-title">{{ t('more.chatterino.header') }}</span>
          <button class="modal-close" @click="showChatterino = false">✕</button>
        </div>

        <div class="modal-body">
          <div class="mc-row">
            <span class="mc-label">Request URL</span>
            <code class="mc-val">https://shyboti.de/api/images/upload</code>
            <button class="mc-copy" @click="copyText('https://shyboti.de/api/images/upload', 'url')">{{ copied === 'url' ? '✓' : 'copy' }}</button>
          </div>
          <div class="mc-row">
            <span class="mc-label">Form field</span>
            <code class="mc-val">file</code>
            <button class="mc-copy" @click="copyText('file', 'field')">{{ copied === 'field' ? '✓' : 'copy' }}</button>
          </div>
          <div class="mc-row">
            <span class="mc-label">Image link</span>
            <code class="mc-val">https://i.shyboti.de/{id}</code>
            <button class="mc-copy" @click="copyText('https://i.shyboti.de/{id}', 'link')">{{ copied === 'link' ? '✓' : 'copy' }}</button>
          </div>
          <div class="mc-row">
            <span class="mc-label">Deletion URL</span>
            <code class="mc-val mc-muted">(leave empty)</code>
          </div>

          <div class="mc-divider"></div>

          <div class="mc-bind-hint">{{ t('more.chatterino.bind_hint') }}</div>
          <div class="mc-row">
            <span class="mc-label">Extra headers <span class="mc-optional">optional</span></span>
            <code v-if="!session" class="mc-val mc-muted">Log in to see</code>
            <code v-else-if="tokenLoading" class="mc-val mc-muted">Generating…</code>
            <code v-else class="mc-val mc-token">{{ showToken ? 'Upload-ID: ' + uploadToken : '••••••••••••••••••••••' }}</code>
            <button v-if="session && !tokenLoading" class="mc-eye" @click="showToken = !showToken" :title="showToken ? 'Hide' : 'Show'">
              <svg v-if="!showToken" viewBox="0 0 14 14" fill="none" xmlns="http://www.w3.org/2000/svg">
                <ellipse cx="7" cy="7" rx="5.5" ry="3.5" stroke="currentColor" stroke-width="1.3"/>
                <circle cx="7" cy="7" r="1.5" fill="currentColor"/>
              </svg>
              <svg v-else viewBox="0 0 14 14" fill="none" xmlns="http://www.w3.org/2000/svg">
                <path d="M2 2l10 10M5.5 4.2A5.5 3.5 0 0 1 7 3.5c3 0 5.5 3.5 5.5 3.5s-.8 1.2-2.1 2.2M8.5 9.8A5.3 5.3 0 0 1 7 10.5c-3 0-5.5-3.5-5.5-3.5s.8-1.2 2.1-2.2" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/>
              </svg>
            </button>
            <button v-if="session && !tokenLoading" class="mc-copy" @click="copyText('Upload-ID: ' + uploadToken, 'token')">{{ copied === 'token' ? '✓' : 'copy' }}</button>
          </div>
        </div>
      </div>
    </div>
  </Teleport>
</template>

<style scoped>
.more-view {
  display: flex; flex-wrap: wrap; gap: 20px; align-content: flex-start;
}

/* >>> Service card <<< */
.service-card {
  position: relative;
  background: #1a1a1e; border: 1px solid #2a2a30;
  width: 280px; display: flex; flex-direction: column; gap: 0;
  cursor: pointer; transition: border-color .2s, transform .15s;
  overflow: hidden;
}
.service-card:hover { border-color: #3a3a44; transform: translateY(-2px); }
.service-card:active { transform: translateY(0); }

/* >>> Icon area <<< */
.card-icon {
  height: 140px; display: flex; align-items: center; justify-content: center;
  background: #111217; border-bottom: 1px solid #2a2a30;
}
.card-icon svg { width: 72px; height: 72px; }
.images-icon { color: #9d6cff; }
.notes-icon  { color: #4ec9b0; }

/* >>> Body <<< */
.card-body {
  padding: 16px 18px 10px; display: flex; flex-direction: column; gap: 5px;
}
.card-title { font-size: 18px; font-weight: 700; color: #e0e0e0; }
.card-sub   { font-size: 12px; color: #555; }
.card-url   {
  font-family: 'Consolas','Fira Mono',monospace; font-size: 11px;
  color: #444; margin-top: 4px;
}
.url-id { color: #9d6cff; }
.notes-icon ~ .card-body .url-id { color: #4ec9b0; }

/* >>> "Your files/notes" button <<< */
.your-btn {
  display: flex; align-items: center; gap: 7px;
  margin: 0 12px 14px; height: 32px; padding: 0 12px;
  border: 1px solid #9d6cff44; background: rgba(111,43,255,.06);
  color: #9d6cff; font-family: inherit; font-size: 11px; font-weight: 600;
  cursor: pointer; transition: all .15s; align-self: flex-start;
}
.your-btn:hover { background: rgba(111,43,255,.16); border-color: #9d6cff88; }
.your-btn svg { width: 13px; height: 13px; flex-shrink: 0; }
.notes-btn { border-color: #4ec9b044; color: #4ec9b0; background: rgba(78,201,176,.06); }
.notes-btn:hover { background: rgba(78,201,176,.16); border-color: #4ec9b088; }

@media (max-width: 680px) {
  .more-view { gap: 14px; }
  .service-card { width: 100%; }
}

/* >>> Button row <<< */
.card-btns {
  display: flex; align-items: center; gap: 8px;
  margin: 0 12px 14px; flex-wrap: wrap;
}
.card-btns .your-btn { margin: 0; }

/* >>> Chatterino button <<< */
.chatterino-btn {
  display: flex; align-items: center; gap: 5px;
  height: 32px; padding: 0 10px;
  border: 1px solid #2a2a30; background: transparent;
  color: #555; font-family: inherit; font-size: 10px; font-weight: 600;
  cursor: pointer; transition: all .15s;
}
.chatterino-btn:hover { border-color: #9d6cff55; color: #9d6cff; background: rgba(111,43,255,.06); }
.chatterino-btn svg { width: 11px; height: 11px; flex-shrink: 0; }

/* >>> Modal backdrop <<< */
.modal-backdrop {
  position: fixed; inset: 0; z-index: 9999;
  background: rgba(0,0,0,.6); backdrop-filter: blur(2px);
  display: flex; align-items: center; justify-content: center;
}
.modal {
  background: #141418; border: 1px solid #2a2a30;
  width: min(480px, 95vw); display: flex; flex-direction: column;
  box-shadow: 0 24px 64px rgba(0,0,0,.6);
}
.modal-header {
  display: flex; align-items: center; justify-content: space-between;
  padding: 14px 18px; border-bottom: 1px solid #1e1e24;
}
.modal-title { font-size: 13px; font-weight: 700; color: #e0e0e0; }
.modal-close {
  width: 24px; height: 24px; border: none; background: transparent;
  color: #555; font-size: 12px; cursor: pointer; transition: color .15s;
}
.modal-close:hover { color: #e0e0e0; }

.modal-body { padding: 16px 18px; display: flex; flex-direction: column; gap: 8px; }

.mc-row { display: flex; align-items: center; gap: 8px; min-height: 24px; }
.mc-label {
  font-size: 10px; color: #555; width: 100px; flex-shrink: 0;
  display: flex; align-items: center; gap: 5px;
}
.mc-optional { font-size: 9px; color: #333; background: #1a1a20; padding: 1px 5px; }
.mc-val {
  flex: 1; font-family: 'Consolas','Fira Mono',monospace; font-size: 11px;
  color: #9d6cff; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
.mc-muted { color: #3a3a44; }
.mc-token { color: #e5c07b; font-size: 10px; }
.mc-copy {
  height: 20px; padding: 0 8px; border: 1px solid #2a2a3055;
  background: transparent; color: #555; font-family: inherit; font-size: 9px;
  cursor: pointer; flex-shrink: 0; transition: all .1s; white-space: nowrap;
}
.mc-copy:hover { background: #6f2bff18; color: #9d6cff; border-color: #6f2bff44; }
.mc-eye {
  width: 22px; height: 20px; border: 1px solid #2a2a30;
  background: transparent; color: #555;
  cursor: pointer; flex-shrink: 0; transition: all .1s;
  display: flex; align-items: center; justify-content: center; padding: 0;
}
.mc-eye:hover { color: #9d6cff; border-color: #6f2bff44; }
.mc-eye svg { width: 12px; height: 12px; }
.mc-divider { height: 1px; background: #1e1e24; margin: 4px 0; }
.mc-bind-hint {
  font-size: 10px; color: #666; padding: 2px 0 4px;
}

/* OBS card icon */
.obs-icon { color: #f14949; }
.url-id.obs-id { color: #f14949; }
.obs-btn { border-color: #f1494944; color: #f14949; background: rgba(241,73,73,.06); }
.obs-btn:hover { background: rgba(241,73,73,.16); border-color: #f1494988; }

/* Variables & Counters card icon */
.vars-icon { color: #e5c07b; }

/* Variables modal */
.vars-backdrop {
  position: fixed; inset: 0; background: rgba(0,0,0,.8);
  display: flex; align-items: center; justify-content: center; z-index: 1000;
}
.vars-modal {
  background: #141418; border: 1px solid #2a2a30;
  width: min(720px, 95vw); max-height: 85vh;
  display: flex; flex-direction: column;
}
.vars-header {
  display: flex; align-items: center; justify-content: space-between;
  padding: 12px 16px; border-bottom: 1px solid #1e1e24; flex-shrink: 0;
}
.vars-title { font-size: 14px; font-weight: 700; color: #e0e0e0; }
.vars-close { background: none; border: none; color: #555; font-size: 18px; cursor: pointer; width: 28px; height: 28px; display: flex; align-items: center; justify-content: center; }
.vars-close:hover { color: #e0e0e0; }
.vars-tabs {
  display: flex; border-bottom: 1px solid #1e1e24; flex-shrink: 0;
}
.vars-tab {
  padding: 8px 16px; font-size: 11px; font-weight: 700; color: #555;
  background: none; border: none; cursor: pointer; border-bottom: 2px solid transparent;
  text-transform: uppercase; letter-spacing: .05em; transition: color .15s;
}
.vars-tab.active { color: #9d6cff; border-bottom-color: #9d6cff; }
.vars-tab:hover:not(.active) { color: #888; }
.vars-body { flex: 1; overflow-y: auto; min-height: 0; }
.vars-table { width: 100%; border-collapse: collapse; }
.vars-table th {
  text-align: left; font-size: 10px; color: #444; font-weight: 700;
  text-transform: uppercase; letter-spacing: .05em;
  padding: 8px 14px; border-bottom: 1px solid #1e1e24; background: #0d0d10;
  position: sticky; top: 0;
}
.vars-table td { padding: 6px 14px; border-bottom: 1px solid #111317; font-size: 12px; color: #ccc; }
.vars-table tr:hover td { background: #1a1a1e; }
.vars-name { font-family: 'Consolas','Fira Mono',monospace; color: #9d6cff; }
.vars-val { font-family: 'Consolas','Fira Mono',monospace; color: #e5c07b; }
.vars-edit-input {
  background: #0d0d10; border: 1px solid #6f2bff55; color: #e5c07b;
  font-family: 'Consolas','Fira Mono',monospace; font-size: 12px;
  padding: 2px 6px; width: 120px; outline: none;
}
.vars-btn {
  height: 22px; padding: 0 8px; font-size: 10px; font-family: inherit;
  border: 1px solid #2a2a30; background: transparent; color: #888; cursor: pointer;
  transition: all .1s; margin-left: 4px;
}
.vars-btn:hover { border-color: #6f2bff44; color: #9d6cff; background: #6f2bff0c; }
.vars-btn.del:hover { border-color: #f1494944; color: #f14949; background: rgba(241,73,73,.06); }
.vars-btn.save { border-color: #6f2bff44; color: #9d6cff; }
.vars-empty { padding: 32px; text-align: center; color: #444; font-size: 13px; }
.vars-footer {
  padding: 10px 14px; border-top: 1px solid #1e1e24; flex-shrink: 0;
  display: flex; gap: 8px; align-items: center; flex-wrap: wrap;
}
.vars-add-btn {
  height: 26px; padding: 0 12px; border: 1px solid #6f2bff44; background: transparent;
  color: #9d6cff; font-family: inherit; font-size: 11px; cursor: pointer;
  transition: background .1s;
}
.vars-add-btn:hover { background: #6f2bff0c; }
.vars-add-form { display: flex; gap: 6px; align-items: center; flex-wrap: wrap; }
.vars-add-input {
  height: 26px; background: #0d0d10; border: 1px solid #2a2a30; color: #e0e0e0;
  font-family: inherit; font-size: 11px; padding: 0 8px; outline: none; width: 130px;
}
.vars-add-input:focus { border-color: #6f2bff55; }
.vars-add-submit {
  height: 26px; padding: 0 12px; border: none; background: #6f2bff;
  color: #fff; font-family: inherit; font-size: 11px; font-weight: 700; cursor: pointer;
}
.vars-add-submit:disabled { opacity: .5; cursor: default; }
.vars-add-cancel { height: 26px; padding: 0 10px; border: 1px solid #2a2a30; background: transparent; color: #666; font-family: inherit; font-size: 11px; cursor: pointer; }
</style>
