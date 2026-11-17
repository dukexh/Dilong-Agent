<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue'
import type { RGB } from '../core/types'
import type { RepresentativeComparison } from '../core/ink-recipe'
import { CompareCore } from '../core/production-compare-core'
import { labFormula, cieFormula } from '../core/color-formulas'
type Metric = 'deltaE'|'rgb'|'bias'
const props=defineProps<{target?:RGB;actual?:RGB;result:RepresentativeComparison|null}>()
const model=defineModel<Metric|null>({required:true}), dialog=ref<HTMLDialogElement>()
let trigger:HTMLElement|null=null
const names={deltaE:'代表色色差 ΔE00',rgb:'代表色 RGB 偏差',bias:'偏色方向'}
const formula={deltaE:'ΔE00 = √[(ΔL′/S_L)² + (ΔC′/S_C)² + (ΔH′/S_H)² + R_T(ΔC′/S_C)(ΔH′/S_H)]\nkL = kC = kH = 1',rgb:'RGB 偏差 = √[((R实涂 − R目标)² + (G实涂 − G目标)² + (B实涂 − B目标)²) / 3]',bias:'ΔL* = L*实涂 − L*目标\nΔa* = a*实涂 − a*目标\nΔb* = b*实涂 − b*目标'}
const format=(values:number[])=>values.map(v=>v.toFixed(2)).join(' / ')
const lab=(rgb:RGB)=>format(CompareCore.rgbToLab(rgb.r,rgb.g,rgb.b))
const current=computed(()=>!props.result?'—':model.value==='bias'?`ΔL* ${props.result.deltaL.toFixed(2)} / Δa* ${props.result.deltaA.toFixed(2)} / Δb* ${props.result.deltaB.toFixed(2)}`:props.result[model.value||'deltaE'].toFixed(2))
watch(model,async value=>{if(value){trigger=document.activeElement as HTMLElement;await nextTick();dialog.value?.showModal()}else{dialog.value?.close();await nextTick();trigger?.focus()} })
onBeforeUnmount(()=>dialog.value?.close())
</script>
<template><Teleport to="body"><dialog ref="dialog" class="color-metric-dialog dilong-theme" aria-labelledby="color-metric-title" @cancel.prevent="model=null" @close="model=null"><template v-if="model"><header><h2 id="color-metric-title">{{names[model]}} · 计算详情</h2><button class="btn btn-secondary" aria-label="关闭指标详情" @click="model=null">关闭</button></header><p>两张原图分别求有效像素平均 RGB，仅排除完全透明像素；非零透明度像素等权参与。</p><pre>R̄ = ΣRᵢ / N；Ḡ = ΣGᵢ / N；B̄ = ΣBᵢ / N
N 为各自图片的有效像素数，两张图片尺寸可以不同。</pre><pre>{{formula[model]}}</pre><p v-if="model==='bias'">ΔL* 正值偏亮、负值偏暗；Δa* 正值偏红、负值偏绿；Δb* 正值偏黄、负值偏蓝。各分量绝对值达到0.5时显示方向文字，较小值仍保留数值。三个分量不相加为一个分数，此规则不是合格阈值。</p><p v-else>数值越小，代表色越接近。这里比较两个平均颜色，不是逐像素色差的平均值。{{model==='rgb'?'RGB偏差范围0—255，不是百分比，仅作辅助参考。':''}}</p><div v-if="result&&target&&actual" class="current"><strong>本次结果：{{current}}</strong><p>目标 RGB：{{format(Object.values(target))}}；实涂 RGB：{{format(Object.values(actual))}}</p><p>目标 Lab：{{lab(target)}}；实涂 Lab：{{lab(actual)}}</p><small>内部使用未取整数值计算，此处显示两位小数。</small></div><p v-else>完成实涂比对后，这里会显示本次代表色及结果。</p><details v-if="model==='deltaE'"><summary>查看 CIEDE2000 修正项定义</summary><pre>{{cieFormula}}</pre></details><details v-if="model!=='rgb'"><summary>查看 RGB → Lab 转换公式</summary><pre>{{labFormula}}</pre><p>按 sRGB 转换，采用 D65 白点；先平均 RGB，再转换 Lab。</p></details></template></dialog></Teleport></template>
<style scoped>
@reference "../assets/css/style.css";
.color-metric-dialog {
  @apply w-[min(760px,calc(100vw-32px))] max-h-[85vh] m-auto p-6 overflow-auto;
  border: 0;
  border-radius: var(--dsw-radius-panel, 28px);
  background: var(--dl-surface);
  color: var(--dl-text);
  box-shadow: var(--dl-shadow);
  font-family: var(--dl-font);
  font-size: 14px;
  overscroll-behavior: contain;
}
.color-metric-dialog::backdrop { background: var(--dl-mask); backdrop-filter: none; }
header { @apply flex items-center justify-between gap-[14px] pb-3; border-bottom: .5px solid var(--dl-border); }
h2 { @apply text-[18px] font-semibold m-0; }
p { @apply text-[14px] leading-[1.7] my-3; }
pre {
  @apply whitespace-pre-wrap wrap-anywhere text-[13px] leading-[1.9] p-[14px] my-3;
  background: var(--dl-inset);
  color: var(--dl-text);
  border: .5px solid var(--dl-border);
  border-radius: var(--dsw-radius-lg, 16px);
  font-family: var(--dl-mono);
  font-variant-numeric: tabular-nums;
}
details { @apply mt-4 text-[14px]; }
summary { cursor: pointer; color: var(--dl-accent); }
summary:focus-visible { outline: 2px solid var(--dl-accent); outline-offset: 3px; }
.current { @apply p-[14px] text-[14px]; background: var(--dl-accent-soft); border-radius: var(--dsw-radius-lg, 16px); }
.current strong { font-variant-numeric: tabular-nums; }
.current small { font-size: 13px; color: var(--dl-muted); }
</style>
