'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {sanitizeRequest:s,SanitizeError}=require('./request-sanitizer');
const oai=params=>({model:'m',messages:[],tools:[{type:'function',function:{name:'f',description:'d',parameters:params}}]});
const P=r=>r.body.tools[0].function.parameters;
test('lower-case JSON schema types are upper-cased',()=>{
 const r=s('/v1/chat/completions',oai({type:'object',properties:{c:{type:'array',items:{type:'string'}}},required:['c']}));
 assert.equal(r.changed,true);assert.deepEqual(P(r),{type:'OBJECT',properties:{c:{type:'ARRAY',items:{type:'STRING'}}},required:['c']});
});
test('JSON-schema-only keywords are dropped',()=>{
 const r=s('/v1/chat/completions',oai({$schema:'x',type:'object',additionalProperties:false,properties:{c:{type:'string',examples:['a']}}}));
 assert.deepEqual(P(r),{type:'OBJECT',properties:{c:{type:'STRING'}}});
});
test('nullable type unions become nullable; multi-type unions become anyOf',()=>{
 const r=s('/v1/chat/completions',oai({type:'object',properties:{a:{type:['string','null']},b:{type:['string','number']}}}));
 assert.deepEqual(P(r).properties.a,{type:'STRING',nullable:true});
 assert.deepEqual(P(r).properties.b.anyOf.map(x=>x.type),['STRING','NUMBER']);
});
test('$ref and allOf are inlined; required trimmed to existing props',()=>{
 const r=s('/v1/chat/completions',oai({type:'object',$defs:{C:{type:'string'}},properties:{c:{$ref:'#/$defs/C'}},allOf:[{required:['c','gone']}]}));
 assert.deepEqual(P(r),{type:'OBJECT',properties:{c:{type:'STRING'}},required:['c']});
});
test('strict flag removed, already-valid schema unchanged',()=>{
 const body=oai({type:'OBJECT',properties:{c:{type:'STRING'}}});
 assert.equal(s('/v1/chat/completions',body).changed,false);
 body.tools[0].function.strict=true;assert.equal(s('/v1/chat/completions',body).changed,true);
});
test('numeric enum kept as description hint',()=>{
 const r=s('/v1/chat/completions',oai({type:'object',properties:{n:{type:'integer',enum:[1,2]}}}));
 assert.equal(P(r).properties.n.enum,undefined);assert.match(P(r).properties.n.description,/1, 2/);
});
test('unfixable requests are rejected locally',()=>{
 assert.throws(()=>s('/v1/chat/completions',oai({type:'object',properties:{x:{$ref:'#/$defs/Missing'}}})),SanitizeError);
 assert.throws(()=>s('/v1/chat/completions',oai({type:'object',$defs:{N:{type:'object',properties:{n:{$ref:'#/$defs/N'}}}},properties:{n:{$ref:'#/$defs/N'}}})),/循环引用/);
 assert.throws(()=>s('/v1/chat/completions',oai({type:'tuple'})),/不支持的类型/);
 const dup=oai({type:'object'});dup.tools.push(dup.tools[0]);assert.throws(()=>s('/v1/chat/completions',dup),/重复/);
 const bad=oai({type:'object'});bad.tools[0].function.name='bad name!';assert.throws(()=>s('/v1/chat/completions',bad),/不合法/);
});
test('native Gemini declarations are repaired too',()=>{
 const body={contents:[],tools:[{functionDeclarations:[{name:'g',parametersJsonSchema:{type:'object',properties:{c:{type:'string'}}}}]}]};
 const r=s('/v1beta/models/x:generateContent',body);
 assert.deepEqual(r.body.tools[0].functionDeclarations[0],{name:'g',parameters:{type:'OBJECT',properties:{c:{type:'STRING'}}}});
});
test('requests without tools are untouched',()=>{
 assert.equal(s('/v1/chat/completions',{model:'m',messages:[{role:'user',content:'hi'}]}).changed,false);
});
