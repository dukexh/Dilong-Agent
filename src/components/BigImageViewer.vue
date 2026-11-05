<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue'
import { Download, Maximize2, Minus, Plus, X } from 'lucide-vue-next'
import { DesignImages } from '../core/design-images'

defineOptions({ inheritAttrs: false })
const props = withDefaults(defineProps<{ src: string; previewSrc?: string; alt: string; eager?: boolean }>(), { previewSrc: '', eager: false })
const trigger = ref<HTMLButtonElement | null>(null)
const dialog = ref<HTMLDialogElement | null>(null)
const viewport = ref<HTMLDivElement | null>(null)
const opened = ref(false)
const thumbnail = ref('')
const zoom = ref<number | null>(null)
const size = ref<{ width: number; height: number } | null>(null)
const viewportSize = ref({ width: 0, height: 0 })
const error = ref('')
let observer: ResizeObserver | null = null
let thumbnailRevision = 0
let drag: { x: number; y: number; left: number; top: number } | null = null
const scale = computed(() => zoom.value ?? (size.value && viewportSize.value.width && viewportSize.value.height ? Math.min(1, viewportSize.value.width / size.value.width, viewportSize.value.height / size.value.height) : 1))
const fullImageStyle = computed(() => size.value ? { width: `${size.value.width * scale.value}px`, height: `${size.value.height * scale.value}px` } : {})
watch(() => [props.src, props.previewSrc], async () => {
  const revision = ++thumbnailRevision
  thumbnail.value = ''
  if (opened.value) close()
  if (props.src && !props.previewSrc) {
    try { const url = await DesignImages.thumbnail(props.src); if (revision === thumbnailRevision) thumbnail.value = url }
    catch { /* The original remains available when thumbnail creation is unavailable. */ }
  }
}, { immediate: true })
async function open() {
  if (!props.src) return
  zoom.value = null; size.value = null; error.value = ''; opened.value = true
  await nextTick()
  dialog.value?.showModal()
  const element = viewport.value
  if (element) {
    const measure = () => { viewportSize.value = { width: element.clientWidth, height: element.clientHeight } }
    measure(); observer = new ResizeObserver(measure); observer.observe(element)
  }
}
function close() {
  observer?.disconnect(); observer = null; drag = null
  dialog.value?.close(); opened.value = false
  void nextTick(() => trigger.value?.focus())
}
function loaded(event: Event) {
  const image = event.target as HTMLImageElement
  size.value = { width: image.naturalWidth, height: image.naturalHeight }
}
async function setZoom(value: number | null) {
  const element = viewport.value
  const previous = scale.value
  const centerX = element ? (element.scrollLeft + element.clientWidth / 2) / previous : 0
  const centerY = element ? (element.scrollTop + element.clientHeight / 2) / previous : 0
  zoom.value = value === null ? null : Math.max(.05, Math.min(4, value))
  await nextTick()
  if (element) { element.scrollLeft = centerX * scale.value - element.clientWidth / 2; element.scrollTop = centerY * scale.value - element.clientHeight / 2 }
}
function startDrag(event: PointerEvent) {
  if (event.button !== 0 || !viewport.value) return
  const element = viewport.value
  drag = { x: event.clientX, y: event.clientY, left: element.scrollLeft, top: element.scrollTop }
  element.setPointerCapture(event.pointerId)
}
function moveDrag(event: PointerEvent) {
  if (!drag || !viewport.value) return
  viewport.value.scrollLeft = drag.left + drag.x - event.clientX
  viewport.value.scrollTop = drag.top + drag.y - event.clientY
}
async function download(event: MouseEvent) {
  if (props.src.startsWith('data:image/png')) return
  event.preventDefault(); error.value = ''
  try {
    const response = await fetch(props.src)
    if (!response.ok) throw new Error(`HTTP ${response.status}`)
    const blob = await response.blob(), url = URL.createObjectURL(blob), link = document.createElement('a')
    const extension = blob.type === 'image/jpeg' ? 'jpg' : blob.type === 'image/webp' ? 'webp' : 'png'
    link.href = url; link.download = `${props.alt || '设计结果'}.${extension}`; link.click()
    setTimeout(() => URL.revokeObjectURL(url), 1000)
  } catch (reason) { error.value = `下载失败：${reason instanceof Error ? reason.message : '无法读取完整图片'}` }
}
onBeforeUnmount(() => { observer?.disconnect(); thumbnailRevision++; dialog.value?.close() })
</script>

