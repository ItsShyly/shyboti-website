// composables/scriptReference.ts
//
// Single shared source of truth for the "variable reference" list shown in
// every script editor (custom commands, countdowns, triggers, timers). Keeping
// this in one file means a new $token only has to be documented once and it
// shows up identically everywhere, instead of drifting out of sync the way the
// old per-component copies did (the countdown/command control tokens below
// were missing entirely from the old CommandEditPanel-only copy of this list).

export interface RefItem { token: string; desc: string; example: string; only?: 'countdown' }
export interface RefGroup { label: string; items: RefItem[] }

export const REF_GROUPS: RefGroup[] = [
  { label: 'Control Flow', items: [
    { token: '$if(condition){ }', desc: 'Conditional block', example: '$if($user.is(mod)){ You are a mod! }' },
    { token: '$if(condition){ }$else{ }', desc: 'With an else branch', example: '$if($args){ $args }$else{ nothing }' },
    { token: '$foreach(item in list){ }', desc: 'Loop over list', example: '$foreach(q in $list.quotes){ $q }' },
    { token: '$repeat(n){ }', desc: 'Repeat n times', example: '$repeat(3){ hi }' },
    { token: '$define name(params){ }', desc: 'Define a macro', example: '$define greet(user){ hi $user }' },
    { token: '$index', desc: 'Current loop index (0-based)', example: '' },
  ]},
  { label: 'Operators', items: [
    { token: '=  ==', desc: 'Equal (both work, same thing)', example: '$if($1 = win){ nice }' },
    { token: '!=', desc: 'Not equal', example: '$if($1 != win){ try again }' },
    { token: '<', desc: 'Less than (numeric)', example: '$if($counter.wins < 10){ keep going }' },
    { token: '>', desc: 'Greater than (numeric)', example: '$if($counter.wins > 10){ nice! }' },
    { token: '<=', desc: 'Less than or equal', example: '$if($args.count <= 1){ one word max }' },
    { token: '>=', desc: 'Greater than or equal', example: '$if($counter.wins >= 100){ legend }' },
    { token: 'and  or  not', desc: 'Combine conditions', example: '$if($user.is(mod) and $args){ ok }' },
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
    { token: '$emote.has(7tv,emote)', desc: 'Check if emote exists', example: '$emote.has(7tv,KEKW) → true' },
    { token: '$emote.count(7tv)', desc: 'Count emotes', example: '42' },
  ]},
  { label: 'Command', items: [
    { token: '$command.output', desc: 'Built-in command output', example: 'Now playing: Never Gonna Give You Up' },
    { token: '$command.uses', desc: 'Times command was used', example: '17' },
    { token: '$command.name', desc: 'Command name', example: '!song' },
    { token: '$command.name.exists', desc: 'Does another command exist?', example: '$command.hype.exists → true' },
    { token: '$command.name.response', desc: 'Raw response of another command', example: '$command.hype.response' },
    { token: '$command.name.run', desc: 'Call another command, use its output', example: '$command.hype.run' },
    { token: '$command.name.create(text)', desc: 'Create/update another command', example: '$command.hype.create(LETS GO!)' },
  ]},
  { label: 'Countdown', items: [
    { token: '$countdown.remaining', desc: "Seconds left (inside this countdown's own message)", example: '$countdown.remaining', only: 'countdown' },
    { token: '$countdown.total', desc: 'Total duration in seconds', example: '$countdown.total', only: 'countdown' },
    { token: '$countdown.elapsed', desc: 'Seconds elapsed', example: '$countdown.elapsed', only: 'countdown' },
    { token: '$countdown.percent', desc: 'Percent complete (0-100)', example: '$countdown.percent', only: 'countdown' },
    { token: '$countdown.running', desc: 'true/false', example: '$countdown.running', only: 'countdown' },
    { token: '$countdown.name.remaining', desc: 'Read any named countdown, from anywhere', example: '$countdown.hype.remaining' },
    { token: '$countdown.name.start', desc: 'Start a countdown from a command/trigger/timer', example: '$countdown.hype.start' },
    { token: '$countdown.name.stop', desc: 'Stop a countdown', example: '$countdown.hype.stop' },
    { token: '$countdown.name.reset', desc: 'Stop and clear a countdown', example: '$countdown.hype.reset' },
  ]},
  { label: 'Moderation', items: [
    { token: '$mod.timeout(user,seconds)', desc: 'Timeout user', example: '$mod.timeout($target.name,60)' },
    { token: '$mod.ban(user)', desc: 'Ban user', example: '$mod.ban($target.name)' },
    { token: '$mod.delete(msg_id)', desc: 'Delete message', example: '$mod.delete($message.id)' },
    { token: '$mod.purge(user)', desc: 'Purge user messages', example: '$mod.purge($target.name)' },
  ]},
]

// >>> Returns the reference groups for a given editor context. Items marked
// >>> `only: 'countdown'` (the bare $countdown.remaining/total/elapsed/percent/
// >>> running tokens) only resolve to a real value inside that countdown's own
// >>> msg_start/msg_tick/msg_end, so they're hidden everywhere else - unlike
// >>> $countdown.name.<x>, which names a specific countdown and therefore works
// >>> (and stays listed) in every editor: commands, timers, triggers, and other
// >>> countdowns alike.
export function getRefGroups(context?: 'countdown'): RefGroup[] {
  return REF_GROUPS
    .map(g => ({ ...g, items: g.items.filter(item => !item.only || item.only === context) }))
    .filter(g => g.items.length > 0)
}

// >>> Renders a $token with the "name" portion (e.g. counter/list/countdown/command
// >>> name, and bracketed args) styled distinctly, for display in the reference list.
export function renderRefToken(token: string): string {
  let result = token
  const namePrefixes = ['$counter.', '$ucounter.', '$var.', '$uvar.', '$list.', '$countdown.', '$command.']
  for (const prefix of namePrefixes) {
    if (result.startsWith(prefix)) {
      const rest = result.slice(prefix.length)
      const m = rest.match(/^(\w+)(.*)/s)
      if (m) {
        result = prefix + `<span class="ep-ref-token-name">${m[1]}</span>` + (m[2] ?? '')
      }
      break
    }
  }
  result = result.replace(/\(([^)]+)\)/g, (_, inner: string) => {
    const colored = inner.split(',').map((part: string) => {
      const trimmed = part.trim()
      if (/^[a-zA-Z_]\w*$/.test(trimmed)) {
        return `<span class="ep-ref-token-name">${trimmed}</span>`
      }
      return part
    }).join(',')
    return `(${colored})`
  })
  return result
}
