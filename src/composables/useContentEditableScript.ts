// composables/useContentEditableScript.ts
//
// Shared caret-preserving highlight + insert-at-cursor logic for the plain
// contenteditable script editors (triggers, timers, countdowns). Custom
// commands has its own richer version of this (ghost autocomplete, line
// numbers) and keeps its own copy, but these three views had byte-for-byte
// identical copies of applyHL/onEditorInput - centralised here instead.
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

// Re-highlights `el` in place, keeping the caret at its current character offset.
export function applyScriptHighlight(el: HTMLElement) {
  const offset = getCaretOffset(el);
  el.innerHTML = highlightScript((el.innerText || "").replace(/\n$/, ""));
  setCaretOffset(el, offset);
}

// >>> Sets an editor's content on initial panel open, without touching Selection/Range.
export function setEditorContent(el: HTMLElement, text: string) {
  el.innerHTML = highlightScript(text);
}

// Inserts `token` at the current caret position (or at the end if the editor
// isn't focused), re-highlights, and leaves the caret right after it.
// Returns the new plain-text content so the caller can sync it into state.
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
