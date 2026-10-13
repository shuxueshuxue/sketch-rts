# Reuse work within a frontend synchronization

The frontend previously built the same world's live selection IDs twice during one synchronous update and scanned units/buildings repeatedly while publishing its debug view. This change reuses the first selection-ID set **within that invocation** and constructs the debug output in one loop per entity array. It adds no cross-frame cache, publication assumptions, simulation changes, or reduction in visible content.

## Production changes

- `syncFrontendWorldView` returns its already-built `liveIds` through a separate `FrontendWorldViewProjection` result type. Its input state has no new required field. `main` passes those IDs to the following `pruneSelection` call.
- Direct `pruneSelection` calls still derive IDs from their current snapshot when build/item targeting requires them. Boarding and no-mode calls no longer allocate an unused ID set. Boarding-source filtering, item ownership, palettes, focus, cabin rules, control groups, and the pre-command truth synchronization retain their existing behavior.
- A stopped adapter explicitly returns `liveIds: undefined`, including when the caller passes the entire previous projection back as input. A real `EmptyGameAdapter` regression checks that boundary.
- `createSketchRtsDebugView` constructs both unit ID arrays and enemy-order counts in one unit loop, and both building ID arrays in one building loop. It preserves entity/selection order, all IDs, optional-field omission, and the absence of `enemyOrders` when there are no qualifying orders. It still publishes a new output object each time.

The relevant production chain is `main.frame` → `syncActiveGameAdapterSnapshot` → `syncFrontendWorldView`, followed by the same main invocation's `syncDebugView` and `pruneSelection`. Initial match activation retains its direct, current-snapshot `pruneSelection()` call. The returned set is read only by the following synchronous checks; it is not retained as a future snapshot index.

## Verification and measured construction counts

[proof.json](proof.json) compares the exact production function bodies at baseline `42bd61c74934dc76f30d42b62e1e31eb5c5974ff` with the edited working tree. TypeScript AST extraction selects nine real main functions: synchronization, pre-command projection, debug publication, selection pruning, match activation/disconnection, focused-unit/student resolution, and mode-class clearing. The actual selection/debug/rule helper implementations and real `snapshotGame` fixtures are executed. UI/audio sinks record calls and arguments instead of operating a browser page.

| Check | Result |
| --- | --- |
| Actual main function scenarios | 27/27: complete state and recorded side effects equal |
| Exact debug object and serialized output scenarios | 5/5 equal, including mixed/neutral owner ordering, empty and missing snapshots |
| Live-ID set builds across those main scenarios | 42 → 21 |
| Mixed 9-unit debug fixture: visited elements | 32 → 9 |
| Mixed 2-building debug fixture: visited elements | 5 → 2 |
| Debug `.map`/`.filter` result arrays per published snapshot | 6 → 0 |
| Existing focused checks plus stopped-publication regression | 11 files, 85 tests passed |
| `tsc --noEmit` | Passed |
| Complete client/story checks | 132 files, 1067 tests passed |
| `npm run build:production` | Passed: global TypeScript check, Vite client build, server bundle |

The main scenarios cover same-tick checkpoint replacement, own/enemy cabin selection, stale groups/focus, valid/missing build workers, missing/wrong-carrier items, valid/dead/enemy boarding sources, all three palette branches, pending veteran choices, absent snapshots, menu gating, pre-command projection, direct pruning, and match activation without a supplied set. [checks.json](checks.json), [focused-tests.log](focused-tests.log), and [typecheck.log](typecheck.log) retain the exact commands/results and source hashes. The initial 84-test/typecheck run is also preserved separately; it predates the stopped-publication regression.

The debug counters observe actual `.map`/`.filter` calls and iterator visits on the input arrays and arrays returned by those methods. They are sampled immediately after the function returns; output equality validation is outside the counters. They do not count allocator bytes, array-capacity growth, every runtime allocation, or CPU time. New output arrays and all output contents remain present.

These are construction-count and Node function-subset correctness results. They are **not** full-page DOM, image/GPU, memory-usage, frame-time, or FPS measurements. No performance percentage is inferred from them.

The parent integration lane additionally ran the complete client/story suite and production build after the edits. [all-client-build-checks.json](all-client-build-checks.json), [all-client-tests.log](all-client-tests.log), and [production-build.log](production-build.log) retain those results. All four changed source/test SHA-256 values remained identical from the start of that validation through completion. This verifies this change's client integration; it does not claim the entire repository's unrelated test suites are green.

## Reproduction and source evidence

From this branch's repository root:

```bash
node --import tsx scripts/art-frontend-sync-reuse-proof.mjs \
  --baseline 42bd61c74934dc76f30d42b62e1e31eb5c5974ff \
  --out /tmp/frontend-sync-reuse-proof
```

The driver asserts the unchanged helpers match the baseline and that source files remain stable during the proof. [source-manifest.json](source-manifest.json) identifies fourteen relevant source files in each arm with full byte size/SHA-256 and gzip SHA. Their complete source is archived under `source/before` and `source/after`; every compressed file round-tripped exactly. [executed-driver.mjs](executed-driver.mjs) and the two executed main subsets retain the program used. This is a relevant-source archive, not an attestation of every transitive module in the repository.

## Remaining world-scale costs

Public lockstep `currentSnapshot()` still calls `SimulationEngine.snapshot()` and `snapshotGame()` on each read, copying the full world. There is no existing trusted presentation publication revision or stable read interface, and externally supplied engines remain mutable. This change deliberately preserves that copying behavior. Reusing a public presentation snapshot would require a separately owned publication interface, invalidation before frame application/checkpoint restoration (including failures and same-tick replacements), and continued defensive copies for ordinary callers; identity, tick, collection lengths, or a false render-update return are insufficient guarantees.

No merge or deployment was performed.
