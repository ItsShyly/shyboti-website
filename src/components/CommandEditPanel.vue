<script setup lang="ts">
import { ref, watch, computed, nextTick, onMounted, onUnmounted } from 'vue'
import { API } from '../api'
import { useAuth } from '../auth'

// ─── Types ───────────────────────────────────────────────────────────────────

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
  isBuiltIn?: boolean   // true = hardcoded bot command, no Response field
}

const props  = defineProps<Props>()
const emit   = defineEmits<{ (e: 'close'): void; (e: 'saved'): void }>()
const { session } = useAuth()

// ─── State ───────────────────────────────────────────────────────────────────

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

// ─── Load ────────────────────────────────────────────────────────────────────

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

// After load(), seed the editor DOM with the loaded rule.
// The _userIsTyping flag prevents this from firing during normal typing
// (onEditorInput manages DOM directly when typing).
watch(() => form.value.rule, (newRule) => {
  if (_userIsTyping) return
  const el = editorRef.value
  if (!el) return
  el.innerHTML = highlight(newRule)
}, { flush: 'post' })

// ─── Save ────────────────────────────────────────────────────────────────────

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

// ─── Rule editor ─────────────────────────────────────────────────────────────

const editorRef      = ref<HTMLDivElement | null>(null)
let   _userIsTyping  = false  // prevents watcher re-seeding DOM while user types
const acRef       = ref<HTMLDivElement | null>(null)
const acItems     = ref<string[]>([])
const acIndex     = ref(0)
const acPos       = ref({ top: 0, left: 0 })
const acVisible   = ref(false)
const acTrigger   = ref('')   // the partial token being typed

// Token groups & their colors (CSS vars defined in style)
const WRAPPERS    = ['$if']
const OPERATORS   = ['[has]','[=]','[starts]','[ends]']
const ACTIONS     = ['[replace]','[remove]','[delete]','[prepend]','[append]','[send]','[stop]']
const VALUES      = ['{output}','{input}','{user}','{channel}','{args}']
const PARAMS_BASE = ['{regex1}','{regex2}','{text1}','{text2}']

function allTokens() {
  return [...WRAPPERS, ...OPERATORS, ...ACTIONS, ...VALUES, ...PARAMS_BASE]
}

function tokenClass(tok: string): string {
  if (WRAPPERS.includes(tok))    return 'tk-wrapper'
  if (OPERATORS.includes(tok))   return 'tk-op'
  if (ACTIONS.includes(tok))     return 'tk-action'
  if (VALUES.includes(tok))      return 'tk-value'
  if (PARAMS_BASE.includes(tok)) return 'tk-param'
  return ''
}

// Sentinel placeholder — private-use Unicode char, survives DOM round-trips
// Never appears in normal text, not stripped by innerText/textContent
const PLACEHOLDER = '\uE000'

