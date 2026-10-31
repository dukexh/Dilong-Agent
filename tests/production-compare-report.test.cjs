'use strict';
// This fixture validates the production report generator and download-link setup.
// It does not prove that Chrome wrote a downloaded file to the user's disk.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { Blob } = require('node:buffer');
const core = require('../production-compare-core.js');

const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jQZkAAAAASUVORK5CYII=';
const quad = [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }, { x: 0, y: 1 }];

function image(actual) {
  const data = new Uint8ClampedArray(16 * 16 * 4);
  for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) {
    const rgb = !actual ? [120, 120, 120] : x >= 6 && x < 10 && y >= 6 && y < 10 ? [210, 60, 40] : [123, 121, 119];
    data.set([...rgb, 255], (y * 16 + x) * 4);
  }
  return { width: 16, height: 16, data };
}

function findNode(tree, predicate) {
  if (Array.isArray(tree)) {
    for (const child of tree) { const found = findNode(child, predicate); if (found) return found; }
    return null;
  }
  if (!tree || typeof tree !== 'object') return null;
  if (predicate(tree)) return tree;
  return findNode(tree.children, predicate);
}

function fixture({ hasResult = true, example = false, decodedWidth = 16, decodedHeight = 16 } = {}) {
  const reference = image(false), actual = image(true);
  const result = hasResult ? {
    ...core.analyze(reference, actual, 1), reference, actual,
    referenceUrl: PNG, actualUrl: PNG,
    createdAt: '2026-10-19T14:37:00.000Z',
    quads: [quad.map(p => ({ ...p })), quad.map(p => ({ ...p }))]
  } : null;
  const sample = '木纹 <img src=x onerror=alert(1)> & "样品"\' A/B';
  const batch = '批次 <B>&"2026"';
  const notes = '第一行 <script>window.pwned=1</script>\n第二行 & "引号" 和 \'单引号\'';
  const sources = [
    { name: '设计<A>&"图纸".png', width: 1600, height: 1600, pixels: reference, url: PNG, example },
    { name: '实物<B>&"照片".png', width: 2048, height: 2048, pixels: actual, url: PNG, example }
  ];
  const threshold = 7.5, review = '需要调整';
  // ProductionCompare hooks in their current declaration order. Child component
  // functions remain opaque React elements, so their hooks are not executed.
  const state = [sources, [quad, quad], [false, false], false, '', result,
    threshold, 50, 'pair', sample, batch, review, notes, null, null, null];
  let stateIndex = 0, refIndex = 0, childMode = false;
  const refs = [];
  const blobs = [], anchors = [], timers = [], appended = [], canvases = [];
  const React = {
    createElement(type, props, ...children) { return { type, props: props || {}, children }; },
    useState(initialValue) {
      if (childMode) return [initialValue, () => {}];
      assert.ok(stateIndex < state.length, 'Fixture must cover every component state hook');
      const index = stateIndex++;
      return [state[index], next => { state[index] = typeof next === 'function' ? next(state[index]) : next; }];
    },
    useRef(value) { if (childMode) return { current: value }; return refs[refIndex++] ||= { current: value }; },
    useMemo(factory) { return factory(); },
    useEffect(effect) { effect(); }
  };
  const document = {
    body: { appendChild(node) { appended.push(node); } },
    createElement(tag) {
      if (tag === 'canvas') {
        const canvas = {
          width: 0, height: 0, data: null,
          getContext() {
            return {
              putImageData(value) { canvas.data = value; },
              drawImage() {},
              fillRect() {},
              getImageData() {
                const data = new Uint8ClampedArray(canvas.width * canvas.height * 4);
                for (let i = 0; i < data.length; i += 4) data.set([120, 120, 120, 255], i);
                return { width: canvas.width, height: canvas.height, data };
              }
            };
          },
          toDataURL() { return PNG; }
        };
        canvases.push(canvas);
        return canvas;
      }
      if (tag === 'a') {
        const anchor = { href: '', download: '', clicked: false, removed: false,
          click() { this.clicked = true; }, remove() { this.removed = true; } };
        anchors.push(anchor);
        return anchor;
      }
      throw new Error('Unexpected fixture element: ' + tag);
    }
  };
  const sandbox = {
    window: { DilongCompareCore: core }, document, Blob, Uint8ClampedArray,
    FileReader: class FileReader {
      readAsDataURL() { this.result = PNG; Promise.resolve().then(() => this.onload()); }
    },
    Image: class Image {
      constructor() { this.naturalWidth = decodedWidth; this.naturalHeight = decodedHeight; }
      set src(value) { this.url = value; Promise.resolve().then(() => this.onload()); }
    },
    ImageData: class ImageData {
      constructor(data, width, height) {
        assert.equal(data.length, width * height * 4, 'ImageData dimensions must match its actual pixel buffer');
        this.data = data; this.width = width; this.height = height;
      }
    },
    URL: {
      createObjectURL(blob) { blobs.push(blob); return 'blob:report-fixture/' + blobs.length; },
      revokeObjectURL() {}
    },
    requestAnimationFrame(fn) { fn(); },
    setTimeout(fn, milliseconds) { if (milliseconds === 0) { fn(); return 0; } timers.push({ fn, milliseconds }); return timers.length; }
  };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../production-compare.js'), 'utf8'), sandbox, { filename: 'production-compare.js' });
  const Component = sandbox.window.DilongProductionCompare(React);
  const render = () => {
    stateIndex = 0; refIndex = 0;
    const tree = Component();
    assert.equal(stateIndex, state.length, 'Fixture hook order must match the production component');
    return tree;
  };
  const renderPanel = side => {
    const element = findNode(render(), node => typeof node.type === 'function' && node.props.side === side);
    childMode = true;
    try { return element.type(element.props); } finally { childMode = false; }
  };
  const tree = render();
  const button = findNode(tree, node => node.type === 'button' && node.children.includes('导出比对报告'));
  assert.ok(button, 'Report export button exists');
  const panels = [0, 1].map(side => findNode(tree, node => typeof node.type === 'function' && node.props.side === side && typeof node.props.onFile === 'function'));
  return { tree, render, renderPanel, button, panels, state, blobs, anchors, appended, timers, canvases, result, threshold, sample, batch, notes, review };
}

