<script setup lang="ts">
/**
 * PuzzlePiece — SVG puzzle piece shaped by token role in the rule DSL.
 *
 * Connector grammar (what each side means):
 *
 *   Tab   (bump sticking OUT) = "I connect outward / I plug into something"
 *   Notch (indent cut IN)     = "Something plugs into me here"
 *
 * Shapes per kind:
 *   wrapper   $if(…)     flat-L  | notch-R    → container, things go inside its right
 *   value     {output}   tab-L   | notch-R    → plugs left into wrapper, accepts operator on right
 *   operator  [has]      tab-L   | notch-R    → plugs left into value, accepts param on right
 *   param     {text1}    tab-L   | flat-R     → plugs left into operator/action, terminal
 *   action    [remove]   tab-L   | notch-R    → plugs left into <do>, accepts args on right
 */

interface Props {
  label: string
  kind: 'value' | 'operator' | 'action' | 'param' | 'wrapper'
  // Override right-side shape (used for specific wrapper tokens like <do and >))
  rightFlat?: boolean
}
const props = defineProps<Props>()

// ── sizing ────────────────────────────────────────────────────────────────────
const H    = 32
const R    = 4
const TW   = 8
const TH   = 8
const TR   = 2.5
const PX   = 12
const CW   = 6.6

const bw = Math.max(52, Math.ceil(props.label.length * CW) + PX * 2)

// Original grammar:
const leftTab    = props.kind !== 'wrapper'
const rightNotch = props.rightFlat ? false : (props.kind !== 'param')

const bodyOffX = leftTab ? TH : 0
const svgW = bw + bodyOffX
const svgH = H

const x0 = bodyOffX
const y0 = 0
const x1 = x0 + bw
const y1 = y0 + H
const midY = y0 + H / 2

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
  const top    = `M${x0 + R},${y0} L${x1 - R},${y0} Q${x1},${y0} ${x1},${y0 + R}`
  const right  = rightNotch
    ? `L${x1},${midY - TW} L${x1 - TH + TR},${midY - TW} Q${x1 - TH},${midY - TW} ${x1 - TH},${midY - TW + TR} L${x1 - TH},${midY + TW - TR} Q${x1 - TH},${midY + TW} ${x1 - TH + TR},${midY + TW} L${x1},${midY + TW} L${x1},${y1 - R} Q${x1},${y1} ${x1 - R},${y1}`
    : `L${x1},${y1 - R} Q${x1},${y1} ${x1 - R},${y1}`
  const bottom = `L${x0 + R},${y1} Q${x0},${y1} ${x0},${y1 - R}`
  const left   = leftTab
    ? `L${x0},${midY + TW} L${x0 - TH + TR},${midY + TW} Q${x0 - TH},${midY + TW} ${x0 - TH},${midY + TW - TR} L${x0 - TH},${midY - TW + TR} Q${x0 - TH},${midY - TW} ${x0 - TH + TR},${midY - TW} L${x0},${midY - TW} L${x0},${y0 + R} Q${x0},${y0} ${x0 + R},${y0}`
    : `L${x0},${y0 + R} Q${x0},${y0} ${x0 + R},${y0}`
  return `${top} ${right} ${bottom} ${left} Z`
}

const path = buildPath()
const textX = x0 + bw / 2
const textY = y0 + H / 2
</script>

<template>
  <svg
    :width="svgW"
    :height="svgH"
    :viewBox="`${leftTab ? -TH : 0} 0 ${svgW} ${svgH}`"
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
      :font-size="11"
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
