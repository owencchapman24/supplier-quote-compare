# Split sourcing

The original single-SKU mode was tested in Microsoft Edge before implementing split sourcing. For 1,750 cups and 1,000 B lids, using one SKU per item, A cups plus B lids cost $171 delivered. Buying everything from B cost $174. This baseline was recorded before production edits.

Before implementation, `node --test tests/split-sourcing.test.mjs` ran five independent fixture tests. Four failed on the baseline, including the mixed cup receipt and its quantity boundary. One budget test already passed.

## Split-sourcing results

Starting in empty storage in Edge 158.0.4370.33, the test launched the reviewed cups demo, added 1,000 compatible lids and edited demand through Comparison.

| Cups | Off, lowest cash | On, ranked receipts | Excess cups in split-mode winner |
|---:|---:|---|---:|
| 1,200 | $141 | $141, $156, $171 | 300 |
| 1,750 | $171 | $156, $171, $174 | 0 |
| 1,751 | $171 | $171, $174, $189 | 249 |

At 1,750 the winner bought one A-12, one B-C12 and one B-L90. Merchandise was $121, with $35 freight on the entire B order. The next receipt used two A-12 and one B-L90. Both stayed visible under the same supplier combination. The split-mode worker scanned 1,748–1,753 in six checks and 78 nodes, returning $156 through 1,750 and $171 from 1,751. Reloading at 1,751 preserved the checked setting and demand.

[Edge screenshot](split-1750.png) · [Browser XLSX at 1,750](split-1750.xlsx). The 1,751 download is at `.work/split-1751.xlsx`. Both exports contain purchases, per-supplier delivery, item coverage and plan totals. The browser suite reconstructed every exported alternative. The recalculated winning totals and aggregate excess were $156 and 0, then $171 and 249. In an in-memory copy, raising the winning A case price by $1 changed the linked $156 total to $157. [Desktop Excel results](split-excel-validation.json)

## Search and regression checks

- The split case-count bound is `max(ceil(demand/pack), ceil(T/price))`, with `T` the greater of minimum and active free-freight threshold. One case above this bound can be removed without eliminating a purchased line, losing coverage or crossing either threshold. The removed case has positive cost. The implementation tightens the bound with already-fixed units and spend and preserves at least one case for a positive line.
- The 1,750 fixture took 11 nodes off and 13 on. Averaged over 1,000 local solves per mode, these took 0.009 ms and 0.021 ms respectively. Every seed selection and explored case count consumes budget. At budgets of 1 and 6, the split fixture returned an empty limited result and a feasible $171 best found. A million-unit UI test reached exactly the 100,000-node cap and displayed **best found only**. [Search measurements](split-search-measurement.json)
- `npm.cmd test` passed 25 tests in 1.24 seconds. Coverage included 48 split markets checked by independent whole-case enumeration, 80 legacy markets, every split cup quantity through 4,000, two legacy curves through 5,000, missing terms and packs, and a 15,000-quote explicit-stack stress case.
- `npm.cmd run test:edge` built the worktree and passed all five Edge scripts in 31.96 seconds. They covered legacy imports, approvals, substitutions, revisions, quantity changes, persistence, export, the split demo and the search cutoff. A newly imported supplier won at $130 by combining its two cup SKUs and buying one extra $20 lid case to reach inclusive free freight.
- `node build.mjs` followed by `node tests/edge-split.mjs --dist --save-evidence` intentionally refreshed the screenshot and workbook. Normal test runs put generated files under `.work/`.
