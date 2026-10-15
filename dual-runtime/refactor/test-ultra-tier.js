'use strict';
const test=require('node:test'),a=require('node:assert/strict'),fs=require('fs'),os=require('os'),path=require('path');
const {AccountTiers}=require('./account-tiers'),{ModelQuotaLedger}=require('./model-quota-ledger');
const {DispatchCore}=require('./dispatch-core'),{AccountPool}=require('../code/account-pool');
const {RequestHistory}=require('./request-history');
function setup(single=false){
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'tier-'));
 for(const id of [1,2,3,4])fs.writeFileSync(path.join(dir,'auth-'+id+'.json'),JSON.stringify({cookies:[{}],origins:[],accountName:'a'+id}),{mode:0o600});
 const tiers=new AccountTiers({authDir:dir,file:path.join(dir,'mode.json'),isSingle:()=>single});
 return {dir,tiers};
}
test('tier is stored in the auth file and survives the switch and a cookie refresh',()=>{
 const {dir,tiers}=setup();tiers.setTier(3,'ultra');
 a.equal(JSON.parse(fs.readFileSync(path.join(dir,'auth-3.json'))).accountTier,'ultra');
 tiers.setMode({enabled:true,slot:'B'});tiers.setMode({enabled:false});a.equal(tiers.isUltra(3),true);
 const f=path.join(dir,'auth-3.json'),d=JSON.parse(fs.readFileSync(f));fs.writeFileSync(f,JSON.stringify({...d,cookies:[{x:1}]}));
 a.equal(new AccountTiers({authDir:dir,file:path.join(dir,'mode.json')}).isUltra(3),true);
 tiers.setTier(3,'standard');a.equal(tiers.isUltra(3),false);a.equal('accountTier' in JSON.parse(fs.readFileSync(f)),false);
});
test('switch only changes allocation; off and single mode allow any slot',()=>{
 const {dir,tiers}=setup();tiers.setTier(3,'ultra');
 a.equal(tiers.allowed('A',3),true);a.equal(tiers.allowed('B',1),true);
 tiers.setMode({enabled:true,slot:'B'});
 a.equal(tiers.allowed('B',3),true);a.equal(tiers.allowed('B',1),false);a.equal(tiers.allowed('A',3),false);a.equal(tiers.allowed('A',1),true);
 a.equal(new AccountTiers({authDir:dir,file:path.join(dir,'mode.json')}).mode.enabled,true);
 const single=new AccountTiers({authDir:dir,file:path.join(dir,'mode.json'),isSingle:()=>true});a.equal(single.allowed('A',3),true);
});
test('rotation candidates follow the slot rule',()=>{
 const {tiers}=setup();tiers.setTier(3,'ultra');tiers.setMode({enabled:true,slot:'B'});
 const pool=new AccountPool([1,2,3,4]);pool.slots.set('A',{current:1,pending:null});pool.owners.set(1,'A');pool.slots.set('B',{current:2,pending:null});pool.owners.set(2,'B');
 const d=new DispatchCore(pool,()=>{});for(const id of pool.ids)d.quotas.account(id,true);d.slotAllows=(s,id)=>tiers.allowed(s,id);
 a.equal(d.rotationCandidate(undefined,undefined,'B'),3);a.equal(d.rotationCandidate(undefined,undefined,'A'),4);
});
test('ultra accounts have no count limit but keep 429 cooldown',()=>{
 const q=new ModelQuotaLedger();q.unlimited=id=>id===3;
 for(let i=0;i<150;i++)a.equal(q.charge(3,'gemini-4-argon','ultra'),true);
 const v=q.view(3,'gemini-4-argon','ultra');a.equal(v.limit,null);a.equal(v.used,150);a.equal(v.allowed,true);
 q.defer(3,'gemini-4-argon','ultra',Date.now()+60000);a.equal(q.view(3,'gemini-4-argon','ultra').allowed,false);
 for(let i=0;i<100;i++)q.charge(1,'gemini-3.7-flash','flash');a.equal(q.view(1,'gemini-3.7-flash','flash').allowed,false);
});
test('request counts per Beijing day, 7 and 30 days with 429',async()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'hist-'));
 const now=Date.UTC(2026,9,15,4,0,0);let t=now;const h=await new RequestHistory(dir,{clock:()=>t}).init();
 const add=async(at,outcome,status)=>{t=at;const id=require('crypto').randomUUID();await h.begin({id,model:'gemini-4-argon',account:3});await h.finish(id,{outcome,httpStatus:status});};
 await add(now-3600000,'success',200);await add(now-3600000,'http_error',429);
 await add(now-13*3600000,'success',200);await add(now-3*86400000,'success',200);await add(now-20*86400000,'success',200);await add(now-40*86400000,'success',200);
 t=now;const c=h.counts().items[0];
 a.deepEqual([c.today.requests,c.week.requests,c.month.requests],[2,4,5]);
 a.equal(c.today.rateLimited,1);a.equal(c.today.success,1);a.ok(c.last429At>0);
});
test('account alias is stored separately from login email and can be cleared',()=>{
 const {dir,tiers}=setup();
 a.deepEqual(tiers.setAlias(2,'  Ultra 主号 '),{id:2,alias:'Ultra 主号'});
 const d=JSON.parse(fs.readFileSync(path.join(dir,'auth-2.json')));a.equal(d.displayName,'Ultra 主号');a.equal(d.accountName,'a2');a.equal(d.cookies.length,1);
 a.deepEqual(tiers.names(2),{alias:'Ultra 主号',accountName:'a2'});
 tiers.setTier(2,'ultra');a.equal(tiers.names(2).alias,'Ultra 主号');
 a.throws(()=>tiers.setAlias(2,'x'.repeat(41)),/40/);
 tiers.setAlias(2,'');a.equal('displayName' in JSON.parse(fs.readFileSync(path.join(dir,'auth-2.json'))),false);
 a.equal((fs.statSync(path.join(dir,'auth-2.json')).mode&0o777),0o600);
});
