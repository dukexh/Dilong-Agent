<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, shallowRef, watch } from 'vue'
import Panel from '../components/Panel.vue'
import ColorMetricDialog from '../components/ColorMetricDialog.vue'
import InkSelector from '../components/InkSelector.vue'
import { average, combinationLabel, compare, normalize, labels, recipe, type InkKey, type RepresentativeComparison } from '../core/ink-recipe'
import { rgbToHex } from '../core/color-analysis'
import { DesignImages } from '../core/design-images'
import type { RGB, InkRecipe } from '../core/types'
type Side = 0 | 1
interface ColorAsset { url: string; rgb: RGB; name: string; example: boolean }
const target=shallowRef<ColorAsset|null>(null), actual=shallowRef<ColorAsset|null>(null)
const selected=ref<InkKey[]>(normalize()), weight=ref<number|string>(10)
const applied=ref<{selected:InkKey[];weight:number}|null>(null), formula=ref<InkRecipe|null>(null)
const result=ref<RepresentativeComparison|null>(null), loading=ref<[boolean,boolean]>([false,false]), errors=ref(['',''])
const inputs=ref<HTMLInputElement[]>([]), metric=ref<'deltaE'|'rgb'|'bias'|null>(null)
const review=ref('未判定'), notes=ref('')
const sequence=[0,0]; let alive=true
const validWeight=computed(()=>weight.value!==''&&Number.isFinite(Number(weight.value))&&Number(weight.value)>=.5&&Number(weight.value)<=500)
const validSelection=computed(()=>selected.value.length>0)
const pending=computed(()=>!!applied.value&&(selected.value.join()!==applied.value.selected.join()||!validWeight.value||Number(weight.value)!==applied.value.weight))
const actualDisabled=computed(()=>!target.value||!formula.value||pending.value||loading.value[0])
const canCompare=computed(()=>!!target.value&&!!actual.value&&!!formula.value&&!loading.value.some(Boolean)&&!pending.value)
const num=(value:number|undefined)=>value===undefined?'—':value.toFixed(2)
const components=Object.keys(labels) as (keyof InkRecipe)[]
const directions=computed(()=>result.value?[[result.value.deltaL,'偏亮','偏暗'],[result.value.deltaA,'偏红','偏绿'],[result.value.deltaB,'偏黄','偏蓝']].filter(([v])=>Math.abs(Number(v))>=.5).map(([v,pos,neg])=>Number(v)>0?pos:neg).join('、')||'偏色方向不明显':'—')
const status=computed(()=>loading.value.some(Boolean)?'正在读取':errors.value.some(Boolean)?'图片读取失败':pending.value?'参数待确认':result.value?'比对完成':!target.value?'待上传目标':!formula.value?'待生成建议':!actual.value?'待上传实涂':'待比对')
const metricNames={deltaE:'代表色色差 ΔE00',rgb:'代表色 RGB 偏差',bias:'偏色方向'}
const metricKeys=['deltaE','rgb','bias'] as const
const biasKeys=[['ΔL*','deltaL'],['Δa*','deltaA'],['Δb*','deltaB']] as const
watch(result,()=>{review.value='未判定';notes.value='';metric.value=null})
function demo(rgb:RGB,name:string):ColorAsset {const c=document.createElement('canvas');c.width=480;c.height=320;const ctx=c.getContext('2d')!;ctx.fillStyle=rgbToHex(rgb);ctx.fillRect(0,0,c.width,c.height);return {url:c.toDataURL(),rgb,name,example:true}}
function restore(){sequence[0]++;sequence[1]++;target.value=demo({r:160,g:130,b:100},'目标颜色（演示）');actual.value=demo({r:170,g:125,b:92},'模拟实涂（演示）');selected.value=normalize();weight.value=10;applied.value={selected:normalize(),weight:10};formula.value=recipe(target.value.rgb);result.value=compare(target.value.rgb,actual.value.rgb);loading.value=[false,false];errors.value=['','']}
function generate(){if(!target.value||!validWeight.value||!validSelection.value)return;if(applied.value&&selected.value.join()!==applied.value.selected.join()){sequence[1]++;actual.value=null;result.value=null;loading.value[1]=false;errors.value[1]=''}formula.value=recipe(target.value.rgb,selected.value);applied.value={selected:normalize(selected.value),weight:Number(weight.value)}}
function compareActual(){if(canCompare.value)result.value=compare(target.value!.rgb,actual.value!.rgb)}
function selectedFile(side:Side,event:Event){const field=event.target as HTMLInputElement,file=field.files?.[0];field.value='';if(file)void upload(side,file)}
async function upload(side:Side,file:File){
  if(side===1&&actualDisabled.value)return
  const token=++sequence[side]!;metric.value=null;result.value=null
  if(side===0){sequence[1]++;target.value=null;actual.value=null;applied.value=null;formula.value=null;selected.value=normalize();loading.value=[true,false];errors.value=['','']}else{actual.value=null;loading.value[1]=true;errors.value[1]=''}
  let url=''
  try{
    if(!file.type.startsWith('image/'))throw Error('仅支持 JPG、PNG、WEBP 等图片文件')
    if(file.size>12*1024*1024)throw Error('图片不能超过 12 MB')
    url=URL.createObjectURL(file)
    const image=await new Promise<HTMLImageElement>((resolve,reject)=>{const im=new Image();im.onload=()=>resolve(im);im.onerror=()=>reject(Error('图片加载失败，请更换图片后重试'));im.src=url})
    if(!alive||token!==sequence[side])return
    DesignImages.validateSize(image.naturalWidth,image.naturalHeight)
    const canvas=document.createElement('canvas');canvas.width=image.naturalWidth;canvas.height=image.naturalHeight
    const ctx=canvas.getContext('2d',{willReadFrequently:true});if(!ctx)throw Error('无法读取图片')
    ctx.drawImage(image,0,0);const rgb=average(ctx.getImageData(0,0,canvas.width,canvas.height)),saved=canvas.toDataURL('image/png');canvas.width=canvas.height=0
    const asset={url:saved,rgb,name:file.name,example:false}
    if(side===0)target.value=asset;else{actual.value=asset;result.value=compare(target.value!.rgb,rgb)}
  }catch(e){if(alive&&token===sequence[side])errors.value[side]=e instanceof Error?e.message:'图片读取失败'}
  finally{if(url)URL.revokeObjectURL(url);if(alive&&token===sequence[side])loading.value[side]=false}
}
onMounted(restore)
onBeforeUnmount(()=>{alive=false;sequence[0]++;sequence[1]++})
</script>
<template><div class="color-compare embedded-module" data-module="color-compare"><main class="workspace">
  <div class="page-heading"><div><div class="breadcrumb">颜色比对工作台 / 目标配墨与实涂复核</div><h1>颜色比对</h1><p>目标颜色 → 选墨与配方 → 实际涂层 → 颜色比较</p></div><button class="btn btn-secondary" @click="restore">恢复演示</button></div>
  <p v-if="target?.example||actual?.example" class="cc-notice" role="status">演示：当前包含内置颜色图，模拟实涂不是真实生产数据；配方和色差由当前颜色实际计算。</p>
  <section class="summary-strip cc-summary" aria-label="颜色比对指标" aria-live="polite"><div><span>任务状态</span><strong>{{status}}</strong></div><div><span>{{metricNames.deltaE}}</span><strong data-metric="deltaE">{{num(result?.deltaE)}}</strong></div><div><span>{{metricNames.rgb}}</span><strong data-metric="rgb">{{num(result?.rgb)}}</strong></div><div><span>偏色方向</span><strong>{{directions}}</strong></div><div><span>人工结论</span><strong>{{result?review:'—'}}</strong></div></section>
  <div class="cc-grid">
    <template v-for="side in ([0,1] as const)" :key="side">
      <Panel class="cc-source" :eyebrow="side===0?'01':'03'" :title="side===0?'上传目标颜色':'上传实际涂层'" :description="side===0?'让目标颜色尽量铺满照片，使用整张原图的平均颜色。':'实际调墨涂层后上传，尽量保持相同拍摄条件。'">
        <div class="cc-upload-actions"><input :ref="el=>{if(el)inputs[side]=el as HTMLInputElement}" type="file" hidden accept="image/*" :aria-label="side===0?'上传目标颜色照片':'上传实际涂层照片'" :disabled="side===1&&actualDisabled" @change="selectedFile(side,$event)"/><button class="btn btn-primary" :disabled="side===1&&actualDisabled" @click="inputs[side]?.click()">{{side===0?(target?'更换目标照片':'选择目标照片'):(actual?'更换实涂照片':'选择实涂照片')}}</button><span>JPG · PNG · WEBP · ≤12 MB</span></div>
        <p v-if="side===1&&!formula" class="cc-notice">请先完成02的配墨建议，再实际涂层并上传照片。</p><p v-if="loading[side]" role="status">正在读取原始图片…</p><p v-if="errors[side]" role="alert" class="error-banner">{{errors[side]}}</p>
        <template v-for="asset in [(side===0?target:actual)]" :key="asset?.url"><template v-if="asset"><figure><img :src="asset.url" :alt="asset.name"/><figcaption>{{asset.name}}{{asset.example?' · 演示':''}}</figcaption></figure><div class="cc-color-info"><i :style="{background:rgbToHex(asset.rgb)}"/><div><strong>代表色 {{rgbToHex(asset.rgb)}}</strong><span>RGB {{num(asset.rgb.r)}} / {{num(asset.rgb.g)}} / {{num(asset.rgb.b)}}</span></div></div></template><div v-else class="cc-empty">{{side===0?'等待目标照片':'等待实际涂层照片'}}</div></template>
      </Panel>
      <Panel v-if="side===0" class="cc-recipe" eyebrow="02" title="选择色墨并生成建议" description="选择组合和重量，确认后生成首次试配建议。">
        <div class="cc-recipe-controls"><InkSelector v-model="selected" label="颜色比对色墨组合" :disabled="loading[0]"/><div class="cc-recipe-actions"><label>配墨重量（kg）<input v-model="weight" aria-label="颜色比对配墨重量" type="number" min="0.5" max="500" step="0.5"/></label><button class="btn btn-primary" :disabled="!target||loading[0]||!validWeight||!validSelection" @click="generate">生成配墨建议</button></div></div>
        <div class="cc-params-status" :class="{pending}" role="status">{{!validSelection?'至少选择一种油墨，当前建议未变。':!validWeight?'请输入0.5至500 kg的有效重量，当前建议未变。':pending?'参数已修改，尚未应用；下方仍为上次生成的建议，请点击“生成配墨建议”确认。':applied?'当前建议：'+combinationLabel(applied.selected)+'，'+num(applied.weight)+' kg。':'组合与重量选择完成后，请点击“生成配墨建议”。'}}</div>
        <table v-if="formula&&applied"><thead><tr><th>成分</th><th>比例</th><th>称量用量</th></tr></thead><tbody><tr v-for="key in components" :key="key" :data-ink="key"><td>{{labels[key]}}{{key!=='thinner'&&!applied.selected.includes(key)?'（未使用）':''}}</td><td>{{formula[key]}}%</td><td>{{num(formula[key]*applied.weight/100)}} kg</td></tr><tr><th>合计</th><td>100%</td><td>{{num(applied.weight)}} kg</td></tr></tbody></table>
        <p class="cc-notice">稀释剂单独计算，不计入油墨数量。配方沿用现有算法，实际效果需通过涂层验证。</p>
      </Panel>
      <Panel v-else class="cc-results" eyebrow="04" title="比对结果与人工复核" description="观察代表色色差与偏色方向，记录本次判断。">
        <button class="btn btn-primary" :disabled="!canCompare" @click="compareActual">比对实涂颜色</button>
        <div class="cc-result-cards"><button v-for="key in metricKeys" :key="key" class="cc-result-card" :class="{'cc-direction-card':key==='bias'}" :aria-label="'查看'+metricNames[key]+'的公式与本次结果'" aria-haspopup="dialog" @click="metric=key"><span>{{metricNames[key]}}</span><strong>{{key==='bias'?directions:num(result?.[key])}}</strong><div v-if="key==='bias'" class="cc-direction-values"><span v-for="[label,k] in biasKeys" :key="k">{{label}} <b :data-metric="k">{{num(result?.[k])}}</b></span></div><p v-else>{{key==='deltaE'?'两个代表色按 CIEDE2000 计算，数值越小越接近。':'代表色 RGB 距离除以 √3，范围 0—255，作为辅助参考。'}}</p><small>查看公式与本次结果 ›</small></button></div>
        <div class="cc-review-fields"><label>人工结论<select v-model="review" aria-label="颜色比对人工结论" :disabled="!result"><option v-for="v in ['未判定','可接受','需要调整','重新打样']" :key="v">{{v}}</option></select><small>结合样品和工艺要求确认。</small></label><label>复核备注<textarea v-model="notes" aria-label="颜色比对复核备注" :disabled="!result" rows="3" maxlength="4000" placeholder="记录拍摄条件、偏色情况或下一步处理意见…"/></label></div>
        <p class="cc-footnote">照片结果受光照、相机与背景影响，仅作试配参考，不自动判定生产合格。</p>
      </Panel>
    </template>
  </div><p class="cc-footnote">图片仅在当前页面会话处理，切换模块可继续；刷新后恢复演示，不保存到历史。</p>
  <ColorMetricDialog v-model="metric" :target="target?.rgb" :actual="actual?.rgb" :result="result"/>
