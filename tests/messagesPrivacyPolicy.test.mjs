import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
test('private texts, attachments, device keys and derived reports have no direct or generic MCP access',async()=>{
 const mcp=JSON.parse(await readFile(new URL('../base44/mcp/config.json',import.meta.url),'utf8'));
 for(const name of ['MessageRecord','MessageConversation','MessageBridgeDevice','ProbuildReportDraft','ProbuildControlDevice']){
  const schema=JSON.parse(await readFile(new URL('../base44/entities/'+name+'.jsonc',import.meta.url),'utf8'));
  assert.deepEqual(schema.rls,{create:false,read:false,update:false,delete:false},name);
  assert.deepEqual(mcp.tools.entity_overrides[name].operations,[],name);
 }
});
