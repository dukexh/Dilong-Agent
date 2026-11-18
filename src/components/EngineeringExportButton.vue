<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue'
import { Download } from 'lucide-vue-next'
import { exportEngineering, inspectExport, loadImage, type EngineeringProject } from '../services/image-tools'
import { physicalSize, preflightExport, type ExportSettings } from '../core/engineering-export'
const props = defineProps<{ src: string; name: string; project?: EngineeringProject; compact?: boolean }>()
const dialog=ref<HTMLDialogElement|null>(null),format=ref<ExportSettings['format']>('tif'),ppi=ref(300),width=ref(0),height=ref(0),busy=ref(false),loading=ref(false),error=ref('')
let controller:AbortController|undefined
const size=computed(()=>{try{return physicalSize(width.value,height.value,ppi.value)}catch{return null}})
const budgetError=computed(()=>{if(!width.value)return '';try{preflightExport({width:width.value,height:height.value},{format:format.value,ppi:ppi.value},format.value==='psd'&&!!props.project);return ''}catch(e){return (e as Error).message}})
async function open(){
  error.value='';width.value=height.value=0;loading.value=true;controller=new AbortController()
  await nextTick();dialog.value?.showModal()
  try{const image=await loadImage(props.src,controller.signal);width.value=image.naturalWidth;height.value=image.naturalHeight;await inspectExport(props.src,{format:format.value,ppi:ppi.value},props.project,controller.signal)}catch(reason){if(reason instanceof Error&&reason.name!=='AbortError')error.value=reason.message}finally{loading.value=false}
}
function close(){controller?.abort();dialog.value?.close();busy.value=false;loading.value=false}
async function download(){
  if(busy.value||!size.value||!width.value)return
  error.value='';busy.value=true;controller=new AbortController()
  try{
    const blob=await exportEngineering(props.src,{format:format.value,ppi:ppi.value},props.project,controller.signal)
    const url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=(props.name.replace(/[\\/:*?"<>|]/g,'_')||'设计单元')+'_'+ppi.value+'ppi.'+format.value
    a.click();setTimeout(()=>URL.revokeObjectURL(url),30000)
  }catch(reason){if(reason instanceof Error&&reason.name!=='AbortError')error.value=reason.message}
  finally{busy.value=false}
}
watch([format,ppi],()=>{if(!busy.value)error.value=''})
watch(()=>props.src,close)
onBeforeUnmount(()=>controller?.abort())
</script>
<template>
  <button type="button" class="engineering-export-button btn btn-secondary" :class="{'export-compact':compact}" :aria-label="compact?'导出 TIF / PSD':undefined" :title="compact?'导出 TIF / PSD':undefined" @click="open"><Download v-if="compact" :size="14"/>导出 TIF / PSD</button>
  <Teleport to="body"><dialog ref="dialog" aria-label="工程文件导出" class="engineering-dialog dilong-theme" @cancel.prevent="close" @close="controller?.abort()"><header><h2>工程文件导出</h2><button type="button" class="btn btn-secondary" @click="close">关闭</button></header><p class="export-name">{{name}}</p><p v-if="loading" role="status">正在读取图像尺寸…</p><template v-else-if="width"><dl><div><dt>实际像素</dt><dd>{{width}} × {{height}}</dd></div><div><dt>按当前分辨率的尺寸</dt><dd>{{size?size.widthMm.toFixed(2)+' × '+size.heightMm.toFixed(2)+' mm':'请输入有效分辨率'}}</dd></div><div><dt>颜色</dt><dd>8 位 RGB · 保留透明度</dd></div></dl><label>文件格式<select v-model="format" :disabled="busy" aria-label="工程文件格式"><option value="tif">TIF 无损合成图</option><option value="psd">PSD {{project?'分层连续单元':'完整设计图'}}</option></select></label><label>分辨率 ppi<input v-model.number="ppi" type="number" min="1" max="2400" step="1" :disabled="busy" aria-label="工程文件分辨率"/></label><p>按实际像素导出，不改变图像尺寸。300 ppi 表示每英寸 300 个像素，修改此值不会增加图像细节。</p><p v-if="format==='psd'">{{project?'包含原始单元参考、单元基础和接缝修补图层；透明区域可继续编辑。':'此来源为合成图，PSD 包含一个完整设计图层。'}}生产分色尚未确认。</p><button type="button" class="btn btn-primary" :disabled="busy||!size||!!budgetError" @click="download">{{busy?'正在编码文件…':'下载工程文件'}}</button><button v-if="busy" type="button" class="btn btn-secondary" @click="controller?.abort()">取消导出</button></template><p v-if="error||budgetError" class="export-error" role="alert">{{budgetError||error}}</p></dialog></Teleport>
</template>
<style scoped>
@reference "../assets/css/style.css";
.engineering-export-button { @apply mt-3 text-xs w-full; }
.engineering-export-button.export-compact { @apply m-0 w-auto inline-flex items-center justify-center gap-1.5 text-xs px-2.5 py-2; }
.engineering-dialog { @apply fixed p-5 w-[min(520px,calc(100vw-32px))] max-h-[90vh] overflow-auto m-auto; background:var(--dl-surface);color:var(--dl-text);border:0;border-radius:var(--dl-r-panel);box-shadow:var(--dl-shadow);font-family:var(--dl-font);font-size:14px;scrollbar-gutter:stable; }
.engineering-dialog::backdrop { background:var(--dl-mask); }
header { @apply flex items-center justify-between gap-3; }
h2 { @apply text-base font-semibold m-0; }
p { @apply text-xs leading-relaxed my-3; color:var(--dl-muted); }
.export-name { @apply wrap-anywhere; }
dl>div { @apply flex justify-between flex-wrap gap-3 text-xs py-2; }
dd { @apply m-0; }
label { @apply block text-xs my-4; }
input,select { @apply block w-full mt-2 border px-3 py-2;min-height:36px;border-radius:var(--dl-r-md);font-size:14px; background:var(--dl-surface);color:var(--dl-text);border-color:var(--dl-border); }
.export-error { color:var(--dl-danger); }

.engineering-export-button { border-radius:var(--dl-r-md); }
.engineering-dialog :where(button,input,select):focus-visible { outline:2px solid var(--dl-focus);outline-offset:2px; }
.engineering-dialog .btn { min-height:36px;padding:8px 12px;border:1px solid var(--dl-border);border-radius:var(--dl-r-md);font:inherit; }
.engineering-dialog .btn-primary { background:var(--dl-primary-fill);color:var(--dl-primary-text);border-color:transparent; }
.engineering-dialog .btn-secondary { background:transparent;color:var(--dl-text); }
.engineering-dialog .btn-primary:hover:not(:disabled) { background:var(--dl-primary-hover); }
.engineering-dialog .btn-secondary:hover:not(:disabled) { background:var(--dl-hover); }
.engineering-dialog .btn + .btn { margin-left:8px; }
.engineering-dialog button:disabled { opacity:.5;cursor:not-allowed; }
dl>div { border-bottom:1px solid var(--dl-divider); }
dt { color:var(--dl-muted); }
dd { font-variant-numeric:tabular-nums; }
</style>
