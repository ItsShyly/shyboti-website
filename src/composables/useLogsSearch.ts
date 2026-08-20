import { ref } from "vue";

// >>> shared state between logs page and nav search

export interface LogSearchResult {
  id: string; // <<< used to scroll/highlight
  label: string; // <<< username / display name
  sub: string; // <<< message snippet around the match
}

const query = ref(""); // <<< search text while scoped to logs
const results = ref<LogSearchResult[]>([]); // <<< best match first
const activeIndex = ref(0); // <<< keyboard-highlighted row index
const matchCount = ref(0);
const matchIndex = ref(0); // <<< 1-based match number for display

const jumpToken = ref(0); // <<< bump this to trigger a jump
const jumpId = ref<string | null>(null); // <<< target message id, if any
const jumpDirection = ref(1); // <<< 1 or -1 for next/prev

// >>> jump to highlighted result, or to a clicked id
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
