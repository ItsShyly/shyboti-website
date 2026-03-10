<script setup lang="ts">
/**
 * PuzzlePiece — SVG puzzle piece shaped by token role in the rule DSL.
 *
 * Connector grammar:
 *   Tab   (bump OUT) = "I plug into something / I connect outward"
 *   Notch (cut IN)   = "Something plugs into me here"
 *   Flat             = "Terminal / no connection"
 *
 * Corrected shapes:
 *   wrapper-open  $if(      tab-L  | flat-R   → plugs left into nothing, opening bracket
 *   wrapper-close >)        tab-L  | flat-R   → closing bracket pair
 *   wrapper-do    <do       tab-L  | flat-R   → do keyword
 *   value         {output}  tab-L  | notch-R  → plugs left, accepts operator on right
 *   operator      [has]     tab-L  | notch-R  → plugs left into value, accepts param on right
 *   param         {text1}   tab-L  | notch-R  → plugs left, can accept args on right
 *   action        [remove]  tab-L  | notch-R  → plugs left into <do>, accepts args on right
 */

interface Props {
  label: string
  kind: 'value' | 'operator' | 'action' | 'param' | 'wrapper'
}
const props = defineProps<Props>()

// ── sizing ────────────────────────────────────────────────────────────────────
const H  = 30
const R  = 4
const TW = 8    // tab half-width
const TH = 8    // tab protrusion
const TR = 2.5  // tab corner radius
const PX = 11
const CW = 6.4

const bw = Math.max(46, Math.ceil(props.label.length * CW) + PX * 2)

// All pieces: tab-left (protrudes OUT left)
const leftTab = true

// Right side: notch (IN) for value, operator, action, param — flat for wrapper
const rightNotch = props.kind !== 'wrapper'

const bodyOffX = TH       // always shift body right to make room for left tab
const svgW     = bw + bodyOffX
const svgH     = H

const x0 = bodyOffX
const y0 = 0
const x1 = x0 + bw
const y1 = H
const midY = H / 2

// ── colours ───────────────────────────────────────────────────────────────────
const COLORS: Record<string, { fill: string; stroke: string; text: string }> = {
  value:    { fill: '#0d2520', stroke: '#4ec9b0', text: '#4ec9b0' },
  operator: { fill: '#1c0f2e', stroke: '#c792ea', text: '#c792ea' },
  action:   { fill: '#280b0b', stroke: '#f14949', text: '#f14949' },
  param:    { fill: '#201808', stroke: '#e5c07b', text: '#e5c07b' },
  wrapper:  { fill: '#0b1928', stroke: '#569cd6', text: '#569cd6' },
}
const col = COLORS[props.kind] ?? COLORS['value']!

function buildPath(): string {
  const top    = `M${x0+R},${y0} L${x1-R},${y0} Q${x1},${y0} ${x1},${y0+R}`
  const right  = rightNotch
    ? `L${x1},${midY-TW} L${x1-TH+TR},${midY-TW} Q${x1-TH},${midY-TW} ${x1-TH},${midY-TW+TR} L${x1-TH},${midY+TW-TR} Q${x1-TH},${midY+TW} ${x1-TH+TR},${midY+TW} L${x1},${midY+TW} L${x1},${y1-R} Q${x1},${y1} ${x1-R},${y1}`
    : `L${x1},${y1-R} Q${x1},${y1} ${x1-R},${y1}`
  const bottom = `L${x0+R},${y1} Q${x0},${y1} ${x0},${y1-R}`
  // Left tab always protrudes outward (leftward)
  const left   = `L${x0},${midY+TW} L${x0-TH+TR},${midY+TW} Q${x0-TH},${midY+TW} ${x0-TH},${midY+TW-TR} L${x0-TH},${midY-TW+TR} Q${x0-TH},${midY-TW} ${x0-TH+TR},${midY-TW} L${x0},${midY-TW} L${x0},${y0+R} Q${x0},${y0} ${x0+R},${y0}`
  return `${top} ${right} ${bottom} ${left} Z`
}

const path = buildPath()
const textX = x0 + bw / 2
const textY = H / 2
// viewBox exposes the left-tab area (negative x)
const vbX = -TH
const vbW = svgW + TH
</script>

<template>
  <svg
    :width="vbW"
    :height="svgH"
    :viewBox="`${vbX} 0 ${vbW} ${svgH}`"
    class="puzzle-svg"
    xmlns="http://www.w3.org/2000/svg"
    overflow="visible"
  >
    <path
      :d="path"
      :fill="col.fill"
      :stroke="col.stroke"
      stroke-width="1.5"
      stroke-linejoin="round"
      stroke-linecap="round"
    />
    <text
      :x="textX"
      :y="textY"
      text-anchor="middle"
      dominant-baseline="central"
      :fill="col.text"
      :font-size="10"
      font-family="'Consolas','Fira Mono',monospace"
      font-weight="600"
      letter-spacing="0.02em"
      pointer-events="none"
      style="user-select:none"
    >{{ label }}</text>
  </svg>
</template>

<style scoped>
.puzzle-svg { display: block; overflow: visible; }
</style>
