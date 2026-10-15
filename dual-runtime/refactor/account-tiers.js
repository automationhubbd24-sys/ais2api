'use strict';
// Account class lives in each auth file (accountTier), so it survives imports,
// cookie refreshes and the Ultra switch. The switch only changes slot allocation.
const fs=require('fs'),path=require('path'),crypto=require('crypto');
const TIERS=['standard','ultra'];
function cleanAlias(name){
 if(name!==undefined&&name!==null&&typeof name!=='string')throw Object.assign(Error('名称格式无效'),{statusCode:400});
 const s=String(name||'').replace(/[\u0000-\u001f\u007f]/g,'').trim();
 if(s.length>40)throw Object.assign(Error('名称最多 40 个字'),{statusCode:400});
 return s;
}
class AccountTiers{
 constructor({authDir,file,isSingle=()=>false}){
  Object.assign(this,{authDir,file,isSingle});this.cache=new Map();
  this.mode={enabled:false,slot:'B'};
  try{const m=JSON.parse(fs.readFileSync(file,'utf8'));
   this.mode={enabled:m.enabled===true,slot:['A','B'].includes(m.slot)?m.slot:'B'};}catch{}
 }
 authFile(id){if(!Number.isSafeInteger(id)||id<1)throw Error('账号无效');return path.join(this.authDir,'auth-'+id+'.json');}
 tier(id){
  let st;try{st=fs.statSync(this.authFile(id));}catch{return 'standard';}
  const tag=st.ino+':'+st.size+':'+st.mtimeMs,hit=this.cache.get(id);
  if(hit?.tag===tag)return hit.tier;
  let tier='standard';
  try{const t=JSON.parse(fs.readFileSync(this.authFile(id),'utf8')).accountTier;if(TIERS.includes(t))tier=t;}catch{}
  this.cache.set(id,{tag,tier});return tier;
 }
 isUltra(id){return this.tier(id)==='ultra';}
 setTier(id,tier){
  if(!TIERS.includes(tier))throw Object.assign(Error('分类只能是 standard 或 ultra'),{statusCode:400});
  this.update(id,data=>{if(tier==='standard')delete data.accountTier;else data.accountTier=tier;});
  return {id,tier};
 }
 // Display name only; accountName stays untouched because login uses it to find duplicates.
 setAlias(id,name){
  const alias=cleanAlias(name);
  this.update(id,data=>{if(alias)data.displayName=alias;else delete data.displayName;});
  return {id,alias};
 }
 names(id){
  try{const d=JSON.parse(fs.readFileSync(this.authFile(id),'utf8'));
   return {alias:typeof d.displayName==='string'?d.displayName:'',accountName:typeof d.accountName==='string'?d.accountName:''};}
  catch{return {alias:'',accountName:''};}
 }
 update(id,change){
  const file=this.authFile(id);let st;
  try{st=fs.lstatSync(file);}catch{throw Object.assign(Error('账号 '+id+' 不存在'),{statusCode:404});}
  if(!st.isFile()||st.isSymbolicLink())throw Object.assign(Error('认证文件类型异常'),{statusCode:409});
  const data=JSON.parse(fs.readFileSync(file,'utf8'));
  change(data);
  const tmp=file+'.'+crypto.randomBytes(6).toString('hex')+'.tmp';
  const fd=fs.openSync(tmp,'wx',st.mode&0o777);
  try{fs.writeFileSync(fd,JSON.stringify(data));fs.fchownSync(fd,st.uid,st.gid);fs.fsyncSync(fd);}finally{fs.closeSync(fd);}
  fs.renameSync(tmp,file);this.cache.delete(id);
 }
 active(){return this.mode.enabled&&!this.isSingle();}
 // Which slot an account may be assigned to. Off/single mode: any slot.
 allowed(slot,id){
  if(!this.active())return true;
  return (slot===this.mode.slot)===this.isUltra(id);
 }
 mismatch(slot,id){return id!==undefined&&!this.allowed(slot,id);}
 setMode(body){
  const enabled=body?.enabled,slot=body?.slot??this.mode.slot;
  if(typeof enabled!=='boolean'||!['A','B'].includes(slot))throw Object.assign(Error('参数无效'),{statusCode:400});
  this.mode={enabled,slot};
  const tmp=this.file+'.tmp';fs.writeFileSync(tmp,JSON.stringify(this.mode),{mode:0o600});fs.renameSync(tmp,this.file);
  return this.status();
 }
 status(ids=[]){
  const ultra=ids.filter(id=>this.isUltra(id));
  return {...this.mode,active:this.active(),single:this.isSingle(),ultraAccounts:ultra};
 }
}
module.exports={AccountTiers,TIERS,cleanAlias};
