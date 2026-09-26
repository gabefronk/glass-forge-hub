import { build } from 'esbuild';
import path from 'node:path';
const root = path.resolve('.');
const stub = ['heic-to', 'jspdf', 'html2canvas', 'canvg', 'pako', 'dompurify'];
await build({
  entryPoints: ['.harness/entry.jsx'], bundle: true, outfile: '.harness/out.js', format: 'iife', jsx: 'automatic', loader: { '.js': 'jsx' },
  define: { 'process.env.NODE_ENV': '"production"', 'import.meta.env': '{}' },
  plugins: [{ name: 'm', setup(b) {
    b.onResolve({ filter: /^@\/api\/base44Client$/ }, () => ({ path: path.join(root, '.harness/base44Mock.js') }));
    b.onResolve({ filter: /^@\/lib\/AuthContext$/ }, () => ({ path: path.join(root, '.harness/auth.js') }));
    b.onResolve({ filter: /billingCore\.js$/ }, (a) => a.importer.includes('.harness') ? undefined : ({ path: path.join(root, '.harness/billing.js') }));
    b.onResolve({ filter: /^@\// }, async (a) => { const r = await b.resolve('./' + a.path.slice(2), { resolveDir: path.join(root, 'src'), kind: a.kind }); return r; });
    b.onResolve({ filter: new RegExp(`^(${stub.join('|')})`) }, (a) => ({ path: a.path, namespace: 'stub' }));
    b.onLoad({ filter: /.*/, namespace: 'stub' }, () => ({ contents: 'export default {}; export const heicTo=()=>null, isHeic=()=>false, jsPDF=function(){};', loader: 'js' }));
  } }],
});


import fs from 'node:fs';
const css = fs.readdirSync('dist/assets').filter((f) => f.endsWith('.css')).map((f) => fs.readFileSync('dist/assets/' + f, 'utf8')).join('\n');
fs.writeFileSync('.harness/index.html', `<!doctype html><html><head><meta charset="utf-8"><style>${css}</style></head><body style="margin:0"><div id="root"></div><script>${fs.readFileSync('.harness/out.js', 'utf8').replace(/<\/script>/g, '<\\/script>')}</script></body></html>`);
console.log('ok');
