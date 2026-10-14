# Enemy multi-source shore-distance experiment: rejected

This is a measurement-only experiment against the complete `shoreSpot` function at `0f31f16c32e9a8050180c4da9d993eb7bf86cad0`. No production source, AI memory, rules, timing phase or checksum cadence was changed. The candidate is rejected: its first multi-field construction adds cost to the relevant existing-warm state, and its steady-state benefit is small and inconsistent between the two real inputs.

The actual native 14,400-tick capture is `/workspace/six-player-structural-runs/shore-actual-0f31`. Its command log remains SHA-256 `771222bde4c8d2c0a46a97313563ad2b5de1d52ed92fb2d3c70511ff2276c997` and final checksum `7d94a5e8`. The two captured calls are tick 6990 / player-6 and tick 12705 / enemy, both `despiteGuns=true`. Their original coarse full-function timings are 2.4216 ms and 1.8954 ms. These diagnostic timings are not replaced by the isolated results below.

A executes the original entire function. B changes only the fixed enemy hall group's `gapOf` scalar minimum into a lazy multi-source field. The own single hall retains the original `.map`/spread expression and `walkingDistance` queries. All guards and candidate ordering remain intact. B uses the actual private `grow` from an ephemeral source bundle; it does not approximate the graph. Owned field buffers are outside the original 128-entry cache/recycling pool, and no multi-source `next` array selects a route. Source-set fields persist only in the scratch module's measured contexts; this is not a proposed production API or cache policy.

Each execution uses five ABBA groups for each real input and each cache state. Every slot gets an independent game-module runtime. Entire-function timings exclude build/load, assertions, input/result serialization and output. Diagnostic query counters use separate bundles; measured bundles contain no per-query counter or timer. There is no forced GC. GC and scheduling can therefore appear in the retained outliers.

| State | Preparation |
| --- | --- |
| All cold | First complete call in a fresh runtime, including native terrain, shoreline and single-field work. |
| Old fields warm, multi cold | Original function prewarms that same runtime once; B's new multi field is absent on the timed call. This isolates the relevant startup cost without comparing it to a cold original cache. |
| All warm | Original and candidate prewarm outside the timer; forty complete calls are timed per slot. |

Two independent executions retain **120 trials and 1,680 measured calls each**, with complete samples and all five group distributions. All measured and counting invocations return the same complete point bytes, and their snapshot, teams and options bytes remain unchanged. Both source HEAD and all bundled original source bytes are checked again after execution. Type checking passes. The first execution and its original source/bundle bytes remain intact.

Median full-function milliseconds:

| Run | Tick | All cold A / B | Old warm, new multi cold A / B | All warm A / B |
| --- | ---: | ---: | ---: | ---: |
| 1 | 6990 | 13.0151 / 15.2211 | 1.7695 / 2.6841 | 1.2487 / 1.2490 |
| 1 | 12705 | 10.8298 / 9.9970 | 1.6495 / 2.0384 | 1.2790 / 1.2729 |
| 2 | 6990 | 11.2875 / 13.3856 | 1.5451 / 2.8737 | 1.2698 / 1.2608 |
| 2 | 12705 | 9.7034 / 10.5011 | 1.4873 / 2.1512 | 1.2839 / 1.2878 |

Steady-state means at tick 6990 change 1.3182 → 1.2985 ms and 1.3451 → 1.3353 ms; at tick 12705 they worsen 1.3447 → 1.3538 ms and 1.3796 → 1.4203 ms. These tiny, mixed differences do not justify a new persistent field/cache. Entirely cold results are noisy and mixed, and are not evidence for a live warm-cache gain. No full AI matrix or further full match was needed to reject this bounded candidate.

## Counter-boundary correction

The original live count of **7,946** is not the total number of `shoreSpots` or `walkingDistance` entries. There are **10,430 shore candidates**, of which **2,484 centers are not land-walkable** and return from `walkingDistance` before `exactField`. A shoreline footprint may span land and water while its center is over water.

Separate `counts-boundaries` instrumentation proves the exact denominator:

| Tick | A walkingDistance entries | Original guard early returns | A exactField calls | Warm A grows | B exactField calls | B multi queries / first builds |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| 6990 | 10,555 | 2,484 | 8,071 | 0 | 7,946 | 25 / 1 |
| 12705 | 10,540 | 2,484 | 8,056 | 0 | 7,946 | 22 / 1 |

These exactField counts match the native capture. The initial entry-count mismatch did **not** establish changed terrain or stale cache state; that suspected cause is withdrawn. No terrain-cache reconstruction or invalidation rule was changed. JSON replay still reconstructs independent runtimes rather than preserving the native engine's complete earlier cache history; the cold/warm preparations and denominator limits remain explicit.

## Evidence

- `run1/summary.json`, `run2/summary.json`: complete per-state, per-group distributions, environment, source/head/input/tool hashes, counting diagnostics and complete result bytes.
- `run1/trials.json.gz`, `run2/trials.json.gz`: every raw full-function sample.
- `counts-boundaries/summary.json`: additional exactField/early-return boundary proof, without supplying timing evidence.
- `closure-verification.json`: both executed script-version hashes, identical 129-file original source inputs, byte-identical timed shore/multi-helper bodies, and exact counter-denominator tuples. Version 2 only adds counting diagnostics, unused metadata facts and a counts-only option; the measured function logic is unchanged.
- Every run keeps the exact four executed bundles, transformed naval/terrain input bytes, complete original source input capture/manifest, actual two input records, and executed experiment source.
- `first-run.log`, `second-run.log`, `counts-boundaries-first.log`, `typecheck-first.log`, `typecheck-final.log` retain original output. No execution or type-check failure occurred.
- Each run's `closed-manifest.json` lists every file except the manifest itself, with full SHA-256 and byte counts. The outer evidence manifest also includes these inner manifests. The `node_modules` dependency link is excluded.

Reproduction uses the archived experiment source plus the pinned independent source worktree and actual input archive. Pass a fresh output directory:

```sh
node --import tsx shore-experiment.ts /workspace/new-shore-comparison
```

This experiment measures two isolated native Node function inputs. It is not a browser/frame benchmark, and does not establish that the 50 ms maximum / 16 ms p99 match target has been met.
