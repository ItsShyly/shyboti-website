<script setup lang="ts">
/**
 * PuzzlePiece — SVG puzzle piece shaped by token category.
 *
 * Connection grammar (left→right rule flow):
 *   VALUES    flat-L | tab-R       "I produce a value"
 *   OPERATORS notch-L | tab-R      "I consume a value, output a result"
 *   ACTIONS   notch-L | flat-R     "I consume a result, terminal"
 *   PARAMS    tab-T  | flat-B      "I plug upward into an action arg"
 *   WRAPPERS  flat-L | tab-R       "I wrap / enclose"
 */

interface Props {
  label: string
  kind: 'value' | 'operator' | 'action' | 'param' | 'wrapper'
}
const props = defineProps<Props>()

// ── constants ─────────────────────────────────────────────────────────────────
const H     = 34     // body height
const R     = 5      // corner radius
const TW    = 9      // tab half-width (the bump)
const TH    = 9      // tab protrusion depth
const TR    = 3      // tab corner radius
const PX    = 13     // horizontal text padding
const FSIZE = 11     // font size px
const CW    = 6.8    // approx char width

const bw = Math.max(54, Math.ceil(props.label.length * CW) + PX * 2)

// SVG canvas accounts for protruding connectors
const hasLeftNotch  = props.kind === 'operator' || props.kind === 'action'
const hasRightTab   = props.kind === 'value' || props.kind === 'operator' || props.kind === 'wrapper'
const hasTopTab     = props.kind === 'param'

const svgW = bw + (hasRightTab ? TH : 0)
const svgH = H  + (hasTopTab  ? TH : 0)

// Body origin (shifted right when there's a left notch, to leave room for inward cut)
// We draw everything relative to body top-left corner (bx, by)
const bx = 0
const by = hasTopTab ? TH : 0

// ── colour palette ────────────────────────────────────────────────────────────
const COLORS: Record<string, { fill: string; stroke: string; text: string }> = {
  value:    { fill: '#0d2520', stroke: '#4ec9b0', text: '#4ec9b0' },
  operator: { fill: '#1c0f2e', stroke: '#c792ea', text: '#c792ea' },
  action:   { fill: '#280b0b', stroke: '#f14949', text: '#f14949' },
  param:    { fill: '#201808', stroke: '#e5c07b', text: '#e5c07b' },
  wrapper:  { fill: '#0b1928', stroke: '#569cd6', text: '#569cd6' },
}
const col = COLORS[props.kind] ?? COLORS['value']!

// ── path builder ──────────────────────────────────────────────────────────────
// We trace clockwise from top-left of the body rect.
// Vertical midpoint of body for connectors:
const midY = by + H / 2

function buildPath(): string {
  // Right tab protrusion (outward bump on right edge)
  const rightTab = hasRightTab ? `
    L${bx+bw},${midY - TW}
    L${bx+bw+TH-TR},${midY - TW} Q${bx+bw+TH},${midY - TW} ${bx+bw+TH},${midY - TW + TR}
    L${bx+bw+TH},${midY + TW - TR} Q${bx+bw+TH},${midY + TW} ${bx+bw+TH-TR},${midY + TW}
    L${bx+bw},${midY + TW}
  ` : ''

  // Left notch (inward cut on left edge) — only for operator/action
  // The notch is traced on the way back up the left side
  const leftNotchDown = hasLeftNotch ? `
    L${bx},${midY + TW}
    L${bx-TH+TR},${midY + TW} Q${bx-TH},${midY + TW} ${bx-TH},${midY + TW - TR}
    L${bx-TH},${midY - TW + TR} Q${bx-TH},${midY - TW} ${bx-TH+TR},${midY - TW}
    L${bx},${midY - TW}
  ` : ''

  // Top tab (upward bump for params)
  const midX = bx + bw / 2
  const topTab = hasTopTab ? `
    L${midX - TW},${by}
    L${midX - TW},${by - TH + TR} Q${midX - TW},${by - TH} ${midX - TW + TR},${by - TH}
    L${midX + TW - TR},${by - TH} Q${midX + TW},${by - TH} ${midX + TW},${by - TH + TR}
    L${midX + TW},${by}
  ` : ''

  // Top edge: left-to-right
  const topEdge = hasTopTab
    ? `M${bx+R},${by} ${topTab} L${bx+bw-R},${by} Q${bx+bw},${by} ${bx+bw},${by+R}`
    : `M${bx+R},${by} L${bx+bw-R},${by} Q${bx+bw},${by} ${bx+bw},${by+R}`

  // Right edge: top-to-bottom (with optional tab)
  const rightEdge = hasRightTab
    ? `L${bx+bw},${midY - TW} ${rightTab} L${bx+bw},${by+H-R} Q${bx+bw},${by+H} ${bx+bw-R},${by+H}`
    : `L${bx+bw},${by+H-R} Q${bx+bw},${by+H} ${bx+bw-R},${by+H}`

  // Bottom edge: right-to-left
  const bottomEdge = `L${bx+R},${by+H} Q${bx},${by+H} ${bx},${by+H-R}`

  // Left edge: bottom-to-top (with optional notch)
  const leftEdge = hasLeftNotch
    ? `${leftNotchDown} L${bx},${by+R} Q${bx},${by} ${bx+R},${by}`
    : `L${bx},${by+R} Q${bx},${by} ${bx+R},${by}`

  return `${topEdge} ${rightEdge} ${bottomEdge} ${leftEdge} Z`
}

const path = buildPath()

// Text center: horizontal center of body, vertical center of body
const textX = bx + bw / 2
const textY = by + H / 2
</script>

<template>
  <svg
    :width="svgW + (hasLeftNotch ? TH : 0)"
    :height="svgH"
    :viewBox="`${hasLeftNotch ? -TH : 0} 0 ${svgW + (hasLeftNotch ? TH : 0)} ${svgH}`"
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
      :font-size="FSIZE"
      font-family="'Consolas','Fira Mono',monospace"
      font-weight="600"
      letter-spacing="0.03em"
      pointer-events="none"
      style="user-select: none"
    >{{ label }}</text>
  </svg>
</template>

<style scoped>
.puzzle-svg {
  display: block;
  overflow: visible;
}
</style>
