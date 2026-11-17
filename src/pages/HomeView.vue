<script setup lang="ts">
import { computed } from 'vue'
import { useRouter } from 'vue-router'
import { Database, Sparkles, FlaskConical, Images, ArrowRight, ChevronRight, Search, Palette, CircleCheck, ChartColumn } from 'lucide-vue-next'
import { useWorkflowStore } from '../stores/workflow'
import { S } from '../services/workflows'
import type { DesignTask } from '../services/types'
const store = useWorkflowStore(), router = useRouter()
const stats = computed(() => [
 {kind:'assets',label:'样例资产',value:store.stats.assets},
 {kind:'tasks',label:'设计任务',value:store.stats.designTasks},
 {kind:'pending',label:'待评价方案',value:store.stats.pendingCandidates},
 {kind:'ink',label:'配墨操作',value:store.stats.inkRuns},
])
const entries = computed(() => [
 {to:'/samples',no:'01',title:'样例库',desc:'查找纹理样例，管理设计方案与生产记录。',icon:Database},
 {to:'/design',no:'02',title:'设计智能体',desc:'相似检索、纹理补全、色彩迁移与样例推荐。',icon:Sparkles},
 {to:'/ink',no:'03',title:'配墨智能体',desc:'分析印刷色层，查看还原图与参考配方。',icon:FlaskConical},
 {to:'/production',no:'04',title:'生产比对',desc:'对照原图与成品图，检查颜色和局部差异。',icon:Images},
 {to:'/color-compare',no:'05',title:'颜色比对',desc:'计算目标色配方，复核实涂色差与偏色。',icon:Palette},
 {to:'/trends',no:'06',title:'趋势洞察',desc:'筛选色系与材质趋势，查阅来源和匹配样例。',icon:ChartColumn},
])
const taskDate = (task: DesignTask) => task.updatedAt || task.createdAt || ''
const taskTimestamp = (task: DesignTask) => Date.parse(taskDate(task)) || 0
const recentTasks = computed(() => [...store.tasks].sort((a, b) => taskTimestamp(b) - taskTimestamp(a)).slice(0, 5))
function taskTime(task: DesignTask) {
 const date = new Date(taskDate(task))
 if (!Number.isFinite(date.getTime())) return ''
 const pad = (value: number) => String(value).padStart(2, '0')
 const day = `${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
 return date.getFullYear() === new Date().getFullYear() ? `${day} ${pad(date.getHours())}:${pad(date.getMinutes())}` : `${date.getFullYear()}-${day}`
}
function open(kind:string,event:MouseEvent){if(kind==='assets')void router.push('/samples');else S.showStats(kind,event.currentTarget as HTMLElement)}
</script>
<template><div class="platform-page dashboard-page"><div class="dashboard-title"><div><h1>装饰纸智能设计工作台</h1><p>样例管理、设计处理、配墨与生产复核</p></div></div>
<section class="command-strip"><div v-for="stat in stats" :key="stat.kind" class="dashboard-stat-cell"><button class="dashboard-stat-button stat-card" :aria-label="`查看${stat.label}，${stat.value}项`" @click="open(stat.kind,$event)"><span>{{stat.label}}</span><strong>{{stat.value}}</strong></button></div><div class="system-ready"><i/><span>核心工作台可用</span></div></section>
<section class="capability-grid"><button v-for="entry in entries" :key="entry.to" class="capability-card" @click="router.push(entry.to)"><div class="capability-top"><component :is="entry.icon"/></div><h2>{{entry.title}}</h2><p>{{entry.desc}}</p></button></section>
<section class="dashboard-lower"><div class="dashboard-panel"><div class="section-heading"><div><span>{{store.tasks.length?'最近任务':'示例任务'}}</span><h2>工作进度</h2></div><button v-if="store.tasks.length" @click="open('tasks',$event)">全部任务 <ArrowRight/></button><button v-else @click="router.push('/design')">进入设计工作台 <ArrowRight/></button></div><div class="task-list"><template v-if="store.tasks.length"><div v-for="task in recentTasks" :key="task.id" role="button" tabindex="0" @click="S.openTask(task)" @keydown.enter="S.openTask(task)" @keydown.space.prevent="S.openTask(task)"><span class="task-icon teal"><Search/></span><div><b>{{task.title}}</b><div class="task-meta"><small>{{S.designModeLabels[task.mode || 'generate']||'趋势任务'}}</small><time v-if="taskTime(task)" :datetime="taskDate(task)" :title="new Date(taskDate(task)).toLocaleString('zh-CN')">{{taskTime(task)}}</time></div></div><em>{{task.status}}</em></div></template><template v-else><div><span class="task-icon teal"><Search/></span><div><b>浅橡木样例相似检索</b><small>设计智能体</small></div><em>待确认</em></div><div><span class="task-icon amber"><Palette/></span><div><b>烟熏胡桃风格孪生</b><small>设计智能体</small></div><em>已生成 3 个方案</em></div><div><span class="task-icon slate"><FlaskConical/></span><div><b>浅色橡木配墨分析</b><small>配墨智能体</small></div><em class="done">已完成</em></div></template></div></div><div class="dashboard-panel data-loop"><div class="section-heading"><div><span>工作流程</span><h2>从样例到生产比对</h2></div></div><div class="loop-flow"><div><Database/><b>样例</b></div><ChevronRight/><div><Sparkles/><b>设计</b></div><ChevronRight/><div><FlaskConical/><b>配墨</b></div><ChevronRight/><div><Images/><b>生产比对</b></div></div></div></section></div></template>

<style scoped>
@reference "../assets/css/style.css";
.task-meta { display:flex; flex-wrap:wrap; align-items:baseline; gap:2px 12px; }
.task-meta time { color:var(--dl-muted); font-size:13px; font-variant-numeric:tabular-nums; white-space:nowrap; }
@media(min-width:1101px){.dashboard-page .capability-grid{@apply grid-cols-3}}
</style>
