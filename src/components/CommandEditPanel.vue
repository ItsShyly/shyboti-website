<script setup lang="ts">
import { ref, watch, computed, nextTick, onMounted, onUnmounted } from 'vue'
import { API } from '../api'
import { useAuth } from '../auth'

export interface CustomCommand {
  name:          string
  response:      string
  rule:          string
  alias:         string
  enabled_when:  string
  required_game: string
  regex1:        string
  regex2:        string
  text1:         string
  text2:         string
  isActive:      boolean | number
  cooldown:      number
  userCooldown:  number
}

interface Props {
  cmdName:    string
  channel:    string
  open:       boolean
  isBuiltIn?: boolean
}

const props = defineProps<Props>()
const emit  = defineEmits<{ (e: 'close'): void; (e: 'saved'): void }>()
const { session } = useAuth()

const loading  = ref(true)
const saving   = ref(false)
const saved    = ref(false)
const deleting = ref(false)

const form = ref<CustomCommand>({
  name: '', response: '', rule: '', alias: '',
  enabled_when: 'always', required_game: '',
  regex1: '', regex2: '', text1: '', text2: '',
  isActive: true, cooldown: 0, userCooldown: 0,
})

async function load() {
  if (!session.value || !props.cmdName) return
  loading.value = true
  try {
    const res = await fetch(`${API}/custom-commands/${props.channel}`, {
      headers: { Authorization: `Bearer ${session.value.token}` }
    })
    if (res.ok) {
      const data = await res.json() as { commands: CustomCommand[] }
      const existing = data.commands.find(c => c.name === props.cmdName)
      if (existing) {
        form.value = { ...existing, isActive: !!existing.isActive }
      } else {
        form.value = {
          name: props.cmdName, response: '', rule: '', alias: '',
          enabled_when: 'always', required_game: '',
          regex1: '', regex2: '', text1: '', text2: '',
          isActive: true, cooldown: 0, userCooldown: 0,
        }
      }
    }
  } catch {}
  loading.value = false
}

watch(() => props.open, (v) => { if (v) load() })
onMounted(() => { if (props.open) load() })

// Seed the editor when rule changes externally (load/reset)
watch(() => form.value.rule, (newRule) => {
  if (_userIsTyping) return
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
    saved.value = true
    setTimeout(() => { saved.value = false }, 2000)
    emit('saved')
  } catch {}
  saving.value = false
}

async function deleteCmd() {
  if (!session.value) return
  if (!confirm(`Delete custom command "${props.cmdName}"? This cannot be undone.`)) return
  deleting.value = true
  try {
    await fetch(`${API}/custom-commands/${props.channel}/${props.cmdName}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${session.value.token}` },
    })
    emit('saved')
    emit('close')
  } catch {}
  deleting.value = false
}

// ─── Tokens ──────────────────────────────────────────────────────────────────

const OPERATORS       = ['[has]','[=]','[<]','[>]','[<=]','[>=]','[starts]','[ends]']
const ACTIONS         = ['[replace]','[remove]','[delete]','[prepend]','[append]','[send]','[stop]']
const VALUES          = ['{output}','{input}','{user}','{channel}','{args}']
const PARAMS          = ['{regex1}','{regex2}','{text1}','{text2}']
const WRAPPERS        = ['$if']
const ACTION_ARG_TOKENS = ['{output}','{input}','{args}','{regex1}','{regex2}','{text1}','{text2}']

const PH_VALUE      = '\uE001'
const PH_PARAM      = '\uE002'
const PH_OP         = '\uE003'
const PH_ACTION     = '\uE004'
const PH_ACTION_ARG = '\uE005'
const PH_CHARS      = [PH_VALUE, PH_PARAM, PH_OP, PH_ACTION, PH_ACTION_ARG]

