import { fileURLToPath, URL } from 'node:url'
import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import vueJsx from '@vitejs/plugin-vue-jsx'
import vueDevTools from 'vite-plugin-vue-devtools'
import tailwindcss from '@tailwindcss/vite'
export default defineConfig({
  plugins: [vue(), vueJsx(), vueDevTools({ appendTo: 'devtools-loader.ts' }), tailwindcss()],
  resolve: { alias: {
    '@': fileURLToPath(new URL('./src', import.meta.url)),
    '@vue/devtools-api': fileURLToPath(new URL('./src/services/devtools.ts', import.meta.url)),
    '@dilong/vue-devtools-api': fileURLToPath(new URL('./node_modules/@vue/devtools-api/dist/index.js', import.meta.url)),
  } },
  base: process.env.DILONG_BASE || '/',
  cacheDir: process.env.DILONG_CACHE_DIR || 'node_modules/.vite',
  server: { host: '127.0.0.1', port: 51458, strictPort: true },
  build: { outDir: 'dist' },
})
