<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, shallowRef, watch } from 'vue'
import { Modal } from 'ant-design-vue'
import { ChevronLeft, ChevronRight, Download, Upload, Search, ArrowUpRight, SlidersHorizontal, Database, CircleCheck, X } from 'lucide-vue-next'
import Panel from '../components/Panel.vue'
import BigImageViewer from '../components/BigImageViewer.vue'
import CandidateReview from '../components/CandidateReview.vue'
import ImageSearchPanel from '../components/ImageSearchPanel.vue'
import EngineeringExportButton from '../components/EngineeringExportButton.vue'
import { S } from '../services/workflows'
import type { WorkflowAsset, WorkflowOpenDetail } from '../services/types'
import { categories, filter, page as paginate } from '../core/sample-library'
import { groups, staffFields, productionFields } from '../core/sample-metadata'
import { useWorkflowStore } from '../stores/workflow'
import { useLibraryStore } from '../stores/library'
import { modelTextSearch } from '../services/model-design'

const archiveOpen = ref(false), imageSearchOpen = ref(false), imageSearchLoaded = ref(false)
const store = useWorkflowStore(), library = useLibraryStore(), selected = shallowRef<WorkflowAsset | null>(null)
const textMatches=shallowRef<WorkflowAsset[]|null>(null),textBusy=ref(false),textNotice=ref('')
let textController:AbortController|undefined
const samples = computed(() => S.librarySamples(store.all)), filtered = computed(() => {
  if(textMatches.value===null)return filter(samples.value, library.query, library.category, store.assets)
  const current=new Map(samples.value.map(row=>[row.id,row]))
  return filter(textMatches.value.flatMap(row=>{const latest=current.get(row.id);return latest?[latest]:[]}), '', library.category, store.assets)
})
const pagination = computed(() => paginate(filtered.value, library.currentPage))
const current = computed(() => store.all.find(asset => asset.id === selected.value?.id) || null)
const own = computed(() => store.assets.some(asset => asset.id === current.value?.id))
const operationMessage = computed(() => store.operations.delete?.message || store.operations.package?.message || '')
const inspector = ref<HTMLElement | null>(null), narrowInspector = ref(false)
let inspectorTrigger: HTMLElement | null = null
let inspectorMedia: MediaQueryList | undefined
function syncInspectorWidth() { narrowInspector.value = !!inspectorMedia?.matches }
function selectSample(asset: WorkflowAsset, event: MouseEvent) {
  inspectorTrigger = event.currentTarget as HTMLElement
  selected.value = asset
}
async function closeInspector() {
  selected.value = null
  await nextTick()
  const target = inspectorTrigger?.isConnected ? inspectorTrigger : document.querySelector<HTMLElement>('.library-search input')
  target?.focus({ preventScroll: true })
  inspectorTrigger = null
}
function inspectorKeydown(event: KeyboardEvent) {
  if (!narrowInspector.value || archiveOpen.value || event.defaultPrevented) return
  if (event.key === 'Escape') {
    event.preventDefault()
    event.stopPropagation()
    void closeInspector()
    return
  }
  if (event.key !== 'Tab') return
  const controls = [...(inspector.value?.querySelectorAll<HTMLElement>('button, a[href], input, select, textarea, summary, [tabindex]') || [])]
    .filter(element => element.tabIndex >= 0 && !element.matches(':disabled') && element.getClientRects().length > 0)
  const first = controls[0], last = controls.at(-1)
  if (!first || !last) { event.preventDefault(); inspector.value?.focus(); return }
  if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus() }
  else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus() }
}
watch([() => current.value?.id, narrowInspector, imageSearchOpen], ([id, narrow, search]) => {
  if (id && narrow && !search && !archiveOpen.value) inspector.value?.querySelector<HTMLElement>('.inspector-head button')?.focus({ preventScroll: true })
}, { flush: 'post' })
onMounted(() => {
  inspectorMedia = window.matchMedia('(max-width: 900px)')
  syncInspectorWidth()
  inspectorMedia.addEventListener('change', syncInspectorWidth)
})
onBeforeUnmount(() => { textController?.abort();inspectorMedia?.removeEventListener('change', syncInspectorWidth) })
watch([() => library.query, () => library.category], () => { textController?.abort();textController=undefined;textBusy.value=false;textMatches.value=null;textNotice.value='';library.currentPage = 1 })
async function searchText(){
  if(textBusy.value||!library.query.trim())return
  const controller=new AbortController();textController=controller;textBusy.value=true;textNotice.value=''
  try{
    const eligible=filter(samples.value,'',library.category,store.assets)
    const rows=await modelTextSearch(library.query,eligible,20,{signal:controller.signal})
    if(textController===controller){textMatches.value=rows.matches.map(row=>row.sample);library.currentPage=1;textNotice.value=rows.notice||(rows.matches.length?'':'没有找到符合描述的样例，请调整关键词。')}
  }catch(error){if(!controller.signal.aborted&&textController===controller){textMatches.value=null;textNotice.value='本次使用资料关键词筛选；图片比较未完成：'+(error as Error).message}}
  finally{if(textController===controller){textBusy.value=false;textController=undefined}}
}
watch(() => filtered.value.length, () => { library.currentPage = Math.min(library.currentPage, pagination.value.pages) })
function toggleImageSearch() { imageSearchLoaded.value = true; imageSearchOpen.value = !imageSearchOpen.value }
function navigatePage(value: number) { library.currentPage = value; document.querySelector('.library-results')?.scrollIntoView({ behavior: 'smooth', block: 'start' }) }
function openEvent(event: Event) { const detail = (event as CustomEvent<WorkflowOpenDetail>).detail; if (detail.page === 'samples') { selected.value = detail.sample; archiveOpen.value = true } }
function imported(event: Event) { const ids = (event as CustomEvent<{ ids: string[] }>).detail.ids; library.category = '我的样例'; library.query = ids.length === 1 ? ids[0]! : ''; library.currentPage = 1 }
onMounted(() => { window.addEventListener('dilong-open', openEvent); window.addEventListener('dilong-library-imported', imported) })
onBeforeUnmount(() => { window.removeEventListener('dilong-open', openEvent); window.removeEventListener('dilong-library-imported', imported) })
function use(asset: WorkflowAsset, target: 'design' | 'color') { archiveOpen.value = false; selected.value = null; S.open(target, asset) }
</script>
<template><div class="platform-page samples-page library-page"><div class="module-title-row"><div><h1>样例库</h1><p>管理纹理样例与生产档案，设计候选采用后入库。</p></div><div class="stage1-library-actions"><button type="button" class="btn btn-secondary" :aria-expanded="imageSearchOpen" @click="toggleImageSearch"><Search :size="16"/>{{imageSearchOpen?'收起以图搜图':'以图搜图'}}</button><button class="btn btn-secondary" :disabled="!store.personalSamples.length || store.operations.package?.state==='busy'" @click="S.exportPackage()"><Download :size="16"/>导出本地样例包</button><button class="btn btn-primary" @click="S.showPackage()"><Upload :size="16"/>导入样例文件包</button></div></div><p v-if="operationMessage" role="status" class="operation-message">{{operationMessage}}</p>
<ImageSearchPanel v-if="imageSearchLoaded" v-show="imageSearchOpen" @open="asset=>{selected=asset;archiveOpen=true}"/>
<section v-if="!imageSearchOpen" class="library-toolbar"><div class="library-search"><Search role="button" tabindex="0" aria-label="执行样例搜索" :aria-disabled="textBusy" @click="searchText" @keydown.enter.prevent="searchText" @keydown.space.prevent="searchText"/><input v-model="library.query" aria-label="搜索样例" placeholder="搜索编号、名称、风格或色系" title="输入后按回车或点击放大镜搜索" @keydown.enter.prevent="searchText"/></div><div class="filter-tabs library-categories"><button v-for="item in categories" :key="item" :class="{active:library.category===item}" @click="library.category=item">{{item}}</button></div><div class="library-count"><b>{{filtered.length}}</b><span>{{textBusy?'正在检索…':'条记录'}}</span></div></section><p v-if="textNotice" class="operation-message" role="status">{{textNotice}}</p>
<section v-if="!imageSearchOpen" class="library-layout" :class="{'inspector-idle':!current}"><div class="library-results"><div class="sample-grid"><button v-for="sample in pagination.rows" :key="sample.id" type="button" class="sample-card texture-card" :class="{selected:current?.id===sample.id}" :aria-pressed="current?.id===sample.id" :data-sample-id="sample.id" @click="selectSample(sample,$event)"><div class="sample-thumb texture-image"><img :src="sample.thumbnailUrl || sample.imageUrl" :alt="sample.name" loading="lazy" decoding="async"/></div><div class="sample-card-body"><div><span>{{sample.id}}</span><em>{{sample.isPublicTexture?'纹理素材':sample.layers+' 色层'}}</em></div><h2 class="texture-name">{{sample.name}}</h2><p>{{sample.wood}} · {{sample.style}} · {{sample.tone}}</p><div class="sample-tags"><span v-if="S.isCandidate(sample)">设计方案 · 已采用</span></div></div></button><div v-if="!pagination.rows.length" class="library-empty"><Search/><b>没有匹配的样例</b><span>请调整搜索词或材质筛选条件。</span></div></div><div class="library-pagination"><button class="btn btn-secondary" :disabled="pagination.current<=1" @click="navigatePage(pagination.current-1)">上一页</button><span class="pagination-position">{{pagination.current}} / {{pagination.pages}} 页</span><span class="pagination-count">{{filtered.length}} 条 · 每页 24 条</span><button class="btn btn-secondary" :disabled="pagination.current>=pagination.pages" @click="navigatePage(pagination.current+1)">下一页</button><label>跳至 <select :value="pagination.current" aria-label="跳转到页" @change="navigatePage(Number(($event.target as HTMLSelectElement).value))"><option v-for="value in pagination.pages" :key="value" :value="value">第 {{value}} 页</option></select></label></div></div>
<aside ref="inspector" aria-label="样例详情" :role="narrowInspector && current ? 'dialog' : undefined" tabindex="-1" @keydown="inspectorKeydown" class="sample-inspector" :class="{open:!!current}"><template v-if="current"><div class="inspector-head"><div><span>{{current.isPublicTexture?'公共纹理素材':'样例档案'}}</span><b>{{current.id}}</b></div><button aria-label="关闭样例档案" @click="closeInspector"><X :size="14"/></button></div><div v-if="own" class="stage1-inspector-actions"><button class="btn btn-secondary" @click="S.startEdit(current)">编辑信息</button><button class="btn btn-danger" @click="S.confirmDelete(current)">删除样例</button></div><div class="inspector-image"><BigImageViewer :src="current.imageUrl" :preview-src="current.thumbnailUrl" :alt="current.name"/></div><EngineeringExportButton :src="current.imageUrl" :name="current.name" :project="current.parameters?.engineering"/><h2>{{current.name}}</h2><div class="inspector-status"><span>{{current.status || '纹理素材'}}</span></div><dl><div><dt>{{current.isPublicTexture?'素材来源':'客户 / 项目'}}</dt><dd>{{current.isPublicTexture?current.source:current.customer || '未填写'}}</dd></div><div><dt>木种 / 材质</dt><dd>{{current.wood}}</dd></div><div><dt>风格 / 色系</dt><dd>{{current.style}} · {{current.tone}}</dd></div><div><dt>配色分析</dt><dd>{{current.analysis?.layerCount ?? '—'}} 层 · {{current.analysis?.averageHex || '—'}}</dd></div><div><dt>生产记录</dt><dd>{{current.productionRecords?.length || 0}} 个批次</dd></div><div><dt>{{current.isPublicTexture?'许可':'调墨师傅'}}</dt><dd>{{current.isPublicTexture?current.license:current.staff?.colorist || '未填写'}}</dd></div></dl><div v-if="!current.isPublicTexture" class="feedback-box"><span>最近生产反馈</span><p>{{current.feedback || '未填写'}}</p></div><div class="record-completeness"><div><span>档案状态</span><b>{{own?'可编辑':current.isPublicTexture?'纹理素材':current.status || '已入库'}}</b></div></div><button class="btn btn-primary inspector-action" @click="archiveOpen=true">查看完整样例档案 <ArrowUpRight :size="14"/></button></template><div v-else class="inspector-empty"><Database/><b>样例详情</b><span>选择样例后查看档案与生产记录</span></div></aside></section><div v-if="!imageSearchOpen" class="demo-data-note"><CircleCheck/><details><summary>数据说明</summary><p>公共样例包括100条示例档案与纹理素材。纹理素材保留来源与许可，业务资料待补充；个人样例保存在当前浏览器，通过样例包导入和导出。</p></details></div>
<Modal class="sample-archive-dialog dilong-theme" wrap-class-name="sample-archive-modal" :style="{top: '32px'}" :body-style="{maxHeight: 'calc(100dvh - 168px)', overflowY: 'auto', overscrollBehavior: 'contain'}" :open="archiveOpen && !!selected" :title="current?.name || '样例已删除'" :footer="null" :width="'min(1120px, calc(100vw - 32px))'" :destroy-on-close="true" @cancel="archiveOpen = false"><div v-if="current" class="sample-archive" :data-sample-id="current.id"><div class="module-toolbar"><span class="badge">{{ current.id }}</span><div class="button-row"><button v-if="S.isLibraryAsset(current)" class="btn btn-secondary" @click="use(current,'color')">用于配墨</button><button class="btn btn-primary" @click="use(current,'design')">用于设计</button><button v-if="own" class="btn btn-secondary" @click="S.startEdit(current)"><SlidersHorizontal :size="15" />编辑信息</button><button v-if="own" class="btn btn-danger" :disabled="store.operations.delete?.state === 'busy'" @click="S.confirmDelete(current)">删除样例</button></div></div><BigImageViewer class="archive-preview" eager :src="current.imageUrl" :preview-src="current.thumbnailUrl" :alt="current.name" /><p v-if="current.isPublicTexture || own" class="muted">{{ current.isPublicTexture ? '公开纹理素材不附带客户、生产配方或生产记录。' : own ? '个人样例的业务资料由用户填写，图像分析与配方为本地算法参考。' : '' }}</p><p v-if="S.isCandidate(current)" class="operation-message">{{ S.isLibraryAsset(current) ? '设计方案 · 已采用 · 已进入正式样例库' : '候选档案 · 未入库，仅供查看记录。请在方案评价中采用后入库。' }}</p><CandidateReview v-if="S.isCandidate(current)" :sample="current" /><section v-for="section in groups" :key="section.title" class="archive-section"><h3>{{ section.title }}</h3><dl class="archive-facts"><div v-for="[key,label] in section.fields" :key="key"><dt>{{ label }}</dt><dd>{{ current[key] || '未填写' }}</dd></div></dl></section><section class="archive-section"><h3>人员信息</h3><dl class="archive-facts"><div v-for="[key,label] in staffFields" :key="key"><dt>{{ label }}</dt><dd>{{ current.staff?.[key] || '未填写' }}</dd></div></dl></section><section class="archive-section"><h3>图像分析</h3><dl class="archive-facts"><div><dt>平均色</dt><dd>{{ current.analysis?.averageHex || '未记录' }}</dd></div><div><dt>明暗 / 纹理密度</dt><dd>{{ current.analysis?.brightness ?? '—' }} / {{ current.analysis?.textureDensity ?? '—' }}</dd></div><div><dt>识别色层</dt><dd>{{ current.analysis?.layerCount ?? '需运行配墨分析' }}</dd></div><div><dt>合成偏差（RGB）</dt><dd>{{ current.analysis?.reconstructionDifference ?? '—' }}</dd></div></dl><div v-if="current.analysis?.layers?.length" class="table-scroll"><table><thead><tr><th>色层</th><th>颜色</th><th>覆盖率</th><th>红 / 黄 / 蓝 / 黑 / 稀释剂</th></tr></thead><tbody><tr v-for="layer in current.analysis.layers" :key="layer.order"><td>{{ layer.name }}</td><td><i class="swatch" :style="{background:layer.hex}" />{{ layer.hex }}</td><td>{{ layer.coverage }}%</td><td>{{ layer.recipe.red }} / {{ layer.recipe.yellow }} / {{ layer.recipe.blue }} / {{ layer.recipe.black }} / {{ layer.recipe.thinner }}</td></tr></tbody></table></div></section><section class="archive-section"><h3>生产记录</h3><div v-if="current.productionRecords?.length" class="table-scroll"><table><thead><tr><th v-for="[key,label] in productionFields" :key="key">{{ label }}</th></tr></thead><tbody><tr v-for="(row,index) in current.productionRecords" :key="index"><td v-for="[key] in productionFields" :key="key">{{ row[key] || '未填写' }}</td></tr></tbody></table></div><p v-else class="muted">尚未提供生产记录。</p></section><section class="archive-section"><h3>评价与反馈</h3><p class="preserve-lines">{{ current.feedback || '未填写' }}</p></section><section class="archive-section"><h3>历史记录</h3><div v-for="(history,index) in current.history || []" :key="index" class="archive-history"><span class="muted">{{ history.date }} · {{ history.status }}</span><strong>{{ history.title }}</strong><p>{{ history.description }}</p></div><p v-if="!current.history?.length" class="muted">未记录。</p></section><section class="archive-section"><h3>素材来源</h3><p>{{ current.source }} · {{ current.license || '未记录许可' }}</p><div class="button-row"><a v-if="current.sourceUrl" :href="current.sourceUrl" target="_blank" rel="noopener noreferrer" class="text-link">查看来源 <ArrowUpRight :size="14" /></a><a v-if="current.licenseUrl" :href="current.licenseUrl" target="_blank" rel="noopener noreferrer" class="text-link">查看许可说明</a></div></section></div><p v-else role="alert">该样例已在其他页面删除，当前无法继续使用。</p></Modal></div></template>
<style scoped>
@reference "../assets/css/style.css";
.sample-archive {
  @apply grid;
  @apply gap-[18px]
}
.archive-section {
  @apply [border-top:1px_solid_var(--border)];
  @apply pt-[20px]
}
.archive-section h3 {
  @apply mb-[16px];
  @apply text-[16px]
}
.archive-facts {
  @apply grid;
  @apply grid-cols-[repeat(2,minmax(0,1fr))];
  @apply gap-[18px]
}
.archive-facts>div {
  @apply grid;
  @apply grid-cols-[110px_1fr];
  @apply gap-[8px]
}
.archive-facts dt {
  color: var(--muted);
  @apply text-[13px]
}
.archive-facts dd {
  @apply m-[0];
  @apply wrap-anywhere;
  @apply text-[13px]
}
.archive-history {
  @apply [padding:12px_0];
  @apply [border-bottom:1px_solid_var(--border)];
  @apply grid;
  @apply gap-[6px]
}
.archive-history span {
  @apply text-[13px]
}
.archive-history strong {
  @apply text-[14px]
}
.archive-history p {
  @apply text-[13px]
}
@media(max-width:600px){
.archive-facts {
  @apply grid-cols-[1fr]
}
.archive-facts>div {
  @apply grid-cols-[100px_1fr]
}}
</style>