const PH_LABELS: Record<string, string> = {
  [PH_VALUE]: 'value', [PH_PARAM]: 'param', [PH_OP]: 'op',
  [PH_ACTION]: 'action', [PH_ACTION_ARG]: 'target',
}
const PH_CLASSES: Record<string, string> = {
  [PH_VALUE]: 'tk-value', [PH_PARAM]: 'tk-param', [PH_OP]: 'tk-op',
  [PH_ACTION]: 'tk-action', [PH_ACTION_ARG]: 'tk-action-arg',
}
const PH_CANDIDATES: Record<string, string[]> = {
  [PH_VALUE]:      VALUES,
  [PH_PARAM]:      PARAMS,
  [PH_OP]:         OPERATORS,
  [PH_ACTION]:     ACTIONS,
  [PH_ACTION_ARG]: ACTION_ARG_TOKENS,
}

function tokenClass(tok: string): string {
  if (WRAPPERS.includes(tok))  return 'tk-wrapper'
  if (OPERATORS.includes(tok)) return 'tk-op'
  if (ACTIONS.includes(tok))   return 'tk-action'
  if (VALUES.includes(tok))    return 'tk-value'
  if (PARAMS.includes(tok))    return 'tk-param'
  return ''
}
function tokenMatchesPh(tok: string, ph: string): boolean {
  return (PH_CANDIDATES[ph] ?? []).includes(tok)
}
function allTokens() {
  return [...WRAPPERS, ...OPERATORS, ...ACTIONS, ...VALUES, ...PARAMS]
}

// ─── Highlight ────────────────────────────────────────────────────────────────

function highlight(src: string): string {
  let s = src.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')

  for (const ph of PH_CHARS) {
    const cls = PH_CLASSES[ph], label = PH_LABELS[ph]
    s = s.split(ph).join(
      `<span class="tk-placeholder ${cls}" data-ph="${ph}" contenteditable="false">${label}</span>`
    )
  }

  s = s.replace(/\$if\(([^)]*)\)/g,   m => `<span class="if-block">${m}</span>`)
  s = s.replace(/\$else\{([^}]*)\}/g, m => `<span class="if-block">${m}</span>`)

  const pat = /(\$if|\$else|\[(?:replace|remove|delete|prepend|append|send|stop|has|=|&lt;=|&gt;=|&lt;|&gt;|starts|ends)\]|\{(?:output|input|user|channel|args|regex1|regex2|text1|text2)\})/g
  s = s.replace(pat, m => {
    const raw = m.replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&amp;/g,'&')
    let cls = ''
    if (['$if','$else'].includes(raw)) cls = 'tk-wrapper'
    else if (OPERATORS.includes(raw))  cls = 'tk-op'
    else if (ACTIONS.includes(raw))    cls = 'tk-action'
    else if (VALUES.includes(raw))     cls = 'tk-value'
    else if (PARAMS.includes(raw))     cls = 'tk-param'
    return cls ? `<span class="${cls}">${m}</span>` : m
  })
  return s
}

// ─── Validation ───────────────────────────────────────────────────────────────

const ruleWarnings = computed((): string[] => {
  const r = form.value.rule
  if (!r.trim()) return []
  const warnings: string[] = []
  let phCount = 0
  for (const ph of PH_CHARS) phCount += (r.split(ph).length - 1)
  if (phCount > 0) warnings.push(`${phCount} unfilled placeholder${phCount > 1 ? 's' : ''} remaining`)
  return warnings
})
const ruleValid = computed(() => ruleWarnings.value.length === 0)

// ─── DOM helpers ──────────────────────────────────────────────────────────────

const editorRef     = ref<HTMLDivElement | null>(null)
let   _userIsTyping = false

// Walk DOM linearly: text nodes contribute their length, placeholder spans contribute 1
function getPlainText(el: HTMLElement): string {
  function walk(node: Node): string {
    if (node.nodeType === Node.TEXT_NODE) return node.textContent ?? ''
    if (node instanceof HTMLElement) {
      if (node.classList.contains('tk-placeholder')) return node.dataset.ph ?? ''
      return Array.from(node.childNodes).map(walk).join('')
    }
    return ''
  }
  return walk(el).replace(/\n\n/g, '\n')
}

