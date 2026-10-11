# Final rules-2 presentation cost

**Timing qualification (follow-up):** the historical WebGL `gl.finish()` samples below record submission plus driver backpressure; they do not independently establish complete GPU execution. Sync-object diagnostics on frozen 9de move seconds into the completion tail. Original values are retained. See [completion and stage evidence](../followup/performance/UPLOAD-EXPERIMENTS.md). No revised formal speedup is claimed.

WebGL production source `277e1e138576d52066280e912b7b96cb8847ad12`, measured 2026-10-11 in an exclusive load window. Complete Canvas subsequently compares benchmark-only `08af824` with cache-only production fix `7cd11ac`; the GPU path is unchanged by that fix. [summary.json](summary.json) aggregates the initial raw files; [canvas-reuse-comparison.json](canvas-reuse-comparison.json) records the complete Canvas pair. **This is an independent final-version cost record, not a speedup comparison with rules 1.** The final catalog contains 55 unit kinds / 48 land kinds; rules version is 2, with changed simulation outcomes, directional poses and connected combat/projectile presentation.

The 1000-unit software-GPU scene still fails the practical performance goal: mean rendering is approximately **5.02 seconds**, not milliseconds. Resource and interaction correctness pass, but do not establish acceptable performance.

## Method and validation

Same host and browser as the earlier measurements: Linux, Node v24.19.0, Chrome/151.0.7922.173, ANGLE SwiftShader software GPU, 1280×720 DPR1. All frame/camera/selection/simulation generation parameters are unchanged. Dynamic uses 1000 initial units, real 60-tick simulation replay, four warmup snapshots and twelve measured snapshots per lifetime, three lifetimes. Static groups use six lifetimes and sixty measured frames each after twelve warmup draws.

The explicit `--final-art` flag connects actual `CombatPresentationTracker` and `ProjectileOriginTracker`. Their production updates and GPU ink rendering execute inside timed `World3DLayer.draw`. Event/count telemetry is collected after the fenced timing sample. Replay hash is `4dc532be9be1cf4cb5a208258580538844af281f834a4965a7ddb43c936b493e`; it intentionally differs from rules 1. No cross-rules comparator was run.

All three browser reports validate resource release and interactions: dynamic 36 cases, all-kind and naval 72 each. Each of 32 model assets installs once; errors are empty. All cycles identify the expected source commit, rules 2 and 55/48 catalog counts. Explicit release succeeds despite the fixture retaining disposed-layer references.

## Browser rendering

Times are milliseconds, with CPU scene update/submission and `gl.finish` completion included. Dynamic simulation precomputation is recorded separately and excluded. SwiftShader results are not hardware FPS. No stable p99 claim is supported by the 36 dynamic samples.

| Scenario | Samples | Mean | p50 | p95 | Max | >16.67 / >33.33 ms |
| --- | --- | --- | --- | --- | --- | --- |
| All land kinds, fixed snapshot | 360 | 4.124 | 3.700 | 6.800 | 13.400 | 0 / 0 |
| Naval, fixed snapshot | 360 | 4.075 | 3.600 | 6.300 | 24.000 | 1 / 0 |
| Dynamic 1000 | 36 | 5017.969 | 5216.900 | 5601.800 | 5745.400 | 36 / 36 |

Dynamic rAF intervals: mean 4979.1 ms, p95 5616.4 ms, max 5733.2 ms (33 intervals). Three independent render means are 4947.0, 5057.5 and 5049.4 ms. Lowest visible-center count is 967 in each cycle; each has walk 8187, cast 704, idle 2710 and attack 387 unit-frame observations. These are deliberately dense mixed armies, including giant creatures and siege machines, not a typical gameplay view.

Final dynamic renderer statistics: 107 calls, 6794 triangles, 53 texture objects, 71 geometries. Painted cards use 49 pages / 772 cards / 127926272 allocated page texels, with 511705088 CPU texture bytes and estimated 682273451 GPU bytes including mipmaps; 4756 cumulative rasterizations and 64 copied layers. Texture estimates exclude driver/scratch/other renderer storage. The working set remains approximately ten times the 12 Mi-texel soft budget. There are no per-frame hit/eviction counters in this run.

