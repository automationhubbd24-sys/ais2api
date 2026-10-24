'use strict';
// Plan 2: never let both workers move onto an unproven AI Studio frontend at once.
// A new frontend only arrives when a page reloads (rotation, restart, crash). While
// one slot is on a frontend that has not yet signed successfully, or its signer is
// broken, the other slot keeps its current page: automatic rotation is held.
const fs=require('fs');
const HASH=/^[0-9a-f]{12}$/,STABLE_MS=600000,PEER_FRESH_MS=600000;
class FrontendGuard{
 constructor({file,now=Date.now,log=console}={}){
  Object.assign(this,{file,now,log});this.verified={};this.seen={};
  try{const d=JSON.parse(fs.readFileSync(file,'utf8'));
   for(const [k,v] of Object.entries(d?.verified||{}))if(HASH.test(k)&&Number.isFinite(v?.at))this.verified[k]={at:v.at,slot:v.slot||null,how:v.how||null};
  }catch{}
 }
 save(){
  if(!this.file)return;
  try{const tmp=this.file+'.tmp';fs.writeFileSync(tmp,JSON.stringify({verified:this.verified}),{mode:0o600});fs.renameSync(tmp,this.file);}catch{}
 }
 observe(slot,status){
  if(!['A','B'].includes(slot)||!status)return;
  const now=this.now(),sig=status.signer&&typeof status.signer==='object'?status.signer:null;
  const frontend=typeof status.frontend==='string'&&HASH.test(status.frontend)?status.frontend:null;
  const prev=this.seen[slot];
  const cur={frontend,state:sig?.state||null,reason:sig?.reason||null,message:sig?.message||null,
   okRequests:Number.isFinite(sig?.okRequests)?sig.okRequests:0,at:now};
  cur.okSince=cur.state==='ok'?(prev&&prev.frontend===frontend&&prev.state==='ok'&&prev.okSince?prev.okSince:now):null;
  this.seen[slot]=cur;
  if(frontend&&!this.verified[frontend]&&cur.state==='ok'){
   const how=cur.okRequests>0?'request':now-cur.okSince>=STABLE_MS?'stable':null;
   if(how){this.verified[frontend]={at:now,slot,how};this.save();this.log.warn?.('[FrontendGuard] frontend '+frontend+' verified on '+slot+' by '+how);}
  }
 }
 hold(slot){
  const peer=slot==='A'?'B':slot==='B'?'A':null,o=peer&&this.seen[peer];
  if(!o||this.now()-o.at>PEER_FRESH_MS)return null;
  if(o.state==='failed')return {reason:'peer_signer_failed',peer,frontend:o.frontend,
   message:'实例 '+peer+' 签名不可用（'+(o.message||o.reason||'未知')+'），暂停本实例自动切号，避免两台同时坏掉'};
  if(o.frontend&&!this.verified[o.frontend])return {reason:'peer_frontend_unverified',peer,frontend:o.frontend,
   message:'实例 '+peer+' 正在使用未验证的新版网页（'+o.frontend.slice(0,8)+'），验证通过前暂停本实例自动切号'};
  return null;
 }
 status(){
  return {verified:Object.entries(this.verified).sort((x,y)=>y[1].at-x[1].at).slice(0,10).map(([frontend,v])=>({frontend,...v})),
   slots:{A:this.seen.A||null,B:this.seen.B||null},holds:{A:this.hold('A'),B:this.hold('B')}};
 }
}
module.exports={FrontendGuard};
