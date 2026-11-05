const {spawnSync}=require('node:child_process')
const result=spawnSync(process.execPath,['tests/vue/browser.cjs','design.cjs','ink-production.cjs'],{stdio:'inherit',windowsHide:true})
process.exitCode=result.status === 0 ? 0 : result.status ?? 1
