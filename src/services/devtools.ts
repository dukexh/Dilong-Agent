import type { setupDevtoolsPlugin as setupPlugin } from '@vue/devtools-api'

// Devtools 8 reads localStorage during module evaluation. Keep this optional
// integration from preventing Pinia/Router and the application from starting.
let plugin: Promise<typeof import('@dilong/vue-devtools-api')> | undefined
export const setupDevtoolsPlugin: typeof setupPlugin = (...args) => {
  if (!import.meta.env.DEV) return
  try { localStorage.getItem('__VUE_DEVTOOLS_KIT_TIMELINE_LAYERS_STATE__') }
  catch { return }
  plugin ??= import('@dilong/vue-devtools-api')
  void plugin.then(api => api.setupDevtoolsPlugin(...args)).catch(() => {
    // Theme and business data do not depend on developer tooling.
  })
}
