'use strict';
// Google cuts a generation at ~600s. The in-page retry loop must not start a
// second attempt after such a cut (it would be killed by the coordinator deadline).
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('fs'),path=require('path'),vm=require('vm');
const src=fs.readFileSync(path.join(__dirname,'black-browser.js'),'utf8');
const start=src.indexOf('class RequestProcessor {');
const end=src.indexOf('\nclass ',start+10);
assert.ok(start>0&&end>start,'RequestProcessor class found');

function load(responses){
 let now=0;const calls=[],logs=[];
 const FakeDate=class extends Date{static now(){return now;}};
 const ctx={
  Date:FakeDate,DOMException:class extends Error{constructor(m,n){super(m);this.name=n;}},
  AbortController,URLSearchParams,setTimeout:(f)=>{f();return 1;},clearTimeout:()=>{},
  Logger:{output:(...a)=>logs.push(a.join(' '))},
  fetch:async()=>{const r=responses[calls.length];calls.push(r);now+=r.ms;
   return {ok:r.status===200,status:r.status,statusText:'',text:async()=>r.body||'',headers:{get:()=>null}};},
 };
 vm.createContext(ctx);
 const RP=vm.runInContext(src.slice(start,end)+'\nRequestProcessor;',ctx);
 const p=new RP();
 p._constructUrl=()=> 'https://x/v1beta/models/m:generateContent';
 p._buildRequestConfig=()=>({});
 return {p,calls,logs};
}
const spec={method:'POST',path:'/v1beta/models/m:generateContent'};

test('failure after ~10 minutes is not retried and surfaces as 504',async()=>{
 const {p,calls,logs}=load([{status:500,ms:600242,body:'[,[13,"Internal error encountered."]]'},{status:200,ms:1000}]);
 const {responsePromise}=p.execute(spec,'op1');
 await assert.rejects(responsePromise,e=>e.status===504&&/约 10 分钟/.test(e.message)&&/不再重试/.test(e.message));
 assert.equal(calls.length,1,'only one Google attempt');
 assert.ok(logs.some(l=>/不再重试/.test(l)));
});

test('503 after 10 minutes (truncated stream parse error) is also not retried',async()=>{
 const {p,calls}=load([{status:503,ms:600400,body:'Unable to parse RpcStatus'},{status:200,ms:1000}]);
 await assert.rejects(p.execute(spec,'op2').responsePromise,e=>e.status===504);
 assert.equal(calls.length,1);
});

test('fast 5xx failures are still retried as before',async()=>{
 const {p,calls}=load([{status:500,ms:3000},{status:503,ms:2000},{status:200,ms:1000}]);
 const r=await p.execute(spec,'op3').responsePromise;
 assert.equal(r.status,200);
 assert.equal(calls.length,3);
});

test('threshold is 9 minutes: 8m59s failure still retries',async()=>{
 const {p,calls}=load([{status:500,ms:539000},{status:200,ms:1000}]);
 const r=await p.execute(spec,'op4').responsePromise;
 assert.equal(r.status,200);
 assert.equal(calls.length,2);
});
