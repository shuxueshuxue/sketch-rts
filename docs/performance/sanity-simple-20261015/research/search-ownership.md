# Search ownership / query-demand research

Research and proof-harness preparation; no tests or benchmarks run by this research agent. Repository deliverable added: `scripts/sanity-overlay-proof.mjs`; no production files changed by this agent. Reviewed 2026-10-15 (UTC session date). Baseline HEAD verified: `4804631c22f7be3f83dc6374e71ce03d86068dd8`; `src/shared/rules-version.ts:6` is rulesVersion 3. Local source line references below refer to this baseline. Parent lane owns implementation and benchmarking. Harness execution and experimental outcomes must be reported separately by its runner.

## Priority hypothesis: stop rematerializing cumulative search state

`src/shared/ship-navigation.ts:959–979` rebuilds reached/traffic/prefix/entrance Maps, replays reached records into shared typed arrays, restores heap slots, then on pause exports the cumulative records and heap again. Expansion budgets at line 1026 bound new expansions (4096 empty traffic / 128 custom traffic), not restoration/export work. With N reached nodes and B expansions/slice, cumulative copying can approach O(N²/B), in addition to search work. This is a structural hypothesis, not measured attribution. Parent reports profile totals of planShipRouteImpl 11.1 s, live advance 4.49 s, arrivalConnectorFor 3.82 s; these overlapping samples are not additive and do not establish a 10x whole-tick opportunity.

An opaque job-only search could retain Map records, Frontier, prefixes, entrances and saved traffic directly between slices. Choose cost/setCost/parent operations at entry; avoid rebuilding Maps/heap or copying all reached nodes. Preserve graph, exact heap order, record replacement order, callback order, budgets, phase transitions and completion tick. Map replaces full-grid typed scratch, avoiding per-job dense arrays of approximately 20S + 12(S/8) bytes, S being heading-lattice nodes. Persistent Maps have substantial overhead themselves: measure peak multi-job retained memory, allocation rate and release after completion/cancellation. Keep fallback on the existing public path for first experiment. All cold searchSteps reconstruction remains timed.

### Important correction: current live API is observable, not opaque

The existing exported `beginLiveShipRouteSearch`/`advanceLiveShipRouteSearch` cannot simply stop maintaining state arrays while claiming compatibility. `src/shared/ship-live-search-integration.test.ts` explicitly enforces:

- L54–61: live state.nodes and state.heap exist after entrance.
- L95–101: every yielded live state deeply equals the general state, including record ordering; retained old-record identity patterns match; callback sequences match.
- L64–68: result aliases state.result and, where present, state.path.
- L125–183: nested route queries and callback exceptions do not corrupt subsequent searches or scratch depth.

Production repository search found only ship-planning-job.ts imports these live entry points, but exported TypeScript functions and tests expose their protocol. A comment calling them internal is insufficient to erase that contract. Dropping these tests or weakening equality would violate the requested acceptance strength.

Recommended experiment architecture: retain the two existing live functions and general API unchanged; add a truly opaque job runtime (or a narrow internal factory wrapper around the same engine). Store runtime in a WeakMap keyed by VoyageJob, not in public ShipRouteSearchState. Common search engine must avoid duplicating algorithm logic. This adds a boundary and some dispatch, so count the diff and reject a giant parallel implementation.

`job.search` caveat: VoyageJob and read() are private, but `ship.sailing.planningJob` is an externally visible JSON string. save() excludes search for newly generated jobs; read() accepts previously serialized/injected JSON containing a search graph. `ship-planning-decoded-search.test.ts:8–35` intentionally injects `{phase:'search',target,...,nodes:'',heap:[]}` and requires a TypeError plus unchanged saved string. Existing JSON search objects must stay on the general path. Do not treat structural resemblance, a decoded job, or a caller-supplied state as owned. A fresh opaque runtime is only valid for jobs created/reconstructed through controlled initialization.

