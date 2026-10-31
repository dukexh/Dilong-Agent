(function () {
  'use strict';
  window.DilongProductionCompare = function createProductionCompare(React) {
    const h = React.createElement;
    const { useState, useRef, useMemo, useEffect } = React;
    const fullQuad = () => [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }, { x: 0, y: 1 }];
    const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
    const num = (v, digits = 2) => Number.isFinite(v) ? v.toFixed(digits) : '—';
    const signed = v => (v > 0 ? '+' : '') + num(v);
    const escape = v => String(v == null ? '' : v).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    const frame = () => new Promise(resolve => requestAnimationFrame(() => setTimeout(resolve, 0)));
    function icon(name, size = 20) {
      const paths = {
        upload: 'M12 16V4m-4 4 4-4 4 4M4 16v4h16v-4',
        compare: 'M4 4h6v16H4zM14 4h6v16h-6zM7 9v6m10-6v6',
        download: 'M12 3v12m-4-4 4 4 4-4M4 17v4h16v-4',
        check: 'm5 12 4 4L19 6',
        info: 'M12 11v6m0-10v1M22 12a10 10 0 1 1-20 0 10 10 0 0 1 20 0',
        image: 'M3 3h18v18H3zM3 16l6-6 5 5 3-3 4 4M16 7h.01',
        arrow: 'm9 5 7 7-7 7'
      };
      return h('svg', { width: size, height: size, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 1.6, strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': true }, h('path', { d: paths[name] || paths.compare }));
    }
    function button(text, onClick, options = {}) {
      return h('button', { type: 'button', className: 'pc-button ' + (options.className || ''), onClick, disabled: options.disabled, title: options.title }, options.icon && icon(options.icon, 15), text);
    }
    function header(step, title, desc, trailing) {
      return h('div', { className: 'panel-header' }, h('div', null, h('span', { className: 'step-no' }, step), h('div', null, h('h2', null, title), h('p', null, desc))), trailing);
    }
    function canvasOf(image) {
      const c = document.createElement('canvas'); c.width = image.width; c.height = image.height;
      c.getContext('2d').putImageData(new ImageData(new Uint8ClampedArray(image.data), image.width, image.height), 0, 0);
      return c;
    }
    function imageAsset(url, name, example = false) {
      return new Promise((resolve, reject) => {
        const img = new Image();
        img.onload = () => {
          try {
            if (img.naturalWidth * img.naturalHeight > 40000000) throw new Error('图片超过 4000 万像素，请先缩小后再上传。');
            const c = document.createElement('canvas'); c.width = img.naturalWidth; c.height = img.naturalHeight;
            const ctx = c.getContext('2d', { willReadFrequently: true }); ctx.drawImage(img, 0, 0, c.width, c.height);
            const pixels = ctx.getImageData(0, 0, c.width, c.height);
            const scale = Math.min(1, 2048 / Math.max(c.width, c.height));
            const preview = document.createElement('canvas'); preview.width = Math.max(1, Math.round(c.width * scale)); preview.height = Math.max(1, Math.round(c.height * scale));
            preview.getContext('2d').drawImage(c, 0, 0, preview.width, preview.height);
            const url = preview.toDataURL('image/png'); c.width = 0; c.height = 0; preview.width = 0; preview.height = 0;
            if (!url.startsWith('data:image/')) throw new Error('浏览器无法读取这张图片的完整尺寸，请使用尺寸更小的图片。');
            resolve({ name, url, pixels, width: img.naturalWidth, height: img.naturalHeight, example });
          } catch (err) { reject(err); }
        };
        img.onerror = () => reject(new Error('图片无法读取，请使用有效的 JPG、PNG 或 WebP 图片。'));
        img.src = url;
      });
    }
    function fileAsset(file) {
      if (!/\.(jpe?g|png|webp)$/i.test(file.name)) return Promise.reject(new Error('请选择 JPG、PNG 或 WebP 图片。'));
      if (file.size > 30 * 1024 * 1024) return Promise.reject(new Error('图片超过 30 MB，请先压缩后再上传。'));
      return new Promise((resolve, reject) => {
        const reader = new FileReader(); reader.onerror = () => reject(new Error('无法读取文件，请重新选择。'));
        reader.onload = () => imageAsset(reader.result, file.name).then(resolve, reject); reader.readAsDataURL(file);
      });
    }
    function heatImage(result, threshold) {
      if (!result) return '';
      const data = new Uint8ClampedArray(result.reference.data);
      const deltaMap = result.previewDeltaMap || result.deltaMap, validMask = result.previewValidMask || result.validMask;
      for (let i = 0; i < deltaMap.length; i++) {
        if (!validMask[i]) { data[i * 4 + 3] = 0; continue; }
        const t = clamp(deltaMap[i] / (2 * threshold), 0, 1);
        const low = [39, 104, 112], mid = [240, 194, 81], high = [197, 69, 46];
        const a = t <= .5 ? low : mid, b = t <= .5 ? mid : high, k = t <= .5 ? t * 2 : (t - .5) * 2;
        const blend = .2 + .65 * Math.min(1, t * 2);
        for (let j = 0; j < 3; j++) data[i * 4 + j] = data[i * 4 + j] * (1 - blend) + (a[j] + (b[j] - a[j]) * k) * blend;
      }
      return canvasOf({ width: result.reference.width, height: result.reference.height, data }).toDataURL('image/png');
    }
    function biasText(result) {
      return [[result.deltaL, '偏亮', '偏暗'], [result.deltaA, '偏红', '偏绿'], [result.deltaB, '偏黄', '偏蓝']]
        .map(([v, pos, neg]) => Math.abs(v) < .5 ? null : (v > 0 ? pos : neg)).filter(Boolean).join('、') || '平均偏色方向不明显';
    }
    const metricLabels = { delta: '颜色偏差 · ΔE00', rgb: '图像偏差 · RGB', ssim: '纹理结构 · SSIM', bias: '平均偏色方向' };
    function labFormula() {
      return h('details', { className: 'pc-formula-more' }, h('summary', null, '查看 RGB → Lab 转换公式'),
        h('pre', null, 'v = RGB通道值 / 255\nc = v / 12.92                         （v ≤ 0.04045）\nc = ((v + 0.055) / 1.055)^2.4         （其他情况）\n\nX = 0.4124564r + 0.3575761g + 0.1804375b\nY = 0.2126729r + 0.7151522g + 0.0721750b\nZ = 0.0193339r + 0.1191920g + 0.9503041b\nx = X / 0.95047；y = Y；z = Z / 1.08883\n\nf(t) = ∛t                             （t > 216/24389）\nf(t) = ((24389/27)t + 16) / 116        （其他情况）\nL* = 116f(y) − 16\na* = 500(f(x) − f(y))\nb* = 200(f(y) − f(z))'), h('p', null, 'r、g、b 为线性化后的 sRGB 通道，白点采用 D65。两张图分别转换，不做自动调色或亮度归一化。'));
    }
    function metricExplanation(kind, result) {
      const formula = text => h('pre', { className: 'pc-formula' }, text);
      const rows = entries => h('dl', { className: 'pc-calculation-values' }, entries.map(([label, value]) => h('div', { key: label }, h('dt', null, label), h('dd', null, value))));
      const context = result ? '本次计算网格 ' + result.width + ' × ' + result.height + '；有效像素 N = ' + result.validCount.toLocaleString('zh-CN') + '。透明度小于 250/255 的对应位置不参与计算。' : '尚未完成本次分析。上传两张图片并点击“确认对齐并分析”后，这里会显示本次实际结果。';
      let body;
      if (kind === 'rgb') body = h('div', null,
        h('p', null, '逐像素比较设计图与实物图的 RGB 值。与配墨页“合成偏差”使用相同的距离公式；此处只统计两图有效像素。'),
        formula('dᵢ = √[(R实物ᵢ − R设计ᵢ)² + (G实物ᵢ − G设计ᵢ)² + (B实物ᵢ − B设计ᵢ)²] / √3\nRGB 平均偏差 = (d₁ + d₂ + … + dₙ) / N'),
        result && rows([['有效像素 N', result.validCount.toLocaleString('zh-CN')], ['本次 RGB 平均偏差', num(result.meanRgbDifference) + ' / 255']]),
        h('p', null, '范围 0—255，0 表示有效位置的 RGB 完全一致。这里是先算每个像素的距离，再取平均，不是先取整张图的平均颜色，也不是百分比。'));
      else if (kind === 'ssim') body = h('div', null,
        h('p', null, '先把对应像素转换为灰度，在每个完整有效的 7 × 7 窗口中比较明暗、对比度和结构，再对窗口结果取平均。'),
        formula('Y = 0.2126R + 0.7152G + 0.0722B\nμx = Σx / 49；μy = Σy / 49\nσx² = Σ(x − μx)² / 48；σy² = Σ(y − μy)² / 48\nσxy = Σ[(x − μx)(y − μy)] / 48\n\nSSIM窗口 = [(2μxμy + C₁)(2σxy + C₂)] / [(μx² + μy² + C₁)(σx² + σy² + C₂)]\nC₁ = (0.01 × 255)²；C₂ = (0.03 × 255)²\n本次 SSIM = 所有有效窗口 SSIM 的总和 / M'),
        result && rows([['有效窗口 M', result.ssimWindowCount.toLocaleString('zh-CN')], ['本次 SSIM', num(result.ssim, 4)]]),
        h('p', null, '窗口步长为 1，含无效像素的窗口跳过，边缘不补像素。灰度直接由 0—255 的 RGB 加权，不先做 sRGB 线性化。结果越接近 1，结构越接近；拍摄明暗和位置偏移也会影响它。'));
      else if (kind === 'bias') body = h('div', null,
        h('p', null, '两图分别转换为 Lab，对每个有效位置计算“实物减设计”，最后分别汇总三个方向的平均差。'),
        formula('平均 ΔL* = Σ(L*实物ᵢ − L*设计ᵢ) / N\n平均 Δa* = Σ(a*实物ᵢ − a*设计ᵢ) / N\n平均 Δb* = Σ(b*实物ᵢ − b*设计ᵢ) / N'),
        result && rows([['本次平均 ΔL*', signed(result.deltaL)], ['本次平均 Δa*', signed(result.deltaA)], ['本次平均 Δb*', signed(result.deltaB)], ['方向说明', biasText(result)]]),
        h('p', null, 'ΔL* 正数偏亮、负数偏暗；Δa* 正数偏红、负数偏绿；Δb* 正数偏黄、负数偏蓝。方向文字仅显示绝对值达到 0.5 的分量；小于 0.5 的值仍参与数值展示。不同位置的正负偏差可能相互抵消。'), labFormula());
      else body = h('div', null,
        h('p', null, '先将两图对应像素从 sRGB 转为 Lab，再按 CIEDE2000 计算每个像素的 ΔE00。参数 kL、kC、kH 均为 1。'),
        formula('ΔE00ᵢ = √[(ΔL′/S_L)² + (ΔC′/S_C)² + (ΔH′/S_H)² + R_T(ΔC′/S_C)(ΔH′/S_H)]\n平均 ΔE00 = ΣΔE00ᵢ / N\n\nP95：将 N 个有效色差升序排列为 d[0]…d[N−1]\nq = 0.95(N−1)，k = floor(q)\nP95 = d[k] + (q−k)(d[min(k+1, N−1)]−d[k])'),
        result && rows([['本次平均 ΔE00', num(result.meanDeltaE)], ['本次第95百分位 ΔE00', num(result.p95DeltaE)], ['有效像素 N', result.validCount.toLocaleString('zh-CN')]]),
        h('p', null, '数值越小，颜色越接近。P95 表示约 95% 的有效像素色差不超过该值；它不等于平均色差。改变热图阈值不会重新计算或改变这里的结果。'),
        h('details', { className: 'pc-formula-more' }, h('summary', null, '查看 CIEDE2000 修正项的定义'), formula('j = 1（设计）、2（实物）；角度以度表示\nCⱼ = √(aⱼ²+bⱼ²)，C̄ = (C₁+C₂)/2\nG = 0.5[1−√(C̄⁷/(C̄⁷+25⁷))]\na′ⱼ = (1+G)aⱼ，C′ⱼ = √(a′ⱼ²+bⱼ²)\nh′ⱼ = atan2(bⱼ,a′ⱼ)，归一到 [0°,360°)；C′ⱼ=0 时为 0\nΔL′ = L₂−L₁；ΔC′ = C′₂−C′₁\nΔh′ = h′₂−h′₁，调整到 [−180°,180°]；C′₁C′₂=0 时取 0\nΔH′ = 2√(C′₁C′₂) sin(Δh′/2)\nL̄′ = (L₁+L₂)/2；C̄′ = (C′₁+C′₂)/2\nh̄′ = h′₁+h′₂                       （C′₁C′₂=0）\nh̄′ = (h′₁+h′₂)/2                   （色相差≤180°）\nh̄′ = (h′₁+h′₂+360°)/2              （色相差>180°且色相和<360°）\nh̄′ = (h′₁+h′₂−360°)/2              （其余情况）\nT = 1−0.17cos(h̄′−30°)+0.24cos(2h̄′)+0.32cos(3h̄′+6°)−0.20cos(4h̄′−63°)\nS_L = 1+0.015(L̄′−50)²/√(20+(L̄′−50)²)\nS_C = 1+0.045C̄′；S_H = 1+0.015C̄′T\nR_C = 2√(C̄′⁷/(C̄′⁷+25⁷))\nθ = 30° exp(−((h̄′−275°)/25°)²)\nR_T = −R_C sin(2θ)')),
        labFormula());
      return h('div', { className: 'pc-metric-details' }, h('p', { id: 'pc-metric-dialog-context', className: 'pc-metric-context' }, context), body,
        result && h('p', { className: 'pc-metric-footnote' }, '分析时间：' + new Date(result.createdAt).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai', hour12: false }) + '（北京时间）。计算使用完整选区的原始像素，预览缩放不改变结果；展示数值经过四舍五入。'));
    }

    function SourcePanel({ side, asset, quad, onQuad, onFile, busy, loading }) {
      const input = useRef(null), gesture = useRef(null), svg = useRef(null);
      const [dragging, setDragging] = useState(false);
      const selectionDisabled = busy || loading || side === 1;
      useEffect(() => { if (selectionDisabled) gesture.current = null; }, [selectionDisabled]);
      const point = event => {
        const rect = svg.current.getBoundingClientRect();
        return { x: clamp((event.clientX - rect.left) / rect.width, 0, 1), y: clamp((event.clientY - rect.top) / rect.height, 0, 1) };
      };
      const rectQuad = (a, b) => [{ x: Math.min(a.x, b.x), y: Math.min(a.y, b.y) }, { x: Math.max(a.x, b.x), y: Math.min(a.y, b.y) }, { x: Math.max(a.x, b.x), y: Math.max(a.y, b.y) }, { x: Math.min(a.x, b.x), y: Math.max(a.y, b.y) }];
      const down = event => {
        if (selectionDisabled) return;
        event.preventDefault(); const p = point(event), idx = event.target.getAttribute('data-corner');
        gesture.current = { anchor: idx == null ? p : quad[(Number(idx) + 2) % 4] };
        event.currentTarget.setPointerCapture(event.pointerId);
        if (idx == null) onQuad(rectQuad(p, p));
      };
      const move = event => {
        if (selectionDisabled || !gesture.current) return;
        const p = point(event);
        onQuad(rectQuad(gesture.current.anchor, p));
      };
      const drop = event => { event.preventDefault(); setDragging(false); if (!busy && !loading && event.dataTransfer.files[0]) onFile(event.dataTransfer.files[0]); };
      const changeCoordinate = (index, axis, value) => {
        if (selectionDisabled) return;
        const p = { ...quad[index], [axis]: clamp(Number(value) / 100, 0, 1) };
        onQuad(rectQuad(quad[(index + 2) % 4], p));
      };
      return h('section', { className: 'panel pc-source-panel' },
        header(side === 0 ? '01' : '02', side === 0 ? '设计原图' : '生产实物', side === 0 ? '上传设计文件，框选本次比较的基准区域' : '上传平面样品照片，选区随设计原图同步', h('span', { className: 'format-note' }, 'JPG · PNG · WEBP')),
        h('input', { ref: input, type: 'file', accept: '.jpg,.jpeg,.png,.webp', hidden: true, disabled: busy || loading, 'aria-label': side === 0 ? '上传设计原图' : '上传生产实物', onChange: e => { if (e.target.files[0]) onFile(e.target.files[0]); e.target.value = ''; } }),
        h('div', { className: 'pc-stage' + (asset ? ' has-image' : '') + (dragging ? ' dragging' : ''), onDragOver: e => { e.preventDefault(); setDragging(true); }, onDragLeave: () => setDragging(false), onDrop: drop },
          asset ? h('div', { className: 'pc-image-frame', style: { aspectRatio: asset.pixels.width + '/' + asset.pixels.height } },
            h('img', { className: 'pc-image', src: asset.url, alt: side === 0 ? '设计原图预览' : '生产实物预览', draggable: false }),
            h('svg', { ref: svg, className: 'pc-selection' + (selectionDisabled ? ' is-readonly' : ''), viewBox: '0 0 100 100', preserveAspectRatio: 'none', onPointerDown: down, onPointerMove: move, onPointerUp: () => { gesture.current = null; }, onPointerCancel: () => { gesture.current = null; }, 'aria-disabled': !!selectionDisabled, 'aria-label': side === 0 ? '拖动框选原图区域' : '实物选区随原图同步，只读', style: { touchAction: selectionDisabled ? 'auto' : 'none' } },
              quad.length >= 3 && h('polygon', { points: quad.map(p => p.x * 100 + ',' + p.y * 100).join(' '), fill: 'rgba(20,95,101,.1)', stroke: '#145f65', strokeWidth: .6, vectorEffect: 'non-scaling-stroke' }),
              quad.map((p, i) => h('g', { key: i }, h('circle', { 'data-corner': i, cx: p.x * 100, cy: p.y * 100, r: 2, fill: '#fff', stroke: '#145f65', strokeWidth: .55, style: { cursor: 'move' } }), h('text', { x: clamp(p.x * 100 + 3, 3, 94), y: clamp(p.y * 100 + 5, 7, 96), fontSize: 4, fill: '#10383c', pointerEvents: 'none', paintOrder: 'stroke', stroke: '#fff', strokeWidth: .9 }, i + 1)))
            )
          ) : h('div', { className: 'pc-upload-empty' }, icon(side === 0 ? 'image' : 'compare', 34), h('strong', null, side === 0 ? '放入设计预期' : '放入生产样品'), h('span', null, '拖拽图片到此处，或选择本地文件'), button('选择图片', () => input.current.click(), { icon: 'upload', disabled: busy || loading })),
          loading && h('div', { className: 'pc-loading-cover', role: 'status' }, '正在读取图片…')
        ),
        asset && h('div', { className: 'pc-file-row' }, h('div', { className: 'pc-file-info' }, h('strong', { title: asset.name }, asset.name), h('small', null, asset.width + ' × ' + asset.height + (asset.example ? ' · 演示样本' : ' · 本地图片'))), button('更换图片', () => input.current.click(), { disabled: busy || loading, icon: 'upload' })),
        asset && side === 0 && h('div', { className: 'pc-toolbar' }, button('使用整张图片', () => onQuad(fullQuad()), { className: 'small', disabled: selectionDisabled })),
        asset && side === 0 && quad.length === 4 && h('details', { className: 'pc-coordinates' }, h('summary', null, '精确调整选区（百分比）'), h('div', { className: 'pc-coordinate-grid' }, [0, 2].map(i => h('div', { className: 'pc-coordinate-row', key: i }, h('span', null, '原图角点 ' + (i + 1)), ['x', 'y'].map(axis => h('label', { key: axis }, axis.toUpperCase(), h('input', { type: 'number', min: 0, max: 100, step: .1, disabled: selectionDisabled, value: Math.round(quad[i][axis] * 1000) / 10, 'aria-label': '原图角点' + (i + 1) + axis.toUpperCase() + '百分比', onChange: e => changeCoordinate(i, axis, e.target.value) }))))))),
        h('p', { className: 'pc-note' }, side === 0 ? '在图上拖动框选；以相同纹理的位置为比较基准。' : '实物选区由设计原图同步，请在左侧调整比对范围。')
      );
    }

    return function ProductionCompare() {
      const [sources, setSources] = useState([null, null]), [quads, setQuads] = useState([fullQuad(), fullQuad()]);
      const [loading, setLoading] = useState([false, false]), [busy, setBusy] = useState(false), [error, setError] = useState('');
      const [result, setResult] = useState(null), [threshold, setThreshold] = useState(5), [opacity, setOpacity] = useState(50), [view, setView] = useState('pair');
      const [sample, setSample] = useState(''), [batch, setBatch] = useState(''), [review, setReview] = useState('未判定'), [notes, setNotes] = useState('');
      const [local, setLocal] = useState(null);
      const [progress, setProgress] = useState(null);
      const uploadTokens = useRef([0, 0]), analysisToken = useRef(0), mounted = useRef(true);
      const [metricDetail, setMetricDetail] = useState(null);
      const metricDialog = useRef(null);
      useEffect(() => {
        const dialog = metricDialog.current;
        if (!dialog) return;
        if (metricDetail && !dialog.open) dialog.showModal();
        else if (!metricDetail && dialog.open) dialog.close();
      }, [metricDetail]);
      useEffect(() => { mounted.current = true; return () => { mounted.current = false; analysisToken.current++; }; }, []);
      const core = window.DilongCompareCore;
      const invalidate = () => { analysisToken.current++; setResult(null); setLocal(null); setReview('未判定'); setError(''); setBusy(false); setProgress(null); setMetricDetail(null); };
      const selectionBlocked = busy || loading.some(Boolean);
      const changeQuad = (side, q) => {
        if (selectionBlocked || side !== 0) return;
        invalidate();
        setQuads([q, q.map(p => ({ ...p }))]);
      };
      const resetQuads = () => {
        if (selectionBlocked) return;
        invalidate(); setQuads([fullQuad(), fullQuad()]);
      };
      async function upload(side, file) {
        if (selectionBlocked) return;
        const token = ++uploadTokens.current[side]; invalidate();
        setSources(old => old.map((v, i) => i === side ? null : v)); setQuads([fullQuad(), fullQuad()]);
        setLoading(old => old.map((v, i) => i === side ? true : v));
        try {
          const asset = await fileAsset(file);
          if (!mounted.current || token !== uploadTokens.current[side]) return;
          setSources(old => old.map((v, i) => i === side ? asset : v)); setQuads([fullQuad(), fullQuad()]);
          if (sources.some(s => s && s.example)) {
            setSample(value => value === '浅橡木演示样本' ? '' : value);
            setBatch(value => value === 'DEMO-01' ? '' : value);
            setNotes(value => value === '演示实物图由原图模拟偏色与局部变化生成，所有比对指标均根据图片实际计算。' ? '' : value);
          }
        } catch (err) { if (mounted.current && token === uploadTokens.current[side]) setError((side === 0 ? '设计原图' : '生产实物') + '读取失败：' + err.message + ' 请重新选择有效图片后再分析。'); }
        finally { if (mounted.current && token === uploadTokens.current[side]) setLoading(old => old.map((v, i) => i === side ? false : v)); }
      }
      async function loadExample() {
        if (selectionBlocked) return;
        invalidate(); setSources([null, null]); setQuads([fullQuad(), fullQuad()]); const tokens = [++uploadTokens.current[0], ++uploadTokens.current[1]]; setLoading([true, true]);
        try {
          const ref = await imageAsset('./sample-oak.png', '浅橡木设计原图（演示）', true);
          const c = canvasOf(ref.pixels), ctx = c.getContext('2d'), pixels = ctx.getImageData(0, 0, c.width, c.height);
          for (let i = 0; i < pixels.data.length; i += 4) { pixels.data[i] = pixels.data[i] * .94 + 7; pixels.data[i + 1] *= .91; pixels.data[i + 2] *= .88; }
          ctx.putImageData(pixels, 0, 0); ctx.fillStyle = 'rgba(105,65,30,.19)'; ctx.fillRect(c.width * .57, c.height * .28, c.width * .18, c.height * .28);
          const actual = await imageAsset(c.toDataURL(), '模拟生产样品（演示偏色与局部变化）', true);
          if (!mounted.current || tokens.some((t, i) => t !== uploadTokens.current[i])) return;
          setSources([ref, actual]); setQuads([fullQuad(), fullQuad()]); setSample('浅橡木演示样本'); setBatch('DEMO-01'); setNotes('演示实物图由原图模拟偏色与局部变化生成，所有比对指标均根据图片实际计算。');
        } catch (err) { if (mounted.current && tokens.every((t, i) => t === uploadTokens.current[i])) setError(err.message); }
        finally { if (mounted.current) setLoading(old => old.map((value, i) => tokens[i] === uploadTokens.current[i] ? false : value)); }
      }
      async function analyze() {
        if (selectionBlocked) return;
        setError('');
        if (!core) { setError('比对模块未加载，请刷新页面后重试。'); return; }
        if (!sources.every(Boolean)) { setError('请先上传设计原图与生产实物图。'); return; }
        if (!quads.every(q => q.length === 4 && core.validateQuad(q))) { setError('选区四角交叉、范围过小或尚未选完，请按顺序重新选择对应区域。'); return; }
        const token = ++analysisToken.current; setBusy(true); setProgress({ fraction: 0, completed: 0, phase: 'pixels' }); setResult(null); setLocal(null); setReview('未判定');
        try {
          await frame();
          const metrics = await core.compareRegions(sources[0].pixels, sources[1].pixels, quads[0], {
            threshold, shouldCancel: () => !mounted.current || token !== analysisToken.current,
            onProgress: value => { if (mounted.current && token === analysisToken.current) setProgress(value); }
          });
          if (!mounted.current || token !== analysisToken.current) return;
          setResult({ ...metrics, referenceUrl: canvasOf(metrics.reference).toDataURL(), actualUrl: canvasOf(metrics.actual).toDataURL(), createdAt: new Date().toISOString(), quads: quads.map(q => q.map(p => ({ ...p }))) });
          setView('pair');
        } catch (err) { if (mounted.current && token === analysisToken.current && err.name !== 'AbortError') setError(err.message || '计算失败，请检查图片和选区。'); }
        finally { if (mounted.current && token === analysisToken.current) { setBusy(false); setProgress(null); } }
      }
      const heatUrl = useMemo(() => heatImage(result, threshold), [result, threshold]);
      const area = useMemo(() => result ? core.thresholdStats(result.deltaMap, result.validMask, threshold) : null, [result, threshold]);
      function inspect(event) {
        if (!result) return;
        const box = event.currentTarget.getBoundingClientRect();
        const x = clamp(Math.floor((event.clientX - box.left) / box.width * result.width), 0, result.width - 1), y = clamp(Math.floor((event.clientY - box.top) / box.height * result.height), 0, result.height - 1);
        let total = 0, count = 0;
        for (let yy = Math.max(0, y - 7); yy <= Math.min(result.height - 1, y + 7); yy++) for (let xx = Math.max(0, x - 7); xx <= Math.min(result.width - 1, x + 7); xx++) {
          const i = yy * result.width + xx; if (result.validMask[i]) { total += result.deltaMap[i]; count++; }
        }
        setLocal({ x, y, value: count ? total / count : null });
      }
      function exportReport() {
        if (!result) return;
        const date = new Date(result.createdAt).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai', hour12: false });
        const figures = [['设计原图 · 对齐选区', result.referenceUrl], ['生产实物 · 校正选区', result.actualUrl], ['图像色差热图', heatUrl]];
        const html = '<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>生产比对报告</title><style>body{font:14px/1.7 system-ui,sans-serif;color:#243639;max-width:1100px;margin:36px auto;padding:0 24px}h1{border-bottom:4px solid #145f65;padding-bottom:12px}table{border-collapse:collapse;width:100%;margin:16px 0}td,th{border:1px solid #ccd6d4;padding:9px;text-align:left}th{background:#eaf0ef}.images{display:flex;gap:16px}figure{margin:0;flex:1;min-width:0}img{width:100%;height:auto}figcaption{font-weight:bold;margin-bottom:8px}.notice{border-left:3px solid #bc8b40;background:#f8f4eb;padding:12px}.notes{white-space:pre-wrap}pre{white-space:pre-wrap;font-size:11px}@media print{body{margin:0;max-width:none}.no-print{display:none}figure{break-inside:avoid}h2{break-after:avoid}}</style><body>' +
          '<h1>帝龙装饰纸 · 生产比对报告</h1><p>样品：' + escape(sample || '未填写') + '　生产批次：' + escape(batch || '未填写') + '</p><p>分析时间：' + escape(date) + '（北京时间）</p>' +
          (sources.some(s => s.example) ? '<p class="notice">本次包含演示样本：带“演示”标记的图片来自内置示例，其中模拟生产图含人为偏色与局部变化。指标均根据当前两图实际计算。</p>' : '') +
          '<p class="notice">未经测色校准的图像比较。结果同时受拍摄光照、设备和选区对齐影响；差异区域占比不等同于生产不合格率。</p><table><tr><th>指标</th><th>结果</th><th>说明</th></tr>' +
          [['平均图像色差 ΔE00', num(result.meanDeltaE), '越小越接近'], ['RGB 平均偏差', num(result.meanRgbDifference) + ' / 255', '与配墨页合成偏差同公式；范围0—255，越小越接近'], ['色差第95百分位 ΔE00', num(result.p95DeltaE), '95%有效像素的色差不超过该值'], ['纹理结构 SSIM', num(result.ssim, 4), '越接近1，图像结构越接近；明暗也会影响'], ['平均 ΔL* / Δa* / Δb*', [result.deltaL, result.deltaA, result.deltaB].map(signed).join(' / '), biasText(result)], ['超阈值区域占比', num(area, 1) + '%', '图像色差 > ' + threshold + '，阈值仅用于差异显示'], ['人工结论', review, '人工复核结果']].map(row => '<tr>' + row.map(v => '<td>' + escape(v) + '</td>').join('') + '</tr>').join('') +
          '</table><div class="images">' + figures.map(([label, url]) => '<figure><figcaption>' + label + '</figcaption><img src="' + url + '" alt="' + label + '"></figure>').join('') + '</div><p>热图色阶：青色 0 → 黄色 ' + threshold + ' → 红色 ≥ ' + num(threshold * 2, 1) + ' ΔE00。显示图叠加了原始纹理。</p><h2>人工备注</h2><p class="notes">' + escape(notes || '无') + '</p><h2>图片与计算参数</h2><p>原图：' + escape(sources[0].name) + '（' + sources[0].width + '×' + sources[0].height + '）<br>实物：' + escape(sources[1].name) + '（' + sources[1].width + '×' + sources[1].height + '）<br>计算分辨率：' + result.width + '×' + result.height + '；覆盖像素位置：' + (result.width * result.height) + '；有效像素：' + result.validCount + '。<br>计算覆盖设计原图选区的全部原始像素；报告图片仅为缩略预览。热图缩小显示时保留显示区域内最大色差，全部指标来自完整色差图。<br>RGB 平均偏差 = 有效像素的 sqrt((R1-R2)^2+(G1-G2)^2+(B1-B2)^2) / sqrt(3) 的平均值，范围0—255。<br>sRGB / D65 → CIELAB；CIEDE2000；灰度 SSIM，7×7窗口，K1=0.01，K2=0.03，data_range=255。<br>设计选区按原始整数像素取样；实物按相同比例位置映射到设计原始像素网格，尺寸不同时采用双线性重采样；未自动匹配纹理、调色或匹配亮度。透明像素不参与比较。</p><details><summary>归一化选区坐标（左上、右上、右下、左下）</summary><pre>' + escape(JSON.stringify(result.quads, null, 2)) + '</pre></details><p class="no-print">可使用浏览器的打印功能保存为 PDF。本报告图片已内嵌，离线可打开。</p></body></html>';
        const blob = new Blob([html], { type: 'text/html;charset=utf-8' }), url = URL.createObjectURL(blob), a = document.createElement('a');
        a.href = url; a.download = (sample || '生产比对').replace(/[<>:"/\\|?*\x00-\x1f]/g, '_') + '_比对报告.html'; document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 30000);
      }
      const ready = sources.every(Boolean) && !loading.some(Boolean) && !busy;
      const stateLabel = busy ? '正在分析' : loading.some(Boolean) ? '正在读取' : result ? '分析完成' : sources.every(Boolean) ? '待确认对齐' : '待上传图片';
      const metrics = [['任务状态', stateLabel], ['平均图像色差 ΔE00', result ? num(result.meanDeltaE) : '—'], ['RGB 平均偏差', result ? num(result.meanRgbDifference) + ' / 255' : '—'], ['纹理结构 SSIM', result ? num(result.ssim, 4) : '—'], ['平均偏色方向', result ? biasText(result) : '—'], ['人工结论', result ? review : '—']];
      let plannedBounds = null;
      try { if (sources[0] && core) plannedBounds = core.comparisonBounds(sources[0].pixels, quads[0]); } catch (_) { /* A drag may temporarily have zero area. */ }
      const marker = local && result ? { left: ((local.x + .5) / result.width * 100) + '%', top: ((local.y + .5) / result.height * 100) + '%' } : null;
      function alignedFigure(title, url) {
        return h('figure', { key: title }, h('figcaption', null, title), h('div', { className: 'pc-image-inspect', style: { aspectRatio: result.width + '/' + result.height, maxWidth: (430 * result.width / result.height) + 'px' } }, h('img', { src: url, alt: title, onClick: inspect }), marker && h('span', { className: 'pc-location-marker', style: marker })));
      }
      function metricCard(kind, value, description, valueClass) {
        return h('button', { type: 'button', className: 'pc-metric', 'aria-label': '查看' + metricLabels[kind] + '的公式与本次结果', 'aria-haspopup': 'dialog', onClick: () => setMetricDetail(kind) },
          h('span', null, metricLabels[kind]), h('strong', { className: valueClass || '' }, value), h('span', { className: 'pc-metric-description' }, description), h('small', { className: 'pc-metric-link' }, '查看公式与本次结果 ›'));
      }
      return h('div', { className: 'production-compare embedded-module' }, h('main', { className: 'workspace' },
        h('section', { className: 'page-heading' }, h('div', null, h('div', { className: 'breadcrumb' }, '生产比对工作台', icon('arrow', 13), '新建比对任务'), h('h1', null, '设计与实物还原评估'), h('p', null, '对照设计预期，查看生产样品的颜色与纹理差异。')), h('div', { className: 'pc-heading-actions' }, button('载入演示样本', loadExample, { disabled: busy || loading.some(Boolean), className: 'ghost' }), button('导出比对报告', exportReport, { className: 'primary export-button', icon: 'download', disabled: !result || busy }))),
        h('div', { className: 'pc-task-fields' }, h('label', null, '样品名称', h('input', { value: sample, onChange: e => setSample(e.target.value), placeholder: '例如：浅色橡木装饰纸', maxLength: 100 })), h('label', null, '生产批次', h('input', { value: batch, onChange: e => setBatch(e.target.value), placeholder: '例如：20261019-01', maxLength: 100 }))),
        h('section', { className: 'summary-strip', 'aria-live': 'polite' }, metrics.map(([label, value], i) => h('div', { key: label }, h('span', null, label), h('strong', { className: i === 0 ? result ? 'ready' : 'pending' : '' }, value)))),
        error && h('div', { className: 'pc-error', role: 'alert' }, icon('info', 17), error),
        sources.some(s => s && s.example) && h('div', { className: 'pc-example-note' }, '当前包含演示样本：示例生产图含模拟偏色与局部变化，指标根据当前两图实际计算。上传真实图片可开始自己的比对。'),
        h('section', { className: 'pc-link-bar', 'aria-label': '选区联动设置' },
          h('strong', null, '选区自动同步'),
          h('p', { id: 'pc-link-hint', role: 'status' }, !sources.every(Boolean) ? '上传两张图片后，在设计原图上框选，实物选区会按比例同步。' : '位置已同步，请核对是否为同一处纹理。联动按相同比例位置同步，请在设计原图上框选。')
        ),
        h('section', { className: 'pc-resolution-note', 'aria-label': '比较分辨率' }, h('strong', null, '原始分辨率比较'),
          h('p', null, sources[0] && plannedBounds ? '设计原图 ' + sources[0].width + ' × ' + sources[0].height + '；本次选区 ' + plannedBounds.width + ' × ' + plannedBounds.height + '，共 ' + (plannedBounds.width * plannedBounds.height).toLocaleString('zh-CN') + ' 个像素。预览缩放不影响完整计算。' : '默认覆盖整张设计原图的全部原始像素，也可框选局部区域。透明像素不参与指标计算。')),
        h('div', { className: 'pc-upload-grid' }, [0, 1].map(side => h(SourcePanel, { key: side, side, asset: sources[side], quad: quads[side], onQuad: q => changeQuad(side, q), onFile: f => upload(side, f), busy: selectionBlocked, loading: loading[side] }))),
        h('section', { className: 'panel pc-comparison-panel' }, header('03', '对齐与差异对照', '确认同一位置的纹理对应，再查看真实图像差异', h('span', { className: 'pc-badge' }, result ? '已完成计算' : '待确认选区')),
          h('div', { className: 'pc-view-body' }, h('div', { className: 'pc-view-main' },
            h('div', { className: 'pc-tabs', role: 'tablist', 'aria-label': '比对显示方式' }, [['pair', '并排对照'], ['overlay', '透明叠加'], ['heat', '色差热图']].map(([key, label]) => h('button', { key, type: 'button', role: 'tab', 'aria-selected': view === key, className: view === key ? 'active' : '', onClick: () => setView(key) }, label))),
            h('div', { className: 'pc-viewer' }, busy ? h('div', { className: 'pc-empty-view', role: 'status' }, icon('compare', 34), h('strong', null, '正在按原始分辨率计算差异…'), h('progress', { max: 100, value: Math.round((progress ? progress.fraction : 0) * 100), 'aria-label': '原始分辨率计算进度' }), h('p', null, Math.round((progress ? progress.fraction : 0) * 100) + '% · ' + (progress && progress.phase === 'percentile' ? '正在汇总色差百分位' : progress && progress.phase === 'preview' ? '正在生成预览' : '逐像素比较颜色与纹理结构'))) : !result ? h('div', { className: 'pc-empty-view' }, icon('compare', 36), h('strong', null, '准备好两张图，开始一次生产比对'), h('p', null, '默认比较整张原图，也可在上方框选局部区域，然后确认对齐并分析。')) : view === 'pair' ? h('div', { className: 'pc-pair' }, alignedFigure('设计原图 · 基准选区', result.referenceUrl), alignedFigure('生产实物 · 校正选区', result.actualUrl)) : view === 'heat' ? h('div', { className: 'pc-single' }, alignedFigure('图像色差分布 · 点击查看局部', heatUrl)) : h('div', { className: 'pc-single' }, h('figure', null, h('figcaption', null, '设计原图 + 生产实物叠加'), h('div', { className: 'pc-overlay', style: { aspectRatio: result.width + '/' + result.height, maxWidth: (430 * result.width / result.height) + 'px' }, onClick: inspect }, h('img', { src: result.referenceUrl, alt: '叠加底图：设计原图' }), h('img', { src: result.actualUrl, alt: '叠加上层：生产实物', style: { opacity: opacity / 100 } }), marker && h('span', { className: 'pc-location-marker', style: marker }))))),
            result && view === 'heat' && h('div', { className: 'pc-legend' }, h('span', null, '0'), h('div', { className: 'pc-legend-gradient' }), h('span', null, '≥ ' + num(threshold * 2, 1) + ' ΔE00'), h('small', null, '黄色位置约为阈值 ' + threshold)),
            result && h('p', { className: 'pc-note' }, '原始像素计算尺寸 ' + result.width + ' × ' + result.height + '；覆盖 ' + (result.width * result.height).toLocaleString('zh-CN') + ' 个像素位置，有效像素 ' + result.validCount.toLocaleString('zh-CN') + '，超阈值像素 ' + Math.round(area / 100 * result.validCount).toLocaleString('zh-CN') + '。图像仅缩小显示；点击查看原始计算位置附近的平均色差。'),
            result && view === 'heat' && result.previewDeltaMap && h('p', { className: 'pc-note' }, '热图缩小显示时保留每个显示区域的最大色差，便于发现小范围差异；所有指标仍按完整色差图计算。')
          ), h('aside', { className: 'pc-controls' },
            h('div', { className: 'pc-control-group' }, h('strong', null, '比对设置'),
              view === 'pair' && h('p', null, '左右查看同一纹理区域的颜色与外观；需要检查错位时切换透明叠加，查看差异位置时切换色差热图。'),
              view === 'overlay' && h('label', null, '叠加透明度', h('span', { className: 'pc-value' }, opacity + '%'), h('input', { type: 'range', min: 0, max: 100, value: opacity, 'aria-label': '叠加透明度', onChange: e => setOpacity(Number(e.target.value)) })),
              view === 'overlay' && h('p', null, '0% 设计图、100% 实物图。拖动滑块检查纹理是否重合；透明度仅改变显示。'),
              view === 'heat' && h('label', null, '差异显示阈值 ΔE00', h('span', { className: 'pc-value' }, threshold), h('input', { type: 'range', min: 1, max: 20, step: .5, value: threshold, 'aria-label': '差异显示阈值', onChange: e => setThreshold(Number(e.target.value)) })),
              view === 'heat' && h('p', null, '青色差异小，黄色约为阈值，红色为阈值两倍及以上。默认 5，仅影响热图与超阈值区域占比，平均色差、RGB 平均偏差和 SSIM 不变；不作为生产合格标准。')
            ),
            h('div', { className: 'pc-control-group' }, h('strong', null, '对齐操作'), h('p', null, '在设计原图上框选，实物区域自动按相同比例同步；请核对是否为同一处纹理。'), button('重置两侧选区', resetQuads, { disabled: selectionBlocked || !sources.some(Boolean), className: 'ghost' })),
            button(busy ? '正在计算…' : '确认对齐并分析', analyze, { disabled: !ready, className: 'primary pc-run', icon: 'check' }),
            busy && button('取消计算', invalidate, { className: 'ghost' }),
            local && h('div', { className: 'pc-local-info', role: 'status' }, h('strong', null, '局部平均色差 ' + num(local.value)), h('span', null, '位置 ' + local.x + ', ' + local.y + ' · 周围最多 15 × 15 像素')),
            h('p', { className: 'pc-note' }, '没有找到对应纹理时，请重新选区。计算不自动修正光照或偏色。')
          ))
        ),
        h('section', { className: 'panel pc-results-panel' }, header('04', '比对结果与人工复核', '分别观察颜色、结构与局部差异，记录本次判断', h('span', { className: 'pc-badge' }, '辅助评估')),
          h('div', { className: 'pc-result-grid' },
            metricCard('delta', result ? num(result.meanDeltaE) : '—', result ? '第95百分位 ' + num(result.p95DeltaE) + '；数值越小，图片颜色越接近。' : '对齐后计算平均色差与第95百分位。'),
            metricCard('rgb', result ? num(result.meanRgbDifference) + ' / 255' : '—', '与配墨页“合成偏差”采用相同公式：对应像素的 RGB 距离除以 √3 后取平均，范围 0—255，越小越接近。此处比较设计图与实物图的有效像素，透明区域不计。'),
            metricCard('ssim', result ? num(result.ssim, 4) : '—', '越接近 1，图像结构越接近；明暗和拍摄质量也会影响。'),
            metricCard('bias', result ? biasText(result) : '—', result ? 'ΔL* ' + signed(result.deltaL) + ' / Δa* ' + signed(result.deltaA) + ' / Δb* ' + signed(result.deltaB) : '查看实物相对设计的亮暗、红绿与黄蓝变化。', 'pc-bias-text')
          ),
          h('div', { className: 'pc-review-grid' }, h('label', { className: 'pc-field' }, '人工结论', h('select', { value: review, disabled: !result, onChange: e => setReview(e.target.value) }, ['未判定', '可接受', '需要调整', '重新打样'].map(v => h('option', { key: v, value: v }, v))), h('small', null, '由你结合样品和工艺要求确认。')), h('label', { className: 'pc-field' }, '复核备注', h('textarea', { value: notes, onChange: e => setNotes(e.target.value), placeholder: '记录偏差位置、拍摄条件或下一步处理意见…', rows: 3, maxLength: 4000 }))),
          h('div', { className: 'pc-reference-note' }, icon('info', 17), h('div', null, h('strong', null, '图像比较参考'), h('p', null, '当前结果未经测色校准，包含光照、设备与对齐误差的影响。超阈值区域占比表示图片差异范围，不等同于生产不合格率。')))
        ),
        h('p', { className: 'pc-local-footer' }, icon('info', 14), '图片仅在当前浏览器中处理。切换模块可继续操作，刷新页面后清空；需要留存时请导出报告。'),
        h('dialog', { ref: metricDialog, className: 'pc-metric-dialog', 'aria-labelledby': 'pc-metric-dialog-title', 'aria-describedby': 'pc-metric-dialog-context', onClose: () => setMetricDetail(null), onCancel: () => setMetricDetail(null) },
          h('div', { className: 'pc-metric-dialog-heading' }, h('h2', { id: 'pc-metric-dialog-title' }, (metricLabels[metricDetail] || '指标') + ' · 计算详情'), h('button', { type: 'button', className: 'pc-button', 'aria-label': '关闭指标详情', onClick: () => setMetricDetail(null) }, '关闭')),
          metricDetail && metricExplanation(metricDetail, result))
      ));
    };
  };
})();
