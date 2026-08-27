<script setup lang="ts">
import { ref, watch, computed, nextTick, onMounted, onUnmounted } from 'vue'
import { API } from '../api'
import { useAuth } from '../auth'
import { highlightScript } from '../composables/scriptHighlight'
import { mockEval, resetMockState, seedMockState, DEFAULT_MOCK, type MockContext } from '../composables/scriptMockEval'
import { useOverlayClose } from '../composables/useOverlayClose'
import { COMMAND_FLAGS } from '../composables/commandFlags'
import EditableNameHeader from './shared/EditableNameHeader.vue'
import RefPanel from './shared/RefPanel.vue'
import { useI18n } from '../i18n'
import { iconSvg as iconSvgFor } from '../composables/icons'

export interface CustomCommand {
  name: string; response: string; rule: string; alias: string
  enabled_when: string; required_game: string
  regex1: string; regex2: string; text1: string; text2: string
  isActive: boolean | number; cooldown: number; userCooldown: number
  description: string
  arg_descs: { usage: string; desc: string }[]
  flags: string[]
}
interface Props { cmdName: string; channel: string; open: boolean; isBuiltIn?: boolean; prefix?: string }

const props = defineProps<Props>()
const emit = defineEmits<{ (e: 'close'): void; (e: 'saved', name: string): void }>()
const { session } = useAuth()
const { t } = useI18n()
const overlay = useOverlayClose()

const loading = ref(true)
const saving = ref(false)
const saved = ref(false)
const saveError = ref('')
const deleting = ref(false)
const deleteConfirm = ref(false)
const activeTab = ref<'response' | 'args' | 'flags' | 'behavior'>('response')
const dirty = ref(false)
const closeConfirmOpen = ref(false)
const missingFields = ref<string[]>([])

const form = ref<CustomCommand>({
  name: '', response: '', rule: '', alias: '', enabled_when: 'always', required_game: '',
  regex1: '', regex2: '', text1: '', text2: '', isActive: true, cooldown: 0, userCooldown: 0,
  description: '', arg_descs: [], flags: [],
})

// vvv custom command invocation flags, off by default vvv
interface CustomFlagDef { flag: string; label: string; desc: string }
const CUSTOM_FLAG_DEFS = computed<CustomFlagDef[]>(() => [
  { flag: '-s', label: t('edit.flag_s_label'), desc: t('edit.flag_s_desc') },
])
function toggleCustomFlag(flag: string) {
  const idx = form.value.flags.indexOf(flag)
  if (idx === -1) form.value.flags.push(flag)
  else form.value.flags.splice(idx, 1)
}
// ^^^ custom command invocation flags ^^^

interface ParamEntry { key: string; type: 'text' | 'regex'; value: string }
const userParams = ref<ParamEntry[]>([
  { key: 'regex1', type: 'regex', value: '' },
  { key: 'regex2', type: 'regex', value: '' },
  { key: 'text1', type: 'text', value: '' },
  { key: 'text2', type: 'text', value: '' },
])
const PARAMS = computed(() => userParams.value.map(p => `{${p.key}}`))

// vvv built-in aliases + flags reference vvv
const builtinChannelAliases = ref<string[]>([])
const builtinGlobalAliases = ref<string[]>([])
const builtinRenamedTo = ref<string | null>(null)
const newAliasName = ref('')
const aliasSaving = ref(false)
const aliasError = ref('')
const resetting = ref(false)
const resetConfirm = ref(false)

