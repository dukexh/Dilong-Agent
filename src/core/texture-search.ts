import type { PixelImage } from './types'

export const TEXTURE_VERSION = 'structure-v2'
export const TEXTURE_PATCH_COUNT = 6
export const TEXTURE_VECTOR_LENGTH = 320
export interface TextureFeatures { version: string; patches: Array<ArrayLike<number>> }

/** In-place radix-2 FFT, used only to describe texture spacing and direction. */
function fft(real: Float64Array, imaginary: Float64Array) {
  const n = real.length
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1
    for (; j & bit; bit >>= 1) j ^= bit
    j ^= bit
    if (i < j) { [real[i], real[j]] = [real[j], real[i]]; [imaginary[i], imaginary[j]] = [imaginary[j], imaginary[i]] }
  }
  for (let length = 2; length <= n; length <<= 1) {
    const angle = -2 * Math.PI / length, wr = Math.cos(angle), wi = Math.sin(angle)
    for (let start = 0; start < n; start += length) {
      let r = 1, im = 0
      for (let j = 0; j < length / 2; j++) {
        const a = start + j, b = a + length / 2, tr = r * real[b] - im * imaginary[b], ti = r * imaginary[b] + im * real[b]
        real[b] = real[a] - tr; imaginary[b] = imaginary[a] - ti; real[a] += tr; imaginary[a] += ti
        const next = r * wr - im * wi; im = r * wi + im * wr; r = next
      }
    }
  }
}

const size = 64, window = Float64Array.from({ length: size }, (_, i) => .5 - .5 * Math.cos(2 * Math.PI * i / (size - 1)))
function spectrum(gray: Float32Array, mean: number): Float32Array {
  const real = new Float64Array(size * size), imaginary = new Float64Array(size * size), r = new Float64Array(size), im = new Float64Array(size), bins = new Float32Array(64)
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) { r[x] = (gray[y * size + x] - mean) * window[x] * window[y]; im[x] = 0 }
    fft(r, im); real.set(r, y * size); imaginary.set(im, y * size)
  }
  for (let x = 0; x < size; x++) {
    for (let y = 0; y < size; y++) { r[y] = real[y * size + x]; im[y] = imaginary[y * size + x] }
    fft(r, im)
    for (let y = 0; y < size; y++) { real[y * size + x] = r[y]; imaginary[y * size + x] = im[y] }
  }
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const fx = x <= size / 2 ? x : x - size, fy = y <= size / 2 ? y : y - size
    if (fy < 0 || fy === 0 && fx <= 0) continue
    const radius = Math.hypot(fx, fy), frequency = Math.min(7, Math.floor(Math.log2(radius) * 8 / 5))
    const direction = Math.min(7, Math.floor(((Math.atan2(fy, fx) + Math.PI) % Math.PI) / Math.PI * 8)), i = y * size + x
    bins[frequency * 8 + direction] += (real[i] ** 2 + imaginary[i] ** 2) * Math.sqrt(radius)
  }
  return bins.map(n => Math.sqrt(n))
}

/** Grayscale edges, microtexture, frequency/direction and coarse shape in six corresponding regions. */
function descriptor(image: PixelImage, box: number[], rotation: number): number[] {
  const gray = new Float32Array(size * size)
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    let u = (x + .5) / size, v = (y + .5) / size
    for (let r = 0; r < rotation; r++) [u, v] = [v, 1 - u]
    const sx = Math.min(image.width - 1, Math.floor((box[0] + u * box[2]) * image.width))
    const sy = Math.min(image.height - 1, Math.floor((box[1] + v * box[3]) * image.height))
    const i = (sy * image.width + sx) * 4
    gray[y * size + x] = image.data[i + 3] ? .2126 * image.data[i] + .7152 * image.data[i + 1] + .0722 * image.data[i + 2] : 0
  }
  const hog = new Float32Array(4 * 4 * 8), lbp = new Float32Array(4 * 16)
  const offsets = [-size - 1, -size, -size + 1, 1, size + 1, size, size - 1, -1]
  for (let y = 1; y < size - 1; y++) for (let x = 1; x < size - 1; x++) {
    const p = y * size + x, dx = gray[p + 1] - gray[p - 1], dy = gray[p + size] - gray[p - size]
    const angle = (Math.atan2(dy, dx) + Math.PI * 2) % Math.PI
    const cell = Math.min(3, Math.floor(y / 16)) * 4 + Math.min(3, Math.floor(x / 16))
    hog[cell * 8 + Math.min(7, Math.floor(angle / Math.PI * 8))] += Math.hypot(dx, dy)
    let pattern = 0
    offsets.forEach((offset, bit) => { if (gray[p + offset] >= gray[p]) pattern |= 1 << bit })
    const region = (y >= size / 2 ? 2 : 0) + (x >= size / 2 ? 1 : 0)
    lbp[region * 16 + (pattern >> 4)]++
  }
  let mean = 0
  const shape = new Float32Array(64)
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) { const value = gray[y * size + x]; mean += value / gray.length; shape[Math.floor(y / 8) * 8 + Math.floor(x / 8)] += value / 64 }
  for (let i = 0; i < shape.length; i++) shape[i] -= mean
  const normalise = (vector: Float32Array, weight: number) => {
    const norm = Math.hypot(...vector)
    return Array.from(vector, n => norm > 1e-6 ? n / norm * Math.sqrt(weight) : 0)
  }
  const vector = [...normalise(hog, .45), ...normalise(lbp, .12), ...normalise(spectrum(gray, mean), .28), ...normalise(shape, .15)], norm = Math.hypot(...vector)
  return vector.map(n => norm ? n / norm : 0)
}

export function textureFeatures(image: PixelImage, rotations = false): TextureFeatures {
  if (!image.width || !image.height || image.data.length !== image.width * image.height * 4) throw Error('无效图像数据')
  if (!image.data.some((value, index) => index % 4 === 3 && value > 0)) throw Error('图片完全透明，没有可检索的纹理')
  const boxes = [[0, 0, 1, 1], [.125, .125, .75, .75], [0, 0, .5, .5], [.5, 0, .5, .5], [0, .5, .5, .5], [.5, .5, .5, .5]]
  const patches: number[][] = []
  for (let rotation = 0; rotation < (rotations ? 4 : 1); rotation++) for (const box of boxes) patches.push(descriptor(image, box, rotation))
  return { version: TEXTURE_VERSION, patches }
}

export function textureScore(query: TextureFeatures, target: TextureFeatures): number {
  if (query.version !== TEXTURE_VERSION || target.version !== TEXTURE_VERSION || !query.patches.length || !target.patches.length) throw Error('纹理索引需要重新建立')
  let best = 0
  const weights = [.5, .2, .075, .075, .075, .075]
  for (let rotation = 0; rotation < query.patches.length; rotation += TEXTURE_PATCH_COUNT) {
    if (query.patches.length - rotation < TEXTURE_PATCH_COUNT || target.patches.length < TEXTURE_PATCH_COUNT) throw Error('纹理特征不完整')
    const scores = weights.map((weight, patch) => {
      const a = query.patches[rotation + patch], b = target.patches[patch]
      if (a.length !== TEXTURE_VECTOR_LENGTH || b.length !== TEXTURE_VECTOR_LENGTH) throw Error('纹理特征维度不匹配')
      let dot = 0
      for (let i = 0; i < a.length; i++) dot += a[i] * b[i]
      return Math.max(0, Math.min(1, dot)) * weight
    })
    best = Math.max(best, scores.reduce((sum, n) => sum + n, 0))
  }
  return Math.round(Math.max(0, Math.min(1, best)) * 1000) / 10
}
