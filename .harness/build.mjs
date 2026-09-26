import { build } from "esbuild"; import path from "node:path";
const plugin = { name: "alias", setup(b) {
  b.onResolve({ filter: /^@\/api\/base44Client$/ }, () => ({ path: path.resolve(".harness/client.js") }));
  b.onResolve({ filter: /^@\/lib\/AuthContext$/ }, () => ({ path: path.resolve(".harness/auth.jsx") }));
  b.onResolve({ filter: /billingCore\.js$/ }, (a) => a.importer.endsWith("billing.js") ? undefined : ({ path: path.resolve(".harness/billing.js") }));
  b.onResolve({ filter: /^(heic-to.*|jspdf|html2canvas|canvg|pako|dompurify)$/ }, () => ({ path: path.resolve(".harness/stub.js") }));
  b.onResolve({ filter: /^@\// }, (a) => b.resolve("./" + a.path.slice(2), { resolveDir: path.resolve("src"), kind: a.kind }));
} };
await build({ entryPoints: [".harness/entry.jsx"], bundle: true, minify: true, format: "iife", outfile: ".harness/out.js", jsx: "automatic", loader: { ".js": "jsx" }, define: { "process.env.NODE_ENV": '"production"', "import.meta.env": "{}" }, plugins: [plugin], logLevel: "error" });
