<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, shallowRef, watch } from 'vue'
import { Modal } from 'ant-design-vue'
import { ChevronLeft, ChevronRight, Download, Upload, Search, ArrowUpRight, SlidersHorizontal, Database, CircleCheck, X } from 'lucide-vue-next'
import Panel from '../components/Panel.vue'
import BigImageViewer from '../components/BigImageViewer.vue'
import CandidateReview from '../components/CandidateReview.vue'
import { S } from '../services/workflows'
import type { WorkflowAsset, WorkflowOpenDetail } from '../services/types'
import { categories, filter, page as paginate } from '../core/sample-library'
import { groups, staffFields, productionFields } from '../core/sample-metadata'
import { useWorkflowStore } from '../stores/workflow'
import { useLibraryStore } from '../stores/library'

const archiveOpen = ref(false)
const store = useWorkflowStore(), library = useLibraryStore(), selected = shallowRef<WorkflowAsset | null>(null)
const samples = computed(() => S.librarySamples(store.all)), filtered = computed(() => filter(samples.value, library.query, library.category, store.assets))
const pagination = computed(() => paginate(filtered.value, library.currentPage))
const current = computed(() => store.all.find(asset => asset.id === selected.value?.id) || null)
const own = computed(() => store.assets.some(asset => asset.id === current.value?.id))
const operationMessage = computed(() => store.operations.delete?.message || store.operations.package?.message || '')
watch([() => library.query, () => library.category], () => { library.currentPage = 1 })
watch(() => filtered.value.length, () => { library.currentPage = Math.min(library.currentPage, pagination.value.pages) })
function navigatePage(value: number) { library.currentPage = value; document.querySelector('.library-results')?.scrollIntoView({ behavior: 'smooth', block: 'start' }) }
function openEvent(event: Event) { const detail = (event as CustomEvent<WorkflowOpenDetail>).detail; if (detail.page === 'samples') { selected.value = detail.sample; archiveOpen.value = true } }
function imported(event: Event) { const ids = (event as CustomEvent<{ ids: string[] }>).detail.ids; library.category = '我的样例'; library.query = ids.length === 1 ? ids[0]! : ''; library.currentPage = 1 }
onMounted(() => { window.addEventListener('dilong-open', openEvent); window.addEventListener('dilong-library-imported', imported) })
onBeforeUnmount(() => { window.removeEventListener('dilong-open', openEvent); window.removeEventListener('dilong-library-imported', imported) })
function use(asset: WorkflowAsset, target: 'design' | 'color') { archiveOpen.value = false; selected.value = null; S.open(target, asset) }
</script>
<template><div class="platform-page samples-page library-page"><div class="page-kicker">SAMPLE ASSET LIBRARY</div><div class="module-title-row"><div><h1>样例库</h1><p>以“一个样例项目”为单位，关联原样、设计、配色、生产参数与反馈记录。</p></div><div class="stage1-library-actions"><button class="btn btn-secondary" :disabled="!store.assets.length || store.operations.package?.state==='busy'" @click="S.exportPackage()"><Download :size="16"/>导出本地样例包</button><button class="btn btn-primary" @click="S.showPackage()"><Upload :size="16"/>导入样例文件包</button></div></div><p v-if="operationMessage" role="status" class="operation-message">{{operationMessage}}</p>
<section class="library-toolbar"><div class="library-search"><Search/><input v-model="library.query" aria-label="搜索样例" placeholder="搜索编号、名称、风格或色系"/></div><div class="filter-tabs library-categories"><button v-for="item in categories" :key="item" :class="{active:library.category===item}" @click="library.category=item">{{item}}</button></div><div class="library-count"><b>{{filtered.length}}</b><span>条记录</span></div></section>
<section class="library-layout"><div class="library-results"><div class="sample-grid"><button v-for="sample in pagination.rows" :key="sample.id" type="button" class="sample-card texture-card" :data-sample-id="sample.id" @click="selected=sample"><div class="sample-thumb texture-image"><img :src="sample.thumbnailUrl || sample.imageUrl" :alt="sample.name" loading="lazy" decoding="async"/></div><div class="sample-card-body"><div><span>{{sample.id}}</span><em>{{sample.isPublicTexture?'纹理素材':sample.layers+' 色层'}}</em></div><h2 class="texture-name">{{sample.name}}</h2><p>{{sample.wood}} · {{sample.style}} · {{sample.tone}}</p><div class="sample-tags"><span>{{sample.source}}</span><span>{{sample.date}}</span></div></div></button><div v-if="!pagination.rows.length" class="library-empty"><Search/><b>没有匹配的样例</b><span>请调整搜索词或材质筛选条件。</span></div></div><div class="library-pagination"><button class="btn btn-secondary" :disabled="pagination.current<=1" @click="navigatePage(pagination.current-1)">上一页</button><span>第 {{pagination.current}} / {{pagination.pages}} 页 · 共 {{filtered.length}} 条 · 每页24条</span><button class="btn btn-secondary" :disabled="pagination.current>=pagination.pages" @click="navigatePage(pagination.current+1)">下一页</button><label>跳至 <select :value="pagination.current" aria-label="跳转到页" @change="navigatePage(Number(($event.target as HTMLSelectElement).value))"><option v-for="value in pagination.pages" :key="value" :value="value">第 {{value}} 页</option></select></label></div></div>
<aside class="sample-inspector" :class="{open:!!current}"><template v-if="current"><div class="inspector-head"><div><span>{{current.isPublicTexture?'公共纹理素材':'样例档案'}}</span><b>{{current.id}}</b></div><button aria-label="关闭样例档案" @click="selected=null"><X :size="14"/></button></div><div v-if="own" class="stage1-inspector-actions"><button class="btn btn-secondary" @click="S.startEdit(current)">编辑信息</button><button class="btn btn-danger" @click="S.confirmDelete(current)">删除样例</button></div><div class="inspector-image"><BigImageViewer :src="current.imageUrl" :preview-src="current.thumbnailUrl" :alt="current.name"/></div><h2>{{current.name}}</h2><div class="inspector-status"><span>{{current.status || '纹理素材'}}</span><small>{{current.isPublicTexture?'来源与许可已记录':own?'图片与分析已保存':'演示记录已建立'}}</small></div><dl><div><dt>{{current.isPublicTexture?'素材来源':'客户 / 项目'}}</dt><dd>{{current.isPublicTexture?current.source:current.customer || '未填写'}}</dd></div><div><dt>木种 / 材质</dt><dd>{{current.wood}}</dd></div><div><dt>风格 / 色系</dt><dd>{{current.style}} · {{current.tone}}</dd></div><div><dt>配色分析</dt><dd>{{current.analysis?.layerCount ?? '—'}} 层 · {{current.analysis?.averageHex || '—'}}</dd></div><div><dt>生产记录</dt><dd>{{current.productionRecords?.length || 0}} 个批次</dd></div><div><dt>{{current.isPublicTexture?'许可':'调墨师傅'}}</dt><dd>{{current.isPublicTexture?current.license:current.staff?.colorist || '未填写'}}</dd></div></dl><div class="feedback-box"><span>{{current.isPublicTexture?'来源说明':'最近生产反馈'}}</span><p>{{current.isPublicTexture?'公开纹理素材不附带客户、生产配方或生产记录。':current.feedback || '未填写'}}</p></div><div class="record-completeness"><div><span>档案完整度</span><b>{{own?'本地档案可编辑':current.isPublicTexture?'素材资料':'100%'}}</b></div><small>{{own?'可通过“编辑信息”补充客户、工艺、人员及实际生产记录。':'查看完整图片、来源和设计与配墨关联。'}}</small></div><button class="btn btn-primary inspector-action" @click="archiveOpen=true">查看完整样例档案 <ArrowUpRight :size="14"/></button></template><div v-else class="inspector-empty"><Database/><b>选择一条样例</b><span>查看其客户来样、配色、生产与人员记录。</span></div></aside></section><div class="demo-data-note"><CircleCheck/><span>公共样例包含原有100条演示档案与新增纹理素材；新增素材的客户、配方和生产资料未填写。来源重复的30张未再次添加。自行导入或保存的样例仅在当前浏览器保留，不会自动共享。</span></div>
<Modal :open="archiveOpen && !!selected" :title="current?.name || '样例已删除'" :footer="null" :width="1000" :destroy-on-close="true" @cancel="archiveOpen = false"><div v-if="current" class="sample-archive" :data-sample-id="current.id"><div class="module-toolbar"><span class="badge">{{ current.id }}</span><div class="button-row"><button class="btn btn-secondary" @click="use(current,'color')">用于配墨</button><button class="btn btn-primary" @click="use(current,'design')">用于设计</button><button v-if="own" class="btn btn-secondary" @click="S.startEdit(current)"><SlidersHorizontal :size="15" />编辑信息</button><button v-if="own" class="btn btn-danger" :disabled="store.operations.delete?.state === 'busy'" @click="S.confirmDelete(current)">删除样例</button></div></div><BigImageViewer :src="current.imageUrl" :preview-src="current.thumbnailUrl" :alt="current.name" /><p class="muted">{{ current.isPublicTexture ? '公开纹理素材不附带客户、生产配方或生产记录。' : own ? '个人样例的业务资料由用户填写，图像分析与配方为本地算法参考。' : '原有演示样例中的业务资料为演示数据。' }}</p><CandidateReview v-if="S.isCandidate(current)" :sample="current" /><section v-for="section in groups" :key="section.title" class="archive-section"><h3>{{ section.title }}</h3><dl class="archive-facts"><div v-for="[key,label] in section.fields" :key="key"><dt>{{ label }}</dt><dd>{{ current[key] || '未填写' }}</dd></div></dl></section><section class="archive-section"><h3>人员信息</h3><dl class="archive-facts"><div v-for="[key,label] in staffFields" :key="key"><dt>{{ label }}</dt><dd>{{ current.staff?.[key] || '未填写' }}</dd></div></dl></section><section class="archive-section"><h3>图像分析</h3><dl class="archive-facts"><div><dt>平均色</dt><dd>{{ current.analysis?.averageHex || '未记录' }}</dd></div><div><dt>明暗 / 纹理密度</dt><dd>{{ current.analysis?.brightness ?? '—' }} / {{ current.analysis?.textureDensity ?? '—' }}</dd></div><div><dt>识别色层</dt><dd>{{ current.analysis?.layerCount ?? '需运行配墨分析' }}</dd></div><div><dt>合成偏差（RGB）</dt><dd>{{ current.analysis?.reconstructionDifference ?? '—' }}</dd></div></dl><div v-if="current.analysis?.layers?.length" class="table-scroll"><table><thead><tr><th>色层</th><th>颜色</th><th>覆盖率</th><th>红 / 黄 / 蓝 / 黑 / 稀释剂</th></tr></thead><tbody><tr v-for="layer in current.analysis.layers" :key="layer.order"><td>{{ layer.name }}</td><td><i class="swatch" :style="{background:layer.hex}" />{{ layer.hex }}</td><td>{{ layer.coverage }}%</td><td>{{ layer.recipe.red }} / {{ layer.recipe.yellow }} / {{ layer.recipe.blue }} / {{ layer.recipe.black }} / {{ layer.recipe.thinner }}</td></tr></tbody></table></div></section><section class="archive-section"><h3>生产记录</h3><div v-if="current.productionRecords?.length" class="table-scroll"><table><thead><tr><th v-for="[key,label] in productionFields" :key="key">{{ label }}</th></tr></thead><tbody><tr v-for="(row,index) in current.productionRecords" :key="index"><td v-for="[key] in productionFields" :key="key">{{ row[key] || '未填写' }}</td></tr></tbody></table></div><p v-else class="muted">尚未提供生产记录。</p></section><section class="archive-section"><h3>评价与反馈</h3><p class="preserve-lines">{{ current.feedback || '未填写' }}</p></section><section class="archive-section"><h3>历史记录</h3><div v-for="(history,index) in current.history || []" :key="index" class="archive-history"><span class="muted">{{ history.date }} · {{ history.status }}</span><strong>{{ history.title }}</strong><p>{{ history.description }}</p></div><p v-if="!current.history?.length" class="muted">未记录。</p></section><section class="archive-section"><h3>素材来源</h3><p>{{ current.source }} · {{ current.license || '未记录许可' }}</p><div class="button-row"><a v-if="current.sourceUrl" :href="current.sourceUrl" target="_blank" rel="noopener noreferrer" class="text-link">查看来源 <ArrowUpRight :size="14" /></a><a v-if="current.licenseUrl" :href="current.licenseUrl" target="_blank" rel="noopener noreferrer" class="text-link">查看许可说明</a></div></section></div><p v-else role="alert">该样例已在其他页面删除，当前无法继续使用。</p></Modal></div></template>
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
  @apply text-[12px]
}
.archive-facts dd {
  @apply m-[0];
  @apply wrap-anywhere;
  @apply text-[12px]
}
.archive-history {
  @apply [padding:12px_0];
  @apply [border-bottom:1px_solid_var(--border)];
  @apply grid;
  @apply gap-[6px]
}
.archive-history span {
  @apply text-[11px]
}
.archive-history strong {
  @apply text-[13px]
}
.archive-history p {
  @apply text-[12px]
}
@media(max-width:600px){
.archive-facts {
  @apply grid-cols-[1fr]
}
.archive-facts>div {
  @apply grid-cols-[100px_1fr]
}}
</style>
