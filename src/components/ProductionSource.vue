<script setup lang="ts">
import { ref } from 'vue'
import { Upload, LoaderCircle, RotateCcw } from 'lucide-vue-next'
import type { PixelImage } from '../core/types'
export interface ProductionAsset { name: string; preview: string; originalUrl: string; pixels: PixelImage; width: number; height: number; example: boolean }
export interface Point { x: number; y: number }
const props = defineProps<{ asset: ProductionAsset | null; quad: Point[]; side: 0 | 1; busy: boolean; loading: boolean }>()
const emit = defineEmits<{ file: [file: File]; quad: [quad: Point[]] }>()
const input = ref<HTMLInputElement>(), svg = ref<SVGSVGElement>(), dragging = ref(false)
let anchor: Point | null = null
const clamp = (value: number) => Math.max(0, Math.min(1, value))
const rectQuad = (first: Point, second: Point): Point[] => [{ x: Math.min(first.x, second.x), y: Math.min(first.y, second.y) }, { x: Math.max(first.x, second.x), y: Math.min(first.y, second.y) }, { x: Math.max(first.x, second.x), y: Math.max(first.y, second.y) }, { x: Math.min(first.x, second.x), y: Math.max(first.y, second.y) }]
function point(event: PointerEvent): Point { const box = svg.value!.getBoundingClientRect(); return { x: clamp((event.clientX - box.left) / box.width), y: clamp((event.clientY - box.top) / box.height) } }
function down(event: PointerEvent) {
  if (props.busy || props.loading || props.side === 1) return
  event.preventDefault(); const value = (event.target as Element).getAttribute('data-corner')
  anchor = value === null ? point(event) : props.quad[(Number(value) + 2) % 4]!
  svg.value?.setPointerCapture(event.pointerId)
  if (value === null) emit('quad', rectQuad(anchor, anchor))
}
function move(event: PointerEvent) { if (!anchor || props.busy || props.loading || props.side === 1) return; emit('quad', rectQuad(anchor, point(event))) }
function coordinate(index: number, axis: 'x' | 'y', event: Event) {
  const value = Number((event.target as HTMLInputElement).value)
  if (!Number.isFinite(value) || props.busy || props.side === 1) return
  emit('quad', rectQuad(props.quad[(index + 2) % 4]!, { ...props.quad[index]!, [axis]: clamp(value / 100) }))
}
function selected(event: Event) { const field = event.target as HTMLInputElement; const file = field.files?.[0]; field.value = ''; if (file && !props.busy && !props.loading) emit('file', file) }
function dropped(event: DragEvent) { event.preventDefault(); dragging.value = false; const file = event.dataTransfer?.files[0]; if (file && !props.busy && !props.loading) emit('file', file) }
</script>
<template>
  <section class="panel pc-source-panel source-card" :class="{dragging}" @dragover.prevent="dragging=true" @dragleave="dragging=false" @drop="dropped">
    <div class="panel-header source-heading"><span class="step-no source-step">{{side===0?'01':'02'}}</span><div><strong>{{side===0?'设计原图':'生产实物'}}</strong><small>{{side===0?'上传设计文件，框选本次比较的基准区域':'上传平面样品照片，选区随设计原图同步'}}</small></div><span class="demo-badge">JPG · PNG · WEBP</span></div>
    <div class="pc-stage has-image source-image">
      <div v-if="asset" class="pc-image-frame source-frame" :style="{aspectRatio:asset.width+'/'+asset.height,'--source-ratio':asset.width/asset.height}">
        <img :src="asset.preview" :alt="side===0?'设计原图预览':'生产实物预览'" draggable="false">
        <svg ref="svg" class="pc-selection selection" :class="{readonly:side===1 || busy || loading}" viewBox="0 0 100 100" preserveAspectRatio="none" :aria-label="side===0?'拖动框选原图区域':'实物选区随原图同步，只读'" :aria-disabled="side===1 || busy || loading" @pointerdown="down" @pointermove="move" @pointerup="anchor=null" @pointercancel="anchor=null">
          <polygon :points="quad.map(p=>p.x*100+','+p.y*100).join(' ')" fill="#145f6518" stroke="#145f65" stroke-width=".65" vector-effect="non-scaling-stroke"/>
          <g v-for="(p,index) in quad" :key="index"><circle :data-corner="index" :cx="p.x*100" :cy="p.y*100" r="1.8" fill="white" stroke="#145f65" stroke-width=".6"/><text :x="Math.max(3,Math.min(94,p.x*100+3))" :y="Math.max(7,Math.min(96,p.y*100+5))" font-size="4" fill="#145f65" stroke="white" stroke-width=".8" paint-order="stroke" pointer-events="none">{{index+1}}</text></g>
        </svg>
      </div>
      <div v-else class="empty-state"><LoaderCircle v-if="loading" :size="26" class="spin"/><Upload v-else :size="26"/><span>{{loading?'正在读取图片…':'拖入图片或选择本地文件'}}</span></div>
    </div>
    <div class="pc-file-row source-bottom"><div><strong :title="asset?.name">{{asset?.name || 'JPG · PNG · WebP'}}</strong><small>{{asset ? asset.width+' × '+asset.height+(asset.example?' · 演示样本':' · 本地图片') : (side===0?'拖动框选矩形，或精确输入百分比':'实物选区随设计原图按比例同步')}}</small></div><input ref="input" type="file" class="sr-only" accept=".png,.jpg,.jpeg,.webp" :aria-label="side===0?'上传设计原图':'上传生产实物'" :disabled="busy || loading" @change="selected"><button class="btn btn-secondary" :disabled="busy || loading" @click="input?.click()"><Upload :size="14"/> 更换图片</button></div>
    <div v-if="asset && side===0" class="source-tools pc-toolbar"><button class="text-link" :disabled="busy || loading" @click="emit('quad',[{x:0,y:0},{x:1,y:0},{x:1,y:1},{x:0,y:1}])"><RotateCcw :size="13"/> 使用整张图片</button><details><summary>精确调整选区（百分比）</summary><div class="coordinate-grid pc-coordinate-grid"><div v-for="index in [0,2]" :key="index"><span>原图角点 {{index+1}}</span><label v-for="axis in (['x','y'] as const)" :key="axis">{{axis.toUpperCase()}}<input class="form-control" type="number" min="0" max="100" step=".1" :value="Math.round(quad[index]![axis]*1000)/10" :disabled="busy || loading" :aria-label="'原图角点'+(index+1)+axis.toUpperCase()+'百分比'" @change="coordinate(index,axis,$event)"></label></div></div></details></div>
  </section>
