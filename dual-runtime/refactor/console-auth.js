'use strict';
// Console password and client API keys. The internal key in coordinator.json stays the
// service-to-service credential; this file only adds a login password and client keys.
const fs=require('fs'),path=require('path'),crypto=require('crypto');
const equal=(a,b)=>{const x=Buffer.from(String(a)),y=Buffer.from(String(b));return x.length===y.length&&crypto.timingSafeEqual(x,y);};
const hash=(password,salt)=>crypto.scryptSync(password,salt,32,{N:16384,r:8,p:1}).toString('hex');
class ConsoleAuth{
 constructor({file,internalKey}){
  if(typeof internalKey!=='string'||internalKey.length<16)throw Error('Internal key required');
  this.file=file;this.internalKey=internalKey;this.state={password:null,keys:[],internalExternal:true};
  try{const d=JSON.parse(fs.readFileSync(file,'utf8'));
   if(d&&typeof d==='object'){
    if(d.password&&/^[0-9a-f]{32}$/.test(d.password.salt)&&/^[0-9a-f]{64}$/.test(d.password.hash))this.state.password={salt:d.password.salt,hash:d.password.hash,updatedAt:d.password.updatedAt||null};
    if(Array.isArray(d.keys))this.state.keys=d.keys.filter(k=>k&&typeof k.key==='string'&&k.key.length>=24&&typeof k.id==='string');
    this.state.internalExternal=d.internalExternal!==false;
   }}catch(e){if(e.code!=='ENOENT')throw Error('console-auth.json unreadable');}
 }
 save(){const tmp=this.file+'.tmp';fs.writeFileSync(tmp,JSON.stringify(this.state,null,1),{mode:0o600});fs.renameSync(tmp,this.file);}
 isInternal(k){return typeof k==='string'&&equal(k,this.internalKey);}
 // Client access: active client keys, plus the internal key unless it was restricted.
 allows(k,{external}={}){
  if(typeof k!=='string'||!k)return false;
  if(this.isInternal(k))return !external||this.state.internalExternal;
  return this.state.keys.some(x=>!x.disabled&&equal(x.key,k));
 }
 verifyLogin(secret){
  if(typeof secret!=='string'||!secret||secret.length>512)return false;
  if(this.state.password)return equal(hash(secret,this.state.password.salt),this.state.password.hash);
  return this.isInternal(secret);
 }
 setPassword({current,next}){
  if(!this.verifyLogin(current))throw Object.assign(Error('当前密码不正确'),{statusCode:403});
  if(typeof next!=='string'||next.length<8||next.length>128)throw Object.assign(Error('新密码长度需为 8–128 位'),{statusCode:400});
  const salt=crypto.randomBytes(16).toString('hex');
  this.state.password={salt,hash:hash(next,salt),updatedAt:Date.now()};this.save();return this.status();
 }
 mask(k){return k.slice(0,6)+'…'+k.slice(-4);}
 status(){return {passwordSet:Boolean(this.state.password),passwordUpdatedAt:this.state.password?.updatedAt||null,
  internalExternal:this.state.internalExternal,internalMasked:this.mask(this.internalKey),
  keys:this.state.keys.map(k=>({id:k.id,name:k.name,masked:this.mask(k.key),createdAt:k.createdAt,disabled:Boolean(k.disabled)}))};}
 createKey(name){
  if(this.state.keys.length>=50)throw Object.assign(Error('Key 数量已达上限'),{statusCode:400});
  const label=String(name||'').trim().slice(0,40)||'未命名';
  const key='sk-ais-'+crypto.randomBytes(24).toString('base64url');
  const item={id:crypto.randomUUID(),name:label,key,createdAt:Date.now()};
  this.state.keys.push(item);this.save();return {...this.status(),created:{id:item.id,name:label,key}};
 }
 updateKey(id,{disabled,remove}){
  const i=this.state.keys.findIndex(k=>k.id===id);if(i<0)throw Object.assign(Error('Key 不存在'),{statusCode:404});
  if(remove)this.state.keys.splice(i,1);else this.state.keys[i].disabled=Boolean(disabled);
  this.save();return this.status();
 }
 setInternalExternal(on){
  if(!on&&!this.state.keys.some(k=>!k.disabled))throw Object.assign(Error('请先创建至少一个可用的客户端 Key'),{statusCode:400});
  this.state.internalExternal=Boolean(on);this.save();return this.status();
 }
}
class StreamMode{
 constructor(file){this.file=file;this.mode='fake';
  try{const d=JSON.parse(fs.readFileSync(file,'utf8'));if(d?.mode==='real'||d?.mode==='fake')this.mode=d.mode;}catch{}
  this.applied=new Map();}
 set(mode){if(mode!=='fake'&&mode!=='real')throw Error('Invalid mode');this.mode=mode;
  const tmp=this.file+'.tmp';fs.writeFileSync(tmp,JSON.stringify({mode,updatedAt:Date.now()}),{mode:0o600});fs.renameSync(tmp,this.file);this.applied.clear();}
}
module.exports={ConsoleAuth,StreamMode};
