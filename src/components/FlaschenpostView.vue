<template>
    <div class="ocean-container">
        <canvas ref="canvas" id="ocean"></canvas>

        <!-- Flaschenpost -->
        <!-- Flaschenpost -->
        <div v-if="bottleVisible" class="bottle" :class="{ 'bottle-open': showPaper }" @click="showPaper = true"
            title="Flaschenpost öffnen">
            <svg viewBox="0 0 80 160" width="60" height="120">

                <!-- Cork (only visible when bottle is closed) -->
                <rect v-if="!showPaper" x="33" y="5" width="14" height="18" rx="2" fill="#8B5A2B" stroke="#5C3A1E"
                    stroke-width="1.5" />

                <!-- Bottle body (glass) -->
                <path
                    d="M 32,10 L 48,10 L 48,30 Q 60,40 60,55 L 60,150 Q 60,150 20,150 Q 20,150 20,130 L 20,55 Q 20,40 32,30 Z"
                    fill="rgba(180, 220, 240, 0.55)" stroke="rgba(255,255,255,0.9)" stroke-width="2" />
                <!-- Highlight / shine -->
                <path d="M 25,60 Q 30,60 28,140 L 25,140 Z" fill="rgba(255,255,255,0.3)" />

                <!-- Rolled paper inside (only visible when bottle is closed) -->
                <rect v-if="!showPaper" x="31" y="45" width="18" height="100" rx="2" fill="#F5E6C8" stroke="#D4B896"
                    stroke-width="1" transform="rotate(11, 35, 95)" />
            </svg>
        </div>

        <!-- Papier / Brief -->
        <transition name="paper">
            <div v-if="showPaper" class="paper-overlay" @click.self="showPaper = false">
                <div class="paper">
                    <button class="paper-close" @click="showPaper = false">✕</button>
                    <div class="paper-content">
                        <p v-if="fpStatus === 'waiting'" class="paper-waiting">
                            Diese Flaschenpost wartet noch auf eine Nachricht...
                        </p>
                        <template v-else>
                            <p class="paper-message" v-html="fpMessageHtml"></p>
                            <p class="paper-meta">— {{ fpSenderName }}, {{ formatTimestamp(fpSentAt) }}</p>
                        </template>
                    </div>
                </div>
            </div>
        </transition>
    </div>
</template>

<script setup lang="ts">
// @ts-nocheck -- ocean canvas below is loosely-typed by design, keep it untyped
import { ref, computed, onMounted, onBeforeUnmount } from 'vue';
import { useRoute } from 'vue-router';
import { API } from '../api';

const canvas = ref(null);
let ctx;
let W, H, DPR, horizonY, oceanH;
let animationId;
let timeOfDay = 0; // 0..1, 0 = midnight, 0.5 = noon, 1 = midnight

// vvv flaschenpost data vvv
const route = useRoute();
const channel = computed(() => String(route.params.channel || '').toLowerCase());

const fpExists = ref(false);
const fpStatus = ref('');
const fpMessageHtml = ref('');
const fpSenderName = ref('');
const fpSentAt = ref(null);

const bottleVisible = computed(() => fpExists.value);
const showPaper = ref(false);

const emoteMap = ref({});

