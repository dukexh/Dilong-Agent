// Deterministic transport fixture for UI regression only; live capability probes are recorded separately.
module.exports=async function modelApi(context){
 const jobs=new Map();let n=0
 const image='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg=='
 await context.route('**/api/**',async route=>{
  const request=route.request(),url=new URL(request.url()),path=url.pathname
  const send=value=>route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(value)})
  if(path.endsWith('/model/status'))return send({connected:true,loggedIn:true,available:true,imageInput:true})
  if(path.endsWith('/model/tasks')){
   const body=request.postDataJSON();let result={}
   if(body.kind==='rank')result={matches:body.candidates.map(c=>({id:c.id,reason:'UI transport fixture'}))}
   else if(body.kind==='terms')result={terms:['木纹','wood','浅色','橡木']}
   else result={images:[image],model:'qwen-image-3.0-pro'}
   const id=String(++n);jobs.set(id,{state:'succeeded',phase:'测试返回',result});return send({id})
  }
  const id=path.split('/').pop();if(request.method()==='DELETE'){jobs.delete(id);return send({ok:true})}
  if(path.includes('/jobs/'))return send(jobs.get(id)||{state:'cancelled'})
  return route.fallback()
 })
}
