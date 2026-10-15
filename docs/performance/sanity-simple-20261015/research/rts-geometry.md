# RTS geometry sanity research — 2026-10-15

Read-only review baseline: sketch-rts HEAD `4804631c22f7be3f83dc6374e71ce03d86068dd8`, rulesVersion 3 (parent lane). This document contains hypotheses and source review, not measured speedups. No benchmark was run by this research lane.

## Highest-priority changes

1. **Prepare one own sweep per attempted motion, not per obstacle.** Baseline `src/shared/ship-collisions.ts:147-170` constructs identical poses, hull rotations, convex hulls, expansions and negative polygons separately for every nearby body and terrain cell. Only callsites are baseline lines 202 and 211. With B obstacles, S substeps, H hull vertices, own preparation changes from O(B S H log H) to O(S H log H), leaving obstacle-specific Minkowski work intact. Lazy per-call parts avoid a global cache or invalidation rules. Temporary live memory grows to O(SH), but total duplicate allocations shrink. Actual gain depends on B and the measured share of this preparation.

   Reviewed parent candidate prepareSweep diff: a/b calculations and original arithmetic are preserved; before polygon is lazily reused; Minkowski and hull routines do not mutate source polygons. The closure is local to sweepShipCollision, shared with terrainContact, and no callback, await or ship mutation intervenes. No equivalence issue found in that diff. Do not share across ticks, replace fractions by accumulation, or unify with hullPassageClear: its curvature lever and world-space arithmetic differ. Empty/open-water calls now allocate a closure and parts array without materializing geometry: measure this overhead.

2. **Reject coarse-grid false candidates before Minkowski construction.** Baseline nearby at lines 104-110 returns overlapping 192-unit buckets; insertion adds 24 to each body's radius. The resulting candidates immediately enter full narrow phase. Compute extents of the already-prepared own negative sweep and actual body polygon, then reject when the a/b segment bounds are strictly outside their summed configuration-space bounds. Borderline/nonfinite inputs must fall back to the old kernel. Keep body/tile ordering and contact tie rules. Do not use hullRadius+error as an exact bound: expandConvex is a miter offset and sharp corners can exceed that radius. Do not approximate pivot/curved center motion by the whole-motion straight chord. A certified conservative reject can reduce allocation and geometry work without changing accepted contacts.

3. **Retain spatial membership between frames.** beginShipCollisionFrame at baseline lines 80-98 clears entries and both buckets every tick; this defeats updateEntry's bounds-unchanged early exit across ticks. Maintain entries and update changed membership instead. All inputs matter: position, radius/profile, terrain footprint size, death, deck membership, additions/removals, array identity. Frozen velocity/yaw snapshots still update each frame. This is more maintenance-heavy than (1)/(2); first measure index building and allocation share.

## Original-source evidence

Sources were opened/read on 2026-10-15. GitHub commit API resolved the branch heads below; each raw file was then fetched again at the exact SHA and function bodies/line positions verified. All source links below are immutable commit permalinks. The initially browsed branch pages had stale line positions; these were corrected after SHA verification. These are implementation precedents, not performance measurements for sketch-rts.

