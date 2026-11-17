const { chromium } = require('playwright')
const assert = require('node:assert/strict')
const base = process.env.DILONG_URL || 'http://127.0.0.1:51458'
const focusIs = (page, selector) => page.locator(selector).evaluate(el => el === document.activeElement)
;(async () => {
  const browser = await chromium.launch({ channel: 'chrome', headless: true })
  try {
    const page = await browser.newPage({ viewport: { width: 390, height: 1000 } })
    const errors = []
    page.on('pageerror', error => errors.push(error.message))
    await page.goto(base + '/samples')
    const card = page.locator('.sample-card').first()
    await card.click()
    await page.waitForFunction(() => document.activeElement?.matches('.inspector-head button'))
    await page.keyboard.press('Shift+Tab')
    assert(await focusIs(page, '.inspector-action'), 'Shift+Tab wraps to the last detail action')
    await page.keyboard.press('Tab')
    assert(await focusIs(page, '.inspector-head button'), 'Tab wraps to close')
    await page.locator('.inspector-image .big-image-trigger').click()
    await page.locator('.big-image-dialog[open]').waitFor()
    await page.keyboard.press('Escape')
    await page.locator('.big-image-dialog').waitFor({ state: 'detached' })
    assert.equal(await page.locator('.sample-inspector.open').count(), 1)
    assert(await focusIs(page, '.inspector-image .big-image-trigger'))
    await page.locator('.inspector-action').click()
    await page.locator('.ant-modal:visible').waitFor()
    await page.waitForFunction(() => !!document.activeElement?.closest('.ant-modal-wrap'))
    await page.keyboard.press('Escape')
    await page.locator('.ant-modal:visible').waitFor({ state: 'hidden' })
    assert.equal(await page.locator('.sample-inspector.open').count(), 1)
    await page.waitForFunction(() => document.activeElement?.matches('.inspector-action'))
    await page.keyboard.press('Escape')
    await page.waitForFunction(() => !document.querySelector('.sample-inspector.open'))
    assert(await card.evaluate(el => el === document.activeElement))
    await page.setViewportSize({ width: 1440, height: 1000 })
    await card.click()
    assert(await card.evaluate(el => el === document.activeElement), 'Desktop selection retains focus')
    await page.setViewportSize({ width: 390, height: 1000 })
    await page.waitForFunction(() => document.activeElement?.matches('.inspector-head button'))
    await page.locator('.inspector-head button').click()
    assert(await card.evaluate(el => el === document.activeElement))
    console.log('PASS mobile inspector keyboard cycle, nested viewers, focus return and desktop behavior')

    for (const width of [1440, 390]) {
      await page.setViewportSize({ width, height: 1000 })
      await page.goto(base + '/design')
      for (const mode of ['compare', 'complete']) {
        await page.locator(`[data-design-mode="${mode}"]`).click()
        await page.getByRole('button', { name: '上传图片', exact: true }).click()
        const box = page.locator('.upload-box'), hit = page.locator('.upload-hitarea')
        const bounds = await box.boundingBox(), target = await hit.boundingBox()
        assert(Math.abs(bounds.width - target.width) <= 2 && Math.abs(bounds.height - target.height) <= 2, 'Full upload hit area')
        for (const position of [{ x: 4, y: 4 }, { x: bounds.width - 5, y: bounds.height - 5 }]) {
          const chooser = page.waitForEvent('filechooser')
          await box.click({ position })
          await (await chooser).setFiles([])
        }
        await hit.focus()
        const chooser = page.waitForEvent('filechooser')
        await page.keyboard.press('Enter')
        await (await chooser).setFiles([])
      }
    }
    console.log('PASS compare/completion upload whitespace, corners and keyboard activation on desktop/mobile')

    for (const mode of ['light', 'dark']) {
      await page.evaluate(mode => localStorage.setItem('dilong-theme', mode), mode)
      await page.goto(base + '/design')
      const button = page.locator('.run-button')
      await button.hover()
      await page.waitForTimeout(220)
      const hover = await button.evaluate(el => getComputedStyle(el).backgroundColor)
      await page.mouse.down()
      const pressed = await button.evaluate(el => ({ background: getComputedStyle(el).backgroundColor, transform: getComputedStyle(el).transform }))
      assert.notEqual(hover, pressed.background, mode + ' pressed feedback')
      assert.equal(pressed.transform, 'none')
      await page.mouse.move(0, 0)
      await page.mouse.up()
      for (const width of [320, 390, 760, 1440]) {
        await page.setViewportSize({ width, height: 1000 })
        for (const route of ['/', '/samples', '/design', '/ink', '/production', '/color-compare', '/trends']) {
          await page.goto(base + route)
          await page.locator('main h1').waitFor()
          const result = await page.evaluate(() => ({
            overflow: document.documentElement.scrollWidth > innerWidth + 1,
            small: innerWidth <= 760 ? [...document.querySelectorAll('.dilong-theme button,.dilong-theme select,.dilong-theme summary')].filter(el => el.getClientRects().length && !el.closest('details:not([open]) > :not(summary)')).filter(el => { const r = el.getBoundingClientRect(); return r.width < 43.5 || r.height < 43.5 }).map(el => el.className) : [],
            implicit: [...document.querySelectorAll('.platform-sidebar nav a,.sample-card,.layer-row')].filter(el => getComputedStyle(el).transitionProperty === 'all').map(el => el.className),
          }))
          assert.equal(result.overflow, false, `${route} ${width} ${mode} overflow`)
          assert.deepEqual(result.small, [], `${route} ${width} ${mode} touch targets`)
          assert.deepEqual(result.implicit, [], `${route} transition properties`)
          if (route === '/color-compare' || route === '/trends') {
            const headings = page.locator(route === '/color-compare' ? '.cc-grid .panel-header h2' : '.trend-page ._resultHead_1w9oj_1 h2')
            assert(await headings.count() > 0)
            for (const heading of await headings.all()) assert.deepEqual(await heading.evaluate(el => ({ size: getComputedStyle(el).fontSize, weight: getComputedStyle(el).fontWeight })), { size: '16px', weight: '600' })
          }
        }
      }
    }
    assert.deepEqual(errors, [])
    console.log('PASS 56 route/theme/width checks: touch targets, headings, transitions, overflow; primary pressed colors')
  } finally { await browser.close() }
})().catch(error => { console.error(error); process.exitCode = 1 })
