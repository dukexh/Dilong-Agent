<script setup lang="ts">
import { computed, nextTick, ref } from 'vue'
import { Modal } from 'ant-design-vue'
import { S } from '../services/workflows'
import { useWorkflowStore } from '../stores/workflow'
import PackageManager from './PackageManager.vue'
import MetadataEditor from './MetadataEditor.vue'
import HistoryDialog from './HistoryDialog.vue'
const store = useWorkflowStore(), packagePanel = ref<InstanceType<typeof PackageManager> | null>(null), editor = ref<InstanceType<typeof MetadataEditor> | null>(null), historyPanel = ref<InstanceType<typeof HistoryDialog> | null>(null)
const packageOpen = computed(() => { void store.tick; return S.packageOpen })
const editOpen = computed(() => { void store.tick; return !!S.editingAssetId })
const statsOpen = computed(() => { void store.tick; return !!S.statsView })
const statsSession = computed(() => { void store.tick; return S.statsSession })
const statsTitle = computed(() => ({ tasks:'设计任务', pending:'待评价方案', ink:'配墨操作记录' } as Record<string,string>)[store.statsView || ''] || '记录明细')
function closePackage() { if (!packagePanel.value?.busy) { S.packageOpen = false; S.status('package-dialog','ready') } }
function closeEditor() { if (!editor.value?.busy) S.closeEdit() }
function closeStats() { if (!historyPanel.value?.cleaning) S.closeStats(S.statsSession) }
async function focusTrigger() { await nextTick(); if (!S.statsView && S.statsTrigger?.isConnected) S.statsTrigger.focus() }
</script>
<template><Modal :open="packageOpen" title="导入样例文件包" :width="900" :footer="null" :destroy-on-close="true" :mask-closable="!packagePanel?.busy" :keyboard="!packagePanel?.busy" @cancel="closePackage"><PackageManager ref="packagePanel" /></Modal><Modal :key="store.editSession" :open="editOpen" title="编辑样例信息" :width="950" :footer="null" :destroy-on-close="true" :mask-closable="!editor?.busy" :keyboard="!editor?.busy" @cancel="closeEditor"><MetadataEditor ref="editor" /></Modal><Modal :key="'stats-'+statsSession" :open="statsOpen" :title="statsTitle" :width="1000" :footer="null" :destroy-on-close="true" :mask-closable="!historyPanel?.cleaning" :keyboard="!historyPanel?.cleaning" @cancel="closeStats" :after-close="focusTrigger"><HistoryDialog ref="historyPanel" /></Modal></template>
