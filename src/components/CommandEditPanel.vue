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
    }
  } catch {}
  loading.value = false
}

watch(() => props.open, v => { if (v) load() })
onMounted(() => { if (props.open) load() })

// Seed editor DOM when rule loads from server (not during user typing)
let _applyingHighlight = false
watch(() => form.value.rule, newRule => {
  if (_applyingHighlight) return
  const el = editorRef.value
  if (!el) return
  el.innerHTML = highlight(newRule)
}, { flush: 'post' })

async function save() {
  if (!session.value || !ruleValid.value) return
  saving.value = true
  try {
    await fetch(`${API}/custom-commands/${props.channel}/${props.cmdName}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.value.token}` },
      body: JSON.stringify({ ...form.value, rule: ruleForSave(form.value.rule) }),
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

// ─── Token definitions ────────────────────────────────────────────────────────

const OPERATORS = ['[has]','[=]','[starts]','[ends]']
const ACTIONS   = ['[replace]','[remove]','[delete]','[prepend]','[append]','[send]','[stop]']
const VALUES    = ['{output}','{input}','{user}','{channel}','{args}']
const PARAMS    = ['{regex1}','{regex2}','{text1}','{text2}']
const WRAPPERS  = ['$if']
const ARG_TOKENS = [...VALUES, ...PARAMS]

// Placeholder sentinels — private use Unicode, survive DOM round-trips
// Each is a single char that represents an "unfilled slot" of a specific type
const PH = {
  value:  '\uE001',  // slot: value token  {output} etc
  param:  '\uE002',  // slot: param token  {text1} etc
  op:     '\uE003',  // slot: operator     [has] etc
  action: '\uE004',  // slot: action name  [remove] etc
  arg:    '\uE005',  // slot: action arg   {text1} etc
}
const PH_ALL = Object.values(PH)

const PH_CANDIDATES: Record<string, string[]> = {
  [PH.value]:  VALUES,
  [PH.param]:  PARAMS,
  [PH.op]:     OPERATORS,
  [PH.action]: ACTIONS,
  [PH.arg]:    ARG_TOKENS,
}
const PH_CLASS: Record<string, string> = {
  [PH.value]: 'tk-value', [PH.param]: 'tk-param', [PH.op]: 'tk-op',
  [PH.action]: 'tk-action', [PH.arg]: 'tk-action-arg',
}
const PH_LABEL: Record<string, string> = {
  [PH.value]: 'value', [PH.param]: 'param', [PH.op]: 'op',
  [PH.action]: 'action', [PH.arg]: 'arg',
}

function tokenClass(tok: string) {
  if (WRAPPERS.includes(tok))  return 'tk-wrapper'
  if (OPERATORS.includes(tok)) return 'tk-op'
  if (ACTIONS.includes(tok))   return 'tk-action'
  if (VALUES.includes(tok))    return 'tk-value'
  if (PARAMS.includes(tok))    return 'tk-param'
  return ''
}
function allTokens() { return [...WRAPPERS, ...OPERATORS, ...ACTIONS, ...VALUES, ...PARAMS] }

// $if skeleton — placeholders mark fill-in spots
function ifSkeleton() {
  return `$if(${PH.value}${PH.op}${PH.param}<do [${PH.action}{${PH.arg}}]>)`
}
// Action skeletons — each action gets the right number of typed placeholder slots
// Single-arg actions default target to {output}, so only the value slot is needed.
// [replace] needs two args: {from}{to} (target defaults to output)
function actionSkeleton(tok: string, selectedText = ''): string {
  const name = tok.slice(1, -1) // strip [ ]
  if (selectedText) {
    // If text was selected/dragged, use it as the first arg
    return `[${name}{${selectedText}}]`
  }
  switch (name) {
    case 'stop':    return `[stop]`
    case 'delete':  return `[delete{${PH.arg}}]`   // {target}
    case 'remove':  return `[remove{${PH.arg}}]`   // {value}  (removes from output)
    case 'prepend': return `[prepend{${PH.arg}}]`  // {text}   (prepends to output)
    case 'append':  return `[append{${PH.arg}}]`   // {text}   (appends to output)
    case 'send':    return `[send{${PH.arg}}]`     // {target}
    case 'replace': return `[replace{${PH.arg}}{${PH.arg}}]`  // {from}{to}  (in output)
    default:        return `[${name}{${PH.arg}}]`
  }
}

// ─── Highlight ────────────────────────────────────────────────────────────────
// Strategy: split the source on sentinel chars first so they are never
// passed through escHtml or regex matchers. Each segment between sentinels
// is plain text that gets escaped + token-coloured, then wrapped in
// block-tint spans where appropriate.

function highlight(src: string): string {
  // Split on sentinel chars, keeping the sentinels as their own elements
  const PH_RE = new RegExp(`([${PH_ALL.join('')}])`, 'g')
  const parts = src.split(PH_RE)  // alternates: plain-text, sentinel, plain-text, …

  // Render each part
  const rendered = parts.map(part => {
    // Sentinel → atomic placeholder span
    if (PH_ALL.includes(part)) {
      const cls   = PH_CLASS[part] ?? ''
      const label = PH_LABEL[part] ?? '?'
      return `<span class="tk-placeholder ${cls}" data-ph="${part}" contenteditable="false">${label}</span>`
    }
    // Plain text segment → escape + colour tokens + wrap block tints
    return colourSegment(part)
  })

  return rendered.join('')
}

// Colour a plain-text segment (no sentinels): escape + colour tokens + block tints
// Safe: uses a single linear pass, no recursion, guaranteed progress each iteration.
function colourSegment(src: string): string {
  if (!src) return ''
  // Just escape and colour — block tints are cosmetic, skip them to avoid
  // partial-match infinite loops on unclosed $if( or [action{ fragments.
  return colourTokens(escHtml(src))
}

function escHtml(s: string): string {
  return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
}

// Colour individual DSL tokens in an already-HTML-escaped string
function colourTokens(s: string): string {
  const pat = /(\$if|\$else|\[(?:replace|remove|delete|prepend|append|send|stop|has|=|starts|ends)\]|\{(?:output|input|user|channel|args|regex1|regex2|text1|text2)\}|&lt;do|&gt;)/g
  return s.replace(pat, m => {
    const raw = m.replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&amp;/g,'&')
    let cls = ''
    if (['$if','$else'].includes(raw) || raw === '<do' || raw === '>') cls = 'tk-wrapper'
    else if (OPERATORS.includes(raw)) cls = 'tk-op'
    else if (ACTIONS.includes(raw))   cls = 'tk-action'
    else if (VALUES.includes(raw))    cls = 'tk-value'
    else if (PARAMS.includes(raw))    cls = 'tk-param'
    return cls ? `<span class="${cls}">${m}</span>` : m
  })
}

// ─── Validation ───────────────────────────────────────────────────────────────

const ruleWarnings = computed((): string[] => {
  const r = form.value.rule
  if (!r.trim()) return []
  const w: string[] = []
  // Count unfilled placeholder sentinels
  let ph = 0; for (const p of PH_ALL) ph += (r.split(p).length - 1)
  if (ph > 0) w.push(`${ph} unfilled slot${ph > 1 ? 's' : ''} remaining (coloured labels)`)
  // $if must have matching <do>
  const ifN = (r.match(/\$if\(/g) || []).length
  const doN = (r.match(/<do/g)    || []).length
  if (ifN !== doN) w.push(`${ifN} $if but ${doN} <do> — must match`)
  // Unmatched [ ]
  const bOpen  = (r.match(/\[/g) || []).length
  const bClose = (r.match(/\]/g) || []).length
  if (bOpen !== bClose) w.push(`Unmatched brackets: ${bOpen} [ vs ${bClose} ]`)
  // Unmatched { }  (excluding PH sentinels — those are already counted)
  const rNoSentinels = r.replace(/[\uE001-\uE005]/g, '')
  const cOpen  = (rNoSentinels.match(/\{/g) || []).length
  const cClose = (rNoSentinels.match(/\}/g) || []).length
  if (cOpen !== cClose) w.push(`Unmatched braces: ${cOpen} { vs ${cClose} }`)
  return w
})
const ruleValid = computed(() => ruleWarnings.value.length === 0)

// ─── Plain-text DOM helpers ───────────────────────────────────────────────────
// Walk the editor DOM, recovering sentinel chars from placeholder spans

function getPlainText(el: HTMLElement): string {
  function walk(node: Node): string {
    if (node instanceof HTMLElement && node.classList.contains('tk-placeholder'))
      return node.dataset.ph ?? ''
    if (node.nodeType === Node.TEXT_NODE)
      return node.textContent ?? ''
    return Array.from(node.childNodes).map(walk).join('')
  }
  return walk(el).replace(/\n\n/g, '\n')
}

// Get caret offset in plain-text terms (placeholder span = 1 char)
function getCaretOffset(el: HTMLElement): number {
  const sel = window.getSelection()
  if (!sel || !sel.rangeCount) return 0
  const range = sel.getRangeAt(0)
  if (!el.contains(range.startContainer)) return 0

  let count = 0
  let found = false

  function walk(node: Node): void {
    if (found) return
    if (node instanceof HTMLElement && node.classList.contains('tk-placeholder')) {
      if (node === range.startContainer || node.contains(range.startContainer)) {
        // caret is at/inside the placeholder — count it as before
        found = true; return
      }
      count += 1; return
    }
    if (node.nodeType === Node.TEXT_NODE) {
      if (node === range.startContainer) {
        count += range.startOffset; found = true; return
      }
      count += node.textContent?.length ?? 0; return
    }
    // Element node: check if caret is between children
    if (node === range.startContainer) {
      const children = Array.from(node.childNodes)
      for (let i = 0; i < range.startOffset && !found; i++) {
        const child = children[i]
        if (child) walk(child)
      }
      found = true; return
    }
    for (const child of Array.from(node.childNodes)) { if (!found) walk(child) }
  }

  walk(el)
  return count
}

// Restore caret to plain-text offset
function restoreCaret(el: HTMLElement, offset: number) {
  let remaining = offset
  let placed    = false

  function walk(node: Node): void {
    if (placed) return
    if (node instanceof HTMLElement && node.classList.contains('tk-placeholder')) {
      if (remaining <= 0) {
        const r = document.createRange()
        r.setStartBefore(node); r.collapse(true)
        window.getSelection()?.removeAllRanges()
        window.getSelection()?.addRange(r)
        placed = true; return
      }
      remaining -= 1; return
    }
    if (node.nodeType === Node.TEXT_NODE) {
      const len = node.textContent?.length ?? 0
      if (remaining <= len) {
        const r = document.createRange()
        r.setStart(node, remaining); r.collapse(true)
        window.getSelection()?.removeAllRanges()
        window.getSelection()?.addRange(r)
        placed = true; return
      }
      remaining -= len; return
    }
    for (const child of Array.from(node.childNodes)) { if (!placed) walk(child) }
  }

  walk(el)
  if (!placed) {
    // fallback: end of content
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

// ─── Editor refs & autocomplete ───────────────────────────────────────────────

const editorRef  = ref<HTMLDivElement | null>(null)
const acRef      = ref<HTMLDivElement | null>(null)
const acItems    = ref<string[]>([])
const acIndex    = ref(0)
const acPos      = ref({ top: 0, left: 0 })
const acVisible  = ref(false)
const acTrigger  = ref('')
const acActivePh = ref<string | null>(null)  // which sentinel is being filled

// ─── Insert at caret ──────────────────────────────────────────────────────────

function insertAtCaret(text: string) {
  const el = editorRef.value; if (!el) return
  el.focus()
  const plain  = getPlainText(el)
  const offset = getCaretOffset(el)
  form.value.rule = plain.slice(0, offset) + text + plain.slice(offset)
  applyHighlight()
  nextTick(() => restoreCaret(el, offset + text.length))
}

// Palette click — $if and actions expand to skeletons
function onPaletteClick(tok: string) {
  if (tok === '$if')            { insertAtCaret(ifSkeleton()); return }
  if (ACTIONS.includes(tok))   { insertAtCaret(actionSkeleton(tok)); return }
  insertAtCaret(tok)
}

// ─── Input & keyboard ─────────────────────────────────────────────────────────

function onEditorInput() {
  const el = editorRef.value; if (!el) return
  // Read current caret BEFORE we modify innerHTML
  // (we need to do this before getPlainText, because after innerHTML is set the old
  //  selection is gone — but we saved offset already inside applyHighlight)
  form.value.rule = getPlainText(el)
  applyHighlight()
  checkAutocomplete()
}

function onEditorKeydown(e: KeyboardEvent) {
  // Autocomplete navigation
  if (acVisible.value) {
    if (e.key === 'ArrowDown') { e.preventDefault(); acIndex.value = Math.min(acIndex.value + 1, acItems.value.length - 1); return }
    if (e.key === 'ArrowUp')   { e.preventDefault(); acIndex.value = Math.max(acIndex.value - 1, 0); return }
    if (e.key === 'Enter' || e.key === 'Tab') { e.preventDefault(); insertAcItem(); return }
    if (e.key === 'Escape')    { acVisible.value = false; acActivePh.value = null; return }
  }

  // $if + ( → expand to full skeleton immediately
  if (e.key === '(') {
    const el = editorRef.value; if (!el) return
    const plain  = getPlainText(el)
    const offset = getCaretOffset(el)
    const before = plain.slice(0, offset)
    if (before.trimEnd().endsWith('$if')) {
      e.preventDefault()
      acVisible.value = false
      const trimmed = before.trimEnd()
      const after   = plain.slice(offset)
      const skel    = ifSkeleton()
      form.value.rule = trimmed.slice(0, -3) + skel + after
      applyHighlight()
      nextTick(() => restoreCaret(el, trimmed.length - 3 + skel.length))
      return
    }
  }

  // [ → if typing an action name, expand to skeleton on ]
  // (handled naturally by autocomplete → insertAcItem expansion)
}

// Click on a placeholder span → show slot suggestions dropdown
function onEditorClick(e: MouseEvent) {
  const target = e.target as HTMLElement
  const phSpan = target.classList.contains('tk-placeholder') ? target
    : (target.closest?.('.tk-placeholder') as HTMLElement | null)
  if (!phSpan) { acVisible.value = false; acActivePh.value = null; return }
  const ph = phSpan.dataset.ph ?? ''
  if (!ph || !PH_CANDIDATES[ph]?.length) return
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
  const candidates = allTokens().filter(t => t.startsWith(p) && t !== p)
  if (!candidates.length) { acVisible.value = false; return }
  acTrigger.value = p; acItems.value = candidates; acIndex.value = 0; acVisible.value = true

  const sel = window.getSelection()
  if (sel && sel.rangeCount) {
    const rect = sel.getRangeAt(0).getBoundingClientRect()
    const er   = el.getBoundingClientRect()
    acPos.value = { top: rect.bottom - er.top + 4, left: rect.left - er.left }
  }
}

function insertAcItem() {
  const item = acItems.value[acIndex.value]; if (!item) return
  acVisible.value = false
  const el = editorRef.value; if (!el) return

  // Placeholder fill mode — replace the sentinel char at its position
  if (acActivePh.value) {
    const ph    = acActivePh.value; acActivePh.value = null
    const plain = getPlainText(el)
    const idx   = plain.indexOf(ph); if (idx === -1) return
    // If filling an action slot, expand to full skeleton (with its own arg placeholders)
    // but we're inside <do [...]> so we replace the whole [PH.action{PH.arg}] group
    let insert = item
    if (ph === PH.action && ACTIONS.includes(item)) {
      // Replace the whole [PH.action{PH.arg}] pattern with the full action skeleton
      const fullSlot = PH.action + '{' + PH.arg + '}'
      const hasArgSlot = plain.slice(idx, idx + fullSlot.length) === fullSlot
      const skel = actionSkeleton(item)  // e.g. [remove{arg}] or [stop]
      // We're already inside [ ] from the ifSkeleton, so strip the outer brackets
      // But only if the skeleton actually has them (stop has no inner content)
      insert = skel.slice(1, skel.lastIndexOf(']')) + skel.slice(skel.lastIndexOf(']') + 1)
      // Simpler: just insert the full skeleton and replace the surrounding [ ] too
      // The ifSkeleton puts [PH.action{PH.arg}] so we need to replace all of that
      const sliceEnd = hasArgSlot ? idx + fullSlot.length : idx + 1
      form.value.rule = plain.slice(0, idx - 1) + skel + plain.slice(sliceEnd + 1)
      applyHighlight()
      nextTick(() => restoreCaret(el, idx - 1 + skel.length))
      return
    }
    form.value.rule = plain.slice(0, idx) + insert + plain.slice(idx + 1)
    applyHighlight()
    nextTick(() => restoreCaret(el, idx + insert.length))
    return
  }

  // Typing mode — replace partial typed text with full token, expand $if/actions to skeletons
  acActivePh.value = null
  const plain   = getPlainText(el)
  const offset  = getCaretOffset(el)
  const trigLen = acTrigger.value.length
  const before  = plain.slice(0, offset - trigLen)
  const after   = plain.slice(offset)
  let insert = item
  if (item === '$if')            insert = ifSkeleton()
  else if (ACTIONS.includes(item)) insert = actionSkeleton(item)
  form.value.rule = before + insert + after
  applyHighlight()
  nextTick(() => restoreCaret(el, before.length + insert.length))
}

// ─── Drag & drop ─────────────────────────────────────────────────────────────

function onDragStart(e: DragEvent, tok: string) { e.dataTransfer?.setData('text/plain', tok) }

function getPhSpanAt(e: DragEvent | MouseEvent): HTMLElement | null {
  const els = document.elementsFromPoint(
    (e as DragEvent).clientX ?? (e as MouseEvent).clientX,
    (e as DragEvent).clientY ?? (e as MouseEvent).clientY
  )
  for (const el of els)
    if (el instanceof HTMLElement && el.classList.contains('tk-placeholder')) return el
  return null
}

function onEditorDrop(e: DragEvent) {
  e.preventDefault()
  const tok = e.dataTransfer?.getData('text/plain'); if (!tok) return
  const el = editorRef.value!; el.focus()

  // Drop onto a placeholder slot → fill it
  const phSpan = getPhSpanAt(e)
  if (phSpan) {
    const ph = phSpan.dataset.ph ?? ''
    if (!(PH_CANDIDATES[ph] ?? []).includes(tok)) return  // wrong type
    const plain = getPlainText(el)
    // Find the position of this specific span in the plain text
    let pos = 0
    let phFound = false
    function findPh(node: Node): void {
      if (phFound) return
      if (node === phSpan) { phFound = true; return }
      if (node instanceof HTMLElement && node.classList.contains('tk-placeholder')) { pos += 1; return }
      if (node.nodeType === Node.TEXT_NODE) { pos += node.textContent?.length ?? 0; return }
      for (const c of Array.from(node.childNodes)) { if (!phFound) findPh(c) }
    }
    findPh(el)
    if (phFound) {
      let insert = tok
      let slotLen = 1
      // If filling an action slot, replace the whole [PH.action{PH.arg}] with the full skeleton
      if (ph === PH.action && ACTIONS.includes(tok)) {
        const fullSlot = PH.action + '{' + PH.arg + '}'
        const skel = actionSkeleton(tok)
        // pos points at PH.action; pos-1 is '[', sliceEnd+1 is ']'
        const sliceEnd = plain.slice(pos, pos + fullSlot.length) === fullSlot ? pos + fullSlot.length : pos + 1
        form.value.rule = plain.slice(0, pos - 1) + skel + plain.slice(sliceEnd + 1)
        applyHighlight()
        nextTick(() => restoreCaret(el, pos - 1 + skel.length))
        return
      }
      form.value.rule = plain.slice(0, pos) + insert + plain.slice(pos + slotLen)
      applyHighlight()
      nextTick(() => restoreCaret(el, pos + insert.length))
    }
    return
  }

  // Normal drop — insert at drop position, wrapping any selection
  const sel = window.getSelection()
  let selText = '', selStart = 0, selEnd = 0
  if (sel && sel.rangeCount && el.contains(sel.anchorNode)) {
    const r = sel.getRangeAt(0)
    selText = r.toString()
    const pre = document.createRange(); pre.setStart(el, 0); pre.setEnd(r.startContainer, r.startOffset)
    selStart = pre.toString().length; selEnd = selStart + selText.length
  }
  let dropOff = selStart
  if (!selText && (document as any).caretRangeFromPoint) {
    const r = (document as any).caretRangeFromPoint(e.clientX, e.clientY)
    if (r) { const pre = document.createRange(); pre.setStart(el,0); pre.setEnd(r.startContainer,r.startOffset); dropOff = pre.toString().length }
  }

  let insert: string
  if (tok === '$if')             insert = ifSkeleton()
  else if (ACTIONS.includes(tok)) insert = actionSkeleton(tok, selText.trim())
  else insert = tok

  const plain  = getPlainText(el)
  const before = plain.slice(0, selText ? selStart : dropOff)
  const after  = plain.slice(selText ? selEnd   : dropOff)
  form.value.rule = before + insert + after
  applyHighlight()
  nextTick(() => restoreCaret(el, before.length + insert.length))
}

function onEditorDragover(e: DragEvent) {
  e.preventDefault()
  document.querySelectorAll('.tk-placeholder.drag-over').forEach(el => el.classList.remove('drag-over'))
  getPhSpanAt(e)?.classList.add('drag-over')
}

// ─── Palette ──────────────────────────────────────────────────────────────────

const palette = [
  { group: 'Wrappers',   cls: 'tk-wrapper', tokens: WRAPPERS  },
  { group: 'Operators',  cls: 'tk-op',      tokens: OPERATORS },
  { group: 'Actions',    cls: 'tk-action',  tokens: ACTIONS   },
  { group: 'Values',     cls: 'tk-value',   tokens: VALUES    },
  { group: 'Parameters', cls: 'tk-param',   tokens: PARAMS    },
]

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

          <div class="field-group">
            <label class="field-label">Rule <span class="field-hint">Click palette or type $ [ { — click a coloured slot to fill it</span></label>
            <div class="rule-area">

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
            </div>
          </div>

          <div class="params-row">
            <div class="field-group sm" v-for="p in ['regex1','regex2','text1','text2']" :key="p">
              <label class="field-label"><span class="tk-param inline">{{ '{' + p + '}' }}</span></label>
              <input v-model="(form as any)[p]" class="field-input" :placeholder="p.startsWith('regex') ? 'pattern…' : 'text…'" />
            </div>
          </div>

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
.panel { width: 700px; max-width: 100vw; height: 100vh; background: #1a1a1e; border-left: 1px solid #2a2a30; display: flex; flex-direction: column; overflow: hidden; animation: slideIn .2s ease; }
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

.rule-area { display: flex; gap: 10px; align-items: flex-start; }
.palette { width: 138px; flex-shrink: 0; display: flex; flex-direction: column; gap: 10px; }
.palette-group { display: flex; flex-direction: column; gap: 2px; }
.palette-group-label { font-size: 9px; font-weight: 700; text-transform: uppercase; letter-spacing: .06em; margin-bottom: 3px; opacity: .7; }
.palette-token { display: inline-block; padding: 3px 7px; font-size: 11px; font-family: 'Consolas','Fira Mono',monospace; cursor: pointer; border: 1px solid transparent; transition: opacity .1s; user-select: none; white-space: nowrap; }
.palette-token:hover { opacity: .75; }
.palette-token[draggable="true"] { cursor: grab; }

.editor-wrap { flex: 1; position: relative; }
.rule-editor { min-height: 110px; max-height: 260px; overflow-y: auto; background: #0d0d10; border: 1px solid #2a2a30; padding: 10px 12px; font-family: 'Consolas','Fira Mono',monospace; font-size: 13px; line-height: 1.8; color: #c0c0c0; outline: none; white-space: pre-wrap; word-break: break-all; transition: border-color .15s; }
.rule-editor:focus   { border-color: #6f2bff55; }
.rule-editor.invalid { border-color: #f1494966; }
.rule-editor:empty::before { content: attr(data-placeholder); color: #2a2a35; pointer-events: none; }
.rule-warnings     { margin-top: 5px; display: flex; flex-direction: column; gap: 2px; }
.rule-warning-item { font-size: 11px; color: #f5a623; background: rgba(245,166,35,.08); border-left: 2px solid #f5a62366; padding: 3px 7px; }

.ac-dropdown { position: absolute; z-index: 100; background: #1a1a1e; border: 1px solid #2a2a30; min-width: 160px; max-height: 180px; overflow-y: auto; }
.ac-item { padding: 5px 10px; font-size: 12px; font-family: 'Consolas','Fira Mono',monospace; cursor: pointer; transition: background .1s; }
.ac-item:hover, .ac-item.active { background: #2a2a35; }

:deep(.tk-wrapper), .palette-token.tk-wrapper, .ac-item.tk-wrapper, .palette-group-label.tk-wrapper { color: #569cd6; border-color: #569cd633; }
:deep(.tk-op),      .palette-token.tk-op,      .ac-item.tk-op,      .palette-group-label.tk-op      { color: #c792ea; border-color: #c792ea33; }
:deep(.tk-action),  .palette-token.tk-action,  .ac-item.tk-action,  .palette-group-label.tk-action  { color: #f14949; border-color: #f1494933; }
:deep(.tk-value),   .palette-token.tk-value,   .ac-item.tk-value,   .palette-group-label.tk-value   { color: #4ec9b0; border-color: #4ec9b033; }
:deep(.tk-param),   .palette-token.tk-param,   .ac-item.tk-param,   .palette-group-label.tk-param   { color: #e5c07b; border-color: #e5c07b33; }
:deep(.tk-action-arg) { color: #7ec8a0; border-color: #7ec8a033; }
.tk-param.inline { font-size: 11px; font-family: 'Consolas','Fira Mono',monospace; }
.params-row, .cond-row { display: flex; gap: 10px; }

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
.output-placeholder { display: inline-flex; align-items: center; gap: 2px; background: #0d0d10; border: 1px dashed #252530; padding: 8px 14px; font-family: 'Consolas','Fira Mono',monospace; user-select: none; cursor: default; }
.op-brace { font-size: 20px; color: #2a2a35; line-height: 1; font-weight: 300; }
.op-label { font-size: 13px; color: #333; letter-spacing: .06em; padding: 0 4px; }

.if-block     { background: rgba(86,156,214,.09); border: 1px solid rgba(86,156,214,.18); border-radius: 2px; padding: 1px 3px; display: inline; }
.action-block { background: rgba(241,73,73,.08);  border: 1px solid rgba(241,73,73,.2);  border-radius: 2px; padding: 1px 3px; display: inline; }

.tk-placeholder {
  display: inline-block; padding: 0 5px; border-radius: 2px;
  font-size: 10px; font-style: italic; line-height: 1.6;
  cursor: pointer; user-select: none; vertical-align: middle; opacity: .85;
  transition: opacity .1s, filter .1s;
}
.tk-placeholder:hover { opacity: 1; filter: brightness(1.2); }
.tk-placeholder.tk-value      { color: #4ec9b0; background: rgba(78,201,176,.14);  border: 1px solid rgba(78,201,176,.4);  }
.tk-placeholder.tk-param      { color: #e5c07b; background: rgba(229,192,123,.14); border: 1px solid rgba(229,192,123,.4); }
.tk-placeholder.tk-op         { color: #c792ea; background: rgba(199,146,234,.14); border: 1px solid rgba(199,146,234,.4); }
.tk-placeholder.tk-action     { color: #f14949; background: rgba(241,73,73,.14);   border: 1px solid rgba(241,73,73,.4);   }
.tk-placeholder.tk-action-arg { color: #7ec8a0; background: rgba(126,200,160,.14); border: 1px solid rgba(126,200,160,.4); }
.tk-placeholder.drag-over     { opacity: 1; filter: brightness(1.4); outline: 1px solid currentColor; }
</style>
