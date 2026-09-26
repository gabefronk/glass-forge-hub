import { build } from "esbuild";
import plugin from "./plugin.mjs";
await build({ entryPoints: [".harness/entry.jsx"], bundle: true, minify: true, format: "iife", outfile: ".harness/out.js", jsx: "automatic", loader: { ".js": "jsx" }, define: { "process.env.NODE_ENV": '"production"', "import.meta.env": "{}" }, plugins: [plugin], logLevel: "error" });
