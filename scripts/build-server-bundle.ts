import { rm } from "node:fs/promises";
import path from "node:path";
import { build } from "esbuild";

const root = process.cwd();
const outdir = path.join(root, "dist-server");

await rm(outdir, { recursive: true, force: true });

await build({
  entryPoints: [path.join(root, "src/server/index.ts")],
  outfile: path.join(outdir, "index.mjs"),
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
