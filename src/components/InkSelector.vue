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
.ink-selector { @apply relative border-0 p-0 m-0 min-w-0;container-type:inline-size;margin-bottom:24px; }
legend { @apply mb-2 text-xs; color:var(--dl-muted); }
.ink-selector-options { @apply grid grid-cols-4 gap-2; }
.ink-choice { @apply flex items-center justify-center gap-2 border rounded-[var(--dl-r-md)] px-2 py-2 cursor-pointer text-xs min-w-0; min-height:36px;border-color:var(--dl-border);background:var(--dl-surface);color:var(--dl-text); }
.ink-choice.selected { border-color:var(--dl-border-strong);background:var(--dl-hover); }
.ink-choice i { @apply block w-3 h-3 rounded-full shrink-0;box-shadow:0 0 0 1px var(--dl-border-strong); }
.ink-choice input { @apply w-3.5 h-3.5 m-0 shrink-0;accent-color:var(--dl-accent); }
.ink-choice span { @apply whitespace-nowrap; }
fieldset:disabled .ink-choice { @apply opacity-60 cursor-wait; }
.selection-error { @apply absolute left-0 right-0 m-0 text-xs;bottom:-24px;line-height:18px;color:var(--dl-danger); }
@media(max-width:600px){.ink-selector-options{@apply grid-cols-2;}}
@media(max-width:760px), (pointer:coarse){.ink-choice{min-height:44px;}}
@container(max-width:420px){.ink-selector-options{grid-template-columns:repeat(2,minmax(0,1fr));}}

.ink-choice:hover { border-color:var(--dl-border-strong); }
.ink-choice:focus-within { outline:2px solid var(--dl-focus);outline-offset:2px; }
</style>
