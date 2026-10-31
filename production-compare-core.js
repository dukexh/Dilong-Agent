/* Offline image comparison. No DOM, network, or third-party runtime required. */
(function (root, factory) {
  'use strict';
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.DilongCompareCore = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const DEG = Math.PI / 180;
  const SSIM_SIZE = 7;
  const SSIM_RADIUS = 3;
  const ALPHA_MIN = 250;

  function assertImage(image, label) {
    if (!image || !Number.isInteger(image.width) || !Number.isInteger(image.height) ||
        image.width < 1 || image.height < 1 || !image.data ||
        image.data.length !== image.width * image.height * 4) {
      throw new Error((label || '图片') + '数据无效，请重新上传。');
    }
  }

  function srgbLinear(value) {
    const v = value / 255;
    return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
  }

  function rgbToLab(r, g, b) {
    r = srgbLinear(r);
    g = srgbLinear(g);
    b = srgbLinear(b);
    const x = (0.4124564 * r + 0.3575761 * g + 0.1804375 * b) / 0.95047;
    const y = 0.2126729 * r + 0.7151522 * g + 0.0721750 * b;
    const z = (0.0193339 * r + 0.1191920 * g + 0.9503041 * b) / 1.08883;
    function f(t) {
      return t > 216 / 24389 ? Math.cbrt(t) : (24389 / 27 * t + 16) / 116;
    }
    const fx = f(x), fy = f(y), fz = f(z);
    return [116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)];
  }

  // CIEDE2000, kL = kC = kH = 1. Sharma, Wu & Dalal (2005).
  function deltaE00(lab1, lab2) {
    const L1 = lab1[0], a1 = lab1[1], b1 = lab1[2];
    const L2 = lab2[0], a2 = lab2[1], b2 = lab2[2];
    const C1 = Math.hypot(a1, b1), C2 = Math.hypot(a2, b2);
    const cMean7 = Math.pow((C1 + C2) / 2, 7);
    const G = 0.5 * (1 - Math.sqrt(cMean7 / (cMean7 + 6103515625)));
    const ap1 = (1 + G) * a1, ap2 = (1 + G) * a2;
    const cp1 = Math.hypot(ap1, b1), cp2 = Math.hypot(ap2, b2);
    function hue(a, b) {
      if (a === 0 && b === 0) return 0;
      const h = Math.atan2(b, a) / DEG;
      return h < 0 ? h + 360 : h;
    }
    const hp1 = hue(ap1, b1), hp2 = hue(ap2, b2);
    const dLp = L2 - L1, dCp = cp2 - cp1;
    let dhp = hp2 - hp1;
    if (cp1 * cp2 === 0) dhp = 0;
    else if (dhp > 180) dhp -= 360;
    else if (dhp < -180) dhp += 360;
    const dHp = 2 * Math.sqrt(cp1 * cp2) * Math.sin(dhp * DEG / 2);
    const lpMean = (L1 + L2) / 2, cpMean = (cp1 + cp2) / 2;
    let hpMean;
    if (cp1 * cp2 === 0) hpMean = hp1 + hp2;
    else if (Math.abs(hp1 - hp2) <= 180) hpMean = (hp1 + hp2) / 2;
    else hpMean = (hp1 + hp2 + (hp1 + hp2 < 360 ? 360 : -360)) / 2;
    const T = 1 - 0.17 * Math.cos((hpMean - 30) * DEG) +
      0.24 * Math.cos(2 * hpMean * DEG) +
      0.32 * Math.cos((3 * hpMean + 6) * DEG) -
      0.20 * Math.cos((4 * hpMean - 63) * DEG);
    const lDiffSquared = Math.pow(lpMean - 50, 2);
    const SL = 1 + 0.015 * lDiffSquared / Math.sqrt(20 + lDiffSquared);
    const SC = 1 + 0.045 * cpMean;
    const SH = 1 + 0.015 * cpMean * T;
    const cpMean7 = Math.pow(cpMean, 7);
    const RC = 2 * Math.sqrt(cpMean7 / (cpMean7 + 6103515625));
    const theta = 30 * Math.exp(-Math.pow((hpMean - 275) / 25, 2));
    const RT = -Math.sin(2 * theta * DEG) * RC;
    const lTerm = dLp / SL, cTerm = dCp / SC, hTerm = dHp / SH;
    return Math.sqrt(Math.max(0,
      lTerm * lTerm + cTerm * cTerm + hTerm * hTerm + RT * cTerm * hTerm));
  }

  function validateQuad(quad) {
    if (!Array.isArray(quad) || quad.length !== 4) return false;
    if (!quad.every(p => p && Number.isFinite(p.x) && Number.isFinite(p.y) &&
        p.x >= 0 && p.x <= 1 && p.y >= 0 && p.y <= 1)) return false;
    // Screen coordinates increase downwards: TL, TR, BR, BL has positive turns.
    let areaTwice = 0;
    for (let i = 0; i < 4; i++) {
      const p = quad[i], q = quad[(i + 1) % 4], r = quad[(i + 2) % 4];
      const cross = (q.x - p.x) * (r.y - q.y) - (q.y - p.y) * (r.x - q.x);
      if (cross <= 1e-8) return false;
      areaTwice += p.x * q.y - q.x * p.y;
    }
    return areaTwice >= 2e-5;
  }

  // Maps an output unit square back to the selected source quadrilateral.
  function squareToQuad(quad) {
    const p0 = quad[0], p1 = quad[1], p2 = quad[2], p3 = quad[3];
    const dx1 = p1.x - p2.x, dx2 = p3.x - p2.x;
    const dy1 = p1.y - p2.y, dy2 = p3.y - p2.y;
    const dx3 = p0.x - p1.x + p2.x - p3.x;
    const dy3 = p0.y - p1.y + p2.y - p3.y;
    let g = 0, h = 0;
    if (Math.abs(dx3) + Math.abs(dy3) > 1e-12) {
      const determinant = dx1 * dy2 - dx2 * dy1;
      if (Math.abs(determinant) < 1e-12) throw new Error('实物选区无法校正，请重新选择四角。');
      g = (dx3 * dy2 - dx2 * dy3) / determinant;
      h = (dx1 * dy3 - dx3 * dy1) / determinant;
    }
    return [p1.x - p0.x + g * p1.x, p3.x - p0.x + h * p3.x, p0.x,
      p1.y - p0.y + g * p1.y, p3.y - p0.y + h * p3.y, p0.y, g, h];
  }

  function warp(source, quad, width, height) {
    assertImage(source, '原始图片');
    if (!validateQuad(quad)) throw new Error('四角选区无效，请按左上、右上、右下、左下顺序选择，避免交叉或重合。');
    if (!Number.isInteger(width) || !Number.isInteger(height) || width < 2 || height < 2) {
      throw new Error('输出图片尺寸无效。');
    }
    const m = squareToQuad(quad);
    const out = new Uint8ClampedArray(width * height * 4);
    for (let y = 0; y < height; y++) {
      const v = y / (height - 1);
      for (let x = 0; x < width; x++) {
        const u = x / (width - 1);
        const denominator = m[6] * u + m[7] * v + 1;
        if (Math.abs(denominator) < 1e-12) throw new Error('实物选区无法校正，请重新选择四角。');
        const sx = Math.max(0, Math.min(source.width - 1,
          ((m[0] * u + m[1] * v + m[2]) / denominator) * (source.width - 1)));
        const sy = Math.max(0, Math.min(source.height - 1,
          ((m[3] * u + m[4] * v + m[5]) / denominator) * (source.height - 1)));
        const x0 = Math.floor(sx), y0 = Math.floor(sy);
        const x1 = Math.min(x0 + 1, source.width - 1), y1 = Math.min(y0 + 1, source.height - 1);
        const fx = sx - x0, fy = sy - y0;
        const i00 = (y0 * source.width + x0) * 4, i10 = (y0 * source.width + x1) * 4;
        const i01 = (y1 * source.width + x0) * 4, i11 = (y1 * source.width + x1) * 4;
        const dest = (y * width + x) * 4;
        for (let c = 0; c < 4; c++) {
          out[dest + c] = (source.data[i00 + c] * (1 - fx) + source.data[i10 + c] * fx) * (1 - fy) +
            (source.data[i01 + c] * (1 - fx) + source.data[i11 + c] * fx) * fy;
        }
      }
    }
    return { width, height, data: out };
  }

  function thresholdStats(deltaMap, validMask, threshold) {
    if (!deltaMap || !validMask || deltaMap.length !== validMask.length ||
        !Number.isFinite(threshold) || threshold < 0) {
      throw new Error('差异显示阈值或图像数据无效。');
    }
    let validCount = 0, exceeded = 0;
    for (let i = 0; i < deltaMap.length; i++) {
      if (validMask[i]) {
        validCount++;
        if (deltaMap[i] > threshold) exceeded++;
      }
    }
    if (!validCount) throw new Error('选区中没有有效的不透明像素，请重新选择。');
    return exceeded / validCount * 100;
  }

  function ssimDetails(first, second, width, height, validMask, allowEmpty = false) {
    if (!Number.isInteger(width) || !Number.isInteger(height) || width < SSIM_SIZE || height < SSIM_SIZE ||
        !first || !second || first.length !== width * height || second.length !== width * height ||
        (validMask && validMask.length !== first.length)) {
      throw new Error('纹理分析需要至少 7×7 像素的相同尺寸图像。');
    }
    // Integral images give the same 7×7 uniform-window statistics as skimage,
    // cropped by three border pixels and with sample covariance (49 / 48).
    const stride = width + 1, integralLength = stride * (height + 1);
    const sums = Array.from({ length: 6 }, () => new Float64Array(integralLength));
    for (let y = 0; y < height; y++) {
      const row = new Float64Array(6);
      for (let x = 0; x < width; x++) {
        const index = y * width + x, i = (y + 1) * stride + x + 1;
        const valid = !validMask || validMask[index];
        const a = valid ? first[index] : 0, b = valid ? second[index] : 0;
        const values = [a, b, a * a, b * b, a * b, valid ? 1 : 0];
        for (let channel = 0; channel < 6; channel++) {
          row[channel] += values[channel];
          sums[channel][i] = sums[channel][i - stride] + row[channel];
        }
      }
    }
    const C1 = Math.pow(0.01 * 255, 2), C2 = Math.pow(0.03 * 255, 2);
    let total = 0, windowCount = 0;
    for (let y = SSIM_RADIUS; y < height - SSIM_RADIUS; y++) {
      for (let x = SSIM_RADIUS; x < width - SSIM_RADIUS; x++) {
        const left = x - SSIM_RADIUS, top = y - SSIM_RADIUS;
        const right = x + SSIM_RADIUS + 1, bottom = y + SSIM_RADIUS + 1;
        const a = top * stride + left, b = top * stride + right;
        const c = bottom * stride + left, d = bottom * stride + right;
        const value = sums.map(sum => sum[d] - sum[b] - sum[c] + sum[a]);
        if (value[5] !== 49) continue;
        const meanA = value[0] / 49, meanB = value[1] / 49;
        const varianceA = Math.max(0, (value[2] / 49 - meanA * meanA) * 49 / 48);
        const varianceB = Math.max(0, (value[3] / 49 - meanB * meanB) * 49 / 48);
        const covariance = (value[4] / 49 - meanA * meanB) * 49 / 48;
        const numerator = (2 * meanA * meanB + C1) * (2 * covariance + C2);
        const denominator = (meanA * meanA + meanB * meanB + C1) * (varianceA + varianceB + C2);
        total += numerator / denominator;
        windowCount++;
      }
    }
    if (!windowCount && allowEmpty) return { value: 0, windowCount: 0 };
    if (!windowCount) throw new Error('选区有效图像区域不足，请重新选择至少包含 7×7 不透明像素的区域。');
    return { value: Math.max(-1, Math.min(1, total / windowCount)), windowCount };
  }

  function grayscaleSSIM(first, second, width, height, validMask) {
    return ssimDetails(first, second, width, height, validMask).value;
  }

  function analyze(reference, actual, threshold) {
    assertImage(reference, '设计原图');
    assertImage(actual, '生产实物图片');
    if (reference.width !== actual.width || reference.height !== actual.height) {
      throw new Error('两张图片尺寸不一致，请先完成选区对齐。');
    }
    if (threshold === undefined) threshold = 5;
    if (!Number.isFinite(threshold) || threshold < 0) throw new Error('差异显示阈值必须为大于或等于 0 的数值。');
    const width = reference.width, height = reference.height, count = width * height;
    const deltaMap = new Float32Array(count), validMask = new Uint8Array(count);
    const firstGray = new Float64Array(count), secondGray = new Float64Array(count);
    const sortedDelta = [];
    let sum = 0, rgbSum = 0, lSum = 0, aSum = 0, bSum = 0, validCount = 0;
    for (let i = 0; i < count; i++) {
      const j = i * 4;
      if (reference.data[j + 3] < ALPHA_MIN || actual.data[j + 3] < ALPHA_MIN) continue;
      const lab1 = rgbToLab(reference.data[j], reference.data[j + 1], reference.data[j + 2]);
      const lab2 = rgbToLab(actual.data[j], actual.data[j + 1], actual.data[j + 2]);
      const difference = deltaE00(lab1, lab2);
      deltaMap[i] = difference;
      validMask[i] = 1;
      sortedDelta.push(difference);
      sum += difference;
      rgbSum += Math.hypot(reference.data[j] - actual.data[j], reference.data[j + 1] - actual.data[j + 1], reference.data[j + 2] - actual.data[j + 2]) / Math.sqrt(3);
      lSum += lab2[0] - lab1[0];
      aSum += lab2[1] - lab1[1];
      bSum += lab2[2] - lab1[2];
      firstGray[i] = 0.2126 * reference.data[j] + 0.7152 * reference.data[j + 1] + 0.0722 * reference.data[j + 2];
      secondGray[i] = 0.2126 * actual.data[j] + 0.7152 * actual.data[j + 1] + 0.0722 * actual.data[j + 2];
      validCount++;
    }
    if (!validCount) throw new Error('选区中没有有效的不透明像素，请重新选择。');
    const structure = ssimDetails(firstGray, secondGray, width, height, validMask);
    sortedDelta.sort((a, b) => a - b);
    // Linear percentile, matching NumPy's default percentile method.
    const position = (sortedDelta.length - 1) * 0.95, lower = Math.floor(position);
    const p95DeltaE = sortedDelta[lower] +
      (sortedDelta[Math.min(lower + 1, sortedDelta.length - 1)] - sortedDelta[lower]) * (position - lower);
    return {
      width, height, meanDeltaE: sum / validCount, meanRgbDifference: rgbSum / validCount, p95DeltaE,
      ssim: structure.value, ssimWindowCount: structure.windowCount,
      deltaL: lSum / validCount, deltaA: aSum / validCount, deltaB: bSum / validCount,
      deltaMap, validMask, validCount,
      areaPercent: thresholdStats(deltaMap, validMask, threshold)
    };
  }

  function comparisonBounds(reference, quad) {
    assertImage(reference, '设计原图');
    if (!validateQuad(quad) || Math.abs(quad[0].y - quad[1].y) > 1e-9 ||
        Math.abs(quad[1].x - quad[2].x) > 1e-9 || Math.abs(quad[2].y - quad[3].y) > 1e-9 ||
        Math.abs(quad[3].x - quad[0].x) > 1e-9) throw new Error('请在设计原图上选择有效的矩形区域。');
    const left = Math.floor(quad[0].x * reference.width), top = Math.floor(quad[0].y * reference.height);
    const right = Math.ceil(quad[2].x * reference.width), bottom = Math.ceil(quad[2].y * reference.height);
    return { left, top, width: right - left, height: bottom - top };
  }

  // Sample the actual image at the reference's original pixel centers. Equal
  // source sizes map to exact source pixels, including a cropped selection.
  function sampleActual(actual, reference, x, y, output, offset) {
    if (actual.width === reference.width && actual.height === reference.height) {
      const index = (y * actual.width + x) * 4;
      for (let c = 0; c < 4; c++) output[offset + c] = actual.data[index + c];
      return;
    }
    const sx = Math.max(0, Math.min(actual.width - 1, (x + .5) * actual.width / reference.width - .5));
    const sy = Math.max(0, Math.min(actual.height - 1, (y + .5) * actual.height / reference.height - .5));
    const x0 = Math.floor(sx), y0 = Math.floor(sy), fx = sx - x0, fy = sy - y0;
    const x1 = Math.min(x0 + 1, actual.width - 1), y1 = Math.min(y0 + 1, actual.height - 1);
    const a = (y0 * actual.width + x0) * 4, b = (y0 * actual.width + x1) * 4;
    const c = (y1 * actual.width + x0) * 4, d = (y1 * actual.width + x1) * 4;
    for (let channel = 0; channel < 4; channel++) output[offset + channel] =
      (actual.data[a + channel] * (1 - fx) + actual.data[b + channel] * fx) * (1 - fy) +
      (actual.data[c + channel] * (1 - fx) + actual.data[d + channel] * fx) * fy;
  }

  // Non-negative Float32 values have the same ordering as their Uint32 bit
  // patterns. Two radix histograms find the exact ranks in the stored map
  // without another image-sized allocation or a blocking Array.sort().
  async function mapPercentile95(deltaMap, validMask, highCounts, validCount, checkpoint) {
    const bits = new Uint32Array(deltaMap.buffer, deltaMap.byteOffset, deltaMap.length);
    const position = (validCount - 1) * .95, lowerRank = Math.floor(position), upperRank = Math.ceil(position);
    function bucketFor(histogram, rank) {
      let preceding = 0;
      for (let bucket = 0; bucket < histogram.length; bucket++) {
        if (preceding + histogram[bucket] > rank) return { bucket, rank: rank - preceding };
        preceding += histogram[bucket];
      }
      throw new Error('色差百分位统计失败，请重新分析。');
    }
    const lower = bucketFor(highCounts, lowerRank), upper = bucketFor(highCounts, upperRank);
    const lowCounts = new Uint32Array(65536);
    const upperCounts = lower.bucket === upper.bucket ? lowCounts : new Uint32Array(65536);
    const block = 262144;
    for (let start = 0; start < bits.length; start += block) {
      const end = Math.min(bits.length, start + block);
      for (let i = start; i < end; i++) {
        if (!validMask[i]) continue;
        const high = bits[i] >>> 16, low = bits[i] & 65535;
        if (high === lower.bucket) lowCounts[low]++;
        else if (high === upper.bucket) upperCounts[low]++;
      }
      await checkpoint('percentile', end, bits.length, .9 + .09 * end / bits.length);
    }
    const valueBits = new Uint32Array(1), valueFloat = new Float32Array(valueBits.buffer);
    valueBits[0] = (lower.bucket << 16) | bucketFor(lowCounts, lower.rank).bucket;
    const lowerValue = valueFloat[0];
    valueBits[0] = (upper.bucket << 16) | bucketFor(upperCounts, upper.rank).bucket;
    return lowerValue + (valueFloat[0] - lowerValue) * (position - lowerRank);
  }

  async function compareRegions(reference, actual, quad, options = {}) {
    assertImage(actual, '生产实物图片');
    const bounds = comparisonBounds(reference, quad), { width, height } = bounds;
    if (Math.min(width, height, width * actual.width / reference.width,
      height * actual.height / reference.height) < 16) throw new Error('选区过小，请选择至少包含 16×16 像素的对应区域。');
    const threshold = options.threshold === undefined ? 5 : options.threshold;
    if (!Number.isFinite(threshold) || threshold < 0) throw new Error('差异显示阈值必须为大于或等于 0 的数值。');
    const yieldTask = options.yieldTask || (() => new Promise(resolve => setTimeout(resolve, 0)));
    const checkCancelled = () => {
      if (options.shouldCancel && options.shouldCancel()) {
        const error = new Error('已取消计算。'); error.name = 'AbortError'; throw error;
      }
    };
    const checkpoint = async (phase, completed, total, fraction) => {
      checkCancelled();
      if (options.onProgress) options.onProgress({ phase, completed, total, fraction });
      await yieldTask(); checkCancelled();
    };
    checkCancelled();
    const count = width * height, deltaMap = new Float32Array(count), validMask = new Uint8Array(count);
    const deltaBits = new Uint32Array(deltaMap.buffer), highCounts = new Uint32Array(65536);
    const previewScale = Math.min(1, 1024 / Math.max(width, height));
    const pw = Math.max(1, Math.round(width * previewScale)), ph = Math.max(1, Math.round(height * previewScale));
    const previewDeltaMap = new Float32Array(pw * ph), previewValidMask = new Uint8Array(pw * ph);
    const previewColumns = Int32Array.from({ length: width }, (_, x) => Math.floor(x * pw / width));
    const rows = Math.max(7, Math.floor(options.blockRows || 32768 / width));
    let sum = 0, rgbSum = 0, lSum = 0, aSum = 0, bSum = 0, validCount = 0, exceeded = 0;
    let structureTotal = 0, ssimWindowCount = 0;
    for (let start = 0; start < height; start += rows) {
      checkCancelled();
      const end = Math.min(height, start + rows), firstRow = Math.max(0, start - SSIM_RADIUS);
      const lastRow = Math.min(height, end + SSIM_RADIUS), stripeHeight = lastRow - firstRow;
      const stripeLength = width * stripeHeight;
      const firstGray = new Float64Array(stripeLength), secondGray = new Float64Array(stripeLength);
      const stripeMask = new Uint8Array(stripeLength), actualRow = new Uint8ClampedArray(width * 4);
      for (let y = firstRow; y < lastRow; y++) {
        for (let x = 0; x < width; x++) sampleActual(actual, reference, bounds.left + x, bounds.top + y, actualRow, x * 4);
        const previewRow = Math.floor(y * ph / height) * pw;
        for (let x = 0; x < width; x++) {
          const sourceIndex = ((bounds.top + y) * reference.width + bounds.left + x) * 4;
          const actualIndex = x * 4, stripeIndex = (y - firstRow) * width + x;
          if (reference.data[sourceIndex + 3] < ALPHA_MIN || actualRow[actualIndex + 3] < ALPHA_MIN) continue;
          const r1 = reference.data[sourceIndex], g1 = reference.data[sourceIndex + 1], b1 = reference.data[sourceIndex + 2];
          const r2 = actualRow[actualIndex], g2 = actualRow[actualIndex + 1], b2 = actualRow[actualIndex + 2];
          firstGray[stripeIndex] = .2126 * r1 + .7152 * g1 + .0722 * b1;
          secondGray[stripeIndex] = .2126 * r2 + .7152 * g2 + .0722 * b2;
          stripeMask[stripeIndex] = 1;
          if (y < start || y >= end) continue;
          const index = y * width + x, lab1 = rgbToLab(r1, g1, b1), lab2 = rgbToLab(r2, g2, b2);
          const difference = deltaE00(lab1, lab2);
          deltaMap[index] = difference; validMask[index] = 1;
          highCounts[deltaBits[index] >>> 16]++;
          sum += difference; lSum += lab2[0] - lab1[0]; aSum += lab2[1] - lab1[1]; bSum += lab2[2] - lab1[2];
          rgbSum += Math.hypot(r1 - r2, g1 - g2, b1 - b2) / Math.sqrt(3);
          validCount++; if (deltaMap[index] > threshold) exceeded++;
          const previewIndex = previewRow + previewColumns[x];
          previewValidMask[previewIndex] = 1;
          previewDeltaMap[previewIndex] = Math.max(previewDeltaMap[previewIndex], deltaMap[index]);
        }
      }
      if (stripeHeight >= SSIM_SIZE) {
        // A stripe without any valid 7x7 windows contributes zero windows.
        const structure = ssimDetails(firstGray, secondGray, width, stripeHeight, stripeMask, true);
        structureTotal += structure.value * structure.windowCount; ssimWindowCount += structure.windowCount;
      }
      await checkpoint('pixels', end * width, count, .9 * end / height);
    }
    if (!validCount) throw new Error('选区中没有有效的不透明像素，请重新选择。');
    if (!ssimWindowCount) throw new Error('选区有效图像区域不足，请重新选择至少包含 7×7 不透明像素的区域。');
    const p95DeltaE = await mapPercentile95(deltaMap, validMask, highCounts, validCount, checkpoint);
    const referencePreview = { width: pw, height: ph, data: new Uint8ClampedArray(pw * ph * 4) };
    const actualPreview = { width: pw, height: ph, data: new Uint8ClampedArray(pw * ph * 4) };
    for (let y = 0; y < ph; y++) {
      const sourceY = bounds.top + Math.min(height - 1, Math.floor((y + .5) * height / ph));
      for (let x = 0; x < pw; x++) {
        const sourceX = bounds.left + Math.min(width - 1, Math.floor((x + .5) * width / pw));
        const index = (y * pw + x) * 4, sourceIndex = (sourceY * reference.width + sourceX) * 4;
        referencePreview.data.set(reference.data.subarray(sourceIndex, sourceIndex + 4), index);
        sampleActual(actual, reference, sourceX, sourceY, actualPreview.data, index);
      }
      if (y % 64 === 63) await checkpoint('preview', y + 1, ph, .99 + .01 * (y + 1) / ph);
    }
    await checkpoint('complete', count, count, 1);
    return { width, height, bounds, meanDeltaE: sum / validCount, meanRgbDifference: rgbSum / validCount, p95DeltaE,
      ssim: Math.max(-1, Math.min(1, structureTotal / ssimWindowCount)), ssimWindowCount,
      deltaL: lSum / validCount, deltaA: aSum / validCount, deltaB: bSum / validCount,
      deltaMap, validMask, validCount, areaPercent: exceeded / validCount * 100,
      reference: referencePreview, actual: actualPreview, previewDeltaMap, previewValidMask };
  }

  return Object.freeze({ rgbToLab, deltaE00, analyze, compareRegions, comparisonBounds, thresholdStats, warp, validateQuad, grayscaleSSIM });
});
