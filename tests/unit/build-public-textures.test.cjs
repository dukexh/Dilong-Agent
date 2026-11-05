const test = require('node:test'), assert = require('node:assert/strict')
const fs = require('node:fs/promises'), path = require('node:path'), os = require('node:os')
const { tsImport } = require('tsx/esm/api')
const tool = tsImport('../../scripts/build-public-textures.ts', __filename)
const row = (id, patch = {}) => ({ id, name: id, category: 'wood', tags: ['wood'], source: 'fixture', source_id: id, imageUrl: 'image.png', thumbnail: 'thumb.png', width: 32, height: 24, source_url: 'https://example.invalid/' + id, license: 'CC0', license_url: 'https://example.invalid/license', ...patch })
async function temporary(t) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'dilong-textures-unit-'))
  t.after(async () => { const target = path.resolve(directory), parent = path.resolve(os.tmpdir()) + path.sep; if (!target.startsWith(parent)) throw Error('Unexpected cleanup target'); await fs.rm(target, { recursive: true, force: true }) })
  return directory
}
test('纹理构建参数默认指向Vue public素材目录，临时output和catalog可独立覆盖', async () => {
  const { parseArgs } = await tool, defaults = parseArgs(['input']), custom = parseArgs(['input', '--output', 'temporary-output', '--catalog', 'temporary-catalog.json'])
  assert.equal(defaults.output, path.resolve(__dirname, '../../public/public-textures')); assert.equal(defaults.catalog, path.resolve(__dirname, '../../src/data/public-catalog.json'))
  assert.equal(custom.input, path.resolve('input')); assert.equal(custom.output, path.resolve('temporary-output')); assert.equal(custom.catalog, path.resolve('temporary-catalog.json'))
  for (const args of [[], ['input', '--output'], ['input', '--catalog', '--output'], ['input', '--unknown'], ['input', 'extra']]) assert.throws(() => parseArgs(args))
})
test('纹理构建保留原样例去重规则，并跳过输入中的重复编号和重复来源', async () => {
  const { selectRows } = await tool
  const input = [row('old', { source: 'polyhaven', source_id: 'base-wood' }), row('new'), row('same-source', { source_id: 'new' }), row('new', { source_id: 'different' }), row('other-source', { source: 'ambientcg', source_id: 'base-wood' })]
  assert.deepEqual(selectRows(input, [{ assetId: 'base-wood' }]).map(record => record.id), ['new', 'other-source'])
})
test('纹理清单缺少必要字段、非法编号或无效尺寸时给出明确错误', async () => {
  const { readRows } = await tool
  assert.deepEqual(readRows([row('valid')]), [row('valid')]); assert.throws(() => readRows({}), /array/)
  for (const input of [null, row('../escape'), row('invalid', { tags: 'wood' }), row('invalid', { width: 0 }), row('invalid', { height: 1.5 }), row('invalid', { source: '' })]) assert.throws(() => readRows([input]))
})
test('已有输出目录在读取输入或启动浏览器前拒绝覆盖，已有catalog保持不变', async t => {
  const { buildPublicTextures } = await tool, directory = await temporary(t), output = path.join(directory, 'existing'), catalog = path.join(directory, 'catalog.json')
  await fs.mkdir(output); await fs.writeFile(path.join(output, 'keep.txt'), 'keep'); await fs.writeFile(catalog, 'old-index')
  await assert.rejects(() => buildPublicTextures({ input: path.join(directory, 'missing-input'), output, catalog }), /Refusing to overwrite/)
  assert.equal(await fs.readFile(path.join(output, 'keep.txt'), 'utf8'), 'keep'); assert.equal(await fs.readFile(catalog, 'utf8'), 'old-index')
})
test('全部图片已在原样例库中时不启动浏览器，仍生成一致的空目录与双catalog格式', async t => {
  const { buildPublicTextures } = await tool, directory = await temporary(t), input = path.join(directory, 'input'), output = path.join(directory, 'output'), catalog = path.join(directory, 'catalog.json')
  const base = JSON.parse(await fs.readFile(path.resolve(__dirname, '../../src/data/base-samples.json'), 'utf8'))
  await fs.mkdir(input); await fs.writeFile(path.join(input, 'manifest.json'), JSON.stringify([row('existing', { source: 'polyhaven', source_id: base[0].assetId })]))
  assert.deepEqual(await buildPublicTextures({ input, output, catalog }), { input: 1, existingSkipped: 1, added: 0 })
  assert.deepEqual(JSON.parse(await fs.readFile(catalog, 'utf8')), []); assert.match(await fs.readFile(path.join(output, 'catalog.js'), 'utf8'), /window\.DilongPublicTextureData=\{"version":1,"records":\[\]\}/)
  assert.deepEqual(await fs.readdir(path.join(output, 'images')), []); assert.deepEqual(await fs.readdir(path.join(output, 'thumbnails')), [])
})
