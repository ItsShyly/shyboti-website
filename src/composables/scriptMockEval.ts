/**
 * scriptMockEval.ts
 * Client-side mock evaluator for the Normal Mode editor preview.
 * Uses fake/static values for all Twitch-live variables.
 * Mirrors the logic of scriptEngine.ts but runs in the browser with no DB.
 */

export interface MockContext {
  user:         string
  display:      string
  channel:      string
  args:         string
  argList:      string[]
  messageText:  string
  isMod:        boolean
  isVip:        boolean
  isSub:        boolean
  isBroadcaster: boolean
  commandOutput: string
}

export const DEFAULT_MOCK: MockContext = {
  user:         'testuser',
  display:      'TestUser',
  channel:      'testchannel',
  args:         'hello world',
  argList:      ['hello', 'world'],
  messageText:  '+command hello world',
  isMod:        false,
  isVip:        false,
  isSub:        false,
  isBroadcaster: false,
  commandOutput: '[bot output]',
}

// In-memory mock counters/vars/lists for preview session
const mockCounters: Record<string, number> = {}
const mockVars:     Record<string, string> = {}
const mockLists:    Record<string, string[]> = {}

export function resetMockState() {
  for (const k in mockCounters) delete mockCounters[k]
  for (const k in mockVars)     delete mockVars[k]
  for (const k in mockLists)    delete mockLists[k]
}

// ─── Entry point ─────────────────────────────────────────────────────────────

export function mockEval(src: string, ctx: MockContext = DEFAULT_MOCK): string {
  if (!src?.trim()) return ''
  const env: MockEnv = { ctx, macros: {}, locals: {}, index: 0, calls: 0 }
  return evalSrc(src, env)
}

interface MockEnv {
  ctx:    MockContext
  macros: Record<string, { params: string[]; body: string }>
  locals: Record<string, string>
  index:  number
  calls:  number
}

// ─── Tokeniser (same structure as server) ────────────────────────────────────

