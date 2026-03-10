<script setup lang="ts">
import { ref, watch, computed, nextTick, onMounted, onUnmounted } from 'vue'
import { API } from '../api'
import { useAuth } from '../auth'
import PuzzlePiece from './PuzzlePiece.vue'

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
function puzzleSVG(label: string, kind: PieceKind, rightFlat = false): string {
  const H = 28, R = 4, TW = 7, TH = 8, TR = 2.5, PX = 10, CW = 6.2
  const bw = Math.max(46, Math.ceil(label.length * CW) + PX * 2)

  // All pieces have a left tab (protrudes left)
  const bodyOffX = TH
  const svgH = H
  const x0 = bodyOffX, y0 = 0, x1 = x0 + bw, y1 = H
  const midY = H / 2

  const COLS: Record<PieceKind, { fill: string; stroke: string; text: string }> = {
    value:    { fill: '#0d2520', stroke: '#4ec9b0', text: '#4ec9b0' },
    operator: { fill: '#1c0f2e', stroke: '#c792ea', text: '#c792ea' },
    action:   { fill: '#280b0b', stroke: '#f14949', text: '#f14949' },
    param:    { fill: '#201808', stroke: '#e5c07b', text: '#e5c07b' },
    wrapper:  { fill: '#0b1928', stroke: '#569cd6', text: '#569cd6' },
  }
  const col = COLS[kind]

  // right side: notch IN unless rightFlat
  const rightNotch = !rightFlat
  const top    = `M${x0+R},${y0} L${x1-R},${y0} Q${x1},${y0} ${x1},${y0+R}`
  const right  = rightNotch
    ? `L${x1},${midY-TW} L${x1-TH+TR},${midY-TW} Q${x1-TH},${midY-TW} ${x1-TH},${midY-TW+TR} L${x1-TH},${midY+TW-TR} Q${x1-TH},${midY+TW} ${x1-TH+TR},${midY+TW} L${x1},${midY+TW} L${x1},${y1-R} Q${x1},${y1} ${x1-R},${y1}`
    : `L${x1},${y1-R} Q${x1},${y1} ${x1-R},${y1}`
  const bottom = `L${x0+R},${y1} Q${x0},${y1} ${x0},${y1-R}`
  // left tab always protrudes outward (leftward)
  const left   = `L${x0},${midY+TW} L${x0-TH+TR},${midY+TW} Q${x0-TH},${midY+TW} ${x0-TH},${midY+TW-TR} L${x0-TH},${midY-TW+TR} Q${x0-TH},${midY-TW} ${x0-TH+TR},${midY-TW} L${x0},${midY-TW} L${x0},${y0+R} Q${x0},${y0} ${x0+R},${y0}`
  const d = `${top} ${right} ${bottom} ${left} Z`

  const vbX = -TH
  const vbW = bw + TH * 2  // room for left-tab and optional right overflow
  const tx  = x0 + bw / 2
  const ty  = H / 2

  return `<svg width="${bw + TH}" height="${svgH}" viewBox="${vbX} 0 ${vbW} ${svgH}" xmlns="http://www.w3.org/2000/svg" style="display:inline-block;vertical-align:middle;overflow:visible">`
    + `<path d="${d}" fill="${col.fill}" stroke="${col.stroke}" stroke-width="1.5" stroke-linejoin="round" stroke-linecap="round"/>`
    + `<text x="${tx}" y="${ty}" text-anchor="middle" dominant-baseline="central" fill="${col.text}" font-size="10" font-family="Consolas,Fira Mono,monospace" font-weight="600" pointer-events="none">${label}</text>`
    + `</svg>`
}

