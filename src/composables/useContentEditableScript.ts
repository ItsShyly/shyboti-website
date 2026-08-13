// >>> shared caret-preserving highlight + insert logic for the plain contenteditable editors (triggers/timers/countdowns); CommandEditPanel keeps its own richer copy
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

// >>> re-highlights el in place, keeps caret at its current offset
export function applyScriptHighlight(el: HTMLElement) {
  const offset = getCaretOffset(el);
  el.innerHTML = highlightScript((el.innerText || "").replace(/\n$/, ""));
  setCaretOffset(el, offset);
}

// >>> setCaretOffset's addRange() steals focus in Chrome, even on first render - use this instead to populate content on panel open
export function setEditorContent(el: HTMLElement, text: string) {
  el.innerHTML = highlightScript(text);
}

// >>> inserts token at caret (or at end if unfocused), re-highlights, returns new plain text
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
