import { ref } from "vue";
import { API } from "../api";
import { useAuth } from "../auth";
import { toCanvas } from "html-to-image";

// >>> shared instance across the whole app
const screenshotDrag = ref(false);
const screenshotRect = ref<{
  x: number;
  y: number;
  w: number;
  h: number;
} | null>(null);
const screenshotAnchor = ref<{ x: number; y: number } | null>(null);

export interface SnippetToast {
  state: "uploading" | "copied";
  url: string | null;
  imgReady: boolean;
}
const screenshotToast = ref<SnippetToast | null>(null);
let screenshotDismissTimer: ReturnType<typeof setTimeout> | null = null;
let suppressContextMenuUntil = 0;
let activeUploadController: AbortController | null = null;
let activeSnippetRunId = 0;

// >>> rAF throttle, one pending frame max
let rafPending = false;
const SNIPPET_CAPTURE_DELAY_MS = 0;
const SNIPPET_DEBUG = true;
const SNIPPET_MAX_RENDER_PIXELS = 3_800_000;
const SNIPPET_MIN_PIXEL_RATIO = 0.85;
const SNIPPET_QUALITY_BOOST = 1.15;
const SNIPPET_OUTPUT_QUALITY = 0.96;
const SNIPPET_LOG_VERSION = "snippet-calib-v7";

async function waitForLogsJobsToSettle(timeoutMs = 5000): Promise<void> {
  const start = Date.now();
  while (
    document.body.classList.contains("logs-jobs-running") &&
    Date.now() - start < timeoutMs
  ) {
    await new Promise<void>((resolve) => setTimeout(resolve, 60));
  }
}

function computeSnippetPixelRatio(selW: number, selH: number): number {
  const dpr = window.devicePixelRatio || 1;
  const area = Math.max(1, selW * selH);
  const cap = Math.sqrt(SNIPPET_MAX_RENDER_PIXELS / area);
  const boosted = dpr * SNIPPET_QUALITY_BOOST;
  const ratio = Math.max(SNIPPET_MIN_PIXEL_RATIO, Math.min(boosted, cap));
  return Number(ratio.toFixed(2));
}

function nearestRowAtLocalY(
  containerEl: HTMLElement,
  localY: number,
): { id: string | null; localTop: number } | null {
  const panel = containerEl.getBoundingClientRect();
  const rows = Array.from(
    containerEl.querySelectorAll(".log-row-outer"),
  ) as HTMLElement[];
  if (!rows.length) return null;
  let best: { id: string | null; localTop: number } | null = null;
  let bestDist = Number.POSITIVE_INFINITY;
  for (const row of rows) {
    const r = row.getBoundingClientRect();
    const rowLocalTop = r.top - panel.top + containerEl.scrollTop;
    const d = Math.abs(rowLocalTop - localY);
    if (d < bestDist) {
      bestDist = d;
      best = { id: row.id || null, localTop: Math.round(rowLocalTop) };
    }
  }
  return best;
}

