import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
const python=process.env.DILONG_PYTHON || (existsSync('backend/.venv/Scripts/python.exe')?'backend/.venv/Scripts/python.exe':existsSync('backend/.venv/bin/python')?'backend/.venv/bin/python':'python')
const args=process.argv.includes('--test')?['-m','pytest','backend/tests','-q']:['-m','uvicorn','backend.main:app','--host','127.0.0.1','--port',process.env.DILONG_BACKEND_PORT||'51460']
const child=spawn(python,args,{stdio:'inherit',windowsHide:true})
child.on('error',()=>{console.error('请先按照 LOCAL_SERVICE.md 安装 Python 后端依赖');process.exitCode=1})
child.on('exit',code=>{process.exitCode=code||0})
for(const signal of ['SIGINT','SIGTERM'])process.on(signal,()=>child.kill())
