<script setup lang="ts">
import { ref, watch, computed, nextTick, onMounted, onUnmounted } from 'vue'
import { API } from '../api'
import { useAuth } from '../auth'

export interface CustomCommand {
  name: string; response: string; rule: string; alias: string
  enabled_when: string; required_game: string
  regex1: string; regex2: string; text1: string; text2: string
  isActive: boolean | number; cooldown: number; userCooldown: number
}
interface Props { cmdName: string; channel: string; open: boolean; isBuiltIn?: boolean }

const props = defineProps<Props>()
const emit  = defineEmits<{ (e: 'close'): void; (e: 'saved'): void }>()
const { session } = useAuth()

const loading  = ref(true)
const saving   = ref(false)
const saved    = ref(false)
const deleting = ref(false)
const form = ref<CustomCommand>({
  name: '', response: '', rule: '', alias: '', enabled_when: 'always', required_game: '',
  regex1: '', regex2: '', text1: '', text2: '', isActive: true, cooldown: 0, userCooldown: 0,
})

// ─── Token definitions ────────────────────────────────────────────────────────

const OPERATORS = ['[has]','[=]','[starts]','[ends]']
const ACTIONS   = ['[replace]','[remove]','[delete]','[prepend]','[append]','[send]','[stop]']
const VALUES    = ['{output}','{input}','{user}','{channel}','{args}']
const WRAPPERS  = ['$if']

// ─── Dynamic parameters ───────────────────────────────────────────────────────
interface ParamEntry { key: string; type: 'text' | 'regex'; value: string }
const userParams = ref<ParamEntry[]>([
  { key: 'regex1', type: 'regex', value: '' },
  { key: 'regex2', type: 'regex', value: '' },
  { key: 'text1',  type: 'text',  value: '' },
  { key: 'text2',  type: 'text',  value: '' },
])
const PARAMS     = computed(() => userParams.value.map(p => `{${p.key}}`))
const ARG_TOKENS = computed(() => [...VALUES, ...PARAMS.value])

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
// Keep form fields in sync with userParams values
watch(userParams, params => {
  for (const p of params) (form.value as any)[p.key] = p.value
}, { deep: true })

// ─── Load / Save ──────────────────────────────────────────────────────────────

async function load() {
  if (!session.value || !props.cmdName) return
  loading.value = true
  try {
    const res = await fetch(`${API}/custom-commands/${props.channel}`, {
      headers: { Authorization: `Bearer ${session.value.token}` }
    })
    if (res.ok) {
      const data = await res.json() as { commands: CustomCommand[] }
      const ex = data.commands.find(c => c.name === props.cmdName)
      form.value = ex
        ? { ...ex, isActive: !!ex.isActive }
        : { name: props.cmdName, response: '', rule: '', alias: '', enabled_when: 'always',
            required_game: '', regex1: '', regex2: '', text1: '', text2: '',
            isActive: true, cooldown: 0, userCooldown: 0 }
      // Seed userParams values from loaded data
      userParams.value = userParams.value.map(p => ({ ...p, value: ex ? ((ex as any)[p.key] ?? '') : '' }))
    }
  } catch {}
  loading.value = false
  // Seed the editor DOM after load (watcher may have missed it while el was unmounted)
  await nextTick()
  const el = editorRef.value
  if (el) el.innerHTML = highlight(form.value.rule)
}

watch(() => props.open, v => { if (v) load() })
onMounted(() => { if (props.open) load() })

// Seed editor DOM when rule changes externally (not during typing)
let _applyingHighlight = false
watch(() => form.value.rule, newRule => {
  if (_applyingHighlight) return
  const el = editorRef.value; if (!el) return
  el.innerHTML = highlight(newRule)
}, { flush: 'post' })

async function save() {
  if (!session.value || !ruleValid.value) return
  saving.value = true
  try {
    await fetch(`${API}/custom-commands/${props.channel}/${props.cmdName}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.value.token}` },
      body: JSON.stringify({
        ...form.value,
        rule: ruleForSave(form.value.rule),
        ...Object.fromEntries(userParams.value.map(p => [p.key, p.value]))
      }),
    })
    saved.value = true; setTimeout(() => { saved.value = false }, 2000); emit('saved')
  } catch {}
  saving.value = false
}

async function deleteCmd() {
  if (!session.value) return
  if (!confirm(`Delete "${props.cmdName}"?`)) return
  deleting.value = true
  try {
    await fetch(`${API}/custom-commands/${props.channel}/${props.cmdName}`, {
      method: 'DELETE', headers: { Authorization: `Bearer ${session.value.token}` }
    })
    emit('saved'); emit('close')
  } catch {}
  deleting.value = false
}

