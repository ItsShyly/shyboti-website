import { ref } from "vue";

// >>> shared instance - lets the global nav search act as an in-page "find in loaded messages" tool on the Logs page (Discord-style scope chip); LogsView owns matching/scrolling, this is just the shared channel between it and the nav bar

export interface LogSearchResult {
  id: string; // <<< used to scroll/highlight
  label: string; // <<< username / display name
  sub: string; // <<< message snippet around the match
}

const query = ref(""); // <<< current search text while scoped to logs
const results = ref<LogSearchResult[]>([]); // <<< written by LogsView, best match first
const activeIndex = ref(0); // <<< keyboard-highlighted row within `results`
const matchCount = ref(0); // <<< number of matching messages currently available
const matchIndex = ref(0); // <<< currently active match number (1-based) for the UI

const jumpToken = ref(0); // <<< bumped whenever a jump should actually happen
const jumpId = ref<string | null>(null); // <<< id of the message to jump to
const jumpDirection = ref(1); // <<< direction for next/previous navigation

// >>> Enter jumps to highlighted result, or clicking a result jumps to that id
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
