<script setup lang="ts">
import { ref, onMounted, onUnmounted } from 'vue'
import { useRoute } from 'vue-router'

// --- Types ---
interface ChatMessage {
  id: number
  user: string
  color: string
  text: string
  parts: MessagePart[]
  timer: ReturnType<typeof setTimeout>
}

interface MessagePart {
  type: 'text' | 'emote'
  value: string
  url?: string
}

// --- State ---
const route = useRoute()
const messages = ref<ChatMessage[]>([])
const emoteMap = ref<Record<string, string>>({})
let ws: WebSocket | null = null
let msgId = 0

// --- Status from OAuth redirect ---
const statusMsg = ref('')

// --- 7TV Emotes ---
const EMOTE_SET_ID = '01JX3CEKZYVQ7JMZTWW638XWG1'

async function loadEmotes() {
  try {
    const res = await fetch(`https://7tv.io/v3/emote-sets/${EMOTE_SET_ID}`)
    const data = await res.json()
    const map: Record<string, string> = {}
    for (const emote of (data.emotes ?? []) as Array<{ name: string; id: string }>) {
      map[emote.name] = `https://cdn.7tv.app/emote/${emote.id}/1x.webp`
    }
    emoteMap.value = map
  } catch (e) {
    console.error('Failed to load 7TV emotes', e)
  }
}

// --- Parse message into text/emote parts ---
function parseMessage(text: string): MessagePart[] {
  return text.split(' ').map((word) => {
    const url = emoteMap.value[word]
    if (url) {
      return { type: 'emote' as const, value: word, url }
    }
    return { type: 'text' as const, value: word }
  })
}

// --- Twitch IRC (anonymous) ---
const CHANNEL = 'itsshyly'

