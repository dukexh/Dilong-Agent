<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, shallowRef, watch } from 'vue'
import { Check, ChevronDown, LoaderCircle, Play, SlidersHorizontal, Sparkles } from 'lucide-vue-next'
import Panel from './Panel.vue'
import BigImageViewer from './BigImageViewer.vue'
import ImageRegionEditor from './ImageRegionEditor.vue'
import EngineeringExportButton from './EngineeringExportButton.vue'
import CandidateSaveButton from './CandidateSaveButton.vue'
import TaskSavedResults from './TaskSavedResults.vue'
import { createSeamless, expandContinuousUnit, fullRegion, loadImage, type UnitSnapshot } from '../services/image-tools'
import { S } from '../services/workflows'
import type { BeginDesignTaskRequest, DesignParameters, DesignTask } from '../services/types'
import type { CompletionPipeline, EngineeringProject } from '../core/seamless'
import type { DesignResult } from '../core/types'

const props = defineProps<{ src: string; name: string; input: BeginDesignTaskRequest['input'] | null; taskId: string | null; restoreKey: number; missing?: boolean; disabled?: boolean }>()
const emit = defineEmits<{ busy: [value: boolean]; task: [id: string | null] }>()
const region = ref(fullRegion()), overlap = ref(15), lightBalance = ref(false)
const completion = ref<CompletionPipeline['completion']>('horizontal3')
const unit = shallowRef<UnitSnapshot | null>(null), confirmed = ref(false), busy = ref(false), error = ref(''), phase = ref(''), fraction = ref(0)
const result = shallowRef<(DesignResult & { engineering: EngineeringProject }) | null>(null), savedParameters = shallowRef<DesignParameters>({})
const localId = ref<string | null>(props.taskId), showHistory = ref(false), resultKey = ref('')
const originalSize = ref<{width:number;height:number}|null>(null)
let sourceRevision = 0
watch(() => props.src, async src => { const token = ++sourceRevision; originalSize.value = null; if (src) try { const image = await loadImage(src); if (token === sourceRevision) originalSize.value = {width:image.naturalWidth,height:image.naturalHeight} } catch { /* The generation action reports unreadable input. */ } }, { immediate:true })
const adjusting = ref(false), needsApply = ref(false), operation = ref<'unit'|'confirm'|'expand'|null>(null)
let autoAllowed = !props.taskId, autoTimer: ReturnType<typeof setTimeout> | undefined
const columns = computed(() => completion.value === 'horizontal5' ? 5 : 3), rows = computed(() => completion.value === 'around' ? 3 : 1)
const unavailable = computed(() => busy.value || props.disabled || props.missing || !props.input || !props.src)
let revision = 0, controller: AbortController | undefined
function setBusy(value: boolean) { busy.value = value; emit('busy', value) }
function clearUnit() { clearTimeout(autoTimer); revision++; controller?.abort(); unit.value = null; confirmed.value = false; result.value = null; showHistory.value = false; error.value = ''; setBusy(false) }
function changeUnit() { autoAllowed = false; needsApply.value = true; clearUnit() }
function scheduleAuto() {
  clearTimeout(autoTimer)
  if (!autoAllowed || busy.value || unit.value || unavailable.value || needsApply.value || error.value) return
  const token = revision
  autoTimer = setTimeout(() => { if (token === revision && autoAllowed && !unavailable.value && !unit.value) void runStage('unit') }, 250)
}
function changeExtent() { result.value = null; showHistory.value = false; error.value = '' }
function snapshot(stage: CompletionPipeline['stage'], value = unit.value!): CompletionPipeline { return { version: 1, stage, unit: value, completion: completion.value } }
function parameters(pipeline?: CompletionPipeline): DesignParameters {
  return { completionVersion: 1, completion: completion.value, seamlessOverlap: overlap.value, lightBalance: lightBalance.value, searchRegion: { ...region.value },
    sourceKind: props.input?.kind, sourceName: props.name, ...(props.input?.kind === 'library' ? { sourceId: props.input.sampleId } : {}), ...(pipeline ? { completionPipeline: pipeline } : {}) }
}
async function hydrate(id: string | null) {
  autoAllowed = false; needsApply.value = false; clearUnit(); localId.value = id
  const token = revision, task = S.tasks.find(t => t.id === id)
  if (!task || !['complete', 'seamless'].includes(task.mode || '')) { autoAllowed = true; scheduleAuto(); return }
  await nextTick(); if (token !== revision) return
  const p = task.parameters
  region.value = p?.searchRegion ? { ...p.searchRegion } : fullRegion(); overlap.value = p?.seamlessOverlap ?? 15; lightBalance.value = p?.lightBalance ?? false
  completion.value = ['horizontal3', 'horizontal5', 'around'].includes(p?.completion || '') ? p!.completion as CompletionPipeline['completion'] : 'horizontal3'
  const saved = p?.completionPipeline
  showHistory.value = !!task.resultIds.length || saved?.stage === 'expanded'
  if (saved?.version === 1 && saved.unit?.url && saved.unit.engineering?.version === 'seamless-v1') {
    unit.value = saved.unit; confirmed.value = saved.stage !== 'unit-ready'; completion.value = saved.completion; return
  }
  // First-iteration standalone units remain readable; confirmation forks a new completion task.
  if (task.mode === 'seamless') {
    const asset = task.resultIds.map(key => S.assets.find(a => a.id === key)).find(a => a?.parameters?.engineering)
    if (asset?.parameters?.engineering) {
      try {
        const image = await loadImage(asset.imageUrl)
        if (token === revision) unit.value = { url: asset.imageUrl, thumbnailUrl: asset.thumbnailUrl || asset.imageUrl, width: image.naturalWidth, height: image.naturalHeight, engineering: asset.parameters.engineering }
      } catch (reason) { if (token === revision) error.value = reason instanceof Error ? reason.message : String(reason) }
    }
  }
}
watch(() => [props.src, props.taskId, props.restoreKey] as const, ([src, id, key], [previousSrc, previousId, previousKey]) => {
  if (key !== previousKey || id && id !== localId.value && id !== previousId) { void hydrate(id); return }
  if (src !== previousSrc || !id && previousId && localId.value) { clearUnit(); localId.value = id; autoAllowed = !id; needsApply.value = false; adjusting.value = false; region.value = fullRegion(); overlap.value = 15; lightBalance.value = false; scheduleAuto() }
})
watch(() => [props.input, props.disabled, props.missing], scheduleAuto)
onMounted(() => { if (props.taskId) void hydrate(props.taskId); else scheduleAuto() })
onBeforeUnmount(() => { clearTimeout(autoTimer); sourceRevision++; revision++; controller?.abort(); emit('busy', false) })

