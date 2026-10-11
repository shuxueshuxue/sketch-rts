# Frozen art refactor measurements

Measured 2026-10-11. Before: `9819046b3820c9f843f0d57beaa198e7970fd5a7`; after: `78ee99a06a6e9522bcd567f9c9ea6c941024679b`. These results precede the separately authorized unit/rule consolidation. Commands and exact sampling definitions are in [MEASUREMENT.md](MEASUREMENT.md); machine-readable comparison and all raw samples are in [comparison.json](comparison.json), [before](before/), and [after](after/).

**This version does not meet the large dynamic scene performance goal.** Draw-call batching works, but dynamic card generation remains extremely expensive. The all-land-kind fixed-snapshot scene also has a reproducible new long frame. Do not describe these results as an overall performance or total-memory improvement.

## Environment and controls

- Linux 6.18.44, AMD EPYC 9V74, 5 exposed logical CPUs; Node v24.19.0.
- Chrome/151.0.7922.173, headless Chromium with `--use-gl=angle --use-angle=swiftshader`, 1280 × 720, DPR 1. This is a **software GPU**, not representative hardware FPS. The original tool records the selected backend and browser version, not the unmasked GL device string.
- Other lanes paused tests, builds and browser workloads throughout the final before/after measurement window. Source remained frozen. No content/resolution reduction was used to improve the after result.
- Canvas simulation hashes match for every recorded checkpoint in all four runs. Dynamic browser replay uses the same 60 real simulation snapshots; SHA-256 is `b3502ce7386cd905707585dd73af5cc3f68a8d07d3d68f391db6fc0fd95afc59` on both versions. Every measured dynamic visible-center count matches: 985, 985, 983, 982, 981, 978, 977, 975, 975, 975, 972, 971.
- Dynamic animation modes differ because the new presentation tracker changes action duration/event classification: each cycle's unit-frame counts are walk 7518 → 7518, cast 872 → 642, attack 516 → 403, idle 3082 → 3425. This compares the **whole presentation implementation under identical simulation input**, not identical poses and not GPU batching in isolation.
- Fixed-snapshot browser scenarios still advance presentation timestamps; they are not fixed-pose microbenchmarks. Warmup uses time zero. New idle poses can therefore introduce later cache misses.

## Timings

All values below are milliseconds. Browser draw timing includes scene updates, submission and `gl.finish`; submission is also separately retained in JSON. Simulation generation is excluded from browser draws and reported separately in each replay's `simulationValuesMs` array. Canvas frame includes simulation, snapshot creation and rendering; it is CPU work, not browser presentation cadence.

| Scenario / samples | Before mean / p50 / p95 / max | After mean / p50 / p95 / max | Mean change |
| --- | --- | --- | --- |
| Canvas cavalry, warmed rendering / 1800 | 0.714 / 0.722 / 0.959 / 5.762 | 0.733 / 0.736 / 0.998 / 6.035 | +2.6% |
| Canvas cavalry, warmed whole CPU frame / 1800 | 0.798 / 0.795 / 1.117 / 5.868 | 0.820 / 0.811 / 1.124 / 6.055 | +2.7% |
| Naval 280, fixed snapshot / 360 | 3.544 / 3.300 / 4.800 / 13.200 | 3.794 / 3.200 / 6.500 / 41.100 | +7.1% |
| All land kinds 280, fixed snapshot / 360 | 4.670 / 4.200 / 7.200 / 12.900 | 44.437 / 3.500 / 7.000 / 2490.300 | +851.6% |
| Dynamic 1000, real snapshot replay / 36 | 14200.769 / 14300.900 / 16814.400 / 17355.100 | 12741.058 / 12689.200 / 14214.800 / 14414.100 | −10.3% |

Canvas warm simulation means are 0.0621 → 0.0609 ms; snapshot means 0.0216 → 0.0257 ms. The dynamic scene's 60 precomputed simulation ticks average 15.313 → 14.235 ms (max 28.4 → 26.1 ms), far below the per-draw rendering stalls; these one-off generation timings do not demonstrate a simulation optimization. The first, cold 600-frame Canvas run has mean rendering 1.477 → 2.570 ms; it is excluded from warmed statistics and retained in the raw report. This is a whole cold run, not one cold-frame cost.

The all-land-kind after spike occurs at **sample index 46 in every one of six cycles**, ranging 2327.9–2490.3 ms. Seven of 360 after samples exceed 16.67 ms and six exceed 33.33 ms; before has none. Naval after has two samples above 16.67 ms, one above 33.33 ms; before has none. Both dynamic versions exceed both limits in all 36 samples. Dynamic requestAnimationFrame intervals average 14070.6 → 12711.6 ms (33 intervals), confirming the stalls extend to browser frame delivery. Dynamic submission means 14200.625 → 12741.033 ms are almost the full fenced cost; the cost is already inside the CPU draw/submission path, including any synchronous readbacks it triggers.

