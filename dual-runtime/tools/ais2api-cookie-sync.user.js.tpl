// ==UserScript==
// @name         AIS2API Cookie 同步
// @namespace    ais2api-cookie-sync
// @version      1.2.0
// @description  在 AI Studio 页面一键把当前 Google 登录状态导入 / 更新到 AIS2API 账号池；可检查 Cookie 是否完整
// @match        https://aistudio.google.com/*
// @match        https://accounts.google.com/*
// @match        https://www.google.com/*
// @match        https://myaccount.google.com/*
// @match        https://ogs.google.com/*
// @match        https://console.cloud.google.com/*
// @run-at       document-idle
// @grant        GM_cookie
// @grant        GM_xmlhttpRequest
// @grant        GM_registerMenuCommand
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_info
// @connect      __HOST__
// @noframes
// ==/UserScript==
(function(){
'use strict';
// Other Google hosts are matched only so Tampermonkey grants cookie access; run on AI Studio only.
if(location.hostname!=='aistudio.google.com')return;
const SERVER=__SERVER__, KEY=__KEY__;
const URLS=['https://aistudio.google.com/','https://accounts.google.com/','https://www.google.com/','https://myaccount.google.com/','https://ogs.google.com/','https://console.cloud.google.com/'];
const SESSION=['SID','__Secure-1PSID','__Secure-3PSID'];
const TS=['__Secure-1PSIDTS','__Secure-3PSIDTS'];
const cfg=()=>({tier:GM_getValue('tier','standard'),alias:GM_getValue('alias',''),auto:GM_getValue('auto',false),minutes:GM_getValue('minutes',10)});

function toast(msg,bad){
 const el=document.createElement('div');el.textContent=msg;
 el.style.cssText='position:fixed;z-index:2147483647;right:16px;bottom:16px;max-width:360px;padding:10px 14px;border-radius:8px;font:13px/1.5 system-ui,sans-serif;color:#fff;box-shadow:0 4px 16px rgba(0,0,0,.25);white-space:pre-wrap;background:'+(bad?'#c62828':'#2e7d32');
 document.body.appendChild(el);setTimeout(()=>el.remove(),bad?9000:5000);
}
// Report panel: stays until closed, text selectable so it can be copied. Never shows cookie values.
function panel(title,text){
 document.getElementById('ais2api-panel')?.remove();
 const box=document.createElement('div');box.id='ais2api-panel';
 box.style.cssText='position:fixed;z-index:2147483647;left:8px;right:8px;top:8px;max-width:640px;margin:auto;max-height:80vh;overflow:auto;background:#fff;color:#222;border-radius:10px;box-shadow:0 6px 24px rgba(0,0,0,.3);font:13px/1.55 system-ui,sans-serif;padding:12px 14px';
 const h=document.createElement('div');h.style.cssText='display:flex;justify-content:space-between;align-items:center;font-weight:600;margin-bottom:6px';
 h.textContent=title;const x=document.createElement('button');x.textContent='关闭';x.style.cssText='padding:4px 12px';x.onclick=()=>box.remove();h.appendChild(x);
 const pre=document.createElement('pre');pre.style.cssText='white-space:pre-wrap;word-break:break-all;margin:0;user-select:text';pre.textContent=text;
 box.append(h,pre);document.body.appendChild(box);
}
function gmList(q){
 return new Promise(resolve=>{
  try{GM_cookie.list(q,(list,err)=>resolve(err||!Array.isArray(list)?{err:String(err||'无返回')}:{list}));}
  catch(e){resolve({err:String(e&&e.message||e)});}
 });
}
async function collect(){
 if(typeof GM_cookie==='undefined'||!GM_cookie.list)throw Error('当前脚本管理器不支持 GM_cookie，请使用 Tampermonkey');
 const seen=new Map(),now=Date.now()/1000;
 const diag={perUrl:[],skipped:[],partitionedKept:[],ts:{}};
 const add=(c,src)=>{
  if(!/^\.?([a-z0-9-]+\.)*google\.com$/i.test(c.domain||'')){diag.skipped.push(c.name+' @'+c.domain+'：不是 google.com 域名');return;}
  const expires=c.session||c.expirationDate==null?-1:Math.floor(c.expirationDate);
  if(expires!==-1&&expires<=now){diag.skipped.push(c.name+' @'+c.domain+'：已过期');return;}
  // Partitioned cookies were silently dropped in 1.0.0. Keep them (without the partition) and report it.
  if(c.partitionKey!=null||c.partitioned)diag.partitionedKept.push(c.name+' @'+c.domain);
  const ss=String(c.sameSite||'unspecified').toLowerCase();
  let sameSite={lax:'Lax',strict:'Strict',none:'None',no_restriction:'None'}[ss]||'Lax';
  if(sameSite==='None'&&!c.secure)sameSite='Lax';
  const domain=c.hostOnly===false&&!c.domain.startsWith('.')?'.'+c.domain:c.domain;
  const key=c.name+'|'+domain+'|'+(c.path||'/');
  if(TS.includes(c.name))diag.ts[c.name]=(diag.ts[c.name]||[]).concat(src+(c.partitionKey!=null||c.partitioned?'（分区）':''));
  if(!seen.has(key))seen.set(key,{name:c.name,value:String(c.value),domain,path:c.path||'/',expires,httpOnly:!!c.httpOnly,secure:!!c.secure,sameSite});
 };
 for(const url of URLS){
  const r=await gmList({url});
  diag.perUrl.push(url.replace('https://','').replace(/\/$/,'')+'：'+(r.err?'失败 '+r.err:r.list.length+' 个'));
  if(!r.err)for(const c of r.list)add(c,'按网址');
 }
 // Ask for the rotating pair by name too, in case URL listing hides them.
 for(const name of TS){
  const r=await gmList({name});
  if(r.err)diag.ts[name+' 按名称查询']=['失败 '+r.err];
  else for(const c of r.list)add(c,'按名称');
 }
 const cookies=[...seen.values()].slice(0,200);
 const ls=[];
 for(let i=0;i<localStorage.length&&ls.length<200;i++){
  const name=localStorage.key(i),value=localStorage.getItem(name);
  if(name&&name.length<=1024&&value!=null&&value.length<=65536)ls.push({name,value});
 }
 return {state:{cookies,origins:[{origin:'https://aistudio.google.com',localStorage:ls}]},diag};
}
// Which signed-in Google account the page is using (/u/N/ or ?authuser=N). Same detection as the old RE Proxy script.
function authUser(){
 try{
  const m=location.pathname.match(/\/u\/(\d+)(?:\/|$)/);if(m)return Number(m[1]);
  const q=new URL(location.href).searchParams.get('authuser');if(q&&/^\d+$/.test(q))return Number(q);
 }catch{}
 return 0;
}
function fingerprint(state){
 return state.cookies.filter(c=>SESSION.concat(TS).includes(c.name)).map(c=>c.name+'='+c.value).sort().join(';');
}
function post(body,mode,force){
 const c=cfg();
 return new Promise((resolve,reject)=>GM_xmlhttpRequest({
  method:'POST',url:SERVER+'/api/cookie-sync',timeout:30000,anonymous:true,
  headers:{'Content-Type':'application/json','Authorization':'Bearer '+KEY},
  data:JSON.stringify({mode,force:force===true,authUser:authUser(),tier:c.tier,alias:c.alias,state:body}),
  onload:r=>{let d={};try{d=JSON.parse(r.responseText);}catch{}resolve({status:r.status,d});},
  onerror:()=>reject(Error('无法连接服务器')),ontimeout:()=>reject(Error('连接服务器超时'))
 }));
}
function report(check,diag){
 const ua=navigator.userAgent.match(/(Edg|Kiwi|Chrome|Firefox|Version)\/[\d.]+/g)||[];
 const lines=[];
 if(check){
  const okTs=!check.missing.includes('__Secure-1PSIDTS')||!check.missing.includes('__Secure-3PSIDTS');
  const au=check.authUser||0;
  lines.push(au!==0?'结论：这是浏览器里的第 '+(au+1)+' 个 Google 账号（authuser='+au+'）。服务器只会打开第 1 个账号，请在浏览器里只登录这一个账号，或用无痕窗口单独登录后再导入。':okTs?'结论：登录 Cookie 完整，可以导入。':'结论：可以导入，但没有 __Secure-1PSIDTS。多数账号没有它也能用；如果导入后服务器跳到登录页，再改用账号密码登录。');
  lines.push('','读到的登录 Cookie：'+(check.present.join('、')||'无'),'缺少：'+(check.missing.join('、')||'无'),'Cookie 总数（去重名称）：'+check.total);
 }
 lines.push('','PSIDTS 来源：'+(Object.keys(diag.ts).length?Object.entries(diag.ts).map(([k,v])=>k+' ← '+v.join('/')).join('；'):'各种方式都没读到'));
 lines.push('','按网址读取：',...diag.perUrl.map(s=>'  '+s));
 if(diag.partitionedKept.length)lines.push('','分区 Cookie（已保留）：'+diag.partitionedKept.join('、'));
 if(diag.skipped.length)lines.push('','跳过：',...diag.skipped.slice(0,30).map(s=>'  '+s));
 lines.push('','环境：'+(GM_info?.scriptHandler||'?')+' '+(GM_info?.version||'')+'；'+ua.join(' '));
 if(check&&check.missing.includes('__Secure-1PSIDTS')&&check.missing.includes('__Secure-3PSIDTS')&&!Object.keys(diag.ts).some(k=>!k.includes('查询')))
  lines.push('','说明：脚本按网址、按名称都查过，浏览器没有给出 PSIDTS。');
 return lines.join('\n');
}
let running=false;
async function sync(mode,quiet){
 if(running)return;running=true;
 try{
  const {state,diag}=await collect();
  if(!state.cookies.some(c=>SESSION.includes(c.name))){
   if(quiet)return;
   if(!state.cookies.some(c=>c.httpOnly))throw Error('读不到 HttpOnly Cookie。请在 Tampermonkey 设置 → 安全 → “允许脚本访问 Cookie”选“全部”');
   throw Error('没有找到 Google 登录 Cookie，请先登录');
  }
  if(mode==='check'){
   const {status,d}=await post(state,'check');
   panel('Cookie 检查（没有导入）',status===200?report(d.check,diag):'检查失败（'+status+'）：'+(d.error||'未知错误')+'\n\n'+report(null,diag));
   return;
  }
  const fp=fingerprint(state);
  if(quiet&&fp===GM_getValue('lastFp','')&&Date.now()-GM_getValue('lastAt',0)<30*60000)return;
  let {status,d}=await post(state,mode);
  if(status===422&&d.needForce){
   if(quiet){console.warn('[AIS2API] 自动同步跳过：缺少 PSIDTS');return;}
   panel('没有导入',(d.error||'')+'\n\n'+report(d.check,diag));
   if(!confirm((d.error||'检查未通过')+'\n\n仍然导入吗？'))return;
   ({status,d}=await post(state,mode,true));
  }
  if(status===200){
   GM_setValue('lastFp',fp);GM_setValue('lastAt',Date.now());
   const name=d.alias?' · '+d.alias:'';
   if(!quiet||!d.updated)toast((d.updated?'已更新账号 #':'已导入新账号 #')+d.index+name+(d.tier==='ultra'?'（Ultra）':'（普通）')+(d.note?'\n'+d.note:''));
   else console.info('[AIS2API] 已同步账号 #'+d.index);
  }else if(quiet&&status===404){console.info('[AIS2API] 当前账号未导入，自动同步跳过');}
  else toast('导入失败（'+status+'）：'+(d.error||'未知错误')+(d.detail?'\n'+d.detail:''),true);
 }catch(e){if(!quiet)toast(e.message,true);else console.warn('[AIS2API]',e.message);}
 finally{running=false;}
}
GM_registerMenuCommand('检查 Cookie（不导入）',()=>sync('check',false));
GM_registerMenuCommand('导入 / 更新当前账号',()=>sync('upsert',false));
GM_registerMenuCommand('设置新账号的分类和名称（当前：'+(cfg().tier==='ultra'?'Ultra':'普通')+'）',()=>{
 const c=cfg();
 const t=prompt('新账号分类：输入 ultra 或 standard（只影响新导入的账号，已导入的账号不改）',c.tier);
 if(t===null)return;GM_setValue('tier',t.trim().toLowerCase()==='ultra'?'ultra':'standard');
 const a=prompt('新账号名称（可留空，最多 40 字）',c.alias);
 if(a!==null)GM_setValue('alias',a.trim().slice(0,40));
 const n=cfg();toast('已保存：'+(n.tier==='ultra'?'Ultra':'普通')+(n.alias?' · '+n.alias:''));
});
GM_registerMenuCommand((cfg().auto?'关闭':'开启')+'自动同步（仅更新已导入账号）',()=>{
 const on=!cfg().auto;GM_setValue('auto',on);
 toast(on?'已开启自动同步：打开 AI Studio 时和每 '+cfg().minutes+' 分钟检查一次，Cookie 变了才上传。刷新页面后菜单文字会更新':'已关闭自动同步');
 if(on)sync('update',true);
});
if(cfg().auto){
 setTimeout(()=>sync('update',true),3000);
 setInterval(()=>sync('update',true),Math.max(2,cfg().minutes)*60000);
}
})();
