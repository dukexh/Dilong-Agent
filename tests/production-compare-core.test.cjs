'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const core = require('../production-compare-core.js');

const fullQuad = [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }, { x: 0, y: 1 }];
function image(width, height, pixel) {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    data.set(pixel(x, y), (y * width + x) * 4);
  }
  return { width, height, data };
}
function close(actual, expected, tolerance = 1e-8) {
  assert.ok(Math.abs(actual - expected) <= tolerance, `${actual} differs from ${expected}`);
}
function pixelAt(im, x, y) {
  return Array.from(im.data.slice((y * im.width + x) * 4, (y * im.width + x) * 4 + 4));
}

test('browser global export works without require or DOM', () => {
  const sandbox = {};
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../production-compare-core.js'), 'utf8'), sandbox);
  assert.equal(typeof sandbox.DilongCompareCore.analyze, 'function');
  assert.equal(typeof sandbox.DilongCompareCore.warp, 'function');
});

test('sRGB to D65 Lab agrees with primary colors and neutrals', () => {
  core.rgbToLab(0, 0, 0).forEach(x => close(x, 0));
  const white = core.rgbToLab(255, 255, 255);
  close(white[0], 100, 1e-4);
  close(white[1], 0, 1e-4);
  close(white[2], 0, 1e-4);
  const red = core.rgbToLab(255, 0, 0);
  close(red[0], 53.24079, 1e-4);
  close(red[1], 80.09246, 1e-4);
  close(red[2], 67.20320, 1e-4);
});

// All 34 supplemental CIEDE2000 reference pairs published by Sharma, Wu & Dalal:
// https://hajim.rochester.edu/ece/sites/gsharma/ciede2000/dataNprograms/ciede2000testdata.txt
const sharmaPairs = [
  [50, 2.6772, -79.7751, 50, 0, -82.7485, 2.0425],
  [50, 3.1571, -77.2803, 50, 0, -82.7485, 2.8615],
  [50, 2.8361, -74.0200, 50, 0, -82.7485, 3.4412],
  [50, -1.3802, -84.2814, 50, 0, -82.7485, 1],
  [50, -1.1848, -84.8006, 50, 0, -82.7485, 1],
  [50, -0.9009, -85.5211, 50, 0, -82.7485, 1],
  [50, 0, 0, 50, -1, 2, 2.3669],
  [50, -1, 2, 50, 0, 0, 2.3669],
  [50, 2.49, -0.001, 50, -2.49, 0.0009, 7.1792],
  [50, 2.49, -0.001, 50, -2.49, 0.001, 7.1792],
  [50, 2.49, -0.001, 50, -2.49, 0.0011, 7.2195],
  [50, 2.49, -0.001, 50, -2.49, 0.0012, 7.2195],
  [50, -0.001, 2.49, 50, 0.0009, -2.49, 4.8045],
  [50, -0.001, 2.49, 50, 0.001, -2.49, 4.8045],
  [50, -0.001, 2.49, 50, 0.0011, -2.49, 4.7461],
  [50, 2.5, 0, 50, 0, -2.5, 4.3065],
  [50, 2.5, 0, 73, 25, -18, 27.1492],
  [50, 2.5, 0, 61, -5, 29, 22.8977],
  [50, 2.5, 0, 56, -27, -3, 31.9030],
  [50, 2.5, 0, 58, 24, 15, 19.4535],
  [50, 2.5, 0, 50, 3.1736, 0.5854, 1],
  [50, 2.5, 0, 50, 3.2972, 0, 1],
  [50, 2.5, 0, 50, 1.8634, 0.5757, 1],
  [50, 2.5, 0, 50, 3.2592, 0.3350, 1],
  [60.2574, -34.0099, 36.2677, 60.4626, -34.1751, 39.4387, 1.2644],
  [63.0109, -31.0961, -5.8663, 62.8187, -29.7946, -4.0864, 1.2630],
  [61.2901, 3.7196, -5.3901, 61.4292, 2.2480, -4.9620, 1.8731],
  [35.0831, -44.1164, 3.7933, 35.0232, -40.0716, 1.5901, 1.8645],
  [22.7233, 20.0904, -46.6940, 23.0331, 14.9730, -42.5619, 2.0373],
  [36.4612, 47.8580, 18.3852, 36.2715, 50.5065, 21.2231, 1.4146],
  [90.8027, -2.0831, 1.4410, 91.1528, -1.6435, 0.0447, 1.4441],
  [90.9257, -0.5406, -0.9208, 88.6381, -0.8985, -0.7239, 1.5381],
  [6.7747, -0.2908, -2.4247, 5.8714, -0.0985, -2.2286, 0.6377],
  [2.0776, 0.0795, -1.1350, 0.9033, -0.0636, -0.5514, 0.9082]
];
test('CIEDE2000 matches all 34 Sharma reference pairs, including hue wrap boundaries', () => {
  sharmaPairs.forEach((row, i) => {
    const first = row.slice(0, 3), second = row.slice(3, 6);
    const actual = core.deltaE00(first, second);
    assert.ok(Math.abs(actual - row[6]) < 0.00005, `Sharma pair ${i + 1}: ${actual}`);
    close(core.deltaE00(second, first), actual, 1e-10);
  });
});