// Walk DOM to get caret offset in plain-text space (placeholders = 1 char)
function getCaretOffset(el: HTMLElement): number {
  const sel = window.getSelection()
  if (!sel || !sel.rangeCount) return 0
  const range = sel.getRangeAt(0)
  if (!el.contains(range.startContainer)) return 0

  let offset = 0
  let found  = false

  function walk(node: Node): void {
    if (found) return
    if (node === range.startContainer) {
      // For text nodes the offset is within the text; for element nodes it's a child index
      if (node.nodeType === Node.TEXT_NODE) {
        offset += range.startOffset
      }
      // if it's an element (e.g. the editor div itself), we've counted up to the child at startOffset
      found = true
      return
    }
    if (node instanceof HTMLElement && node.classList.contains('tk-placeholder')) {
      offset += 1
      return
    }
    if (node.nodeType === Node.TEXT_NODE) {
      offset += node.textContent?.length ?? 0
      return
    }
    for (const child of Array.from(node.childNodes)) {
      if (found) return
      walk(child)
    }
  }
  walk(el)
  return offset
}

// Walk DOM to restore caret at plain-text offset (placeholders = 1 char)
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
    for (const child of Array.from(node.childNodes)) {
      if (placed) return
      walk(child)
    }
  }

  walk(el)
  if (!placed) {
    // fallback: end of content
    const r = document.createRange()
    r.selectNodeContents(el); r.collapse(false)
    window.getSelection()?.removeAllRanges()
    window.getSelection()?.addRange(r)
  }
}

function applyHighlight() {
  const el = editorRef.value
  if (!el) return
  const offset = getCaretOffset(el)
  el.innerHTML = highlight(form.value.rule)
  restoreCaret(el, offset)
}

function ruleForSave(rule: string): string {
  let r = rule
  for (const ph of PH_CHARS) r = r.split(ph).join('')
  return r
}

// ─── Autocomplete state ───────────────────────────────────────────────────────

const acRef      = ref<HTMLDivElement | null>(null)
const acItems    = ref<string[]>([])
const acIndex    = ref(0)
const acPos      = ref({ top: 0, left: 0 })
const acVisible  = ref(false)
const acTrigger  = ref('')
const acActivePh = ref<string | null>(null)  // set when clicking a placeholder

// ─── Insert helpers ───────────────────────────────────────────────────────────

// Insert text at current caret position (used by palette click and $if auto-complete)
function insertAtCaret(text: string) {
  const el = editorRef.value
  if (!el) return

  // If editor isn't focused, insert at end
  if (document.activeElement !== el) {
    form.value.rule = form.value.rule + text
    el.innerHTML = highlight(form.value.rule)
    nextTick(() => restoreCaret(el, form.value.rule.length))
    return
  }

  const offset = getCaretOffset(el)
  const plain  = getPlainText(el)
  form.value.rule = plain.slice(0, offset) + text + plain.slice(offset)
  applyHighlight()
  nextTick(() => restoreCaret(el, offset + text.length))
}

// ─── Input & keyboard ─────────────────────────────────────────────────────────

function onEditorInput() {
  const el = editorRef.value
  if (!el) return
  _userIsTyping = true
  form.value.rule = getPlainText(el)
  applyHighlight()
  checkAutocomplete()
  _userIsTyping = false
}

function onEditorKeydown(e: KeyboardEvent) {
  if (acVisible.value) {
    if (e.key === 'ArrowDown') { e.preventDefault(); acIndex.value = Math.min(acIndex.value + 1, acItems.value.length - 1); return }
    if (e.key === 'ArrowUp')   { e.preventDefault(); acIndex.value = Math.max(acIndex.value - 1, 0); return }
    if (e.key === 'Enter' || e.key === 'Tab') { e.preventDefault(); insertAcItem(); return }
    if (e.key === 'Escape')    { acVisible.value = false; acActivePh.value = null; return }
  }

  // Block deletion of placeholder spans
  if (e.key === 'Backspace' || e.key === 'Delete') {
    const sel = window.getSelection()
    if (sel && sel.rangeCount) {
      const range = sel.getRangeAt(0)
      if (range.collapsed) {
        const checkNode = (n: Node | null | undefined) =>
          n instanceof HTMLElement && n.classList.contains('tk-placeholder')
        const sib = e.key === 'Backspace'
          ? range.startContainer.childNodes[range.startOffset - 1]
          : range.endContainer.childNodes[range.endOffset]
        if (checkNode(sib) || checkNode(range.startContainer.parentElement)) {
          e.preventDefault(); return
        }
      }
    }
  }

  // Auto-skeleton for $if(
  if (e.key === '(' && getPlainText(editorRef.value!).trimEnd().endsWith('$if')) {
    e.preventDefault()
    insertAtCaret(`(${PH_VALUE}${PH_OP}${PH_PARAM}<do [${PH_ACTION}{${PH_ACTION_ARG}}]>)`)
  }
}