async function runStage(kind: 'unit' | 'confirm' | 'expand') {
  if (unavailable.value || !props.input || kind !== 'unit' && !unit.value || kind === 'expand' && !confirmed.value) return
  clearTimeout(autoTimer); autoAllowed = false; operation.value = kind
  if (kind === 'unit') { unit.value = null; confirmed.value = false; needsApply.value = false }
  phase.value = kind === 'unit' ? '自动制作连续单元' : kind === 'confirm' ? '确认连续单元' : '连续扩展'; fraction.value = 0
  const token = ++revision, key = S.createId(), options = S.startDesignRun(key), originalInput = { ...props.input }, src = props.src
  controller = S.designRuns.get(key)!.controller
  const onProgress = options.onProgress
  options.onProgress = p => { onProgress(p); if (token === revision) { phase.value = p.phase; fraction.value = p.fraction } }
  error.value = ''; result.value = null; showHistory.value = false; setBusy(true); S.status('design', 'busy')
  const capturedUnit = unit.value
  let task: DesignTask | undefined
  try {
    const previous = S.tasks.find(t => t.id === localId.value), reusable = previous?.mode === 'complete' && previous.parameters?.completionVersion === 1
    const initialPipeline = kind === 'unit' ? undefined : snapshot('unit-confirmed', capturedUnit!)
    if (kind === 'confirm' && reusable && previous.status === '待处理') task = previous
    else task = await S.beginDesignTask({ mode: 'complete', taskId: reusable ? previous.id : null, runKey: key, parameters: parameters(initialPipeline), input: originalInput })
    S.checkDesignCancelled(options)
    if (token === revision) { localId.value = task.id; S.activeTask = task.id; emit('task', task.id) }
    if (kind === 'unit') {
      const generated = await createSeamless(src, overlap.value, lightBalance.value, region.value, options)
      const value: UnitSnapshot = { url: generated.url, thumbnailUrl: generated.thumbnailUrl, width: generated.width, height: generated.height, engineering: generated.engineering }
      S.checkDesignCancelled(options)
      await S.updateTask(task.id, { parameters: parameters(snapshot('unit-ready', value)), status: '待处理', outputCount: 0, error: '', conditions: '连续单元已生成，待确认' })
      if (token === revision) { unit.value = value; confirmed.value = false }
    } else if (kind === 'confirm') {
      options.onProgress({ fraction: .5, phase: '保存连续单元确认' })
      await S.updateTask(task.id, { parameters: parameters(snapshot('unit-confirmed', capturedUnit!)), status: '待处理', error: '', conditions: '连续单元已确认，待扩展' })
      if (token === revision) confirmed.value = true
    } else {
      const generated = await expandContinuousUnit(capturedUnit!, completion.value, options)
      S.checkDesignCancelled(options)
      const p = { ...parameters(snapshot('expanded', capturedUnit!)), mode: 'complete', engineering: generated.engineering, outputWidth: generated.width, outputHeight: generated.height }
      await S.updateTask(task.id, { parameters: p, status: '已处理', outputCount: 1, error: '', completedAt: new Date().toISOString() })
      if (token === revision) { result.value = generated; savedParameters.value = p; resultKey.value = 'complete-' + key }
    }
  } catch (reason) {
    const cancelled = reason instanceof Error && reason.name === 'AbortError', message = cancelled ? '任务已取消，可重新执行' : reason instanceof Error ? reason.message : String(reason)
    if (task) try { await S.updateTask(task.id, { status: cancelled ? '已取消' : '执行失败', error: message }) } catch { /* Preserve the original error; a deleted task is never recreated. */ }
    if (token === revision) error.value = message
  } finally {
    S.finishDesignRun(key)
    if (token === revision) { controller = undefined; operation.value = null; setBusy(false); S.status('design', error.value ? 'error' : 'ready', error.value) }
  }
}
</script>
<template>
  <div class="completion-flow">
    <Panel class="completion-panel unit-panel" title="连续单元预览" eyebrow="STEP 02">
      <template #actions><span class="unit-status" :class="{ready:confirmed}"><Check v-if="confirmed" :size="13"/><Sparkles v-else :size="13"/>{{busy&&operation==='unit'?'自动生成中':confirmed?'已确认':unit?'待确认':'自动制作'}}</span></template>
      <div v-if="unit" class="confirmed-unit" :data-confirmed-unit="confirmed">
        <p class="unit-dimensions"><span v-if="originalSize" class="original-dimensions">原图 {{originalSize.width}} × {{originalSize.height}} → </span>单元 {{unit.width}} × {{unit.height}} px</p>
        <div class="single-unit-preview"><BigImageViewer :src="unit.url" :preview-src="unit.thumbnailUrl" alt="四方连续单元"/></div>
        <div class="unit-confirm-row"><EngineeringExportButton :src="unit.url" :name="name+' · 连续单元'" :project="unit.engineering" compact/><span class="unit-check-hint">{{confirmed?'在 03 选择扩展方式':'查看单元图后确认'}}</span><button type="button" class="confirm-unit-button completion-primary" aria-label="确认单元并进入补全" :disabled="unavailable||confirmed" @click="runStage('confirm')"><Check :size="14"/>{{confirmed?'单元已确认':'确认连续单元'}}</button></div>
      </div>
      <div v-else class="unit-placeholder" :aria-busy="busy&&operation==='unit'"><LoaderCircle v-if="busy&&operation==='unit'" :size="30" class="spin"/><Sparkles v-else :size="28"/><strong>{{busy&&operation==='unit'?'正在自动制作连续单元':needsApply?'调整后需重新生成':showHistory?'已载入历史结果':'选择来样后自动制作'}}</strong><span>{{busy&&operation==='unit'?phase:needsApply?'在下方应用调整，重新生成单元图':showHistory?'重新制作不会覆盖已保存结果':'系统会自动处理上下、左右接缝'}}</span><button v-if="!busy&&(error||showHistory)" type="button" class="completion-secondary retry-unit-button" :disabled="unavailable" @click="runStage('unit')">重新制作单元</button></div>
      <div v-if="busy" class="completion-progress" role="status"><progress :value="fraction" max="1" aria-label="补全流程进度"/><div><span>{{phase}}</span><button type="button" @click="controller?.abort()">取消</button></div></div><p v-if="error" class="completion-error" role="alert">{{error}}</p>

      <details class="unit-adjustments" :open="adjusting" @toggle="adjusting=($event.target as HTMLDetailsElement).open"><summary><SlidersHorizontal :size="14"/>手动调整<ChevronDown :size="12"/></summary><div class="unit-adjustment-layout"><ImageRegionEditor v-if="src" v-model="region" :src="src" :disabled="busy||disabled" compact horizontal :expanded="adjusting" @edit="changeUnit"/><div class="unit-adjustment-options"><label class="completion-field">接缝修补范围 {{overlap}}%<input v-model.number="overlap" aria-label="连续单元接缝重叠" type="range" min="5" max="30" :disabled="busy||disabled" @input="changeUnit"/></label><label class="completion-field checkbox-field"><input v-model="lightBalance" type="checkbox" :disabled="busy||disabled" @change="changeUnit"/> 均衡光照</label><p>仅在接缝不理想或需要裁剪时调整。修补会缩小单元幅面。</p><button type="button" class="unit-run-button completion-secondary" :disabled="unavailable" @click="runStage('unit')">应用调整，重新生成</button></div></div></details>
    </Panel>
    <Panel class="completion-panel completion-options completion-panel-config" title="连续扩展" eyebrow="STEP 03">
      <div class="completion-expand-row"><label class="completion-field">扩展方式<select v-model="completion" aria-label="补全扩展方式" :disabled="busy||!confirmed" @change="changeExtent"><option value="horizontal3">横向 3 倍</option><option value="horizontal5">横向 5 倍</option><option value="around">四周 3 × 3</option></select></label><span class="target-dimensions">{{unit?unit.width*columns+' × '+unit.height*rows+' px':'等待连续单元'}}<small>{{confirmed?'按单元原像素铺排':'确认单元后即可扩展'}}</small></span><button type="button" class="completion-run-button completion-primary" :disabled="unavailable||!confirmed" @click="runStage('expand')"><LoaderCircle v-if="busy&&operation==='expand'" :size="15" class="spin"/><Play v-else :size="14"/>{{busy&&operation==='expand'?'正在扩展…':'生成补全结果'}}</button></div>
    </Panel>
    <Panel v-if="result||showHistory" class="completion-panel completion-output" title="补全结果" eyebrow="STEP 04">
      <article v-if="result" class="completion-result"><BigImageViewer :src="result.url" :preview-src="result.thumbnailUrl" alt="小样联想补全结果" :style="{aspectRatio:result.width+'/'+result.height}"/><div><h3>{{name}} · 连续扩展</h3><p class="image-dimensions">{{result.width}} × {{result.height}} · 完整分辨率 PNG</p><p>{{columns}} 列 × {{rows}} 行 · 保持纹理尺度</p><CandidateSaveButton :src="result.url" :name="name+' · 连续扩展'" source="completion" :source-key="resultKey" :task-id="localId" :parameters="savedParameters"/><EngineeringExportButton :src="result.url" :name="name+' · 连续扩展'" :project="result.engineering"/></div></article>
      <TaskSavedResults v-else-if="showHistory" :task-id="localId"/>
      <p v-else class="completion-result-empty">{{confirmed?'选择扩展方式，生成完整纹理图。':'确认连续单元后，在这里查看扩展结果。'}}</p>
    </Panel>

  </div>