Dynamic uses only 12 samples × 3 independent layer lifetimes after four warmup snapshots (ticks 16–19), measuring ticks 20–31. **36 samples do not support stable p99 inference.** The JSON's mechanical percentile field should not be presented as such. Earlier long-loop CDP timeouts are excluded diagnostics under `work/art-refactor/dynamic-*-timeout.json`; shortening the measured interval did not reduce scene size, visible content or quality.

## Submission and memory diagnostics

These are the final measured frame in each cycle, identical across cycles. Texture count is an object count, not bytes.

| Scenario | Calls before → after | Triangles before → after | Textures before → after |
| --- | --- | --- | --- |
| Naval | 89 → 59 | 62892 → 62892 | 29 → 14 |
| All land kinds | 307 → 73 | 62776 → 62892 | 167 → 21 |
| Dynamic | 1250 → 98 | 6556 → 6556 | 624 → 47 |

Dynamic after card diagnostics: 43 pages, 688 resident cards, 180355072 allocated page texels, 721420288 CPU texture-storage bytes and estimated 961893718 GPU bytes including mipmaps; 5021 cumulative rasterizations and zero copied layers. The allocated page texels exceed the 12 × 1024 × 1024 soft budget by 14.3× because current-frame visible cards are preserved. This is a concrete working-set problem, not evidence that fewer texture objects means less memory. `gpuBytes` is a storage estimate, not measured driver allocation. `rasterizations` is generated card count, not GPU upload-call count.

Only end-of-window cumulative card statistics were captured; **there are no per-frame rasterization, hit or eviction counters in this dataset**, and the old implementation did not expose comparable card byte statistics. Repeated regeneration or readback is a hypothesis requiring a controlled fixed-pose follow-up, not a conclusion isolated by these results.

Canvas cumulative scratch requests decrease from 46465024 to 28383880 RGBA bytes (−38.9%), while allocation count increases from 133 to 269. After retained Canvas cache: 267 entries, 6768290 pixels / 27073160 bytes, 62037 hits, 267 misses, zero evictions. Scratch requests are cumulative requested pixel storage, not process/native memory or retained peak. Actual end-of-run process RSS is **408330240 → 636690432 bytes**, sampled without forced GC. Therefore total-memory reduction is not demonstrated.

Dynamic JS heap after forced GC at the final cycle is 42308844 → 42402148 bytes. The tool intentionally retains disposed layer references and all 60 simulation snapshots to verify explicit release; this is not standalone renderer heap. Native canvas, GPU and driver storage are not included in JS heap.

## Validation and visual evidence

`art-compare.mjs` exits successfully after checking runtime/viewport, scene, Canvas checkpoint hashes, dynamic replay hash and resource validation. All browser groups have no recorded shader/GL/network exceptions and pass interaction/resource release checks: 36 cases for dynamic, 72 each for the other groups; each of 32 GLB resources requests/installs once per run. Resource disposal checks pass despite retained disposed-layer references.

Both [before/catalog/inventory.json](before/catalog/inventory.json) and [after/catalog/inventory.json](after/catalog/inventory.json) cover 57 unit cards, 57 corpse variants, 14 building cards, 17 inventory items, unit/building portraits, and five modes × six frames × 57 units = 1710 animation frames. These are actual catalogue painter outputs, not substitute drawings. Ship cards are the 2D catalogue path; native 3D ship geometry is exercised in browser fixtures. Building cards are the buildable catalogue, not a claim to cover every campaign/environment prop.

Reviewed after [units](after/catalog/units.png), [corpses](after/catalog/corpses.png), [buildings](after/catalog/buildings.png), [items](after/catalog/items.png), [attack sheet](after/catalog/animation-attack.png), and [dynamic WebGL](after/webgl-dynamic.png). They retain the muted angular painted style and visibly render the catalog families. The pressure screenshot deliberately packs giant creatures and siege machines together; edge clipping and dense occlusion make it a workload proof, not a normal gameplay-composition acceptance image. Contact-sheet overview is not sufficient to certify every hand/weapon contact or every facing. Real gameplay/equipment screenshots and event/contact videos supplied by the other lanes complement these fixtures.

Outstanding: eliminate the repeatable fixed-snapshot long frame; reduce dynamic card-generation/readback cost and working-set storage without removing visible content; collect controlled identical-pose readback/cache diagnostics and hardware-GPU evidence. Keep this frozen comparison intact when recording subsequent optimizations.