function esc(s) {
    return String(s)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

// >>> same word-token emote swap as the dashboard's chat log
function renderMsgWithMap(text, em) {
    if (!Object.keys(em).length) return esc(text);
    const tokens = text.split(/( +)/);
    let out = '';
    for (const tok of tokens) {
        if (!tok) continue;
        if (/^ +$/.test(tok)) {
            out += tok;
            continue;
        }
        const entry = em[tok];
        if (!entry) {
            out += esc(tok);
            continue;
        }
        out += `<img class="paper-emote" src="${esc(entry.url)}" alt="${esc(tok)}" title="${esc(tok)}">`;
    }
    return out;
}

async function fetchEmotes(ch) {
    const next = {};
    for (const path of [`/emotes/${ch}`, `/emotes/twitch/${ch}`]) {
        try {
            const r = await fetch(`${API}${path}`);
            if (r.ok) {
                const d = await r.json();
                for (const e of d.emotes ?? []) next[e.name] = { url: e.url };
            }
        } catch { }
    }
    emoteMap.value = next;
}

async function fetchFlaschenpost() {
    const ch = channel.value;
    if (!ch) return;
    try {
        const r = await fetch(`${API}/flaschenpost/${ch}`);
        if (!r.ok) return;
        const d = await r.json();
        fpExists.value = !!d.exists;
        if (d.exists) {
            fpStatus.value = d.status;
            fpSenderName.value = d.senderName || '';
            fpSentAt.value = d.sentAt || null;
            fpMessageHtml.value = d.message ? renderMsgWithMap(d.message, emoteMap.value) : '';
        } else {
            showPaper.value = false;
        }
    } catch { }
}

function formatTimestamp(ms) {
    if (!ms) return '';
    return new Date(ms).toLocaleString();
}

let pollTimer = null;
// ^^^ flaschenpost data ^^^

/* ── PALETTE KEYFRAMES (full 24h cycle) ── */
const KEYS = [
    {
        t: 0.0,
        skyTop: [8, 12, 30],
        skyHor: [34, 44, 82],
        sun: [255, 206, 148],
        glow: [255, 92, 58],
        wFar: [28, 42, 76],
        wNear: [6, 16, 32],
        foam: [196, 208, 234],
        star: 1,
        moonDisc: [228, 234, 255],
        moonGlow: [140, 164, 216]
    },
    {
        t: 0.25,
        skyTop: [38, 44, 86],
        skyHor: [247, 176, 128],
        sun: [255, 238, 206],
        glow: [255, 178, 120],
        wFar: [176, 150, 150],
        wNear: [34, 62, 84],
        foam: [255, 244, 234],
        star: 0,
        moonDisc: [228, 234, 255],
        moonGlow: [140, 164, 216]
    },
    {
        t: 0.375,
        skyTop: [64, 134, 206],
        skyHor: [188, 222, 236],
        sun: [255, 255, 246],
        glow: [255, 250, 224],
        wFar: [120, 186, 196],
        wNear: [20, 92, 114],
        foam: [255, 255, 255],
        star: 0,
        moonDisc: [228, 234, 255],
        moonGlow: [140, 164, 216]
    },
    {
        t: 0.5,
        skyTop: [58, 142, 214],
        skyHor: [176, 216, 230],
        sun: [255, 255, 248],
        glow: [255, 252, 232],
        wFar: [96, 178, 188],
        wNear: [16, 96, 120],
        foam: [255, 255, 255],
        star: 0,
        moonDisc: [228, 234, 255],
        moonGlow: [140, 164, 216]
    },
    {
        t: 0.625,
        skyTop: [74, 92, 156],
        skyHor: [255, 202, 120],
        sun: [255, 236, 194],
        glow: [255, 168, 92],
        wFar: [206, 164, 118],
        wNear: [34, 78, 98],
        foam: [255, 244, 228],
        star: 0,
        moonDisc: [228, 234, 255],
        moonGlow: [140, 164, 216]
    },
    {
        t: 0.75,
        skyTop: [48, 38, 86],
        skyHor: [255, 108, 68],
        sun: [255, 206, 148],
        glow: [255, 92, 58],
        wFar: [188, 98, 84],
        wNear: [30, 42, 72],
        foam: [255, 222, 200],
        star: 0.15,
        moonDisc: [228, 234, 255],
        moonGlow: [140, 164, 216]
    },
    {
        t: 0.875,
        skyTop: [8, 12, 30],
        skyHor: [34, 44, 82],
        sun: [255, 206, 148],
        glow: [255, 92, 58],
        wFar: [28, 42, 76],
        wNear: [6, 16, 32],
        foam: [196, 208, 234],
        star: 0.8,
        moonDisc: [228, 234, 255],
        moonGlow: [140, 164, 216]
    },
    {
        t: 1.0,
        skyTop: [8, 12, 30],
        skyHor: [34, 44, 82],
        sun: [255, 206, 148],
        glow: [255, 92, 58],
        wFar: [28, 42, 76],
        wNear: [6, 16, 32],
        foam: [196, 208, 234],
        star: 1,
        moonDisc: [228, 234, 255],
        moonGlow: [140, 164, 216]
    }
];

function lerp(a, b, t) {
    return a + (b - a) * t;
}

function lerpRGB(a, b, t) {
    return [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)];
}

function rgb(c, a = 1) {
    return `rgba(${c[0] | 0},${c[1] | 0},${c[2] | 0},${a})`;
}

