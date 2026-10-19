'use strict';
const {withDeadline}=require('./control-deadline');
// Analytics never owns admission, quota deduction or execution reconciliation.
function createRecordedForward({history,forward,priceFor=()=>void 0,clock=Date.now,recordTimeoutMs=1000,missLog=null}){
 if(!Number.isSafeInteger(recordTimeoutMs)||recordTimeoutMs<1)throw Error('Invalid history deadline');
 const health={beginFailures:0,finishFailures:0,lastFailureAt:null,recordingPaused:false,usageMissing:0,lastUsageMissing:null,usageMissingTotal:0};
 // Durable miss log: survives restarts so a regression is still visible later.
 const fs=require('fs');
 if(missLog){
  try{
   const lines=fs.readFileSync(missLog,'utf8').split('\n').filter(Boolean);
   health.usageMissingTotal=lines.length;
   try{health.lastUsageMissing=JSON.parse(lines[lines.length-1]);}catch{}
  }catch{}
 }
 const persistMiss=row=>{
  if(!missLog)return;
  try{
   try{if(fs.statSync(missLog).size>1048576)fs.renameSync(missLog,missLog+'.1');}catch{}
   fs.appendFileSync(missLog,JSON.stringify(row)+'\n',{mode:0o600});
  }catch{}
 };
 // A slow write pauses recording only until that write actually settles; then recording
 // resumes on its own. A write that never settles keeps it paused (no queue growth).
 const record=async work=>{
  // A write that never settles pauses at most 5 minutes; the next slow write re-pauses.
  if(health.recordingPaused&&clock()-health.pausedAt>=300000){health.recordingPaused=false;health.resumedAt=clock();}
  if(health.recordingPaused)throw Error('History recording paused');
  const op=Promise.resolve().then(work);
  try{return await withDeadline(()=>op,recordTimeoutMs,'History recording deadline exceeded');}
  catch(error){
   if(error.message==='History recording deadline exceeded'&&!health.recordingPaused){
    health.recordingPaused=true;health.pausedAt=clock();health.pauses=(health.pauses||0)+1;
    const resume=()=>{health.recordingPaused=false;health.resumedAt=clock();};
    op.then(resume,resume);
   }
   throw error;
  }
 };
 async function recorded(ticket,route,body,res,credentials,options){
  let started=false;
  try{
   let parsed={};try{parsed=JSON.parse(body.toString('utf8'));}catch{}
   const native=route.startsWith('/v1beta/models/');
   const requestedModel=native?route.slice('/v1beta/models/'.length).split(':')[0]:parsed.model;
   await record(()=>history.begin({
    id:ticket.id,model:ticket.model,requestedModel,account:ticket.account,
    slot:ticket.slot,workerEpoch:ticket.workerEpoch,
    stream:native?route.endsWith(':streamGenerateContent'):parsed.stream===true,
    price:priceFor(ticket.model)
   }));
   started=true;
  }catch{
   health.beginFailures++;health.lastFailureAt=clock();
  }
  let result;
  try{
   result=await forward(ticket,route,body,res,credentials,options);
   return result;
  }finally{
   if(started){
    const m=result?.metrics;
    // Anti-truncation workers emit usage only when every continuation round reported it (summed),
    // so the observed usage is the full billed aggregate and is kept as-is.
    const recordedMetrics=m;
    const outcome=result?.cancelled?'cancelled':
     !result||result.uncertain?'uncertain':
     Number.isInteger(result.status)&&result.status>=400?'http_error':
     m?.applicationError?'application_error':
     // [DONE] means generation finished even if the client closed before the socket did.
     result.status>=200&&result.status<300&&(m?.transportComplete||m?.streamDoneSeen)?'success':'uncertain';
    if(outcome==='success'&&!recordedMetrics?.usageComplete){
     // Guard: a successful generation must carry usage. Surface every miss so regressions are visible.
     health.usageMissing++;health.usageMissingTotal++;
     health.lastUsageMissing={at:clock(),id:ticket.id,model:ticket.model,stream:!!recordedMetrics,
      malformed:!!recordedMetrics?.malformed,hasUsage:!!recordedMetrics?.usage,doneSeen:!!recordedMetrics?.streamDoneSeen};
     try{console.warn('[Usage] success without complete usage',JSON.stringify(health.lastUsageMissing));}catch{}
     persistMiss(health.lastUsageMissing);
    }
    try{await record(()=>history.finish(ticket.id,{outcome,httpStatus:result?.status,metrics:recordedMetrics}));}
    catch{health.finishFailures++;health.lastFailureAt=clock();}
   }
  }
 }
 recorded.status=()=>({...health,history:history.status()});
 return recorded;
}
module.exports={createRecordedForward};
