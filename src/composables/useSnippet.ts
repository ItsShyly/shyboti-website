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

interface PaintedUserInfo {
  text: string
  /** position relative to the capture region */
  x: number
  y: number
  color: string
  fontSize: number
  fontFamily: string
  fontWeight: string
}

/** Read paint color from a live DOM element (before html2canvas clones it) */
function readPaintColor(el: HTMLElement): string | null {
  const cs = getComputedStyle(el)
  // --snippet-paint-preview holds an opaque paint-derived color
  const preview = cs.getPropertyValue('--snippet-paint-preview').trim()
  if (preview && preview !== 'transparent') return preview
  // data attribute fallback
  const attr = el.getAttribute('data-snippet-paint')
  if (attr && attr !== 'transparent') return attr
  // --snippet-fallback-color holds user's chat color
  const fallback = cs.getPropertyValue('--snippet-fallback-color').trim()
  if (fallback && fallback !== 'transparent') return fallback
  // last resort: computed color (may be 'transparent' for painted users)
  const color = cs.color
  if (color && color !== 'transparent' && color !== 'rgba(0, 0, 0, 0)') return color
  return null
}

/** Is this element using background-clip paint (gradient/image text)? */
function isPaintedUser(el: HTMLElement): boolean {
  const cs = getComputedStyle(el)
  const clip = cs.getPropertyValue('-webkit-background-clip') || cs.getPropertyValue('background-clip')
  return clip === 'text'
}

/** Collect painted username info from live DOM before html2canvas clone */
function collectPaintedUsers(container: HTMLElement, selX: number, selY: number): PaintedUserInfo[] {
  const users = Array.from(container.querySelectorAll('.log-user')) as HTMLElement[]
  const containerRect = container.getBoundingClientRect()
  const result: PaintedUserInfo[] = []

  for (const el of users) {
    if (!isPaintedUser(el)) continue
    const color = readPaintColor(el)
    if (!color) continue

    const rect = el.getBoundingClientRect()
    const cs = getComputedStyle(el)
    const fontSize = parseFloat(cs.fontSize) || 12

    result.push({
      text: el.textContent?.trim() ?? '',
      // Position relative to the capture region origin
      x: rect.left - containerRect.left + container.scrollLeft - selX,
      y: rect.top - containerRect.top + container.scrollTop - selY,
      color,
      fontSize,
      fontFamily: cs.fontFamily || 'sans-serif',
      fontWeight: cs.fontWeight || '600',
    })
  }
  return result.filter(p => p.text)
}

/** Draw painted usernames onto the canvas after html2canvas capture */
function drawPaintedUsers(canvas: HTMLCanvasElement, users: PaintedUserInfo[], scale: number) {
  if (!users.length) return
  const ctx = canvas.getContext('2d')
  if (!ctx) return
  ctx.save()
  ctx.textBaseline = 'top'
  for (const u of users) {
    const sz = Math.round(u.fontSize * scale)
    ctx.font = `${u.fontWeight} ${sz}px ${u.fontFamily}`
    ctx.fillStyle = u.color
    ctx.fillText(u.text, u.x * scale, u.y * scale)
  }
  ctx.restore()
  console.log(`[Snippet] Drew ${users.length} painted usernames onto canvas`)
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

    // Collect painted username positions + colors from the LIVE DOM
    // (before html2canvas clones and loses background-clip: text)
    const paintedUsers = collectPaintedUsers(containerEl, sel.x, sel.y)

    const totalStart = performance.now()
    console.log('[Snippet] Starting screenshot process, painted users:', paintedUsers.length)

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
          onclone: (_doc: Document, clonedEl: HTMLElement) => {
            // Hide painted usernames in the clone so html2canvas
            // doesn't render them as colored rectangles.
            // We'll draw them back onto the canvas afterwards.
            const users = clonedEl.querySelectorAll('.log-user') as NodeListOf<HTMLElement>
            users.forEach((el: HTMLElement) => {
              const clip = el.style.getPropertyValue('-webkit-background-clip') ||
                           el.style.getPropertyValue('background-clip') ||
                           el.style.backgroundClip ||
                           (el.style as any).WebkitBackgroundClip || ''
              if (clip === 'text') {
                // Make this element invisible to html2canvas
                // but keep its space so layout isn't affected
                el.style.setProperty('visibility', 'hidden', 'important')
              }
            })
          },
        }

        cropCanvas = await html2canvas(containerEl, baseOptions)
        if (!cropCanvas.width || !cropCanvas.height) {
          cropCanvas = await html2canvas(containerEl, {
            ...baseOptions,
            foreignObjectRendering: true,
          })
        }
      } finally {
        document.body.classList.remove('snippet-capturing')
      }
      // Draw painted usernames back onto the canvas with their paint colors
      drawPaintedUsers(cropCanvas, paintedUsers, scale)
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
