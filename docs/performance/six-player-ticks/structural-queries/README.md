# Bounded structural query investigation

This followup preserves [PR #373](https://github.com/shuxueshuxue/sketch-rts/pull/373), its [original evidence](../README.md) and the [completed focused/ABBA evidence](../remaining-spikes/README.md). The execution source is frozen at `0f31f16c32e9a8050180c4da9d993eb7bf86cad0`. The question is whether `shoreSpot` can replace its remaining fixed-base minimum-distance queries with a multi-source field, and whether the isolated B2 nonplanning tick 2088 stall has a reproducible internal cause. **The multi-source prototype is rejected: its remaining query reduction is small, first-use cost is worse with existing warm fields, and steady warm results do not support a stable benefit.** Production implementation remains unchanged. The PR remains a draft without merge or deployment.

## Distance equivalence and cache ownership

`shoreSpot.gapOf` needs only the minimum numeric terrain distance to the fixed owner/enemy base sets for that invocation. It does not select a base identity. The existing private `grow(state, sources)` can compute this minimum using the same symmetric terrain-only 5/7 costs. This claim does not cover weighted travel costs, selected origin identity, route construction or path tie order.

The new [nine-case proof test](../../../../src/shared/terrain-multi-source.test.ts) compiles the actual private production functions with test-only exports. It compares every padded cell against copied single-source fields, including 500 deterministic random cases. It covers equal distances, reordered and duplicated seeds, no bases, blocked/off-map/NaN sources, disconnected land/sea, shoreline corners, boundaries, changed source sets and exact public distance conversion. No production export or algorithm is changed.

Two constraints matter for any future implementation. Raw private `grow` accepts blocked seeds and can expand from them, so public-equivalent seeds must be validated. The existing 128-field LRU can recycle and overwrite a borrowed single-source buffer; an independently owned multi-source field must not retain such a borrowed buffer. The proof exercises both cases. It also preserves the current terrain-object identity protocol: replacing the terrain refreshes the runtime, while mutating `cells` on an already cached object does not. This old behavior is documented rather than changed here.

## The remaining repetition is small

The earlier cache-count capture is inspected by target key and actual `shoreSpot` context, rather than summing all ship routes. Each selected owner has one own hall and five enemy halls:

| Tick / owner | Own-hall field hits | Enemy field hits | Total field hits | Enemy hits saved by one multi-source lookup |
| --- | ---: | ---: | ---: | ---: |
| 6990 / player-6 | 7,946 | 25 × 5 = 125 | 8,071 | 100 / 8,071 = 1.239% |
| 12705 / enemy | 7,946 | 22 × 5 = 110 | 8,056 | 88 / 8,056 = 1.092% |

There are no `shoreSpot` field misses/builds/evictions in these contexts. One own hall is already a single source, so multi-source growth cannot remove the dominant own-hall scan. Enemy distances are requested only after the preceding gap guards admit a candidate. Candidate order and those short circuits are important to this count.

These are **valid `exactField` cache reads**, not the number of `walkingDistance` entries or shoreline candidates. The separate boundary-count experiment confirms **10,430 shore candidates**, of which **7,946** have land-walkable centres and **2,484** return before querying a field. Total walking-distance entries are **10,555 / 10,540**, reducing to exactly **8,071 / 8,056** field reads after those early returns. These field counts agree with the live capture. There is no evidence of a terrain/runtime mismatch from the differing counter levels. Relative to all walking-distance entries, the maximum enemy lookup savings are only **0.947% / 0.835%**.

An additional full 14,400-tick capture instruments only the complete `shoreSpot` boundary at the two selected ticks, with no per-gap timer. It observes one invocation at **2.4216 / 1.8954 ms**, inside the respective `v6Economy` scopes of **52.6989 / 3.2719 ms**. These diagnostic times do not establish a speedup. At 6990 the shoreline scan is a small part of the economic spike; at 12705 it is a much larger fraction of that particular short economic scope. The remaining economic time is not all attributed to one function. Immutable snapshot/context inputs are retained for the separate experiment.

## Complete-function experiment

The scratch experiment compares the actual entire original function (A) with the same function using a lazy enemy-only multi-source minimum (B). Own-hall queries, row order, guards, placement checks and returned point remain unchanged. Private production `grow` is exposed only in the scratch bundle; the owned field is outside the numeric LRU. This is not a proposed persistent production cache.

Each experiment uses five **A → B → B → A** groups for each of the two captured inputs in three states: all caches cold; original single fields warmed but the new multi-source field still cold; and both variants warmed. Every slot gets an independent module/runtime. Counting runs are separate from timing runs. Full result bytes, input snapshot bytes and teams/options bytes are checked after the complete function call. Timing includes the complete call and any field construction; bundle construction, module load, prewarming, serialization and assertions are outside the call timer. No GC is forced and outliers are retained.

The snapshots are replayed into independent fresh module runtimes. They do not restore every internal cache object from the running match. The function experiment therefore supports an isolated cold/warm cost decision, not a full-tick or browser performance claim. The live command/state oracle remains a separate validation.

Two separate executions each contain five ABBA groups and **1,680 complete timed calls**, for **3,360** total. Both inputs retain exact result bytes, respectively `{"x":6160,"y":1392}` and `{"x":7408,"y":7312}`, and unchanged snapshot/teams/options bytes. The source-input hashes remain pinned to the same production source. Original run 1 is retained when the diagnostic boundary counters are added for run 2.

All table values are complete-function medians in milliseconds. Each cold-state cell has ten samples per variant, and each fully warm cell has 400. Means, p95/p99/max, every sample and all five group distributions remain in the raw summaries; no outlier is removed.

| Input tick | Cache state | Run 1 A → B | Run 2 A → B |
| --- | --- | ---: | ---: |
| 6990 | All cold | 13.0151 → 15.2211 | 11.2875 → 13.3856 |
| 12705 | All cold | 10.8298 → 9.9970 | 9.7034 → 10.5011 |
| 6990 | Old fields warm, new multi cold | 1.7695 → 2.6841 | 1.5451 → 2.8737 |
| 12705 | Old fields warm, new multi cold | 1.6495 → 2.0384 | 1.4873 → 2.1512 |
| 6990 | All warm | 1.2487 → 1.2490 | 1.2698 → 1.2608 |
| 12705 | All warm | 1.2790 → 1.2729 | 1.2839 → 1.2878 |

Existing warm single fields make the new first-use field slower in both inputs and both executions. Fully warm differences are tiny and their median direction changes; the warm means also have mixed direction across the two inputs (6990 is slightly smaller, 12705 slightly larger, in both executions). All-cold results are variable and do not establish an improvement either. This does not justify the additional field ownership, cache-key, invalidation and memory lifetime machinery. **No generic multi-source API/cache or production helper is added.** The mathematical proof and the complete negative experiment remain reviewable.

## Tick 2088: normal cost reproduced, 99 ms cause unresolved

Five sequential 2,110-tick runs retain low-perturbation simulation phase scopes around ticks 2086–2090, GC entries and the runtime's own CPU/resource counters. The selected tick is nonplanning in every run. Each complete prefix is **68,005 bytes**, SHA-256 `acd47bbc31b5480319a69bf4b1c6a10ac4c6c624e003b49e54bc0682fdea60be`, checksum `7a73a658`.

| Repeat | Whole tick 2088 ms | Ship-route call ms | Main-thread CPU ms |
| --- | ---: | ---: | ---: |
| 1 | 15.227 | 13.946 | 13.813 |
| 2 | 16.015 | 14.570 | 15.440 |
| 3 | 16.183 | 14.947 | 12.545 |
| 4 | 15.286 | 13.883 | 13.424 |
| 5 | 14.224 | 12.955 | 10.495 |

One `planShipRouteImpl` call for `unit-enemy2-transport-1108`, under `updateUnits → sailToward`, dominates this tick's reproduced normal cost. None of these five tick-2088 windows overlaps a reported GC entry. The original unobserved B2 **99.1884 ms** stall is not reproduced. These runs cannot identify its cause, rule out GC/scheduling in that earlier run, or justify a ship/AI behavior change.

CPU units alone do not validate short-window attribution. Neighbouring ticks and four five-tick aggregates record main-thread CPU above their wall-clock brackets. The raw signed differences are retained; they are not converted into waiting, scheduling or GC durations. A separate exclusive calibration records eight repetitions per workload: a 1 ms busy interval has wall/CPU medians **1.007 / 0.022 ms**, while 100 ms busy has **100.037 / 97.568 ms**. The own-thread API uses microsecond representation, without a documented short-interval error guarantee. [Official Node 24.19 API](https://nodejs.org/download/release/v24.19.0/docs/api/process.html#processthreadcpuusagepreviousvalue).

The first calibration attempt may have overlapped type checking; its original notes and output are preserved. The exclusive second execution is recorded separately. No restricted host logs, native debugger installation or additional security permission is used.

## What limits a larger gain

The existing B1/B2 full-match means average **3.6861 ms whole**, **2.7456 ms simulation (74.48%)** and **0.9212 ms AI (24.99%)**. Eliminating all AI cost would give only about **1.333×** average whole-tick improvement in this headless scenario, assuming the other cost remains unchanged. This is an upper bound for that hypothetical change, not a measured optimization or browser frame-time bound. The separately timed render snapshot is not renderer time.

Terrain field work grows with the reachable cell graph, not just the visible unit count. The actual map is **320 × 320 = 102,400 cells**, at 32 world units per cell. Building K uncached goal fields can repeat work proportional to **K × (V + E)**; fixed eight-neighbour edges make that approximately K × V. Warm field lookup is constant work, but still occurs for each admitted candidate. Existing per-invocation coast reuse has already removed the repeated same-component outer candidate scan, leaving little enemy-base multiplicity in `shoreSpot`.

Ship routing also distinguishes heading: its eight heading states give an upper bound of **819,200 cell/heading poses** on this map. This is a configuration-space bound, not evidence that every tick traverses all poses. The tick-2088 route scope identifies a real normal cost for one transport; it does not establish a whole-match simulation hotspot on its own.

The next potentially useful planning investigation is reducing the number of distinct cold sea-goal fields requested for mine candidates, with exact scalar/selection/order equivalence first. In the existing candidate tick-6990 `player-6/v6Economy` context, twelve sea targets each have one `nearestByRoute` miss/build and one hit; the subsequent twelve road reads are all hits. Thus there are **36 field reads and twelve cold builds**, with the formerly duplicated reverse-road builds already removed. Each target is in the same **85,767-cell** static sea component: twelve times that topology is **1,029,204 cell/field pairs**, not a measured queue-pop, relaxation or visit count. This is per-context work-count and topology evidence. The current capture has no separate `chooseNavalMine` duration, so the remaining economic time is not assigned to those twelve builds. The earlier verified CPU windows support investigating field expansion; they do not measure the new candidate's twelve fields in isolation. No safe new implementation or order-of-magnitude whole-game improvement is established. No Worker/ECS/WASM rewrite, AI phase staggering, ship backoff, broad AI matrix or new gameplay scope is introduced here.

## Oracles, checks and closed evidence

The new full-match capture retains all **14,400 native frames**, complete command SHA-256 `771222bde4c8d2c0a46a97313563ad2b5de1d52ed92fb2d3c70511ff2276c997`, checksum `7d94a5e8`. All five shorter repetitions match the entire original 2,110-frame prefix and its separate prefix checksum; a prefix checksum is not the full-match checksum. Planning phase, ship rules, checksum frequency and assertions remain unchanged.

The archive protects all **315** earlier files by comparing their full bytes with committed Git blobs at `0f31f16c`. It retains closed run/source/tool sets, failed setup logs, both calibration attempts and exact input/output identities. Only each explicitly named `node_modules` dependency symlink is excluded and its target is recorded. Runtime bundles and logs receive byte-preserving gzip; affected raw text receives gzip to preserve the existing source/docs naming boundary. Existing gzip bytes are copied unchanged.

The nine new proof tests, strict TypeScript checking and **all seven post-archive source/docs boundary tests pass**. The [complete 16-test log](validation/six-player-structural-final-tests.log.gz) is retained. Production implementation remains at the previously validated source; the earlier full-suite/build/CI results remain linked in the preceding report and are not presented as a new full-suite execution.

The [closed manifest](evidence-manifest.json) verifies **527 captured files** and all **315 protected earlier files**. It retains complete command/state validation, captured/restored/payload hashes and three explicit dependency-link exclusions. An initial preparation script has a syntax error before execution. The first archive attempt then encounters a tool sorting-contract error: the stored and expected sets contain exactly the same 71 experiment files and identical bytes, but the wrapper's path ordering differs from the earlier verifier's relative-string ordering. The failed archive's complete files, logs and original wrapper are retained under [archive-attempts/attempt1](archive-attempts/attempt1/failed-attempt-identity.json). Only the new wrapper is corrected to the existing verifier contract; no assertion, experiment or old evidence is changed. The successful fresh archive and final verification logs are retained. Duplicate files from that failed attempt produce 22 native verification records; they are **not new runtime measurements**. Actual new long/prefix executions remain one full match and five 2,110-tick repetitions.

Reviewable evidence:

- [Independent analysis and identity checks](analyses/six-player-structural-analysis.json), including all twelve sea-target keys, topology cardinalities, signed CPU deltas and per-run oracle checks.
- [Two-run complete-function experiment](experiment/shore/README.md), [run 1](experiment/shore/run1/summary.json), [run 2](experiment/shore/run2/summary.json), [counter boundaries](experiment/shore/counts-boundaries/summary.json), and [source/version closure](experiment/shore/closure-verification.json).
- [Actual full-match input capture](capture/runs/shore-actual-0f31/summary.json), [native command bytes](capture/runs/shore-actual-0f31/command-frames.jsonl.gz), and [two immutable function inputs](capture/runs/shore-actual-0f31/shore-inputs.jsonl.gz).
- Five original observations: [1](capture/runs/2088-observed-1/summary.json), [2](capture/runs/2088-observed-2/summary.json), [3](capture/runs/2088-observed-3/summary.json), [4](capture/runs/2088-observed-4/summary.json), [5](capture/runs/2088-observed-5/summary.json).
- [Multi-source proof](proof/multi-source/README.md), [exclusive CPU calibration](calibration/exclusive-clean/result.json) and [earlier calibration execution notes](calibration/first-with-execution-notes/execution-notes.json).

From the repository root, verify the closed archive with:

```sh
python3 docs/performance/six-player-ticks/structural-queries/archive-evidence.py verify
```

The [final explicit capture plan](archive-plan.json) and [archive source](archive-evidence.py) retain the closed inventory and verification logic. The independent analysis can be reproduced from repository evidence without executing the game:

```sh
python3 docs/performance/six-player-ticks/structural-queries/analyses/analyze-six-player-structural-evidence.py \
  --cache-capture docs/performance/six-player-ticks/remaining-spikes/capture/cache-candidate-09e \
  --b1-dir docs/performance/six-player-ticks/remaining-spikes/capture/abba-B1-candidate \
  --b2-dir docs/performance/six-player-ticks/remaining-spikes/capture/abba-B2-candidate \
  --shore-capture docs/performance/six-player-ticks/structural-queries/capture/runs/shore-actual-0f31 \
  --shore-experiment docs/performance/six-player-ticks/structural-queries/experiment/shore/run1 \
  --shore-boundaries docs/performance/six-player-ticks/structural-queries/experiment/shore/counts-boundaries/summary.json \
  --observed-dir docs/performance/six-player-ticks/structural-queries/capture/runs/2088-observed-1 \
  --observed-dir docs/performance/six-player-ticks/structural-queries/capture/runs/2088-observed-2 \
  --observed-dir docs/performance/six-player-ticks/structural-queries/capture/runs/2088-observed-3 \
  --observed-dir docs/performance/six-player-ticks/structural-queries/capture/runs/2088-observed-4 \
  --observed-dir docs/performance/six-player-ticks/structural-queries/capture/runs/2088-observed-5 \
  --original-dir docs/performance/six-player-ticks/runs/step3-border \
  --output /tmp/six-player-structural-reproduced.json
```

Paths in reproduced JSON may differ; numeric evidence, input payload hashes and native oracle verdicts must agree. Fresh game-window captures use the archived [observer probe](tools/observer/six-player-tick-probe.ts) with `--source` pointing to an unchanged detached `0f31` worktree, `--ticks 2110 --focus-ticks 2088 --focus-radius 2 --observe-gc --observe-runtime-usage`, and a fresh `--out` path. The scratch experiment's exact source and recorded worktree/input paths remain in its own closure; only its isolated function cost is claimed. No merge or deployment has occurred.
