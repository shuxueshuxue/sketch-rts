# Final controlled GPU-world performance and memory results

At unchanged measured scene content and final pixels, the final renderer reduces the 1000-unit dynamic GPU-world completion wall from **9.61 s to 3.99 s (58.48%, 2.41×)**. Relative to the dirty-mip stage alone, it is **7.92% lower**. Persistent CPU card buffers drop from **819.53 MB to 28.22 MB** including scratch storage, with final recorded typed-array peak **32.31 MB** and Canvas backing reported separately. **The practical large-scene performance goal remains unmet:** every measured complete-world draw still exceeds 33.3 ms. Static warm-cache scenarios remain near their original cost, and GPU array storage is unchanged.

Sources are fixed: correctness baseline `0f93be611ced03514194288236a0d0d08c6d0214`, dirty-mip stage `e06e047724825905815f30c79253bff72567f37d`, final GPU-only array/streaming/mask stage **`7b8186e668398f7869e27e47eeba626f7af2b1ac`**. The measured final source is qualified by that exact commit, not by later branch HEADs. All three use the same five benchmark/helper/fixture/runner input hashes and identical source-qualified protocol.

## Measured performance

| GPU-world scenario | Samples per source | Baseline mean | Mip-stage mean | Final mean | Final p50 / p95 / max |
| --- | ---: | ---: | ---: | ---: | ---: |
| Dynamic, 1000 initial units | 36 / 3 lifetimes | 9614.09 ms | 4335.45 ms | **3991.90 ms** | 4069.10 / 4745.30 / 4875.50 ms |
| All 48 land kinds, static | 360 / 6 lifetimes | 177.57 ms | 176.65 ms | **177.37 ms** | 177.50 / 217.80 / 236.70 ms |
| Naval/static mixed fixture | 360 / 6 lifetimes | 170.23 ms | 175.52 ms | **170.44 ms** | 170.70 / 210.60 / 268.80 ms |

Each source has 756 successful measured GPU completion signals; **all 756 exceed 33.3 ms and 16.7 ms**. Dynamic has only 36 samples, so no stable p99 or long-run stall-rate claim is supported. Static results vary within and across lifetimes; the final values are effectively near baseline rather than evidence of a broad static speedup.

Final mean CPU submission is **1990.86 ms dynamic**, **5.16 ms all-kind**, **5.25 ms naval**. Submission includes GL calls and driver backpressure, not just JavaScript execution. It rises from baseline dynamic 693.30 ms while verified complete wall falls; the GPU transfer work has moved into preparation and can block there. It falls from the mip-stage dynamic 2323.77 ms. These fields must not be interpreted as isolated CPU algorithm benchmarks or used to obscure remaining total cost.

Final dynamic requestAnimationFrame start intervals (33 intervals) have mean **3962.98 ms**, p95 **4749.90 ms**, max **4883.20 ms**. Each interval spans adjacent measured starts; the final draw in each lifetime has no following sampled interval, so interval mean need not equal draw mean. Static loop-start intervals are independently recorded: means **177.52 ms** and **170.49 ms**, respectively. They are not display presentation intervals. Raw values and all distributions remain in [final summary](after-7b8186e/summary.json) and its three source JSON files.

Simulation is explicitly excluded from timed rendering. The real 60-tick replay is generated once and reused by all three dynamic lifetimes; there is no AI planner. The 60 `stepGame` calls total **836.40 ms baseline**, **839.30 ms mip stage**, **787.30 ms final** (means 13.94 / 13.99 / 13.12 ms). Final p95 is 21.70 ms, maximum 27.70 ms. Those measurements exclude command issuance and snapshot serialization; they are not repeated three times in the count and do not establish a simulation improvement, since simulation input/output is unchanged. Do not add them to each replay-render sample or claim whole-game frame time from this benchmark.

## Exact controls and visual equivalence

Both automated comparisons pass: [final versus baseline](after-7b8186e/controlled-vs-0f93be6.json), [final versus mip stage](after-7b8186e/controlled-vs-e06e047.json). Checks include environment, all five tool input hashes, generated fixture hashes, lifetime/sample counts, complete replay descriptors excluding only simulation timing values, every visible-count value, mode counts, complete per-frame/final combat and projectile coverage, card content counters, and successful sync statuses.

Dynamic state hash is identical at `4e4d7aa52988e06df59fca084a5b649ba0140b36322f872099676d839724e0d8`; each lifetime preserves 967 final-visible units and modes walk 8187 / cast 704 / idle 2710 / attack 387. It observes 24 blood-event IDs with three newly born in the measured window, and 22 projectile effects with all socket origins resolved. Blood/ink exposure is air 429 / body 241 / speed 1498 / deck 0. Replay lifetimes observe the same events; unique IDs are not summed across cycles.

All three final screenshots match both earlier sources as decoded 1280×720 RGBA: **0 changed pixels, maximum channel difference 0**. This verifies final sampled images, not every intermediate frame. Independent strict LOD/mip/picking/context-recovery proofs validate additional renderer properties outside this timing experiment.

Per source, interaction/resource tests pass for 36 dynamic, 72 all-kind, and 72 naval cases. No GL errors, context loss or failed requests occur, and explicit lifetime resources release correctly. Raw result JSON retains all validation, model-installation and resource counters.

## Owned memory, transient peaks and GPU storage

