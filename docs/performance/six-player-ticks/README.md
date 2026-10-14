# Six-player tick performance, exact-semantics changes

The controlled six-seat static solo run reproduces large AI-planning spikes. After steps 1–3, whole-tick maximum fell from **447.66 to 91.87 ms**, p99 from **46.19 to 30.53 ms**, and ticks over 50 ms from **120 to 21**. All 14,400 native command frames are byte-identical in every stage, with the same final checksum. **The requested maximum ≤50 ms and p99 ≤16 ms were not achieved.** Planning still runs for all five owners together every 15 ticks.

Most of the observed improvement arrives in step 1. The single sequential runs for steps 2 and 3 do not demonstrate a stable additional whole-game speedup: step-1/2/3 whole-tick p99 values are 30.57/30.93/30.53 ms and means 3.79/3.84/3.78 ms. Scope-safe reuse and border traversal remove repeated work, but their isolated macro effect is below the resolution of this comparison. No browser FPS, rendering speedup, or memory reduction is claimed.

## Scenario and measurement boundary

- Source baseline: `a0524c2c9b32d4b92084d4f9478729eb562f7d29` (PR #372 production source).
- Room ID: `six-player-perf-512`; map: `sapphireArchipelago`; one idle human and five V9 AI seats; rules version 2 and checksum version 18.
- Human `player` is grove. In seat order: `enemy` grove/v9_archer, `enemy2` ember/v9_archer, `player-4` grove/v9_knight, `player-5` ember/v9_summoner, `player-6` grove/v9_knight.
- Actual initial state: **48 units and 6 buildings**. The first minute ends with 63 units and 21 buildings; the final state has 109 units and 51 buildings, with no winner. The supplied report omitted its room ID and race configuration and called 63/21 its start. That may reflect its minute-zero end sample, but this evidence does not establish that these are the same original match.
- Execution: `StaticSoloDeploymentRuntime.createRoom` / `startRoom` → `LocalGameAdapter.updateToRenderTime` → `CommandFrameRuntime.tick`, driven by 50 ms of clock advance for each of 14,400 calls. `currentSnapshot()` is called exactly once after each tick.
- `wholeMs` times the adapter update. It excludes the separately measured `currentSnapshot`, command serialization/hash observer, and disk output. `frameMs` times the native frame runtime; `simMs` times `stepGame`; `aiMs` times `planPresetAiRuntimeCommands`, including its shared snapshot and every due owner. Per-owner timings wrap the actual owner planner.
- `aiSnapshotMs` and `otherSnapshotMs` are overlapping diagnostic subsets, not additive costs; `otherSnapshotMs` includes the separately timed render snapshot. This is a Node headless execution of the real adapter path, **without actual rendering or a browser frame loop**.
- Hooks are inserted at four function boundaries in an ephemeral esbuild bundle. Original game sources are retained and checked before/after execution. A separate unmodified-source run checks hook transparency. Percentiles use nearest rank; cold startup and isolated spikes remain in the report.

Host: Node `v24.19.0`, V8 `13.6.233.17-node.51`, esbuild `0.28.0`, TypeScript `5.9.3`, Linux `6.18.44`, AMD EPYC 9V74. The OS exposed five CPUs and 18,882,699,264 bytes of memory. These are single sequential runs in one environment; process scheduling, JIT and garbage collection affect tail observations. Every run records its exact environment, executed bundle, probe, source inputs and hashes.

## Commits and complete evidence

| Stage | Source commit | Summary | Environment |
| --- | --- | --- | --- |
| Baseline a0524c2 | `a0524c2c9b32d4b92084d4f9478729eb562f7d29` | [baseline-a052 summary](runs/baseline-a052/summary.json) | [environment](runs/baseline-a052/environment.json) |
| Step 1: distance first | `2f0942076365ba5a28fac816a5d79b288587563a` | [step1-distance summary](runs/step1-distance/summary.json) | [environment](runs/step1-distance/environment.json) |
| Step 2: readiness reuse | `c37d897a7aeb3d1b9997b79ebb278b64432b609a` | [step2-readiness summary](runs/step2-readiness/summary.json) | [environment](runs/step2-readiness/environment.json) |
| Step 3: border rings | `32ff4e96ebabe5461e28ac540fc13d0134077c77` | [step3-border summary](runs/step3-border/summary.json) | [environment](runs/step3-border/environment.json) |

Step 0 is `8609c8c9a0cfce99e1fbdf892036d26f6c52b969`: adds the repeatable probe and npm entry point without production behavior changes. The baseline above runs that probe against the detached a0524c2 source.

Each run directory preserves `room.json`, the complete initial snapshot, all command frames, every tick sample, source inputs, exact executed bundle and entry, probe source, report, summary and environment. Storage compression is byte-preserving; `runtime.mjs.gz` restores the exact original `runtime.mjs` bytes. The [closed evidence manifest](evidence-manifest.json) records original/stored/payload byte counts and full SHA-256 digests, exact file sets, source-input checks, independent restore comparisons, and full native-command equality for all six long runs. The 123 captured files occupy 18,655,302 stored bytes versus 36,872,026 original capture bytes. Compression saves evidence storage, not game memory or tick time.

## Tick distributions

All values are milliseconds. AI values in this table include all 14,400 ticks, including 13,440 ticks without planning. Planning-only rows contain 960 ticks.

| Stage | Component | Median | p95 | p99 | Maximum | Mean | >50 ms ticks |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Baseline a0524c2 | Whole adapter tick | 1.84 | 17.74 | 46.19 | 447.66 | 4.56 | 120 |
| Baseline a0524c2 | Simulation step | 1.76 | 9.27 | 18.28 | 44.61 | 2.72 | 0 |
| Baseline a0524c2 | AI runtime, all ticks | 0.00 | 8.83 | 39.89 | 438.87 | 1.82 | 103 |
| Baseline a0524c2 | Render snapshot, separate | 0.22 | 0.37 | 0.51 | 5.70 | 0.20 | 0 |
| Baseline a0524c2 | Whole planning tick only | 22.36 | 88.01 | 277.99 | 447.66 | 31.38 | 120 |
| Step 1: distance first | Whole adapter tick | 1.88 | 16.85 | 30.57 | 109.17 | 3.79 | 22 |
| Step 1: distance first | Simulation step | 1.80 | 9.21 | 18.93 | 63.34 | 2.76 | 2 |
| Step 1: distance first | AI runtime, all ticks | 0.00 | 8.28 | 21.61 | 103.97 | 1.02 | 7 |
| Step 1: distance first | Render snapshot, separate | 0.23 | 0.39 | 0.54 | 9.13 | 0.22 | 0 |
| Step 1: distance first | Whole planning tick only | 18.33 | 43.69 | 54.48 | 109.17 | 19.34 | 20 |
| Step 2: readiness reuse | Whole adapter tick | 1.89 | 17.07 | 30.93 | 97.25 | 3.84 | 24 |
| Step 2: readiness reuse | Simulation step | 1.81 | 9.48 | 19.68 | 51.42 | 2.80 | 3 |
| Step 2: readiness reuse | AI runtime, all ticks | 0.00 | 9.10 | 22.16 | 93.70 | 1.02 | 4 |
| Step 2: readiness reuse | Render snapshot, separate | 0.24 | 0.39 | 0.53 | 6.25 | 0.22 | 0 |
| Step 2: readiness reuse | Whole planning tick only | 18.48 | 42.70 | 57.20 | 97.25 | 19.53 | 21 |
| Step 3: border rings | Whole adapter tick | 1.85 | 16.89 | 30.53 | 91.87 | 3.78 | 21 |
| Step 3: border rings | Simulation step | 1.78 | 9.22 | 18.67 | 62.05 | 2.74 | 2 |
| Step 3: border rings | AI runtime, all ticks | 0.00 | 9.22 | 21.23 | 88.11 | 1.01 | 6 |
| Step 3: border rings | Render snapshot, separate | 0.23 | 0.37 | 0.50 | 12.77 | 0.21 | 0 |
| Step 3: border rings | Whole planning tick only | 18.53 | 42.64 | 55.41 | 91.87 | 19.38 | 19 |

All stages have exactly 960 planning ticks, each at `tick % 15 == 0`, each running all five owners. All 25 baseline worst ticks align with this cadence; 22 of the final 25 do. The final run still has 19 planning ticks above 50 ms plus two nonplanning simulation ticks above 50 ms. Cadence-aligned stalls have been reduced, not eliminated.

## Per-owner planning

Each owner has 960 planner samples per stage. Only baseline and final are expanded here; intermediate stages remain in their complete summaries.

| Stage | Owner / preset | Median | p95 | p99 | Maximum | Mean |
| --- | --- | ---: | ---: | ---: | ---: | ---: |
| Baseline a0524c2 | enemy / v9_archer | 2.55 | 7.97 | 53.61 | 417.74 | 4.80 |
| Baseline a0524c2 | enemy2 / v9_archer | 2.60 | 50.33 | 208.55 | 383.43 | 12.57 |
| Baseline a0524c2 | player-4 / v9_knight | 3.40 | 7.39 | 23.28 | 27.35 | 3.62 |
| Baseline a0524c2 | player-5 / v9_summoner | 2.50 | 8.63 | 21.07 | 29.57 | 3.31 |
| Baseline a0524c2 | player-6 / v9_knight | 1.88 | 6.89 | 12.57 | 74.87 | 2.85 |
| Step 3: border rings | enemy / v9_archer | 2.33 | 6.78 | 24.52 | 54.87 | 3.07 |
| Step 3: border rings | enemy2 / v9_archer | 2.02 | 5.61 | 27.18 | 31.25 | 2.72 |
| Step 3: border rings | player-4 / v9_knight | 3.09 | 7.40 | 22.13 | 27.08 | 3.43 |
| Step 3: border rings | player-5 / v9_summoner | 2.21 | 7.71 | 21.75 | 29.21 | 2.90 |
| Step 3: border rings | player-6 / v9_knight | 1.75 | 6.88 | 13.66 | 79.00 | 2.86 |

## Growth over the match

Each row covers 1,200 ticks, starting at minute ×1,200. Population is measured at the end of that minute and is identical in all stages.

| Minute | End units / buildings | Whole mean before → after | Planning mean before → after | Whole max before → after | >50 ms before → after |
| --- | --- | ---: | ---: | ---: | ---: |
| 0 | 63 / 21 | 0.75 → 0.84 | 7.80 → 8.52 | 88.02 → 91.87 | 1 → 1 |
| 1 | 70 / 23 | 1.35 → 1.38 | 6.38 → 6.72 | 43.47 → 53.15 | 0 → 1 |
| 2 | 73 / 23 | 1.91 → 1.83 | 9.89 → 9.38 | 66.44 → 39.20 | 1 → 0 |
| 3 | 80 / 28 | 2.59 → 2.63 | 12.83 → 12.78 | 34.24 → 37.54 | 0 → 0 |
| 4 | 84 / 28 | 3.32 → 3.19 | 21.18 → 18.67 | 186.49 → 73.20 | 2 → 1 |
| 5 | 91 / 32 | 5.89 → 4.97 | 36.98 → 21.77 | 348.58 → 91.68 | 10 → 1 |
| 6 | 93 / 36 | 5.64 → 4.77 | 36.43 → 22.36 | 246.78 → 52.59 | 9 → 1 |
| 7 | 94 / 38 | 6.05 → 5.01 | 43.12 → 26.92 | 223.82 → 50.91 | 18 → 3 |
| 8 | 99 / 40 | 5.40 → 5.25 | 28.56 → 26.29 | 59.49 → 56.37 | 3 → 2 |
| 9 | 106 / 43 | 6.49 → 4.29 | 56.52 → 23.86 | 447.66 → 64.42 | 19 → 4 |
| 10 | 109 / 46 | 8.13 → 5.27 | 70.60 → 27.85 | 384.93 → 61.85 | 44 → 4 |
| 11 | 109 / 51 | 7.21 → 5.89 | 46.23 → 27.49 | 415.17 → 62.87 | 13 → 3 |

## Worst-tick evidence

These are the five highest whole-tick samples in each end of the comparison; each summary retains all 25 with owner timings, and `ticks.json.gz` retains every tick.

| Stage | Tick before apply | mod 15 | Whole | Simulation | AI |
| --- | ---: | ---: | ---: | ---: | ---: |
| Baseline a0524c2 | 11085 | 0 | 447.66 | 5.02 | 438.87 |
| Baseline a0524c2 | 13530 | 0 | 415.17 | 9.57 | 403.48 |
| Baseline a0524c2 | 13125 | 0 | 384.93 | 2.55 | 380.99 |
| Baseline a0524c2 | 6930 | 0 | 348.58 | 6.43 | 341.99 |
| Baseline a0524c2 | 6855 | 0 | 336.72 | 4.45 | 332.17 |
| Step 3: border rings | 0 | 0 | 91.87 | 8.59 | 80.06 |
| Step 3: border rings | 6990 | 0 | 91.68 | 3.57 | 88.11 |
| Step 3: border rings | 5280 | 0 | 73.20 | 2.17 | 71.01 |
| Step 3: border rings | 10860 | 0 | 64.42 | 5.49 | 58.08 |
| Step 3: border rings | 13500 | 0 | 62.87 | 22.69 | 39.67 |

## Memory observations

These are **process samples**, including the probe, source bundle, timing arrays, command-log observer and output generation. They are not allocations per tick or browser memory measurements. Garbage collection is not forced and the values are not measured at an equal GC phase; a smaller `heapUsed` must not be interpreted as a memory improvement.

| Stage | RSS before → after, MiB | heapUsed before → after, MiB | external before → after, MiB |
| --- | ---: | ---: | ---: |
| Baseline a0524c2 | 249.88 → 931.98 | 67.12 → 78.40 | 91.57 → 321.32 |
| Step 1: distance first | 266.12 → 929.79 | 84.56 → 79.36 | 95.36 → 320.95 |
| Step 2: readiness reuse | 250.75 → 1221.38 | 55.50 → 80.19 | 90.85 → 320.96 |
| Step 3: border rings | 241.92 → 1199.75 | 61.93 → 196.48 | 90.47 → 320.95 |

Per-minute RSS/heap/external/ArrayBuffer observations are retained in every `summary.json`; per-tick samples carry their memory observations where collected. No memory or GC benefit is established by this run.

## Independent CPU profiles

Two additional full 14,400-tick runs capture Node’s built-in inspector samples over ticks **0–14,400**. They retain all native frames and the same checksum/log bytes as the unprofiled runs. Sampling has overhead, so these are diagnostic runs and do not replace the four timing comparisons above. The attachment sampled only ticks 12,000–13,500; its 45.8% `reachableTarget` self share is not directly comparable to this full-match share.

- [Baseline captured run](profiles/baseline-profile/summary.json) · [profile bytes](profiles/baseline-profile/cpu-profile.cpuprofile.gz) · [environment](profiles/baseline-profile/environment.json).
- [Final captured run](profiles/final-profile/summary.json) · [profile bytes](profiles/final-profile/cpu-profile.cpuprofile.gz) · [environment](profiles/final-profile/environment.json).
- [Complete comparison, including all recorded top-self entries](profiles/profile-comparison.json.gz).

| Sampled function / scope | Baseline self, ms | Final self, ms | Baseline inclusive, ms | Final inclusive, ms |
| --- | ---: | ---: | ---: | ---: |
| `reachableTarget` | 11122.776 | 23.437 | 11260.558 | 70.013 |
| `readinessPlan` | 76.161 | 42.600 | 11363.949 | 125.990 |
| `unitClaims` | 47.327 | 40.842 | 13575.313 | 2383.646 |
| `planPresetAiRuntimeCommands` | 17.617 | 8.855 | 26785.946 | 14014.003 |
| `stepGame` | 1456.147 | 1401.866 | 39597.727 | 38564.838 |
| `planShipRouteImpl` | 1481.159 | 1359.550 | 10592.971 | 10347.892 |
| `(garbage collector)` | 3984.201 | 3868.627 | 3984.201 | 3868.627 |

Total sampled time is 74,260.938 ms / 68,049 samples before and 60,154.517 ms / 54,319 samples after. `reachableTarget` self time falls from 14.978% to 0.039%; its final inclusive time includes calls to the new `consider` helper. AI inclusive time falls substantially, while simulation, ship-route and garbage-collection absolute sampled time remain similar. Inclusive scopes overlap and must not be summed.

The profiles support the readiness/reachability diagnosis for the controlled run. They also identify ship routing as a material residual workload (10.35 seconds inclusive in the final full-match sample), but **do not prove that a particular top-spike tick was caused by ship routing**. Its percentage rises because the total sampled time falls; that does not establish a routing regression. Further per-tick attribution remains necessary before changing ship rules or introducing a think phase.

## Why the changes preserve decisions

1. **Distance before reachability.** Readiness computes distance once, applies the same open/closed approach bounds and 900-unit cap, then queries reachability only for candidates that remain. The stable distance sort and input-order tie handling remain unchanged. The same pure-predicate reordering is applied to eligible naval candidates; the other policy reachability sites were audited rather than mechanically reordered.
2. **Readiness reuse in one invocation.** A synchronous script-runner scope owns the cache. Reuse requires the same snapshot identity, owner, team object and tested team values, general mode, target existence and coordinates. A changed budget snapshot is a distinct frame and does not share this entry. Mode/target/team changes trigger recomputation; unrelated memory changes need not. Scope exit and exceptions discard results, nested scopes restore their enclosing scope, and returned command/set containers stay independent. The runner only retains an unchanged budget view identity; adjusted gold/reserve values still get distinct snapshots. This is not an unbounded snapshot-only WeakMap assumption.
3. **Exact terrain ring boundary.** The production traversal visits the same border cells, preserves bounds, connected-component checks, termination guard, and minimum `(squared distance, padded cell index)` tie-break, without scanning each ring’s interior. An open same-island goal returns itself, as its sole goal seed already did. Test-only square traversal is exercised through the public destination path, including land/sea, edge/corner ties, obstacles, changed revisions and cache turnover.

The changes do not alter AI scheduling, navigation rules, checksum version or frequency, frozen opponents, benchmark manifests, or the three AI routes. No new think phase, blocked-ship backoff, placeholder rendering, or lowered validation cadence is used.

### Full command and state oracles

All four 14,400-tick runs have:

- Final checksum: `7d94a5e8` (checksum version 18).
- Complete native command log: **14,400 frames**, 612 nonempty frames, **618,189 uncompressed bytes**.
- Full command-log SHA-256: `771222bde4c8d2c0a46a97313563ad2b5de1d52ed92fb2d3c70511ff2276c997`.

The stored command logs are compared after decompression, not merely through a hash of a subset of commands. Empty ticks remain `frame: null`; native room ID, tick, sequence and command ordering remain in the original serialization.

The 31-tick [instrumented smoke](probe-smoke/instrumented-3/summary.json) and [plain-source smoke](probe-smoke/plain-1/summary.json) both produce checksum `b8473a1c`, 4,085 native log bytes, and SHA-256 `728be47578cdbea79678a68cb2bbfd90402f1795ae9e55e6ad8c9ddbf632a417`. This is a transparency smoke, not a long-match performance comparison.

## Validation and attribution

The full test suite is **not green**. `npm test -- --run --maxWorkers=2 --minWorkers=2` exits 1: **6,763 passed / 4 failed of 6,767 tests**, with 619 files passing and three failing, in 406.79 seconds. [Complete original output](validation/recorded/six-player-full-tests.log.gz).

Those three unchanged specifications were run on detached baseline a0524c2: **82 passed / the same four failed of 86**, exit 1, in 11.65 seconds. Failure names and assertion messages match exactly, and all three specification SHA-256 values match both source trees. [Baseline original output](validation/recorded/six-player-nav-baseline-a052.log.gz) · [complete attribution and source hashes](validation/recorded/six-player-test-attribution.json.gz). These are unresolved baseline naval acceptance failures; this comparison does **not** establish that the tests are wrong. No assertion was weakened and no navigation rule was altered to make them pass.

| Unresolved baseline specification | Case |
| --- | --- |
| `ship-maneuver-recovery.test.ts` | Forward recovery when an in-place turn is possible but a sailing circle is blocked |
| `ship-voyage-quality.test.ts` | Six incoming friendly batteries find distinct usable stations around a stopped heavy hull |
| `ship-voyage.test.ts` | Reverse into an aligned berth within one hull length, without two U-turns |
| `ship-voyage.test.ts` | Keep a zero-margin reference for exact control instead of smoothing through it |

`npm run build:production` exits **0**, including TypeScript `--noEmit`, Vite production client and server bundle. [Complete original build output](validation/recorded/six-player-build-production.log.gz).

After all evidence was archived, `npx vitest run src/sdk/package-boundaries.test.ts --maxWorkers=1 --minWorkers=1` exits **0**: all **7 tests pass** in 27.86 seconds, including the naming check over the current complete source/docs tree. [Complete original final-boundary output](validation/recorded/six-player-final-boundaries.log.gz).

Focused results:

- Probe: 4 tests pass, including return/throw handling, missing-boundary rejection and instrumented/unmodified native frame equality.
- Readiness, naval-query, engagements and script-runner: 53 tests pass. Reuse cases cover memory/options changes, inherited/deleted team values, budget identity, mutation isolation, nested scopes, exceptions and standalone calls; `tsc --noEmit` passes.
- Terrain, public old/new destination equivalence, arrival and snapshot ground: 29 tests pass. The equivalence suite includes 6,561 isolated-island pairs plus generated archipelago land/sea queries and hand-map boundary/tie/revision cases.

The first probe smoke failed because esbuild’s synthetic stdin entry was incorrectly treated as a file to read; the probe now excludes that synthetic metafile entry. This was a probe implementation defect, not a game defect. Its failed executed bundle and full exception log are preserved. The second smoke succeeded while the probe metadata was still being finalized; it is retained as an intermediate attempt, not substituted for the final instrumented/plain pair. Step-2 strict type checking also caught two test-only `exactOptionalPropertyTypes` assignments; replacing the assignments with property deletion retained the assertions. The first strict check output was not saved as a full raw log; the retained `readiness-step2-checks.json.gz` contains the actual captured final tool outputs and the stated correction, not a reconstruction of that missing log. These failures are not suppressed or reclassified solely to obtain a green result.

## Reproduce

Use an independent baseline checkout so current source edits cannot leak into its run; the probe rejects an existing output directory and verifies all bundled source bytes plus HEAD before and after execution.

```sh
git worktree add --detach /tmp/sketch-six-player-a052 a0524c2c9b32d4b92084d4f9478729eb562f7d29
ln -s "$PWD/node_modules" /tmp/sketch-six-player-a052/node_modules
npm run benchmark:six-player-ticks -- --source /tmp/sketch-six-player-a052 --ticks 14400 --out /tmp/six-player-before
npm run benchmark:six-player-ticks -- --source "$PWD" --ticks 14400 --out /tmp/six-player-after
```

For each intermediate result, check out its exact source commit in another detached worktree and run the unchanged probe with a fresh `--out`. Default tick count is 14,400. `--plain` bundles unmodified game source; `--cpu-prof-from T` uses Node’s built-in inspector CPU profiler from tick T through the end, with no installed native debugging tools. Profiled runs are diagnostic and are kept separate from the timed before/after table.

## Verify captured bytes

The manifest includes complete original and stored hashes, not abbreviated digests. This checks every independently reread asset, restores added-gzip bytes, and verifies each compressed payload:

```sh
python3 - <<'PYVERIFY'
from pathlib import Path
import gzip, hashlib, json
root = Path("docs/performance/six-player-ticks")
manifest = json.loads((root / "evidence-manifest.json").read_text())
sha = lambda data: hashlib.sha256(data).hexdigest()
for directory in manifest["capturedDirectories"]:
    expected = {name + ".gz" if name == "runtime.mjs" else name
                for name in directory["exactFileNames"]}
    assert {p.name for p in (root / directory["destination"]).iterdir()} == expected
for entry in manifest["assets"]:
    stored = (root / entry["storedPath"]).read_bytes()
    assert len(stored) == entry["storedBytes"]
    assert sha(stored) == entry["storedSha256"]
    capture = gzip.decompress(stored) if entry["storageEncoding"] == "gzip-added" else stored
    assert len(capture) == entry["captureBytes"]
    assert sha(capture) == entry["captureSha256"]
    if "payloadSha256" in entry:
        payload = gzip.decompress(stored)
        assert len(payload) == entry["payloadBytes"]
        assert sha(payload) == entry["payloadSha256"]
print("All captured bytes verified")
PYVERIFY
```

For readability, restore any compressed text with `gzip -dc FILE.gz`. [Original validation and exception logs](validation/recorded) retain their complete bytes; captured source/input text has not been edited to satisfy repository naming checks.

## Remaining limits

The six-player ticks still exceed both requested limits, and the full suite retains four reproducible baseline naval acceptance failures. Shared five-owner planning remains visible every 15 ticks, and simulation/snapshot/GC costs remain. The supplied blocked-ship 146–210 ms series was not reproduced by this particular fixed room run: simulation maximum is 44.61 ms in its baseline and 62.05 ms in its final run. This does not disprove that report for its original match. Lockstep checksum serialization, six-color card churn and browser rendering were not measured by this static headless probe.

Changing owner phases or ship replan timing would change behavior under the current rules/frozen-baseline contracts and requires a separate deliberate decision. Further exact optimizations should follow the residual CPU evidence rather than assume those behavior changes are necessary.