- Spring `CQuadField::MovedUnit`, lines 364-373: compares occupied quads and returns if unchanged. https://github.com/spring/spring/blob/2925abc99980eb3b08f421a6a45a184938611c40/rts/Sim/Misc/QuadField.cpp#L364
- Spring `GetUnitsExact`, lines 552-575: obtains candidate quads, deduplicates by stamp, then tests actual squared distance before returning a unit. This supports a cheap precise rejection after bucket selection. https://github.com/spring/spring/blob/2925abc99980eb3b08f421a6a45a184938611c40/rts/Sim/Misc/QuadField.cpp#L552
- 0 A.D. obstruction manager lines 140-145 separates unit and static subdivisions. `MoveShape`, lines 333-378, updates old/new occupied spatial bounds rather than rebuilding the world. https://github.com/0ad/0ad/blob/61a3b9507d974084e6badb88a0826bd89a6d5b8b/source/simulation2/components/CCmpObstructionManager.cpp#L140 and https://github.com/0ad/0ad/blob/61a3b9507d974084e6badb88a0826bd89a6d5b8b/source/simulation2/components/CCmpObstructionManager.cpp#L333
- OpenRA `ActorMap`, lines 473-510: processes queued position changes and dirties affected proximity triggers. Its consistency boundary differs from sketch-rts sequential motion, so copying the batching schedule would require a semantic decision. https://github.com/OpenRA/OpenRA/blob/e180e3225f3930272dd451917467631618f8976f/OpenRA.Mods.Common/Traits/World/ActorMap.cs#L473
- Box2D `distance.c::b2FindSupport`, lines 148-166, plus subsequent simplex implementation: support-map machinery is an alternative to materializing a complete Minkowski polygon. https://github.com/erincatto/box2d/blob/ac7c751eaeddbabdc1c4d41ae4f3a25d78627790/src/distance.c#L148 . Official collision documentation describes shape casts, distance, TOI and dynamic AABB tree. Important version correction: the initially browsed generated website described initial overlap as a miss, but the verified current header instead says it returns zero fraction and normal. Neither contract is the same as this project's separating-overlap rule; do not rely on the stale generated website statement. Verified header: https://github.com/erincatto/box2d/blob/ac7c751eaeddbabdc1c4d41ae4f3a25d78627790/include/box2d/collision.h#L71 . https://github.com/erincatto/box2d/blob/ac7c751eaeddbabdc1c4d41ae4f3a25d78627790/docs/collision.md
- 0 A.D. LongPathfinder lines 467-475 explains jumping to jump points rather than every adjacent node. https://github.com/0ad/0ad/blob/61a3b9507d974084e6badb88a0826bd89a6d5b8b/source/simulation2/helpers/LongPathfinder.cpp#L467 . HierarchicalPathfinder Update lines 438-468 rebuilds dirty chunks, but notes global connectivity may still need a map-wide flood. https://github.com/0ad/0ad/blob/61a3b9507d974084e6badb88a0826bd89a6d5b8b/source/simulation2/helpers/HierarchicalPathfinder.cpp#L438

## Aggressive candidates requiring separate semantic work

- Replace explicit Minkowski polygons/planes with support-map shape casting. It may delete sorting, vertex materialization and projection caching. Cannot claim equivalence without preserving initial-overlap separation, rotation envelope guarantees, pointed-bow combined normals, impact points and numerical tolerances. Porting a physics library is not automatically simpler or cheaper.
- Merge terrain cells into boundary polygons/rectangles. Even an identical occupied union can change per-cell initial overlap, contact ties, normals and damage points. Boolean terrain-clear queries and physical contact generation need separate analysis; do not silently change the latter.
- Hierarchical sea lanes or JPS. This project searches heading states with wind-asymmetric costs, curved connectors and traffic. Ordinary uniform-grid JPS pruning is not automatically admissible here; a new graph may select different routes. Document decisions rather than attributing such behavior changes to equivalent optimization.

## Validation deliverable

`scripts/sanity-sweep-proof.mjs` bundles the complete original and candidate collision modules independently. esbuild onLoad only appends private-function exports. The expected algorithm remains the untouched original sweepShape. The candidate is prepareSweep's closure, called across a body sequence, reverse sequence and replay to expose reuse contamination. Tests include every SHIP_KINDS entry, stationary/translation/rotation/wrap/tiny-angle/pivot/copied-pivot/curvature/copied-curvature/signed-zero/large-coordinate cases, tangency perturbations, deterministic random scenarios, and public sweepShipCollision with terrain and multiple bodies. Deep comparison uses Object.is numerical semantics through assert.deepStrictEqual; source hashes and counts are printed. The script was deliberately not executed while the parent was timing.

Suggested counters for causal diagnosis: candidates returned by buckets -> AABB survivors -> Minkowski constructions -> contacts, grouped by tick, plus own sweep preparations and substeps. Report their distribution on peak ticks; do not infer a tenfold overall speedup from an isolated contact or convex-hull microbenchmark.

## Follow-up structural diagnosis: snapshot COW and planning continuation

These are additional read-only findings, not measured optimization results. Local source positions below were rechecked after the review; they describe baseline behavior. The parent owns implementation, benchmarking and correctness proof.

### First priority: one building mutation after a production snapshot loses the whole warm terrain tile graph

The actual production chain is:

1. `src/server/room-host.ts:528`: `matchEnded || completedFrame && hosted.frameListeners.size > 0` calls `snapshotGame(game)`. Thus an ordinary observed room can trigger the behavior; it is not inherently an artificial benchmark snapshot.
2. `src/shared/sim.ts:978`: `snapshotGame` calls `shareBuildingBodies(game.map, snapshot.map)`.
3. `src/shared/terrain.ts:1128-1134`: `shareBuildingBodies` sets the overlay's `shared = true` and points the snapshot map to the same overlay.
4. `terrain.ts:1145-1147` correctly returns early if the body list is unchanged. However, the next real building footprint addition/removal passes that guard. At `terrain.ts:1150-1153`, `overlay.shared` forces `createRuntime(terrain, 'land')`, discarding the live world's previous warm tile graph instead of retaining its unaffected sectors.
5. The first subsequent query needing tiles reaches `terrain.ts:440-462`, which builds all sector regions, windows and links. `linkSector` at `terrain.ts:623-638` performs `growBox` for every window in each rebuilt sector. Without COW, a mutation can reach the existing `redoTiles` local-update path instead.

