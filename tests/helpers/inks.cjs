const names={red:'红墨',yellow:'黄墨',blue:'蓝墨',black:'黑墨'}
async function chooseInks(page,label,keys){
  const selected=typeof keys==='string'?keys.split(','):keys
  for(const [key,name]of Object.entries(names))await page.getByRole('checkbox',{name:label+'：'+name,exact:true}).setChecked(selected.includes(key))
}
async function inkKeys(page,label){
 const selected=[]
 for(const [key,name]of Object.entries(names))if(await page.getByRole('checkbox',{name:label+'：'+name,exact:true}).isChecked())selected.push(key)
 return selected
}
async function settled(page){await page.waitForFunction(()=>!document.querySelector('.ink-run-info')?.textContent.includes('正在保存')&&!document.querySelector('.ink-application-status')?.textContent.includes('正在保存'))}
module.exports={chooseInks,inkKeys,settled}
