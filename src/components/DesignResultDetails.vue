<script setup lang="ts">
import type { ModelUsage } from '../core/types'
defineProps<{ model?: unknown; prompt?: unknown; width?: number; height?: number; similarityError?: unknown; usage?: ModelUsage }>()
</script>
<template>
  <details v-if="model || prompt" class="design-result-details">
    <summary>结果详情</summary>
    <dl>
      <div v-if="model"><dt>生成模型</dt><dd>{{model}}</dd></div>
      <div v-if="prompt"><dt>设计要求</dt><dd>{{prompt}}</dd></div>
      <div v-if="width && height"><dt>实际像素</dt><dd>{{width}} × {{height}}</dd></div>
      <div v-if="similarityError"><dt>结构比较</dt><dd>{{similarityError}}</dd></div>
      <div v-if="usage"><dt>本次调用用量</dt><dd>输入 {{usage.inputTokens??'未报告'}} Token · 输出 {{usage.outputTokens??'未报告'}} Token<span v-if="usage.outputImages"> · 生成 {{usage.outputImages}} 张</span><span v-if="usage.recorded===false"> · 用量记录未保存</span></dd></div>
    </dl>
  </details>
</template>
<style scoped>
.design-result-details{margin:8px 0;color:var(--dl-muted);font-size:12px;overflow-wrap:anywhere}
summary{cursor:pointer}dl{margin:8px 0}dl>div{margin:6px 0}dt{font-weight:600}dd{margin:3px 0;white-space:pre-wrap}
</style>
