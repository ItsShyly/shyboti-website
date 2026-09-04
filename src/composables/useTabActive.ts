import { ref, onActivated, onDeactivated, onUnmounted } from "vue";

// >>> true only while this KeepAlive'd tab is the one on screen. use it to
// gate <Teleport :disabled> so a backgrounded tab doesn't leave stale nodes
// in a shared teleport target.
//
// starts true on purpose: a component is only set up while it's being shown,
// and onActivated also fires on a fresh KeepAlive mount. no false->true flip
// on mount means the <Teleport> is enabled from the very first render, so its
// content never renders in-place and then gets moved a tick later - that move,
// under KeepAlive, was corrupting the tab's own subtree (list showed empty)
// and jittering the teleported header button.
export function useTabActive() {
  const active = ref(true);
  onActivated(() => (active.value = true));
  onDeactivated(() => (active.value = false));
  onUnmounted(() => (active.value = false));
  return active;
}
