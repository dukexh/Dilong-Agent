<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { fullRegion, type ImageRegion } from '../services/image-tools'
const props = defineProps<{ src: string; disabled?: boolean; compact?: boolean; horizontal?: boolean; expanded?: boolean; previewSize?: number }>()
const emit = defineEmits<{ edit: [] }>()
const region = defineModel<ImageRegion>({ default: fullRegion })
const stage = ref<HTMLElement | null>(null)
const native = ref({ width: 0, height: 0 })
const editing = ref(!!props.expanded)
watch(() => props.expanded, value => { editing.value = !!value })
const previewLimit = computed(() => props.previewSize ?? (props.horizontal ? 200 : 288))
const selected = computed(() => editing.value || region.value.x !== 0 || region.value.y !== 0 || region.value.width !== 100 || region.value.height !== 100)
const cropSize = computed(() => {
  const width = Math.max(1, Math.min(native.value.width - Math.floor(native.value.width * region.value.x / 100), Math.round(native.value.width * region.value.width / 100)))
  const height = Math.max(1, Math.min(native.value.height - Math.floor(native.value.height * region.value.y / 100), Math.round(native.value.height * region.value.height / 100)))
  return region.value.rotation % 180 ? { width: height, height: width } : { width, height }
})
let start: { x: number; y: number } | null = null
watch(() => props.src, () => { region.value = fullRegion(); native.value = { width: 0, height: 0 }; editing.value = !!props.expanded })
function loaded(event: Event) { const image = event.target as HTMLImageElement; native.value = { width: image.naturalWidth, height: image.naturalHeight } }
function update(key: keyof ImageRegion, event: Event) {
  const value = Number((event.target as HTMLInputElement).value)
  if (!Number.isFinite(value)) return
  const next = { ...region.value, [key]: value }
  next.x = Math.max(0, Math.min(99, next.x)); next.y = Math.max(0, Math.min(99, next.y))
  next.width = Math.max(1, Math.min(100 - next.x, next.width)); next.height = Math.max(1, Math.min(100 - next.y, next.height))
  region.value = next
  emit('edit')
}
function point(event: PointerEvent) {
  const rect = stage.value!.getBoundingClientRect()
  return { x: Math.max(0, Math.min(100, (event.clientX - rect.left) / rect.width * 100)), y: Math.max(0, Math.min(100, (event.clientY - rect.top) / rect.height * 100)) }
}
function down(event: PointerEvent) { if (props.disabled || !stage.value) return; editing.value = true; start = point(event); stage.value.setPointerCapture(event.pointerId) }
function move(event: PointerEvent) {
  if (!start || props.disabled) return
  const end = point(event), x = Math.min(99, Math.min(start.x, end.x)), y = Math.min(99, Math.min(start.y, end.y))
  region.value = { x, y, width: Math.min(100 - x, Math.max(1, Math.abs(end.x - start.x))), height: Math.min(100 - y, Math.max(1, Math.abs(end.y - start.y))), rotation: region.value.rotation }
  emit('edit')
}
function up() { start = null }
function reset() { region.value = fullRegion(); emit('edit') }
</script>
<template>
  <fieldset class="region-editor" :class="{'region-compact':compact,'region-horizontal':horizontal}" :disabled="disabled"><legend :class="{'sr-only':compact}">有效纹理区域</legend><p v-if="!compact">拖动框选，排除背景；也可填写百分比。裁剪后按指定角度旋转。</p>
    <div v-if="src" ref="stage" class="region-stage" :style="compact&&native.height?{maxWidth:Math.min(previewLimit,previewLimit*native.width/native.height)+'px'}:undefined" @pointerdown.prevent="down" @pointermove="move" @pointerup="up" @pointercancel="up"><img :src="src" alt="框选纹理区域" draggable="false" @load="loaded"/><span v-if="!compact||selected" class="region-selection" :style="{left:region.x+'%',top:region.y+'%',width:region.width+'%',height:region.height+'%'}"/></div>
    <div v-if="compact" class="compact-region-toolbar"><span class="source-pixel-dimensions">{{native.width||'—'}} × {{native.height||'—'}} px</span><button type="button" :aria-expanded="editing" @click="editing=!editing">{{editing?'收起参数':'裁剪与旋转'}}</button></div>
    <p v-else-if="native.width" class="source-pixel-dimensions">原图 {{native.width}} × {{native.height}} 像素 · 当前选区 {{cropSize.width}} × {{cropSize.height}} 像素</p>
    <div v-show="!compact||editing" class="region-parameters"><p v-if="compact">在图片上拖动框选，按当前方向比较纹理。</p>
    <div class="region-fields"><label v-for="item in [{key:'x',label:'左侧'},{key:'y',label:'顶部'},{key:'width',label:'宽度'},{key:'height',label:'高度'}] as const" :key="item.key">{{item.label}} %<input :aria-label="'选区'+item.label+'百分比'" type="number" :min="item.key==='x'||item.key==='y'?0:1" max="100" step="1" :value="Math.round(region[item.key]*10)/10" @change="update(item.key,$event)"/></label></div>
    <div class="region-actions"><label>旋转 <select aria-label="纹理旋转角度" :value="region.rotation" @change="update('rotation',$event)"><option :value="0">0°</option><option :value="90">90°</option><option :value="180">180°</option><option :value="270">270°</option></select></label><button type="button" class="btn btn-secondary" @click="reset">使用整张图片</button></div></div>
  </fieldset>
