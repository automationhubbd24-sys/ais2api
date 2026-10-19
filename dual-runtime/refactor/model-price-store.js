'use strict';
const fs=require('fs'),path=require('path'),crypto=require('crypto');
const {validatePrice}=require('./usage-metrics');
const clone=v=>JSON.parse(JSON.stringify(v));
const fail=(message,statusCode)=>Object.assign(Error(message),{statusCode});
function cleanPrice(p,revision){
 const out={currency:p?.currency,revision:String(revision),reasoningMode:p?.reasoningMode};
 for(const key of ['inputPerMillion','outputPerMillion','cachedPerMillion','reasoningPerMillion']){
  out[key]=p?.[key];
  if(typeof out[key]==='number' && out[key]>1000000)throw fail('Price rate too large',400);
 }
 try{validatePrice(out);}catch{throw fail('Invalid model price',400);}
 return out;
}
class ModelPriceStore{
 constructor(file){
  this.file=file;this.revision=0;this.prices=Object.create(null);this.scheduled=Object.create(null);this.blocked=false;
  try{
   const stat=fs.lstatSync(file);
   if(!stat.isFile()||stat.isSymbolicLink()||stat.size>2097152)throw Error('Invalid price file');
   const data=JSON.parse(fs.readFileSync(file,'utf8'));
   if(data.version!==1||!Number.isSafeInteger(data.revision)||data.revision<0||
     !data.prices||typeof data.prices!=='object'||Array.isArray(data.prices))throw Error('Invalid price file');
   for(const [model,p] of Object.entries(data.prices)){
    this.validateModel(model);
    if(!/^\d+$/.test(p.revision)||!Number.isSafeInteger(Number(p.revision))||
      Number(p.revision)>data.revision)throw Error('Invalid price revision');
    this.prices[model]=cleanPrice(p,p.revision);
   }
   // Optional future prices: {model:[{effectiveAt,price}]}. Request records snapshot the price
   // in effect when they start, so older records keep the rate that applied at the time.
   if(data.scheduled!==undefined){
    if(!data.scheduled||typeof data.scheduled!=='object'||Array.isArray(data.scheduled))throw Error('Invalid price file');
    for(const [model,list] of Object.entries(data.scheduled)){
     this.validateModel(model);
     if(!Array.isArray(list)||list.length>20)throw Error('Invalid price file');
     this.scheduled[model]=list.map(e=>{
      if(!Number.isSafeInteger(e?.effectiveAt)||e.effectiveAt<0)throw Error('Invalid price file');
      if(!/^\d+$/.test(e.price?.revision)||Number(e.price.revision)>data.revision)throw Error('Invalid price revision');
      return {effectiveAt:e.effectiveAt,price:cleanPrice(e.price,e.price.revision)};
     }).sort((a,b)=>a.effectiveAt-b.effectiveAt);
    }
   }
   this.revision=data.revision;
  }catch(e){if(e.code!=='ENOENT')throw Error('Price configuration invalid; file preserved');}
 }
 validateModel(model){
  if(typeof model!=='string'||!/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,199}$/.test(model))throw fail('Canonical model ID required',400);
 }
 effective(model,at=Date.now()){
  let p=this.prices[model];
  for(const e of this.scheduled[model]||[])if(e.effectiveAt<=at)p=e.price;
  return p;
 }
 snapshot(){
  const now=Date.now(),prices=Object.create(null),scheduled={};
  for(const m of new Set([...Object.keys(this.prices),...Object.keys(this.scheduled)])){
   const p=this.effective(m,now);if(p)prices[m]=clone(p);
   const future=(this.scheduled[m]||[]).filter(e=>e.effectiveAt>now);
   if(future.length)scheduled[m]=clone(future);
  }
  return {version:1,revision:this.revision,prices,scheduled,blocked:this.blocked,currency:'USD',estimated:true};
 }
 get(model,at=Date.now()){if(this.blocked)return;const p=this.effective(model,at);return p?clone(p):undefined;}
 set(input){
  if(this.blocked)throw fail('Price storage blocked; reconcile before retry',503);
  this.validateModel(input?.model);
  if(!Number.isSafeInteger(input.revision)||input.revision<0)throw fail('Invalid price revision',400);
  if(input.revision!==this.revision)throw fail('Price revision changed; refresh first',409);
  if(this.revision===Number.MAX_SAFE_INTEGER)throw fail('Price revision capacity reached',503);
  const revision=this.revision+1;
  let prices=this.prices,scheduled=this.scheduled;
  const now=Date.now();
  const keepFuture=list=>(list||[]).filter(e=>e.effectiveAt>now);
  if(input.clearScheduled===true){
   // Only future changes are cancelled; a change that already took effect stays.
   const base=this.effective(input.model,now);
   prices=Object.assign(Object.create(null),this.prices);if(base)prices[input.model]=base;
   scheduled=Object.assign(Object.create(null),this.scheduled);delete scheduled[input.model];
  }else if(input.effectiveAt!==undefined&&input.effectiveAt!==null){
   if(!Number.isSafeInteger(input.effectiveAt)||input.effectiveAt<=now||input.effectiveAt>now+5*366*86400000)
    throw fail('Effective time must be in the future',400);
   const price=cleanPrice(input.price,revision);
   const list=keepFuture(this.scheduled[input.model]).filter(e=>e.effectiveAt!==input.effectiveAt);
   if(list.length>=20)throw fail('Too many scheduled prices',400);
   // Prices whose time has come are folded into the base price so the file stays small.
   const base=this.effective(input.model,now);
   prices=Object.assign(Object.create(null),this.prices);if(base)prices[input.model]=base;
   scheduled=Object.assign(Object.create(null),this.scheduled,{[input.model]:[...list,{effectiveAt:input.effectiveAt,price}].sort((a,b)=>a.effectiveAt-b.effectiveAt)});
  }else{
   const price=cleanPrice(input.price,revision);
   if(!Object.hasOwn(this.prices,input.model)&&Object.keys(this.prices).length>=1000)throw fail('Price catalog capacity reached',400);
   prices=Object.assign(Object.create(null),this.prices,{[input.model]:price});
   // A price saved "now" replaces anything already in effect but keeps future changes.
   scheduled=Object.assign(Object.create(null),this.scheduled);
   const fut=keepFuture(this.scheduled[input.model]);if(fut.length)scheduled[input.model]=fut;else delete scheduled[input.model];
  }
  const payload=JSON.stringify({version:1,revision,prices,...(Object.keys(scheduled).length?{scheduled}:{})})+'\n';
  const dir=path.dirname(this.file),tmp=this.file+'.'+crypto.randomUUID()+'.tmp';
  let fd;
  try{
   fd=fs.openSync(tmp,'wx',0o600);
   fs.writeFileSync(fd,payload);fs.fsyncSync(fd);fs.closeSync(fd);fd=undefined;
   fs.renameSync(tmp,this.file);
   const d=fs.openSync(dir,'r');try{fs.fsyncSync(d);}finally{fs.closeSync(d);}
   this.prices=prices;this.scheduled=scheduled;this.revision=revision;
   return this.snapshot();
  }catch{
   this.blocked=true;
   throw fail('Price save not confirmed; reconcile before retry',503);
  }finally{
   if(fd!==undefined)try{fs.closeSync(fd);}catch{}
   try{fs.unlinkSync(tmp);}catch{}
  }
 }
}
module.exports={ModelPriceStore};
