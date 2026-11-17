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
function generate(){
  if(!target.value||!validWeight.value||!validSelection.value)return
  // Photo measurements belong to the image pair and remain valid across recipe edits.
  formula.value=recipe(target.value.rgb,selected.value)
  applied.value={selected:normalize(selected.value),weight:Number(weight.value)}
}
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
  <div class="page-heading"><div><h1>颜色比对</h1><p>目标颜色 → 选墨与配方 → 实际涂层 → 颜色比较</p></div><button class="btn btn-secondary" @click="restore">恢复演示</button></div>
  <p v-if="target?.example||actual?.example" class="sample-label" role="status">示例图</p>
  <section class="summary-strip cc-summary" aria-label="颜色比对指标" aria-live="polite"><div><span>任务状态</span><strong>{{status}}</strong></div><div><span>{{metricNames.deltaE}}</span><strong data-metric="deltaE">{{num(result?.deltaE)}}</strong></div><div><span>{{metricNames.rgb}}</span><strong data-metric="rgb">{{num(result?.rgb)}}</strong></div><div><span>偏色方向</span><strong>{{directions}}</strong></div><div><span>人工结论</span><strong>{{result?review:'—'}}</strong></div></section>
  <div class="cc-grid">
    <template v-for="side in ([0,1] as const)" :key="side">
      <Panel class="cc-source" :class="side===0?'cc-target':'cc-actual'" :eyebrow="side===0?'01':'03'" :title="side===0?'上传目标颜色':'上传实际涂层'" :description="side===0?'整张照片取平均色，请让目标颜色铺满画面':'上传实涂照片，保持与目标照片相同的拍摄条件'">
        <div class="cc-upload-actions"><input :ref="el=>{if(el)inputs[side]=el as HTMLInputElement}" type="file" hidden accept="image/*" :aria-label="side===0?'上传目标颜色照片':'上传实际涂层照片'" :disabled="side===1&&actualDisabled" @change="selectedFile(side,$event)"/><button class="btn btn-secondary" :disabled="side===1&&actualDisabled" @click="inputs[side]?.click()">{{side===0?(target?'更换目标照片':'选择目标照片'):(actual?'更换实涂照片':'选择实涂照片')}}</button><span>JPG · PNG · WEBP · ≤12 MB</span></div>
        <p v-if="side===1&&!formula" class="cc-notice">请先完成02的配墨建议，再实际涂层并上传照片。</p><p v-if="loading[side]" role="status">正在读取原始图片…</p><p v-if="errors[side]" role="alert" class="error-banner">{{errors[side]}}</p>
        <template v-for="asset in [(side===0?target:actual)]" :key="asset?.url"><template v-if="asset"><figure><img :src="asset.url" :alt="asset.name"/><figcaption>{{asset.example ? (side===0?'目标颜色':'实涂颜色') : asset.name}}</figcaption></figure><div class="cc-color-info"><i :style="{background:rgbToHex(asset.rgb)}"/><div><strong>代表色 {{rgbToHex(asset.rgb)}}</strong><span>RGB {{num(asset.rgb.r)}} / {{num(asset.rgb.g)}} / {{num(asset.rgb.b)}}</span></div></div></template><div v-else class="cc-empty">{{side===0?'等待目标照片':'等待实际涂层照片'}}</div></template>
      </Panel>
      <Panel v-if="side===0" class="cc-recipe" eyebrow="02" title="选择色墨并生成建议">
        <div class="cc-recipe-controls"><InkSelector v-model="selected" label="颜色比对色墨组合" :disabled="loading[0]"/><div class="cc-recipe-actions"><label>配墨重量（kg）<input v-model="weight" aria-label="颜色比对配墨重量" type="number" min="0.5" max="500" step="0.5"/></label><button class="btn btn-primary" :disabled="!target||loading[0]||!validWeight||!validSelection" @click="generate">生成配墨建议</button></div></div>
        <div class="cc-params-status" :class="{pending}" role="status">{{!validSelection?'至少选择一种油墨，当前建议未变。':!validWeight?'请输入0.5至500 kg的有效重量，当前建议未变。':pending?'参数已修改，尚未应用；下方仍为上次生成的建议，请点击“生成配墨建议”确认。':applied?'当前建议：'+combinationLabel(applied.selected)+'，'+num(applied.weight)+' kg。':'组合与重量选择完成后，请点击“生成配墨建议”。'}}</div>
        <table v-if="formula&&applied"><thead><tr><th>成分</th><th>比例</th><th>称量用量</th></tr></thead><tbody><tr v-for="key in components" :key="key" :data-ink="key"><td>{{labels[key]}}{{key!=='thinner'&&!applied.selected.includes(key)?'（未使用）':''}}</td><td>{{formula[key]}}%</td><td>{{num(formula[key]*applied.weight/100)}} kg</td></tr><tr><th>合计</th><td>100%</td><td>{{num(applied.weight)}} kg</td></tr></tbody></table>

      </Panel>
      <Panel v-else class="cc-results" eyebrow="04" title="比对结果与人工复核">
        <button class="btn btn-primary" :disabled="!canCompare" @click="compareActual">比对实涂颜色</button>
        <div class="cc-result-cards"><button v-for="key in metricKeys" :key="key" class="cc-result-card" :class="{'cc-direction-card':key==='bias'}" :aria-label="'查看'+metricNames[key]+'的公式与本次结果'" aria-haspopup="dialog" @click="metric=key"><span>{{metricNames[key]}}</span><strong>{{key==='bias'?directions:num(result?.[key])}}</strong><div v-if="key==='bias'" class="cc-direction-values"><span v-for="[label,k] in biasKeys" :key="k">{{label}} <b :data-metric="k">{{num(result?.[k])}}</b></span></div><small>详情 ›</small></button></div>
        <div class="cc-review-fields"><label>人工结论<select v-model="review" aria-label="颜色比对人工结论" :disabled="!result"><option v-for="v in ['未判定','可接受','需要调整','重新打样']" :key="v">{{v}}</option></select></label><label>复核备注<textarea v-model="notes" aria-label="颜色比对复核备注" :disabled="!result" rows="3" maxlength="4000" placeholder="拍摄条件、偏色情况、处理意见"/></label></div>

      </Panel>
    </template>
  </div><details class="context-help"><summary>配色与保存说明</summary><p>示例使用内置颜色图。稀释剂单独计算，配方用量通过实涂确认；照片测色受光照、相机和背景影响。</p><p>切换模块可继续处理，刷新后恢复示例。本页结果不写入历史记录。</p></details>
  <ColorMetricDialog v-model="metric" :target="target?.rgb" :actual="actual?.rgb" :result="result"/>
