import type { PixelImage } from './types'
import type { SeamlessDocument } from './seamless'

export interface ExportSettings { format: 'tif' | 'psd'; ppi: number }
export function physicalSize(width: number, height: number, ppi = 300) {
  if (!Number.isFinite(ppi) || ppi < 1 || ppi > 2400) throw Error('分辨率须在 1—2400 ppi 之间')
  return { widthMm: width / ppi * 25.4, heightMm: height / ppi * 25.4 }
}
export function validateExport(image: PixelImage, settings: ExportSettings, layered = false) {
  physicalSize(image.width, image.height, settings.ppi)
  const maxSide = settings.format === 'psd' ? 30000 : 32767
  if (!Number.isInteger(image.width) || !Number.isInteger(image.height) || image.width < 1 || image.height < 1 || image.width > maxSide || image.height > maxSide || image.width * image.height > 40000000) throw Error('文件超过格式尺寸限制或 4000 万像素上限')
  if (image.data.length !== image.width * image.height * 4) throw Error('导出图像数据不完整')
  const estimate = image.width * image.height * (settings.format === 'psd' ? layered ? 40 : 20 : 12)
  if (estimate > 768 * 1024 * 1024) throw Error('本次导出预计超过 768 MB 内存预算，请减小单元尺寸或选择 TIF；系统不会自动降低像素')
}

/** Baseline TIFF: uncompressed, 8-bit sRGB-compatible RGBA, unassociated alpha, explicit inch resolution. */
export function encodeTiff(image: PixelImage, ppi = 300): Uint8Array<ArrayBuffer> {
  validateExport(image, { format: 'tif', ppi })
  const count = 14, ifdEnd = 8 + 2 + count * 12 + 4, bits = ifdEnd, xRes = bits + 8, yRes = xRes + 8, pixels = yRes + 8
  const out = new Uint8Array(pixels + image.data.length), view = new DataView(out.buffer)
  out.set([73, 73, 42, 0]); view.setUint32(4, 8, true); view.setUint16(8, count, true)
  let pos = 10
  const tag = (id: number, type: number, n: number, value: number) => {
    view.setUint16(pos, id, true); view.setUint16(pos + 2, type, true); view.setUint32(pos + 4, n, true)
    if (type === 3 && n === 1) view.setUint16(pos + 8, value, true); else view.setUint32(pos + 8, value, true)
    pos += 12
  }
  tag(256, 4, 1, image.width); tag(257, 4, 1, image.height); tag(258, 3, 4, bits)
  tag(259, 3, 1, 1); tag(262, 3, 1, 2); tag(273, 4, 1, pixels); tag(277, 3, 1, 4)
  tag(278, 4, 1, image.height); tag(279, 4, 1, image.data.length); tag(282, 5, 1, xRes)
  tag(283, 5, 1, yRes); tag(284, 3, 1, 1); tag(296, 3, 1, 2); tag(338, 3, 1, 2)
  for (let c = 0; c < 4; c++) view.setUint16(bits + c * 2, 8, true)
  for (const offset of [xRes, yRes]) { view.setUint32(offset, Math.round(ppi * 1000), true); view.setUint32(offset + 4, 1000, true) }
  out.set(image.data, pixels)
  return out
}

export async function encodePsd(image: PixelImage, ppi = 300, document?: SeamlessDocument): Promise<Uint8Array<ArrayBuffer>> {
  validateExport(image, { format: 'psd', ppi }, !!document)
  const { writePsdUint8Array } = await import('ag-psd')
  const dimensions = { width: image.width, height: image.height }
  const children = document ? (() => {
    if (document.base.width !== image.width || document.base.height !== image.height || document.repairMask.length !== image.width * image.height) throw Error('工程图层尺寸不一致')
    const original = { ...dimensions, data: document.base.data }
    const repairMask = new Uint8ClampedArray(image.data.length), baseMask = new Uint8ClampedArray(image.data.length)
    for (let i = 0; i < document.repairMask.length; i++) {
      const value = document.repairMask[i]
      for (let c = 0; c < 3; c++) { repairMask[i * 4 + c] = value; baseMask[i * 4 + c] = 255 - value }
      repairMask[i * 4 + 3] = baseMask[i * 4 + 3] = 255
    }
    const mask = (data: Uint8ClampedArray) => ({ top: 0, left: 0, right: image.width, bottom: image.height, defaultColor: 0, imageData: { ...dimensions, data } })
    return [
      { name: '原始单元参考', hidden: true, imageData: original },
      { name: '单元基础', imageData: original, mask: mask(baseMask) },
      { name: '接缝修补', imageData: { ...dimensions, data: image.data }, mask: mask(repairMask) },
    ]
  })() : [{ name: '完整设计图', imageData: { ...dimensions, data: image.data } }]
  return writePsdUint8Array({ ...dimensions, channels: 4, bitsPerChannel: 8, imageData: { ...dimensions, data: image.data }, children,
    imageResources: { resolutionInfo: { horizontalResolution: ppi, horizontalResolutionUnit: 'PPI', widthUnit: 'Centimeters', verticalResolution: ppi, verticalResolutionUnit: 'PPI', heightUnit: 'Centimeters' } },
  }, { generateThumbnail: false, noBackground: true }) as Uint8Array<ArrayBuffer>
}
