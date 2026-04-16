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

async function waitForLogsJobsToSettle(timeoutMs = 5000): Promise<void> {
  const start = Date.now()
  while (document.body.classList.contains('logs-jobs-running') && Date.now() - start < timeoutMs) {
    await new Promise<void>((resolve) => setTimeout(resolve, 60))
  }
}

async function loadToCanvasFn(): Promise<(node: HTMLElement, options?: Record<string, unknown>) => Promise<HTMLCanvasElement>> {
  try {
    // @ts-ignore module may not be installed locally yet
    const local = await import('html-to-image')
    if (typeof local.toCanvas === 'function') return local.toCanvas
  } catch {
    // Fall through to CDN import.
  }
  // @ts-ignore remote module has no local type declarations
  const remote = await import(/* @vite-ignore */ 'https://esm.sh/html-to-image@1.11.13')
  if (typeof remote.toCanvas !== 'function') {
    throw new Error('Failed to load html-to-image toCanvas()')
  }
  return remote.toCanvas
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
      const toCanvas = await loadToCanvasFn()
      const scale = window.devicePixelRatio || 1

      const renderStart = performance.now()
      document.body.classList.add('snippet-capturing')
      await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()))

      let cropCanvas: HTMLCanvasElement
      try {
        const fullCanvas = await toCanvas(containerEl, {
          pixelRatio: scale,
          cacheBust: true,
          backgroundColor: '#0d0d10',
          style: {
            background: '#0d0d10',
          },
        })

        const srcX = Math.max(0, Math.round((sel.x - containerEl.scrollLeft) * scale))
        const srcY = Math.max(0, Math.round((sel.y - containerEl.scrollTop) * scale))
        const reqW = Math.max(1, Math.round(sel.w * scale))
        const reqH = Math.max(1, Math.round(sel.h * scale))
        const srcW = Math.max(1, Math.min(reqW, fullCanvas.width - srcX))
        const srcH = Math.max(1, Math.min(reqH, fullCanvas.height - srcY))

        if (srcX >= fullCanvas.width || srcY >= fullCanvas.height) {
          throw new Error('Selection is outside rendered canvas bounds')
        }

        cropCanvas = document.createElement('canvas')
        cropCanvas.width = srcW
        cropCanvas.height = srcH
        const ctx = cropCanvas.getContext('2d')
        if (!ctx) throw new Error('Could not create canvas context')
        ctx.drawImage(fullCanvas, srcX, srcY, srcW, srcH, 0, 0, srcW, srcH)
      } finally {
        document.body.classList.remove('snippet-capturing')
      }

      const renderDuration = performance.now() - renderStart
      console.log(`[Snippet] html-to-image render: ${renderDuration.toFixed(2)}ms`)

      cropCanvas.toBlob(async (blob: Blob | null) => {
        const blobTime = performance.now()
        if (!blob) { screenshotToast.value = null; return }
        const blobDuration = blobTime - renderStart - renderDuration
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
          console.log(`[Snippet] Total time: ${totalDuration.toFixed(2)}ms (render: ${renderDuration.toFixed(2)}ms, blob: ${blobDuration.toFixed(2)}ms, upload: ${uploadDuration.toFixed(2)}ms)`)
          
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
