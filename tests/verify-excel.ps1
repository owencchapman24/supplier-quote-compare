param([Parameter(Mandatory=$true)][string]$Workbook)
$ErrorActionPreference='Stop'
$excelApp=$null
$book=$null
try {
  $excelApp=New-Object -ComObject Excel.Application
  $excelApp.Visible=$false
  $excelApp.DisplayAlerts=$false
  $excelApp.AutomationSecurity=3
  $book=$excelApp.Workbooks.Open((Resolve-Path -LiteralPath $Workbook).Path, 0, $true)
  $excelApp.Calculate()
  $summary=$book.Worksheets.Item('Plan comparison')
  $observed=@($summary.Range('F2').Value2,$summary.Range('F3').Value2)
  if($observed[0] -ne 141 -or $observed[1] -ne 171) {throw "Unexpected Excel totals $observed"}
  $all=$book.Worksheets.Item('All plan orders')
  $plans=@{}
  $deliveryRows=@{}
  for($i=2;$i -le $all.UsedRange.Rows.Count;$i++) {
    $plan=$all.Cells.Item($i,1).Text
    $supplier=$all.Cells.Item($i,2).Text
    $kind=$all.Cells.Item($i,3).Text
    if (!$plans.ContainsKey($plan)) {$plans[$plan]=[decimal]0}
    if ($kind -eq 'Order line') {
      $cases=[int]$all.Cells.Item($i,8).Value2
      $pack=[int]$all.Cells.Item($i,9).Value2
      $need=[int]$all.Cells.Item($i,7).Value2
      $received=[int]$all.Cells.Item($i,10).Value2
      $price=[decimal]$all.Cells.Item($i,12).Value2
      if($received -ne $cases*$pack -or [int]$all.Cells.Item($i,11).Value2 -ne ($received-$need)) {throw "Bad quantity at row $i"}
      if([decimal]$all.Cells.Item($i,13).Value2 -ne $cases*$price -or $all.Cells.Item($i,17).Value2 -lt 1) {throw "Bad price/source at row $i"}
      $plans[$plan]+=$cases*$price
    } elseif($kind -eq 'Order delivery') {
      $key="$plan|$supplier"
      if($deliveryRows.ContainsKey($key)) {throw "Repeated delivery for $key"}
      $deliveryRows[$key]=[decimal]$all.Cells.Item($i,14).Value2
      $plans[$plan]+=$deliveryRows[$key]
    }
  }
  if($plans['Plan 1'] -ne 141 -or $plans['Plan 2'] -ne 171) {throw 'Unable to reconstruct both plans'}
  $clip=@()
  $wrapSamples=@()
  foreach($sheet in $book.Worksheets) {
    $used=$sheet.UsedRange
    $heights=@()
    for($i=1;$i -le $used.Rows.Count;$i++){ $heights+=([double]$sheet.Rows.Item($i).RowHeight) }
    $null=$used.EntireRow.AutoFit()
    for($i=1;$i -le $used.Rows.Count;$i++){
      $need=[double]$sheet.Rows.Item($i).RowHeight
      if ($need -gt $heights[$i-1]+0.8) { $clip+="$($sheet.Name) row $i - saved $($heights[$i-1]) pt, Excel AutoFit $need pt" }
      if ($need -ge 30 -and $wrapSamples.Count -lt 7) {$wrapSamples+="$($sheet.Name) row $i - saved $($heights[$i-1]) pt, Excel AutoFit $need pt"}
    }
  }
  [pscustomobject]@{excelVersion=$excelApp.Version;build=$excelApp.Build;openedReadOnly=$book.ReadOnly;sheets=$book.Worksheets.Count;calculatedCash=$observed;reconstructedCash=$plans;deliveryByOrder=$deliveryRows;potentialClipping=$clip;wrappedRows=$wrapSamples}|ConvertTo-Json -Depth 5
} finally {
  if($book){$book.Close($false)}
  if($excelApp){$excelApp.Quit();[void][Runtime.InteropServices.Marshal]::FinalReleaseComObject($excelApp)}
}
