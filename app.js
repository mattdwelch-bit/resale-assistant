const $ = id => document.getElementById(id);
const comps = $('comps');
const tpl = $('compTemplate');
let saved = JSON.parse(localStorage.getItem('resale_items') || '[]');
let photos = [];

function money(n){return '$' + (isFinite(n)?Math.round(n):0).toLocaleString();}
function num(id){return +($(id)?.value || 0) || 0;}
function today(){return new Date().toISOString().slice(0,10);}

function setView(viewId){
  document.querySelectorAll('.view').forEach(v=>v.classList.toggle('active', v.id===viewId));
  document.querySelectorAll('.tab').forEach(t=>t.classList.toggle('active', t.dataset.view===viewId));
}

document.querySelectorAll('.tab').forEach(t=>t.addEventListener('click',()=>setView(t.dataset.view)));

async function compressImage(file, maxSize=1100, quality=.72){
  const dataUrl = await new Promise((resolve,reject)=>{const r=new FileReader();r.onload=()=>resolve(r.result);r.onerror=reject;r.readAsDataURL(file);});
  const img = await new Promise((resolve,reject)=>{const i=new Image();i.onload=()=>resolve(i);i.onerror=reject;i.src=dataUrl;});
  const scale = Math.min(1, maxSize / Math.max(img.width, img.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(img.width * scale);
  canvas.height = Math.round(img.height * scale);
  canvas.getContext('2d').drawImage(img,0,0,canvas.width,canvas.height);
  return canvas.toDataURL('image/jpeg', quality);
}

async function handlePhotos(files){
  for(const file of files){
    if(!file.type.startsWith('image/')) continue;
    try{ photos.push(await compressImage(file)); }catch(e){ console.warn('Photo skipped', e); }
  }
  renderPhotos();
}

function renderPhotos(){
  const wrap = $('photoPreview');
  wrap.innerHTML = '';
  photos.forEach((src,idx)=>{
    const tile = document.createElement('div');
    tile.className = 'photoTile';
    tile.innerHTML = `<img src="${src}" alt="Item photo ${idx+1}"><button type="button">×</button>`;
    tile.querySelector('button').onclick=()=>{photos.splice(idx,1);renderPhotos();};
    wrap.appendChild(tile);
  });
}

function addComp(data={}){
  const node=tpl.content.cloneNode(true);
  const el=node.querySelector('.comp');
  el.querySelector('.sold').value=data.sold||'';
  el.querySelector('.ship').value=data.ship||'';
  el.querySelector('.match').value=data.match||'1';
  el.querySelector('.source').value=data.source||'';
  el.querySelector('.remove').onclick=()=>{el.remove();calc();};
  el.querySelectorAll('input,select').forEach(x=>x.addEventListener('input',calc));
  comps.appendChild(node);
  calc();
}

function getCompValues(){
  return [...document.querySelectorAll('.comp')].map(c=>({
    sold:+c.querySelector('.sold').value||0,
    ship:+c.querySelector('.ship').value||0,
    match:+c.querySelector('.match').value||1,
    source:c.querySelector('.source').value.trim()
  })).filter(c=>c.sold>0);
}

function calc(){
  const vals=getCompValues();
  const condition=+$('condition').value;
  let weighted=0,weight=0;
  vals.forEach(c=>{weighted+=(c.sold+c.ship)*c.match;weight+=c.match;});
  const avg=weight?weighted/weight*condition:0;
  const list=num('listingPrice') || avg*1.08;
  const quick=avg*.75;
  const hold=avg*1.25;
  const maxBuy=avg*.35;
  const cost=num('buyCost');
  const estimatedFees=list*.15;
  const estimatedProfit=list-estimatedFees-cost;
  const actualSold=num('actualSoldPrice');
  const actualFees=num('actualFees');
  const actualProfit=actualSold ? actualSold-actualFees-cost : 0;
  $('avgSold').textContent=money(avg);
  $('quickPrice').textContent=money(quick);
  $('listPrice').textContent=money(list);
  $('holdPrice').textContent=money(hold);
  $('maxBuy').textContent=money(maxBuy);
  $('profit').textContent=money(actualSold ? actualProfit : estimatedProfit);
  let call='Add comps to get a recommendation.';
  if(vals.length){
    if(actualSold) call='SOLD: actual profit '+money(actualProfit)+'.';
    else if(cost && cost<=maxBuy*.7) call='BUY: plenty of margin.';
    else if(cost && cost<=maxBuy) call='BUY if condition and demand are solid.';
    else if(cost) call='PASS unless it is rare, local-only, or very easy to sell.';
    else call='Target buy price: '+money(maxBuy)+' or less.';
  }
  $('buyCall').textContent=call;
  return {avg,list,quick,hold,maxBuy,profit: actualSold ? actualProfit : estimatedProfit, actualProfit, vals, call};
}

function statusClass(status){
  return 'status ' + String(status || '').toLowerCase().replaceAll(' ','-');
}

function renderSaved(){
  const wrap = $('savedItems');
  wrap.innerHTML=saved.length?'':'<p>No saved items yet.</p>';
  saved.slice().reverse().forEach((item,reverseIndex)=>{
    const index = saved.length - 1 - reverseIndex;
    const d=document.createElement('div');
    d.className='savedItem';
    const thumb = item.photos?.[0] ? `<img class="thumb" src="${item.photos[0]}" alt="${item.name||'Saved item'}">` : `<div class="thumb"></div>`;
    const profit = item.actualSoldPrice ? (+item.actualSoldPrice||0)-(+item.actualFees||0)-(+item.buyCost||0) : item.profit;
    d.innerHTML=`
      <div class="savedItemHeader">
        ${thumb}
        <div>
          <strong>${item.name||'Untitled item'} — ${money(item.list)}</strong>
          <small>${item.category} · Paid ${money(+item.buyCost||0)} · Max buy ${money(item.maxBuy)} · Profit ${money(profit)}</small>
          <div class="${statusClass(item.status)}">${item.status||'Research Pending'}</div>
        </div>
      </div>
      <p>${item.purchaseLocation?'<b>Found:</b> '+item.purchaseLocation+'<br>':''}${item.listedWhere?'<b>Listed:</b> '+item.listedWhere+'<br>':''}${item.notes||''}</p>
      <button class="deleteItem" type="button">Delete item</button>`;
    d.querySelector('.deleteItem').onclick=()=>{
      if(confirm('Delete this saved item?')){saved.splice(index,1);localStorage.setItem('resale_items',JSON.stringify(saved));renderSaved();}
    };
    wrap.appendChild(d);
  });
}

function saveItem(){
  const r=calc();
  const item={
    date:new Date().toISOString(),
    name:$('itemName').value.trim(),
    category:$('category').value,
    conditionText:$('condition').selectedOptions[0].text,
    condition:$('condition').value,
    buyCost:$('buyCost').value,
    sourceFound:$('sourceFound').value,
    purchaseDate:$('purchaseDate').value,
    purchaseLocation:$('purchaseLocation').value.trim(),
    status:$('status').value,
    listingPrice:$('listingPrice').value,
    listedWhere:$('listedWhere').value.trim(),
    actualSoldPrice:$('actualSoldPrice').value,
    actualFees:$('actualFees').value,
    notes:$('notes').value.trim(),
    photos:[...photos],
    ...r
  };
  saved.push(item);
  try{
    localStorage.setItem('resale_items',JSON.stringify(saved));
    renderSaved();
    setView('inventoryView');
  } catch(e){
    alert('This item could not be saved. Try deleting a few photos or older saved items.');
    saved.pop();
  }
}

function exportCsv(){
  const rows=[['Date Added','Item','Category','Condition','Where Found','Purchase Date','Purchase Location','Buy Cost','Status','Listing Price','Listed Where','Actual Sold Price','Actual Fees','Avg Sold','Quick Price','List Price','Hold Price','Max Buy','Profit','Recommendation','Notes','Photo Count']];
  saved.forEach(i=>{
    const actualProfit=(+i.actualSoldPrice||0)?(+i.actualSoldPrice||0)-(+i.actualFees||0)-(+i.buyCost||0):'';
    rows.push([i.date,i.name,i.category,i.conditionText,i.sourceFound,i.purchaseDate,i.purchaseLocation,i.buyCost,i.status,i.listingPrice,i.listedWhere,i.actualSoldPrice,i.actualFees,Math.round(i.avg),Math.round(i.quick),Math.round(i.list),Math.round(i.hold),Math.round(i.maxBuy),actualProfit===''?Math.round(i.profit):Math.round(actualProfit),i.call,i.notes,i.photos?.length||0]);
  });
  const csv=rows.map(r=>r.map(v=>'"'+String(v??'').replaceAll('"','""')+'"').join(',')).join('\n');
  const blob=new Blob([csv],{type:'text/csv'});
  const a=document.createElement('a');
  a.href=URL.createObjectURL(blob);
  a.download='resale_items_v12.csv';
  a.click();
}

function clearForm(){
  ['itemName','buyCost','notes','purchaseLocation','listingPrice','listedWhere','actualSoldPrice','actualFees'].forEach(id=>$(id).value='');
  $('purchaseDate').value=today();
  $('category').selectedIndex=0;
  $('condition').selectedIndex=0;
  $('sourceFound').selectedIndex=0;
  $('status').selectedIndex=0;
  photos=[]; renderPhotos();
  comps.innerHTML=''; addComp();
}

$('photoInput').addEventListener('change', e=>handlePhotos(e.target.files));
['condition','buyCost','listingPrice','actualSoldPrice','actualFees'].forEach(id=>$(id).addEventListener('input',calc));
$('addComp').onclick=()=>addComp();
$('saveItem').onclick=saveItem;
$('exportCsv').onclick=exportCsv;
$('clearForm').onclick=clearForm;
$('purchaseDate').value=today();
addComp();
renderSaved();
if('serviceWorker' in navigator){navigator.serviceWorker.register('sw.js').catch(()=>{});}
