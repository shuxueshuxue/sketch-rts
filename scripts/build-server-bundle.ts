import { rm } from "node:fs/promises";
import path from "node:path";
import { build } from "esbuild";

const root = process.cwd();
const outdir = path.join(root, "dist-server");

await rm(outdir, { recursive: true, force: true });

// The server and the worker thread its hosted AI thinks on (src/server/index.ts loads ./ai-think-worker.mjs).
await build({
  entryPoints: { index: path.join(root, "src/server/index.ts"), "ai-think-worker": path.join(root, "src/ai/think-worker/node-entry.ts") },
  outdir,
  outExtension: { ".js": ".mjs" },
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node20",
  banner: {
    js: "import { createRequire } from 'node:module'; const require = createRequire(import.meta.url);",
  },
  define: {
    "process.env.NODE_ENV": '"production"',
  },
});
