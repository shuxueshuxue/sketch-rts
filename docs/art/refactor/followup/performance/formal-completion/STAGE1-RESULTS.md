# Stage 1: complete-quality mip updates, verified completion comparison

The dirty-layer mip implementation reduces the measured dynamic GPU-world completion wall by **54.91% (2.22×)**, with unchanged simulation, effect coverage and final pixels. It still takes **4.34 seconds per sampled dynamic draw** on SwiftShader and does not meet practical performance goals. Static warm-cache timings show no broad improvement, and scratch texture storage increases owned memory slightly.

Before: `0f93be611ced03514194288236a0d0d08c6d0214`. After: `e06e047724825905815f30c79253bff72567f37d`. Both detached full-source worktrees use exactly the same benchmark, helper, fixture and runner hashes, verified by [controlled-comparison.json](after-e06e047/controlled-comparison.json). Browser version/backend, Node, viewport, quality, selection, timestamps, warmup and sample counts match. The candidate also includes UI ownership fixes; this experiment exercises the unchanged GPU-world scenarios, not UI performance.

| GPU-world scenario | Samples per version | Before mean / p95 / max | After mean / p95 / max | Mean change |
| --- | ---: | ---: | ---: | ---: |
| Dynamic, 1000 initial units | 36 across 3 lifetimes | 9614.09 / 10449.30 / 10457.70 ms | 4335.45 / 5186.50 / 5230.80 ms | −54.91% |
| All 48 land kinds, static | 360 across 6 lifetimes | 177.57 / 223.80 / 291.90 ms | 176.65 / 217.60 / 246.70 ms | −0.52% |
| Naval/static mixed fixture | 360 across 6 lifetimes | 170.23 / 203.60 / 318.30 ms | 175.52 / 213.40 / 268.10 ms | +3.11% |

Raw samples, p50, frame intervals, CPU submission, completion waits and resource counters are in [before summary](before-0f93be6/summary.json) and [after summary](after-e06e047/summary.json). All 756 measured frames in each version successfully signal completion and exceed 33.3 ms. The dynamic 36 samples are insufficient to infer stable p99 or long-run stall frequency. Small static differences overlap lifetime variation; this run does not establish a static speedup or remove the observed naval increase.

CPU submission for dynamic rises **693.30 → 2323.77 ms**, while full verified completion wall falls. The new path performs texture/mip work during scene/card preparation and can encounter driver backpressure there. Submission time is not an isolated measure of JavaScript execution; this pair does not support interpreting the rise as pure JS work or hiding it behind the total improvement. Earlier staged diagnostics independently identified full-array mip execution as the main bottleneck. Static CPU submission stays approximately 5 ms.

## What was controlled and verified

Each dynamic lifetime replays the same 60-tick simulation, with four warmup snapshots and measured ticks 20–31. Its replay hash remains `4e4d7aa52988e06df59fca084a5b649ba0140b36322f872099676d839724e0d8`. The comparator checks the complete replay descriptor after removing only measured simulation durations, every visible-count sample, all animation-mode counts, every final-art coverage field and frame, sample counts, completed sync statuses, and cache-content counters. All fifteen lifetime pairs pass.

Dynamic measured modes per lifetime remain walk 8187, cast 704, idle 2710 and attack 387. Blood/ink instance-frame exposures include air 429, body 241, speed 1498 and deck 0. Each lifetime observes 24 eligible blood IDs, of which three are newly born in the measured tick window, and 22 projectile effects with all 22 socket origins resolved. These are workload-coverage observations, not evidence that every visual feature is exercised.

Each scene's final PNG is compared as decoded 1280×720 RGBA: **zero changed pixels, maximum channel difference 0** for all three images. Screenshots are retained in the before/after directories. Exact final screenshots complement the independent candidate mip/LOD/context-recovery checks; they do not assert that every intermediate frame was pixel-diffed.

Interaction and resource-release checks pass in each version: 36 dynamic interaction cases, 72 all-kind, 72 naval, no GL errors or failed model requests. Model-installation count is a loader check, not a count of drawn assets.

## Memory and transfer accounting

Dynamic array storage is unchanged: 47 pages, 752 cards, 204,210,176 base pixels, **816,840,704 CPU backing bytes** and **1,089,120,939 estimated GPU bytes**. The candidate adds two scratch textures with **2,686,976 CPU bytes** and **3,582,620 estimated GPU bytes**, for totals **819,527,680 CPU** and **1,092,703,559 estimated GPU**. This stage provides no array-memory reduction.

Each static scenario adds one scratch texture: 262,144 CPU and 349,524 estimated GPU bytes. All new ownership counters are retained separately in the comparator. CPU backing counters and GPU storage estimates are not total-process memory. JS heaps include retained measurement telemetry; slower baseline frames collect many more polling intervals, so heap/RSS differences cannot all be counted as product memory improvement. No process-RSS time series was captured in this formal harness.

At the end of each dynamic sampled lifetime the candidate records 65 initialized pages, 4584 mip-layer updates, 45,709 mip copy calls, 1,090,519,040 array base-upload bytes and 5,127,143,424 scratch-upload bytes. These are cumulative counters through the sampled lifetime, including setup/warmup; they are **not measured-window-only bandwidth** and must not be divided by the 36 measured frames. Cold allocation still performs its initial array upload; no unmeasured allocation shortcut is assumed.

## Scope and timing limits

This is representative **GPU `World3DLayer.draw`** performance, not whole-game frame time or complete asset-performance coverage. Dynamic covers 48 land kinds and no ships. Both static fixtures use six ship kinds, omitting `fireShip`; they clear buildings, resources, shops and obstacles. Loading 32 models does not mean 32 models were drawn. Canvas terrain/ground blood is excluded. Independent complete visual catalog and deck-effect proofs cover additional content, but do not expand the scope of these timing results.

The reliable hook uses `fenceSync + flush + clientWaitSync(0)` with asynchronous timer polling. Complete wall includes CPU submission and verified-completion waiting, including scheduling and polling costs. Yield intervals combine pending GPU work and event-loop scheduling; no overhead is subtracted, and this is not pure GPU duration, display cadence or hardware FPS. The same hook runs on both versions. Historical `gl.finish()` data remain separate and are not silently replaced or used as this pair's denominator.

## Evidence and reproduction

Before and after retain JSON, screenshots, console logs, source hashes, fixture hashes, benchmark-input hashes, full coverage and resource telemetry. Exact original JSON/script bytes are stored in deterministic gzip archives, with decompressed SHA-256 in each `archive-integrity.json`. Readable JSON uses only an equivalent Unicode string escape to satisfy repository naming checks; parsed strings, all numeric samples and original input SHA claims are unchanged. The [seven naming/package checks](naming-check.log) pass after this evidence-preserving storage adjustment.

Reproduction commands and baseline environment are in [before RESULTS](before-0f93be6/RESULTS.md). Use the archived helper and decompressed benchmark script unchanged on each frozen production source. Aggregate with `summarize.mjs DIR`; verify controls with `compare.mjs BEFORE_DIR AFTER_DIR`. Run each scene serially in an exclusive test/browser window.
