import { nextTick, onMounted, watch, type WatchSource } from 'vue'

/**
 * Re-runs Preline's DOM scan.
 *
 * The router already calls autoInit after every navigation, so pages only need
 * this for markup that appears *after* mount — v-if panels, v-for lists filled
 * from async data, dynamically injected modals.
 *
 * @param deps reactive sources that should trigger a re-scan when they change
 */
export function usePreline(deps: WatchSource[] = []) {
  const reinit = (): void => {
    nextTick(() => window.HSStaticMethods?.autoInit())
  }

  onMounted(reinit)
  if (deps.length) watch(deps, reinit)

  return { reinit }
}
