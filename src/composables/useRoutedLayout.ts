import { onBeforeUnmount, watch } from 'vue'
import { useRoute } from 'vue-router'
import { useLayoutStore } from '@/stores/layout'
export function useRoutedLayout() {
  const route = useRoute(), layout = useLayoutStore()
  watch(() => route.meta.layoutMode, mode => layout.setMode(mode), { immediate: true })
  watch(() => route.meta.bodyClass, (value, previous) => {
    if (previous) document.body.classList.remove(previous)
    if (value) document.body.classList.add(value)
  }, { immediate: true })
  onBeforeUnmount(() => { if (route.meta.bodyClass) document.body.classList.remove(route.meta.bodyClass); layout.clear() })
}