</template>
<style scoped>
@reference "../assets/css/style.css";
.source-card {
  @apply min-w-[0];
  background: var(--surface);
  @apply overflow-visible
}
.source-heading {
  @apply flex;
  @apply gap-[12px];
  @apply items-center;
  @apply justify-start
}
.source-heading>div {
  @apply flex;
  @apply flex-col;
  @apply gap-[4px];
  @apply min-w-[0]
}
.source-heading strong {
  @apply text-[14px]
}
.source-heading small {
  @apply text-[11px];
  color: var(--muted)
}
.source-step {
  flex: none
}
.demo-badge {
  font: 9px var(--font-mono);
  color: #869c9e;
  @apply ml-[auto]
}
.source-image {
  @apply p-[0];
  @apply flex;
  @apply items-center;
  @apply justify-center;
  background: #edf1f0;
  @apply min-h-[200px]
}
.source-frame {
  @apply relative;
  @apply w-[100%]
}
.source-frame img {
  @apply w-[100%];
  @apply h-[100%];
  @apply object-contain;
  @apply block;
  pointer-events: none
}
.selection {
  @apply absolute;
  @apply inset-[0];
  @apply w-[100%];
  @apply h-[100%];
  @apply overflow-visible;
  touch-action: none;
  cursor: crosshair
}
.selection.readonly {
  cursor: default;
  touch-action: auto
}
.selection circle {
  cursor: move
}
.selection.readonly circle {
  cursor: default
}
.source-bottom {
  @apply [padding:14px_16px];
  @apply flex;
  @apply items-center;
  @apply justify-between;
  @apply gap-[8px]
}
.source-bottom>div {
  @apply min-w-[0];
  @apply flex;
  @apply flex-col;
  @apply gap-[6px]
}
.source-bottom strong {
  @apply text-[12px];
  @apply wrap-anywhere
}
.source-bottom small {
  @apply text-[10px];
  color: #899fa0
}
.source-bottom button {
  @apply text-[11px];
  flex: none
}
.source-tools {
  @apply [padding:8px_16px_14px];
  @apply grid;
  @apply gap-[16px];
  @apply text-[11px];
  color: var(--muted)
}
.source-tools details {
  @apply text-[10px]
}
.source-tools summary {
  cursor: pointer
}
.text-link {
  @apply [border:1px_solid_#c5d5d5];
  background: var(--surface);
  @apply [padding:7px_10px];
  color: #145f65;
  @apply flex;
  @apply items-center;
  @apply gap-[5px];
  @apply text-[10px];
  @apply w-[max-content]
}
.coordinate-grid {
  @apply grid;
  @apply gap-[12px];
  @apply mt-[12px]
}
.coordinate-grid>div {
  @apply flex;
  @apply gap-[10px];
  @apply items-center
}
.coordinate-grid>div>span {
  flex: 1
}
.coordinate-grid label {
  @apply flex;
  @apply gap-[4px];
  @apply items-center
}
.coordinate-grid input {
  @apply w-[65px];
  @apply text-[11px];
  @apply p-[6px]
}
.empty-state {
  @apply min-h-[200px]
}
.source-card.dragging {
  outline: 2px dashed #145f65
}
@media(max-width:600px){
.source-bottom {
  @apply flex-wrap
}
.source-bottom button {
  @apply ml-[auto]
}
.source-heading {
  @apply p-[12px]
}
.source-heading small {
  @apply text-[10px]
}
.coordinate-grid>div {
  @apply gap-[6px]
}
.coordinate-grid input {
  @apply w-[58px]
}}
</style>
