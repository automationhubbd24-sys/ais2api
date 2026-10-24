'use strict';
const a=require('assert');const {BrowserLease}=require('./browser-lease');
function mk(readyA,readyB){
 const slots=new Map([['A',{ready:readyA}],['B',{ready:readyB}]]);
 const l=Object.create(BrowserLease.prototype);
 Object.assign(l,{lease:null,switching:false,mode:{single:false},isStopping:()=>false,
  dispatch:{halted:false,slots,operations:{acquire:s=>({s}),release(){}},checkpoint(){}},scheduler:{pump(){}}});
 l.drain=async()=>{};l.stopOwned=async()=>({account:1,containerId:'x'});l.resume=async()=>{};
 return l;}
(async()=>{
 {const l=mk(true,true);const r=await l.acquire('t','A');a.strictEqual(r.slot,'A');console.log('ok prefers failed worker');}
 {const l=mk(true,false);await a.rejects(l.acquire('t','A'),/实例 B 未就绪/);a.strictEqual(l.lease,null);console.log('ok never pauses the only ready worker');}
 {const l=mk(true,true);const r=await l.acquire('t');a.strictEqual(r.slot,'B');console.log('ok default unchanged');}
})().catch(e=>{console.error(e);process.exit(1);});