export function useSnippet() {
  const { session } = useAuth();

  // >>> attach to @contextmenu on the host element
  function onSnippetContextMenu(e: MouseEvent) {
    if (screenshotDrag.value || Date.now() < suppressContextMenuUntil) {
      e.preventDefault();
    }
  }

  // >>> attach to @mousedown on the host element
  function onSnippetMouseDown(e: MouseEvent, containerEl: HTMLElement) {
    if (e.button !== 2) return;
    const target = e.target as HTMLElement;
    // >>> don't interfere with interactive elements
    if (target.closest("a, button, input, textarea, select, [data-no-snippet]"))
      return;

    const rect = containerEl.getBoundingClientRect();
    const x = e.clientX - rect.left + containerEl.scrollLeft;
    const y = e.clientY - rect.top + containerEl.scrollTop;
    screenshotAnchor.value = { x, y };
    screenshotRect.value = { x, y, w: 0, h: 0 };
    screenshotDrag.value = true;
    e.preventDefault();
  }

  // >>> attach to window mousemove, rAF throttled so no lag
  function onWindowMouseMove(e: MouseEvent, containerEl: HTMLElement | null) {
    if (!screenshotDrag.value || !screenshotAnchor.value || !containerEl)
      return;
    if (rafPending) return;
    rafPending = true;
    requestAnimationFrame(() => {
      rafPending = false;
      if (!screenshotAnchor.value || !containerEl) return;
      const rect = containerEl.getBoundingClientRect();
      const cx = e.clientX - rect.left + containerEl.scrollLeft;
      const cy = e.clientY - rect.top + containerEl.scrollTop;
      const ax = screenshotAnchor.value.x;
      const ay = screenshotAnchor.value.y;
      screenshotRect.value = {
        x: Math.min(ax, cx),
        y: Math.min(ay, cy),
        w: Math.abs(cx - ax),
        h: Math.abs(cy - ay),
      };
    });
  }

  // >>> attach to window mouseup
  async function onWindowMouseUp(
    e: MouseEvent,
    containerEl: HTMLElement | null,
  ) {
    if (!screenshotDrag.value) return;
    screenshotDrag.value = false;
    const sel = screenshotRect.value;
    screenshotRect.value = null;
    screenshotAnchor.value = null;
    if (!sel || sel.w < 10 || sel.h < 10 || !containerEl) return;

    // >>> suppress the native context menu that fires after a drag
    suppressContextMenuUntil = Date.now() + 500;

    // >>> cancel in-flight upload if a new snippet starts
    activeSnippetRunId += 1;
    const runId = activeSnippetRunId;
    if (activeUploadController) {
      activeUploadController.abort();
      activeUploadController = null;
    }

    // >>> lib resets scroll on clone, render full height instead
    const captureRoot =
      (containerEl.querySelector(".logs-tbody") as HTMLElement | null) ??
      containerEl;
    const hostRect = containerEl.getBoundingClientRect();
    const captureRect = captureRoot.getBoundingClientRect();

    // >>> host-local space -> viewport -> capture-root content space
    const selViewportLeft = hostRect.left + sel.x - containerEl.scrollLeft;
    const selViewportTop = hostRect.top + sel.y - containerEl.scrollTop;
    const selInCapture = {
      x: selViewportLeft - captureRect.left + captureRoot.scrollLeft,
      y: selViewportTop - captureRect.top + captureRoot.scrollTop,
      w: sel.w,
      h: sel.h,
    };

    if (SNIPPET_DEBUG) {
      // >>> debug-only: inspect selected usernames/paint vars
      try {
        const panel = containerEl.getBoundingClientRect();
        const selLeft = panel.left + sel.x - containerEl.scrollLeft;
        const selTop = panel.top + sel.y - containerEl.scrollTop;
        const selRight = selLeft + sel.w;
        const selBottom = selTop + sel.h;
        const users = Array.from(
          containerEl.querySelectorAll(".log-user"),
        ) as HTMLElement[];
        const hits = users.filter((el) => {
          const r = el.getBoundingClientRect();
          return (
            r.right > selLeft &&
            r.left < selRight &&
            r.bottom > selTop &&
            r.top < selBottom
          );
        });
        const sample = hits.slice(0, 5).map((el) => ({
          text: el.textContent?.trim()?.slice(0, 24) ?? "",
          dataPaint: el.getAttribute("data-snippet-paint") ?? "",
          cssPreview: getComputedStyle(el)
            .getPropertyValue("--snippet-paint-preview")
            .trim(),
          cssFallback: getComputedStyle(el)
            .getPropertyValue("--snippet-fallback-color")
            .trim(),
          computedColor: getComputedStyle(el).color,
        }));

        const rowRefs = Array.from(
          containerEl.querySelectorAll(".log-row-outer"),
        )
          .slice(0, 3)
          .map((el) => {
            const row = el as HTMLElement;
            const r = row.getBoundingClientRect();
            return {
              id: row.id || null,
              viewportTop: Math.round(r.top),
              localTop: Math.round(r.top - panel.top + containerEl.scrollTop),
            };
          });

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
            local: {
              x: Math.round(sel.x),
              y: Math.round(sel.y),
              w: Math.round(sel.w),
              h: Math.round(sel.h),
            },
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
        };
        console.log("[Snippet] Selection geometry", selectionGeom);
        console.log(
          "[Snippet] Selection geometry JSON:",
          JSON.stringify(selectionGeom),
        );
      } catch (err) {
        console.warn("[Snippet] Could not inspect selected usernames", err);
      }
    }

    await waitForLogsJobsToSettle();

    if (SNIPPET_CAPTURE_DELAY_MS > 0) {
      console.log(
        `[Snippet] Extra capture delay: ${SNIPPET_CAPTURE_DELAY_MS}ms`,
      );
      await new Promise<void>((resolve) =>
        setTimeout(resolve, SNIPPET_CAPTURE_DELAY_MS),
      );
    }

    if (screenshotDismissTimer) clearTimeout(screenshotDismissTimer);
    screenshotToast.value = { state: "uploading", url: null, imgReady: false };

    const totalStart = performance.now();
    console.log(
      `[Snippet] Starting screenshot process (${SNIPPET_LOG_VERSION})`,
    );

    try {
      const scale = computeSnippetPixelRatio(selInCapture.w, selInCapture.h);

      const renderStart = performance.now();
      document.body.classList.add("snippet-capturing");
      await new Promise<void>((resolve) =>
        requestAnimationFrame(() => resolve()),
      );

      let cropCanvas: HTMLCanvasElement;
      try {
        // >>> force full render so scroll pos doesn't matter
        const contentH = captureRoot.scrollHeight;
        const contentW = captureRoot.scrollWidth;

        const fullCanvas = await toCanvas(captureRoot, {
          pixelRatio: scale,
          cacheBust: false,
          width: contentW,
          height: contentH,
          backgroundColor: "#0d0d10",
          style: {
            overflow: "visible",
            height: `${contentH}px`,
            maxHeight: "none",
            background: "#0d0d10",
          },
        });

        // >>> content-space coords -> scaled canvas pixels
        const srcX = Math.max(0, Math.round(selInCapture.x * scale));
        const srcY = Math.max(0, Math.round(selInCapture.y * scale));
        const reqW = Math.max(1, Math.round(selInCapture.w * scale));
        const reqH = Math.max(1, Math.round(selInCapture.h * scale));
        const srcW = Math.max(1, Math.min(reqW, fullCanvas.width - srcX));
        const srcH = Math.max(1, Math.min(reqH, fullCanvas.height - srcY));

        if (SNIPPET_DEBUG) {
          const selectionTopRow = nearestRowAtLocalY(
            captureRoot,
            selInCapture.y,
          );
          const cropMode = {
            canvas: { w: fullCanvas.width, h: fullCanvas.height },
            contentSize: { w: contentW, h: contentH },
            scrollTop: captureRoot.scrollTop,
            selInCapture: {
              x: Math.round(selInCapture.x),
              y: Math.round(selInCapture.y),
              w: Math.round(selInCapture.w),
              h: Math.round(selInCapture.h),
            },
            src: { x: srcX, y: srcY, w: srcW, h: srcH },
            selectionTopRow,
          };
          console.log("[Snippet] Crop mode", cropMode);
          console.log("[Snippet] Crop mode JSON:", JSON.stringify(cropMode));
        }

        if (srcX >= fullCanvas.width || srcY >= fullCanvas.height) {
          throw new Error("Selection is outside rendered canvas bounds");
        }

        cropCanvas = document.createElement("canvas");
        cropCanvas.width = srcW;
        cropCanvas.height = srcH;
        const ctx = cropCanvas.getContext("2d");
        if (!ctx) throw new Error("Could not create canvas context");
        ctx.drawImage(fullCanvas, srcX, srcY, srcW, srcH, 0, 0, srcW, srcH);
      } finally {
        document.body.classList.remove("snippet-capturing");
      }

      const renderDuration = performance.now() - renderStart;
      console.log(
        `[Snippet] html-to-image render: ${renderDuration.toFixed(2)}ms`,
      );
      console.log(`[Snippet] Pixel ratio used: ${scale.toFixed(2)}`);

      cropCanvas.toBlob(
        async (blob: Blob | null) => {
          const blobTime = performance.now();
          if (!blob) {
            screenshotToast.value = null;
            return;
          }
          if (runId !== activeSnippetRunId) return;
          const blobDuration = blobTime - renderStart - renderDuration;
          console.log(
            `[Snippet] toBlob creation: ${blobDuration.toFixed(2)}ms, size: ${(blob.size / 1024).toFixed(2)}KB`,
          );
          let uploadController: AbortController | null = null;

          try {
            const fd = new FormData();
            fd.append(
              "file",
              new File([blob], "snippet.webp", { type: "image/webp" }),
            );
            fd.append("width", String(cropCanvas.width));
            fd.append("height", String(cropCanvas.height));
            const headers: Record<string, string> = {};
            if (session.value)
              headers["Authorization"] = `Bearer ${session.value.token}`;

            uploadController = new AbortController();
            activeUploadController = uploadController;

            const uploadStart = performance.now();
            const res = await fetch(`${API}/images/upload`, {
              method: "POST",
              headers,
              body: fd,
              signal: uploadController.signal,
            });
            const uploadDuration = performance.now() - uploadStart;

            if (runId !== activeSnippetRunId) return;

            if (!res.ok) {
              screenshotToast.value = null;
              return;
            }
            const data = (await res.json()) as { id: string };
            const url = `https://i.shyboti.de/${data.id}`;
            const totalDuration = performance.now() - totalStart;

            console.log(`[Snippet] Upload: ${uploadDuration.toFixed(2)}ms`);
            console.log(
              `[Snippet] Total time: ${totalDuration.toFixed(2)}ms (render: ${renderDuration.toFixed(2)}ms, blob: ${blobDuration.toFixed(2)}ms, upload: ${uploadDuration.toFixed(2)}ms)`,
            );

            await navigator.clipboard.writeText(url).catch(() => {});
            screenshotToast.value = { state: "copied", url, imgReady: false };
          } catch (err) {
            if (err instanceof DOMException && err.name === "AbortError") {
              console.log("[Snippet] Upload aborted by newer capture");
              return;
            }
            console.error("[Snippet] Upload error:", err);
            screenshotToast.value = null;
          } finally {
            if (
              uploadController &&
              activeUploadController === uploadController
            ) {
              activeUploadController = null;
            }
          }
        },
        "image/webp",
        SNIPPET_OUTPUT_QUALITY,
      );
    } catch (err) {
      console.error("Snippet failed:", err);
      screenshotToast.value = null;
    }
  }

  // >>> call from the toast image's @load event
  function onSnippetImgLoad() {
    if (!screenshotToast.value) return;
    screenshotToast.value = { ...screenshotToast.value, imgReady: true };
    if (screenshotDismissTimer) clearTimeout(screenshotDismissTimer);
    screenshotDismissTimer = setTimeout(() => {
      screenshotToast.value = null;
    }, 3000);
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
  };
}
