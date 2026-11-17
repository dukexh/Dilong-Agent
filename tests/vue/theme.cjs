const { chromium } = require('playwright')
const assert = require('node:assert/strict')
const fs = require('node:fs'), path = require('node:path')
const base = process.env.DILONG_URL || 'http://127.0.0.1:51458'
const output = path.resolve('verification/harness-theme')
fs.mkdirSync(output, { recursive: true })

;(async () => {
  const browser = await chromium.launch({ channel: 'chrome', headless: true })
  const results = []
  try {
    for (const mode of ['light', 'dark']) {
      const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } })
      await context.addInitScript(value => localStorage.setItem('dilong-theme', value), mode)
      const page = await context.newPage(), errors = []
      page.on('pageerror', error => errors.push(error.message))
      try {
        const checkDialog = async (name, selector) => {
          const dialog = page.locator(selector)
          await dialog.waitFor()
          await page.waitForTimeout(300)
          const style = await dialog.evaluate(el => {
            const css = getComputedStyle(el)
            const mask = document.querySelector('.ant-modal-mask')
            return {
              background: css.backgroundColor, color: css.color, radius: css.borderRadius,
              surface: css.getPropertyValue('--dl-surface').trim(),
              blur: el.tagName === 'DIALOG' ? getComputedStyle(el, '::backdrop').backdropFilter : getComputedStyle(mask).backdropFilter,
              overflow: document.documentElement.scrollWidth > innerWidth + 1,
            }
          })
          assert.equal(style.radius, '28px', `${name}: panel radius`)
          assert.equal(style.background, mode === 'dark' ? 'rgb(35, 35, 36)' : 'rgb(255, 255, 255)')
          assert.equal(style.color, mode === 'dark' ? 'rgb(249, 250, 251)' : 'rgb(15, 17, 21)')
          assert(style.surface, `${name}: teleported content must inherit local tokens`)
          assert.equal(style.blur, 'none')
          assert.equal(style.overflow, false)
          await page.screenshot({ path: path.join(output, `${name}-${mode}.png`) })
          results.push({ name, mode, ...style })
        }
        await page.goto(base + '/samples')
        await page.getByRole('button', { name: '导入样例文件包', exact: true }).click()
        await checkDialog('import', '.ant-modal-content')
        await page.locator('.ant-modal-close').click()
        await page.locator('.ant-modal:visible').waitFor({ state: 'hidden' })
        await page.goto(base + '/design')
        const primary = await page.locator('.run-button').evaluate(el => ({ background: getComputedStyle(el).backgroundColor, color: getComputedStyle(el).color }))
        assert.equal(primary.background, mode === 'dark' ? 'rgb(249, 250, 251)' : 'rgb(15, 17, 21)')
        assert.equal(primary.color, mode === 'dark' ? 'rgb(15, 17, 21)' : 'rgb(255, 255, 255)')
        await page.locator('.source-image .big-image-trigger').click()
        await checkDialog('image', '.big-image-dialog[open]')
        await page.getByRole('button', { name: '关闭大图', exact: true }).click()
        await page.locator('.source-panel .engineering-export-button').click()
        await checkDialog('engineering', '.engineering-dialog[open]')
        await page.locator('.engineering-dialog').getByRole('button', { name: '关闭', exact: true }).click()
        await page.goto(base + '/color-compare')
        await page.locator('.cc-result-card').first().click()
        await checkDialog('metric', '.color-metric-dialog[open]')
        assert.deepEqual(errors, [])
      } finally { await context.close() }
    }
  } finally { await browser.close() }
  fs.writeFileSync(path.join(output, 'results.json'), JSON.stringify(results, null, 2))
  console.log('PASS Harness light/dark primary controls and 8 teleported dialog surfaces, radius, mask and overflow')
})().catch(error => { console.error(error); process.exitCode = 1 })
