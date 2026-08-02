<script setup lang="ts">
import { ref, watch, computed, nextTick, onMounted, onUnmounted } from 'vue'
import { API } from '../api'
import { useAuth } from '../auth'
import { highlightScript } from '../composables/scriptHighlight'
import { mockEval, resetMockState, seedMockState, DEFAULT_MOCK, type MockContext } from '../composables/scriptMockEval'
import { useI18n } from '../i18n'

export interface CustomCommand {
  name: string; response: string; rule: string; alias: string
  enabled_when: string; required_game: string
  regex1: string; regex2: string; text1: string; text2: string
  isActive: boolean | number; cooldown: number; userCooldown: number
  description: string
  arg_descs: { usage: string; desc: string }[]
}
interface Props { cmdName: string; channel: string; open: boolean; isBuiltIn?: boolean; prefix?: string }

const props = defineProps<Props>()
const emit  = defineEmits<{ (e: 'close'): void; (e: 'saved'): void }>()
const { session } = useAuth()
const { t } = useI18n()

const loading       = ref(true)
const saving        = ref(false)
const saved         = ref(false)
const deleting      = ref(false)
const deleteConfirm = ref(false)

const form = ref<CustomCommand>({
  name: '', response: '', rule: '', alias: '', enabled_when: 'always', required_game: '',
  regex1: '', regex2: '', text1: '', text2: '', isActive: true, cooldown: 0, userCooldown: 0,
  description: '', arg_descs: [],
})

interface ParamEntry { key: string; type: 'text' | 'regex'; value: string }
const userParams = ref<ParamEntry[]>([
  { key: 'regex1', type: 'regex', value: '' },
  { key: 'regex2', type: 'regex', value: '' },
  { key: 'text1',  type: 'text',  value: '' },
  { key: 'text2',  type: 'text',  value: '' },
])
const PARAMS = computed(() => userParams.value.map(p => `{${p.key}}`))

function addParam(type: 'text' | 'regex') {
  const prefix   = type === 'regex' ? 'regex' : 'text'
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
  if (!session.value || !props.cmdName) return
  loading.value = true
  try {
    if (props.isBuiltIn) {
      // >>> For built-ins: load description from /commands/:channel
      const res = await fetch(`${API}/commands/${props.channel}`, {
        headers: { Authorization: `Bearer ${session.value.token}` }
      })
      if (res.ok) {
        const data = await res.json() as { commands: Array<{ name: string; description: string }> }
        const cmd = data.commands.find(c => c.name === props.cmdName)
        form.value = { ...form.value, name: props.cmdName, description: cmd?.description ?? '' }
      }
    } else {
      const res = await fetch(`${API}/custom-commands/${props.channel}`, {
        headers: { Authorization: `Bearer ${session.value.token}` }
      })
      if (res.ok) {
        const data = await res.json() as { commands: CustomCommand[] }
        const ex = data.commands.find(c => c.name === props.cmdName)
        form.value = ex
          ? { ...ex, isActive: !!ex.isActive, description: ex.description ?? '', arg_descs: ex.arg_descs ?? [] }
          : { name: props.cmdName, response: '', rule: '', alias: '', enabled_when: 'always',
              required_game: '', regex1: '', regex2: '', text1: '', text2: '',
              isActive: true, cooldown: 0, userCooldown: 0, description: '', arg_descs: [] }
        userParams.value = userParams.value.map(p => ({ ...p, value: ex ? ((ex as any)[p.key] ?? '') : '' }))
      }
    }
  } catch {}
  loading.value = false

  // >>> Fetch real counter/var values to seed the preview with actual state
  try {
    const vres = await fetch(`${API}/variables/${props.channel}`, {
      headers: { Authorization: `Bearer ${session.value!.token}` }
    })
    if (vres.ok) {
      const vdata = await vres.json() as {
        counters:  { name: string; value: number }[]
        vars:      { name: string; value: string }[]
      }
      const realCounters: Record<string, number> = {}
      const realVars:     Record<string, string>  = {}
      for (const c of vdata.counters) realCounters[c.name] = c.value
      for (const v of vdata.vars)     realVars[v.name]     = v.value
      seedMockState(realCounters, realVars)
    }
  } catch {}

  await nextTick()
  const nel = normalEditorRef.value
  if (nel) {
    const src = form.value.response || (props.isBuiltIn ? BUILTIN_PREFIX : '')
    nel.innerText = src
    applyNormalHighlight(nel, src)
  }
  updatePreview()
}

// --- Validation ---
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
        else if (!/\$/.test(condSrc)) errors.push({ blockIndex: idx, type: 'cond_invalid', message: `${condSrc} is not a valid expression` })
        if (body === '') errors.push({ blockIndex: idx, type: 'body_missing', message: 'Body missing' })
        pos = bodyEnd + 1
        idx++
        continue
      }
    }
    // Fallback for legacy/unclosed
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

// --- Line numbers ---
const lineCount = ref(1)
function updateLineNumbers(text: string) {
  lineCount.value = (text.match(/\n/g) || []).length + 1
}

// --- ARG VARIANT SYSTEM ---
function scanArgNums(src: string): { positional: Set<number>; hasGeneric: boolean } {
  const positional = new Set<number>()
  for (const m of src.matchAll(/\$(?:args\.)?(\d+)\b/g)) {
    const n = parseInt(m[1] || '')
    if (!isNaN(n) && n > 0) positional.add(n)
  }
  const hasGeneric = /\$(?:args|query)\b|\{args\}/i.test(src) && positional.size === 0
  return { positional, hasGeneric }
}

// Parse a single condition clause like "$1 = test" or "$channel.name = $2"
function parseCondClause(clause: string): { argNum: number; value: string } | null {
  clause = clause.trim()
  let m = clause.match(/^\$(?:args\.)?(\d+)\s*=\s*(.+)$/)
  if (m) {
    const n = parseInt(m[1] ?? '0')
    const v = (m[2] ?? '').trim()
    return n && v ? { argNum: n, value: v } : null
  }
  m = clause.match(/^(.+?)\s*=\s*\$(?:args\.)?(\d+)\s*$/)
  if (m) {
    const v = (m[1] ?? '').trim()
    const n = parseInt(m[2] ?? '0')
    return n && v ? { argNum: n, value: v } : null
  }
  return null
}

// A parsed variant: one $if block (possibly with && compound conditions)
interface VariantEntry {
  constraints: Map<number, string>  // argNum -> value (e.g. 1->"test", 2->"$channel.name")
  condStr: string                   // raw condition string inside $if(...) for reconstruction
  maxArg: number                    // highest argument number mentioned in condition or block body
  bodyHasArgs: Set<number>          // $N references found inside the $if body
}

