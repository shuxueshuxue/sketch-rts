# Terrain multi-source distance boundary proof

Production terrain at `0f31f16c` is unchanged. `proof-summary.json` pins the source, proof test and original log SHA-256.

Command:

```sh
npx vitest run src/shared/terrain-multi-source.test.ts --maxWorkers=1 --minWorkers=1
```

Nine tests passed in 461 ms, including 500 deterministic random cases. The test compiles the actual private `createRuntime`, `runtime`, `grow`, and `exactField` with test-only exports. Every single-source `dist` is copied immediately before recycling its uncached scratch field through `spare`; the expected minimum therefore cannot be overwritten by the later multi-source grow. The minimum is compared at every padded cell, including unreachable and blocked cells.

## What is equivalent

For valid walkable source cells, `grow(state, sources).dist[cell]` equals the minimum of `grow(state, [source]).dist[cell]` for each source. An empty valid set yields `UNREACHED` everywhere. Reordering and duplicate source cells do not change the minimum; normalize and deduplicate before passing them to grow.

The relevant graph has walkable cells as vertices, orthogonal edges of cost 5 and diagonals of cost 7 where both adjoining orthogonal cells are walkable. All costs are positive, so a shortest path from any source is exactly the minimum of its single-source paths. Production `grow` implements this graph directly. It ignores the runtime's terrain pace weights: mud and shallow ground retain the same 5/7 road cost as grass. This proof supports `walkingDistance`; it does not support replacing weighted `groundTravelCost`.

The proof also compares the resulting scalar `(cost * terrain.cell) / 5` with `Math.min(Infinity, ...goals.map(goal => walkingDistance(...) ?? Infinity))`, including subcell coordinates, blocked goals, map bounds, NaN and infinity. It supports a distance-only query. It does not choose a base identity or preserve a requested base's route/next-step behavior at a tie.

## Source and geometry boundaries

- The private grow does not validate source cells. A blocked seed receives distance zero and can spread into open neighbours; this differs from public `walkingDistance`, which returns undefined for a blocked goal. Filter with the **existing runtime's** `walk`, integer padded-index bounds, and deduplication. Off-map/padding/NaN inputs are not grow sources.
- A new `Terrain` object creates a new runtime and refreshes both single-source and multi-source results. Changed source-cell sets require a new field. The test covers added, removed, moved, reordered, and empty base sets.
- Existing runtime caching is keyed by terrain object identity and mover. Replacing `cells` on an already warm object does not rebuild its runtime; the old API remains stale. A candidate must not silently use a fresh runtime in this case and thereby change existing behavior. The supported refresh protocol is replacement terrain identity. This work does not fix the broader mutable-terrain contract.
- Building obstruction revisions and snapshot COW do not belong in this **terrain-only road distance** key: `walkingDistance` uses `runtime`, not `routing`. Owner/team selection stays in the caller's source list.

## Ownership and cache behavior

`grow` initializes the existing eight bucket arrays if needed, zeroes/drains their tops, and obtains a field with `spare.pop()` or new arrays. It overwrites that field's `dist` and `next`. Calling grow directly does not insert into `fields` or advance the cache clock. A returned uncached field is not later returned to `spare` by the existing single-field LRU; the proof retains such a field unchanged through cache churn.

By contrast, retaining `exactField(...).dist` as a long-lived getter buffer is unsafe. At 128 cached fields, that field can be evicted, pushed into spare, then rewritten for another target. The test demonstrates the overwrite and verifies that calling `exactField` again rebuilds the correct original distance.

For one valid source, a getter should call the existing public `walkingDistance` per query; holding a borrowed cached buffer adds an ownership hazard without a field-build reduction. For multiple sources, a lazy invocation-local field could own its uncached distance buffer; return scalars and keep that buffer out of the single/weighted numeric-key cache and its recycling pool. Construct only on the first actual eligible query. In `shoreSpot`, do not eagerly build the enemy field before the existing own-distance short-circuit, or build either field when no shore point is queried.

This is a correctness proposal, not a recommendation to adopt unmeasured rebuilding. Warm single-source caches can be cheaper than constructing a new multi-source field; invocation-local buffers can add allocation pressure. Root's measured cold/warm workload should decide whether any production candidate is worthwhile. No cache capacity, simulation rule, planning frequency, production API or old evidence was changed.
