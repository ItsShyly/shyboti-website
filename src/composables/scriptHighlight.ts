/**
 * scriptHighlight.ts
 * Syntax highlighter for the ShyBoti scripting language.
 * Returns an HTML string with <span class="sh-*"> tokens for the editor.
 *
 */

const CUSTOM_FAMILIES = ['$counter.', '$ucounter.', '$var.', '$uvar.', '$list.']

const BUILTIN_PREFIXES = [
  '$user', '$target', '$channel', '$command', '$message',
  '$args', '$query', '$random', '$time', '$text', '$regex',
  '$calc', '$http', '$twitch', '$emote', '$log',
  '$mod', '$chat', '$cooldown', '$debug',
  '$index', '$last_error',
  '$1','$2','$3','$4','$5','$6','$7','$8','$9',
]

// Block keywords that take no parens
const BLOCK_KEYWORDS_SIMPLE = ['$else', '$end']
// Block keywords that take parens
const BLOCK_KEYWORDS_PAREN  = ['$foreach', '$repeat', '$define']

function esc(s: string): string {
  return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
}

// 3 levels of color for nested $if blocks
// level 0 = outermost, level 1 = first nest, level 2+ = second nest (cycles)
const IF_COLORS = [
  { kw: '#569cd6', cond: '#7ec8e3', body: '#4ec9b0' },  // blue / cyan / teal
  { kw: '#c792ea', cond: '#e0b0ff', body: '#f9a84d' },  // purple / lavender / orange
  { kw: '#4ec9b0', cond: '#98d9c8', body: '#569cd6' },  // teal / mint / blue
]

function colorAt(level: number) {
  return IF_COLORS[level % IF_COLORS.length]!
}

/**
 * Check if a condition string is valid.
 * Minimal requirement: non‑empty and contains at least one `$` variable.
 */
function isValidCondition(cond: string): boolean {
  const trimmed = cond.trim()
  return trimmed.length > 0 && /\$/.test(trimmed)
}