function getPalette(t) {
    let i = 0;
    while (i < KEYS.length - 1 && t > KEYS[i + 1].t) i++;
    const a = KEYS[i];
    const b = KEYS[Math.min(i + 1, KEYS.length - 1)];
    const span = b.t - a.t || 1;
    const k = Math.max(0, Math.min(1, (t - a.t) / span));
    return {
        skyTop: lerpRGB(a.skyTop, b.skyTop, k),
        skyHor: lerpRGB(a.skyHor, b.skyHor, k),
        sun: lerpRGB(a.sun, b.sun, k),
        glow: lerpRGB(a.glow, b.glow, k),
        wFar: lerpRGB(a.wFar, b.wFar, k),
        wNear: lerpRGB(a.wNear, b.wNear, k),
        foam: lerpRGB(a.foam, b.foam, k),
        star: lerp(a.star, b.star, k),
        moonDisc: lerpRGB(a.moonDisc, b.moonDisc, k),
        moonGlow: lerpRGB(a.moonGlow, b.moonGlow, k)
    };
}

/* ── SUN / MOON ELEVATION ── */
function getSunElevation(t) {
    if (t >= 0.25 && t <= 0.75) {
        return Math.sin(Math.PI * (t - 0.25) / 0.5);
    }
    return 0;
}

function getMoonElevation(t) {
    if (t <= 0.25) {
        return Math.cos(Math.PI * t / 0.5);
    } else if (t >= 0.75) {
        return Math.sin(Math.PI * (t - 0.75) / 0.5);
    }
    return 0;
}

/* ── STATIC ELEMENTS ── */
const stars = Array.from({ length: 140 }, () => ({
    x: Math.random(),
    y: Math.random() * 0.4,
    r: Math.random() * 1.2 + 0.3,
    tw: Math.random() * Math.PI * 2
}));

const clouds = Array.from({ length: 5 }, (_, i) => ({
    x: Math.random(),
    y: 0.08 + Math.random() * 0.18,
    w: 0.18 + Math.random() * 0.22,
    speed: 0.000015 + Math.random() * 0.00002
}));

const birds = Array.from({ length: 4 }, () => ({
    x: Math.random(),
    y: 0.15 + Math.random() * 0.18,
    speed: 0.00004 + Math.random() * 0.00004,
    size: 8 + Math.random() * 6,
    flap: Math.random() * Math.PI * 2
}));

/* ── CANVAS SETUP ── */
function resize() {
    const canvasEl = canvas.value;
    if (!canvasEl) return;
    DPR = Math.min(window.devicePixelRatio || 1, 2);
    W = window.innerWidth;
    H = window.innerHeight;
    canvasEl.width = W * DPR;
    canvasEl.height = H * DPR;
    canvasEl.style.width = W + 'px';
    canvasEl.style.height = H + 'px';
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
    horizonY = H * 0.42;
    oceanH = H - horizonY;
}

/* ── RENDER LOOP ── */
let T = 0;

