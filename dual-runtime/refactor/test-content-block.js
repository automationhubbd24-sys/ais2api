'use strict';
const test=require('node:test'),assert=require('node:assert');
const AT=require('../code/anti-truncation.js');
const {ResponseMetrics}=require('./response-metrics');
test('response-side PROHIBITED_CONTENT is recognised with prompt tokens',()=>{
 const info=AT.atBlockInfo({candidates:[{finishReason:'PROHIBITED_CONTENT'}],usageMetadata:{promptTokenCount:66751}});
 assert.deepStrictEqual(info,{reason:'PROHIBITED_CONTENT',stage:'response',promptTokens:66751});
});
test('prompt-side blockReason is recognised',()=>{
 const info=AT.atBlockInfo({promptFeedback:{blockReason:'SAFETY'}});
 assert.strictEqual(info.reason,'SAFETY');assert.strictEqual(info.stage,'prompt');assert.strictEqual(info.promptTokens,null);
});
test('normal finish reasons are not blocks',()=>{
 for(const f of ['STOP','MAX_TOKENS','MALFORMED_FUNCTION_CALL',undefined])
  assert.strictEqual(AT.atBlockInfo({candidates:[{finishReason:f}]}),null);
 assert.strictEqual(AT.atBlockInfo({promptFeedback:{blockReason:'BLOCK_REASON_UNSPECIFIED'}}),null);
 assert.strictEqual(AT.atBlockInfo(null),null);
});
test('blocked payload is recorded with reason and input tokens, not as service failure',()=>{
 const payload=AT.atBlockPayload({reason:'PROHIBITED_CONTENT',stage:'response',promptTokens:66751},502);
 assert.strictEqual(payload.error.type,'content_blocked');
 assert.notStrictEqual(payload.error.status,'SERVICE_UNAVAILABLE');
 const m=new ResponseMetrics({stream:false});m.write(Buffer.from(JSON.stringify(payload)));
 const r=m.finish({complete:true});
 assert.strictEqual(r.errorKind,'PROHIBITED_CONTENT');
 assert.strictEqual(r.applicationError,true);
 assert.strictEqual(r.usage.input,66751);
 assert.strictEqual(r.usage.output,null);
 assert.strictEqual(r.usageComplete,false);
});
