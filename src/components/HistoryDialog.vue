<script setup lang="ts">
import { computed, nextTick, onMounted, ref, watch } from 'vue'
import { S } from '../services/workflows'
import type { CandidateStatus, DesignTask, InkRun, WorkflowAsset } from '../services/types'
import CandidateReview from './CandidateReview.vue'
import { useWorkflowStore } from '../stores/workflow'
const store = useWorkflowStore(), selected = ref<string[]>([]), cleaning = ref(false), message = ref(''), container = ref<HTMLElement | null>(null)
onMounted(async () => { await nextTick(); container.value?.focus({ preventScroll: true }) })
const kind = computed(() => { void store.tick; return S.statsView })
const title = computed(() => ({ tasks:'设计任务', pending:'方案评价', ink:'配墨操作记录' } as Record<string,string>)[kind.value || ''])
const newest = <T extends { createdAt?: string }>(rows: T[]) => rows.slice().sort((a,b) => (Date.parse(b.createdAt || '') || 0) - (Date.parse(a.createdAt || '') || 0))
const tasks = computed(() => newest(store.tasks)), inkRuns = computed(() => newest(store.inkRuns))
const reviewFilter = ref<CandidateStatus | 'all'>('pending')
const reviewTabs = [{ key: 'pending', label: '待评价' }, { key: 'adjust', label: '需调整' }, { key: 'accepted', label: '已采用' }, { key: 'rejected', label: '未采用' }, { key: 'all', label: '全部' }] as const
const candidates = computed(() => newest(store.assets.filter(asset => S.isCandidate(asset))))
const statusOf = (asset: typeof store.assets[number]) => asset.candidateReview?.status || 'pending'
const draftRows = ref(new Map<string, WorkflowAsset>())
function trackDraft(asset: WorkflowAsset, dirty: boolean) { if (dirty) draftRows.value.set(asset.id, asset); else draftRows.value.delete(asset.id) }
const visibleCandidates = computed(() => newest([...candidates.value, ...[...draftRows.value.values()].filter(asset => !candidates.value.some(row => row.id === asset.id))]).filter(asset => draftRows.value.has(asset.id) || reviewFilter.value === 'all' || statusOf(asset) === reviewFilter.value))
const statusLabel = (status: string) => reviewTabs.find(tab => tab.key === status)?.label || '待评价'
function reviewed(status: CandidateStatus) { message.value = `已标记为${statusLabel(status)}，可在“${statusLabel(status)}”中查看和继续处理。` }
const count = computed(() => kind.value === 'tasks' ? tasks.value.length : kind.value === 'pending' ? visibleCandidates.value.length : inkRuns.value.length)
watch(count, async (value, previous) => {
  if (value >= previous) return
  await nextTick()
  // Removing the focused candidate or history row must keep keyboard events inside the modal.
  if (container.value && !container.value.contains(document.activeElement)) container.value.focus()
})
const eligible = (task: DesignTask) => !['处理中','状态待确认'].includes(task.status)
const selectedIds = computed(() => selected.value.filter(id => kind.value === 'tasks' ? tasks.value.some(task => task.id === id && eligible(task)) : inkRuns.value.some(run => run.id === id)))
const selectable = computed(() => kind.value === 'tasks' ? tasks.value.filter(eligible).map(task => task.id) : inkRuns.value.map(run => run.id))
watch(() => { void store.tick; return S.statsSession }, () => { selected.value = []; message.value = ''; reviewFilter.value = 'pending'; draftRows.value.clear() })
function toggle(id: string, checked: boolean) { selected.value = checked ? [...new Set([...selected.value,id])] : selected.value.filter(key => key !== id) }
function time(value?: string) { return value && Number.isFinite(Date.parse(value)) ? new Date(value).toLocaleString('zh-CN',{hour12:false}) : '未记录' }
async function remove(ids: string[]) {
  if (cleaning.value || !ids.length || !['tasks','ink'].includes(kind.value || '')) return
  const currentKind = kind.value, session = S.statsSession
  const note = currentKind === 'tasks' ? '已保存的候选和样例库会保留。' : '记录中的图片和参数快照将删除，样例库会保留。'
  if (!window.confirm(`确定删除 ${ids.length} 条${title.value}？\n${note}此操作不可撤销。`)) return
  cleaning.value = true; message.value = ''
  try { const total = await S.deleteHistory(currentKind === 'tasks' ? 'tasks' : 'inkRuns',ids); if (S.statsSession === session && S.statsView === currentKind) { selected.value = []; message.value = `已删除 ${total} 条记录。${note}` } }
  catch (reason) { if (S.statsSession === session) message.value = reason instanceof Error ? reason.message : '清理失败' }
  finally { cleaning.value = false }
}
function go(action: () => unknown) { S.closeStats(S.statsSession); void action() }
function sourceName(task: DesignTask) { return task.input?.name || store.all.find(asset => asset.id === task.sampleId)?.name || task.sampleId || '未记录' }
function source(run: InkRun) { return store.all.find(asset => asset.id === run.sampleId) }
defineExpose({ cleaning })
</script>
<template><div ref="container" class="history-dialog" tabindex="-1"><p class="muted">{{ kind === 'ink' ? '打开此次配墨可恢复当次图片、配方和最近保存的参数，不重复分析或计数。' : kind === 'pending' ? '候选先保存到这里，只有已采用方案进入正式样例库。评价不会自动修改图片。' : '查看任务的输入、条件和结果；打开任务可继续处理或查看已保存候选。' }}</p><div v-if="kind === 'pending'" class="review-tabs" role="group" aria-label="方案评价分类"><button v-for="tab in reviewTabs" :key="tab.key" type="button" :aria-pressed="reviewFilter === tab.key" :class="['btn', reviewFilter === tab.key ? 'btn-primary' : 'btn-secondary']" @click="reviewFilter = tab.key; message = ''">{{ tab.label }}（{{ tab.key === 'all' ? candidates.length : candidates.filter(asset => statusOf(asset) === tab.key).length }}）</button></div><p v-if="kind === 'pending' && draftRows.size" class="muted" role="status">当前列表保留了尚未保存的评价草稿，即使方案状态在其他页面发生变化也不会移除。</p><div class="module-toolbar"><span class="badge">共 {{ count }} 条记录</span><div v-if="kind !== 'pending'" class="button-row"><button class="btn btn-secondary" :disabled="cleaning || !selectable.length" @click="selected = selectedIds.length === selectable.length ? [] : selectable">{{ selectedIds.length === selectable.length && selectable.length ? '取消全选' : '全选可清理记录' }}</button><button class="btn btn-danger" :disabled="cleaning || !selectedIds.length" @click="remove(selectedIds)">删除所选（{{ selectedIds.length }}）</button></div></div><p v-if="message" role="status" class="operation-message">{{ message }}</p><div v-if="!count" class="empty-state"><h3>暂无{{ kind === 'pending' ? statusLabel(reviewFilter) + '方案' : title }}</h3><p>执行相应操作后，记录会显示在这里。</p></div><template v-if="kind === 'tasks'"><article v-for="task in tasks" :key="task.id" class="summary-record" :data-record-id="task.id"><header><label><input type="checkbox" :checked="selectedIds.includes(task.id)" :disabled="cleaning || !eligible(task)" :aria-label="`选择记录 ${task.title}`" @change="toggle(task.id,($event.target as HTMLInputElement).checked)" />选择</label><h3>{{ task.title || '设计任务' }}</h3><span class="badge">{{ task.status }}</span></header><dl><div><dt>创建时间</dt><dd>{{ time(task.createdAt) }}</dd></div><div><dt>处理方式</dt><dd>{{ task.mode ? S.designModeLabels[task.mode] : '趋势设计任务' }}</dd></div><div><dt>输入样例</dt><dd>{{ sourceName(task) }}</dd></div><div><dt>任务来源</dt><dd>{{ task.source }}</dd></div><div><dt>设计条件</dt><dd>{{ task.conditions || '未记录' }}</dd></div><div><dt>结果</dt><dd>{{ task.outputCount == null ? '处理数量未记录' : task.outputCount+' 个结果' }}；已保存 {{ task.resultIds.filter(id => store.assets.some(asset => asset.id === id)).length }} 个候选</dd></div></dl><p v-if="task.error" class="error-message">{{ task.error }}</p><div class="button-row"><button class="btn btn-primary" @click="go(() => S.openTask(task))">打开任务</button><button class="btn btn-danger" :disabled="cleaning || !eligible(task)" @click="remove([task.id])">删除记录</button></div></article></template><template v-else-if="kind === 'pending'"><article v-for="asset in visibleCandidates" :key="asset.id" class="summary-record summary-candidate" :data-record-id="asset.id"><img :src="asset.thumbnailUrl || asset.imageUrl" :alt="asset.name" loading="lazy" /><div><header><h3>{{ asset.name }}</h3><span class="badge">{{ statusLabel(statusOf(asset)) }}</span></header><p>{{ asset.id }} · {{ time(asset.createdAt || asset.importedAt) }}</p><p class="muted">{{ asset.source }}</p><CandidateReview :sample="asset" @reviewed="reviewed" @editing="trackDraft(asset,$event)" /><div class="button-row"><button class="btn btn-secondary" @click="go(() => S.open('samples',asset))">查看样例档案</button><button v-if="statusOf(asset) === 'accepted'" class="btn btn-primary" @click="go(() => S.open('color',asset))">用于配墨</button><button v-if="statusOf(asset) === 'adjust'" class="btn btn-primary" @click="go(() => S.open('design',asset))">继续设计</button></div></div></article></template><template v-else-if="kind === 'ink'"><article v-for="run in inkRuns" :key="run.id" class="summary-record" :data-record-id="run.id"><header><label><input type="checkbox" :checked="selectedIds.includes(run.id)" :disabled="cleaning" :aria-label="`选择记录 ${run.inputName}`" @change="toggle(run.id,($event.target as HTMLInputElement).checked)" />选择</label><h3>{{ run.inputName || '未记录图片名称' }}</h3><span class="badge">分析成功</span></header><dl><div><dt>分析时间</dt><dd>{{ time(run.createdAt) }}</dd></div><div><dt>来源</dt><dd>{{ run.source || '未记录' }}</dd></div><div><dt>识别色层</dt><dd>{{ run.layerCount }} 层</dd></div><div><dt>合成偏差（RGB）</dt><dd>{{ Number.isFinite(run.difference) ? run.difference.toFixed(2) + ' / 255' : '未记录' }}</dd></div><div><dt>关联样例</dt><dd>{{ source(run)?.name || (run.sampleId ? '源样例已删除（'+run.sampleId+'）' : '用户上传图片') }}</dd></div></dl><p v-if="!S.canRestoreInkRun(run)" class="muted">此旧记录没有完整图片或配方快照，无法恢复当次操作。</p><div class="button-row"><button v-if="S.canRestoreInkRun(run)" class="btn btn-primary" @click="go(() => S.openInkRun(run))">打开此次配墨</button><button v-if="source(run)" class="btn btn-secondary" @click="go(() => S.open('samples',source(run)!))">查看来源样例</button><button v-if="source(run)" class="btn btn-secondary" @click="go(() => S.open('color',source(run)!))">重新配墨</button><button class="btn btn-danger" :disabled="cleaning" @click="remove([run.id])">删除记录</button></div></article></template></div></template>
<style scoped>
@reference "../assets/css/style.css";
.review-tabs { display: flex; flex-wrap: wrap; gap: 8px; }
.history-dialog { @apply grid gap-[18px]; color: var(--dl-text); font-size: 14px; }
.summary-record {
  @apply p-[18px] grid gap-4;
  border: .5px solid var(--dl-border);
  border-radius: var(--dsw-radius-xl, 20px);
  background: var(--dl-surface);
}
.summary-record header { @apply flex items-center gap-3 flex-wrap; }
.summary-record h3 { @apply text-[15px] font-semibold wrap-anywhere; flex: 1; color: var(--dl-text); }
.summary-record header label { @apply text-[13px] flex gap-[5px] items-center; color: var(--dl-muted); }
.summary-record input[type="checkbox"] { accent-color: var(--dl-accent); }
.summary-record dl { @apply grid grid-cols-[repeat(2,minmax(0,1fr))] gap-[13px]; }
.summary-record dl>div { @apply grid grid-cols-[95px_1fr] gap-2 text-[14px]; }
.summary-record dt { color: var(--dl-muted); }
.summary-record dd { @apply m-0 wrap-anywhere; color: var(--dl-text); font-variant-numeric: tabular-nums; }
.summary-candidate { @apply grid-cols-[140px_1fr]; align-items: start; }
.summary-candidate>img { @apply w-[140px] h-[140px] object-contain; background: var(--dl-inset); border-radius: var(--dsw-radius-lg, 16px); }
.summary-candidate>div { @apply grid gap-[13px] min-w-0; }
@media(max-width:600px) {
  .summary-record dl,.summary-candidate { grid-template-columns: 1fr; }
  .summary-candidate>img { width: 100%; height: 180px; }
  .summary-record { padding: 13px; }
}
</style>