function draw() {
    const canvasEl = canvas.value;
    if (!canvasEl || !ctx) return;

    // real time (full 24h)
    const now = new Date();
    const hours = now.getHours() + now.getMinutes() / 60 + now.getSeconds() / 3600;
    timeOfDay = hours / 24;

    const P = getPalette(timeOfDay);
    const sunH = getSunElevation(timeOfDay);
    const moonH = getMoonElevation(timeOfDay);

    const sunX = W * 0.5;
    const moonX = W * 0.5;
    const sunY = horizonY - sunH * horizonY * 0.82;
    const moonY = horizonY - moonH * horizonY * 0.82;

    /* ── SKY ── */
    const sky = ctx.createLinearGradient(0, 0, 0, horizonY + oceanH * 0.1);
    sky.addColorStop(0, rgb(P.skyTop));
    sky.addColorStop(0.7, rgb(lerpRGB(P.skyTop, P.skyHor, 0.55)));
    sky.addColorStop(1, rgb(P.skyHor));
    ctx.fillStyle = sky;
    ctx.fillRect(0, 0, W, horizonY + 2);

    /* ── STARS ── */
    if (P.star > 0.01) {
        stars.forEach((s) => {
            const tw = 0.5 + 0.5 * Math.sin(T * 2 + s.tw);
            ctx.fillStyle = rgb([255, 255, 255], P.star * tw * 0.9);
            ctx.beginPath();
            ctx.arc(s.x * W, s.y * horizonY, s.r, 0, Math.PI * 2);
            ctx.fill();
        });
    }

    /* ── SUN GLOW & DISC (only when sun is up) ── */
    if (sunH > 0.01) {
        const glowR = Math.min(W, H) * 0.5;
        const g = ctx.createRadialGradient(sunX, sunY, 0, sunX, sunY, glowR);
        g.addColorStop(0, rgb(P.glow, 0.55));
        g.addColorStop(0.25, rgb(P.glow, 0.22));
        g.addColorStop(1, rgb(P.glow, 0));
        ctx.fillStyle = g;
        ctx.fillRect(0, 0, W, horizonY + oceanH * 0.4);

        const sunR = Math.min(W, H) * 0.045;
        const sd = ctx.createRadialGradient(sunX, sunY, 0, sunX, sunY, sunR);
        sd.addColorStop(0, rgb(P.sun, 1));
        sd.addColorStop(0.7, rgb(P.sun, 0.95));
        sd.addColorStop(1, rgb(P.sun, 0.2));
        ctx.fillStyle = sd;
        ctx.beginPath();
        ctx.arc(sunX, sunY, sunR, 0, Math.PI * 2);
        ctx.fill();
    }

    /* ── MOON GLOW & DISC (only when moon is up) ── */
    if (moonH > 0.01) {
        const glowR = Math.min(W, H) * 0.5;
        const g = ctx.createRadialGradient(moonX, moonY, 0, moonX, moonY, glowR);
        g.addColorStop(0, rgb(P.moonGlow, 0.45));
        g.addColorStop(0.25, rgb(P.moonGlow, 0.18));
        g.addColorStop(1, rgb(P.moonGlow, 0));
        ctx.fillStyle = g;
        ctx.fillRect(0, 0, W, horizonY + oceanH * 0.4);

        const moonR = Math.min(W, H) * 0.04;
        const md = ctx.createRadialGradient(moonX, moonY, 0, moonX, moonY, moonR);
        md.addColorStop(0, rgb(P.moonDisc, 1));
        md.addColorStop(0.7, rgb(P.moonDisc, 0.95));
        md.addColorStop(1, rgb(P.moonDisc, 0.2));
        ctx.fillStyle = md;
        ctx.beginPath();
        ctx.arc(moonX, moonY, moonR, 0, Math.PI * 2);
        ctx.fill();
    }

    /* ── CLOUDS ── */
    clouds.forEach((c) => {
        c.x += c.speed;
        if (c.x > 1.3) c.x = -0.3;
        const cx = c.x * W;
        const cy = c.y * horizonY;
        const cw = c.w * W;
        ctx.fillStyle = rgb(lerpRGB(P.skyHor, [255, 255, 255], 0.25), 0.16);
        for (let j = 0; j < 4; j++) {
            ctx.beginPath();
            ctx.ellipse(
                cx + j * cw * 0.22,
                cy + Math.sin(j) * 6,
                cw * (0.3 - j * 0.04),
                cw * 0.06,
                0,
                0,
                Math.PI * 2
            );
            ctx.fill();
        }
    });

    /* ── BIRDS ── */
    birds.forEach((b) => {
        b.x += b.speed;
        b.flap += 0.15;
        if (b.x > 1.2) {
            b.x = -0.2;
            b.y = 0.15 + Math.random() * 0.18;
        }
        const bx = b.x * W;
        const by = b.y * horizonY;
        const wing = Math.sin(b.flap) * b.size * 0.5;
        ctx.strokeStyle = rgb(lerpRGB(P.skyTop, [0, 0, 0], 0.3), 0.5);
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.moveTo(bx - b.size, by + wing);
        ctx.quadraticCurveTo(bx, by - b.size * 0.3, bx, by);
        ctx.quadraticCurveTo(bx, by - b.size * 0.3, bx + b.size, by + wing);
        ctx.stroke();
    });

    /* ── ATMOSPHERIC HAZE AT HORIZON ── */
    const haze = ctx.createLinearGradient(0, horizonY - 40, 0, horizonY + 40);
    haze.addColorStop(0, rgb(P.skyHor, 0));
    haze.addColorStop(0.5, rgb(P.skyHor, 0.45));
    haze.addColorStop(1, rgb(P.wFar, 0));
    ctx.fillStyle = haze;
    ctx.fillRect(0, horizonY - 40, W, 80);

    /* ── OCEAN SWELLS (slower water) ── */
    const NUM = 26;
    for (let i = 0; i < NUM; i++) {
        const depth = i / (NUM - 1);
        const yTop = horizonY + Math.pow(depth, 1.9) * oceanH;
        const amp = lerp(0.6, 30, depth);
        const wlen = lerp(46, 340, depth);
        const speed = lerp(0.05, 0.2, depth); // much slower than original
        const phase = T * speed + i * 0.9;
        const col = lerpRGB(P.wFar, P.wNear, depth);

        ctx.beginPath();
        ctx.moveTo(0, H);
        ctx.lineTo(0, yTop + Math.sin(phase) * amp);
        for (let x = 0; x <= W; x += 6) {
            const y =
                yTop +
                Math.sin(x / wlen + phase) * amp +
                Math.sin(x / (wlen * 0.4) + phase * 1.6) * amp * 0.3;
            ctx.lineTo(x, y);
        }
        ctx.lineTo(W, H);
        ctx.closePath();
        ctx.fillStyle = rgb(col);
        ctx.fill();

        ctx.lineWidth = lerp(0.6, 2.2, depth);
        ctx.beginPath();
        let started = false;
        for (let x = 0; x <= W; x += 6) {
            const y =
                yTop +
                Math.sin(x / wlen + phase) * amp +
                Math.sin(x / (wlen * 0.4) + phase * 1.6) * amp * 0.3;
            started ? ctx.lineTo(x, y) : (ctx.moveTo(x, y), (started = true));
        }
        ctx.strokeStyle = rgb(lerpRGB(col, P.sun, 0.55), lerp(0.05, 0.3, depth));
        ctx.stroke();

        if (depth > 0.62) {
            const foamA = (depth - 0.62) / 0.38;
            for (let x = 0; x <= W; x += 9) {
                const y =
                    yTop +
                    Math.sin(x / wlen + phase) * amp +
                    Math.sin(x / (wlen * 0.4) + phase * 1.6) * amp * 0.3;
                const crest = Math.sin(x / wlen + phase);
                if (crest > 0.55 && Math.random() > 0.45) {
                    ctx.fillStyle = rgb(P.foam, foamA * (0.18 + Math.random() * 0.35));
                    ctx.fillRect(
                        x + (Math.random() - 0.5) * 6,
                        y - Math.random() * 3,
                        1.5 + Math.random() * 3,
                        1.5 + Math.random() * 2
                    );
                }
            }
        }
    }

    /* ── SUN GLITTER PATH ── */
    if (sunH > 0.01) {
        const glitterCount = 220;
        for (let i = 0; i < glitterCount; i++) {
            const dy = Math.random();
            const y = horizonY + Math.pow(dy, 1.5) * oceanH;
            const spread = lerp(6, W * 0.3, dy);
            const x = sunX + (Math.random() - 0.5) * 2 * spread;
            const distFade = 1 - Math.min(1, Math.abs(x - sunX) / (spread + 1));
            const flick = 0.25 + Math.random() * 0.75;
            const a = distFade * distFade * flick * 0.7 * (1 - dy * 0.25);
            if (a < 0.02) continue;
            ctx.fillStyle = rgb(P.sun, a * 0.85);
            const len = 1 + Math.random() * (2 + dy * 4);
            ctx.fillRect(x, y, len, 1 + dy);
        }
    }

    /* ── MOON GLITTER PATH ── */
    if (moonH > 0.01) {
        const glitterCount = 180;
        for (let i = 0; i < glitterCount; i++) {
            const dy = Math.random();
            const y = horizonY + Math.pow(dy, 1.5) * oceanH;
            const spread = lerp(6, W * 0.3, dy);
            const x = moonX + (Math.random() - 0.5) * 2 * spread;
            const distFade = 1 - Math.min(1, Math.abs(x - moonX) / (spread + 1));
            const flick = 0.25 + Math.random() * 0.75;
            const a = distFade * distFade * flick * 0.5 * (1 - dy * 0.25);
            if (a < 0.02) continue;
            ctx.fillStyle = rgb(P.moonDisc, a * 0.85);
            const len = 1 + Math.random() * (2 + dy * 4);
            ctx.fillRect(x, y, len, 1 + dy);
        }
    }

    /* ── VIGNETTE ── */
    const vig = ctx.createRadialGradient(
        W / 2,
        H * 0.55,
        H * 0.25,
        W / 2,
        H * 0.55,
        H * 0.9
    );
    vig.addColorStop(0, 'rgba(0,0,0,0)');
    vig.addColorStop(1, 'rgba(0,0,8,0.34)');
    ctx.fillStyle = vig;
    ctx.fillRect(0, 0, W, H);

    T += 0.016;
    animationId = requestAnimationFrame(draw);
}

