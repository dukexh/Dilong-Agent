<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { ArrowRight, ArrowUpRight, Search, Palette, TrendingUp, Check, LoaderCircle, Flame, FileSearch, CircleCheck, Database, Lightbulb, Sparkles } from 'lucide-vue-next'
import Panel from '../components/Panel.vue'
import { S } from '../services/workflows'
import { useWorkflowStore } from '../stores/workflow'
defineOptions({ name: 'TrendsView' })
const store = useWorkflowStore()
const tab = ref('radar'), platform = ref('全平台'), period = ref('近90天'), space = ref('全屋空间'), query = ref(''), selectedId = ref(S.originalTrends[0]!.id)
const activeColor = ref(''), busy = ref(false), researchBusy = ref(false), researched = ref(true), taskError = ref('')
const researchPlatforms = ref(['小红书','抖音']), matchLibrary = ref(true), topic = ref('浅色原木与门墙柜一体化趋势')
const presets = ['浅色原木与门墙柜一体化趋势','胡桃木与烟熏色系的变化','暖灰中古在家居空间中的应用','红棕复古装饰纹理']
const timers = new Set<ReturnType<typeof setTimeout>>()
const filtered = computed(() => { void store.tick; return S.filterOriginal(platform.value,period.value,space.value).filter(row => !query.value.trim() || [row.name,row.material,...row.tags].join(' ').includes(query.value.trim())) })
const selected = computed(() => filtered.value.find(row => row.id === selectedId.value) || filtered.value[0] || S.emptyTrend(S.originalTrends[0]!))
const matches = computed(() => { void store.tick; return S.matchOriginal(selected.value) })
const sourceCount = computed(() => selected.value.sources.reduce((total,source) => total+source.count,0))
const research = computed(() => { void store.tick; return S.researchOriginal(topic.value,researchPlatforms.value,matchLibrary.value) })
const existingTask = computed(() => store.tasks.find(task => task.sourceId === selected.value.id))
watch(() => selected.value.id, () => { activeColor.value = selected.value.palette[0] || ''; taskError.value = '' }, { immediate:true })
function delay(callback: () => void, ms: number) { const timer = setTimeout(() => { timers.delete(timer); callback() },ms); timers.add(timer) }
function search() { busy.value = true; S.status('trends','busy'); delay(() => { busy.value=false; S.status('trends','ready') },650) }
function runResearch() { researchBusy.value=true; researched.value=false; delay(() => { researchBusy.value=false; researched.value=true },750) }
async function createTask() {
  taskError.value=''
  try { if (existingTask.value) { S.openTask(existingTask.value); return }; const sample = matches.value[0]; if (!sample) throw Error('没有可用的匹配样例，请选择其他趋势方向'); await S.createTask({id:selected.value.id,title:selected.value.name,keywords:[sample.wood,sample.tone,sample.style]},sample) }
  catch (reason) { taskError.value=reason instanceof Error ? reason.message : '任务创建失败'; S.status('trends','error',taskError.value) }
}
function points(signals: number[]) { const min=Math.min(...signals)-5,max=Math.max(...signals)+5; return signals.map((value,index) => `${index*28},${35-(value-min)/(max-min)*29}`).join(' ') }
onBeforeUnmount(() => { timers.forEach(clearTimeout); if (busy.value) S.status('trends','ready') })

