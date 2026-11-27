// Offline OOXML writer for the browser. Text cells always use inline strings.
const xml=s=>String(s).replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\uFFFE\uFFFF]/g,'').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;')
const ns='http://schemas.openxmlformats.org/spreadsheetml/2006/main'
const rel='http://schemas.openxmlformats.org/officeDocument/2006/relationships'
const pkg='http://schemas.openxmlformats.org/package/2006/relationships'
const decl='<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
const column=i=>i<26?String.fromCharCode(65+i):column(Math.floor(i/26)-1)+column(i%26)
const styles=`<styleSheet xmlns="${ns}"><numFmts count="1"><numFmt numFmtId="164" formatCode="&quot;$&quot;#,##0.00"/></numFmts><fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><color rgb="FFFFFFFF"/><sz val="11"/><name val="Calibri"/></font></fonts><fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FF154B3D"/><bgColor indexed="64"/></patternFill></fill></fills><borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="3">${[0,1,2].map(i=>'<xf numFmtId="'+(i===2?164:0)+'" fontId="'+(i===1?1:0)+'" fillId="'+(i===1?2:0)+'" borderId="0" xfId="0" applyAlignment="1" applyNumberFormat="1"><alignment vertical="center" wrapText="1"/></xf>').join('')}</cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>`
export const usd=cents=>cents==null?null:{value:cents/100,money:true}
export const computed=(value,formula,money=false)=>({value,formula,money})
function worksheet({headers,widths,rows}) {
  const body=[headers,...rows].map((row,i)=>{
    let lines=1
    const cells=row.map((v,j)=>{
      if(v==null) return ''
      const data=typeof v==='object'?v:{value:v}
      const {value,formula}=data
      const style=i===0?1:data.money?2:0
      const ref=column(j)+(i+1)
      const numeric=typeof value==='number'
      if(!numeric) {
        const wrapped=String(value).split('\n').reduce((n,s)=>n+Math.max(1,Math.ceil(s.length/(widths[j]*0.79))),0)
        lines=Math.max(lines,wrapped)
      }
      const cell='<c r="'+ref+'" s="'+style+'"'
      if(!numeric) return cell+' t="inlineStr"><is><t xml:space="preserve">'+xml(value)+'</t></is></c>'
      const calculation=formula?'<f>'+xml(formula)+'</f>':''
      return cell+'>'+calculation+'<v>'+value+'</v></c>'
    }).join('')
    return '<row r="'+(i+1)+'" ht="'+Math.min(409,Math.max(28,lines*16+9))+'" customHeight="1">'+cells+'</row>'
  }).join('')
  return `<worksheet xmlns="${ns}"><sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews><sheetFormatPr defaultRowHeight="20"/><cols>${widths.map((w,i)=>'<col min="'+(i+1)+'" max="'+(i+1)+'" width="'+w+'" customWidth="1"/>').join('')}</cols><sheetData>${body}</sheetData><autoFilter ref="A1:${column(headers.length-1)}${rows.length+1}"/></worksheet>`
}
export async function writeBook(sheets) {
  const zip=new globalThis.JSZip()
  const put=(name,content)=>zip.file(name,decl+content)
  const relationships=list=>'<Relationships xmlns="'+pkg+'">'+list.map(([id,type,target])=>'<Relationship Id="'+id+'" Type="'+rel+'/'+type+'" Target="'+target+'"/>').join('')+'</Relationships>'
  put('_rels/.rels',relationships([['book','officeDocument','xl/workbook.xml']]))
  put('xl/workbook.xml','<workbook xmlns="'+ns+'" xmlns:r="'+rel+'"><sheets>'+sheets.map((s,i)=>'<sheet name="'+xml(s.name)+'" sheetId="'+(i+1)+'" r:id="s'+i+'"/>').join('')+'</sheets></workbook>')
  put('xl/_rels/workbook.xml.rels',relationships([['styles','styles','styles.xml'],...sheets.map((s,i)=>['s'+i,'worksheet','worksheets/sheet'+(i+1)+'.xml'])]))
  put('xl/styles.xml',styles)
  sheets.forEach((s,i)=>put('xl/worksheets/sheet'+(i+1)+'.xml',worksheet(s)))
  const overrides=[['/xl/workbook.xml','sheet.main'],['/xl/styles.xml','styles'],...sheets.map((s,i)=>['/xl/worksheets/sheet'+(i+1)+'.xml','worksheet'])]
  put('[Content_Types].xml','<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/>'+overrides.map(([p,type])=>'<Override PartName="'+p+'" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.'+type+'+xml"/>').join('')+'</Types>')
  return zip.generateAsync({type:'blob',mimeType:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',compression:'DEFLATE'})
}
