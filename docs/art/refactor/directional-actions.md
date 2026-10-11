# Directional action rendering

Implementation worktree: `sketch-rts-units`. This stage changes presentation and must be measured independently from the frozen art refactor baseline. It also follows the separately authorized shared-caster catalog changes; its timings are not interchangeable with an earlier ruleset.

The body retains two mirrored silhouettes. Attack and cast targets are captured at actual release/contact by `UnitAnimationTracker`, and survive target death or a new order during recovery. Direction includes a height delta only when both endpoint heights are known. `UnitFacingTracker.actionFacing` holds the side for that action; a nearly vertical target keeps the previous side.

`art/action-direction.ts` projects the captured vector into the actual view and chooses one of thirteen samples, -90° through +90° at 15° intervals. Negative means screen-up in the right-facing authored rig. `motion.actionDirection` selects one of three authored source planes (up -60°, level 0°, down +60°), plus no more than 30° of terminal correction. Equipment, upper-body gesture and hand positions receive that correction; feet and the whole body are not rotated toward the target. Attack variants remain independent of aim.

`rig.ts` authors different grip targets for shafts, bows, staves, blades and unarmed gestures. The two-hand grip is solved in the intersection of both shoulder reach discs before either arm is solved. Both hands attach to one rigid tool and keep fixed upper/lower bone lengths. The elbow branch stays constant through recovery. The near support arm and shield remain in front of the torso while upward contact tools pass behind it. Story equipment detail hooks follow the same layer and sockets.

Nonhuman figures retain their native anatomy: giants and fish steer their arm/tool chain; quadrupeds steer the neck and bite; spider mouthparts and spirit shapes change locally. Ships retain their ship-specific hull and weapon expression, rather than using a humanoid skeleton.

Canvas units, story models and WebGL cards use the same `animationKey`. Idle, walk and the final recovery sample discard aim; the final attack/cast sample shares the ready key. Direction samples are rasterized only on demand. `actionPaintSize` reserves 160 art units for active combat poses and 128 for other poses. Canvas and WebGL retain cropped pixels; WebGL pools rectangular power-of-two layers with a per-card transform that preserves the original world anchor. Cache identity includes the source domain and density. Density is unchanged. A 160-square scratch source uses 56.25% more pixels than a 128-square source at equal density, but retained texture cost depends on the actual alpha bounds. New stage measurements must report both the working set and cold-cache cost.

Verification sources:

- `src/client/art/action-direction.test.ts`: all thirteen directions; projection and height; arm lengths and rigid support sockets; all equipment bounds; native creature and mounted bounds; distinct source poses and exact ready endpoints.
- `src/client/world3d/painted-card-batches.test.ts`: mixed-size texture pages, identical foot anchor, precise alpha picking outside the smaller domain.
- `scripts/art-direction-review.ts`: full attack/cast equipment contact sheets and native/mirrored anatomy sheets.
- `src/client/art/shared-caster-skins.test.ts` and `scripts/art-shared-caster-review.ts`: owner faction, actual equipped appearance, portraits and corpse cache separation.

Validation completed on 2026-10-11: the focused run below passed 9 files / 85 tests (12.48 seconds wall time, not a rendering benchmark). This includes all thirteen directions, both action modes, native/mounted bounds, bone lengths, the added downward foot-plane constraint, release metadata, corpse regressions and texture-array picking. The first visual review exposed long downward weapons crossing the foot plane despite fitting the atlas; grip placement was corrected and a separate ground constraint test now covers that failure.

```sh
npx vitest run src/client/art/action-direction.test.ts src/client/art/release-socket.test.ts src/client/art/rig.test.ts src/client/art/painted-creatures.test.ts src/client/art/shared-caster-skins.test.ts src/client/art/raster-cache.test.ts src/client/world3d/painted-card-batches.test.ts src/client/appearance-integration.test.ts src/client/art/story-remains.test.ts --reporter=dot
npx tsx scripts/art-direction-review.ts
npx tsx scripts/art-direction-motion.ts
npx tsx scripts/art-shared-caster-review.ts
```

Generated and reviewed contact sheets are in `directions/attack-all-weapons.png`, `directions/cast-all-weapons.png`, and `directions/native-anatomy.png`. `directions/recovery-and-cast.gif` shows contact-to-ready and cast-to-ready at a deliberately slowed 90 ms per sample. `after/shared-caster-skins.png` compares two owner factions under identical team color.

Shared-caster actual UI training and integrated missile-origin browser reviews have passed; see `unit-consolidation.md` and `combat-presentation-validation.md`. Final integrated regression and independent stage performance measurements remain pending. The Canvas and GPU missile-origin consumers are connected; their integration tests and browser evidence are tracked separately from the 85 art tests above. No performance improvement is claimed for this stage.

`release-socket.ts` supplies a pure authored offset: `{x,y,ground}` before facing mirror and after model/unit scale. It uses the same solved grip, torso lean, body lift, mount transform and story model size as the painter. `storyFigure` / `storyCreature` attach a release callback to the model's paint function, so a campaign character whose simulation base differs from its visual anatomy retains the correct socket. Native ship/engineering models return undefined to retain their existing physical hardpoints.

The effect integration samples this offset once per release event, using its immutable origin, direction and tick. Moving the shooter or changing equipment later must never move an existing projectile. Canvas and GPU map the offset through their own body anchors; crew `fromHeight` contains deck height plus 18 and must not be counted twice. Simulated projectile coordinates, arrival tick, target endpoint and hit rules remain unchanged. Rendering uses first-observed live appearance or, for an absent shooter, captured death-time equipment and owner race. Neither is an authoritative release-time inventory snapshot; changing gear before first observation remains ambiguous and must not be presented as exact reconstruction.

Current corpses additionally capture equipped weapon/shield and deck attachment before items are dropped. The release resolver uses those facts with the event's original origin/elevation, never the later corpse or hull position. Older corpses lacking captured equipment keep authored/default appearance. Elevated absent sources lacking deck facts keep the recorded hardpoint instead of guessing a crew offset. The earlier contact sheets/recordings predate these follow-up fixes; focused regression coverage is documented in `followup/animation-audit.md`, and final-source visual evidence must be labeled separately.
