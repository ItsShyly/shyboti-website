/**
 * scriptHighlight.ts
 * Syntax highlighter for the ShyBoti scripting language.
 * Returns an HTML string with <span class="sh-*"> tokens for the editor.
 */

const KEYWORDS  = ['$if', '$else', '$end', '$foreach', '$repeat', '$define']
const BUILTINS  = [
  '$counter', '$ucounter', '$var', '$uvar', '$list',
  '$user', '$target', '$channel', '$command', '$message',
  '$args', '$query', '$random', '$time', '$text', '$regex',
  '$calc', '$http', '$twitch', '$emote', '$log',
  '$mod', '$chat', '$cooldown', '$debug',
  '$index', '$last_error',
  '$1','$2','$3','$4','$5','$6','$7','$8','$9',
]

function esc(s: string): string {
  return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
}

export function highlightScript(src: string): string {
  let out = '', i = 0

  while (i < src.length) {
    // Comment: # to end of line
    if (src[i] === '#') {
      const end = src.indexOf('\n', i)
      const line = end === -1 ? src.slice(i) : src.slice(i, end)
      out += `<span class="sh-comment">${esc(line)}</span>`
      i += line.length; continue
    }

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
      const tok  = src.slice(i, j)
      const base = '$' + tok.slice(1).split(/[.(]/)[0]!
      let cls = 'sh-error'
      if (KEYWORDS.some(k  => tok.startsWith(k)))   cls = 'sh-kw'
      else if (BUILTINS.some(b => tok.startsWith(b) || tok === b)) cls = 'sh-builtin'
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
