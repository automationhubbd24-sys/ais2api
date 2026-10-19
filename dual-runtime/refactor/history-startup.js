'use strict';
const {RequestHistory}=require('./request-history');
const {withDeadline}=require('./control-deadline');

// Analytics may be unavailable without taking generation admission down.
// Do not delete, repair or partially expose a corrupt history directory.
// A failed start is retried in the background with a fresh instance; only a
// fully initialised instance is ever published (a late init of a timed-out
// instance is discarded).
async function openHistory(dir,{timeoutMs=10000,historyOptions={},createHistory,retryMs=60000,retryTimeoutMs=120000,log=console}={}){
 const make=()=>createHistory?createHistory():new RequestHistory(dir,historyOptions);
 const attempt=(ms=timeoutMs)=>withDeadline(()=>make().init(),ms,'History initialization deadline exceeded');
 try{return await attempt();}
 catch(e){
  const unavailable=()=>{throw Object.assign(Error('Request history unavailable'),{statusCode:503});};
  let live=null,attempts=1,lastError=String(e?.message||e).slice(0,120),timer=null;
  const facade={
   begin:async(...a)=>live?live.begin(...a):unavailable(),
   finish:async(...a)=>live?live.finish(...a):unavailable(),
   list:(...a)=>live?live.list(...a):unavailable(),
   summary:(...a)=>live?live.summary(...a):unavailable(),
   counts:(...a)=>live?live.counts(...a):unavailable(),
   expireStale:async(...a)=>live?live.expireStale(...a):0,
   status:()=>live?live.status():({ready:false,degraded:true,error:'history_initialization_failed',records:null,capacity:null,attempts,lastError}),
   stopRetry:()=>clearTimeout(timer),
  };
  const retry=async()=>{
   attempts++;
   try{live=await attempt(Math.max(timeoutMs,retryTimeoutMs));log.warn?.('[Analytics] history recovered after '+attempts+' attempt(s)');}
   catch(err){lastError=String(err?.message||err).slice(0,120);timer=setTimeout(retry,retryMs);timer.unref?.();}
  };
  if(retryMs>0){timer=setTimeout(retry,retryMs);timer.unref?.();}
  return facade;
 }
}
module.exports={openHistory};