// ─── Placeholder sentinels ────────────────────────────────────────────────────
// Private-use Unicode chars — survive DOM round-trips, never confused with real text
const PH = {
  value:  '\uE001',  // fills with: {output} {input} etc
  param:  '\uE002',  // fills with: {text1} {regex1} etc
  op:     '\uE003',  // fills with: [has] [=] etc
  action: '\uE004',  // fills with: [remove] [replace] etc  (inside skeleton [ ])
  arg:    '\uE005',  // fills with: {text1} {output} etc    (NO surrounding {} in skeleton)
}
const PH_ALL = Object.values(PH)
const PH_CLASS: Record<string, string> = {
  [PH.value]: 'tk-value', [PH.param]: 'tk-param', [PH.op]: 'tk-op',
  [PH.action]: 'tk-action', [PH.arg]: 'tk-action-arg',
}
const PH_LABEL: Record<string, string> = {
  [PH.value]: 'value', [PH.param]: 'param', [PH.op]: 'op',
  [PH.action]: 'action', [PH.arg]: 'arg',
}
// Getter-based so they always reflect current PARAMS/ARG_TOKENS
const PH_CANDIDATES: Record<string, string[]> = {
  [PH.value]:                VALUES,
  get [PH.param]()  { return PARAMS.value },
  [PH.op]:                   OPERATORS,
  [PH.action]:               ACTIONS,
  get [PH.arg]()    { return ARG_TOKENS.value },
}

function tokenClass(tok: string): string {
  if (WRAPPERS.includes(tok))     return 'tk-wrapper'
  if (OPERATORS.includes(tok))    return 'tk-op'
  if (ACTIONS.includes(tok))      return 'tk-action'
  if (VALUES.includes(tok))       return 'tk-value'
  if (PARAMS.value.includes(tok)) return 'tk-param'
  return ''
}
function allTokens() { return [...WRAPPERS, ...OPERATORS, ...ACTIONS, ...VALUES, ...PARAMS.value] }

// ─── Skeletons ────────────────────────────────────────────────────────────────
// PH.arg has NO surrounding {} — user fills it with a full token like {text1}
// so we get [remove{text1}] not [remove{{text1}}]

function ifSkeleton() {
  return `$if(${PH.value}${PH.op}${PH.param}<do [${PH.action}${PH.arg}]>)`
}

function actionSkeleton(tok: string, selectedText = ''): string {
  const name = tok.replace(/^\[|\]$/g, '')
  if (selectedText) return `[${name}{${selectedText}}]`
  switch (name) {
    case 'stop':    return `[stop]`
    case 'replace': return `[replace${PH.arg}${PH.arg}]`  // [replace{from}{to}]
    default:        return `[${name}${PH.arg}]`            // [remove{val}] etc
  }
}

// ─── Highlight ────────────────────────────────────────────────────────────────
// Split on sentinels first (so they never get HTML-escaped or regex-matched),
// then colour each plain-text segment with block tints + token colours.

function highlight(src: string): string {
  const PH_RE = new RegExp(`([${PH_ALL.join('')}])`, 'g')
  return src.split(PH_RE).map(part => {
    if (PH_ALL.includes(part)) {
      const cls = PH_CLASS[part] ?? '', label = PH_LABEL[part] ?? '?'
      return `<span class="tk-placeholder ${cls}" data-ph="${part}" contenteditable="false">${label}</span>`
    }
    return colourSegment(part)
  }).join('')
}