export function highlightScript(src: string, ifLevel = 0): string {
  let out = '', i = 0

  while (i < src.length) {
    // Newline
    if (src[i] === '\n') { out += '\n'; i++; continue }

    // Quoted string
    if (src[i] === '"' || src[i] === "'") {
      const q = src[i]!; let j = i + 1
      while (j < src.length && src[j] !== q) { if (src[j] === '\\') j++; j++ }
      j++
      out += `<span class="sh-string">${esc(src.slice(i, j))}</span>`
      i = j; continue
    }

    // Number literal (only when not part of a $token)
    if (/\d/.test(src[i]!) && (i === 0 || !/[$\w]/.test(src[i-1]!))) {
      let j = i
      while (j < src.length && /[\d.]/.test(src[j]!)) j++
      out += `<span class="sh-number">${esc(src.slice(i, j))}</span>`
      i = j; continue
    }

    // $if block - handle recursively
    if (src.startsWith('$if(', i) || src.startsWith('$if (', i)) {
      const col = colorAt(ifLevel)

      // Find matching closing ) for condition
      const parenStart = src.indexOf('(', i + 3)
      if (parenStart === -1) {
        out += `<span class="sh-kw" style="color:${col.kw}">${esc('$if')}</span>`
        i += 3
        continue
      }

      let depth = 0, condEnd = -1
      for (let k = parenStart; k < src.length; k++) {
        if (src[k] === '(') depth++
        else if (src[k] === ')') { depth--; if (depth === 0) { condEnd = k; break } }
      }

      if (condEnd === -1) {
        out += `<span class="sh-kw" style="color:${col.kw}">${esc('$if')}</span>`
        out += esc(src.slice(i + 3))
        i = src.length
        continue
      }

      const condSrc = src.slice(parenStart + 1, condEnd)
      const afterCond = src.slice(condEnd + 1)
      const braceMatch = afterCond.match(/^\s*\{/)

      // Emit $if keyword
      out += `<span class="sh-kw" style="color:${col.kw}">$if</span>`

      // Condition slot with validation class
      const condTrimmed = condSrc.trim()
      const condValid = isValidCondition(condSrc)
      const condClass = condTrimmed === '' ? 'empty-cond' : (condValid ? '' : 'invalid-cond')
      out += `<span class="sh-if-cond ${condClass}" style="color:${col.cond}">(${esc(condSrc)})</span>`

      if (braceMatch) {
        // Brace syntax: find matching }
        const braceStart = condEnd + 1 + afterCond.indexOf('{')
        let bdepth = 0, bodyEnd = -1
        for (let k = braceStart; k < src.length; k++) {
          if (src[k] === '{') bdepth++
          else if (src[k] === '}') { bdepth--; if (bdepth === 0) { bodyEnd = k; break } }
        }

        if (bodyEnd === -1) {
          // Unclosed brace - emit rest as body error
          const body = src.slice(braceStart + 1)
          const bodyTrimmed = body.trim()
          const bodyClass = bodyTrimmed === '' ? 'empty-body' : ''
          out += `<span class="sh-if-body ${bodyClass}" style="color:${col.body}">{${highlightScript(body, ifLevel + 1)}}</span>`
          i = src.length
          continue
        }

        const body = src.slice(braceStart + 1, bodyEnd)
        const gap = src.slice(condEnd + 1, braceStart)
        if (gap.trim()) out += esc(gap)

        const bodyTrimmed = body.trim()
        const bodyClass = bodyTrimmed === '' ? 'empty-body' : ''
        out += `<span class="sh-if-body ${bodyClass}" style="color:${col.body}">{${highlightScript(body, ifLevel + 1)}}</span>`
        i = bodyEnd + 1
      } else {
        // Legacy $end syntax - kept for compatibility
        const endRel = afterCond.indexOf('$end')
        if (endRel === -1) {
          i = condEnd + 1
        } else {
          const bodyStart = condEnd + 1
          const bodyEnd   = condEnd + 1 + endRel
          const body      = src.slice(bodyStart, bodyEnd)
          const bodyTrimmed = body.trim()
          const bodyClass = bodyTrimmed === '' ? 'empty-body' : ''
          out += `<span class="sh-if-body ${bodyClass}" style="color:${col.body}">{${highlightScript(body, ifLevel + 1)}}</span>`
          i = bodyEnd + 4 // length of '$end'
        }
      }
      continue
    }

    // $else - simple keyword
    if (src.startsWith('$else', i) && !/\w/.test(src[i+5] ?? '')) {
      out += `<span class="sh-kw">$else</span>`
      i += 5
      continue
    }

    // $end - legacy, show faded
    if (src.startsWith('$end', i) && !/\w/.test(src[i+4] ?? '')) {
      out += `<span class="sh-kw sh-end">$end</span>`
      i += 4
      continue
    }

    // Other block keywords: $foreach, $repeat, $define
    const blockKw = BLOCK_KEYWORDS_PAREN.find(k => src.startsWith(k, i))
    if (blockKw) {
      out += `<span class="sh-kw">${esc(blockKw)}</span>`
      i += blockKw.length
      continue
    }

    // $-token
    if (src[i] === '$') {
      let j = i + 1
      while (j < src.length && /[\w.]/.test(src[j]!)) j++
      // If followed by (, consume args
      if (src[j] === '(') {
        let depth = 0
        while (j < src.length) {
          if (src[j] === '(') depth++
          else if (src[j] === ')') { depth--; j++; if (depth === 0) break; continue }
          j++
        }
      }
      const tok = src.slice(i, j)

      if (CUSTOM_FAMILIES.some(f => tok.startsWith(f))) {
        const family = CUSTOM_FAMILIES.find(f => tok.startsWith(f))!
        const rest   = tok.slice(family.length)
        const dotIdx   = rest.indexOf('.')
        const userName = dotIdx === -1 ? rest : rest.slice(0, dotIdx)
        const subProp  = dotIdx === -1 ? '' : rest.slice(dotIdx)
        out += `<span class="sh-builtin">${esc(family)}</span>` +
               `<span class="sh-custom">${esc(userName)}</span>` +
               (subProp ? `<span class="sh-builtin">${esc(subProp)}</span>` : '')
        i = j
        continue
      }

      let cls: string
      if (BUILTIN_PREFIXES.some(b => tok === b || tok.startsWith(b + '.') || tok.startsWith(b + '('))) {
        cls = 'sh-builtin'
      } else if (/^\$[a-zA-Z_]\w*(\(.*\))?$/.test(tok)) {
        cls = 'sh-custom'
      } else {
        cls = 'sh-error'
      }
      out += `<span class="${cls}">${esc(tok)}</span>`
      i = j
      continue
    }

    // Operators
    if ('=!<>'.includes(src[i]!)) {
      const two = src.slice(i, i + 2)
      if (['==','!=','<=','>='].includes(two)) {
        out += `<span class="sh-op">${esc(two)}</span>`
        i += 2
        continue
      }
      if ('<>'.includes(src[i]!)) {
        out += `<span class="sh-op">${esc(src[i]!)}</span>`
        i++
        continue
      }
    }

    // &
    if (src[i] === '&' && src[i+1] === '&') {
      out += `<span class="sh-op">&amp;&amp;</span>`
      i += 2
      continue
    }

    // Keyword operators: and, or, not
    const wordOp = src.slice(i).match(/^(and|or|not)\b/)
    if (wordOp) {
      out += `<span class="sh-op">${wordOp[1]}</span>`
      i += wordOp[1]!.length
      continue
    }

    // Parens / braces / punctuation
    if ('(),'.includes(src[i]!)) {
      out += `<span class="sh-paren">${esc(src[i]!)}</span>`
      i++
      continue
    }
    if (src[i] === '.') {
      out += `<span class="sh-paren">.</span>`
      i++
      continue
    }
    if (src[i] === '{') {
      out += `<span class="sh-paren">{</span>`
      i++
      continue
    }
    if (src[i] === '}') {
      out += `<span class="sh-paren">}</span>`
      i++
      continue
    }

    out += esc(src[i]!)
    i++
  }

  return out
}

if (import.meta.hot) {}