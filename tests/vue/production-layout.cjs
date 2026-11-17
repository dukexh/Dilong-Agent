const { chromium } = require('playwright')
const assert = require('node:assert/strict')
const fs = require('node:fs'), path = require('node:path')
const base = process.env.DILONG_URL || 'http://127.0.0.1:51458'
const output = path.resolve('verification/production-workbench')
fs.mkdirSync(output, { recursive: true })

;(async () => {
  const browser = await chromium.launch({ channel: 'chrome', headless: true }), cases = []
  try {
    for (const theme of ['light', 'dark']) {
      const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } })
      await context.addInitScript(value => localStorage.setItem('dilong-theme', value), theme)
      const page = await context.newPage(), errors = []
      page.on('pageerror', error => errors.push(error.message))
      await page.goto(base + '/production')
      await page.waitForFunction(() => document.querySelector('.pc-work-status')?.textContent.includes('分析完成'))
      const initial = await page.evaluate(() => {
        const image = document.querySelector('.source-frame').getBoundingClientRect()
        const run = document.querySelector('.pc-run').getBoundingClientRect()
        return { imageTop: image.top, imageBottom: image.bottom, runTop: run.top, runBottom: run.bottom }
      })
      assert(initial.imageTop < 450, 'Input images should be prominent in the first viewport')
      assert(initial.runBottom < 1000, 'Confirmation should be reachable in the first desktop viewport')
      assert(initial.runTop - initial.imageBottom < 220, 'Confirmation must stay adjacent to selection')
      if (theme === 'light') await page.screenshot({ path: path.join(output, 'initial.png'), fullPage: true })
      const values = await page.locator('.comparison-metric strong').allTextContents()
      for (const width of [1440, 1120, 900, 390, 320]) {
        await page.setViewportSize({ width, height: 1000 })
        for (const mode of ['并排对照', '色差热图']) {
          await page.getByRole('button', { name: mode, exact: true }).click()
          const geometry = await page.evaluate(() => {
            const boxes = [...document.querySelectorAll('.inspect-image')].map(el => {
              const rect = el.getBoundingClientRect()
              return { width: rect.width, height: rect.height, bottom: rect.bottom }
            })
            return { boxes, hintTop: document.querySelector('.inspect-hint').getBoundingClientRect().top, overflow: document.documentElement.scrollWidth > innerWidth + 1 }
          })
          assert(!geometry.overflow, `${theme} ${width} ${mode}: horizontal overflow`)
          assert(geometry.boxes.every(box => box.width >= (width >= 900 ? 300 : 220)), `${width} ${mode}: primary image compressed by secondary content`)
          assert(geometry.hintTop >= Math.max(...geometry.boxes.map(box => box.bottom)), 'Inspection hint must follow the image, not compete alongside it')
          assert.deepEqual(await page.locator('.comparison-metric strong').allTextContents(), values)
          cases.push({ theme, width, mode, ...geometry })
        }
        if (width === 1440 || (theme === 'light' && width === 390)) {
          await page.evaluate(() => scrollTo(0, 0))
          await page.screenshot({ path: path.join(output, `heat-${theme}-${width}.png`), fullPage: true })
        }
      }
      assert.deepEqual(errors, [])
      cases.push({ theme, initial })
      await context.close()
    }
    fs.writeFileSync(path.join(output, 'results.json'), JSON.stringify(cases, null, 2))
    console.log('PASS production image prominence, adjacent confirmation, result modes, unchanged metrics and 20 responsive/theme states')
  } finally { await browser.close() }
})().catch(error => { console.error(error); process.exitCode = 1 })
