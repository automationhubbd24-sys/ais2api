'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {openHistory}=require('./history-startup');
const {DispatchCore}=require('./dispatch-core');
const {createRecordedForward}=require('./recorded-forward');
const {CoordinatorMonitor}=require('./coordinator-monitor');
const wait=ms=>new Promise(r=>setTimeout(r,ms));
test('history startup failure is retried with a fresh instance and then published',async()=>{
 let n=0;const make=()=>{n++;const me=n;return {init:async()=>{if(me<3)throw Error('busy disk');return live;}};};
 const live={status:()=>({ready:true}),list:()=>({items:[1]}),begin:async()=>'ok',expireStale:async()=>2};
 const h=await openHistory('/unused',{createHistory:make,retryMs:15,log:{warn(){}}});
 assert.equal(h.status().ready,false);assert.throws(()=>h.list(),e=>e.statusCode===503);
 await wait(120);h.stopRetry();
 assert.equal(n,3);assert.equal(h.status().ready,true);assert.deepEqual(h.list(),{items:[1]});
 assert.equal(await h.begin({}),'ok');assert.equal(await h.expireStale(),2);
});
test('a timed-out instance is never published even if it later succeeds',async()=>{
 let release;const slow={init:()=>new Promise(r=>{release=()=>r(slow);}),status:()=>({ready:true})};
 let calls=0;const h=await openHistory('/unused',{timeoutMs:10,retryMs:0,createHistory:()=>{calls++;return slow;}});
 release();await wait(5);assert.equal(h.status().ready,false);assert.equal(calls,1);
});
test('halted dispatch resumes only after a checkpoint lands again',()=>{
 const d=new DispatchCore({slots:new Map(),ids:[]},()=>{throw Error('disk full');});
 assert.throws(()=>d.checkpoint());assert.equal(d.halted,true);
 assert.equal(d.tryResume(),false);assert.equal(d.halted,true);
 let saved=0;d.persist=()=>{saved++;};
 assert.equal(d.tryResume(),true);assert.equal(d.halted,false);assert.equal(saved,1);
 assert.equal(d.tryResume(),false);
});
test('a write that never settles pauses recording for a bounded time only',async()=>{
 let now=0,begins=0;
 const history={begin:async()=>{begins++;if(begins===1)return new Promise(()=>{});},finish:async()=>{},status:()=>({ready:true})};
 const f=createRecordedForward({history,recordTimeoutMs:10,clock:()=>now,forward:async()=>({status:200})});
 const args=[{model:'fixture-flash'},'/v1/chat/completions',Buffer.from('{}'),{},{}];
 await f(...args);assert.equal(f.status().recordingPaused,true);
 now+=60000;await f(...args);assert.equal(begins,1);
 now+=300000;await f(...args);assert.equal(begins,2);assert.equal(f.status().recordingPaused,false);
});
test('stale rotation failure without a pending marker is cleared; a marked one is kept',()=>{
 const failures=new Map();
 const slots=new Map([['A',{}],['B',{rotation:{phase:'started'}}]]);
 const dispatch={halted:false,slots,pool:{slots:new Map([['A',{current:1}],['B',{current:2,pending:{id:3}}]])},operations:{has:()=>false}};
 const m=new CoordinatorMonitor({dispatch,rotation:{failures,running:new Set()},scheduler:{pump(){}}});
 failures.set('A',{retryAt:Date.now()});failures.set('B',{retryAt:0});
 const warn=console.warn;console.warn=()=>{};
 m.expireFailure('A');assert.equal(failures.has('A'),true);
 failures.get('A').retryAt=Date.now()-61000;m.expireFailure('A');m.expireFailure('B');
 console.warn=warn;
 assert.equal(failures.has('A'),false);assert.equal(failures.has('B'),true);
});
