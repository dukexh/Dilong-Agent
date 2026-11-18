<script setup lang="ts">
import { computed,onBeforeUnmount,ref,shallowRef } from 'vue'
import { Search,Palette,TrendingUp,Flame,FileSearch,LoaderCircle,ArrowUpRight } from 'lucide-vue-next'
import { S } from '../services/workflows'
import { searchPosts,platformNames,type Post,type Platform } from '../services/posts'
import type { WorkflowAsset } from '../services/types'
defineOptions({name:'TrendsView'})
const tab=ref('radar'),platform=ref('全平台'),period=ref('近90天'),space=ref('全屋空间'),query=ref('浅色木纹'),sort=ref('general')
const topic=ref('浅色原木与门墙柜一体化'),researchPlatforms=ref<Platform[]>(['xiaohongshu','douyin']),matchLibrary=ref(true)
const rows=shallowRef<Post[]>([]),selected=shallowRef<Post|null>(null),busy=ref(false),error=ref(''),notice=ref(''),searched=ref(false)
const cursors=ref<Partial<Record<Platform,string|null>>>({}),sourceQuery=ref(''),applied=ref(''),activePlatforms=ref<Platform[]>([])
const direction=ref(''),material=ref(''),color=ref(''),sampleId=ref(''),taskMessage=ref(''),tick=ref(0)
const unsubscribe=S.subscribe(()=>tick.value++)
const samples=computed(()=>{void tick.value;return S.formalSamples()})
const matches=computed(()=>{const terms=(sourceQuery.value+' '+material.value).split(/[、，,\s]+/).filter(t=>t.length>1);return samples.value.filter(s=>terms.some(t=>[s.name,s.wood,s.style,s.tone].join(' ').includes(t))).slice(0,5)})
const selectedSample=computed(()=>samples.value.find(s=>s.id===sampleId.value)||matches.value[0])
const keywords=computed(()=>{const map=new Map<string,number>();for(const p of rows.value)for(const term of new Set(p.title.match(/[A-Za-z]{3,}|[\u4e00-\u9fa5]{2,6}/g)||[]))map.set(term,(map.get(term)||0)+1);return [...map].sort((a,b)=>b[1]-a[1]).slice(0,12)})
const ui=(name:string)=>'_'+name+'_1w9oj_1'
let controller:AbortController|undefined
function choose(p:Post){selected.value=p;direction.value=p.title;taskMessage.value=''}
function transfer(p:Post){choose(p);tab.value='translate'}
async function search(more=false,research=false){
 if(busy.value)return
 const text=research?topic.value.trim():query.value.trim();if(!text){error.value='请输入搜索关键词';return}
 const platforms:Platform[]=research?[...researchPlatforms.value]:platform.value==='全平台'?['xiaohongshu','douyin']:[platform.value==='小红书'?'xiaohongshu':'douyin']
 if(!platforms.length){error.value='至少选择一个平台';return}
 busy.value=true;S.status('trends','busy');error.value='';notice.value='';controller=new AbortController()
 if(!more){rows.value=[];selected.value=null;cursors.value={};sourceQuery.value=text+(space.value==='全屋空间'||research?'':' '+space.value);activePlatforms.value=platforms;applied.value=sourceQuery.value}
 try{
  const targets=more?activePlatforms.value.filter(p=>!!cursors.value[p]):platforms
  const results=await Promise.allSettled(targets.map(p=>searchPosts(p,sourceQuery.value,period.value,sort.value,more?cursors.value[p]||null:null,{signal:controller!.signal})))
  if(controller.signal.aborted)return
  const errors:string[]=[],notes:string[]=[];const known=new Set(rows.value.map(p=>p.platform+':'+p.id));const added:Post[]=[]
  results.forEach((result,i)=>{const p=targets[i]!;if(result.status==='rejected'){errors.push(platformNames[p]+'：'+String(result.reason?.message||'搜索失败'));return}cursors.value[p]=result.value.cursor;notes.push(result.value.notice);for(const row of result.value.posts){const key=row.platform+':'+row.id;if(!known.has(key)){known.add(key);added.push(row)}}})
  rows.value=[...rows.value,...added];if(!selected.value&&rows.value[0])choose(rows.value[0]);searched.value=true;error.value=errors.join('；');notice.value=[...new Set(notes)].join(' ')
 }finally{busy.value=false;S.status('trends',error.value?'error':'ready',error.value)}
}
async function createTask(){
 const sample=selectedSample.value;if(!selected.value||!sample||!direction.value.trim()){taskMessage.value='请选择参考帖子、正式样例并填写设计方向';return}
 try{const p=selected.value;await S.createTask({id:'post-'+p.platform+'-'+p.id,title:direction.value,keywords:[material.value,color.value].filter(Boolean)},sample,{source:'真实帖子参考',mode:'generate',parameters:{direction:direction.value,referencePost:{id:p.id,platform:p.platform,title:p.title,url:p.url},material:material.value,color:color.value}})
 taskMessage.value='设计任务已创建，可在设计智能体或历史记录查看。'
 }catch(e){taskMessage.value=(e as Error).message}
}
onBeforeUnmount(()=>{controller?.abort();unsubscribe()})
</script>
<template><div class="platform-page trend-page trends-view" :class="ui('page')">
<header :class="ui('header')"><div><h1>趋势洞察</h1><p>色系、材质与风格趋势</p></div><details class="context-help"><summary>数据来源</summary><p>通过 TikHub 检索小红书、抖音的真实帖子；统计仅覆盖已获取内容。</p></details></header>
<nav class="trend-tabs" :class="ui('tabList')" role="tablist" aria-label="趋势功能"><button v-for="[key,label,icon] in [['radar','热点雷达',Flame],['research','定向研究',FileSearch],['forecast','趋势预测',TrendingUp],['translate','趋势转化',Palette]]" :key="String(key)" role="tab" :aria-selected="tab===key" :data-state="tab===key?'active':'inactive'" @click="tab=String(key)"><component :is="icon"/>{{label}}</button></nav>
<section v-if="tab==='radar'" :class="ui('content')" class="trend-layout">
<section :class="ui('queryPanel')"><div :class="ui('panelTitle')"><span>01</span><b>检索市场内容</b></div><div :class="ui('platforms')"><button v-for="value in ['全平台','小红书','抖音']" :key="value" :disabled="busy" :class="platform===value?ui('active'):''" @click="platform=value">{{value}}</button></div>
<label>搜索内容<input v-model="query" class="form-control" aria-label="帖子搜索关键词" :disabled="busy" maxlength="120"/></label><label>观察周期<select v-model="period" :disabled="busy" aria-label="观察周期"><option v-for="value in ['不限','近7天','近30天','近90天','近半年']" :key="value">{{value}}</option></select></label><label>应用空间<select v-model="space" :disabled="busy" aria-label="应用空间"><option v-for="value in ['全屋空间','客厅','卧室','厨房与柜体','商业空间']" :key="value">{{value}}</option></select></label><label>排序<select v-model="sort" :disabled="busy"><option value="general">综合</option><option value="latest">最新</option><option value="likes">最多点赞</option></select></label>
<button class="btn btn-primary" :disabled="busy||!query.trim()" @click="search()"><LoaderCircle v-if="busy" class="spin"/><Search v-else :size="16"/>{{busy?'正在检索…':'搜索帖子'}}</button><div class="quick-terms"><button v-for="word in ['浅色原木','暖灰中古','胡桃木家居']" :key="word" :disabled="busy" @click="query=word">{{word}}</button></div></section>
<section :class="ui('radarResults')"><div :class="ui('resultHead')"><div><span>真实帖子</span><h2>{{applied||'搜索装饰与家居灵感'}}</h2></div><em>{{rows.length}} 条已获取</em></div><div v-if="rows.length" class="real-post-grid"><button v-for="p in rows" :key="p.platform+p.id" class="real-post" :class="{selected:selected?.id===p.id&&selected?.platform===p.platform}" @click="choose(p)"><img v-if="p.cover" :src="p.cover" :alt="p.title" loading="lazy" referrerpolicy="no-referrer"/><div v-else class="post-placeholder">暂无封面</div><b>{{p.title}}</b><small>{{p.author||'作者未提供'}} · {{platformNames[p.platform]}}</small></button></div><div v-else class="empty-state"><b>{{searched?'暂无匹配帖子':'输入关键词开始检索'}}</b><span>请先在后端配置 TikHub 密钥。</span></div>
<button v-if="Object.values(cursors).some(Boolean)" class="btn btn-secondary" :disabled="busy" @click="search(true)">加载更多</button></section>
<aside :class="ui('tracePanel')"><div :class="ui('panelTitle')"><span>02</span><b>帖子来源</b></div><template v-if="selected"><h3>{{selected.title}}</h3><dl class="post-facts"><div><dt>平台 / 作者</dt><dd>{{platformNames[selected.platform]}} / {{selected.author||'未提供'}}</dd></div><div><dt>发布时间</dt><dd>{{selected.publishedAt?new Date(selected.publishedAt).toLocaleString():'未提供'}}</dd></div><div><dt>采集时间</dt><dd>{{new Date(selected.collectedAt).toLocaleString()}}</dd></div><div v-for="[key,label] in [['likes','点赞'],['comments','评论'],['collects','收藏'],['shares','分享']]" :key="key"><dt>{{label}}</dt><dd>{{selected.metrics[key!]??'未提供'}}</dd></div></dl><a class="btn btn-secondary" :href="selected.url" target="_blank" rel="noopener noreferrer">打开原帖 <ArrowUpRight :size="14"/></a><button class="btn btn-primary" @click="transfer(selected)">用于设计参考</button></template><p v-else>选择帖子查看详情。</p></aside></section>
<section v-if="tab==='research'" :class="ui('contentSingle')"><section :class="ui('researchForm')"><div :class="ui('panelTitle')"><span>01</span><b>定向趋势资料</b></div><textarea v-model="topic" aria-label="研究主题" :disabled="busy" rows="3"/><div :class="ui('researchOptions')"><label v-for="(label,p) in platformNames" :key="p"><input v-model="researchPlatforms" type="checkbox" :value="p" :disabled="busy"/>{{label}}信号</label><label><input v-model="matchLibrary" type="checkbox"/>匹配样例库</label></div><button class="btn btn-primary" :disabled="busy||!topic.trim()" @click="search(false,true)">{{busy?'正在检索…':'检索专题资料'}}</button></section><section :class="ui('report')"><div :class="ui('resultHead')"><h2>专题资料 · {{rows.length}} 条</h2></div><p>按本次已获取的帖子整理，不包含模型分析或全平台趋势判断。</p><div class="keyword-list"><span v-for="[word,n] in keywords" :key="word">{{word}} · {{n}}</span></div><ul class="research-posts"><li v-for="p in rows" :key="p.platform+p.id"><a :href="p.url" target="_blank" rel="noopener noreferrer">{{p.title}}</a><small>{{platformNames[p.platform]}}</small><button class="text-link" @click="transfer(p)">用于设计参考</button></li></ul><button v-if="Object.values(cursors).some(Boolean)" class="btn btn-secondary" :disabled="busy" @click="search(true,true)">加载更多</button><template v-if="matchLibrary"><h3>关键词匹配样例</h3><button v-for="s in matches" :key="s.id" class="match-card" @click="S.open('samples',s)">{{s.name}}</button><p v-if="!matches.length">暂无关键词匹配样例。</p></template></section></section>
<section v-if="tab==='forecast'" :class="ui('contentSingle')"><section :class="ui('forecastTop')"><h2>趋势预测</h2><p>暂无足够历史数据</p></section><section :class="ui('metricGrid')" class="trend-overview"><div v-for="label in ['当前热度','增长速度','内容饱和度','预测置信度']" :key="label"><span>{{label}}</span><strong>—</strong></div></section><div :class="ui('forecastLayout')"><section :class="ui('chartPanel')"><h2>近六个月趋势动量</h2><div class="empty-state">尚未建立持续历史样本，暂不显示曲线。</div></section><section :class="ui('judgement')"><h2>设计价值判断</h2><p>可先查看真实帖子，并由用户确认设计方向。</p></section></div></section>
<section v-if="tab==='translate'" :class="ui('contentSingle')"><section :class="ui('translateHead')"><div><h2>趋势转化</h2><p>选择帖子参考并确认设计要求。</p></div><button class="btn btn-primary" :disabled="!selected||!selectedSample||!direction.trim()" @click="createTask">创建设计任务</button></section><div :class="ui('translateGrid')"><section :class="ui('paletteCard')"><template v-if="selected"><img v-if="selected.cover" class="reference-cover" :src="selected.cover" referrerpolicy="no-referrer" :alt="selected.title"/><h3>{{selected.title}}</h3><a :href="selected.url" target="_blank" rel="noopener noreferrer">查看来源 ↗</a></template><p v-else>请在热点雷达或定向研究中选择帖子。</p></section><section :class="ui('specCard')" class="design-brief"><label>设计方向<textarea v-model="direction" rows="3" aria-label="转化设计方向"/></label><label>材质要求<input v-model="material" aria-label="材质要求"/></label><label>色系要求<input v-model="color" aria-label="色系要求"/></label><label>正式输入样例<select v-model="sampleId" aria-label="转化输入样例"><option value="">{{matches[0]?.name||'请选择正式样例'}}</option><option v-for="s in samples" :key="s.id" :value="s.id">{{s.id}} · {{s.name}}</option></select></label></section><section :class="ui('matches')"><h3>关键词关联样例</h3><button v-for="s in matches" :key="s.id" class="match-card" @click="sampleId=s.id">{{s.name}}</button></section></div><p role="status">{{taskMessage}}</p></section>
<div v-if="error" class="error-message" role="alert">{{error}}</div><p v-if="notice" class="muted" role="status">{{notice}}</p><button v-if="busy" class="btn btn-secondary" @click="controller?.abort()">取消检索</button>
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
  @apply text-[13px];
  color: var(--dl-muted)
}
.trend-extra-search summary,.direction-extra summary {
  cursor: pointer
}
.trend-extra-search input {
  @apply text-[13px];
  @apply mt-[8px];
  @apply p-[7px]
}
.direction-extra {
  @apply mt-[20px];
  @apply text-[13px];
  color: var(--dl-muted);
  @apply leading-[1.8]
}
.direction-extra p {
  @apply [margin:10px_0]
}
.direction-extra .btn {
  @apply text-[13px]
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
  @apply [border:.5px_solid_var(--dl-border)];
  @apply flex;
  @apply items-center;
  @apply justify-center
}
.palette-swatches svg {
  color: white;
  filter: drop-shadow(0 1px 1px rgb(0 0 0 / 70%))
}
.research-results {
  @apply grid;
  @apply grid-cols-[repeat(4,minmax(0,1fr))];
  @apply gap-[7px];
  @apply m-[0]
}
.research-results>div {
  background: var(--dl-inset);
  @apply p-[12px];
  @apply flex;
  @apply flex-col;
  @apply gap-[9px];
  @apply min-w-[0]
}
.research-results dt {
  @apply text-[13px];
  color: var(--dl-muted)
}
.research-results dd {
  @apply text-[13px];
  @apply font-[600];
  @apply m-[0];
  @apply leading-[1.7];
  @apply wrap-anywhere
}
.research-palette { display:flex; flex-wrap:wrap; gap:8px 16px; }
.research-palette>span { display:inline-flex; align-items:center; gap:7px; min-width:0; }
.research-palette i { display:block; flex:none; width:24px; height:24px; border:1px solid var(--dl-border); border-radius:4px; }
.research-palette>span>span { font:13px/20px var(--dl-font); font-variant-numeric:tabular-nums; color:var(--dl-text); }
.research-results>div.report-evidence {
  background: var(--dl-inset);
  color: var(--dl-text)
}
.research-results>div.report-evidence dt {
  color: var(--dl-muted)
}
.research-results>div.report-evidence dd {
  @apply text-[13px];
  @apply font-[400]
}
.research-results>div:nth-child(5) {
  grid-column: span 2
}
.bar-column>small {
  font: 13px var(--font-mono);
  color: var(--dl-muted);
  @apply mt-[7px]
}
.match-card span {
  @apply text-[13px];
  @apply font-[600]
}
.trends-view :deep(._tabList_1w9oj_1 button) {
  @apply text-[14px]!
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


.real-post-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:14px}.real-post{display:grid;gap:8px;text-align:left;border:1px solid var(--dl-border);border-radius:10px;padding:10px;background:var(--dl-surface);color:var(--dl-text);min-width:0}.real-post.selected{outline:2px solid var(--dl-accent)}.real-post img,.post-placeholder{width:100%;height:180px;object-fit:cover;border-radius:6px;background:var(--dl-inset)}.real-post b{font-size:13px;overflow-wrap:anywhere}.real-post small{color:var(--dl-muted)}.post-facts div{padding:9px 0;border-bottom:1px solid var(--dl-border)}.post-facts dd{margin:5px 0;font-size:13px}.post-facts dt{color:var(--dl-muted);font-size:12px}.quick-terms,.keyword-list{display:flex;gap:7px;flex-wrap:wrap;margin:15px 0}.quick-terms button,.keyword-list span{padding:5px;border:1px solid var(--dl-border);border-radius:5px;font-size:12px}.research-posts{padding-left:20px}.research-posts li{padding:12px 0;border-bottom:1px solid var(--dl-border)}.research-posts small{margin:0 10px}.reference-cover{width:100%;max-height:240px;object-fit:contain}.design-brief label{display:grid;gap:7px;margin-bottom:12px}.design-brief input,.design-brief textarea,.design-brief select{width:100%;padding:9px;background:var(--dl-surface);border:1px solid var(--dl-border);color:var(--dl-text)}
@media(max-width:560px){.real-post-grid{grid-template-columns:1fr}}
</style>
