const { chromium } = require('playwright')
const assert = require('node:assert/strict')
const fs = require('node:fs'), path = require('node:path'), os = require('node:os')
const base = process.env.DILONG_URL || process.env.DILONG_TEST_BASE || 'http://127.0.0.1:51458'

// reviewLifecycle: 独立浏览器上下文，沿用原有场景和断言。
async function reviewLifecycle() {

 const browser = await chromium.launch({headless:true,channel:'chrome'})
 try {
  const context = await browser.newContext({viewport:{width:1440,height:1000}})
  const page = await context.newPage()
  await page.goto(base)
  const id = await page.evaluate(async () => {
   const {S} = await import('/src/services/workflows.ts'); await S.ready
   const canvas = document.createElement('canvas'); canvas.width=80;canvas.height=80
   const ctx=canvas.getContext('2d');ctx.fillStyle='#ad946f';ctx.fillRect(0,0,80,80)
   return (await S.save(canvas.toDataURL(),'评价流程测试','相似检索',{},'review-test')).id
  })
  async function open() { await page.getByRole('button').filter({hasText:'待评价方案'}).click();await page.locator('.history-dialog').waitFor() }
  async function tab(label) { await page.locator('.review-tabs').getByRole('button',{name:new RegExp('^'+label)}).click() }
  const other = await page.context().newPage(); await other.goto(base+'/samples')
  await other.evaluate(async () => (await import('/src/services/workflows.ts')).S.ready)
  async function membership(expected) {
   for (const target of [page, other]) {
    await target.waitForFunction(async ({id,expected}) => {
     const {S}=await import('/src/services/workflows.ts')
     return S.formalSamples().some(a=>a.id===id)===expected
    },{id,expected})
   }
   const state=await page.evaluate(async id=>{const {S}=await import('/src/services/workflows.ts');return {total:S.stats().assets,stored:S.assets.filter(a=>a.id===id).length,listed:S.librarySamples(S.all()).some(a=>a.id===id),recommended:S.recommend('橡木',99999,S.all()).some(a=>a.id===id)}},id)
   assert.equal(state.total,2990+Number(expected));assert.equal(state.stored,1);assert.equal(state.listed,expected);if(!expected)assert.equal(state.recommended,false)
   await other.getByLabel('搜索样例',{exact:true}).fill(id)
   await other.waitForFunction(({id,expected})=>!!document.querySelector(`[data-sample-id="${id}"]`)===expected,{id,expected})
  }
  await membership(false)
  await open()
  await page.getByLabel('候选评价',{exact:true}).selectOption('adjust')
  await page.getByLabel('评价意见').fill('颜色偏深，需要降低明暗反差')
  assert.equal(await page.evaluate(async id => (await import('/src/services/workflows.ts')).S.assets.find(a=>a.id===id).candidateReview.status,id),'pending')
  await page.getByRole('button',{name:'保存评价',exact:true}).click()
  await page.getByText('暂无待评价方案',{exact:true}).waitFor()
  await tab('需调整');await page.getByRole('button',{name:'继续设计',exact:true}).click()
  await page.waitForURL(base+'/design');await page.getByText('颜色偏深，需要降低明暗反差',{exact:true}).waitFor()
  await page.goto(base);await open();await tab('需调整')
  assert.equal(await page.getByLabel('评价意见').inputValue(),'颜色偏深，需要降低明暗反差')
  await page.getByLabel('候选评价',{exact:true}).selectOption('accepted');await page.getByRole('button',{name:'保存评价',exact:true}).click()
  await membership(true);await tab('已采用');await page.getByRole('button',{name:'用于配墨',exact:true}).click();await page.waitForURL(base+'/ink')
  await page.goto(base);await open();await tab('已采用')
  await page.getByLabel('候选评价',{exact:true}).selectOption('rejected');await page.getByLabel('评价意见').fill('不符合本次需求');await page.getByText('保存后将从样例库撤下，候选和已有配墨历史保留。',{exact:true}).waitFor();await page.getByRole('button',{name:'保存评价',exact:true}).click()
  await membership(false);await tab('未采用');assert.equal(await page.getByLabel('评价意见').inputValue(),'不符合本次需求')
  await page.getByLabel('候选评价',{exact:true}).selectOption('pending');await page.getByRole('button',{name:'保存评价',exact:true}).click()
  await tab('待评价');await page.locator('.summary-candidate').waitFor()
  fs.mkdirSync('verification/candidate-review',{recursive:true})
  await page.screenshot({path:'verification/candidate-review/desktop.png',fullPage:true})
  await page.setViewportSize({width:390,height:844})
  await page.screenshot({path:'verification/candidate-review/mobile.png',fullPage:true})
  assert(await page.locator('.history-dialog').evaluate(el=>el.scrollWidth<=el.clientWidth+1))
  await tab('全部');assert.equal(await page.locator('.summary-candidate').count(),1)
  await page.keyboard.press('Escape');await page.locator('.history-dialog').waitFor({state:'detached'})
  await other.close(); console.log('PASS 正式入库与撤销、统计、跨标签同步、分类、草稿确认、意见持久化、继续设计、配墨入口、重新评价、移动端和Esc关闭')
 } finally {await browser.close()}

}

