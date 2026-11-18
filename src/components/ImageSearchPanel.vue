<script setup lang="ts">
import { computed, onBeforeUnmount, ref, shallowRef } from 'vue'
import { Camera, ChevronDown, ImagePlus, RotateCcw, Search, ScanSearch, ArrowUpRight } from 'lucide-vue-next'
import { modelImageSearch } from '../services/model-design'
import { S } from '../services/workflows'
import { useWorkflowStore } from '../stores/workflow'
import { fullRegion, searchTextures, demoSearchUrl, DEMO_SEARCH_NAME, type SearchScope, type TextureMatch } from '../services/image-tools'
import type { WorkflowAsset } from '../services/types'
import ImageRegionEditor from './ImageRegionEditor.vue'
import BigImageViewer from './BigImageViewer.vue'
import EngineeringExportButton from './EngineeringExportButton.vue'
const emit = defineEmits<{ open: [asset: WorkflowAsset] }>()
const store = useWorkflowStore(), source = ref(demoSearchUrl()), sourceName = ref(DEMO_SEARCH_NAME), region = ref(fullRegion()), count = ref(5)
const busy = ref(false), error = ref(''), searched = ref(false), skipped = ref(0), phase = ref(''), notice=ref(''), fraction = ref(0), indeterminate=ref(false)
const results = shallowRef<TextureMatch[]>([])
const scope = ref<SearchScope>('all')
const mine = computed(() => store.assets.filter(S.isLibraryAsset))
const eligible = computed(() => scope.value === 'mine' ? mine.value : store.all.filter(S.isLibraryAsset))
const matches = computed(() => results.value.flatMap(row => { const latest = eligible.value.find(a => a.id === row.sample.id); return latest ? [{...row,sample:latest}] : [] }))
let controller: AbortController | undefined
function restoreDemo() { if(busy.value)return; if(source.value.startsWith('blob:'))URL.revokeObjectURL(source.value);source.value=demoSearchUrl();sourceName.value=DEMO_SEARCH_NAME;region.value=fullRegion();scope.value='all';clearResults() }
function clearResults() { results.value=[]; searched.value=false; error.value=''; skipped.value=0;notice.value='' }
function upload(event: Event) {
  const input=event.target as HTMLInputElement, file=input.files?.[0]; input.value=''
  if(!file || busy.value) return
  clearResults()
  if(!/^image\/(png|jpeg|webp)$/.test(file.type)){error.value='请选择 PNG、JPG 或 WebP 图片';return}
  if(source.value)URL.revokeObjectURL(source.value)
  source.value=URL.createObjectURL(file);sourceName.value=file.name;region.value=fullRegion()
}
async function search() {
  if(busy.value || !source.value)return
  clearResults();busy.value=true;controller=new AbortController()
  try {
    const result=await modelImageSearch(source.value,eligible.value,region.value,count.value,{scope:scope.value,publicIds:S.base.map(a=>a.id),signal:controller.signal,onProgress:p=>{phase.value=p.phase;fraction.value=p.fraction;indeterminate.value=!!p.indeterminate}})
    notice.value=result.notice;results.value=result.matches;skipped.value=result.skipped;searched.value=true
    if(!result.matches.length && result.skipped)error.value='本地样例图片无法读取，请检查样例原图后重试'
  }catch(reason){error.value=reason instanceof Error&&reason.name==='AbortError'?'检索已取消':reason instanceof Error?reason.message:String(reason)}
  finally{busy.value=false;controller=undefined}
}
function displayName(asset: WorkflowAsset) { return asset.name.replace(/^(木纹|石纹|织物|皮革)\s*[·・]\s*/, '').replace(/\s*[-|]\s*Free Download.*$/i, '').replace(/\.(jpg|jpeg|png|webp)$/i, '').replace(/[_-]/g, ' ') }
function sourceLabel(asset: WorkflowAsset) { return asset.isPublicTexture ? asset.source.replace(/^公共纹理\s*[·・]\s*/, '') : mine.value.some(row=>row.id===asset.id)?'我的样例':'演示样例' }
onBeforeUnmount(()=>{controller?.abort();if(source.value)URL.revokeObjectURL(source.value)})
</script>
<template>
  <section class="image-search-panel" aria-label="以图搜图">
    <header class="search-header"><div class="search-heading"><span class="search-symbol"><ScanSearch :size="19"/></span><div><h2>以图搜图</h2><span class="search-library-count">{{eligible.length.toLocaleString()}} 个样例</span></div></div><div class="search-header-tools"><label><span class="sr-only">搜图范围</span><select v-model="scope" aria-label="搜图范围" :disabled="busy" @change="clearResults"><option value="all">全部样例</option><option value="mine">我的样例</option></select></label><span class="search-mode-label" title="比较整体形态、纹理疏密和走向，颜色不参与排序">整体纹理</span></div></header>
    <div class="image-search-workspace">
      <aside class="query-panel"><div class="query-heading"><h3>参考来样</h3><button type="button" class="icon-button" aria-label="恢复演示来样" title="恢复演示来样" :disabled="busy" @click="restoreDemo"><RotateCcw :size="15"/></button></div>
        <ImageRegionEditor v-if="source" v-model="region" :src="source" :disabled="busy" compact @edit="clearResults"/>
        <p class="source-name" :title="sourceName">{{sourceName}}</p>
        <div class="search-upload-actions"><label class="query-upload"><ImagePlus :size="15"/>更换图片<input type="file" aria-label="上传搜图样板" accept="image/png,image/jpeg,image/webp" :disabled="busy" @change="upload"/></label><label class="query-upload"><Camera :size="15"/>拍照<input type="file" aria-label="拍摄搜图样板" accept="image/*" capture="environment" :disabled="busy" @change="upload"/></label><BigImageViewer v-if="source" :src="source" alt="搜图来样" button-only/></div>
        <button type="button" class="search-submit" aria-label="开始以图搜图" :disabled="busy||!source||!eligible.length" @click="search"><Search :size="16"/>{{busy?'正在检索…':'开始检索'}}</button>
        <div v-if="busy" class="search-progress" role="status"><progress :value="indeterminate?undefined:fraction" max="1" aria-label="搜图进度"/><div><span>{{phase}}</span><button type="button" @click="controller?.abort()">取消</button></div></div>
        <p v-if="error" role="alert" class="search-error">{{error}}</p><p v-if="scope==='mine'&&!mine.length" class="query-empty">还没有正式个人样例。<button type="button" class="text-link" @click="S.showPackage()">导入样例包</button></p>
      </aside>
      <div class="search-results-area"><div class="results-heading"><h3>检索结果 <span v-if="searched">{{matches.length}}</span></h3><label class="result-count">显示 <select v-model.number="count" aria-label="搜图返回数量" :disabled="busy" @change="clearResults"><option :value="5">5 项</option><option :value="10">10 项</option><option :value="20">20 项</option></select></label></div>
        <div class="image-search-results"><article v-for="(row,index) in matches" :key="row.sample.id" class="search-match"><div class="match-image"><BigImageViewer :src="row.sample.imageUrl" :preview-src="row.sample.thumbnailUrl" :alt="row.sample.name"/><span class="match-rank">{{String(index+1).padStart(2,'0')}}</span></div><div class="match-body"><h4 :title="row.sample.name">{{displayName(row.sample)}}</h4><p class="match-source">{{sourceLabel(row.sample)}}</p><div class="match-actions"><button type="button" class="match-archive" @click="emit('open',row.sample)">档案<ArrowUpRight :size="13"/></button><EngineeringExportButton :src="row.sample.imageUrl" :name="row.sample.name" :project="row.sample.parameters?.engineering" compact/><button type="button" class="match-design" @click="S.open('design',row.sample)">用于设计</button></div></div></article></div>
        <div v-if="!matches.length" class="search-empty"><ScanSearch :size="32" :stroke-width="1.2"/><h4>{{busy?'正在寻找相近纹理':searched?'当前范围没有可用样例':'寻找相近的纹理'}}</h4><p>{{busy?'比较整体形态、疏密与走向':searched?'试试更换范围或上传其他来样':'使用左侧演示来样，或上传自己的图片'}}</p></div>
        <p v-if="notice" class="search-skipped" role="status">{{notice}}</p><p v-if="skipped" class="search-skipped">{{skipped}} 张图片无法读取，已跳过。</p>
      </div>
    </div>
    <details class="search-method"><summary>检索方式<ChevronDown :size="12"/></summary><p>先比较整图与分区的纹理形态、疏密和走向，再对召回样例进行图片比较排序。颜色不参与排序；服务不可用时使用结构检索结果，并在结果区注明。排序不表示视觉相似百分比。</p></details>
  </section>