## Actual combat coverage

In each dynamic lifetime, the measured snapshots contain 24 unique blood-eligible effect IDs, with 21 observed in warmup and 3 born inside the measured tick window. There are 77 blood-event snapshot occurrences. The same events replay in all cycles, so unique counts must **not** be summed across cycles.

GPU combat ink has 2168 instance-frame observations: air 429, body 241, speed 1498, deck 0. Peak total is 274, with air 126, body 21 and speed 128; capacity peaks at 512 instances / 43008 bytes. Each measured frame submits one combat-ink draw, no overflow. These are instances, not measured visible fragments or allocation counts. Deck blood is **not exercised** by this land battle. Static scenarios produce no combat effects, despite having the same production trackers connected.

All 22 unique projectile effects resolve their actual launch socket in the dynamic sample. Missing socket handling exists but is not exercised here. The GPU fixture does not time the separate Canvas terrain/ground-blood pass; its timing is explicitly null, along with JS allocation bytes, projectile-cache bytes and pre-warmup historical residue. History starts at tick 16, so old expired blood events cannot be reconstructed by this fixture.

## Canvas base-path record

`canvas.json` retains the unchanged original sampler, which passes no combat/projectile tracker. It measures final directional unit drawing but **excludes the new Canvas blood/projectile presentation paths**. Do not use it as the full final Canvas cost. The separately recorded opt-in results below complete that coverage without overwriting this record.

For this base record, cold 600-frame render mean is 4.811 ms. The 1800 warmed samples average 3.264 ms, p50 0.877, p95 12.559, max 37.399; 34 samples exceed 16.67 ms and one exceeds 33.33 ms. Whole CPU frame mean is 3.384 ms. Cache ends at 512 entries / 12562676 pixels / 50250704 bytes, with 60452 hits, 1852 misses and 1340 evictions. End process RSS is **2285469696 bytes**, sampled without forced GC; it must not be hidden behind the much smaller cache-byte estimate. Native allocator behavior and allocation turnover need investigation before interpreting this as retained leakage.

## Complete Canvas and resource-reuse comparison

Raw complete-path runs: [before reuse](canvas-complete-before-reuse/canvas.json), source `08af8246d96729abe734f7ba0e210dffdf017271` (benchmark-only change from 277e1e1), and [after reuse](canvas-complete-after-reuse/canvas.json), source `7cd11ac1c4f9f38e0e662f9707fa05a93b6cd9eb` (Canvas raster cache and its tests only). Both run the same `--final-art` four 600-frame real cavalry matches, same headless Canvas backend/environment, without forced GC. Complete drawWorld timing includes tracker updates and ground/body/air passes; a separate ground-only cost is unavailable and remains null.

Every run has identical simulation hashes and **identical entire per-frame presentation coverage objects**. Each observes all 400 simulation ticks 0–399, 57 unique eligible blood effects, and 42 projectile effects with 42 origins resolved. Ground records peak at 227 and are active in 414/600 frames; body peaks at 12, droplets at 57 and speed lines at 54. Ground instance-frame exposure is 60077. These are presentation records before viewport culling, not visible fragments. Diagnostic collection occurs outside the timed interval, but its retained data contributes to RSS.

Decoded RGBA pixels are identical for all five 1280×720 screenshots at frames 0, 150, 300, 450 and 599: zero changed channels, zero maximum difference. Hashes are recorded in the comparison JSON. This exact parity applies to this Canvas resource-reuse change, not earlier CPU/GPU antialiasing or GPU mipmap comparisons.

| Complete Canvas warmed render / 1800 samples | Before reuse | After reuse |
| --- | --- | --- |
| Mean / p50 / p95 / max, ms | 4.043 / 2.010 / 13.741 / 70.228 | 4.076 / 2.021 / 13.849 / 41.547 |
| >16.67 / >33.33 ms | 39 / 2 | 42 / 2 |
| Whole CPU frame mean, ms | 4.157 | 4.202 |
| First/cold run render mean, ms | 5.256 | 5.444 |

