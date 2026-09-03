import { ref, onActivated, onDeactivated, onMounted, onUnmounted } from "vue";

// >>> true only while this KeepAlive'd tab is the one on screen. use it to
// gate <Teleport :disabled> so a backgrounded tab doesn't leave stale nodes
// in a shared teleport target.
export function useTabActive() {
  const active = ref(false);
  onMounted(() => (active.value = true));
  onUnmounted(() => (active.value = false));
  onActivated(() => (active.value = true));
  onDeactivated(() => (active.value = false));
  return active;
}
