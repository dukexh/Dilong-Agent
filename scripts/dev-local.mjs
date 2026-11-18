import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
const python=process.env.DILONG_PYTHON || (existsSync('backend/.venv/Scripts/python.exe')?'backend/.venv/Scripts/python.exe':existsSync('backend/.venv/bin/python')?'backend/.venv/bin/python':'python')
const children=[]
for(const [cmd,args] of [[python,['-m','uvicorn','backend.main:app','--host','127.0.0.1','--port',process.env.DILONG_BACKEND_PORT||'51460']],[process.execPath,['node_modules/vite/bin/vite.js','--host','127.0.0.1','--port','51458','--strictPort']]]){
 const child=spawn(cmd,args,{stdio:'inherit',windowsHide:true});children.push(child)
 const stop=code=>{for(const other of children)if(other!==child)other.kill();process.exitCode=code||0}
 child.on('error',()=>{console.error('启动失败，请按 LOCAL_SERVICE.md 安装后端依赖');stop(1)});child.on('exit',stop)
}
for(const signal of ['SIGINT','SIGTERM'])process.on(signal,()=>{for(const child of children)child.kill()})
