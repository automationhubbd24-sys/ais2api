'use strict';
const test=require('node:test'),assert=require('assert'),fs=require('fs'),path=require('path');
const src=fs.readFileSync(path.join(__dirname,'..','code','unified-server.runtime.js'),'utf8');
const a=src.indexOf('const GCB_INSTALL = `')+21,b=src.indexOf('`;',a);
const code=src.slice(a,b).replace(/\\\\/g,'\\');
function install(M){const window={default_MakerSuite:M};new Function('window','return '+code)(window);return window;}
const snap=function(a,b){return a.snapshot(b),{content:b}};
const hashFn=new Function('a','var e=new TextEncoder;return x.digest()');
test('new frontend: GB is a class, hash function found by scanning (OC)',()=>{
 class GB{constructor(){this.k=1}}
 const w=install({Ln:snap,GB,OC:hashFn});assert.equal(w.__gcHn,'OC');assert.equal(w.__gcH,hashFn);
});
test('GB is the real hash function: shortcut still used',()=>{assert.equal(install({Ln:snap,GB:hashFn}).__gcHn,'GB');});
test('old frontend: gC found by scanning',()=>{assert.equal(install({En:snap,gC:hashFn}).__gcHn,'gC');});
test('GB is an unrelated function: not used, scan finds the real one',()=>{
 const w=install({Ln:snap,GB:function(){return 1},zz:hashFn});assert.equal(w.__gcHn,'zz');
});
test('no hash function at all: reports nohash',()=>{
 class GB{} ;const window={default_MakerSuite:{Ln:snap,GB}};
 assert.equal(new Function('window','return '+code)(window),'nohash');
});