async function resetToDefault() {
  if (!session.value || !props.cmdName) return
  if (!resetConfirm.value) {
    resetConfirm.value = true
    setTimeout(() => { resetConfirm.value = false }, 3000)
    return
  }
  resetConfirm.value = false
  resetting.value = true
  saveError.value = ''
  try {
    const res = await fetch(`${API}/commands/${props.channel}/${props.cmdName}/reset`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${session.value.token}` }
    })
    if (!res.ok) {
      const data = await res.json().catch(() => ({})) as {
        error?: string
        conflicts?: { alias: string; command: string }[]
      }
      if (data.error === 'alias_conflict' && data.conflicts?.length) {
        const list = data.conflicts.map(c => `+${c.alias} (${props.prefix ?? '+'}${c.command})`).join(', ')
        saveError.value = `${t('cmd.reset_alias_conflict_prefix')} ${list}. ${t('cmd.reset_alias_conflict_suffix')}`
      } else {
        saveError.value = t('edit.rename_error')
      }
      resetting.value = false
      return
    }
    builtinRenamedTo.value = null
    form.value.name = props.cmdName
    await loadAliases()
    emit('saved', props.cmdName)
  } catch {
    saveError.value = t('edit.rename_error')
  }
  resetting.value = false
}
const builtinFlags = computed(() => props.isBuiltIn ? (COMMAND_FLAGS[props.cmdName] ?? []) : [])
// >>> alias needs a saved command to attach to
const aliasesNeedSave = computed(() => !props.isBuiltIn && !props.cmdName)

async function loadAliases() {
  if (!session.value || !props.cmdName) return
  try {
    const res = await fetch(`${API}/command-aliases/${props.channel}/${props.cmdName}`, {
      headers: { Authorization: `Bearer ${session.value.token}` }
    })
    if (res.ok) {
      const data = await res.json() as { channelAliases: string[]; globalAliases: string[] }
      builtinChannelAliases.value = data.channelAliases
      builtinGlobalAliases.value = data.globalAliases
    }
  } catch { }
}

async function addAlias() {
  if (!session.value || !props.cmdName) return
  const alias = newAliasName.value.trim().toLowerCase()
  if (!alias) return
  aliasSaving.value = true
  aliasError.value = ''
  try {
    const res = await fetch(`${API}/command-aliases/${props.channel}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.value.token}` },
      body: JSON.stringify({ alias, command: props.cmdName })
    })
    if (!res.ok) {
      const data = await res.json().catch(() => ({})) as { error?: string }
      aliasError.value = data.error ?? t('edit.alias_error')
    } else {
      newAliasName.value = ''
      await loadAliases()
      emit('saved', props.cmdName)
    }
  } catch {
    aliasError.value = t('edit.alias_error')
  }
  aliasSaving.value = false
}

async function removeAlias(alias: string) {
  if (!session.value) return
  aliasSaving.value = true
  try {
    await fetch(`${API}/command-aliases/${props.channel}/${alias}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${session.value.token}` }
    })
    await loadAliases()
    emit('saved', props.cmdName)
  } catch { }
  aliasSaving.value = false
}
// ^^^ built-in aliases + flags reference ^^^

// vvv keywords - natural-language phrases that run this command, just triggers under the hood vvv
interface KeywordTrigger { name: string; match_type: string; match_pattern: string; is_active: number }
const keywords = ref<KeywordTrigger[]>([])
const keywordSaving = ref(false)
const keywordError = ref('')
const newKeywordPattern = ref('')
const newKeywordMatchType = ref('contains')
const KEYWORD_MATCH_TYPES = computed(() => [
  { value: 'contains', label: t('match.contains') },
  { value: 'exact', label: t('match.exact') },
  { value: 'starts', label: t('match.starts') },
  { value: 'ends', label: t('match.ends') },
  { value: 'regex', label: t('match.regex') },
])
function keywordMatchLabel(v: string) {
  return KEYWORD_MATCH_TYPES.value.find((m) => m.value === v)?.label ?? v
}

async function loadKeywords() {
  if (!session.value || !props.cmdName) return
  try {
    const res = await fetch(`${API}/triggers/${props.channel}`, {
      headers: { Authorization: `Bearer ${session.value.token}` }
    })
    if (!res.ok) return
    const data = await res.json() as { triggers: KeywordTrigger[] }
    keywords.value = data.triggers.filter((tr: any) => tr.linked_command === props.cmdName)
  } catch {
    keywords.value = []
  }
}

async function addKeyword() {
  if (!session.value || !props.cmdName) return
  const pattern = newKeywordPattern.value.trim()
  if (!pattern) return
  keywordSaving.value = true
  keywordError.value = ''
  try {
    const slug = props.cmdName.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')
    const genName = `kw-${slug}-${Math.random().toString(36).slice(2, 7)}`
    const res = await fetch(`${API}/triggers/${props.channel}/${genName}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.value.token}` },
      body: JSON.stringify({
        event_type: 'message',
        match_type: newKeywordMatchType.value,
        match_pattern: pattern,
        action_type: 'run_command',
        response: props.cmdName,
        cooldown_sec: 0,
        is_active: 1,
      })
    })
    if (!res.ok) throw new Error()
    newKeywordPattern.value = ''
    await loadKeywords()
    emit('saved', props.cmdName)
  } catch {
    keywordError.value = t('edit.keyword_error')
  }
  keywordSaving.value = false
}

async function removeKeyword(name: string) {
  if (!session.value) return
  keywordSaving.value = true
  try {
    await fetch(`${API}/triggers/${props.channel}/${name}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${session.value.token}` }
    })
    await loadKeywords()
    emit('saved', props.cmdName)
  } catch { }
  keywordSaving.value = false
}
// ^^^ keywords ^^^

function addParam(type: 'text' | 'regex') {
  const prefix = type === 'regex' ? 'regex' : 'text'
  const existing = userParams.value.filter(p => p.type === type).map(p => p.key)
  let n = 1; while (existing.includes(`${prefix}${n}`)) n++
  userParams.value.push({ key: `${prefix}${n}`, type, value: '' })
}
function removeParam(key: string) {
  if (form.value.rule.includes(`{${key}}`)) return
  userParams.value = userParams.value.filter(p => p.key !== key)
}
watch(userParams, params => {
  for (const p of params) (form.value as any)[p.key] = p.value
}, { deep: true })

async function load() {
  if (!session.value) return
  builtinChannelAliases.value = []
  builtinGlobalAliases.value = []
  builtinRenamedTo.value = null
  newAliasName.value = ''
  aliasError.value = ''
  missingFields.value = []
  if (!props.cmdName) {
    form.value = {
      name: '', response: '', rule: '', alias: '', enabled_when: 'always', required_game: '',
      regex1: '', regex2: '', text1: '', text2: '', isActive: true, cooldown: 0, userCooldown: 0,
      description: '', arg_descs: [], flags: []
    }
    loading.value = false
    return
  }
  loading.value = true
  try {
    if (props.isBuiltIn) {
      // >>> built-ins load description from /commands
      const res = await fetch(`${API}/commands/${props.channel}`, {
        headers: { Authorization: `Bearer ${session.value.token}` }
      })
      if (res.ok) {
        const data = await res.json() as { commands: Array<{ name: string; description: string; renamedTo: string | null }> }
        const cmd = data.commands.find(c => c.name === props.cmdName)
        builtinRenamedTo.value = cmd?.renamedTo ?? null
        form.value = { ...form.value, name: cmd?.renamedTo || props.cmdName, description: cmd?.description ?? '' }
      }
      await loadAliases()
    } else {
      const res = await fetch(`${API}/custom-commands/${props.channel}`, {
        headers: { Authorization: `Bearer ${session.value.token}` }
      })
      if (res.ok) {
        const data = await res.json() as { commands: CustomCommand[] }
        const ex = data.commands.find(c => c.name === props.cmdName)
        form.value = ex
          ? { ...ex, isActive: !!ex.isActive, description: ex.description ?? '', arg_descs: ex.arg_descs ?? [], flags: ex.flags ?? [] }
          : {
            name: props.cmdName, response: '', rule: '', alias: '', enabled_when: 'always',
            required_game: '', regex1: '', regex2: '', text1: '', text2: '',
            isActive: true, cooldown: 0, userCooldown: 0, description: '', arg_descs: [], flags: []
          }
        userParams.value = userParams.value.map(p => ({ ...p, value: ex ? ((ex as any)[p.key] ?? '') : '' }))
      }
      await loadAliases()
    }
    await loadKeywords()
  } catch { }
  loading.value = false

  // >>> seeds preview with real counter/var values
  try {
    const vres = await fetch(`${API}/variables/${props.channel}`, {
      headers: { Authorization: `Bearer ${session.value!.token}` }
    })
    if (vres.ok) {
      const vdata = await vres.json() as {
        counters: { name: string; value: number }[]
        vars: { name: string; value: string }[]
      }
      const realCounters: Record<string, number> = {}
      const realVars: Record<string, string> = {}
      for (const c of vdata.counters) realCounters[c.name] = c.value
      for (const v of vdata.vars) realVars[v.name] = v.value
      seedMockState(realCounters, realVars)
    }
  } catch { }

  await nextTick()
  const nel = normalEditorRef.value
  if (nel) {
    const src = form.value.response || (props.isBuiltIn ? BUILTIN_PREFIX : '')
    setNormalEditorContent(nel, src)
  }
  updatePreview()
  // >>> loading populates form itself, doesn't count as an edit
  dirty.value = false
}
// >>> anything that changes what save() would persist (userParams syncs into form already)
watch(form, () => { dirty.value = true }, { deep: true })

// vvv validation vvv
interface ValidationError {
  blockIndex: number
  type: 'cond_missing' | 'cond_invalid' | 'body_missing'
  message: string
}

const validationErrors = ref<ValidationError[]>([])

function validateScript(src: string): ValidationError[] {
  const errors: ValidationError[] = []
  let idx = 0
  let pos = 0
  while (pos < src.length) {
    const ifStart = src.indexOf('$if(', pos)
    if (ifStart === -1) break
    const parenStart = src.indexOf('(', ifStart + 3)
    if (parenStart === -1) { pos = ifStart + 3; continue }
    let depth = 0, condEnd = -1
    for (let k = parenStart; k < src.length; k++) {
      if (src[k] === '(') depth++
      else if (src[k] === ')') { depth--; if (depth === 0) { condEnd = k; break } }
    }
    if (condEnd === -1) { pos = ifStart + 3; continue }
    const condSrc = src.slice(parenStart + 1, condEnd).trim()
    const afterCond = src.slice(condEnd + 1)
    const braceMatch = afterCond.match(/^\s*\{/)
    if (braceMatch) {
      const braceStart = condEnd + 1 + afterCond.indexOf('{')
      let bdepth = 0, bodyEnd = -1
      for (let k = braceStart; k < src.length; k++) {
        if (src[k] === '{') bdepth++
        else if (src[k] === '}') { bdepth--; if (bdepth === 0) { bodyEnd = k; break } }
      }
      if (bodyEnd !== -1) {
        const body = src.slice(braceStart + 1, bodyEnd).trim()
        if (condSrc === '') errors.push({ blockIndex: idx, type: 'cond_missing', message: 'Expression missing' })
        // >>> allows bare exprs, catches unedited placeholder
        else if (!/\$/.test(condSrc) && !/[=<>!]/.test(condSrc) && !/^(true|false|\d+)$/i.test(condSrc) && !/\b(and|or|not)\b/i.test(condSrc))
          errors.push({ blockIndex: idx, type: 'cond_invalid', message: `${condSrc} is not a valid expression` })
        if (body === '') errors.push({ blockIndex: idx, type: 'body_missing', message: 'Body missing' })
        pos = bodyEnd + 1
        idx++
        continue
      }
    }
    // >>> fallback for legacy/unclosed
    pos = condEnd + 1
    idx++
  }
  return errors
}

const validationMessage = computed(() => {
  const errs = validationErrors.value
  if (errs.length === 0) return ''
  return errs.map(e => e.message).join(' · ')
})
// ^^^ validation ^^^

const lineCount = ref(1)
function updateLineNumbers(text: string) {
  lineCount.value = (text.match(/\n/g) || []).length + 1
}

watch(() => props.open, v => { if (v) { load(); deleteConfirm.value = false; saveError.value = ''; activeTab.value = 'response'; closeConfirmOpen.value = false } })
onMounted(() => { if (props.open) load() })

// >>> the response tab's v-if unmounts the contenteditable - repopulate it
// >>> from form.value.response when switching back, else it renders empty
watch(activeTab, async tab => {
  if (tab !== 'response') return
  await nextTick()
  const el = normalEditorRef.value
  if (!el) return
  const src = form.value.response || (props.isBuiltIn ? BUILTIN_PREFIX : '')
  setNormalEditorContent(el, src)
  updateLineNumbers(src)
})

// vvv close confirm + shortcuts vvv
function requestClose() {
  if (dirty.value) closeConfirmOpen.value = true
  else emit('close')
}
async function saveAndClose() {
  closeConfirmOpen.value = false
  await save()
  if (!saveError.value) emit('close')
}
function discardAndClose() {
  closeConfirmOpen.value = false
  emit('close')
}
function onKeydown(e: KeyboardEvent) {
  if (!props.open) return
  const mod = e.ctrlKey || e.metaKey
  if (mod && e.key.toLowerCase() === 's') {
    e.preventDefault()
    save()
    return
  }
  if (e.key === 'Escape') {
    if (closeConfirmOpen.value) closeConfirmOpen.value = false
    else requestClose()
  }
}
onMounted(() => window.addEventListener('keydown', onKeydown))
onUnmounted(() => window.removeEventListener('keydown', onKeydown))
// ^^^ close confirm + shortcuts ^^^
// >>> unlocks aliases right after the first save of a new command, no full reload
watch(() => props.cmdName, (name, old) => { if (name && !old && props.open) { loadAliases(); loadKeywords() } })

watch(() => form.value.response, (src) => {
  if (props.isBuiltIn) return
  validationErrors.value = validateScript(src)
  updateLineNumbers(src)
  if (src?.trim()) missingFields.value = missingFields.value.filter(f => f !== 'response')
}, { immediate: false })

watch(() => form.value.name, (n) => {
  if (n?.trim()) missingFields.value = missingFields.value.filter(f => f !== 'name')
})

async function save() {
  if (!session.value) return
  const newName = form.value.name?.trim().toLowerCase().replace(/[^a-z0-9_-]/g, '')
  const missing: string[] = []
  const missingKeys: string[] = []
  if (!newName) { missing.push(t('edit.name')); missingKeys.push('name') }
  if (!props.isBuiltIn && !form.value.response?.trim()) { missing.push(t('edit.response')); missingKeys.push('response') }
  missingFields.value = missingKeys
  if (missing.length) {
    saveError.value = t('edit.missing_fields') + missing.join(', ')
    // >>> jump to the response tab so its red border is actually visible
    if (missingKeys.includes('response') && activeTab.value !== 'response') activeTab.value = 'response'
    return
  }
  saveError.value = ''
  saving.value = true
  try {
    const oldName = props.cmdName
    const isNew = !oldName
    const renamed = !props.isBuiltIn && !isNew && newName && newName !== oldName

    // >>> built-ins rename through /commands (renamedTo override), never
    // >>> through custom-commands - their own name in that table is fixed
    if (props.isBuiltIn && oldName) {
      const wantsRenameChange = newName !== oldName || !!builtinRenamedTo.value
      if (wantsRenameChange) {
        const rres = await fetch(`${API}/commands/${props.channel}/${oldName}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.value.token}` },
          body: JSON.stringify({ renamedTo: newName === oldName ? null : newName }),
        })
        if (!rres.ok) {
          const d = await rres.json().catch(() => ({})) as { error?: string }
          saveError.value = d.error ?? t('edit.rename_error')
          saving.value = false
          return
        }
        builtinRenamedTo.value = newName === oldName ? null : newName
      }
    }

    // >>> put the data under the new name
    const targetName = (renamed || isNew) ? newName : oldName
    await fetch(`${API}/custom-commands/${props.channel}/${targetName}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.value.token}` },
      body: JSON.stringify({
        ...form.value,
        name: targetName,
        ...Object.fromEntries(userParams.value.map(p => [p.key, p.value]))
      }),
    })

    // >>> if renamed, delete the old name
    if (renamed) {
      await fetch(`${API}/custom-commands/${props.channel}/${oldName}`, {
        method: 'DELETE', headers: { Authorization: `Bearer ${session.value.token}` }
      })
    }

    saved.value = true; dirty.value = false; setTimeout(() => { saved.value = false }, 2000); emit('saved', targetName)
  } catch { }
  saving.value = false
}

async function deleteCmd() {
  if (!session.value) return
  if (!deleteConfirm.value) { deleteConfirm.value = true; setTimeout(() => { deleteConfirm.value = false }, 3000); return }
  deleteConfirm.value = false
  deleting.value = true
  try {
    await fetch(`${API}/custom-commands/${props.channel}/${props.cmdName}`, {
      method: 'DELETE', headers: { Authorization: `Bearer ${session.value.token}` }
    })
    emit('saved', ''); emit('close')
  } catch { }
  deleting.value = false
}

// vvv editor vvv
const normalEditorRef = ref<HTMLDivElement | null>(null)
const previewOutput = ref('')
const mockCtx = ref<MockContext>({ ...DEFAULT_MOCK })
let _normalHighlighting = false

// >>> ghost autocomplete
const ghostSuggestion = ref('')
const ghostFull = ref('')
const ghostMatches = ref<string[]>([])
const ghostMatchIdx = ref(0)

const COMPLETIONS = [
  '$if(){ }', '$else', '$foreach()', '$repeat()', '$define',
  '$counter.', '$ucounter.', '$var.', '$uvar.', '$list.',
  '$user', '$user.name', '$user.display', '$user.mention', '$user.followage', '$user.created',
  '$user.is(mod)', '$user.is(sub)', '$user.is(vip)', '$user.is(broadcaster)',
  '$target.name', '$target.mention', '$target.id',
  '$channel.name', '$channel.title', '$channel.game', '$channel.viewers', '$channel.isLive', '$channel.uptime',
  '$command.name', '$command.uses', '$command.output',
  '$message.text', '$message.id', '$message.length',
  '$args', '$args.count', '$1', '$2', '$3',
  '$query',
  '$random.int(,)', '$random.pick(,)', '$random.chance()',
  '$time.now', '$time.unix', '$time.format(,)', '$time.ago()',
  '$text.len()', '$text.upper()', '$text.lower()', '$text.title()', '$text.trim()',
  '$text.contains(,)', '$text.starts(,)', '$text.ends(,)',
  '$text.replace(,,)', '$text.remove(,)', '$text.split(,)', '$text.join(,)',
  '$regex.match(,)', '$regex.replace(,,)',
  '$calc()',
  '$http.get()', '$http.post(,)', '$http.json(,)',
  '$twitch.followers()', '$twitch.subscribers()', '$twitch.uptime', '$twitch.game', '$twitch.title',
  '$emote.has(7tv,)', '$emote.count(7tv)',
  '$log.last()', '$log.find()',
  '$mod.delete()', '$mod.timeout(,)', '$mod.ban()', '$mod.unban()', '$mod.purge()',
  '$chat.slow()', '$chat.emoteonly()', '$chat.followers()',
  '$cooldown.set()', '$cooldown.user()',
  '$index', '$last_error',
]

function updatePreview() {
  try {
    previewOutput.value = mockEval(form.value.response, mockCtx.value)
  } catch { previewOutput.value = '[preview error]' }
}

watch(() => form.value.response, () => updatePreview(), { flush: 'post' })
watch(mockCtx, () => updatePreview(), { deep: true })

const BUILTIN_PREFIX = '$command.output'

function onNormalInput() {
  const el = normalEditorRef.value; if (!el) return
  removeGhostSpan()
  let text = el.innerText.replace(/\n$/, '')
  if (props.isBuiltIn && !text.startsWith(BUILTIN_PREFIX)) {
    text = BUILTIN_PREFIX + (text.startsWith('$command.outpu') ? text.slice(text.indexOf(BUILTIN_PREFIX.slice(-1)) + 1) : '\n' + text)
    el.innerText = text
  }
  form.value.response = text
  applyNormalHighlight(el, text)
  updateGhost(el, text)
  syncLineNumbers(el)
}

// >>> avoids stealing focus, no selection/range touched
function setNormalEditorContent(el: HTMLElement, text: string) {
  el.innerHTML = highlightScript(text)
}

function applyNormalHighlight(el: HTMLElement, text: string) {
  if (_normalHighlighting) return
  const sel = window.getSelection()
  const offset = sel?.rangeCount ? getTextOffset(el) : 0
  _normalHighlighting = true
  el.innerHTML = highlightScript(text)
  _normalHighlighting = false
  restoreTextOffset(el, offset)
}

function getTextOffset(el: HTMLElement): number {
  const sel = window.getSelection(); if (!sel?.rangeCount) return 0
  const range = sel.getRangeAt(0)
  const pre = range.cloneRange(); pre.selectNodeContents(el); pre.setEnd(range.startContainer, range.startOffset)
  let ghost = 0
  el.querySelectorAll('.ghost-inline').forEach(g => {
    if (pre.intersectsNode(g)) ghost += (g.textContent?.length ?? 0)
  })
  return Math.max(0, pre.toString().length - ghost)
}

function restoreTextOffset(el: HTMLElement, offset: number) {
  let remaining = offset, placed = false
  function walk(node: Node) {
    if (placed) return
    if (node.nodeType === Node.TEXT_NODE) {
      const len = node.textContent?.length ?? 0
      if (remaining <= len) {
        const r = document.createRange(); r.setStart(node, remaining); r.collapse(true)
        window.getSelection()?.removeAllRanges(); window.getSelection()?.addRange(r)
        placed = true; return
      }
      remaining -= len; return
    }
    for (const c of Array.from(node.childNodes)) walk(c)
  }
  walk(el)
  if (!placed) { const r = document.createRange(); r.selectNodeContents(el); r.collapse(false); window.getSelection()?.removeAllRanges(); window.getSelection()?.addRange(r) }
}

const lineNumbersRef = ref<HTMLDivElement | null>(null)

function syncLineNumbers(el: HTMLElement) {
  const lnEl = lineNumbersRef.value; if (!lnEl) return
  // >>> count lines in the raw text
  const text = form.value.response || ''
  const count = (text.match(/\n/g) || []).length + 1
  lineCount.value = count
  // >>> sync scroll position
  lnEl.scrollTop = el.scrollTop
}

// >>> keep line numbers scroll synced with editor
function onEditorScroll(e: Event) {
  const lnEl = lineNumbersRef.value; if (!lnEl) return
  lnEl.scrollTop = (e.target as HTMLElement).scrollTop
}

// >>> clear ghost if cursor moves without typing
function onEditorClick() {
  const el = normalEditorRef.value; if (!el) return
  const offset = getTextOffset(el)
  const text = form.value.response || ''
  const before = text.slice(0, offset)
  if (!before.match(/(\$[\w.]*)$/)) {
    ghostSuggestion.value = ''
    removeGhostSpan()
    ghostMatches.value = []
    ghostMatchIdx.value = 0
    _lastGhostPartial = ''
  }
}

function onEditorKeyupClearGhost(e: KeyboardEvent) {
  // >>> recheck ghost validity on nav keys
  const navKeys = ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End']
  if (!navKeys.includes(e.key)) return
  const el = normalEditorRef.value; if (!el) return
  const offset = getTextOffset(el)
  const text = form.value.response || ''
  const before = text.slice(0, offset)
  if (!before.match(/(\$[\w.]*)$/)) {
    ghostSuggestion.value = ''
    removeGhostSpan()
    ghostMatches.value = []
    ghostMatchIdx.value = 0
    _lastGhostPartial = ''
  }
}

let _lastGhostPartial = ''

function removeGhostSpan() {
  const el = normalEditorRef.value; if (!el) return
  const existing = el.querySelector('.ghost-inline')
  if (existing) existing.parentNode?.removeChild(existing)
}

function insertGhostSpan(suffix: string) {
  removeGhostSpan()
  if (!suffix) return
  const sel = window.getSelection(); if (!sel?.rangeCount) return
  const range = sel.getRangeAt(0).cloneRange()
  range.collapse(true)
  const span = document.createElement('span')
  span.className = 'ghost-inline'
  span.setAttribute('contenteditable', 'false')
  span.style.cssText = 'color:#3a3a50;pointer-events:none;user-select:none;font-family:inherit;font-size:inherit;'
  span.textContent = suffix
  range.insertNode(span)
  const r = document.createRange()
  r.setStartBefore(span)
  r.collapse(true)
  sel.removeAllRanges()
  sel.addRange(r)
}

function updateGhost(el: HTMLElement, text: string) {
  const sel = window.getSelection(); if (!sel?.rangeCount) { ghostSuggestion.value = ''; removeGhostSpan(); ghostMatches.value = []; ghostMatchIdx.value = 0; return }
  const offset = getTextOffset(el)
  const before = text.slice(0, offset)
  const m = before.match(/(\$[\w.]*)$/)
  if (!m) { ghostSuggestion.value = ''; removeGhostSpan(); ghostMatches.value = []; ghostMatchIdx.value = 0; _lastGhostPartial = ''; return }
  const partial = m[1]!
  const matches = COMPLETIONS.filter(c => c.startsWith(partial) && c !== partial)
  if (!matches.length) { ghostSuggestion.value = ''; removeGhostSpan(); ghostMatches.value = []; ghostMatchIdx.value = 0; _lastGhostPartial = ''; return }
  if (partial !== _lastGhostPartial) { ghostMatchIdx.value = 0; _lastGhostPartial = partial }
  ghostMatches.value = matches
  if (ghostMatchIdx.value >= matches.length) ghostMatchIdx.value = 0
  const match = matches[ghostMatchIdx.value]!
  const suffix = match.slice(partial.length)
  ghostSuggestion.value = suffix
  ghostFull.value = match
  nextTick(() => insertGhostSpan(suffix))
}

function acceptCurrentGhost() {
  const el = normalEditorRef.value; if (!el) return
  const offset = getTextOffset(el)
  const text = form.value.response
  const before = text.slice(0, offset)
  const after = text.slice(offset)
  const m = before.match(/(\$[\w.]*)$/)
  const partial = m?.[1] ?? ''
  const full = partial + ghostSuggestion.value
  let insert = full
  let cursorOffset = before.length - partial.length + full.length

  // >>> special case for $if, adds the braces too
  if (full.startsWith('$if(')) {
    insert = '$if(  ){ }'
    cursorOffset = before.length - partial.length + 5 // <<< cursor between parentheses
  } else if (full === '$foreach()') {
    insert = '$foreach( in ){\n  \n}'
    cursorOffset = before.length - partial.length + 9
  } else if (full === '$repeat()') {
    insert = '$repeat(){\n  \n}'
    cursorOffset = before.length - partial.length + 8
  }

  const newText = before.slice(0, before.length - partial.length) + insert + after
  form.value.response = newText
  el.innerText = newText
  applyNormalHighlight(el, newText)
  nextTick(() => restoreTextOffset(el, cursorOffset))
  ghostSuggestion.value = ''; ghostMatches.value = []; ghostMatchIdx.value = 0; _lastGhostPartial = ''
}

// >>> reuses caret-preserving helpers from ghost autocomplete
function insertRefToken(token: string) {
  const el = normalEditorRef.value; if (!el) return
  removeGhostSpan()
  el.focus()
  const text = form.value.response || ''
  const offset = getTextOffset(el)
  const newText = text.slice(0, offset) + token + text.slice(offset)
  form.value.response = newText
  el.innerText = newText
  applyNormalHighlight(el, newText)
  nextTick(() => restoreTextOffset(el, offset + token.length))
  updatePreview()
}

function onNormalKeydown(e: KeyboardEvent) {
  if (props.isBuiltIn) {
    const el = normalEditorRef.value; if (!el) return
    const offset = getTextOffset(el)
    if ((e.key === 'Backspace' && offset <= BUILTIN_PREFIX.length) ||
      (e.key === 'Delete' && offset < BUILTIN_PREFIX.length)) {
      e.preventDefault(); return
    }
  }
  if (e.key === 'ArrowRight' && ghostSuggestion.value) {
    e.preventDefault()
    acceptCurrentGhost()
    return
  }
  if (e.key === 'Tab') {
    e.preventDefault()
    const el = normalEditorRef.value; if (!el) return
    if (ghostMatches.value.length > 1 && e.shiftKey === false && ghostSuggestion.value) {
      ghostMatchIdx.value = (ghostMatchIdx.value + 1) % ghostMatches.value.length
      const partial = form.value.response.slice(0, getTextOffset(el)).match(/(\$[\w.]*)$/)?.[1] ?? ''
      const next = ghostMatches.value[ghostMatchIdx.value]!
      ghostSuggestion.value = next.slice(partial.length)
      ghostFull.value = next
      nextTick(() => insertGhostSpan(next.slice(partial.length)))
      return
    }
    if (ghostSuggestion.value) {
      acceptCurrentGhost()
    } else {
      removeGhostSpan()
      const offset = getTextOffset(el)
      const text = el.innerText.replace(/\n$/, '')
      const newText = text.slice(0, offset) + '  ' + text.slice(offset)
      form.value.response = newText
      el.innerText = newText
      applyNormalHighlight(el, newText)
      nextTick(() => restoreTextOffset(el, offset + 2))
    }
    return
  }
}

// ^^^ editor ^^^
</script>

<template>
  <Teleport to="body">
    <div v-if="open" class="ep-overlay" v-bind="overlay.handlers(requestClose)">
      <div class="ep-panel">

        <div class="ep-panel-header">
          <div>
            <div class="ep-panel-title">
              Edit
              <EditableNameHeader v-model="form.name" :orig-name="cmdName" :prefix="prefix || '+'"
                placeholder="commandname" :error="missingFields.includes('name')" />
            </div>
            <div class="ep-panel-sub">Rule builder for #{{ channel }}</div>
          </div>
          <div class="ep-panel-header-actions">
            <button v-if="isBuiltIn" class="reset-default-btn" :class="{ confirm: resetConfirm }"
              :disabled="resetting" @click="resetToDefault">
              {{ resetConfirm ? t('edit.reset_confirm') : t('edit.reset_default') }}
            </button>
            <button class="ep-panel-close" title="Close (Esc)" @click="requestClose" v-html="iconSvgFor('x')"></button>
          </div>
        </div>

        <div v-if="loading" class="ep-panel-loading">{{ t('edit.saving').replace('…', '…') || 'Loading…' }}</div>
        <div v-else class="ep-panel-body">
          <div v-if="saveError" class="ep-toast error">{{ saveError }}</div>

          <div class="ep-tabs">
            <button class="ep-tab" :class="{ active: activeTab === 'response' }"
              @click="activeTab = 'response'">{{ t('edit.tab_response') }}</button>
            <button class="ep-tab" :class="{ active: activeTab === 'args' }"
              @click="activeTab = 'args'">{{ t('edit.tab_args') }}</button>
            <button v-if="!isBuiltIn" class="ep-tab" :class="{ active: activeTab === 'flags' }"
              @click="activeTab = 'flags'">{{ t('edit.tab_flags') }}</button>
            <button class="ep-tab" :class="{ active: activeTab === 'behavior' }"
              @click="activeTab = 'behavior'">{{ t('edit.tab_behavior') }}</button>
          </div>

          <!-- vvv response tab vvv -->
          <template v-if="activeTab === 'response'">
            <div class="ep-field-group">
              <label class="ep-field-label">{{ t('edit.response') }}</label>

              <!-- >>> locked prefix for built-in commands -->
              <div v-if="isBuiltIn" class="builtin-prefix-row">
                <span class="builtin-prefix-token">$command.output <span class="builtin-prefix-lock" v-html="iconSvgFor('lock')"></span></span>
                <span class="builtin-prefix-hint">{{ t('edit.builtin_locked') }}</span>
              </div>

              <div class="editor-wrapper" :class="{ 'field-error': missingFields.includes('response') }">
                <!-- >>> scrolls in sync with editor -->
                <div class="line-numbers" ref="lineNumbersRef">
                  <div v-for="n in lineCount" :key="n" class="line-number">{{ n }}</div>
                </div>
                <div class="normal-editor-container">
                  <div ref="normalEditorRef" class="normal-editor" contenteditable="true" spellcheck="false"
                    :data-placeholder="isBuiltIn ? '$text.upper($command.output)' : 'Hello $user.mention! $if($args){ You said: $args }'"
                    @input="onNormalInput" @keydown="onNormalKeydown" @keyup="onEditorKeyupClearGhost"
                    @click="onEditorClick" @scroll="onEditorScroll" @blur="removeGhostSpan"></div>
                  <div v-if="validationMessage" class="validation-badge">
                    <span v-for="(err, idx) in validationErrors" :key="idx" class="validation-pill" :class="err.type">
                      {{ err.message }}
                    </span>
                  </div>
                </div>
              </div>

              <div class="normal-hint">{{ t('edit.tab_complete') }} &nbsp;·&nbsp; <code>$</code></div>
            </div>

            <div class="ep-field-group">
              <label class="ep-field-label">{{ t('edit.description') }}</label>
              <div v-if="isBuiltIn" class="desc-readonly">{{ form.description || '-' }}</div>
              <input v-else v-model="form.description" class="ep-field-input" :placeholder="t('edit.desc_placeholder')"
                maxlength="120" />
            </div>

            <RefPanel :title="t('edit.var_ref')" @insert="insertRefToken" />

            <details class="ep-field-group preview-details">
              <summary class="preview-summary">
                {{ t('edit.preview') }} <span class="preview-note">{{ t('edit.preview_note') }}</span>
              </summary>
              <div class="preview-body">
                <div class="preview-output">{{ previewOutput || '-' }}</div>

                <div class="mock-ctx-grid">
                  <label>user</label><input v-model="mockCtx.user" class="ep-field-input mock-input"
                    @input="mockCtx.display = mockCtx.user" />
                  <label>message</label><input v-model="mockCtx.messageText" class="ep-field-input mock-input"
                    @input="() => { const w = mockCtx.messageText.split(' '); mockCtx.args = w.slice(1).join(' '); mockCtx.argList = w.slice(1) }"
                    placeholder="message without command" />
                </div>
                <div class="mock-role-row">
                  <label class="mock-check-label"><input type="checkbox" v-model="mockCtx.isMod" /> mod</label>
                  <label class="mock-check-label"><input type="checkbox" v-model="mockCtx.isSub" /> sub</label>
                  <label class="mock-check-label"><input type="checkbox" v-model="mockCtx.isVip" /> vip</label>
                  <label class="mock-check-label"><input type="checkbox" v-model="mockCtx.isBroadcaster" />
                    broadcaster</label>
                </div>
              </div>
            </details>
          </template>
          <!-- ^^^ response tab ^^^ -->

          <!-- vvv args tab vvv -->
          <template v-if="activeTab === 'args'">
            <!-- >>> built-ins only -->
            <div v-if="isBuiltIn" class="ep-field-group">
              <label class="ep-field-label">{{ t('edit.flags') }}</label>
              <div v-if="!builtinFlags.length" class="arg-descs-empty">{{ t('edit.flags_empty') }}</div>
              <div v-else class="flags-list">
                <div v-for="f in builtinFlags" :key="f.flag" class="flags-row">
                  <span class="flags-flag">{{ f.flag }}</span>
                  <span class="flags-desc">{{ f.desc }}</span>
                </div>
              </div>
            </div>

            <!-- >>> aliases work for built-in and custom -->
            <div class="ep-field-group">
              <label class="ep-field-label">{{ t('edit.aliases') }} <span class="ep-field-hint">{{ t('edit.aliases_hint') }}</span></label>
              <div v-if="aliasesNeedSave" class="arg-descs-empty">
                {{ t('edit.aliases_save_first') }}
              </div>
              <template v-else>
                <div class="alias-add-row">
                  <input v-model="newAliasName" class="ep-field-input alias-add-input" :placeholder="t('edit.aliases_placeholder')"
                    @keydown.enter="addAlias" />
                  <button class="arg-add-btn" type="button" :disabled="aliasSaving || !newAliasName.trim()" @click="addAlias">
                    {{ t('edit.aliases_add') }}
                  </button>
                </div>
                <div v-if="!builtinChannelAliases.length && !builtinGlobalAliases.length" class="arg-descs-empty">
                  {{ t('edit.aliases_empty') }}
                </div>
                <div v-else class="alias-chip-list">
                  <span v-for="a in builtinGlobalAliases" :key="'g:' + a" class="alias-chip"
                    :class="{ locked: !isBuiltIn }" :title="isBuiltIn ? '' : t('edit.alias_global_hint')">
                    {{ prefix || '+' }}{{ a }}
                    <button v-if="isBuiltIn" class="alias-chip-remove" type="button" :disabled="aliasSaving"
                      @click="removeAlias(a)" v-html="iconSvgFor('x')"></button>
                  </span>
                  <span v-for="a in builtinChannelAliases" :key="'c:' + a" class="alias-chip">
                    {{ prefix || '+' }}{{ a }}
                    <button class="alias-chip-remove" type="button" :disabled="aliasSaving" @click="removeAlias(a)" v-html="iconSvgFor('x')"></button>
                  </span>
                </div>
                <div v-if="aliasError" class="alias-error">{{ aliasError }}</div>
              </template>
            </div>

            <!-- >>> keywords - natural phrases that run this command without the prefix -->
            <div class="ep-field-group">
              <label class="ep-field-label">{{ t('edit.keywords') }} <span class="ep-field-hint">{{ t('edit.keywords_hint') }}</span></label>
              <div v-if="aliasesNeedSave" class="arg-descs-empty">
                {{ t('edit.aliases_save_first') }}
              </div>
              <template v-else>
                <div class="alias-add-row">
                  <select v-model="newKeywordMatchType" class="ep-field-select match-type">
                    <option v-for="m in KEYWORD_MATCH_TYPES" :key="m.value" :value="m.value">{{ m.label }}</option>
                  </select>
                  <input v-model="newKeywordPattern" class="ep-field-input alias-add-input" :placeholder="t('edit.keywords_placeholder')"
                    @keydown.enter="addKeyword" />
                  <button class="arg-add-btn" type="button" :disabled="keywordSaving || !newKeywordPattern.trim()" @click="addKeyword">
                    {{ t('edit.aliases_add') }}
                  </button>
                </div>
                <div v-if="!keywords.length" class="arg-descs-empty">{{ t('edit.keywords_empty') }}</div>
                <div v-else class="alias-chip-list">
                  <span v-for="k in keywords" :key="k.name" class="alias-chip">
                    {{ keywordMatchLabel(k.match_type) }}: "{{ k.match_pattern }}"
                    <button class="alias-chip-remove" type="button" :disabled="keywordSaving" @click="removeKeyword(k.name)" v-html="iconSvgFor('x')"></button>
                  </span>
                </div>
                <div v-if="keywordError" class="alias-error">{{ keywordError }}</div>
              </template>
            </div>
          </template>
          <!-- ^^^ args tab ^^^ -->

          <!-- vvv flags tab vvv -->
          <template v-if="activeTab === 'flags' && !isBuiltIn">
            <div class="ep-field-group">
              <label class="ep-field-label">{{ t('edit.tab_flags') }} <span class="ep-field-hint">{{ t('edit.custom_flags_hint') }}</span></label>
              <div class="flags-list">
                <div v-for="f in CUSTOM_FLAG_DEFS" :key="f.flag" class="flags-row flags-row-toggle" @click="toggleCustomFlag(f.flag)">
                  <div class="ep-switch" :class="{ on: form.flags.includes(f.flag) }">
                    <div class="ep-switch-knob"></div>
                  </div>
                  <span class="flags-flag">{{ f.label }}</span>
                  <span class="flags-desc">{{ f.desc }}</span>
                </div>
              </div>
            </div>
          </template>
          <!-- ^^^ flags tab ^^^ -->

          <!-- vvv behavior tab vvv -->
          <template v-if="activeTab === 'behavior'">
            <div v-if="!isBuiltIn" class="ep-field-group">
              <label class="ep-field-label">{{ t('edit.status') }}</label>
              <div class="ep-switch-wrap" @click="form.isActive = !form.isActive">
                <div class="ep-switch" :class="{ on: form.isActive }"><span class="ep-switch-knob"></span></div>
                <span>{{ form.isActive ? t('edit.enabled') : t('edit.disabled') }}</span>
              </div>
            </div>

            <div class="ep-row-3">
              <div class="ep-field-group ep-sm">
                <label class="ep-field-label">{{ t('edit.active_when') }}</label>
                <select v-model="form.enabled_when" class="ep-field-select">
                  <option value="always">{{ t('edit.when.always') }}</option>
                  <option value="online">{{ t('edit.when.online') }}</option>
                  <option value="offline">{{ t('edit.when.offline') }}</option>
                </select>
              </div>
              <div class="ep-field-group ep-sm">
                <label class="ep-field-label">{{ t('edit.required_game') }} <span class="ep-field-hint">{{
                  t('edit.optional')
                    }}</span></label>
                <input v-model="form.required_game" class="ep-field-input" placeholder="Fortnite" />
              </div>
              <div v-if="!isBuiltIn" class="ep-field-group ep-sm">
                <label class="ep-field-label">{{ t('edit.alias') }} <span class="ep-field-hint">{{ t('edit.optional')
                }}</span></label>
                <input v-model="form.alias" class="ep-field-input" placeholder="shortname" />
              </div>
            </div>

            <div class="ep-row-3">
              <div class="ep-field-group ep-sm">
                <label class="ep-field-label">{{ t('edit.global_cd') }} <span class="ep-field-hint">{{
                  t('edit.seconds_short')
                    }}</span></label>
                <input v-model.number="form.cooldown" type="number" min="0" class="ep-field-input" />
              </div>
              <div class="ep-field-group ep-sm">
                <label class="ep-field-label">{{ t('edit.user_cd') }} <span class="ep-field-hint">{{
                  t('edit.seconds_short')
                    }}</span></label>
                <input v-model.number="form.userCooldown" type="number" min="0" class="ep-field-input" />
              </div>
            </div>
          </template>
          <!-- ^^^ behavior tab ^^^ -->

        </div>

        <!-- >>> footer pinned outside scroll -->
        <div class="ep-panel-footer">
          <button v-if="!isBuiltIn" class="ep-btn-delete" :class="{ confirm: deleteConfirm }" :disabled="deleting"
            @click="deleteCmd">
            {{ deleting ? t('edit.deleting') : deleteConfirm ? t('edit.confirm_delete') : t('edit.delete') }}
          </button>
          <div v-else></div>
          <div class="ep-footer-right">
            <button class="ep-btn-cancel" @click="requestClose">{{ t('edit.cancel') }}</button>
            <button class="ep-btn-save" :disabled="saving" @click="save">
              <template v-if="saved"><span v-html="iconSvgFor('check')"></span> {{ t('edit.saved') }}</template>
              <template v-else-if="saving">{{ t('edit.saving') }}</template>
              <template v-else>{{ t('edit.save') }}</template>
            </button>
          </div>
        </div>

      </div>

      <div v-if="closeConfirmOpen" class="ep-close-confirm-backdrop" @mousedown.self="closeConfirmOpen = false">
        <div class="ep-close-confirm">
          <div class="ep-close-confirm-title">{{ t('edit.close_confirm_title') }}</div>
          <div class="ep-close-confirm-body">{{ t('edit.close_confirm_body') }}</div>
          <div class="ep-close-confirm-actions">
            <button class="ep-btn-cancel" @click="closeConfirmOpen = false">{{ t('edit.cancel') }}</button>
            <button class="ep-btn-delete" @click="discardAndClose">{{ t('edit.discard') }}</button>
            <button class="ep-btn-save" :disabled="saving" @click="saveAndClose">
              {{ saving ? t('edit.saving') : t('edit.save_and_close') }}
            </button>
          </div>
        </div>
      </div>
    </div>
  </Teleport>
</template>

<style scoped>
.ep-panel-header-actions {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-shrink: 0;
}
.reset-default-btn {
  height: 28px;
  padding: 0 12px;
  border: 1px solid #2a2a30;
  background: transparent;
  color: #888;
  font-family: inherit;
  font-size: 11px;
  cursor: pointer;
  white-space: nowrap;
  transition: all .15s;
}
.reset-default-btn:hover:not(:disabled) {
  color: #ccc;
  border-color: #444;
}
.reset-default-btn.confirm {
  border-color: #f14949;
  background: rgba(241, 73, 73, 0.15);
  color: #f14949;
  font-weight: 700;
}
.reset-default-btn:disabled {
  opacity: .5;
  cursor: not-allowed;
}

.desc-readonly {
  font-size: 12px;
  color: #555;
  background: #0d0d10;
  border: 1px solid #1e1e22;
  padding: 7px 10px;
  font-style: italic;
}

.arg-add-btn {
  height: 24px;
  padding: 0 10px;
  border: 1px solid #6f2bff55;
  background: transparent;
  color: #9d6cff;
  font-family: inherit;
  font-size: 11px;
  cursor: pointer;
  transition: background .15s;
  flex-shrink: 0;
  white-space: nowrap;
}

.arg-add-btn:hover {
  background: #6f2bff22;
}

.arg-descs-empty {
  font-size: 11px;
  color: #444;
  font-style: italic;
  padding: 6px 0;
}

/* >>> built-in aliases + flags */
.alias-chip-list {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}

.alias-chip {
  display: flex;
  align-items: center;
  gap: 6px;
  font-family: 'Consolas', 'Fira Mono', monospace;
  font-size: 12px;
  color: #9d6cff;
  background: #6f2bff11;
  border: 1px solid #6f2bff33;
  padding: 4px 8px;
}

.alias-chip.locked {
  color: #888;
  background: #1a1a1e;
  border-color: #2a2a30;
  cursor: default;
}

.alias-chip-remove {
  border: none;
  background: none;
  color: #f14949;
  cursor: pointer;
  font-size: 10px;
  padding: 0;
  line-height: 1;
}

.alias-chip-remove:disabled {
  opacity: .5;
  cursor: default;
}

.alias-add-row {
  display: flex;
  gap: 6px;
  margin-bottom: 8px;
}

.alias-add-input {
  flex: 1;
  min-width: 0;
  max-width: 200px;
}

.alias-add-row .match-type {
  width: 120px;
  flex-shrink: 0;
  height: 32px;
}

.alias-error {
  font-size: 11px;
  color: #f14949;
  margin-top: 6px;
}

.flags-title {
  margin-top: 12px;
}

.flags-list {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.flags-row {
  display: flex;
  gap: 10px;
  align-items: baseline;
  font-size: 12px;
}

.flags-flag {
  font-family: 'Consolas', 'Fira Mono', monospace;
  color: #e5c07b;
  flex-shrink: 0;
  width: 120px;
}

.flags-desc {
  color: #888;
}

.flags-row-toggle {
  align-items: center;
  cursor: pointer;
  padding: 6px 8px;
  user-select: none;
}

.flags-row-toggle:hover {
  background: #1c1c22;
}

/* >>> built-in prefix lock */
.builtin-prefix-row {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 5px 0;
}

.builtin-prefix-token {
  font-family: 'Consolas', 'Fira Mono', monospace;
  font-size: 12px;
  color: #9d6cff;
  background: rgba(111, 43, 255, .12);
  border: 1px solid rgba(111, 43, 255, .3);
  padding: 3px 9px;
  user-select: none;
  cursor: not-allowed;
  position: relative;
}

.builtin-prefix-lock {
  font-size: 9px;
  margin-left: 5px;
  opacity: .5;
}

.builtin-prefix-hint {
  font-size: 11px;
  color: #555;
}

/* >>> line numbers + editor side by side, one border */
.editor-wrapper {
  display: flex;
  align-items: stretch;
  border: 1px solid #2a2a30;
  background: #0d0d10;
  min-height: 120px;
  resize: vertical;
  overflow: hidden;
  transition: border-color .15s;
}

.editor-wrapper:focus-within {
  border-color: #6f2bff55;
}
.editor-wrapper.field-error {
  border-color: #f14949;
}

.line-numbers {
  display: flex;
  flex-direction: column;
  min-width: 36px;
  padding: 12px 6px 12px 8px;
  background: #0a0a0d;
  border-right: 1px solid #1a1a22;
  overflow: hidden; /* >>> hides scroll bar, synced manually */
  flex-shrink: 0;
  user-select: none;
  pointer-events: none;
}

.line-number {
  font-family: 'Consolas', 'Fira Mono', monospace;
  font-size: 13px;
  line-height: 1.7; /* >>> must match .normal-editor line-height */
  color: #3a3a50;
  text-align: right;
  white-space: pre;
}

.normal-editor-container {
  position: relative;
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
}

.normal-editor {
  flex: 1;
  min-height: 120px;
  overflow-y: auto;
  padding: 12px 14px;
  font-family: 'Consolas', 'Fira Mono', monospace;
  font-size: 13px;
  line-height: 1.7;
  color: #c0c0c0;
  outline: none;
  white-space: pre-wrap;
  word-break: break-word;
  tab-size: 2;
  background: transparent;
  border: none; /* >>> border is on .editor-wrapper */
}

.normal-editor:empty::before {
  content: attr(data-placeholder);
  color: #2a2a35;
  pointer-events: none;
  white-space: pre;
}

.validation-badge {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
  padding: 4px 8px;
  border-top: 1px solid #1a1a22;
  background: #0a0a0d;
}

.validation-pill {
  font-family: 'Consolas', 'Fira Mono', monospace;
  font-size: 10px;
  font-weight: 600;
  padding: 2px 7px;
  border-radius: 3px;
  white-space: nowrap;
}

.validation-pill.cond_missing {
  color: #7ec8e3;
  background: rgba(126, 200, 227, .12);
  border: 1px solid rgba(126, 200, 227, .3);
}

.validation-pill.cond_invalid {
  color: #f9a84d;
  background: rgba(249, 168, 77, .10);
  border: 1px solid rgba(249, 168, 77, .3);
}

.validation-pill.body_missing {
  color: #4ec9b0;
  background: rgba(78, 201, 176, .10);
  border: 1px solid rgba(78, 201, 176, .3);
}

.normal-hint {
  font-size: 11px;
  color: #555;
}

.normal-hint code {
  font-family: 'Consolas', 'Fira Mono', monospace;
  color: #9d6cff;
}

/* >>> preview + mock values dropdown */
.preview-details {
  border: 1px solid #1e1e22;
}

.preview-summary {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 7px 12px;
  margin: 0;
  font-size: 10px;
  font-weight: 600;
  color: #555;
  cursor: pointer;
  user-select: none;
  list-style: none;
}

.preview-note {
  font-size: 10px;
  color: #555;
  font-weight: 400;
  text-transform: none;
  letter-spacing: 0;
}

.preview-body {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 0 12px 10px;
}

.preview-output {
  font-family: 'Consolas', 'Fira Mono', monospace;
  font-size: 12px;
  color: #4ec9b0;
  background: rgba(78, 201, 176, .06);
  border: 1px solid rgba(78, 201, 176, .2);
  padding: 8px 10px;
  min-height: 30px;
  word-break: break-all;
}

.mock-ctx-grid {
  display: grid;
  grid-template-columns: 56px 1fr;
  gap: 5px 8px;
}

.mock-ctx-grid label {
  font-size: 10px;
  color: #555;
}

.mock-input {
  font-size: 11px !important;
  padding: 4px 8px !important;
}

.mock-role-row {
  display: flex;
  flex-wrap: wrap;
  gap: 6px 10px;
}

.mock-check-label {
  display: flex;
  align-items: center;
  gap: 4px;
  font-size: 10px;
  color: #555;
  cursor: pointer;
}

.mock-check-label input {
  width: 13px;
  height: 13px;
  accent-color: #9d6cff;
}

/* >>> unsaved-changes close confirmation */
.ep-close-confirm-backdrop {
  position: fixed;
  inset: 0;
  z-index: 2100;
  background: rgba(0, 0, 0, .6);
  display: flex;
  align-items: center;
  justify-content: center;
}

.ep-close-confirm {
  width: min(380px, 92vw);
  background: #16161a;
  border: 1px solid #2a2a30;
  box-shadow: 0 12px 48px rgba(0, 0, 0, .7);
  padding: 18px;
}

.ep-close-confirm-title {
  color: #e0e0e0;
  font-weight: 700;
  font-size: 14px;
  margin-bottom: 8px;
}

.ep-close-confirm-body {
  color: #888;
  font-size: 12px;
  line-height: 1.5;
  margin-bottom: 16px;
}

.ep-close-confirm-actions {
  display: flex;
  flex-wrap: wrap;
  justify-content: flex-end;
  gap: 8px;
}

</style>

<style>
/* >>> $if coloring, unique to this editor */
.sh-if-kw {
  font-weight: 600;
}

.sh-if-cond {}

.sh-if-cond-empty {
  background: rgba(126, 200, 227, .10);
  border-radius: 2px;
  outline: 1px dashed rgba(126, 200, 227, .4);
}

.sh-if-cond-invalid {
  background: rgba(249, 168, 77, .08);
  border-radius: 2px;
  outline: 1px dashed rgba(249, 168, 77, .4);
}

.sh-if-body {}

.sh-if-body-empty {
  background: rgba(78, 201, 176, .06);
  border-radius: 2px;
  outline: 1px dashed rgba(78, 201, 176, .3);
}

.sh-if-paren {
  font-weight: 600;
}

/* >>> ghost autocomplete suffix styling */
.ghost-inline {
  color: #3a3a50;
  pointer-events: none;
  user-select: none;
}
</style>
