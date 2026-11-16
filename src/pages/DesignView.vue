<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, shallowRef } from 'vue'
import { ArrowUpRight, CheckCircle2, ImagePlus, Layers, LoaderCircle, Palette, Play, Search, ShieldCheck, Sparkles, Upload } from 'lucide-vue-next'
import Panel from '../components/Panel.vue'
import BigImageViewer from '../components/BigImageViewer.vue'
import CandidateSaveButton from '../components/CandidateSaveButton.vue'
import TaskSavedResults from '../components/TaskSavedResults.vue'
import CompletionWorkflow from '../components/CompletionWorkflow.vue'
import ImageRegionEditor from '../components/ImageRegionEditor.vue'
import EngineeringExportButton from '../components/EngineeringExportButton.vue'
import { fullRegion, searchTextures, demoSearchUrl, DEMO_SEARCH_NAME, type SearchScope, type TextureMatch } from '../services/image-tools'
import { analyzeSummary } from '../core/color-analysis'
import { DesignImages, scoreLabel } from '../core/design-images'
import type { DesignResult, ImageSummary } from '../core/types'
import { S } from '../services/workflows'
import type { BeginDesignTaskRequest, DesignMode, DesignParameters, DesignTask, WorkflowAsset, WorkflowOpenDetail } from '../services/types'