</main></div></template>
<style scoped>
.workspace { width: 100%; max-width: 1460px; margin: auto; padding: 28px 30px 40px; }
.page-heading { display: flex; justify-content: space-between; align-items: center; gap: 20px; margin-bottom: 20px; }
.page-heading h1 { margin: 0 0 4px; }
.page-heading p, .breadcrumb { font-size: 13px; color: var(--dl-muted); }
.cc-grid { display: grid; grid-template-columns: repeat(2, minmax(0,1fr)); gap: 20px; align-items: start; grid-template-areas: "target actual" "recipe results"; }
.cc-target { grid-area: target; }
.cc-actual { grid-area: actual; }
.cc-recipe { grid-area: recipe; }
.cc-results { grid-area: results; }
.cc-grid :deep(.panel) { margin: 0; min-width: 0; }
.cc-grid :deep(.panel-header) { padding: 16px 20px; min-height: 76px; }
.cc-grid :deep(.panel-header h2) { font-size: 15px; font-weight: 600; }
.cc-grid :deep(.panel-header p) { font-size: 13px; }
.cc-grid :deep(.panel-content) { padding: 20px; min-width: 0; }
.cc-upload-actions { display: flex; flex-wrap: wrap; align-items: center; gap: 8px 12px; margin-bottom: 16px; }
.cc-upload-actions span { font-size: 13px; color: var(--dl-muted); }
.cc-source figure { margin: 0 0 12px; }
.cc-source img { display: block; width: 100%; height: 220px; object-fit: contain; background: var(--dl-inset); border-radius: 8px; }
.cc-source figcaption { margin-top: 8px; font-size: 13px; color: var(--dl-muted); overflow-wrap: anywhere; }
.cc-color-info { display: flex; align-items: center; gap: 12px; padding: 12px 0 0; border-top: .5px solid var(--dl-border); }
.cc-color-info i { width: 32px; height: 32px; flex: none; border: .5px solid var(--dl-border); border-radius: 4px; }
.cc-color-info > div { display: grid; gap: 4px; min-width: 0; }
.cc-color-info strong { font-size: 14px; font-weight: 500; }
.cc-color-info span { font-size: 13px; color: var(--dl-muted); overflow-wrap: anywhere; font-variant-numeric: tabular-nums; }
.cc-empty { display: grid; place-items: center; min-height: 200px; padding: 20px; border-radius: 8px; background: var(--dl-inset); color: var(--dl-muted); }
label { display: grid; gap: 8px; min-width: 0; font-size: 13px; color: var(--dl-muted); }
input, select, textarea { width: 100%; min-width: 0; min-height: 36px; border: .5px solid var(--dl-border-strong); border-radius: var(--dl-r-md); background: var(--dl-surface); color: var(--dl-text); padding: 8px 12px; font: 14px/20px var(--dl-font); }
textarea { resize: vertical; }
button:disabled { opacity: .45; cursor: default; }
.cc-recipe-controls { display: grid; grid-template-columns: minmax(0,1fr) 120px; align-items: start; gap: 16px; }
.cc-recipe-controls > .ink-selector { margin-bottom: 0; }
.cc-recipe-actions { display: contents; }
.cc-recipe-actions > button { grid-column: 1 / -1; justify-self: start; }
.cc-params-status { margin-top: 12px; padding: 8px 0; font-size: 13px; line-height: 20px; color: var(--dl-muted); }
.pending { padding: 8px 12px; border-left: 2px solid var(--dl-warning); background: var(--dl-warning-soft); color: var(--dl-warning); }
table { width: 100%; border-collapse: collapse; margin: 12px 0; font-size: 14px; font-variant-numeric: tabular-nums; }
td, th { padding: 8px 0; text-align: left; border-bottom: .5px solid var(--dl-border); }
th { font-size: 13px; font-weight: 500; color: var(--dl-muted); }
.cc-notice { margin: 12px 0; padding: 0; font-size: 13px; line-height: 20px; color: var(--dl-muted); }
.workspace > .cc-notice { padding-left: 12px; border-left: 2px solid var(--dl-border-strong); }
.cc-result-cards { display: grid; margin: 16px 0 20px; border-top: .5px solid var(--dl-border); }
.cc-result-card { display: grid; grid-template-columns: minmax(0,1fr) auto; align-items: baseline; gap: 4px 16px; width: 100%; min-width: 0; padding: 12px 0; border: 0; border-bottom: .5px solid var(--dl-border); border-radius: 0; background: transparent; text-align: left; font-weight: 400; cursor: pointer; }
.cc-result-card > span { font-size: 14px; color: var(--dl-text); }
.cc-result-card strong { font: 500 20px/28px var(--dl-font); font-variant-numeric: tabular-nums; color: var(--dl-text); text-align: right; }
.cc-result-card p { margin: 0; color: var(--dl-muted); font-size: 13px; line-height: 20px; }
.cc-result-card small { grid-column: 2; font-size: 13px; color: var(--dl-muted); text-align: right; }
.cc-direction-card strong { font-size: 15px; }
.cc-direction-values { grid-column: 1 / -1; display: flex; flex-wrap: wrap; gap: 8px 20px; color: var(--dl-muted); font-size: 13px; line-height: 20px; }
.cc-direction-values b { margin-left: 4px; font: 500 14px/20px var(--dl-font); font-variant-numeric: tabular-nums; color: var(--dl-text); }
.cc-review-fields { display: grid; grid-template-columns: minmax(100px,.65fr) minmax(0,1.6fr); gap: 16px; }
.cc-review-fields label { align-content: start; }
.cc-review-fields small, .cc-footnote { font-size: 13px; line-height: 20px; color: var(--dl-muted); }
.cc-footnote { margin-top: 16px; }
@media (hover: hover) { .cc-result-card:hover { background: var(--dl-hover); } }
@media (max-width: 1100px) { .cc-recipe-controls { grid-template-columns: minmax(0,1fr) 100px; gap: 12px; } }
@media (max-width: 850px) { .cc-grid { grid-template-columns: minmax(0,1fr); grid-template-areas: "target" "recipe" "actual" "results"; } .workspace { padding-inline: 20px; } }
@media (max-width: 600px) {
  .workspace { padding-inline: 14px; }
  .page-heading { align-items: start; }
  .cc-grid :deep(.panel-content), .cc-grid :deep(.panel-header) { padding: 16px; }
  .cc-review-fields { grid-template-columns: minmax(0,1fr); }
  .cc-recipe-controls { grid-template-columns: minmax(0,1fr); }
  .cc-recipe-actions { display: grid; grid-template-columns: 100px minmax(0,1fr); align-items: end; gap: 12px; }
  .cc-recipe-actions > button { grid-column: auto; }
  .cc-result-card { gap: 4px 8px; }
  .cc-source img { height: 180px; }
}
</style>