Additional interoperability gap worth a focused differential test: beginLive → public advance → live advance on the SAME state, plus JSON clone after a live yield and mutation/replacement of nodes/heap. Existing baseline rematerializes from the public arrays every call; a hidden persistent cache could silently ignore edits. Keeping old APIs unchanged avoids this new invalidation protocol.

## Minimal discriminating validation (commands proposed, NOT executed)

Run from `/workspace/sketch-rts`, after implementation. No performance conclusions from Vitest timings.

```sh
npx vitest run src/shared/ship-live-search-integration.test.ts src/shared/ship-search-continuation.test.ts src/shared/ship-navigation-workspace.test.ts src/shared/ship-planning-decoded-search.test.ts
```

This is the first gate: exact per-yield observable state, record identity, callback tracing, finite budgets 12/128/1024 and Infinity, serialized fallback, interleaved scratch, nested calls/errors, malformed decoded graph handling.

```sh
npx vitest run src/shared/ship-planning-state.test.ts src/shared/ship-planning-budget.test.ts src/server/room-planning-restore.test.ts
npx tsc --noEmit
```

This is the product gate. ship-planning-state tests include >50,000 expansions followed by 80 tick-by-tick snapshot/checksum comparisons (L160), cold preparation without authoritative mutation (L191), FIFO two-ship restore (L225), cancellation/fresh snapshots (L256), wind invalidation (L283/L342), abandoned job pruning (L310), and 300 ticks with cold clones at pending boundaries for finish/wind/new command/traffic (L367). Room tests assert waiting to reconstruct cannot advance room tick/checksum or lose admitted commands. These are unusually strong existing oracles; preserve them.

For a NEW opaque runtime, add one focused differential harness against unchanged public advance: same frozen scene/traffic; compare return/undefined on EVERY slice, result route including all scalars, callback trace, final partial, and interleave two opaque jobs with a public synchronous query. Include fallback and custom callback nesting/throw. These behaviors are not fully exercised by tests that continue to use the old live API. Parent's deterministic game checks should additionally compare baseline vs candidate, not only candidate warm vs candidate cold.

Performance discriminator: count cumulative nodes replayed/exported and heap slots restored/saved against newly expanded nodes, per job and per tick. Benchmark late slices, entire job, warm uninterrupted simulation, cold restore, and multiple concurrent jobs. Report p99/max/end-to-end time plus heap/arrayBuffers/RSS and GC. If copying is small or Map access costs outweigh saved reconstruction, reject; do not change slice budget to hide it.

## Secondary hypothesis: scalar distance queries compute full maps

terrain.ts:963 walkingDistance obtains one distance through exactField, whose grow at L1428 clears dist/next and exhausts the connected graph. groundTravelCost L1014 also builds a full weighted field for obstructed straight lines. FIELD_CACHE=128. Count requests, unique target cells, hit rate, expanded cells, and actually read dist cells before changing anything. Existing nearestByRoute and same-goal calls already share fields; do not count them as independent full searches.

An exact point search or lazily settled destination field can stop after required query cells settle, preserving integer distances and unreachable behavior. Batch known query points without skipping any requests. Avoid changing walkRoute direction tie-breaking; weighted grid reverse-edge semantics require proof. Huge gains require actual demand area far smaller than complete field area. No measurements yet.

setBuildingBodies L1137 already skips equal body lists; changed lists still copy full walk, rasterize all buildings and scan all cells to discover dirty sectors. Incremental footprints/dirty sectors are a lower-priority design because overlaps, snapshot copy-on-write, connectivity splits and clearance maintenance can add considerable complexity. Static terrain distance queries alone do not justify D* Lite.

## Primary sources actually browsed

Initially fetched with web open/find on 2026-10-15 UTC session date. The Detour and 0 A.D. sources were subsequently pinned by reading GitHub's commit API and fetching the complete raw files at those SHAs via HTTPS on the same session date. The raw pinned files have different line offsets from the web extraction of the moving branches: the verified pinned locations below supersede the earlier extraction locations. This was network/source reading only, no benchmarks or CPU tests. Local code evidence is pinned to the baseline SHA.

