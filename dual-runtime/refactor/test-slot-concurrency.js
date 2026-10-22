'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('fs'),os=require('os'),path=require('path');
const {randomUUID}=require('node:crypto');
const {SlotConcurrency}=require('./slot-concurrency');
const {AccountPool}=require('../code/account-pool');
const {DispatchCore}=require('./dispatch-core');
const plan={model:'fixture-flash',quotaFamily:'flash'};
function setup(limits){
 const pool=new AccountPool([1,2,3]);
 for(const [slot,account] of [['A',1],['B',2]]){pool.slots.set(slot,{current:account,pending:null});pool.owners.set(account,slot);}
 const d=new DispatchCore(pool,()=>{});for(const id of pool.ids)d.quotas.account(id,true);
 d.slotLimit=slot=>limits[slot];
 const epoch={A:randomUUID(),B:randomUUID()};
 const probe=(slot,ops)=>d.update(slot,{account:slot==='A'?1:2,workerEpoch:epoch[slot],ready:true,busy:ops>0,browserOperations:ops,activeRequests:ops,quarantined:false});
 return {d,probe};
}
test('setting persists across restarts, defaults to 2 and rejects values outside 1-10',()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'cc-')),file=path.join(dir,'concurrency.json');
 const a=new SlotConcurrency(file);
 assert.deepEqual([a.get('A'),a.get('B')],[2,2]);
 assert.deepEqual(a.set({A:10,B:5}),{A:10,B:5,min:1,max:10,default:2});
 assert.deepEqual(JSON.parse(fs.readFileSync(file,'utf8')),{A:10,B:5});
 assert.equal((fs.statSync(file).mode&0o777),0o600);
 const b=new SlotConcurrency(file); // a restarted coordinator reads the saved value
 assert.deepEqual([b.get('A'),b.get('B')],[10,5]);
 for(const bad of [0,11,2.5,-1,'x',null])assert.throws(()=>b.set({A:bad}),e=>e.statusCode===400);
 assert.deepEqual([b.get('A'),b.get('B')],[10,5],'a rejected value changes nothing');
 b.set({B:3});assert.deepEqual(new SlotConcurrency(file).status(),{A:10,B:3,min:1,max:10,default:2});
 fs.writeFileSync(file,'{"A":99,"B":"bad"}');
 assert.deepEqual([new SlotConcurrency(file).get('A'),new SlotConcurrency(file).get('B')],[2,2],'corrupt file falls back to the default');
});
test('dispatch admits up to the configured limit per slot, even while the worker is busy',()=>{
 const {d,probe}=setup({A:5,B:1});
 probe('A',0);probe('B',0);
 const got=[];for(let i=0;i<8;i++){const t=d.acquire(randomUUID(),plan);if(t)got.push(t.slot);}
 assert.equal(got.filter(s=>s==='A').length,5);assert.equal(got.filter(s=>s==='B').length,1);
 assert.equal(d.slots.get('A').active,5);
 // the worker reports 3 running operations: still ready because 3 < 5
 probe('A',3);assert.equal(d.slots.get('A').ready,true);
 probe('A',5);assert.equal(d.slots.get('A').ready,false);
});
test('raising the limit takes effect without restarting; out-of-range values fall back to 2',()=>{
 const limits={A:2,B:2},{d,probe}=setup(limits);
 probe('A',0);probe('B',0);
 let n=0;while(d.acquire(randomUUID(),plan))n++;assert.equal(n,4);
 limits.A=4;probe('A',2);
 while(d.acquire(randomUUID(),plan))n++;assert.equal(n,6);
 limits.A=99;assert.equal(d.limitOf('A'),2);limits.A=0;assert.equal(d.limitOf('A'),2);
});
test('worker-side ceilings are 10, so the coordinator setting is what limits concurrency',()=>{
 const read=f=>fs.readFileSync(path.join(__dirname,f),'utf8');
 assert.ok(read('../code/stability.js').includes(' constructor(limit=10){'));
 assert.ok(read('operation-tracker.js').includes('this.active.size>=10'));
 assert.ok(read('black-browser.js').includes('activeOperations.size >= 10'));
 assert.ok(read('dispatch-state.js').includes('state.active>10'));
 const {SerialGate}=require('../code/stability');
 const g=new SerialGate();let running=0,peak=0;
 const job=()=>g.run(async()=>{running++;peak=Math.max(peak,running);await new Promise(r=>setTimeout(r,20));running--;});
 return Promise.all(Array.from({length:10},job)).then(()=>assert.equal(peak,10));
});