// Click on placeholder → open slot-specific suggestions
function onEditorClick(e: MouseEvent) {
  const target = e.target as HTMLElement
  const phSpan = target.classList.contains('tk-placeholder') ? target
    : (target.closest('.tk-placeholder') as HTMLElement | null)
  if (!phSpan) return

  const ph = phSpan.dataset.ph ?? ''
  if (!ph || !PH_CANDIDATES[ph]?.length) return

  e.preventDefault()

  acActivePh.value = ph
  acItems.value    = PH_CANDIDATES[ph]
  acIndex.value    = 0
  acTrigger.value  = ''
  acVisible.value  = true

  const rect       = phSpan.getBoundingClientRect()
  const editorRect = editorRef.value!.getBoundingClientRect()
  acPos.value = { top: rect.bottom - editorRect.top + 4, left: rect.left - editorRect.left }
}

// ─── Autocomplete ─────────────────────────────────────────────────────────────

function checkAutocomplete() {
  if (acActivePh.value) return
  const el = editorRef.value
  if (!el) return
  const sel = window.getSelection()
  if (!sel || !sel.rangeCount) return

  // Get text before caret in the current text node only
  const range    = sel.getRangeAt(0).cloneRange()
  range.collapse(true)
  const preRange = document.createRange()
  preRange.setStart(el, 0)
  preRange.setEnd(range.startContainer, range.startOffset)
  const textBefore = preRange.toString()

  const partial    = textBefore.match(/(\$[\w]*|\[[\w=<>]*|\{[\w]*)$/)
  if (!partial) { acVisible.value = false; return }

  const p          = partial[0]
  const candidates = allTokens().filter(t => t.startsWith(p) && t !== p)
  if (!candidates.length) { acVisible.value = false; return }

  acTrigger.value = p
  acItems.value   = candidates
  acIndex.value   = 0
  acVisible.value = true

  const rect       = range.getBoundingClientRect()
  const editorRect = el.getBoundingClientRect()
  acPos.value = { top: rect.bottom - editorRect.top + 4, left: rect.left - editorRect.left }
}

function insertAcItem() {
  const item = acItems.value[acIndex.value]
  if (!item) return
  acVisible.value = false

  const el = editorRef.value
  if (!el) return

  // ── Placeholder-click mode ──
  if (acActivePh.value) {
    const ph = acActivePh.value
    acActivePh.value = null
    const plain = getPlainText(el)
    const idx   = plain.indexOf(ph)
    if (idx === -1) return
    form.value.rule = plain.slice(0, idx) + item + plain.slice(idx + 1)
    applyHighlight()
    nextTick(() => restoreCaret(el, idx + item.length))
    return
  }

  // ── Typing mode: replace partial trigger at caret ──
  acActivePh.value = null
  const caretOffset = getCaretOffset(el)
  const plain       = getPlainText(el)
  const triggerLen  = acTrigger.value.length
  const before      = plain.slice(0, caretOffset - triggerLen)
  const after       = plain.slice(caretOffset)
  form.value.rule   = before + item + after
  applyHighlight()
  nextTick(() => restoreCaret(el, before.length + item.length))
}

// ─── Drag & drop ─────────────────────────────────────────────────────────────

function onDragStart(e: DragEvent, token: string) {
  e.dataTransfer?.setData('text/plain', token)
}

function buildDropInsert(token: string, selected: string): string {
  const sel = selected.trim()
  if (token === '$if') {
    return sel
      ? `$if(${sel}${PH_OP}${PH_PARAM}<do [${PH_ACTION}{${PH_ACTION_ARG}}]>)`
      : `$if(${PH_VALUE}${PH_OP}${PH_PARAM}<do [${PH_ACTION}{${PH_ACTION_ARG}}]>)`
  }
  if (ACTIONS.includes(token)) {
    const name = token.slice(1, -1)
    return sel ? `[${name}{${sel}}]` : `[${name}{${PH_ACTION_ARG}}]`
  }
  return token
}

function getPhSpanAtPoint(e: DragEvent): HTMLElement | null {
  for (const el of document.elementsFromPoint(e.clientX, e.clientY)) {
    if (el instanceof HTMLElement && el.classList.contains('tk-placeholder')) return el
  }
  return null
}

function onEditorDrop(e: DragEvent) {
  e.preventDefault()
  const token = e.dataTransfer?.getData('text/plain')
  if (!token) return
  const el = editorRef.value!
  el.focus()

  const phSpan = getPhSpanAtPoint(e)
  if (phSpan) {
    const ph = phSpan.dataset.ph ?? ''
    if (!tokenMatchesPh(token, ph)) return

    const plain = getPlainText(el)
    let pos = 0
    function findSpanPos(node: Node): boolean {
      if (node === phSpan) return true
      if (node instanceof HTMLElement && node.classList.contains('tk-placeholder')) { pos += 1; return false }
      if (node.nodeType === Node.TEXT_NODE) { pos += node.textContent?.length ?? 0; return false }
      for (const child of Array.from(node.childNodes)) { if (findSpanPos(child)) return true }
      return false
    }
    findSpanPos(el)
    form.value.rule = plain.slice(0, pos) + token + plain.slice(pos + 1)
    applyHighlight()
    nextTick(() => restoreCaret(el, pos + token.length))
    return
  }

  // Normal drop at caret
  const sel    = window.getSelection()
  let selText  = '', selStart = 0, selEnd = 0
  if (sel && sel.rangeCount && el.contains(sel.anchorNode)) {
    const r   = sel.getRangeAt(0)
    selText   = r.toString()
    const pre = document.createRange()
    pre.setStart(el, 0); pre.setEnd(r.startContainer, r.startOffset)
    selStart  = pre.toString().length
    selEnd    = selStart + selText.length
  }
  let dropOffset = selStart
  if (!selText && (document as any).caretRangeFromPoint) {
    const r = (document as any).caretRangeFromPoint(e.clientX, e.clientY)
    if (r) {
      const pre = document.createRange()
      pre.setStart(el, 0); pre.setEnd(r.startContainer, r.startOffset)
      dropOffset = pre.toString().length
    }
  }
  const plain  = getPlainText(el)
  const insert = buildDropInsert(token, selText)
  const before = plain.slice(0, selText ? selStart : dropOffset)
  const after  = plain.slice(selText ? selEnd : dropOffset)
  form.value.rule = before + insert + after
  applyHighlight()
  nextTick(() => restoreCaret(el, before.length + insert.length))
}

function onEditorDragover(e: DragEvent) {
  e.preventDefault()
  document.querySelectorAll('.tk-placeholder.drag-over').forEach(el => el.classList.remove('drag-over'))
  const phSpan = getPhSpanAtPoint(e)
  if (phSpan) phSpan.classList.add('drag-over')
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
  const target = e.target as HTMLElement
  if (target.classList.contains('tk-placeholder')) return
  acVisible.value  = false
  acActivePh.value = null
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
            <div class="panel-sub">Custom response &amp; rule builder for #{{ channel }}</div>
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
            <label class="field-label">
              Rule
              <span class="field-hint">Drag tokens or type $, [, { — click a slot to fill it</span>
            </label>

            <div class="slot-legend">
              <span class="legend-item tk-value">value</span><span class="legend-sep">—</span><span class="legend-desc">what to compare</span>
              <span class="legend-sep">·</span>
              <span class="legend-item tk-op">op</span><span class="legend-sep">—</span><span class="legend-desc">operator</span>
              <span class="legend-sep">·</span>
              <span class="legend-item tk-param">param</span><span class="legend-sep">—</span><span class="legend-desc">match against</span>
              <span class="legend-sep">·</span>
              <span class="legend-item tk-action">action</span><span class="legend-sep">—</span><span class="legend-desc">what to do</span>
              <span class="legend-sep">·</span>
              <span class="legend-item tk-action-arg">target</span><span class="legend-sep">—</span><span class="legend-desc">what to act on</span>
            </div>

            <div class="rule-area">
              <div class="palette">
                <div v-for="group in palette" :key="group.group" class="palette-group">
                  <div class="palette-group-label" :class="group.cls">{{ group.group }}</div>
                  <div
                    v-for="tok in group.tokens" :key="tok"
                    class="palette-token" :class="tokenClass(tok)"
                    draggable="true"
                    @dragstart="onDragStart($event, tok)"
                    @click="insertAtCaret(tok)"
                    title="Click or drag to insert"
                  >{{ tok }}</div>
                </div>
              </div>

              <div class="editor-wrap">
                <div
                  ref="editorRef"
                  class="rule-editor"
                  :class="{ invalid: !ruleValid }"
                  contenteditable="true"
                  spellcheck="false"
                  @input="onEditorInput"
                  @keydown="onEditorKeydown"
                  @click="onEditorClick"
                  @drop="onEditorDrop"
                  @dragover="onEditorDragover"
                  data-placeholder="e.g.  $if({output}[has]{text1}<do [remove{output}]>)"
                ></div>
                <div v-if="ruleWarnings.length" class="rule-warnings">
                  <div v-for="w in ruleWarnings" :key="w" class="rule-warning-item">⚠ {{ w }}</div>
                </div>
                <div v-if="acVisible" ref="acRef" class="ac-dropdown"
                  :style="{ top: acPos.top + 'px', left: acPos.left + 'px' }">
                  <div
                    v-for="(item, i) in acItems" :key="item"
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
              <label class="field-label">Global cooldown <span class="field-hint">seconds</span></label>
              <input v-model.number="form.cooldown" type="number" min="0" class="field-input" />
            </div>
            <div class="field-group sm">
              <label class="field-label">User cooldown <span class="field-hint">seconds</span></label>
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
              <button
                class="btn-save"
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
.panel-overlay {
  position: fixed; inset: 0; background: rgba(0,0,0,.65);
  display: flex; align-items: flex-start; justify-content: flex-end; z-index: 1000;
}
.panel {
  width: 700px; max-width: 100vw; height: 100vh; background: #1a1a1e;
  border-left: 1px solid #2a2a30; display: flex; flex-direction: column;
  overflow: hidden; animation: slideIn .2s ease;
}
@keyframes slideIn { from { transform: translateX(40px); opacity: 0 } to { transform: none; opacity: 1 } }
.panel-header {
  display: flex; align-items: flex-start; justify-content: space-between;
  padding: 20px 24px 16px; border-bottom: 1px solid #222; flex-shrink: 0;
}
.panel-title { font-size: 16px; font-weight: 700; color: #e0e0e0; }
.panel-cmd   { color: #9d6cff; }
.panel-sub   { font-size: 11px; color: #555; margin-top: 3px; }
.panel-close {
  width: 28px; height: 28px; border: none; background: transparent;
  color: #555; font-size: 14px; cursor: pointer; flex-shrink: 0;
  display: flex; align-items: center; justify-content: center;
}
.panel-close:hover { color: #e0e0e0; }
.panel-loading { padding: 40px; text-align: center; color: #555; font-size: 13px; }
.panel-body { flex: 1; overflow-y: auto; padding: 20px 24px; display: flex; flex-direction: column; gap: 16px; }

.field-group { display: flex; flex-direction: column; gap: 5px; }
.field-group.sm { flex: 1; min-width: 0; }
.field-label {
  font-size: 11px; font-weight: 600; color: #888; text-transform: uppercase;
  letter-spacing: .05em; display: flex; align-items: center; gap: 6px;
}
.field-hint { font-size: 10px; color: #555; font-weight: 400; text-transform: none; letter-spacing: 0; }
.field-input, .field-textarea, .field-select {
  background: #111217; border: 1px solid #2a2a30; color: #e0e0e0;
  font-family: inherit; font-size: 13px; padding: 7px 10px; outline: none; transition: border-color .15s;
}
.field-input:focus, .field-textarea:focus, .field-select:focus { border-color: #6f2bff55; }
.field-textarea { resize: vertical; min-height: 52px; }
.field-select   { appearance: none; cursor: pointer; }

.slot-legend { display: flex; align-items: center; flex-wrap: wrap; gap: 4px; font-size: 10px; padding: 5px 0 2px; }
.legend-item { font-family: 'Consolas','Fira Mono',monospace; font-size: 10px; padding: 1px 5px; border: 1px solid; border-radius: 2px; }
.legend-sep  { color: #333; }
.legend-desc { color: #444; }

.rule-area { display: flex; gap: 10px; align-items: flex-start; }
.palette { width: 138px; flex-shrink: 0; display: flex; flex-direction: column; gap: 10px; }
.palette-group { display: flex; flex-direction: column; gap: 2px; }
.palette-group-label { font-size: 9px; font-weight: 700; text-transform: uppercase; letter-spacing: .06em; margin-bottom: 3px; opacity: .7; }
.palette-token {
  display: inline-block; padding: 3px 7px; font-size: 11px;
  font-family: 'Consolas','Fira Mono',monospace;
  cursor: pointer; border: 1px solid transparent; transition: opacity .1s;
  user-select: none; white-space: nowrap;
}
.palette-token:hover { opacity: .75; }
.palette-token[draggable="true"] { cursor: grab; }

.editor-wrap { flex: 1; position: relative; }
.rule-editor {
  min-height: 110px; max-height: 260px; overflow-y: auto;
  background: #0d0d10; border: 1px solid #2a2a30;
  padding: 10px 12px; font-family: 'Consolas','Fira Mono',monospace; font-size: 13px;
  line-height: 1.8; color: #c0c0c0; outline: none; white-space: pre-wrap; word-break: break-all;
  transition: border-color .15s;
}
.rule-editor:focus   { border-color: #6f2bff55; }
.rule-editor.invalid { border-color: #f1494966; }
.rule-editor:empty::before { content: attr(data-placeholder); color: #2a2a35; pointer-events: none; }

.rule-warnings     { margin-top: 5px; display: flex; flex-direction: column; gap: 2px; }
.rule-warning-item { font-size: 11px; color: #f5a623; background: rgba(245,166,35,.08); border-left: 2px solid #f5a62366; padding: 3px 7px; }

.ac-dropdown { position: absolute; z-index: 100; background: #1a1a1e; border: 1px solid #2a2a30; min-width: 160px; max-height: 180px; overflow-y: auto; }
.ac-item { padding: 5px 10px; font-size: 12px; font-family: 'Consolas','Fira Mono',monospace; cursor: pointer; transition: background .1s; }
.ac-item:hover, .ac-item.active { background: #2a2a35; }

:deep(.tk-wrapper), .palette-token.tk-wrapper, .ac-item.tk-wrapper, .palette-group-label.tk-wrapper, .legend-item.tk-wrapper { color: #569cd6; border-color: #569cd633; }
:deep(.tk-op),      .palette-token.tk-op,      .ac-item.tk-op,      .palette-group-label.tk-op,      .legend-item.tk-op      { color: #c792ea; border-color: #c792ea33; }
:deep(.tk-action),  .palette-token.tk-action,  .ac-item.tk-action,  .palette-group-label.tk-action,  .legend-item.tk-action  { color: #f14949; border-color: #f1494933; }
:deep(.tk-value),   .palette-token.tk-value,   .ac-item.tk-value,   .palette-group-label.tk-value,   .legend-item.tk-value   { color: #4ec9b0; border-color: #4ec9b033; }
:deep(.tk-param),   .palette-token.tk-param,   .ac-item.tk-param,   .palette-group-label.tk-param,   .legend-item.tk-param   { color: #e5c07b; border-color: #e5c07b33; }
:deep(.tk-action-arg), .legend-item.tk-action-arg { color: #7ec8a0; border-color: #7ec8a033; }

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
