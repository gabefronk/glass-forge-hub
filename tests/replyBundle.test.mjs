import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
const source = path => fs.readFileSync(new URL(path, import.meta.url), 'utf8').replaceAll('\r\n', '\n');
test('published function includes the tested preview core, adapter and authorized handler', () => {
  const entry = source('../base44/functions/message-assistant/entry.ts');
  const strip = text => text.replace(/^import .*;\n/m, '').replace(/^export /gm, '');
  assert.ok(entry.includes(strip(source('../base44/shared/replyPlanner.mjs'))));
  assert.ok(entry.includes(strip(source('../base44/shared/replyPreview.js'))));
  assert.ok(entry.includes(source('../base44/shared/messageAssistant.js').replace(/^import .*;\n/m, '')));
  assert.match(entry, /Deno\.serve\(createMessageAssistantHandler/);
});