// Extract all $if(...) ... $end blocks as VariantEntry[], plus set of bare $N references
function extractVariants(src: string): { variants: VariantEntry[]; bareArgs: Set<number> } {
  const variants: VariantEntry[] = []
  const usedInIf = new Set<number>()
  const bareArgs = new Set<number>()

  let pos = 0
  while (pos < src.length) {
    const ifStart = src.indexOf('$if(', pos)
    if (ifStart === -1) break

    let depth = 0, condEnd = -1
    for (let i = ifStart + 4; i < src.length; i++) {
      const ch = src[i]
      if (ch === '(') depth++
      else if (ch === ')') {
        if (depth === 0) { condEnd = i; break }
        depth--
      }
    }
    if (condEnd === -1) { pos = ifStart + 4; continue }

    const condStr = src.slice(ifStart + 4, condEnd).trim()
    const afterCond = src.slice(condEnd + 1)
    const braceRel  = afterCond.match(/^\s*\{/)
    let endIdx: number
    let bodyStart: number
    let bodyEnd: number

    if (braceRel) {
      const braceStart = condEnd + 1 + afterCond.indexOf('{')
      let bdepth = 0, bEnd = -1
      for (let k = braceStart; k < src.length; k++) {
        if (src[k] === '{') bdepth++
        else if (src[k] === '}') { bdepth--; if (bdepth === 0) { bEnd = k; break } }
      }
      if (bEnd === -1) { pos = condEnd + 1; continue }
      bodyStart = braceStart + 1
      bodyEnd   = bEnd
      endIdx    = bEnd
    } else {
      const legacyEnd = src.indexOf('$end', condEnd + 1)
      if (legacyEnd === -1) { pos = condEnd + 1; continue }
      bodyStart = condEnd + 1
      bodyEnd   = legacyEnd
      endIdx    = legacyEnd + 3
    }

    const clauses = condStr.split(/\s*&&?\s*/)
    const constraints = new Map<number, string>()
    for (const clause of clauses) {
      const parsed = parseCondClause(clause)
      if (parsed) {
        constraints.set(parsed.argNum, parsed.value)
        usedInIf.add(parsed.argNum)
      }
    }

    const blockBody = src.slice(bodyStart, bodyEnd)
    const bodyArgs = new Set<number>()
    for (const m of blockBody.matchAll(/\$(?:args\.)?(\d+)\b/g)) {
      const n = parseInt(m[1] || '')
      if (!isNaN(n) && n > 0) bodyArgs.add(n)
    }

    let maxArg = 0
    for (const n of constraints.keys()) maxArg = Math.max(maxArg, n)
    for (const n of bodyArgs) maxArg = Math.max(maxArg, n)

    variants.push({ constraints, condStr, maxArg, bodyHasArgs: bodyArgs })
    pos = endIdx + 1
  }

  const withoutIfs = src
    .replace(/\$if\([^)]*\)\s*\{[^}]*\}/g, '')
    .replace(/\$if\([^)]+\)[\s\S]*?\$end/g, '')
  for (const m of withoutIfs.matchAll(/\$(?:args\.)?(\d+)\b/g)) {
    const n = parseInt(m[1] || '')
    if (!isNaN(n) && n > 0 && !usedInIf.has(n)) bareArgs.add(n)
  }

  return { variants, bareArgs }
}

function buildArgDescs(
  src: string,
  existing: { usage: string; desc: string }[]
): { usage: string; desc: string }[] {
  const { positional, hasGeneric } = scanArgNums(src)
  if (positional.size === 0 && !hasGeneric) return []
  if (hasGeneric) {
    const prev = existing.find(e => e.usage === '<args>' || e.usage === '<$args>')
    return [{ usage: '<args>', desc: prev?.desc ?? '' }]
  }

  const { variants, bareArgs } = extractVariants(src)
  const result: { usage: string; desc: string }[] = []

  for (const v of variants) {
    if (v.constraints.size === 0 && v.bodyHasArgs.size === 0) continue
    const maxArg = v.maxArg
    const parts: string[] = []
    for (let n = 1; n <= maxArg; n++) {
      const val = v.constraints.get(n)
      if (val !== undefined) {
        parts.push(val.startsWith('$') ? `<${val}>` : val)
      } else {
        parts.push('<word>')
      }
    }
    const usage = parts.join(' ')
    const prev = existing.find(e => e.usage === usage)
    result.push({ usage, desc: prev?.desc ?? '' })
  }

  for (const n of [...bareArgs].sort((a, b) => a - b)) {
    const usage = '<word>'
    const prev = existing.find(e => e.usage === usage || e.usage === `${n}` || e.usage === `<arg${n}>`)
    if (!result.some(r => r.usage === usage)) {
      result.push({ usage, desc: prev?.desc ?? '' })
    }
  }

  return result
}