No CPU speedup is demonstrated. The lower observed maximum does not outweigh the similar distributions or prove long-tail elimination.

End-of-run RSS across four matches is **920 → 1408 → 1900 → 2430 MB before**, versus **923 → 1240 → 1515 → 1916 MB after** (decimal MB, no forced GC). Final measured RSS falls 21.2%, but **continues to grow substantially**; the total-memory problem is only partially mitigated, not resolved. These are separate processes and four matches, not a long-term steady-state proof or precise live-allocation census.

The after cache reports a stable `ownedCanvasBytes` of 53084088: entries 50250704, four scratch canvases 2183168, and eight spare canvases 650216 bytes. Leased/retired canvases are zero at each run boundary. Entries/hits/misses/evictions are unchanged: final 512 / 60452 / 1852 / 1340. This bounded tracked ownership is distinct from the approximately 1.92GB process RSS; native allocator/backend retention still needs investigation.

Cumulative scratch factory requests decrease from 1854 to 1749 and requested RGBA bytes from 167287652 to 158032680. Those counters omit backing-store resizing/internal allocation and are neither retained memory nor total allocation bytes. JS allocation bytes remain unavailable.

An independent [explicit-GC diagnostic](diagnostic-gc/gc-diagnostic.json) at the same 7cd11ac source runs the complete four matches first, then calls `global.gc()` twice with `setImmediate` between observations. Original run/result arrays remain referenced and used after GC (four runs / 2400 render samples), and cache ownership remains live. RSS is 1922396160 bytes before GC, 1836941312 after the first GC, and unchanged after the second; heap used falls 74876688 → 33315016 bytes and external memory 36881696 → 4901707 bytes. Tracked Canvas ownership remains 53084088 bytes. This does **not** show that a simple delayed V8 collection explains the large RSS. Nor does RSS alone identify strong-reference leakage: native allocator/backend retention and unreturned pages remain possibilities. No forced-GC delta is counted as product improvement; official no-GC runs are unchanged. The [reproducer](diagnostic-gc/reproduce.mjs) defaults to a separate `work/` output.

A subsequent [event-loop lifecycle diagnostic](diagnostic-yield/comparison.json) uses the same production source, four matches and full presentation path, but adds `await setImmediate` every 20 frames **after** timing, telemetry and screenshots. It performs no forced GC. RSS becomes **584859648 → 635723776 → 650022912 → 659484672 bytes**, versus the formal synchronous 923217920 → 1239642112 → 1514868736 → 1916043264 bytes. Every simulation checkpoint, entire per-frame presentation coverage object and all five decoded RGBA images match exactly; owned Canvas bytes remain 53084088. This strongly supports a contribution from event-loop-dependent headless/native cleanup or scheduling to the synchronous fixture's high RSS. It does not identify a specific allocator mechanism or prove browser leakage/absence of leakage. RSS still rises across these four runs, so long-term plateau is unproven. CPU sample times exclude the yields and **are not wall-frame times or product speedup evidence**. Formal results remain unchanged; the [reproducer](diagnostic-yield/reproduce.mjs) defaults to separate `work/` output.

## Visual scope and outstanding work

The final dynamic screenshot was inspected: mixed silhouettes, equipment and directional poses render, but giant-unit overlap and edge clipping make this a workload proof rather than a composition acceptance scene. Parent-thread gameplay and direction/contact proofs cover different visual requirements. Earlier backend/mipmap pixel-parity limitations remain independent evidence, not invalidated by this resource pass.

Outstanding performance issues are dynamic seconds-long frames and a large card working set, plus Canvas cold-pose churn. Formal synchronous headless RSS remains high; the independent yield diagnostic shows a substantial lifecycle effect, so it must not be presented as confirmed browser leakage. Long-session memory behavior, physical GPU behavior and driver memory remain unmeasured. Complete Canvas combat coverage is measured above, but no counter claims a standalone ground-blood timing.