defineOptions({ name: 'DesignView' })
type RankedResult = TextureMatch
const tick = ref(0), completionBusy = ref(false), restoreKey = ref(0), searchScope = ref<SearchScope>('all')
const unsubscribe = S.subscribe(() => tick.value++)
const samples = computed(() => { tick.value; return S.formalSamples() })
const selected = shallowRef<WorkflowAsset | null>(null)
const mode = ref<DesignMode>('compare')
const sourceKind = ref<'library' | 'upload'>('library')
const uploadedUrl = ref(''), uploadedName = ref('')
const uploadedSummary = shallowRef<ImageSummary | null>(null)
const uploadError = ref(''), reading = ref(false)
const source = computed(() => selected.value || samples.value[0])
const sourceUrl = computed(() => sourceKind.value === 'upload' ? uploadedUrl.value : source.value?.imageUrl || '')
const sourceName = computed(() => sourceKind.value === 'upload' ? uploadedName.value : source.value?.name || '未选择样例')
const sourceSummary = computed(() => sourceKind.value === 'upload' ? uploadedSummary.value : source.value?.analysis)
const missingSource = computed(() => sourceKind.value === 'library' && !!source.value?.missing)
const fileInput = ref<HTMLInputElement | null>(null)
const sorting = ref('texture'), limit = ref(5), completion = ref('horizontal3'), targetStyle = ref('smoked'), strength = ref(78)
const region = ref(fullRegion())
const direction = ref('浅色自然橡木'), candidateCount = ref(3)
const currentTaskId = ref<string | null>(null), showTaskResults = ref(false)
const task = computed(() => { tick.value; return S.tasks.find(row => row.id === currentTaskId.value) })
const taskDeleted = computed(() => { tick.value; return !!currentTaskId.value && S.deletedHistory.tasks.has(currentTaskId.value) })
const busy = ref(false), executed = ref(false), executionError = ref(''), candidateRun = ref('')
const rankedResults = shallowRef<RankedResult[]>([]), imageResults = shallowRef<DesignResult[]>([]), recommended = shallowRef<WorkflowAsset[]>([])
const progress = computed(() => { tick.value; return S.designRuns.get(candidateRun.value) })
let designRevision = 0, uploadRevision = 0, ownedUploadUrl = '', designError = '', inputTouched = false
const jobs = new Set<number>()
const deferredUploadUrls = new Set<string>()
const working = computed(() => busy.value || completionBusy.value)
const completionInput = computed<BeginDesignTaskRequest['input'] | null>(() => sourceKind.value === 'upload' ? uploadedSummary.value && uploadedUrl.value ? { kind: 'upload', name: sourceName.value, src: uploadedUrl.value, summary: uploadedSummary.value } : null : source.value && !source.value.missing ? {kind:'library',sampleId:source.value.id,name:source.value.name} : null)
const modes = [
  { key: 'compare' as const, name: '快速比对排序', description: '检索历史相似样例', icon: Search },
  { key: 'complete' as const, name: '小样联想补全', description: '扩展连续大幅纹理', icon: Layers },
  { key: 'twin' as const, name: '风格迁移孪生', description: '保留结构迁移色彩', icon: Palette },
  { key: 'generate' as const, name: '样例自动设计', description: '按条件推荐现有样例', icon: Sparkles },
]
const activeMode = computed(() => modes.find(item => item.key === mode.value)!)
const runLabel = computed(() => missingSource.value ? '请先选择新输入' : ['已中断', '状态待确认', '已取消', '执行失败'].includes(task.value?.status || '') ? '重新执行' : mode.value === 'compare' ? '开始相似检索' : mode.value === 'complete' ? '生成本地补全' : mode.value === 'twin' ? '生成风格孪生' : '开始候选推荐')
const executionLabel = computed(() => mode.value === 'compare' ? '全部 / 个人正式样例 · 纹理结构检索' : mode.value === 'complete' ? '已确认连续单元周期铺排' : mode.value === 'twin' ? '结构保留色彩迁移' : '样例库关键词匹配')
const truth = computed(() => mode.value === 'compare' ? '按整图及对应分区的形态、疏密和走向排序，颜色不参与比较。可手动旋转来样调整方向；排序不是视觉相似百分比。' : mode.value === 'complete' ? '先制作并确认四方连续单元，再按原像素周期铺排；请查看单元图后确认。' : mode.value === 'twin' ? '保留原图分辨率与纹理，调整综合色。结构相似度采用原图与候选的全分辨率灰度 SSIM，明暗变化也会影响结果。' : '候选来自已有样例库，按材质、色系及风格关键词匹配，当前未生成新图片。')
function errorMessage(reason: unknown) { return reason instanceof Error ? reason.message : String(reason) }
function syncStatus() { S.status('design', jobs.size ? 'busy' : designError ? 'error' : 'ready', jobs.size ? '设计任务正在执行' : designError) }
function invalidate() {
  designRevision++; busy.value = false; executed.value = false; showTaskResults.value = false
  rankedResults.value = []; imageResults.value = []; recommended.value = []; executionError.value = ''; designError = ''
  syncStatus()
}
function clearUpload() {
  uploadRevision++; reading.value = false
  if (ownedUploadUrl) { if (jobs.size) deferredUploadUrls.add(ownedUploadUrl); else URL.revokeObjectURL(ownedUploadUrl) }
  ownedUploadUrl = ''; uploadedUrl.value = ''; uploadedName.value = ''; uploadedSummary.value = null; uploadError.value = ''
}
function resetTask() { currentTaskId.value = null; S.activeTask = null }
function chooseSourceKind(kind: 'library' | 'upload') {
  inputTouched = true
  if (working.value || sourceKind.value === kind) return
  invalidate(); clearUpload(); resetTask(); sourceKind.value = kind
  // 恢复上传任务产生的临时样例不属于样例库；保留真实候选的继续设计入口。
  if (kind === 'library') selected.value = S.all().find(asset => asset.id === selected.value?.id) || null
}
function chooseSample(event: Event) {
  inputTouched = true
  if (working.value) return
  const value = (event.target as HTMLSelectElement).value, sample = samples.value.find(item => item.id === value)
  if (!sample) return
  invalidate(); clearUpload(); resetTask(); selected.value = sample; sourceKind.value = 'library'
}
function chooseMode(value: DesignMode) { if (!working.value && mode.value !== value) { invalidate(); mode.value = value } }
async function upload(file?: File) {
  if (!file || working.value) return
  inputTouched = true
  clearUpload(); const revision = uploadRevision
  invalidate(); resetTask(); sourceKind.value = 'upload'; uploadedName.value = file.name; reading.value = true
  try {
    if (!file.type.startsWith('image/')) throw new Error('请选择 PNG、JPG 或 WebP 图片。')
    ownedUploadUrl = URL.createObjectURL(file); uploadedUrl.value = ownedUploadUrl
    const summary = await analyzeSummary(uploadedUrl.value)
    if (revision !== uploadRevision) return
    uploadedSummary.value = summary
  } catch (reason) {
    if (revision !== uploadRevision) return
    if (ownedUploadUrl) URL.revokeObjectURL(ownedUploadUrl)
    ownedUploadUrl = ''; uploadedUrl.value = ''; uploadedSummary.value = null
    const code = reason && typeof reason === 'object' && 'code' in reason ? reason.code : ''
    uploadError.value = code === 'IMAGE_SIZE_LIMIT' || code === 'IMAGE_FULLY_TRANSPARENT' ? errorMessage(reason) : reason instanceof Error && reason.message === '请选择 PNG、JPG 或 WebP 图片。' ? reason.message : '图片读取失败，请更换文件后重试。'
  } finally { if (revision === uploadRevision) reading.value = false }
}
async function restoreDemo() {
  if (working.value) return
  inputTouched = true
  clearUpload(); const revision = uploadRevision
  invalidate(); resetTask(); sourceKind.value = 'upload'; uploadedName.value = DEMO_SEARCH_NAME; uploadedUrl.value = demoSearchUrl(); searchScope.value = 'all'; reading.value = true
  try { const summary = await analyzeSummary(uploadedUrl.value); if (revision === uploadRevision) uploadedSummary.value = summary }
  catch (reason) { if (revision === uploadRevision) uploadError.value = reason instanceof Error ? reason.message : String(reason) }
  finally { if (revision === uploadRevision) reading.value = false }
}
function fileChanged(event: Event) { const input = event.target as HTMLInputElement; const file = input.files?.[0]; input.value = ''; void upload(file) }
function restore(detail: WorkflowOpenDetail) {
  if (detail.page !== 'design' || !detail.sample) return
  inputTouched = true
  invalidate(); clearUpload(); selected.value = detail.sample; currentTaskId.value = detail.task?.id || null; showTaskResults.value = !!detail.task
  if (detail.task?.input?.kind === 'upload') { sourceKind.value = 'upload'; uploadedUrl.value = detail.task.input.imageUrl; uploadedName.value = detail.task.input.name; uploadedSummary.value = detail.task.input.summary }
  else sourceKind.value = 'library'
  mode.value = detail.task?.mode === 'seamless' ? 'complete' : detail.task?.mode || (detail.task ? 'generate' : 'compare')
  restoreKey.value++
  const parameters = detail.task?.parameters
  direction.value = typeof parameters?.direction === 'string' ? parameters.direction : detail.task?.conditions || '浅色自然橡木'
  candidateCount.value = typeof parameters?.candidateCount === 'number' ? parameters.candidateCount : 3
  sorting.value = 'texture'; limit.value = parameters?.limit || 5; searchScope.value = parameters?.searchScope || 'all'
  void nextTick(() => { region.value = parameters?.searchRegion ? { ...parameters.searchRegion } : fullRegion() })
  completion.value = parameters?.completion || 'horizontal3'; targetStyle.value = parameters?.style || 'smoked'; strength.value = parameters?.strength ?? 78
}
function onOpen(event: Event) { restore((event as CustomEvent<WorkflowOpenDetail>).detail) }
function onDeleted(event: Event) {
  const detail = (event as CustomEvent<{ asset?: WorkflowAsset; id?: string; ids?: string[] }>).detail
  const ids = detail.ids || (detail.asset ? [detail.asset.id] : detail.id ? [detail.id] : [])
  if (sourceKind.value === 'library' && source.value && ids.includes(source.value.id)) { invalidate(); clearUpload(); resetTask(); selected.value = S.base[0] || samples.value[0] || null }
  rankedResults.value = rankedResults.value.filter(item => !ids.includes(item.sample.id)); recommended.value = recommended.value.filter(item => !ids.includes(item.id))
}
function onUpdated(event: Event) {
  const asset = (event as CustomEvent<{ asset: WorkflowAsset }>).detail.asset
  if (source.value?.id === asset.id) selected.value = asset
  recommended.value = recommended.value.map(item => item.id === asset.id ? asset : item).filter(S.isLibraryAsset)
  rankedResults.value = rankedResults.value.map(item => item.sample.id === asset.id ? { ...item, sample: asset } : item).filter(item => S.isLibraryAsset(item.sample))
}
async function run() {
  if (working.value || mode.value === 'complete' || mode.value === 'seamless') return
  const inputSource = source.value, kind = sourceKind.value, src = sourceUrl.value, summary = sourceSummary.value
  if (kind === 'library' && (!inputSource || inputSource.missing)) { executionError.value = '源样例已删除，请先选择新输入。'; return }
  if (kind === 'upload' && (!src || !summary || reading.value)) { executionError.value = '请先上传一张可读取的样例图片。'; return }
  if (mode.value === 'compare' && !summary) { executionError.value = '当前样例缺少图像分析，请重新选择输入。'; return }
  const revision = ++designRevision, runKey = S.createId(), runMode = mode.value, inputName = sourceName.value
  const parameters: DesignParameters = { sorting: sorting.value, limit: limit.value, completion: completion.value, style: targetStyle.value, strength: strength.value, direction: direction.value, candidateCount: candidateCount.value,
    ...(runMode === 'compare' ? {searchRegion:{...region.value}} : {}), ...(runMode==='compare'?{searchScope:searchScope.value}:{}) }
  const options = S.startDesignRun(runKey), isCurrent = () => revision === designRevision
  const request: BeginDesignTaskRequest = { taskId: currentTaskId.value, runKey, mode: runMode, parameters, input: kind === 'upload' ? { kind: 'upload', src, name: inputName, summary: summary! } : { kind: 'library', sampleId: inputSource!.id, name: inputName } }
  jobs.add(revision); designError = ''; executionError.value = ''; candidateRun.value = runKey; busy.value = true; executed.value = false; showTaskResults.value = false; rankedResults.value = []; imageResults.value = []; recommended.value = []; syncStatus()
  let startedTask: DesignTask | undefined
  try {
    startedTask = await S.beginDesignTask(request)
    if (isCurrent()) { currentTaskId.value = startedTask.id; S.activeTask = startedTask.id }
    S.checkDesignCancelled(options)
    const executionSrc = startedTask.input?.kind === 'upload' ? startedTask.input.imageUrl : src
    let generated: DesignResult[] = [], recommendations: WorkflowAsset[] = [], matches: RankedResult[] = [], count = 0
    if (runMode === 'twin') { generated = await DesignImages.twin(executionSrc, parameters.style || 'smoked', parameters.strength ?? 78, options); count = generated.length }
    else {
      options.onProgress({ fraction: .1, phase: '检索候选' }); await new Promise<void>(resolve => setTimeout(resolve, 420)); S.checkDesignCancelled(options)
      if (runMode === 'compare') {
        const result = await searchTextures(executionSrc, (searchScope.value === 'mine' ? S.assets.filter(S.isLibraryAsset) : S.formalSamples()), parameters.searchRegion, parameters.limit, {...options,scope:searchScope.value,publicIds:S.base.map(a=>a.id)})
        if (!result.matches.length && result.skipped) throw Error('本地样例图片无法读取，请检查原图后重试')
        matches = result.matches; count = matches.length
      }
      else { recommendations = S.recommend(parameters.direction || '', parameters.candidateCount || 3, S.formalSamples()); count = recommendations.length }
    }
    S.checkDesignCancelled(options); options.onProgress({ fraction: .99, phase: '保存任务状态' })
    // 保留本次排序及分数，只移除已删除或撤回采用的候选，并读取最新资料。
    const refreshCandidates = () => {
      const available = new Map((runMode === 'compare' && parameters.searchScope === 'mine' ? S.assets.filter(S.isLibraryAsset) : S.formalSamples()).map(asset => [asset.id, asset]))
      if (runMode === 'compare') {
        matches = matches.flatMap(item => { const sample = available.get(item.sample.id); return sample ? [{ ...item, sample }] : [] })
        count = matches.length
      } else if (runMode === 'generate') {
        recommendations = recommendations.flatMap(item => { const sample = available.get(item.id); return sample ? [sample] : [] })
        count = recommendations.length
      }
    }
    const completionStatus = () => startedTask!.input?.kind === 'library' && !S.all().some(asset => asset.id === startedTask!.sampleId) ? '源样例已删除' : count ? '已处理' : '无匹配结果'
    refreshCandidates()
    // 保存本身也是异步操作；期间若有候选退出，修正数量后再发布结果。
    let savedCount: number, savedStatus: ReturnType<typeof completionStatus>
    do {
      savedCount = count; savedStatus = completionStatus()
      await S.updateTask(startedTask.id, { status: savedStatus, outputCount: savedCount, completedAt: new Date().toISOString(), error: '' })
      refreshCandidates()
    } while (savedCount !== count || savedStatus !== completionStatus())
    if (isCurrent()) {
      imageResults.value = generated; rankedResults.value = matches; recommended.value = recommendations; executed.value = true
      if (runMode === 'generate') executionError.value = !count ? '没有匹配样例；支持材质、色系及风格关键词，例如浅色橡木、深色胡桃、黑色石纹。' : count < (parameters.candidateCount || 3) ? `匹配不足，实际找到 ${count} 个候选。` : ''
    }
  } catch (reason) {
    const cancelled = reason instanceof Error && reason.name === 'AbortError'
    let text = cancelled ? '任务已取消，可重新执行。' : `任务执行失败：${errorMessage(reason)}`
    if (startedTask) {
      try { await S.updateTask(startedTask.id, { status: cancelled ? '已取消' : '执行失败', error: text, completedAt: new Date().toISOString() }) }
      catch (saveError) { text += `；任务状态保存失败：${errorMessage(saveError)}` }
    }
    if (isCurrent()) { executionError.value = text; designError = text }
  } finally {
    S.finishDesignRun(runKey); jobs.delete(revision)
    if (!jobs.size) { deferredUploadUrls.forEach(url => URL.revokeObjectURL(url)); deferredUploadUrls.clear() }
    if (isCurrent()) busy.value = false
    syncStatus()
  }
}
function cancel() { const running = progress.value; if (running && running.phase !== '保存任务状态') { running.controller.abort(); syncStatus() } }
function imageParameters(result: DesignResult): DesignParameters {
  return { mode: mode.value, sourceKind: sourceKind.value, sourceName: sourceName.value,
    ...(sourceKind.value === 'library' ? { sourceId: source.value?.id } : {}),
    completion: completion.value, style: targetStyle.value, strength: strength.value, outputWidth: result.width, outputHeight: result.height,
    ...(mode.value === 'twin' ? { structureSimilarity: result.similarity, similarityError: result.similarityError } : {}) }
}
function engineeringParameters(sample: WorkflowAsset): DesignParameters {
  const p = sample.parameters
  return p?.engineering ? { engineering: p.engineering, outputWidth: p.outputWidth, outputHeight: p.outputHeight } : {}
}
function hex(summary: ImageSummary) { return '#' + [summary.averageRgb.r, summary.averageRgb.g, summary.averageRgb.b].map(value => Math.round(value).toString(16).padStart(2, '0')).join('').toUpperCase() }
onMounted(() => {
  window.addEventListener('dilong-open', onOpen); window.addEventListener('dilong-asset-deleted', onDeleted); window.addEventListener('dilong-asset-updated', onUpdated)
  void S.ready.then(() => { if (!inputTouched && !selected.value && !uploadedUrl.value && !currentTaskId.value) void restoreDemo() })
})
onBeforeUnmount(() => { unsubscribe(); window.removeEventListener('dilong-open', onOpen); window.removeEventListener('dilong-asset-deleted', onDeleted); window.removeEventListener('dilong-asset-updated', onUpdated); clearUpload(); designRevision++ })
</script>

