import { ref } from 'vue'

// Shared reactive state - single instance across the whole app.
//
// Lets the global nav search bar (App.vue) act, while on the Logs page, as an
// in-page "find in loaded messages" tool - Discord-style: a removable scope
// chip appears in the search box, and typing highlights every match already
// loaded in LogsView (no new network request) and jumps to the nearest one.
// Enter / Shift+Enter (or explicit next/previous) step through matches, same
// as the universal search dropdown's arrow-key navigation.
//
// LogsView owns the actual matching + scrolling logic (it has the loaded
// messages); this composable is just the shared channel between it and the
// nav bar: the query flows in, match position/count flow back out, and jump
// requests flow in.

const query      = ref('')   // current search text while scoped to logs (bound to the nav input)
const matchCount = ref(0)    // total matches in the currently loaded logs - written by LogsView
const matchIndex = ref(0)    // 1-based position of the active match, 0 = no match - written by LogsView

const jumpToken     = ref(0)          // bumped to ask LogsView to move to another match
const jumpDirection = ref<1 | -1>(1)  // direction of the pending jump

function requestJump(direction: 1 | -1 = 1) {
  jumpDirection.value = direction
  jumpToken.value++
}

function reset() {
  query.value      = ''
  matchCount.value = 0
  matchIndex.value = 0
}

export function useLogsSearch() {
  return { query, matchCount, matchIndex, jumpToken, jumpDirection, requestJump, reset }
}
