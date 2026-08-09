import { ref } from 'vue'

// >>> ticks up the instant a lazy route's real chunk finishes downloading -
// >>> RouteLoading.vue watches this to snap its bar to 100% before the real
// >>> page swaps in, instead of just vanishing mid-fill at ~90%
export const routeLoadSignal = ref(0)