<template>
  <button v-bind="$attrs" ref="trigger" type="button" class="big-image-trigger" :disabled="!src" :aria-label="`放大查看${alt}`" title="点击查看完整分辨率" @click="open">
    <img v-if="src" :src="previewSrc || thumbnail || src" :alt="alt" :loading="eager ? 'eager' : 'lazy'" />
    <span v-else class="image-unavailable">图片不可用</span>
    <span v-if="src" class="image-hint"><Maximize2 :size="13" />放大查看</span>
  </button>
  <Teleport to="body">
    <dialog v-if="opened" ref="dialog" class="big-image-dialog" :aria-label="alt" @cancel.prevent="close" @click="event => { if (event.target === event.currentTarget) close() }">
      <header><div><strong>{{ alt }}</strong><p>完整分辨率查看；支持缩放、拖动或滚动，按 Esc 关闭。</p></div><button type="button" aria-label="关闭大图" @click="close"><X :size="20" /></button></header>
      <div class="image-tools">
        <button type="button" @click="setZoom(null)">适应窗口</button><button type="button" @click="setZoom(1)">100%</button>
        <button type="button" aria-label="缩小图片" @click="setZoom(scale * .8)"><Minus :size="16" /></button><button type="button" aria-label="放大图片" @click="setZoom(scale * 1.25)"><Plus :size="16" /></button>
        <span aria-live="polite">{{ size ? `${size.width} × ${size.height} · ${Math.round(scale * 100)}%` : '正在加载完整图片' }}</span>
        <a :href="src" :download="`${alt || '设计结果'}.png`" @click="download"><Download :size="15" />下载完整图片</a>
      </div>
      <p v-if="error" class="image-error" role="alert">{{ error }}</p>
      <div ref="viewport" class="image-viewport" tabindex="0" aria-label="完整图片，可滚动查看" @pointerdown="startDrag" @pointermove="moveDrag" @pointerup="drag = null" @pointercancel="drag = null" @lostpointercapture="drag = null">
        <img :src="src" :alt="alt" :style="fullImageStyle" draggable="false" @load="loaded" @error="error = '完整图片加载失败，请关闭后重试'" />
      </div>
    </dialog>
  </Teleport>
</template>

<style scoped>
@reference "../assets/css/style.css";
.big-image-trigger {
  @apply relative;
  isolation: isolate;
  @apply flex;
  @apply items-center;
  @apply justify-center;
  @apply w-[100%];
  @apply h-[100%];
  @apply min-h-[80px];
  @apply p-[0];
  @apply [border:0];
  background: transparent;
  cursor: zoom-in;
  @apply overflow-hidden
}
.big-image-trigger:disabled {
  cursor: default
}
.big-image-trigger>img {
  @apply w-[100%];
  @apply h-[100%];
  @apply object-contain;
  @apply block
}
.image-hint {
  @apply absolute;
  @apply z-[2];
  @apply right-[10px];
  @apply bottom-[10px];
  pointer-events: none;
  @apply whitespace-nowrap;
  @apply leading-[1.4];
  @apply [border:1px_solid_#c5d5d6];
  @apply flex;
  @apply gap-[5px];
  @apply items-center;
  @apply [padding:5px_8px];
  @apply rounded-[1px];
  @apply text-[11px];
  background: #ffffffea;
  color: #145f65;
  box-shadow: 0 2px 10px #0001
}
.image-unavailable {
  color: var(--muted,#6b7280);
  @apply text-[13px]
}
.big-image-dialog {
  @apply w-[min(1100px,94vw)];
  @apply max-w-[94vw];
  @apply m-[auto];
  @apply p-[0];
  @apply [border:1px_solid_var(--border,#e5e7eb)];
  @apply rounded-[2px];
  background: var(--card,#fff);
  color: var(--text,#374151);
  box-shadow: 0 25px 80px #0005
}
.big-image-dialog::backdrop {
  background: #10101caa;
  backdrop-filter: blur(3px)
}
header {
  @apply flex;
  @apply items-center;
  @apply justify-between;
  @apply [padding:18px_20px];
  @apply [border-bottom:1px_solid_var(--border,#e5e7eb)]
}
header strong {
  @apply text-[16px];
  color: var(--title,#111827)
}
header p {
  @apply [margin:4px_0_0];
  @apply text-[12px];
  color: var(--muted,#6b7280)
}
header button,.image-tools button {
  @apply [border:1px_solid_var(--border,#e5e7eb)];
  background: var(--card,#fff);
  color: inherit;
  @apply rounded-[1px];
  cursor: pointer;
  @apply inline-flex;
  @apply items-center;
  @apply justify-center;
  @apply [padding:7px_10px]
}
header button {
  @apply p-[7px]
}
.image-tools {
  @apply flex;
  @apply items-center;
  @apply gap-[7px];
  @apply flex-wrap;
  @apply [padding:12px_20px];
  @apply text-[12px]
}
.image-tools span {
  @apply ml-[4px];
  color: var(--muted,#6b7280)
}
.image-tools a {
  @apply inline-flex;
  @apply gap-[6px];
  @apply items-center;
  @apply ml-[auto];
  color: var(--primary,#145f65);
  text-decoration: none
}
.image-viewport {
  @apply h-[min(67vh,720px)];
  @apply overflow-auto;
  background: repeating-conic-gradient(#e5e7eb 0% 25%,#f9fafb 0% 50%) 50% / 18px 18px;
  cursor: grab;
  touch-action: none;
  overscroll-behavior: contain
}
.image-viewport:active {
  cursor: grabbing
}
.image-viewport img {
  @apply block;
  @apply max-w-[none];
  @apply max-h-[none];
  @apply object-contain;
  @apply m-[auto];
  user-select: none
}
.image-error {
  @apply [padding:0_20px];
  color: #dc2626;
  @apply text-[12px]
}
button:focus-visible,a:focus-visible {
  outline: 3px solid #438e93;
  outline-offset: 2px
}@media(max-width:600px){
header {
  @apply p-[13px]
}
.image-tools {
  @apply p-[10px]
}
.image-tools a {
  @apply ml-[0]
}
.image-viewport {
  @apply h-[62vh]
}}
/* Long names remain readable within the existing layout. */
header { @apply gap-[12px]; } header>div { @apply min-w-0; flex: 1; } header strong { @apply block wrap-anywhere; } header>button { flex: none; }
</style>
