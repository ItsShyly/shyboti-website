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

    suppressContextMenuUntil = Date.now() + 500

    if (screenshotDismissTimer) clearTimeout(screenshotDismissTimer)
    screenshotToast.value = { state: 'uploading', url: null, imgReady: false }

    try {
      //   1. Find only the rows that intersect the selected viewport rect
      //   2. Clone them into a minimal off-screen div
      //   3. Run html2canvas on that tiny fragment
      // if this works it could save a few seconds

      const panelRect  = containerEl.getBoundingClientRect()
      const scale      = window.devicePixelRatio || 1

      // Convert scroll-relative selection to viewport coords
      const selViewLeft   = panelRect.left + sel.x - containerEl.scrollLeft
      const selViewTop    = panelRect.top  + sel.y - containerEl.scrollTop
      const selViewRight  = selViewLeft + sel.w
      const selViewBottom = selViewTop  + sel.h

      // Build a minimal clone: only rows (and day separators) that intersect the rect
      const clone = document.createElement('div')
      clone.style.cssText = `
        position: fixed; left: -9999px; top: 0;
        width: ${Math.round(sel.w)}px;
        background: #0d0d10;
        font-family: 'JetBrains Mono', monospace;
        font-size: 12px; color: #ccc;
        overflow: hidden; pointer-events: none;
      `

      // Grab every direct child of the scroll container that overlaps
      const tbody = containerEl.querySelector('.logs-tbody') ?? containerEl
      const candidates = tbody.children
      let cloneH = 0
      const clonedNodes: { node: Node; top: number }[] = []

      for (const child of Array.from(candidates)) {
        const cr = child.getBoundingClientRect()
        // Check vertical overlap with selection
        if (cr.bottom < selViewTop - 2 || cr.top > selViewBottom + 2) continue
        const childClone = child.cloneNode(true) as HTMLElement
        // Inline the computed styles we care about so html2canvas doesn't need to re-read
        const cs = window.getComputedStyle(child as HTMLElement)
        childClone.style.cssText = `
          display: ${cs.display};
          padding: ${cs.padding};
          font-size: ${cs.fontSize};
          line-height: ${cs.lineHeight};
          color: ${cs.color};
          background: ${cs.background};
          border-bottom: ${cs.borderBottom};
          width: ${Math.round(sel.w)}px;
          box-sizing: border-box;
          white-space: pre-wrap;
          word-break: break-word;
        `
        clone.appendChild(childClone)
        clonedNodes.push({ node: childClone, top: cr.top })
        cloneH += cr.height
      }

      // If no rows found (e.g. selection is entirely outside the table), fall back
      if (!clone.children.length) {
        // minimal fallback: just use html2canvas on the small region directly
        const html2canvas = (await import('html2canvas')).default
        const fc = await html2canvas(containerEl, {
          x: Math.round(sel.x), y: Math.round(sel.y),
          width: Math.round(sel.w), height: Math.round(sel.h),
          scrollX: 0, scrollY: 0,
          useCORS: true, allowTaint: true, logging: false,
          scale, backgroundColor: '#0d0d10',
        })
        fc.toBlob((blob: Blob | null) => uploadBlob(blob), 'image/webp', 0.88)
        return
      }

      document.body.appendChild(clone)

      // >>> Compute vertical crop within the clone:
      // The first cloned row may start above selViewTop — offset into it
      const cloneRect = clone.getBoundingClientRect()
      const cropY = Math.max(0, selViewTop - cloneRect.top)
      const cropH = Math.min(Math.round(sel.h), cloneRect.height - cropY)

      // >>> Also crop horizontally within the selection
      const cropX = Math.max(0, selViewLeft - cloneRect.left)
      const cropW = Math.min(Math.round(sel.w), cloneRect.width - cropX)

      const html2canvas = (await import('html2canvas')).default
      const rendered = await html2canvas(clone, {
        x:               Math.round(cropX),
        y:               Math.round(cropY),
        width:           Math.max(4, Math.round(cropW)),
        height:          Math.max(4, Math.round(cropH)),
        scrollX:         0, scrollY: 0,
        useCORS:         true,
        allowTaint:      true,
        logging:         false,
        scale,
        backgroundColor: '#0d0d10',
      })

      document.body.removeChild(clone)

      rendered.toBlob((blob: Blob | null) => uploadBlob(blob), 'image/webp', 0.88)  // <<< i think webp is the fastest option here
    } catch (err) {
      console.error('Snippet failed:', err)
      screenshotToast.value = null
    }
  }

  async function uploadBlob(blob: Blob | null) {
    if (!blob) { screenshotToast.value = null; return }
    const fd = new FormData()
    fd.append('file', new File([blob], 'snippet.webp', { type: 'image/webp' }))
    const headers: Record<string, string> = {}
    if (session.value) headers['Authorization'] = `Bearer ${session.value.token}`
    try {
      const res = await fetch(`${API}/images/upload`, { method: 'POST', headers, body: fd })
      if (!res.ok) { screenshotToast.value = null; return }
      const data = await res.json() as { id: string }
      const url = `https://i.shyboti.de/${data.id}`
      await navigator.clipboard.writeText(url).catch(() => {})
      screenshotToast.value = { state: 'copied', url, imgReady: false }
    } catch { screenshotToast.value = null }
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
