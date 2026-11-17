<script setup lang="ts">
import { computed, onMounted, ref, watch, nextTick, type Component } from 'vue'
import { useRoute, type RouteMeta } from 'vue-router'
import { ConfigProvider, theme } from 'ant-design-vue'
import DefaultLayout from './layouts/DefaultLayout.vue'
import GlobalDialogs from './components/GlobalDialogs.vue'
import { useThemeStore } from './stores/theme'
const route = useRoute(), themeStore = useThemeStore()
const layouts: Partial<Record<NonNullable<RouteMeta['layout']>, Component>> = { default: DefaultLayout }
const layout = computed(() => layouts[route.meta.layout || 'default'] || DefaultLayout)
const themeRoot = ref<HTMLElement>()
// Keep teleported Ant surfaces inside the same local theme boundary.
const popupContainer = () => themeRoot.value || document.body
const palette = ref({ colorPrimary: '#0f1115', colorBgElevated: '#ffffff', colorText: '#0f1115', colorTextSecondary: '#61666b', colorBorder: '#e4e6eb' })
async function syncPalette() {
  await nextTick()
  if (!themeRoot.value) return
  const css = getComputedStyle(themeRoot.value)
  palette.value = {
    colorPrimary: css.getPropertyValue('--dl-accent').trim(),
    colorBgElevated: css.getPropertyValue('--dl-surface').trim(),
    colorText: css.getPropertyValue('--dl-text').trim(),
    colorTextSecondary: css.getPropertyValue('--dl-muted').trim(),
    colorBorder: css.getPropertyValue('--dl-border').trim(),
  }
}
onMounted(syncPalette)
watch(() => themeStore.theme, syncPalette, { flush: 'post' })
const themeConfig = computed(() => ({ algorithm: themeStore.isDark ? theme.darkAlgorithm : theme.defaultAlgorithm, token: { ...palette.value, borderRadius: 12, fontSize: 13, controlHeight: 36, fontFamily: 'var(--dl-font)' } }))
</script>
<template><div ref="themeRoot" class="dilong-theme"><ConfigProvider :theme="themeConfig" :get-popup-container="popupContainer"><component :is="layout"><RouterView v-slot="{ Component }"><KeepAlive :include="['DesignView','InkView','ProductionView','ColorCompareView','TrendsView']"><component :is="Component" /></KeepAlive></RouterView></component><GlobalDialogs /></ConfigProvider></div></template>