test('identical textured images give exact identity metrics', () => {
  const im = image(32, 24, (x, y) => [(x * 7 + y * 3) % 256, (x * y * 2) % 256, (x + y) * 4 % 256, 255]);
  const result = core.analyze(im, im);
  close(result.meanDeltaE, 0);
  close(result.p95DeltaE, 0);
  close(result.ssim, 1);
  close(result.areaPercent, 0);
  close(result.deltaL, 0);
  assert.equal(result.validCount, 768);
  assert.equal(result.ssimWindowCount, (32 - 6) * (24 - 6));
  assert.ok(result.deltaMap instanceof Float32Array);
  assert.ok(result.validMask instanceof Uint8Array);
});

test('brightness and red shifts have meaningful signed Lab direction', () => {
  const reference = image(20, 20, () => [160, 140, 120, 255]);
  const darker = image(20, 20, () => [125, 105, 85, 255]);
  const redder = image(20, 20, () => [200, 140, 120, 255]);
  const darkResult = core.analyze(reference, darker);
  assert.ok(darkResult.deltaL < -10);
  assert.ok(darkResult.meanDeltaE > 5);
  assert.equal(darkResult.areaPercent, 100);
  assert.ok(darkResult.ssim < 1);
  assert.ok(core.analyze(reference, redder).deltaA > 10);
});

test('localized changes appear only at modified pixels and threshold updates do not recompute metrics', () => {
  const reference = image(20, 20, () => [120, 120, 120, 255]);
  const actual = image(20, 20, (x, y) => x >= 8 && x < 12 && y >= 8 && y < 12 ? [220, 30, 20, 255] : [120, 120, 120, 255]);
  const result = core.analyze(reference, actual, 5);
  close(result.areaPercent, 4);
  assert.equal(result.deltaMap[0], 0);
  assert.ok(result.deltaMap[9 * 20 + 9] > 20);
  close(core.thresholdStats(result.deltaMap, result.validMask, 100), 0);
  close(core.thresholdStats(result.deltaMap, result.validMask, 0), 4);
  assert.ok(result.ssim < 0.99);
});

test('transparent pixels are excluded from color, area and SSIM windows', () => {
  const reference = image(20, 20, () => [100, 100, 100, 255]);
  const actual = image(20, 20, (x, y) => x === 0 || y === 0 ? [255, 0, 0, 0] : [100, 100, 100, 255]);
  const result = core.analyze(reference, actual);
  assert.equal(result.validCount, 361);
  assert.equal(result.validMask[0], 0);
  assert.equal(result.ssimWindowCount, 13 * 13);
  close(result.meanDeltaE, 0);
  close(result.ssim, 1);
  const onlySmallPatch = image(20, 20, (x, y) => [100, 100, 100, x < 6 && y < 6 ? 255 : 0]);
  assert.throws(() => core.analyze(reference, onlySmallPatch), /有效图像区域不足/);
});

test('SSIM agrees with skimage 0.25 sample-covariance reference values', () => {
  // Expected values produced with skimage.metrics.structural_similarity,
  // win_size=7, data_range=255, use_sample_covariance=True, K1=.01, K2=.03.
  const width = 31, height = 23, first = [], second = [], flipped = [];
  const sample = (x, y) => (x * 19 + y * 11 + (x * y % 17) * 3) % 256;
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const value = sample(x, y);
    first.push(value);
    second.push(value * 0.83 + 15 + (x + y) % 5 * 3);
    flipped.push(sample(width - 1 - x, y));
  }
  close(core.grayscaleSSIM(first, second, width, height), 0.9790331245514349, 1e-12);
  close(core.grayscaleSSIM(first, flipped, width, height), 0.03805444812472717, 1e-12);
});

