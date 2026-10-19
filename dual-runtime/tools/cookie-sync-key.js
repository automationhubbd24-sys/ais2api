#!/usr/bin/env node
'use strict';
// Prints the userscript sync key for this deployment.
// The key is HMAC-SHA256(first API key, 'ais2api-cookie-sync-v1'), the same value the management server checks.
// It is not the API key itself; it only allows importing/refreshing accounts. Changing the first API key changes it.
// Usage: node cookie-sync-key.js [path/to/coordinator.json]   or   API_KEY=... node cookie-sync-key.js
const fs=require('fs'),path=require('path'),crypto=require('crypto');
let key=process.env.API_KEY||'';
if(!key){
 const file=process.argv[2]||path.join(__dirname,'..','coordinator.json');
 try{key=String((JSON.parse(fs.readFileSync(file,'utf8')).apiKeys||[])[0]||'');}
 catch(e){console.error('读不到 '+file+'：'+e.message+'\n可以用 API_KEY=<第一个 API Key> node cookie-sync-key.js');process.exit(1);}
}
if(!key){console.error('没有找到 API Key（coordinator.json 的 apiKeys[0]）');process.exit(1);}
console.log(crypto.createHmac('sha256',key).update('ais2api-cookie-sync-v1').digest('hex'));
