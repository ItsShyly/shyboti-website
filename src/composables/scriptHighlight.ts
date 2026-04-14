/**
 * scriptHighlight.ts
 * Syntax highlighter for the ShyBoti scripting language.
 */

const KEYWORDS = ['$if', '$else', '$end', '$foreach', '$repeat', '$define']

const CUSTOM_FAMILIES = ['$counter.', '$ucounter.', '$var.', '$uvar.', '$list.']

const BUILTIN_PREFIXES = [
  '$user', '$target', '$channel', '$command', '$message',
  '$args', '$query', '$random', '$time', '$text', '$regex',
  '$calc', '$http', '$twitch', '$emote', '$log',
  '$mod', '$chat', '$cooldown', '$debug',
  '$index', '$last_error',
  '$1','$2','$3','$4','$5','$6','$7','$8','$9',
]

const BUILTINS = [...CUSTOM_FAMILIES.map(f => f.slice(0, -1)), ...BUILTIN_PREFIXES]

function esc(s: string): string {
  return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
}

interface IfBlock {
  start: number          // position of '$if'
  condStart: number      // position of '('
  condEnd: number        // position of ')'
  end: number            // position after '$end'
  bodyStart: number      // position after ')'
  bodyEnd: number        // position before '$end'
  balanced: boolean
}

function findIfBlocks(src: string): IfBlock[] {
  const blocks: IfBlock[] = []
  const stack: number[] = []  // indices of '$if(' starts
  let i = 0

  while (i < src.length) {
    if (src.startsWith('$if(', i)) {
      stack.push(i)
      i += 4
    } else if (src.startsWith('$end', i) && stack.length > 0) {
      const start = stack.pop()!
      // Find matching closing parenthesis for condition
      let depth = 0
      let condEnd = -1
      for (let j = start + 4; j < i; j++) {
        const ch = src[j]
        if (ch === '(') depth++
        else if (ch === ')') {
          if (depth === 0) { condEnd = j; break }
          depth--
        }
      }
      const balanced = condEnd !== -1
      blocks.push({
        start,
        condStart: start + 3,   // position of '('
        condEnd: balanced ? condEnd : i,
        end: i + 4,
        bodyStart: balanced ? condEnd + 1 : start + 4,
        bodyEnd: i,
        balanced,
      })
      i += 4
    } else {
      i++
    }
  }

  // Sort by start position descending (innermost first)
  return blocks.sort((a, b) => b.start - a.start)
}

function wrapIfBlocksWithStructure(src: string): string {
  const blocks = findIfBlocks(src)
  if (blocks.length === 0) return src

  let result = src
  for (const b of blocks) {
    const before = result.slice(0, b.start)
    const after  = result.slice(b.end)

    let condHtml: string
    let bodyHtml: string

    if (b.balanced) {
      const condRaw = result.slice(b.condStart + 1, b.condEnd)
      const bodyRaw = result.slice(b.bodyStart, b.bodyEnd)
      // Recursively wrap inner blocks inside condition and body
      condHtml = `<span class="sh-cond">${wrapIfBlocksWithStructure(condRaw)}</span>`
      bodyHtml = `<span class="sh-body">${wrapIfBlocksWithStructure(bodyRaw)}</span>`
    } else {
      // Unbalanced block – wrap everything from $if to the end as error
      const inner = result.slice(b.start + 4, b.end - 4)
      condHtml = `<span class="sh-error-block">${esc(inner)}</span>`
      bodyHtml = ''
    }

    const ifToken = `<span class="sh-kw">$if</span>`
    const openParen = `<span class="sh-paren">(</span>`
    const closeParen = b.balanced ? `<span class="sh-paren">)</span>` : ''
    const endToken = b.balanced ? `<span class="sh-kw">$end</span>` : ''

    const wrapped = ifToken + openParen + condHtml + closeParen + bodyHtml + endToken
    result = before + wrapped + after
  }

  return result
}

