/**
 * scriptHighlight.ts
 * Syntax highlighter for the ShyBoti scripting language.
 * Returns an HTML string with <span class="sh-*"> tokens for the editor.
 */

const KEYWORDS  = ['$if', '$else', '$end', '$foreach', '$repeat', '$define']

// >>> Families where the user chooses a name - e.g. $var.wins, $counter.deaths, $list.quotes
// >>> These get sh-custom coloring (teal/cyan) to distinguish from fixed builtins
const CUSTOM_FAMILIES = ['$counter.', '$ucounter.', '$var.', '$uvar.', '$list.']

// >>> Known fixed builtin prefixes (no user-defined name segment)
const BUILTIN_PREFIXES = [
  '$user', '$target', '$channel', '$command', '$message',
  '$args', '$query', '$random', '$time', '$text', '$regex',
  '$calc', '$http', '$twitch', '$emote', '$log',
  '$mod', '$chat', '$cooldown', '$debug',
  '$index', '$last_error',
  '$1','$2','$3','$4','$5','$6','$7','$8','$9',
]

// >>> Legacy flat list kept for callers that used BUILTINS
const BUILTINS = [...CUSTOM_FAMILIES.map(f => f.slice(0, -1)), ...BUILTIN_PREFIXES]

function esc(s: string): string {
  return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
}

/**
 * Recursively wrap $if(...) ... $end blocks with visual containers.
 * Uses a stack to correctly handle nested blocks.
 */
function wrapIfBlocks(code: string): string {
  const stack: number[] = []       // positions of '$if' starts
  const blocks: Array<{ start: number; condEnd: number; end: number }> = []
  let i = 0

  while (i < code.length) {
    if (code.startsWith('$if(', i)) {
      stack.push(i)
      i += 4
    } else if (code.startsWith('$end', i) && stack.length > 0) {
      const start = stack.pop()!
      // Find the closing parenthesis of the condition
      let depth = 0
      let condEnd = -1
      for (let j = start + 4; j < i; j++) {
        const ch = code[j]
        if (ch === '(') depth++
        else if (ch === ')') {
          if (depth === 0) { condEnd = j; break }
          depth--
        }
      }
      if (condEnd !== -1) {
        blocks.push({ start, condEnd, end: i + 4 })
      }
      i += 4
    } else {
      i++
    }
  }

  if (blocks.length === 0) return code

  // Sort blocks by start position descending (innermost first)
  blocks.sort((a, b) => b.start - a.start)

  let result = code
  for (const b of blocks) {
    const before   = result.slice(0, b.start)
    const cond     = result.slice(b.start + 4, b.condEnd)
    const body     = result.slice(b.condEnd + 1, b.end - 4)  // between ) and $end
    const after    = result.slice(b.end)

    const wrappedCond = wrapIfBlocks(cond) // process nested conditions
    const wrappedBody = wrapIfBlocks(body) // process nested bodies

    const wrapped = `<span class="if-block-container">` +
                    `<span class="if-token" contenteditable="false">$if</span>` +
                    `<span class="if-token" contenteditable="false">(</span>` +
                    wrappedCond +
                    `<span class="if-token" contenteditable="false">)</span>` +
                    wrappedBody +
                    `<span class="if-token" contenteditable="false">$end</span>` +
                    `</span>`

    result = before + wrapped + after
  }

  return result
}

export function highlightScript(src: string): string {
  // First, wrap all if-blocks with visual containers
  let out = wrapIfBlocks(src)

  // Then apply standard token highlighting
  let i = 0
  const result: string[] = []

  while (i < out.length) {
    // Skip already wrapped spans (they contain HTML)
    if (out.startsWith('<span', i)) {
      let j = i
      while (j < out.length && out[j] !== '>') j++
      j++
      let depth = 1
      while (j < out.length && depth > 0) {
        if (out.startsWith('<span', j)) depth++
        else if (out.startsWith('</span>', j)) depth--
        j++
      }
      result.push(out.slice(i, j))
      i = j
      continue
    }

    const ch = out[i]!

    // >>> Quoted string
    if (ch === '"' || ch === "'") {
      const q = ch; let j = i + 1
      while (j < out.length && out[j] !== q) { if (out[j] === '\\') j++; j++ }
      j++
      result.push(`<span class="sh-string">${esc(out.slice(i, j))}</span>`)
      i = j; continue
    }

    // >>> Number
    if (/\d/.test(ch)) {
      let j = i
      while (j < out.length && /[\d.]/.test(out[j]!)) j++
      result.push(`<span class="sh-number">${esc(out.slice(i, j))}</span>`)
      i = j; continue
    }

    // >>> $-token (but not inside already wrapped if-token)
    if (ch === '$') {
      let j = i + 1
      while (j < out.length && /[\w.]/.test(out[j]!)) j++
      if (out[j] === '(') {
        let depth = 0
        while (j < out.length) {
          if (out[j] === '(') depth++
          else if (out[j] === ')') { depth--; j++; if (depth === 0) break; continue }
          j++
        }
      }
      const tok = out.slice(i, j)

      let cls: string
      if (KEYWORDS.some(k => tok.startsWith(k))) {
        cls = 'sh-kw'
      } else if (CUSTOM_FAMILIES.some(f => tok.startsWith(f))) {
        const family = CUSTOM_FAMILIES.find(f => tok.startsWith(f))!
        const rest   = tok.slice(family.length)
        const dotIdx   = rest.indexOf('.')
        const userName = dotIdx === -1 ? rest : rest.slice(0, dotIdx)
        const subProp  = dotIdx === -1 ? '' : rest.slice(dotIdx)
        result.push(
          `<span class="sh-builtin">${esc(family)}</span>` +
          `<span class="sh-custom">${esc(userName)}</span>` +
          (subProp ? `<span class="sh-builtin">${esc(subProp)}</span>` : '')
        )
        i = j; continue
      } else if (BUILTIN_PREFIXES.some(b => tok === b || tok.startsWith(b + '.') || tok.startsWith(b + '('))) {
        cls = 'sh-builtin'
      } else if (/^\$[a-zA-Z_]\w*$/.test(tok) || /^\$[a-zA-Z_]\w*\(/.test(tok)) {
        cls = 'sh-custom'
      } else {
        cls = 'sh-error'
      }
      result.push(`<span class="${cls}">${esc(tok)}</span>`)
      i = j; continue
    }

    // >>> Operators
    if ('=!<>'.includes(ch)) {
      const two = out.slice(i, i + 2)
      if (['==','!=','<=','>='].includes(two)) {
        result.push(`<span class="sh-op">${esc(two)}</span>`); i += 2; continue
      }
      if ('<>'.includes(ch)) {
        result.push(`<span class="sh-op">${esc(ch)}</span>`); i++; continue
      }
    }

    // >>> Keyword operators: and, or, not
    const wordOp = out.slice(i).match(/^(and|or|not)\b/)
    if (wordOp) {
      result.push(`<span class="sh-op">${wordOp[1]}</span>`)
      i += wordOp[1]!.length; continue
    }

    // >>> Parens / punctuation
    if ('(),'.includes(ch)) {
      result.push(`<span class="sh-paren">${esc(ch)}</span>`); i++; continue
    }
    if (ch === '.') {
      result.push(`<span class="sh-paren">.</span>`); i++; continue
    }

    // >>> Newline
    if (ch === '\n') {
      result.push('\n'); i++; continue
    }

    result.push(esc(ch)); i++
  }

  return result.join('')
}