</main></div></template>
<style scoped>
@reference "../assets/css/style.css";
.workspace{@apply w-full max-w-[1460px] mx-auto px-[30px] pt-[28px] pb-[40px]}.page-heading{@apply flex justify-between items-center gap-5 mb-[18px]}.page-heading h1{@apply text-[25px] my-2}.page-heading p{@apply text-[12px]}.breadcrumb{@apply text-[9px] text-[#708185]}
.cc-summary{@apply grid-cols-5 mb-4}.cc-summary>div{@apply min-w-0 px-[18px] py-4}.cc-summary span{@apply text-[10px]}.cc-summary strong{@apply text-[15px]}
.cc-grid{@apply grid grid-cols-2 gap-[14px] items-stretch}.cc-grid :deep(.panel){@apply m-0 min-w-0 flex flex-col}.cc-grid :deep(.panel-header){@apply min-h-[76px] px-[17px] py-[14px]}.cc-grid :deep(.panel-header h2){@apply text-[14px]}.cc-grid :deep(.panel-header p){@apply text-[11px]}.cc-grid :deep(.panel-content){@apply p-[17px] flex flex-col flex-1 min-w-0}
.cc-upload-actions{@apply flex flex-wrap items-center gap-[10px] mb-2}.cc-upload-actions span{@apply text-[10px] text-[#708185]}.cc-source figure{@apply flex flex-col flex-1 mt-[10px] mb-3}.cc-source img{@apply w-full object-contain flex-1 h-0 min-h-[300px] bg-[#f2f6f6] border border-[#e0e7e7]}.cc-source figcaption{@apply text-[11px] text-[#708185] mt-2 wrap-anywhere}.cc-color-info{@apply flex items-center gap-3 p-[10px] bg-[#f5f8f8] border border-[#d7e0e0]}.cc-color-info i{@apply w-[44px] h-[38px] shrink-0 border border-[#becbcd]}.cc-color-info>div{@apply grid gap-[5px] min-w-0}.cc-color-info strong{@apply text-[12px]}.cc-color-info span{@apply text-[11px] text-[#708185] wrap-anywhere}.cc-empty{@apply flex-1 min-h-[300px] grid place-items-center bg-[#f1f5f4] text-[#7a8b8d]}
label{@apply grid gap-[7px] min-w-0 text-[12px] text-[#62777b]}input,select,textarea{@apply w-full min-w-0 border border-[#c7d3d4] bg-white text-[#26383b] px-[11px] py-[10px] text-[12px]}textarea{@apply resize-y}button{@apply text-[12px]}button:disabled{@apply opacity-45 cursor-default}.cc-recipe-controls{@apply grid grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)] items-center gap-[10px] pb-[26px]}.cc-recipe-controls>.ink-selector{margin-bottom:0}.cc-recipe-actions{@apply grid grid-cols-[minmax(90px,1fr)_auto] items-end gap-[10px]}.cc-recipe-actions>label{@apply whitespace-nowrap}.cc-recipe-controls button{@apply whitespace-nowrap min-h-[40px]}.cc-params-status{@apply text-[11px] leading-[1.7] text-[#466b6e] py-2 mt-2}.pending{@apply bg-[#fff5e6] border-l-[3px] border-[#be7c24] px-3 text-[#8d5719]}
table{@apply w-full border-collapse text-[12px] my-3 flex-1}td,th{@apply px-2 py-[11px] text-left border-b border-[#dce3e3]}th{@apply text-[10px] text-[#708185] bg-[#f5f8f8]}.cc-notice{@apply text-[11px] leading-[1.7] px-[13px] py-[11px] bg-[#fff7e9] border-l-[3px] border-[#bb813d] my-3}.cc-results :deep(.panel-content)>button{@apply self-start}
.cc-result-cards{@apply grid grid-cols-2 gap-3 my-[17px] flex-1}.cc-result-card{@apply w-full min-w-0 p-4 border border-[#dce5e5] bg-[#f7fafa] text-left font-normal cursor-pointer}.cc-result-card:hover{@apply bg-[#edf6f4] border-[#145f65]}.cc-result-card>span{@apply block mb-[10px] text-[#62777b] text-[14px]}.cc-result-card strong{@apply block text-[#145f65] font-mono font-semibold text-[38px] leading-[1.2]}.cc-result-card p{@apply mt-[11px] text-[#62777b] text-[12px] leading-[1.8]}.cc-result-card small{@apply block mt-3 text-[#145f65] text-[12px]}.cc-direction-card{@apply col-span-2}.cc-direction-card strong{@apply font-sans text-[26px] leading-[1.6]}.cc-direction-values{@apply grid grid-cols-3 gap-[10px] mt-4 text-[#62777b] text-[14px]}.cc-direction-values b{@apply text-[18px] font-mono text-[#145f65]}.cc-review-fields{@apply grid grid-cols-[minmax(100px,.65fr)_minmax(0,1.6fr)] gap-4}.cc-review-fields label{@apply content-start text-[11px]}.cc-review-fields small{@apply text-[10px]}.cc-footnote{@apply text-[11px] leading-[1.7] text-[#62777b] mt-4}
@media(max-width:1200px){.cc-recipe-controls{@apply grid-cols-[minmax(0,1fr)_minmax(90px,.4fr)] pb-0}.cc-recipe-actions{display:contents}.cc-recipe-controls button{@apply col-span-2 justify-self-start mt-[26px]}}
@media(max-width:1100px){.cc-source img,.cc-empty{@apply min-h-[260px]}.cc-summary{@apply grid-cols-3}}
@media(max-width:850px){.cc-grid{@apply grid-cols-1}.workspace{@apply px-5}}
@media(max-width:600px){.workspace{@apply px-[14px]}.cc-summary{@apply grid-cols-2}.cc-source img,.cc-empty{@apply min-h-[220px]}.cc-review-fields{@apply grid-cols-1}.cc-result-card strong{@apply text-[32px]}.cc-direction-card strong{@apply text-[24px]}.cc-direction-values>span{@apply flex flex-col gap-[5px]}.page-heading{@apply items-start}}
</style>
