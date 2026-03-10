<script setup lang="ts">
import { computed } from 'vue'

interface Props {
  label: string
  kind: 'value' | 'operator' | 'action' | 'param' | 'wrapper'
  rightFlat?: boolean
  leftTab?: boolean
}
const props = defineProps<Props>()

const H  = 32
const R  = 4
const TW = 8
const TH = 8
const TR = 2.5
const PX = 12
const CW = 6.6

const COLORS: Record<string, { fill: string; stroke: string; text: string }> = {
  value:    { fill: '#0d2520', stroke: '#4ec9b0', text: '#4ec9b0' },
  operator: { fill: '#1c0f2e', stroke: '#c792ea', text: '#c792ea' },
  action:   { fill: '#280b0b', stroke: '#f14949', text: '#f14949' },
  param:    { fill: '#201808', stroke: '#e5c07b', text: '#e5c07b' },
  wrapper:  { fill: '#0b1928', stroke: '#569cd6', text: '#569cd6' },
}

const geo = computed(() => {
  const col      = COLORS[props.kind] ?? COLORS['value']!
  const leftTab  = props.leftTab ?? (props.kind !== 'wrapper')
  const rightTab = props.rightFlat ? false : true

  const bodyW = Math.max(52, Math.ceil(props.label.length * CW) + PX * 2)

  // Body always starts at x0=TH so there's room for a left tab whether or not we draw one.
  // viewBox shifts left by TH when there's a left tab, exposing the protrusion.
  const x0 = TH
  const x1 = TH + bodyW
  const y0 = 0
  const y1 = H
  const midY = H / 2

  const svgW    = bodyW + TH   // canvas width (tab area + body)
  const svgH    = H
  const vbX     = leftTab ? -TH : 0   // expose left tab when present
  const vbW     = svgW + (leftTab ? TH : 0)

  // ── path ──────────────────────────────────────────────────────────────────
  const top    = `M${x0+R},${y0} L${x1-R},${y0} Q${x1},${y0} ${x1},${y0+R}`

  const right = rightTab
    ? `L${x1},${midY-TW}` +
      ` L${x1-TH+TR},${midY-TW} Q${x1-TH},${midY-TW} ${x1-TH},${midY-TW+TR}` +
      ` L${x1-TH},${midY+TW-TR} Q${x1-TH},${midY+TW} ${x1-TH+TR},${midY+TW}` +
      ` L${x1},${midY+TW} L${x1},${y1-R} Q${x1},${y1} ${x1-R},${y1}`
    : `L${x1},${y1-R} Q${x1},${y1} ${x1-R},${y1}`

  const bottom = `L${x0+R},${y1} Q${x0},${y1} ${x0},${y1-R}`

  // Left tab protrudes LEFT from x0 — since x0 = TH when leftTab, it goes to x=0 (not negative)
  const left = leftTab
    ? `L${x0},${midY+TW}` +
      ` L${x0-TH+TR},${midY+TW} Q${x0-TH},${midY+TW} ${x0-TH},${midY+TW-TR}` +
      ` L${x0-TH},${midY-TW+TR} Q${x0-TH},${midY-TW} ${x0-TH+TR},${midY-TW}` +
      ` L${x0},${midY-TW} L${x0},${y0+R} Q${x0},${y0} ${x0+R},${y0}`
    : `L${x0},${y0+R} Q${x0},${y0} ${x0+R},${y0}`

  return {
    col,
    path:    `${top} ${right} ${bottom} ${left} Z`,
    svgW:    vbW,
    svgH,
    viewBox: `${vbX} 0 ${vbW} ${svgH}`,
    textX:   x0 + bodyW / 2,
    textY:   midY,
  }
})
</script>

<template>
  <svg
    :width="geo.svgW"
    :height="geo.svgH"
    :viewBox="geo.viewBox"
    class="puzzle-svg"
    xmlns="http://www.w3.org/2000/svg"
    overflow="visible"
  >
    <path
      :d="geo.path"
      :fill="geo.col.fill"
      :stroke="geo.col.stroke"
      stroke-width="1.5"
      stroke-linejoin="round"
      stroke-linecap="round"
    />
    <text
      :x="geo.textX"
      :y="geo.textY"
      text-anchor="middle"
      dominant-baseline="central"
      :fill="geo.col.text"
      font-size="11"
      font-family="'Consolas','Fira Mono',monospace"
      font-weight="600"
      letter-spacing="0.02em"
      pointer-events="none"
      style="user-select: none"
    >{{ label }}</text>
  </svg>
</template>

<style scoped>
.puzzle-svg { display: block; overflow: visible; }
</style>
