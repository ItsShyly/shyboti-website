<script setup lang="ts">
import { computed } from 'vue'

/**
 * PuzzlePiece — SVG puzzle piece shaped by token role in the rule DSL.
 *
 * Connector grammar:
 *   Tab   (bump sticking OUT left)  = "I plug leftward into something"
 *   Notch (indent cut IN on right)  = "Something plugs into me from the right"
 *
 * Shapes per kind:
 *   wrapper   flat-L  | notch-R    ($if, $else — container openers)
 *   value     tab-L   | notch-R
 *   operator  tab-L   | notch-R
 *   param     tab-L   | notch-R
 *   action    tab-L   | notch-R
 */

interface Props {
  label: string
  kind: 'value' | 'operator' | 'action' | 'param' | 'wrapper'
  rightFlat?: boolean   // force flat right side (for closing bracket pieces like >))
  leftTab?: boolean     // override left side (for structural wrapper pieces like <do)
}
const props = defineProps<Props>()

// ── constants ─────────────────────────────────────────────────────────────────
const H  = 32   // piece height
const R  = 4    // corner radius
const TW = 8    // tab/notch half-width (vertical extent from midY)
const TH = 8    // tab/notch depth (horizontal extent)
const TR = 2.5  // tab/notch corner radius
const PX = 12   // horizontal text padding
const CW = 6.6  // approx char width for label sizing

// v2 — force rebuild
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
  const rightTab = props.rightFlat ? false : true   // notch on right = accepts plug-in

  // Body rectangle: always starts at x=0, width = bw
  // If leftTab, the tab protrudes LEFT into negative x territory (-TH to 0)
  const bw   = Math.max(52, Math.ceil(props.label.length * CW) + PX * 2)
  const x0   = 0
  const x1   = bw
  const y0   = 0
  const y1   = H
  const midY = H / 2

  // SVG viewport: needs to show from -TH (tab left edge) to x1 (body right edge)
  // viewBox: "vbX 0 vbW H"
  const vbX = leftTab ? -TH : 0
  const vbW = leftTab ? bw + TH : bw   // total width visible
  // rendered svg element width = same as vbW (1:1 pixel mapping)

  // ── path ──────────────────────────────────────────────────────────────────
  const top    = `M${x0+R},${y0} L${x1-R},${y0} Q${x1},${y0} ${x1},${y0+R}`

  // Right side: notch (cut inward — something plugs in) or flat
  const right = rightTab
    ? `L${x1},${midY-TW}` +
      ` L${x1-TH+TR},${midY-TW} Q${x1-TH},${midY-TW} ${x1-TH},${midY-TW+TR}` +
      ` L${x1-TH},${midY+TW-TR} Q${x1-TH},${midY+TW} ${x1-TH+TR},${midY+TW}` +
      ` L${x1},${midY+TW} L${x1},${y1-R} Q${x1},${y1} ${x1-R},${y1}`
    : `L${x1},${y1-R} Q${x1},${y1} ${x1-R},${y1}`

  const bottom = `L${x0+R},${y1} Q${x0},${y1} ${x0},${y1-R}`

  // Left side: tab (protrudes left into negative x) or flat
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
    svgH:    H,
    viewBox: `${vbX} 0 ${vbW} ${H}`,
    textX:   x0 + bw / 2,
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