This is a concrete amplification candidate: a local building event can cause map-wide derived work. On a sufficiently large warm map, 10–100x less *event-specific work* is plausible to test; no such speedup has yet been measured by this research lane, and this is not a claim of an overall match speedup. Even the incremental route retains global island relabeling, so that remaining cost must be included.

Proposed minimal real macro scene:

- Use a large legal terrain map (for example 256 or 512 cells per side), several existing buildings, and a distant ground army following ordinary move orders around obstacles. Run until the actual routing tiles are warm.
- Subscribe to ordinary room frame snapshots through the production path above. Keep the emitted snapshot for the immutability check.
- Issue a normal worker build command for one legal foundation, or let ordinary combat destroy one low-HP building. Keep other buildings alive so the empty-body fast path does not mask the case. Do not mutate building arrays on every tick to manufacture workload.
- Capture the mutation tick and the first subsequent complex mover query; construction and first tile use may occur in different ticks. Count COW detachments, tilesOf cold builds, sectors relabeled/linked, growBox calls, and total time including subsequent work.
- Diagnostic controls: identical input sequence without snapshots, and snapshots without a building mutation. Performance comparisons between implementation variants must both retain the intended production snapshot cadence.
- Verify the retained old snapshot still sees the old building geometry and routes after the new world changes; verify new-world routes, checksums and deterministic state against the unmodified implementation. Record memory retained by both versions, not only the live map.

The structural candidate is to preserve unaffected sector-derived work during COW. A shallow copy of `Tiles` is unsafe: region/island arrays, mutable node fields and caches can still affect the old snapshot. Establish ownership of every mutated field, and prefer a small explicit clone of necessary state over a general cache framework. The parent is preparing a COW full-match experiment and proof; expand the macro scene after evidence supports the candidate.

### Next priority: arrival geometry is per-slice, despite a per-search description

`src/shared/ship-navigation.ts:554-563` prepares up to eight goal-only arrival arcs, checking hull placement, traffic and swept passage. Baseline `planShipRouteImpl` invokes it at `:916` during initial preparation and again at `:927` on continuation entry. Each resume can therefore repeat the same target geometry, including resumes far from the destination or still processing entrance work. The comment describes reuse per search, but the lifetime is per invocation/slice.

Parent-reported experiment status: deferring construction until actual use has already been tried once and showed no global improvement. This weakens the simple eager-initialization candidate; it does **not** resolve repeated construction across slices of the same long-running search. Do not repeat that lazy-only experiment or claim it succeeded.

Measure arrival builds per ShipRouteSearchState identity, actual closure uses, repeated arc hull-check duration, and how many slice builds are never used. Only the built-in frozen-traffic live planner offers a straightforward equivalence boundary for retaining the derived closure. Arbitrary externally supplied callbacks may have observable calls or changing results; trafficBlocked and custom callback behavior must remain intact. Budget, expansion order, completion tick and chosen route must remain identical.

### Search continuation repeatedly serializes its own derived working set

At `ship-navigation.ts:956-965`, every resume reconstructs reached-node lookup and replays old stamps, costs and parents into the shared workspace. At `:974-978`, pause materializes nodes, trafficFits, heap, prefixes and entrances again. Each slice expands only 128 states with traffic or 4096 without. For a search accumulating V states in K-state slices, accumulated old-state transfer can approach O(V²/K), although the present 1.76 million restored-node count alone does not establish that it dominates measured CPU.

Count cumulative restored nodes versus newly expanded nodes per job; time restore and pause separately; measure peak concurrent jobs and graph bytes. A live job can conceptually own its runtime graph across slices, avoiding repeated transfer. It must preserve exact heap order and all existing snapshot/reconstruction semantics, and must not keep an unnecessary second complete graph alongside serialized state. This remains a candidate pending causal timing, not an instruction to add a large cache system.

### Duplicate exact terrain-query census before further caching

Potential repeated callers include `sailing.ts:136` coastal-course classification, `:171` straight-course checks, connector/refinement checks and physical execution. Establish exact repeated-query counts and saved-time upper bounds before implementation. A geometry key must include terrain identity/content validity, map dimensions and cell size, actual hull profile, both endpoints' x/y/heading, and destination pivot/curvature. Do not classify the three distinct tracking-margin corridor sweeps as duplicates. Report duplicate elapsed-time share per peak tick, not just raw call counts.
