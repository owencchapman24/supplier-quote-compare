import { scanRange } from './scenarios.mjs'
import { optimize } from './optimizer.mjs'
self.onmessage=({data})=>{
  try {
    const {market,product,start,end,quantity}=data
    const value=quantity===undefined ? scanRange(market,product,start,end) : optimize({...market,demand:{...market.demand,[product]:quantity}})
    self.postMessage({value})
  } catch(error){self.postMessage({error:error.message})}
}
