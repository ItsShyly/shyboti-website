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
const SNIPPET_DEBUG = true
const SNIPPET_MAX_RENDER_PIXELS = 2_400_000
const SNIPPET_MIN_PIXEL_RATIO = 0.65
const SNIPPET_LOG_VERSION = 'snippet-calib-v3'

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
  const ratio = Math.max(SNIPPET_MIN_PIXEL_RATIO, Math.min(dpr, cap))
  return Number(ratio.toFixed(2))
}

function addSnippetCalibrationMarker(containerEl: HTMLElement, markerY: number): () => void {
  const marker = document.createElement('div')
  marker.setAttribute('data-snippet-calibration', '1')
  marker.style.position = 'absolute'
  marker.style.left = '2px'
  marker.style.top = `${Math.max(0, Math.round(markerY))}px`
  marker.style.width = '5px'
  marker.style.height = '5px'
  marker.style.background = 'rgb(255, 0, 255)'
  marker.style.pointerEvents = 'none'
  marker.style.zIndex = '2147483647'

  const originalPosition = containerEl.style.position
  const computedPos = getComputedStyle(containerEl).position
  if (computedPos === 'static') {
    containerEl.style.position = 'relative'
  }

  containerEl.appendChild(marker)

  return () => {
    marker.remove()
    if (computedPos === 'static') {
      containerEl.style.position = originalPosition
    }
  }
}

function detectSnippetCalibrationMarkerY(canvas: HTMLCanvasElement): number | null {
  const ctx = canvas.getContext('2d')
  if (!ctx) return null
  const { width, height } = canvas
  const data = ctx.getImageData(0, 0, width, height).data

  let bestY = -1
  let bestHits = 0
  for (let y = 0; y < height; y++) {
    let hits = 0
    for (let x = 0; x < Math.min(width, 32); x++) {
      const i = (y * width + x) * 4
      const r = data[i] ?? 0
      const g = data[i + 1] ?? 0
      const b = data[i + 2] ?? 0
      if (r > 240 && g < 30 && b > 240) hits++
    }
    if (hits > bestHits) {
      bestHits = hits
      bestY = y
    }
  }

  if (bestHits < 2 || bestY < 0) return null
  return bestY
}