1. Recast Navigation / Detour, `Detour/Source/DetourNavMeshQuery.cpp`:
   https://github.com/recastnavigation/recastnavigation/blob/9f4ce64458dfae86e1239c525ddc219c4e9e06f1/Detour/Source/DetourNavMeshQuery.cpp#L1261-L1303
   Pinned raw URL: https://raw.githubusercontent.com/recastnavigation/recastnavigation/9f4ce64458dfae86e1239c525ddc219c4e9e06f1/Detour/Source/DetourNavMeshQuery.cpp
   Commit `9f4ce64458dfae86e1239c525ddc219c4e9e06f1`, committer timestamp 2026-02-27T07:16:52Z; raw-file SHA256 `73651e2cea3c162cd01574e24668a30ab4c3dc985e07d51a9d7038c0523b0db1`.
   Verified raw lines: initSlicedFindPath starts L1216; L1261–1275 initializes node pool/open list once; updateSlicedFindPath starts L1280; its bounded loop L1295–1303 directly pops persistent m_openList. Supports persistent search ownership, not a measured speedup for sketch-rts. Detour's polygon graph, costs and path semantics must NOT be substituted blindly.

2. Wildfire Games / 0 A.D., `source/simulation2/components/CCmpPathfinder.cpp`:
   https://github.com/0ad/0ad/blob/61a3b9507d974084e6badb88a0826bd89a6d5b8b/source/simulation2/components/CCmpPathfinder.cpp#L481-L568
   Pinned raw URL: https://raw.githubusercontent.com/0ad/0ad/61a3b9507d974084e6badb88a0826bd89a6d5b8b/source/simulation2/components/CCmpPathfinder.cpp
   Commit `61a3b9507d974084e6badb88a0826bd89a6d5b8b`, committer timestamp 2024-08-17T03:00:28Z; raw-file SHA256 `526ed503a944f60a3a6cbdad530543abdf8a92f37c8b53deeb3a9dfc94439f70`.
   Verified raw lines: UpdateGrid starts L481; no-dirty return L524–525; global reload/recompute L561–562 vs local pathfinder Update L566–567; dirty-cell copy L547–550 still scans grid. Supports separating global/local invalidation, not a claim that this upstream implementation avoids all scans or proves 10x.

3. Sven Koenig and Maxim Likhachev, “D* Lite”, AAAI 2002:
   https://idm-lab.org/bib/abstracts/papers/aaai02b.pdf
   Actual PDF opened and text searched. Browser returned eight pages, including p6 experiments comparing incremental search and A*, and p7 conclusion describing reuse of already consistent goal distances. The paper reports order-of-magnitude advantages in certain replanning contexts, not this game's scenario. Moving start / local edge changes motivate repair; global wind-dependent weights and exact path/slice completion protocol limit direct adoption. No external figure or performance number has been used as a local benchmark result.

The attempted Boost latest Dijkstra documentation URL returned 404 and is NOT supporting evidence.

## Follow-up: exact octile witness fast path (review only)

Reviewed on 2026-10-15; no implementation or tests run. This is a stronger small-change candidate than introducing a second search runtime because it can avoid entire full-map fields without any additional cache or change to the search algorithm.

Proposed scope is ONLY walkingDistance, after the existing no-terrain branch and walk[start]/walk[target] validity checks, and only if state.fields.has(target) is false. Compute padded-grid integer coordinate deltas. Walk one monotone witness: diagonal toward the target while both deltas are nonzero, then along the remaining axis. Require the destination cell to be walkable for every step; diagonal steps additionally require both cardinal side cells walkable. If this witness succeeds, return `(DIAGONAL * min(abs(dx),abs(dy)) + STRAIGHT * abs(abs(dx)-abs(dy))) * terrain.cell / STRAIGHT`; otherwise use the unchanged exactField. When a field already exists, keep the existing exactField call so its LRU use update remains intact.

