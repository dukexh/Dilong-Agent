<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue'
import { Download } from 'lucide-vue-next'
import { exportEngineering, loadImage, type EngineeringProject } from '../services/image-tools'
import { physicalSize, type ExportSettings } from '../core/engineering-export'
const props = defineProps<{ src: string; name: string; project?: EngineeringProject; compact?: boolean }>()
const dialog=ref<HTMLDialogElement|null>(null),format=ref<ExportSettings['format']>('tif'),ppi=ref(300),width=ref(0),height=ref(0),busy=ref(false),loading=ref(false),error=ref('')
let controller:AbortController|undefined
const size=computed(()=>{try{return physicalSize(width.value,height.value,ppi.value)}catch{return null}})
async function open(){
  error.value='';width.value=height.value=0;loading.value=true;controller=new AbortController()
  await nextTick();dialog.value?.showModal()
  try{const image=await loadImage(props.src,controller.signal);width.value=image.naturalWidth;height.value=image.naturalHeight}catch(reason){if(reason instanceof Error&&reason.name!=='AbortError')error.value=reason.message}finally{loading.value=false}
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
watch(()=>props.src,close)
onBeforeUnmount(()=>controller?.abort())
</script>
<template>
  <button type="button" class="engineering-export-button btn btn-secondary" :class="{'export-compact':compact}" :aria-label="compact?'导出 TIF / PSD':undefined" :title="compact?'导出 TIF / PSD':undefined" @click="open"><Download v-if="compact" :size="14"/>导出 TIF / PSD</button>
  <Teleport to="body"><dialog ref="dialog" aria-label="工程文件导出" class="engineering-dialog" @cancel.prevent="close" @close="controller?.abort()"><header><h2>工程文件导出</h2><button type="button" class="btn btn-secondary" @click="close">关闭</button></header><p class="export-name">{{name}}</p><p v-if="loading" role="status">正在读取完整像素原图…</p><template v-else-if="width"><dl><div><dt>实际像素</dt><dd>{{width}} × {{height}}</dd></div><div><dt>按当前分辨率的尺寸</dt><dd>{{size?size.widthMm.toFixed(2)+' × '+size.heightMm.toFixed(2)+' mm':'请输入有效分辨率'}}</dd></div><div><dt>颜色</dt><dd>8 位 RGB · 保留透明度</dd></div></dl><label>文件格式<select v-model="format" :disabled="busy" aria-label="工程文件格式"><option value="tif">TIF 无损合成图</option><option value="psd">PSD {{project?'分层连续单元':'完整设计图'}}</option></select></label><label>分辨率 ppi<input v-model.number="ppi" type="number" min="1" max="2400" step="1" :disabled="busy" aria-label="工程文件分辨率"/></label><p>按实际像素导出，不改变图像尺寸。300 ppi 表示每英寸 300 个像素，修改此值不会增加图像细节。</p><p v-if="format==='psd'">{{project?'包含原始单元参考、单元基础和接缝修补图层；透明区域可继续编辑。':'此来源为合成图，PSD 包含一个完整设计图层。'}}生产分色尚未确认。</p><button type="button" class="btn btn-primary" :disabled="busy||!size" @click="download">{{busy?'正在编码文件…':'下载工程文件'}}</button><button v-if="busy" type="button" class="btn btn-secondary" @click="controller?.abort()">取消导出</button></template><p v-if="error" class="export-error" role="alert">{{error}}</p></dialog></Teleport>
</template>
<style scoped>
@reference "../assets/css/style.css";
.engineering-export-button { @apply mt-3 text-xs w-full; }
.engineering-export-button.export-compact { @apply m-0 w-auto inline-flex items-center justify-center gap-1.5 text-[11px] px-2.5 py-2; }
.engineering-dialog { @apply fixed p-5 border w-[min(520px,calc(100vw-32px))] max-h-[90vh] overflow-auto m-auto; background:var(--surface,#fff);color:var(--ink,#173a3d);border-color:var(--line-strong,#c8d8d8); }
.engineering-dialog::backdrop { background:#102b3480; }
header { @apply flex items-center justify-between gap-3; }
h2 { @apply text-lg font-semibold; }
p { @apply text-xs leading-relaxed my-3; color:var(--muted); }
.export-name { @apply wrap-anywhere; }
dl>div { @apply flex justify-between flex-wrap gap-3 text-xs my-3; }
dd { @apply m-0; }
label { @apply block text-xs my-4; }
input,select { @apply block w-full mt-2 border px-3 py-2; background:var(--surface);color:var(--ink);border-color:var(--line-strong); }
.export-error { color:#b13e28; }
</style>
