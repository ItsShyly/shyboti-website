<script setup lang="ts">
import { ref, watch, computed, nextTick, onMounted, onUnmounted } from 'vue'
import { API } from '../api'
import { useAuth } from '../auth'
import PuzzlePiece from './PuzzlePiece.vue'
import { highlightScript } from '../composables/scriptHighlight'
import { mockEval, resetMockState, DEFAULT_MOCK, type MockContext } from '../composables/scriptMockEval'

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

const loading       = ref(true)
const saving        = ref(false)
const saved         = ref(false)
const deleting      = ref(false)
const deleteConfirm = ref(false)
const ruleOpen      = ref(false)
const ruleTarget    = ref<'output' | 'input'>('output')
const form = ref<CustomCommand>({
  name: '', response: '', rule: '', alias: '', enabled_when: 'always', required_game: '',
  regex1: '', regex2: '', text1: '', text2: '', isActive: true, cooldown: 0, userCooldown: 0,
})

const OPERATORS = ['[has]','[hasnot]','[=]','[starts]','[ends]']
const ACTIONS   = ['[replace]','[remove]','[delete]','[prepend]','[append]','[send]','[stop]']
const VALUES    = ['{output}','{input}','{user}','{channel}','{args}']
const WRAPPERS  = ['$if']

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
watch(userParams, params => {
  for (const p of params) (form.value as any)[p.key] = p.value
}, { deep: true })

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
      userParams.value = userParams.value.map(p => ({ ...p, value: ex ? ((ex as any)[p.key] ?? '') : '' }))
    }
  } catch {}
  loading.value = false
  await nextTick()
  // Normal editor — load response into the script editor
  const nel = normalEditorRef.value
  if (nel) {
    const src = form.value.response || (props.isBuiltIn ? BUILTIN_PREFIX : '')
    nel.innerText = src
    applyNormalHighlight(nel, src)
  }
  updatePreview()
  // Puzzle editor (legacy, kept as fallback)
  const el = editorRef.value
  if (el) el.innerHTML = highlight(form.value.rule)
  const rel = responseRef.value
  if (rel) rel.innerHTML = highlightResponse(form.value.response)
}

watch(() => props.open, v => { if (v) { load(); deleteConfirm.value = false; ruleOpen.value = false } })
onMounted(() => { if (props.open) load() })

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