### Exactness argument

grow at terrain.ts:1428 uses constant cardinal cost 5 and diagonal cost 7 for BOTH movers, ignoring weight/pace. With unrestricted 8-neighbor movement, the integer octile metric is the shortest distance: take min(|dx|,|dy|) diagonals and ||dx|-|dy|| cardinal steps. Equivalently, that metric changes by at most the cost of any allowed graph edge, so it lower-bounds every obstacle-constrained path. Obstacles and no-corner-cut rules can remove edges but cannot reduce that lower bound. A witness consisting entirely of valid edges attains it, proving equality. Graph edges/corner constraints are symmetric, so starting at from rather than traversing the existing target-rooted field is equivalent. It is not an approximation or a new route choice: only the scalar result is returned; walkRoute/steerPoint/next are unchanged.

### Boundaries that must remain unchanged

- Validate walk[start] and walk[target] before start===target: blocked, off-map, NaN and infinite same-point queries must still return undefined. A valid same CELL returns 0 even when physical coordinates differ.
- Compute deltas from padAt cells, not world-space displacement: existing result quantizes endpoints to cells. Use width for vertical padded offsets and check both diagonal side cells.
- Without terrain, the current result is Euclidean world distance, not octile or zero for nearby coordinates; retain that branch.
- Mud/shallow pace weights must not enter walkingDistance. Do not apply this exactness argument to groundTravelCost's weighted field.
- Multiply integer cost by terrain.cell, then divide by 5 in the same evaluation order as existing code. Reordering division can change floating results for non-integer cell sizes.
- Witness failure means only this one monotone path failed. Another optimal path or a longer detour may exist: ALWAYS fall back, never return undefined from a failed witness.
- Preserve sentinel behavior: exactField treats costs >= UNREACHED as undefined. At unrealistic but API-representable extreme map dimensions an unconditional formula could exceed this threshold. Either retain the same final cost guard or constrain the shortcut to lowerBound < UNREACHED. Ordinary game maps are far below this bound.
- Terrain identity invalidation is intentionally unchanged. In-place cells mutation is already documented by terrain-multi-source.test.ts; do not broaden this small patch into runtime invalidation work.

### Existing / historical overlap

Current walkingDistance has no direct witness; it always builds/reads exactField after endpoint validation. searchExit terrain.ts:871 already uses the octile expression as a weighted hierarchical heuristic, not a feasibility witness. Existing groundTravelCost has a continuous straight-segment shortcut with different semantics. Recent terrain commit history and all-ref commit-title searches for octile/witness/walkingDistance plus `git log --all -S octile -- src/shared/terrain.ts` did not reveal a prior implementation; this is not proof that every historical differently named variant was exhaustively searched.

### Minimal meaningful validation

```sh
npx vitest run src/shared/terrain.test.ts src/shared/terrain-arrival.test.ts src/shared/terrain-multi-source.test.ts
npx tsc --noEmit
```

terrain-multi-source.test.ts already exposes actual grow/exactField/runtime through test-only source compilation and has uniform 5/7 on mud/shallow, precise floating conversion, invalid-point, identity and LRU reuse checks. However several existing tests build fields first: they can entirely miss a cache-miss-only shortcut. Add a focused differential test using that test-only access pattern, comparing walkingDistance on a fresh runtime with grow(...).dist on a SEPARATE runtime (or use grow, which does not insert in fields). Test all valid endpoint pairs over small obstacle maps and both movers. Include all 512 binary 3x3 occupancy patterns if practical: these exhaust diagonal corner configurations and short alternative optimal paths, without probabilistic assertions. Use an oracle independent of walkingDistance so the shortcut cannot certify itself.

