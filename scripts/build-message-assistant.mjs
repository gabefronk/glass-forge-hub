// Rebuild only the message-assistant deployment bundle from its tested shared sources.
// Does not deploy, authenticate, change entities, or call a model.
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { buildSync } from 'esbuild';
const root = new URL('../', import.meta.url);
const entryPath = new URL('base44/functions/message-assistant/entry.ts', root);
const sharedPath = new URL('base44/shared/messageAssistant.js', root);
const old = fs.readFileSync(entryPath, 'utf8').replaceAll('\r\n', '\n');
const shared = fs.readFileSync(sharedPath, 'utf8').replaceAll('\r\n', '\n');
const imports = shared.match(/^import \{([^}]+)\} from '\.\/replyPreview\.js';\n/);
const prefixEnd = old.indexOf('// Scoped preview modules');
const footerStart = old.indexOf('async function loadAssistantDirectory(client)');
if (!imports || prefixEnd < 0 || footerStart < 0) throw new Error('Unexpected deployment layout; refusing to overwrite.');
const bundle = buildSync({ entryPoints: [fileURLToPath(new URL('base44/shared/replyPreview.js', root))], bundle: true, platform: 'neutral', format: 'iife', globalName: '__jobReply', write: false, logLevel: 'silent' }).outputFiles[0].text;
const prefix = old.slice(0, prefixEnd).replace('// Deployment revision 2026-09-13: policy v3 and solution maps v2; approved iPad route; draft-only worker.', '// Deployment revision 2026-09-14: policy v4, service safety v1, draft-only worker; no sending.');
const output = prefix + '// Scoped preview modules are enclosed to preserve existing helper names.\n// JOB_REPLY_BUNDLE_START\n' + bundle + 'const {' + imports[1] + '} = __jobReply;\n// JOB_REPLY_BUNDLE_END\n' + shared.slice(imports[0].length) + '\n\n' + old.slice(footerStart);
fs.writeFileSync(entryPath, output);
console.log('Rebuilt base44/functions/message-assistant/entry.ts from tested shared modules; not deployed.');
