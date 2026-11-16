<script setup lang="ts">
import { inks, labels, inkColours, type InkKey } from '../core/ink-recipe'
defineProps<{ disabled?: boolean; label: string }>()
const selected = defineModel<InkKey[]>({ required: true })
function toggle(key: InkKey, checked: boolean) {
  selected.value = inks.filter(ink => ink === key ? checked : selected.value.includes(ink))
}
</script>
<template>
  <fieldset class="ink-selector" :disabled="disabled" :aria-label="label">
    <legend>基础色墨</legend>
    <div class="ink-selector-options">
      <label v-for="key in inks" :key="key" class="ink-choice" :class="{selected:selected.includes(key)}">
        <input type="checkbox" :checked="selected.includes(key)" :aria-label="label+'：'+labels[key]" @change="toggle(key,($event.target as HTMLInputElement).checked)"/>
        <i :style="{background:inkColours[key]}"/><span>{{labels[key]}}</span>
      </label>
    </div>
    <p v-if="!selected.length" class="selection-error" role="status">至少选择一种油墨</p>
  </fieldset>
</template>
<style scoped>
@reference "../assets/css/style.css";
.ink-selector { @apply relative border-0 p-0 m-0 min-w-0;container-type:inline-size;margin-bottom:26px; }
legend { @apply mb-2 text-xs; color:var(--muted); }
.ink-selector-options { @apply grid grid-cols-4 gap-2; }
.ink-choice { @apply flex items-center justify-center gap-2 border rounded px-2 py-3 cursor-pointer text-xs min-w-0; border-color:var(--line-strong,var(--border));background:var(--surface,var(--card));color:var(--ink,var(--text)); }
.ink-choice.selected { border-color:var(--teal);background:color-mix(in srgb,var(--teal) 8%,var(--surface)); }
.ink-choice i { @apply block w-3 h-3 rounded-full shrink-0; }
.ink-choice input { @apply w-3.5 h-3.5 m-0 shrink-0;accent-color:var(--teal); }
.ink-choice span { @apply whitespace-nowrap; }
fieldset:disabled .ink-choice { @apply opacity-60 cursor-wait; }
.selection-error { @apply absolute left-0 right-0 m-0 text-xs;bottom:-26px;line-height:18px;color:#a13e24; }
@media(max-width:600px){.ink-selector-options{@apply grid-cols-2;}}
@container(max-width:420px){.ink-selector-options{grid-template-columns:repeat(2,minmax(0,1fr));}}
</style>
