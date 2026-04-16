import { ref } from 'vue'
import { API } from '../api'
import { useAuth } from '../auth'
import { toCanvas } from 'html-to-image'

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
const SNIPPET_DEBUG = false
const SNIPPET_MAX_RENDER_PIXELS = 2_400_000

async function waitForLogsJobsToSettle(timeoutMs = 5000): Promise<void> {
  const start = Date.now()
  while (document.body.classList.contains('logs-jobs-running') && Date.now() - start < timeoutMs) {
    await new Promise<void>((resolve) => setTimeout(resolve, 60))
  }
}

function computeSnippetPixelRatio(selW: number, selH: number): number {
  const dpr = window.devicePixelRatio || 1
  const area = Math.max(1, selW * selH)
  const cap = Math.sqrt(SNIPPET_MAX_RENDER_PIXELS / area)
  const ratio = Math.max(1, Math.min(dpr, cap))
  return Number(ratio.toFixed(2))
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

    if (SNIPPET_DEBUG) {
      // Debug-only: inspect selected usernames and paint-related style vars.
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
      const scale = computeSnippetPixelRatio(sel.w, sel.h)

      const renderStart = performance.now()
      document.body.classList.add('snippet-capturing')
      await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()))

      let cropCanvas: HTMLCanvasElement
      try {
        // Render ONLY the selected region by cloning the current viewport
        // and clipping via an offscreen wrapper. This avoids expensive
        // full-canvas renders and fixes crop coordinate drift.
        const viewX = sel.x - containerEl.scrollLeft
        const viewY = sel.y - containerEl.scrollTop

        const wrapper = document.createElement('div')
        wrapper.style.position = 'fixed'
        wrapper.style.left = '-100000px'
        wrapper.style.top = '0'
        wrapper.style.width = `${Math.max(1, Math.round(sel.w))}px`
        wrapper.style.height = `${Math.max(1, Math.round(sel.h))}px`
        wrapper.style.overflow = 'hidden'
        wrapper.style.pointerEvents = 'none'
        wrapper.style.background = '#0d0d10'
        wrapper.style.zIndex = '-1'

        const clone = containerEl.cloneNode(true) as HTMLElement
        clone.style.margin = '0'
        clone.style.width = `${containerEl.clientWidth}px`
        clone.style.height = `${containerEl.clientHeight}px`
        clone.style.transform = `translate(${-viewX}px, ${-viewY}px)`
        clone.style.transformOrigin = 'top left'
        clone.style.background = '#0d0d10'
        clone.scrollTop = containerEl.scrollTop
        clone.scrollLeft = containerEl.scrollLeft

        wrapper.appendChild(clone)
        document.body.appendChild(wrapper)
        try {
          cropCanvas = await toCanvas(wrapper, {
            pixelRatio: scale,
            cacheBust: false,
            backgroundColor: '#0d0d10',
            style: {
              background: '#0d0d10',
            },
          })
        } finally {
          wrapper.remove()
        }
      } finally {
        document.body.classList.remove('snippet-capturing')
      }

      const renderDuration = performance.now() - renderStart
      console.log(`[Snippet] html-to-image render: ${renderDuration.toFixed(2)}ms`)
      console.log(`[Snippet] Pixel ratio used: ${scale.toFixed(2)}`)

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
      }, 'image/webp', 1)
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
