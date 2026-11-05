<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, shallowRef, watch } from 'vue'
import { useRouter } from 'vue-router'
import { Download, FlaskConical, Layers3, LoaderCircle, RotateCcw, Upload, ArrowUpRight, Check, ChevronRight, Image as ImageIcon, Eye, EyeOff, Activity } from 'lucide-vue-next'
import Panel from '../components/Panel.vue'
import BigImageViewer from '../components/BigImageViewer.vue'
import { analyzeInk, renderInk, rgbToHex } from '../core/color-analysis'
import { assetUrl } from '../core/sample-library'
import type { InkLayer, InkResult } from '../core/types'
import { S } from '../services/workflows'
import type { InkRun, InkSettings, WorkflowOpenDetail } from '../services/types'
import { useWorkflowStore } from '../stores/workflow'

type InkRecipe = InkLayer['recipe']
interface InputOperation { name: string; source: string; sampleId?: string | null }
const workflow = useWorkflowStore(), router = useRouter()
const source = ref(assetUrl('sample-oak.png')), sourceName = ref('浅色橡木_样例.png')
const result = shallowRef<InkResult | null>(null), activeRun = shallowRef<InkRun | null>(null)
const selectedLayer = ref(0), enabled = ref<boolean[]>([]), weight = ref<number | string>(10)
const tab = ref<'overview' | 'detail'>('overview'), previewTab = ref<'pair' | 'layer'>('pair')
const busy = ref(false), error = ref(''), localSaveError = ref(''), dragging = ref(false), settingsSaving = ref(false)
const fileInput = ref<HTMLInputElement>()
let request = 0, settingsSaveVersion = 0, restoring = false
const ingredients: Array<{ key: keyof InkRecipe; label: string; color: string }> = [
  { key: 'red', label: '红墨', color: '#b7322c' }, { key: 'yellow', label: '黄墨', color: '#d6a51e' },
  { key: 'blue', label: '蓝墨', color: '#325d81' }, { key: 'black', label: '黑墨', color: '#33393b' },
  { key: 'thinner', label: '稀释剂', color: '#cbd2d2' },
]
const activeLayer = computed(() => result.value?.layers[selectedLayer.value] ?? null)
const activeCount = computed(() => enabled.value.filter(Boolean).length)
const aggregateHex = computed(() => {
  const layers = result.value?.layers
  if (!layers?.length) return '—'
  const total = layers.reduce((sum, layer) => sum + layer.share, 0) || 1
  return rgbToHex({
    r: layers.reduce((sum, layer) => sum + layer.rgb.r * layer.share, 0) / total,
    g: layers.reduce((sum, layer) => sum + layer.rgb.g * layer.share, 0) / total,
    b: layers.reduce((sum, layer) => sum + layer.rgb.b * layer.share, 0) / total,
  })
})
const validWeight = computed(() => Number.isFinite(Number(weight.value)) && Number(weight.value) >= .5 && Number(weight.value) <= 500)
const reconstructed = computed(() => result.value ? renderInk(result.value.renderModel, enabled.value) : '')
const difference = computed(() => result.value ? S.layerDifference(result.value.renderModel, enabled.value) : null)
const warnings = computed(() => result.value ? S.inkWarnings(result.value.layers) : [])
const recordDeleted = computed(() => { void workflow.tick; return !!activeRun.value && S.deletedHistory.inkRuns.has(activeRun.value.id) })
const recordConflict = computed(() => { void workflow.tick; return !!activeRun.value && S.hasInkConflict(activeRun.value.id) })
const recordStatus = computed(() => { void workflow.tick; return S.inkRecordStatus?.id === activeRun.value?.id ? S.inkRecordStatus : null })
const analysisDate = computed(() => new Date(activeRun.value?.createdAt || Date.now()).toLocaleString('zh-CN'))
function settings(): InkSettings { return { weight: Number(weight.value), enabled: [...enabled.value], selectedLayer: selectedLayer.value, tab: tab.value } }
function clearResult() {
  request++; settingsSaveVersion++; settingsSaving.value = false; activeRun.value = null; result.value = null; enabled.value = []
  busy.value = false; error.value = ''; localSaveError.value = ''; selectedLayer.value = 0
}
function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => { const image = new Image(); image.onload = () => resolve(image); image.onerror = () => reject(new Error('图片加载失败，请更换图片后重试')); image.src = src })
}
async function persistSettings() {
  const record = activeRun.value
  if (!record || !result.value || busy.value || error.value || !validWeight.value || recordDeleted.value || recordConflict.value || restoring) return
  const currentSettings = settings()
  const version = ++settingsSaveVersion
  settingsSaving.value = true
  activeRun.value = { ...record, difference: difference.value ?? record.difference, snapshot: record.snapshot ? { ...record.snapshot, settings: currentSettings } : undefined }
  const current = () => activeRun.value?.id === record.id && settingsSaveVersion === version
  try { await S.updateInkRunSettings(record.id, currentSettings); if (current()) localSaveError.value = '' }
  catch (failure) { if (current()) localSaveError.value = failure instanceof Error ? failure.message : '保存失败，请重试。' }
  finally { if (current()) settingsSaving.value = false }
}
async function retrySave() {
  const record = activeRun.value
  if (!record || recordDeleted.value || recordConflict.value || !validWeight.value) return
  try {
    if (S.inkRuns.some(run => run.id === record.id)) await S.updateInkRunSettings(record.id, settings())
    else await S.recordInkRun({ ...record, snapshot: record.snapshot ? { ...record.snapshot, settings: settings() } : undefined })
    localSaveError.value = ''
  } catch (failure) { localSaveError.value = failure instanceof Error ? failure.message : '配墨记录保存失败。' }
}
async function reloadRecord() {
  const latest = S.inkRuns.find(run => run.id === activeRun.value?.id)
  if (latest) await S.openInkRun(latest)
}
async function analyze(operation?: InputOperation) {
  clearResult(); const token = request
  busy.value = true; S.status('ink', 'busy')
  try {
    await new Promise(resolve => setTimeout(resolve, 40))
    const image = await loadImage(source.value)
    if (token !== request) return
    const next = analyzeInk(image)
    if (!next) throw new Error('未能读取图片颜色，请更换图片。')
    if (token !== request) return
    result.value = next; selectedLayer.value = 0; enabled.value = next.layers.map(() => true); busy.value = false
    S.status('ink', 'ready')
    if (operation) {
      try {
        const record: InkRun = { id: 'ink-' + S.createId() + '-' + token, createdAt: new Date().toISOString(), inputName: operation.name, sampleId: operation.sampleId || null,
          source: operation.source, layerCount: next.layers.length, difference: S.layerDifference(next.renderModel, enabled.value),
          snapshot: { version: 1, imageUrl: S.captureInkImage(image), layers: next.layers, renderModel: next.renderModel, settings: settings() } }
        if (token !== request) return
        activeRun.value = record
        await S.recordInkRun(record)
      } catch (failure) { if (token === request) localSaveError.value = failure instanceof Error ? failure.message : '配墨记录保存失败。' }
    }
  } catch (failure) {
    if (token !== request) return
    result.value = null; enabled.value = []; error.value = failure instanceof Error ? failure.message : '分析失败，请重试。'; S.status('ink', 'error', error.value)
  } finally { if (token === request) busy.value = false }
}
async function uploadFile(file?: File) {
  if (!file) return
  clearResult(); source.value = ''; sourceName.value = file.name
  const token = request
  if (!file.type.startsWith('image/')) { error.value = '仅支持 JPG、PNG、WEBP 等图片文件。'; S.status('ink', 'error', error.value); return }
  if (file.size > 12 * 1024 * 1024) { error.value = '图片不能超过 12 MB。'; S.status('ink', 'error', error.value); return }
  try {
    const url = await new Promise<string>((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(String(reader.result)); reader.onerror = () => reject(new Error('文件读取失败，请重新选择。')); reader.readAsDataURL(file) })
    if (token !== request) return
    source.value = url
    await analyze({ name: file.name, source: '用户上传' })
  } catch (failure) { if (token === request) error.value = failure instanceof Error ? failure.message : '上传失败。' }
}
function upload(event: Event) { const input = event.target as HTMLInputElement; const file = input.files?.[0]; input.value = ''; void uploadFile(file) }
function drop(event: DragEvent) { event.preventDefault(); dragging.value = false; void uploadFile(event.dataTransfer?.files[0]) }
function resetCurrentSample() {
  if (!result.value || busy.value) return
  enabled.value = result.value.layers.map(() => true)
  selectedLayer.value = 0; tab.value = 'overview'; previewTab.value = 'pair'
}
function toggle(index: number) { enabled.value = enabled.value.map((value, i) => i === index ? !value : value) }
function showLayer(index: number) { selectedLayer.value = index; tab.value = 'detail' }
function amount(percentage: number) { const kg = percentage / 100 * (validWeight.value ? Number(weight.value) : 0); return kg >= 1 ? kg.toFixed(3) + ' kg' : (kg * 1000).toFixed(1) + ' g' }
function exportRecipe() {
  if (!result.value || busy.value || !validWeight.value || error.value) return
  const text = ['帝龙智能配色系统 - 配墨建议单', '样例文件：' + sourceName.value, '分析时间：' + analysisDate.value,
    '初步识别色层：' + result.value.layers.length + ' 层', ...warnings.value, '单层配墨基准：' + weight.value + ' kg',
    '当前合成偏差（白底）：' + (difference.value?.toFixed(2) ?? '—') + ' / 255', '',
    ...result.value.layers.flatMap((layer, index) => [`${index + 1}. ${layer.name} / ${layer.hex} / 图像占比 ${layer.share}% / ${enabled.value[index] ? '开启' : '关闭'}`,
      ...ingredients.map(item => `   ${item.label}：${layer.recipe[item.key]}%（${amount(layer.recipe[item.key])}）`), '']),
    '说明：本结果为基于图像色彩的初始配墨建议，实际生产前需结合纸张、油墨和设备条件试印校正。'].join('\r\n')
  const url = URL.createObjectURL(new Blob(['\uFEFF' + text], { type: 'text/plain;charset=utf-8' })); const anchor = document.createElement('a')
  anchor.href = url; anchor.download = sourceName.value.replace(/\.[^.]+$/, '').replace(/[<>:"/\\|?*\u0000-\u001f]/g, '_') + '_配墨建议.txt'; anchor.click(); setTimeout(() => URL.revokeObjectURL(url), 30000)
}
async function restore(event: Event) {
  const run = (event as CustomEvent<{ run: InkRun }>).detail.run
  if (!S.canRestoreInkRun(run)) return
  restoring = true; clearResult(); const snapshot = run.snapshot, saved: Partial<InkSettings> = snapshot.settings || {}
  const restoredEnabled = Array.isArray(saved.enabled) && saved.enabled.length === snapshot.layers.length ? [...saved.enabled] : snapshot.layers.map(() => true)
  source.value = snapshot.imageUrl; sourceName.value = run.inputName; activeRun.value = structuredClone(run)
  result.value = { layers: snapshot.layers, renderModel: snapshot.renderModel, difference: run.difference, reconstructionUrl: renderInk(snapshot.renderModel, restoredEnabled) }
  enabled.value = restoredEnabled
  weight.value = typeof saved.weight === 'number' && Number.isFinite(saved.weight) ? Math.max(.5, Math.min(500, saved.weight)) : 10
  selectedLayer.value = typeof saved.selectedLayer === 'number' && Number.isInteger(saved.selectedLayer) && saved.selectedLayer >= 0 && saved.selectedLayer < snapshot.layers.length ? saved.selectedLayer : 0
  tab.value = saved.tab === 'detail' ? 'detail' : 'overview'; S.status('ink', 'ready'); S.status('ink-restore', 'ready')
  await nextTick(); restoring = false
}
function openSample(event: Event) {
  const detail = (event as CustomEvent<WorkflowOpenDetail>).detail
  if (detail.page !== 'color' || !detail.sample) return
  source.value = detail.sample.imageUrl; sourceName.value = detail.sample.name + '.png'
  void analyze({ name: sourceName.value, sampleId: detail.sample.id, source: '样例库' })
}
watch([weight, enabled, selectedLayer, tab], () => { if (!restoring) void persistSettings() }, { deep: true })
onMounted(() => { window.addEventListener('dilong-ink-open', restore); window.addEventListener('dilong-open', openSample); void analyze() })
onBeforeUnmount(() => { request++; window.removeEventListener('dilong-ink-open', restore); window.removeEventListener('dilong-open', openSample) })
</script>
<template><div class="ink-page embedded-module"><div class="workspace">
<div class="breadcrumb">配色工作台 <ChevronRight/> 新建分析任务</div><div class="page-heading"><div><h1>样例分色、色层还原与配墨建议</h1><p>将样例拆解为最多四个真实色层，逐层合成还原图，并同步生成各层初始配墨配方。</p></div><button class="btn btn-primary export-button" :disabled="busy || !result || !validWeight" @click="exportRecipe"><Download :size="16"/>导出配墨建议单</button></div>
<div class="ink-algorithm-note"><b>本地算法初步分析</b><p>用于演示与人工参考；细密纹理可能识别不足，配方需经试印确认。</p></div>
<section class="summary-strip ink-summary"><div class="ink-metric"><span>任务状态</span><strong :class="result?'ready':'pending'">{{busy?'分析中…':error?'分析失败':result?'分析完成':'等待图片'}}</strong></div><div class="ink-metric"><span>初步识别色层</span><strong>{{busy?'计算中':result?result.layers.length+' 层':'—'}}</strong></div><div class="ink-metric aggregate-color"><span>综合色值</span><strong class="hex-summary"><i :style="{background:aggregateHex==='—'?'transparent':aggregateHex}"/><b class="hex-value">{{aggregateHex}}</b></strong></div><div class="ink-metric"><span>当前合成偏差（白底）</span><strong>{{busy?'计算中':difference?.toFixed(2) ?? '—'}}<template v-if="!busy && difference!==null"> / 255</template></strong></div><div class="ink-metric"><span>配方基准</span><strong>{{validWeight?Number(weight).toFixed(1)+' kg / 层':'—'}}</strong></div></section>
<p v-if="error" class="error-banner" role="alert">{{error}}</p>
    <div v-if="activeRun" class="ink-run-info" :role="recordConflict || localSaveError || recordStatus?.state==='error' ? 'alert' : 'status'">
      <template v-if="recordDeleted">此次历史已删除。当前预览仍可导出，后续参数调整不再保存到该记录。</template>
      <template v-else-if="recordConflict">此记录已在其他页面修改，当前预览已保留，参数暂不保存。<button class="btn btn-secondary" @click="reloadRecord">重新加载最新记录</button></template>
      <template v-else><strong>当前配墨记录：{{activeRun.inputName}}</strong><span>{{settingsSaving || recordStatus?.state==='busy' ? '正在保存…' : localSaveError || recordStatus?.message || '原图、配方和参数已保存在本机浏览器'}}</span><button v-if="localSaveError || recordStatus?.state==='error'" class="btn btn-secondary" @click="retrySave">重试保存</button></template>
    </div>

<div class="main-grid"><section class="panel image-panel"><header class="panel-header"><div><span class="step-no">01</span><div><h2>上传样例</h2><p>上传后自动完成色层分析</p></div></div><span class="format-note">JPG · PNG · WEBP</span></header><input ref="fileInput" type="file" accept=".png,.jpg,.jpeg,.webp" class="sr-only" aria-label="上传配墨图片" @change="upload"/>
<div class="image-stage" :class="{dragging}" @dragover.prevent="dragging=true" @dragleave="dragging=false" @drop="drop"><BigImageViewer v-if="source" :src="source" :alt="sourceName" class="ink-large-image" eager/><div v-if="busy" class="analysis-overlay"><LoaderCircle class="spin"/><span>正在识别颜色与色层…</span></div><div v-else-if="!source" class="empty-state">请选择有效图片</div><div class="scan-corners" aria-hidden="true"><i/><i/><i/><i/></div></div><div class="file-row"><div class="file-info"><ImageIcon/><div><strong>{{sourceName}}</strong><span>当前分析样例</span></div></div><button class="btn btn-secondary" @click="fileInput?.click()"><Upload :size="14"/>更换图片</button></div><div class="local-note"><Check :size="14"/>主动选择的图片与配墨记录保存在当前浏览器，不会上传服务器。</div></section>
<section class="panel layers-panel"><header class="panel-header"><div><span class="step-no">02</span><div><h2>印刷色层建议</h2><p>按实际叠印顺序由浅至深排列</p></div></div><span class="complete-badge"><Check/>{{busy?'计算中':result?'已完成':'待分析'}}</span></header><div class="layer-list"><article v-for="(layer,index) in result?.layers || []" :key="index" class="layer-card" :class="{selected:selectedLayer===index}"><button class="layer-row layer-select" :class="{active:selectedLayer===index}" :aria-pressed="selectedLayer===index" @click="selectedLayer=index"><span class="layer-index">{{String(index+1).padStart(2,'0')}}</span><span class="color-swatch" :style="{background:layer.hex}"/><span class="layer-copy"><strong>{{layer.name}}</strong><small>{{layer.role}}</small></span><span class="layer-values"><strong class="current-layer-hex">{{layer.hex}}</strong><small>覆盖约 {{layer.share}}%</small></span><ChevronRight/></button></article><div v-if="!result" class="empty-state">{{busy?'正在计算色层…':'选择有效图片后开始分析'}}</div></div>
<div class="weight-setting"><div><FlaskConical/><div><strong><label for="ink-weight">单层配墨重量</label></strong><span>四层配方同步换算用量</span></div></div><div class="weight-input"><input id="ink-weight" v-model.number="weight" class="form-control" type="number" min="0.5" max="500" step="0.5"/><span>kg</span></div></div><p v-if="!validWeight" class="warning-text">请输入0.5至500 kg的配墨重量。</p><div class="ink-secondary-actions"><button class="text-link" aria-label="恢复当前样例" title="保留当前图片和重量，恢复全部色层与默认预览" :disabled="busy || !result" @click="resetCurrentSample"><RotateCcw :size="13"/>恢复当前样例</button><button class="text-link" :disabled="busy || !source" @click="analyze({name:sourceName,source:'用户重新分析'})">重新分析当前图片</button></div></section></div>
<section class="panel reconstruction-panel"><header class="panel-header"><div><span class="step-no">03</span><div><h2>四色层合成还原</h2><p>还原图仅由识别出的色层重新叠加生成</p></div></div><span class="reconstruction-status"><Layers3/>原样与重建对比</span></header><div class="reconstruction-body"><div><div class="ink-preview-tabs" role="tablist" aria-label="配墨图像预览"><button role="tab" :aria-selected="previewTab==='pair'" :class="{active:previewTab==='pair'}" @click="previewTab='pair'">原图与合成</button><button role="tab" :aria-selected="previewTab==='layer'" :class="{active:previewTab==='layer'}" :disabled="!activeLayer" @click="previewTab='layer'">当前色层</button></div><div v-if="previewTab==='pair'" class="comparison-grid image-pair"><figure><figcaption><span>上传原样</span><small>原始图像</small></figcaption><div class="compare-image"><BigImageViewer v-if="source" :src="source" :alt="sourceName" class="ink-large-image"/></div></figure><figure><figcaption><span>四色层还原样</span><small>{{result?'当前启用 '+activeCount+' / '+result.layers.length+' 层':'等待分析'}}</small></figcaption><div class="compare-image reconstructed"><BigImageViewer v-if="result && reconstructed" :src="reconstructed" alt="色层合成还原图" class="ink-large-image"/><div v-else class="empty-state">{{busy?'正在计算…':'分析后显示还原图'}}</div></div></figure></div><div v-else class="single-layer-preview checker"><BigImageViewer v-if="activeLayer" :src="activeLayer.maskUrl" :alt="activeLayer.name+'分层图'" class="ink-large-image"/></div></div>
<aside class="layer-stack"><div class="stack-heading"><div><strong>色层叠加控制</strong><span>关闭任意一层，观察该层对还原结果的影响</span></div><button class="btn btn-secondary" :disabled="!result" @click="enabled=result?.layers.map(()=>true) ?? []">全部开启</button></div><div class="stack-list"><label v-for="(layer,index) in result?.layers || []" :key="index" class="stack-layer layer-switch" :class="{disabled:!enabled[index]}"><span class="stack-order">{{index+1}}</span><span class="stack-thumb checker"><img :src="layer.maskUrl" :alt="layer.name+'色层缩略图'"/></span><span class="stack-copy"><b>{{layer.name}}</b><small>{{layer.hex}} · 覆盖约 {{layer.share}}%</small></span><input class="sr-only" type="checkbox" :checked="enabled[index]" :aria-label="'开启'+layer.name" @change="toggle(index)"/><Eye v-if="enabled[index]" :size="15"/><EyeOff v-else :size="15"/></label></div><div class="difference-note"><strong>当前合成偏差（白底）：{{busy?'计算中':difference?.toFixed(2) ?? '—'}}<template v-if="!busy && difference!==null"> / 255</template></strong><span>数值越低，四色层近似效果越接近上传原样。该指标为 RGB 像素平均距离，用于本次快速视觉比较。</span></div></aside></div></section>
<section class="panel formula-panel"><header class="panel-header"><div><span class="step-no">04</span><div><h2>各色层配墨建议</h2><p>默认同时查看全部色层，也可切换到单层详情称量</p></div></div><span class="formula-status"><Activity :size="15"/> 初始配方建议</span></header><div class="formula-tabs"><div class="formula-tabs-list ink-preview-tabs" role="tablist" aria-label="配方查看方式"><button role="tab" :aria-selected="tab==='overview'" :class="{active:tab==='overview'}" @click="tab='overview'">全部色层总览</button><button role="tab" :aria-selected="tab==='detail'" :class="{active:tab==='detail'}" :disabled="!activeLayer" @click="tab='detail'">单层配方详情</button></div>
<div v-if="result && tab==='overview'" class="recipe-grid"><article v-for="(layer,index) in result.layers" :key="index" class="recipe-card"><header class="recipe-card-head"><i class="mini-swatch" :style="{background:layer.hex}"/><div><strong>{{String(index+1).padStart(2,'0')}} · {{layer.name}}</strong><small>{{layer.hex}} · {{layer.share}}%</small></div><button @click="showLayer(index)">查看详情</button></header><div class="recipe-components"><div v-for="item in ingredients" :key="item.key"><span><i :style="{background:item.color}"/>{{item.label}}</span><b>{{layer.recipe[item.key]}}%</b></div></div><footer class="recipe-card-total"><span>单层合计</span><strong>{{validWeight?Number(weight).toFixed(2)+' kg':'—'}}</strong></footer></article></div>
<div v-else-if="activeLayer" class="formula-body recipe-panel"><aside class="target-card"><span>{{activeLayer.name}}</span><div class="target-color" :style="{background:activeLayer.hex}"/><strong>{{activeLayer.hex}}</strong><p>RGB {{Math.round(activeLayer.rgb.r)}} / {{Math.round(activeLayer.rgb.g)}} / {{Math.round(activeLayer.rgb.b)}}</p><div class="layer-pager"><button v-for="(layer,index) in result?.layers || []" :key="index" :class="{active:selectedLayer===index}" :aria-label="`查看第${index+1}色层配方`" :aria-pressed="selectedLayer===index" @click="selectedLayer=index">{{String(index+1).padStart(2,'0')}}</button></div><div class="target-meta"><span>当前色层</span><b>{{selectedLayer+1}} / {{result?.layers.length}}</b></div></aside><div class="ink-table-wrap recipe-list"><div class="ink-table-head"><span>油墨组分</span><span>参考占比</span><span>换算用量</span><span>配方比例</span></div><div v-for="item in ingredients" :key="item.key" class="ink-row recipe-row"><span class="ink-name"><i :style="{background:item.color}"/><b>{{item.label}}</b></span><strong>{{activeLayer.recipe[item.key]}}%</strong><strong>{{amount(activeLayer.recipe[item.key])}}</strong><div class="ratio-track"><i :style="{width:activeLayer.recipe[item.key]+'%',background:item.color}"/></div></div><div class="total-row"><b>配方合计</b><strong>100%</strong><strong>{{validWeight?Number(weight).toFixed(2)+' kg':'—'}}</strong><span>按单层配墨重量换算</span></div></div></div><div v-else class="empty-state">暂无可用配方</div></div><p v-for="warning in warnings" :key="warning" class="warning-text">{{warning}}</p><div class="industrial-notice"><strong>试印提示</strong><span>该配方由图像色彩近似换算，作为首次调整的参考起点。实际生产前请结合原纸底色、油墨型号与设备状态进行试印校正。</span></div></section>
</div></div></template>
<style scoped>
@reference "../assets/css/style.css";
.ink-algorithm-note {
  @apply [border:1px_solid_#c5d5d6];
  background: #f3f8f8;
  @apply [padding:14px_16px];
  @apply mb-[12px];
  color: #386064;
  @apply text-[12px]
}
.ink-algorithm-note p {
  @apply [margin:6px_0_0]
}
.ink-run-info {
  @apply flex;
  @apply items-center;
  @apply gap-[10px];
  @apply flex-wrap;
  @apply [padding:12px_16px];
  @apply [border:1px_solid_var(--border)];
  @apply text-[12px];
  background: var(--surface);
  @apply [margin:0_0_14px]
}
.ink-run-info span {
  color: var(--muted)
}
.ink-run-info .btn {
  @apply text-[11px];
  @apply [padding:6px_10px]
}
.ink-large-image {
  @apply w-[100%];
  @apply h-[100%]
}
.ink-secondary-actions {
  @apply flex;
  @apply justify-between;
  @apply gap-[8px];
  @apply [padding:0_14px_14px]
}
.warning-text {
  @apply text-[11px];
  @apply leading-[1.7];
  color: #a76b26;
  @apply [margin:9px_18px]
}
.ink-preview-tabs {
  @apply flex;
  @apply gap-[0];
  @apply flex-wrap;
  @apply m-[0];
  @apply p-[0]
}
.ink-preview-tabs button {
  @apply [padding:7px_12px];
  @apply [border:0];
  background: #f0f4f4;
  color: var(--muted);
  @apply text-[11px];
  cursor: pointer
}
.ink-preview-tabs button.active {
  background: #fff;
  color: #145f65;
  box-shadow: inset 0 -2px #145f65
}
.reconstruction-body>div>.ink-preview-tabs {
  @apply [padding:10px_16px_0];
  background: #f5f7f7
}
.single-layer-preview {
  @apply h-[350px];
  @apply m-[16px]
}
.recipe-card-total {
  @apply flex;
  @apply justify-between;
  @apply gap-[8px];
  background: #253b3e;
  color: white;
  @apply p-[11px];
  @apply text-[11px]
}
.layer-card {
  @apply [border:0]
}
.image-stage :deep(img),.compare-image :deep(img) {
  @apply object-contain
}
.layer-switch {
  @apply relative
}
.layer-switch input {
  @apply absolute;
  @apply inset-[0];
  @apply w-[100%];
  @apply h-[100%];
  opacity: 0;
  @apply z-[1];
  clip: auto;
  clip-path: none;
  @apply m-[0];
  cursor: pointer
}
.layer-switch:focus-within {
  outline: 2px solid #438e93;
  outline-offset: 1px
}
.layer-values strong {
  @apply text-[11px]
}
.formula-status {
  @apply flex;
  @apply items-center;
  @apply gap-[6px]
}
.formula-tabs .recipe-grid {
  @apply pt-[20px]
}
.hex-summary b {
  @apply font-[600]
}
@media(max-width:760px){
.page-heading {
  @apply gap-[14px];
  @apply items-start;
  @apply flex-col
}
.page-heading h1 {
  @apply text-[22px];
  @apply leading-[1.5]
}
.page-heading p {
  @apply leading-[1.8]
}
.ink-summary {
  @apply grid-cols-[repeat(2,minmax(0,1fr))]
}
.ink-summary>div {
  @apply [padding:14px_12px]
}
.layer-row {
  @apply grid-cols-[22px_36px_1fr_75px_12px];
  @apply gap-[7px];
  @apply [padding:8px_6px]
}
.color-swatch {
  @apply w-[32px];
  @apply h-[36px]
}
.layer-values strong {
  @apply text-[10px]
}
.layer-copy strong {
  @apply text-[12px]
}
.layer-copy small {
  @apply text-[9px]
}
.reconstruction-status {
  @apply hidden
}
.reconstruction-body {
  @apply grid-cols-[1fr]
}
.compare-image {
  @apply h-[230px]
}
.recipe-grid {
  @apply grid-cols-[1fr]
}
.ink-table-wrap {
  @apply overflow-auto
}
.ink-table-head,.ink-row,.total-row {
  @apply grid-cols-[90px_60px_90px];
  @apply gap-[8px]
}
.ink-row .ratio-track,.ink-table-head>span:last-child,.total-row>span:last-child {
  @apply hidden
}
.single-layer-preview {
  @apply h-[250px]
}
.ink-secondary-actions {
  @apply flex-wrap
}}
/* Long names remain readable within the existing layout. */
.ink-run-info { @apply min-w-0 wrap-anywhere; } .ink-run-info strong { @apply min-w-0; } .file-info { @apply min-w-0; flex: 1; } .file-info strong { @apply whitespace-normal max-w-none overflow-visible wrap-anywhere; } .file-row>button { flex: none; } .ink-table-wrap { @apply min-w-0 overflow-x-auto; }
</style>
