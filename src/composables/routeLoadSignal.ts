import { ref } from 'vue'

// >>> ticks on chunk-load so loading bar can snap to 100%
export const routeLoadSignal = ref(0)