function removeAllIfBlocksForArg(src: string, argNum: number): string {
  let result = src
  let safety = 0
  while (safety++ < 20) {
    const ifPat = new RegExp(`\\$if\\(\\s*\\$(?:args\\.)?${argNum}\\s*(?:=[^)]*)?\\)`)
    const m = ifPat.exec(result)
    if (!m) break
    const start = m.index
    const afterCond = result.slice(start + m[0].length)
    const braceM = afterCond.match(/^\s*\{/)
    if (braceM) {
      const braceStart = start + m[0].length + afterCond.indexOf('{')
      let bdepth = 0, bEnd = -1
      for (let k = braceStart; k < result.length; k++) {
        if (result[k] === '{') bdepth++
        else if (result[k] === '}') { bdepth--; if (bdepth === 0) { bEnd = k; break } }
      }
      if (bEnd === -1) { result = result.slice(0, start) + result.slice(start + m[0].length); continue }
      result = result.slice(0, start) + result.slice(bEnd + 1)
    } else {
      const endIdx = afterCond.indexOf('$end')
      if (endIdx === -1) { result = result.slice(0, start) + result.slice(start + m[0].length) }
      else { result = result.slice(0, start) + result.slice(start + m[0].length + endIdx + 4) }
    }
  }
  return result.replace(/  +/g, ' ').trim()
}

function extractIfBlockBody(src: string, argNum: number): string {
  const ifPat = new RegExp(`\\$if\\(\\s*\\$(?:args\\.)?${argNum}\\s*(?:=[^)]*)?\\)`)
  const m = ifPat.exec(src)
  if (!m) return ''
  const after  = src.slice(m.index + m[0].length)
  const endIdx = after.indexOf('$end')
  return endIdx === -1 ? '' : after.slice(0, endIdx).trim()
}

function removeArgFromResponse(src: string, argNum: number): string {
  let r = removeAllIfBlocksForArg(src, argNum)
  r = r.replace(new RegExp(`\\$(?:args\\.)?${argNum}\\b`, 'g'), '')
  return r.replace(/  +/g, ' ').trim()
}

function parseChipToCondition(usage: string): string | null {
  const trimmed = usage.trim()
  if (!trimmed) return null

  const rawTokens = trimmed.split(/\s+/)
  const clauses: string[] = []

  rawTokens.forEach((tok, i) => {
    const argN = i + 1
    if (tok === '<word>' || tok === '') return
    const varMatch = tok.match(/^<(\$[^>]+)>$/)
    if (varMatch) { clauses.push(`$${argN} = ${varMatch[1]}`); return }
    if (/^\$?(?:args\.)?[1-9]\d*$/.test(tok)) return
    clauses.push(`$${argN} = ${tok}`)
  })

  if (clauses.length === 0) return null
  return clauses.join(' && ')
}

function replaceIfBlock(src: string, oldCondStr: string, bodyText: string, newCond: string | null): string {
  const escaped = oldCondStr.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const pat = new RegExp(`\\$if\\(\\s*${escaped}\\s*\\)([\\s\\S]*?)\\$end`)
  const m = pat.exec(src)
  if (!m) return src
  if (newCond !== null) {
    return src.slice(0, m.index) + `$if(${newCond})${m[1]}$end` + src.slice(m.index + m[0].length)
  }
  return (src.slice(0, m.index) + ' ' + bodyText + ' ' + src.slice(m.index + m[0].length)).replace(/  +/g, ' ').trim()
}

function syncResponseFromChip(chipIdx: number, newUsage: string) {
  const { variants } = extractVariants(form.value.response || '')
  let src = form.value.response || ''

  const isVariant = chipIdx < variants.length

  if (isVariant) {
    const v = variants[chipIdx]!
    const newCond = parseChipToCondition(newUsage.trim())
    if (newCond === null) {
      const firstArgNum = v.constraints.keys().next().value ?? 1
      const body = extractIfBlockBody(src, firstArgNum)
      src = replaceIfBlock(src, v.condStr, body, null)
    } else {
      src = replaceIfBlock(src, v.condStr, '', newCond)
    }
  }

  form.value.response = src
  const nel = normalEditorRef.value
  if (nel) { nel.innerText = src; applyNormalHighlight(nel, src) }
  updatePreview()
}

watch(() => props.open, v => { if (v) { load(); deleteConfirm.value = false } })
onMounted(() => { if (props.open) load() })

watch(() => form.value.response, (src) => {
  if (props.isBuiltIn) return
  form.value.arg_descs = buildArgDescs(src, form.value.arg_descs ?? [])
  validationErrors.value = validateScript(src)
  updateLineNumbers(src)
}, { immediate: false })

async function save() {
  if (!session.value) return
  saving.value = true
  try {
    const newName = form.value.name?.trim().toLowerCase().replace(/[^a-z0-9_-]/g, '')
    const oldName = props.cmdName
    const renamed = !props.isBuiltIn && newName && newName !== oldName

    // PUT the data under the new name
    const targetName = renamed ? newName : oldName
    await fetch(`${API}/custom-commands/${props.channel}/${targetName}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.value.token}` },
      body: JSON.stringify({
        ...form.value,
        name: targetName,
        ...Object.fromEntries(userParams.value.map(p => [p.key, p.value]))
      }),
    })

    // If renamed, delete the old name
    if (renamed) {
      await fetch(`${API}/custom-commands/${props.channel}/${oldName}`, {
        method: 'DELETE', headers: { Authorization: `Bearer ${session.value.token}` }
      })
    }

    saved.value = true; setTimeout(() => { saved.value = false }, 2000); emit('saved')
  } catch {}
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
    emit('saved'); emit('close')
  } catch {}
  deleting.value = false
}

// ========== NORMAL MODE EDITOR ==========
const normalEditorRef = ref<HTMLDivElement | null>(null)
const previewOutput  = ref('')
const mockCtx        = ref<MockContext>({ ...DEFAULT_MOCK })
let   _normalHighlighting = false

// Ghost autocomplete
const ghostSuggestion = ref('')
const ghostFull       = ref('')
const ghostMatches    = ref<string[]>([])
const ghostMatchIdx   = ref(0)

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

