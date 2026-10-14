External real Chromium Canvas pixel equality check. This does not edit or transform production source.

Run sequentially in the browser window assigned by the review agent:

```sh
node /workspace/homepage-raster-pixel-tools/verify.mjs --baseline /workspace/sketch-rts-homepage-art-before-render-fix --candidate /workspace/sketch-rts-homepage-board --out /workspace/homepage-raster-pixel-parity-1
```

Optional narrow first run: append `--corpses-only true --model marine` and select a different new output directory (6 cases). Without `--model marine`, corpse-only mode has 18 cases. The full run has 34 cases: 18 actual marine/carpenter/pirate corpse cases (density 2/4, orientation 0/1/2), 8 representative actual unit/story-model poses, 6 actual scenery cases, and 2 actual crop-pool reuse cases. Corpse outer tiles/coordinates and readback context match WorldLayer/PaintedCardBatches. Each regular case records a real cold miss and warm cache hit. Crop pixels are read after both outer draws so the observation does not migrate a baseline crop before its warm draw.

Evidence contains exact case inputs; source/head/tool/runtime hashes and versions; source snapshots before/after; Chromium runtime and stderr; console/network failures; outer and crop RGBA losslessly gzipped; canvas dimensions, alpha bounds/statistics, crop density/anchors/context attributes; byte-by-byte differences with examples. Output directories are created exclusively and never overwritten. `proof.json.pass` requires every RGBA byte, dimension, anchor and alpha statistic to match. Crop `willReadFrequently` is the intentional candidate difference. It requires source differences to be limited to the one hint plus comments. Failure leaves all collected evidence and sets exit status 1.

No tests or browser runs were performed as part of preparing these external files. Pixel equality is a correctness check, not a performance claim or a promise for other browser engines.
