<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { Check, LoaderCircle, Save } from 'lucide-vue-next'
import { message } from 'ant-design-vue'
import { S } from '../services/workflows'
import type { DesignParameters } from '../services/types'
import CandidateReview from './CandidateReview.vue'

const props = withDefaults(defineProps<{ src: string; name: string; source: string; parameters?: DesignParameters; sourceKey: string; taskId?: string | null }>(), { parameters: () => ({}) })
const tick = ref(0), error = ref(''), saving = ref(false)
const unsubscribe = S.subscribe(() => tick.value++)
onBeforeUnmount(unsubscribe)
const taskId = computed(() => { tick.value; const id = props.taskId === undefined ? S.activeTask : props.taskId; return S.tasks.some(task => task.id === id) ? id : null })
const saved = computed(() => { tick.value; return S.assets.find(asset => asset.sourceKey === props.sourceKey) })
const linked = computed(() => { tick.value; return !!saved.value && (!taskId.value || !!S.tasks.find(task => task.id === taskId.value)?.resultIds.includes(saved.value.id)) })
const busy = computed(() => { tick.value; return saving.value || S.operations.save?.state === 'busy' })
const label = computed(() => saving.value ? '正在保存…' : linked.value && !error.value ? '已保存候选' : error.value ? '保存失败，点击重试' : saved.value ? '关联到当前任务' : '保存候选方案')
watch(() => [props.sourceKey, props.taskId], () => { error.value = '' })
async function save() {
  if (busy.value || linked.value && !error.value) return
  error.value = ''; saving.value = true
  try {
    await S.save(props.src, props.name, props.source, props.parameters, props.sourceKey, taskId.value)
    message.success('已将候选内容保存到样例库中')
  } catch (reason) { error.value = `保存失败：${reason instanceof Error ? reason.message : '请重试'}` }
  finally { saving.value = false }
}
</script>

<template>
  <div class="candidate-save">
    <button type="button" :class="{ saved: linked && !error }" :disabled="busy || (linked && !error)" @click="save"><LoaderCircle v-if="saving" :size="14" class="spin" /><Check v-else-if="linked && !error" :size="14" /><Save v-else :size="14" />{{ label }}</button>
    <p v-if="error" class="save-error" role="alert">{{ error }}</p>
    <CandidateReview v-if="saved" :sample="saved" />
  </div>
</template>

<style scoped>
@reference "../assets/css/style.css";
.candidate-save button {
  @apply w-[100%];
  @apply flex;
  @apply items-center;
  @apply justify-center;
  @apply gap-[7px];
  @apply [border:1px_solid_#c3d8d9];
  background: #edf5f5;
  color: #145f65;
  @apply [padding:9px_12px];
  @apply rounded-[2px];
  @apply text-[12px];
  cursor: pointer
}
.candidate-save button.saved {
  color: #16a34a;
  @apply [border-color:#d1f0d9];
  background: #f2fbf5
}
.candidate-save button:disabled {
  cursor: default;
  opacity: .8
}
.save-error {
  @apply text-[12px];
  color: #dc2626;
  @apply [margin:7px_0_0]
}
.spin {
  animation: spin 1s linear infinite
}@keyframes spin{
to {
  transform: rotate(360deg)
}}
</style>
