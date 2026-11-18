import { DesignImages } from '../core/design-images'
import type { DesignOptions, DesignResult, GenerationCheckpoint, ModelUsage } from '../core/types'
import { readPixels, pixelsUrl, fullRegion, searchTextures, loadImage, type ImageRegion, type TextureMatch, type TextureSearchOptions } from './image-tools'
import { localTask } from './local-api'
import { CompareCore } from '../core/production-compare-core'
import { exactSampleQuery, mergeUsage } from '../core/model-contracts'
import type { WorkflowAsset } from './types'

async function preview(src:string,signal?:AbortSignal,region=fullRegion()){
  const controller=new AbortController(),abort=()=>controller.abort(),timer=setTimeout(abort,12000)
  signal?.addEventListener('abort',abort,{once:true});if(signal?.aborted)controller.abort()
  try{return pixelsUrl(await readPixels(src,region,512,controller.signal))}
  finally{clearTimeout(timer);signal?.removeEventListener('abort',abort)}
}
interface RankResult {matches:TextureMatch[];unreadable:number;omitted:number;usage:ModelUsage[]}
async function rank(query:string,source:string|undefined,candidates:TextureMatch[],options:DesignOptions,policy:'all'|'filter'):Promise<RankResult>{
  const previews=await Promise.all(candidates.map(async row=>{
    try{return {row,image:await preview(row.sample.thumbnailUrl||row.sample.imageUrl,options.signal)}}
    catch(error){if(options.signal?.aborted)throw error;try{return {row,image:await preview(row.sample.imageUrl,options.signal)}}catch(error){if(options.signal?.aborted)throw error;return null}}
  }))
  options.signal?.throwIfAborted()
  const readable=previews.filter((v):v is NonNullable<typeof v>=>!!v),unreadable=candidates.length-readable.length
  if(!readable.length)return {matches:[],unreadable,omitted:0,usage:[]}
  try{
    const result=await localTask<{matches:Array<{id:string;reason:string}>;omittedCount?:number;usage?:ModelUsage}>('model/tasks',{kind:'rank',query,has_reference:!!source,rank_policy:policy,images:[...(source?[source]:[]),...readable.map(r=>r.image)],candidates:readable.map(({row:r})=>({id:r.sample.id,name:r.sample.name,wood:r.sample.wood,style:r.sample.style,tone:r.sample.tone}))},options)
    const lookup=new Map(readable.map(r=>[r.row.sample.id,r.row])),seen=new Set<string>()
    const matches=result.matches.flatMap(r=>{const found=lookup.get(r.id);if(!found||seen.has(r.id))return [];seen.add(r.id);return [{...found,reason:r.reason}]})
    const omitted=readable.length-matches.length
    if(policy==='all')for(const {row} of readable)if(!seen.has(row.sample.id))matches.push({...row,reason:'沿用结构初筛顺序'})
    return {matches,unreadable,omitted:Math.max(result.omittedCount||0,omitted),usage:result.usage?[result.usage]:[]}
  }catch(error){throw Object.assign(error instanceof Error?error:Error(String(error)),{readable:readable.map(r=>r.row),unreadable})}
}
export async function modelImageSearch(src:string,assets:WorkflowAsset[],region:ImageRegion=fullRegion(),count=5,options:TextureSearchOptions={}){
  const initial=await searchTextures(src,assets,region,20,options)
  if(!initial.matches.length)return {...initial,notice:'没有可比较的正式样例',usage:[] as ModelUsage[]}
  try{
    const ranked=await rank('以参考来样的整体纹理形态、疏密、走向为准',await preview(src,options.signal,region),initial.matches,options,'all')
    const matches=ranked.matches.slice(0,count),skipped=initial.skipped+ranked.unreadable
    const notice=[ranked.usage.length||matches.length?'已完成图片比较排序':'候选图片无法读取',ranked.omitted?'部分候选沿用结构检索顺序':'',skipped?`${skipped} 张候选图片无法读取，已跳过`:'',matches.length<count?`当前只有 ${matches.length} 项可用结果，少于所选 ${count} 项`:''].filter(Boolean).join('；')
    return {matches,skipped,notice,usage:ranked.usage}
  }catch(error){
    if(options.signal?.aborted)throw new DOMException('检索已取消','AbortError')
    const e=error as Error&{readable?:TextureMatch[];unreadable?:number;usage?:ModelUsage}
    return {matches:(e.readable||initial.matches).slice(0,count),skipped:initial.skipped+(e.unreadable||0),notice:`本次使用结构算法排序，未完成模型重排：${e.message}`,usage:e.usage?[e.usage]:[]}
  }
}
export async function modelTextSearch(query:string,assets:WorkflowAsset[],count:number,options:DesignOptions={}){
  const exact=assets.filter(s=>[s.id,s.assetId,s.name].some(v=>exactSampleQuery(query,v)))
  if(exact.length)return {matches:exact.slice(0,count).map(sample=>({sample,score:100})),usage:[] as ModelUsage[],notice:'按编号或名称精确匹配'}
  const result=await localTask<{terms:string[];usage?:ModelUsage}>('model/tasks',{kind:'terms',query},options)
  const scored=assets.map(sample=>{const text=[sample.id,sample.assetId,sample.name,sample.wood,sample.style,sample.tone,sample.source,...sample.tags||[]].join(' ').toLowerCase();return {sample,score:result.terms.reduce((n,term)=>n+(text.includes(term.toLowerCase())?1:0),text.includes(query.trim().toLowerCase())?20:0)}}).filter(r=>r.score>0).sort((a,b)=>b.score-a.score).slice(0,20)
  if(!scored.length)return {matches:[],usage:result.usage?[result.usage]:[],notice:'已有样例资料中没有找到符合描述的候选，请调整关键词。'}
  const ranked=await rank(query,undefined,scored,options,'filter')
  return {matches:ranked.matches.slice(0,count),usage:mergeUsage(result.usage?[result.usage]:[],ranked.usage),notice:ranked.unreadable?`${ranked.unreadable} 张候选图片无法读取，已跳过`:''}
}
async function referenceImage(src:string,signal?:AbortSignal){
  const image=await loadImage(src,signal),w=image.naturalWidth,h=image.naturalHeight
  if(w>8000||h>8000||Math.max(w/h,h/w)>10)throw Error(`参考图 ${w}×${h} 超过模型输入范围（单边8000像素、宽高比10:1）；请另选参考图，系统不会自动缩小`)
  const response=await fetch(src,{signal});if(!response.ok)throw Error('无法读取完整参考图，请下载后重新上传')
  const blob=await response.blob();if(blob.size>10000000)throw Error('参考图超过模型10MB输入限制，请另选图片，系统不会自动降低像素')
  if(!['image/png','image/jpeg','image/webp'].includes(blob.type.split(';')[0]||''))throw Error('参考图须为 PNG、JPG 或 WebP，请重新上传')
  const data=await new Promise<string>((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(String(reader.result));reader.onerror=()=>reject(Error('读取参考图失败'));reader.readAsDataURL(blob)})
  signal?.throwIfAborted();return data
}
async function fingerprint(value:string){
  if(globalThis.crypto?.subtle){const bytes=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value));return [...new Uint8Array(bytes)].map(b=>b.toString(16).padStart(2,'0')).join('')}
  return value // Exact equality on ordinary HTTP; no unsafe cache-key approximation.
}
interface GenerationOptions extends DesignOptions {generationId?:string;checkpoint?:GenerationCheckpoint;onCheckpoint?:(state:GenerationCheckpoint)=>Promise<void>}
export async function modelGenerate(src:string,query:string,kind:'generate'|'edit',count:number,options:GenerationOptions={}){
  const reference=await referenceImage(src,options.signal),signature=await fingerprint(JSON.stringify({reference,query,kind,count}))
  if(options.checkpoint&&options.checkpoint.signature!==signature)throw Error('输入或设计要求已变化，不能续用旧结果。请选择“重新生成全部”')
  let state:GenerationCheckpoint=options.checkpoint?structuredClone(options.checkpoint):{version:1,id:options.generationId||String(Date.now()),signature,targetCount:count,results:[],usage:[]}
  const checkpoint=async()=>{await options.onCheckpoint?.(structuredClone(state))}
  await checkpoint()
  try{
    for(let i=state.results.length;i<count;i++){
      options.signal?.throwIfAborted()
      const result=await localTask<{images:string[];model:string;usage?:ModelUsage}>('model/tasks',{kind,query,images:[reference]},{...options,onProgress:p=>options.onProgress?.({...p,phase:`第 ${i+1}/${count} 张：${p.phase}`,indeterminate:true})})
      state.usage=mergeUsage(state.usage,result.usage?[result.usage]:[])
      if(!result.images[0])throw Error('生成服务没有返回图片')
      const url=result.images[0],image=await readPixels(url,fullRegion(),Infinity,options.signal)
      const item:DesignResult={url,thumbnailUrl:await DesignImages.thumbnail(url),width:image.width,height:image.height,model:result.model,prompt:query,usage:result.usage,generationId:state.id,generationIndex:i}
      if(kind==='edit'){
        const source=await loadImage(src,options.signal)
        if(source.naturalWidth!==image.width||source.naturalHeight!==image.height)item.similarityError='输出尺寸与参考图不同，未计算结构相似度'
        else try{item.similarity=await CompareCore.structureSimilarity(await readPixels(src,fullRegion(),Infinity,options.signal),image,{signal:options.signal})}catch(error){if(options.signal?.aborted)throw error;item.similarityError=(error as Error).message}
      }
      state.results.push(item);await checkpoint()
    }
    return state.results
  }catch(error){
    const e=error as Error&{usage?:ModelUsage};state.usage=mergeUsage(state.usage,e.usage?[e.usage]:[])
    throw Object.assign(e,{checkpoint:state})
  }
}
