<script setup lang="ts">
import { useRoutedLayout } from '@/composables/useRoutedLayout'
import AppHeader from './partials/AppHeader.vue'
import AppSidebar from './partials/AppSidebar.vue'
useRoutedLayout()
</script>
<template><div class="platform-shell app-shell"><AppSidebar/><section class="platform-main"><AppHeader/><main class="platform-content"><slot/></main></section></div></template>
