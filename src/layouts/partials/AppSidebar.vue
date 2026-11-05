<script setup lang="ts">
import { useRoute } from 'vue-router'
import { Layers3 } from 'lucide-vue-next'
import { sidebarItems } from '../../data/sidebar'
const route = useRoute()
</script>
<template><aside class="platform-sidebar" aria-label="主导航"><div class="platform-brand"><div class="brand-mark"><Layers3 :size="22"/></div><div><b>帝龙装饰纸</b><span>智能设计平台</span></div></div><nav class="text-navigation"><RouterLink v-for="item in sidebarItems" :key="item.to" :to="item.to" :class="{active:route.path===item.to}" :aria-label="item.title+' '+item.subtitle" :title="item.title"><component :is="item.icon"/><span><b>{{item.title}}</b><small>{{item.subtitle}}</small></span></RouterLink></nav><div class="sidebar-foot"><span>PLATFORM DEMO</span><b>V0.6</b><small>演示数据 · 非生产版本</small></div></aside></template>
