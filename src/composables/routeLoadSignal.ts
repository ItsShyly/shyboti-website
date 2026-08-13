import { ref } from 'vue'

// >>> ticks on chunk-load so RouteLoading.vue can snap its bar to 100% instead of vanishing mid-fill
export const routeLoadSignal = ref(0)
