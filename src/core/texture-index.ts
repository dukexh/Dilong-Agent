import { TEXTURE_VERSION, TEXTURE_PATCH_COUNT, TEXTURE_VECTOR_LENGTH, type TextureFeatures } from './texture-search'

export interface TextureIndexManifest {
  algorithm: string; patchCount: number; vectorLength: number; ids: string[]; file: string; byteLength: number
}
export function decodeTextureIndex(manifest: TextureIndexManifest, buffer: ArrayBuffer): Map<string, TextureFeatures> {
  if (manifest.algorithm !== TEXTURE_VERSION || manifest.patchCount !== TEXTURE_PATCH_COUNT || manifest.vectorLength !== TEXTURE_VECTOR_LENGTH || !Array.isArray(manifest.ids) || !manifest.ids.length || manifest.ids.length > 100000 || manifest.ids.some(id => typeof id !== 'string' || !id) || new Set(manifest.ids).size !== manifest.ids.length) throw Error('公共纹理索引版本或记录不匹配，请重新构建索引')
  const stride = manifest.patchCount * manifest.vectorLength
  if (buffer.byteLength !== manifest.ids.length * stride * 4 || buffer.byteLength !== manifest.byteLength) throw Error('公共纹理索引文件不完整')
  const values = new Float32Array(buffer)
  if (values.some(n => !Number.isFinite(n))) throw Error('公共纹理索引包含无效特征')
  return new Map(manifest.ids.map((id, i) => [id, { version: TEXTURE_VERSION, patches: Array.from({ length: manifest.patchCount }, (_, p) => values.subarray(i * stride + p * manifest.vectorLength, i * stride + (p + 1) * manifest.vectorLength)) }]))
}
