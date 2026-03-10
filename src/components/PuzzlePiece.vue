<script setup lang="ts">
import { computed } from 'vue'

/**
 * PuzzlePiece — SVG puzzle piece shaped by token role in the rule DSL.
 *
 * Connector grammar:
 *   Tab   (bump sticking OUT left) = "I plug into something on my left"
 *   Notch (indent cut IN right)    = "Something plugs into me from my right"
 *
 * Shapes per kind:
 *   wrapper   $if(…)     flat-L  | notch-R
 *   value     {output}   tab-L   | notch-R
 *   operator  [has]      tab-L   | notch-R
 *   param     {text1}    tab-L   | notch-R
 *   action    [remove]   tab-L   | notch-R
 */

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

const geo = computed(() => {
  const bw = Math.max(52, Math.ceil(props.label.length * CW) + PX * 2)

  const leftTab    = props.leftTab  ?? (props.kind !== 'wrapper')
  const rightNotch = props.rightFlat ? false : true

  const bodyOffX = leftTab ? TH : 0
  const svgW = bw + bodyOffX
  const x0 = bodyOffX, y0 = 0, x1 = x0 + bw, y1 = H
  const midY = H / 2

  const top    = `M${x0+R},${y0} L${x1-R},${y0} Q${x1},${y0} ${x1},${y0+R}`
  const right  = rightNotch
    ? `L${x1},${midY-TW} L${x1-TH+TR},${midY-TW} Q${x1-TH},${midY-TW} ${x1-TH},${midY-TW+TR} L${x1-TH},${midY+TW-TR} Q${x1-TH},${midY+TW} ${x1-TH+TR},${midY+TW} L${x1},${midY+TW} L${x1},${y1-R} Q${x1},${y1} ${x1-R},${y1}`
    : `L${x1},${y1-R} Q${x1},${y1} ${x1-R},${y1}`
  const bottom = `L${x0+R},${y1} Q${x0},${y1} ${x0},${y1-R}`
  const left   = leftTab
    ? `L${x0},${midY+TW} L${x0-TH+TR},${midY+TW} Q${x0-TH},${midY+TW} ${x0-TH},${midY+TW-TR} L${x0-TH},${midY-TW+TR} Q${x0-TH},${midY-TW} ${x0-TH+TR},${midY-TW} L${x0},${midY-TW} L${x0},${y0+R} Q${x0},${y0} ${x0+R},${y0}`
    : `L${x0},${y0+R} Q${x0},${y0} ${x0+R},${y0}`

  return {
    bw,
    leftTab,
    svgW,
    path: `${top} ${right} ${bottom} ${left} Z`,
    textX: x0 + bw / 2,
    textY: H / 2,
    viewBox: `${leftTab ? -TH : 0} 0 ${svgW} ${H}`,
  }
})

const COLORS: Record<string, { fill: string; stroke: string; text: string }> = {
  value:    { fill: '#0d2520', stroke: '#4ec9b0', text: '#4ec9b0' },
  operator: { fill: '#1c0f2e', stroke: '#c792ea', text: '#c792ea' },
  action:   { fill: '#280b0b', stroke: '#f14949', text: '#f14949' },
  param:    { fill: '#201808', stroke: '#e5c07b', text: '#e5c07b' },
  wrapper:  { fill: '#0b1928', stroke: '#569cd6', text: '#569cd6' },
}
const col = computed(() => COLORS[props.kind] ?? COLORS['value']!)
</script>

<template>
  <svg
    :width="geo.svgW"
    :height="H"
    :viewBox="geo.viewBox"
    class="puzzle-svg"
    xmlns="http://www.w3.org/2000/svg"
    overflow="visible"
  >
    <path
      :d="geo.path"
      :fill="col.fill"
      :stroke="col.stroke"
      stroke-width="1.5"
      stroke-linejoin="round"
      stroke-linecap="round"
    />
    <text
      :x="geo.textX"
      :y="geo.textY"
      text-anchor="middle"
      dominant-baseline="central"
      :fill="col.text"
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