<template>
  <div class="platform-page design-page">
    <div class="page-kicker">DESIGN AGENT WORKSPACE</div><div class="module-title-row design-heading"><div><h1>设计智能体</h1><p>可从样例库选择或上传客户来样，完成真实图像比对、纹理补全与结构保持风格迁移。</p></div><span class="truth-chip"><CheckCircle2 :size="14"/>当前输出：本地图像算法实算</span></div>
    <div class="design-mode-grid mode-grid"><button v-for="item in modes" :key="item.key" :data-design-mode="item.key" type="button" :class="['mode-card', { active: mode === item.key }]" :disabled="working" @click="chooseMode(item.key)"><span class="mode-icon"><component :is="item.icon" :size="20" /></span><span><strong>{{ item.name }}</strong><small>{{ item.description }}</small></span><ArrowUpRight :size="16" class="mode-arrow" /></button></div>
    <div v-if="sourceKind === 'library' && source?.candidateReview?.status === 'adjust'" class="task-info" role="status"><strong>待调整方案：{{ source.name }}</strong><p>{{ source.candidateReview.note || '尚未填写调整意见，请选择处理方式后继续设计。' }}</p><small>此处以该候选图片继续设计，原方案和评价记录保留。</small></div><div v-if="(task || taskDeleted) && (mode!=='complete' || taskDeleted || task?.resultIds.length || ['源样例已删除','执行失败','已取消','已中断','状态待确认'].includes(task?.status||''))" class="task-info" role="status"><template v-if="task"><div><strong>当前任务：{{ task.title }}</strong><span>{{ task.status }} · {{ task.outputCount ?? 0 }} 个处理结果 · 已保存 {{ task.resultIds.length }} 个候选</span></div><p v-if="missingSource">源样例已删除，仍可查看和评价已保存候选。重新设计请先选择新输入。<button type="button" @click="S.navigate('samples')">选择新样例</button></p><p v-else-if="['已中断', '状态待确认'].includes(task.status)">{{ task.error }} 点击“重新执行”重试。</p></template><span v-else>此任务记录已删除；已保存候选仍在方案评价中，重新执行会创建新任务。</span></div>
    <div class="design-workspace" :class="{'completion-workspace':mode==='complete'}">
      <Panel class="design-source source-panel" :class="{'source-compact':mode==='complete'}" :data-input-ready="!!completionInput&&!reading" title="选择输入样例" eyebrow="STEP 01" description="样例库或本地上传">
        <div class="source-tabs"><button type="button" :class="{ active: sourceKind === 'library' }" :disabled="working" @click="chooseSourceKind('library')">从样例库选择</button><button type="button" :class="{ active: sourceKind === 'upload' }" :disabled="working" @click="chooseSourceKind('upload')">上传图片</button></div>
        <label v-if="sourceKind === 'library'" class="design-field"><select :value="source?.id || ''" :disabled="working" aria-label="设计输入样例" @change="chooseSample"><option v-if="missingSource" :value="source?.id">{{ sourceName }}（源样例已删除）</option><option v-if="!missingSource && source && !S.isLibraryAsset(source)" :value="source.id">{{ source.name }}（当前候选 · 未入库）</option><option v-for="sample in samples" :key="sample.id" :value="sample.id">{{ sample.id }} · {{ sample.name }}</option></select></label>
        <div v-else class="upload-box" @dragover.prevent @drop.prevent="event => upload(event.dataTransfer?.files[0])"><Upload :size="21" /><button type="button" :disabled="working" @click="fileInput?.click()">选择或拖入图片</button><small>{{ reading ? '正在读取图片…' : uploadedName || '支持 PNG、JPG、WebP' }}</small><input ref="fileInput" class="file-hidden" type="file" accept="image/png,image/jpeg,image/webp" :disabled="working" @change="fileChanged" /></div>
        <div class="source-image"><BigImageViewer v-if="sourceUrl" :src="sourceUrl" :preview-src="sourceKind === 'library' ? source?.thumbnailUrl : undefined" :alt="sourceName" eager /><div v-else class="source-empty"><ImagePlus :size="31" /><span>{{ missingSource ? '源样例已删除' : '等待上传图片' }}</span></div><span class="source-id">{{ sourceKind === 'upload' ? uploadedName === DEMO_SEARCH_NAME ? '演示来样' : '客户来样' : source?.id }}</span></div>
        <EngineeringExportButton v-if="sourceUrl" :compact="mode==='complete'" :src="sourceUrl" :name="sourceName" :project="sourceKind === 'library' ? source?.parameters?.engineering : undefined"/>
        <dl v-if="mode !== 'complete' && sourceKind === 'library' && source"><div><dt>木种</dt><dd>{{ source.wood }}</dd></div><div><dt>风格</dt><dd>{{ source.style }}</dd></div><div><dt>色系</dt><dd>{{ source.tone }}</dd></div></dl>
        <dl v-else-if="mode !== 'complete' && uploadedSummary"><div><dt>平均色</dt><dd>{{ hex(uploadedSummary) }}</dd></div><div><dt>明暗值</dt><dd>{{ uploadedSummary.brightness }}</dd></div><div><dt>纹理密度</dt><dd>{{ uploadedSummary.textureDensity }}</dd></div></dl>
        <p v-if="uploadError" class="design-error" role="alert">{{ uploadError }}</p><div v-if="mode!=='complete'" class="source-note"><ShieldCheck :size="14" /><span>{{ sourceKind === 'library' ? '输入来自公共样例或本地样例库' : '图片在浏览器本地处理，任务保存完整输入快照' }}</span></div>
      </Panel>
      <CompletionWorkflow v-if="mode === 'complete'" :src="sourceUrl" :name="sourceName" :input="completionInput" :task-id="currentTaskId" :restore-key="restoreKey" :missing="missingSource" :disabled="reading" @busy="completionBusy=$event" @task="currentTaskId=$event"/>
      <Panel v-if="mode !== 'complete'" class="design-config config-panel" :title="activeMode.name" eyebrow="STEP 02" description="配置图像任务参数">
        <template v-if="mode === 'compare'"><label class="design-field">搜图范围<select v-model="searchScope" aria-label="搜图范围" :disabled="working" @change="invalidate"><option value="all">全部样例</option><option value="mine">我的样例</option></select></label><button type="button" class="btn btn-secondary" :disabled="working" @click="restoreDemo">恢复演示来样</button><label class="design-field">返回数量 <b>{{ limit }} 条</b><input v-model.number="limit" type="range" min="3" max="20" :disabled="working" @input="invalidate" /></label><ImageRegionEditor v-if="sourceUrl" v-model="region" :src="sourceUrl" :disabled="working" compact :preview-size="180" @edit="invalidate"/></template>
        <template v-else-if="mode === 'twin'"><label class="design-field">目标风格<select v-model="targetStyle" :disabled="working" @change="invalidate"><option value="smoked">烟熏胡桃</option><option value="warmGrey">暖灰中古</option><option value="lightNatural">浅色自然</option><option value="redBrown">红棕复古</option></select></label><label class="design-field">色彩迁移强度 <b>{{ strength }}%</b><input v-model.number="strength" type="range" min="35" max="95" :disabled="working" @input="invalidate" /></label><div class="config-note">保留原始纹理结构，按强度调整综合色，生成三个完整分辨率候选。</div></template>
        <template v-else><label class="design-field">设计方向<textarea v-model="direction" rows="4" :disabled="working" @input="invalidate" /></label><label class="design-field">候选方案数量<select v-model.number="candidateCount" :disabled="working" @change="invalidate"><option :value="3">3 个方案</option><option :value="4">4 个方案</option></select></label><div class="config-note">支持材质、色系及风格关键词，例如“浅色自然橡木”。未匹配时不会用无关图片补足数量。</div></template>
        <button type="button" class="run-button" :disabled="working || reading || missingSource || !sourceUrl" @click="run"><LoaderCircle v-if="busy" :size="16" class="spin" /><Play v-else :size="16" />{{ busy ? '正在执行…' : runLabel }}</button><div class="execution-label"><ShieldCheck :size="13" />{{ executionLabel }}</div><p v-if="executionError" class="design-error" role="alert">{{ executionError }}</p>
      </Panel>
      <Panel v-if="mode !== 'complete'" class="design-results results-panel" title="候选结果" eyebrow="STEP 03" :description="busy ? '正在计算图像候选' : showTaskResults ? '已保存的任务结果' : executed ? '保存候选供评价，采用后进入样例库' : '完成配置后执行任务'">
        <div v-if="busy" class="result-waiting"><LoaderCircle :size="30" class="spin" /><strong>正在计算图像结果</strong><template v-if="progress"><span role="status">{{ progress.controller.signal.aborted ? '正在取消，等待当前处理步骤结束…' : `${progress.phase} · ${Math.floor(progress.fraction * 100)}%` }}</span><progress aria-label="设计任务进度" :value="progress.fraction" max="1" /><button type="button" :disabled="progress.controller.signal.aborted || progress.phase === '保存任务状态'" @click="cancel">取消任务</button></template></div>
        <TaskSavedResults v-else-if="showTaskResults" :task-id="currentTaskId" />
        <div v-else-if="executed && mode === 'compare'" class="candidate-grid"><article v-for="(result, index) in rankedResults" :key="result.sample.id" class="candidate-card"><div class="candidate-image"><BigImageViewer :src="result.sample.imageUrl" :preview-src="result.sample.thumbnailUrl" :alt="result.sample.name" /><span class="candidate-letter">{{ String.fromCharCode(65 + index) }}</span></div><div class="candidate-copy"><div class="candidate-title"><strong>{{ result.sample.name }}</strong><em>排序 {{ String(index+1).padStart(2,'0') }}</em></div><CandidateSaveButton :src="result.sample.imageUrl" :name="`${result.sample.name} · 检索候选`" source="相似检索" :source-key="result.sample.id" :task-id="currentTaskId" :parameters="{ ...engineeringParameters(result.sample), wood: result.sample.wood, style: result.sample.style, tone: result.sample.tone }" /><EngineeringExportButton :src="result.sample.imageUrl" :name="result.sample.name" :project="result.sample.parameters?.engineering"/></div></article><p v-if="!rankedResults.length" class="result-empty">当前范围没有可比较的正式样例，请切换范围或导入样例。</p></div>
        <div v-else-if="executed && mode === 'twin'" class="candidate-grid"><article v-for="(result, index) in imageResults" :key="`${candidateRun}-${index}`" class="candidate-card"><div class="candidate-image"><BigImageViewer :src="result.url" :preview-src="result.thumbnailUrl" :alt="`结构保留候选 ${String.fromCharCode(65+index)}`"/><span class="candidate-letter">{{String.fromCharCode(65+index)}}</span></div><div class="candidate-copy"><div class="candidate-title"><strong>结构保留候选 {{String.fromCharCode(65+index)}}</strong></div><p class="similarity" :title="result.similarityError || '原图与候选的全分辨率灰度 SSIM，明暗变化也会影响；负值显示 0%。'">{{scoreLabel(result.similarity)}}</p><p>{{['轻度综合色迁移','中度综合色迁移','鲜明目标色迁移'][index]}}</p><small class="image-dimensions">{{result.width}} × {{result.height}} · 完整分辨率 PNG</small><CandidateSaveButton :src="result.url" :name="`twin ${index+1}`" source="twin" :source-key="`twin-${candidateRun}-${index}`" :task-id="currentTaskId" :parameters="imageParameters(result)"/><EngineeringExportButton :src="result.url" :name="sourceName+' · '+activeMode.name"/></div></article></div>
        <div v-else-if="executed && mode === 'generate'" class="candidate-grid"><article v-for="(result, index) in recommended" :key="result.id" class="candidate-card"><div class="candidate-image"><BigImageViewer :src="result.imageUrl" :preview-src="result.thumbnailUrl" :alt="result.name" /><span class="candidate-letter">{{ String.fromCharCode(65 + index) }}</span></div><div class="candidate-copy"><div class="candidate-title"><strong>{{ result.name }}</strong></div><p>{{ result.style }} · {{ result.tone }}</p><CandidateSaveButton :src="result.imageUrl" :name="`${result.name} · 推荐候选`" source="示例推荐" :source-key="`recommend-${result.id}`" :task-id="currentTaskId" :parameters="{ ...engineeringParameters(result), direction, wood: result.wood, style: result.style, tone: result.tone }" /><EngineeringExportButton :src="result.imageUrl" :name="result.name" :project="result.parameters?.engineering"/></div></article><p v-if="!recommended.length" class="result-empty">没有匹配样例，请调整设计方向后重试。</p></div>
        <div v-else class="result-waiting"><span class="waiting-icon"><component :is="activeMode.icon" :size="28" /></span><strong>配置完成后开始执行</strong><span>{{ mode === 'compare' ? '在所选正式图库中检索相似纹理结构' : mode === 'twin' ? '保留原始纹理结构，探索不同综合色方案' : '从现有样例库筛选符合方向的候选' }}</span></div>
        <details class="result-truth"><summary>处理方式与说明</summary><p>{{ truth }}</p></details>
      </Panel>
    </div>
  </div>
