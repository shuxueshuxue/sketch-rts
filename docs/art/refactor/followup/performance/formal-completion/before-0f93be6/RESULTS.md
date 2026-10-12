# Correctness baseline with verified GPU completion

Production source: `0f93be611ced03514194288236a0d0d08c6d0214`. Measurement tool: `9a37bfbb1464d5d6da9493857783017cfd81a569`, applied unchanged to the detached source worktree. Measured on 2026-10-11 in an exclusive browser/test window. [summary.json](summary.json) aggregates the raw reports; [source-manifest.json](source-manifest.json) records every production source file hash. This is a baseline, **not an optimization result**.

| Scene | Lifetimes × measured frames | Complete wall mean | p50 | p95 | max | CPU submission mean |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| 1000-unit dynamic replay | 3 × 12 | 9614.09 ms | 9704.50 ms | 10449.30 ms | 10457.70 ms | 693.30 ms |
| All 48 land kinds, static | 6 × 60 | 177.57 ms | 179.40 ms | 223.80 ms | 291.90 ms | 5.05 ms |
| Naval/static mixed fixture | 6 × 60 | 170.23 ms | 172.80 ms | 203.60 ms | 318.30 ms | 5.31 ms |

All **756 measured frames** signal completion successfully, and all exceed 33.3 ms. Dynamic has only 36 samples, insufficient to infer stable p99 or long-run stall rates. The current correctness-preserving software-GPU renderer still fails the practical performance goal.

## Method and limits

The unchanged 1280×720 DPR1 fixtures run in Chromium 151 / ANGLE SwiftShader on this host. Dynamic retains the real 60-tick simulation replay, 1000 initial units, unchanged camera and selection, four warmup snapshots, and measured ticks 20–31. Each static lifetime retains twelve warmup and sixty measured draws, 280 units and 24 ships. No content, resolution, filtering, mip quality or sample count was reduced. Simulation generation runs outside the timed draw; raw simulation durations remain in the replay metadata.

`--reliable-completion` inserts a WebGL2 sync object, flushes and polls `clientWaitSync(sync,0,0)` with `setTimeout(0)` yields. Complete wall includes scene/card preparation, WebGL submission and the verified completion wait. Raw wait, poll-call time, statuses and every yield interval are saved per frame. Yield intervals contain both pending GPU work and event-loop scheduling; those components cannot be separated or subtracted from this evidence. These are completion wall upper bounds, **not GPU timer-query durations, screen presentation cadence, or hardware FPS**. Static timing remains schedule-sensitive even though its actual completion cost substantially exceeds the former approximately 4 ms submission result.

Historical `gl.finish()` records remain unchanged and must not be substituted into a formal before/after comparison. Both source versions must use this exact helper and fixture hashes. The `fullDrawFenced` raw field is retained as a historical alias; `gpuCompleteWall` names the new metric explicitly. Dynamic frame intervals use requestAnimationFrame timestamps, static intervals use loop-start timestamps, so interval meaning is declared rather than conflated.

## Correctness, coverage and memory

All reports have empty errors/failures and pass model installation, interaction and lifetime resource-release checks: dynamic 36 interaction cases, all-kind 72, naval 72. The catalog is rules 2, 55 total kinds / 48 land kinds. Dynamic shows the same 967-unit final visibility and identical mode counts in all three lifetimes. Its state hash is `4e4d7aa52988e06df59fca084a5b649ba0140b36322f872099676d839724e0d8`; it differs from the earlier 9de snapshot and must match the future candidate before claiming a controlled comparison. Each lifetime observes 24 eligible blood-event IDs and 22 projectile effects, all 22 with resolved origins. Production combat/projectile paths are timed; the separate Canvas terrain/ground blood pass is not part of this WebGL benchmark.

Dynamic ends each lifetime with 47 array pages, 752 cached cards, 204,210,176 base pixels, **816,840,704 CPU backing bytes** and **1,089,120,939 estimated GPU texture bytes**, with 4577 rasterizations and 55 copied layers. All-kind static ends with 58,720,256 CPU / 78,293,675 estimated GPU array bytes; naval static with 37,748,736 / 50,331,648. These are renderer-owned texture-storage counters/estimates, not total process memory. The baseline has no scratch-mip path. Future candidate totals must include its scratch textures separately rather than compare only array bytes.

Post-cycle JS heap and all raw resource counters are retained. Browser heap includes benchmark telemetry: slower frames retain more polling intervals, so a future heap/RSS decrease cannot wholly be attributed to product memory improvement. No process-RSS time series was captured by this formal harness. Existing runner GC occurs outside the measured loop for lifetime-resource diagnostics; there is no forced GC in measured frames.

The [dynamic screenshot](webgl-dynamic.png) was visually inspected: the complete dense formation and large-unit silhouettes are present. [All-kind](webgl-all-units.png) and [naval](webgl-naval.png) screenshots are retained for exact candidate comparison; no claim of future pixel parity is made before that comparison.

Reproduce from the frozen source with the archived `art-browser-benchmark.mjs.gz` (decompress first) and `art-gpu-completion.mjs` copied into `scripts/`, then run:

```sh
node --import tsx scripts/art-browser-benchmark.mjs --dynamic --final-art --reliable-completion --out OUTPUT/webgl-dynamic.json --screenshot OUTPUT/webgl-dynamic.png
node --import tsx scripts/art-browser-benchmark.mjs --all-units --final-art --reliable-completion --out OUTPUT/webgl-all-units.json --screenshot OUTPUT/webgl-all-units.png
node --import tsx scripts/art-browser-benchmark.mjs --final-art --reliable-completion --out OUTPUT/webgl-naval.json --screenshot OUTPUT/webgl-naval.png
```

Only one command runs at a time, with other tests/builds/browsers paused. Each JSON includes exact source commit, generated fixture SHA, benchmark input SHAs, environment, per-frame values, coverage, resource checks and retained lifetime counters.

Evidence storage: [archive-integrity.json](archive-integrity.json) records hashes of the original measured JSON files and benchmark script, now also retained byte-for-byte in deterministic gzip archives. Readable JSON uses a Unicode escape solely to satisfy repository naming checks; parsed strings, every numeric value, and recorded input hashes are unchanged. Decompress the script archive before reproducing.

Scope clarification: these are representative GPU `World3DLayer.draw` timings, not whole-game frame times or complete asset-performance coverage. Dynamic exercises 48 land kinds and no ships. Both static fixtures use six ship kinds and omit `fireShip`; they clear buildings, resources, shops and obstacles. The 32 model installations validate loading, not 32 drawn assets. Independent catalog/deck visual checks cover additional assets but do not expand this timing scope. Canvas ground/terrain rendering is excluded.
