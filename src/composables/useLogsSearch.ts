import { ref } from "vue";

// Shared reactive state - single instance across the whole app.
//
// Lets the global nav search bar (App.vue) act, while on the Logs page, as an
// in-page "find in loaded messages" tool - Discord-style: a removable scope
// chip appears in the search box, typing shows a dropdown of matching
// messages already loaded in LogsView (no new network request), and the view
// only actually scrolls/jumps when the person presses Enter or clicks one of
// the results - never automatically while typing.
//
// LogsView owns the actual matching + scrolling logic (it has the loaded
// messages); this composable is just the shared channel between it and the
// nav bar: the query flows in, the result list + active (keyboard-highlighted)
// index flow back out, and jump requests (id of the message to scroll to) flow in.

export interface LogSearchResult {
  id: string; // message id, used to scroll/highlight
  label: string; // username / display name
  sub: string; // message snippet around the match
}

const query = ref(""); // current search text while scoped to logs
const results = ref<LogSearchResult[]>([]); // written by LogsView, best match first
const activeIndex = ref(0); // keyboard-highlighted row within `results`
const matchCount = ref(0); // number of matching messages currently available
const matchIndex = ref(0); // currently active match number (1-based) for the UI

const jumpToken = ref(0); // bumped whenever a jump should actually happen
const jumpId = ref<string | null>(null); // id of the message to jump to
const jumpDirection = ref(1); // direction for next/previous navigation

// Called on Enter (jump to the currently highlighted result) or when a
// result is clicked directly (jump to that specific id).
function requestJump(target: number | string) {
  if (typeof target === "number") {
    jumpDirection.value = target;
    jumpId.value = null;
  } else {
    jumpId.value = target;
    jumpDirection.value = 1;
  }
  jumpToken.value++;
}

function reset() {
  query.value = "";
  results.value = [];
  activeIndex.value = 0;
  matchCount.value = 0;
  matchIndex.value = 0;
  jumpDirection.value = 1;
  jumpId.value = null;
}

export function useLogsSearch() {
  return {
    query,
    results,
    activeIndex,
    matchCount,
    matchIndex,
    jumpToken,
    jumpId,
    jumpDirection,
    requestJump,
    reset,
  };
}