function evalSrc(src: string, env: MockEnv): string {
  if (env.calls++ > 500) return '[overflow]'
  let out = '', i = 0

  while (i < src.length) {
    const rest = src.slice(i)

    // $if(<cond>) ... [$else ...] $end
    const ifM = rest.match(/^\$if\s*\(/)
    if (ifM) {
      const condStart = i + ifM[0].length
      const condEnd   = findMatchingParen(src, condStart - 1)
      const cond      = src.slice(condStart, condEnd)
      const { thenSrc, elseSrc, endIdx } = findIfBody(src, condEnd + 1)
      const condVal = evalExprStr(cond, env)
      out += evalSrc(isTruthy(condVal) ? thenSrc : (elseSrc ?? ''), env)
      i = endIdx; continue
    }

    // $foreach
    const feM = rest.match(/^\$foreach\s*\(/)
    if (feM) {
      const argStart = i + feM[0].length
      const argEnd   = findMatchingParen(src, argStart - 1)
      const argStr   = src.slice(argStart, argEnd)
      const fm       = argStr.match(/^(\w+)\s+in\s+(.+)$/)
      const item     = fm?.[1] ?? 'item'
      const list     = evalExprStr(fm?.[2]?.trim() ?? '', env)
      const items    = list.split(',').map(s => s.trim()).filter(Boolean)
      const { body, endIdx } = findBlock(src, argEnd + 1)
      const childEnv = { ...env, locals: { ...env.locals } }
      let loopOut = ''
      for (let idx = 0; idx < Math.min(items.length, 20); idx++) {
        childEnv.locals[item] = items[idx]!; childEnv.index = idx
        loopOut += evalSrc(body, childEnv)
      }
      out += loopOut; i = endIdx; continue
    }

    // $repeat
    const repM = rest.match(/^\$repeat\s*\(/)
    if (repM) {
      const argStart = i + repM[0].length
      const argEnd   = findMatchingParen(src, argStart - 1)
      const count    = parseInt(evalExprStr(src.slice(argStart, argEnd), env)) || 0
      const { body, endIdx } = findBlock(src, argEnd + 1)
      const childEnv = { ...env, locals: { ...env.locals } }
      let loopOut = ''
      for (let idx = 0; idx < Math.min(count, 20); idx++) {
        childEnv.index = idx; loopOut += evalSrc(body, childEnv)
      }
      out += loopOut; i = endIdx; continue
    }

    // $define
    const defM = rest.match(/^\$define\s+(\w+)\s*\(([^)]*)\)/)
    if (defM) {
      const name   = defM[1]!
      const params = defM[2]!.split(',').map(s => s.trim()).filter(Boolean)
      const after  = i + defM[0].length
      const { body, endIdx } = findBlock(src, after)
      env.macros[name] = { params, body }
      i = endIdx; continue
    }

    // $-expression
    if (src[i] === '$') {
      const exprEnd = findExprEnd(src, i)
      out += evalExpr(src.slice(i, exprEnd), env)
      i = exprEnd; continue
    }

    out += src[i]!; i++
  }

  return out
}

function evalExprStr(raw: string, env: MockEnv): string {
  return evalSrc(raw.trim(), env)
}

function evalExpr(raw: string, env: MockEnv): string {
  const expr  = raw.trim()
  if (!expr.startsWith('$')) return expr
  const inner = expr.slice(1)

  // Locals
  if (env.locals[inner] !== undefined) return env.locals[inner]!

  // $index, $last_error
  if (inner === 'index')      return String(env.index)
  if (inner === 'last_error') return env.locals['__last_error__'] ?? ''

  // $args, $query, $1..$9
  if (inner === 'args' || inner === 'query') return env.ctx.args
  if (inner === 'args.count')               return String(env.ctx.argList.length)
  const argNm  = inner.match(/^args\.(\d+)$/)
  if (argNm)   return env.ctx.argList[parseInt(argNm[1]!) - 1] ?? ''
  const dolN   = inner.match(/^(\d)$/)
  if (dolN)    return env.ctx.argList[parseInt(dolN[1]!) - 1] ?? ''

  // $user.*
  if (inner.startsWith('user')) {
    const prop = inner.slice(4).replace(/^\./, '')
    if (!prop || prop === 'name')  return env.ctx.user
    if (prop === 'display')        return env.ctx.display
    if (prop === 'id')             return '123456789'
    if (prop === 'mention')        return `@${env.ctx.display}`
    if (prop === 'followage')      return '2 years, 3 months'
    if (prop === 'created')        return '2019-04-12'
    if (prop.startsWith('is(')) {
      const role = prop.slice(3, -1).toLowerCase()
      if (role === 'broadcaster') return String(env.ctx.isBroadcaster)
      if (role === 'mod')         return String(env.ctx.isMod)
      if (role === 'vip')         return String(env.ctx.isVip)
      if (role === 'sub')         return String(env.ctx.isSub)
    }
    return ''
  }

  // $target.*
  if (inner.startsWith('target')) {
    const arg0 = env.ctx.argList[0]?.replace('@', '') ?? 'targetuser'
    const prop = inner.slice(6).replace(/^\./, '')
    if (!prop || prop === 'name')  return arg0
    if (prop === 'mention')        return `@${arg0}`
    if (prop === 'id')             return '987654321'
    return ''
  }

  // $channel.*
  if (inner.startsWith('channel')) {
    const prop = inner.slice(7).replace(/^\./, '')
    if (!prop || prop === 'name')  return env.ctx.channel
    if (prop === 'title')          return 'Mock stream title'
    if (prop === 'game')           return 'Just Chatting'
    if (prop === 'viewers')        return '42'
    if (prop === 'isLive')         return 'true'
    if (prop === 'uptime')         return '1h 23m'
    return ''
  }

  // $command.*
  if (inner.startsWith('command')) {
    const prop = inner.slice(7).replace(/^\./, '')
    if (!prop || prop === 'name')  return 'testcmd'
    if (prop === 'uses')           return '17'
    if (prop === 'output')         return env.ctx.commandOutput
    return ''
  }

  // $message.*
  if (inner.startsWith('message')) {
    const prop = inner.slice(7).replace(/^\./, '')
    if (!prop || prop === 'text')  return env.ctx.messageText
    if (prop === 'id')             return 'mock-msg-id'
    if (prop === 'length')         return String(env.ctx.messageText.length)
    return ''
  }

  // $counter.<n>[.op]
  const counterM = inner.match(/^counter\.(\w+)(?:\.(.+))?$/)
  if (counterM) {
    const name = counterM[1]!; const op = counterM[2] ?? ''
    if (!(name in mockCounters)) mockCounters[name] = 0
    if (!op)        { mockCounters[name]++; return String(mockCounters[name]) }
    if (op === 'get')   return String(mockCounters[name])
    if (op === 'reset') { mockCounters[name] = 0; return '0' }
    const setM = op.match(/^set\((.+)\)$/); if (setM) { mockCounters[name] = parseInt(evalExprStr(setM[1]!, env)) || 0; return String(mockCounters[name]) }
    const addM = op.match(/^add\((.+)\)$/); if (addM) { mockCounters[name] += parseInt(evalExprStr(addM[1]!, env)) || 0; return String(mockCounters[name]) }
    return ''
  }

  // $ucounter — same as counter in mock
  const ucounterM = inner.match(/^ucounter\.(\w+)(?:\.(.+))?$/)
  if (ucounterM) {
    const key = `u_${ucounterM[1]}`; const op = ucounterM[2] ?? ''
    if (!(key in mockCounters)) mockCounters[key] = 0
    if (!op) { mockCounters[key]++; return String(mockCounters[key]) }
    if (op === 'get') return String(mockCounters[key])
    return ''
  }

  // $var.<n>[.op]
  const varM = inner.match(/^var\.(\w+)(?:\.(.+))?$/)
  if (varM) {
    const name = varM[1]!; const op = varM[2] ?? ''
    if (!op)           return mockVars[name] ?? ''
    if (op === 'delete') { delete mockVars[name]; return '' }
    const setM = op.match(/^set\((.+)\)$/); if (setM) { mockVars[name] = evalExprStr(setM[1]!, env); return mockVars[name] }
    return ''
  }

  // $uvar — same as var in mock
  const uvarM = inner.match(/^uvar\.(\w+)(?:\.(.+))?$/)
  if (uvarM) {
    const name = `u_${uvarM[1]}`; const op = uvarM[2] ?? ''
    if (!op)           return mockVars[name] ?? ''
    const setM = op.match(/^set\((.+)\)$/); if (setM) { mockVars[name] = evalExprStr(setM[1]!, env); return mockVars[name] }
    return ''
  }

  // $list.<n>[.op]
  const listM = inner.match(/^list\.(\w+)(?:\.(.+))?$/)
  if (listM) {
    const name = listM[1]!; const op = listM[2] ?? ''
    if (!mockLists[name]) mockLists[name] = ['item1', 'item2', 'item3']
    const lst = mockLists[name]!
    if (!op || op === 'random') return lst[Math.floor(Math.random() * lst.length)] ?? ''
    if (op === 'size')  return String(lst.length)
    const addM = op.match(/^add\((.+)\)$/); if (addM) { lst.push(evalExprStr(addM[1]!, env)); return lst[lst.length-1]! }
    const getM = op.match(/^get\((.+)\)$/); if (getM) { return lst[parseInt(evalExprStr(getM[1]!, env))] ?? '' }
    return ''
  }

  // $random.*
  if (inner.startsWith('random')) {
    const prop = inner.slice(6).replace(/^\./, '')
    const intM = prop.match(/^int\((.+),(.+)\)$/)
    if (intM) { const min = parseInt(evalExprStr(intM[1]!, env)); const max = parseInt(evalExprStr(intM[2]!, env)); return String(Math.floor(Math.random() * (max - min + 1)) + min) }
    const pickM = prop.match(/^pick\((.+)\)$/)
    if (pickM) { const items = pickM[1]!.split(',').map(s => s.trim()); return items[Math.floor(Math.random() * items.length)] ?? '' }
    const chanceM = prop.match(/^chance\((.+)\)$/)
    if (chanceM) { return String(Math.random() * 100 < parseFloat(evalExprStr(chanceM[1]!, env))) }
    return ''
  }

  // $time.*
  if (inner.startsWith('time')) {
    const prop = inner.slice(4).replace(/^\./, '')
    if (!prop || prop === 'now')  return new Date().toISOString()
    if (prop === 'unix')          return String(Math.floor(Date.now() / 1000))
    return '2025-01-01T00:00:00Z'
  }

  // $text.*
  if (inner.startsWith('text.')) {
    const call = inner.slice(5)
    const fnM  = call.match(/^(\w+)\((.+)?\)$/)
    if (!fnM) return ''
    const fn = fnM[1]!; const rawArgs = splitArgs(fnM[2] ?? '')
    const a  = (n: number) => evalExprStr(rawArgs[n] ?? '', env)
    switch (fn) {
      case 'len':      return String(a(0).length)
      case 'upper':    return a(0).toUpperCase()
      case 'lower':    return a(0).toLowerCase()
      case 'title':    return a(0).replace(/\b\w/g, c => c.toUpperCase())
      case 'trim':     return a(0).trim()
      case 'contains': return String(a(0).includes(a(1)))
      case 'starts':   return String(a(0).startsWith(a(1)))
      case 'ends':     return String(a(0).endsWith(a(1)))
      case 'replace':  return a(0).split(a(1)).join(a(2))
      case 'remove':   return a(0).split(a(1)).join('')
      case 'split':    return a(0).split(a(1)).join(',')
      case 'join':     return a(0).split(',').join(a(1))
      default: return ''
    }
  }

  // $regex.*
  if (inner.startsWith('regex.')) {
    const call = inner.slice(6)
    const matchM   = call.match(/^match\((.+)\)$/)
    const replaceM = call.match(/^replace\((.+)\)$/)
    if (matchM) { try { const [t, p] = splitArgs(matchM[1]!); const m = evalExprStr(t ?? '', env).match(new RegExp(evalExprStr(p ?? '', env))); return m?.[0] ?? '' } catch { return '' } }
    if (replaceM) { try { const [t, p, r] = splitArgs(replaceM[1]!); return evalExprStr(t ?? '', env).replace(new RegExp(evalExprStr(p ?? '', env), 'g'), evalExprStr(r ?? '', env)) } catch { return '' } }
    return ''
  }

  // $calc
  const calcM = inner.match(/^calc\((.+)\)$/)
  if (calcM) {
    try { const safe = evalExprStr(calcM[1]!, env).replace(/[^0-9+\-*/().\s%]/g, ''); return String(Function(`"use strict"; return (${safe})`)()) } catch { return '0' }
  }

  // $http.* — mock
  if (inner.startsWith('http.')) return '[http response]'

  // $twitch.* — mock
  if (inner.startsWith('twitch.')) {
    const prop = inner.slice(7)
    if (prop === 'uptime')   return '1h 23m'
    if (prop === 'game')     return 'Just Chatting'
    if (prop === 'title')    return 'Mock stream title'
    if (prop.startsWith('followers')) return '1234'
    if (prop.startsWith('subscribers')) return '56'
    return ''
  }

  // $emote.* — mock
  if (inner.startsWith('emote.')) return 'true'

  // $log.* — mock
  if (inner.startsWith('log.')) return '[log result]'

  // $mod.* / $chat.* / $cooldown.* / $debug.*
  if (inner.startsWith('mod.') || inner.startsWith('chat.') ||
      inner.startsWith('cooldown.') || inner.startsWith('debug.')) return ''

  // User macro call
  const macroCallM = inner.match(/^([a-z_]\w*)\((.*)?\)$/)
  if (macroCallM && env.macros[macroCallM[1]!]) {
    const macro   = env.macros[macroCallM[1]!]!
    const rawArgs = splitArgs(macroCallM[2] ?? '')
    const evaled  = rawArgs.map(a => evalExprStr(a, env))
    const childEnv: MockEnv = { ...env, locals: { ...env.locals } }
    for (let i = 0; i < macro.params.length; i++) childEnv.locals[macro.params[i]!] = evaled[i] ?? ''
    return evalSrc(macro.body, childEnv)
  }

  return ''
}

// ─── Parser helpers (same as server) ─────────────────────────────────────────

function findExprEnd(src: string, start: number): number {
  let i = start + 1, depth = 0
  while (i < src.length) {
    const c = src[i]!
    if (c === '(') { depth++; i++; continue }
    if (c === ')') { if (depth === 0) break; depth--; i++; continue }
    if (depth === 0 && /[\s\n\r]/.test(c)) break
    i++
  }
  if (depth > 0 && i < src.length) i++
  return i
}

function findMatchingParen(src: string, openIdx: number): number {
  let depth = 0
  for (let i = openIdx; i < src.length; i++) {
    if (src[i] === '(') depth++
    else if (src[i] === ')') { depth--; if (depth === 0) return i }
  }
  return src.length
}

function findIfBody(src: string, from: number): { thenSrc: string; elseSrc: string | null; endIdx: number } {
  let depth = 0, i = from, thenEnd = -1, elseStart = -1, endIdx = src.length
  while (i < src.length) {
    if (src.slice(i).match(/^\$if\s*\(/))   { depth++; i += 3; continue }
    if (src.slice(i).match(/^\$else\b/) && depth === 0) { thenEnd = i; elseStart = i + 5; i += 5; continue }
    if (src.slice(i).match(/^\$end\b/)  && depth === 0) { if (thenEnd === -1) thenEnd = i; endIdx = i + 4; break }
    if (src.slice(i).match(/^\$end\b/))     { depth--; i += 4; continue }
    i++
  }
  const thenSrc = src.slice(from, thenEnd === -1 ? endIdx - 4 : thenEnd).trim()
  const elseSrc = elseStart !== -1 ? src.slice(elseStart, endIdx - 4).trim() : null
  return { thenSrc, elseSrc, endIdx }
}

function findBlock(src: string, from: number): { body: string; endIdx: number } {
  let depth = 0, i = from
  while (i < src.length) {
    if (src.slice(i).match(/^\$if\s*\(/) || src.slice(i).match(/^\$foreach\s*\(/) || src.slice(i).match(/^\$repeat\s*\(/)) { depth++; i += 3; continue }
    if (src.slice(i, i + 4) === '$end' && depth === 0) return { body: src.slice(from, i).trim(), endIdx: i + 4 }
    if (src.slice(i, i + 4) === '$end') { depth--; i += 4; continue }
    i++
  }
  return { body: src.slice(from).trim(), endIdx: src.length }
}

function splitArgs(raw: string): string[] {
  const args: string[] = []; let depth = 0, buf = ''
  for (const c of raw) {
    if (c === '(' || c === '[') { depth++; buf += c }
    else if (c === ')' || c === ']') { depth--; buf += c }
    else if (c === ',' && depth === 0) { args.push(buf.trim()); buf = '' }
    else buf += c
  }
  if (buf.trim()) args.push(buf.trim())
  return args
}

function isTruthy(val: string): boolean {
  if (val === 'true') return true
  if (val === 'false' || val === '' || val === '0') return false
  const n = Number(val); if (!isNaN(n)) return n !== 0
  return true
}
