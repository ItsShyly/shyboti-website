/**
 * scriptHighlight.ts
 * Syntax highlighter for the ShyBoti scripting language.
 * Returns an HTML string with <span class="sh-*"> tokens for the editor.
 */

const KEYWORDS  = ['$if', '$else', '$end', '$foreach', '$repeat', '$define']

// Families where the user chooses a name — e.g. $var.wins, $counter.deaths, $list.quotes
// These get sh-custom coloring (teal/cyan) to distinguish from fixed builtins
const CUSTOM_FAMILIES = ['$counter.', '$ucounter.', '$var.', '$uvar.', '$list.']

// Known fixed builtin prefixes (no user-defined name segment)
const BUILTIN_PREFIXES = [
  '$user', '$target', '$channel', '$command', '$message',
  '$args', '$query', '$random', '$time', '$text', '$regex',
  '$calc', '$http', '$twitch', '$emote', '$log',
  '$mod', '$chat', '$cooldown', '$debug',
  '$index', '$last_error',
  '$1','$2','$3','$4','$5','$6','$7','$8','$9',
]

// Legacy flat list kept for callers that used BUILTINS
const BUILTINS = [...CUSTOM_FAMILIES.map(f => f.slice(0, -1)), ...BUILTIN_PREFIXES]

function esc(s: string): string {
  return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
}

export function highlightScript(src: string): string {
  let out = '', i = 0

  while (i < src.length) {
    // Quoted string
    if (src[i] === '"' || src[i] === "'") {
      const q = src[i]!; let j = i + 1
      while (j < src.length && src[j] !== q) { if (src[j] === '\\') j++; j++ }
      j++
      out += `<span class="sh-string">${esc(src.slice(i, j))}</span>`
      i = j; continue
    }

    // Number
    if (/\d/.test(src[i]!)) {
      let j = i
      while (j < src.length && /[\d.]/.test(src[j]!)) j++
      out += `<span class="sh-number">${esc(src.slice(i, j))}</span>`
      i = j; continue
    }

    // $-token
    if (src[i] === '$') {
      let j = i + 1
      while (j < src.length && /[\w.]/.test(src[j]!)) j++
      if (src[j] === '(') {
        let depth = 0
        while (j < src.length) {
          if (src[j] === '(') depth++
          else if (src[j] === ')') { depth--; j++; if (depth === 0) break; continue }
          j++
        }
      }
      const tok = src.slice(i, j)

      let cls: string
      if (KEYWORDS.some(k => tok.startsWith(k))) {
        // Control flow keyword — blue
        cls = 'sh-kw'
      } else if (CUSTOM_FAMILIES.some(f => tok.startsWith(f))) {
        // User-named family ($var.wins, $counter.deaths) — render with two-tone span:
        // family prefix in builtin colour, user name in custom colour
        const family = CUSTOM_FAMILIES.find(f => tok.startsWith(f))!
        const rest   = tok.slice(family.length)  // e.g. "wins" or "wins.get"
        // Split rest at first dot to separate user name from sub-property
        const dotIdx   = rest.indexOf('.')
        const userName = dotIdx === -1 ? rest : rest.slice(0, dotIdx)
        const subProp  = dotIdx === -1 ? '' : rest.slice(dotIdx)
        const familyHtml  = `<span class="sh-builtin">${esc(family)}</span>`
        const userHtml    = `<span class="sh-custom">${esc(userName)}</span>`
        const subHtml     = subProp ? `<span class="sh-builtin">${esc(subProp)}</span>` : ''
        out += familyHtml + userHtml + subHtml
        i = j; continue
      } else if (BUILTIN_PREFIXES.some(b => tok === b || tok.startsWith(b + '.') || tok.startsWith(b + '('))) {
        // Known fixed builtin — purple
        cls = 'sh-builtin'
      } else {
        // Starts with $ but matches nothing known — red error
        cls = 'sh-error'
      }
      out += `<span class="${cls}">${esc(tok)}</span>`
      i = j; continue
    }

    // Operators
    if ('=!<>'.includes(src[i]!)) {
      const two = src.slice(i, i + 2)
      if (['==','!=','<=','>='].includes(two)) { out += `<span class="sh-op">${esc(two)}</span>`; i += 2; continue }
      if ('<>'.includes(src[i]!)) { out += `<span class="sh-op">${esc(src[i]!)}</span>`; i++; continue }
    }

    // Keyword operators: and, or, not
    const wordOp = src.slice(i).match(/^(and|or|not)\b/)
    if (wordOp) { out += `<span class="sh-op">${wordOp[1]}</span>`; i += wordOp[1]!.length; continue }

    // Parens / punctuation
    if ('(),'.includes(src[i]!)) { out += `<span class="sh-paren">${esc(src[i]!)}</span>`; i++; continue }
    if (src[i] === '.') { out += `<span class="sh-paren">.</span>`; i++; continue }

    // Newline
    if (src[i] === '\n') { out += '\n'; i++; continue }

    out += esc(src[i]!); i++
  }

  return out
}
