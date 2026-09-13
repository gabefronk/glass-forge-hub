import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { buildSync } from 'esbuild';
const source = path => fs.readFileSync(new URL(path, import.meta.url), 'utf8').replaceAll('\r\n', '\n');
test('published function includes the tested preview core, adapter and authorized handler', () => {
  const entry = source('../base44/functions/message-assistant/entry.ts');
  const bundle = buildSync({entryPoints:[new URL('../base44/shared/replyPreview.js',import.meta.url).pathname],bundle:true,platform:'neutral',format:'iife',globalName:'__jobReply',write:false,logLevel:'silent'}).outputFiles[0].text;
  assert.ok(entry.includes(bundle), 'Published preview must exactly include the tested core, job fact adapter, and generation checks.');
  assert.ok(entry.includes(source('../base44/shared/messageAssistant.js').replace(/^import .*;\n/m, '')));
  assert.match(entry, /Deno\.serve\(createMessageAssistantHandler/);
});
