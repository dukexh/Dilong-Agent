export interface ReportSource { name: string; width: number; height: number; example: boolean }
export interface ReportPoint { x: number; y: number }
export interface ProductionReportResult {
  meanDeltaE: number; meanRgbDifference: number; p95DeltaE: number; ssim: number
  deltaL: number; deltaA: number; deltaB: number; width: number; height: number; validCount: number
  ssimWindowCount: number; referenceUrl: string; actualUrl: string; createdAt: string; quads: ReportPoint[][]
}
export interface ProductionReportInput {
  result: ProductionReportResult; sources: [ReportSource, ReportSource]; sample: string; batch: string
  review: string; notes: string; threshold: number; area: number; heatUrl: string
}
const escape = (value: unknown) => String(value ?? '').replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]!)
const num = (value: number, digits = 2) => Number.isFinite(value) ? value.toFixed(digits) : '—'
const signed = (value: number) => (value > 0 ? '+' : '') + num(value)
export function productionBias(result: Pick<ProductionReportResult, 'deltaL' | 'deltaA' | 'deltaB'>) {
  return ([[result.deltaL, '偏亮', '偏暗'], [result.deltaA, '偏红', '偏绿'], [result.deltaB, '偏黄', '偏蓝']] as const)
    .filter(([value]) => Math.abs(value) >= .5).map(([value, positive, negative]) => value > 0 ? positive : negative).join('、') || '平均偏色方向不明显'
}
/** All images are embedded so the exported report remains usable offline. */
export function createProductionReport(input: ProductionReportInput): string {
  const { result, sources, sample, batch, review, notes, threshold, area, heatUrl } = input
  const date = new Date(result.createdAt).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai', hour12: false })
  const rows = [
    ['平均图像色差 ΔE00', num(result.meanDeltaE), '越小越接近'],
    ['RGB 平均偏差', num(result.meanRgbDifference) + ' / 255', '与配墨页合成偏差同公式；范围0—255，越小越接近'],
    ['色差第95百分位 ΔE00', num(result.p95DeltaE), '95%有效像素的色差不超过该值'],
    ['纹理结构 SSIM', num(result.ssim, 4) + '（' + num(result.ssim * 100, 1) + '%）', '越接近1，图像结构越接近；明暗也会影响'],
    ['平均 ΔL* / Δa* / Δb*', [result.deltaL, result.deltaA, result.deltaB].map(value => signed(value)).join(' / '), productionBias(result)],
    ['超阈值区域占比', num(area, 1) + '%', '图像色差 > ' + threshold + '，阈值仅用于差异显示'],
    ['人工结论', review, '人工复核结果'],
  ]
  const figures = [['设计原图 · 对齐选区', result.referenceUrl], ['生产实物 · 校正选区', result.actualUrl], ['图像色差热图', heatUrl]]
  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>生产比对报告</title><style>body{font:14px/1.7 system-ui,sans-serif;color:#243639;max-width:1100px;margin:36px auto;padding:0 24px}h1{border-bottom:4px solid #7a13f0;padding-bottom:12px}table{border-collapse:collapse;width:100%;margin:16px 0}td,th{border:1px solid #ccd6d4;padding:9px;text-align:left}th{background:#f4f0fc}.images{display:flex;gap:16px}figure{margin:0;flex:1;min-width:0}img{width:100%;height:auto}figcaption{font-weight:bold;margin-bottom:8px}.notice{border-left:3px solid #bc8b40;background:#f8f4eb;padding:12px}.notes{white-space:pre-wrap}pre{white-space:pre-wrap;font-size:11px}@media(max-width:600px){.images{display:block}figure{margin-bottom:20px}}@media print{body{margin:0;max-width:none}.no-print{display:none}figure{break-inside:avoid}h2{break-after:avoid}}</style></head><body>
<h1>帝龙装饰纸 · 生产比对报告</h1><p>样品：${escape(sample || '未填写')}　生产批次：${escape(batch || '未填写')}</p><p>分析时间：${escape(date)}（北京时间）</p>
${sources.some(source => source.example) ? '<p class="notice">本次包含演示样本：带“演示”标记的图片来自内置示例，其中模拟生产图含人为偏色与局部变化。指标均根据当前两图实际计算。</p>' : ''}
<p class="notice">未经测色校准的图像比较。结果同时受拍摄光照、设备和选区对齐影响；差异区域占比不等同于生产不合格率。</p>
<table><tr><th>指标</th><th>结果</th><th>说明</th></tr>${rows.map(row => '<tr>' + row.map(value => '<td>' + escape(value) + '</td>').join('') + '</tr>').join('')}</table>
<div class="images">${figures.map(([label, url]) => '<figure><figcaption>' + escape(label) + '</figcaption><img src="' + escape(url) + '" alt="' + escape(label) + '"></figure>').join('')}</div>
<p>热图色阶：青色 0 → 黄色 ${threshold} → 红色 ≥ ${num(threshold * 2, 1)} ΔE00。显示图叠加了原始纹理。</p><h2>人工备注</h2><p class="notes">${escape(notes || '无')}</p>
<h2>图片与计算参数</h2><p>原图：${escape(sources[0].name)}（${sources[0].width}×${sources[0].height}）<br>实物：${escape(sources[1].name)}（${sources[1].width}×${sources[1].height}）<br>计算分辨率：${result.width}×${result.height}；覆盖像素位置：${result.width * result.height}；有效像素：${result.validCount}；有效SSIM窗口：${result.ssimWindowCount}。<br>计算覆盖设计原图选区的全部原始像素；报告图片仅为缩略预览。热图缩小显示时保留显示区域内最大色差，全部指标来自完整色差图。<br>RGB 平均偏差 = 有效像素的 sqrt((R1-R2)^2+(G1-G2)^2+(B1-B2)^2) / sqrt(3) 的平均值，范围0—255。<br>sRGB / D65 → CIELAB；CIEDE2000；灰度 SSIM，7×7窗口，K1=0.01，K2=0.03，data_range=255。<br>设计选区按原始整数像素取样；实物按相同比例位置映射到设计原始像素网格，尺寸不同时采用双线性重采样；未自动匹配纹理、调色或匹配亮度。透明度小于250/255的对应像素不参与比较。</p>
<details><summary>归一化选区坐标（左上、右上、右下、左下）</summary><pre>${escape(JSON.stringify(result.quads, null, 2))}</pre></details><p class="no-print">可使用浏览器的打印功能保存为 PDF。本报告图片已内嵌，离线可打开。</p></body></html>`
}
