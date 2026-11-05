const {spawn,spawnSync}=require('node:child_process'),http=require('node:http'),net=require('node:net'),path=require('node:path'),fs=require('node:fs'),os=require('node:os')
const root=path.resolve(__dirname,'../..')
const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms))
async function port(){const server=net.createServer();await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const value=server.address().port;await new Promise(resolve=>server.close(resolve));return value}
;(async()=>{
 const value=await port(),base='http://127.0.0.1:'+value,cache=fs.mkdtempSync(path.join(os.tmpdir(),'dilong-vue-test-cache-'))
 const server=spawn(process.execPath,['node_modules/vite/bin/vite.js','--host','127.0.0.1','--port',String(value),'--strictPort'],{cwd:root,stdio:['ignore','pipe','pipe'],windowsHide:true,env:{...process.env,DILONG_CACHE_DIR:cache}})
 let log='';server.stdout.on('data',data=>log+=data);server.stderr.on('data',data=>log+=data)
 try{
  let ready=false;for(let i=0;i<100&&!ready;i++){ready=await new Promise(resolve=>{const r=http.get(base+'/src/main.ts',res=>{res.resume();resolve(res.statusCode===200)});r.on('error',()=>resolve(false))});if(!ready)await pause(100)}if(!ready)throw Error('Vite did not start: '+log)
  const scripts=process.argv.slice(2).length?process.argv.slice(2):['design.cjs','storage.cjs','ink-production.cjs','library-home-trends.cjs','migration-fixes.cjs','legacy-compat.cjs','original-appearance.cjs','text-display.cjs','template-ecosystem.cjs']
  for(const script of scripts){
   console.log('\nRunning '+script)
   const result=spawnSync(process.execPath,[path.join('tests/vue',script)],{cwd:root,stdio:'inherit',windowsHide:true,env:{...process.env,DILONG_URL:base,DILONG_TEST_BASE:base,DILONG_TEST_FILTER:''}})
   if(result.status!==0)throw Error(script+' failed with exit '+result.status)
  }
  console.log('All Vue browser suites passed against an isolated temporary Vite server.')
 }finally{
  if(server.exitCode===null){server.kill();await new Promise(resolve=>server.once('exit',resolve))}
  if(path.dirname(path.resolve(cache))===path.resolve(os.tmpdir())&&path.basename(cache).startsWith('dilong-vue-test-cache-'))fs.rmSync(cache,{recursive:true,force:true})
 }
})().catch(error=>{console.error(error);process.exitCode=1})
