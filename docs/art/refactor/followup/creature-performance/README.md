# Lossless raster recovery, 2026-10-11

Baseline: `da2ec82`; optimized implementation is the commit containing this report. Same Chrome 151 / SwiftShader environment, camera, simulation and visible content. This is a software GPU measurement, not hardware FPS.

## Results and correction

The earlier creature reports named a `gl.finish()` measurement “renderCompleteMs”. It mostly measured submission in this browser. The fixture now waits for a GPU fence; older numbers must not be interpreted as completed frame time.

21 creatures paired with 21 soldiers, 160 ticks / 80 rendered frames:

| milliseconds | baseline mean / p50 / p95 / max | optimized mean / p50 / p95 / max |
|---|---|---|
| Simulation | 0.864 / 0.6 / 1.5 / 8.2 | 0.824 / 0.6 / 1.4 / 8.7 |
| CPU render submission | 52.405 / 37.8 / 130 / 228.5 | 41.092 / 27.6 / 116.3 / 241.2 |
| Completed rendering | 375.645 / 322.3 / 665.7 / 1153.7 | 385.307 / 336.9 / 736.5 / 1195.8 |
| Frame incl. simulation | 376.509 / 322.8 / 667.2 / 1161.9 | 386.131 / 338.2 / 737.5 / 1204.5 |

**Capture defect discovered during subsequent visual review:** the original `fenced-before/after` recordings captured after an asynchronous yield without preserving the WebGL buffer. Their 80 PNG hashes match, but the actor canvas was cleared. These recordings are invalid as unit visual evidence. Rendering timings still include the submitted work; corrected preserved-buffer pairs are reported below when available. The separate thousand-unit benchmark already explicitly preserves its buffer and is unaffected. CPU submission improved; completed frame time did not. Cold maximum submission also did not improve. PNG/video capture and RAF pacing are excluded; GPU fence waiting includes browser task scheduling.

Frozen 1000-unit dynamic benchmark, three independent lifetimes, 4 warmups + 12 samples each (36 samples):

| variant | completed render mean ms | final main-card owned CPU bytes |
|---|---:|---:|
| baseline | 4488.68 | 32926464 |
| unconditional 48 MiB recovery | 4560.40 | 83759580 |
| adaptive recovery | 4507.89 | 32926464 |

No significant large-scene speedup. Adaptive policy releases an unprofitable cache. Learning still costs memory (peak 83062992 bytes) and CPU; it is not free. GPU-owned bytes remain 1279452480, 49 pages / 784 cards. Final baseline/adaptive screenshots are byte-identical. Simulation hash is identical (`4e4d7aa52988e06df59fca084a5b649ba0140b36322f872099676d839724e0d8`). Thirty-six samples cannot establish stable tail latency.

## Implementation and failed candidates

The expensive full Canvas read also executes deferred drawing. A one-pixel flush separated about 2104 ms drawing flush from 562 ms readback over the diagnostic run. Reusing exact rendered poses is useful only when their working set fits.

GPU-evicted raster cards are retained with lossless per-row word RLE; transparent nonzero RGB and low alpha are preserved. Recovered data is already in GPU row order. Retained budget is 48 MiB **per card-batch instance** (live and remains each have one), plus reusable compression scratch. No resolution, mip, shader, picking threshold, visibility or simulation change. Pick masks process eight alpha samples per byte; odd widths retain a general path. The isolated mask benchmark improves 62.76 to 36.06 ms with exact output.

Trace: 841 GPU misses, 434 unique keys, 407 possible reuse hits. Raw 32 MiB LRU gave 96 hits; 32 MiB RLE gave 152; 48 MiB RLE gave 406. Raw/32 MiB variants did not improve frame cost. Storing GPU-oriented pixels avoids repeated row flips. Retained small-scene recovery and scratch are approximately 48.35 MiB.

The cache measures compression/reconstruction cost against avoided paint time. After two budget turnovers, unprofitable scans clear all entries and scratch and bypass 4096 requests; repeated failures lengthen bypass up to 16384. Huge scenes therefore do not permanently pay a 48 MiB tax for ~2% reuse. This optimizes CPU raster work, not GPU rasterization, which remains the large-scene bottleneck.

## Reproduce and validation

```
node --import tsx scripts/combat-effects-proof.mjs --fixture scripts/art-creature-world-fixture.ts --out docs/art/refactor/followup/creature-performance/fenced-after.json
node --import tsx scripts/art-browser-benchmark.mjs --dynamic --final-art --reliable-completion --out docs/art/refactor/followup/creature-performance/dynamic-adaptive.json --screenshot docs/art/refactor/followup/creature-performance/dynamic-adaptive.png
node --import tsx scripts/card-context-proof.mjs --out docs/art/refactor/followup/creature-performance/context-proof.json
npx vitest run src/client/art src/client/world3d/card-raster-cache.test.ts src/client/world3d/card-pick-mask.test.ts src/client/world3d/painted-card-batches.test.ts src/client/projectile-origins.test.ts
npm run build
```

For baseline, use detached `da2ec82` and copy only the two current creature proof scripts (fence and SHA reporting) into that worktree. 18 files / 185 tests passed. Context loss/restore passed, zero pixel differences, same picking, no GL errors, cache released on loss. Dynamic lifetimes disposed all resources. Build includes TypeScript checking. JSON diagnostics retain rejected policies as evidence; redundant candidate media were removed.

Remaining: no completed-frame improvement demonstrated on this software GPU; hardware GPU profiling is needed before a production performance claim. Library media delivery remains separately blocked by hosted-tool HTTP 401; no public upload was attempted.

## Corrected preserved-buffer pair

Both worktrees use the same proof-only `preserveDrawingBuffer=true` context so yielding to the compositor cannot erase the actor canvas. Production context options are unchanged. `preserved-before.json` is da2ec82 and `preserved-after.json` is b2f74b7 (before the separate gait change). All **80 full PNG hashes match**, now with visible units, weapons and shadows. The old invalid capture media were removed; their JSON timing records remain identified above. The 1000-unit fixture always preserved its buffer.

| milliseconds | baseline mean / p50 / p95 / max | optimized mean / p50 / p95 / max |
|---|---|---|
| simulationMs | 0.80 / 0.70 / 1.50 / 6.80 | 0.97 / 0.60 / 1.50 / 16.00 |
| renderSubmitMs | 53.16 / 40.60 / 111.30 / 246.30 | 37.37 / 24.80 / 103.40 / 255.60 |
| renderCompleteMs | 383.23 / 330.80 / 688.30 / 1101.20 | 358.02 / 314.20 / 695.60 / 1031.80 |
| frameMs | 384.03 / 331.60 / 689.00 / 1108.00 | 358.99 / 314.70 / 696.60 / 1047.80 |

CPU submission improves; the completed-frame difference is small in this single 80-frame software-GPU pair, with a worse p95 but lower maximum in the optimized run. This is not evidence of a hardware FPS improvement. Use the corrected pair for current media and the completed 36-sample dynamic results for the large-scene result.