// Syntax highlight: returns HTML string
function highlight(src: string): string {
  // 1. Escape HTML
  const esc = src
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')

  // 2. Wrap structural regions with tinted spans
  function wrapRegions(s: string): string {
    let out = '', i = 0
    while (i < s.length) {
      // $if( ... ) — blue tint
      if (s.startsWith('$if(', i)) {
        let depth = 0, j = i + 4, inner = '$if('
        for (; j < s.length; j++) {
          inner += s[j]
          if (s[j] === '(') depth++
          else if (s[j] === ')') { if (depth === 0) break; depth-- }
        }
        out += `<span class="if-block">${inner}</span>`
        i = j + 1; continue
      }
      // $else{ ... } — blue tint
      if (s.startsWith('$else{', i)) {
        let depth = 0, j = i + 6, inner = '$else{'
        for (; j < s.length; j++) {
          inner += s[j]
          if (s[j] === '{') depth++
          else if (s[j] === '}') { if (depth === 0) break; depth-- }
        }
        out += `<span class="if-block">${inner}</span>`
        i = j + 1; continue
      }
      // &lt;do ... &gt; — blue tint
      if (s.startsWith('&lt;do', i)) {
        const end = s.indexOf('&gt;', i)
        if (end !== -1) {
          out += `<span class="if-block">${s.slice(i, end + 4)}</span>`
          i = end + 4; continue
        }
      }
      // [action{args}] or [action]{args} — red tint
      // Match [actionName followed by optional {args} then ]
      const actionMatch = s.slice(i).match(/^\[(replace|remove|delete|prepend|append|send|stop)((?:\{[\w\uE000]+\})*)\]/)
      if (actionMatch) {
        out += `<span class="action-block">${actionMatch[0]}</span>`
        i += actionMatch[0].length; continue
      }
      out += s[i]; i++
    }
    return out
  }

  const wrapped = wrapRegions(esc)

  // 3. Colorise individual tokens
  const pat = /(\$if|\$else|\[(?:replace|remove|delete|prepend|append|send|stop|has|=|starts|ends)\]|\{(?:output|input|user|channel|args|regex1|regex2|text1|text2)\}|&lt;do|&gt;|\uE000)/g

  return wrapped.replace(pat, (m) => {
    const raw = m.replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&amp;/g,'&')
    let cls = ''
    if (['$if','$else'].includes(raw) || raw === '<do' || raw === '>')            cls = 'tk-wrapper'
    else if (['[has]','[=]','[starts]','[ends]'].includes(raw))                   cls = 'tk-op'
    else if (/^\[(replace|remove|delete|prepend|append|send|stop)\]$/.test(raw))  cls = 'tk-action'
    else if (['{output}','{input}','{user}','{channel}','{args}'].includes(raw))  cls = 'tk-value'
    else if (['{regex1}','{regex2}','{text1}','{text2}'].includes(raw))           cls = 'tk-param'
    else if (raw === '\uE000')                                                     return `<span class="tk-placeholder">\uE000</span>`
    return cls ? `<span class="${cls}">${m}</span>` : m
  })
}

// Detailed rule warnings — always visible, blocks save if non-empty
const ruleWarnings = computed((): string[] => {
  const r = form.value.rule
  if (!r.trim()) return []
  const warnings: string[] = []
  // Unfilled placeholders
  const phCount = (r.match(/\uE000/g) || []).length
  if (phCount > 0) warnings.push(`${phCount} unfilled placeholder${phCount > 1 ? 's' : ''} (yellow spaces) in rule`)
  // Mismatched $if / <do>
  const ifCount  = (r.match(/\$if\(/g) || []).length
  const doCount  = (r.match(/<do/g)   || []).length
  if (ifCount !== doCount) warnings.push(`${ifCount} $if block${ifCount !== 1 ? 's' : ''} but ${doCount} <do> block${doCount !== 1 ? 's' : ''} — must match`)
  return warnings
})

const ruleValid = computed(() => ruleWarnings.value.length === 0)

// Re-render highlighted content while preserving caret
function applyHighlight() {
  const el = editorRef.value
  if (!el) return
  const sel   = window.getSelection()
  const range = sel && sel.rangeCount ? sel.getRangeAt(0) : null

  // Get plain text offset
  let offset = 0
  if (range && el.contains(range.startContainer)) {
    const preRange = document.createRange()
    preRange.setStart(el, 0)
    preRange.setEnd(range.startContainer, range.startOffset)
    offset = preRange.toString().length
  }

  el.innerHTML = highlight(form.value.rule)

  // Restore caret
  if (range) {
    restoreCaret(el, offset)
  }
}

function restoreCaret(el: HTMLElement, offset: number) {
  const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT)
  let remaining = offset
  while (walker.nextNode()) {
    const node = walker.currentNode as Text
    if (remaining <= node.length) {
      const r = document.createRange()
      r.setStart(node, remaining)
      r.collapse(true)
      const sel = window.getSelection()
      sel?.removeAllRanges()
      sel?.addRange(r)
      return
    }
    remaining -= node.length
  }
}

