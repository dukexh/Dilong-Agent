'use strict';
const { chromium } = require(process.env.DILONG_PLAYWRIGHT || 'playwright');
const fs = require('node:fs'), path = require('node:path'), http = require('node:http'), assert = require('node:assert/strict');
(async () => {
  const root = path.resolve(__dirname, '..');
  const server = http.createServer((req, res) => {
    const file = path.join(root, decodeURIComponent(req.url.split('?')[0]));
    fs.readFile(file, (error, body) => { res.statusCode = error ? 404 : 200; res.setHeader('Content-Type', file.endsWith('.js') ? 'text/javascript' : file.endsWith('.css') ? 'text/css' : 'text/html'); res.end(error ? '' : body); });
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  try {
    const context = await browser.newContext(), a = await context.newPage(), b = await context.newPage(), errors = [];
    for (const page of [a,b]) page.on('pageerror', error => errors.push(error.message));
    const url = `http://127.0.0.1:${server.address().port}/index.html`;
    await a.goto(url); await a.evaluate(() => DilongStage1.ready);
    const id = await a.evaluate(async () => {
      const c = document.createElement('canvas'); c.width = c.height = 16; c.getContext('2d').fillRect(0,0,16,16);
      return (await DilongStage1.save(c.toDataURL(), '同步测试', 'test', {}, 'tab-sync')).id;
    });
    await b.goto(url); await b.evaluate(() => DilongStage1.ready);
    await b.evaluate(() => { window.keepPage = true; });
    await b.locator('nav button').filter({hasText:'生产比对'}).click();
    await b.locator('.production-compare input').first().fill('保留比对输入');
    await a.evaluate(id => DilongStage1.updateAsset(id, { name:'A已修改' }), id);
    await b.waitForFunction(id => DilongStage1.assets.find(x=>x.id===id)?.name==='A已修改', id);
    assert.equal(await b.evaluate(() => window.keepPage), true);
    assert.equal(await b.locator('.production-compare input').first().inputValue(), '保留比对输入');
    console.log('PASS 自动更新数据，不重载页面或清空生产比对输入');

    await b.evaluate(id => DilongStage1.startEdit(DilongStage1.assets.find(x=>x.id===id)), id);
    const editor = b.locator('.stage1-edit-dialog');
    await editor.getByLabel('样例名称', {exact:true}).fill('B未保存内容');
    await a.evaluate(id => DilongStage1.updateAsset(id, { name:'A第二次修改' }), id);
    await editor.getByRole('alert').waitFor();
    assert.equal(await editor.getByLabel('样例名称', {exact:true}).inputValue(), 'B未保存内容');
    assert(await editor.getByRole('button', {name:'保存样例信息',exact:true}).isDisabled());
    b.once('dialog', dialog => dialog.accept());
    await editor.getByRole('button', {name:'重新加载最新内容',exact:true}).click();
    assert.equal(await editor.getByLabel('样例名称', {exact:true}).inputValue(), 'A第二次修改');
    await editor.getByLabel('样例名称', {exact:true}).fill('B确认后修改');
    await editor.getByRole('button', {name:'保存样例信息',exact:true}).click();
    await editor.waitFor({state:'hidden'});
    await a.waitForFunction(id=>DilongStage1.assets.find(x=>x.id===id)?.name==='B确认后修改',id);
    console.log('PASS 冲突保留草稿，确认重新加载后可保存，双向通知生效');

    await b.evaluate(id=>DilongStage1.startEdit(DilongStage1.assets.find(x=>x.id===id)),id);
    await editor.getByLabel('样例名称',{exact:true}).fill('不能复活');
    await a.evaluate(id=>DilongStage1.deleteAsset(id),id);
    await editor.getByText(/该记录已在其他页面删除/).waitFor();
    assert.equal(await editor.getByLabel('样例名称',{exact:true}).inputValue(),'不能复活');
    assert(await editor.getByRole('button',{name:'保存样例信息',exact:true}).isDisabled());
    await editor.getByRole('button',{name:'取消',exact:true}).click();
    console.log('PASS 删除通知保留正在编辑的内容，同时阻止恢复已删除记录');

    // No notifications: exercise transaction protection independently of UI sync.
    const c = await context.newPage();
    await c.addInitScript(() => { window.BroadcastChannel = undefined; });
    const nextId = await a.evaluate(async()=> (await DilongStage1.save(DilongStage1.base[0].imageUrl,'离线通知测试','test',{},'no-notification')).id);
    await c.goto(url);await c.evaluate(()=>DilongStage1.ready);
    await a.evaluate(id=>DilongStage1.updateAsset(id,{name:'数据库最新值'}),nextId);
    const staleEdit = await c.evaluate(async id=>{try{await DilongStage1.updateAsset(id,{name:'旧值覆盖'});return 'saved'}catch(e){return e.code}},nextId);
    assert.equal(staleEdit,'DATA_CONFLICT');
    await a.evaluate(id=>DilongStage1.deleteAsset(id),nextId);
    const staleReview = await c.evaluate(async id=>{try{await DilongStage1.reviewCandidate(id,'accepted');return 'saved'}catch(e){return e.code}},nextId);
    assert.equal(staleReview,'DATA_CONFLICT');
    await c.reload();await c.evaluate(()=>DilongStage1.ready);
    assert.equal(await c.evaluate(id=>DilongStage1.assets.some(x=>x.id===id),nextId),false);
    console.log('PASS 无通知时仍拒绝旧版本写入及已删除候选评价，刷新不复活');

    const ids = await a.evaluate(async()=>{
      const S=DilongStage1;
      return Promise.all(['first','second'].map(async key=>(await S.save(S.base[0].imageUrl,key,'test',{},'parallel-'+key)).id));
    });
    await b.waitForFunction(ids=>ids.every(id=>DilongStage1.assets.some(x=>x.id===id)),ids);
    for(const page of [a,b]) await page.evaluate(id=>{window.editBaseline=DilongStage1.assets.find(x=>x.id===id)},ids[0]);
    const competing=await Promise.all([a,b].map((page,i)=>page.evaluate(async i=>{
      try{await DilongStage1.updateAsset(editBaseline.id,{name:'并发-'+i},editBaseline);return 'saved'}catch(e){return e.code}
    },i)));
    assert.deepEqual(competing.sort(),['DATA_CONFLICT','saved']);
    for(const page of [a,b])await page.waitForFunction(id=>DilongStage1.assets.find(x=>x.id===id)?.name.startsWith('并发-'),ids[0]);
    await b.waitForFunction(ids=>DilongStage1.assets.some(x=>x.id===ids[1]),ids);
    await Promise.all([a.evaluate(id=>DilongStage1.updateAsset(id,{name:'独立一'}),ids[0]),b.evaluate(id=>DilongStage1.updateAsset(id,{name:'独立二'}),ids[1])]);
    await a.waitForFunction(id=>DilongStage1.assets.find(x=>x.id===id)?.name==='独立二',ids[1]);
    await b.waitForFunction(id=>DilongStage1.assets.find(x=>x.id===id)?.name==='独立一',ids[0]);
    console.log('PASS 同记录并发保存只有一个版本成功，不同记录可独立保存');

    await a.evaluate(async()=>{
      const S=DilongStage1;
      await S.recordInkRun({id:'sync-history',snapshot:{version:1,imageUrl:S.base[0].imageUrl,layers:[{}],renderModel:{width:1,height:1,assignments:[0],original:[0,0,0,255],colours:[{r:0,g:0,b:0}]},settings:{weight:10,enabled:[true]}}});
    });
    await b.waitForFunction(()=>DilongStage1.inkRuns.some(x=>x.id==='sync-history'));
    await a.evaluate(()=>DilongStage1.deleteHistory('inkRuns',['sync-history']));
    await b.waitForFunction(()=>DilongStage1.deletedHistory.inkRuns.has('sync-history'));
    await b.evaluate(()=>DilongStage1.updateInkRunSettings('sync-history',{weight:20,enabled:[true]}));
    await b.reload();await b.evaluate(()=>DilongStage1.ready);
    assert.equal(await b.evaluate(()=>DilongStage1.inkRuns.some(x=>x.id==='sync-history')),false);
    console.log('PASS 配墨历史删除自动同步，旧页面调参不会恢复历史');

    await b.locator('nav button').filter({hasText:'配墨智能体'}).click();
    const ink=b.locator('.app-shell.embedded-module');
    await ink.locator('input[type=file]').setInputFiles(path.join(root,'sample-oak.png'));
    await b.waitForFunction(()=>DilongStage1.inkRuns.length===1);
    const runId=await b.evaluate(()=>DilongStage1.inkRuns[0].id);
    await a.waitForFunction(id=>DilongStage1.inkRuns.some(x=>x.id===id),runId);
    await a.evaluate(id=>{const S=DilongStage1,run=S.inkRuns.find(x=>x.id===id);return S.updateInkRunSettings(id,{...run.snapshot.settings,weight:20})},runId);
    await ink.getByText(/此记录已在其他页面修改/).waitFor();
    assert.equal(await ink.locator('input[type=number]').first().inputValue(),'10');
    await ink.getByRole('button',{name:'重新加载最新记录',exact:true}).click();
    await b.waitForFunction(()=>document.querySelector('.app-shell input[type=number]').value==='20');
    console.log('PASS 配墨记录更新保留当前预览，显式重新加载后恢复最新参数');

    await b.locator('nav button').filter({hasText:'设计智能体'}).click();
    await b.locator('.design-mode-grid button').nth(2).click();
    await b.evaluate(()=>{DilongDesignImages.twin=(src,style,strength,options)=>new Promise((resolve,reject)=>options.signal.addEventListener('abort',()=>reject(new DOMException('已取消','AbortError')),{once:true}));});
    await b.getByRole('button',{name:'生成风格孪生',exact:true}).click();
    await b.waitForFunction(()=>DilongStage1.tasks.some(x=>x.status==='处理中'));
    await a.evaluate(id=>DilongStage1.updateAsset(id,{name:'运行中收到外部更新'}),ids[1]);
    await b.waitForFunction(id=>DilongStage1.assets.find(x=>x.id===id)?.name==='运行中收到外部更新',ids[1]);
    assert.equal(await b.evaluate(()=>DilongStage1.tasks.find(x=>x.id===DilongStage1.activeTask).status),'处理中');
    assert.equal(await b.evaluate(()=>DilongStage1.designRuns.size),1);
    await b.getByRole('button',{name:'取消任务',exact:true}).click();
    await b.waitForFunction(()=>DilongStage1.tasks.find(x=>x.id===DilongStage1.activeTask)?.status==='已取消');
    console.log('PASS 数据同步不重置或中断运行中的设计任务，原取消操作仍有效');
    assert.deepEqual(errors,[]);
  } finally { await browser.close(); await new Promise(resolve=>server.close(resolve)); }
})().catch(error=>{console.error(error);process.exitCode=1;});
