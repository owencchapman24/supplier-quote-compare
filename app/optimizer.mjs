/** All money in USD cents. Count only complete, confirmed receipts. */
export const limits = Object.freeze({ units: 1_000_000, cents: 100_000_000, lines: 32, nodes: 100_000 })
const integer = (value, low, high) => Number.isSafeInteger(value) && value >= low && value <= high
export const validUnits = n => integer(n, 1, limits.units)
export const validMoney = n => integer(n, 0, limits.cents)
export const validRule = s => validMoney(s.fee) && validMoney(s.minimum) && (s.freeAt === null || validMoney(s.freeAt))
export const validOffer = o => o.approved === true && validUnits(o.pack) && validMoney(o.price) && o.price > 0

export function proofLabel(result) {
  if (result.proven) return result.baskets.length ? 'Verified optimum' : 'Search complete'
  return result.baskets.length ? 'Search limit reached · best found only' : 'No complete plan found within limit'
}

export function optimize({ demand, offers, suppliers, allowSplitSourcing = false }, { maxNodes = limits.nodes } = {}) {
  const items = Object.entries(demand)
  if (items.length > limits.lines || items.some(([, units]) => !validUnits(units))) throw Error('Invalid demand quantity or line count.')
  if (!integer(maxNodes, 1, Number.MAX_SAFE_INTEGER)) throw Error('Invalid search budget.')
  const rules = new Map(suppliers.filter(validRule).map(s => [s.id, s]))
  const choices = items.map(([p]) => offers.filter(o => o.product === p && validOffer(o) && rules.has(o.supplier)))
  const missing = items.filter((_, i) => choices[i].length === 0).map(([p]) => p)
  let nodes = 0, proven = true
  const receipts = new Map(), lines = []
  function visit() {
    if (nodes >= maxNodes) { proven = false; return false }
    nodes++
    return true
  }
  function record(spent, key) {
    const orders = [...spent].sort(([a],[b]) => a.localeCompare(b)).map(([supplier, merchandise]) => {
      const r = rules.get(supplier)
      if (merchandise < r.minimum) return null
      const fee = r.freeAt !== null && merchandise >= r.freeAt ? 0 : r.fee
      return { supplier, merchandise, fee }
    })
    if (orders.includes(null)) return
    const merchandise = orders.reduce((n,o) => n + o.merchandise, 0)
    const fees = orders.reduce((n,o) => n + o.fee, 0)
    const total = merchandise + fees
    const prev = receipts.get(key)
    if (prev && prev.total <= total) {
      if(!allowSplitSourcing && prev.total===total) prev.equalReceipts++
      return
    }
    const received = new Map()
    const purchases = lines.map(l => {
      const units = l.cases*l.pack
      received.set(l.product,(received.get(l.product) || 0) + units)
      return { ...l, received: units, subtotal: l.cases*l.price,
        ...(!allowSplitSourcing && {excess: units-demand[l.product]}) }
    })
    const coverage = items.map(([product,required]) => ({ product, required, received: received.get(product),
      excess: received.get(product)-required }))
    receipts.set(key, { total, merchandise, fees, equalReceipts:1, orders, lines:purchases, items:coverage })
  }
  function priceAssignment() {
    const spent = new Map()
    for (const l of lines) spent.set(l.supplier, (spent.get(l.supplier) || 0) + l.cases*l.price)
    const key = JSON.stringify([...spent.keys()].sort())
    function topUp(i) {
      if (!visit()) return
      if (i === lines.length) { record(spent,key); return }
      const line = lines[i], base = line.cases, id = line.supplier
      const sub = spent.get(id), r = rules.get(id)
      // After both thresholds are met, another positive-price case can only cost more.
      const threshold = Math.max(r.minimum, r.fee ? r.freeAt ?? 0 : 0)
      const extras = Math.max(0, Math.ceil((threshold - sub) / line.price))
      for (let n = 0; n <= extras && proven; n++) {
        line.cases = base + n
        spent.set(id, sub + n*line.price)
        topUp(i+1)
      }
      spent.set(id, sub)
      line.cases = base
    }
    topUp(0)
  }
  function assign(i) {
    if (!visit()) return
    if (i === items.length) { priceAssignment(); return }
    for (const offer of choices[i]) {
      lines.push({ ...offer, cases: Math.ceil(items[i][1] / offer.pack) })
      assign(i+1)
      lines.pop()
      if (!proven) break
    }
  }
  function splitSearch() {
    const spent = new Map()
    function buy(offer,cases) {
      lines.push({...offer,cases})
      spent.set(offer.supplier,(spent.get(offer.supplier) || 0) + cases*offer.price)
    }
    function undo() {
      const line = lines.pop()
      const rest = spent.get(line.supplier) - line.cases*line.price
      if (rest) spent.set(line.supplier,rest)
      else spent.delete(line.supplier)
    }
    function saveReceipt() {
      record(spent,JSON.stringify([[...spent.keys()].sort(),lines.length > items.length]))
    }
    // A deterministic feasible incumbent. Charge one decision per item, including
    // a seed interrupted by the budget. Never publish a partial seed.
    for (const [i, [,required]] of items.entries()) {
      if (!visit()) return
      const o = choices[i][0]
      buy(o,Math.max(Math.ceil(required/o.pack), Math.ceil(rules.get(o.supplier).minimum/o.price)))
    }
    saveReceipt()
    while (lines.length) undo()

    // Iterative DFS. Each frame assigns one quote's count. Bounds depend only
    // on already fixed purchases, so they also apply to every descendant.
    const stack = []
    function push(item, index, remaining) {
      const offer = choices[item][index], rule = rules.get(offer.supplier)
      const threshold = Math.max(rule.minimum,rule.fee ? rule.freeAt ?? 0 : 0)
      const cover = Math.max(0, Math.ceil(remaining/offer.pack))
      const topUp = Math.ceil((threshold-(spent.get(offer.supplier) || 0))/offer.price)
      // Preserve a positive line when it identifies a different supplier set
      // or a mixed-SKU alternative, even if previous lines cover the item.
      stack.push({item,index,offer,remaining,next:index+1===choices[item].length ? cover : 0,
        bound:Math.max(1,cover,topUp),bought:false})
    }
    push(0,0,items[0][1])
    while (stack.length) {
      const f = stack.at(-1)
      if (f.bought) { undo(); f.bought=false }
      if (f.next > f.bound) { stack.pop(); continue }
      if (!visit()) return
      const n = f.next++
      if (n) { buy(f.offer,n); f.bought=true }
      if (f.index+1 < choices[f.item].length) {
        push(f.item,f.index+1,f.remaining-n*f.offer.pack)
      } else if (f.item+1 < items.length) {
        push(f.item+1,0,items[f.item+1][1])
      } else {
        saveReceipt()
      }
    }
  }
  if (items.length && !missing.length) {
    if (allowSplitSourcing) splitSearch()
    else assign(0)
  }
  const baskets = [...receipts.values()].sort((a,b) => a.total-b.total || a.orders.length-b.orders.length)
  return { baskets, proven, nodes, missing }
}
