<script setup lang="ts">
import { computed } from 'vue'
const props = defineProps<{title?:string;description?:string;eyebrow?:string}>()
const step = computed(() => props.eyebrow?.match(/\d+/)?.[0])
</script>
<template><section class="panel"><header v-if="title" class="panel-header"><div><span v-if="step" class="step-no">{{step.padStart(2,'0')}}</span><div class="step-title"><h2>{{title}}</h2><p v-if="description">{{description}}</p></div></div><slot name="actions"/></header><div class="panel-content"><slot/></div><footer v-if="$slots.footer" class="panel-footer"><slot name="footer"/></footer></section></template>
