// >>> plain @click.self closes on drag-out-of-panel too (some browsers still fire the click), so only close when BOTH mousedown and mouseup land on the backdrop itself
export function useOverlayClose() {
  let mousedownOnSelf = false;

  function handlers(close: () => void) {
    return {
      onMousedown: (e: MouseEvent) => {
        mousedownOnSelf = e.target === e.currentTarget;
      },
      onMouseup: (e: MouseEvent) => {
        if (mousedownOnSelf && e.target === e.currentTarget) close();
        mousedownOnSelf = false;
      },
      onMouseleave: () => {
        mousedownOnSelf = false;
      },
    };
  }

  return { handlers };
}
