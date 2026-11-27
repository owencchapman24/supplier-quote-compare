export const $=id=>document.getElementById(id)
export const esc=v=>String(v ?? '').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]))
const dollars=new Intl.NumberFormat('en-US',{style:'currency',currency:'USD'})
export const money=n=>dollars.format(n/100)
export const number=n=>n.toLocaleString('en-US')
export const option=(v,t)=>'<option value="'+esc(v)+'">'+esc(t)+'</option>'
export function notify(msg) {
  $('notice').textContent=msg
  $('notice').classList.add('visible')
  clearTimeout(notify.timer)
  notify.timer=setTimeout(()=>$('notice').classList.remove('visible'),4600)
}
export function heading(section,title,description,actions='') {
  return '<div class="page-head"><div><div class="eyebrow">'+esc(section)+'</div><h1>'+esc(title)+'</h1><p>'+esc(description)+'</p></div><div class="actions">'+actions+'</div></div>'
}
