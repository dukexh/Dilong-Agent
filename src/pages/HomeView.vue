<script setup lang="ts">
import { computed } from 'vue'
import { useRouter } from 'vue-router'
import { Database, Sparkles, FlaskConical, Images, ArrowRight, ChevronRight, Search, Palette, CircleCheck, ChartColumn } from 'lucide-vue-next'
import { useWorkflowStore } from '../stores/workflow'
import { S } from '../services/workflows'
const store = useWorkflowStore(), router = useRouter()
const stats = computed(() => [
 {kind:'assets',label:'样例资产',value:store.stats.assets,note:'纹理与工艺样'},
 {kind:'tasks',label:'设计任务',value:store.stats.designTasks,note:'实际设计任务'},
 {kind:'pending',label:'待评价方案',value:store.stats.pendingCandidates,note:'已保存、未人工评价'},
 {kind:'ink',label:'配墨操作',value:store.stats.inkRuns,note:'成功分析次数'},
])
const entries = [
 {to:'/samples',no:'01',title:'样例资产库',desc:'统一管理样例图、设计输出、生产参数与人工反馈。',meta:'100 张纹理与工艺色样',icon:Database},
 {to:'/design',no:'02',title:'设计智能体',desc:'围绕历史样例完成快速比对、联想补全、风格孪生与自动设计。',meta:'4 项设计能力',icon:Sparkles},
 {to:'/ink',no:'03',title:'配墨智能体',desc:'从样例识别2—4个印刷色层，完成视觉还原并生成初始配墨建议。',meta:'现有能力已保留',icon:FlaskConical},
 {to:'/production',no:'04',title:'生产比对',desc:'生产后上传成品图，与设计原图比较颜色、纹理结构和局部差异。',meta:'设计与实物比对',icon:Images},
 {to:'/trends',no:'05',title:'趋势洞察',desc:'查看流行色系、材质与风格方向，为下一轮设计提供参考。',meta:'演示数据',icon:ChartColumn},
]
function open(kind:string,event:MouseEvent){if(kind==='assets')void router.push('/samples');else S.showStats(kind,event.currentTarget as HTMLElement)}
</script>
<template><div class="platform-page dashboard-page"><div class="page-kicker">DILONG DESIGN INTELLIGENCE PLATFORM</div><div class="dashboard-title"><div><h1>装饰纸智能设计工作台</h1><p>围绕样例资产，连接市场趋势、智能设计、配色配墨与生产反馈。</p></div><div class="truth-chip"><CircleCheck/>当前版本：前端能力演示</div></div>
<section class="command-strip"><div v-for="stat in stats" :key="stat.kind" class="dashboard-stat-cell"><button class="dashboard-stat-button stat-card" :aria-label="`查看${stat.label}，${stat.value}项`" @click="open(stat.kind,$event)"><span>{{stat.label}}</span><strong>{{stat.value}}</strong><small>{{stat.note}}</small></button></div><div class="system-ready"><i/><span>核心工作台可用</span></div></section>
<section class="capability-grid"><button v-for="entry in entries" :key="entry.to" class="capability-card" @click="router.push(entry.to)"><div class="capability-top"><span>{{entry.no}}</span><component :is="entry.icon"/></div><h2>{{entry.title}}</h2><p>{{entry.desc}}</p><div><span>{{entry.meta}}</span><ArrowRight/></div></button></section>
<section class="dashboard-lower"><div class="dashboard-panel"><div class="section-heading"><div><span>{{store.tasks.length?'最近任务':'演示任务示例'}}</span><h2>工作进度</h2></div><button @click="router.push('/design')">进入设计工作台 <ArrowRight/></button></div><div class="task-list"><template v-if="store.tasks.length"><div v-for="task in store.tasks" :key="task.id" role="button" tabindex="0" @click="S.openTask(task)" @keydown.enter="S.openTask(task)" @keydown.space.prevent="S.openTask(task)"><span class="task-icon teal"><Search/></span><div><b>{{task.title}}</b><small>设计智能体 · {{S.designModeLabels[task.mode || 'generate']||'趋势任务'}}</small></div><em>{{task.status}}</em></div></template><template v-else><div><span class="task-icon teal"><Search/></span><div><b>浅橡木样例相似检索</b><small>设计智能体 · 演示任务</small></div><em>待确认</em></div><div><span class="task-icon amber"><Palette/></span><div><b>烟熏胡桃风格孪生</b><small>设计智能体 · 演示任务</small></div><em>已生成 3 个方案</em></div><div><span class="task-icon slate"><FlaskConical/></span><div><b>浅色橡木配墨分析</b><small>配墨智能体 · 浏览器算法</small></div><em class="done">已完成</em></div></template></div></div><div class="dashboard-panel data-loop"><div class="section-heading"><div><span>平台数据闭环</span><h2>从样例到生产比对</h2></div></div><div class="loop-flow"><div><Database/><b>样例</b></div><ChevronRight/><div><Sparkles/><b>设计</b></div><ChevronRight/><div><FlaskConical/><b>配墨</b></div><ChevronRight/><div><Images/><b>生产比对</b></div></div><p>先选样例、设计并分析配墨，实际生产后上传成品进行比对。趋势洞察可独立为下一轮设计提供参考。</p></div></section></div></template>
