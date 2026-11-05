<script setup lang="ts">
import { computed } from 'vue'
import { useRoute } from 'vue-router'
import { ChevronRight, LayoutGrid, Sun, Moon } from 'lucide-vue-next'
import { sidebarItems } from '../../data/sidebar'
import { useThemeStore } from '../../stores/theme'
import { useWorkflowStore } from '../../stores/workflow'
const route = useRoute(), layout = useThemeStore(), workflow = useWorkflowStore()
const current = computed(() => sidebarItems.find(item => item.to === route.path) || sidebarItems[0]!)
const state = computed(() => Object.values(workflow.operations).some(operation => operation.state === 'busy') ? '处理中' : '就绪')
</script>
<template><header class="platform-topbar"><div><LayoutGrid/><span>{{current.title}}</span><ChevronRight/><b>{{current.subtitle}}</b></div><div class="topbar-status"><i/><span role="status">{{state}}</span><button class="theme-toggle" :aria-label="layout.isDark?'切换浅色':'切换深色'" @click="layout.toggleTheme()"><Sun v-if="layout.isDark"/><Moon v-else/></button></div></header></template>
