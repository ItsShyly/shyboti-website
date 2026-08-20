// >>> shared caret-safe highlighting for plain editors
import { highlightScript } from "./scriptHighlight";

export function getCaretOffset(el: HTMLElement): number {
  const sel = window.getSelection();
  if (!sel?.rangeCount || !el.contains(sel.getRangeAt(0).startContainer)) {
    return (el.innerText || "").replace(/\n$/, "").length;
  }
  const r = sel.getRangeAt(0);
  const pre = r.cloneRange();
  pre.selectNodeContents(el);
  pre.setEnd(r.startContainer, r.startOffset);
  return pre.toString().length;
}

export function setCaretOffset(el: HTMLElement, offset: number) {
  const sel = window.getSelection();
  let remaining = offset;
  let placed = false;
  function walk(node: Node) {
    if (placed) return;
    if (node.nodeType === Node.TEXT_NODE) {
      const len = node.textContent?.length ?? 0;
      if (remaining <= len) {
        const r = document.createRange();
        r.setStart(node, remaining);
        r.collapse(true);
        sel?.removeAllRanges();
        sel?.addRange(r);
        placed = true;
        return;
      }
      remaining -= len;
      return;
    }
    for (const c of Array.from(node.childNodes)) walk(c);
  }
  walk(el);
  if (!placed) {
    const r = document.createRange();
    r.selectNodeContents(el);
    r.collapse(false);
    sel?.removeAllRanges();
    sel?.addRange(r);
  }
}

// >>> re-highlights in place, keeps caret position
export function applyScriptHighlight(el: HTMLElement) {
  const offset = getCaretOffset(el);
  el.innerHTML = highlightScript((el.innerText || "").replace(/\n$/, ""));
  setCaretOffset(el, offset);
}

// >>> chrome steals focus via addRange, use this on panel open
export function setEditorContent(el: HTMLElement, text: string) {
  el.innerHTML = highlightScript(text);
}

// >>> falls back to inserting at the end if unfocused
export function insertTokenAtCursor(el: HTMLElement, token: string): string {
  el.focus();
  const text = (el.innerText || "").replace(/\n$/, "");
  const offset = getCaretOffset(el);
  const newText = text.slice(0, offset) + token + text.slice(offset);
  el.innerText = newText;
  applyScriptHighlight(el);
  setCaretOffset(el, offset + token.length);
  return newText;
}