const REF_GROUPS = [
  { label: 'Control Flow', items: [
    { token: '$if(condition)', desc: 'Conditional block', example: '$if($user.is(mod))' },
    { token: '$else', desc: 'Else branch', example: '' },
    { token: '$end', desc: 'End block', example: '' },
    { token: '$foreach(item in list)', desc: 'Loop over list', example: '$foreach(q in $list.quotes)' },
    { token: '$repeat(n)', desc: 'Repeat n times', example: '$repeat(3)' },
    { token: '$define name(params)', desc: 'Define a macro', example: '$define greet(user)' },
    { token: '$index', desc: 'Current loop index (0-based)', example: '' },
  ]},
  { label: 'Counters', items: [
    { token: '$counter.name', desc: 'Increment +1, return value', example: '$counter.wins' },
    { token: '$counter.name.get', desc: 'Read without changing', example: '$counter.wins.get' },
    { token: '$counter.name.set(n)', desc: 'Set to value', example: '$counter.wins.set(10)' },
    { token: '$counter.name.add(n)', desc: 'Add value', example: '$counter.wins.add(5)' },
    { token: '$counter.name.reset', desc: 'Reset to 0', example: '$counter.wins.reset' },
    { token: '$ucounter.name', desc: 'Per-user counter', example: '$ucounter.hugs' },
  ]},
  { label: 'Variables', items: [
    { token: '$var.name', desc: 'Read variable', example: '$var.lastSong' },
    { token: '$var.name.set(value)', desc: 'Set variable', example: '$var.lastSong.set($args)' },
    { token: '$var.name.delete', desc: 'Delete variable', example: '$var.lastSong.delete' },
    { token: '$uvar.name', desc: 'Per-user variable', example: '$uvar.points' },
  ]},
  { label: 'Lists', items: [
    { token: '$list.name', desc: 'Random item from list', example: '$list.quotes' },
    { token: '$list.name.add(value)', desc: 'Add to list', example: '$list.quotes.add($args)' },
    { token: '$list.name.remove(value)', desc: 'Remove value', example: '$list.quotes.remove($args)' },
    { token: '$list.name.get(index)', desc: 'Get by index', example: '$list.quotes.get(0)' },
    { token: '$list.name.size', desc: 'Number of items', example: '$list.quotes.size' },
    { token: '$list.name.random', desc: 'Random item', example: '$list.quotes.random' },
    { token: '$list.name.clear', desc: 'Clear list', example: '$list.quotes.clear' },
  ]},
  { label: 'User', items: [
    { token: '$user.name', desc: 'Login name', example: 'coolstreamer' },
    { token: '$user.display', desc: 'Display name', example: 'CoolStreamer' },
    { token: '$user.mention', desc: '@DisplayName', example: '@CoolStreamer' },
    { token: '$user.followage', desc: 'How long following', example: '2 years, 3 months' },
    { token: '$user.is(mod)', desc: 'true/false', example: 'false' },
    { token: '$user.is(sub)', desc: 'true/false', example: 'true' },
    { token: '$user.is(vip)', desc: 'true/false', example: 'false' },
    { token: '$user.is(broadcaster)', desc: 'true/false', example: 'false' },
    { token: '$target.name', desc: 'First argument as user', example: 'coolstreamer (the @mention arg)' },
    { token: '$target.mention', desc: '@target', example: '@coolstreamer' },
  ]},
  { label: 'Channel', items: [
    { token: '$channel.name', desc: 'Channel login', example: 'mystream' },
    { token: '$channel.title', desc: 'Stream title', example: 'Playing some games!' },
    { token: '$channel.game', desc: 'Current game', example: 'Just Chatting' },
    { token: '$channel.viewers', desc: 'Viewer count', example: '42' },
    { token: '$channel.isLive', desc: 'true/false', example: 'true' },
    { token: '$channel.uptime', desc: 'Stream uptime', example: '1h 23m' },
  ]},
  { label: 'Arguments', items: [
    { token: '$args', desc: 'All arguments', example: 'hello world' },
    { token: '$args.count', desc: 'Number of args', example: '2' },
    { token: '$1 $2 $3', desc: 'Individual args', example: '$1 → hello, $2 → world' },
    { token: '$query', desc: 'Alias for $args', example: 'hello world' },
  ]},
  { label: 'Random', items: [
    { token: '$random.int(min,max)', desc: 'Random integer', example: '$random.int(1,100) → 42' },
    { token: '$random.pick(a,b,c)', desc: 'Random from list', example: '$random.pick(yes,no,maybe) → maybe' },
    { token: '$random.chance(pct)', desc: 'true with pct% chance', example: '$random.chance(30) → true' },
  ]},
  { label: 'Text', items: [
    { token: '$text.upper(text)', desc: 'Uppercase', example: '$text.upper($user.name) → COOLSTREAMER' },
    { token: '$text.lower(text)', desc: 'Lowercase', example: '$text.lower(Hello) → hello' },
    { token: '$text.replace(text,from,to)', desc: 'Replace', example: '$text.replace($args,bad,***)' },
    { token: '$text.contains(text,val)', desc: 'true/false', example: '$text.contains($args,hello) → true' },
    { token: '$text.len(text)', desc: 'String length', example: '$text.len($args) → 11' },
    { token: '$text.trim(text)', desc: 'Trim whitespace', example: '$text.trim( hello ) → hello' },
    { token: '$calc(expr)', desc: 'Math expression', example: '$calc(2 + 3) → 5' },
  ]},
  { label: 'Time', items: [
    { token: '$time.now', desc: 'Current ISO timestamp', example: '2025-01-01T12:00:00Z' },
    { token: '$time.unix', desc: 'Unix timestamp (seconds)', example: '1735732800' },
    { token: '$time.ago(ts)', desc: 'Human time since ts', example: '$time.ago($var.lastSeen) → 3 hours ago' },
    { token: '$time.format(ts,fmt)', desc: 'Format timestamp', example: '$time.format($time.now,HH:mm) → 12:00' },
  ]},
  { label: 'HTTP', items: [
    { token: '$http.get(url)', desc: 'GET request, returns text', example: '$http.get(https://api.example.com/joke)' },
    { token: '$http.post(url,body)', desc: 'POST request', example: '$http.post(https://api.example.com/log,$args)' },
    { token: '$http.json(url,path)', desc: 'GET + extract JSON path', example: '$http.json(https://api.example.com/data,$.name)' },
  ]},
  { label: 'Twitch', items: [
    { token: '$twitch.uptime', desc: 'Stream uptime', example: '1h 23m' },
    { token: '$twitch.game', desc: 'Current game', example: 'Just Chatting' },
    { token: '$twitch.title', desc: 'Stream title', example: 'Playing games!' },
    { token: '$twitch.followers(user)', desc: 'Follower count', example: '$twitch.followers($user.name) → 1234' },
  ]},
  { label: 'Emotes', items: [
    { token: '$emote.has(7tv,code)', desc: 'Check if emote exists', example: '$emote.has(7tv,KEKW) → true' },
    { token: '$emote.count(7tv)', desc: 'Count emotes', example: '42' },
  ]},
  { label: 'Command', items: [
    { token: '$command.output', desc: 'Built-in command output', example: 'Now playing: Never Gonna Give You Up' },
    { token: '$command.uses', desc: 'Times command was used', example: '17' },
    { token: '$command.name', desc: 'Command name', example: '!song' },
  ]},
  { label: 'Moderation', items: [
    { token: '$mod.timeout(user,seconds)', desc: 'Timeout user', example: '$mod.timeout($target.name,60)' },
    { token: '$mod.ban(user)', desc: 'Ban user', example: '$mod.ban($target.name)' },
    { token: '$mod.delete(msg_id)', desc: 'Delete message', example: '$mod.delete($message.id)' },
    { token: '$mod.purge(user)', desc: 'Purge user messages', example: '$mod.purge($target.name)' },
  ]},
]

function renderRefToken(token: string): string {
  let result = token
  const namePrefixes = ['$counter.', '$ucounter.', '$var.', '$uvar.', '$list.']
  for (const prefix of namePrefixes) {
    if (result.startsWith(prefix)) {
      const rest = result.slice(prefix.length)
      const m = rest.match(/^(\w+)(.*)/s)
      if (m) {
        result = prefix + `<span class="ref-token-name">${m[1]}</span>` + (m[2] ?? '')
      }
      break
    }
  }
  result = result.replace(/\(([^)]+)\)/g, (_, inner: string) => {
    const colored = inner.split(',').map(part => {
      const trimmed = part.trim()
      if (/^[a-zA-Z_]\w*$/.test(trimmed)) {
        return `<span class="ref-token-name">${trimmed}</span>`
      }
      return part
    }).join(',')
    return `(${colored})`
  })
  return result
}

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

// ── Line numbers ──────────────────────────────────────────────────────────────
const lineNumbersRef = ref<HTMLDivElement | null>(null)

function syncLineNumbers(el: HTMLElement) {
  const lnEl = lineNumbersRef.value; if (!lnEl) return
  // count lines in the raw text
  const text   = form.value.response || ''
  const count  = (text.match(/\n/g) || []).length + 1
  lineCount.value = count
  // sync scroll position
  lnEl.scrollTop = el.scrollTop
}

// Keep line numbers scroll in sync when editor scrolls
function onEditorScroll(e: Event) {
  const lnEl = lineNumbersRef.value; if (!lnEl) return
  lnEl.scrollTop = (e.target as HTMLElement).scrollTop
}