// Wrap a puzzle SVG as an atomic inline token
// data-tok is used by getPlainText to recover the raw token string
function puzzleSpan(tok: string, kind: PieceKind, rightFlat = false): string {
  const svg = puzzleSVG(tok, kind, rightFlat)
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
      return `<span class="tk-placeholder pz-ph ${cls}" data-ph="${ph}" contenteditable="false" style="display:inline-block;vertical-align:middle;margin:0 1px;opacity:0.55;cursor:pointer">${svg}</span>`
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
      out += `<span class="if-block">${puzzleSpan('$if(', 'wrapper', true)}${highlight(inner)}${puzzleSpan('>)', 'wrapper', true)}</span>`
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
      // find closing >
      let j = i + 3
      while (j < src.length && src.charAt(j) !== '>') j++
      const inner = src.slice(i + 3, j)
      out += `<span class="do-block">${puzzleSpan('<do', 'wrapper', true)}${highlight(inner.trim())}${puzzleSpan('>', 'wrapper', true)}</span>`
      i = j + 1; continue
    }

    const actionMatch = src.slice(i).match(/^\[(replace|remove|delete|prepend|append|send|stop)/)
    if (actionMatch) {
      const name = actionMatch[1] ?? ''
      let j = i + 1 + name.length
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
      if (!foundClose) { /* partial */ }
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
  const tok   = tokSpan.dataset.tok
  const kind  = tokenKind(tok)
  const plain = getPlainText(editorRef.value!)
  const idx   = plain.indexOf(tok)
  if (idx === -1) return

  // Determine if this position expects a specific placeholder
  // We replace with the matching PH sentinel based on kind
  const kindToPh: Record<PieceKind, string> = {
    value:    PH.value,
    operator: PH.op,
    action:   PH.action,
    param:    PH.param,
    wrapper:  '', // wrappers don't get a placeholder
  }
  const replacement = kind ? (kindToPh[kind] ?? '') : ''
  form.value.rule = plain.slice(0, idx) + replacement + plain.slice(idx + tok.length)
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
      const hasArg = plain.charAt(idx + 1) === PH.arg
      const sliceEnd = hasArg ? idx + 2 : idx + 1
      form.value.rule = plain.slice(0, idx - 1) + skel + plain.slice(sliceEnd + 1)
      applyHighlight(); nextTick(() => restoreCaret(el, idx - 1 + skel.length))
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
      const hasArg = plain.charAt(pos + 1) === PH.arg
      const sliceEnd = hasArg ? pos + 2 : pos + 1
      form.value.rule = plain.slice(0, pos - 1) + skel + plain.slice(sliceEnd + 1)
      applyHighlight(); nextTick(() => restoreCaret(el, pos - 1 + skel.length))
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

          <div class="field-group">
            <template v-if="!isBuiltIn">
              <label class="field-label">Response <span class="field-hint">= <code class="hint-code">{output}</code> &nbsp;·&nbsp; also use {user} {channel} {args}</span></label>
              <div
                ref="responseRef"
                class="field-textarea response-editor"
                contenteditable="true"
                spellcheck="false"
                data-placeholder="Hello {user}! You said: {args}"
                @input="onResponseInput"
              ></div>
            </template>
            <template v-else>
              <label class="field-label">Output <span class="field-hint">Hardcoded — the bot generates this</span></label>
              <div class="output-placeholder">
                <span class="op-brace">{</span><span class="op-label">output</span><span class="op-brace">}</span>
              </div>
            </template>
          </div>

          <!-- ── Rule section (collapsible) ────────────────────────────────────────── -->
          <div class="rule-section">
            <button class="rule-toggle" @click="ruleOpen = !ruleOpen">
              <span class="rule-toggle-arrow">{{ ruleOpen ? '▼' : '►' }}</span>
              Rule
              <span class="rule-toggle-hint">
                {{ ruleOpen ? 'click to collapse' : (form.rule.trim() ? '✔ rule set — click to edit' : 'click to add a rule') }}
              </span>
              <span v-if="!ruleValid && !!form.rule" class="rule-toggle-warn">⚠ invalid</span>
            </button>

            <div v-if="ruleOpen" class="rule-section-body">

              <!-- target toggle -->
              <div class="rule-target-row">
                <span class="rule-target-label">Apply rule to:</span>
                <button class="rule-target-btn" :class="{ active: ruleTarget === 'output' }" @click="ruleTarget = 'output'">{output}</button>
                <button class="rule-target-btn" :class="{ active: ruleTarget === 'input' }"  @click="ruleTarget = 'input'">{input}</button>
              </div>

              <div class="rule-area">

                <div class="palette">
                  <div v-for="g in palette" :key="g.group" class="palette-group">
                    <div class="palette-group-label" :class="'pk-' + g.kind">{{ g.group }}</div>
                    <div v-for="tok in g.tokens" :key="tok"
                      class="palette-piece-wrap"
                      draggable="true"
                      @dragstart="onDragStart($event, tok)"
                      @click="onPaletteClick(tok)"
                      title="Click or drag to add"
                    >
                      <PuzzlePiece :label="tok" :kind="g.kind" />
                    </div>
                  </div>
                </div>

                <div class="editor-col">
                  <div class="editor-wrap">
                    <div
                      ref="editorRef"
                      class="rule-editor"
                      :class="{ invalid: !ruleValid && !!form.rule }"
                      contenteditable="true"
                      spellcheck="false"
                      data-placeholder="e.g. $if({output}[has]{text1}&lt;do [remove{text1}]&gt;)"
                      @input="onEditorInput"
                      @keydown="onEditorKeydown"
                      @click="onEditorClick"
                      @contextmenu="onEditorContextMenu"
                      @dragstart="onEditorDragStart"
                      @drop="onEditorDrop"
                      @dragover="onEditorDragover"
                    ></div>
                    <div class="editor-legend">
                      <span class="legend-item">
                        <span class="legend-icon">🖱️<span class="legend-btn lmb">L</span></span>
                        <span class="legend-desc">Select / drag piece</span>
                      </span>
                      <span class="legend-sep">·</span>
                      <span class="legend-item">
                        <span class="legend-icon">🖱️<span class="legend-btn rmb">R</span></span>
                        <span class="legend-desc">Remove piece</span>
                      </span>
                    </div>

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

                  <!-- Params: below the editor -->
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

                  <!-- Simulator -->
                  <div class="sim-section">
                    <button class="btn-sim-toggle" @click="simExpanded = !simExpanded">
                      {{ simExpanded ? '▾ hide simulator' : '▸ test rule' }}
                    </button>
                    <div v-if="simExpanded" class="sim-body">
                      <div class="sim-row">
                        <span class="sim-label">Input</span>
                        <input v-model="simInput" class="field-input sim-input" placeholder="test input…" />
                      </div>
                      <div class="sim-row">
                        <span class="sim-label">User</span>
                        <input v-model="simUser" class="field-input sim-input" placeholder="testuser" />
                      </div>
                      <div v-if="isBuiltIn" class="sim-row">
                        <span class="sim-label">Output</span>
                        <span class="sim-builtin-note">bot-generated — uses <code>{output}</code> placeholder</span>
                      </div>
                      <button class="btn-run-sim" :disabled="!form.rule.trim()" @click="simulateRule">Run</button>
                      <div v-if="simResult" class="sim-result">
                        <div v-if="simResult.errors.length" class="sim-errors">
                          <div v-for="e in simResult.errors" :key="e" class="sim-error-item">{{ e }}</div>
                        </div>
                        <div v-if="!simResult.errors.length" class="sim-output">
                          <span class="sim-output-label">Output</span>
                          <span class="sim-output-val">{{ simResult.output }}</span>
                        </div>
                      </div>
                    </div>
                  </div>

                </div><!-- /editor-col -->
              </div><!-- /rule-area -->
            </div><!-- /rule-section-body -->
          </div><!-- /rule-section -->

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
</style>

<style>
.output-placeholder { display: inline-flex; align-items: center; gap: 2px; background: #0d0d10; border: 1px dashed #252530; padding: 8px 14px; font-family: 'Consolas','Fira Mono',monospace; user-select: none; cursor: default; }
.op-brace { font-size: 20px; color: #2a2a35; line-height: 1; font-weight: 300; }
.op-label { font-size: 13px; color: #333; letter-spacing: .06em; padding: 0 4px; }

.if-block     { background: rgba(86,156,214,.07);  border: 1px solid rgba(86,156,214,.18); border-radius: 4px; padding: 2px 4px; display: inline-flex; align-items: center; gap: 1px; flex-wrap: wrap; }
.do-block     { background: rgba(86,156,214,.05);  border: 1px dashed rgba(86,156,214,.20); border-radius: 4px; padding: 2px 4px; display: inline-flex; align-items: center; gap: 1px; flex-wrap: wrap; }
.action-block { background: rgba(241,73,73,.07);   border: 1px solid rgba(241,73,73,.18);  border-radius: 4px; padding: 2px 4px; display: inline-flex; align-items: center; gap: 1px; }

.pz-tok:hover > svg { filter: brightness(1.3) drop-shadow(0 0 3px currentColor); }
.pz-ph { opacity: 0.5; transition: opacity .15s; }
.pz-ph:hover { opacity: 0.85; }

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
