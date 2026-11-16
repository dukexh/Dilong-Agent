import type { PixelImage } from './types'

export interface EngineeringProject {
  version: 'seamless-v1'; baseUrl: string; maskUrl: string; overlap: number; lightBalance: boolean
  repeat?: { columns: number; rows: number; unitWidth: number; unitHeight: number }
}
export interface UnitSnapshot { url: string; thumbnailUrl: string; width: number; height: number; engineering: EngineeringProject }
export interface CompletionPipeline {
  version: 1; stage: 'unit-ready' | 'unit-confirmed' | 'expanded'; unit: UnitSnapshot
  completion: 'horizontal3' | 'horizontal5' | 'around'
}

export interface SeamlessDocument {
  version: 'seamless-v1'; base: PixelImage; result: PixelImage; repairMask: Uint8Array
  overlap: number; lightBalance: boolean
}

function validate(image: PixelImage) {
  if (image.width < 16 || image.height < 16) throw Error('四方连续需要至少 16 × 16 像素的有效图像')
  if (image.data.length !== image.width * image.height * 4) throw Error('图像数据不完整')
}

/** Minimum-error cut between overlapping ends. The cut moves at most one pixel per row. */
function cut(cost: Float32Array, width: number, height: number, margin = 2): Int32Array {
  const prev = new Float64Array(width), next = new Float64Array(width), directions = new Int8Array(width * height)
  for (let x = 0; x < width; x++) prev[x] = x >= margin && x < width - margin ? cost[x] : Infinity
  for (let y = 1; y < height; y++) {
    next.fill(Infinity)
    for (let x = margin; x < width - margin; x++) {
      let dx = 0
      if (prev[x - 1] < prev[x]) dx = -1
      if (prev[x + 1] < prev[x + dx]) dx = 1
      next[x] = cost[y * width + x] + prev[x + dx]; directions[y * width + x] = dx
    }
    prev.set(next)
  }
  let best = margin
  for (let x = margin + 1; x < width - margin; x++) if (prev[x] < prev[best]) best = x
  const path = new Int32Array(height)
  for (let y = height - 1; y >= 0; y--) { path[y] = best; best += directions[y * width + best] }
  return path
}

/** Close the cut around the other texture axis; reuse one DP workspace for at most four starts. */
function periodicCut(cost: Float32Array, width: number, height: number, margin: number): Int32Array {
  const initial = cut(cost, width, height, margin)
  let column = margin, lowestColumnCost = Infinity
  for (let x = margin; x < width - margin; x++) {
    let total = 0
    for (let y = 0; y < height; y++) total += cost[y * width + x]
    if (total < lowestColumnCost) { column = x; lowestColumnCost = total }
  }
  const starts = [...new Set([initial[0], initial[height - 1], Math.round((initial[0] + initial[height - 1]) / 2), column])].sort((a, b) => a - b)
  const prev = new Float64Array(width), next = new Float64Array(width), directions = new Int8Array(width * height)
  let bestCost = Infinity, best = initial
  for (const start of starts) {
    prev.fill(Infinity); prev[start] = cost[start]
    for (let y = 1; y < height; y++) {
      next.fill(Infinity)
      for (let x = margin; x < width - margin; x++) {
        let dx = 0
        if (prev[x - 1] < prev[x]) dx = -1
        if (prev[x + 1] < prev[x + dx]) dx = 1
        next[x] = cost[y * width + x] + prev[x + dx]; directions[y * width + x] = dx
      }
      prev.set(next)
    }
    if (prev[start] < bestCost) {
      bestCost = prev[start]
      const path = new Int32Array(height)
      let x = start
      for (let y = height - 1; y >= 0; y--) { path[y] = x; x += directions[y * width + x] }
      best = path
    }
  }
  return best
}

