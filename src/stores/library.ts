import { defineStore } from 'pinia'
import { ref } from 'vue'
export const useLibraryStore = defineStore('library', () => {
  const query = ref(''), category = ref('全部'), currentPage = ref(1)
  return { query, category, currentPage }
})
