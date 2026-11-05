<script setup lang="ts">
import { computed, ref, shallowRef, watch } from 'vue'
import { S } from '../services/workflows'
import type { SampleMetadata, WorkflowAsset } from '../services/types'
import { draft, groups, productionFields, staffFields } from '../core/sample-metadata'
import { useWorkflowStore } from '../stores/workflow'
const store = useWorkflowStore(), form = ref<SampleMetadata | null>(null), baseline = shallowRef<WorkflowAsset | null>(null), busy = ref(false), error = ref('')
watch(() => store.editSession, () => {
  baseline.value = S.editingAssetSnapshot || null; form.value = baseline.value ? draft(baseline.value) : null; error.value = ''
}, { immediate: true })
const current = computed(() => store.assets.find(asset => asset.id === baseline.value?.id))
const changed = computed(() => !!baseline.value && (!current.value || (current.value._revision || 0) !== (baseline.value._revision || 0)))
function reload() { if (current.value && window.confirm('重新加载会替换当前表单内容，是否继续？')) S.startEdit(current.value) }
async function save() {
  if (!baseline.value || !form.value || busy.value || changed.value) return
  busy.value = true; error.value = ''
  // Editable metadata follows the JSON package schema; IndexedDB cannot clone Vue proxies.
  try { const patch = JSON.parse(JSON.stringify(form.value)) as SampleMetadata; await S.updateAsset(baseline.value.id, patch, baseline.value); S.closeEdit() }
  catch (reason) { error.value = reason instanceof Error ? reason.message : '保存失败' } finally { busy.value = false }
}
function addProduction() { form.value?.productionRecords.push({ batchNo:'', stage:'', date:'', equipment:'', quantity:'', substrate:'', deltaE:'', result:'', operator:'' }) }
defineExpose({ busy })
</script>
<template><form v-if="form" class="metadata-form" @submit.prevent="save"><p class="muted">样例编号 {{ baseline?.id }}；图像分析根据图片生成，业务资料由用户提供。</p><div v-if="changed" role="alert" class="conflict-notice"><p>{{ current ? '该记录已在其他页面修改。当前填写内容已保留，请重新加载最新内容后核对。' : '该记录已在其他页面删除。当前填写内容已保留，但不能继续保存。' }}</p><button v-if="current" type="button" class="btn btn-secondary" @click="reload">重新加载最新内容</button></div><fieldset v-for="section in groups" :key="section.title" :disabled="busy"><legend>{{ section.title }}</legend><div class="metadata-grid"><label v-for="[key,label] in section.fields" :key="key">{{ label }}<input v-model="form[key]" class="form-control" :aria-label="label" /></label></div></fieldset><fieldset :disabled="busy"><legend>人员信息</legend><div class="metadata-grid"><label v-for="[key,label] in staffFields" :key="key">{{ label }}<input v-model="form.staff[key]" class="form-control" :aria-label="label" /></label></div></fieldset><fieldset :disabled="busy"><legend>生产记录</legend><div v-for="(row,index) in form.productionRecords" :key="index" class="record-editor"><div class="metadata-grid"><label v-for="[key,label] in productionFields" :key="key">{{ label }}<input v-model="row[key]" class="form-control" :type="key === 'date' ? 'date' : 'text'" :aria-label="`生产记录${index+1}${label}`" /></label></div><button type="button" class="btn btn-danger" @click="form.productionRecords.splice(index,1)">删除此条生产记录</button></div><button type="button" class="btn btn-secondary" @click="addProduction">添加生产记录</button></fieldset><fieldset :disabled="busy"><legend>评价与反馈</legend><label>反馈说明<textarea v-model="form.feedback" class="form-control" rows="4" aria-label="反馈说明" /></label></fieldset><fieldset :disabled="busy"><legend>历史记录</legend><div v-for="(row,index) in form.history" :key="index" class="record-editor"><div class="metadata-grid"><label>日期<input v-model="row.date" type="date" class="form-control" :aria-label="`历史记录${index+1}日期`" /></label><label>标题<input v-model="row.title" class="form-control" :aria-label="`历史记录${index+1}标题`" /></label><label>状态<input v-model="row.status" class="form-control" :aria-label="`历史记录${index+1}状态`" /></label><label>描述<textarea v-model="row.description" class="form-control" :aria-label="`历史记录${index+1}描述`" /></label></div><button type="button" class="btn btn-danger" @click="form.history.splice(index,1)">删除此条历史记录</button></div><button type="button" class="btn btn-secondary" @click="form.history.push({date:'',title:'',description:'',status:''})">添加历史记录</button></fieldset><p v-if="error" role="alert" class="error-message">{{ error }}</p><div class="button-row"><button type="submit" class="btn btn-primary" :disabled="busy || changed">{{ busy ? '保存中…' : '保存信息' }}</button><button type="button" class="btn btn-secondary" :disabled="busy" @click="S.closeEdit()">取消</button></div></form></template>
<style scoped>
@reference "../assets/css/style.css";
.metadata-form {
  @apply grid;
  @apply gap-[22px]
}
.metadata-form fieldset {
  @apply [border:1px_solid_var(--border)];
  @apply rounded-[2px];
  @apply p-[18px];
  @apply min-w-[0]
}
.metadata-form legend {
  @apply font-[600];
  @apply [padding:0_8px]
}
.metadata-grid {
  @apply grid;
  @apply grid-cols-[repeat(2,minmax(0,1fr))];
  @apply gap-[16px]
}
.metadata-form label {
  @apply grid;
  @apply gap-[7px];
  @apply text-[12px]
}
.record-editor {
  @apply pb-[20px];
  @apply mb-[20px];
  @apply [border-bottom:1px_solid_var(--border)];
  @apply grid;
  @apply gap-[14px]
}
.record-editor .btn {
  @apply w-[fit-content]
}
.metadata-form textarea {
  @apply w-[100%];
  resize: vertical
}@media(max-width:600px){
.metadata-grid {
  @apply grid-cols-[1fr]
}
.metadata-form fieldset {
  @apply p-[12px]
}}
</style>
