'use strict';
const { chromium } = require(process.env.DILONG_PLAYWRIGHT || 'playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');

(async () => {
  const root = path.resolve(__dirname, '..');
  const out = fs.mkdtempSync(path.join(os.tmpdir(), 'dilong-images-'));
  const server = http.createServer((req, res) => {
    const pathname = decodeURIComponent(req.url.split('?')[0]);
    const file = path.join(root, pathname === '/' ? 'index.html' : pathname);
    fs.readFile(file, (error, data) => {
      if (error) { res.writeHead(404); res.end(); return; }
      const ext = path.extname(file);
      res.setHeader('Content-Type', ({ '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css' })[ext] || 'application/octet-stream');
      res.end(data);
    });
  });
  let browser;
  const errors = [];
  try {
    await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
    const base = `http://127.0.0.1:${server.address().port}/index.html`;
    browser = await chromium.launch({ channel: 'chrome', headless: true });
    const page = await browser.newPage({ acceptDownloads: true });
    page.setDefaultTimeout(10000);
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(base);
    await page.evaluate(() => window.DilongStage1.ready);
    await page.waitForFunction(() => window.DilongStage1.operations.ink?.state === 'ready');

    const saved = await page.evaluate(async () => {
      const S = window.DilongStage1;
      const NativeImage = window.Image;
      const nativeEncode = HTMLCanvasElement.prototype.toDataURL;
      const load = src => new Promise((resolve, reject) => {
        const im = new NativeImage(); im.onload = () => resolve(im); im.onerror = reject; im.src = src;
      });
      const pixels = async src => {
        const im = await load(src), c = document.createElement('canvas');
        c.width = im.naturalWidth; c.height = im.naturalHeight;
        const ctx = c.getContext('2d'); ctx.drawImage(im, 0, 0);
        return ctx.getImageData(0, 0, c.width, c.height).data;
      };
      const normalize = async src => {
        const im = await load(src), c = document.createElement('canvas');
        c.width = im.naturalWidth; c.height = im.naturalHeight;
        c.getContext('2d').drawImage(im, 0, 0);
        return c.toDataURL('image/png');
      };
      const analysisFields = (summary, result) => ({
        ...summary, layerCount: result.layers.length,
        averageHex: '#' + Object.values(summary.averageRgb).map(n => n.toString(16).padStart(2, '0')).join(''),
        reconstructionDifference: result.difference,
        layers: result.layers.map((layer, i) => ({ order: i + 1, name: layer.name, hex: layer.hex, rgb: layer.rgb, coverage: layer.share, recipe: layer.recipe }))
      });
      const fixtures = [
        { name: 'transparent.png', width: 960, height: 640, type: 'image/png', transparent: true },
        { name: 'photo.jpg', width: 1000, height: 700, type: 'image/jpeg' },
        { name: 'portrait.webp', width: 640, height: 960, type: 'image/webp' },
        { name: 'small.png', width: 117, height: 61, type: 'image/png', transparent: true }
      ];
      const results = [];
      for (const fixture of fixtures) {
        const c = document.createElement('canvas'); c.width = fixture.width; c.height = fixture.height;
        const ctx = c.getContext('2d'), data = ctx.createImageData(c.width, c.height);
        for (let y = 0; y < c.height; y++) for (let x = 0; x < c.width; x++) {
          const i = (y * c.width + x) * 4;
          data.data[i] = (x * 3 + y * 7) % 256;
          data.data[i + 1] = (x * 11 + y * 5) % 256;
          data.data[i + 2] = (x + y * 13) % 256;
          data.data[i + 3] = fixture.transparent && x < 30 ? x % 3 * 100 : 255;
        }
        ctx.putImageData(data, 0, 0);
        const src = c.toDataURL(fixture.type, .88), canonical = await normalize(src);
        // Reference the existing URL-based algorithms and full-resolution PNG
        // normalization, so using a thumbnail or a different color path fails.
        const expected = analysisFields(await S.analyze(canonical), S.analyzeFull(await load(canonical)));
        const counts = { decodes: 0, fullSizeEncodes: 0 };
        window.Image = new Proxy(NativeImage, { construct(target, args) { counts.decodes++; return Reflect.construct(target, args); } });
        HTMLCanvasElement.prototype.toDataURL = function (...args) {
          if (this.width === fixture.width && this.height === fixture.height) counts.fullSizeEncodes++;
          return nativeEncode.apply(this, args);
        };
        let record;
        try { record = await S.save(src, fixture.name, '图片回归', {}, fixture.name); }
        finally { window.Image = NativeImage; HTMLCanvasElement.prototype.toDataURL = nativeEncode; }
        const { algorithmVersion, analysedAt, ...analysis } = record.analysis;
        const originalPixels = await pixels(record.imageUrl), expectedPixels = await pixels(canonical);
        const thumb = await load(record.thumbnailUrl);
        results.push({ name: fixture.name, counts, expected, analysis, algorithmVersion,
          exactPixels: originalPixels.length === expectedPixels.length && originalPixels.every((v, i) => v === expectedPixels[i]),
          fullSize: [(await load(record.imageUrl)).naturalWidth, (await load(record.imageUrl)).naturalHeight],
          thumbSize: [thumb.naturalWidth, thumb.naturalHeight],
          thumbIsOriginal: record.thumbnailUrl === record.imageUrl,
          originalUrlLength: record.imageUrl.length, thumbnailUrlLength: record.thumbnailUrl.length });
        if (fixture.type === 'image/jpeg') window.imageTestLegacySource = src;
      }
      window.imageTestPixels = pixels;
      window.imageTestRecords = S.assets;
      window.imageTestEncodings = [];
      window.Image = new Proxy(NativeImage, { construct(target, args) { window.imageTestEncodings.push('decode'); return Reflect.construct(target, args); } });
      HTMLCanvasElement.prototype.toDataURL = function (...args) { window.imageTestEncodings.push('encode'); return nativeEncode.apply(this, args); };
      window.imageTestRestore = () => { window.Image = NativeImage; HTMLCanvasElement.prototype.toDataURL = nativeEncode; };
      const createURL = URL.createObjectURL;
      URL.createObjectURL = function (blob) {
        if (blob.type === 'application/zip') window.imageTestZip = blob;
        return createURL.call(this, blob);
      };
      return results;
    });
    for (const record of saved) {
      assert.deepEqual(record.analysis, record.expected, record.name + ': all analysis and recipe fields');
      assert.equal(record.algorithmVersion, 'dilong-color-v0.3');
      assert(record.exactPixels, record.name + ': original RGBA pixels');
      assert.equal(record.counts.decodes, 2, record.name + ': source and normalized PNG decoded once each');
      if (record.name === 'small.png') {
        assert(record.thumbIsOriginal, 'small images need no extra thumbnail encoding');
        assert.deepEqual(record.thumbSize, [117, 61]);
      } else {
        assert.equal(record.counts.fullSizeEncodes, 1, 'one full-size PNG normalization');
        assert.equal(Math.max(...record.thumbSize), 640);
        assert(record.thumbSize[0] * record.thumbSize[1] < record.fullSize[0] * record.fullSize[1]);
      }
    }

    const downloadEvent = page.waitForEvent('download');
    await page.evaluate(() => window.DilongStage1.exportPackage());
    const zipPath = path.join(out, 'samples.zip');
    await (await downloadEvent).saveAs(zipPath);
    assert.deepEqual(await page.evaluate(() => window.imageTestEncodings), [], 'PNG export needs no image decode or canvas encode');
    const exportResult = await page.evaluate(async () => {
      imageTestRestore();
      const S = window.DilongStage1, files = await S.unzip(await imageTestZip.arrayBuffer());
      const manifest = JSON.parse(new TextDecoder().decode(files.get('manifest.json')));
      const exact = [];
      for (const [i, sample] of manifest.samples.entries()) {
        const original = new Uint8Array(await (await fetch(S.assets[i].imageUrl)).arrayBuffer());
        const exported = files.get(sample.image);
        exact.push(exported.length === original.length && exported.every((v, n) => v === original[n]));
      }
      return { schemaVersion: manifest.schemaVersion, images: manifest.samples.map(s => s.image), exact };
    });
    assert.equal(exportResult.schemaVersion, 1);
    assert.deepEqual(exportResult.exact, saved.map(() => true));
    assert(exportResult.images.every(name => name.endsWith('.png')));

    await page.evaluate(() => {
      const S = window.DilongStage1;
      S.assets = [{ ...S.assets[0], id: 'LEGACY-JPEG', imageUrl: imageTestLegacySource }];
    });
    const legacyDownload = page.waitForEvent('download');
    await page.evaluate(() => window.DilongStage1.exportPackage());
    await (await legacyDownload).saveAs(path.join(out, 'legacy.zip'));
    assert(await page.evaluate(async () => {
      const files = await DilongStage1.unzip(await imageTestZip.arrayBuffer());
      const bytes = files.get('images/0.png');
      const url = URL.createObjectURL(new Blob([bytes], { type: 'image/png' }));
      try {
        const actual = await imageTestPixels(url), expected = await imageTestPixels(imageTestLegacySource);
        return actual.length === expected.length && actual.every((v, i) => v === expected[i]);
      } finally { URL.revokeObjectURL(url); DilongStage1.assets = imageTestRecords; }
    }), 'legacy non-PNG records still export original-resolution PNG pixels');

    const legacyAnalyzer = await page.evaluate(async () => {
      const S = DilongStage1, analyze = S.analyze, source = S.assets[1];
      S.analyze = url => {
        if (typeof url !== 'string') throw Error('OLDER_HTML_REQUIRES_URL');
        return analyze(url);
      };
      try {
        const record = await S.save(source.imageUrl, '旧版页面兼容', '图片回归');
        const fields = ({ analysedAt, ...analysis }) => analysis;
        return { expected: fields(source.analysis), actual: fields(record.analysis) };
      } finally { S.analyze = analyze; }
    });
    assert.deepEqual(legacyAnalyzer.actual, legacyAnalyzer.expected, 'cached older HTML keeps its URL-based analyzer contract');
    const thumbnailFailure = await page.evaluate(async () => {
      const S = DilongStage1, encode = HTMLCanvasElement.prototype.toDataURL, source = S.assets[1];
      let failures = 0;
      HTMLCanvasElement.prototype.toDataURL = function (...args) {
        if (Math.max(this.width, this.height) === 640) { failures++; throw Error('THUMBNAIL_ENCODING_FAILURE'); }
        return encode.apply(this, args);
      };
      try {
        const record = await S.save(source.imageUrl, '缩略图失败回退', '图片回归');
        const fields = ({ analysedAt, ...analysis }) => analysis;
        return { failures, fallback: record.thumbnailUrl === record.imageUrl, expected: fields(source.analysis), actual: fields(record.analysis) };
      } finally { HTMLCanvasElement.prototype.toDataURL = encode; }
    });
    assert.equal(thumbnailFailure.failures, 1);
    assert(thumbnailFailure.fallback, 'thumbnail encoding failure keeps the full-resolution preview');
    assert.deepEqual(thumbnailFailure.actual, thumbnailFailure.expected);
    assert(await page.evaluate(async () => {
      const S = DilongStage1, count = S.assets.length;
      const blank = document.createElement('canvas'); blank.width = 16; blank.height = 16;
      for (const src of ['data:image/png;base64,bm90LWFuLWltYWdl', blank.toDataURL('image/png')]) {
        try { await S.save(src, '无效图片', '图片回归'); return false; }
        catch (_) { if (S.assets.length !== count || S.operations.save?.state !== 'error') return false; }
      }
      return true;
    }), 'broken and fully transparent images never create a saved sample');

    const context = await browser.newContext();
    const importedPage = await context.newPage();
    importedPage.on('pageerror', error => errors.push(error.message));
    await importedPage.goto(base);
    await importedPage.evaluate(() => window.DilongStage1.ready);
    await importedPage.waitForFunction(() => window.DilongStage1.operations.ink?.state === 'ready');
    const rows = await importedPage.evaluate(async bytes => {
      const S = window.DilongStage1, OriginalImage = window.Image;
      let decodes = 0;
      window.Image = new Proxy(OriginalImage, { construct(target, args) { decodes++; return Reflect.construct(target, args); } });
      let rows;
      try { rows = await S.previewPackage(new File([new Uint8Array(bytes)], 'samples.zip')); }
      finally { window.Image = OriginalImage; }
      await S.commitPackage(rows);
      return { decodes, rows: rows.map(r => ({ state: r.state, analysis: r.record.analysis, name: r.record.name })) };
    }, [...fs.readFileSync(zipPath)]);
    assert.equal(rows.decodes, saved.length * 2, 'import decodes each source and normalized PNG only once');
    for (const [i, row] of rows.rows.entries()) {
      assert.equal(row.state, '有效');
      const { algorithmVersion, analysedAt, ...analysis } = row.analysis;
      assert.deepEqual(analysis, saved[i].analysis, row.name + ': ZIP round-trip analysis');
    }
    const beforeReload = await importedPage.evaluate(() => DilongStage1.assets.map(a => ({ id: a.id, imageUrl: a.imageUrl, thumbnailUrl: a.thumbnailUrl })).sort((a, b) => a.id.localeCompare(b.id)));
    await importedPage.reload();
    await importedPage.evaluate(() => DilongStage1.ready);
    assert.deepEqual(await importedPage.evaluate(() => DilongStage1.assets.map(a => ({ id: a.id, imageUrl: a.imageUrl, thumbnailUrl: a.thumbnailUrl })).sort((a, b) => a.id.localeCompare(b.id))), beforeReload, 'originals and thumbnails survive IndexedDB reload');
    const preview = await page.evaluate(async () => {
      const S = DilongStage1, sample = S.assets[0];
      const task = await S.beginDesignTask({ runKey: 'image-preview-test', mode: 'generate',
        input: { kind: 'library', sampleId: sample.id, name: sample.name },
        parameters: { direction: '图片回归' } });
      await S.save(sample.imageUrl, sample.name, sample.source, sample.parameters, sample.sourceKey, task.id);
      S.openTask(S.tasks.find(t => t.id === task.id));
      return { original: sample.imageUrl, thumbnail: sample.thumbnailUrl };
    });
    const candidate = page.locator('.task-saved-results .candidate-preview-trigger');
    await candidate.waitFor({ state: 'visible' });
    assert.equal(await candidate.locator('img').getAttribute('src'), preview.thumbnail);
    await candidate.click();
    const enlarged = page.locator('.candidate-preview-dialog img');
    await enlarged.waitFor({ state: 'visible' });
    assert.equal(await enlarged.getAttribute('src'), preview.original, 'enlarging a thumbnail always opens the original');
    await page.waitForFunction(() => document.querySelector('.candidate-preview-dialog img')?.naturalWidth === 960);
    assert.deepEqual(errors, []);
    fs.writeFileSync(path.join(out, 'results.json'), JSON.stringify({ saved, exportResult, importDecodes: rows.decodes }, null, 2));
    console.log('PASS PNG/JPEG/WebP/透明图：像素与配方一致、各两次解码、PNG原字节导出、旧格式/旧页面兼容、坏图拒绝、缩略图失败回退、IndexedDB恢复及任务缩略图放大原图；输出 ' + out);
  } finally {
    if (browser) await browser.close();
    await new Promise(resolve => server.close(resolve));
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
