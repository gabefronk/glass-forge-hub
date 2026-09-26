import path from "node:path";
export default { name: "alias", setup(b) {
  b.onResolve({ filter: /^@\/api\/base44Client$/ }, () => ({ path: path.resolve(".harness/client.js") }));
  b.onResolve({ filter: /^@\/lib\/AuthContext$/ }, () => ({ path: path.resolve(".harness/auth.jsx") }));
  b.onResolve({ filter: /billingCore\.js$/ }, (a) => a.importer.endsWith("billing.js") ? undefined : ({ path: path.resolve(".harness/billing.js") }));
  b.onResolve({ filter: /^@\// }, async (a) => { const r = await b.resolve("./" + a.path.slice(2), { resolveDir: path.resolve("src"), kind: a.kind }); return r; });
} };