// Clear ghost when cursor moves without typing (click, arrow keys, etc.)
function onEditorClick() {
  const el = normalEditorRef.value; if (!el) return
  const offset = getTextOffset(el)
  const text   = form.value.response || ''
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
  // On any non-autocomplete navigation key, re-check if ghost is still valid
  const navKeys = ['ArrowLeft','ArrowRight','ArrowUp','ArrowDown','Home','End']
  if (!navKeys.includes(e.key)) return
  const el = normalEditorRef.value; if (!el) return
  const offset = getTextOffset(el)
  const text   = form.value.response || ''
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
  const offset  = getTextOffset(el)
  const text    = form.value.response
  const before  = text.slice(0, offset)
  const after   = text.slice(offset)
  const m       = before.match(/(\$[\w.]*)$/)
  const partial = m?.[1] ?? ''
  const full    = partial + ghostSuggestion.value
  let insert = full
  let cursorOffset = before.length - partial.length + full.length

  // Special handling for $if -> $if(  ){ }
  if (full.startsWith('$if(')) {
    insert = '$if(  ){ }'
    cursorOffset = before.length - partial.length + 5 // cursor between parentheses
  } else if (full === '$foreach()') {
    insert = '$foreach( in )\n  \n$end'
    cursorOffset = before.length - partial.length + 9
  } else if (full === '$repeat()') {
    insert = '$repeat()\n  \n$end'
    cursorOffset = before.length - partial.length + 8
  }

  const newText = before.slice(0, before.length - partial.length) + insert + after
  form.value.response = newText
  el.innerText = newText
  applyNormalHighlight(el, newText)
  nextTick(() => restoreTextOffset(el, cursorOffset))
  ghostSuggestion.value = ''; ghostMatches.value = []; ghostMatchIdx.value = 0; _lastGhostPartial = ''
}

function onNormalKeydown(e: KeyboardEvent) {
  if (props.isBuiltIn) {
    const el = normalEditorRef.value; if (!el) return
    const offset = getTextOffset(el)
    if ((e.key === 'Backspace' && offset <= BUILTIN_PREFIX.length) ||
        (e.key === 'Delete'    && offset < BUILTIN_PREFIX.length)) {
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
      const text   = el.innerText.replace(/\n$/, '')
      const newText = text.slice(0, offset) + '  ' + text.slice(offset)
      form.value.response = newText
      el.innerText = newText
      applyNormalHighlight(el, newText)
      nextTick(() => restoreTextOffset(el, offset + 2))
    }
    return
  }
}

function addArgVariant() {
  const { positional } = scanArgNums(form.value.response || '')
  const next = positional.size > 0 ? Math.max(...positional) + 1 : 1
  const snippet = ' $' + next
  form.value.response = (form.value.response || '').trimEnd() + snippet
  const nel = normalEditorRef.value
  if (nel) { nel.innerText = form.value.response; applyNormalHighlight(nel, form.value.response) }
  updatePreview()
}

function removeArgVariant(i: number) {
  const descs = form.value.arg_descs ?? []
  const { positional } = scanArgNums(form.value.response || '')
  const sorted = [...positional].sort((a, b) => a - b)
  const argNum = sorted[i]
  if (argNum) {
    const cleaned = removeArgFromResponse(form.value.response || '', argNum)
    form.value.response = cleaned
    const nel = normalEditorRef.value
    if (nel) { nel.innerText = cleaned; applyNormalHighlight(nel, cleaned) }
    updatePreview()
    form.value.arg_descs = buildArgDescs(cleaned, descs.filter((_, idx) => idx !== i))
  } else {
    const d = [...descs]
    d.splice(i, 1)
    form.value.arg_descs = d
  }
}
</script>