</template>

<style scoped>
@reference "../assets/css/style.css";
.design-page .page-kicker {
  @apply mb-[10px]
}
.design-heading {
  @apply mb-[24px]
}
.mode-grid {
  grid-template-columns:repeat(auto-fit,minmax(170px,1fr));
  @apply mb-[20px]
}
.mode-card {
  @apply relative;
  @apply flex;
  @apply items-center;
  @apply gap-[12px];
  @apply min-w-[0];
  @apply text-left
}
.mode-icon {
  @apply flex;
  @apply items-center;
  color: #64878b
}
.mode-card strong {
  @apply block;
  @apply text-[14px]
}
.mode-card small {
  @apply block;
  @apply text-[11px];
  color: var(--muted);
  @apply mt-[6px]
}
.mode-arrow {
  @apply ml-[auto];
  @apply w-[14px]
}
.mode-card.active {
  background: #edf5f5;
  @apply [border-color:#145f65];
  box-shadow: inset 4px 0 #145f65
}
.design-workspace>.panel {
  @apply p-[18px];
  box-shadow: none
}
.design-workspace>.panel :deep(.panel-header) {
  @apply [padding:0_0_16px];
  @apply min-h-[0];
  @apply mb-[16px]
}
.design-workspace>.panel :deep(.panel-content) {
  @apply p-[0]
}
.design-field {
  @apply block;
  @apply text-[12px];
  color: var(--muted);
  @apply [margin:0_0_16px]
}
.design-field select,.design-field textarea {
  @apply block;
  @apply w-[100%];
  @apply mt-[8px];
  @apply [border:1px_solid_var(--line-strong)];
  @apply [padding:10px_12px];
  @apply rounded-[0];
  background: var(--surface);
  color: var(--ink);
  @apply text-[12px]
}
.design-field b {
  @apply block;
  color: var(--teal);
  font: 10px var(--font-mono);
  @apply [margin:6px_0]
}
.design-field input[type=range] {
  @apply w-[100%];
  accent-color: #145f65
}
.source-tabs {
  @apply flex;
  @apply gap-[4px];
  @apply p-[3px];
  background: #edf1f1;
  @apply mb-[8px]
}
.source-tabs button {
  flex: 1;
  @apply [padding:10px_4px];
  color: #7f8f90;
  @apply text-[11px];
  @apply [border:0];
  background: none
}
.source-tabs button.active {
  background: white;
  color: #145f65;
  @apply font-[600];
  box-shadow: 0 1px 2px #17393b20
}
.source-image {
  @apply relative;
  @apply h-[220px];
  background: #e6eceb;
  @apply overflow-hidden
}
.source-id {
  @apply absolute;
  @apply left-[7px];
  @apply bottom-[7px];
  color: white;
  background: #263c3fdf;
  @apply [padding:4px_7px];
  font: 10px var(--font-mono);
  @apply max-w-[75%];
  @apply overflow-hidden;
  @apply text-ellipsis;
  @apply whitespace-nowrap;
  pointer-events: none
}
.source-panel dl {
  @apply [margin:18px_0_0]
}
.source-panel dl>div {
  @apply flex;
  @apply justify-between;
  @apply gap-[10px];
  @apply [border-bottom:1px_solid_#e5eceb];
  @apply [padding:11px_0];
  @apply text-[12px]
}
.source-panel dt {
  color: var(--muted)
}
.source-panel dd {
  @apply m-[0];
  @apply font-[600]
}
.source-note {
  @apply flex;
  @apply gap-[6px];
  @apply [padding:12px_9px];
  background: #edf7f3;
  @apply text-[11px];
  color: #25756d;
  @apply mt-[14px];
  @apply leading-[1.7]
}
.source-note svg {
  flex: none;
  @apply w-[13px];
  @apply mt-[2px]
}
.upload-box {
  @apply [padding:14px_10px];
  @apply [border:1px_dashed_var(--line-strong)];
  @apply text-[12px];
  @apply flex;
  @apply gap-[8px];
  @apply flex-col;
  @apply items-center;
  @apply mb-[12px]
}
.upload-box small {
  @apply text-[10px];
  color: var(--muted);
  @apply wrap-anywhere
}
.file-hidden {
  @apply hidden
}
.source-empty {
  @apply h-[100%];
  @apply flex;
  @apply flex-col;
  @apply items-center;
  @apply justify-center;
  @apply gap-[10px];
  color: var(--muted);
  @apply text-[12px]
}
.dimension-list {
  @apply flex;
  @apply gap-[5px];
  @apply mb-[14px];
  @apply flex-wrap
}
.dimension-list span {
  background: #eff4f4;
  @apply [padding:6px_7px];
  @apply text-[8px];
  color: #7a9295
}
.config-note {
  @apply text-[11px];
  @apply leading-[1.8];
  background: #f2f6f6;
  @apply p-[12px];
  color: var(--muted)
}
.run-button {
  @apply w-[100%];
  @apply flex;
  @apply items-center;
  @apply justify-center;
  @apply gap-[7px];
  background: #145f65;
  color: white;
  @apply [border:0];
  @apply rounded-[2px];
  @apply text-[14px];
  @apply [padding:12px_5px]
}
.execution-label {
  @apply flex;
  @apply items-center;
  @apply justify-center;
  @apply gap-[5px];
  @apply text-[11px];
  color: var(--muted);
  @apply mt-[12px]
}
.task-info {
  background: #f3f8f8;
  @apply [border:1px_solid_var(--line-strong)];
  @apply p-[12px];
  @apply text-[12px];
  @apply [margin:0_0_16px]
}
.task-info>div {
  @apply flex;
  @apply justify-between;
  @apply gap-[12px];
  @apply flex-wrap
}
.task-info p {
  @apply text-[11px];
  @apply leading-[1.7];
  @apply [margin:8px_0_0]
}
.task-info button {
  color: var(--teal);
  @apply ml-[8px]
}
.design-error {
  color: #a13e24;
  @apply text-[12px];
  @apply leading-[1.8];
  @apply [margin:12px_0];
  @apply wrap-anywhere
}
.result-waiting {
  @apply h-[300px];
  @apply min-h-[300px];
  @apply flex;
  @apply flex-col;
  @apply items-center;
  @apply justify-center;
  @apply text-center;
  @apply gap-[10px];
  background: #f6f9f9;
  @apply [border:1px_dashed_#c7d5d5];
  color: #819496;
  @apply text-[12px]
}
.result-waiting>strong {
  @apply text-[12px];
  color: #37585c
}
.result-waiting>span:last-child {
  @apply max-w-[95%];
  @apply leading-[1.8]
}
.result-waiting progress {
  @apply w-[85%];
  accent-color: #145f65
}
.waiting-icon {
  @apply flex;
  @apply items-center;
  @apply justify-center;
  color: #779b9e
}
.result-truth {
  @apply items-start;
  @apply gap-[8px];
  background: #eaf6f1;
  color: #247968;
  @apply p-[16px];
  @apply mt-[16px];
  @apply text-[11px]
}
.result-truth summary {
  cursor:pointer;
}
.result-truth strong {
  @apply text-[12px]
}
.result-truth p {
  color: #75938b;
  @apply leading-[1.8];
  @apply mt-[3px]
}
.candidate-grid {
  @apply grid;
  @apply grid-cols-[repeat(auto-fit,minmax(185px,1fr))];
  @apply gap-[12px]
}
.candidate-card {
  @apply min-w-[0];
  background: var(--surface);
  @apply [border:1px_solid_var(--line-strong)]
}
.candidate-image {
  @apply h-[150px];
  @apply relative;
  background: #e8eeed
}
.candidate-image.completion {
  @apply h-[125px]
}
.candidate-letter {
  @apply absolute;
  @apply left-[8px];
  @apply top-[8px];
  @apply [padding:4px_7px];
  background: #253b3de8;
  color: white;
  font: 10px var(--font-mono);
  pointer-events: none
}
.candidate-copy {
  @apply p-[12px]
}
.candidate-title {
  @apply flex;
  @apply justify-between;
  @apply gap-[5px];
  @apply text-[12px]
}
.candidate-title em {
  @apply text-[10px];
  @apply whitespace-nowrap;
  color: #145f65;
  font-style: normal
}
.candidate-copy>p {
  @apply text-[11px];
  @apply leading-[1.7];
  color: var(--muted);
  @apply [margin:8px_0]
}
.score-grid {
  @apply flex;
  @apply gap-[5px];
  @apply justify-between;
  @apply text-[9px];
  @apply [padding:9px_0];
  color: var(--muted)
}
.score-grid b {
  color: var(--ink)
}
.continue-design { @apply w-full mt-3 text-xs; }
.image-dimensions {
  @apply text-[10px];
  color: var(--muted);
  @apply block;
  @apply [margin:10px_0]
}
.result-empty {
  @apply p-[30px];
  color: var(--muted);
  @apply text-[12px]
}
.similarity {
  color: #145f65!important
}
@media(max-width:760px){
.design-workspace>.panel {
  @apply p-[15px]
}
.design-heading {
  @apply mb-[18px]
}
.candidate-grid {
  @apply grid-cols-[1fr]
}
.design-field textarea {
  @apply min-h-[90px]
}}
.design-page .design-workspace:not(.completion-workspace) { align-items:stretch; }
.design-workspace:not(.completion-workspace)>.panel { display:flex;flex-direction:column;min-height:560px; }
.design-workspace:not(.completion-workspace)>.panel :deep(.panel-content) { display:flex;flex-direction:column;flex:1;min-height:0; }
.design-workspace>.panel :deep(.panel-header) { min-height:64px;box-sizing:border-box; }
.design-workspace:not(.completion-workspace) .source-image { height:180px;flex-shrink:0; }
.design-workspace:not(.completion-workspace) .upload-box { display:grid;grid-template-columns:24px minmax(0,1fr);column-gap:8px;row-gap:4px;padding:10px; }
.design-workspace:not(.completion-workspace) .upload-box>svg { grid-column:1;grid-row:1/span 2; }
.design-workspace:not(.completion-workspace) .upload-box>button,.design-workspace:not(.completion-workspace) .upload-box>small { grid-column:2;min-width:0;overflow-wrap:anywhere; }
.design-workspace:not(.completion-workspace) .source-panel dl { display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:6px;margin-top:14px; }
.design-workspace:not(.completion-workspace) .source-panel dl>div { display:block;padding:8px 4px;border-bottom:0;background:var(--surface-soft,var(--surface));min-width:0; }
.design-workspace:not(.completion-workspace) .source-panel dt { font-size:10px; }
.design-workspace:not(.completion-workspace) .source-panel dd { font-size:11px;margin-top:6px;overflow-wrap:anywhere; }
.design-workspace:not(.completion-workspace) .source-note { margin-top:auto;padding:10px; }
.design-workspace:not(.completion-workspace) .config-panel .run-button { margin-top:auto; }
.design-workspace:not(.completion-workspace) .results-panel .result-waiting { flex:1;height:auto;min-height:280px; }
.design-workspace:not(.completion-workspace) .results-panel :deep(.panel-content) { contain:size; }
.design-workspace:not(.completion-workspace) .results-panel .candidate-grid,.design-workspace:not(.completion-workspace) .results-panel :deep(.saved-results) { flex:1;height:0;min-height:0;overflow:auto;align-content:start; }
@media(max-width:760px){.design-workspace:not(.completion-workspace)>.panel{min-height:0;}.design-workspace:not(.completion-workspace) .results-panel :deep(.panel-content){contain:none;}.design-workspace:not(.completion-workspace) .config-panel .run-button,.design-workspace:not(.completion-workspace) .source-note{margin-top:14px;}.design-workspace:not(.completion-workspace) .results-panel .candidate-grid,.design-workspace:not(.completion-workspace) .results-panel :deep(.saved-results){height:auto;flex:none;overflow:visible;}}
.design-page .design-workspace.completion-workspace { display:grid;grid-template-columns:240px minmax(0,1fr);grid-template-rows:max-content minmax(0,1fr) auto;gap:18px;align-items:stretch; }
.design-page .completion-workspace>.source-panel { grid-column:1;grid-row:1;@apply rounded-lg p-4; }
.design-page .completion-workspace>.source-panel { min-height:0;height:auto; }
.source-compact .source-image { @apply h-44 rounded-md; }
.source-compact .upload-box { @apply px-2 py-3 gap-2 rounded-md; }
.source-compact .upload-box>svg { @apply hidden; }
.source-compact .upload-box small { @apply text-[10px] max-w-full truncate; }
.source-compact :deep(.engineering-export-button) { @apply mt-3; }
@media(max-width:1000px) and (min-width:761px){.design-page .design-workspace.completion-workspace{grid-template-columns:210px minmax(0,1fr);gap:14px;}}
@media(max-width:760px){.design-page .design-workspace.completion-workspace{grid-template-columns:minmax(0,1fr);grid-template-rows:none;}.design-page .completion-workspace>.source-panel{grid-column:1;grid-row:auto;}.source-compact .source-image{@apply h-40;}.source-compact .upload-box{@apply py-2;}}
/* Long names remain readable within the existing layout. */
.task-info { @apply min-w-0 wrap-anywhere; } .task-info strong { @apply min-w-0; }
</style>
