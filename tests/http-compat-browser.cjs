'use strict';
const { chromium } = require(process.env.DILONG_PLAYWRIGHT || 'playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

(async () => {
  const root = path.resolve(__dirname, '..');
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  try {
    for (const scenario of [
      { name: '普通 HTTP IP', url: 'http://192.0.2.1:8004/index.html', secure: false },
      { name: 'HTTPS', url: 'https://192.0.2.1:8004/index.html', secure: true },
      { name: '本机 HTTP', url: 'http://127.0.0.1:48004/index.html', secure: true }
    ]) {
      const context = await browser.newContext();
      try {
        // Fulfill local files at real browser origins without contacting this
        // reserved test IP. Never fake isSecureContext, Crypto or Web Locks.
        await context.route('**/*', async route => {
          const url = new URL(route.request().url());
          const file = path.resolve(root, '.' + decodeURIComponent(url.pathname));
          if (!file.startsWith(root + path.sep)) { await route.fulfill({ status: 404, body: '' }); return; }
          try {
            const body = await fs.readFile(file);
            const contentType = {
              '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
              '.css': 'text/css; charset=utf-8', '.png': 'image/png', '.webp': 'image/webp', '.svg': 'image/svg+xml'
            }[path.extname(file)] || 'application/octet-stream';
            await route.fulfill({ status: 200, body, contentType });
          } catch (_) { await route.fulfill({ status: 404, body: '' }); }
        });
        await context.addInitScript(() => { window.nativeUUIDBeforeStartup = crypto.randomUUID; });
        const page = await context.newPage(), errors = [];
        page.on('pageerror', error => errors.push(error.message));
        page.setDefaultTimeout(10000);
        await page.goto(scenario.url);
        await page.locator('.platform-shell').waitFor({ state: 'visible' });
        await page.evaluate(() => DilongStage1.ready);
        await page.waitForFunction(() => DilongStage1.operations.ink?.state === 'ready');
        const runtime = await page.evaluate(() => {
          const ids = Array.from({ length: 512 }, () => DilongStage1.createId());
          return { secure: isSecureContext, nativeUUID: typeof crypto.randomUUID, locks: typeof navigator.locks,
            nativeUnchanged: crypto.randomUUID === nativeUUIDBeforeStartup, ids, unique: new Set(ids).size };
        });
        assert.equal(runtime.secure, scenario.secure);
        assert.equal(runtime.nativeUUID, scenario.secure ? 'function' : 'undefined');
        assert(runtime.nativeUnchanged, 'application code must preserve the native Crypto API');
        assert(runtime.ids.every(id => uuid.test(id)));
        assert.equal(runtime.unique, runtime.ids.length);
        console.log('PASS ' + scenario.name + '：原生能力检测、启动、UUID v4 格式与唯一性');

        if (!scenario.secure) {
          assert.equal(runtime.locks, 'undefined');
          await page.locator('nav button').filter({ hasText: '设计智能体' }).click();
          await page.getByRole('button', { name: '开始相似检索', exact: true }).click();
          await page.waitForFunction(() => DilongStage1.tasks.length === 1 && DilongStage1.tasks[0].status === '已处理');
          await page.getByRole('button', { name: '保存候选方案', exact: true }).first().click();
          await page.waitForFunction(() => DilongStage1.assets.length === 1 && DilongStage1.tasks[0].resultIds.length === 1);
          await page.evaluate(() => DilongStage1.open('color', DilongStage1.assets[0]));
          await page.waitForFunction(() => DilongStage1.inkRuns.length === 1);
          const snapshot = () => page.evaluate(() => {
            const S = DilongStage1, task = S.tasks[0];
            return { task: { id: task.id, ownerId: task.ownerId, runKey: task.runKey, resultIds: task.resultIds, status: task.status },
              assetId: S.assets[0].id, inkId: S.inkRuns[0].id, inkRestorable: S.canRestoreInkRun(S.inkRuns[0]),
              counts: [S.tasks.length, S.assets.length, S.inkRuns.length] };
          });
          const saved = await snapshot();
          for (const key of ['id', 'ownerId', 'runKey']) assert(uuid.test(saved.task[key]), key);
          assert(uuid.test(saved.assetId.slice('LOCAL-'.length)));
          assert(/^ink-[0-9a-f-]{36}-\d+$/i.test(saved.inkId));
          assert(saved.inkRestorable);
          await page.reload();
          await page.evaluate(() => DilongStage1.ready);
          await page.waitForFunction(() => DilongStage1.operations.ink?.state === 'ready');
          assert.deepEqual(await snapshot(), saved, 'all records, IDs and associations survive HTTP reload');
          await page.evaluate(() => DilongStage1.openInkRun(DilongStage1.inkRuns[0]));
          await page.locator('.app-shell.embedded-module').waitFor({ state: 'visible' });
          await page.waitForFunction(() => document.querySelector('.ink-run-info strong')?.textContent.endsWith(DilongStage1.inkRuns[0].inputName));
          console.log('PASS 普通 HTTP：真实设计、候选保存、配墨记录、刷新持久化及历史恢复');

          // Simulate an unfinished record in this isolated context. Without Web
          // Locks it must remain uncertain; a UUID fallback cannot prove liveness.
          await page.evaluate(id => DilongStage1.updateTask(id, { status: '处理中' }), saved.task.id);
          await page.reload(); await page.evaluate(() => DilongStage1.ready);
          const recovered = await page.evaluate(() => ({ status: DilongStage1.tasks[0].status,
            results: DilongStage1.tasks[0].resultIds, counts: [DilongStage1.tasks.length, DilongStage1.assets.length, DilongStage1.inkRuns.length] }));
          assert.equal(recovered.status, '状态待确认');
          assert.deepEqual(recovered.results, saved.task.resultIds);
          assert.deepEqual(recovered.counts, saved.counts);
          const persistedStatus = await page.evaluate(id => new Promise((resolve, reject) => {
            const open = indexedDB.open('dilong-workflows');
            open.onerror = () => reject(open.error);
            open.onsuccess = () => {
              const db = open.result, read = db.transaction('tasks').objectStore('tasks').get(id);
              read.onerror = () => { db.close(); reject(read.error); };
              read.onsuccess = () => { db.close(); resolve(read.result.status); };
            };
          }), saved.task.id);
          assert.equal(persistedStatus, '处理中', 'missing Web Locks must not overwrite another page\'s task status');
          console.log('PASS 普通 HTTP：缺少 Web Locks 时保持保守恢复，不误判或覆盖任务');
        }
        assert.deepEqual(errors, [], scenario.name + ': no uncaught page errors');
      } finally { await context.close(); }
    }
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
