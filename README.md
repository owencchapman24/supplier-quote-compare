# Orderbook

A local buyer workspace for comparing delivered cash totals across supplier quotes. Files are parsed in Edge. The loopback server serves static assets. Quote records, approvals, terms and demand are saved in the current browser profile for the current origin.

## Launch on Windows

In PowerShell, open the project folder and run the following commands with Node 22 or later. The app serves its own scripts, sample files and historical bid transcription locally.

```powershell
npm.cmd ci --offline
npm.cmd run build
$env:PORT = '42834'
npm.cmd run serve
```

Open **http://127.0.0.1:42834** in Edge. Keep that PowerShell window open while using the app. Use the same URL and browser profile to reopen saved quotes. For development, `npm.cmd start` serves the source files. Rebuild after edits when serving `dist`.

## 90-second demo

1. In an empty Comparison workspace, choose **Start reviewed cups demo**. The two saved quotes were captured by importing the sample CSV and XLSX in Edge, including sheet selection, column mapping, terms and individual SKU decisions. At 1,200 cups, A costs $96 and B costs $101.
2. Open **Quantity sensitivity**, enter 2,100 under **Inspect quantity** and choose **Compare at quantity**. B costs $134 and A costs $144. The saved order still needs 1,200 cups. **Apply** is the action that changes demand.
3. Choose **Add compatible lids to demand…**, review 1,000 lids and select **Run comparison**. All B costs $141. Splitting A cups and B lids costs $171. Expand **Approved substitutions for this demand** and **quote issues excluded** to inspect the 90 mm fit and the rejected 80 mm lid.
4. In **Quote library**, revise A-12 to **$30 per case**, enter a revision source and confirm the equivalent product and 1,000-unit pack. Return to **Comparison**. The split costs $135 and all B costs $141. Reload to reopen the saved revision. A changed source file can also be reimported and approved through **Import quote**.

**Download XLSX** saves the current basket, a costed receipt for every ranked supplier combination, sensitivity intervals, original source cells, active and superseded decisions, and price revisions. The winning order and alternatives each show delivery once per supplier. The range export uses the last inspected page for the selected item and a default scan from 1 through the greater of 3,000 or current demand for other items. The Quantity boundaries sheet records its range coverage.

**Public bid** opens the April 2021 Montgomery County Public Schools pizza bid, item 34893. The source link opens page 4 of the official bid tab on the issuer’s website. A separate 140-serving, zero-freight illustration shows the whole-case arithmetic for every published basis. Select a price basis and confirm pack, shape and ingredient eligibility before including an offer. The saved decisions affect only this historical example.

## Replay through the interface

The initial demand is 1,200 twelve-ounce cups. Both approved cup SKUs take 90 mm lids. Names and fit details in these local fixtures illustrate the buyer's scenario.

| Import quote | Worksheet / header | Map SKU, description, units per case, USD case price | Decisions and terms |
|---|---|---|---|
| Supplier A · `samples/supplier-a.csv` | CSV / row 1 | Item code, Item description, Units per case, Case price USD | Confirm A-12 for cups. Mark the 80 mm A-80 lid incompatible. Leave A-12X unresolved because pack size is missing. Fee $0, minimum $0, no free-freight threshold. |
| Supplier B · `samples/supplier-b.xlsx` | Read Terms, then select Case rates / row 2 | Stock no., Trade description, Pieces / carton, USD / carton | Confirm B-C12 for cups and B-L90 for 90 mm lids. Fee $35, minimum $0, no free-freight threshold. |

1. Enter the supplier name and choose its file. Use the raw preview to select the sheet, header row and four distinct columns. Enter and confirm the order terms.
2. Choose **Review quote lines**. Check the source description, product, pack and case price before choosing **Confirm offer**. Choose **Import reviewed quote** to activate that supplier's quote.
3. Open **Comparison**. Use **Edit demand** and **Run comparison** to try 2,100 cups. Return to 1,200 cups and add 1,000 lids, or load `samples/demand-template.csv` in the demand editor. New demand product names become choices in subsequent quote reviews.
4. Expand a product on a basket card to see its SKU, case price, filename, worksheet and row. **Quote library** also retains source cell values, the column map, import time, decisions and terms.

In **Edit demand**, a CSV with the `product,units` template header loads directly into the editable rows. For other CSV files and XLSX workbooks, choose the worksheet and header row, map the product and quantity columns, check the preview, and select **Load reviewed demand rows**. Only **Run comparison** saves the edited list. The **Demand and terms** export shows saved values alongside the original product and units, filename, worksheet and source row.

Each import replaces the named supplier's active quote. The superseded quote remains in the library and export. Exact prior decisions and confirmed price revisions are restored for the same supplier, filename, worksheet, headers, column roles and full raw row. Changing a source value requires a new line decision. Order terms require confirmation on each import. Unconfirmed terms, invalid packs or prices, and incompatible or unapproved substitutions exclude the affected supplier or offer from ranking.

## Allow split sourcing

The checkbox beside **Edit demand** is off for fresh projects and saved projects that predate the setting. Turn it on to combine whole cases of approved quotes for one item, including different SKUs from the same supplier. The project saves the choice.

