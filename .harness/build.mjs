import { build } from "esbuild";
import plugin from "./plugin.mjs";
await build({ entryPoints: [".harness/entry.jsx"], bundle: true, minify: true, format: "iife", outfile: ".harness/out.js", jsx: "automatic", loader: { ".js": "jsx" }, define: { "process.env.NODE_ENV": '"production"', "import.meta.env": "{}" }, plugins: [plugin], logLevel: "error", metafile: true }).then(r => { const m = r.metafile.outputs[".harness/out.js"].inputs; const top = Object.entries(m).sort((a,b)=>b[1].bytesInOutput-a[1].bytesInOutput).slice(0,12); for (const [k,v] of top) console.log(v.bytesInOutput, k); });