test('warp preserves a full image and bilinearly interpolates resized pixels', () => {
  const im = image(9, 9, (x, y) => [x * 20, y * 20, x * 10 + y * 10, 255]);
  assert.deepEqual(core.warp(im, fullQuad, 9, 9).data, im.data);
  const resized = core.warp(im, fullQuad, 17, 17);
  assert.deepEqual(pixelAt(resized, 1, 1), [10, 10, 10, 255]);
  assert.deepEqual(pixelAt(resized, 16, 16), [160, 160, 160, 255]);
});

test('inverse perspective mapping reaches exact corners and projective center', () => {
  const source = image(101, 101, (x, y) => [x * 2, y * 2, 50, 255]);
  const quad = [{ x: 0.2, y: 0.2 }, { x: 0.8, y: 0.2 }, { x: 1, y: 0.8 }, { x: 0, y: 0.8 }];
  const warped = core.warp(source, quad, 11, 11);
  assert.deepEqual(pixelAt(warped, 0, 0), [40, 40, 50, 255]);
  assert.deepEqual(pixelAt(warped, 10, 0), [160, 40, 50, 255]);
  assert.deepEqual(pixelAt(warped, 10, 10), [200, 160, 50, 255]);
  assert.deepEqual(pixelAt(warped, 0, 10), [0, 160, 50, 255]);
  // Independent analytical solution for this trapezoid: center maps to (.5,.425).
  assert.deepEqual(pixelAt(warped, 5, 5), [100, 85, 50, 255]);
});

test('known synthetic perspective becomes substantially closer after alignment', () => {
  const texture = (u, v) => [70 + 150 * u, 90 + 100 * v, 110 + 35 * Math.sin(8 * u + 3 * v), 255];
  const reference = image(65, 65, (x, y) => texture(x / 64, y / 64));
  // Analytic inverse of the trapezoid homography, separate from warp().
  const actual = image(201, 201, (x, y) => {
    const sx = x / 200, sy = y / 200;
    const v = (sy - 0.2) / (0.28 + 0.4 * sy);
    const u = (sx * (1 - 0.4 * v) + 0.2 * v - 0.2) / 0.6;
    return texture(Math.max(0, Math.min(1, u)), Math.max(0, Math.min(1, v)));
  });
  const quad = [{ x: 0.2, y: 0.2 }, { x: 0.8, y: 0.2 }, { x: 1, y: 0.8 }, { x: 0, y: 0.8 }];
  const aligned = core.analyze(reference, core.warp(actual, quad, 65, 65));
  const unaligned = core.analyze(reference, core.warp(actual, fullQuad, 65, 65));
  assert.ok(aligned.meanDeltaE < 0.25, `${aligned.meanDeltaE}`);
  assert.ok(aligned.meanDeltaE < unaligned.meanDeltaE / 10);
  assert.ok(aligned.ssim > 0.99);
});

test('quad validation rejects crossed, concave, reversed, degenerate and out-of-bounds selections', () => {
  assert.equal(core.validateQuad(fullQuad), true);
  const invalid = [
    [fullQuad[0], fullQuad[2], fullQuad[1], fullQuad[3]],
    [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 0.2, y: 0.2 }, { x: 0, y: 1 }],
    [...fullQuad].reverse(),
    [fullQuad[0], fullQuad[1], fullQuad[1], fullQuad[3]],
    [{ x: -0.1, y: 0 }, ...fullQuad.slice(1)],
    [{ x: NaN, y: 0 }, ...fullQuad.slice(1)],
    [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 0.000001 }, { x: 0, y: 0.000001 }],
    null, []
  ];
  invalid.forEach(quad => assert.equal(core.validateQuad(quad), false));
  assert.throws(() => core.warp(image(8, 8, () => [0, 0, 0, 255]), invalid[0], 8, 8), /四角选区无效/);
});

test('bad image data, mismatched sizes, transparency and invalid thresholds give actionable errors', () => {
  const opaque = image(8, 8, () => [128, 128, 128, 255]);
  assert.throws(() => core.analyze({}, opaque), /数据无效/);
  assert.throws(() => core.analyze(opaque, image(9, 8, () => [0, 0, 0, 255])), /尺寸不一致/);
  assert.throws(() => core.analyze(opaque, image(8, 8, () => [0, 0, 0, 0])), /没有有效/);
  assert.throws(() => core.analyze(opaque, opaque, -1), /阈值/);
  assert.throws(() => core.analyze(opaque, opaque, NaN), /阈值/);
  assert.throws(() => core.thresholdStats([1], [0], 5), /没有有效/);
  assert.throws(() => core.thresholdStats([1], [], 5), /阈值或图像数据无效/);
  const small = image(6, 6, () => [0, 0, 0, 255]);
  assert.throws(() => core.analyze(small, small), /至少 7×7/);
});
