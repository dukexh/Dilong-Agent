const {chromium}=require('playwright'),assert=require('node:assert/strict')
const base=process.env.DILONG_URL||'http://127.0.0.1:51458'
;(async()=>{
 const b=await chromium.launch({channel:'chrome',headless:true})
 try{const c=await b.newContext({viewport:{width:1440,height:1000}}),p=await c.newPage(),errors=[],jobs=new Map();let n=0;p.on('pageerror',e=>errors.push(e.message))
 await c.route('**/api/**',async route=>{const url=new URL(route.request().url());if(url.pathname.endsWith('/posts/search')){const body=route.request().postDataJSON(),id=String(++n);jobs.set(id,{state:'succeeded',result:{posts:[{id:body.platform,platform:body.platform,title:'浅色木纹家居参考',cover:'',author:'作者',url:body.platform==='douyin'?'https://www.douyin.com/video/1234567890123456789':'https://www.xiaohongshu.com/explore/'+'a'.repeat(24),publishedAt:null,collectedAt:new Date().toISOString(),metrics:{likes:5}}],cursor:body.cursor?null:'next-page',notice:'接口测试资料'}});return route.fulfill({json:{id}})}if(url.pathname.includes('/jobs/'))return route.fulfill({json:jobs.get(url.pathname.split('/').pop())||{ok:true}});return route.fallback()})
 await p.goto(base+'/trends');await p.getByRole('tab',{name:'热点雷达',exact:true}).waitFor();assert.equal(await p.getByRole('tab').count(),4)
 await p.getByRole('button',{name:'搜索帖子',exact:true}).click();await p.locator('.real-post').first().waitFor();assert.equal(await p.locator('.real-post').count(),2)
 await p.getByRole('button',{name:'加载更多',exact:true}).click();await p.getByRole('button',{name:'加载更多',exact:true}).waitFor({state:'hidden'});assert.equal(await p.locator('.real-post').count(),2)
 await p.getByRole('button',{name:'用于设计参考',exact:true}).click();await p.getByLabel('转化设计方向').fill('真实帖子转化测试');await p.getByLabel('转化输入样例').selectOption({index:1});await p.getByRole('button',{name:'创建设计任务',exact:true}).click();await p.waitForFunction(async()=>{const {S}=await import('/src/services/workflows.ts');return S.tasks.some(t=>t.source==='真实帖子参考'&&t.parameters?.referencePost?.url)})
 await p.goto(base+'/trends');await p.getByRole('tab',{name:'定向研究',exact:true}).click();await p.getByRole('button',{name:'检索专题资料',exact:true}).click();await p.locator('.research-posts li').first().waitFor();assert.equal(await p.locator('.research-posts li').count(),2)
 for(const tab of ['热点雷达','定向研究','趋势预测','趋势转化']){await p.getByRole('tab',{name:tab,exact:true}).click();for(const width of [1440,390,320]){await p.setViewportSize({width,height:1000});assert(await p.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),`${tab} ${width}`)}}
 assert.deepEqual(errors,[]);console.log('PASS real-post API UI fixture: dual-platform, pagination dedupe, four tabs, research, source-to-design, 1440/390/320px')
 }finally{await b.close()}
})().catch(e=>{console.error(e);process.exitCode=1})
