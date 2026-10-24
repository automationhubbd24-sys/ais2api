'use strict';
const test=require('node:test'),a=require('node:assert/strict'),{randomUUID}=require('crypto');
const fs=require('fs'),os=require('os'),path=require('path');
const {createWorker}=require('../code/worker-system');
const {DispatchCore}=require('./dispatch-core'),{AccountPool}=require('../code/account-pool');
const {FrontendGuard}=require('./frontend-guard'),{RotationController}=require('./rotation-controller');
function worker(sig,patch={}){
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'sig-'));fs.writeFileSync(path.join(dir,'auth-5.json'),'{}');
 const page={isClosed:()=>false,url:()=>patch.url||'https://aistudio.google.com/prompts/new_chat'};
 class Sys{constructor(){this.authSource={availableIndices:[5]};this.config={};this.requestHandler={stabilityGate:{activeCount:0}};
  this.browserManager={currentAuthIndex:5,context:{},page,gcbSigner:sig,gcbFrontend:'b5261d7d7c8d'};
  this.connectionRegistry={hasActiveConnections:()=>patch.conn!==false,protocolReady:()=>true,messageQueues:new Map()};}}
 return createWorker(Sys,5,dir).status();
}
test('worker ready only when signer ok',()=>{
 const ok=worker({state:'ok',reason:null,message:'签名正常',okRequests:1});a.equal(ok.ready,true);a.equal(ok.unready,null);a.equal(ok.frontend,'b5261d7d7c8d');
 const chk=worker({state:'checking',reason:null,message:'签名自检中',since:1});a.equal(chk.ready,false);a.equal(chk.unready.reason,'signer_checking');
 const bad=worker({state:'failed',reason:'signer_missing',message:'没找到签名函数',since:123});
 a.equal(bad.ready,false);a.equal(bad.unready.reason,'signer_missing');a.equal(bad.unready.message,'没找到签名函数');a.equal(bad.unready.since,123);
});
test('non-signer causes named before signer',()=>{
 a.equal(worker({state:'ok'},{conn:false}).unready.reason,'page_not_connected');
 a.equal(worker({state:'ok'},{url:'https://accounts.google.com/x'}).unready.reason,'login_required');
 a.equal(worker(null).ready,true); // legacy page without self-check is not blocked
});
function core(){const pool=new AccountPool([1,2,3]);for(const [s,id] of [['A',1],['B',2]]){pool.slots.set(s,{current:id,pending:null});pool.owners.set(id,s);}
 const d=new DispatchCore(pool,()=>{});return d;}
const probe=(x={})=>({account:1,workerEpoch:randomUUID(),executionProtocol:2,ready:true,busy:false,activeRequests:0,browserOperations:0,quarantined:false,hardQuarantine:false,pendingCompletions:0,cooldownUntil:0,...x});
test('coordinator keeps worker reason and does not dispatch',()=>{
 const d=core();d.update('A',probe({ready:false,unready:{reason:'frontend_incompatible',message:'连续签名报错，前端可能不兼容',since:9},
  signer:{state:'failed',reason:'frontend_incompatible',message:'x',detail:'[14,"token service not ready"]',names:{hash:'gC',sign:'En',service:'tC'}},frontend:'abcdefabcdef'}));
 const s=d.slots.get('A');a.equal(s.ready,false);a.equal(s.unready.reason,'frontend_incompatible');a.equal(s.unready.message,'连续签名报错，前端可能不兼容');
 a.equal(s.workerHealth.frontend,'abcdefabcdef');a.equal(s.workerHealth.signer.names.sign,'En');
 d.update('A',probe());a.equal(d.slots.get('A').ready,true);a.equal(d.slots.get('A').unready,null);
 d.update('A',probe({account:9}));a.equal(d.slots.get('A').unready.reason,'account_mismatch');
});
test('guard holds peer while its frontend is unverified or signer broken',()=>{
 let t=1e12;const g=new FrontendGuard({now:()=>t,log:{}});g.verified.b5261d7d7c8d={at:1};
 g.observe('A',{frontend:'b5261d7d7c8d',signer:{state:'ok',okRequests:5}});
 g.observe('B',{frontend:'111111111111',signer:{state:'checking'}});
 a.equal(g.hold('B'),null);a.equal(g.hold('A').reason,'peer_frontend_unverified');
 g.observe('B',{frontend:'111111111111',signer:{state:'ok',okRequests:0}});a.ok(g.hold('A'));
 g.observe('B',{frontend:'111111111111',signer:{state:'ok',okRequests:1}});a.equal(g.hold('A'),null);a.ok(g.verified['111111111111']);
 g.observe('B',{frontend:'222222222222',signer:{state:'ok',okRequests:0}});a.ok(g.hold('A'));t+=600001;g.observe('B',{frontend:'222222222222',signer:{state:'ok',okRequests:0}});a.equal(g.hold('A'),null);
 g.observe('B',{frontend:'222222222222',signer:{state:'failed',reason:'signer_missing',message:'没找到签名函数'}});
 a.equal(g.hold('A').reason,'peer_signer_failed');a.match(g.hold('A').message,/没找到签名函数/);
 t+=600001;a.equal(g.hold('A'),null); // stale peer observation never holds forever
});
test('guard persists verified versions',()=>{
 const f=path.join(fs.mkdtempSync(path.join(os.tmpdir(),'fg-')),'v.json');
 const g=new FrontendGuard({file:f,log:{}});g.observe('A',{frontend:'333333333333',signer:{state:'ok',okRequests:2}});
 a.ok(new FrontendGuard({file:f}).verified['333333333333']);
});
test('automatic rotation blocked by hold, manual force not',async()=>{
 const d=core();d.update('A',probe());const r=new RotationController(d,{validateAccount(){}});
 r.frontendHold=()=>({reason:'peer_signer_failed',message:'实例 B 签名不可用'});
 const p=r.preflight('A');a.equal(p.available,false);a.equal(p.frontendHold.reason,'peer_signer_failed');
 await a.rejects(r.rotate('A',false,3),e=>e.code==='FRONTEND_HOLD');
 r.forced.add('A');a.notEqual(r.preflight('A').reason,'实例 B 签名不可用');
});
