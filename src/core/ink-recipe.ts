import type { RGB, InkRecipe } from './types'
import { CompareCore } from './production-compare-core'

export const inks = ['red', 'yellow', 'blue', 'black'] as const
export type InkKey = typeof inks[number]
export const defaultCombination = inks.join(',')
export const labels: Record<keyof InkRecipe, string> = { red: '红墨', yellow: '黄墨', blue: '蓝墨', black: '黑墨', thinner: '稀释剂' }
export const inkColours: Record<InkKey, string> = { red: '#b7322c', yellow: '#d6a51e', blue: '#325d81', black: '#33393b' }
export function normalize(selected: string | readonly string[] = inks): InkKey[] {
  const values = typeof selected === 'string' ? selected.split(',') : selected
  if (!Array.isArray(values) || new Set(values).size !== values.length || values.length < 1 || values.length > 4 || values.some(k => !inks.includes(k as InkKey))) throw Error('请至少选择一种油墨，且只能选择红、黄、蓝、黑')
  return inks.filter(k => values.includes(k))
}
export function combinationLabel(selected: string | readonly string[] = inks): string {
  const keys = normalize(selected)
  return ['','单墨','双墨','三墨','四墨'][keys.length] + '：' + keys.map(key => labels[key].replace('墨', '')).join('、')
}
export function recipe(rgb: RGB, selected: string | readonly string[] = inks): InkRecipe {
  const keys = normalize(selected)
  if (Object.values(rgb).some(v => !Number.isFinite(v) || v < 0 || v > 255)) throw Error('目标RGB无效')
  const r=rgb.r/255,g=rgb.g/255,b=rgb.b/255,d=1-Math.max(r,g,b),s=Math.max(r,g,b)-Math.min(r,g,b)
  const weights={red:Math.max(.03,r-g+Math.max(0,r-b)*.35),yellow:Math.max(.03,Math.min(r,g)-b+Math.max(0,g-b)*.3),blue:Math.max(.018,b-Math.min(r,g)+Math.max(0,r+b-2*g)*.18),black:Math.max(.025,d*.75+(1-s)*d*.35)}
  const total=Math.max(20,Math.min(76,20+d*57+s*15)),sum=keys.reduce((v,k)=>v+weights[k],0)
  const result: InkRecipe={red:0,yellow:0,blue:0,black:0,thinner:0}
  for (const k of keys) result[k]=Math.round(weights[k]/sum*total)
  result.thinner=100-inks.reduce((v,k)=>v+result[k],0)
  return result
}
export function average(pixels: { data: Uint8ClampedArray }): RGB {
  let r=0,g=0,b=0,count=0
  for(let i=0;i<pixels.data.length;i+=4){if(!pixels.data[i+3])continue;r+=pixels.data[i]!;g+=pixels.data[i+1]!;b+=pixels.data[i+2]!;count++}
  if(!count)throw Error('图片完全透明，没有可见内容，请更换图片')
  return {r:r/count,g:g/count,b:b/count}
}
export function compare(target: RGB, actual: RGB) {
  const a=CompareCore.rgbToLab(target.r,target.g,target.b),b=CompareCore.rgbToLab(actual.r,actual.g,actual.b)
  return {deltaE:CompareCore.deltaE00(a,b),rgb:Math.hypot(actual.r-target.r,actual.g-target.g,actual.b-target.b)/Math.sqrt(3),deltaL:b[0]-a[0],deltaA:b[1]-a[1],deltaB:b[2]-a[2]}
}
export type RepresentativeComparison = ReturnType<typeof compare>
