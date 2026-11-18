import type { DesignOptions } from '../core/types'
export const apiBase=()=>import.meta.env.BASE_URL+'api/'
export async function localApi<T=any>(path:string,body?:unknown,signal?:AbortSignal):Promise<T>{
  let response:Response
  try{response=await fetch(apiBase()+path,{method:body===undefined?'GET':'POST',headers:body===undefined?{}:{'Content-Type':'application/json'},...(body===undefined?{}:{body:JSON.stringify(body)}),signal})}
  catch(error){if(signal?.aborted)throw new DOMException('任务已取消','AbortError');throw Object.assign(Error('服务暂时无法连接，请稍后重试或联系管理员'),{name:'LocalTransportError'})}
  let data:any
  try{data=await response.json()}catch{throw Object.assign(Error('服务响应不完整，请稍后重试'),{name:'LocalTransportError'})}
  if(!response.ok||data.error){const error=Object.assign(Error(data.error||'本机服务请求失败'),{usage:data.usage});if(response.status===404&&path.startsWith('jobs/'))error.name='ServiceRestartError';throw error}
  return data as T
}
export async function localTask<T=any>(endpoint:string,body:unknown,options:DesignOptions={}):Promise<T>{
  options.signal?.throwIfAborted()
  const job=await localApi<{id:string}>(endpoint,body,options.signal)
  const cancel=()=>{void localApi(`jobs/${job.id}/cancel`,{}).catch(()=>{})}
  options.signal?.addEventListener('abort',cancel,{once:true})
  try{
    for(;;){
      options.signal?.throwIfAborted()
      let row:any
      for(let attempt=0;;attempt++){
        try{row=await localApi(`jobs/${job.id}`,undefined,options.signal);break}
        catch(error){
          if(options.signal?.aborted||!(error instanceof Error)||error.name!=='LocalTransportError'||attempt>=3)throw error
          options.onProgress?.({fraction:0,phase:'连接短暂中断，正在恢复任务状态',indeterminate:true})
          await new Promise<void>(r=>setTimeout(r,1000))
        }
      }
      options.onProgress?.({fraction:row.state==='succeeded'?1:0,phase:row.phase,indeterminate:row.state!=='succeeded'})
      if(row.state==='succeeded')return row.result as T
      if(['failed','cancelled','interrupted'].includes(row.state))throw Object.assign(Error(row.error||row.phase),{usage:row.usage})
      await new Promise<void>(r=>setTimeout(r,500))
    }
  }finally{options.signal?.removeEventListener('abort',cancel);if(options.signal?.aborted)cancel();void fetch(apiBase()+`jobs/${job.id}`,{method:'DELETE'}).catch(()=>{})}
}
