const { chromium } = require('playwright')
const assert = require('node:assert/strict')
const base = process.env.DILONG_TEST_BASE || 'http://127.0.0.1:51458'

;(async () => {
  const browser = await chromium.launch({ channel: 'chrome', headless: true })
  const page = await browser.newPage({ viewport: { width: 1600, height: 840 } }), errors = []
  page.on('pageerror', error => errors.push(error.message))
  const metric = page.locator('[data-metric="deltaE"]')
  const generate = () => page.getByRole('button', { name: '生成配墨建议', exact: true }).click()
  const upload = (side, name, buffer) => page.getByLabel(side === 0 ? '上传目标颜色照片' : '上传实际涂层照片', { exact: true }).setInputFiles({ name, mimeType: 'image/png', buffer })
  const holdNextImage = () => page.evaluate(() => {
    const OriginalImage = window.Image
    window.Image = function () {
      window.Image = OriginalImage
      const image = new OriginalImage(), setter = Object.getOwnPropertyDescriptor(HTMLImageElement.prototype, 'src').set
      Object.defineProperty(image, 'src', { set(value) { window.releaseHeldImage = () => setter.call(image, value) } })
      return image
    }
  })
  try {
    for (const route of ['production', 'color-compare']) {
      await page.goto(base + '/' + route)
      if (route === 'production') await page.waitForFunction(() => document.querySelector('.pc-work-status')?.textContent.includes('分析完成'))
      for (const width of [1600, 768, 390, 320]) {
        await page.setViewportSize({ width, height: 840 })
        await page.locator(route === 'production' ? '.pc-metric' : '.cc-result-card').first().click()
        const dialog = page.locator('dialog[open]')
        await dialog.waitFor()
        const checkGeometry = async () => {
          const box = await dialog.evaluate(element => {
            const r = element.getBoundingClientRect()
            return { x: r.x, y: r.y, w: r.width, h: r.height, overflow: element.scrollWidth - element.clientWidth }
          })
          assert(Math.abs(box.x + box.w / 2 - width / 2) < 1, `${route} ${width}: horizontal center`)
          assert(Math.abs(box.y + box.h / 2 - 420) < 1, `${route} ${width}: vertical center`)
          assert(box.x >= 12 && box.y >= 12 && box.h <= 816 && box.overflow <= 1, `${route} ${width}: fits viewport`)
        }
        await checkGeometry()
        await dialog.locator('details summary').first().click()
        await checkGeometry()
        await page.keyboard.press('Escape')
        await dialog.waitFor({ state: 'hidden' })
      }
    }

    await page.setViewportSize({ width: 1600, height: 840 })
    await page.getByRole('button', { name: '恢复演示', exact: true }).click()
    const actual = page.locator('.cc-actual img'), originalSource = await actual.getAttribute('src')
    const originalMeasurement = await metric.innerText(), previousTable = await page.locator('.cc-recipe table').innerText()
    await page.getByRole('checkbox', { name: '颜色比对色墨组合：蓝墨', exact: true }).uncheck()
    await page.getByLabel('颜色比对配墨重量', { exact: true }).fill('12')
    assert.equal(await page.locator('.cc-recipe table').innerText(), previousTable)
    await generate()
    assert.equal(await actual.getAttribute('src'), originalSource)
    assert.equal(await metric.innerText(), originalMeasurement)
    assert.match(await page.locator('.cc-recipe table').innerText(), /12\.00 kg/)
    assert.match(await page.locator('tr[data-ink="blue"]').innerText(), /0%\s+0\.00 kg/)

    const picture = Buffer.from(await page.evaluate(() => {
      const canvas = document.createElement('canvas'); canvas.width = 24; canvas.height = 24
      const ctx = canvas.getContext('2d'); ctx.fillStyle = '#a08264'; ctx.fillRect(0, 0, 24, 24)
      return canvas.toDataURL().split(',')[1]
    }), 'base64')
    // A recipe confirmation does not invalidate an in-flight photo of the same target.
    await holdNextImage()
    await upload(1, 'held-actual.png', picture)
    await page.getByRole('checkbox', { name: '颜色比对色墨组合：蓝墨', exact: true }).check()
    await generate()
    await page.evaluate(() => window.releaseHeldImage())
    await page.locator('.cc-actual img[alt="held-actual.png"]').waitFor()
    assert.equal(await metric.innerText(), '0.00')

    // A new target still invalidates an older actual-image decode callback.
    await holdNextImage()
    await upload(1, 'stale-actual.png', picture)
    await upload(0, 'new-target.png', picture)
    await page.locator('.cc-target img[alt="new-target.png"]').waitFor()
    await page.evaluate(async () => {
      window.releaseHeldImage()
      await new Promise(resolve => setTimeout(resolve, 150))
    })
    assert.equal(await actual.count(), 0)
    assert.equal(await metric.innerText(), '—')
    assert.equal(await page.locator('.cc-recipe table').count(), 0)
    assert.deepEqual(errors, [])
    console.log('PASS measurement dialogs centered at four viewport widths, retained photo/metrics across recipe confirmation, draft boundary, pending actual upload and stale target replacement')
  } finally { await browser.close() }
})().catch(error => { console.error(error); process.exitCode = 1 })
