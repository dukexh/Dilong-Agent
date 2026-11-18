const { chromium } = require('playwright')
const assert = require('node:assert/strict')
const { records, untilRecords } = require('../helpers/database.cjs')
const base = process.env.DILONG_URL || 'http://127.0.0.1:51458'

async function counts(page) {
  const [tasks, assets] = await Promise.all([records(page, 'tasks'), records(page, 'assets')])
  return { tasks: tasks.length, assets: assets.length }
}
async function results(page) {
  await page.waitForFunction(() => document.querySelectorAll('.candidate-card').length === 5)
  return page.locator('.candidate-title strong').allTextContents()
}

;(async () => {
  const browser = await chromium.launch({ channel: 'chrome', headless: true })
  try {
    const context = await browser.newContext(), page = await context.newPage()
    await require('../helpers/model-api.cjs')(context)
    await page.goto(base + '/design')
    const initial = await results(page)
    assert.deepEqual(await counts(page), { tasks: 0, assets: 0 })
    await page.locator('.run-button').click()
    await page.waitForFunction(() => !document.querySelector('.run-button').disabled)
    assert.deepEqual(await results(page), initial)
    assert.equal((await counts(page)).tasks, 1)
    await context.close()
    console.log('PASS default candidates match manual search without automatic task/history writes')

    // Hold the index request to exercise edits while the initial lookup is in flight.
    for (const action of ['scope', 'manual']) {
      const context = await browser.newContext(), page = await context.newPage()
      await require('../helpers/model-api.cjs')(context)
      let release, firstRequest
      const hold = new Promise(resolve => { release = resolve })
      const requested = new Promise(resolve => { firstRequest = resolve })
      let requests = 0
      await page.route('**/texture-search/manifest.json', async route => {
        if (++requests === 1) { firstRequest(); await hold }
        await route.continue().catch(() => {})
      })
      await page.goto(base + '/design')
      await requested
      if (action === 'scope') {
        await page.getByLabel('搜图范围', { exact: true }).selectOption('mine')
        release()
        await page.waitForTimeout(500)
        assert.equal(await page.locator('.candidate-card').count(), 0)
        assert.equal(await page.locator('.design-error').count(), 0)
        assert.deepEqual(await counts(page), { tasks: 0, assets: 0 })
        await page.locator('.restore-demo').click()
        await results(page)
        assert.deepEqual(await counts(page), { tasks: 0, assets: 0 })
        await page.locator('.candidate-save button').first().click()
        await untilRecords(page, 'assets', rows => rows.length === 1)
        assert.deepEqual(await counts(page), { tasks: 0, assets: 1 })
      } else {
        await page.locator('.run-button').click()
        release()
        await results(page)
        assert.equal((await counts(page)).tasks, 1)
        assert.equal(await page.locator('.design-error').count(), 0)
      }
      await context.close()
      console.log(`PASS pending default lookup: ${action} cancels stale results; saving/restoring remain available`)
    }
  } finally { await browser.close() }
})().catch(error => { console.error(error); process.exitCode = 1 })