function connectIRC() {
  ws = new WebSocket('wss://irc-ws.chat.twitch.tv:443')

  ws.onopen = () => {
    ws!.send('CAP REQ :twitch.tv/tags twitch.tv/commands')
    ws!.send('NICK justinfan12345')
    ws!.send(`JOIN #${CHANNEL}`)
  }

  ws.onmessage = (event: MessageEvent) => {
    const raw: string = event.data
    const lines = raw.split('\r\n').filter(Boolean)

    for (const line of lines) {
      // PING keepalive
      if (line.startsWith('PING')) {
        ws!.send('PONG :tmi.twitch.tv')
        continue
      }

      if (!line.includes('PRIVMSG')) continue

      const tagSection = line.startsWith('@') ? line.slice(1, line.indexOf(' ')) : ''
      const tags: Record<string, string> = {}
      for (const part of tagSection.split(';')) {
        const eqIdx = part.indexOf('=')
        if (eqIdx !== -1) {
          tags[part.slice(0, eqIdx)] = part.slice(eqIdx + 1)
        }
      }

      const msgMatch = line.match(/PRIVMSG #\w+ :(.+)$/)
      if (!msgMatch || msgMatch[1] == null) continue
      const text = msgMatch[1]

      const displayName = tags['display-name'] ?? 'anonymous'
      const color = tags['color'] ?? '#ffffff'

      addMessage(displayName, color, text)
    }
  }

  ws.onclose = () => {
    setTimeout(connectIRC, 3000)
  }
}

function addMessage(user: string, color: string, text: string) {
  const id = ++msgId
  const parts = parseMessage(text)

  const timer = setTimeout(() => {
    messages.value = messages.value.filter((m) => m.id !== id)
  }, 10000)

  messages.value.push({ id, user, color, text, parts, timer })

  if (messages.value.length > 50) {
    const oldest = messages.value.shift()
    if (oldest) clearTimeout(oldest.timer)
  }
}

// --- Auth ---
const API_BASE = 'https://shyboti.de/api'

function addBot() {
  window.location.href = `${API_BASE}/auth/add`
}

function removeBot() {
  window.location.href = `${API_BASE}/auth/remove`
}

// --- Lifecycle ---
onMounted(async () => {
  // Handle OAuth redirect status
  const status = route.query['status'] as string | undefined
  const channel = route.query['channel'] as string | undefined
  if (status === 'added' && channel) {
    statusMsg.value = `✓ ShyBoti wurde zu #${channel} hinzugefügt!`
  } else if (status === 'removed' && channel) {
    statusMsg.value = `✓ ShyBoti hat #${channel} verlassen.`
  } else if (status === 'error') {
    statusMsg.value = '✗ Fehler beim Authentifizieren.'
  }
  if (statusMsg.value) {
    setTimeout(() => (statusMsg.value = ''), 8000)
  }

  // Load emotes then connect IRC
  await loadEmotes()
  connectIRC()
})

onUnmounted(() => {
  ws?.close()
})
</script>

<template>
  <div class="page">
    <header>
      <h1>ShyBoti ist auf dem Weg&hellip;</h1>
      <div class="buttons">
        <button class="btn btn-add" @click="addBot">+ Hinzufügen</button>
        <button class="btn btn-remove" @click="removeBot">– Entfernen</button>
      </div>
    </header>

    <p v-if="statusMsg" class="status-msg">{{ statusMsg }}</p>

    <section class="chat">
      <TransitionGroup name="fade" tag="div" class="chat-inner">
        <div v-for="msg in messages" :key="msg.id" class="chat-line">
          <span class="username" :style="{ color: msg.color }">{{ msg.user }}</span>
          <span class="colon">: </span>
          <span class="message-body">
            <template v-for="(part, i) in msg.parts" :key="i">
              <img
                v-if="part.type === 'emote'"
                :src="part.url"
                :alt="part.value"
                class="emote"
              />
              <span v-else>{{ part.value }} </span>
            </template>
          </span>
        </div>
      </TransitionGroup>
    </section>
  </div>
</template>

<style>
/* Reset */
*, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

body {
  background: #000;
  color: #fff;
  font-family: 'Courier New', Courier, monospace;
  font-size: 15px;
  min-height: 100vh;
}

.page {
  max-width: 860px;
  margin: 0 auto;
  padding: 2rem 1.5rem;
  display: flex;
  flex-direction: column;
  gap: 1.5rem;
}

header {
  display: flex;
  flex-direction: column;
  gap: 1rem;
}

h1 {
  font-size: 1.6rem;
  font-weight: normal;
  letter-spacing: 0.04em;
}

.buttons {
  display: flex;
  gap: 0.75rem;
  flex-wrap: wrap;
}

.btn {
  font-family: inherit;
  font-size: 0.9rem;
  padding: 0.4rem 1rem;
  border: 1px solid #fff;
  background: transparent;
  color: #fff;
  cursor: pointer;
  letter-spacing: 0.05em;
  transition: background 0.15s, color 0.15s;
}

.btn:hover { background: #fff; color: #000; }
.btn-remove { border-color: #888; color: #888; }
.btn-remove:hover { background: #888; color: #000; }

.status-msg {
  border: 1px solid #555;
  padding: 0.5rem 0.75rem;
  color: #aaffaa;
  font-size: 0.9rem;
}

/* Chat */
.chat {
  width: 100%;
}

.chat-inner {
  display: flex;
  flex-direction: column;
  gap: 0.35rem;
}

.chat-line {
  line-height: 1.5;
  word-break: break-word;
}

.username {
  font-weight: bold;
}

.colon {
  color: #ccc;
}

.message-body {
  color: #eee;
}

.emote {
  display: inline-block;
  vertical-align: middle;
  height: 1.6em;
  margin: 0 1px;
}

/* Fade transition */
.fade-enter-active { transition: opacity 0.3s; }
.fade-leave-active { transition: opacity 0.5s; }
.fade-enter-from, .fade-leave-to { opacity: 0; }
</style>