function join(image: PixelImage, band: number, vertical: boolean): PixelImage {
  const length = vertical ? image.height : image.width, rows = vertical ? image.width : image.height
  const outputLength = length - band, width = vertical ? image.width : outputLength, height = vertical ? outputLength : image.height
  const index = (x: number, y: number) => vertical ? (x * image.width + y) * 4 : (y * image.width + x) * 4
  const costs = new Float32Array(band * rows)
  for (let y = 0; y < rows; y++) for (let x = 0; x < band; x++) {
    const a = index(x, y), b = index(outputLength + x, y)
    let cost = 0
    for (let c = 0; c < 4; c++) cost += (image.data[a + c] - image.data[b + c]) ** 2
    costs[y * band + x] = cost
  }
  const feather = Math.min(Math.floor((band - 1) / 2), Math.max(2, Math.round(band * .35)))
  const path = periodicCut(costs, band, rows, feather), data = new Uint8ClampedArray(width * height * 4)
  for (let y = 0; y < rows; y++) for (let x = 0; x < outputLength; x++) {
    const a = index(x, y), b = index(outputLength + x, y)
    const out = vertical ? (x * width + y) * 4 : (y * width + x) * 4
    const t = x < band ? Math.max(0, Math.min(1, (path[y] + feather - x) / (2 * feather))) : 0
    const amount = t * t * (3 - 2 * t)
    // Premultiplied-alpha blending avoids dark halos around transparent content.
    const alpha = image.data[a + 3] * (1 - amount) + (amount ? image.data[b + 3] * amount : 0)
    for (let c = 0; c < 3; c++) data[out + c] = alpha ? (image.data[a + c] * image.data[a + 3] * (1 - amount) + (amount ? image.data[b + c] * image.data[b + 3] * amount : 0)) / alpha : 0
    data[out + 3] = alpha
  }
  return { width, height, data }
}

export function seamless(image: PixelImage, overlap = 15, lightBalance = false): SeamlessDocument {
  validate(image)
  if (!Number.isFinite(overlap) || overlap < 5 || overlap > 30) throw Error('接缝重叠比例须在 5%—30% 之间')
  const source: PixelImage = { ...image, data: new Uint8ClampedArray(image.data) }
  if (lightBalance) {
    // Correct low-frequency lighting only; preserve the local high-frequency texture.
    const means = new Float64Array(image.height), columns = new Float64Array(image.width)
    let total = 0
    for (let y = 0; y < image.height; y++) for (let x = 0; x < image.width; x++) {
      const i = (y * image.width + x) * 4, l = .2126 * image.data[i] + .7152 * image.data[i + 1] + .0722 * image.data[i + 2]
      means[y] += l / image.width; columns[x] += l / image.height; total += l / (image.width * image.height)
    }
    const smooth = (v: Float64Array) => Float64Array.from(v, (_, i) => {
      let sum = 0, count = 0; const radius = Math.max(2, Math.round(v.length / 16))
      for (let j = Math.max(0, i - radius); j <= Math.min(v.length - 1, i + radius); j++) { sum += v[j]; count++ }
      return sum / count
    })
    const rowLight = smooth(means), colLight = smooth(columns)
    for (let y = 0; y < image.height; y++) for (let x = 0; x < image.width; x++) {
      const i = (y * image.width + x) * 4, adjustment = (2 * total - rowLight[y] - colLight[x]) * .5
      for (let c = 0; c < 3; c++) source.data[i + c] += adjustment
    }
  }
  const bw = Math.max(6, Math.min(Math.floor(image.width / 3), Math.round(image.width * overlap / 100)))
  const bh = Math.max(6, Math.min(Math.floor(image.height / 3), Math.round(image.height * overlap / 100)))
  const result = join(join(source, bw, false), bh, true)
  const base: PixelImage = { width: result.width, height: result.height, data: new Uint8ClampedArray(result.data.length) }
  const repairMask = new Uint8Array(result.width * result.height)
  for (let y = 0; y < result.height; y++) for (let x = 0; x < result.width; x++) {
    const i = (y * result.width + x) * 4, j = (y * image.width + x) * 4
    base.data.set(image.data.subarray(j, j + 4), i)
    repairMask[y * result.width + x] = result.data.subarray(i, i + 4).some((n, c) => n !== base.data[i + c]) ? 255 : 0
  }
  return { version: 'seamless-v1', base, result, repairMask, overlap, lightBalance }
}

export function repeatTile(image: PixelImage, columns: number, rows: number): PixelImage {
  if (![columns, rows].every(n => Number.isInteger(n) && n > 0 && n <= 5)) throw Error('无效铺排数量')
  const width = image.width * columns, height = image.height * rows
  if (width * height > 40000000 || width > 32767 || height > 32767) throw Error('铺排结果超过 4000 万像素或单边尺寸限制，请导出连续单元')
  const data = new Uint8ClampedArray(width * height * 4)
  for (let y = 0; y < height; y++) for (let col = 0; col < columns; col++) {
    data.set(image.data.subarray(y % image.height * image.width * 4, (y % image.height + 1) * image.width * 4), (y * width + col * image.width) * 4)
  }
  return { width, height, data }
}
