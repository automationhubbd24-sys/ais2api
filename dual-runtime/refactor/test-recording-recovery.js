'use strict';
const test=require('node:test'),assert=require('assert'),fs=require('fs'),os=require('os'),path=require('path');
const {createRecordedForward}=require('./recorded-forward');
const {RequestHistory}=require('./request-history');
const AT=require(path.join(__dirname,'..','code','anti-truncation.js'));
test('a slow history write pauses recording only until it settles',async()=>{
 let release,begins=0;
 const history={begin:async()=>{begins++;if(begins===1)return new Promise(r=>{release=r;});},finish:async()=>{},status:()=>({ready:true})};
 const forward=createRecordedForward({history,recordTimeoutMs:10,forward:async()=>({status:200})});
 const args=[{model:'m',id:'x'},'/v1/chat/completions',Buffer.from('{}'),{},{}];
 await forward(...args);assert.equal(forward.status().recordingPaused,true);
 await forward(...args);assert.equal(begins,1,'paused while the slow write is still running');
 release();await new Promise(r=>setImmediate(r));
 assert.equal(forward.status().recordingPaused,false,'resumes once the write settles');
 await forward(...args);assert.equal(begins,2);
});
test('stale pending rows are closed as uncertain, fresh ones untouched',async()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'hist-'));let now=1_000_000_000_000;
 const h=new RequestHistory(dir,{clock:()=>now});await h.init();
 const {randomUUID}=require('crypto');const a=randomUUID(),b=randomUUID();
 await h.begin({id:a,model:'gemini-4-argon',account:31,slot:'B'});
 now+=61*60000;await h.begin({id:b,model:'gemini-4-argon',account:31,slot:'B'});
 assert.equal(await h.expireStale(),1);
 const rows=h.list({}).items,ra=rows.find(r=>r.id===a),rb=rows.find(r=>r.id===b);
 assert.equal(ra.outcome,'uncertain');assert.equal(ra.metrics.errorKind,'stale_pending');assert.equal(rb.outcome,'pending');
 const disk=JSON.parse(fs.readFileSync(path.join(dir,a+'.json'),'utf8'));assert.equal(disk.phase,'finished');
 fs.rmSync(dir,{recursive:true,force:true});
});
test('anti-truncation early finish payload records reason and tokens, no content',()=>{
 const p=AT.atFinishPayload({reason:'OTHER',chars:7756,promptTokens:70811,outputTokens:5621},502);
 assert.equal(p.error.status,'FINISH_OTHER');assert.equal(p.error.type,'upstream_incomplete');
 assert.deepEqual(p.usage,{prompt_tokens:70811,completion_tokens:5621});
 assert.ok(!('choices' in p));
});
test('worker inline AT module exposes the same block/finish helpers',()=>{
 const fs=require('fs');const src=fs.readFileSync(path.join(__dirname,'..','code','unified-server.runtime.js'),'utf8');
 const start=src.indexOf('const AT = (function () {');const end=src.indexOf('})();',start)+5;
 const IAT=new Function(src.slice(start,end)+'\nreturn AT;')();
 for(const f of ['atBlockInfo','atBlockMessage','atBlockPayload','atFinishPayload'])assert.equal(typeof IAT[f],'function',f);
 const p=IAT.atFinishPayload({reason:'OTHER',round:1,chars:5,promptTokens:1,outputTokens:2},502);
 assert.equal(p.error.status,'FINISH_OTHER');assert.equal(p.choices,undefined);
});