function nearestRowAtLocalY(containerEl: HTMLElement, localY: number): { id: string | null; localTop: number } | null {
  const panel = containerEl.getBoundingClientRect()
  const rows = Array.from(containerEl.querySelectorAll('.log-row-outer')) as HTMLElement[]
  if (!rows.length) return null
  let best: { id: string | null; localTop: number } | null = null
  let bestDist = Number.POSITIVE_INFINITY
  for (const row of rows) {
    const r = row.getBoundingClientRect()
    const rowLocalTop = r.top - panel.top + containerEl.scrollTop
    const d = Math.abs(rowLocalTop - localY)
    if (d < bestDist) {
      bestDist = d
      best = { id: row.id || null, localTop: Math.round(rowLocalTop) }
    }
  }
  return best
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

    const captureRoot = (containerEl.querySelector('.logs-tbody') as HTMLElement | null) ?? containerEl
    const hostRect = containerEl.getBoundingClientRect()
    const captureRect = captureRoot.getBoundingClientRect()

    // Convert selection from host-local space to viewport space, then into capture-root local space.
    const selViewportLeft = hostRect.left + sel.x - containerEl.scrollLeft
    const selViewportTop = hostRect.top + sel.y - containerEl.scrollTop
    const selInCapture = {
      x: selViewportLeft - captureRect.left + captureRoot.scrollLeft,
      y: selViewportTop - captureRect.top + captureRoot.scrollTop,
      w: sel.w,
      h: sel.h,
    }

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

        const rowRefs = Array.from(containerEl.querySelectorAll('.log-row-outer'))
          .slice(0, 3)
          .map((el) => {
            const row = el as HTMLElement
            const r = row.getBoundingClientRect()
            return {
              id: row.id || null,
              viewportTop: Math.round(r.top),
              localTop: Math.round(r.top - panel.top + containerEl.scrollTop),
            }
          })

        const selectionGeom = {
          panel: {
            left: Math.round(panel.left),
            top: Math.round(panel.top),
            width: Math.round(panel.width),
            height: Math.round(panel.height),
          },
          captureRoot: {
            className: captureRoot.className,
            left: Math.round(captureRect.left),
            top: Math.round(captureRect.top),
            width: Math.round(captureRect.width),
            height: Math.round(captureRect.height),
            scrollLeft: Math.round(captureRoot.scrollLeft),
            scrollTop: Math.round(captureRoot.scrollTop),
            scrollWidth: Math.round(captureRoot.scrollWidth),
            scrollHeight: Math.round(captureRoot.scrollHeight),
          },
          scroll: {
            left: Math.round(containerEl.scrollLeft),
            top: Math.round(containerEl.scrollTop),
            width: Math.round(containerEl.scrollWidth),
            height: Math.round(containerEl.scrollHeight),
          },
          selection: {
            local: { x: Math.round(sel.x), y: Math.round(sel.y), w: Math.round(sel.w), h: Math.round(sel.h) },
            captureLocal: {
              x: Math.round(selInCapture.x),
              y: Math.round(selInCapture.y),
              w: Math.round(selInCapture.w),
              h: Math.round(selInCapture.h),
            },
            viewport: {
              left: Math.round(selLeft),
              top: Math.round(selTop),
              right: Math.round(selRight),
              bottom: Math.round(selBottom),
            },
          },
          selectedUsersCount: hits.length,
          selectedUsersSample: sample,
          rowRefs,
        }
        console.log('[Snippet] Selection geometry', selectionGeom)
        console.log('[Snippet] Selection geometry JSON:', JSON.stringify(selectionGeom))
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
    console.log(`[Snippet] Starting screenshot process (${SNIPPET_LOG_VERSION})`)

    try {
      const scale = computeSnippetPixelRatio(selInCapture.w, selInCapture.h)

      const renderStart = performance.now()
      document.body.classList.add('snippet-capturing')
      await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()))

      let cropCanvas: HTMLCanvasElement
      const calibrationMarkerLocalY = Math.max(0, selInCapture.y - 8)
      const removeCalibrationMarker = addSnippetCalibrationMarker(captureRoot, calibrationMarkerLocalY)
      try {
        const fullCanvas = await toCanvas(captureRoot, {
          pixelRatio: scale,
          cacheBust: false,
          backgroundColor: '#0d0d10',
          style: {
            background: '#0d0d10',
          },
        })

        const clientWScaled = Math.max(1, Math.round(captureRoot.clientWidth * scale))
        const clientHScaled = Math.max(1, Math.round(captureRoot.clientHeight * scale))
        const scrollWScaled = Math.max(1, Math.round(captureRoot.scrollWidth * scale))
        const scrollHScaled = Math.max(1, Math.round(captureRoot.scrollHeight * scale))

        const widthViewportDelta = Math.abs(fullCanvas.width - clientWScaled)
        const widthContentDelta = Math.abs(fullCanvas.width - scrollWScaled)
        const heightViewportDelta = Math.abs(fullCanvas.height - clientHScaled)
        const heightContentDelta = Math.abs(fullCanvas.height - scrollHScaled)

        const widthLooksLikeViewport = widthViewportDelta <= widthContentDelta
        const heightLooksLikeViewport = heightViewportDelta <= heightContentDelta

        // Base mapping from container space. Nested scroll compensation proved
        // to overcorrect (jumping far out of bounds), so we keep source Y in
        // the same local coordinate space as selection.
        const sourceX = widthLooksLikeViewport ? (selInCapture.x - captureRoot.scrollLeft) : selInCapture.x
        let sourceY = selInCapture.y

        // Safety: if Y is outside the rendered viewport bounds, reset to local selection Y.
        if (sourceY < 0 || sourceY > captureRoot.clientHeight) {
          sourceY = selInCapture.y
        }

        const markerYRendered = detectSnippetCalibrationMarkerY(fullCanvas)
        if (markerYRendered !== null) {
          const markerYExpected = Math.round(calibrationMarkerLocalY * scale)
          const markerDeltaScaled = markerYRendered - markerYExpected
          sourceY += markerDeltaScaled / Math.max(0.01, scale)
          if (SNIPPET_DEBUG) {
            console.log('[Snippet] Marker calibration', {
              markerYRendered,
              markerYExpected,
              markerDeltaScaled,
              markerDeltaUnscaled: markerDeltaScaled / Math.max(0.01, scale),
            })
          }
        } else if (SNIPPET_DEBUG) {
          console.log('[Snippet] Marker calibration', { markerYRendered: null })
        }

        const srcX = Math.max(0, Math.round(sourceX * scale))
        const srcY = Math.max(0, Math.round(sourceY * scale))
        const reqW = Math.max(1, Math.round(selInCapture.w * scale))
        const reqH = Math.max(1, Math.round(selInCapture.h * scale))
        const srcW = Math.max(1, Math.min(reqW, fullCanvas.width - srcX))
        const srcH = Math.max(1, Math.min(reqH, fullCanvas.height - srcY))

        if (SNIPPET_DEBUG) {
          const selectionTopRow = nearestRowAtLocalY(captureRoot, selInCapture.y)
          const cropTopRow = nearestRowAtLocalY(captureRoot, sourceY)
          const cropMode = {
            widthLooksLikeViewport,
            heightLooksLikeViewport,
            canvas: { w: fullCanvas.width, h: fullCanvas.height },
            client: { w: clientWScaled, h: clientHScaled },
            scroll: { w: scrollWScaled, h: scrollHScaled },
            source: { x: sourceX, y: sourceY },
            scrollOffsetsApplied: {
              x: widthLooksLikeViewport,
              y: heightLooksLikeViewport,
            },
            src: { x: srcX, y: srcY, w: srcW, h: srcH },
            localMapping: {
              selectionTopY: Math.round(sel.y),
              selectionTopYCapture: Math.round(selInCapture.y),
              cropTopY: Math.round(sourceY),
              deltaY: Math.round(sourceY - selInCapture.y),
            },
            nearestRows: {
              selectionTopRow,
              cropTopRow,
            },
          }
          console.log('[Snippet] Crop mode', cropMode)
          console.log('[Snippet] Crop mode JSON:', JSON.stringify(cropMode))
          console.log(
            `[Snippet] Crop numbers selY=${Math.round(sel.y)} sourceY=${Math.round(sourceY)} scrollTop=${Math.round(containerEl.scrollTop)} srcY=${srcY} reqH=${reqH} srcH=${srcH} scale=${scale.toFixed(2)}`
          )
        }

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
        removeCalibrationMarker()
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
      }, 'image/webp', 0.9)
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
