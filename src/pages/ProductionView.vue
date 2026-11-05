<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, shallowRef, watch } from 'vue'
import { Download, ScanLine, SlidersHorizontal, Layers, Columns2, Activity, LoaderCircle, X, Info, ArrowLeftRight, RotateCcw, ChevronRight, Check } from 'lucide-vue-next'
import Panel from '../components/Panel.vue'
import ProductionSource, { type ProductionAsset, type Point } from '../components/ProductionSource.vue'
import { CompareCore } from '../core/production-compare-core'
import { assetUrl } from '../core/sample-library'
import type { ComparisonResult, PixelImage } from '../core/types'
import { createProductionReport, productionBias } from '../core/production-report'

type AnalyzedResult = ComparisonResult & { createdAt: string; quads: Point[][]; referenceUrl: string; actualUrl: string }
type MetricKind = 'delta' | 'rgb' | 'ssim' | 'bias'
interface LocalInspection { x: number; y: number; value: number | null; count: number; referenceRgb: number[]; actualRgb: number[]; referenceLab: number[]; actualLab: number[] }
const sources = shallowRef<[ProductionAsset | null, ProductionAsset | null]>([null, null])
const loading = ref<[boolean, boolean]>([false, false]), quad = ref<Point[]>(fullQuad())
const result = shallowRef<AnalyzedResult | null>(null), mode = ref<'pair' | 'overlay' | 'heat'>('pair')
const threshold = ref(5), opacity = ref(50), busy = ref(false), error = ref(''), progress = ref(0), phase = ref('准备图像')
const sampleName = ref(''), batch = ref(''), review = ref('未判定'), notes = ref(''), local = shallowRef<LocalInspection | null>(null)
const metricDetail = ref<MetricKind | null>(null), metricDialog = ref<HTMLDialogElement>()
const sourceVersions = [0, 0]
let controller: AbortController | null = null, generation = 0, alive = true
function fullQuad(): Point[] { return [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }, { x: 0, y: 1 }] }
const clamp = (value: number, low: number, high: number) => Math.max(low, Math.min(high, value))
const ready = computed(() => sources.value.every(Boolean) && !loading.value.some(Boolean))
const selectionBlocked = computed(() => busy.value || loading.value.some(Boolean))
const completedAt = computed(() => result.value ? new Date(result.value.createdAt).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai', hour12: false }) : '')
const changedArea = computed(() => {
  const current = result.value
  if (!current) return null
  let count = 0
  for (let index = 0; index < current.deltaMap.length; index++) if (current.validMask[index] && current.deltaMap[index]! > threshold.value) count++
  return { count, percent: count / current.validCount * 100 }
})
const plannedBounds = computed(() => { try { return sources.value[0] ? CompareCore.comparisonBounds(sources.value[0].pixels, quad.value) : null } catch { return null } })
const bias = computed(() => result.value ? productionBias(result.value) : '等待分析')
const marker = computed(() => local.value && result.value ? { left: ((local.value.x + .5) / result.value.width * 100) + '%', top: ((local.value.y + .5) / result.value.height * 100) + '%' } : undefined)
const signed = (value: number) => (value > 0 ? '+' : '') + value.toFixed(2)
function canvasUrl(image: PixelImage) {
  const canvas = document.createElement('canvas'); canvas.width = image.width; canvas.height = image.height
  const context = canvas.getContext('2d'); if (!context) throw new Error('浏览器无法建立图像画布。')
  context.putImageData(new ImageData(new Uint8ClampedArray(image.data), image.width, image.height), 0, 0)
  const url = canvas.toDataURL('image/png'); canvas.width = canvas.height = 0; return url
}
const heatmap = computed(() => {
  const current = result.value
  if (!current) return ''
  const data = new Uint8ClampedArray(current.reference.data), delta = current.previewDeltaMap, valid = current.previewValidMask
  for (let pixel = 0; pixel < delta.length; pixel++) {
    if (!valid[pixel]) { data[pixel * 4 + 3] = 0; continue }
    const ratio = clamp(delta[pixel]! / (threshold.value * 2), 0, 1)
    const lower = ratio <= .5 ? [39, 104, 112] : [240, 194, 81], upper = ratio <= .5 ? [240, 194, 81] : [197, 69, 46]
    const position = ratio <= .5 ? ratio * 2 : (ratio - .5) * 2, blend = .2 + .65 * Math.min(1, ratio * 2)
    for (let channel = 0; channel < 3; channel++) data[pixel * 4 + channel] = data[pixel * 4 + channel]! * (1 - blend) + (lower[channel]! + (upper[channel]! - lower[channel]!) * position) * blend
  }
  return canvasUrl({ width: current.reference.width, height: current.reference.height, data })
})
function invalidate() {
  generation++; controller?.abort(); controller = null; busy.value = false; result.value = null; local.value = null
  progress.value = 0; error.value = ''; mode.value = 'pair'; review.value = '未判定'; metricDetail.value = null
}
function changeQuad(value: Point[]) { if (selectionBlocked.value) return; invalidate(); quad.value = value.map(point => ({ ...point })) }
function resetQuads() { changeQuad(fullQuad()) }
function decode(url: string, name: string, example = false): Promise<ProductionAsset> {
  return new Promise((resolve, reject) => {
    const image = new Image()
    image.onload = () => {
      try {
        if (image.naturalWidth * image.naturalHeight > 40_000_000) throw new Error('图片超过4000万像素，请先缩小后再上传。')
        const canvas = document.createElement('canvas'); canvas.width = image.naturalWidth; canvas.height = image.naturalHeight
        const context = canvas.getContext('2d', { willReadFrequently: true }); if (!context) throw new Error('无法读取图像画布。')
        context.drawImage(image, 0, 0)
        const pixels = context.getImageData(0, 0, canvas.width, canvas.height), originalUrl = canvas.toDataURL('image/png')
        const scale = Math.min(1, 2048 / Math.max(canvas.width, canvas.height)), preview = document.createElement('canvas')
        preview.width = Math.max(1, Math.round(canvas.width * scale)); preview.height = Math.max(1, Math.round(canvas.height * scale))
        const previewContext = preview.getContext('2d'); if (!previewContext) throw new Error('无法生成图像预览。')
        previewContext.drawImage(canvas, 0, 0, preview.width, preview.height)
        const previewUrl = preview.toDataURL('image/png')
        if (!previewUrl.startsWith('data:image/')) throw new Error('浏览器无法读取这张图片的完整尺寸，请使用尺寸更小的图片。')
        resolve({ name, originalUrl, preview: previewUrl, pixels: { width: pixels.width, height: pixels.height, data: pixels.data }, width: image.naturalWidth, height: image.naturalHeight, example })
        canvas.width = canvas.height = preview.width = preview.height = 0
      } catch (failure) { reject(failure) }
    }
    image.onerror = () => reject(new Error('图片无法读取，请使用有效的 JPG、PNG 或 WebP 图片。')); image.src = url
  })
}
async function upload(file: File, index: 0 | 1) {
  if (selectionBlocked.value) return
  invalidate(); const token = ++sourceVersions[index]!
  const next: [ProductionAsset | null, ProductionAsset | null] = [...sources.value]; next[index] = null; sources.value = next; quad.value = fullQuad()
  if (!/\.(png|jpe?g|webp)$/i.test(file.name)) { error.value = '请选择 JPG、PNG 或 WebP 图片。'; return }
  if (file.size > 30 * 1024 * 1024) { error.value = '图片超过30 MB，请先压缩后再上传。'; return }
  loading.value[index] = true; const url = URL.createObjectURL(file)
  try {
    const asset = await decode(url, file.name)
    if (!alive || token !== sourceVersions[index]) return
    const assets: [ProductionAsset | null, ProductionAsset | null] = [...sources.value]; assets[index] = asset; sources.value = assets
    if (sampleName.value === '浅橡木演示样本') sampleName.value = ''
    if (batch.value === 'DEMO-01') batch.value = ''
    if (notes.value === demoNotes) notes.value = ''
  } catch (failure) { if (alive && token === sourceVersions[index]) error.value = (index === 0 ? '设计原图' : '生产实物') + '读取失败：' + (failure instanceof Error ? failure.message : '读取失败') + ' 请重新选择有效图片后再分析。' }
  finally { URL.revokeObjectURL(url); if (alive && token === sourceVersions[index]) loading.value[index] = false }
}
const demoNotes = '演示实物图由原图模拟偏色与局部变化生成，所有比对指标均根据图片实际计算。'
async function loadDemo() {
  if (selectionBlocked.value) return
  invalidate(); sources.value = [null, null]; quad.value = fullQuad(); const tokens = [++sourceVersions[0]!, ++sourceVersions[1]!]; loading.value = [true, true]
  try {
    const first = await decode(assetUrl('sample-oak.png'), '浅橡木设计原图（演示）', true), data = new Uint8ClampedArray(first.pixels.data)
    for (let index = 0; index < data.length; index += 4) { data[index] = data[index]! * .94 + 7; data[index + 1] = data[index + 1]! * .91; data[index + 2] = data[index + 2]! * .88 }
    const canvas = document.createElement('canvas'); canvas.width = first.width; canvas.height = first.height
    const context = canvas.getContext('2d')!; context.putImageData(new ImageData(data, first.width, first.height), 0, 0)
    context.fillStyle = 'rgba(105,65,30,.19)'; context.fillRect(first.width * .57, first.height * .28, first.width * .18, first.height * .28)
    const actual = await decode(canvas.toDataURL('image/png'), '模拟生产样品（演示偏色与局部变化）', true); canvas.width = canvas.height = 0
    if (!alive || tokens.some((token, index) => token !== sourceVersions[index])) return
    sources.value = [first, actual]; sampleName.value = '浅橡木演示样本'; batch.value = 'DEMO-01'; notes.value = demoNotes
  } catch (failure) { if (alive) error.value = failure instanceof Error ? failure.message : '演示图读取失败。' }
  finally { if (alive) loading.value = loading.value.map((value, index) => tokens[index] === sourceVersions[index] ? false : value) as [boolean, boolean] }
}
async function analyze() {
  if (!ready.value || selectionBlocked.value) return
  if (!CompareCore.validateQuad(quad.value)) { error.value = '选区范围过小或尚未选完，请重新选择矩形区域。'; return }
  const first = sources.value[0]!, second = sources.value[1]!, selected = quad.value.map(point => ({ ...point })), token = ++generation
  controller = new AbortController(); const current = controller
  busy.value = true; error.value = ''; result.value = null; local.value = null; progress.value = 0; phase.value = '准备图像'; review.value = '未判定'; metricDetail.value = null
  try {
    await new Promise(resolve => setTimeout(resolve, 40))
    const comparison = await CompareCore.compareRegions(first.pixels, second.pixels, selected, { threshold: threshold.value, signal: current.signal, shouldCancel: () => current.signal.aborted || !alive || token !== generation,
      onProgress: value => { if (token !== generation) return; progress.value = Math.round(value.fraction * 100); phase.value = ({ pixels: '逐像素比较颜色与纹理', preview: '生成可视化', complete: '计算完成', percentile: '计算色差分布' } as Record<string, string>)[value.phase] || '正在分析图像' } })
    if (!alive || token !== generation) return
    result.value = { ...comparison, createdAt: new Date().toISOString(), quads: [selected, selected.map(point => ({ ...point }))], referenceUrl: canvasUrl(comparison.reference), actualUrl: canvasUrl(comparison.actual) }
    progress.value = 100; mode.value = 'pair'
  } catch (failure) { if (token === generation && alive) error.value = failure instanceof Error && failure.name === 'AbortError' ? '计算已取消，可以重新分析。' : failure instanceof Error ? failure.message : '分析失败，请检查图片和选区。' }
  finally { if (token === generation) { busy.value = false; controller = null } }
}
function cancelAnalysis() { controller?.abort() }
function actualPixel(actual: PixelImage, reference: PixelImage, x: number, y: number): number[] {
  if (actual.width === reference.width && actual.height === reference.height) return Array.from(actual.data.slice((y * actual.width + x) * 4, (y * actual.width + x) * 4 + 4))
  const sx = clamp((x + .5) * actual.width / reference.width - .5, 0, actual.width - 1), sy = clamp((y + .5) * actual.height / reference.height - .5, 0, actual.height - 1)
  const x0 = Math.floor(sx), y0 = Math.floor(sy), fx = sx - x0, fy = sy - y0, x1 = Math.min(x0 + 1, actual.width - 1), y1 = Math.min(y0 + 1, actual.height - 1)
  const indices = [(y0 * actual.width + x0) * 4, (y0 * actual.width + x1) * 4, (y1 * actual.width + x0) * 4, (y1 * actual.width + x1) * 4]
  return Array.from(new Uint8ClampedArray([0, 1, 2, 3].map(channel => (actual.data[indices[0]! + channel]! * (1 - fx) + actual.data[indices[1]! + channel]! * fx) * (1 - fy) + (actual.data[indices[2]! + channel]! * (1 - fx) + actual.data[indices[3]! + channel]! * fx) * fy)))
}
function inspect(event: MouseEvent) {
  const current = result.value, first = sources.value[0], second = sources.value[1]
  if (!current || !first || !second) return
  const box = (event.currentTarget as HTMLElement).getBoundingClientRect(), x = clamp(Math.floor((event.clientX - box.left) / box.width * current.width), 0, current.width - 1), y = clamp(Math.floor((event.clientY - box.top) / box.height * current.height), 0, current.height - 1)
  let sum = 0, count = 0
  const refRgb = [0, 0, 0], actRgb = [0, 0, 0], refLab = [0, 0, 0], actLab = [0, 0, 0]
  for (let row = Math.max(0, y - 7); row <= Math.min(current.height - 1, y + 7); row++) for (let column = Math.max(0, x - 7); column <= Math.min(current.width - 1, x + 7); column++) {
    const index = row * current.width + column
    if (!current.validMask[index]) continue
    sum += current.deltaMap[index]!; count++
    const sourceX = current.bounds.left + column, sourceY = current.bounds.top + row, start = (sourceY * first.width + sourceX) * 4
    const reference = Array.from(first.pixels.data.slice(start, start + 3)), actual = actualPixel(second.pixels, first.pixels, sourceX, sourceY)
    const firstLab = CompareCore.rgbToLab(reference[0]!, reference[1]!, reference[2]!), secondLab = CompareCore.rgbToLab(actual[0]!, actual[1]!, actual[2]!)
    for (let channel = 0; channel < 3; channel++) { refRgb[channel] = refRgb[channel]! + reference[channel]!; actRgb[channel] = actRgb[channel]! + actual[channel]!; refLab[channel] = refLab[channel]! + firstLab[channel]!; actLab[channel] = actLab[channel]! + secondLab[channel]! }
  }
  local.value = { x, y, value: count ? sum / count : null, count, referenceRgb: refRgb.map(value => value / Math.max(1, count)), actualRgb: actRgb.map(value => value / Math.max(1, count)), referenceLab: refLab.map(value => value / Math.max(1, count)), actualLab: actLab.map(value => value / Math.max(1, count)) }
}
function exportResult() {
  const current = result.value, first = sources.value[0], second = sources.value[1]
  if (!current || !first || !second || busy.value) return
  const html = createProductionReport({ result: current, sources: [first, second], sample: sampleName.value, batch: batch.value, review: review.value, notes: notes.value, threshold: threshold.value, area: changedArea.value!.percent, heatUrl: heatmap.value })
  const url = URL.createObjectURL(new Blob([html], { type: 'text/html;charset=utf-8' })), link = document.createElement('a')
  link.href = url; link.download = (sampleName.value || '生产比对').replace(/[<>:"/\\|?*\u0000-\u001f]/g, '_') + '_比对报告.html'; link.click(); setTimeout(() => URL.revokeObjectURL(url), 30000)
}
const metricLabels: Record<MetricKind, string> = { delta: '颜色偏差 · ΔE00', rgb: '图像偏差 · RGB', ssim: '纹理结构 · SSIM', bias: '平均偏色方向' }
const formulas: Record<MetricKind, string> = {
  delta: 'ΔE00ᵢ = √[(ΔL′/S_L)² + (ΔC′/S_C)² + (ΔH′/S_H)² + R_T(ΔC′/S_C)(ΔH′/S_H)]\n平均 ΔE00 = ΣΔE00ᵢ / N\n\nP95：N个有效色差升序排列为 d[0]…d[N−1]\nq = 0.95(N−1)，k = floor(q)\nP95 = d[k] + (q−k)(d[min(k+1,N−1)]−d[k])',
  rgb: 'dᵢ = √[(R实物ᵢ−R设计ᵢ)²+(G实物ᵢ−G设计ᵢ)²+(B实物ᵢ−B设计ᵢ)²] / √3\nRGB 平均偏差 = Σdᵢ / N',
  ssim: 'Y = 0.2126R + 0.7152G + 0.0722B\nμx = Σx / 49；μy = Σy / 49\nσx² = Σ(x−μx)² / 48；σy² = Σ(y−μy)² / 48\nσxy = Σ[(x−μx)(y−μy)] / 48\n\nSSIM窗口 = [(2μxμy+C₁)(2σxy+C₂)] / [(μx²+μy²+C₁)(σx²+σy²+C₂)]\nC₁ = (0.01×255)²；C₂ = (0.03×255)²\n本次 SSIM = 所有有效窗口 SSIM 的总和 / M',
  bias: '平均 ΔL* = Σ(L*实物ᵢ−L*设计ᵢ) / N\n平均 Δa* = Σ(a*实物ᵢ−a*设计ᵢ) / N\n平均 Δb* = Σ(b*实物ᵢ−b*设计ᵢ) / N',
}
const metricText: Record<MetricKind, string> = {
  delta: '两图对应像素先从 sRGB 转为 Lab，按 CIEDE2000 计算色差，kL、kC、kH 均为1。数值越小颜色越接近。P95 表示约95%的有效像素不超过该值。热图阈值不会改变平均色差或P95。',
  rgb: '先算每个有效像素的RGB距离，再取平均；不是先取整张图的平均颜色。范围0—255，0表示有效位置RGB完全一致。与配墨页合成偏差采用相同距离公式。',
  ssim: '灰度直接由0—255的RGB加权，不先做sRGB线性化。比较完整有效的7×7窗口，步长1，含无效像素的窗口跳过，边缘不补像素。越接近1结构越相似；光照和位置偏移也会影响。',
  bias: '逐像素计算实物减设计，再对三个方向分别取平均。ΔL*正数偏亮/负数偏暗；Δa*正数偏红/负数偏绿；Δb*正数偏黄/负数偏蓝。绝对值达到0.5才显示方向文字，数值仍全部展示。不同位置的正负偏差可能抵消。',
}
const labFormula = 'v = RGB通道值 / 255\nc = v / 12.92（v ≤ 0.04045）\nc = ((v+0.055)/1.055)^2.4（其他情况）\nX = 0.4124564r+0.3575761g+0.1804375b\nY = 0.2126729r+0.7151522g+0.0721750b\nZ = 0.0193339r+0.1191920g+0.9503041b\nx = X/0.95047；y = Y；z = Z/1.08883\nf(t)=∛t（t>216/24389），否则 f(t)=((24389/27)t+16)/116\nL*=116f(y)−16；a*=500(f(x)−f(y))；b*=200(f(y)−f(z))\nr、g、b为线性化后的sRGB通道，白点D65；不自动调色或归一化亮度。'
const deltaFormula = 'j=1设计，2实物；角度单位为度\nCⱼ=√(aⱼ²+bⱼ²)，C̄=(C₁+C₂)/2\nG=0.5[1−√(C̄⁷/(C̄⁷+25⁷))]\na′ⱼ=(1+G)aⱼ，C′ⱼ=√(a′ⱼ²+bⱼ²)\nh′ⱼ=atan2(bⱼ,a′ⱼ)，归一到[0°,360°)，C′ⱼ=0时为0\nΔL′=L₂−L₁；ΔC′=C′₂−C′₁\nΔh′=h′₂−h′₁，调整到[−180°,180°]，C′₁C′₂=0时取0\nΔH′=2√(C′₁C′₂)sin(Δh′/2)\nL̄′=(L₁+L₂)/2；C̄′=(C′₁+C′₂)/2\nh̄′=h′₁+h′₂（C′₁C′₂=0）；否则按色相差≤180°取均值\n色相差>180°且色相和<360°时加360°后取均值，否则减360°后取均值\nT=1−0.17cos(h̄′−30°)+0.24cos(2h̄′)+0.32cos(3h̄′+6°)−0.20cos(4h̄′−63°)\nS_L=1+0.015(L̄′−50)²/√(20+(L̄′−50)²)\nS_C=1+0.045C̄′；S_H=1+0.015C̄′T\nR_C=2√(C̄′⁷/(C̄′⁷+25⁷))；θ=30°exp(−((h̄′−275°)/25°)²)\nR_T=−R_C sin(2θ)'
watch(metricDetail, async value => { await nextTick(); if (value && metricDialog.value && !metricDialog.value.open) metricDialog.value.showModal(); else if (!value && metricDialog.value?.open) metricDialog.value.close() })
onMounted(() => { void loadDemo() })
onBeforeUnmount(() => { alive = false; generation++; sourceVersions[0] = sourceVersions[0]! + 1; sourceVersions[1] = sourceVersions[1]! + 1; controller?.abort() })
</script>
<template><div class="production-page production-compare embedded-module"><div class="workspace"><div class="breadcrumb">生产比对工作台 <ChevronRight/> 新建比对任务</div><div class="page-heading"><div><h1>设计与实物还原评估</h1><p>对照设计预期，查看生产样品的颜色与纹理差异。</p></div><button class="btn btn-primary export-button" :disabled="!result || busy" @click="exportResult"><Download :size="16"/>导出比对报告</button></div>
<div class="pc-task-fields"><label class="pc-field">样品名称<input v-model="sampleName" class="form-control" placeholder="输入样品名称" maxlength="100"/></label><label class="pc-field">生产批次<input v-model="batch" class="form-control" placeholder="填写实际批次（可选）" maxlength="100"/></label></div>
<section class="summary-strip pc-summary"><div><span>任务状态</span><strong :class="result?'ready':'pending'">{{busy?'正在分析…':error?'分析失败':result?'分析完成':'待确认对齐'}}</strong></div><div><span>平均图像色差 ΔE00</span><strong>{{result?.meanDeltaE.toFixed(2) ?? '—'}}</strong></div><div><span>RGB 平均偏差</span><strong>{{result?.meanRgbDifference.toFixed(2) ?? '—'}}</strong></div><div><span>纹理结构 SSIM</span><strong>{{result?(result.ssim*100).toFixed(1)+'%':'—'}}</strong></div><div><span>平均偏色方向</span><strong>{{result?bias:'—'}}</strong></div><div><span>人工结论</span><strong>{{result?review:'—'}}</strong></div></section>
<div v-if="sources.some(source=>source?.example)" class="pc-example-note">当前包含演示样本：示例生产图含模拟偏色与局部变化，指标根据当前两图实际计算。上传真实图片可开始自己的比对。</div><section class="pc-link-bar" aria-label="选区联动设置"><strong>选区自动同步</strong><span>位置已同步，请核对是否为同一处纹理。联动按相同比例位置同步，请在设计原图上框选。</span></section><section v-if="plannedBounds && sources[0]" class="pc-resolution-note selection-summary"><strong>原始分辨率比较</strong><p>设计原图 {{sources[0].width}} × {{sources[0].height}}；本次选区 {{plannedBounds.width}} × {{plannedBounds.height}}，共 {{(plannedBounds.width*plannedBounds.height).toLocaleString()}} 个像素。预览缩放不影响完整计算。</p></section>
<div class="pc-upload-grid input-grid"><ProductionSource v-for="(asset,index) in sources" :key="index" :asset="asset" :quad="quad" :side="index as 0|1" :busy="selectionBlocked" :loading="loading[index]!" @file="upload($event,index as 0|1)" @quad="changeQuad"/></div>
<section class="panel pc-comparison-panel"><header class="panel-header"><div><span class="step-no">03</span><div><h2>对齐与差异对照</h2><p>确认同一位置的纹理对应，再查看真实图像差异</p></div></div><span class="pc-badge">{{result?'已完成分析':'待确认选区'}}</span></header><div class="pc-view-body"><div class="pc-view-main"><nav class="pc-tabs view-tabs" aria-label="对比查看模式"><button :class="{active:mode==='pair'}" @click="mode='pair'" title="并排对照">并排对照</button><button :class="{active:mode==='overlay'}" :disabled="!result" @click="mode='overlay'" title="透明叠加">透明叠加</button><button :class="{active:mode==='heat'}" :disabled="!result" @click="mode='heat'" title="色差热图">色差热图</button></nav><div class="pc-viewer">
        <div v-if="result" class="result-viewer">
          <div v-if="mode==='pair'" class="comparison-stage pair-stage"><figure v-for="(url,index) in [result.referenceUrl,result.actualUrl]" :key="index"><div class="inspect-image" :style="{aspectRatio:result.width+'/'+result.height,'--image-ratio':result.width/result.height}" @click="inspect"><img :src="url" :alt="index===0?'设计图对照预览':'实物图对照预览'"><i v-if="marker" class="location-marker" :style="marker"/></div><span>{{index===0?'A · 设计原图':'B · 实物图像'}}</span></figure></div>
          <div v-else-if="mode==='overlay'" class="comparison-stage single-result"><div class="inspect-image overlay-image" :style="{aspectRatio:result.width+'/'+result.height,'--image-ratio':result.width/result.height}" @click="inspect"><img :src="result.referenceUrl" alt="叠加底图"><img :src="result.actualUrl" alt="叠加实物图" :style="{opacity:opacity/100}"><i v-if="marker" class="location-marker" :style="marker"/></div><span class="stage-badge">实物图透明度 {{opacity}}%</span></div>
          <div v-else class="comparison-stage single-result heat-stage"><div class="inspect-image" :style="{aspectRatio:result.width+'/'+result.height,'--image-ratio':result.width/result.height}" @click="inspect"><img :src="heatmap" alt="实际色差热图"><i v-if="marker" class="location-marker" :style="marker"/></div><span class="stage-badge">色差热图 · ΔE00</span></div>
        </div>
        <div v-else class="comparison-stage result-empty empty-state"><LoaderCircle v-if="busy" :size="28" class="spin"/><ScanLine v-else :size="28"/><strong>{{busy?'正在按原始分辨率计算…':'确认选区后开始分析'}}</strong><p>准备两张图，框选相同纹理的位置，确认对齐后查看结果。</p></div>
        <div v-if="mode==='overlay'" class="control-row"><label for="overlay-opacity"><SlidersHorizontal :size="14"/> 实物图透明度</label><input id="overlay-opacity" v-model.number="opacity" type="range" min="0" max="100"><strong>{{opacity}}%</strong></div>
        <div v-if="mode==='heat'" class="heat-controls"><div class="control-row"><label for="heat-threshold"><SlidersHorizontal :size="14"/> 差异阈值</label><input id="heat-threshold" v-model.number="threshold" type="range" min="1" max="20" step="0.5"><strong>{{threshold.toFixed(1)}}</strong></div><div class="heat-scale"><span>差异较小</span><i></i><span>差异较大</span></div><p class="muted">超过当前阈值的像素：<b>{{changedArea?.count.toLocaleString() ?? '—'}}</b>，占有效区域 <b>{{changedArea?.percent.toFixed(2) ?? '—'}}%</b>。</p></div>
        <p v-if="result" class="inspect-hint muted">点击图中位置，查看周围最多15 × 15个原始像素的局部平均值。</p>
        <div v-if="local" class="local-inspection" role="status"><strong>局部平均色差 {{local.value?.toFixed(2) ?? '—'}} ΔE00</strong><span>位置 {{local.x}}, {{local.y}} · {{local.count}} 个有效像素</span><template v-if="local.count"><p>设计 RGB：{{local.referenceRgb.map(v=>v.toFixed(1)).join(' / ')}}<br>实物 RGB：{{local.actualRgb.map(v=>v.toFixed(1)).join(' / ')}}</p><p>设计 Lab：{{local.referenceLab.map(v=>v.toFixed(2)).join(' / ')}}<br>实物 Lab：{{local.actualLab.map(v=>v.toFixed(2)).join(' / ')}}</p></template><p v-else>此处没有可参与比较的不透明像素。</p></div>
        <div class="visual-footer"><span class="muted">{{result ? result.width.toLocaleString()+' × '+result.height.toLocaleString()+' 原始计算网格' : '完成分析后显示对应区域'}}</span><span v-if="result" class="badge">{{result.validCount.toLocaleString()}} 有效像素</span></div>

</div></div><aside class="pc-controls"><div class="pc-control-group"><h3>比对设置</h3><p>左右查看同一纹理区域的颜色与外观；需要检查错位时切换透明叠加，查看差异位置时切换色差热图。</p></div><div class="pc-control-group"><h3>对齐操作</h3><p>在设计原图上框选，实物区域自动按相同比例同步；请核对是否为同一处纹理。</p><button class="btn btn-secondary" :disabled="selectionBlocked" @click="resetQuads"><RotateCcw :size="13"/>重置两侧选区</button></div><button v-if="!busy" class="btn btn-primary pc-run" :disabled="!ready" @click="analyze()"><Check :size="16"/>确认对齐并分析</button><button v-else class="btn btn-secondary pc-run" @click="cancelAnalysis"><X :size="16"/>取消计算</button><div v-if="busy" class="calculation-progress" role="status"><div><span>{{phase}}</span><b>{{progress}}%</b></div><progress :value="progress" max="100" aria-label="图像比对进度"/></div><p class="pc-note">没有找到对应纹理时，请重新选区。计算不自动修正光照或偏色。</p></aside></div><p v-if="error" role="alert" class="error-banner">{{error}}</p></section>
<section class="panel pc-results-panel"><header class="panel-header"><div><span class="step-no">04</span><div><h2>比对结果与人工复核</h2><p>分别观察颜色、结构与局部差异，记录本次判断</p></div></div><span class="pc-badge">辅助评估</span></header>
    <div class="pc-result-grid metric-grid">
      <button type="button" class="pc-metric comparison-metric" aria-haspopup="dialog" :aria-label="'查看'+metricLabels.delta+'的公式与本次结果'" @click="metricDetail='delta'"><span class="metric-label">平均颜色偏差 <i>ΔE00</i></span><strong>{{result?.meanDeltaE.toFixed(2) ?? '—'}}</strong><small>第95百分位 {{result?.p95DeltaE.toFixed(2) ?? '—'}}</small><small class="metric-details-link">查看公式与本次结果 ›</small></button>
      <button type="button" class="pc-metric comparison-metric" aria-haspopup="dialog" :aria-label="'查看'+metricLabels.rgb+'的公式与本次结果'" @click="metricDetail='rgb'"><span class="metric-label">图像平均偏差 <i>RGB</i></span><strong>{{result?.meanRgbDifference.toFixed(2) ?? '—'}}<em v-if="result"> / 255</em></strong><small>逐像素 RGB 距离的平均值</small><small class="metric-details-link">查看公式与本次结果 ›</small></button>
      <button type="button" class="pc-metric comparison-metric" aria-haspopup="dialog" :aria-label="'查看'+metricLabels.ssim+'的公式与本次结果'" @click="metricDetail='ssim'"><span class="metric-label">纹理结构相似度 <i>SSIM</i></span><strong>{{result ? (result.ssim*100).toFixed(1)+'%' : '—'}}</strong><small>{{result?'SSIM '+result.ssim.toFixed(4):'等待分析图像结构'}}</small><small class="metric-details-link">查看公式与本次结果 ›</small></button>
      <button type="button" class="pc-metric comparison-metric bias-metric" aria-haspopup="dialog" :aria-label="'查看'+metricLabels.bias+'的公式与本次结果'" @click="metricDetail='bias'"><span class="metric-label">平均偏色方向 <i>Lab</i></span><strong>{{bias}}</strong><small>{{result?'ΔL '+signed(result.deltaL)+' · Δa '+signed(result.deltaA)+' · Δb '+signed(result.deltaB):'比较明暗、红绿与黄蓝方向'}}</small><small class="metric-details-link">查看公式与本次结果 ›</small></button>
    </div>


<div class="pc-review-grid review-form"><label class="pc-field">人工结论<select v-model="review" class="form-control" :disabled="!result"><option>未判定</option><option>可接受</option><option>需要调整</option><option>重新打样</option></select><small>由供给油墨和工艺要求确认。</small></label><label class="pc-field">复核备注<textarea v-model="notes" class="form-control" rows="4" maxlength="4000" placeholder="记录需要调整的颜色、纹理或取样情况…"/></label></div><div class="pc-reference-note review-note"><Info :size="16"/><div><strong>图像比较参考</strong><p>当前结果未经测色校准，包含光照、设备与对齐误差的影响。超阈值区域占比表示图片差异范围，不等同于生产不合格率。</p></div></div><p v-if="completedAt" class="calculated-at muted">最近分析：{{completedAt}}</p></section><p class="pc-local-footer production-footer">图片仅在当前浏览器中处理。切换模块可继续操作，刷新页面后清空；需要留存时请导出报告。</p>
    <dialog ref="metricDialog" class="metric-dialog" aria-labelledby="metric-dialog-title" aria-describedby="metric-dialog-context" @close="metricDetail=null" @cancel="metricDetail=null"><div class="metric-dialog-heading"><h2 id="metric-dialog-title">{{metricDetail?metricLabels[metricDetail]:''}} · 计算详情</h2><button class="btn btn-secondary" aria-label="关闭指标详情" @click="metricDetail=null">关闭</button></div><div v-if="metricDetail" class="metric-dialog-body"><p id="metric-dialog-context">{{result?'本次计算网格 '+result.width+' × '+result.height+'；有效像素 N = '+result.validCount.toLocaleString()+'。':'尚未完成本次分析。确认对齐并分析后显示实际结果。'}}透明度小于250/255的对应像素不参与计算。</p><p>{{metricText[metricDetail]}}</p><pre>{{formulas[metricDetail]}}</pre><dl v-if="result" class="metric-values"><template v-if="metricDetail==='delta'"><dt>本次平均 ΔE00</dt><dd>{{result.meanDeltaE.toFixed(2)}}</dd><dt>第95百分位 ΔE00</dt><dd>{{result.p95DeltaE.toFixed(2)}}</dd></template><template v-else-if="metricDetail==='rgb'"><dt>本次 RGB 平均偏差</dt><dd>{{result.meanRgbDifference.toFixed(2)}} / 255</dd></template><template v-else-if="metricDetail==='ssim'"><dt>有效窗口 M</dt><dd>{{result.ssimWindowCount.toLocaleString()}}</dd><dt>本次 SSIM</dt><dd>{{result.ssim.toFixed(4)}}（{{(result.ssim*100).toFixed(1)}}%）</dd></template><template v-else><dt>平均 ΔL* / Δa* / Δb*</dt><dd>{{[result.deltaL,result.deltaA,result.deltaB].map(v=>signed(v)).join(' / ')}}</dd><dt>方向说明</dt><dd>{{bias}}</dd></template><dt>有效像素 N</dt><dd>{{result.validCount.toLocaleString()}}</dd></dl><details v-if="metricDetail==='delta'"><summary>查看 CIEDE2000 修正项的定义</summary><pre>{{deltaFormula}}</pre></details><details v-if="metricDetail==='delta' || metricDetail==='bias'"><summary>查看 RGB → Lab 转换公式</summary><pre>{{labFormula}}</pre></details><p v-if="result" class="muted">分析时间：{{completedAt}}（北京时间）。指标来自完整选区原始像素，预览缩放不改变结果；展示数值经过四舍五入。</p></div></dialog>
</div></div></template>
<style scoped>
@reference "../assets/css/style.css";
.selection-summary {
  @apply [border:1px_solid_var(--border)];
  background: var(--surface-2);
  @apply p-[14px];
  @apply rounded-[8px];
  @apply mt-[16px];
  @apply text-[12px]
}
.selection-summary strong {
  color: #145f65
}
.selection-summary p {
  color: var(--muted);
  @apply text-[11px];
  @apply leading-[1.7];
  @apply [margin:6px_0_0]
}
.text-link {
  @apply inline-flex;
  @apply items-center;
  @apply gap-[5px];
  @apply [border:0];
  background: none;
  color: #145f65;
  @apply text-[11px];
  cursor: pointer
}
.text-link:disabled {
  opacity: .5
}
.reset-selection {
  @apply ml-[12px]
}
.comparison-metric {
  @apply text-left;
  cursor: pointer;
  color: inherit
}
.comparison-metric:hover {
  @apply [border-color:#438e93]
}
.metric-details-link {
  color: #145f65!important
}
.result-viewer {
  @apply min-w-[0]
}
.comparison-stage.pair-stage {
  @apply h-[auto]
}
.pair-stage figure {
  @apply flex;
  @apply items-center;
  @apply justify-center;
  @apply min-h-[240px]
}
.inspect-image {
  @apply relative;
  @apply w-[min(100%,calc(320px_*_var(--image-ratio)))];
  @apply max-h-[320px];
  cursor: crosshair
}
.inspect-image>img {
  @apply block;
  @apply w-[100%];
  @apply h-[100%];
  @apply object-contain
}
.single-result {
  @apply relative;
  @apply flex;
  @apply items-center;
  @apply justify-center;
  @apply p-[12px];
  @apply h-[auto];
  @apply min-h-[260px]
}
.overlay-image>img+img {
  @apply absolute;
  @apply inset-[0]
}
.location-marker {
  @apply absolute;
  @apply w-[14px];
  @apply h-[14px];
  transform: translate(-50%,-50%);
  @apply [border:2px_solid_#fff];
  outline: 1px solid #145f65;
  @apply rounded-[50%];
  pointer-events: none
}
.inspect-hint {
  @apply text-[11px];
  @apply [margin:12px_0_0]
}
.local-inspection {
  @apply grid;
  @apply gap-[7px];
  @apply [border:1px_solid_#bfd0d1];
  background: var(--surface-2);
  @apply p-[12px];
  @apply rounded-[8px];
  @apply mt-[14px];
  @apply text-[12px]
}
.local-inspection span,.local-inspection p {
  @apply text-[11px];
  color: var(--muted);
  @apply leading-[1.7];
  @apply m-[0]
}
.result-empty {
  @apply text-center;
  @apply p-[20px]
}
.result-empty p {
  @apply text-[12px];
  @apply leading-[1.7]
}
.production-footer {
  @apply text-[11px];
  @apply leading-[1.7]
}
.metric-dialog {
  @apply w-[min(760px,calc(100vw_-_28px))];
  @apply max-h-[85vh];
  @apply overflow-auto;
  background: var(--surface);
  color: var(--text);
  @apply [border:1px_solid_var(--border)];
  @apply rounded-[12px];
  @apply p-[0]
}
.metric-dialog::backdrop {
  background: #102b2e99
}
.metric-dialog-heading {
  @apply sticky;
  @apply top-[0];
  background: var(--surface);
  @apply [padding:18px_20px];
  @apply [border-bottom:1px_solid_var(--border)];
  @apply flex;
  @apply justify-between;
  @apply items-center;
  @apply gap-[10px];
  @apply z-[1]
}
.metric-dialog-heading h2 {
  @apply text-[16px];
  @apply m-[0]
}
.metric-dialog-heading .btn {
  @apply text-[12px]
}
.metric-dialog-body {
  @apply p-[20px];
  @apply text-[13px];
  @apply leading-[1.8]
}
.metric-dialog pre {
  @apply whitespace-pre-wrap;
  @apply wrap-anywhere;
  @apply text-[11px];
  @apply [border:1px_solid_var(--border)];
  background: var(--surface-2);
  @apply rounded-[7px];
  @apply p-[12px];
  font-family: ui-monospace,monospace
}
.metric-dialog summary {
  cursor: pointer;
  color: #145f65
}
.metric-dialog details {
  @apply mt-[14px]
}
.metric-values {
  @apply grid;
  @apply grid-cols-[minmax(0,1fr)_minmax(0,1fr)];
  @apply text-[12px]
}
.metric-values dt,.metric-values dd {
  @apply p-[8px];
  @apply [border-bottom:1px_solid_var(--border)];
  @apply m-[0];
  @apply wrap-anywhere
}
.metric-values dd {
  @apply font-[600]
}
.metric-dialog-body>p:last-child {
  @apply text-[11px]
}@media(max-width:575px){
.reset-selection {
  @apply [margin:7px_0_0];
  @apply flex
}
.inspect-image {
  @apply w-[min(100%,calc(230px_*_var(--image-ratio)))];
  @apply max-h-[230px]
}
.pair-stage figure {
  @apply min-h-[230px]!;
  @apply h-[auto]!
}
.metric-dialog-body {
  @apply p-[14px]
}
.metric-dialog-heading {
  @apply p-[14px]
}
.metric-dialog-heading h2 {
  @apply text-[14px]
}}
.pc-summary {
  @apply grid-cols-[repeat(6,minmax(0,1fr))];
  @apply mt-[14px]
}
.pc-summary strong {
  @apply text-[13px]
}
.pc-task-fields .pc-field {
  @apply flex;
  @apply flex-col;
  @apply gap-[8px];
  @apply text-[12px]
}
.pc-task-fields input {
  @apply h-[40px]
}
.input-grid {
  @apply grid;
  @apply grid-cols-[repeat(2,minmax(0,1fr))];
  @apply gap-[14px]
}
.selection-summary {
  @apply rounded-[0];
  @apply mt-[14px];
  @apply [border-left:3px_solid_#145f65]
}
.selection-summary strong {
  color: #145f65
}
.pc-link-bar {
  @apply mt-[14px]
}
.production-page .workspace {
  @apply max-w-[none];
  @apply [padding:28px_30px_40px]
}
.pc-upload-grid {
  @apply [margin:14px_0]
}
.pc-viewer {
  background: #f2f6f6;
  @apply min-h-[330px]
}
.view-tabs {
  @apply flex;
  @apply items-center;
  @apply gap-[4px];
  @apply [padding:10px_12px];
  @apply [border-bottom:1px_solid_var(--line)]
}
.view-tabs button {
  @apply [padding:8px_12px];
  @apply text-[11px];
  color: #7b9294;
  background: none;
  @apply [border:1px_solid_transparent]
}
.view-tabs button.active {
  background: #e6f1f1;
  @apply [border-color:#c5ddde];
  color: #145f65;
  @apply font-[600]
}
.comparison-stage {
  background: #f2f6f6;
  @apply min-h-[300px]
}
.pair-stage {
  @apply grid;
  @apply grid-cols-[1fr_1fr];
  @apply gap-[1px]
}
.pair-stage figure {
  @apply relative;
  @apply p-[12px]
}
.pair-stage figure>span,.stage-badge {
  @apply absolute;
  @apply left-[12px];
  @apply top-[12px];
  @apply [padding:5px_8px];
  background: #ffffffdf;
  color: #45666a;
  @apply text-[10px]
}
.pair-stage figure>span {
  @apply top-[auto];
  @apply bottom-[12px]
}
.single-result {
  @apply relative
}
.inspect-image {
  @apply relative
}
.heat-stage img {
  @apply object-contain
}
.result-empty {
  @apply min-h-[320px]
}
.control-row {
  @apply flex;
  @apply items-center;
  @apply gap-[8px];
  @apply p-[14px];
  @apply text-[11px]
}
.control-row input {
  flex: 1;
  @apply min-w-[0];
  accent-color: #145f65
}
.control-row strong {
  @apply min-w-[35px]
}
.heat-scale {
  @apply flex;
  @apply gap-[8px];
  @apply items-center;
  @apply [padding:0_14px];
  @apply text-[10px];
  color: var(--muted)
}
.heat-scale i {
  @apply h-[6px];
  flex: 1;
  background: linear-gradient(90deg,#276870,#f0c251,#c5452e)
}
.heat-controls>p,.inspect-hint {
  @apply [padding:0_14px];
  @apply text-[11px];
  @apply leading-[1.8]
}
.local-inspection {
  @apply m-[14px];
  @apply rounded-[0]
}
.visual-footer {
  @apply flex;
  @apply justify-between;
  @apply gap-[8px];
  @apply flex-wrap;
  @apply [padding:10px_14px];
  @apply [border-top:1px_solid_var(--line)];
  @apply text-[10px]
}
.pc-controls .btn {
  @apply w-[100%];
  @apply text-[11px];
  @apply mt-[14px]
}
.pc-controls .pc-run {
  @apply mt-[55px]
}
.calculation-progress {
  @apply mt-[16px];
  color: #145f65;
  @apply text-[11px]
}
.calculation-progress>div {
  @apply flex;
  @apply justify-between;
  @apply gap-[8px];
  @apply mb-[8px]
}
.calculation-progress progress {
  @apply w-[100%];
  accent-color: #145f65
}
.pc-result-grid {
  @apply grid;
  @apply grid-cols-[repeat(4,minmax(0,1fr))];
  @apply gap-[12px]
}
.comparison-metric {
  @apply flex;
  @apply flex-col;
  @apply gap-[15px];
  @apply [border:1px_solid_#d5e0e1];
  background: #f5f9f9;
  @apply text-left;
  @apply min-h-[205px];
  @apply [padding:20px_16px];
  @apply min-w-[0];
  @apply justify-center
}
.metric-label {
  color: #7f979a;
  @apply text-[10px]
}
.metric-label i {
  font-style: normal
}
.comparison-metric>strong {
  @apply text-[23px];
  font-family: var(--font-mono);
  @apply font-[500];
  color: #275f65
}
.comparison-metric>small {
  @apply text-[10px];
  color: #799497;
  @apply leading-[1.8]
}
.comparison-metric em {
  @apply text-[11px];
  font-style: normal
}
.bias-metric>strong {
  @apply text-[15px];
  @apply leading-[1.7]
}
.pc-review-grid .pc-field {
  @apply flex;
  @apply flex-col;
  @apply gap-[8px];
  @apply text-[12px];
  color: #7f9699
}
.pc-review-grid textarea {
  @apply w-[100%];
  @apply min-h-[115px];
  resize: vertical
}
.pc-review-grid small {
  @apply text-[10px]
}
.calculated-at {
  @apply [padding:0_18px_14px];
  @apply text-[10px]
}
.metric-dialog {
  @apply rounded-[2px]
}
.metric-dialog pre {
  @apply rounded-[0]
}
.review-note p {
  @apply text-[10px];
  @apply [margin:8px_0_0];
  @apply leading-[1.8]
}
@media(max-width:760px){
.production-page .workspace {
  @apply [padding:20px_14px]
}
.page-heading {
  @apply flex-col;
  @apply items-start;
  @apply gap-[14px]
}
.page-heading h1 {
  @apply text-[23px]
}
.page-heading p {
  @apply leading-[1.8]
}
.pc-summary {
  @apply grid-cols-[repeat(2,minmax(0,1fr))]
}
.pc-summary>div {
  @apply [padding:14px_12px]
}
.input-grid,.pc-result-grid {
  @apply grid-cols-[1fr]
}
.pc-controls .pc-run {
  @apply mt-[14px]
}
.metric-dialog {
  @apply max-w-[calc(100vw_-_20px)]
}
.pc-task-fields {
  @apply grid-cols-[1fr]
}
.pair-stage {
  @apply grid-cols-[1fr]
}
.comparison-metric {
  @apply min-h-[160px]
}
.pc-result-grid {
  @apply gap-[8px]
}}
</style>