function getPlainText(el: HTMLElement): string {
  // \uE000 survives innerText round-trips natively — no special recovery needed
  return el.innerText.replace(/\n\n/g, '\n')
}

// Strip sentinels before saving — placeholders not filled = removed from saved rule
function ruleForSave(rule: string): string {
  return rule.replace(/\uE000/g, '')
}

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
    if (e.key === 'ArrowDown')  { e.preventDefault(); acIndex.value = Math.min(acIndex.value + 1, acItems.value.length - 1); return }
    if (e.key === 'ArrowUp')    { e.preventDefault(); acIndex.value = Math.max(acIndex.value - 1, 0); return }
    if (e.key === 'Enter' || e.key === 'Tab') { e.preventDefault(); insertAcItem(); return }
    if (e.key === 'Escape')     { acVisible.value = false; return }
  }
  // Auto-insert $if skeleton with ◆ placeholders for required slots
  if (e.key === '(' && form.value.rule.endsWith('$if')) {
    e.preventDefault()
    // ◆ marks "fill this in" spots — yellow bg in highlight
    insertText(`({output}[has]${PLACEHOLDER}<do [${PLACEHOLDER}]>)`)
  }
}

function checkAutocomplete() {
  const el  = editorRef.value
  if (!el) return
  const sel = window.getSelection()
  if (!sel || !sel.rangeCount) return

  const range    = sel.getRangeAt(0).cloneRange()
  range.collapse(true)
  const preRange = document.createRange()
  preRange.setStart(el, 0)
  preRange.setEnd(range.startContainer, range.startOffset)
  const textBefore = preRange.toString()

  // Find partial token at cursor
  const partial = textBefore.match(/(\$[\w]*|\[[\w=]*|\{[\w]*)$/)
  if (!partial) { acVisible.value = false; return }

  const p = partial[0]
  const candidates = allTokens().filter(t => t.startsWith(p) && t !== p)
  if (!candidates.length) { acVisible.value = false; return }

  acTrigger.value = p
  acItems.value   = candidates
  acIndex.value   = 0
  acVisible.value = true

  // Position dropdown near cursor
  const rect = range.getBoundingClientRect()
  const editorRect = el.getBoundingClientRect()
  acPos.value = { top: rect.bottom - editorRect.top + 4, left: rect.left - editorRect.left }
}

function insertAcItem() {
  const item = acItems.value[acIndex.value]
  if (!item) return
  acVisible.value = false

  const el  = editorRef.value
  if (!el) return
  const sel = window.getSelection()
  if (!sel || !sel.rangeCount) return

  // Delete the partial trigger text, insert full token
  const range    = sel.getRangeAt(0)
  const preRange = document.createRange()
  preRange.setStart(el, 0)
  preRange.setEnd(range.startContainer, range.startOffset)
  const full  = preRange.toString()
  const after = full.slice(0, full.length - acTrigger.value.length)
  const rest  = getPlainText(el).slice(full.length)

  form.value.rule = after + item + rest
  applyHighlight()

  // Move caret after inserted token
  nextTick(() => restoreCaret(el, (after + item).length))
}

function insertText(text: string) {
  const el  = editorRef.value
  if (!el) return
  const sel = window.getSelection()
  if (!sel || !sel.rangeCount) return

  const range    = sel.getRangeAt(0)
  const preRange = document.createRange()
  preRange.setStart(el, 0)
  preRange.setEnd(range.startContainer, range.startOffset)
  const before = preRange.toString()
  const allText = getPlainText(el)
  const after   = allText.slice(before.length)

  form.value.rule = before + text + after
  applyHighlight()
  nextTick(() => restoreCaret(el, (before + text).length))
}

// Drag token from palette into editor
function onDragStart(e: DragEvent, token: string) {
  e.dataTransfer?.setData('text/plain', token)
}

// Build the insertion string for a dragged token, optionally wrapping selected text
function buildDropInsert(token: string, selected: string): string {
  const sel = selected.trim()
  // Wrappers
  if (token === '$if') {
    return sel
      ? `$if(${sel}[has]${PLACEHOLDER}<do [${PLACEHOLDER}]>)`
      : `$if(${PLACEHOLDER}[has]${PLACEHOLDER}<do [${PLACEHOLDER}]>)`
  }
  if (token === '$else') {
    return sel ? `$else{${sel}}` : `$else{[${PLACEHOLDER}]}`
  }
  // Actions — wrap selected text as the arg
  const isAction = ACTIONS.includes(token)
  if (isAction) {
    const name = token.slice(1, -1) // strip [ ]
    return sel ? `[${name}{${sel}}]` : `[${name}{${PLACEHOLDER}}]`
  }
  return token
}

function onEditorDrop(e: DragEvent) {
  e.preventDefault()
  const token = e.dataTransfer?.getData('text/plain')
  if (!token) return
  const el = editorRef.value!
  el.focus()

  // Capture any currently selected text inside the editor
  const sel     = window.getSelection()
  let selText   = ''
  let selStart  = 0
  let selEnd    = 0
  if (sel && sel.rangeCount && el.contains(sel.anchorNode)) {
    const r    = sel.getRangeAt(0)
    selText    = r.toString()
    const pre  = document.createRange()
    pre.setStart(el, 0)
    pre.setEnd(r.startContainer, r.startOffset)
    selStart   = pre.toString().length
    selEnd     = selStart + selText.length
  }

  // Find drop caret position
  let dropOffset = selStart // default: insert at selection start if wrapping
  if (!selText && (document as any).caretRangeFromPoint) {
    const r = (document as any).caretRangeFromPoint(e.clientX, e.clientY)
    if (r) {
      const pre = document.createRange()
      pre.setStart(el, 0)
      pre.setEnd(r.startContainer, r.startOffset)
      dropOffset = pre.toString().length
    }
  }

  const plain  = getPlainText(el)
  const insert = buildDropInsert(token, selText)

  // Replace selection (if any) or insert at cursor
  const before = plain.slice(0, selText ? selStart : dropOffset)
  const after  = plain.slice(selText ? selEnd : dropOffset)
  form.value.rule = before + insert + after
  applyHighlight()
  nextTick(() => restoreCaret(el, before.length + insert.length))
}

function onEditorDragover(e: DragEvent) { e.preventDefault() }

// Palette drag items
const palette = [
  { group: 'Wrappers',   tokens: WRAPPERS },
  { group: 'Operators',  tokens: OPERATORS },
  { group: 'Actions',    tokens: ACTIONS },
  { group: 'Values',     tokens: VALUES },
  { group: 'Parameters', tokens: PARAMS_BASE },
]

// Click outside autocomplete
function onClickOutside(e: MouseEvent) {
  if (acVisible.value && acRef.value && !acRef.value.contains(e.target as Node)) {
    acVisible.value = false
  }
}
onMounted(()    => document.addEventListener('mousedown', onClickOutside))
onUnmounted(()  => document.removeEventListener('mousedown', onClickOutside))
</script>

<template>
  <Teleport to="body">
    <div v-if="open" class="panel-overlay" @click.self="emit('close')">
      <div class="panel">

        <!-- Header -->
        <div class="panel-header">
          <div>
            <div class="panel-title">Edit <span class="panel-cmd">+{{ cmdName }}</span></div>
            <div class="panel-sub">Custom response &amp; rule builder for #{{ channel }}</div>
          </div>
          <button class="panel-close" @click="emit('close')">✕</button>
        </div>

        <div v-if="loading" class="panel-loading">Loading…</div>

        <div v-else class="panel-body">

          <!-- Response: editable for custom commands, locked placeholder for built-ins -->
          <div class="field-group">
            <template v-if="!isBuiltIn">
              <label class="field-label">Response <span class="field-hint">Use {user} {channel} {args}</span></label>
              <textarea v-model="form.response" class="field-textarea" rows="2"
                placeholder="Hello {user}! You said: {args}" />
            </template>
            <template v-else>
              <label class="field-label">Output <span class="field-hint">Hardcoded — the bot generates this</span></label>
              <div class="output-placeholder">
                <span class="op-brace">{</span>
                <span class="op-label">output</span>
                <span class="op-brace">}</span>
              </div>
            </template>
          </div>

          <!-- Rule editor + palette -->
          <div class="field-group">
            <label class="field-label">
              Rule
              <span class="field-hint">Modifies {output} before it's sent. Drag tokens or type $, [, {</span>
            </label>
            <div class="rule-area">
              <!-- Palette -->
              <div class="palette">
                <div v-for="group in palette" :key="group.group" class="palette-group">
                  <div class="palette-group-label">{{ group.group }}</div>
                  <div
                    v-for="tok in group.tokens" :key="tok"
                    class="palette-token" :class="tokenClass(tok)"
                    draggable="true"
                    @dragstart="onDragStart($event, tok)"
                    @click="insertText(tok)"
                    :title="'Click or drag to insert'"
                  >{{ tok }}</div>
                </div>
              </div>

              <!-- Editor -->
              <div class="editor-wrap">
                <div
                  ref="editorRef"
                  class="rule-editor"
                  :class="{ invalid: !ruleValid }"
                  contenteditable="true"
                  spellcheck="false"
                  @input="onEditorInput"
                  @keydown="onEditorKeydown"
                  @drop="onEditorDrop"
                  @dragover="onEditorDragover"
                  :data-placeholder="'[remove{text1}]  or  $if({output}[has]{text1}<do [remove{text1}]>)'"
                ></div>
                <div v-if="ruleWarnings.length" class="rule-warnings">
                  <div v-for="w in ruleWarnings" :key="w" class="rule-warning-item">⚠ {{ w }}</div>
                </div>

                <!-- Autocomplete dropdown -->
                <div
                  v-if="acVisible"
                  ref="acRef"
                  class="ac-dropdown"
                  :style="{ top: acPos.top + 'px', left: acPos.left + 'px' }"
                >
                  <div
                    v-for="(item, i) in acItems" :key="item"
                    class="ac-item" :class="[tokenClass(item), { active: i === acIndex }]"
                    @mousedown.prevent="acIndex = i; insertAcItem()"
                  >{{ item }}</div>
                </div>
              </div>
            </div>
          </div>

          <!-- Parameters row -->
          <div class="params-row">
            <div class="field-group sm" v-for="p in ['regex1','regex2','text1','text2']" :key="p">
              <label class="field-label">
                <span :class="'tk-param inline'">{{ '{' + p + '}' }}</span>
              </label>
              <input v-model="(form as any)[p]" class="field-input" :placeholder="p === 'regex1' || p === 'regex2' ? 'pattern…' : 'text…'" />
            </div>
          </div>

          <!-- Conditions row -->
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

          <!-- Cooldowns row -->
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

          <!-- Footer actions -->
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
              >
                {{ saved ? '✓ Saved' : saving ? 'Saving…' : !ruleValid ? '⚠ Fix rule' : 'Save' }}
              </button>
            </div>
          </div>
        </div>

      </div>
    </div>
  </Teleport>
</template>

<style scoped>
/* ── Overlay & panel ─────────────────────────────────────────────────────── */
.panel-overlay {
  position: fixed; inset: 0; background: rgba(0,0,0,.65);
  display: flex; align-items: flex-start; justify-content: flex-end;
  z-index: 1000; padding: 0;
}
.panel {
  width: 680px; max-width: 100vw; height: 100vh;
  background: #1a1a1e; border-left: 1px solid #2a2a30;
  display: flex; flex-direction: column; overflow: hidden;
  animation: slideIn .2s ease;
}
@keyframes slideIn { from { transform: translateX(40px); opacity: 0 } to { transform: none; opacity: 1 } }

.panel-header {
  display: flex; align-items: flex-start; justify-content: space-between;
  padding: 20px 24px 16px; border-bottom: 1px solid #222;
  flex-shrink: 0;
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
.panel-body    { flex: 1; overflow-y: auto; padding: 20px 24px; display: flex; flex-direction: column; gap: 16px; }

/* ── Fields ──────────────────────────────────────────────────────────────── */
.field-group { display: flex; flex-direction: column; gap: 5px; }
.field-group.sm { flex: 1; min-width: 0; }
.field-label {
  font-size: 11px; font-weight: 600; color: #888; text-transform: uppercase; letter-spacing: .05em;
  display: flex; align-items: center; gap: 6px;
}
.field-hint  { font-size: 10px; color: #555; font-weight: 400; text-transform: none; letter-spacing: 0; }
.field-input, .field-textarea, .field-select {
  background: #111217; border: 1px solid #2a2a30; color: #e0e0e0;
  font-family: inherit; font-size: 13px; padding: 7px 10px; outline: none;
  transition: border-color .15s;
}
.field-input:focus, .field-textarea:focus, .field-select:focus { border-color: #6f2bff55; }
.field-textarea { resize: vertical; min-height: 52px; }
.field-select   { appearance: none; cursor: pointer; }

/* output-placeholder styles are in global <style> block below due to Teleport */

/* ── Rule area ───────────────────────────────────────────────────────────── */
.rule-area {
  display: flex; gap: 10px; align-items: flex-start;
}

/* Palette */
.palette {
  width: 138px; flex-shrink: 0; display: flex; flex-direction: column; gap: 10px;
}
.palette-group-label {
  font-size: 9px; font-weight: 700; color: #444; text-transform: uppercase;
  letter-spacing: .06em; margin-bottom: 3px;
}
.palette-group { display: flex; flex-direction: column; gap: 2px; }
.palette-token {
  display: inline-block; padding: 3px 7px; font-size: 11px; font-family: 'Consolas','Fira Mono',monospace;
  cursor: grab; border: 1px solid transparent; transition: opacity .1s;
  user-select: none; white-space: nowrap;
}
.palette-token:hover { opacity: .75; }

/* Editor */
.editor-wrap { flex: 1; position: relative; }
.rule-editor {
  min-height: 110px; max-height: 260px; overflow-y: auto;
  background: #0d0d10; border: 1px solid #2a2a30;
  padding: 10px 12px; font-family: 'Consolas','Fira Mono',monospace; font-size: 13px;
  line-height: 1.6; color: #c0c0c0; outline: none; white-space: pre-wrap; word-break: break-all;
  transition: border-color .15s;
}
.rule-editor:focus { border-color: #6f2bff55; }
.rule-editor.invalid { border-color: #f1494966; }
.rule-editor:empty::before {
  content: attr(data-placeholder); color: #333; pointer-events: none;
}
.rule-warnings { margin-top: 5px; display: flex; flex-direction: column; gap: 2px; }
.rule-warning-item { font-size: 11px; color: #e5c07b; background: rgba(229,192,123,.08); border-left: 2px solid #e5c07b66; padding: 3px 7px; }

/* Autocomplete */
.ac-dropdown {
  position: absolute; z-index: 100;
  background: #1a1a1e; border: 1px solid #2a2a30;
  min-width: 160px; max-height: 180px; overflow-y: auto;
}
.ac-item {
  padding: 5px 10px; font-size: 12px; font-family: 'Consolas','Fira Mono',monospace;
  cursor: pointer; transition: background .1s;
}
.ac-item:hover, .ac-item.active { background: #2a2a35; }

/* ── Token colours ───────────────────────────────────────────────────────── */
/* Deep (global) selectors needed because they're injected into contenteditable innerHTML */
:deep(.tk-wrapper), .palette-token.tk-wrapper, .ac-item.tk-wrapper { color: #569cd6; border-color: #569cd633; }
:deep(.tk-op),      .palette-token.tk-op,      .ac-item.tk-op      { color: #c792ea; border-color: #c792ea33; }
:deep(.tk-action),  .palette-token.tk-action,  .ac-item.tk-action  { color: #f14949; border-color: #f1494933; }
:deep(.tk-value),   .palette-token.tk-value,   .ac-item.tk-value   { color: #4ec9b0; border-color: #4ec9b033; }
:deep(.tk-param),   .palette-token.tk-param,   .ac-item.tk-param   { color: #e5c07b; border-color: #e5c07b33; }
:deep(.tk-do)                                                        { color: #666; }

.tk-param.inline { font-size: 11px; font-family: 'Consolas','Fira Mono',monospace; }

/* ── Params / conditions rows ────────────────────────────────────────────── */
.params-row, .cond-row {
  display: flex; gap: 10px;
}

/* ── Footer ──────────────────────────────────────────────────────────────── */
.panel-footer {
  display: flex; align-items: center; justify-content: space-between;
  padding-top: 16px; border-top: 1px solid #222; margin-top: 4px;
}
.footer-right { display: flex; gap: 8px; }

.btn-save {
  height: 34px; padding: 0 20px; border: none;
  background: #6f2bff; color: #fff; font-family: inherit; font-size: 12px; font-weight: 600;
  cursor: pointer; transition: background .15s;
}
.btn-save:hover:not(:disabled) { background: #7f3fff; }
.btn-save:disabled { opacity: .4; cursor: not-allowed; }
.btn-save.saved    { background: #1a3d2a; color: #23d18b; }
.btn-save.invalid  { background: #2a1a0a; color: #e5c07b; border: 1px solid #e5c07b44; }
.btn-cancel {
  height: 34px; padding: 0 16px; border: 1px solid #333; background: transparent;
  color: #888; font-family: inherit; font-size: 12px; cursor: pointer;
}
.btn-cancel:hover { border-color: #555; color: #e0e0e0; }
.btn-delete {
  height: 34px; padding: 0 14px; border: 1px solid #f1494944; background: transparent;
  color: #f14949; font-family: inherit; font-size: 12px; cursor: pointer;
  transition: background .15s;
}
.btn-delete:hover:not(:disabled) { background: #f1494911; }
.btn-delete:disabled { opacity: .4; cursor: not-allowed; }
</style>

<!-- Global styles for Teleport-rendered content -->
<style>
.output-placeholder {
  display: inline-flex; align-items: center; gap: 2px;
  background: #0d0d10; border: 1px dashed #252530;
  padding: 8px 14px; font-family: 'Consolas','Fira Mono',monospace;
  user-select: none; cursor: default;
}
.op-brace { font-size: 20px; color: #2a2a35; line-height: 1; font-weight: 300; }
.op-label { font-size: 13px; color: #333; letter-spacing: .06em; padding: 0 4px; }

/* $if / $else{ / <do > block tint */
.if-block {
  background: rgba(86, 156, 214, 0.09);
  border: 1px solid rgba(86, 156, 214, 0.18);
  border-radius: 2px;
  padding: 1px 3px;
  display: inline;
}
/* [action{args}] block tint */
.action-block {
  background: rgba(241, 73, 73, 0.08);
  border: 1px solid rgba(241, 73, 73, 0.2);
  border-radius: 2px;
  padding: 1px 3px;
  display: inline;
}
/* placeholder — empty yellow space */
.tk-placeholder {
  display: inline-block;
  min-width: 14px;
  background: rgba(229, 192, 123, 0.28);
  border: 1px solid rgba(229, 192, 123, 0.5);
  border-radius: 2px;
  cursor: text;
}
</style>
