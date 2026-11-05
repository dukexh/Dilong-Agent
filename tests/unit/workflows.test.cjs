const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { S } = require('../../src/services/workflows.ts')
const metadata = require('../../src/core/sample-metadata.ts')
const asset = (id, patch = {}) => ({ id, name: id, imageUrl: 'data:image/png;base64,AA==', wood: '橡木', style: '现代自然', tone: '浅灰', source: '测试', ...patch })
const reset = () => { S.assets = []; S.tasks = []; S.inkRuns = []; S.base = []; S.operations = {}; S.activeTask = null; S.designRuns.clear() }

test.beforeEach(reset)

test('元数据保留真实客户、生产记录、候选评价；编辑草稿不修改原对象', () => {
  const input = { name: '客户橡木', customer: '客户A', staff: { colorist: '张师傅' }, productionRecords: [{ batchNo: 'B-1', date: '2024-02-29', deltaE: 1.25 }], history: [{ date: '2026-10-31', title: '确认', description: '试印通过', status: '已确认' }], recordKind: 'design-candidate', candidateReview: { status: 'accepted' }, parameters: { strength: 60 } }
  const normalized = metadata.normalize(input)
  assert.equal(normalized.staff.colorist, '张师傅'); assert.equal(normalized.productionRecords[0].deltaE, '1.25')
  assert.deepEqual(normalized.history, input.history); assert.equal(normalized.candidateReview.status, 'accepted')
  const draft = metadata.draft(normalized)
  draft.staff.colorist = '李师傅'; draft.productionRecords[0].batchNo = 'B-2'
  assert.equal(normalized.staff.colorist, '张师傅'); assert.equal(normalized.productionRecords[0].batchNo, 'B-1'); assert.equal(draft.orderNo, '')
  assert.deepEqual(metadata.normalize(draft), { ...normalized, staff: { ...normalized.staff, colorist: '李师傅' }, productionRecords: [{ ...normalized.productionRecords[0], batchNo: 'B-2' }] })
})
test('元数据明确拒绝错误类型、不存在的日期及负色差', () => {
  for (const patch of [{ customer: [] }, { staff: '人名' }, { productionRecords: {} }, { history: {} }, { parameters: [] }, { candidateReview: { status: 'unknown' } }, { productionRecords: [{ batchNo: 'B', date: '2026-02-30' }] }, { productionRecords: [{ batchNo: 'B', deltaE: -1 }] }]) assert.throws(() => metadata.normalize({ name: '样例', ...patch }))
  assert.throws(() => metadata.normalize({ name: '', productionRecords: [] }), /样例名称/)
  assert.equal(metadata.normalize({ name: '旧样例', productionRecords: [{}] }).productionRecords.length, 0)
})
test('ZIP往返保留中文路径与原始字节，没有导出数量或容量门槛', async () => {
  const files = [['manifest.json', new TextEncoder().encode(JSON.stringify({ schemaVersion: 1, samples: [] }))], ['images/橡木.png', new Uint8Array([137, 80, 78, 71, 0, 255])]]
  const zipped = S.zip(files), restored = await S.unzip(await zipped.arrayBuffer())
  assert.equal(zipped.type, 'application/zip'); assert.equal(restored.size, 2)
  assert.deepEqual(restored.get('images/橡木.png'), files[1][1]); assert.deepEqual(restored.get('manifest.json'), files[0][1])
  const many = Array.from({ length: 501 }, (_, index) => [`images/${index}.png`, new Uint8Array([index % 256])])
  assert.equal((await S.unzip(await S.zip(many).arrayBuffer())).size, 501)
})
test('ZIP检查CRC、重复路径及150MB解压上限', async () => {
  const buffer = await S.zip([['a', new Uint8Array([1, 2, 3])]]).arrayBuffer(), corrupted = buffer.slice(0)
  new Uint8Array(corrupted)[31] ^= 1
  await assert.rejects(() => S.unzip(corrupted), /文件校验失败/)
  await assert.rejects(() => S.unzip(new ArrayBuffer(5)), /有效的 ZIP/)
  const repeated = await S.zip([['a', new Uint8Array([1])], ['a', new Uint8Array([2])]]).arrayBuffer()
  await assert.rejects(() => S.unzip(repeated), /重复路径/)
  const oversized = buffer.slice(0), view = new DataView(oversized), central = 30 + 1 + 3
  view.setUint32(central + 24, 150 * 1024 * 1024 + 1, true)
  await assert.rejects(() => S.unzip(oversized), /150MB/)
})
test('导入支持普通ZIP的deflate-raw条目，并在读取前拒绝100MB以上文件', async () => {
  const source = new TextEncoder().encode('真实纹理数据'.repeat(500)), name = 'image.txt'
  const initial = new Uint8Array(await S.zip([[name, source]]).arrayBuffer()), nameLength = new TextEncoder().encode(name).length
  const centralOffset = 30 + nameLength + source.length, local = initial.slice(0, 30 + nameLength), central = initial.slice(centralOffset, initial.length - 22), end = initial.slice(-22)
  const packed = new Uint8Array(require('node:zlib').deflateRawSync(source))
  const localView = new DataView(local.buffer), centralView = new DataView(central.buffer), endView = new DataView(end.buffer)
  localView.setUint16(8, 8, true); localView.setUint32(18, packed.length, true)
  centralView.setUint16(10, 8, true); centralView.setUint32(20, packed.length, true); endView.setUint32(16, local.length + packed.length, true)
  const zipped = await new Blob([local, packed, central, end]).arrayBuffer()
  assert.deepEqual((await S.unzip(zipped)).get(name), source)
  await assert.rejects(() => S.previewPackage({ size: 101 * 1024 * 1024, arrayBuffer() { throw Error('不应开始读取') } }), /ZIP 不能超过100MB/)
})
test('样例总数、候选待评价数及旧记录身份兼容，公共样例不误计为个人候选', () => {
  S.base = [asset('public')]
  S.assets = [asset('pending', { recordKind: 'design-candidate' }), asset('accepted', { recordKind: 'design-candidate', candidateReview: { status: 'accepted' } }), asset('legacy', { status: '本地保存' }), asset('imported', { status: '本地导入', importedAt: '2026-11-05' })]
  assert.deepEqual(S.stats(), { assets: 5, designTasks: 0, pendingCandidates: 2, inkRuns: 0 })
  assert.equal(S.isCandidate(S.base[0]), false); assert.equal(S.isCandidate(S.assets[3]), false)
  assert.deepEqual(S.librarySamples(S.all()).map(item => item.id), ['imported', 'pending', 'accepted', 'legacy', 'public'])
})
test('配墨快照保留TypedArray；透明像素不进入偏差，关闭全部色层使用白底', () => {
  const model = { width: 2, height: 1, original: new Uint8ClampedArray([50, 50, 50, 255, 255, 0, 0, 0]), assignments: new Uint8Array([0, 0]), colours: [{ r: 50, g: 50, b: 50 }], alphaThreshold: 0 }
  const run = { id: 'ink-1', inputName: '原图', layerCount: 1, difference: 0, snapshot: { version: 1, imageUrl: 'data:image/png;base64,AA==', layers: [{}], renderModel: model, settings: { weight: 10, enabled: [true], selectedLayer: 0, tab: 'overview' } } }
  assert.equal(S.canRestoreInkRun(run), true); assert.equal(S.canRestoreInkRun({ id: 'legacy' }), false)
  assert.equal(S.layerDifference(model, [true]), 0); assert.equal(S.layerDifference(model, [false]), 205)
  assert.equal(structuredClone(run).snapshot.renderModel.original instanceof Uint8ClampedArray, true)
  assert.equal(S.canRestoreInkRun({ ...run, snapshot: { ...run.snapshot, renderModel: { ...model, assignments: new Uint8Array(1) } } }), false)
})
test('长任务进度单调递增，取消立即阻止后续进度，并可清理运行状态', () => {
  const options = S.startDesignRun('run-1')
  options.onProgress({ fraction: .8, phase: '处理中' }); options.onProgress({ fraction: .2, phase: '旧进度' })
  assert.equal(S.designRuns.get('run-1').fraction, .8)
  options.onProgress({ fraction: 1, phase: '保存中' }); assert.equal(S.designRuns.get('run-1').fraction, .99)
  S.designRuns.get('run-1').controller.abort()
  assert.throws(() => S.checkDesignCancelled(options), error => error.name === 'AbortError')
  options.onProgress({ fraction: .9, phase: '不应应用' }); assert.equal(S.designRuns.get('run-1').phase, '保存中')
  S.finishDesignRun('run-1'); assert.equal(S.designRuns.size, 0)
})
test('跨模块事件等待异步导航完成，只派发一次，并携带原样例和任务', async () => {
  const events = [], frames = [], oldWindow = global.window, oldRAF = global.requestAnimationFrame, previousNavigate = S.navigate
  let resolveNavigation
  global.window = { dispatchEvent: event => events.push(event) }; global.requestAnimationFrame = callback => { frames.push(callback); return frames.length }
  S.navigate = () => new Promise(resolve => { resolveNavigation = resolve })
  try {
    const source = asset('source'), opening = S.open('design', source)
    assert.equal(frames.length, 0); assert.equal(events.length, 0)
    resolveNavigation(); await opening
    assert.equal(events.length, 0); assert.equal(frames.length, 1)
    frames.shift()(); frames.shift()()
    assert.equal(events.length, 1); assert.equal(events[0].type, 'dilong-open'); assert.equal(events[0].detail.sample, source); assert.equal(events[0].detail.page, 'design')
  } finally { S.navigate = previousNavigate; global.window = oldWindow; global.requestAnimationFrame = oldRAF }
})
test('多约束推荐必须全部匹配；演示趋势按来源、日期和空间筛选', () => {
  S.base = [asset('yes'), asset('wrongTone', { tone: '深棕' }), asset('wrongMaterial', { wood: '胡桃木' })]
  assert.deepEqual(S.recommend('浅灰橡木', 10).map(item => item.id), ['yes'])
  assert.deepEqual(S.recommend('不认识的方向', 10), [])
  S.originalTrends = JSON.parse(fs.readFileSync(path.join(__dirname, '../../src/data/trends.json'), 'utf8'))
  assert.equal(S.filterOriginal('全平台', '近7天', '全屋空间').length, 2)
  assert.equal(S.filterOriginal('抖音', '近7天', '全屋空间').length, 0)
  assert.match(S.researchOriginal('红棕', ['小红书'], true).summary, /深红棕复古/)
  assert.match(S.researchOriginal('不存在方向', ['小红书'], true).risk, /不能形成结论/)
})
test('HTTP下UUID安全随机回退正确设置版本与variant且不修改Crypto', () => {
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'crypto')
  try {
    const replacement = { getRandomValues(bytes) { assert.equal(this, replacement); for (let index = 0; index < bytes.length; index++) bytes[index] = index; return bytes } }
    Object.defineProperty(globalThis, 'crypto', { configurable: true, value: replacement })
    assert.equal(S.createId(), '00010203-0405-4607-8809-0a0b0c0d0e0f'); assert.equal(replacement.randomUUID, undefined)
    Object.defineProperty(globalThis, 'crypto', { configurable: true, value: {} }); assert.throws(() => S.createId(), /不支持安全随机数/)
  } finally { if (previous) Object.defineProperty(globalThis, 'crypto', previous); else delete globalThis.crypto }
})