const PH = {
  value:  '\uE001',
  param:  '\uE002',
  op:     '\uE003',
  action: '\uE004',
  arg:    '\uE005',
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
const PH_CANDIDATES: Record<string, string[]> = {
  [PH.value]:                VALUES,
  get [PH.param]()  { return PARAMS.value },
  [PH.op]:                   OPERATORS,
  [PH.action]:               ACTIONS,
  get [PH.arg]()    { return ARG_TOKENS.value },
}

type PieceKind = 'value' | 'operator' | 'action' | 'param' | 'wrapper'

function tokenKind(tok: string): PieceKind | null {
  if (WRAPPERS.includes(tok))     return 'wrapper'
  if (OPERATORS.includes(tok))    return 'operator'
  if (ACTIONS.includes(tok))      return 'action'
  if (VALUES.includes(tok))       return 'value'
  if (PARAMS.value.includes(tok)) return 'param'
  return null
}
function tokenClass(tok: string): string {
  const k = tokenKind(tok)
  if (!k) return ''
  return { wrapper: 'tk-wrapper', operator: 'tk-op', action: 'tk-action', value: 'tk-value', param: 'tk-param' }[k]
}
function allTokens() { return [...WRAPPERS, ...OPERATORS, ...ACTIONS, ...VALUES, ...PARAMS.value] }

// ── Inline SVG puzzle piece ──────────────────────────────────────────────────
// All pieces: tab-left (sticks OUT left), configurable right side
// rightFlat: wrapper open/close pieces — they terminate, nothing slots into them
// rightNotch (IN): value, operator, action, param — something can slot in from right
// rightFlat overrides the right-side shape to flat (used for <do and >) wrapper tokens)
function puzzleSVG(label: string, kind: PieceKind, rightFlat = false, leftTabOverride?: boolean, displayLabel?: string): string {
  const H = 32, R = 4, TW = 8, TH = 8, TR = 2.5, PX = 12, CW = 6.6
  const sizeLabel = (displayLabel !== undefined && displayLabel.length > label.length) ? displayLabel : label
  const bw = Math.max(52, Math.ceil(sizeLabel.length * CW) + PX * 2)

  // Grammar: wrapper=flat-L|notch-R, all others=tab-L|notch-R
  // leftTab/rightFlat can be overridden per-call for structural tokens like <do and >)
  const leftTab    = leftTabOverride ?? (kind !== 'wrapper')
  const rightNotch = rightFlat ? false : true

  // Body at x=0..bw; tab (if any) protrudes LEFT into -TH..0
  const x0 = 0, y0 = 0, x1 = bw, y1 = H
  const midY = H / 2
  const vbX  = leftTab ? -TH : 0
  const vbW  = leftTab ? bw + TH : bw

  const COLS: Record<PieceKind, { fill: string; stroke: string; text: string }> = {
    value:    { fill: '#0d2520', stroke: '#4ec9b0', text: '#4ec9b0' },
    operator: { fill: '#1c0f2e', stroke: '#c792ea', text: '#c792ea' },
    action:   { fill: '#280b0b', stroke: '#f14949', text: '#f14949' },
    param:    { fill: '#201808', stroke: '#e5c07b', text: '#e5c07b' },
    wrapper:  { fill: '#0b1928', stroke: '#569cd6', text: '#569cd6' },
  }
  const col = COLS[kind]

  const top    = `M${x0+R},${y0} L${x1-R},${y0} Q${x1},${y0} ${x1},${y0+R}`
  const right  = rightNotch
    ? `L${x1},${midY-TW} L${x1-TH+TR},${midY-TW} Q${x1-TH},${midY-TW} ${x1-TH},${midY-TW+TR} L${x1-TH},${midY+TW-TR} Q${x1-TH},${midY+TW} ${x1-TH+TR},${midY+TW} L${x1},${midY+TW} L${x1},${y1-R} Q${x1},${y1} ${x1-R},${y1}`
    : `L${x1},${y1-R} Q${x1},${y1} ${x1-R},${y1}`
  const bottom = `L${x0+R},${y1} Q${x0},${y1} ${x0},${y1-R}`
  const left   = leftTab
    ? `L${x0},${midY+TW} L${x0-TH+TR},${midY+TW} Q${x0-TH},${midY+TW} ${x0-TH},${midY+TW-TR} L${x0-TH},${midY-TW+TR} Q${x0-TH},${midY-TW} ${x0-TH+TR},${midY-TW} L${x0},${midY-TW} L${x0},${y0+R} Q${x0},${y0} ${x0+R},${y0}`
    : `L${x0},${y0+R} Q${x0},${y0} ${x0+R},${y0}`
  const d = `${top} ${right} ${bottom} ${left} Z`

  const tx = bw / 2
  const ty = H / 2

  return `<svg width="${vbW}" height="${H}" viewBox="${vbX} 0 ${vbW} ${H}" xmlns="http://www.w3.org/2000/svg" style="display:inline-block;vertical-align:middle;overflow:visible">`
    + `<path d="${d}" fill="${col.fill}" stroke="${col.stroke}" stroke-width="1.5" stroke-linejoin="round" stroke-linecap="round"/>`
    + `<text x="${tx}" y="${ty}" text-anchor="middle" dominant-baseline="central" fill="${col.text}" font-size="11" font-family="Consolas,Fira Mono,monospace" font-weight="600" letter-spacing="0.02em" pointer-events="none" style="user-select:none">${displayLabel !== undefined ? displayLabel : label}</text>`
    + `</svg>`
}

// Wrap a puzzle SVG as an atomic inline token
// data-tok is used by getPlainText to recover the raw token string
function puzzleSpan(tok: string, kind: PieceKind, rightFlat = false, leftTabOverride?: boolean, displayLabel?: string): string {
  const svg = puzzleSVG(tok, kind, rightFlat, leftTabOverride, displayLabel)
  // draggable="true" enables reordering; data-tok-drag marks it as a draggable piece
  return `<span class="pz-tok" data-tok="${tok}" contenteditable="false" draggable="true" data-tok-drag="1" style="display:inline-block;vertical-align:middle;margin:0 2px;cursor:grab">${svg}</span>`
}

function ifSkeleton() {
  return `$if(${PH.value}${PH.op}${PH.param}<do [${PH.action}${PH.arg}]>)`
}

function actionSkeleton(tok: string, selectedText = ''): string {
  const name = tok.replace(/^\[|\]$/g, '')
  if (selectedText) return `[${name}{${selectedText}}]`
  switch (name) {
    case 'stop':    return `[stop]`
    case 'replace': return `[replace${PH.arg}${PH.arg}]`
    default:        return `[${name}${PH.arg}]`
  }
}

function highlight(src: string): string {
  const PH_SET = new Set(PH_ALL)

  function renderPH(ph: string): string {
    const cls   = PH_CLASS[ph] ?? ''
    const label = PH_LABEL[ph] ?? '?'
    // Render placeholder as a puzzle piece of appropriate kind
    const kindMap: Record<string, PieceKind> = {
      [PH.value]: 'value', [PH.param]: 'param', [PH.op]: 'operator',
      [PH.action]: 'action', [PH.arg]: 'param',
    }
    const k = kindMap[ph]
    if (k) {
      const svg = puzzleSVG(label, k)
      return `<span class="tk-placeholder pz-ph ${cls}" data-ph="${ph}" contenteditable="false" style="display:inline-block;vertical-align:middle;margin:0 1px;opacity:0.35;cursor:pointer">${svg}</span>`
    }
    return `<span class="tk-placeholder ${cls}" data-ph="${ph}" contenteditable="false">${label}</span>`
  }

  let out = ''
  let i   = 0

  while (i < src.length) {
    const ch = src.charAt(i)

    if (PH_SET.has(ch)) {
      out += renderPH(ch); i++; continue
    }

    if (src.startsWith('$if(', i)) {
      let depth = 0, j = i + 4, inner = ''
      while (j < src.length) {
        const cj = src.charAt(j)
        if (cj === '(') depth++
        else if (cj === ')') { if (depth === 0) break; depth-- }
        inner += cj; j++
      }
      // highlight(inner) processes <do...> and leaves do-block intentionally unclosed.
      // We inject >)  into that open do-block, then close do-block, then close if-block.
      const innerHtml = highlight(inner)
      out += `<span class="if-block">${puzzleSpan('$if(', 'wrapper', true)}${innerHtml}${puzzleSpan('>)', 'wrapper', true, true, '')}</span></span>`
      // The extra </span> closes the do-block that highlight(inner) left open
      i = j + 1; continue
    }

    if (src.startsWith('$else{', i)) {
      let depth = 0, j = i + 6, inner = ''
      while (j < src.length) {
        const cj = src.charAt(j)
        if (cj === '{') depth++
        else if (cj === '}') { if (depth === 0) break; depth-- }
        inner += cj; j++
      }
      out += `<span class="if-block">${puzzleSpan('$else{', 'wrapper', true)}${highlight(inner)}${puzzleSpan('}', 'wrapper', true)}</span>`
      i = j + 1; continue
    }

    if (src.startsWith('<do', i)) {
      // find closing > (not consumed by $if — $if's parser stops at ')' not '>')
      let j = i + 3
      while (j < src.length && src.charAt(j) !== '>') j++
      const inner = src.slice(i + 3, j)
      // <do has notch-right (things slot into it); no standalone '>' piece needed here —
      // the closing '>' is part of the >)  piece rendered by the $if wrapper
      // <do shows 'then do'; leave do-block UNCLOSED so $if handler can inject >)  inside it
      out += `<span class="do-block">${puzzleSpan('<do', 'wrapper', false, true, 'then do')}${highlight(inner.trim())}`
      // intentionally no </span> here — $if handler closes it after appending >) piece
      i = j + 1; continue
    }

    // Action: [name...] with known name, OR [PH...] skeleton with placeholder action
    const actionMatch = src.slice(i).match(/^\[(replace|remove|delete|prepend|append|send|stop)/)
    const actionPhMatch = src.charAt(i) === '[' && (PH_SET.has(src.charAt(i + 1)) || src.charAt(i + 1) === ']')
    if (actionMatch || actionPhMatch) {
      if (actionPhMatch) {
        // Skeleton [▪action▪arg] — collect everything between [ and matching ]
        i++ // skip '['
        const phArgs: string[] = []
        while (i < src.length && src.charAt(i) !== ']') {
          if (PH_SET.has(src.charAt(i))) { phArgs.push(src.charAt(i)); i++ }
          else i++ // skip unexpected chars
        }
        if (src.charAt(i) === ']') i++ // skip ']'
        // render as action-block: first PH is the action slot, rest are arg slots
        const actionSlot = phArgs[0] ? renderPH(phArgs[0]) : ''
        const argSlots   = phArgs.slice(1).map(renderPH).join('')
        out += `<span class="action-block" style="display:inline-flex;align-items:center">${actionSlot}${argSlots}</span>`
        continue
      }
      const name = actionMatch![1] ?? ''
      let j = i + 1 + name.length  // skip '[' + name letters
      let args: string[] = []
      let foundClose = false
      while (j < src.length) {
        const c = src.charAt(j)
        if (PH_SET.has(c)) {
          args.push(c); j++
        } else if (c === '{') {
          let tok = '{'; j++
          while (j < src.length && src.charAt(j) !== '}' && !PH_SET.has(src.charAt(j))) {
            tok += src.charAt(j); j++
          }
          if (j < src.length && src.charAt(j) === '}') { tok += '}'; j++ }
          args.push(tok)
        } else if (c === ']') {
          foundClose = true; j++; break
        } else { j++ }
      }
      const actionPiece = puzzleSpan(`[${name}]`, 'action')
      const argPieces   = args.map(a => {
        if (PH_SET.has(a)) return renderPH(a)
        const k = tokenKind(a)
        return k ? puzzleSpan(a, k) : escHtml(a)
      }).join('')
      out += `<span class="action-block" style="display:inline-flex;align-items:center">${actionPiece}${argPieces}</span>`
      i = j; continue
    }

    // scan a plain chunk (no special tokens), then pass to colourTokens
    let chunk = ''
    while (i < src.length) {
      if (PH_SET.has(src.charAt(i))) break
      if (src.startsWith('$if(', i) || src.startsWith('$else{', i) || src.startsWith('<do', i)) break
      if (src.slice(i).match(/^\[(replace|remove|delete|prepend|append|send|stop)/)) break
      chunk += src.charAt(i); i++
    }
    if (chunk) out += colourTokens(chunk)
  }

  return out
}

// colourSegment no longer needed separately — highlight() handles everything
function colourSegment(src: string): string { return highlight(src) }

function escHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

// colourTokens: operates on RAW (un-escaped) source text now, returns HTML with puzzle spans
function colourTokens(raw: string): string {
  const paramKeys = userParams.value.map(p => p.key).join('|')
  const paramPat  = paramKeys ? `|\\{(?:${paramKeys})\\}` : ''
  const pat = new RegExp(
    `(\\$if(?:\\()?|\\$else(?:\{)?` +
    `|\\[(?:replace|remove|delete|prepend|append|send|stop)\\]` +
    `|\\[(?:has|hasnot|=|starts|ends)\\]` +
    `|\\{(?:output|input|user|channel|args)\\}` +
    paramPat +
    `|<do>?|>)`, 'g'
  )
  return raw.replace(pat, tok => {
    const k = tokenKind(tok)
    if (k) return puzzleSpan(tok, k)
    // structural punctuation: keep plain but styled
    if (tok === '<do' || tok === '<do>' || tok === '>') return `<span class="tk-wrapper" style="vertical-align:middle">${escHtml(tok)}</span>`
    return escHtml(tok)
  })
}

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

function getPlainText(el: HTMLElement): string {
  function walk(node: Node): string {
    if (node instanceof HTMLElement) {
      if (node.classList.contains('tk-placeholder')) return node.dataset.ph ?? ''
      if (node.classList.contains('pz-tok'))         return node.dataset.tok ?? ''
    }
    if (node.nodeType === Node.TEXT_NODE) return node.textContent ?? ''
    return Array.from(node.childNodes).map(walk).join('')
  }
  return walk(el).replace(/\n\n/g, '\n')
}

function isAtomic(node: Node): boolean {
  return node instanceof HTMLElement &&
    (node.classList.contains('tk-placeholder') || node.classList.contains('pz-tok'))
}

function getCaretOffset(el: HTMLElement): number {
  const sel = window.getSelection()
  if (!sel || !sel.rangeCount) return 0
  const range = sel.getRangeAt(0)
  if (!el.contains(range.startContainer)) return 0
  let count = 0, found = false
  function walk(node: Node): void {
    if (found) return
    if (isAtomic(node)) {
      if (node === range.startContainer || node.contains(range.startContainer)) { found = true; return }
      count += (node as HTMLElement).dataset.tok?.length ?? (node as HTMLElement).dataset.ph?.length ?? 1; return
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
    if (isAtomic(node)) {
      const len = (node as HTMLElement).dataset.tok?.length ?? (node as HTMLElement).dataset.ph?.length ?? 1
      if (remaining <= 0) {
        const r = document.createRange(); r.setStartBefore(node); r.collapse(true)
        window.getSelection()?.removeAllRanges(); window.getSelection()?.addRange(r)
        placed = true; return
      }
      remaining -= len; return
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

// ── Normal Mode state ──────────────────────────────────────────────────────
const editorMode     = ref<'normal' | 'puzzle'>('normal')
const normalEditorRef = ref<HTMLDivElement | null>(null)
const previewOutput  = ref('')
const refPanelOpen   = ref(false)
const mockCtx        = ref<MockContext>({ ...DEFAULT_MOCK })
let   _normalHighlighting = false
let   _ghostEl: HTMLElement | null = null

// Ghost autocomplete — shown inline after cursor
const ghostSuggestion = ref('')  // the suffix to complete (e.g. 'f(' when you typed '$i')
const ghostFull       = ref('')  // the full match that would be inserted
const ghostMatches    = ref<string[]>([])  // all matches for cycling
const ghostMatchIdx   = ref(0)             // current cycle position

// Autocomplete dropdown for Normal Mode
const nmAcVisible  = ref(false)
const nmAcItems    = ref<{ token: string; group: string; desc: string }[]>([])
const nmAcIndex    = ref(0)
const nmAcPos      = ref({ top: 0, left: 0 })
const nmAcPartial  = ref('')  // current partial text, e.g. '$co'
const nmAcRef      = ref<HTMLDivElement | null>(null)

// All completable tokens for Normal Mode
const COMPLETIONS = [
  '$if()', '$else', '$end', '$foreach()', '$repeat()', '$define',
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

// ── Variable reference data ─────────────────────────────────────────────
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

// Render a reference token with user-supplied name segments in a distinct colour.
// Two cases:
//   1. Name after a dotted prefix: $counter.name, $var.name, $list.name etc.
//   2. Argument placeholders inside (): url, user, min, max, seconds, fmt, etc.
function renderRefToken(token: string): string {
  // Step 1: highlight the user-chosen name after known dotted prefixes
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
  // Step 2: highlight word-args inside () — these are always placeholder names
  // e.g. $http.get(url), $mod.timeout(user,seconds), $random.int(min,max)
  // Match the paren section and wrap each comma-separated word in a span.
  result = result.replace(/\(([^)]+)\)/g, (_, inner: string) => {
    const colored = inner.split(',').map(part => {
      const trimmed = part.trim()
      // Only color pure word tokens (no $ or special chars) — these are param names
      if (/^[a-zA-Z_]\w*$/.test(trimmed)) {
        return `<span class="ref-token-name">${trimmed}</span>`
      }
      return part
    }).join(',')
    return `(${colored})`
  })
  return result
}

// COMPLETIONS_META: flat list with group+desc for dropdown display
const COMPLETIONS_META: { token: string; group: string; desc: string }[] = [
  // Control Flow
  { token: '$if()',       group: 'Control Flow', desc: 'Conditional block' },
  { token: '$else',       group: 'Control Flow', desc: 'Else branch' },
  { token: '$end',        group: 'Control Flow', desc: 'End block' },
  { token: '$foreach()',  group: 'Control Flow', desc: 'Loop over list' },
  { token: '$repeat()',   group: 'Control Flow', desc: 'Repeat n times' },
  { token: '$define',     group: 'Control Flow', desc: 'Define a macro' },
  { token: '$index',      group: 'Control Flow', desc: 'Current loop index' },
  // Counters
  { token: '$counter.',   group: 'Counters', desc: 'Increment +1, return value' },
  { token: '$ucounter.',  group: 'Counters', desc: 'Per-user counter' },
  // Variables
  { token: '$var.',       group: 'Variables', desc: 'Read/write variable' },
  { token: '$uvar.',      group: 'Variables', desc: 'Per-user variable' },
  // Lists
  { token: '$list.',      group: 'Lists', desc: 'Random item from list' },
  // User
  { token: '$user',           group: 'User', desc: 'Sending user (login name)' },
  { token: '$user.name',      group: 'User', desc: 'Login name' },
  { token: '$user.display',   group: 'User', desc: 'Display name' },
  { token: '$user.mention',   group: 'User', desc: '@DisplayName' },
  { token: '$user.followage', group: 'User', desc: 'How long following' },
  { token: '$user.is(mod)',         group: 'User', desc: 'true/false' },
  { token: '$user.is(sub)',         group: 'User', desc: 'true/false' },
  { token: '$user.is(vip)',         group: 'User', desc: 'true/false' },
  { token: '$user.is(broadcaster)', group: 'User', desc: 'true/false' },
  { token: '$target.name',    group: 'User', desc: 'First arg as user' },
  { token: '$target.mention', group: 'User', desc: '@target' },
  // Message
  { token: '$message.text',   group: 'Message', desc: 'Full message text' },
  { token: '$message.id',     group: 'Message', desc: 'Message ID' },
  { token: '$message.length', group: 'Message', desc: 'Character count' },
  // Arguments
  { token: '$args',       group: 'Arguments', desc: 'All arguments' },
  { token: '$args.count', group: 'Arguments', desc: 'Number of args' },
  { token: '$1',          group: 'Arguments', desc: 'First arg' },
  { token: '$2',          group: 'Arguments', desc: 'Second arg' },
  { token: '$3',          group: 'Arguments', desc: 'Third arg' },
  { token: '$query',      group: 'Arguments', desc: 'Alias for $args' },
  // Channel
  { token: '$channel.name',    group: 'Channel', desc: 'Channel login' },
  { token: '$channel.title',   group: 'Channel', desc: 'Stream title' },
  { token: '$channel.game',    group: 'Channel', desc: 'Current game' },
  { token: '$channel.viewers', group: 'Channel', desc: 'Viewer count' },
  { token: '$channel.isLive',  group: 'Channel', desc: 'true/false' },
  { token: '$channel.uptime',  group: 'Channel', desc: 'Stream uptime' },
  // Command
  { token: '$command.output', group: 'Command', desc: 'Built-in command output' },
  { token: '$command.uses',   group: 'Command', desc: 'Times used' },
  { token: '$command.name',   group: 'Command', desc: 'Command name' },
  // Random
  { token: '$random.int(,)',    group: 'Random', desc: 'Random integer' },
  { token: '$random.pick(,)',   group: 'Random', desc: 'Random from list' },
  { token: '$random.chance()',  group: 'Random', desc: 'true with pct% chance' },
  // Text
  { token: '$text.upper()',    group: 'Text', desc: 'Uppercase' },
  { token: '$text.lower()',    group: 'Text', desc: 'Lowercase' },
  { token: '$text.replace(,,)', group: 'Text', desc: 'Replace substring' },
  { token: '$text.contains(,)', group: 'Text', desc: 'true/false' },
  { token: '$text.len()',       group: 'Text', desc: 'String length' },
  { token: '$text.trim()',      group: 'Text', desc: 'Trim whitespace' },
  { token: '$calc()',           group: 'Text', desc: 'Math expression' },
  // Time
  { token: '$time.now',        group: 'Time', desc: 'Current ISO timestamp' },
  { token: '$time.unix',       group: 'Time', desc: 'Unix timestamp (seconds)' },
  { token: '$time.ago()',      group: 'Time', desc: 'Human time since ts' },
  { token: '$time.format(,)',  group: 'Time', desc: 'Format timestamp' },
  // HTTP
  { token: '$http.get()',      group: 'HTTP', desc: 'GET request' },
  { token: '$http.post(,)',    group: 'HTTP', desc: 'POST request' },
  { token: '$http.json(,)',    group: 'HTTP', desc: 'GET + extract JSON path' },
  // Twitch
  { token: '$twitch.uptime',   group: 'Twitch', desc: 'Stream uptime' },
  { token: '$twitch.game',     group: 'Twitch', desc: 'Current game' },
  { token: '$twitch.title',    group: 'Twitch', desc: 'Stream title' },
  { token: '$twitch.followers()', group: 'Twitch', desc: 'Follower count' },
  // Moderation
  { token: '$mod.timeout(,)',  group: 'Moderation', desc: 'Timeout user' },
  { token: '$mod.ban()',       group: 'Moderation', desc: 'Ban user' },
  { token: '$mod.delete()',    group: 'Moderation', desc: 'Delete message' },
]

const GROUP_COLORS: Record<string, { bg: string; text: string }> = {
  'Control Flow': { bg: 'rgba(86,156,214,.15)',  text: '#569cd6' },
  'Counters':     { bg: 'rgba(229,192,123,.12)', text: '#e5c07b' },
  'Variables':    { bg: 'rgba(229,192,123,.12)', text: '#e5c07b' },
  'Lists':        { bg: 'rgba(229,192,123,.12)', text: '#e5c07b' },
  'User':         { bg: 'rgba(78,201,176,.12)',  text: '#4ec9b0' },
  'Message':      { bg: 'rgba(78,201,176,.10)',  text: '#4ec9b0' },
  'Arguments':    { bg: 'rgba(78,201,176,.10)',  text: '#4ec9b0' },
  'Channel':      { bg: 'rgba(199,146,234,.12)', text: '#c792ea' },
  'Command':      { bg: 'rgba(199,146,234,.12)', text: '#c792ea' },
  'Random':       { bg: 'rgba(241,73,73,.10)',   text: '#f14949' },
  'Text':         { bg: 'rgba(35,209,139,.08)',  text: '#23d18b' },
  'Time':         { bg: 'rgba(35,209,139,.08)',  text: '#23d18b' },
  'HTTP':         { bg: 'rgba(245,166,35,.10)',  text: '#f5a623' },
  'Twitch':       { bg: 'rgba(145,71,255,.12)',  text: '#9147ff' },
  'Moderation':   { bg: 'rgba(241,73,73,.12)',   text: '#f14949' },
}

function updatePreview() {
  try {
    resetMockState()
    previewOutput.value = mockEval(form.value.response, mockCtx.value)
  } catch { previewOutput.value = '[preview error]' }
}

watch(() => form.value.response, () => updatePreview(), { flush: 'post' })

watch(mockCtx, () => updatePreview(), { deep: true })

// ── Normal editor input handler ──────────────────────────────────────────────

const BUILTIN_PREFIX = '$command.output'

function onNormalInput() {
  const el = normalEditorRef.value; if (!el) return
  removeGhostSpan()  // remove ghost before reading text so it doesn't pollute innerText
  let text = el.innerText.replace(/\n$/, '')
  // Guard: built-in commands must always start with the locked prefix
  if (props.isBuiltIn && !text.startsWith(BUILTIN_PREFIX)) {
    text = BUILTIN_PREFIX + (text.startsWith('$command.outpu') ? text.slice(text.indexOf(BUILTIN_PREFIX.slice(-1)) + 1) : '\n' + text)
    el.innerText = text
  }
  form.value.response = text
  applyNormalHighlight(el, text)
  updateGhost(el, text)
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
  // Subtract any ghost-inline text that got included (ghost spans are before cursor in DOM order sometimes)
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
  // Move caret back to before the ghost span
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
  // Reset cycle index when partial changes
  if (partial !== _lastGhostPartial) { ghostMatchIdx.value = 0; _lastGhostPartial = partial }
  ghostMatches.value = matches
  if (ghostMatchIdx.value >= matches.length) ghostMatchIdx.value = 0
  const match = matches[ghostMatchIdx.value]!
  const suffix = match.slice(partial.length)
  ghostSuggestion.value = suffix
  ghostFull.value = match
  nextTick(() => insertGhostSpan(suffix))
}

// Accept the current ghost suggestion — shared by Tab and ArrowRight
function acceptCurrentGhost() {
  const el = normalEditorRef.value; if (!el) return
  const offset  = getTextOffset(el)
  const text    = form.value.response  // use model (clean), not innerText (which includes ghost span)
  const before  = text.slice(0, offset)
  const after   = text.slice(offset)
  const m       = before.match(/(\$[\w.]*)$/)
  const partial = m?.[1] ?? ''
  const full    = partial + ghostSuggestion.value
  let insert = full
  let cursorOffset = before.length - partial.length + full.length
  if (full === '$if()') {
    insert = '$if()\n  \n$end'; cursorOffset = before.length - partial.length + 4
  } else if (full === '$foreach()') {
    insert = '$foreach( in )\n  \n$end'; cursorOffset = before.length - partial.length + 9
  } else if (full === '$repeat()') {
    insert = '$repeat()\n  \n$end'; cursorOffset = before.length - partial.length + 8
  }
  const newText = before.slice(0, before.length - partial.length) + insert + after
  form.value.response = newText
  el.innerText = newText
  applyNormalHighlight(el, newText)
  nextTick(() => restoreTextOffset(el, cursorOffset))
  ghostSuggestion.value = ''; ghostMatches.value = []; ghostMatchIdx.value = 0; _lastGhostPartial = ''
}

function onNormalKeydown(e: KeyboardEvent) {
  // Guard prefix for built-in commands
  if (props.isBuiltIn) {
    const el = normalEditorRef.value; if (!el) return
    const offset = getTextOffset(el)
    if ((e.key === 'Backspace' && offset <= BUILTIN_PREFIX.length) ||
        (e.key === 'Delete'    && offset < BUILTIN_PREFIX.length)) {
      e.preventDefault(); return
    }
  }
  // ArrowRight: accept ghost suggestion if one is active
  if (e.key === 'ArrowRight' && ghostSuggestion.value) {
    e.preventDefault()
    acceptCurrentGhost()
    return
  }
  // Tab key handling
  if (e.key === 'Tab') {
    e.preventDefault()
    const el = normalEditorRef.value; if (!el) return
    if (ghostMatches.value.length > 1 && e.shiftKey === false && ghostSuggestion.value) {
      // Cycle to next match on repeated Tab
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
      // No suggestion — insert 2 spaces (stay in editor like a code editor)
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
  // Enter: default behaviour (line break)
}

const editorRef  = ref<HTMLDivElement | null>(null)
const acRef      = ref<HTMLDivElement | null>(null)
const acItems    = ref<string[]>([])
const acIndex    = ref(0)
const acPos      = ref({ top: 0, left: 0 })
const acVisible  = ref(false)
const acTrigger  = ref('')
const acActivePh = ref<string | null>(null)
const acSwapTok  = ref<string | null>(null)  // token being swapped via left-click
let   draggedTok = ''                        // token being dragged from inside the editor

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

  // Left-click on a real puzzle piece (pz-tok) → open swap picker
  const tokSpan = (target.classList.contains('pz-tok') ? target
    : target.closest?.('.pz-tok') as HTMLElement | null)
  if (tokSpan && tokSpan.dataset.tok) {
    e.preventDefault()
    const tok   = tokSpan.dataset.tok
    const kind  = tokenKind(tok)
    if (!kind) return
    // Build candidate list for this kind
    const candidates: Record<PieceKind, string[]> = {
      wrapper:  WRAPPERS,
      operator: OPERATORS,
      action:   ACTIONS,
      value:    VALUES,
      param:    PARAMS.value,
    }
    acItems.value    = candidates[kind]
    acIndex.value    = acItems.value.indexOf(tok)
    acTrigger.value  = tok
    acActivePh.value = null
    acSwapTok.value  = tok
    acVisible.value  = true
    const rect = tokSpan.getBoundingClientRect()
    const er   = editorRef.value!.getBoundingClientRect()
    acPos.value = { top: rect.bottom - er.top + 4, left: rect.left - er.left }
    return
  }

  const phSpan = target.classList.contains('tk-placeholder') ? target
    : (target.closest?.('.tk-placeholder') as HTMLElement | null)
  if (!phSpan) { acVisible.value = false; acActivePh.value = null; acSwapTok.value = null; return }
  const ph = phSpan.dataset.ph ?? ''
  if (!ph || !(PH_CANDIDATES[ph]?.length)) return
  e.preventDefault()
  acActivePh.value = ph
  acSwapTok.value  = null
  acItems.value    = PH_CANDIDATES[ph]
  acIndex.value    = 0; acTrigger.value = ''; acVisible.value = true
  const rect = phSpan.getBoundingClientRect()
  const er   = editorRef.value!.getBoundingClientRect()
  acPos.value = { top: rect.bottom - er.top + 4, left: rect.left - er.left }
}

// Right-click on a pz-tok → delete it (replace with placeholder if inside action/if context)
function onEditorContextMenu(e: MouseEvent) {
  const target = e.target as HTMLElement
  const tokSpan = (target.classList.contains('pz-tok') ? target
    : target.closest?.('.pz-tok') as HTMLElement | null) as HTMLElement | null
  if (!tokSpan || !tokSpan.dataset.tok) return
  e.preventDefault()
  const tok = tokSpan.dataset.tok

  // Structural wrapper pieces that cannot be deleted independently
  if (tok === '<do' || tok === '>)') return

  const plain = getPlainText(editorRef.value!)
  const idx   = plain.indexOf(tok)
  if (idx === -1) return

  // For wrapper opening tokens, delete the entire $if(...) / $else{...} block
  let deleteStart = idx
  let deleteEnd   = idx + tok.length
  if (tok === '$if(') {
    let depth = 0, k = idx + 4
    while (k < plain.length) {
      if (plain[k] === '(') depth++
      else if (plain[k] === ')') { if (depth === 0) { deleteEnd = k + 1; break }; depth-- }
      k++
    }
    form.value.rule = plain.slice(0, deleteStart) + plain.slice(deleteEnd)
    applyHighlight(); nextTick(() => restoreCaret(editorRef.value!, deleteStart)); return
  }
  if (tok === '$else{') {
    let depth = 0, k = idx + 6
    while (k < plain.length) {
      if (plain[k] === '{') depth++
      else if (plain[k] === '}') { if (depth === 0) { deleteEnd = k + 1; break }; depth-- }
      k++
    }
    form.value.rule = plain.slice(0, deleteStart) + plain.slice(deleteEnd)
    applyHighlight(); nextTick(() => restoreCaret(editorRef.value!, deleteStart)); return
  }

  // Action piece: find the whole [action{args}] in plain text and replace with fresh skeleton
  // so orphaned arg placeholders don't linger
  if (ACTIONS.includes(tok)) {
    // The action token in plain text is e.g. "[remove]" stored as data-tok
    // Around it in the rule string is [...args...] — find the enclosing action block
    const actionStart = plain.lastIndexOf('[', idx)  // opening '[' before the action name
    let actionEnd = idx + tok.length
    // skip past any following arg tokens (PH or real) until ']'
    // Actually in the plain-text repr, the skeleton is stored as PH chars with no brackets
    // The action block in plain is: PH.action + PH.arg... or [name]{arg}...
    // Since tok = "[remove]" etc., we need to consume args after it
    while (actionEnd < plain.length) {
      const c = plain[actionEnd]!
      if (PH_ALL.includes(c)) { actionEnd++; continue }  // placeholder arg
      if (c === '{') { // real arg token like {text1}
        while (actionEnd < plain.length && plain[actionEnd] !== '}') actionEnd++
        actionEnd++; continue
      }
      break
    }
    // Replace the action + its args with just the action placeholder skeleton
    const replacement = PH.action + PH.arg  // one action slot + one arg slot
    form.value.rule = plain.slice(0, idx) + replacement + plain.slice(actionEnd)
    applyHighlight(); nextTick(() => restoreCaret(editorRef.value!, idx + replacement.length)); return
  }

  // Arg/value/operator/param piece: replace with appropriate placeholder
  const kind = tokenKind(tok)
  const kindToPh: Record<PieceKind, string> = {
    value:    PH.value,
    operator: PH.op,
    action:   PH.action,
    param:    PH.param,
    wrapper:  '',
  }
  const replacement = kind ? (kindToPh[kind] ?? '') : ''
  form.value.rule = plain.slice(0, idx) + replacement + plain.slice(deleteEnd)
  applyHighlight()
  nextTick(() => restoreCaret(editorRef.value!, idx + replacement.length))
}

function checkAutocomplete() {
  if (acActivePh.value) return
  const el = editorRef.value; if (!el) return
  const plain  = getPlainText(el)
  const offset = getCaretOffset(el)
  const before = plain.slice(0, offset)
  const partial = before.match(/(\$[\w]*|\[[\w=]*|\{[\w]*)$/)
  if (!partial) { acVisible.value = false; return }
  const p = partial[0]
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

  // Swap an existing token for another of the same kind
  if (acSwapTok.value) {
    const oldTok = acSwapTok.value; acSwapTok.value = null
    const plain  = getPlainText(el)
    const idx    = plain.indexOf(oldTok)
    if (idx === -1) return
    let insert = item
    if (item === '$if')              insert = ifSkeleton()
    else if (ACTIONS.includes(item)) insert = actionSkeleton(item)
    form.value.rule = plain.slice(0, idx) + insert + plain.slice(idx + oldTok.length)
    applyHighlight()
    nextTick(() => restoreCaret(el, idx + insert.length))
    return
  }

  if (acActivePh.value) {
    const ph = acActivePh.value; acActivePh.value = null
    const plain = getPlainText(el)
    const idx   = plain.indexOf(ph); if (idx === -1) return
    if (ph === PH.action && ACTIONS.includes(item)) {
      const skel = actionSkeleton(item)
      // [ and ] are eaten by highlight()/getPlainText — plain has just ▪action▪arg▪arg...
      // Replace from ▪action through all consecutive ▪arg PHs with the new skeleton.
      let sliceEnd = idx + 1
      while (plain.charAt(sliceEnd) === PH.arg) sliceEnd++
      form.value.rule = plain.slice(0, idx) + skel + plain.slice(sliceEnd)
      applyHighlight(); nextTick(() => restoreCaret(el, idx + skel.length))
      return
    }
    form.value.rule = plain.slice(0, idx) + item + plain.slice(idx + 1)
    applyHighlight(); nextTick(() => restoreCaret(el, idx + item.length))
    return
  }

  const plain   = getPlainText(el)
  const offset  = getCaretOffset(el)
  const trigLen = acTrigger.value.length
  const before  = plain.slice(0, offset - trigLen)
  const after   = plain.slice(offset)
  let insert = item
  if (item === '$if')              insert = ifSkeleton()
  else if (ACTIONS.includes(item)) insert = actionSkeleton(item)
  form.value.rule = before + insert + after
  applyHighlight()
  nextTick(() => restoreCaret(el, before.length + insert.length))
}

function onDragStart(e: DragEvent, tok: string) {
  e.dataTransfer?.setData('text/plain', tok)
}

// Drag start from a piece already inside the editor
function onEditorDragStart(e: DragEvent) {
  const target = e.target as HTMLElement
  const tokSpan = (target.classList.contains('pz-tok') ? target
    : target.closest?.('.pz-tok') as HTMLElement | null) as HTMLElement | null
  if (!tokSpan || !tokSpan.dataset.tok) { e.preventDefault(); return }
  draggedTok = tokSpan.dataset.tok
  e.dataTransfer?.setData('text/plain', draggedTok)
  e.dataTransfer?.setData('text/x-editor-drag', '1') // marks as internal move
  // Remove the piece from its current position after a tick (so it renders as a ghost)
  nextTick(() => {
    if (!draggedTok) return
    const plain = getPlainText(editorRef.value!)
    const idx   = plain.indexOf(draggedTok)
    if (idx === -1) return
    form.value.rule = plain.slice(0, idx) + plain.slice(idx + draggedTok.length)
    applyHighlight()
  })
}

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
      // [ and ] are eaten by highlight()/getPlainText - replace from pos through all arg PHs
      let sliceEnd = pos + 1
      while (plain.charAt(sliceEnd) === PH.arg) sliceEnd++
      form.value.rule = plain.slice(0, pos) + skel + plain.slice(sliceEnd)
      applyHighlight(); nextTick(() => restoreCaret(el, pos + skel.length))
      return
    }
    form.value.rule = plain.slice(0, pos) + tok + plain.slice(pos + 1)
    applyHighlight(); nextTick(() => restoreCaret(el, pos + tok.length))
    return
  }

  let dropOff = 0
  if ((document as any).caretRangeFromPoint) {
    const r = (document as any).caretRangeFromPoint(e.clientX, e.clientY)
    if (r) {
      const pre = document.createRange(); pre.setStart(el, 0); pre.setEnd(r.startContainer, r.startOffset)
      dropOff = pre.toString().length
    }
  }
  const plain = getPlainText(el)
  const insert = tok === '$if' ? ifSkeleton() : ACTIONS.includes(tok) ? actionSkeleton(tok) : tok
  form.value.rule = plain.slice(0, dropOff) + insert + plain.slice(dropOff)
  applyHighlight(); nextTick(() => restoreCaret(el, dropOff + insert.length))
}

function onEditorDragover(e: DragEvent) {
  e.preventDefault()
  document.querySelectorAll('.tk-placeholder.drag-over').forEach(el => el.classList.remove('drag-over'))
  getPhSpanAt(e)?.classList.add('drag-over')
}

// ─── Response field highlighting ───────────────────────────────────────────
const responseRef = ref<HTMLDivElement | null>(null)
let _applyingResponseHighlight = false

function highlightResponse(src: string): string {
  const paramKeys = userParams.value.map(p => p.key).join('|')
  const paramPat  = paramKeys ? `|\\{(?:${paramKeys})\\}` : ''
  const pat = new RegExp(
    `(\\{(?:output|input|user|channel|args)\\}` + paramPat + `)`, 'g'
  )
  return escHtml(src).replace(pat, m => {
    const raw = m.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    const cls = VALUES.includes(raw) ? 'tk-value' : PARAMS.value.includes(raw) ? 'tk-param' : ''
    return cls ? `<span class="${cls}">${m}</span>` : m
  })
}

function getResponseCaretOffset(el: HTMLElement): number {
  const sel = window.getSelection()
  if (!sel || !sel.rangeCount) return 0
  const range = sel.getRangeAt(0)
  if (!el.contains(range.startContainer)) return 0
  const pre = document.createRange()
  pre.setStart(el, 0)
  pre.setEnd(range.startContainer, range.startOffset)
  return pre.toString().length
}

function restoreResponseCaret(el: HTMLElement, offset: number) {
  let remaining = offset, placed = false
  function walk(node: Node): void {
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
    for (const c of Array.from(node.childNodes)) { if (!placed) walk(c) }
  }
  walk(el)
  if (!placed) {
    const r = document.createRange(); r.selectNodeContents(el); r.collapse(false)
    window.getSelection()?.removeAllRanges(); window.getSelection()?.addRange(r)
  }
}

function onResponseInput() {
  const el = responseRef.value; if (!el) return
  const offset = getResponseCaretOffset(el)
  const text = el.innerText.replace(/\n$/, '')
  form.value.response = text
  _applyingResponseHighlight = true
  el.innerHTML = highlightResponse(text)
  _applyingResponseHighlight = false
  nextTick(() => restoreResponseCaret(el, offset))
}

watch(() => form.value.response, val => {
  if (_applyingResponseHighlight) return
  const el = responseRef.value; if (!el) return
  el.innerHTML = highlightResponse(val)
}, { flush: 'post' })

const simInput    = ref('')
const simUser     = ref('testuser')
const simResult   = ref<{ output: string; send: boolean; errors: string[] } | null>(null)
const simExpanded = ref(false)

function simulateRule() {
  const errors: string[] = []
  const rule = ruleForSave(form.value.rule)
  if (!rule.trim()) { simResult.value = { output: '', send: true, errors: ['No rule to simulate'] }; return }

  const ctx = {
    input:   simInput.value,
    output:  form.value.response || simInput.value,
    user:    simUser.value || 'testuser',
    channel: props.channel || 'testchannel',
    args:    simInput.value,
    ...Object.fromEntries(userParams.value.map(p => [p.key, p.value])),
  }

  try {
    let vars: Record<string, string> = { output: ctx.output }
    let src = rule.trim()
    let send = true

    function resolveVal(name: string): string {
      if (name in vars) return vars[name] ?? ''
      return (ctx as any)[name] ?? ''
    }

    function execActs(actSrc: string): boolean {
      const normalized = actSrc.replace(/\[(replace|remove|delete|prepend|append|send|stop)((?:\{[\w]+\})*)\]/g, '[$1]$2')
      const ACTION_RE = /\[(replace|remove|delete|prepend|append|send|stop)\]((?:\{[\w]+\})*)/g
      for (const m of normalized.matchAll(ACTION_RE)) {
        const action   = m[1] ?? ''
        const argNames = [...(m[2] ?? '').matchAll(/\{([\w]+)\}/g)].map((a: RegExpMatchArray) => a[1] ?? '')
        const args     = argNames.map(resolveVal)
        const twoArg   = ['remove','replace','prepend','append']
        const target   = (twoArg.includes(action) && argNames.length === 1) ? 'output' : (argNames[0] ?? 'output')
        const val0 = args[0] ?? '', val1 = args[1] ?? ''
        if (action === 'stop') return true
        switch (action) {
          case 'delete':  vars[target] = ''; break
          case 'prepend': vars[target] = (argNames.length === 1 ? val0 : val1) + (vars[target] ?? ''); break
          case 'append':  vars[target] = (vars[target] ?? '') + (argNames.length === 1 ? val0 : val1); break
          case 'remove': { const rv = argNames.length === 1 ? val0 : val1; vars[target] = (vars[target] ?? resolveVal(target)).split(rv).join(''); break }
          case 'replace':
            if (argNames.length <= 2) vars['output'] = (vars['output'] ?? ctx.output).split(val0).join(val1)
            else vars[target] = (vars[target] ?? '').split(val1).join(args[2] ?? '')
            break
          case 'send': vars['__send__'] = resolveVal(argNames[0] ?? 'output'); break
        }
      }
      return false
    }

    function evalCond(cond: string): boolean {
      const cm = cond.match(/^\{([\w]+)\}\[([\w=<>]+)\]\{([\w]+)\}$/)
      if (!cm) { errors.push(`Invalid condition syntax: "${cond}"`); return false }
      const left = resolveVal(cm[1] ?? ''), op = cm[2] ?? '', right = resolveVal(cm[3] ?? '')
      const lN = parseFloat(left), rN = parseFloat(right), num = !isNaN(lN) && !isNaN(rN)
      switch (op) {
        case 'has':    return left.includes(right)
        case 'hasnot': return !left.includes(right)
        case '=':      return left === right
        case 'starts': return left.startsWith(right)
        case 'ends':   return left.endsWith(right)
        case '<':  return num ? lN < rN  : left < right
        case '>':  return num ? lN > rN  : left > right
        case '<=': return num ? lN <= rN : left <= right
        case '>=': return num ? lN >= rN : left >= right
        default: errors.push(`Unknown operator: [${op}]`); return false
      }
    }

    let safety = 0
    while (src.includes('$if(') && safety++ < 20) {
      const start = src.indexOf('$if(')
      let depth = 0, idx = start + 4, inner = ''
      for (; idx < src.length; idx++) {
        const ci = src.charAt(idx)
        if (ci === '(') depth++
        else if (ci === ')') { if (depth === 0) break; depth-- }
        inner += ci
      }
      const full = src.slice(start, idx + 1)
      const doStart = inner.indexOf('<do')
      if (doStart === -1) { errors.push('Missing <do> in $if'); break }
      let doEnd = -1, bd = 0
      for (let k = doStart + 3; k < inner.length; k++) {
        const ck = inner.charAt(k)
        if (ck === '[') bd++
        else if (ck === ']') bd--
        else if (ck === '>' && bd === 0) { doEnd = k; break }
      }
      if (doEnd === -1) { errors.push('Unclosed <do> in $if'); break }
      const condition = inner.slice(0, doStart).trim()
      const doBlock   = inner.slice(doStart + 3, doEnd).trim()
      const rest      = inner.slice(doEnd + 1).trim()
      const elseMatch = rest.match(/^\$else\{(.*)\}$/)
      const elseBlock = elseMatch ? (elseMatch[1] ?? '').trim() : ''
      const condTrue  = evalCond(condition)
      const block     = condTrue ? doBlock : elseBlock
      if (block) { if (execActs(block)) { send = false; break } }
      src = src.replace(full, '').trim()
    }

    if (send && src.trim()) { if (execActs(src)) send = false }

    const finalOutput = vars['__send__'] ?? vars['output'] ?? ctx.output
    simResult.value = { output: finalOutput, send, errors }
  } catch (e: any) {
    simResult.value = { output: '', send: false, errors: [`Runtime error: ${e?.message ?? e}`] }
  }
}

const palette = computed(() => [
  { group: 'Wrappers',   kind: 'wrapper'  as PieceKind, tokens: WRAPPERS     },
  { group: 'Operators',  kind: 'operator' as PieceKind, tokens: OPERATORS    },
  { group: 'Actions',    kind: 'action'   as PieceKind, tokens: ACTIONS      },
  { group: 'Values',     kind: 'value'    as PieceKind, tokens: VALUES       },
  { group: 'Parameters', kind: 'param'    as PieceKind, tokens: PARAMS.value },
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

          <!-- ── Response / Script editor ── -->
          <div class="field-group">
            <label class="field-label">
              Response
              <span class="field-hint">full scripting language — <code class="hint-code">$</code> to start a variable</span>
            </label>

            <!-- locked $command.output prefix for built-in commands -->
            <div v-if="isBuiltIn" class="builtin-prefix-row">
              <span class="builtin-prefix-token">$command.output</span>
              <span class="builtin-prefix-hint">locked — wrap your script around this</span>
            </div>

            <div class="normal-editor-container">
              <div
                ref="normalEditorRef"
                class="normal-editor"
                contenteditable="true"
                spellcheck="false"
                :data-placeholder="isBuiltIn ? '$text.upper($command.output)' : 'Hello $user.mention! $if($args) You said: $args $end'"
                @input="onNormalInput"
                @keydown="onNormalKeydown"
                @blur="removeGhostSpan"
              ></div>
              <!-- Inline ghost: rendered as a zero-width overlay after cursor via CSS trick -->
              <div v-if="ghostSuggestion" class="ghost-overlay" aria-hidden="true"></div>
            </div>

            <div class="normal-hint">Tab to complete &nbsp;·&nbsp; <code>$</code> to start a variable</div>

            <!-- Preview -->
            <div class="preview-section">
              <div class="preview-label">Preview <span class="preview-note">(mock values)</span></div>
              <div class="preview-output">{{ previewOutput || '—' }}</div>
            </div>

            <!-- Mock values -->
            <details class="mock-ctx-details">
              <summary class="mock-ctx-summary">⚙ Mock values</summary>
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
              <summary class="ref-summary">📖 Variable reference</summary>
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
            <button v-if="!isBuiltIn" class="btn-delete" :class="{ confirm: deleteConfirm }" :disabled="deleting" @click="deleteCmd">
              {{ deleting ? 'Deleting…' : deleteConfirm ? 'Confirm delete?' : 'Delete command' }}
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
.hint-code   { font-family: 'Consolas','Fira Mono',monospace; color: #4ec9b0; font-style: normal; font-size: 10px; background: rgba(78,201,176,.1); padding: 1px 4px; border-radius: 2px; }
.response-editor {
  min-height: 52px; line-height: 1.5; white-space: pre-wrap; word-break: break-word;
  cursor: text; outline: none;
}
.response-editor:empty:before {
  content: attr(data-placeholder);
  color: #3a3a40; pointer-events: none;
}
.response-editor:focus { border-color: #6f2bff55; }
.field-input, .field-textarea, .field-select { background: #111217; border: 1px solid #2a2a30; color: #e0e0e0; font-family: inherit; font-size: 13px; padding: 7px 10px; outline: none; transition: border-color .15s; }
.field-input:focus, .field-textarea:focus, .field-select:focus { border-color: #6f2bff55; }
.field-textarea { resize: vertical; min-height: 52px; }
.field-select   { appearance: none; cursor: pointer; }

.rule-area { display: flex; flex-direction: row; gap: 10px; align-items: flex-start; }
.palette { width: 150px; flex-shrink: 0; display: flex; flex-direction: column; gap: 12px; }
.palette-group { display: flex; flex-direction: column; gap: 4px; }
.palette-group-label { font-size: 9px; font-weight: 700; text-transform: uppercase; letter-spacing: .06em; margin-bottom: 2px; opacity: .6; }
.pk-wrapper  { color: #569cd6; }
.pk-operator { color: #c792ea; }
.pk-action   { color: #f14949; }
.pk-value    { color: #4ec9b0; }
.pk-param    { color: #e5c07b; }
.palette-piece-wrap {
  display: block; cursor: grab; user-select: none;
  transition: filter .12s, transform .1s;
  overflow: visible;
  line-height: 0;
}
.palette-piece-wrap:hover { filter: brightness(1.3); transform: translateX(2px); }
.palette-piece-wrap:active { cursor: grabbing; }

.editor-col { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 8px; overflow: visible; }
.editor-wrap { position: relative; width: 100%; }

.rule-editor { min-height: 80px; max-height: 280px; overflow-y: auto; background: #0d0d10; border: 1px solid #2a2a30; padding: 12px 14px; font-family: 'Consolas','Fira Mono',monospace; font-size: 13px; line-height: 2.2; color: #c0c0c0; outline: none; white-space: normal; word-break: normal; transition: border-color .15s; display: flex; flex-wrap: wrap; align-items: center; gap: 2px; }
.rule-editor:focus   { border-color: #6f2bff55; }
.rule-editor.invalid { border-color: #f1494966; }
.rule-editor:empty::before { content: attr(data-placeholder); color: #2a2a35; pointer-events: none; }
.rule-warnings     { margin-top: 4px; display: flex; flex-direction: column; gap: 2px; }
.rule-warning-item { font-size: 11px; color: #f5a623; background: rgba(245,166,35,.08); border-left: 2px solid #f5a62366; padding: 3px 7px; }

.editor-legend { display: flex; align-items: center; gap: 8px; margin-top: 5px; }
.legend-item   { display: inline-flex; align-items: center; gap: 4px; }
.legend-icon   { display: inline-flex; align-items: center; font-size: 13px; line-height: 1; }
.legend-btn    { display: inline-block; font-size: 8px; font-weight: 700; line-height: 1; padding: 1px 3px; border-radius: 2px; margin-left: 1px; vertical-align: middle; }
.legend-btn.lmb { background: #2a2a35; color: #569cd6; border: 1px solid #569cd644; }
.legend-btn.rmb { background: #2a1a1a; color: #f14949; border: 1px solid #f1494944; }
.legend-desc   { font-size: 10px; color: #444; }
.legend-sep    { color: #333; font-size: 12px; }

.ac-dropdown { position: absolute; z-index: 100; background: #1a1a1e; border: 1px solid #2a2a30; min-width: 160px; max-height: 180px; overflow-y: auto; }
.ac-item { padding: 5px 10px; font-size: 12px; font-family: 'Consolas','Fira Mono',monospace; cursor: pointer; transition: background .1s; }
.ac-item:hover, .ac-item.active { background: #2a2a35; }

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
.btn-delete { height: 34px; padding: 0 14px; border: 1px solid #f1494944; background: transparent; color: #f14949; font-family: inherit; font-size: 12px; cursor: pointer; transition: background .15s, border-color .15s; }
.btn-delete:hover:not(:disabled) { background: #f1494911; }
.btn-delete:disabled { opacity: .4; cursor: not-allowed; }
.btn-delete.confirm { border-color: #f14949aa; background: #f1494922; font-weight: 700; }

/* ── Rule section collapsible ── */
.rule-section { border: 1px solid #222; background: #141418; }
.rule-toggle { width: 100%; display: flex; align-items: center; gap: 8px; padding: 10px 14px; border: none; background: transparent; color: #888; font-family: inherit; font-size: 12px; font-weight: 600; cursor: pointer; text-align: left; transition: background .1s, color .1s; }
.rule-toggle:hover { background: #1e1e22; color: #ccc; }
.rule-toggle-arrow { font-size: 9px; color: #555; flex-shrink: 0; }
.rule-toggle-hint { font-size: 10px; color: #444; font-weight: 400; margin-left: 2px; }
.rule-toggle-hint.has-rule { color: #23d18b88; }
.rule-toggle-warn { margin-left: auto; font-size: 10px; color: #f5a623; }
.rule-section-body { padding: 12px 14px; display: flex; flex-direction: column; gap: 10px; border-top: 1px solid #222; }

/* ── Rule target toggle ── */
.rule-target-row { display: flex; align-items: center; gap: 8px; }
.rule-target-label { font-size: 10px; color: #555; font-weight: 600; text-transform: uppercase; letter-spacing: .05em; flex-shrink: 0; }
.rule-target-btn { height: 26px; padding: 0 10px; border: 1px solid #2a2a30; background: #111217; color: #555; font-family: 'Consolas','Fira Mono',monospace; font-size: 11px; cursor: pointer; transition: background .15s, color .15s, border-color .15s; }
.rule-target-btn:hover { color: #888; }
.rule-target-btn.active { border-color: #4ec9b066; color: #4ec9b0; background: rgba(78,201,176,.08); }

.sim-section { display: flex; flex-direction: column; gap: 0; margin-top: 2px; }
.btn-sim-toggle { align-self: flex-start; height: 24px; padding: 0 11px; border: 1px solid #2a2a30; background: #111217; color: #666; font-family: inherit; font-size: 10px; cursor: pointer; transition: border-color .15s, color .15s; }
.btn-sim-toggle:hover { border-color: #6f2bff55; color: #9d6cff; }
.sim-body { margin-top: 6px; display: flex; flex-direction: column; gap: 5px; background: #0d0d10; border: 1px solid #2a2a30; padding: 10px 12px; }
.sim-row { display: flex; align-items: center; gap: 8px; }
.sim-label { font-size: 10px; font-weight: 600; color: #555; text-transform: uppercase; letter-spacing: .05em; min-width: 46px; flex-shrink: 0; }
.sim-input { flex: 1; font-size: 12px !important; padding: 5px 8px !important; }
.sim-builtin-note { flex: 1; font-size: 11px; color: #383838; font-style: italic; }
.sim-builtin-note code { font-family: 'Consolas','Fira Mono',monospace; color: #4ec9b0; font-style: normal; }
.btn-run-sim { align-self: flex-start; height: 26px; padding: 0 14px; border: none; background: #6f2bff; color: #fff; font-family: inherit; font-size: 11px; font-weight: 600; cursor: pointer; margin-top: 2px; transition: background .15s; }
.btn-run-sim:hover:not(:disabled) { background: #7f3fff; }
.btn-run-sim:disabled { opacity: .35; cursor: not-allowed; }
.sim-result { margin-top: 6px; display: flex; flex-direction: column; gap: 4px; }
.sim-errors { display: flex; flex-direction: column; gap: 2px; }
.sim-error-item { font-size: 11px; color: #f14949; background: rgba(241,73,73,.08); border-left: 2px solid #f1494966; padding: 3px 7px; }
.sim-output { display: flex; align-items: baseline; gap: 8px; }
.sim-output-label { font-size: 10px; font-weight: 700; color: #555; text-transform: uppercase; letter-spacing: .05em; flex-shrink: 0; }
.sim-output-val { font-size: 13px; font-family: 'Consolas','Fira Mono',monospace; color: #23d18b; background: rgba(35,209,139,.08); border: 1px solid rgba(35,209,139,.25); padding: 4px 10px; word-break: break-all; flex: 1; }

/* ── Built-in prefix lock ── */
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

/* ── Mode toggle ── */
.mode-toggle-row { display: flex; align-items: center; gap: 6px; }
.mode-btn { height: 26px; padding: 0 12px; border: 1px solid #2a2a30; background: #111217; color: #555; font-family: inherit; font-size: 11px; font-weight: 600; cursor: pointer; transition: all .15s; }
.mode-btn:hover { color: #888; border-color: #444; }
.mode-btn.active { border-color: #6f2bff66; color: #9d6cff; background: rgba(111,43,255,.1); }
.mode-hint { font-size: 10px; color: #383838; margin-left: 4px; }

/* ── Normal Mode editor ── */
.normal-mode-wrap { display: flex; flex-direction: column; gap: 8px; }
.normal-editor-container { position: relative; }
.normal-editor {
  min-height: 120px; max-height: 320px; overflow-y: auto;
  background: #0d0d10; border: 1px solid #2a2a30;
  padding: 12px 14px; font-family: 'Consolas','Fira Mono',monospace;
  font-size: 13px; line-height: 1.7; color: #c0c0c0;
  outline: none; white-space: pre-wrap; word-break: break-word;
  tab-size: 2;
}
.normal-editor:focus { border-color: #6f2bff55; }
.normal-editor:empty::before { content: attr(data-placeholder); color: #2a2a35; pointer-events: none; white-space: pre; }
.ghost-overlay { display: none; } /* ghost is rendered via ::after on the editor */
.normal-hint { font-size: 10px; color: #383838; }
.normal-hint code { font-family: 'Consolas','Fira Mono',monospace; color: #9d6cff; }

/* ── Preview ── */
.preview-section { display: flex; flex-direction: column; gap: 4px; }
.preview-label { font-size: 10px; font-weight: 600; color: #555; text-transform: uppercase; letter-spacing: .05em; display: flex; align-items: center; gap: 6px; }
.preview-note { font-size: 9px; color: #333; font-weight: 400; text-transform: none; letter-spacing: 0; }
.preview-output {
  font-family: 'Consolas','Fira Mono',monospace; font-size: 13px;
  color: #4ec9b0; background: rgba(78,201,176,.06);
  border: 1px solid rgba(78,201,176,.15);
  padding: 8px 12px; min-height: 32px; word-break: break-all;
}

/* ── Mock context ── */
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

/* ── Reference panel ── */
.ref-content { max-height: 320px; overflow-y: auto; padding: 8px 10px; display: flex; flex-direction: column; gap: 10px; }
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

/* ── Syntax highlight colours ── */
</style>

<style>
.output-placeholder { display: inline-flex; align-items: center; gap: 2px; background: #0d0d10; border: 1px dashed #252530; padding: 8px 14px; font-family: 'Consolas','Fira Mono',monospace; user-select: none; cursor: default; }
.op-brace { font-size: 20px; color: #2a2a35; line-height: 1; font-weight: 300; }
.op-label { font-size: 13px; color: #333; letter-spacing: .06em; padding: 0 4px; }

.if-block     { background: rgba(86,156,214,.07);  border: 1px solid rgba(86,156,214,.18); border-radius: 4px; padding: 2px 4px; display: inline-flex; align-items: center; gap: 1px; flex-wrap: wrap; }
.do-block     { background: rgba(86,156,214,.05);  border: 1px dashed rgba(86,156,214,.20); border-radius: 4px; padding: 2px 4px; display: inline-flex; align-items: center; gap: 1px; flex-wrap: wrap; }
.action-block { background: rgba(241,73,73,.07);   border: 1px solid rgba(241,73,73,.18);  border-radius: 4px; padding: 2px 4px; display: inline-flex; align-items: center; gap: 1px; }

.pz-tok:hover > svg { filter: brightness(1.3) drop-shadow(0 0 3px currentColor); }

/* Syntax highlight for normal mode editor */
.sh-kw       { color: #569cd6; }
.sh-builtin  { color: #9d6cff; }
.sh-locked   { color: #9d6cff; border-bottom: 1px solid rgba(111,43,255,.4); cursor: not-allowed; }
.sh-op      { color: #c792ea; }
.sh-string  { color: #ce9178; }
.sh-number  { color: #b5cea8; }
.sh-paren   { color: #888; }
.sh-comment { color: #3c4a3c; font-style: italic; }
.sh-error   { color: #f14949; text-decoration: underline wavy #f1494966; }
.pz-ph { opacity: 0.35; transition: opacity .15s; }
.pz-ph:hover { opacity: 0.7; }

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