The final dynamic cache retains the same **47 pages / 752 cards / 204,210,176 array base pixels**, with 4577 rasterizations and 55 compacted layers. Its CPU array RGBA copies are now **zero**. Exact end-of-sampling owned counters are:

| Dynamic CPU storage component | Bytes |
| --- | ---: |
| Picking masks | 25,526,272 |
| Row staging buffer | 2,560 |
| Scratch texture upload buffers | 2,686,976 |
| Total counted owned CPU buffers | **28,215,808** |
| Recorded peak owned CPU buffers | **32,311,808** |
| Maximum one pending RGBA readback | **1,638,400** |
| Canvas backing (separate) | **2,949,120** |

Both pending RGBA and pending-mask counters are zero at the sample endpoint. Peak pending RGBA is part of peak owned CPU, not an additional simultaneous allocation to add again. Canvas backing is excluded from that owned-typed-array counter and is reported separately. The final persistent CPU buffer count is **96.55% lower than the original baseline counted CPU array buffers (816,840,704 bytes)**, and **96.56% lower than mip-stage arrays plus scratch (819,527,680 bytes)**. These are counted renderer-owned buffers; they exclude object overhead, unrelated caches and unreachable allocations awaiting browser reclamation. They do **not** establish a 96.56% browser RSS reduction or total-memory guarantee.

GPU dimensions and precision stay unchanged. Dynamic array estimate remains **1,089,120,939 bytes**, exactly matching both earlier stages. Final exact allocated array mip bytes are **1,089,119,360**; scratch mip storage adds **3,582,620**, yielding **1,092,701,980 exact owned GPU bytes** at the endpoint. The previous estimate includes rounding, so do not mistake the 1579-byte estimate/exact distinction for a real GPU saving.

Recorded owned GPU peak is **1,302,415,900 bytes**. The largest temporarily retiring source set is **209,713,920 bytes**; during compaction these sources remain in the page list alongside destinations, so they are **already included** in the corresponding owned peak. Do not add the two peaks. End-of-sample retired bytes are zero. Earlier versions did not record equivalent transient peaks, so this does not support a comparative peak-GPU improvement claim. Large GPU memory remains a constraint.

Final all-kind static owns 2,065,408 CPU bytes (peak 2,327,552) and 78,642,900 exact GPU bytes; naval owns 1,336,320 CPU bytes (peak 1,598,464) and 50,680,980 exact GPU bytes. Each has 262,144 separate Canvas backing bytes. All counters, including masks, scratch, pending buffers and peaks, are retained in the comparators.

Dynamic cumulative transfer counters through setup/warmup and sampling include **0 array base-upload bytes**, 5,115,674,624 scratch-upload bytes, 4577 mip-layer updates, 45,639 mip-copy calls and 550 GPU compaction-copy calls across 55 moved layers. These are not measured-window-only bandwidth; do not divide them by the 36 samples. Shader-visible contents are unchanged despite removal of persistent CPU RGBA arrays, as exact pixels and picking proofs establish.

Browser heap is retained only as an instrumentation-inclusive resource diagnostic. Slower runs retain more polling intervals; JS heap/RSS differences cannot all be attributed to the product. There is no process-RSS time series or JS-allocation count in this formal harness. Existing runner GC is outside measured frames, for lifecycle checks, and is not presented as a product improvement.

## Scope and remaining limits

This measures representative **GPU `World3DLayer.draw`** work, not complete game frames or all-asset performance. Dynamic exercises 48 land kinds and no ships; static fixtures use six ship kinds and omit `fireShip`. Fixtures clear buildings, resources, shops and obstacles. Loading 32 model files validates loading, not 32 drawn assets. Canvas terrain/ground blood, simulation scheduling, AI and UI rendering are excluded. Separate complete visual catalog and deck proofs cover other content but do not enlarge this performance scope.

The reliable hook uses `fenceSync + flush + clientWaitSync(0)` with timer polling. Wall time includes verified completion, CPU submission, poll calls and event-loop scheduling. Recorded yielded intervals mix pending GPU work with scheduling; no overhead is subtracted. These are completion wall upper bounds, not pure GPU timer-query durations or hardware FPS. Chromium/ANGLE SwiftShader results must not be extrapolated to physical GPUs without new measurements. Historical `gl.finish()` reports remain separate and are not used as this final comparison's denominator.

The final renderer is meaningfully faster and uses far less owned CPU buffer storage at identical measured quality, but **approximately four seconds for a dynamic world draw, approximately 170–177 ms for warm static worlds, and over 1 GB of dynamic GPU texture storage remain unresolved limitations**.

## Evidence and reproduction

The final directory contains raw readable JSON, original-byte gzip archives, PNGs, console logs, full source manifest, helper and compressed exact benchmark script, summary and both controlled comparisons. `archive-integrity.json` and the shared `archive-audit.json` verify decompressed original SHA-256 values and semantic identity of readable JSON. Unicode escaping changes only a naming-sensitive string's spelling, not its parsed value, measured numbers or input hash claims. The final [naming/package checks](after-7b8186e/naming-check.log) pass 7/7.

Use the same commands in [baseline RESULTS](before-0f93be6/RESULTS.md) on each fixed source, decompressing the archived script first and preserving all helper/fixture hashes. Run each group serially with other tests/builds/browsers paused. `summarize.mjs` aggregates; `compare.mjs BEFORE AFTER OUTPUT_NAME` checks controls and decoded screenshots. Source code was not changed during any measured run.
