<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { S } from '../services/workflows'
import type { CandidateStatus, WorkflowAsset } from '../services/types'

const props = defineProps<{ sample: WorkflowAsset }>()
const tick = ref(0), error = ref(''), saving = ref(false)
const unsubscribe = S.subscribe(() => tick.value++)
onBeforeUnmount(unsubscribe)
const current = computed(() => { tick.value; return S.assets.find(asset => asset.id === props.sample.id) })
const candidate = computed(() => !!current.value && S.isCandidate(current.value))
const disabled = computed(() => { tick.value; return saving.value || S.operations.review?.state === 'busy' || S.operations.save?.state === 'busy' })
watch(() => props.sample.id, () => { error.value = '' })
async function review(event: Event) {
  const select = event.target as HTMLSelectElement, status = select.value
  if (!current.value || !['pending', 'accepted', 'adjust', 'rejected'].includes(status)) return
  saving.value = true; error.value = ''
  try { await S.reviewCandidate(current.value.id, status as CandidateStatus) }
  catch (reason) { error.value = reason instanceof Error ? reason.message : '评价保存失败，请重试' }
  finally { saving.value = false; select.value = current.value?.candidateReview?.status || 'pending' }
}
</script>

<template>
  <div v-if="candidate" class="candidate-review">
    <label>候选评价<select aria-label="候选评价" :value="current?.candidateReview?.status || 'pending'" :disabled="disabled" @change="review"><option value="pending">待评价</option><option value="accepted">已采用</option><option value="adjust">需调整</option><option value="rejected">未采用</option></select></label>
    <p v-if="error" role="alert">{{ error }}</p>
  </div>
</template>

<style scoped>
@reference "../assets/css/style.css";
.candidate-review {
  @apply mt-[10px]
}
.candidate-review label {
  @apply flex;
  @apply items-center;
  @apply justify-between;
  @apply gap-[10px];
  color: var(--muted,#6b7280);
  @apply text-[12px]
}
.candidate-review select {
  @apply [padding:6px_9px];
  @apply [border:1px_solid_var(--border,#e5e7eb)];
  @apply rounded-[2px];
  background: var(--card,#fff);
  color: var(--text,#374151);
  @apply text-[12px]
}
.candidate-review p {
  @apply text-[12px];
  color: #dc2626;
  @apply [margin:7px_0_0]
}
</style>
