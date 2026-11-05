<script setup lang="ts">
import { computed, onBeforeUnmount, ref } from 'vue'
import { S } from '../services/workflows'
import { scoreLabel } from '../core/design-images'
import type { WorkflowAsset } from '../services/types'
import BigImageViewer from './BigImageViewer.vue'
import CandidateReview from './CandidateReview.vue'

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
  <div v-if="deleted" class="saved-empty"><strong>任务记录已删除</strong><span>已保存候选仍在样例库中。</span><button type="button" @click="S.navigate('samples')">查看样例库</button></div>
  <div v-else-if="assets.length" class="saved-results">
    <article v-for="asset in assets" :key="asset.id"><div class="saved-image"><BigImageViewer :src="asset.imageUrl" :preview-src="asset.thumbnailUrl" :alt="asset.name" /></div><div class="saved-copy"><strong>{{ asset.name }}</strong><p>此任务已保存的候选</p><p v-if="asset.parameters?.mode === 'twin'" title="原图与候选的全分辨率灰度 SSIM；明暗变化也会影响；负值显示 0%。">{{ similarity(asset) }}</p><CandidateReview :sample="asset" /></div></article>
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
  @apply [border:1px_solid_var(--border,#e5e7eb)];
  @apply rounded-[2px];
  @apply overflow-hidden;
  background: var(--card,#fff)
}
.saved-image {
  @apply h-[170px];
  background: var(--soft,#f9fafb)
}
.saved-copy {
  @apply p-[13px]
}
.saved-copy>strong {
  @apply text-[13px];
  color: var(--title,#111827)
}
.saved-copy>p {
  @apply text-[12px];
  color: var(--muted,#6b7280);
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
  color: var(--muted,#6b7280);
  @apply text-[13px]
}
.saved-empty strong {
  color: var(--title,#111827)
}
.saved-empty button {
  @apply [border:1px_solid_var(--border,#e5e7eb)];
  background: var(--card,#fff);
  color: var(--primary,#145f65);
  @apply rounded-[2px];
  @apply [padding:8px_14px];
  cursor: pointer
}
/* Long names remain readable within the existing layout. */
.saved-copy { @apply min-w-0; } .saved-copy>strong { @apply block wrap-anywhere; }
</style>