/* ── LIFECYCLE ── */
onMounted(() => {
    const canvasEl = canvas.value;
    if (canvasEl) {
        ctx = canvasEl.getContext('2d');
        resize();
        window.addEventListener('resize', resize);
        draw();
    }

    fetchEmotes(channel.value).then(fetchFlaschenpost);
    pollTimer = setInterval(fetchFlaschenpost, 5000);
});

onBeforeUnmount(() => {
    cancelAnimationFrame(animationId);
    window.removeEventListener('resize', resize);
    if (pollTimer) clearInterval(pollTimer);
});
</script>

<style>
@import url('https://fonts.googleapis.com/css2?family=Dancing+Script:wght@400..700&display=swap');

* {
    margin: 0;
    padding: 0;
    box-sizing: border-box;
}

html,
body {
    width: 100%;
    height: 100%;
    overflow: hidden;
}

body {
    background: #06080f;
    font-family: "DM Mono", monospace;
    cursor: default;
}

#ocean {
    position: fixed;
    inset: 0;
    display: block;
}

/* ── Flaschenpost ── */
.bottle {
    position: fixed;
    left: 50%;
    top: 70%;
    transform: translateX(-50%);
    cursor: pointer;
    z-index: 20;
    pointer-events: auto;
    animation: bob 3s ease-in-out infinite;
    transition: transform 0.2s ease;
}

