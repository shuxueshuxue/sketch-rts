# Dragon head and neck revision

Scope: only `dragonBody` in `src/client/art/creature-painters.ts`. The shared wing, pose generator, release socket, anatomy scale, other creature painters and combat rules are unchanged by this lane.

- Broader neck root tapers into a low, angular reptilian skull instead of a thin upright stalk.
- Long narrow muzzle, continuous brow ridge and small amber eye replace the round cheek / oversized eye of the rejected first draft.
- Idle mouth is a thin closed seam; dark mouth opening follows actual attack/cast action strength.
- Adult horns are a separated swept pair; whelps retain short growing horns. Existing washed red/brown palettes and body/wing silhouettes remain.
- The front mouth corner remains `p.release`, so attack/cast aim and flame/missile launch points retain their existing coordinates.

Run `node --import tsx scripts/art-dragon-face-review.ts after` to reproduce [after.png](after.png). [before.png](before.png) was captured before this lane's changes. The sheet uses production `drawAtlasUnit`, catalog radius / glyph scale, both mirrored silhouettes, ±60° contact and casting, and production portraits at 48 and 96 pixels. No enlarged concept rendering substitutes for the native-size review. At 48 pixels the horn/muzzle silhouette carries the distinction; tiny eye details naturally have limited resolution.

Validation: dragon-specific tests render both species in 13 directions, attack/cast and both mirrors, checking that the existing mouth release touches painted pixels and that pixels remain inside the production atlas domain. They also preserve ready mouth coordinates and compare dark mouth coverage at rest versus contact. Existing creature tests verify impact, intermediate recovery and exact return to ready pixels.

Logs: `/tmp/dragon-face-tests.log` (25 tests passed across dragon and existing creatures); `/tmp/dragon-face-final-tests.log` (final dragon-only rerun after enlarging the test's inspection canvas to avoid cropping its comparison). Root owns final integrated typecheck/build and visual acceptance. No performance improvement is claimed, and this lane did not change the wing/body silhouette beyond the head-neck junction.