function applyTokenHighlighting(html: string): string {
  let out = ''
  let i = 0

  while (i < html.length) {
    // Skip already wrapped spans (sh-cond, sh-body, sh-error-block, sh-kw from above)
    if (html.startsWith('<span class="sh-', i)) {
      let j = i
      while (j < html.length && html[j] !== '>') j++
      j++
      let depth = 1
      while (j < html.length && depth > 0) {
        if (html.startsWith('<span', j)) depth++
        else if (html.startsWith('</span>', j)) depth--
        j++
      }
      out += html.slice(i, j)
      i = j
      continue
    }

    const ch = html[i]!

    // Quoted string
    if (ch === '"' || ch === "'") {
      const q = ch
      let j = i + 1
      while (j < html.length && html[j] !== q) {
        if (html[j] === '\\') j++
        j++
      }
      j++
      out += `<span class="sh-string">${esc(html.slice(i, j))}</span>`
      i = j
      continue
    }

    // Number
    if (/\d/.test(ch)) {
      let j = i
      while (j < html.length && /[\d.]/.test(html[j]!)) j++
      out += `<span class="sh-number">${esc(html.slice(i, j))}</span>`
      i = j
      continue
    }

    // $-token
    if (ch === '$') {
      let j = i + 1
      while (j < html.length && /[\w.]/.test(html[j]!)) j++
      if (html[j] === '(') {
        let depth = 0
        while (j < html.length) {
          if (html[j] === '(') depth++
          else if (html[j] === ')') {
            depth--
            j++
            if (depth === 0) break
            continue
          }
          j++
        }
      }
      const tok = html.slice(i, j)

      let cls: string
      if (KEYWORDS.some(k => tok.startsWith(k))) {
        cls = 'sh-kw'
      } else if (CUSTOM_FAMILIES.some(f => tok.startsWith(f))) {
        const family = CUSTOM_FAMILIES.find(f => tok.startsWith(f))!
        const rest = tok.slice(family.length)
        const dotIdx = rest.indexOf('.')
        const userName = dotIdx === -1 ? rest : rest.slice(0, dotIdx)
        const subProp = dotIdx === -1 ? '' : rest.slice(dotIdx)
        out += `<span class="sh-builtin">${esc(family)}</span>` +
               `<span class="sh-custom">${esc(userName)}</span>` +
               (subProp ? `<span class="sh-builtin">${esc(subProp)}</span>` : '')
        i = j
        continue
      } else if (BUILTIN_PREFIXES.some(b => tok === b || tok.startsWith(b + '.') || tok.startsWith(b + '('))) {
        cls = 'sh-builtin'
      } else if (/^\$[a-zA-Z_]\w*$/.test(tok) || /^\$[a-zA-Z_]\w*\(/.test(tok)) {
        cls = 'sh-custom'
      } else {
        cls = 'sh-error'
      }
      out += `<span class="${cls}">${esc(tok)}</span>`
      i = j
      continue
    }

    // Operators
    if ('=!<>'.includes(ch)) {
      const two = html.slice(i, i + 2)
      if (['==', '!=', '<=', '>='].includes(two)) {
        out += `<span class="sh-op">${esc(two)}</span>`
        i += 2
        continue
      }
      if ('<>'.includes(ch)) {
        out += `<span class="sh-op">${esc(ch)}</span>`
        i++
        continue
      }
    }

    // Keyword operators
    const wordOp = html.slice(i).match(/^(and|or|not)\b/)
    if (wordOp) {
      out += `<span class="sh-op">${wordOp[1]}</span>`
      i += wordOp[1]!.length
      continue
    }

    // Parens / punctuation
    if ('(),'.includes(ch)) {
      out += `<span class="sh-paren">${esc(ch)}</span>`
      i++
      continue
    }
    if (ch === '.') {
      out += `<span class="sh-paren">.</span>`
      i++
      continue
    }

    // Newline
    if (ch === '\n') {
      out += '\n'
      i++
      continue
    }

    out += esc(ch)
    i++
  }

  return out
}

export function highlightScript(src: string): string {
  const structured = wrapIfBlocksWithStructure(src)
  return applyTokenHighlighting(structured)
}