// reviewConcurrency: 独立浏览器上下文，沿用原有场景和断言。
async function reviewConcurrency() {
async function ready(p){await p.goto(base);await p.evaluate(async()=>{window.S=(await import('/src/services/workflows.ts')).S;await S.ready;const c=document.createElement('canvas');c.width=32;c.height=24;const x=c.getContext('2d');x.fillStyle='#bfa67d';x.fillRect(0,0,32,24);window.pic=c.toDataURL()})}
const browser=await chromium.launch({channel:'chrome',headless:true});const ctx=await browser.newContext();try{
 await ctx.addInitScript(()=>Object.defineProperty(navigator,'locks',{value:undefined,configurable:true}))
 const a=await ctx.newPage(),b=await ctx.newPage();await ready(a);await ready(b)
 const tasks=[];for(const p of [a,b])tasks.push(await p.evaluate(async()=>{const t=await S.beginDesignTask({mode:'compare',runKey:S.createId(),parameters:{limit:3},input:{kind:'library',sampleId:S.base[0].id,name:S.base[0].name}});await S.updateTask(t.id,{status:'已处理'});return t.id}))
 const results=await Promise.all([a.evaluate(id=>S.save(pic,'并发候选','相似检索',{},'concurrent-review',id),tasks[0]),b.evaluate(id=>S.save(pic,'并发候选','相似检索',{},'concurrent-review',id),tasks[1])]);const id=results[0].id
 assert.equal(results[1].id,id)
 for(const p of [a,b])await p.waitForFunction(({id,tasks})=>S.assets.filter(x=>x.sourceKey==='concurrent-review').length===1 && tasks.every(t=>S.tasks.find(x=>x.id===t)?.resultIds.includes(id)),{id,tasks})
 console.log('PASS 无Web Locks环境下跨标签同时保存只产生一条候选，两个任务均正确关联')
 const states=await a.evaluate(async({id,taskId})=>{const rows=[];for(const state of ['处理中','已取消','执行失败','已中断','状态待确认']){await S.updateTask(taskId,{status:state});const version=S.tasks.find(t=>t.id===taskId)._revision;await S.reviewCandidate(id,'adjust','意见');if(S.tasks.find(t=>t.id===taskId)._revision!==version)throw Error('评价不应改写运行或重试任务版本');rows.push(S.tasks.find(t=>t.id===taskId).status)}await S.updateTask(taskId,{status:'处理中'});await S.save(pic,'并发候选','相似检索',{},'concurrent-review',taskId);let blocked=false;try{await S.deleteHistory('tasks',[taskId])}catch{blocked=true}await S.updateTask(taskId,{status:'已处理'});await S.reviewCandidate(id,'pending','');return{rows,blocked}}, {id,taskId:tasks[0]})
 assert.deepEqual(states.rows,['处理中','已取消','执行失败','已中断','状态待确认']);assert.equal(states.blocked,true)
 console.log('PASS 评价和候选关联保留运行/重试状态，运行中的任务仍不能删除')
 await b.waitForFunction(id=>S.assets.find(x=>x.id===id)?.candidateReview?.status==='pending',id)
 await a.getByRole('button').filter({hasText:'待评价方案'}).click();const row=a.locator(`[data-record-id="${id}"]`)
 await row.getByLabel('候选评价',{exact:true}).selectOption('adjust');await row.getByLabel('评价意见').fill('本页尚未保存的意见')
 const snapshot=await a.evaluate(id=>structuredClone(S.assets.find(x=>x.id===id)),id)
 await b.evaluate(id=>S.reviewCandidate(id,'accepted','其他页面的新意见'),id)
 await row.getByRole('alert').filter({hasText:'当前草稿已保留'}).waitFor()
 assert.equal(await row.getByLabel('评价意见').inputValue(),'本页尚未保存的意见');assert.equal(await row.getByLabel('候选评价',{exact:true}).inputValue(),'adjust');assert(await row.getByRole('button',{name:'保存评价',exact:true}).isDisabled())
 const stale=await a.evaluate(async({id,snapshot})=>{try{await S.reviewCandidate(id,'rejected','旧内容',snapshot);return ''}catch(e){return e.code}}, {id,snapshot});assert.equal(stale,'DATA_CONFLICT')
 await row.getByRole('button',{name:'重新加载最新评价（放弃草稿）',exact:true}).click();await row.waitFor({state:'detached'})
 await a.locator('.review-tabs').getByRole('button',{name:/^已采用/}).click();await row.waitFor();assert.equal(await row.getByLabel('评价意见').inputValue(),'其他页面的新意见')
 console.log('PASS 跨页评价保留草稿与所在行，旧版本不能覆盖，显式重载后读取最新状态')
 await row.getByLabel('评价意见').fill('删除后仍保留供复制的意见');await b.evaluate(id=>S.deleteAsset(id),id)
 await row.getByRole('alert').filter({hasText:'已在其他页面删除'}).waitFor();assert.equal(await row.getByLabel('评价意见').inputValue(),'删除后仍保留供复制的意见');assert(await row.getByRole('button',{name:'保存评价',exact:true}).isDisabled())
 console.log('PASS 跨页删除不丢失正在编辑的意见且禁止复活已删除记录')
}finally{await ctx.close();await browser.close()}
}

