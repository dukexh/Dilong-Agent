import type { DesignParameters } from '../services/types'
import type { ModelUsage } from './types'

export const styleNames:Record<string,string>={smoked:'烟熏胡桃',warmGrey:'暖灰中古',lightNatural:'浅色自然',redBrown:'红棕复古'}
export function styleTendency(value:number){return value<=50?'轻微':value<=75?'适中':'明显'}
// Carry business requirements between entry points, never old result pixels/layers.
export function designContext(p:DesignParameters|undefined):DesignParameters{
  return p?{material:p.material,color:p.color,referencePost:p.referencePost}:{}
}
export function designPrompt(mode:'twin'|'generate',p:DesignParameters){
  const text=(v:unknown)=>typeof v==='string'?v.trim():''
  const post=p.referencePost as {title?:string}|undefined
  return [mode==='twin'?`目标风格：${styleNames[p.style||'']||p.style}；风格变化倾向：${styleTendency(p.strength??78)}。尽量保持纹理走向与尺度，不添加文字。`:text(p.direction),
    text(p.material)&&`材质要求：${text(p.material)}`,text(p.color)&&`色系要求：${text(p.color)}`,
    text(post?.title)&&`参考帖子主题（文字资料）：${text(post?.title)}`].filter(Boolean).join('\n')
}
export function mergeUsage(...lists:Array<ModelUsage[]|undefined>){return [...new Map(lists.flatMap(x=>x||[]).map(x=>[x.id,x])).values()]}
export function exactSampleQuery(query:string,value:unknown){return typeof value==='string'&&value.trim().toLocaleLowerCase()===query.trim().toLocaleLowerCase()}
