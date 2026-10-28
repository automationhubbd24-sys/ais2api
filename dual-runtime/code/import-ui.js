const sameOrigin=req=>{try{const o=new URL(req.headers.origin);return ["https:","http:"].includes(o.protocol)&&o.host===req.headers.host;}catch{return false;}};
const fs = require("fs"), path = require("path"), crypto = require("crypto");
const AUTH_DIR=path.join(__dirname,"auth");
const SESSION_NAMES=["SID","__Secure-1PSID","__Secure-3PSID"];
const httpError=(status,error,extra)=>Object.assign(Error(error),{status,body:{error,...(extra||{})}});
// Validate a Playwright storage-state payload. Never echoes cookie values.
function validate(d){
   const str=x=>typeof x==="string";
   if(Array.isArray(d)) d={cookies:d,origins:[]};
   if(!d || !Array.isArray(d.cookies) || !d.cookies.length || d.cookies.length>500 || !Array.isArray(d.origins) || d.origins.length>20) throw Error("顶层结构无效：需要 cookies 与 origins 数组");
  const googleCookies=d.cookies.filter(c=>c&&str(c.domain)&&/^\.?([a-z0-9-]+\.)*google\.com$/i.test(c.domain));
  if(!googleCookies.length || googleCookies.length>200) throw Error("没有找到有效的 google.com Cookie");
  const cookies=googleCookies.map((c,i)=>{
    const expires=c.session===true?-1:(c.expires??c.expirationDate??-1);
    const sameSite={lax:"Lax",strict:"Strict",none:"None",no_restriction:"None",unspecified:"Lax"}[String(c.sameSite??"unspecified").toLowerCase()];
    if(!str(c.name) || !c.name || c.name.length>256 || !str(c.value) || c.value.length>16384 ||
       !str(c.path) || !c.path.startsWith("/") || c.path.length>2048 ||
       !Number.isFinite(expires) || expires<-1 || typeof c.httpOnly!=="boolean" ||
       typeof c.secure!=="boolean" || !sameSite) throw Error("Google Cookie #"+(i+1)+" 字段无效");
    return {name:c.name,value:c.value,domain:c.domain,path:c.path,expires,httpOnly:c.httpOnly,secure:c.secure,sameSite};
  });
  const origins=d.origins.map(o=>{
    if(!o || !["https://aistudio.google.com","https://ai.studio","https://accounts.google.com"].includes(o.origin) || !Array.isArray(o.localStorage) || o.localStorage.length>200) throw Error("origins.origin 只允许 aistudio.google.com / ai.studio / accounts.google.com");
    return {origin:o.origin,localStorage:o.localStorage.map(v=>{
      if(!v || !str(v.name) || !str(v.value) || v.name.length>1024 || v.value.length>65536) throw Error("localStorage 项无效");
      return {name:v.name,value:v.value};
    })};
  });
  return {cookies,origins};
}
const sess=list=>{const m=new Map();for(const c of list)if(SESSION_NAMES.includes(c.name)&&c.value)m.set(c.name,c.value);return m;};
const listIds=()=>{fs.mkdirSync(AUTH_DIR,{recursive:true,mode:0o700});return fs.readdirSync(AUTH_DIR).filter(n=>/^auth-\d+\.json$/.test(n)).map(n=>Number(n.match(/\d+/)[0]));};
function findSame(cookies,nums){
  const mine=sess(cookies);if(!mine.size)return null;
  for(const n of nums){
    try{const other=sess(JSON.parse(fs.readFileSync(path.join(AUTH_DIR,"auth-"+n+".json"),"utf8")).cookies||[]);
      if([...mine].some(([k,v])=>other.get(k)===v))return n;}catch{}
  }
  return null;
}
const cleanAlias=v=>String(v||"").replace(/[\u0000-\u001f\u007f]/g,"").trim().slice(0,40);
// mode: "new" rejects an already-imported session (409); "upsert" refreshes its cookies in place;
// "update" only refreshes and never creates. Name, tier and login email are always kept on refresh.
function saveImport(system,body,{tier,alias,update=false,mode}={}){
  mode=mode||(update?"upsert":"new");
  let data;
  try{data=validate(body);}catch(e){throw httpError(400,"文件结构不符合要求，或无法安全保存",{detail:String(e.message).slice(0,200)});}
  if(!sess(data.cookies).size)throw httpError(400,"没有找到登录 Cookie（SID / __Secure-1PSID），请确认已登录 Google");
  const nums=listIds();
  const same=findSame(data.cookies,nums);
  if(same!==null){
    if(mode==="new")throw httpError(409,"这个账号已经导入过（账号 #"+same+"），没有重复添加",{duplicate:same});
    const file=path.join(AUTH_DIR,"auth-"+same+".json");
    let old={};try{old=JSON.parse(fs.readFileSync(file,"utf8"));}catch{}
    const keep={};for(const k of ["accountName","accountTier","displayName"])if(old[k]!==undefined)keep[k]=old[k];
    const content=JSON.stringify({cookies:data.cookies,origins:data.origins,...keep});
    if(Buffer.byteLength(content)>262144)throw httpError(413,"文件过大");
    const tmp=file+".tmp-"+process.pid+"-"+Date.now();
    fs.writeFileSync(tmp,content,{flag:"wx",mode:0o600});
    try{fs.renameSync(tmp,file);}catch(e){try{fs.unlinkSync(tmp);}catch{}throw e;}
    system.logger.info("[Import] 更新账号 #"+same+" 的 Cookie");
    return {index:same,updated:true,tier:["pro","ultra","ultra20"].includes(keep.accountTier)?keep.accountTier:"standard",alias:keep.displayName||"",verified:false};
  }
  if(mode==="update")throw httpError(404,"这个 Google 账号还没导入过；自动同步只更新已导入的账号");
  if(nums.length>=50)throw httpError(409,"账号数量已达上限");
  const index=Math.max(0,...nums)+1;
  tier=["pro","ultra","ultra20"].includes(tier)?tier:"standard";alias=cleanAlias(alias);
  const content=JSON.stringify({cookies:data.cookies,origins:data.origins,accountName:"导入账号 "+index,...(tier!=="standard"?{accountTier:tier}:{}),...(alias?{displayName:alias}:{})});
  if(Buffer.byteLength(content)>262144)throw httpError(413,"文件过大");
  fs.writeFileSync(path.join(AUTH_DIR,"auth-"+index+".json"),content,{flag:"wx",mode:0o600});
  system.authSource.initialIndices.push(index);
  system.authSource.availableIndices.push(index);
  system.authSource.accountNameMap.set(index,alias||"导入账号 "+index);
  if(system.requestHandler)system.requestHandler.currentAuthIndex=index;
  system.logger.info("[Import] 新增账号 #"+index+"，尚未验证");
  return {index,updated:false,tier,alias,verified:false};
}
module.exports = function(app, system) {
  const guard = (req,res,next) => {
    res.set("Cache-Control","no-store");
    res.removeHeader("Access-Control-Allow-Origin");
    if (!req.session.isAuthenticated) return res.status(401).json({error:"请先登录"});
    next();
  };
  app.get("/import",guard,(req,res)=>{
    req.session.importToken ||= crypto.randomBytes(32).toString("hex");
    res.set("X-Frame-Options","DENY");
    res.send(fs.readFileSync(path.join(__dirname,"import-ui.html"),"utf8").replace("__CSRF_TOKEN__",req.session.importToken));
  });
  app.post("/api/import-account",guard,(req,res)=>{
    if(!sameOrigin(req) || !req.session.importToken || req.get("X-Import-Token") !== req.session.importToken)
      return res.status(403).json({error:"请求校验失败，请刷新导入页面"});
    if(!req.is("application/json")) return res.status(415).json({error:"仅支持JSON"});
    if(system.authSource.authMode !== "file") return res.status(409).json({error:"非文件认证模式"});
    let alias="";try{alias=decodeURIComponent(req.get("X-Account-Alias")||"");}catch{}
    try{const r=saveImport(system,req.body,{tier:req.get("X-Account-Tier"),alias,update:false});res.json({index:r.index,tier:r.tier,alias:r.alias,verified:false});}
    catch(e){
      if(e.status)return res.status(e.status).json(e.body);
      res.status(400).json({error:"文件结构不符合要求，或无法安全保存",detail:e && e.message ? String(e.message).slice(0,200) : "unknown"});
    }
  });
};
module.exports.saveImport=saveImport;
