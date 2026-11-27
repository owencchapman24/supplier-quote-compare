param(
  [Parameter(Mandatory)][string]$Workbook,
  [Parameter(Mandatory)][ValidateSet(1750,1751)][int]$CupDemand
)
$ErrorActionPreference = 'Stop'
$excel = $null
$book = $null
function Assert-Equal($Actual, $Expected, [string]$Subject) {
  if ($Actual -ne $Expected) { throw "$Subject expected $Expected, got $Actual" }
}
function Get-ColumnMap($Sheet) {
  $map = @{}
  for ($column = 1; $column -le $Sheet.UsedRange.Columns.Count; $column++) {
    $map[$Sheet.Cells.Item(1,$column).Text] = $column
  }
  return $map
}

# The independent purchase ledger comes from the original offer sheets.
$catalog = @{
  'A-12' = @{Supplier='Supplier A'; Item='Cups'; Pack=1000; Cents=4800}
  'B-C12' = @{Supplier='Supplier B'; Item='Cups'; Pack=750; Cents=3300}
  'B-L90' = @{Supplier='Supplier B'; Item='Lids'; Pack=1000; Cents=4000}
}
$fees = @{'Supplier A'=0; 'Supplier B'=3500}
$expectedCases = if ($CupDemand -eq 1750) { @{'A-12'=1;'B-C12'=1;'B-L90'=1} } else { @{'A-12'=2;'B-L90'=1} }
$expectedCash = if ($CupDemand -eq 1750) {15600} else {17100}
try {
  $excel = New-Object -ComObject Excel.Application
  $excel.Visible = $false
  $excel.DisplayAlerts = $false
  $excel.AutomationSecurity = 3
  $book = $excel.Workbooks.Open((Resolve-Path -LiteralPath $Workbook).Path,0,$true)
  $excel.CalculateFull()
  $sheet = $book.Worksheets.Item('Order by supplier')
  $columns = Get-ColumnMap $sheet
  $orderGoods = @{}
  $orderFees = @{}
  $coverage = @{}
  $received = @{Cups=0; Lids=0}
  $lines = @()
  for ($row = 2; $row -le $sheet.UsedRange.Rows.Count; $row++) {
    $kind = $sheet.Cells.Item($row,$columns['Record']).Text
    $supplier = $sheet.Cells.Item($row,$columns['Supplier']).Text
    if ($kind -eq 'Order line') {
      $sku = $sheet.Cells.Item($row,$columns['SKU']).Text
      Assert-Equal $sheet.Cells.Item($row,$columns['Excess']).Text '' "Line-level excess must stay blank"
      Assert-Equal $sheet.Cells.Item($row,$columns['Required units']).Text '' "Line-level demand must stay blank"
      $offer = $catalog[$sku]
      if (!$offer) {throw "Unexpected SKU $sku"}
      $cases = [decimal]$sheet.Cells.Item($row,$columns['Cases']).Value2
      Assert-Equal $cases $expectedCases[$sku] "Case count for $sku"
      Assert-Equal $supplier $offer.Supplier "Supplier for $sku"
      Assert-Equal ([int]$sheet.Cells.Item($row,$columns['Units per case']).Value2) $offer.Pack "Pack for $sku"
      Assert-Equal (100*[decimal]$sheet.Cells.Item($row,$columns['USD per case']).Value2) $offer.Cents "Case cents for $sku"
      $subtotal = $cases*$offer.Cents
      $units = $cases*$offer.Pack
      Assert-Equal (100*[decimal]$sheet.Cells.Item($row,$columns['Merchandise']).Value2) $subtotal "Extended cents for $sku"
      Assert-Equal ([int]$sheet.Cells.Item($row,$columns['Received']).Value2) $units "Received for $sku"
      $received[$offer.Item] += $units
      $orderGoods[$supplier] += $subtotal
      $lines += [pscustomobject]@{sku=$sku;cases=$cases;received=$units;merchandiseCents=$subtotal}
    } elseif ($kind -eq 'Item coverage') {
      $label = $sheet.Cells.Item($row,$columns['Demand match']).Text
      $item = if ($label -like 'Cups*') {'Cups'} elseif ($label -like 'Lids*') {'Lids'} else {throw "Unknown demand $label"}
      if ($coverage.ContainsKey($item)) {throw "Repeated aggregate for $item"}
      $need = if ($item -eq 'Cups') {$CupDemand} else {1000}
      Assert-Equal ([int]$sheet.Cells.Item($row,$columns['Required units']).Value2) $need "Required $item"
      Assert-Equal ([int]$sheet.Cells.Item($row,$columns['Combined received']).Value2) $received[$item] "Combined $item units"
      Assert-Equal ([int]$sheet.Cells.Item($row,$columns['Excess']).Value2) ($received[$item]-$need) "Aggregate $item excess"
      $coverage[$item] = $received[$item]-$need
    } elseif ($kind -eq 'Order delivery') {
      if ($orderFees.ContainsKey($supplier)) {throw "Repeated delivery fee for $supplier"}
      $fee = 100*[decimal]$sheet.Cells.Item($row,$columns['Delivery']).Value2
      Assert-Equal $fee $fees[$supplier] "Delivery cents for $supplier"
      $orderFees[$supplier] = $fee
      $delivered = 100*[decimal]$sheet.Cells.Item($row,$columns['Delivered order cost']).Value2
      Assert-Equal $delivered ($orderGoods[$supplier]+$fee) "Delivered cents for $supplier"
    }
  }
  Assert-Equal $coverage.Count 2 'One aggregate per required item'
  Assert-Equal $lines.Count $expectedCases.Count 'Number of order lines'
  Assert-Equal $orderFees.Count $orderGoods.Count 'Number of delivery rows'
  $goods = ($orderGoods.Values | Measure-Object -Sum).Sum
  $freight = ($orderFees.Values | Measure-Object -Sum).Sum
  Assert-Equal ($goods+$freight) $expectedCash 'Independent delivered cash'
  $cupExcess = $received['Cups']-$CupDemand
  Assert-Equal $received['Lids'] 1000 'Lid fulfillment'
  Assert-Equal $cupExcess $(if($CupDemand -eq 1750){0}else{249}) 'Total cup excess'
  $summary = $book.Worksheets.Item('Plan comparison')
  $cols = Get-ColumnMap $summary
  Assert-Equal (100*[decimal]$summary.Cells.Item(2,$cols['Total cash']).Value2) $expectedCash 'Excel comparison total'
  Assert-Equal ([int]$summary.Cells.Item(2,$cols['Excess units']).Value2) $cupExcess 'Excel aggregate excess'
  $detail = $book.Worksheets.Item('All plan orders')
  $dc = Get-ColumnMap $detail
  $matrix = $detail.UsedRange.Value2
  $plans = @{}
  for ($r=2; $r -le $matrix.GetLength(0); $r++) {
    $id = $matrix[$r,$dc['Plan']]
    if (!$plans.ContainsKey($id)) {$plans[$id] = @{goods=@{};fees=@{};units=@{Cups=0;Lids=0}}}
    $p = $plans[$id]
    $vendor = $matrix[$r,$dc['Supplier']]
    $kind = $matrix[$r,$dc['Record']]
    if ($kind -eq 'Order line') {
      $o = $catalog[$matrix[$r,$dc['SKU']]]
      Assert-Equal $vendor $o.Supplier "$id quote supplier"
      $n = [decimal]$matrix[$r,$dc['Cases']]
      $amount = $n * $o.Cents
      Assert-Equal (100*[decimal]$matrix[$r,$dc['Merchandise']]) $amount "$id line subtotal"
      $p.goods[$vendor] += $amount
      $p.units[$o.Item] += $n * $o.Pack
    } elseif ($kind -eq 'Order delivery') {
      if ($p.fees.ContainsKey($vendor)) {throw "Repeated fee for $id/$vendor"}
      $p.fees[$vendor] = $fees[$vendor]
      Assert-Equal (100*[decimal]$matrix[$r,$dc['Delivery']]) $fees[$vendor] "$id delivery"
      Assert-Equal (100*[decimal]$matrix[$r,$dc['Delivered order cost']]) ($p.goods[$vendor]+$fees[$vendor]) "$id supplier total"
    }
  }
  $alternatives = @()
  $comparison = $summary.UsedRange.Value2
  for ($r=2; $r -le $comparison.GetLength(0); $r++) {
    $id = $comparison[$r,$cols['Plan']]
    $p = $plans[$id]
    Assert-Equal $p.goods.Count $p.fees.Count "$id order count"
    if ($p.units.Cups -lt $CupDemand -or $p.units.Lids -lt 1000) {throw "$id is incomplete"}
    $planCash = ($p.goods.Values | Measure-Object -Sum).Sum + ($p.fees.Values | Measure-Object -Sum).Sum
    Assert-Equal (100*[decimal]$comparison[$r,$cols['Total cash']]) $planCash "$id cash"
    Assert-Equal $comparison[$r,$cols['Excess units']] ($p.units.Cups-$CupDemand+$p.units.Lids-1000) "$id aggregate excess"
    $alternatives += [int]$planCash
  }
  $expectedTotals = if ($CupDemand -eq 1750) {'15600,17100,17400'} else {'17100,17400,18900'}
  Assert-Equal ($alternatives -join ',') $expectedTotals 'All independently reconstructed complete plans'
  [pscustomobject]@{app='Excel Desktop';version=$excel.Version;build=$excel.Build;openedReadOnly=$book.ReadOnly;cupDemand=$CupDemand;lidDemand=1000;lines=$lines;merchandiseBySupplierCents=$orderGoods;deliveryBySupplierCents=$orderFees;cashCents=$goods+$freight;cupExcess=$cupExcess;lidExcess=0;allPlanCents=$alternatives} | ConvertTo-Json -Depth 5
} finally {
  if($book){$book.Close($false)}
  if($excel){$excel.Quit();[void][Runtime.InteropServices.Marshal]::FinalReleaseComObject($excel)}
}
