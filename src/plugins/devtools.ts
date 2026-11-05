/** Enable the template's visual Devtools in the explicit tools mode. */
export async function initializeDevtools() {
  if (!import.meta.env.DEV || import.meta.env.MODE !== 'tools') return
  try {
    // Devtools 8 reads browser storage during evaluation; it is optional UI.
    const value = localStorage.getItem('__VUE_DEVTOOLS_KIT_TIMELINE_LAYERS_STATE__')
    if (value) JSON.parse(value)
    await import('./devtools-loader')
  } catch { /* Restricted storage must not prevent the workspace from opening. */ }
}