.bottle:hover {
    transform: translateX(-50%) scale(1.05);
}

.bottle-open {
    opacity: 0.3;
    pointer-events: none;
}

@keyframes bob {

    0%,
    100% {
        margin-top: 0;
    }

    50% {
        margin-top: -15px;
    }
}

/* ── Papier (Brief) ── */
.paper-overlay {
    position: fixed;
    inset: 0;
    background: rgba(0, 0, 0, 0.5);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 30;
    backdrop-filter: blur(4px);
}

.paper {
    position: relative;
    width: min(400px, 80vw);
    background: #f5e6c8;
    padding: 40px 30px;
    border-radius: 4px;
    box-shadow: 0 20px 60px rgba(0, 0, 0, 0.5), 0 0 0 1px rgba(255, 255, 255, 0.2);
    transform: rotate(-1deg);
    animation: unfold 0.3s ease-out;
}

.paper::before {
    content: '';
    position: absolute;
    top: 0;
    left: 0;
    right: 0;
    bottom: 0;
    background: url("data:image/svg+xml,%3Csvg width='100' height='100' viewBox='0 0 100 100' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.8' numOctaves='4' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100' height='100' filter='url(%23n)' opacity='0.05'/%3E%3C/svg%3E");
    pointer-events: none;
}

.paper-close {
    position: absolute;
    top: 10px;
    right: 15px;
    background: none;
    border: none;
    font-size: 24px;
    cursor: pointer;
    color: #5c3a1e;
    line-height: 1;
}

.paper-close:hover {
    color: #8b5a2b;
}

.paper-content {
    font-family: "Dancing Script", cursive;
    font-size: 1.5rem;
    color: #3a2a1a;
    text-align: center;
    line-height: 1.6;
    max-height: 50vh;
    overflow-y: auto;
    padding-right: 4px;
}

.paper-waiting {
    opacity: 0.6;
    font-style: italic;
}

.paper-message {
    white-space: pre-wrap;
    word-break: break-word;
}

.paper-meta {
    margin-top: 14px;
    font-size: 1.1rem;
    opacity: 0.65;
}

.paper-emote {
    height: 1.4em;
    width: auto;
    vertical-align: middle;
    display: inline-block;
}

/* Transitionen */
.paper-enter-active,
.paper-leave-active {
    transition: opacity 0.3s ease;
}

.paper-enter-from,
.paper-leave-to {
    opacity: 0;
}

.paper-enter-active .paper {
    animation: unfold 0.3s ease-out;
}

@keyframes unfold {
    from {
        transform: rotate(-1deg) scale(0.8);
        opacity: 0;
    }

    to {
        transform: rotate(-1deg) scale(1);
        opacity: 1;
    }
}

/* Responsive Anpassungen */
@media (max-width: 600px) {
    .bottle svg {
        width: 45px;
        height: 90px;
    }

    .paper {
        padding: 30px 20px;
    }

    .paper-content {
        font-size: 1.2rem;
    }
}
</style>