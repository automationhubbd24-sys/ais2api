'use strict';
// Per-instance concurrency. Persisted to disk so restarts, account switches and
// worker re-creation all keep the configured value; the worker itself has a
// fixed ceiling of MAX and the coordinator is what enforces the chosen value.
const fs=require('fs');
const MIN=1,MAX=10,DEFAULT=2;
const valid=n=>Number.isSafeInteger(n)&&n>=MIN&&n<=MAX;
class SlotConcurrency{
 constructor(file){
  this.file=file;this.limits={A:DEFAULT,B:DEFAULT};
  try{const d=JSON.parse(fs.readFileSync(file,'utf8'));for(const s of ['A','B'])if(valid(d?.[s]))this.limits[s]=d[s];}catch{}
 }
 get(slot){return valid(this.limits[slot])?this.limits[slot]:DEFAULT;}
 set(body){
  const next={...this.limits};
  for(const s of ['A','B']){
   if(body?.[s]===undefined)continue;
   const n=Number(body[s]);
   if(!valid(n))throw Object.assign(Error('并发数只能是 '+MIN+' 到 '+MAX+' 的整数'),{statusCode:400});
   next[s]=n;
  }
  const tmp=this.file+'.tmp';
  const fd=fs.openSync(tmp,'w',0o600);
  try{fs.writeSync(fd,JSON.stringify(next));fs.fsyncSync(fd);}finally{fs.closeSync(fd);}
  fs.renameSync(tmp,this.file);
  this.limits=next;return this.status();
 }
 status(){return {A:this.get('A'),B:this.get('B'),min:MIN,max:MAX,default:DEFAULT};}
}
module.exports={SlotConcurrency,MIN,MAX,DEFAULT};
