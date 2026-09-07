import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
test('frontend and runner share identical reviewed intake and price-verification rules',()=>{for(const file of ['easyRequest.js','amscoQuotePlan.js'])assert.equal(fs.readFileSync(new URL('../../src/lib/'+file,import.meta.url),'utf8'),fs.readFileSync(new URL('../shared/'+file,import.meta.url),'utf8'));});
