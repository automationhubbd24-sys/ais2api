'use strict';
const fs=require('fs');
const path=require('path');
function createWorker(System,account,authDir){
 if(!Number.isSafeInteger(account)||account<1)throw Error('Invalid worker account');
 const names=fs.readdirSync(authDir).filter(n=>n.startsWith(`auth-`) && n.endsWith(`.json`));
 if(names.length!==1||names[0]!==`auth-${account}.json`)throw Error('Worker requires exactly its assigned authentication file');
 const stat=fs.lstatSync(path.join(authDir,names[0]));
 if(!stat.isFile()||stat.isSymbolicLink())throw Error('Authentication must be a regular file');
 const system=new System();
 const ids=system.authSource.availableIndices;
 if(ids.length!==1||ids[0]!==account)throw Error('Loaded account differs from assignment');
 system.config.switchOnUses=0;
 system.config.failureThreshold=0;
 system.config.immediateSwitchStatusCodes=[];
 system.requestHandler.maxRetries=1;
 system.requestHandler._switchToNextAuth=async()=>({success:false,reason:'Account assignment is controlled by the coordinator'});
 system.requestHandler._switchToSpecificAuth=async()=>({success:false,reason:'Account assignment is controlled by the coordinator'});
 const UNREADY={account_mismatch:'浏览器未加载本账号',browser_not_started:'浏览器未启动',region_blocked:'当前地区不可用',login_required:'需要重新登录',page_not_connected:'页面未连接',protocol_not_ready:'页面协议未就绪',signer_checking:'签名自检中'};
 const status=()=>{
  const b=system.browserManager,sig=b.gcbSigner||null;
  let reason=null,url='';
  try{url=b.page&&!b.page.isClosed()?b.page.url():'';}catch{}
  if(b.currentAuthIndex!==account)reason='account_mismatch';
  else if(!b.context||!b.page||b.page.isClosed())reason='browser_not_started';
  else if(/\/docs\/available-regions/.test(url))reason='region_blocked';
  else if(/accounts\.google\.com/.test(url))reason='login_required';
  else if(!system.connectionRegistry.hasActiveConnections())reason='page_not_connected';
  else if(system.connectionRegistry.protocolReady?.()!==true)reason='protocol_not_ready';
  else if(sig&&sig.state!=='ok')reason=sig.state==='failed'&&sig.reason?sig.reason:'signer_checking';
  const ready=reason===null;
  const signer=sig?{state:sig.state,reason:sig.reason,message:sig.message,detail:sig.detail,since:sig.since,frontend:sig.frontend||b.gcbFrontend||null,names:sig.names,okRequests:sig.okRequests,lastOkAt:sig.lastOkAt||null}:null;
  const unready=ready?null:{reason,message:sig&&sig.state==='failed'&&reason===sig.reason?sig.message:(UNREADY[reason]||reason),since:sig&&reason===(sig.reason||'signer_checking')?sig.since:null};
  return {account,ready,busy:(system.requestHandler.stabilityGate?.activeCount||0)>0,activeRequests:system.connectionRegistry.messageQueues.size,
   unready,signer,frontend:signer?.frontend||b.gcbFrontend||null};
 };
 return {system,status};
}
module.exports={createWorker};