// candidateFreshness: 独立浏览器上下文，沿用原有场景和断言。
async function candidateFreshness() {
async function ready(page) {
  await page.goto(base)
  await page.evaluate(async () => { window.S = (await import('/src/services/workflows.ts')).S; await S.ready })
}

  const browser = await chromium.launch({ channel: 'chrome', headless: true })
  try {
    for (const scenario of [
      { mode: 'compare', phase: 'begin', removeAll: false },
      { mode: 'compare', phase: 'save', removeAll: true },
    ]) {
      const context = await browser.newContext()
      await require('../helpers/model-api.cjs')(context)
      try {
        const page = await context.newPage(), other = await context.newPage(), errors = []
        page.on('pageerror', e => errors.push(e.message)); other.on('pageerror', e => errors.push(e.message))
        await ready(page)
        const fixture = await page.evaluate(async () => {
          const canvas = document.createElement('canvas'); canvas.width = 48; canvas.height = 32
          const ctx = canvas.getContext('2d'); ctx.fillStyle = '#a28264'; ctx.fillRect(0, 0, 48, 32)
          const url = canvas.toDataURL(), ids = []
          for (let i = 0; i < 3; i++) {
            const asset = await S.save(url, '候选' + i, '相似检索', { wood: '橡木', tone: '浅色', style: '自然' }, 'fresh-' + i, null)
            await S.reviewCandidate(asset.id, 'accepted', ''); ids.push(asset.id)
          }
          // A small catalog makes all-result withdrawal and stable ordering observable.
          S.base = []; S.status('fixture', 'ready')
          return { ids, url }
        })
        await ready(other)
        await page.evaluate(() => S.navigate('design'))
        await page.getByRole('button', { name: '上传图片', exact: true }).click()
        await page.locator('.source-panel input[type=file]').setInputFiles({ name: 'target.png', mimeType: 'image/png', buffer: Buffer.from(fixture.url.split(',')[1], 'base64') })
        await page.locator('.source-panel dl').waitFor()
        if (scenario.mode === 'generate') await page.locator('[data-design-mode="generate"]').click()
        // Hold one real async boundary; no candidate state or ranking code is replaced.
        await page.evaluate(phase => {
          if (phase === 'begin') {
            const original = S.beginDesignTask
            S.beginDesignTask = async (...args) => { const task = await original(...args); window.held = true; await new Promise(resolve => { window.release = resolve }); return task }
          } else {
            const original = S.updateTask; let held = false
            S.updateTask = async (...args) => {
              if (!held && args[1].outputCount !== undefined) { held = true; window.held = true; await new Promise(resolve => { window.release = resolve }) }
              return original(...args)
            }
          }
        }, scenario.phase)
        await page.locator('.run-button').click(); await page.waitForFunction(() => window.held)
        await other.evaluate(async ({ ids, removeAll }) => {
          await S.reviewCandidate(ids[0], 'rejected', '撤回采用')
          await S.deleteAsset(ids[1])
          if (removeAll) await S.reviewCandidate(ids[2], 'adjust', '待调整')
          else await S.updateAsset(ids[2], { name: '保留候选最新名称' })
        }, { ids: fixture.ids, removeAll: scenario.removeAll })
        await page.waitForFunction(({ ids, removeAll }) => !S.formalSamples().some(a => a.id === ids[0] || a.id === ids[1]) && (removeAll ? !S.isLibraryAsset(S.assets.find(a => a.id === ids[2])) : S.assets.find(a => a.id === ids[2])?.name === '保留候选最新名称'), { ids: fixture.ids, removeAll: scenario.removeAll })
        await page.evaluate(() => window.release()); await page.waitForFunction(() => !document.querySelector('.run-button').disabled)
        const expected = scenario.removeAll ? 0 : 1
        assert.equal(await page.locator('.candidate-card').count(), expected)
        if (expected) {
          assert.match(await page.locator('.candidate-title').innerText(), /保留候选最新名称/)
          if (scenario.mode === 'compare') assert.match(await page.locator('.candidate-title').innerText(), /排序 01/)
        }
        const task = await page.evaluate(() => S.tasks.at(-1))
        assert.equal(task.outputCount, expected)
        assert.equal(task.status, expected ? '已处理' : '无匹配结果')
        assert.deepEqual(errors, [])
        console.log(`PASS ${scenario.mode} ${scenario.phase}：跨页撤回/删除不回流，资料与数量最新，${expected}个结果`)
      } finally { await context.close() }
    }
  } finally { await browser.close() }

}

;(async () => {
  await reviewLifecycle()
  await reviewConcurrency()
  await candidateFreshness()
})().catch(error => { console.error(error); process.exitCode = 1 })
