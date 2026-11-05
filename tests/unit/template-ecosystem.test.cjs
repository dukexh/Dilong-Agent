const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs'), path = require('node:path')
const root = path.resolve(__dirname, '../..')
const read = name => JSON.parse(fs.readFileSync(path.join(root, name), 'utf8'))

test('shared template dependencies stay pinned in manifest, lockfile and installation', () => {
  const { versions } = read('config/template-ecosystem.json')
  const manifest = read('package.json'), lock = read('package-lock.json')
  for (const [name, version] of Object.entries(versions)) {
    assert.equal(manifest.dependencies?.[name] || manifest.devDependencies?.[name], version, name + ' manifest')
    assert.equal(lock.packages['node_modules/' + name]?.version, version, name + ' lockfile')
    assert.equal(read('node_modules/' + name + '/package.json').version, version, name + ' installation')
  }
})