</template>
<style scoped>
@reference "../assets/css/style.css";
.region-editor { @apply min-w-0 border-0 p-0 my-3; }
legend { @apply text-xs font-semibold; color:var(--ink); }
p { @apply text-xs leading-relaxed my-2; color:var(--muted); }
.region-stage { @apply relative overflow-hidden max-w-80 my-2; touch-action:none; cursor:crosshair; background:var(--surface); }
.region-stage img { @apply block w-full select-none; pointer-events:none; }
.region-selection { @apply absolute border-2 border-teal-600; box-shadow:0 0 0 500px #10282d44; pointer-events:none; }
.region-fields { @apply grid grid-cols-4 gap-2; }
label { @apply text-xs min-w-0; color:var(--muted); }
input,select { @apply w-full mt-1 px-2 py-2 min-w-0 border; background:var(--surface); color:var(--ink); border-color:var(--line-strong); }
.region-actions { @apply flex flex-wrap items-end gap-3 mt-3; }
.region-actions label { @apply flex-1; }
.region-compact { @apply m-0; }
.region-compact .region-stage { @apply m-0 mx-auto rounded-md; }
.compact-region-toolbar { @apply flex items-center justify-between gap-2 text-[11px] mt-3; color:var(--muted); }
.compact-region-toolbar button { color:var(--teal); }
.region-compact .region-parameters { @apply border-t mt-3 pt-2; border-color:var(--line-strong); }
.region-compact .region-fields { @apply grid-cols-2; }
.region-horizontal { @apply grid gap-x-5 gap-y-3;grid-template-columns:minmax(0,200px) minmax(0,1fr);align-items:start; }
.region-horizontal .region-stage { grid-column:1;grid-row:1; }
.region-horizontal .compact-region-toolbar { grid-column:1;grid-row:2;@apply mt-0; }
.region-horizontal .region-parameters { grid-column:2;grid-row:1/span 2;@apply border-0 m-0 p-0; }
.region-horizontal .region-parameters>p { @apply mt-0; }
@media(max-width:760px){.region-horizontal{grid-template-columns:1fr;}.region-horizontal .region-stage{grid-column:1;grid-row:1;}.region-horizontal .compact-region-toolbar{grid-column:1;grid-row:2;}.region-horizontal .region-parameters{grid-column:1;grid-row:3;}}
</style>
