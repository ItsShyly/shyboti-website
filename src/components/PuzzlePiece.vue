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
 *
 * Example chain:  $if( ←value→ ←operator→ ←param  <do  ←action→ ←param )
 *                 [flat|notch] [tab|notch] [tab|notch] [tab|flat] [tab|notch] [tab|flat]
 */

interface Props {
  label: string
  kind: 'value' | 'operator' | 'action' | 'param' | 'wrapper'
}
const props = defineProps<Props>()

// ── sizing ────────────────────────────────────────────────────────────────────
const H    = 32      // body height
const R    = 4       // corner radius
const TW   = 8       // tab half-width
const TH   = 8       // tab protrusion depth
const TR   = 2.5     // tab corner radius
const PX   = 12      // horizontal text padding
const CW   = 6.6     // approx char width at 11px

const bw = Math.max(52, Math.ceil(props.label.length * CW) + PX * 2)

// Does each side have a tab (out) or notch (in) or flat?
// L = left side, R = right side
const leftTab   = props.kind !== 'wrapper'               // all except wrapper have tab-left
const rightNotch = props.kind !== 'param'                // all except param have notch-right
// (wrapper: flat-L, notch-R)
// (value:   tab-L,  notch-R)
// (operator:tab-L,  notch-R)
// (param:   tab-L,  flat-R)
// (action:  tab-L,  notch-R)

// Canvas size: tab on left means we need TH extra on left side
// notch on right is INWARD so it reduces effective width — but we keep bw as the outer boundary
// We offset body right by TH when there's a left tab, so the tab protrudes left of x=0
const bodyOffX = leftTab ? TH : 0
const svgW = bw + bodyOffX   // total canvas width
const svgH = H

// Body rect in SVG space
const x0 = bodyOffX  // left edge of body
const y0 = 0         // top edge of body
const x1 = x0 + bw  // right edge of body
const y1 = y0 + H   // bottom edge

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

// ── path ──────────────────────────────────────────────────────────────────────
// Trace clockwise: top-left → top-right → bottom-right → bottom-left → close
//
// Helper fragments:
//   tabOut going LEFT  = bump protruding left from the left edge (going up the left side)
//   notchIn on RIGHT   = indent cut into right edge (going down the right side)

function buildPath(): string {
  // TOP edge: left-to-right, straight
  const top = `M${x0 + R},${y0} L${x1 - R},${y0} Q${x1},${y0} ${x1},${y0 + R}`

  // RIGHT edge: top-to-bottom
  // If rightNotch: cut an inward notch at midY
  let right: string
  if (rightNotch) {
    // Go down to notch top, cut inward, continue down
    right = `
      L${x1},${midY - TW}
      L${x1 - TH + TR},${midY - TW} Q${x1 - TH},${midY - TW} ${x1 - TH},${midY - TW + TR}
      L${x1 - TH},${midY + TW - TR} Q${x1 - TH},${midY + TW} ${x1 - TH + TR},${midY + TW}
      L${x1},${midY + TW}
      L${x1},${y1 - R} Q${x1},${y1} ${x1 - R},${y1}
    `
  } else {
    right = `L${x1},${y1 - R} Q${x1},${y1} ${x1 - R},${y1}`
  }

  // BOTTOM edge: right-to-left, straight
  const bottom = `L${x0 + R},${y1} Q${x0},${y1} ${x0},${y1 - R}`

  // LEFT edge: bottom-to-top
  // If leftTab: bump protruding LEFT from x0 at midY (going upward)
  let left: string
  if (leftTab) {
    // Coming up the left side, at midY we protrude outward (leftward = negative x)
    left = `
      L${x0},${midY + TW}
      L${x0 - TH + TR},${midY + TW} Q${x0 - TH},${midY + TW} ${x0 - TH},${midY + TW - TR}
      L${x0 - TH},${midY - TW + TR} Q${x0 - TH},${midY - TW} ${x0 - TH + TR},${midY - TW}
      L${x0},${midY - TW}
      L${x0},${y0 + R} Q${x0},${y0} ${x0 + R},${y0}
    `
  } else {
    left = `L${x0},${y0 + R} Q${x0},${y0} ${x0 + R},${y0}`
  }

  return `${top} ${right} ${bottom} ${left} Z`
}

const path = buildPath()

// Text centered in the body rect
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
.puzzle-svg {
  display: block;
  overflow: visible;
}
</style>