Targeted fixtures: all octants; horizontal/vertical/equal cells; each single blocked diagonal side; diagonal-first blocked but cardinal-first succeeds at the same optimal cost; required longer detour; disconnected cells; blocked/off-map/NaN/Infinity endpoints; arbitrary positions within cells; mud/shallow; non-integer cell sizes with strict numeric equality. Compare both cold and prepopulated exactField paths; verify the successful witness leaves target field absent and a pre-existing field's used count advances. Compare walkRoute/steering after queries to a fresh reference runtime to expose spare-array/LRU contamination.

Performance hypothesis must account for repeated same-goal queries: without building a field, k successful witnesses cost O(kL) rather than baseline O(V+k), where L is witness length and V full explored area. This can regress dense repeated queries to one target, even though individual cold queries improve dramatically. Avoid adding counters/caches preemptively. Measure actual unique target count, witness success/failure and attempted steps, eliminated grow calls, entire tick/job performance and retained memory. Misses add up to O(L) before fallback, although early blocked witnesses are cheap. Adversarial long open corridors with a blocker near the witness end and heavily reused open-map targets are necessary negative controls.

## Follow-up: transpose naval-mine distance matrix

Static review only, 2026-10-15. Parent reports tick 6990 has 10,687 walkingDistance calls and 12 grow calls costing approximately 41 ms, with only 240 grow calls over the whole measured match. These are parent-supplied measurements, not independently executed here. A transpose can specifically remove expensive cold destination fields while keeping every origin comparison and AI decision.

Current naval-mines.ts:23–24 uses nearestByRoute over [...fleet, candidate.departure] with landing as target, then queries the selected origin again. All candidate landings therefore own distinct target-rooted fields. The desired score is min over origins of d(origin,landing); walkingDistance uses an undirected constant-5/7 graph with symmetric no-corner-cut rules, so d(origin,landing)=d(landing,origin). For no-terrain finite points the sqrt expression is also exactly symmetric. The existing naval-mines-distance-reuse.test.ts independently verifies 35,110 all-pairs cases against Floyd-Warshall, including blocked/disconnected cells, and finite terrain-free fractional points.

Minimal proposed replacement ONLY for those two lines (not applied):

```ts
    let origin: MineCoast['departure'] | undefined;
    let shortest = Infinity;
    for (const from of [...fleet, candidate.departure]) {
      const route = walkingDistance(snapshot.map, candidate.landing, from, 'sea');
      if (route !== undefined && route < shortest) {
        origin = from;
        shortest = route;
      }
    }
    const road = origin ? shortest : walkingDistance(snapshot.map, origin!, candidate.landing, 'sea')!;
```

Remove now-unused nearestByRoute import. Preserve fleet filtering, threats construction, candidates.map, threat distance filter/reduction, stable sort comparator and final ?.candidate verbatim. This adds roughly 8 lines and removes one import; final actual diff must be counted by implementing owner. No new cache, deduplication, dataflow buffering or graph implementation is required. The intentionally unchanged invalid-origin call on the last line preserves historical failure behavior, and deserves a short comment.

### Edge/compatibility review

