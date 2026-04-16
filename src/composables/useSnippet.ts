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

type SnippetUserOverlay = {
  text: string
  x: number
  y: number
  color: string
  fontSizePx: number
  fontFamily: string
  fontWeight: string
}

function snippetUsableColor(v: string | null | undefined): string {
  const s = String(v ?? '').trim()
  if (!s) return ''
  const low = s.toLowerCase()
  if (low === 'transparent' || low === 'rgba(0, 0, 0, 0)' || low === 'rgba(0,0,0,0)') return ''
  if (low.includes('var(') || low.includes('gradient(')) return ''
  const m = low.match(/rgba\(\s*\d+\s*,\s*\d+\s*,\s*\d+\s*,\s*([0-9]*\.?[0-9]+)\s*\)/)
  if (m && Number(m[1]) <= 0.14) return ''
  return s
}

function snippetToOpaque(v: string): string {
  const s = v.trim()
  const rgba = s.match(/^rgba\(\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*([0-9]*\.?[0-9]+)\s*\)$/i)
  if (rgba) return `rgb(${rgba[1]}, ${rgba[2]}, ${rgba[3]})`
  return s
}

function buildSnippetUserOverlays(users: HTMLElement[], selLeft: number, selTop: number): SnippetUserOverlay[] {
  return users.map((el) => {
    const rect = el.getBoundingClientRect()
    const cs = getComputedStyle(el)
    const rawColor =
      cs.getPropertyValue('--snippet-paint-preview').trim() ||
      cs.getPropertyValue('--snippet-fallback-color').trim() ||
      el.getAttribute('data-snippet-paint') ||
      cs.color ||
      '#cccccc'
    const usable = snippetUsableColor(rawColor)
    const color = usable ? snippetToOpaque(usable) : '#cccccc'
    const fontSizePx = Math.max(10, Number.parseFloat(cs.fontSize || '14') || 14)

    return {
      text: el.textContent?.trim() ?? '',
      x: rect.left - selLeft,
      // Baseline correction keeps canvas text vertically aligned with DOM text.
      y: rect.top - selTop + fontSizePx * 0.82,
      color,
      fontSizePx,
      fontFamily: cs.fontFamily || 'sans-serif',
      fontWeight: cs.fontWeight || '700',
    }
  }).filter(o => !!o.text)
}

function paintSnippetUserOverlays(canvas: HTMLCanvasElement, overlays: SnippetUserOverlay[], scale: number) {
  if (!overlays.length) return
  const ctx = canvas.getContext('2d')
  if (!ctx) return
  ctx.save()
  ctx.textAlign = 'left'
  ctx.textBaseline = 'alphabetic'
  for (const o of overlays) {
    ctx.font = `${o.fontWeight} ${Math.round(o.fontSizePx * scale)}px ${o.fontFamily}`
    ctx.fillStyle = o.color
    ctx.fillText(o.text, o.x * scale, o.y * scale)
  }
  ctx.restore()
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

    const panel = containerEl.getBoundingClientRect()
    const selLeft = panel.left + sel.x - containerEl.scrollLeft
    const selTop = panel.top + sel.y - containerEl.scrollTop
    const selRight = selLeft + sel.w
    const selBottom = selTop + sel.h
    const usersForOverlay = Array.from(containerEl.querySelectorAll('.log-user')) as HTMLElement[]
    const overlayUsers = usersForOverlay.filter((el) => {
      const r = el.getBoundingClientRect()
      return r.right > selLeft && r.left < selRight && r.bottom > selTop && r.top < selBottom
    })
    const overlays = buildSnippetUserOverlays(overlayUsers, selLeft, selTop)

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
      let cropCanvas: HTMLCanvasElement
      try {
        cropCanvas = await html2canvas(containerEl, {
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
          onclone: (doc: Document) => {
            const users = doc.querySelectorAll('.log-user') as NodeListOf<HTMLElement>
            let colorUsed = 0
            let hardFallbackUsed = 0

            users.forEach((el: HTMLElement) => {
              const cs = getComputedStyle(el)
              const raw =
                cs.getPropertyValue('--snippet-paint-preview').trim() ||
                cs.getPropertyValue('--snippet-fallback-color').trim() ||
                el.getAttribute('data-snippet-paint') ||
                cs.color ||
                ''
              const validated = snippetUsableColor(raw)
              let textColor: string
              if (validated) {
                textColor = snippetToOpaque(validated)
                colorUsed += 1
              } else {
                textColor = '#cccccc'
                hardFallbackUsed += 1
              }

              // Completely replace inline styles to eliminate Vue-bound
              // paint properties (background-image, color:transparent, etc.)
              el.style.cssText = [
                `color: ${textColor}`,
                `-webkit-text-fill-color: ${textColor}`,
                `background: none`,
                `-webkit-background-clip: border-box`,
                `background-clip: border-box`,
                `filter: none`,
                `font-weight: 700`,
              ].join(' !important; ') + ' !important;'
            })
            console.log('[Snippet] Clone paint mapping', {
              total: users.length,
              colorUsed,
              hardFallbackUsed,
              sampleColors: Array.from(users).slice(0, 3).map(el => ({
                text: el.textContent?.trim()?.slice(0, 20),
                attr: el.getAttribute('data-snippet-paint'),
                final: el.style.color,
              })),
            })
          },
        })
      } finally {
        document.body.classList.remove('snippet-capturing')
      }
      paintSnippetUserOverlays(cropCanvas, overlays, scale)
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
