// >>> needs both mousedown+mouseup on backdrop, click.self alone leaks
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