const ui = (name: string) => '_'+name+'_1w9oj_1'
</script>
<template><div class="platform-page trend-page trends-view" :class="ui('page')"><div :class="ui('kicker')">MARKET TREND INTELLIGENCE</div><header :class="ui('header')"><div><h1>趋势洞察</h1><p>从市场内容信号出发，识别正在流行和即将上升的装饰方向，并转化为可落地的装饰纸设计任务。</p></div><div :class="ui('demoState')"><CircleCheck/><span><b>当前数据：可追溯演示集</b><small>尚未实时连接小红书、抖音</small></span></div></header>
<nav class="trend-tabs" :class="ui('tabList')" role="tablist" aria-label="趋势功能"><button v-for="[key,label,icon] in [['radar','热点雷达',Flame],['research','定向研究',FileSearch],['forecast','趋势预测',TrendingUp],['translate','趋势转化',Palette]]" :key="String(key)" role="tab" :aria-selected="tab===key" :data-state="tab===key?'active':'inactive'" @click="tab=String(key)"><component :is="icon"/>{{label}}</button></nav>
<section v-if="tab==='radar'" :class="ui('content')" class="trend-layout"><section :class="ui('queryPanel')"><div :class="ui('panelTitle')"><span>01</span><div><b>检索市场热点</b><small>筛选平台、周期和应用空间</small></div></div><div :class="ui('platforms')"><button v-for="value in ['全平台','小红书','抖音']" :key="value" :class="platform===value?ui('active'):''" @click="platform=value">{{value}}</button></div><label>观察周期<select v-model="period" aria-label="观察周期"><option v-for="value in ['近7天','近30天','近90天','近半年']" :key="value">{{value}}</option></select></label><label>应用空间<select v-model="space" aria-label="应用空间"><option v-for="value in ['全屋空间','客厅','卧室','厨房与柜体','商业空间']" :key="value">{{value}}</option></select></label><button class="btn btn-primary" :disabled="busy" @click="search"><LoaderCircle v-if="busy" class="spin" :size="16"/><Search v-else :size="16"/>{{busy?'正在整理信号…':'检索热门趋势'}}</button><div :class="ui('dataNote')"><Database/><span>演示检索不会访问真实平台；接入合规数据渠道后可替换同一输入与结果结构。</span></div><details class="trend-extra-search"><summary>搜索趋势</summary><input v-model="query" aria-label="搜索趋势" placeholder="检索色系、材质或风格" class="form-control"/></details></section>
<section :class="ui('radarResults')"><div :class="ui('resultHead')"><div><span>TREND RANKING</span><h2>{{platform}} · {{period}}热门方向</h2></div><em>{{space}}</em></div><div v-if="filtered.length" :class="ui('trendGrid')"><button v-for="(trend,index) in filtered" :key="trend.id" class="trend-card" :class="[ui('trendCard'),selected.id===trend.id?ui('selected'):'']" @click="selectedId=trend.id"><div :class="ui('rank')">{{String(index+1).padStart(2,'0')}}</div><i :style="{background:trend.color}"/><div><span>{{trend.stage}}</span><h3>{{trend.name}}</h3><p>{{trend.desc}}</p><div :class="ui('tags')"><em v-for="tag in trend.tags" :key="tag">{{tag}}</em></div></div><aside><b>{{trend.heat}}</b><small>热度指数</small><strong><TrendingUp/>+{{trend.growth}}%</strong></aside></button></div><div v-else class="empty-state"><b>暂无匹配资料</b><span>当前条件下没有相关资料，请调整筛选条件。</span></div></section>
<aside :class="ui('tracePanel')"><div :class="ui('panelTitle')"><span>02</span><div class="direction-hero"><b>信号来源</b><small><strong>{{selected.name}}</strong> · 演示统计</small></div></div><template v-if="filtered.length"><div v-for="source in selected.sources" :key="source.platform" :class="ui('sourceRow')" class="source-row"><span>{{source.platform}}</span><b>{{source.count.toLocaleString()}} 条</b><em>{{source.change}}</em></div><div :class="ui('traceSummary')"><CircleCheck/><span>所选演示来源的参考置信度为 {{selected.confidence}}%。</span></div><details class="direction-extra"><summary>查看色板与设计建议</summary><div class="palette-swatches"><button v-for="color in selected.palette" :key="color" :style="{background:color}" :aria-label="`选择色值${color}`" @click="activeColor=color"><Check v-if="activeColor===color" :size="15"/></button></div><p class="selected-hex">{{activeColor}}</p><p>{{selected.texture}}</p><button class="btn btn-secondary" @click="tab='translate'">转为设计方向<ArrowRight :size="13"/></button></details></template><p v-else class="muted">请先调整筛选条件。</p></aside></section>
<section v-if="tab==='research'" :class="ui('contentSingle')"><section :class="ui('researchForm')"><div :class="ui('panelTitle')"><span>01</span><div><b>定向趋势研究</b><small>提出明确的风格、材质或色彩问题</small></div></div><textarea v-model="topic" aria-label="研究主题" rows="3"/><div :class="ui('presets')"><button v-for="preset in presets" :key="preset" @click="topic=preset">{{preset}}</button></div><div :class="ui('researchOptions')"><label v-for="value in ['小红书','抖音']" :key="value"><input v-model="researchPlatforms" type="checkbox" :value="value"/>{{value}}信号</label><label><input v-model="matchLibrary" type="checkbox"/>匹配样例库</label></div><button class="btn btn-primary" :disabled="researchBusy || !topic.trim()" @click="runResearch"><LoaderCircle v-if="researchBusy" class="spin" :size="15"/><Sparkles v-else :size="15"/>{{researchBusy?'正在形成专项分析…':'生成趋势研究'}}</button></section><section :class="ui('report')"><div v-if="researchBusy" :class="ui('loading')" role="status"><LoaderCircle class="spin"/><b>正在聚类关键词与案例信号…</b><span>将形成趋势定义、色板、材质和变化方向。</span></div><template v-else-if="researched"><div :class="ui('resultHead')"><div><span>DIRECTED TREND REPORT</span><h2>定向趋势研究摘要</h2></div><em>演示结论</em></div><div :class="ui('reportLead')"><Lightbulb/><div><span>研究问题</span><h3>{{topic}}</h3><p class="direction-description">{{research.summary}}</p></div></div><dl class="research-results"><div v-for="([label,value],index) in [['核心变化',research.change],['推荐色系',research.palette],['材质方向',research.material],['风险提示',research.risk],['代表信号',research.evidence],['样例匹配',research.growth],['来源',research.confidence]]" :key="label" :class="{'report-evidence':index>=4}"><dt :class="{'sr-only':index>=5}">{{label}}</dt><dd>{{value}}</dd></div></dl></template></section></section>
<section v-if="tab==='forecast'" :class="ui('contentSingle')"><section :class="ui('forecastTop')"><div><span>选择预测对象</span><select v-model="selectedId" aria-label="选择预测对象"><option v-for="trend in filtered" :key="trend.id" :value="trend.id">{{trend.name}}</option></select></div><div :class="ui('lifecycle')"><span>生命周期</span><b>{{selected.stage}}</b><em :style="{background:selected.color}"/></div><div :class="ui('forecastText')"><TrendingUp/><span><b>3—6个月判断</b><small>{{selected.forecast}}</small></span></div></section><section :class="ui('metricGrid')" class="trend-overview"><div v-for="[label,value,note] in [['当前热度',selected.heat,'内容关注强度'],['增长速度',selected.growth+'%','近期信号变化'],['内容饱和度',selected.saturation+'%','同类内容密度'],['预测置信度',selected.confidence+'%','演示来源参考']]" :key="label"><span>{{label}}</span><strong>{{value}}</strong><small>{{note}}</small></div></section><div :class="ui('forecastLayout')"><section :class="ui('chartPanel')"><div :class="ui('resultHead')"><div><span>TREND MOMENTUM</span><h2>近六个月趋势动量</h2></div><em>演示时间序列</em></div><div :class="ui('barChart')" class="bar-plot"><div v-for="(value,index) in selected.signals" :key="index" class="bar-column"><span class="sr-only">{{value}}</span><i :style="{height:value+'%',background:selected.color}"/><small>观察{{index+1}}</small></div></div></section><section :class="ui('judgement')"><div :class="ui('resultHead')"><div><span>DESIGN JUDGEMENT</span><h2>设计价值判断</h2></div></div><div :class="ui('judgementLead')"><i :style="{background:selected.color}"/><div><h3>{{selected.name}}</h3><span>{{selected.stage}}</span></div></div><p>{{selected.forecast}}</p><dl><div><dt>跨平台一致性</dt><dd>{{selected.sources.length>1?'较高':'依据有限'}}</dd></div><div><dt>商业转化潜力</dt><dd>{{selected.saturation>70?'稳定':'较强'}}</dd></div><div><dt>建议动作</dt><dd>{{selected.stage.includes('萌芽')?'小批量验证':'进入设计转化'}}</dd></div></dl></section></div></section>
<section v-if="tab==='translate'" :class="ui('contentSingle')"><section :class="ui('translateHead')"><div><span>选择趋势方向</span><select v-model="selectedId" aria-label="选择趋势方向"><option v-for="trend in filtered" :key="trend.id" :value="trend.id">{{trend.name}}</option></select></div><div :class="ui('translateTitle')"><i :style="{background:selected.color}"/><div><span>DESIGN TRANSLATION</span><h2>{{selected.name}}装饰纸转化建议</h2></div></div><button class="btn btn-primary" :disabled="!filtered.length" @click="createTask"><Palette :size="15"/>{{existingTask?'打开已有设计任务':'创建装饰纸设计任务'}}</button></section><p v-if="taskError" role="alert" class="error-message">{{taskError}}</p><div :class="ui('translateGrid')"><section :class="ui('paletteCard')"><span>推荐综合色板</span><div><i v-for="color in selected.palette" :key="color" :style="{background:color}"><em>{{color}}</em></i></div></section><section :class="ui('specCard')"><div><span>推荐材质</span><b>{{selected.material}}</b></div><div><span>纹理组织</span><b>{{selected.texture}}</b></div><div><span>印刷约束</span><b>{{selected.layers}}</b></div><div><span>生命周期</span><b>{{selected.stage}}</b></div></section><section :class="ui('matches')"><span>样例库匹配</span><button v-for="(sample,index) in matches" :key="sample.id" class="match-card" @click="S.open('samples',sample)"><em>{{String(index+1).padStart(2,'0')}}</em><span>{{sample.name}}</span><ArrowUpRight/></button><p v-if="!matches.length" class="muted">没有可用的匹配样例。</p></section></div><section :class="ui('taskBrief')" class="task-brief"><p>以 <strong>{{selected.name}}</strong> 为综合色方向，优先采用 {{selected.material}} 结构；{{selected.texture}}，{{selected.layers}}。输出浅、中、深候选，并与相近样例比对。</p><div><span>演示资料 · 需人工审核</span><span>输入样例</span><span>设计候选</span><span>配墨分析</span></div></section></section>
</div></template>
<style scoped>
@reference "../assets/css/style.css";
.trend-tabs button {
  @apply flex;
  @apply items-center;
  @apply justify-center
}
.trends-view {
  @apply [padding:30px_32px]
}
.trend-extra-search {
  @apply mt-[12px];
  @apply text-[10px];
  color: #7d9699
}
.trend-extra-search summary,.direction-extra summary {
  cursor: pointer
}
.trend-extra-search input {
  @apply text-[10px];
  @apply mt-[8px];
  @apply p-[7px]
}
.direction-extra {
  @apply mt-[20px];
  @apply text-[10px];
  color: #789194;
  @apply leading-[1.8]
}
.direction-extra p {
  @apply [margin:10px_0]
}
.direction-extra .btn {
  @apply text-[10px]
}
.direction-hero strong {
  @apply font-[400]
}
.palette-swatches {
  @apply flex;
  @apply gap-[5px];
  @apply mt-[12px]
}
.palette-swatches button {
  @apply w-[35px];
  @apply h-[35px];
  @apply [border:1px_solid_#c5d1d1];
  @apply flex;
  @apply items-center;
  @apply justify-center
}
.palette-swatches svg {
  color: white;
  filter: drop-shadow(0 1px 1px #333)
}
.research-results {
  @apply grid;
  @apply grid-cols-[repeat(4,minmax(0,1fr))];
  @apply gap-[7px];
  @apply m-[0]
}
.research-results>div {
  background: #f2f6f6;
  @apply p-[12px];
  @apply flex;
  @apply flex-col;
  @apply gap-[9px];
  @apply min-w-[0]
}
.research-results dt {
  @apply text-[10px];
  color: #7d9496
}
.research-results dd {
  @apply text-[11px];
  @apply font-[600];
  @apply m-[0];
  @apply leading-[1.7];
  @apply wrap-anywhere
}
.research-results>div.report-evidence {
  background: #24373a;
  color: #b3c4c5
}
.research-results>div.report-evidence dt {
  color: white
}
.research-results>div.report-evidence dd {
  @apply text-[10px];
  @apply font-[400]
}
.research-results>div:nth-child(5) {
  grid-column: span 2
}
.bar-column>small {
  font: 10px var(--font-mono);
  color: #7c9395;
  @apply mt-[7px]
}
.match-card span {
  @apply text-[12px];
  @apply font-[600]
}
.trends-view :deep(._tabList_1w9oj_1 button) {
  @apply text-[13px]!
}
.error-message {
  @apply [margin:10px_0];
  @apply p-[12px]
}
@media(max-width:850px){
.trends-view {
  @apply [padding:20px_14px]
}
.research-results {
  @apply grid-cols-[1fr_1fr]
}
.research-results>div:nth-child(5) {
  grid-column: 1/-1
}
.direction-extra {
  @apply mt-[14px]
}}
@media(max-width:560px){
.research-results {
  @apply grid-cols-[1fr]
}
.research-results>div:nth-child(5) {
  grid-column: auto
}}
</style>