// Colour a sentinel-free segment: escape → block tints → token colours
function colourSegment(src: string): string {
  if (!src) return ''
  let out = '', i = 0
  while (i < src.length) {
    // $if(…) — blue tint wrapper. Inner content gets full colourSegment treatment.
    if (src.startsWith('$if(', i)) {
      let depth = 0, j = i + 4
      while (j < src.length && !(src[j] === ')' && depth === 0)) {
        if (src[j] === '(') depth++; else if (src[j] === ')') depth--; j++
      }
      // Render prefix '$if(' and suffix ')' as wrapper tokens; inner content recursively
      const inner = src.slice(i + 4, j)
      out += `<span class="if-block"><span class="tk-wrapper">$if(</span>${colourSegment(inner)}<span class="tk-wrapper">)</span></span>`
      i = j + 1; continue
    }
    // $else{…} — blue tint wrapper
    if (src.startsWith('$else{', i)) {
      let depth = 0, j = i + 6
      while (j < src.length && !(src[j] === '}' && depth === 0)) {
        if (src[j] === '{') depth++; else if (src[j] === '}') depth--; j++
      }
      const inner = src.slice(i + 6, j)
      out += `<span class="if-block"><span class="tk-wrapper">$else{</span>${colourSegment(inner)}<span class="tk-wrapper">}</span></span>`
      i = j + 1; continue
    }
    // [action…] — red tint wrapper. Inner args get token colours.
    const actionStart = src.slice(i).match(/^\[(replace|remove|delete|prepend|append|send|stop)/)
    if (actionStart) {
      let depth = 0, j = i + 1
      while (j < src.length) {
        if (src[j] === '{') depth++
        else if (src[j] === '}') depth--
        else if (src[j] === ']' && depth === 0) { j++; break }
        j++
      }
      // Colour the action name red, args individually (values/params keep their colour)
      const actionFull = src.slice(i, j)  // e.g. [replace{text1}{text2}]
      // Split into: [name, {arg1}, {arg2}, ]
      const actionName = actionFull.match(/^\[([\w]+)/)?.[1] ?? ''
      const argsStr = actionFull.slice(1 + actionName.length, -1)  // {text1}{text2}
      const nameHtml = `<span class="tk-action">[${escHtml(actionName)}</span>`
      const argsHtml = colourTokens(escHtml(argsStr))
      const closeHtml = `<span class="tk-action">]</span>`
      out += `<span class="action-block">${nameHtml}${argsHtml}${closeHtml}</span>`
      i = j; continue
    }
    // Plain chars up to next special start
    let chunk = ''
    while (i < src.length) {
      if (src.startsWith('$if(', i) || src.startsWith('$else{', i)) break
      if (src.slice(i).match(/^\[(replace|remove|delete|prepend|append|send|stop)/)) break
      chunk += src[i++]
    }
    if (chunk) out += colourTokens(escHtml(chunk))
  }
  return out
}

function escHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

// Token-colour an already-escaped HTML string (no sentinels present).
// Does NOT match actions-with-args like [remove{text1}] — those are wrapped
// in .action-block by colourSegment. Only colours bare tokens individually.
function colourTokens(s: string): string {
  const paramKeys = userParams.value.map(p => p.key).join('|')
  const paramPat  = paramKeys ? `|\\{(?:${paramKeys})\\}` : ''
  const pat = new RegExp(
    `(\\$if|\\$else` +
    // bare actions only (no args) — actions WITH args get their tint from action-block
    `|\\[(?:replace|remove|delete|prepend|append|send|stop)\\]` +
    // operators
    `|\\[(?:has|=|starts|ends)\\]` +
    // values
    `|\\{(?:output|input|user|channel|args)\\}` +
    // dynamic params
    paramPat +
    `|&lt;do|&gt;)`, 'g'
  )
  return s.replace(pat, m => {
    const raw = m.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&')
    let cls = ''
    if (['$if','$else'].includes(raw) || raw === '<do' || raw === '>') cls = 'tk-wrapper'
    else if (OPERATORS.includes(raw))           cls = 'tk-op'
    else if (ACTIONS.includes(raw))             cls = 'tk-action'
    else if (VALUES.includes(raw))              cls = 'tk-value'
    else if (PARAMS.value.includes(raw))        cls = 'tk-param'
    return cls ? `<span class="${cls}">${m}</span>` : m
  })
}

// ─── Validation ───────────────────────────────────────────────────────────────

const ruleWarnings = computed((): string[] => {
  const r = form.value.rule
  if (!r.trim()) return []
  const w: string[] = []
  let ph = 0; for (const p of PH_ALL) ph += (r.split(p).length - 1)
  if (ph > 0) w.push(`${ph} unfilled slot${ph > 1 ? 's' : ''} remaining`)
  const ifN = (r.match(/\$if\(/g) || []).length
  const doN = (r.match(/<do/g)    || []).length
  if (ifN !== doN) w.push(`${ifN} $if but ${doN} <do> — must match`)
  const bOpen  = (r.match(/\[/g) || []).length
  const bClose = (r.match(/\]/g) || []).length
  if (bOpen !== bClose) w.push(`Unmatched [ ] : ${bOpen} vs ${bClose}`)
  const rNoPH = r.replace(/[\uE001-\uE005]/g, '')
  const cOpen  = (rNoPH.match(/\{/g) || []).length
  const cClose = (rNoPH.match(/\}/g) || []).length
  if (cOpen !== cClose) w.push(`Unmatched { } : ${cOpen} vs ${cClose}`)
  return w
})
const ruleValid = computed(() => ruleWarnings.value.length === 0)

// ─── DOM helpers ──────────────────────────────────────────────────────────────

function getPlainText(el: HTMLElement): string {
  function walk(node: Node): string {
    if (node instanceof HTMLElement && node.classList.contains('tk-placeholder'))
      return node.dataset.ph ?? ''
    if (node.nodeType === Node.TEXT_NODE) return node.textContent ?? ''
    return Array.from(node.childNodes).map(walk).join('')
  }
  return walk(el).replace(/\n\n/g, '\n')
}

function getCaretOffset(el: HTMLElement): number {
  const sel = window.getSelection()
  if (!sel || !sel.rangeCount) return 0
  const range = sel.getRangeAt(0)
  if (!el.contains(range.startContainer)) return 0
  let count = 0, found = false
  function walk(node: Node): void {
    if (found) return
    if (node instanceof HTMLElement && node.classList.contains('tk-placeholder')) {
      if (node === range.startContainer || node.contains(range.startContainer)) { found = true; return }
      count += 1; return
    }
    if (node.nodeType === Node.TEXT_NODE) {
      if (node === range.startContainer) { count += range.startOffset; found = true; return }
      count += node.textContent?.length ?? 0; return
    }
    if (node === range.startContainer) {
      const ch = Array.from(node.childNodes)
      for (let i = 0; i < range.startOffset && !found; i++) { if (ch[i]) walk(ch[i]!) }
      found = true; return
    }
    for (const c of Array.from(node.childNodes)) { if (!found) walk(c) }
  }
  walk(el); return count
}

function restoreCaret(el: HTMLElement, offset: number) {
  let remaining = offset, placed = false
  function walk(node: Node): void {
    if (placed) return
    if (node instanceof HTMLElement && node.classList.contains('tk-placeholder')) {
      if (remaining <= 0) {
        const r = document.createRange(); r.setStartBefore(node); r.collapse(true)
        window.getSelection()?.removeAllRanges(); window.getSelection()?.addRange(r)
        placed = true; return
      }
      remaining -= 1; return
    }
    if (node.nodeType === Node.TEXT_NODE) {
      const len = node.textContent?.length ?? 0
      if (remaining <= len) {
        const r = document.createRange(); r.setStart(node, remaining); r.collapse(true)
        window.getSelection()?.removeAllRanges(); window.getSelection()?.addRange(r)
        placed = true; return
      }
      remaining -= len; return
    }
    for (const c of Array.from(node.childNodes)) { if (!placed) walk(c) }
  }
  walk(el)
  if (!placed) {
    const r = document.createRange(); r.selectNodeContents(el); r.collapse(false)
    window.getSelection()?.removeAllRanges(); window.getSelection()?.addRange(r)
  }
}

function applyHighlight() {
  const el = editorRef.value; if (!el) return
  const offset = getCaretOffset(el)
  _applyingHighlight = true
  el.innerHTML = highlight(form.value.rule)
  _applyingHighlight = false
  nextTick(() => restoreCaret(el, offset))
}

function ruleForSave(rule: string) {
  let r = rule; for (const p of PH_ALL) r = r.split(p).join(''); return r
}

// ─── Editor state ─────────────────────────────────────────────────────────────

const editorRef  = ref<HTMLDivElement | null>(null)
const acRef      = ref<HTMLDivElement | null>(null)
const acItems    = ref<string[]>([])
const acIndex    = ref(0)
const acPos      = ref({ top: 0, left: 0 })
const acVisible  = ref(false)
const acTrigger  = ref('')
const acActivePh = ref<string | null>(null)

// ─── Insert ───────────────────────────────────────────────────────────────────

function insertAtCaret(text: string) {
  const el = editorRef.value; if (!el) return
  el.focus()
  const plain  = getPlainText(el)
  const offset = getCaretOffset(el)
  form.value.rule = plain.slice(0, offset) + text + plain.slice(offset)
  applyHighlight()
  nextTick(() => restoreCaret(el, offset + text.length))
}

function onPaletteClick(tok: string) {
  if (tok === '$if')          { insertAtCaret(ifSkeleton()); return }
  if (ACTIONS.includes(tok))  { insertAtCaret(actionSkeleton(tok)); return }
  insertAtCaret(tok)
}

// ─── Editor events ────────────────────────────────────────────────────────────

function onEditorInput() {
  const el = editorRef.value; if (!el) return
  form.value.rule = getPlainText(el)
  applyHighlight()
  checkAutocomplete()
}

function onEditorKeydown(e: KeyboardEvent) {
  if (acVisible.value) {
    if (e.key === 'ArrowDown') { e.preventDefault(); acIndex.value = Math.min(acIndex.value + 1, acItems.value.length - 1); return }
    if (e.key === 'ArrowUp')   { e.preventDefault(); acIndex.value = Math.max(acIndex.value - 1, 0); return }
    if (e.key === 'Enter' || e.key === 'Tab') { e.preventDefault(); insertAcItem(); return }
    if (e.key === 'Escape')    { acVisible.value = false; acActivePh.value = null; return }
  }
  // $if + ( → expand immediately
  if (e.key === '(') {
    const el = editorRef.value; if (!el) return
    const before = getPlainText(el).slice(0, getCaretOffset(el))
    if (before.trimEnd().endsWith('$if')) {
      e.preventDefault(); acVisible.value = false
      const trimmed = before.trimEnd()
      const after   = getPlainText(el).slice(getCaretOffset(el))
      const skel    = ifSkeleton()
      form.value.rule = trimmed.slice(0, -3) + skel + after
      applyHighlight()
      nextTick(() => restoreCaret(el, trimmed.length - 3 + skel.length))
    }
  }
}

function onEditorClick(e: MouseEvent) {
  const target = e.target as HTMLElement
  const phSpan = target.classList.contains('tk-placeholder') ? target
    : (target.closest?.('.tk-placeholder') as HTMLElement | null)
  if (!phSpan) { acVisible.value = false; acActivePh.value = null; return }
  const ph = phSpan.dataset.ph ?? ''
  if (!ph || !(PH_CANDIDATES[ph]?.length)) return
  e.preventDefault()
  acActivePh.value = ph
  acItems.value    = PH_CANDIDATES[ph]
  acIndex.value    = 0; acTrigger.value = ''; acVisible.value = true
  const rect = phSpan.getBoundingClientRect()
  const er   = editorRef.value!.getBoundingClientRect()
  acPos.value = { top: rect.bottom - er.top + 4, left: rect.left - er.left }
}

// ─── Autocomplete ─────────────────────────────────────────────────────────────

function checkAutocomplete() {
  if (acActivePh.value) return
  const el = editorRef.value; if (!el) return
  const plain  = getPlainText(el)
  const offset = getCaretOffset(el)
  const before = plain.slice(0, offset)
  const partial = before.match(/(\$[\w]*|\[[\w=]*|\{[\w]*)$/)
  if (!partial) { acVisible.value = false; return }
  const p = partial[0]
  // Include exact matches too ($if typed fully → offer to expand)
  const candidates = allTokens().filter(t => t.startsWith(p))
  if (!candidates.length) { acVisible.value = false; return }
  acTrigger.value = p; acItems.value = candidates; acIndex.value = 0; acVisible.value = true
  const sel = window.getSelection()
  if (sel?.rangeCount) {
    const rect = sel.getRangeAt(0).getBoundingClientRect()
    const er   = el.getBoundingClientRect()
    acPos.value = { top: rect.bottom - er.top + 4, left: rect.left - er.left }
  }
}

function insertAcItem() {
  const item = acItems.value[acIndex.value]; if (!item) return
  acVisible.value = false
  const el = editorRef.value; if (!el) return

  // ── Placeholder fill mode ─────────────────────────────────────────────────
  if (acActivePh.value) {
    const ph = acActivePh.value; acActivePh.value = null
    const plain = getPlainText(el)
    const idx   = plain.indexOf(ph); if (idx === -1) return
    if (ph === PH.action && ACTIONS.includes(item)) {
      // Replace [PH.action PH.arg] (pos-1='[', pos=PH.action, pos+1=PH.arg?, pos+?=']')
      const skel = actionSkeleton(item)
      const hasArg = plain[idx + 1] === PH.arg
      const sliceEnd = hasArg ? idx + 2 : idx + 1
      form.value.rule = plain.slice(0, idx - 1) + skel + plain.slice(sliceEnd + 1)
      applyHighlight(); nextTick(() => restoreCaret(el, idx - 1 + skel.length))
      return
    }
    form.value.rule = plain.slice(0, idx) + item + plain.slice(idx + 1)
    applyHighlight(); nextTick(() => restoreCaret(el, idx + item.length))
    return
  }

  // ── Typing mode ───────────────────────────────────────────────────────────
  const plain   = getPlainText(el)
  const offset  = getCaretOffset(el)
  const trigLen = acTrigger.value.length
  const before  = plain.slice(0, offset - trigLen)
  const after   = plain.slice(offset)
  let insert = item
  // Expand $if and actions to skeletons (even when exact token typed)
  if (item === '$if')           insert = ifSkeleton()
  else if (ACTIONS.includes(item)) insert = actionSkeleton(item)
  form.value.rule = before + insert + after
  applyHighlight()
  nextTick(() => restoreCaret(el, before.length + insert.length))
}

// ─── Drag & drop ─────────────────────────────────────────────────────────────

function onDragStart(e: DragEvent, tok: string) { e.dataTransfer?.setData('text/plain', tok) }

function getPhSpanAt(e: DragEvent): HTMLElement | null {
  for (const el of document.elementsFromPoint(e.clientX, e.clientY))
    if (el instanceof HTMLElement && el.classList.contains('tk-placeholder')) return el
  return null
}

function onEditorDrop(e: DragEvent) {
  e.preventDefault()
  const tok = e.dataTransfer?.getData('text/plain'); if (!tok) return
  const el = editorRef.value!; el.focus()

  const phSpan = getPhSpanAt(e)
  if (phSpan) {
    const ph = phSpan.dataset.ph ?? ''
    if (!(PH_CANDIDATES[ph] ?? []).includes(tok)) return
    const plain = getPlainText(el)
    let pos = 0, phFound = false
    function findPh(node: Node): void {
      if (phFound) return
      if (node === phSpan) { phFound = true; return }
      if (node instanceof HTMLElement && node.classList.contains('tk-placeholder')) { pos += 1; return }
      if (node.nodeType === Node.TEXT_NODE) { pos += node.textContent?.length ?? 0; return }
      for (const c of Array.from(node.childNodes)) { if (!phFound) findPh(c) }
    }
    findPh(el)
    if (!phFound) return
    if (ph === PH.action && ACTIONS.includes(tok)) {
      const skel = actionSkeleton(tok)
      const hasArg = plain[pos + 1] === PH.arg
      const sliceEnd = hasArg ? pos + 2 : pos + 1
      form.value.rule = plain.slice(0, pos - 1) + skel + plain.slice(sliceEnd + 1)
      applyHighlight(); nextTick(() => restoreCaret(el, pos - 1 + skel.length))
      return
    }
    form.value.rule = plain.slice(0, pos) + tok + plain.slice(pos + 1)
    applyHighlight(); nextTick(() => restoreCaret(el, pos + tok.length))
    return
  }

  // Drop at cursor
  let dropOff = 0
  if ((document as any).caretRangeFromPoint) {
    const r = (document as any).caretRangeFromPoint(e.clientX, e.clientY)
    if (r) {
      const pre = document.createRange(); pre.setStart(el, 0); pre.setEnd(r.startContainer, r.startOffset)
      dropOff = pre.toString().length
    }
  }
  const plain = getPlainText(el)
  let insert = tok === '$if' ? ifSkeleton() : ACTIONS.includes(tok) ? actionSkeleton(tok) : tok
  form.value.rule = plain.slice(0, dropOff) + insert + plain.slice(dropOff)
  applyHighlight(); nextTick(() => restoreCaret(el, dropOff + insert.length))
}

function onEditorDragover(e: DragEvent) {
  e.preventDefault()
  document.querySelectorAll('.tk-placeholder.drag-over').forEach(el => el.classList.remove('drag-over'))
  getPhSpanAt(e)?.classList.add('drag-over')
}

// ─── Palette ──────────────────────────────────────────────────────────────────

const palette = computed(() => [
  { group: 'Wrappers',   cls: 'tk-wrapper', tokens: WRAPPERS     },
  { group: 'Operators',  cls: 'tk-op',      tokens: OPERATORS    },
  { group: 'Actions',    cls: 'tk-action',  tokens: ACTIONS      },
  { group: 'Values',     cls: 'tk-value',   tokens: VALUES       },
  { group: 'Parameters', cls: 'tk-param',   tokens: PARAMS.value },
])

function onClickOutside(e: MouseEvent) {
  if (!acVisible.value) return
  if (acRef.value?.contains(e.target as Node)) return
  if ((e.target as HTMLElement)?.classList?.contains('tk-placeholder')) return
  acVisible.value = false; acActivePh.value = null
}
onMounted(()   => document.addEventListener('mousedown', onClickOutside))
onUnmounted(() => document.removeEventListener('mousedown', onClickOutside))
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

        <div v-if="loading" class="panel-loading">Loading…</div>
        <div v-else class="panel-body">

          <!-- Response / Output -->
          <div class="field-group">
            <template v-if="!isBuiltIn">
              <label class="field-label">Response <span class="field-hint">Use {user} {channel} {args}</span></label>
              <textarea v-model="form.response" class="field-textarea" rows="2" placeholder="Hello {user}! You said: {args}" />
            </template>
            <template v-else>
              <label class="field-label">Output <span class="field-hint">Hardcoded — the bot generates this</span></label>
              <div class="output-placeholder">
                <span class="op-brace">{</span><span class="op-label">output</span><span class="op-brace">}</span>
              </div>
            </template>
          </div>

          <!-- Rule + palette + params -->
          <div class="field-group">
            <label class="field-label">Rule <span class="field-hint">Click palette or type $ [ { — click a coloured slot to fill it</span></label>
            <div class="rule-area">

              <!-- Left: palette -->
              <div class="palette">
                <div v-for="g in palette" :key="g.group" class="palette-group">
                  <div class="palette-group-label" :class="g.cls">{{ g.group }}</div>
                  <div v-for="tok in g.tokens" :key="tok"
                    class="palette-token" :class="tokenClass(tok)"
                    draggable="true"
                    @dragstart="onDragStart($event, tok)"
                    @click="onPaletteClick(tok)"
                    title="Click or drag"
                  >{{ tok }}</div>
                </div>
              </div>

              <!-- Right: editor + params -->
              <div class="editor-col">
                <div class="editor-wrap">
                  <div
                    ref="editorRef"
                    class="rule-editor"
                    :class="{ invalid: !ruleValid && !!form.rule }"
                    contenteditable="true"
                    spellcheck="false"
                    data-placeholder="e.g. $if({output}[has]{text1}<do [remove{text1}]>)"
                    @input="onEditorInput"
                    @keydown="onEditorKeydown"
                    @click="onEditorClick"
                    @drop="onEditorDrop"
                    @dragover="onEditorDragover"
                  ></div>

                  <div v-if="form.rule && ruleWarnings.length" class="rule-warnings">
                    <div v-for="w in ruleWarnings" :key="w" class="rule-warning-item">⚠ {{ w }}</div>
                  </div>

                  <div v-if="acVisible" ref="acRef" class="ac-dropdown"
                    :style="{ top: acPos.top + 'px', left: acPos.left + 'px' }">
                    <div v-for="(item, i) in acItems" :key="item"
                      class="ac-item" :class="[tokenClass(item), { active: i === acIndex }]"
                      @mousedown.prevent="acIndex = i; insertAcItem()"
                    >{{ item }}</div>
                  </div>
                </div>

                <!-- Params: directly below the editor, same column -->
                <div class="params-section">
                  <div class="params-header">
                    <span class="params-label">Parameters</span>
                    <div class="params-add-btns">
                      <button class="btn-add-param" @click="addParam('text')">+ text</button>
                      <button class="btn-add-param" @click="addParam('regex')">+ regex</button>
                    </div>
                  </div>
                  <div class="params-list">
                    <div v-for="p in userParams" :key="p.key" class="param-row">
                      <span class="param-key tk-param">{{ '{' + p.key + '}' }}</span>
                      <input v-model="p.value" class="field-input param-input"
                        :placeholder="p.type === 'regex' ? 'pattern…' : 'text…'" />
                      <button class="btn-remove-param"
                        :disabled="form.rule.includes('{' + p.key + '}')"
                        :title="form.rule.includes('{' + p.key + '}') ? 'Used in rule — cannot remove' : 'Remove'"
                        @click="removeParam(p.key)">✕</button>
                    </div>
                    <div v-if="userParams.length === 0" class="params-empty">
                      No parameters — click + text or + regex to add
                    </div>
                  </div>
                </div>
              </div><!-- /editor-col -->

            </div><!-- /rule-area -->
          </div><!-- /field-group Rule -->

          <!-- Settings row -->
          <div class="cond-row">
            <div class="field-group sm">
              <label class="field-label">Active when</label>
              <select v-model="form.enabled_when" class="field-select">
                <option value="always">Always</option>
                <option value="online">Online only</option>
                <option value="offline">Offline only</option>
              </select>
            </div>
            <div class="field-group sm">
              <label class="field-label">Required game <span class="field-hint">optional</span></label>
              <input v-model="form.required_game" class="field-input" placeholder="Fortnite" />
            </div>
            <div class="field-group sm">
              <label class="field-label">Alias <span class="field-hint">optional</span></label>
              <input v-model="form.alias" class="field-input" placeholder="shortname" />
            </div>
          </div>

          <div class="cond-row">
            <div class="field-group sm">
              <label class="field-label">Global cooldown <span class="field-hint">s</span></label>
              <input v-model.number="form.cooldown" type="number" min="0" class="field-input" />
            </div>
            <div class="field-group sm">
              <label class="field-label">User cooldown <span class="field-hint">s</span></label>
              <input v-model.number="form.userCooldown" type="number" min="0" class="field-input" />
            </div>
          </div>

          <!-- Footer -->
          <div class="panel-footer">
            <button v-if="!isBuiltIn" class="btn-delete" :disabled="deleting" @click="deleteCmd">
              {{ deleting ? 'Deleting…' : 'Delete command' }}
            </button>
            <div v-else></div>
            <div class="footer-right">
              <button class="btn-cancel" @click="emit('close')">Cancel</button>
              <button class="btn-save"
                :class="{ saved, invalid: !ruleValid && !!form.rule }"
                :disabled="saving || !ruleValid"
                :title="ruleWarnings.join(' · ')"
                @click="save"
              >{{ saved ? '✓ Saved' : saving ? 'Saving…' : !ruleValid ? '⚠ Fix rule' : 'Save' }}</button>
            </div>
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
.panel-body { flex: 1; overflow-y: auto; padding: 20px 24px; display: flex; flex-direction: column; gap: 16px; }

.field-group { display: flex; flex-direction: column; gap: 5px; }
.field-group.sm { flex: 1; min-width: 0; }
.field-label { font-size: 11px; font-weight: 600; color: #888; text-transform: uppercase; letter-spacing: .05em; display: flex; align-items: center; gap: 6px; }
.field-hint  { font-size: 10px; color: #555; font-weight: 400; text-transform: none; letter-spacing: 0; }
.field-input, .field-textarea, .field-select { background: #111217; border: 1px solid #2a2a30; color: #e0e0e0; font-family: inherit; font-size: 13px; padding: 7px 10px; outline: none; transition: border-color .15s; }
.field-input:focus, .field-textarea:focus, .field-select:focus { border-color: #6f2bff55; }
.field-textarea { resize: vertical; min-height: 52px; }
.field-select   { appearance: none; cursor: pointer; }

/* Rule layout: palette left | editor+params right */
.rule-area { display: flex; flex-direction: row; gap: 10px; align-items: flex-start; }
.palette { width: 130px; flex-shrink: 0; display: flex; flex-direction: column; gap: 10px; }
.palette-group { display: flex; flex-direction: column; gap: 2px; }
.palette-group-label { font-size: 9px; font-weight: 700; text-transform: uppercase; letter-spacing: .06em; margin-bottom: 3px; opacity: .7; }
.palette-token { display: inline-block; padding: 3px 7px; font-size: 11px; font-family: 'Consolas','Fira Mono',monospace; cursor: grab; border: 1px solid transparent; transition: opacity .1s; user-select: none; white-space: nowrap; }
.palette-token:hover { opacity: .75; }

/* editor-col: right column containing both editor and params stacked vertically */
.editor-col { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 8px; overflow: visible; }
.editor-wrap { position: relative; width: 100%; }

.rule-editor { min-height: 100px; max-height: 220px; overflow-y: auto; background: #0d0d10; border: 1px solid #2a2a30; padding: 10px 12px; font-family: 'Consolas','Fira Mono',monospace; font-size: 13px; line-height: 1.8; color: #c0c0c0; outline: none; white-space: pre-wrap; word-break: break-all; transition: border-color .15s; }
.rule-editor:focus   { border-color: #6f2bff55; }
.rule-editor.invalid { border-color: #f1494966; }
.rule-editor:empty::before { content: attr(data-placeholder); color: #2a2a35; pointer-events: none; }
.rule-warnings     { margin-top: 4px; display: flex; flex-direction: column; gap: 2px; }
.rule-warning-item { font-size: 11px; color: #f5a623; background: rgba(245,166,35,.08); border-left: 2px solid #f5a62366; padding: 3px 7px; }

.ac-dropdown { position: absolute; z-index: 100; background: #1a1a1e; border: 1px solid #2a2a30; min-width: 160px; max-height: 180px; overflow-y: auto; }
.ac-item { padding: 5px 10px; font-size: 12px; font-family: 'Consolas','Fira Mono',monospace; cursor: pointer; transition: background .1s; }
.ac-item:hover, .ac-item.active { background: #2a2a35; }

/* Params below editor */
.params-section { display: flex; flex-direction: column; gap: 5px; }
.params-header { display: flex; align-items: center; justify-content: space-between; }
.params-label { font-size: 10px; font-weight: 600; color: #555; text-transform: uppercase; letter-spacing: .05em; }
.params-add-btns { display: flex; gap: 5px; }
.btn-add-param { height: 22px; padding: 0 9px; border: 1px solid #2a2a30; background: #111217; color: #666; font-family: inherit; font-size: 10px; cursor: pointer; transition: border-color .15s, color .15s; }
.btn-add-param:hover { border-color: #e5c07b55; color: #e5c07b; }
.params-list { display: flex; flex-direction: column; gap: 3px; }
.param-row { display: flex; align-items: center; gap: 6px; }
.param-key { font-size: 11px; font-family: 'Consolas','Fira Mono',monospace; min-width: 60px; flex-shrink: 0; }
.param-input { flex: 1; min-width: 0; font-size: 12px !important; padding: 5px 8px !important; }
.btn-remove-param { width: 22px; height: 22px; flex-shrink: 0; border: 1px solid #f1494933; background: transparent; color: #f14949; font-size: 10px; cursor: pointer; display: flex; align-items: center; justify-content: center; transition: background .1s; }
.btn-remove-param:hover:not(:disabled) { background: #f1494922; }
.btn-remove-param:disabled { opacity: .2; cursor: not-allowed; }
.params-empty { font-size: 11px; color: #383838; font-style: italic; }

:deep(.tk-wrapper), .palette-token.tk-wrapper, .ac-item.tk-wrapper, .palette-group-label.tk-wrapper { color: #569cd6; border-color: #569cd633; }
:deep(.tk-op),      .palette-token.tk-op,      .ac-item.tk-op,      .palette-group-label.tk-op      { color: #c792ea; border-color: #c792ea33; }
:deep(.tk-action),  .palette-token.tk-action,  .ac-item.tk-action,  .palette-group-label.tk-action  { color: #f14949; border-color: #f1494933; }
:deep(.tk-value),   .palette-token.tk-value,   .ac-item.tk-value,   .palette-group-label.tk-value   { color: #4ec9b0; border-color: #4ec9b033; }
:deep(.tk-param),   .palette-token.tk-param,   .ac-item.tk-param,   .palette-group-label.tk-param   { color: #e5c07b; border-color: #e5c07b33; }
:deep(.tk-action-arg) { color: #7ec8a0; border-color: #7ec8a033; }

.cond-row { display: flex; gap: 10px; }
.panel-footer { display: flex; align-items: center; justify-content: space-between; padding-top: 16px; border-top: 1px solid #222; margin-top: 4px; }
.footer-right { display: flex; gap: 8px; }
.btn-save { height: 34px; padding: 0 20px; border: none; background: #6f2bff; color: #fff; font-family: inherit; font-size: 12px; font-weight: 600; cursor: pointer; transition: background .15s; }
.btn-save:hover:not(:disabled) { background: #7f3fff; }
.btn-save:disabled { opacity: .4; cursor: not-allowed; }
.btn-save.saved   { background: #1a3d2a; color: #23d18b; }
.btn-save.invalid { background: #2a1a0a; color: #e5c07b; border: 1px solid #e5c07b44; }
.btn-cancel { height: 34px; padding: 0 16px; border: 1px solid #333; background: transparent; color: #888; font-family: inherit; font-size: 12px; cursor: pointer; }
.btn-cancel:hover { border-color: #555; color: #e0e0e0; }
.btn-delete { height: 34px; padding: 0 14px; border: 1px solid #f1494944; background: transparent; color: #f14949; font-family: inherit; font-size: 12px; cursor: pointer; transition: background .15s; }
.btn-delete:hover:not(:disabled) { background: #f1494911; }
.btn-delete:disabled { opacity: .4; cursor: not-allowed; }
</style>

<style>
/* Global: affects :deep rule-editor content */
.output-placeholder { display: inline-flex; align-items: center; gap: 2px; background: #0d0d10; border: 1px dashed #252530; padding: 8px 14px; font-family: 'Consolas','Fira Mono',monospace; user-select: none; cursor: default; }
.op-brace { font-size: 20px; color: #2a2a35; line-height: 1; font-weight: 300; }
.op-label { font-size: 13px; color: #333; letter-spacing: .06em; padding: 0 4px; }

/* Block tints rendered inside the contenteditable */
.if-block     { background: rgba(86,156,214,.10); border: 1px solid rgba(86,156,214,.22); border-radius: 3px; padding: 1px 3px; display: inline; }
.action-block { background: rgba(241,73,73,.10);  border: 1px solid rgba(241,73,73,.25);  border-radius: 3px; padding: 1px 3px; display: inline; }

/* Placeholder slot chips */
.tk-placeholder {
  display: inline-block; padding: 0 5px; border-radius: 3px;
  font-size: 10px; font-style: italic; line-height: 1.6;
  cursor: pointer; user-select: none; vertical-align: middle; opacity: .9;
  transition: opacity .1s, filter .1s;
}
.tk-placeholder:hover { opacity: 1; filter: brightness(1.2); }
.tk-placeholder.tk-value      { color: #4ec9b0; background: rgba(78,201,176,.15);  border: 1px solid rgba(78,201,176,.45);  }
.tk-placeholder.tk-param      { color: #e5c07b; background: rgba(229,192,123,.15); border: 1px solid rgba(229,192,123,.45); }
.tk-placeholder.tk-op         { color: #c792ea; background: rgba(199,146,234,.15); border: 1px solid rgba(199,146,234,.45); }
.tk-placeholder.tk-action     { color: #f14949; background: rgba(241,73,73,.15);   border: 1px solid rgba(241,73,73,.45);   }
.tk-placeholder.tk-action-arg { color: #7ec8a0; background: rgba(126,200,160,.15); border: 1px solid rgba(126,200,160,.45); }
.tk-placeholder.drag-over     { opacity: 1; filter: brightness(1.4); outline: 1px solid currentColor; }
</style>