- Keep strict `<`, same origin order, and shortest initialized to Infinity: equal routes retain first original origin; undefined/NaN/Infinity do not become a selected origin. No sorting origins or departure-first shortcut.
- All unreachable: original nearestByRoute returns undefined, then walkingDistance reads undefined.x and throws TypeError. Returning Infinity, undefined candidate or filtering it out would silently alter behavior. Proposed fallback preserves the original actual failing call; candidate iteration still aborts at the same invalid candidate before its threat calculation.
- Empty candidates still returns undefined, after the same threat preparation. A valid departure with an empty fleet still scores correctly. Do not early-return before threats in this patch.
- Return identity: retaining `{ candidate, threat, road }` and final `.candidate` returns the exact original candidate object, not a copy. Origin is not returned and affects no other behavior, but preserve its tie rule anyway.
- Existing test references the older reverse SECOND query, which is mathematically equivalent but is not a literal copy of current main. It is a useful independent oracle for results/identity, not a proof of identical cache traffic.
- Threat reduction order and candidate stable-sort ties must remain verbatim. Replacing sorting with an argmin could be equivalent for valid numbers but is unnecessary added proof burden.
- Typed snapshot inputs are plain data. Reversing calls changes property-access order for out-of-contract getters/proxies and potentially changes which property access fails first for malformed points. Do not claim arbitrary adversarial object/accessor trace equivalence. Normal finite points, blocked/outside/NaN coordinates, undefined road and all-unreachable failure should be explicitly tested. Preserve exception type; exotic engine-specific error strings need not be invented.
- Upstream naval.ts:955–973 shares shore by water component. coastOnWater at L772 uses its water parameter only in sameGround checks, so equal shore plus equal sea component yields equal departure coordinates even when landing differs. Still count actual target cells; don't assume object identity or every candidate sharing one departure.

### Complexity, memory and transfer risk

For C landing cells and F fleet cells plus D departure cells, cold fields can fall from C to F+D (deduplicated naturally by exactField target key), while query comparisons stay O(C(F+1)); redundant second query per candidate disappears. With one/no ship and one coast this may turn 12 fields into 2/1. The benefit is not unconditional: a large fleet may have more unique cells than landings, moving ships change target cells across invocations, and fields >128 can thrash. Previously landing targets could stay warm as fleet moved. Therefore compare full-match grow count/time, per-tick peaks, cache churn and memory, not only tick 6990. Reuse of pre-existing origin fields can improve this; all such cache interactions must be measured. Do not introduce an adaptive cache policy before this simple experiment has evidence.

### Validation proposed, not run

```sh
npx vitest run src/ai/policy/naval-mines-distance-reuse.test.ts
npx tsc --noEmit
```

Existing test covers independent symmetry, original candidate identity, reversed/permuted input order, duplicates, same route ties, disconnected fleet, no fleet, no terrain, contested/uncontested, alliances and input immutability. Add focused cases for all origins unreachable (both current-main reference and candidate throw TypeError), invalid landing with otherwise valid origins, blocked/NaN origin ignored in favor of reachable departure, empty candidates, and exact candidate ties across multiple departures. Baseline-reference and candidate runs should use separate cloned terrain identities for cold-cache performance comparisons; using the same map lets the reference warm the candidate's cache.

For structural proof, use test-only runtime access (as in terrain-multi-source tests) or diagnostic counters to compare actual newly built targets in a cold 12-landing/one-departure fixture with a deliberate obstacle preventing the octile witness. If octile and transpose experiments are combined, report factorial A/B (baseline, witness only, transpose only, both), because witness success can make field-count savings disappear without representing a regression. End-to-end snapshot/checksum sequence equality and selected plan identity on all supported AI routes remain acceptance criteria.

## Follow-up: retain tile fields across snapshot copy-on-write

Status: static review completed, dedicated differential harness written but NOT executed by this research agent. Parent owns the approximately 10-line candidate in `/tmp/sanity-terrain-cow.ts`. Parent reports tick 9659 contains 3489 growBoxInto calls costing about 31.8 ms; these measurements were not independently run here.

Problem: shareBuildingBodies marks an overlay shared. A later building change clones through createRuntime, dropping already-built tiles. The next query builds all sector fields rather than using the existing redoTiles dirty-sector update. Preserve the prior walk and shallow-clone tile containers on the same terrain identity, then let unchanged existing dirty detection and redoTiles operate. This restores an existing incremental dataflow rather than inventing another cache policy.

Pinned local evidence:

