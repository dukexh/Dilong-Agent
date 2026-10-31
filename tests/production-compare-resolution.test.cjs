'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const core = require('../production-compare-core.js');
const full = [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }, { x: 0, y: 1 }];
function image(width, height, pixel = () => [120, 120, 120, 255]) {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) data.set(pixel(x, y), (y * width + x) * 4);
  return { width, height, data };
}
const immediate = async () => {};
const options = { yieldTask: immediate, blockRows: 7 };
const close = (a, b, tolerance = 1e-8) => assert.ok(Math.abs(a - b) < tolerance, `${a} != ${b}`);

test('full comparison exceeds both old limits, visits every original pixel and retains a one-pixel change', async () => {
  const reference = image(2560, 40), actual = image(2560, 40);
  const changedIndex = 21 * reference.width + 2301;
  actual.data.set([240, 10, 20, 255], changedIndex * 4);
  const progress = [];
  const result = await core.compareRegions(reference, actual, full, { ...options, onProgress: p => progress.push(p) });
  assert.equal(result.width, 2560); assert.equal(result.height, 40);
  assert.equal(result.validCount, 102400); assert.equal(result.deltaMap.length, 102400);
  assert.equal(result.ssimWindowCount, (2560 - 6) * (40 - 6));
  assert.equal(Array.from(result.deltaMap).filter(v => v > 0).length, 1);
  assert.ok(result.deltaMap[changedIndex] > 20);
  close(result.areaPercent, 100 / 102400);
  close(result.meanDeltaE, core.deltaE00(core.rgbToLab(120, 120, 120), core.rgbToLab(240, 10, 20)) / 102400);
  assert.equal(result.p95DeltaE, 0);
  assert.equal(result.reference.width, 1024, 'Only the display preview is reduced');
  close(Math.max(...result.previewDeltaMap), result.deltaMap[changedIndex]);
  assert.equal(progress.at(-1).fraction, 1);
  assert.ok(progress.length > 3);
});

test('striped metrics and weighted SSIM match the full-image formula across chunk boundaries', async () => {
  const reference = image(71, 59, (x, y) => [(x * 11 + y * 3) % 256, (x * 3 + y * 7) % 256, (x * y) % 256, 255]);
  const actual = image(71, 59, (x, y) => [(x * 11 + y * 3 + 9) % 256, (x * 3 + y * 7 + 2) % 256, (x * y + 20) % 256, 255]);
  const expected = core.analyze(reference, actual, 7.5);
  for (const blockRows of [7, 13, 25, 100]) {
    const result = await core.compareRegions(reference, actual, full, { ...options, blockRows, threshold: 7.5 });
    for (const key of ['meanDeltaE', 'meanRgbDifference', 'ssim', 'deltaL', 'deltaA', 'deltaB', 'areaPercent']) close(result[key], expected[key]);
    close(result.p95DeltaE, expected.p95DeltaE, 1e-5);
    assert.equal(result.ssimWindowCount, expected.ssimWindowCount);
    assert.deepEqual(result.deltaMap, expected.deltaMap);
  }
});

test('empty transparent stripes do not discard later valid SSIM windows or change percentile ranks', async () => {
  const reference = image(32, 35);
  const actual = image(32, 35, (x, y) => y < 8 ? [255, 0, 0, 0] : [120 + x % 3, 120, 120, 255]);
  const result = await core.compareRegions(reference, actual, full, options), expected = core.analyze(reference, actual);
  assert.equal(result.validCount, 32 * 27);
  assert.equal(result.ssimWindowCount, expected.ssimWindowCount);
  close(result.ssim, expected.ssim);
  close(result.p95DeltaE, expected.p95DeltaE, 1e-5);
  assert.deepEqual(result.validMask, expected.validMask);
});

test('local selection copies exact original reference pixels and excludes changes outside its bounds', async () => {
  const reference = image(80, 64, (x, y) => [x * 3, y * 3, x + y, 255]);
  const actual = { ...reference, data: new Uint8ClampedArray(reference.data) };
  actual.data.set([255, 0, 0, 255], 0);
  const quad = [{ x: .2, y: .25 }, { x: .6, y: .25 }, { x: .6, y: .75 }, { x: .2, y: .75 }];
  const result = await core.compareRegions(reference, actual, quad, options);
  assert.deepEqual(result.bounds, { left: 16, top: 16, width: 32, height: 32 });
  assert.equal(result.validCount, 1024); assert.equal(result.meanDeltaE, 0); assert.equal(result.ssim, 1);
  for (let y = 0; y < 32; y++) for (let x = 0; x < 32; x++) {
    const source = ((16 + y) * 80 + 16 + x) * 4, destination = (y * 32 + x) * 4;
    assert.deepEqual(result.reference.data.slice(destination, destination + 4), reference.data.slice(source, source + 4));
  }
  const fractional = [{ x: .201, y: .251 }, { x: .599, y: .251 }, { x: .599, y: .749 }, { x: .201, y: .749 }];
  assert.deepEqual(core.comparisonBounds(reference, fractional), result.bounds, 'Bounds cover every touched original pixel');
});

test('different source sizes use the original reference grid without reducing its coverage', async () => {
  const result = await core.compareRegions(image(128, 64), image(64, 32), full, options);
  assert.equal(result.width, 128); assert.equal(result.height, 64); assert.equal(result.validCount, 8192);
  assert.equal(result.meanDeltaE, 0); assert.equal(result.ssim, 1);
});

test('full-resolution computation yields and cancels without returning partial statistics', async () => {
  let cancelled = false, completed = false, yields = 0;
  await assert.rejects(core.compareRegions(image(256, 80), image(256, 80), full, {
    blockRows: 7, shouldCancel: () => cancelled,
    onProgress: p => { if (p.phase === 'complete') completed = true; if (p.phase === 'pixels') cancelled = true; },
    yieldTask: async () => { yields++; }
  }), { name: 'AbortError' });
  assert.equal(completed, false); assert.equal(yields, 1);
});
