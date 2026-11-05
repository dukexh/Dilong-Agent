<script setup lang="ts">
import { computed, type Component } from 'vue'
import { useRoute, type RouteMeta } from 'vue-router'
import { ConfigProvider, theme } from 'ant-design-vue'
import DefaultLayout from './layouts/DefaultLayout.vue'
import GlobalDialogs from './components/GlobalDialogs.vue'
import { useThemeStore } from './stores/theme'
const route = useRoute(), themeStore = useThemeStore()
const layouts: Partial<Record<NonNullable<RouteMeta['layout']>, Component>> = { default: DefaultLayout }
const layout = computed(() => layouts[route.meta.layout || 'default'] || DefaultLayout)
const themeConfig = computed(() => ({ algorithm: themeStore.isDark ? theme.darkAlgorithm : theme.defaultAlgorithm, token: { colorPrimary: '#145f65', borderRadius: 2, fontFamily: 'Noto Sans SC, Microsoft YaHei, PingFang SC, Arial, sans-serif' } }))
</script>
<template><ConfigProvider :theme="themeConfig"><component :is="layout"><RouterView v-slot="{ Component }"><KeepAlive :include="['DesignView','InkView','ProductionView','TrendsView']"><component :is="Component" /></KeepAlive></RouterView></component><GlobalDialogs /></ConfigProvider></template>
