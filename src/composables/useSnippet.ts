import { ref } from 'vue'
import { API } from '../api'
import { useAuth } from '../auth'

// Shared reactive state – single instance across the whole app
const screenshotDrag   = ref(false)
const screenshotRect   = ref<{ x: number; y: number; w: number; h: number } | null>(null)
const screenshotAnchor = ref<{ x: number; y: number } | null>(null)

export interface SnippetToast {
  state:    'uploading' | 'copied'
  url:      string | null
  imgReady: boolean
}
const screenshotToast = ref<SnippetToast | null>(null)
let   screenshotDismissTimer: ReturnType<typeof setTimeout> | null = null
let   suppressContextMenuUntil = 0

// rAF throttle flag – one pending frame max
let rafPending = false
const SNIPPET_CAPTURE_DELAY_MS = 0

function toOpaqueOnDark(color: string): string {
  const s = color.trim()
  const m = s.match(/^rgba\(\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*([0-9]*\.?[0-9]+)\s*\)$/i)
  if (!m) return s
  const r = Math.max(0, Math.min(255, Number(m[1])))
  const g = Math.max(0, Math.min(255, Number(m[2])))
  const b = Math.max(0, Math.min(255, Number(m[3])))
  const a = Math.max(0, Math.min(1, Number(m[4])))
  const bgR = 13
  const bgG = 13
  const bgB = 16
  const outR = Math.round(r * a + bgR * (1 - a))
  const outG = Math.round(g * a + bgG * (1 - a))
  const outB = Math.round(b * a + bgB * (1 - a))
  return `rgb(${outR}, ${outG}, ${outB})`
}

function colorScore(color: string): number {
  const s = color.trim()
  const m = s.match(/^rgba?\(\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})(?:\s*,\s*([0-9]*\.?[0-9]+))?\s*\)$/i)
  if (!m) return 0
  const r = Number(m[1])
  const g = Number(m[2])
  const b = Number(m[3])
  const a = m[4] !== undefined ? Number(m[4]) : 1
  if (!Number.isFinite(a) || a <= 0.14) return 0
  const max = Math.max(r, g, b)
  const min = Math.min(r, g, b)
  return (max - min) * a
}

function readColorFromBackgroundImage(el: HTMLElement): string | null {
  const bgImage = getComputedStyle(el).backgroundImage || ''
  if (!bgImage || bgImage === 'none') return null
  const matches = bgImage.match(/rgba?\([^\)]+\)/gi) ?? []
  if (!matches.length) return null
  let best: string | null = null
  let bestScore = 0
  for (const raw of matches) {
    const score = colorScore(raw)
    if (score > bestScore) {
      best = raw
      bestScore = score
    }
  }
  if (!best) return null
  return toOpaqueOnDark(best)
}

/** Read paint color from a live DOM element */
function readPaintColor(el: HTMLElement): string | null {
  const fromBg = readColorFromBackgroundImage(el)
  if (fromBg) return fromBg

  const cs = getComputedStyle(el)
  const preview = cs.getPropertyValue('--snippet-paint-preview').trim()
  if (preview && preview !== 'transparent') return preview
  const attr = el.getAttribute('data-snippet-paint')
  if (attr && attr !== 'transparent') return attr
  const fallback = cs.getPropertyValue('--snippet-fallback-color').trim()
  if (fallback && fallback !== 'transparent') return fallback
  const color = cs.color
  if (color && color !== 'transparent' && color !== 'rgba(0, 0, 0, 0)') return color
  return null
}

/**
 * Temporarily convert painted usernames from gradient-background to flat
 * colored text in the LIVE DOM. Returns a restore function.
 */
function flattenPaintsForCapture(container: HTMLElement): () => void {
  const users = Array.from(container.querySelectorAll('.log-user')) as HTMLElement[]
  const originals: { el: HTMLElement; cssText: string }[] = []

  for (const el of users) {
    const cs = getComputedStyle(el)
    const clip = cs.getPropertyValue('-webkit-background-clip') || cs.getPropertyValue('background-clip')
    if (clip !== 'text') continue

    const color = readPaintColor(el)
    if (!color) continue

    // Save original inline styles for restoration
    originals.push({ el, cssText: el.style.cssText })

    // Replace with flat colored text
    el.style.cssText = `color: ${color} !important; -webkit-text-fill-color: ${color} !important; background-image: none !important; background-clip: border-box !important; -webkit-background-clip: border-box !important; filter: none !important; font-weight: 600 !important; line-height: 1.1rem !important;`
  }

  console.log('[Snippet] Flattened', originals.length, 'painted users in live DOM')

  return () => {
    for (const { el, cssText } of originals) {
      el.style.cssText = cssText
    }
    console.log('[Snippet] Restored', originals.length, 'painted users')
  }
}

