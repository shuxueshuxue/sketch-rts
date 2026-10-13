# Obstacle hit feedback reuses the existing first-hit index

`drawObstacles` previously scanned `snapshot.effects` once for every obstacle,
before checking whether the obstacle intersects the viewport. The unit and
building paths already reused `PresentationViewIndex.hits`. This change passes
that same index to the obstacle path. The index preserves the original first
matching hit, including two or three concurrent hits on the same obstacle.
There are no simulation, painting, culling, quality or combat rule changes.

## Actual Canvas parity

Run from the repository root:

```sh
node --import tsx scripts/art-obstacle-hit-index-proof.ts docs/art/refactor/followup/obstacle-hit-index/v2
```

The proof uses separately bundled **complete** before/after `world-renderer`
modules over identical dependency source bytes. Both execute the real
`drawWorld` entrypoint on native Napi Canvas with independent art caches and
presentation indexes. Original module snapshots, bundle bytes, dependency
hashes, PNGs and full results are retained. Dependency and candidate hashes are
checked again after execution. This is native Canvas evidence, not browser/GPU
evidence.

Six identical scenes cover 2/3 repeated hits and remaining ticks 14/10/6, visible
rocks and gate with HP bars, a damaged selected building, a selected soldier and
a hovered opponent. Each scene additionally contains 1,000 offscreen obstacles
and 1,000 unrelated effects. All six before/after pairs have zero changed RGBA
channels, equal authoritative fact hashes and the correct first-hit object.

For the two-hit scene, the actual renderer performs 1,002 `effects.find` calls
and 1,006,003 predicate visits before the change. Afterwards there are zero
`find` calls/visits and 1,005 indexed `get` calls, including the existing three
unit/building lookups. Index construction still traverses the effects once on
a changed snapshot. It is not removed and event history remains intact.

`v2/proof.json` contains the final counts. The initial proof and its executed
script remain intact: its after `mapGets` also included two **post-render**
first-hit assertions. V2 uses unobserved `Map.prototype.get` for those assertions,
so its counts describe only `drawWorld`. The production candidate is identical
in both runs.

## Local CPU measurement and validation

V2 alternates before/after execution order, warms each actual Canvas renderer
for 10 calls and retains 40 calls per arm. Timed calls have no counter wrappers;
readback and PNG encoding occur outside timing. Mean local `drawWorld` cost was
9.969 ms before and 0.650 ms after (p95 11.084 / 1.313 ms). This deliberately
stresses the removed obstacle/effect nested scan. It is **not** total frame time,
FPS, GPU timing or a claim about ordinary battlefield performance.

Existing validation completed successfully:

```text
npm test -- --run src/client/presentation-view.test.ts src/client/world-renderer.test.ts
Test Files  2 passed (2)
Tests       26 passed (26)
```

No new implementation-mirroring unit test was added. The final PNG was visually
inspected; obstacle bodies/HP bars, unit selection/hover and building selection
remain present. Broader final-branch tests and browser validation belong to the
parent lane's final combined verification.