<template>
  <Teleport to="body">
    <div v-if="open" class="panel-overlay" @click.self="emit('close')">
      <div class="panel">

        <div class="panel-header">
          <div>
            <div class="panel-title">Edit <span class="panel-cmd">+{{ cmdName }}</span></div>
            <div class="panel-sub">Rule builder for #{{ channel }}</div>
          </div>
          <button class="panel-close" @click="emit('close')">✕</button>
        </div>

        <div v-if="loading" class="panel-loading">{{ t('edit.saving').replace('…','…') || 'Loading…' }}</div>
        <div v-else class="panel-body">

          <!--  Response / Script editor  -->
          <div class="field-group">
            <label class="field-label">
              {{ t('edit.response') }}
              <span class="field-hint">{{ t('edit.response_hint') }}</span>
            </label>

            <!-- locked $command.output prefix for built-in commands -->
            <div v-if="isBuiltIn" class="builtin-prefix-row">
              <span class="builtin-prefix-token">$command.output</span>
              <span class="builtin-prefix-hint">{{ t('edit.builtin_locked') }}</span>
            </div>

            <div class="editor-wrapper">
              <!-- Line numbers gutter (scrolls in sync with editor) -->
              <div class="line-numbers" ref="lineNumbersRef">
                <div v-for="n in lineCount" :key="n" class="line-number">{{ n }}</div>
              </div>
              <!-- Editor + validation badge -->
              <div class="normal-editor-container">
                <div
                  ref="normalEditorRef"
                  class="normal-editor"
                  contenteditable="true"
                  spellcheck="false"
                  :data-placeholder="isBuiltIn ? '$text.upper($command.output)' : 'Hello $user.mention! $if($args){ You said: $args }'"
                  @input="onNormalInput"
                  @keydown="onNormalKeydown"
                  @keyup="onEditorKeyupClearGhost"
                  @click="onEditorClick"
                  @scroll="onEditorScroll"
                  @blur="removeGhostSpan"
                ></div>
                <!-- Validation error badge -->
                <div v-if="validationMessage" class="validation-badge">
                  <span v-for="(err, idx) in validationErrors" :key="idx" class="validation-pill"
                    :class="err.type">
                    {{ err.message }}
                  </span>
                </div>
              </div>
            </div>

            <div class="normal-hint">{{ t('edit.tab_complete') }} &nbsp;·&nbsp; <code>$</code></div>

            <!-- Preview -->
            <div class="preview-section">
              <div class="preview-label">{{ t('edit.preview') }} <span class="preview-note">{{ t('edit.preview_note') }}</span></div>
              <div class="preview-output">{{ previewOutput || '-' }}</div>
            </div>

            <!-- Mock values -->
            <details class="mock-ctx-details">
              <summary class="mock-ctx-summary">{{ t('edit.mock_values') }}</summary>
              <div class="mock-ctx-body">
                <div class="mock-ctx-grid">
                  <label>user</label><input v-model="mockCtx.user" class="field-input mock-input" @input="mockCtx.display = mockCtx.user" />
                  <label>message</label><input v-model="mockCtx.messageText" class="field-input mock-input" @input="() => { const w = mockCtx.messageText.split(' '); mockCtx.args = w.slice(1).join(' '); mockCtx.argList = w.slice(1) }" placeholder="message without command" />
                </div>
                <div class="mock-role-row">
                  <span class="mock-role-hint">Role:</span>
                  <label class="mock-check-label"><input type="checkbox" v-model="mockCtx.isMod" /> mod</label>
                  <label class="mock-check-label"><input type="checkbox" v-model="mockCtx.isSub" /> sub</label>
                  <label class="mock-check-label"><input type="checkbox" v-model="mockCtx.isVip" /> vip</label>
                  <label class="mock-check-label"><input type="checkbox" v-model="mockCtx.isBroadcaster" /> broadcaster</label>
                </div>
              </div>
            </details>

            <!-- Variable reference -->
            <details class="ref-panel">
              <summary class="ref-summary">{{ t('edit.var_ref') }}</summary>
              <div class="ref-content">
                <div class="ref-group" v-for="g in REF_GROUPS" :key="g.label">
                  <div class="ref-group-label">{{ g.label }}</div>
                  <div class="ref-row" v-for="r in g.items" :key="r.token" :class="{ 'has-example': !!r.example }">
                    <code class="ref-token" v-html="renderRefToken(r.token)"></code>
                    <span class="ref-desc">{{ r.desc }}</span>
                    <span v-if="r.example" class="ref-example">{{ r.example }}</span>
                  </div>
                </div>
              </div>
            </details>
          </div>

          <!-- Name field with rename support -->
          <div v-if="!isBuiltIn" class="field-group">
            <label class="field-label">Command name
              <span class="field-hint">Rename by changing this - saves with new name</span>
            </label>
            <div class="name-input-wrap">
              <span class="name-prefix">{{ prefix || '+' }}</span>
              <input v-model="form.name" class="field-input name-input" placeholder="commandname" />
            </div>
          </div>

          <!-- Description field -->
          <div class="field-group">
            <label class="field-label">
              {{ t('edit.description') }}
              <span v-if="isBuiltIn" class="field-hint">{{ t('edit.desc_hint_builtin') }}</span>
              <span v-else class="field-hint">{{ t('edit.desc_hint_custom') }}</span>
            </label>
            <div v-if="isBuiltIn" class="desc-readonly">{{ form.description || '-' }}</div>
            <input
              v-else
              v-model="form.description"
              class="field-input"
              :placeholder="t('edit.desc_placeholder')"
              maxlength="120"
            />
          </div>

          <!-- Arg variants editor (custom commands only) -->
          <div v-if="!isBuiltIn" class="field-group">
            <div class="arg-descs-header">
              <label class="field-label">Argument Variants
                <span class="field-hint">Auto-detected from response - edit chips to update the response</span>
              </label>
              <button class="arg-add-btn" @click="addArgVariant" type="button">+ Arg</button>
            </div>
            <div v-if="!form.arg_descs?.length" class="arg-descs-empty">
              No variants detected. Use <code class="hint-code">$if($1 = value)</code>, <code class="hint-code">$1</code>, <code class="hint-code">$args</code> in the response.
            </div>
            <div class="arg-descs-list">
              <div v-for="(v, i) in form.arg_descs" :key="i" class="arg-desc-row">
                <span class="arg-desc-prefix">{{ prefix || '+' }}{{ form.name }}</span>
                <input
                  :value="form.arg_descs[i]?.usage ?? ''"
                  class="field-input arg-usage-input"
                  placeholder="<value>"
                  @change="(e) => { const val = (e.target as HTMLInputElement).value; if (form.arg_descs[i]) { form.arg_descs[i].usage = val; syncResponseFromChip(i, val) } }"
                />
                <input
                  :value="form.arg_descs[i]?.desc ?? ''"
                  class="field-input arg-desc-input"
                  placeholder="What this variant does…"
                  @change="(e) => { if (form.arg_descs[i]) form.arg_descs[i].desc = (e.target as HTMLInputElement).value }"
                />
                <button class="arg-remove-btn" @click="removeArgVariant(i)" type="button">✕</button>
              </div>
            </div>
          </div>

          <div class="cond-row">
            <div class="field-group sm">
              <label class="field-label">{{ t('edit.active_when') }}</label>
              <select v-model="form.enabled_when" class="field-select">
                <option value="always">{{ t('edit.when.always') }}</option>
                <option value="online">{{ t('edit.when.online') }}</option>
                <option value="offline">{{ t('edit.when.offline') }}</option>
              </select>
            </div>
            <div class="field-group sm">
              <label class="field-label">{{ t('edit.required_game') }} <span class="field-hint">{{ t('edit.optional') }}</span></label>
              <input v-model="form.required_game" class="field-input" placeholder="Fortnite" />
            </div>
            <div class="field-group sm">
              <label class="field-label">{{ t('edit.alias') }} <span class="field-hint">{{ t('edit.optional') }}</span></label>
              <input v-model="form.alias" class="field-input" placeholder="shortname" />
            </div>
          </div>

          <div class="cond-row">
            <div class="field-group sm">
              <label class="field-label">{{ t('edit.global_cd') }} <span class="field-hint">{{ t('edit.seconds_short') }}</span></label>
              <input v-model.number="form.cooldown" type="number" min="0" class="field-input" />
            </div>
            <div class="field-group sm">
              <label class="field-label">{{ t('edit.user_cd') }} <span class="field-hint">{{ t('edit.seconds_short') }}</span></label>
              <input v-model.number="form.userCooldown" type="number" min="0" class="field-input" />
            </div>
          </div>

        </div>

        <!-- Footer pinned outside scroll area -->
        <div class="panel-footer">
          <button v-if="!isBuiltIn" class="btn-delete" :class="{ confirm: deleteConfirm }" :disabled="deleting" @click="deleteCmd">
            {{ deleting ? t('edit.deleting') : deleteConfirm ? t('edit.confirm_delete') : t('edit.delete') }}
          </button>
          <div v-else></div>
          <div class="footer-right">
            <button class="btn-cancel" @click="emit('close')">{{ t('edit.cancel') }}</button>
            <button class="btn-save"
              :disabled="saving"
              @click="save"
            >{{ saved ? t('edit.saved') : saving ? t('edit.saving') : t('edit.save') }}</button>
          </div>
        </div>

      </div>
    </div>
  </Teleport>
</template>

