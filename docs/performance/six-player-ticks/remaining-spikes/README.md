# Remaining six-player tick spikes

This followup preserves [PR #373](https://github.com/shuxueshuxue/sketch-rts/pull/373) and its [original evidence](../README.md). It narrows the investigation to the remaining planning spikes and simulation ticks 1859 and 10960. No merge or deployment is authorized.

The completed **A1 → B1 → B2 → A2** comparison shows smaller whole-tick p99 in both paired comparisons: **31.73 → 27.72 ms** and **31.50 → 28.17 ms**, reductions of **12.66%** and **10.59%**. The average of the two whole-tick means is **3.9175 → 3.6861 ms**, a **5.91%** reduction. Complete native command bytes and the final checksum remain identical. **The maximum ≤50 ms and p99 ≤16 ms targets remain unmet:** the candidate still has 7/9 ticks above 50 ms, and its worst observed tick is **99.19 ms**. This comparison does not establish an isolated benefit for each optimization, statistical significance, memory reduction or rendering improvement.

**Validation status:** focused tests, strict type checking, production build and all 7 post-archive source/docs boundary tests pass. The full suite passes 6,795 tests and retains the same four documented baseline navigation failures. The archive verifies 186 new captures, all nine complete long-run command logs/checksums and the 125 protected original files.

## Investigation boundary

The original final run contained 19 planning ticks above 50 ms and two nonplanning simulation spikes: tick 1859 at 53.13 ms and tick 10960 at 62.05 ms. Whole-match ship-route totals cannot identify the cause of those individual stalls.

Selected original spike ticks, using the tick number **before** application:

```text
0,1859,5280,6990,7560,8850,9000,9375,9900,10065,10860,10960,
11085,11265,12480,12705,12885,12945,13500,13905,13920
```

The source baseline is `086dffc5ae9e895f38e56f5ddedfa2ab0d7ac86d`. Focused diagnostics measure the actual synchronous simulation phases and AI script callbacks in selected windows, while preserving function identity, argument evaluation, return values and exceptions. Diagnostic runs remain separate from timed comparisons. CPU samples require verified clock anchors before they can support per-tick attribution. Garbage-collection entry overlap is diagnostic evidence and is not an exclusive CPU-cost measurement.

The original scoped/CPU probe is committed as `2c782d3`; optional terrain-cache key counters are added in `ad3cbd4`. The first two attribution runs use scopes without cache-key counters. A later source-stage diagnostic uses a frozen copy of the original scoped probe. Counter-enabled runs provide cache-key and work-count evidence; their extra instrumentation can materially disturb timing, so they cannot establish performance gains. The final unprofiled comparison must use the same probe with all optional focused diagnostics disabled for both sources.

## Focused attribution

Two full 14,400-tick diagnostic runs use the same frozen baseline and produce complete command-frame bytes identical to the original step-3 run, plus checksum `7d94a5e8`. [Run 1](capture/focused-before-086-run1/summary.json) records scopes, garbage-collection entries and five CPU windows; [run 2](capture/focused-before-086-run2/summary.json) records scopes and garbage-collection entries without CPU profiling. The CPU windows cover ticks 1858–1860, 5279–5281, 6989–6991, 10959–10961 and 12704–12706. All five profile start/end timestamps were verified and independently rechecked against the `process.hrtime` call brackets. Sample alignment uses the raw per-tick clock anchors. [Complete two-run attribution](analyses/six-player-spike-focused-two-run-comparison.json).

The selected ticks show several distinct causes. Costs below are diagnostic measurements in milliseconds, and nested inclusive scopes overlap; they must not be added together.

| Tick | Repeated scoped observation, run 1 / run 2 | Focused CPU evidence | Consequence for this change |
| --- | --- | --- | --- |
| 1859 | Two transports are born. `updateTraining` 24.28 / 25.01; `updateUnits` 22.80 / 17.18; simulation total 51.17 / 45.73 | `shipLaunchPose` → `harborPoses` → `hullFits` → `clearOutline`, including polygon projection work, plus ship steering | Remove unused shoreline SAT projections while retaining the exact hull/cell test. This tick is not explained by a whole-match route total. |
| 5280 | `player-6` naval script triggers `tilesOf` rebuilding, 51.09 / 46.49 | `growBoxInto` / `growBox` / `linkSector`, with region/island labeling, under `canReach` | Hoist repeated box-boundary work while retaining the same terrain expansion order. |
| 6990 | `player-6` economy script takes 80.41 / 84.19 | Exact distance-field expansion under `chooseNavalMine`; repeated `shoreSpot` scans under `islandPlan` | Reuse the already requested landing distance field and identical component shore answers within one invocation. |
| 10960 | A new incomplete farm appears. `updateUnits` 34.18 / 24.73 includes `tilesOf` 12.60 / 14.27 and ship steering. `syncBuildingBodies` is only 1.59 / 1.49. Simulation total 34.92 / 25.34 | Terrain box expansion under worker movement and ship corridor/steering work | Apply the same terrain and exact shoreline changes. The building update alone does not account for this tick. The original 62.05 ms value is not reproduced in these two diagnostics. |
| 12705 | `enemy` economy script takes 26.73 / 25.46 | `shoreSpot` / `gapOf` and exact distance-field expansion under `chooseNavalMine` | Remove repeated equivalent queries, preserving selection and policy memory. |

Garbage-collection entries overlap some selected ticks and some new outliers; this association is retained rather than treated as exclusive GC CPU time. The diagnostic runs have 26 and 19 whole ticks above 50 ms, and the set of outliers moves between runs. These counts are evidence of remaining variability, not a before/after result. Outside the chosen windows, only coarse timing and GC association are available; the report does not assign an exact internal cause to those new stalls.

Separate cache-key diagnostics corroborate the repeated-query mechanism. At tick 6990, two sea distance expansions under `chooseNavalMine` miss their cache, with recorded keys `14040` and `14962`; tick 12705 has one such miss with key `78136`. `shoreSpot` makes repeated land-field queries with hits, including keys `96852` and `96672`, without corresponding misses. Repeated cached calls and candidate scans remain work even when they do not build a new field. The completed candidate has **2 → 0** `chooseNavalMine` misses at 6990 and **1 → 0** at 12705. Repeated `shoreSpot` land-field hit counts fall **96,852 → 8,071** and **96,672 → 8,056**. [Baseline counter capture](capture/cache-before-086/focused-diagnostics.json.gz) · [candidate counter capture](capture/cache-candidate-09e/focused-diagnostics.json.gz). These are work-count comparisons; the counter-enabled wall times are substantially disturbed and are excluded from the performance table.

The complete [run-1 analysis](analyses/six-player-spike-focused-analysis-run1.json), [run-2 analysis](analyses/six-player-spike-focused-analysis-run2.json), [intermediate three-change analysis](analyses/six-player-spike-focused-analysis-stage3.json) and original [diagnostics](capture/focused-before-086-run1/focused-diagnostics.json.gz) retain the scopes, CPU clock anchors, stack samples and garbage-collection entries. The analyses are captured from their original files rather than reconstructed from this summary.

## Exact change and equivalence

Four narrow changes address the observed work:

1. **`a7c2cf4`: complete shoreline SAT projections only as needed.** `polygonTouchesCellForPolygon` evaluates the same hull-edge projections in their original order and stops on the same first separating edge. The existing per-polygon projection state retains independently completed minimum/maximum prefixes; subsequent cells and full-plane callers resume that exact state. The change keeps the existing epsilon, cell iteration, hull geometry and boolean contact result. It does not change ship clearance or collision rules.
2. **`7a4e8b8`: reuse the exact landing distance field.** `nearestByRoute` has already queried the candidate landing as the target. The following score query uses that same target direction rather than building the reversed field. This uses the unweighted symmetric 5/7-step `walkingDistance` query; it is not an assumption about pace-weighted travel cost. Candidate origin selection, threat computation, stable sorting and returned object identity remain unchanged.
3. **`ded19d3`: compute terrain box boundary masks once per expanded cell.** `growBoxInto` removes the same out-of-box directions using a mask and a precomputed local-offset array. It retains the direction order, relaxation comparison, integer costs, corner permission checks, heap/queue order and output arrays. No terrain revision or invalidation policy changes.
4. **`09e4d3c`: reuse identical water coasts within one island candidate scan.** `islandPlan` keeps one `shoreSpot` answer, including an undefined answer, per connected water component during that synchronous invocation. Each candidate still runs the existing eligibility and walkability checks, and retains its own `coastOnWater` departure query. The complete plan, policy memory, retry timing and eligibility callback order remain unchanged. Answers are discarded after the invocation; they do not persist across owners, snapshots or ticks.

AI planning phase, ship rules, checksum frequency, simulation rules and test assertions remain unchanged. No behavior change has been selected. Any later proposal with different behavior requires a separate user decision before implementation.

## Interleaved comparison

The recorded order is **A1 → B1 → B2 → A2**, where A is frozen baseline `086dffc5ae9e895f38e56f5ddedfa2ab0d7ac86d` and B is complete four-change candidate `09e4d3c22577e590647556785d469ebff8c581b1`. Every run contains 14,400 ticks and disables CPU profiling, focused scopes, cache-key counters and GC observation. Both sources use the same probe SHA-256 `c4feb5e7d63fdbd343362754e5cb1960b765a7265ad9a04b820869f9f725f9dc`, scenario and stable host environment. Each frozen source is unchanged during capture. The [complete comparison](analyses/six-player-spike-abba-analysis.json) recomputes distributions from all ticks and verifies source inputs, tick phase, entity counts, full command bytes and final checksums; all comparison checks pass.

All timing values below are milliseconds. Quantiles use nearest rank. Cold startup and outliers remain included; no sampled tick is removed.

| Recorded order / source | Median | p95 | p99 | Maximum | Mean | Whole ticks >50 ms |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| [A1 baseline](capture/abba-A1-before/summary.json) | 1.895 | 17.756 | 31.734 | 88.498 | 3.902 | 25 |
| [B1 candidate](capture/abba-B1-candidate/summary.json) | 1.854 | 16.587 | 27.715 | 76.487 | 3.672 | 7 |
| [B2 candidate](capture/abba-B2-candidate/summary.json) | 1.856 | 16.399 | 28.167 | 99.188 | 3.701 | 9 |
| [A2 baseline](capture/abba-A2-before/summary.json) | 1.918 | 17.330 | 31.502 | 98.821 | 3.933 | 20 |

The A1/B1 and A2/B2 p99 reductions are **12.664%** and **10.588%**. The arithmetic average of the two run means falls **5.906%**. These are observed repeated contrasts for the combined candidate; two runs per group do not establish statistical significance or a universal speedup. Averaging run statistics does not create a pooled p99 or maximum.

Whole-tick performance includes simulation and due AI planning. `wholeMs` excludes the separately timed render snapshot, command serialization/hash observer and disk output. `simMs` measures the actual simulation step; `aiMs` measures the actual AI runtime and overlaps its own snapshot. Every run has exactly 960 planning ticks, all at `tick % 15 == 0`, with all five owners due together; the remaining 13,440 ticks have no owner plans.

| Run | Simulation mean / p99 | AI mean, all ticks | Whole planning mean / p99 | Planning whole >50 ms | Nonplanning whole >50 ms |
| --- | ---: | ---: | ---: | ---: | ---: |
| A1 | 2.841 / 19.634 | 1.040 | 19.895 / 56.278 | 23 | 2 |
| B1 | 2.736 / 18.589 | 0.916 | 17.782 / 46.149 | 5 | 2 |
| B2 | 2.755 / 18.828 | 0.926 | 17.957 / 43.027 | 7 | 2 |
| A2 | 2.879 / 19.995 | 1.033 | 19.788 / 55.895 | 18 | 2 |

All four runs still have two **whole nonplanning** ticks above 50 ms. B2 has only one simulation sample strictly above 50 ms: at tick 1859 its whole update is **50.0065 ms** while simulation is **49.9868 ms**. The boundary distinction remains visible rather than rounding that simulation sample into a second >50 ms event.

The selected ticks also show practical limits to the improvement:

| Tick before apply | A1 whole | B1 whole | B2 whole | A2 whole |
| --- | ---: | ---: | ---: | ---: |
| 1859 | 45.30 | 43.07 | 50.01 | 46.86 |
| 5280 | 62.47 | 70.88 | 70.02 | 73.91 |
| 6990 | 88.50 | 66.43 | 74.61 | 97.06 |
| 10960 | 23.83 | 21.20 | 21.43 | 23.43 |
| 12705 | 55.65 | 33.92 | 31.18 | 49.68 |

Tick 6990 improves in both contrasts but remains above 50 ms. Tick 5280 is slower in B1 than A1 and faster in B2 than A2; no reliable isolated benefit is claimed there. The two original nonplanning spikes are not eliminated: 1859 remains near the limit, and the original 62.05 ms simulation at 10960 does not recur in these unprofiled baselines either.

The worst candidate sample is B2 **tick 2088**, a nonplanning simulation event: whole **99.1884 ms**, simulation **99.1795 ms**. The same tick is **12.45 / 14.17 / 12.92 ms** in A1/B1/A2. These four timing runs contain no GC or internal phase observation, so that stall's cause is **unresolved**; it cannot be attributed to GC from timing alone. [All original selected ticks and every new >50 ms row](analyses/six-player-spike-abba-analysis.json) remain in the complete analysis.

The separately timed `currentSnapshot` means are **0.2136 / 0.2136 / 0.2138 / 0.2168 ms** in recorded order; observer means are **0.00749 / 0.00731 / 0.00764 / 0.00757 ms**. These are snapshot/measurement costs, not renderer frame times. RSS and heap samples remain in each summary and analysis; GC phase was not standardized and allocations were not counted, so **no memory reduction is established**. This headless Node scenario does not measure rendering or browser FPS.

The maximum ≤50 ms and p99 ≤16 ms goals remain unmet. The result supports retaining the exact optimizations and documents the remaining stalls without changing AI phase, ship behavior, checksum cadence or assertions.

## Complete native-frame and state oracle

All **nine completed full runs** in this followup retain **14,400 native frames**, final checksum `7d94a5e8`, and complete native command-log SHA-256 `771222bde4c8d2c0a46a97313563ad2b5de1d52ed92fb2d3c70511ff2276c997`. Their decompressed native frame **bytes**, including empty frames, room ID, tick, sequence and command ordering, match the original step-3 oracle. This includes the two baseline scope runs, baseline/candidate cache-count runs, intermediate three-change scoped/CPU run and four unprofiled ABBA runs. Failed setup directories remain captured but do not count as completed runs. A short smoke establishes complete-prefix equality only and does not establish the full-match checksum.

Native command captures: [A1](capture/abba-A1-before/command-frames.jsonl.gz), [B1](capture/abba-B1-candidate/command-frames.jsonl.gz), [B2](capture/abba-B2-candidate/command-frames.jsonl.gz), [A2](capture/abba-A2-before/command-frames.jsonl.gz). Execution identities and complete input hashes are in each run's `environment.json`; [the comparison](analyses/six-player-spike-abba-analysis.json) retains and validates those inputs against the original baseline.

## Validation and unresolved issues

Completed targeted validation:

- Terrain equivalence: **34 tests pass**, including the new old/new terrain expansion comparison and related public navigation coverage.
- Shoreline projection equivalence: **4 tests pass**, including rotated fleet hulls, swept hulls, convex padding, partial/full projection-cache interleaving and unchanged inputs.
- Naval mine distance reuse: **16 tests pass** across the new four-case suite and the existing 12-case suite. The independent shortest-path oracle checks **35,110** point pairs, both directions, blocked corners, disconnected seas, terrain-free finite coordinates and strict candidate/identity/tie equivalence.
- Per-invocation coast reuse: **13 tests pass**. A complete captured pre-change `islandPlan` function supplies the control; assertions compare exact result bytes, complete policy memory and eligibility callback order. Twelve same-sea candidates make 12 → 1 shore calls; a two-sea fixture makes 12 → 2. The tests cover failed answers, blocked shores, retry/known/sailing plans, depleted/ineligible resources, later invocations, owner/context changes and new terrain identities. These are work-count reductions in fixtures, not yet a measured whole-game gain.
- Strict TypeScript checking passes after the implementation and coast tests.

The first mine equivalence attempt has two failures caused by the test fixture requesting nonexistent unit kind `wolf`; replacing that fixture kind with existing `wildling` allows setup to run while retaining the assertions. This is an identified test-fixture defect, not a weakened navigation requirement. Its failed output is preserved alongside the successful rerun.

Two probe execution attempts also failed before usable tick attribution: the sparse-source attempt left a partial entry capture, and the first copied-tool attempt lacked the Node module type declaration. Preserve their original directories and logs and classify them as setup/tool failures, not as tick-performance evidence. In particular, `/workspace/six-player-focused-full.log` must remain in the final archive.

The full suite completed in **408.22 seconds: 623 files pass, 3 fail; 6,795 tests pass, 4 fail (6,799 total)**. The [raw full-suite output](logs/six-player-spike-full-tests.log.gz) and [failure attribution](analyses/six-player-spike-test-attribution.json) retain the exact cases and messages. All four failures match the published original failures and its a052 baseline reproduction; the three failing test files retain their complete original hashes. They are unresolved navigation acceptance behavior, with no new full-suite failures. This does not establish that the tests are incorrect. No assertion was reduced.

The [production build](logs/six-player-spike-build-production.log.gz) passes, including strict TypeScript, Vite and the server bundle. All **7 source/docs naming boundary tests pass after evidence capture**; the [completed raw log](logs/six-player-spike-final-boundaries.log.gz) is added as an explicit post-archive validation capture without replacing earlier captures. The diagnostic tool's initial strict check also failed because it read nonexistent `route.replans/goal` fields; correcting those diagnostic reads to actual `goalX/goalY` passed. Its failed and successful raw logs are retained. One earlier, nonredirected tool test attempt has no complete raw log or final exit result; later captured 7-test and final 9-test runs provide the recorded tool validation. The persistent 31-tick smoke is an intermediate tool version, as its actual archived source hashes state.

## Archive and independent verification

The complete execution [command journal](capture/command-journal.json) retains attempted runs and their recorded outcomes. The frozen [current probe](tools/current/six-player-tick-probe.ts) and [original scoped/CPU probe](tools/profile-original/six-player-tick-probe.ts), including their corresponding instrumentation helpers, retain the actual tooling used. Failed setup outputs remain alongside completed captures.

[`archive-evidence.py`](archive-evidence.py) accepts a final explicit JSON plan. Each `capturedDirectories` entry has an absolute `source` and a relative `destination`; it copies every file recursively and records both closed file sets. `capturedFiles` adds explicitly named logs or analysis files. An optional `addedGzip` flag controls compression for an added file. The default adds deterministic gzip to `runtime.mjs` and `.log` files; existing `.gz` files are copied without recompression. The archive refuses existing outputs.

```json
{
  "schema": 1,
  "capturedDirectories": [
    {
      "source": "/workspace/six-player-spike-runs",
      "destination": "capture"
    }
  ],
  "capturedFiles": []
}
```

After all runs and logs are closed, archive and verify from the repository root:

```sh
python3 docs/performance/six-player-ticks/remaining-spikes/archive-evidence.py archive --plan /workspace/six-player-followup-final-archive-plan.json
python3 docs/performance/six-player-ticks/remaining-spikes/archive-evidence.py verify
```

The new manifest records captured, stored, restored and decompressed-payload byte counts and full SHA-256 digests, execution-source identities and input-byte validation, plus native command equality. Verification independently rereads every stored asset and restores added gzip. It also verifies the original README, original manifest and all 123 original captured assets against their published hashes. The original evidence subtree remains unchanged.

Post-archive validation logs use `append-file --source CLOSED_LOG --destination logs/NAME.log`. This verifies the existing archive first, adds only the new byte-preserving capture, records its purpose and original hash, and verifies the whole archive again. Previous assets and the original evidence are preserved.

## Reproduce the analysis and comparison

These scripts only read recorded evidence; they do not execute the game. Use fresh output filenames to retain the original analyses:

```sh
python3 docs/performance/six-player-ticks/remaining-spikes/analyses/analyze-six-player-focused-spikes.py docs/performance/six-player-ticks/remaining-spikes/capture/focused-before-086-run1 /tmp/six-player-focused-run1-reproduced.json --original-dir docs/performance/six-player-ticks/runs/step3-border
python3 docs/performance/six-player-ticks/remaining-spikes/analyses/analyze-six-player-spike-abba.py docs/performance/six-player-ticks/remaining-spikes/capture/abba-A1-before docs/performance/six-player-ticks/remaining-spikes/capture/abba-B1-candidate docs/performance/six-player-ticks/remaining-spikes/capture/abba-B2-candidate docs/performance/six-player-ticks/remaining-spikes/capture/abba-A2-before --original-dir docs/performance/six-player-ticks/runs/step3-border --output /tmp/six-player-abba-reproduced.json
```

The [focused-run analysis script](analyses/analyze-six-player-focused-spikes.py), [two-run comparison script](analyses/compare-six-player-focused-spikes.py) and [ABBA analysis script](analyses/analyze-six-player-spike-abba.py) retain the actual analysis logic. Paths in reproduced output may differ; numeric evidence, native bytes, input hashes and comparison verdicts must agree.

For new timing measurements, use clean detached baseline/candidate worktrees and the same frozen current probe. The repository's Node dependencies must be installed before execution. Keep the four runs sequential in the stated order, with fresh output directories and optional diagnostics disabled:

```sh
git worktree add --detach /tmp/sketch-spike-before 086dffc5ae9e895f38e56f5ddedfa2ab0d7ac86d
git worktree add --detach /tmp/sketch-spike-candidate 09e4d3c22577e590647556785d469ebff8c581b1
ln -s "$PWD/node_modules" /tmp/sketch-spike-before/node_modules
ln -s "$PWD/node_modules" /tmp/sketch-spike-candidate/node_modules
npx tsx docs/performance/six-player-ticks/remaining-spikes/tools/current/six-player-tick-probe.ts --source /tmp/sketch-spike-before --ticks 14400 --out /tmp/sketch-spike-A1
npx tsx docs/performance/six-player-ticks/remaining-spikes/tools/current/six-player-tick-probe.ts --source /tmp/sketch-spike-candidate --ticks 14400 --out /tmp/sketch-spike-B1
npx tsx docs/performance/six-player-ticks/remaining-spikes/tools/current/six-player-tick-probe.ts --source /tmp/sketch-spike-candidate --ticks 14400 --out /tmp/sketch-spike-B2
npx tsx docs/performance/six-player-ticks/remaining-spikes/tools/current/six-player-tick-probe.ts --source /tmp/sketch-spike-before --ticks 14400 --out /tmp/sketch-spike-A2
```

For tick attribution, use the frozen original scoped probe and preserve its diagnostic separation. For example, add `--focus-ticks 1859,5280,6990,10960,12705 --focus-radius 1 --cpu-prof-windows 1858:1860,5279:5281,6989:6991,10959:10961,12704:12706 --observe-gc` against the baseline, with a fresh output path. Profiling may alter timings; revalidate clock anchors and native frames before interpreting the samples.
