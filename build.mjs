import { cp, mkdir } from 'node:fs/promises'

const root=new URL('./',import.meta.url)
const dist=new URL('dist/',root)
for(const dir of ['app','samples','evidence/public-source']){
  const destination=new URL(dir+'/',dist)
  await mkdir(destination,{recursive:true})
  await cp(new URL(dir+'/',root),destination,{recursive:true})
}
console.log('Production files ready in dist. Run npm run serve.')