<style scoped>
.panel-overlay { position: fixed; inset: 0; background: rgba(0,0,0,.65); display: flex; align-items: flex-start; justify-content: flex-end; z-index: 1000; }
.panel { width: 720px; max-width: 100vw; height: 100vh; background: #1a1a1e; border-left: 1px solid #2a2a30; display: flex; flex-direction: column; overflow: hidden; animation: slideIn .2s ease; }
@keyframes slideIn { from { transform: translateX(40px); opacity: 0 } to { transform: none; opacity: 1 } }
.panel-header { display: flex; align-items: flex-start; justify-content: space-between; padding: 20px 24px 16px; border-bottom: 1px solid #222; flex-shrink: 0; }
.panel-title { font-size: 16px; font-weight: 700; color: #e0e0e0; }
.panel-cmd   { color: #9d6cff; }
.panel-sub   { font-size: 11px; color: #555; margin-top: 3px; }
.panel-close { width: 28px; height: 28px; border: none; background: transparent; color: #555; font-size: 14px; cursor: pointer; flex-shrink: 0; display: flex; align-items: center; justify-content: center; }
.panel-close:hover { color: #e0e0e0; }
.panel-loading { padding: 40px; text-align: center; color: #555; font-size: 13px; }
.panel-body { flex: 1; overflow-y: scroll; padding: 20px 24px; display: flex; flex-direction: column; gap: 16px; scrollbar-width: none; }
.panel-body::-webkit-scrollbar { display: none; }

.field-group { display: flex; flex-direction: column; gap: 5px; }
.field-group.sm { flex: 1; min-width: 0; }
.field-label { font-size: 11px; font-weight: 600; color: #888; text-transform: uppercase; letter-spacing: .05em; display: flex; align-items: center; gap: 6px; }
.field-hint  { font-size: 10px; color: #555; font-weight: 400; text-transform: none; letter-spacing: 0; }
.hint-code   { font-family: 'Consolas','Fira Mono',monospace; color: #4ec9b0; font-style: normal; font-size: 10px; background: rgba(78,201,176,.1); padding: 1px 4px; border-radius: 2px; }
.field-input, .field-textarea, .field-select { background: #111217; border: 1px solid #2a2a30; color: #e0e0e0; font-family: inherit; font-size: 13px; padding: 7px 10px; outline: none; transition: border-color .15s; }
.field-input:focus, .field-textarea:focus, .field-select:focus { border-color: #6f2bff55; }
.field-textarea { resize: vertical; min-height: 52px; }
.field-select   { appearance: none; cursor: pointer; }

.cond-row { display: flex; gap: 10px; }
.panel-footer { display: flex; align-items: center; justify-content: space-between; padding: 12px 24px; border-top: 1px solid #222; flex-shrink: 0; background: #1a1a1e; }
.footer-right { display: flex; gap: 8px; }
.btn-save { height: 34px; padding: 0 20px; border: none; background: #6f2bff; color: #fff; font-family: inherit; font-size: 12px; font-weight: 600; cursor: pointer; transition: background .15s; }
.btn-save:hover:not(:disabled) { background: #7f3fff; }
.btn-save:disabled { opacity: .4; cursor: not-allowed; }
.btn-save.saved   { background: #1a3d2a; color: #23d18b; }
.btn-cancel { height: 34px; padding: 0 16px; border: 1px solid #333; background: transparent; color: #888; font-family: inherit; font-size: 12px; cursor: pointer; }
.btn-cancel:hover { border-color: #555; color: #e0e0e0; }
.btn-delete { height: 34px; padding: 0 14px; border: 1px solid #f1494944; background: transparent; color: #f14949; font-family: inherit; font-size: 12px; cursor: pointer; transition: background .15s, border-color .15s; }
.btn-delete:hover:not(:disabled) { background: #f1494911; }
.btn-delete:disabled { opacity: .4; cursor: not-allowed; }
.btn-delete.confirm { border-color: #f14949aa; background: #f1494922; font-weight: 700; }
.desc-readonly { font-size: 12px; color: #555; background: #0d0d10; border: 1px solid #1e1e22; padding: 7px 10px; font-style: italic; }

.name-input-wrap { display: flex; align-items: center; border: 1px solid #2a2a30; background: #0d0d10; }
.name-prefix { padding: 0 6px 0 10px; color: #9d6cff; font-weight: 700; font-size: 13px; flex-shrink: 0; }
.name-input  { border: none !important; background: transparent !important; flex: 1; padding-left: 0 !important; }

/* Arg variants editor */
.arg-descs-header { display: flex; align-items: center; justify-content: space-between; margin-bottom: 6px; }
.arg-add-btn {
  height: 24px; padding: 0 10px; border: 1px solid #6f2bff55;
  background: transparent; color: #9d6cff; font-family: inherit; font-size: 11px;
  cursor: pointer; transition: background .15s;
}
.arg-add-btn:hover { background: #6f2bff22; }
.arg-descs-empty { font-size: 11px; color: #444; font-style: italic; padding: 6px 0; }
.arg-descs-list { display: flex; flex-direction: column; gap: 5px; }
.arg-desc-row {
  display: flex; align-items: center; gap: 6px;
}
.arg-desc-prefix {
  font-family: 'Consolas','Fira Mono',monospace; font-size: 12px;
  color: #9d6cff; font-weight: 700; flex-shrink: 0; white-space: nowrap;
}
.arg-usage-input { width: 160px; flex-shrink: 0; font-family: 'Consolas','Fira Mono',monospace !important; color: #e5c07b !important; }
.arg-desc-input  { flex: 1; min-width: 0; }
.arg-remove-btn {
  width: 24px; height: 24px; flex-shrink: 0; border: 1px solid #f1494933;
  background: transparent; color: #f14949; font-size: 11px; cursor: pointer;
  display: flex; align-items: center; justify-content: center;
}
.arg-remove-btn:hover { background: #f1494911; }

/*  Built-in prefix lock  */
.builtin-prefix-row { display: flex; align-items: center; gap: 8px; padding: 5px 0; }
.builtin-prefix-token {
  font-family: 'Consolas','Fira Mono',monospace; font-size: 12px;
  color: #9d6cff; background: rgba(111,43,255,.12);
  border: 1px solid rgba(111,43,255,.3); padding: 3px 9px;
  user-select: none; cursor: not-allowed;
  position: relative;
}
.builtin-prefix-token::after { content: '🔒'; font-size: 9px; margin-left: 5px; opacity: .5; }
.builtin-prefix-hint { font-size: 10px; color: #383838; }

/*  Normal Mode editor  */
/* editor-wrapper: line numbers + editor side by side, sharing one border */
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
.editor-wrapper:focus-within { border-color: #6f2bff55; }

/* Line numbers gutter */
.line-numbers {
  display: flex;
  flex-direction: column;
  min-width: 36px;
  padding: 12px 6px 12px 8px;
  background: #0a0a0d;
  border-right: 1px solid #1a1a22;
  overflow: hidden;          /* hides scroll bar, synced manually */
  flex-shrink: 0;
  user-select: none;
  pointer-events: none;
}
.line-number {
  font-family: 'Consolas','Fira Mono',monospace;
  font-size: 13px;
  line-height: 1.7;          /* must match .normal-editor line-height */
  color: #3a3a50;
  text-align: right;
  white-space: pre;
}

/* Editor area inside wrapper */
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
  font-family: 'Consolas','Fira Mono',monospace;
  font-size: 13px;
  line-height: 1.7;
  color: #c0c0c0;
  outline: none;
  white-space: pre-wrap;
  word-break: break-word;
  tab-size: 2;
  background: transparent;
  border: none;              /* border is on .editor-wrapper */
}
.normal-editor:empty::before {
  content: attr(data-placeholder);
  color: #2a2a35;
  pointer-events: none;
  white-space: pre;
}

/* Validation badge - sits below the editor, inside editor-container */
.validation-badge {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
  padding: 4px 8px;
  border-top: 1px solid #1a1a22;
  background: #0a0a0d;
}
.validation-pill {
  font-family: 'Consolas','Fira Mono',monospace;
  font-size: 10px;
  font-weight: 600;
  padding: 2px 7px;
  border-radius: 3px;
  white-space: nowrap;
}
.validation-pill.cond_missing  { color: #7ec8e3; background: rgba(126,200,227,.12); border: 1px solid rgba(126,200,227,.3); }
.validation-pill.cond_invalid  { color: #f9a84d; background: rgba(249,168,77,.10);  border: 1px solid rgba(249,168,77,.3);  }
.validation-pill.body_missing  { color: #4ec9b0; background: rgba(78,201,176,.10);  border: 1px solid rgba(78,201,176,.3);  }

.ghost-overlay { display: none; }
.normal-hint { font-size: 10px; color: #383838; }
.normal-hint code { font-family: 'Consolas','Fira Mono',monospace; color: #9d6cff; }

/*  Preview  */
.preview-section { display: flex; flex-direction: column; gap: 4px; }
.preview-label { font-size: 10px; font-weight: 600; color: #555; text-transform: uppercase; letter-spacing: .05em; display: flex; align-items: center; gap: 6px; }
.preview-note { font-size: 9px; color: #333; font-weight: 400; text-transform: none; letter-spacing: 0; }
.preview-output {
  font-family: 'Consolas','Fira Mono',monospace; font-size: 13px;
  color: #4ec9b0; background: rgba(78,201,176,.06);
  border: 1px solid rgba(78,201,176,.15);
  padding: 8px 12px; min-height: 32px; word-break: break-all;
}

/*  Mock context  */
.mock-ctx-details, .ref-panel { border: 1px solid #1e1e22; }
.mock-ctx-summary, .ref-summary {
  padding: 6px 10px; font-size: 10px; font-weight: 600; color: #555;
  text-transform: uppercase; letter-spacing: .05em;
  cursor: pointer; user-select: none; list-style: none;
}
.mock-ctx-summary:hover, .ref-summary:hover { color: #888; }
.mock-ctx-grid {
  display: grid; grid-template-columns: 60px 1fr; gap: 4px 8px;
  padding: 8px 10px; align-items: center;
}
.mock-ctx-body { display: flex; flex-direction: column; }
.mock-ctx-grid label { font-size: 10px; color: #555; font-family: 'Consolas','Fira Mono',monospace; }
.mock-input { font-size: 11px !important; padding: 3px 6px !important; }
.mock-role-row { display: flex; align-items: center; gap: 10px; padding: 6px 10px 8px; }
.mock-role-hint { font-size: 10px; color: #444; text-transform: uppercase; letter-spacing: .04em; font-weight: 600; }
.mock-check-label { display: flex; align-items: center; gap: 4px; font-size: 11px; color: #666; cursor: pointer; }
.mock-check-label input { accent-color: #6f2bff; }

/*  Reference panel  */
.ref-content { max-height: 320px; overflow-y: scroll; padding: 8px 10px; display: flex; flex-direction: column; gap: 10px; scrollbar-width: none; }
.ref-content::-webkit-scrollbar { display: none; }
.ref-group-label { font-size: 9px; font-weight: 700; text-transform: uppercase; letter-spacing: .06em; color: #9d6cff; margin-bottom: 3px; }
.ref-row { display: flex; align-items: baseline; gap: 8px; padding: 1px 0; }
.ref-token { font-family: 'Consolas','Fira Mono',monospace; font-size: 11px; color: #4ec9b0; background: rgba(78,201,176,.08); padding: 1px 5px; white-space: nowrap; flex-shrink: 0; }
:deep(.ref-token-name) { color: #7cb8ea; font-style: italic; }
.ref-desc { font-size: 10px; color: #484848; flex: 1; }
.ref-row { position: relative; }
.ref-example {
  display: none; position: absolute; right: 0; top: 50%; transform: translateY(-50%);
  font-family: 'Consolas','Fira Mono',monospace; font-size: 10px;
  color: #23d18b; background: #0d1a13; border: 1px solid rgba(35,209,139,.3);
  padding: 2px 7px; white-space: nowrap; pointer-events: none; z-index: 10;
  box-shadow: 0 2px 8px rgba(0,0,0,.5);
}
.ref-row.has-example:hover .ref-example { display: block; }
.ref-row.has-example:hover .ref-desc { opacity: 0.4; }
</style>

<style>
/* ── $if coloring ─────────────────────────────────────────────────────────── */

/* $if keyword - just color, no background */
.sh-if-kw { font-weight: 600; }

/* condition ( ... ) - subtle dashed underline shows it's a fillable slot */
.sh-if-cond { }
.sh-if-cond-empty   { background: rgba(126,200,227,.10); border-radius: 2px; outline: 1px dashed rgba(126,200,227,.4); }
.sh-if-cond-invalid { background: rgba(249,168,77,.08);  border-radius: 2px; outline: 1px dashed rgba(249,168,77,.4);  }

/* body { ... } - very faint tint to indicate it's a container */
.sh-if-body { }
.sh-if-body-empty { background: rgba(78,201,176,.06); border-radius: 2px; outline: 1px dashed rgba(78,201,176,.3); }

/* parens/braces that belong to $if - inherit keyword color, bold */
.sh-if-paren { font-weight: 600; }

/* ── Standard token colors ────────────────────────────────────────────────── */
.sh-kw      { color: #569cd6; font-weight: 600; }   /* other keywords (no background) */
.sh-end     { font-size: 0.82em; opacity: 0.4; vertical-align: middle; }
.sh-builtin { color: #9d6cff; }
.sh-locked  { color: #9d6cff; border-bottom: 1px solid rgba(111,43,255,.4); cursor: not-allowed; }
.sh-op      { color: #c792ea; }
.sh-string  { color: #ce9178; }
.sh-number  { color: #b5cea8; }
.sh-custom  { color: #4fc1e9; }
.sh-unknown { color: #d1c023; }
.sh-error   { color: #f14949; text-decoration: underline wavy #f1494966; }

/* Ghost autocomplete suffix */
.ghost-inline {
  color: #3a3a50;
  pointer-events: none;
  user-select: none;
}
</style>