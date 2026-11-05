const { chromium } = require('playwright')
const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path'), os = require('node:os')
const base = process.env.DILONG_URL || 'http://127.0.0.1:51458'
;(async () => {
  const browser = await chromium.launch({ channel: 'chrome', headless: true })
  let server, cache
  try {
    const context = await browser.newContext(), page = await context.newPage(), errors = []
    page.on('pageerror', error => errors.push(error.message))
    await page.goto(base, { waitUntil: 'networkidle' })
    assert.equal(await page.locator('#__vue-devtools-container__').count(), 0)
    await page.evaluate(async () => {
      const { mountFixture } = await import('/tests/fixtures/template-jsx.tsx')
      const host = document.createElement('div'); host.id = 'jsx-fixture'; document.body.append(host)
      window.__unmountJSX = mountFixture(host)
    })
    await page.locator('#jsx-fixture button').click()
    assert.equal(await page.locator('#jsx-fixture').textContent(), 'JSX 1')
    await page.evaluate(() => { window.__unmountJSX(); document.querySelector('#jsx-fixture').remove() })
    assert.deepEqual(errors, [])
    console.log('PASS 正常工作台不显示开发工具；Vue JSX真实挂载和响应式点击通过')
    await context.close()

    cache = fs.mkdtempSync(path.join(os.tmpdir(), 'dilong-tools-test-'))
    const { createServer } = await import('vite')
    server = await createServer({ mode: 'tools', cacheDir: cache, server: { host: '127.0.0.1', port: 0, strictPort: false }, logLevel: 'error' })
    await server.listen()
    const toolsBase = 'http://127.0.0.1:' + server.httpServer.address().port
    for (const denied of [false, true]) {
      const c = await browser.newContext(), p = await c.newPage(), failures = []
      p.on('pageerror', error => failures.push(error.message))
      if (denied) await c.addInitScript(() => Object.defineProperty(window, 'localStorage', { get() { throw new DOMException('blocked', 'SecurityError') } }))
      await p.goto(toolsBase, { waitUntil: 'networkidle' })
      await p.locator('h1').waitFor()
      if (denied) assert.equal(await p.locator('#__vue-devtools-container__').count(), 0)
      else await p.locator('#__vue-devtools-container__').waitFor({ state: 'attached' })
      await p.getByRole('button', { name: '切换深色', exact: true }).click()
      assert.equal(await p.locator('html').getAttribute('data-theme'), 'dark')
      assert.deepEqual(failures, [])
      console.log('PASS 模板Devtools tools模式' + (denied ? '存储受限仍可启动和切换主题' : '加载真实工具客户端'))
      await c.close()
    }
  } finally {
    await server?.close()
    await browser.close()
    if (cache && path.dirname(path.resolve(cache)) === path.resolve(os.tmpdir()) && path.basename(cache).startsWith('dilong-tools-test-')) fs.rmSync(cache, { recursive: true, force: true })
  }
})().catch(error => { console.error(error); process.exitCode = 1 })