test('production report generation embeds actual metrics, current threshold, metadata and escaped text', async () => {
  const f = fixture();
  assert.equal(f.button.props.disabled, false);
  f.button.props.onClick();
  assert.equal(f.blobs.length, 1);
  assert.equal(f.blobs[0].type, 'text/html;charset=utf-8');
  const html = await f.blobs[0].text();
  assert.match(html, /^<!doctype html><html lang="zh-CN">/);
  assert.match(html, /<meta charset="utf-8">/);
  assert.ok(html.endsWith('</body></html>'));
  assert.match(html, /帝龙装饰纸 · 生产比对报告/);
  assert.match(html, /北京时间/);
  assert.match(html, /22:37:00/);
  const row = (label, value) => assert.ok(html.includes('<td>' + label + '</td><td>' + value + '</td>'), label + ' report value must match the fixture');
  row('平均图像色差 ΔE00', f.result.meanDeltaE.toFixed(2));
  row('RGB 平均偏差', f.result.meanRgbDifference.toFixed(2) + ' / 255');
  assert.match(html, /RGB 平均偏差 = 有效像素的 sqrt/);
  row('色差第95百分位 ΔE00', f.result.p95DeltaE.toFixed(2));
  row('纹理结构 SSIM', f.result.ssim.toFixed(4));
  row('人工结论', f.review);
  const currentArea = core.thresholdStats(f.result.deltaMap, f.result.validMask, f.threshold);
  assert.notEqual(currentArea, f.result.areaPercent, 'Changed threshold must exercise fresh area statistics');
  row('超阈值区域占比', currentArea.toFixed(1) + '%');
  assert.match(html, /图像色差 &gt; 7\.5/);
  assert.match(html, /黄色 7\.5 → 红色 ≥ 15\.0 ΔE00/);
  assert.match(html, /木纹 &lt;img src=x onerror=alert\(1\)&gt; &amp; &quot;样品&quot;&#39; A\/B/);
  assert.match(html, /批次 &lt;B&gt;&amp;&quot;2026&quot;/);
  assert.match(html, /第一行 &lt;script&gt;window\.pwned=1&lt;\/script&gt;\n第二行 &amp; &quot;引号&quot; 和 &#39;单引号&#39;/);
  assert.match(html, /设计&lt;A&gt;&amp;&quot;图纸&quot;\.png（1600×1600）/);
  assert.match(html, /实物&lt;B&gt;&amp;&quot;照片&quot;\.png（2048×2048）/);
  assert.match(html, /计算分辨率：16×16；覆盖像素位置：256；有效像素：256/);
  assert.match(html, /报告图片仅为缩略预览/);
  assert.match(html, /sRGB \/ D65 → CIELAB；CIEDE2000/);
  assert.match(html, /7×7窗口，K1=0\.01，K2=0\.03，data_range=255/);
  assert.match(html, /设计选区按原始整数像素取样/);
  assert.match(html, /尺寸不同时采用双线性重采样/);
  assert.match(html, /未经测色校准的图像比较/);
  assert.match(html, /归一化选区坐标（左上、右上、右下、左下）/);
  assert.match(html, /&quot;x&quot;: 1/);
  assert.match(html, /&quot;y&quot;: 0/);
  const imageSources = Array.from(html.matchAll(/<img src="([^"]+)"/g), match => match[1]);
  assert.equal(imageSources.length, 3);
  imageSources.forEach(src => assert.equal(src, PNG));
  assert.doesNotMatch(html, /<script\b/i);
  assert.doesNotMatch(html, /<link\b/i);
  assert.doesNotMatch(html, /(?:src|href)=["'](?:https?:)?\/\//i);
  assert.doesNotMatch(html, /演示样本：实物图由原图模拟/);
  assert.equal(f.canvases.length, 1, 'The current heatmap is generated for the report');
  assert.equal(f.canvases[0].data.width, 16);
  assert.equal(f.canvases[0].data.height, 16);
  assert.equal(f.anchors[0].href, 'blob:report-fixture/1');
  assert.equal(f.anchors[0].clicked, true, 'The browser download link is activated');
  assert.equal(f.anchors[0].removed, true);
  assert.equal(f.appended[0], f.anchors[0]);
  assert.match(f.anchors[0].download, /_比对报告\.html$/);
  assert.doesNotMatch(f.anchors[0].download, /[<>:"/\\|?*\x00-\x1f]/);
  assert.equal(f.timers[0].milliseconds, 30000, 'Blob URL is kept alive while the browser begins downloading');
});

test('demonstration report explicitly identifies its simulated sample origin', async () => {
  const f = fixture({ example: true });
  f.button.props.onClick();
  const html = await f.blobs[0].text();
  assert.match(html, /本次包含演示样本/);
  assert.match(html, /模拟生产图含人为偏色与局部变化/);
  assert.match(html, /指标均根据当前两图实际计算/);
});

test('report export stays disabled and produces no Blob until a current analysis exists', () => {
  const f = fixture({ hasResult: false });
  assert.equal(f.button.props.disabled, true);
  // A defensive direct call must also avoid emitting a stale or empty report.
  f.button.props.onClick();
  assert.equal(f.blobs.length, 0);
  assert.equal(f.anchors.length, 0);
  assert.equal(f.canvases.length, 0);
});

test('upload rejects unsupported extensions and oversized files with visible errors and invalidates old results', async () => {
  const unsupported = fixture();
  await unsupported.panels[0].props.onFile({ name: '原图.pdf', size: 100 });
  assert.match(unsupported.state[4], /请选择 JPG、PNG 或 WebP 图片/);
  assert.equal(unsupported.state[5], null, 'An attempted replacement invalidates the previous result');
  assert.equal(unsupported.state[11], '未判定', 'The previous manual decision is reset');
  assert.deepEqual(Array.from(unsupported.state[2]), [false, false]);
  const oversized = fixture();
  await oversized.panels[1].props.onFile({ name: '实物.png', size: 30 * 1024 * 1024 + 1 });
  assert.match(oversized.state[4], /图片超过 30 MB/);
  assert.equal(oversized.state[5], null);
  assert.deepEqual(Array.from(oversized.state[2]), [false, false]);
});

test('accepted local image follows FileReader/Image/canvas upload flow and resets both selections', async () => {
  // Browser image decoding is mocked; this checks component state transitions,
  // not Chrome's file-picker permission or the actual disk file decoding.
  const f = fixture();
  const previousActual = f.state[0][1];
  await f.panels[0].props.onFile({ name: '新的设计.png', size: 128 });
  assert.equal(f.state[0][0].name, '新的设计.png');
  assert.equal(f.state[0][0].example, false);
  assert.equal(f.state[0][0].pixels.width, 16);
  assert.equal(f.state[0][0].pixels.height, 16);
  assert.equal(f.state[0][1], previousActual, 'Uploading the reference preserves the other source');
  assert.equal(f.state[5], null);
  assert.equal(f.state[4], '');
  assert.deepEqual(Array.from(f.state[2]), [false, false]);
  assert.equal(JSON.stringify(f.state[1][0]), JSON.stringify(quad));
});

test('upload preserves decoded original pixels above 2048 instead of replacing them with its preview', async () => {
  const f = fixture({ decodedWidth: 3000, decodedHeight: 32 });
  await f.panels[0].props.onFile({ name: '原始分辨率.png', size: 1024 });
  assert.equal(f.state[0][0].width, 3000);
  assert.equal(f.state[0][0].pixels.width, 3000);
  assert.equal(f.state[0][0].pixels.height, 32);
  assert.equal(f.state[0][0].pixels.data.length, 3000 * 32 * 4);
});

test('analysis and report use complete reference dimensions above the former 512 limit', async () => {
  const f = fixture({ hasResult: false });
  const pixels = { width: 2600, height: 32, data: new Uint8ClampedArray(2600 * 32 * 4) };
  for (let i = 0; i < pixels.data.length; i += 4) pixels.data.set([120, 120, 120, 255], i);
  f.state[0] = f.state[0].map(source => ({ ...source, width: 2600, height: 32, pixels }));
  await buttonNamed(f.render(), '确认对齐并分析').props.onClick();
  assert.equal(f.state[4], '');
  assert.equal(f.state[5].width, 2600); assert.equal(f.state[5].height, 32);
  assert.equal(f.state[5].validCount, 83200); assert.equal(f.state[3], false); assert.equal(f.state[14], null);
  buttonNamed(f.render(), '导出比对报告').props.onClick();
  const html = await f.blobs[0].text();
  assert.match(html, /计算分辨率：2600×32/); assert.match(html, /有效像素：83200/);
});

const normalized = value => JSON.parse(JSON.stringify(value));
const buttonNamed = (tree, name) => findNode(tree, node => node.type === 'button' && node.children.includes(name));
const panelElement = (f, side) => findNode(f.render(), node => typeof node.type === 'function' && node.props.side === side);
const sliderNode = (f, name) => findNode(f.render(), node => node.type === 'input' && node.props['aria-label'] === name);
const crop = [{ x: .1, y: .2 }, { x: .8, y: .2 }, { x: .8, y: .6 }, { x: .1, y: .6 }];

test('reference crop and coordinate editing synchronize normalized positions across different image sizes', () => {
  const f = fixture();
  f.state[0][1] = { ...f.state[0][1], width: 2400, height: 1200, pixels: { width: 64, height: 32 } };
  panelElement(f, 0).props.onQuad(crop);
  assert.deepEqual(normalized(f.state[1]), [crop, crop]);
  assert.notEqual(f.state[1][0], f.state[1][1], 'The linked selections do not share mutable point objects');
  assert.notEqual(f.state[1][0][0], f.state[1][1][0]);
  assert.equal(f.state[5], null);
  assert.equal(f.state[11], '未判定');
  const xInput = findNode(f.renderPanel(0), node => node.props['aria-label'] === '原图角点1X百分比');
  xInput.props.onChange({ target: { value: '25' } });
  assert.equal(f.state[1][0][0].x, .25);
  assert.deepEqual(normalized(f.state[1][0]), normalized(f.state[1][1]));
  buttonNamed(f.renderPanel(0), '使用整张图片').props.onClick();
  assert.deepEqual(normalized(f.state[1]), [quad, quad]);
});

test('actual selection is always read-only with no manual selection controls or unlink switch', () => {
  const f = fixture();
  f.state[13] = { x: 5, y: 5, value: 1 };
  const right = f.renderPanel(1);
  assert.equal(findNode(right, node => node.type === 'input' && node.props.type === 'number'), null);
  assert.equal(buttonNamed(right, '使用整张图片'), null);
  assert.equal(buttonNamed(right, '手动调整实物区域'), null);
  assert.equal(buttonNamed(right, '重新选四角'), null);
  assert.equal(findNode(f.render(), node => node.props.role === 'switch'), null);
  assert.ok(buttonNamed(right, '更换图片'), 'The actual image can still be replaced');
  panelElement(f, 1).props.onQuad(crop);
  assert.deepEqual(normalized(f.state[1]), [quad, quad]);
  assert.equal(f.state[5], f.result);
  const svg = findNode(right, node => node.type === 'svg' && node.props['aria-disabled']);
  svg.props.onPointerDown({});
  svg.props.onPointerMove({});
  assert.deepEqual(normalized(f.state[1]), [quad, quad]);
  assert.equal(f.state[13].value, 1);
  panelElement(f, 0).props.onQuad(crop);
  assert.deepEqual(normalized(f.state[1]), [crop, crop]);
  assert.equal(f.state[5], null);
  assert.equal(f.state[13], null);
  assert.equal(f.state[11], '未判定');
});

test('reset, source replacement and demo restore both full images and keep synchronization active', async () => {
  const f = fixture();
  f.state[1] = [crop, crop];
  buttonNamed(f.render(), '重置两侧选区').props.onClick();
  assert.deepEqual(normalized(f.state[1]), [quad, quad]);
  f.state[1] = [crop, crop];
  await panelElement(f, 1).props.onFile({ name: 'replacement.png', size: 100 });
  assert.deepEqual(normalized(f.state[1]), [quad, quad]);
  assert.equal(f.state[5], null);
  await buttonNamed(f.render(), '载入演示样本').props.onClick();
  assert.deepEqual(normalized(f.state[1]), [quad, quad]);
  assert.equal(f.state[0][0].example, true);
  assert.equal(f.state[0][1].example, true);
  panelElement(f, 0).props.onQuad(crop);
  assert.deepEqual(normalized(f.state[1]), [crop, crop]);
});

test('loading either image or analyzing blocks selection edits and image replacement on both sides', () => {
  for (const calculating of [false, true]) {
    const f = fixture();
    if (calculating) f.state[3] = true; else f.state[2] = [true, false];
    panelElement(f, 0).props.onQuad(crop);
    buttonNamed(f.render(), '重置两侧选区').props.onClick();
    assert.deepEqual(normalized(f.state[1]), [quad, quad]);
    for (const side of [0, 1]) {
      const panel = f.renderPanel(side);
      if (side === 0) {
        assert.equal(buttonNamed(panel, '使用整张图片').props.disabled, true);
        assert.equal(findNode(panel, node => node.type === 'input' && node.props.type === 'number').props.disabled, true);
      }
      assert.equal(findNode(panel, node => node.type === 'svg' && node.props['aria-disabled']).props['aria-disabled'], true);
      assert.equal(buttonNamed(panel, '更换图片').props.disabled, true);
    }
  }
});

test('mode-specific sliders keep values, selections, metrics and review across tab changes', () => {
  const f = fixture();
  const selections = f.state[1], result = f.state[5];
  const selectTab = name => findNode(f.render(), node => node.props.role === 'tab' && node.children.includes(name)).props.onClick();
  assert.equal(sliderNode(f, '叠加透明度'), null);
  assert.equal(sliderNode(f, '差异显示阈值'), null);
  selectTab('透明叠加');
  assert.equal(sliderNode(f, '叠加透明度').props.value, 50);
  assert.equal(sliderNode(f, '差异显示阈值'), null);
  sliderNode(f, '叠加透明度').props.onChange({ target: { value: '80' } });
  selectTab('色差热图');
  assert.equal(sliderNode(f, '叠加透明度'), null);
  const threshold = sliderNode(f, '差异显示阈值');
  assert.equal(threshold.props.min, 1); assert.equal(threshold.props.max, 20); assert.equal(threshold.props.step, .5);
  threshold.props.onChange({ target: { value: '2.5' } });
  const tree = f.render();
  const summary = JSON.stringify(findNode(tree, node => node.props.className === 'summary-strip'));
  const biasCard = findNode(tree, node => node.props['aria-label'] === '查看平均偏色方向的公式与本次结果');
  const direction = findNode(biasCard, node => node.type === 'strong').children[0];
  assert.ok(summary.includes('平均偏色方向'));
  assert.ok(summary.includes(direction), 'Summary direction must agree with the 04 result card');
  assert.ok(!summary.includes('超阈值区域占比'));
  selectTab('并排对照'); selectTab('透明叠加');
  assert.equal(sliderNode(f, '叠加透明度').props.value, 80);
  selectTab('色差热图');
  assert.equal(sliderNode(f, '差异显示阈值').props.value, 2.5);
  assert.equal(f.state[5], result);
  assert.equal(f.state[1], selections);
  assert.equal(f.state[11], '需要调整');
});
