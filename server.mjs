import http from 'node:http'
import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
const root = fileURLToPath(new URL(process.argv.includes('--dist')?'./dist/':'./',import.meta.url))
const types = { '.html':'text/html', '.css':'text/css', '.mjs':'text/javascript', '.js':'text/javascript', '.csv':'text/csv', '.xlsx':'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', '.json':'application/json', '.pdf':'application/pdf', '.png':'image/png' }
const port = Number(process.env.PORT || 4173)
const server = http.createServer(async (req,res) => {
  try {
    const pathname = new URL(req.url,'http://localhost').pathname
    const file = pathname === '/' ? '/app/index.html' : pathname
    if (!/^\/(app|samples|evidence\/public-source)\/[\w./-]+$/.test(file) || file.includes('..') || !types[path.extname(file)]) throw Error()
    const bytes = await fs.readFile(path.join(root,file))
    res.writeHead(200,{'Content-Type':types[path.extname(file)],'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'})
    res.end(bytes)
  } catch { res.writeHead(404); res.end('File unavailable') }
})
server.listen(port,'127.0.0.1',()=>console.log('Orderbook is running at http://127.0.0.1:'+server.address().port))
