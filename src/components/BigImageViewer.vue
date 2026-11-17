<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue'
import { Download, Maximize2, Minus, Plus, X } from 'lucide-vue-next'
import { DesignImages } from '../core/design-images'

defineOptions({ inheritAttrs: false })
const props = withDefaults(defineProps<{ src: string; previewSrc?: string; alt: string; eager?: boolean; buttonOnly?: boolean; description?: string; resetKey?: number; downloadLabel?: string }>(), { previewSrc: '', eager: false, buttonOnly: false, description: '', downloadLabel: '下载完整图片' })
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
  if (props.src && !props.previewSrc && !props.buttonOnly) {
    try { const url = await DesignImages.thumbnail(props.src); if (revision === thumbnailRevision) thumbnail.value = url }
    catch { /* The original remains available when thumbnail creation is unavailable. */ }
  }
}, { immediate: true })
watch(() => props.resetKey, () => { if(opened.value)close() })
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
  <button v-bind="$attrs" ref="trigger" type="button" class="big-image-trigger" :class="{'button-only':buttonOnly}" :disabled="!src" :aria-label="`放大查看${alt}`" :title="description || '点击查看完整分辨率'" @click="open">
    <template v-if="buttonOnly"><Maximize2 :size="13"/>放大查看</template><img v-else-if="src" :src="previewSrc || thumbnail || src" :alt="alt" :loading="eager ? 'eager' : 'lazy'" />
    <span v-else class="image-unavailable">图片不可用</span>
    <span v-if="src&&!buttonOnly" class="image-hint"><Maximize2 :size="13" />放大查看</span>
  </button>
  <Teleport to="body">
    <dialog v-if="opened" ref="dialog" class="big-image-dialog dilong-theme" :aria-label="alt" @cancel.prevent="close" @click="event => { if (event.target === event.currentTarget) close() }">
      <header><div><strong>{{ alt }}</strong><p>{{description || '完整分辨率查看；支持缩放、拖动或滚动，按 Esc 关闭。'}}</p></div><button type="button" aria-label="关闭大图" @click="close"><X :size="20" /></button></header>
      <div class="image-tools">
        <button type="button" @click="setZoom(null)">适应窗口</button><button type="button" @click="setZoom(1)">100%</button>
        <button type="button" aria-label="缩小图片" @click="setZoom(scale * .8)"><Minus :size="16" /></button><button type="button" aria-label="放大图片" @click="setZoom(scale * 1.25)"><Plus :size="16" /></button>
        <span aria-live="polite">{{ size ? `${size.width} × ${size.height} · ${Math.round(scale * 100)}%` : '正在加载完整图片' }}</span>
        <a :href="src" :download="`${alt || '设计结果'}.png`" @click="download"><Download :size="15" />{{downloadLabel}}</a>
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
  @apply relative flex items-center justify-center w-full h-full min-h-[80px] p-0 border-0 overflow-hidden;
  isolation: isolate;
  background: transparent;
  cursor: zoom-in;
}
.big-image-trigger:disabled { cursor: default; }
.big-image-trigger>img { @apply w-full h-full object-contain block; }
.image-hint {
  @apply absolute z-[2] right-[10px] bottom-[10px] whitespace-nowrap flex gap-[5px] items-center px-2 py-[5px] text-[13px] leading-[1.4];
  pointer-events: none;
  border: .5px solid var(--dl-border);
  border-radius: var(--dsw-radius-sm, 8px);
  background: var(--dl-surface);
  color: var(--dl-text);
  box-shadow: var(--dl-shadow);
}
.image-unavailable { color: var(--dl-muted); font-size: 14px; }
.big-image-dialog {
  @apply w-[min(1100px,94vw)] max-w-[94vw] m-auto p-0;
  border: 0;
  border-radius: var(--dsw-radius-panel, 28px);
  background: var(--dl-surface);
  color: var(--dl-text);
  box-shadow: var(--dl-shadow);
  font-family: var(--dl-font);
  overflow: hidden;
}
.big-image-dialog::backdrop { background: var(--dl-mask); backdrop-filter: none; }
header {
  @apply flex items-center justify-between gap-3 px-5 py-[18px];
  border-bottom: .5px solid var(--dl-border);
}
header>div { min-width: 0; flex: 1; }
header strong { @apply block text-[16px] font-semibold wrap-anywhere; color: var(--dl-text); }
header p { @apply mt-1 mb-0 text-[13px] leading-[1.6]; color: var(--dl-muted); }
header button,.image-tools button {
  @apply inline-flex items-center justify-center px-[10px] py-[6px] text-[14px];
  min-height: 32px;
  border: .5px solid var(--dl-border);
  border-radius: var(--dsw-radius-md, 12px);
  background: var(--dl-surface);
  color: var(--dl-text);
  font: inherit;
  cursor: pointer;
}
header button { @apply p-[7px]; width: 36px; height: 36px; flex: none; }
.image-tools { @apply flex items-center gap-[7px] flex-wrap px-5 py-3 text-[13px]; }
.image-tools span { margin-left: 4px; color: var(--dl-muted); font-variant-numeric: tabular-nums; }
.image-tools a { @apply inline-flex gap-[6px] items-center ml-auto; color: var(--dl-accent); text-decoration: none; }
.image-viewport {
  @apply h-[min(67vh,720px)] overflow-auto;
  background: repeating-conic-gradient(var(--dl-border) 0% 25%,var(--dl-inset) 0% 50%) 50% / 18px 18px;
  cursor: grab;
  touch-action: none;
  overscroll-behavior: contain;
}
.image-viewport:active { cursor: grabbing; }
.image-viewport img { @apply block max-w-none max-h-none object-contain m-auto; user-select: none; }
.image-error { @apply px-5 text-[13px] leading-[1.6]; color: var(--dl-danger); }
button:focus-visible,a:focus-visible,.image-viewport:focus-visible {
  outline: 2px solid var(--dl-accent);
  outline-offset: 2px;
}
.button-only {
  @apply w-auto h-auto min-h-[32px] px-[10px] py-[6px] gap-[6px] text-[14px];
  border: .5px solid var(--dl-border);
  border-radius: var(--dsw-radius-md, 12px);
  background: var(--dl-surface);
  color: var(--dl-text);
}
@media (hover: hover) {
  header button:hover,.image-tools button:hover,.button-only:hover { background: var(--dl-hover); border-color: var(--dl-border-strong); }
  .image-tools a:hover { text-decoration: underline; text-underline-offset: 3px; }
}
@media(max-width:600px) {
  header { padding: 13px; }
  .image-tools { padding: 10px; }
  .image-tools a { margin-left: 0; }
  .image-viewport { height: 62vh; }
}
</style>