- [Snapshot sharing and overlay replacement](https://github.com/shuxueshuxue/sketch-rts/blob/4804631c22f7be3f83dc6374e71ce03d86068dd8/src/shared/terrain.ts#L1129-L1180).
- [Tile structure and full/incremental construction](https://github.com/shuxueshuxue/sketch-rts/blob/4804631c22f7be3f83dc6374e71ce03d86068dd8/src/shared/terrain.ts#L424-L506).
- [Canonical sector-node ordering and linkSector mutation](https://github.com/shuxueshuxue/sketch-rts/blob/4804631c22f7be3f83dc6374e71ce03d86068dd8/src/shared/terrain.ts#L610-L635).
- [Lazy next writes and goal-field LRU](https://github.com/shuxueshuxue/sketch-rts/blob/4804631c22f7be3f83dc6374e71ce03d86068dd8/src/shared/terrain.ts#L718-L761).

Review conclusions:

1. Guard inheritance with current.terrain === terrain. Copy old walk before dirty detection. Do not inherit state from a replaced terrain identity.
2. Clone the Tiles object, node Map and every node record. linkSector reassigns node.field and node.edges, then pushes into that NEW edges array. Merely cloning the Map would mutate old snapshot nodes.
3. Clone borders/goals Maps, region/island arrays; initialize exits/nearest as empty Maps. Existing borders arrays, node.cells and goal.seeds are read-only after creation; changed borders get new arrays. goals Map itself is mutable LRU, so it cannot be shared.
4. Field dist is immutable after construction. Field next is a mutable pure memo: downhill reads only field-box geometry, dist and corner side cells. For retained untouched sector fields and goals outside the existing ±2-sector invalidation radius, this local geometry is identical, so old/new snapshots can safely share next writes. This is result/semantic isolation, not a claim that every cache byte is independent.
5. Preserve existing redoTiles ordering. sectorNodes explicitly sorts keys; edges derive from that order; heap tie-breaking is explicit. Map insertion order does not set path ties. Region/island labels use deterministic cell order.
6. Do not copy clearance/wholes or other global derived data without separate proof. The minimal candidate keeps their current fresh/lazy behavior.
7. Work remains: full walk comparison, label arrays and full labelIslands pass. Measure complete tick costs, including redoTiles work brought into setBuildingBodies, memory retained with old snapshots, and field recomputation on subsequent queries. Avoid claiming the entire map update becomes local.

Harness deliverable: `/workspace/sketch-rts/scripts/sanity-overlay-proof.mjs`. Run only after timing ends:

```sh
node scripts/sanity-overlay-proof.mjs /tmp/sanity-control /tmp/sanity-terrain-cow.ts /tmp/sanity-overlay-proof-result.json
```

Both complete terrain modules are bundled with esbuild using the control dependency root; only B's terrain source is overridden through onLoad. No function body is rewritten or private helper exported. Report contains both raw source SHA256s, bundle SHA256s, dependency inputs, calls/comparisons, mutation and snapshot counts, precise failing query context and values. Unexpected control exceptions fail rather than allowing two matching exceptions to certify fixtures.

Fixtures: three 63×47 maps (open weighted terrain, walls/gaps, mixed coasts); 13 building generations with nonempty-to-nonempty additions/removals, overlaps, sector-boundary footprints, closed/opened wall gaps, duplicate bodies producing no walk change, empty overlay removal/recreation and terrain identity replacement. Each update compares every land cell's isOpenGround and samples both movers through openGroundNear, walkableGoal, segmentWalkable, openStep, walkDestination and steerPoint. Values and returned-input aliases are compared. Partial prewarming and asymmetric old-snapshot prewarming deliberately exercise lazy next/goals. All retained generations are queried between current-world probes, including frozen historical results. Each generation also compares against a fresh control map rebuilt from the same buildings. Public map bytes and argument bytes must remain unchanged.

Limits: this finite adversarial harness is not an exhaustive state-space proof and does not replace whole-game checksum/route acceptance. It does not compare groundRevision numbers across modules because these are allocation/invalidation identity tokens, not corresponding serializable game values. It has not been executed by this agent: any report of passing results must cite the actual output produced by the parent runner. No benchmarks or CPU tests were launched during the parent's formal timing series.
