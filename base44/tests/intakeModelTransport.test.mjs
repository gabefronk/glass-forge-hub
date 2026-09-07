import test from 'node:test';
import assert from 'node:assert/strict';
import { invokeIntakeModel } from '../shared/windowQuoteScriptedRuntime.js';

const request = { prompt: 'Interpret this request.', response_json_schema: { type: 'object', properties: { summary: { type: 'string' } } }, add_context_from_internet: false };
const context = invoke => ({ client: { asServiceRole: { integrations: { Core: { InvokeLLM: invoke } } } } });

test('model transport uses the authenticated app integration and accepts structured results', async () => {
  let calls=0;
  const result=await invokeIntakeModel(request,context(async params=>{calls++;assert.deepEqual(params,request);return{summary:'Understood'};}));
  assert.deepEqual(result,{summary:'Understood'});assert.equal(calls,1);
});

test('a provider schema rejection retries once as JSON text without weakening the data contract', async () => {
  const calls=[];
  const result=await invokeIntakeModel(request,context(async params=>{calls.push(params);if(calls.length===1)throw{status:400};return '```json\n{"summary":"Understood"}\n```';}));
  assert.deepEqual(result,{summary:'Understood'});assert.equal(calls.length,2);assert.equal('response_json_schema' in calls[1],false);assert.equal(calls[1].add_context_from_internet,false);assert.ok(calls[1].prompt.includes(JSON.stringify(request.response_json_schema)));
});

test('authentication and quota failures do not trigger alternative model calls', async () => {
  for(const status of [401,403,429,503]){let calls=0;await assert.rejects(invokeIntakeModel(request,context(async()=>{calls++;throw{status};})),error=>error.status===status);assert.equal(calls,1);}
});

test('malformed fallback text is rejected instead of treated as a usable quote', async () => {
  let calls=0;await assert.rejects(invokeIntakeModel(request,context(async()=>{if(++calls===1)throw{response:{status:400}};return 'Cannot return a schedule';})),SyntaxError);assert.equal(calls,2);
});
