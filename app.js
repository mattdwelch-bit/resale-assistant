const $ = id => document.getElementById(id);
const comps = $('comps');
const tpl = $('compTemplate');
let saved = [];
const APP_VERSION = '1.4.0';
const STORAGE_KEY = 'resale_items_v140';
const LEGACY_KEYS = ['resale_items_v131','resale_items_v121','resale_items'];
let photos = [];
let editIndex = null;
let detailIndex = null;

function money(n){return '$' + (isFinite(n)?Math.round(n):0).toLocaleString();}
function num(id){return +($(id)?.value || 0) || 0;}
function today(){return new Date().toISOString().slice(0,10);}
function esc(v){return String(v ?? '').replace(/[&<>"]/g, m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[m]));}

function setView(viewId){
  document.querySelectorAll('.view').forEach(v=>v.classList.toggle('active', v.id===viewId));
  document.querySelectorAll('.tab').forEach(t=>t.classList.toggle('active', t.dataset.view===viewId));
  window.scrollTo({top:0,behavior:'smooth'});
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

function statusClass(status){return 'status ' + String(status || '').toLowerCase().replaceAll(' ','-');}

function openItemsDb(){
  return new Promise((resolve,reject)=>{
    if(!('indexedDB' in window)) return resolve(null);
    const req=indexedDB.open('ResaleAssistantDB',1);
    req.onupgradeneeded=()=>{
      const db=req.result;
      if(!db.objectStoreNames.contains('kv')) db.createObjectStore('kv');
    };
    req.onsuccess=()=>resolve(req.result);
    req.onerror=()=>reject(req.error);
  });
}

async function idbGet(key){
  const db=await openItemsDb();
  if(!db) return null;
  return new Promise((resolve,reject)=>{
    const tx=db.transaction('kv','readonly');
    const req=tx.objectStore('kv').get(key);
    req.onsuccess=()=>resolve(req.result || null);
    req.onerror=()=>reject(req.error);
  });
}

async function idbSet(key,value){
  const db=await openItemsDb();
  if(!db) throw new Error('IndexedDB unavailable');
  return new Promise((resolve,reject)=>{
    const tx=db.transaction('kv','readwrite');
    tx.objectStore('kv').put(value,key);
    tx.oncomplete=()=>resolve();
    tx.onerror=()=>reject(tx.error);
  });
}

async function loadSaved(){
  try{
    const fromIdb=await idbGet(STORAGE_KEY);
    if(Array.isArray(fromIdb)){ saved=fromIdb; return; }

    for(const key of LEGACY_KEYS){
      const legacyIdb=await idbGet(key);
      if(Array.isArray(legacyIdb)){ saved=legacyIdb; await persist(); return; }
    }

    for(const key of LEGACY_KEYS){
      const raw=localStorage.getItem(key);
      if(raw){
        saved=JSON.parse(raw) || [];
        await persist();
        return;
      }
    }
    saved=[];
  }catch(e){
    console.warn('Could not load saved inventory',e);
    saved=[];
  }
}

async function persist(){
  await idbSet(STORAGE_KEY,saved);
  try{ localStorage.setItem(STORAGE_KEY,JSON.stringify(saved.map(i=>({...i,photos:[]})))); }catch(e){}
}


function currentItemFromForm(){
  const r=calc();
  return {
    date: editIndex===null ? new Date().toISOString() : (saved[editIndex]?.date || new Date().toISOString()),
    updated:new Date().toISOString(),
    name:$('itemName').value.trim(),
    category:$('category').value,
    era:$('era').value,
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
}

function fillForm(item){
  $('itemName').value=item.name||'';
  $('category').value=item.category||'Furniture';
  $('era').value=item.era||'Unknown / Not sure';
  $('condition').value=item.condition||'1';
  $('buyCost').value=item.buyCost||'';
  $('sourceFound').value=item.sourceFound||'Garage Sale';
  $('purchaseDate').value=item.purchaseDate||today();
  $('purchaseLocation').value=item.purchaseLocation||'';
  $('status').value=item.status||'Research Pending';
  $('listingPrice').value=item.listingPrice||'';
  $('listedWhere').value=item.listedWhere||'';
  $('actualSoldPrice').value=item.actualSoldPrice||'';
  $('actualFees').value=item.actualFees||'';
  $('notes').value=item.notes||'';
  photos=[...(item.photos||[])];
  renderPhotos();
  comps.innerHTML='';
  (item.vals&&item.vals.length?item.vals:[{}]).forEach(addComp);
  calc();
}

function resetForm(){
  editIndex=null;
  $('formTitle').textContent='2. Item Details';
  $('saveItem').textContent='Save item';
  $('cancelEdit').hidden=true;
  ['itemName','buyCost','notes','purchaseLocation','listingPrice','listedWhere','actualSoldPrice','actualFees'].forEach(id=>$(id).value='');
  $('purchaseDate').value=today();
  $('category').selectedIndex=0;
  $('era').selectedIndex=0;
  $('condition').selectedIndex=0;
  $('sourceFound').selectedIndex=0;
  $('status').selectedIndex=0;
  photos=[]; renderPhotos();
  comps.innerHTML=''; addComp();
}

function startEdit(index){
  editIndex=index;
  fillForm(saved[index]);
  $('formTitle').textContent='2. Edit Item';
  $('saveItem').textContent='Save changes';
  $('cancelEdit').hidden=false;
  setView('newItemView');
}

function renderSaved(){
  const wrap = $('savedItems');
  const q=($('inventorySearch')?.value||'').toLowerCase();
  const f=$('statusFilter')?.value||'';
  const filtered=saved.map((item,index)=>({item,index})).filter(({item})=>{
    const hay=[item.name,item.category,item.era,item.status,item.purchaseLocation,item.notes].join(' ').toLowerCase();
    return (!q || hay.includes(q)) && (!f || item.status===f);
  }).reverse();
  wrap.innerHTML=filtered.length?'':'<p>No matching saved items.</p>';
  filtered.forEach(({item,index})=>{
    const d=document.createElement('div');
    d.className='savedItem';
    const thumb = item.photos?.[0] ? `<img class="thumb" src="${item.photos[0]}" alt="${esc(item.name||'Saved item')}">` : `<div class="thumb"></div>`;
    const profit = item.actualSoldPrice ? (+item.actualSoldPrice||0)-(+item.actualFees||0)-(+item.buyCost||0) : item.profit;
    d.innerHTML=`
      <div class="savedItemHeader">
        ${thumb}
        <div>
          <strong>${esc(item.name||'Untitled item')} — ${money(item.list)}</strong>
          <small>${esc(item.category||'')}${item.era ? ' · '+esc(item.era) : ''} · Paid ${money(+item.buyCost||0)} · Max buy ${money(item.maxBuy)} · Profit ${money(profit)}</small>
          <div class="${statusClass(item.status)}">${esc(item.status||'Research Pending')}</div>
        </div>
      </div>
      <p>${item.purchaseLocation?'<b>Found:</b> '+esc(item.purchaseLocation)+'<br>':''}${item.listedWhere?'<b>Listed:</b> '+esc(item.listedWhere)+'<br>':''}${esc(item.notes||'')}</p>
      <div class="buttonRow"><button class="viewItem secondary" type="button">View</button><button class="editItem" type="button">Edit</button><button class="deleteItem" type="button">Delete</button></div>`;
    d.querySelector('.viewItem').onclick=()=>showDetail(index);
    d.querySelector('.editItem').onclick=()=>startEdit(index);
    d.querySelector('.deleteItem').onclick=async()=>{
      if(confirm('Delete this saved item?')){saved.splice(index,1);await persist();renderSaved();}
    };
    wrap.appendChild(d);
  });
}

function showDetail(index){
  detailIndex=index;
  const item=saved[index];
  const profit = item.actualSoldPrice ? (+item.actualSoldPrice||0)-(+item.actualFees||0)-(+item.buyCost||0) : item.profit;
  const photoHtml=(item.photos||[]).map((p,i)=>`<img src="${p}" alt="Photo ${i+1}">`).join('');
  const compHtml=(item.vals||[]).map(c=>`<li>${money(+c.sold||0)} + ship ${money(+c.ship||0)} · match ${c.match} · ${esc(c.source||'')}</li>`).join('') || '<li>No comps saved.</li>';
  $('itemDetail').innerHTML=`
    <div class="detailHeader">
      <h2>${esc(item.name||'Untitled item')}</h2>
      <div class="${statusClass(item.status)}">${esc(item.status||'Research Pending')}</div>
    </div>
    <div class="detailPhotos">${photoHtml || '<div class="emptyPhoto">No photos</div>'}</div>
    <div class="detailGrid">
      <div><span>Category</span><strong>${esc(item.category||'')}</strong></div>
      <div><span>Era</span><strong>${esc(item.era||'')}</strong></div>
      <div><span>Paid</span><strong>${money(+item.buyCost||0)}</strong></div>
      <div><span>List</span><strong>${money(item.list)}</strong></div>
      <div><span>Avg sold</span><strong>${money(item.avg)}</strong></div>
      <div><span>Profit</span><strong>${money(profit)}</strong></div>
    </div>
    <p class="call">${esc(item.call||'')}</p>
    <p>${item.purchaseDate?'<b>Purchased:</b> '+esc(item.purchaseDate)+'<br>':''}${item.sourceFound?'<b>Source:</b> '+esc(item.sourceFound)+'<br>':''}${item.purchaseLocation?'<b>Location:</b> '+esc(item.purchaseLocation)+'<br>':''}${item.listedWhere?'<b>Listed where:</b> '+esc(item.listedWhere)+'<br>':''}${esc(item.notes||'')}</p>
    <h3>Comps</h3><ul>${compHtml}</ul>
    <div class="buttonRow"><button id="detailEdit">Edit item</button><button id="detailDelete" class="deleteItem">Delete item</button></div>`;
  $('detailEdit').onclick=()=>startEdit(index);
  $('detailDelete').onclick=async()=>{ if(confirm('Delete this saved item?')){saved.splice(index,1);await persist();renderSaved();setView('inventoryView');} };
  setView('detailView');
}

async function saveItem(){
  const item=currentItemFromForm();
  if(editIndex===null){ saved.push(item); }
  else { saved[editIndex]=item; detailIndex=editIndex; }
  try{
    await persist();
    renderSaved();
    const edited=editIndex;
    resetForm();
    if(edited===null) setView('inventoryView'); else showDetail(edited);
  } catch(e){
    alert('This item could not be saved. Try deleting a few photos or older saved items.');
  }
}

function exportCsv(){
  const rows=[['Date Added','Updated','Item','Category','Era','Condition','Where Found','Purchase Date','Purchase Location','Buy Cost','Status','Listing Price','Listed Where','Actual Sold Price','Actual Fees','Avg Sold','Quick Price','List Price','Hold Price','Max Buy','Profit','Recommendation','Notes','Photo Count']];
  saved.forEach(i=>{
    const actualProfit=(+i.actualSoldPrice||0)?(+i.actualSoldPrice||0)-(+i.actualFees||0)-(+i.buyCost||0):'';
    rows.push([i.date,i.updated||'',i.name,i.category,i.era||'',i.conditionText,i.sourceFound,i.purchaseDate,i.purchaseLocation,i.buyCost,i.status,i.listingPrice,i.listedWhere,i.actualSoldPrice,i.actualFees,Math.round(i.avg),Math.round(i.quick),Math.round(i.list),Math.round(i.hold),Math.round(i.maxBuy),actualProfit===''?Math.round(i.profit):Math.round(actualProfit),i.call,i.notes,i.photos?.length||0]);
  });
  const csv=rows.map(r=>r.map(v=>'"'+String(v??'').replaceAll('"','""')+'"').join(',')).join('\n');
  const blob=new Blob([csv],{type:'text/csv'});
  const a=document.createElement('a');
  a.href=URL.createObjectURL(blob);
  a.download='resale_items_v140.csv';
  a.click();
}



async function init(){
  await loadSaved();
  $('photoInput').addEventListener('change', e=>handlePhotos(e.target.files));
  ['condition','buyCost','listingPrice','actualSoldPrice','actualFees'].forEach(id=>$(id).addEventListener('input',calc));
  $('addComp').onclick=()=>addComp();
  $('saveItem').onclick=saveItem;
  $('exportCsv').onclick=exportCsv;
  $('clearForm').onclick=resetForm;
  $('cancelEdit').onclick=()=>{resetForm();setView('inventoryView');};
  $('backToInventory').onclick=()=>setView('inventoryView');
  $('inventorySearch').addEventListener('input',renderSaved);
  $('statusFilter').addEventListener('change',renderSaved);
  $('purchaseDate').value=today();
  addComp();
  renderSaved();
  setupUpdates();
}

async function clearAppCaches(){
  if('caches' in window){
    const keys=await caches.keys();
    await Promise.all(keys.map(k=>caches.delete(k)));
  }
}

function showUpdateBanner(message='New version available'){
  const banner=$('updateBanner');
  banner.hidden=false;
  banner.querySelector('strong').textContent=message;
}

function setupUpdates(){
  $('versionLabel').textContent='Version '+APP_VERSION;
  $('appStatus').textContent='Loaded Version '+APP_VERSION;
  $('forceRefresh').onclick=async()=>{
    $('appStatus').textContent='Refreshing app cache...';
    await clearAppCaches();
    if(navigator.serviceWorker?.controller){
      navigator.serviceWorker.controller.postMessage({type:'CLEAR_CACHES'});
    }
    setTimeout(()=>location.reload(),350);
  };
  $('updateNow').onclick=async()=>{
    $('appStatus').textContent='Updating app...';
    await clearAppCaches();
    if(window.__waitingWorker){ window.__waitingWorker.postMessage({type:'SKIP_WAITING'}); }
    setTimeout(()=>location.reload(),500);
  };

  if(!('serviceWorker' in navigator)) return;
  navigator.serviceWorker.register('sw.js?v='+APP_VERSION).then(reg=>{
    if(reg.waiting){ window.__waitingWorker=reg.waiting; showUpdateBanner(); }
    reg.addEventListener('updatefound',()=>{
      const newWorker=reg.installing;
      if(!newWorker) return;
      newWorker.addEventListener('statechange',()=>{
        if(newWorker.state==='installed' && navigator.serviceWorker.controller){
          window.__waitingWorker=newWorker;
          showUpdateBanner();
        }
      });
    });
    reg.update().catch(()=>{});
  }).catch(()=>{});

  navigator.serviceWorker.addEventListener('controllerchange',()=>{
    if(!window.__reloading){ window.__reloading=true; location.reload(); }
  });
}

init();
