// composables/useOverlayClose.ts
//
// Shared "click backdrop to close" behaviour for slide-in edit panels.
//
// Closing on a plain @click.self is what OBS widgets used to do, and it has a
// bug: if you mousedown inside the panel (e.g. to select text) and drag the
// pointer out over the backdrop before releasing, some browsers still fire a
// click on the backdrop and the panel slams shut mid-selection. Custom
// commands / triggers / timers / countdowns avoided this by only closing when
// BOTH the mousedown and the mouseup happened on the backdrop itself. This
// composable is that same guarded behaviour, shared so every panel gets it
// (including OBS widgets, which previously didn't).
//
// Usage in a template:
//   <div class="panel-overlay" v-bind="overlay.handlers(() => editOpen = false)">
export function useOverlayClose() {
  let mousedownOnSelf = false

  function handlers(close: () => void) {
    return {
      onMousedown: (e: MouseEvent) => { mousedownOnSelf = e.target === e.currentTarget },
      onMouseup: (e: MouseEvent) => {
        if (mousedownOnSelf && e.target === e.currentTarget) close()
        mousedownOnSelf = false
      },
      onMouseleave: () => { mousedownOnSelf = false },
    }
  }

  return { handlers }
}
