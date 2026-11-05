import { defineStore } from 'pinia'
import { ref, watch } from 'vue'
import { applyDocumentLayout, clearDocumentLayout, type LayoutMode } from '@/utils/layoutDom'
export const useLayoutStore = defineStore('layout', () => {
  const mode = ref<LayoutMode>('default')
  function setMode(next: LayoutMode | undefined) { mode.value = next ?? 'default' }
  watch(mode, value => applyDocumentLayout(value), { immediate: true })
  return { mode, setMode, clear: clearDocumentLayout }
})
