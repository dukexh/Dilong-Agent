<script setup lang="ts">
import { computed, onBeforeUnmount, ref, shallowRef, watch } from 'vue'
import { S } from '../services/workflows'
import type { CandidateStatus, WorkflowAsset } from '../services/types'

const props = defineProps<{ sample: WorkflowAsset }>()
const emit = defineEmits<{ reviewed: [status: CandidateStatus]; editing: [dirty: boolean] }>()
const tick = ref(0), error = ref(''), saving = ref(false), draftStatus = ref<CandidateStatus>('pending'), note = ref(''), saved = ref('')
const unsubscribe = S.subscribe(() => tick.value++)
onBeforeUnmount(unsubscribe)
const current = computed(() => { tick.value; return S.assets.find(asset => asset.id === props.sample.id) })
const baseline = shallowRef<WorkflowAsset | null>(null), conflicted = ref(false)
const dirty = computed(() => draftStatus.value !== (baseline.value?.candidateReview?.status || 'pending') || note.value.trim() !== (baseline.value?.candidateReview?.note || ''))
const candidate = computed(() => !!current.value && S.isCandidate(current.value) || dirty.value)
const disabled = computed(() => { tick.value; return saving.value || S.operations.review?.state === 'busy' || S.operations.save?.state === 'busy' })
function reload() {
  if (!current.value) return
  baseline.value = structuredClone(current.value)
  draftStatus.value = current.value.candidateReview?.status || 'pending'
  note.value = current.value.candidateReview?.note || ''
  conflicted.value = false; error.value = ''; saved.value = ''
}
watch(current, value => {
  if (!baseline.value || baseline.value.id !== props.sample.id) { reload(); return }
  if (value && (value._revision || 0) === (baseline.value._revision || 0)) return
  if (dirty.value || saving.value) conflicted.value = true
  else reload()
}, { immediate: true })
watch(dirty, value => emit('editing', value), { immediate: true, flush: 'sync' })
async function review() {
  if (!current.value || disabled.value || !dirty.value || conflicted.value || !baseline.value) return
  saving.value = true; error.value = ''; saved.value = ''
  const status = draftStatus.value
  try { await S.reviewCandidate(current.value.id, status, note.value, baseline.value); reload(); saved.value = status === 'accepted' ? '评价已保存，方案已进入样例库' : '评价已保存，候选保留在方案评价中'; emit('reviewed', status) }
  catch (reason) { error.value = reason instanceof Error ? reason.message : '评价保存失败，请重试' }
  finally { saving.value = false }
}
</script>

<template>
  <div v-if="candidate" class="candidate-review">
    <label>候选评价<select aria-label="候选评价" v-model="draftStatus" :disabled="disabled"><option value="pending">待评价</option><option value="accepted">已采用</option><option value="adjust">需调整</option><option value="rejected">未采用</option></select></label>
    <label class="review-note">{{ draftStatus === 'adjust' ? '调整意见（选填）' : draftStatus === 'rejected' ? '未采用原因（选填）' : '评价备注（选填）' }}<textarea v-model="note" aria-label="评价意见" maxlength="2000" rows="2" :disabled="disabled" placeholder="例如：颜色偏深，希望降低明暗反差" /></label>
    <p class="library-effect" role="status">{{ current?.candidateReview?.status === 'accepted' && draftStatus !== 'accepted' ? '保存后将从样例库撤下，候选和已有配墨历史保留。' : draftStatus === 'accepted' ? '保存为已采用后进入正式样例库，可用于检索、设计和配墨。' : '此状态仅保留在方案评价中，不进入正式样例库。' }}</p><div class="button-row"><button type="button" class="btn btn-primary" :disabled="disabled || !dirty || conflicted || !current" @click="review">{{ saving ? '保存中…' : '保存评价' }}</button><span v-if="saved && !dirty" role="status">{{ saved }}</span><span v-else-if="dirty" class="muted">修改尚未保存</span></div>
    <div v-if="conflicted" role="alert" class="review-conflict"><p>{{ current ? '此方案已在其他页面修改，当前草稿已保留。请复制需要保留的意见，再重新加载最新评价后核对。' : '此方案已在其他页面删除，当前草稿已保留供复制，不能继续保存。' }}</p><button v-if="current" type="button" class="btn btn-secondary" :disabled="saving" @click="reload">重新加载最新评价（放弃草稿）</button></div><p v-if="error" role="alert">{{ error }}</p>
  </div>
</template>

<style scoped>
@reference "../assets/css/style.css";
.candidate-review { margin-top: 10px; color: var(--dl-text); }
.candidate-review label { @apply flex items-center justify-between gap-[10px] text-[14px]; color: var(--dl-muted); }
.review-note { margin: 10px 0; flex-direction: column; align-items: stretch !important; }
.review-note textarea,.candidate-review select {
  padding: 8px 10px;
  border: .5px solid var(--dl-border);
  border-radius: var(--dsw-radius-md, 12px);
  color: var(--dl-text);
  background: var(--dl-inset);
  font-family: var(--dl-font);
  font-size: 14px;
}
.review-note textarea { width: 100%; resize: vertical; }
.candidate-review select { min-height: 36px; padding: 6px 9px; }
.review-note textarea:focus-visible,.candidate-review select:focus-visible { outline: 2px solid var(--dl-accent); outline-offset: 2px; }
.candidate-review .library-effect { color: var(--dl-muted); margin: 10px 0; line-height: 1.6; font-size: 13px; }
.candidate-review p { margin: 7px 0 0; font-size: 13px; line-height: 1.6; color: var(--dl-danger); }
.review-conflict { margin-top: 10px; padding: 12px; border: .5px solid var(--dl-warning); border-radius: var(--dsw-radius-md, 12px); background: var(--dl-warning-soft); }
.review-conflict p { color: var(--dl-warning); }
.candidate-review .button-row [role="status"] { font-size: 13px; color: var(--dl-success); }
@media (hover: hover) {
  .review-note textarea:hover,.candidate-review select:hover { border-color: var(--dl-border-strong); }
}
</style>
