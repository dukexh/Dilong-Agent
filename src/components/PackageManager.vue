<script setup lang="ts">
import { computed, ref, shallowRef } from 'vue'
import { S } from '../services/workflows'
import type { PackageRow } from '../services/types'
import { useWorkflowStore } from '../stores/workflow'
import { assetUrl } from '../core/sample-library'
const store = useWorkflowStore(), rows = shallowRef<PackageRow[] | null>(null), busy = ref(false), error = ref(''), fileName = ref(''), importedIds = ref<string[]>([])
const valid = computed(() => rows.value?.filter(row => row.state === '有效').length || 0)
const counts = computed(() => ({ duplicate: rows.value?.filter(row => row.state.startsWith('重复')).length || 0, error: rows.value?.filter(row => row.state.startsWith('错误')).length || 0 }))
async function select(event: Event) {
  const input = event.target as HTMLInputElement, file = input.files?.[0]; input.value = ''
  if (!file || busy.value) return
  busy.value = true; rows.value = null; error.value = ''; fileName.value = file.name; importedIds.value = []
  try { rows.value = await S.previewPackage(file) } catch (reason) { error.value = reason instanceof Error ? reason.message : '无法读取样例包' } finally { busy.value = false }
}
async function commit() {
  if (!rows.value || busy.value) return
  busy.value = true; error.value = ''
  try { const count = await S.commitPackage(rows.value); importedIds.value = [...S.lastImportIds]; rows.value = null; error.value = `已导入 ${count} 条样例` } catch (reason) { error.value = '保存失败：' + (reason instanceof Error ? reason.message : String(reason)) } finally { busy.value = false }
}
defineExpose({ busy })
</script>
<template><section class="package-manager"><p>导入自己的图片和业务资料，先校验再确认入库。编号重复的记录会跳过。</p><label class="file-picker btn btn-primary">{{ busy ? '正在校验图片…' : '选择 ZIP 样例包' }}<input type="file" accept=".zip" aria-label="导入样例文件包" :disabled="busy" @change="select" /></label><span class="muted">{{ fileName || '未选择文件' }}</span><p v-if="error" role="status" class="operation-message">{{ error }}</p><div v-if="rows" class="import-preview"><p class="badge">有效 {{ valid }} · 重复 {{ counts.duplicate }} · 错误 {{ counts.error }}</p><ul class="import-rows"><li v-for="(row,index) in rows" :key="index">{{ String(row.record.id || '无编号') }} {{ String(row.record.name || '') }}：{{ row.state }}</li></ul><button class="btn btn-primary" :disabled="busy || !valid" @click="commit">确认导入有效记录</button></div><button v-if="importedIds.length" class="btn btn-secondary" @click="S.showImported(importedIds)">查看导入样例</button><details class="package-format"><summary>样例包制作方法与格式</summary><p>ZIP 顶层放置 manifest.json 和 images 文件夹。请以 UTF-8 保存清单，编号、名称和图片为必填项。</p><pre>{"schemaVersion":1,"samples":[{"id":"MY-001","name":"自己的纹理","image":"images/01.png","wood":"橡木","style":"自然","tone":"浅色"}]}</pre><ol><li>准备自己的 PNG、JPG 或 WebP 图片。</li><li>按示例填写清单，选中清单与 images 文件夹一起压缩，不在外面再套文件夹。</li><li>选择 ZIP，查看有效、重复及错误明细后确认导入。</li></ol><p>ZIP 不超过100 MB，解压内容不超过150 MB；单张图片不超过30 MB、4000万像素。样例数量不设上限。</p><p>客户、工艺、人员和生产记录可以随清单导入，也可入库后编辑补充。未填写内容不会自动生成；生产实测值与图像算法值分别保存。</p><p>人员字段：designer、colorist、operator、reviewer。生产记录需填写 batchNo；日期使用 YYYY-MM-DD，实测色差为非负数。</p><div class="button-row"><a class="text-link" :href="assetUrl('示例样例包.zip')" download>下载示例样例包</a><a class="text-link" :href="assetUrl('样例包格式说明.txt')" download>下载完整格式说明</a><a class="text-link" :href="assetUrl('制作自己的样例包.txt')" download>制作步骤</a></div></details><button class="btn btn-secondary" :disabled="busy || !store.personalSamples.length || store.operations.package?.state === 'busy'" @click="S.exportPackage()">导出我的样例包</button><p v-if="store.operations.package?.message" role="status">{{ store.operations.package.message }}</p></section></template>
<style scoped>
@reference "../assets/css/style.css";
.package-manager { @apply grid gap-[18px] grid-cols-[minmax(0,1fr)]; color: var(--dl-text); font-size: 14px; line-height: 1.65; }
.package-manager>* { min-width: 0; }
.package-manager>span { overflow-wrap: anywhere; }
.file-picker { @apply w-fit relative overflow-hidden; cursor: pointer; }
.file-picker input { @apply absolute inset-0; opacity: 0; cursor: pointer; }
.file-picker:focus-within { outline: 2px solid var(--dl-accent); outline-offset: 2px; }
.package-format { padding: 16px; border: .5px solid var(--dl-border); border-radius: var(--dsw-radius-lg, 16px); background: var(--dl-surface); }
.package-format summary { font-weight: 600; cursor: pointer; color: var(--dl-text); }
.package-format summary:focus-visible { outline: 2px solid var(--dl-accent); outline-offset: 3px; }
.package-format p,.package-format ol { margin-top: 12px; line-height: 1.9; }
.package-format pre { @apply p-3 whitespace-pre-wrap wrap-anywhere text-[13px]; background: var(--dl-inset); color: var(--dl-text); border-radius: var(--dsw-radius-md, 12px); font-family: var(--dl-mono); }
.import-rows { @apply max-h-[240px] overflow-auto px-5 py-[15px]; list-style: disc; background: var(--dl-inset); border-radius: var(--dsw-radius-md, 12px); overscroll-behavior: contain; }
.import-rows li { @apply p-[3px] wrap-anywhere; }
.import-preview { @apply grid gap-3; }
</style>
