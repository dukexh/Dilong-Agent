<script setup lang="ts">
import { computed, onBeforeUnmount, ref } from 'vue'
import { S } from '../services/workflows'
import { scoreLabel } from '../core/design-images'
import type { WorkflowAsset } from '../services/types'
import BigImageViewer from './BigImageViewer.vue'
import CandidateReview from './CandidateReview.vue'
import EngineeringExportButton from './EngineeringExportButton.vue'

const props = defineProps<{ taskId: string | null }>()
const tick = ref(0)
const unsubscribe = S.subscribe(() => tick.value++)
onBeforeUnmount(unsubscribe)
const task = computed(() => { tick.value; return S.tasks.find(row => row.id === props.taskId) })
const deleted = computed(() => { tick.value; return !!props.taskId && S.deletedHistory.tasks.has(props.taskId) })
const assets = computed(() => { tick.value; return (task.value?.resultIds || []).map(id => S.assets.find(asset => asset.id === id)).filter((asset): asset is WorkflowAsset => !!asset) })
function similarity(asset: WorkflowAsset) { return scoreLabel(typeof asset.parameters?.structureSimilarity === 'number' ? asset.parameters.structureSimilarity : null) }
</script>

<template>
  <div v-if="deleted" class="saved-empty"><strong>任务记录已删除</strong><span>已保存候选仍在方案评价中，采用后进入样例库。</span><button type="button" @click="S.showStats('pending')">查看方案评价</button></div>
  <div v-else-if="assets.length" class="saved-results">
    <article v-for="asset in assets" :key="asset.id"><div class="saved-image"><BigImageViewer :src="asset.imageUrl" :preview-src="asset.thumbnailUrl" :alt="asset.name" /></div><div class="saved-copy"><strong>{{ asset.name }}</strong><p>此任务已保存的候选</p><p v-if="asset.parameters?.mode === 'twin'" title="原图与候选的全分辨率灰度 SSIM；明暗变化也会影响；负值显示 0%。">{{ similarity(asset) }}</p><EngineeringExportButton :src="asset.imageUrl" :name="asset.name" :project="asset.parameters?.engineering"/><CandidateReview :sample="asset" /></div></article>
  </div>
  <div v-else class="saved-empty"><strong>本任务尚未保存候选</strong><span>{{ task?.error || '输入与参数已恢复，可重新执行并保存需要的方案。' }}</span></div>
</template>

<style scoped>
@reference "../assets/css/style.css";
.saved-results {
  @apply grid;
  @apply grid-cols-[repeat(auto-fill,minmax(210px,1fr))];
  @apply gap-[14px]
}
.saved-results article {
  @apply [border:.5px_solid_var(--border,var(--dl-inset))];
  @apply rounded-[var(--dl-r-md)];
  @apply overflow-hidden;
  background: var(--card,var(--dl-surface))
}
.saved-image {
  @apply h-[170px];
  background: var(--soft,var(--dl-surface))
}
.saved-copy {
  @apply p-[13px]
}
.saved-copy>strong {
  @apply text-[14px];
  color: var(--title,var(--dl-text))
}
.saved-copy>p {
  @apply text-[13px];
  color: var(--muted,var(--dl-muted));
  @apply [margin:7px_0]
}
.saved-empty {
  @apply min-h-[230px];
  @apply flex;
  @apply flex-col;
  @apply justify-center;
  @apply items-center;
  @apply gap-[12px];
  @apply text-center;
  color: var(--muted,var(--dl-muted));
  @apply text-[14px]
}
.saved-empty strong {
  color: var(--title,var(--dl-text))
}
.saved-empty button {
  @apply [border:.5px_solid_var(--border,var(--dl-inset))];
  background: var(--card,var(--dl-surface));
  color: var(--primary,var(--dl-accent));
  @apply rounded-[var(--dl-r-md)];
  @apply [padding:8px_14px];
  cursor: pointer
}
/* Long names remain readable within the existing layout. */
.saved-copy { @apply min-w-0; } .saved-copy>strong { @apply block wrap-anywhere; }
</style>