</template>
<style scoped>
@reference "../assets/css/style.css";
.completion-flow { display:contents; }
.completion-panel { @apply p-5 min-w-0 rounded-lg;box-shadow:none; }
.completion-panel :deep(.panel-header) { @apply p-0 pb-4 mb-4;min-height:64px;box-sizing:border-box; }
.completion-panel :deep(.panel-content) { @apply p-0; }
.unit-panel { grid-column:2;grid-row:1/span 2;display:flex;flex-direction:column;min-height:0; }
.unit-panel :deep(.panel-content) { display:flex;flex-direction:column;flex:1;min-height:0; }
.confirmed-unit { display:flex;flex-direction:column;flex:1;min-height:0; }
.completion-options { grid-column:1;grid-row:2;display:flex;flex-direction:column;min-height:0; }
.completion-options :deep(.panel-content) { display:flex;flex-direction:column;flex:1; }
.completion-output { grid-column:1/-1;grid-row:3; }
.unit-status { @apply inline-flex items-center gap-1.5 text-[11px] shrink-0; color:var(--muted); }
.unit-status.ready { color:var(--teal); }
.unit-dimensions { @apply text-[11px];color:var(--muted); }
.single-unit-preview { @apply relative flex items-center justify-center min-h-80 rounded-md overflow-hidden;flex:1; background:color-mix(in srgb,var(--surface) 94%,var(--ink)); }
.single-unit-preview :deep(.big-image-trigger) { @apply absolute inset-0 h-full w-full; }
.single-unit-preview :deep(.big-image-trigger>img) { max-height:420px; }
.unit-confirm-row { @apply flex items-center gap-3 pt-4 flex-wrap; }
.unit-check-hint { @apply text-[11px] flex-1; color:var(--muted); }
.completion-primary { @apply inline-flex items-center justify-center gap-2 px-4 py-3 rounded text-xs font-medium; background:var(--teal);color:var(--surface); }
.completion-secondary { @apply border px-3 py-2 rounded text-xs; background:var(--surface);color:var(--teal);border-color:var(--line-strong); }
button:disabled { @apply opacity-50 cursor-not-allowed; }
.unit-placeholder { @apply h-80 flex flex-col items-center justify-center gap-3 text-center rounded-md p-4; background:color-mix(in srgb,var(--surface) 96%,var(--ink));color:var(--muted); }
.unit-placeholder strong { @apply text-sm font-medium; color:var(--ink); }
.unit-placeholder span { @apply text-xs; }
.unit-adjustments { @apply border-t pt-4 mt-4 min-w-0; border-color:var(--line-strong);flex-shrink:0; }
.unit-adjustments summary { @apply inline-flex items-center gap-2 cursor-pointer text-[11px] list-none; color:var(--muted); }
.unit-adjustments summary svg:last-child { @apply ml-2; }
.unit-adjustments[open] summary svg:last-child { transform:rotate(180deg); }
.unit-adjustment-layout { @apply grid gap-6 mt-4;grid-template-columns:minmax(0,1.7fr) minmax(240px,1fr);align-items:start; }
.unit-adjustment-options .completion-field:first-child { margin-top:0; }
.completion-field { @apply block text-xs my-3; color:var(--muted); }
.completion-field input[type=range],select { @apply block w-full mt-2; }
input[type=range],progress { accent-color:var(--teal); }
select { @apply px-3 py-2.5 rounded border text-xs; background:var(--surface);color:var(--ink);border-color:var(--line-strong); }
.checkbox-field { @apply flex items-center gap-2; }
p { @apply text-xs leading-relaxed my-3; color:var(--muted); }
.completion-expand-row { @apply flex flex-col items-stretch gap-3;flex:1; }
.completion-expand-row .completion-field { @apply m-0; }
.target-dimensions { @apply text-xs pb-0.5; color:var(--ink); }
.target-dimensions small { @apply block text-[10px] mt-2; color:var(--muted); }
.completion-run-button { @apply w-full; margin-top:auto; }
.completion-progress { @apply mt-3 text-[11px]; color:var(--muted); }
.completion-progress progress { @apply block w-full h-1.5; }
.completion-progress>div { @apply flex justify-between gap-3 mt-2; }
.completion-result { @apply grid gap-5;grid-template-columns:minmax(0,2fr) minmax(220px,1fr); }
.completion-result { align-items:start; }
.completion-result :deep(.big-image-trigger) { @apply w-full h-auto min-h-24 max-h-[420px] rounded-md; background:color-mix(in srgb,var(--surface) 94%,var(--ink)); }
.completion-result h3 { @apply text-sm font-semibold wrap-anywhere; }
.completion-result-empty { @apply text-center py-6; }
.completion-error { color:#a13e24; }
.spin { animation:completion-spin 1s linear infinite; }
@keyframes completion-spin{to{transform:rotate(360deg);}}
@media(max-width:1000px){.completion-expand-row{@apply flex-wrap;}.target-dimensions{@apply flex-1;}.completion-run-button{@apply w-full;}.unit-adjustment-layout{@apply grid-cols-1;}}
@media(max-width:760px){
  .unit-panel,.completion-options,.completion-output { grid-column:1;grid-row:auto; }
  .single-unit-preview { flex:none;height:min(360px,80vw);min-height:240px; }
}
</style>