</template>
<style scoped>
@reference "../assets/css/style.css";
.image-search-panel { @apply mb-5 overflow-hidden border rounded-[var(--dl-r-lg)]; background:var(--dl-surface);border-color:var(--dl-border); }
.search-header { @apply flex flex-wrap items-center justify-between gap-3 px-4 py-3 border-b; border-color:var(--dl-border); }
.search-heading { @apply flex items-center gap-3; }
.search-symbol { @apply flex items-center justify-center w-8 h-8; color:var(--dl-muted); }
h2 { @apply text-base font-semibold m-0; }
.search-library-count { @apply block text-xs mt-1; color:var(--dl-muted); }
.search-header-tools { @apply flex items-center gap-3; }
select { @apply border rounded-[var(--dl-r-md)] px-3 py-2 text-[14px]; background:var(--dl-surface);border-color:var(--dl-border);color:var(--dl-text); }
.search-mode-label { @apply text-xs px-2 py-1; color:var(--dl-muted); }
.image-search-workspace { @apply grid gap-5 p-4 items-start; grid-template-columns:256px minmax(0,1fr); }
.query-panel { @apply min-w-0; }
.query-heading,.results-heading { @apply flex items-center justify-between gap-2 mb-3; }
h3 { @apply m-0 text-[14px] font-semibold; }
.icon-button { @apply flex items-center justify-center w-8 h-8 rounded-[var(--dl-r-sm)]; color:var(--dl-muted); }
.icon-button:hover { color:var(--dl-text);background:var(--dl-hover); }
.source-name { @apply text-xs truncate my-3; color:var(--dl-muted); }
.search-upload-actions { @apply flex flex-wrap items-center gap-2; }
.query-upload { @apply inline-flex items-center gap-1.5 px-2.5 py-2 rounded-[var(--dl-r-md)] border cursor-pointer text-xs;background:var(--dl-surface);border-color:var(--dl-border);color:var(--dl-text); }
.query-upload:focus-within { outline:2px solid var(--dl-focus);outline-offset:2px; }
.search-upload-actions input { @apply sr-only; }
.search-upload-actions :deep(.button-only) { @apply min-h-8 h-auto w-auto bg-transparent border-0 px-1 text-xs; color:var(--dl-muted); }
.search-submit { @apply flex w-full items-center justify-center gap-2 py-2 mt-3 rounded-[var(--dl-r-md)] text-[14px] font-medium;min-height:36px; background:var(--dl-primary-fill);color:var(--dl-primary-text); }
button:disabled { @apply opacity-50 cursor-not-allowed; }
.search-progress { @apply mt-3 text-xs;color:var(--dl-muted); }
.search-progress>div { @apply flex justify-between gap-2 mt-1; }
.search-progress>div>span { @apply min-w-0 truncate; }
progress { @apply w-full h-1.5;accent-color:var(--dl-accent); }
.query-empty,.search-error { @apply text-xs leading-relaxed mt-3; }
.search-error { color:var(--dl-danger); }
.search-results-area { @apply min-w-0; }
.results-heading { @apply min-h-7; }
.results-heading h3 span { @apply ml-1 text-xs font-normal; color:var(--dl-muted); }
.result-count { @apply flex items-center gap-2 text-xs; color:var(--dl-muted); }
.result-count select { @apply border-0 p-1; }
.image-search-results { @apply grid grid-cols-3 gap-4; }
.search-match { @apply min-w-0 overflow-hidden rounded-[var(--dl-r-md)] border flex flex-col; border-color:var(--dl-border);background:var(--dl-surface);transition:border-color .15s; }
.search-match:hover { border-color:var(--dl-border-strong); }
.match-image { @apply relative aspect-[4/3] p-2; background:var(--dl-inset); }
.match-image :deep(.big-image-trigger) { @apply w-full h-full rounded-sm overflow-hidden; }
.match-image :deep(.big-image-trigger img) { object-fit:contain; }
.match-image :deep(.image-hint) { @apply p-1.5 top-2 right-2 bottom-auto rounded; font-size:0;gap:0;opacity:0;transition:opacity .2s; }
.match-image:hover :deep(.image-hint),.match-image :deep(.big-image-trigger:focus-visible .image-hint) { opacity:1; }
.match-rank { @apply absolute top-4 left-4 text-xs px-1.5 py-1 rounded; background:var(--dl-surface);color:var(--dl-text);pointer-events:none; }
.match-body { @apply p-3 flex flex-col;flex:1; }
h4 { @apply m-0 font-semibold text-xs leading-relaxed; }
.match-body h4 { @apply overflow-hidden;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;min-height:36px; }
.match-source { @apply text-xs mt-1 mb-3 truncate; color:var(--dl-muted); }
.match-actions { @apply flex flex-wrap items-center gap-1.5 pt-2 border-t;margin-top:auto; border-color:var(--dl-border); }
.match-archive { @apply inline-flex items-center gap-1 text-xs py-2 pr-1; color:var(--dl-muted); }
.match-design { @apply text-xs rounded-[var(--dl-r-md)] px-2.5 py-2 ml-auto font-medium;min-height:32px; background:var(--dl-inset);color:var(--dl-text); }
.match-actions :deep(.export-compact) { @apply border-0 bg-transparent; color:var(--dl-muted); }
.search-empty { @apply flex flex-col items-center justify-center text-center gap-2 py-10 px-3; color:var(--dl-muted); }
.search-empty h4 { color:var(--dl-text); }
.search-empty p { @apply text-xs m-0; }
.search-skipped { @apply text-xs mt-3; color:var(--dl-muted); }
.search-method { @apply border-t px-4 py-3; border-color:var(--dl-border); }
.search-method summary { @apply inline-flex items-center gap-2 cursor-pointer text-xs list-none; color:var(--dl-muted); }
.search-method[open] summary svg { transform:rotate(180deg); }
.search-method p { @apply text-xs leading-loose max-w-3xl my-3; color:var(--dl-muted); }
@media(max-width:1200px){.image-search-workspace{grid-template-columns:232px minmax(0,1fr);gap:20px;}.image-search-results{@apply grid-cols-2;}}
@media(max-width:760px){.search-header{@apply p-4 gap-3;}.search-header-tools{@apply gap-2;}.image-search-workspace{@apply grid-cols-1 p-4 gap-5;}.query-panel{@apply p-0;}.query-panel :deep(.region-stage){max-width:240px!important;}.image-search-results{@apply grid-cols-2 gap-3;}.match-body{@apply p-2.5;}.match-actions{@apply gap-1;}.match-design{@apply w-full ml-0 text-center;}.search-method{@apply px-4;}.search-empty{@apply py-10;}.match-body h4{min-height:38px;}}
@media(max-width:380px){.image-search-results{@apply grid-cols-1;}.match-image{@apply aspect-[4/3];}.search-mode-label{@apply hidden;}.match-design{@apply w-auto ml-auto;}}

:where(button,select,summary):focus-visible { outline:2px solid var(--dl-focus);outline-offset:2px; }
.search-submit:hover:not(:disabled) { background:var(--dl-primary-hover); }
.match-design:hover:not(:disabled),.query-upload:hover { background:var(--dl-hover); }
.search-progress button,.match-archive { min-height:32px;border-radius:var(--dl-r-sm); }
@media(prefers-reduced-motion:reduce){.search-match,.match-image :deep(.image-hint){transition:none;}}
</style>
