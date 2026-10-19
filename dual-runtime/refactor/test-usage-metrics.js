'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {normalizeUsage:n,estimateCost:c,validatePrice:v}=require('./usage-metrics');
const price={currency:'USD',revision:'test-only',inputPerMillion:2,outputPerMillion:8,cachedPerMillion:0.5,reasoningPerMillion:8,reasoningMode:'separate'};
test('missing token data remains unknown, not zero',()=>{
 assert.ok(n({choices:[{message:{content:'not stored'}}]}) === null);
 const u=n({usage:{prompt_tokens:10}});
 assert.equal(u.output,null);assert.equal(u.cached,null);
 assert.equal(c(u,price).amount,null);
});
test('OpenAI reasoning is already included in completion tokens',()=>{
 const u=n({usage:{prompt_tokens:1000,completion_tokens:200,prompt_tokens_details:{cached_tokens:800},completion_tokens_details:{reasoning_tokens:100},total_tokens:1200}});
 assert.equal(c(u,price).amount,0.0036);
 assert.equal(u.source,'response-reported-unverified');
});
test('Gemini separate reasoning is priced explicitly',()=>{
 const u=n({usageMetadata:{promptTokenCount:1000,candidatesTokenCount:200,cachedContentTokenCount:800,thoughtsTokenCount:100,totalTokenCount:1300}});
 assert.equal(c(u,price).amount,0.0044);
});
test('cache is ignored: all input is billed at the uncached rate',()=>{
 const u=n({usage:{prompt_tokens:1000,completion_tokens:200}});
 assert.equal(c(u,price).amount,0.0036);
 assert.equal(c(u,{...price,cachedPerMillion:null}).amount,0.0036);
});
test('missing prices are not free usage',()=>{
 assert.equal(c(n({usage:{prompt_tokens:0,completion_tokens:0}}),).reason,'price_missing');
});
test('invalid numbers and cache larger than input are rejected',()=>{
 assert.ok(n({usage:{prompt_tokens:-1,completion_tokens:1.5}}) === null);
 assert.equal(c(n({usage:{prompt_tokens:1,completion_tokens:1,prompt_tokens_details:{cached_tokens:2}}}),price).amount,0.00001);
 assert.throws(()=>v({...price,inputPerMillion:Infinity}));
 assert.throws(()=>v({...price,outputPerMillion:-1}));
});
test('explicit zero usage and explicit zero price are valid',()=>{
 const u=n({usage:{prompt_tokens:0,completion_tokens:0,prompt_tokens_details:{cached_tokens:0}}});
 assert.equal(c(u,price).amount,0);
});
test('only allowlisted metrics leave normalization',()=>{
 const u=n({usage:{prompt_tokens:12,secret:'must not persist'},messages:['private text']});
 assert.equal(JSON.stringify(u).includes('private'),false);
 assert.equal(JSON.stringify(u).includes('secret'),false);
});
test('native usage without thoughtsTokenCount means zero thinking tokens',()=>{
 const u=n({usageMetadata:{promptTokenCount:10,candidatesTokenCount:2,cachedContentTokenCount:0}});
 assert.equal(u.reasoning,0);assert.equal(c(u,price).amount,0.000036);
});
test('native output is derived from total when candidates count is omitted',()=>{
 const u=n({usageMetadata:{promptTokenCount:100,thoughtsTokenCount:20,totalTokenCount:150}});
 assert.equal(u.output,30);
 assert.equal(n({usageMetadata:{promptTokenCount:100}}).output,null);
});