With the original demo quotes, add 1,000 compatible lids, then change the cup demand. All prices include delivery.

| Cups | One SKU per item | Allow split sourcing | Winning cup purchase with splitting enabled |
|---:|---:|---:|---|
| 1,200 | $141 | $141 | 2 B cases |
| 1,750 | $171 | $156 | 1 A case of 1,000 and 1 B case of 750 |
| 1,751 | $171 | $171 | 2 A cases, with 249 excess cups |

At 1,750, the $156 receipt includes $48 and $33 for cups, $40 for lids and one $35 B delivery. Comparison also shows the $171 single-SKU-per-item receipt from A and B, and the $174 all-B receipt. In **Quantity sensitivity**, scan cups from 1,748 through 1,753 to see the switch.

In a split-mode workbook, **Item coverage** rows show demand, combined units received and excess once per item. **Plan comparison** sums merchandise, freight and excess over that plan's own rows in **All plan orders**.

## Cash and search rules

- One buying period, one destination, USD integer cents and zero tax. A complete order covers every item's required units. Excess is the sum received for the item minus its demand and receives no credit.
- The merchandise minimum is inclusive. Each used supplier charges its fixed fee once, waived if its inclusive free-freight threshold is met. An unused supplier incurs no fee.
- Off mode enumerates one approved SKU per item and legal case top-ups. Split mode enumerates whole-case counts. Let `T` be the higher of the supplier minimum and its active free-freight threshold (the latter is zero for an absent threshold or zero fee). For each positive-price quote, `max(ceil(demand / pack), ceil(T / price))` bounds its count. Above that bound, removing one case leaves the quote positive, covers demand and preserves threshold eligibility while strictly reducing cost.
- In the iterative split search, previously fixed units and supplier spend can be subtracted from demand and threshold. The upper bound keeps at least one case possible to preserve supplier membership and mixed-item alternatives. The final quote for an item must cover its remaining units. A feasible seed uses the first eligible quote for each item, covering demand and the supplier minimum.
- Keep the least expensive complete receipt found for each supplier set. Split mode keeps two representatives when available, one with a single SKU per item and one with any mixed item. This includes single-supplier plans. Equal cash totals tie, fewer deliveries display first, and equal-cost receipts within a group retain the first encountered. The split search considers the seed first, then traverses eligible quotes in demand and quote order.
- Each basket search allows 100,000 nodes. Split mode charges each seed selection and every case-count decision (including zero) before descending. Traversal uses an explicit stack. A completed search with a plan reports **Verified optimum**. Truncation reports **best found only** or **No complete plan found within limit**. The split merchandise lower bound prices demand at the cheapest eligible per-unit rate for each item, rounded down to cents. The feasible upper bound includes freight.
- Sensitivity runs in a worker with other demand fixed. Off mode jumps between individual pack boundaries. Split mode checks each integer quantity because coverage can change at sums of different packs. Consecutive proven quantities with identical winning receipts merge. Each page allows 128 checks and 400,000 total nodes, with 100,000 per quantity. **Inspect next page** continues at the first unchecked quantity. Click an interval or enter a quantity for its complete receipts.
- Inputs support up to 32 unique demand lines, 1,000,000 units per demand or pack, and $1,000,000 per monetary input. Case prices must be positive. Quote intake accepts ordinary UTF-8 comma-separated CSV and literal-cell XLSX quotes. Formula and error cells require source correction when mapped to a required field.

## Verification

```powershell
npm.cmd test
npm.cmd run test:edge
node tests/edge-demand.mjs
```

The browser tests require Microsoft Edge and Playwright Core. Install the optional test dependency with `npm.cmd install --no-save --package-lock=false playwright-core` before running `npm.cmd run test:edge`, or set `PLAYWRIGHT_CORE` to an existing installation’s `index.mjs`. The browser suite builds and serves `dist`, imports both formats into a fresh Edge context and saves the full-basket screenshot and downloaded workbook under `.work/edge-run/`. It also exercises the one-click demo in another empty context, checks interval boundaries, applies a quantity, revises and reimports prices, reopens a saved workspace and inspects historical eligibility. The XLSX assertions read receipt lines, freight, source cells, revisions and cached numeric values from the downloaded bytes.

To refresh the committed screenshot and workbook after reviewing a change, run `node tests/edge.mjs --dist --save-evidence` after the build. To regenerate the reviewed sample after an intentional fixture change, run `node tests/edge.mjs --capture-demo`. This records the real import decisions in `samples/reviewed-demo.json`. The file contains supplier records only. The optimizer calculates recommendations on demand.

The default split browser test writes `.work/split-1750.png`, `.work/split-1750.xlsx`, `.work/split-1751.xlsx` and `.work/off-1750.xlsx`. To intentionally refresh the split screenshot and workbook under `evidence/`, run the following commands.

```powershell
npm.cmd run build
node tests/edge-split.mjs --dist --save-evidence
```

[Split sourcing baseline and verification](evidence/split-sourcing.md) · [Original milestone](evidence/milestone.md)
