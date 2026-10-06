import { build } from 'esbuild';
import { copyFile, mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const output=resolve(process.argv[2]??'.art-build/ship-webgl-preview');
await mkdir(output,{recursive:true});
await build({entryPoints:['src/recorder/previews/ship-webgl.ts'],bundle:true,format:'esm',target:'es2022',define:{'import.meta.env':JSON.stringify({BASE_URL:'/sketch-rts/'})},loader:{'.woff2':'dataurl'},outfile:resolve(output,'ship-webgl.js'),minify:true});
await copyFile('public/art/ships3d/warship.glb',resolve(output,'warship.glb'));
await writeFile(resolve(output,'index.html'),'<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Sketch RTS · 实时 3D 海试</title><link rel="stylesheet" href="ship-webgl.css"></head><body><script type="module" src="ship-webgl.js"></script></body></html>');
console.log(output);
