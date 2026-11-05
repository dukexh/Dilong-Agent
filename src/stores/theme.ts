import { defineStore } from 'pinia'
import { computed, ref, watch } from 'vue'
export type Theme = 'light' | 'dark'
const STORAGE_KEY = 'dilong-theme'
function readStoredTheme(): Theme {
  try { return localStorage.getItem(STORAGE_KEY) === 'dark' ? 'dark' : 'light' }
  catch { return 'light' }
}
export const useThemeStore = defineStore('theme', () => {
  const theme = ref<Theme>(readStoredTheme())
  const isDark = computed(() => theme.value === 'dark')
  function setTheme(next: Theme) { theme.value = next === 'dark' ? 'dark' : 'light' }
  function toggleTheme() { setTheme(isDark.value ? 'light' : 'dark') }
  function resetTheme() { setTheme('light') }
  watch(theme, value => {
    document.documentElement.setAttribute('data-theme', value)
    try { localStorage.setItem(STORAGE_KEY, value) } catch { /* Keep switching available in memory. */ }
  }, { immediate: true })
  return { theme, isDark, setTheme, toggleTheme, resetTheme }
})