async function waitForLogsJobsToSettle(timeoutMs = 5000): Promise<void> {
  const start = Date.now()
  while (document.body.classList.contains('logs-jobs-running') && Date.now() - start < timeoutMs) {
    await new Promise<void>((resolve) => setTimeout(resolve, 60))
  }
}

export function useSnippet() {
  const { session } = useAuth()

  /** Attach to @contextmenu on the host element */
  function onSnippetContextMenu(e: MouseEvent) {
    if (screenshotDrag.value || Date.now() < suppressContextMenuUntil) {
      e.preventDefault()
    }
  }

  /** Attach to @mousedown on the host element */
  function onSnippetMouseDown(e: MouseEvent, containerEl: HTMLElement) {
    if (e.button !== 2) return
    const target = e.target as HTMLElement
    // Don't interfere with interactive elements
    if (target.closest('a, button, input, textarea, select, [data-no-snippet]')) return

    const rect = containerEl.getBoundingClientRect()
    const x = e.clientX - rect.left + containerEl.scrollLeft
    const y = e.clientY - rect.top  + containerEl.scrollTop
    screenshotAnchor.value = { x, y }
    screenshotRect.value   = { x, y, w: 0, h: 0 }
    screenshotDrag.value   = true
    e.preventDefault()
  }

  /** Attach to window mousemove – rAF throttled so no lag */
  function onWindowMouseMove(e: MouseEvent, containerEl: HTMLElement | null) {
    if (!screenshotDrag.value || !screenshotAnchor.value || !containerEl) return
    if (rafPending) return
    rafPending = true
    requestAnimationFrame(() => {
      rafPending = false
      if (!screenshotAnchor.value || !containerEl) return
      const rect = containerEl.getBoundingClientRect()
      const cx = e.clientX - rect.left + containerEl.scrollLeft
      const cy = e.clientY - rect.top  + containerEl.scrollTop
      const ax = screenshotAnchor.value.x
      const ay = screenshotAnchor.value.y
      screenshotRect.value = {
        x: Math.min(ax, cx), y: Math.min(ay, cy),
        w: Math.abs(cx - ax), h: Math.abs(cy - ay),
      }
    })
  }

  /** Attach to window mouseup */
  async function onWindowMouseUp(e: MouseEvent, containerEl: HTMLElement | null) {
    if (!screenshotDrag.value) return
    screenshotDrag.value = false
    const sel = screenshotRect.value
    screenshotRect.value   = null
    screenshotAnchor.value = null
    if (!sel || sel.w < 10 || sel.h < 10 || !containerEl) return

    // Suppress the native context menu that fires on mouseup after a drag
    suppressContextMenuUntil = Date.now() + 500

    // Debug: verify painted usernames that are actually inside the selected region.
    try {
      const panel = containerEl.getBoundingClientRect()
      const selLeft = panel.left + sel.x - containerEl.scrollLeft
      const selTop = panel.top + sel.y - containerEl.scrollTop
      const selRight = selLeft + sel.w
      const selBottom = selTop + sel.h
      const users = Array.from(containerEl.querySelectorAll('.log-user')) as HTMLElement[]
      const hits = users.filter((el) => {
        const r = el.getBoundingClientRect()
        return r.right > selLeft && r.left < selRight && r.bottom > selTop && r.top < selBottom
      })
      const sample = hits.slice(0, 5).map((el) => ({
        text: el.textContent?.trim()?.slice(0, 24) ?? '',
        dataPaint: el.getAttribute('data-snippet-paint') ?? '',
        cssPreview: getComputedStyle(el).getPropertyValue('--snippet-paint-preview').trim(),
        cssFallback: getComputedStyle(el).getPropertyValue('--snippet-fallback-color').trim(),
        computedColor: getComputedStyle(el).color,
      }))
      console.log('[Snippet] Selected .log-user count:', hits.length, sample)
    } catch (err) {
      console.warn('[Snippet] Could not inspect selected usernames', err)
    }

    await waitForLogsJobsToSettle()

    if (SNIPPET_CAPTURE_DELAY_MS > 0) {
      console.log(`[Snippet] Extra capture delay: ${SNIPPET_CAPTURE_DELAY_MS}ms`)
      await new Promise<void>((resolve) => setTimeout(resolve, SNIPPET_CAPTURE_DELAY_MS))
    }

    if (screenshotDismissTimer) clearTimeout(screenshotDismissTimer)
    screenshotToast.value = { state: 'uploading', url: null, imgReady: false }

    const totalStart = performance.now()
    console.log('[Snippet] Starting screenshot process')

    try {
      // @ts-ignore
      const html2canvas = (await import('html2canvas')).default
      const scale = window.devicePixelRatio || 1

      // Only capture the selected region
      const html2Start = performance.now()
      document.body.classList.add('snippet-capturing')
      // Let style changes settle before html2canvas snapshots computed styles.
      await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()))

      // Flatten painted usernames to flat colored text in the LIVE DOM.
      // html2canvas will clone this already-flattened state.
      const restorePaints = flattenPaintsForCapture(containerEl)

      let cropCanvas: HTMLCanvasElement
      try {
        const baseOptions = {
          x:               Math.round(sel.x),
          y:               Math.round(sel.y),
          width:           Math.round(sel.w),
          height:          Math.round(sel.h),
          scrollX:         0,
          scrollY:         0,
          useCORS:         true,
          allowTaint:      true,
          logging:         false,
          scale,
          backgroundColor: '#0d0d10',
        }

        cropCanvas = await html2canvas(containerEl, baseOptions)
        if (!cropCanvas.width || !cropCanvas.height) {
          cropCanvas = await html2canvas(containerEl, {
            ...baseOptions,
            foreignObjectRendering: true,
          })
        }
      } finally {
        restorePaints()
        document.body.classList.remove('snippet-capturing')
      }
      const html2Duration = performance.now() - html2Start
      console.log(`[Snippet] html2canvas render: ${html2Duration.toFixed(2)}ms`)

      cropCanvas.toBlob(async (blob: Blob | null) => {
        const blobTime = performance.now()
        if (!blob) { screenshotToast.value = null; return }
        const blobDuration = blobTime - html2Start - html2Duration
        console.log(`[Snippet] toBlob creation: ${blobDuration.toFixed(2)}ms, size: ${(blob.size / 1024).toFixed(2)}KB`)

        try {
          const fd = new FormData()
          fd.append('file', new File([blob], 'snippet.webp', { type: 'image/webp' }))
          fd.append('width', String(cropCanvas.width))
          fd.append('height', String(cropCanvas.height))
          const headers: Record<string, string> = {}
          if (session.value) headers['Authorization'] = `Bearer ${session.value.token}`
          
          const uploadStart = performance.now()
          const res = await fetch(`${API}/images/upload`, { method: 'POST', headers, body: fd })
          const uploadDuration = performance.now() - uploadStart
          
          if (!res.ok) { screenshotToast.value = null; return }
          const data = await res.json() as { id: string }
          const url = `https://i.shyboti.de/${data.id}`
          const totalDuration = performance.now() - totalStart
          
          console.log(`[Snippet] Upload: ${uploadDuration.toFixed(2)}ms`)
          console.log(`[Snippet] Total time: ${totalDuration.toFixed(2)}ms (render: ${html2Duration.toFixed(2)}ms, blob: ${blobDuration.toFixed(2)}ms, upload: ${uploadDuration.toFixed(2)}ms)`)
          
          await navigator.clipboard.writeText(url).catch(() => {})
          screenshotToast.value = { state: 'copied', url, imgReady: false }
        } catch (err) { 
          console.error('[Snippet] Upload error:', err)
          screenshotToast.value = null 
        }
      }, 'image/webp', 0.92)
    } catch (err) {
      console.error('Snippet failed:', err)
      screenshotToast.value = null
    }
  }

  /** Call from the toast image's @load event */
  function onSnippetImgLoad() {
    if (!screenshotToast.value) return
    screenshotToast.value = { ...screenshotToast.value, imgReady: true }
    if (screenshotDismissTimer) clearTimeout(screenshotDismissTimer)
    screenshotDismissTimer = setTimeout(() => { screenshotToast.value = null }, 3000)
  }

  return {
    screenshotDrag,
    screenshotRect,
    screenshotToast,
    onSnippetContextMenu,
    onSnippetMouseDown,
    onWindowMouseMove,
    onWindowMouseUp,
    onSnippetImgLoad,
  }
}
