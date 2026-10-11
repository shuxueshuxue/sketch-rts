# Animation and combat presentation audit

Audited source: main `9de6820`, plus the focused fixes listed below. This is a source-path and automated-regression audit, not a new browser visual approval or a performance result.

## Actual paths traced

- `shared/sim.ts`: innate ranged `launchProjectile`, equipped `fireWeapon`, melee `applyAttackDamage`, charge impact, native heal/summon/curse/stomp/bloodlust/web, veteran and item releases → existing WorldEffect with `sourceId`, `actionMode`, release tick and available actual endpoints/elevations. Impact `hit` does not retrigger launch animation; its `unitId` identifies the victim, not the attacker.
- Campaign Powers and scripted arrows → Stage `unitAction` at actual release, plus projectile metadata where relevant. Stage retains one recent cue per living actor, not unbounded history.
- Main Canvas `drawWorld`, GPU `World3DLayer`, recorder and story renderer → animation tracker; projected action vectors → facing lock → finite direction pose/cache key. GPU/Canvas projectile origins resolve the shared release pose/socket. Renderer-specific foot adapters remain necessary.
- MenuBackdrop contains actual simulation, including woods combat. It previously passed animation but omitted combat/projectile trackers. This audit adds both trackers to its WorldFrame and resets them when beginning/restarting a scene. Static portraits are untouched.
- `addHitEffect` captures each impact's actual damage, post-hit HP, class, kind/radius and deck metadata. Both physical projectile impact paths pass original projectile launch coordinates, rather than the shooter's later location. No extra simulated effects, IDs or random draws are required.

## Concrete defects fixed in this audit

1. Animation ignored WorldEffects appended after its first draw of a tick. Reproduction uses actual `strikeUnit`: observe tick zero, strike right, observe again at tick zero, strike left, observe again. Previously both immediate poses stayed idle. New release identity tracking consumes additions without moving the gait/clock, preserves the newest same-mode direction, and gives a simultaneous cast precedence over an attack. Cooldown observations are synchronized on consumption, preventing the following tick from inventing a second release. Stage cues retain precedence and repeated observation preserves the locked direction object.
2. Combat presentation had the equivalent same-tick early return. It now consumes newly appended hit records once while retaining existing speed-line observation and interpolation clock. Regression uses two actual strikes: a light injury then a qualifying near-lethal injury, duplicate observation and the next tick. Particle time is not restarted.
3. Real menu simulation omitted the new trackers. Added lifecycle wiring as described above.

Neither fix changes simulation, action timing, damage, IDs or RNG. Same tick with the identical effects array and count remains a fast return. Event contents are assumed immutable once emitted, matching the existing projectile origin tracker contract.

## Direction, reuse and equipment boundaries

- True release direction survives later target death and order changes through recovery. Vertical vectors keep the latched side; height differences project through the camera rather than treating deck shots as flat XY. Missing height is not invented. `releaseFacing` is read-only; the next actual action updates its lock through `actionFacing`.
- Same-tick opposite strikes now update facing immediately when the renderer consumes the new frame. No facing algorithm change is required. Existing tests exercise near-vertical deadzone, projected vectors, new orders during recovery and clearing the lock after completion.
- Native movement/cooldown observation remains available when an event has no direction, including incomplete older snapshots. No arbitrary target guess is made. Socket resolution intentionally returns undefined for incomplete release metadata or absent elevated shooters without captured deck facts; native hardpoints remain authoritative. These are explicit input limitations, not a second unit-painting implementation.
- Actual pickup/wield commands drive `appearanceFor`, choosing equipment and motion family without altering combat rules. Compatible figures share `sampleMotion`. Same actor/weapon gets three deterministic attack variants; cast is independently sampled. Explicit slash/thrust family selection is a composer API verified in rig tests, not a new player command or combat mechanic.
- A projectile socket is cached on first observation of its effect ID. Later equipment/facing/radius changes cannot move an already launched shot. If the first observation occurs only after equipment changed, release-time equipment cannot be reconstructed from the current event. This is a real remaining snapshot limitation.
- Follow-up projectile fix uses captured death-time equipment and owner race when the shooter is already absent at first observation. Captured corpse deck facts allow the original event elevation to supply the crew floor offset; later hull/corpse movement never changes the cached origin. Older corpses without equipment facts keep defaults; elevated sources without deck facts keep the original hardpoint. These are death-time facts, not an invented release-time equipment snapshot.
- Story-specific painters previously ignored runtime equipment overrides. Parent assigned the live-painter/cache/socket fix to the rig lane; this document does not certify that lane's unfinished work. `ProjectileOriginTracker` already passes presentation to `resolveReleaseSocket`; the authored-model release callback must receive it too.
- Recovery is six finite contact-to-ready samples; it never plays a long windup after the hit. It is not continuous cross-fading between arbitrarily interrupted actions. This audit does not claim that every contact/weapon clearance has been visually verified.

## Blood and motion constraints verified

Eligibility requires actual non-mechanical unit metadata and HP after this hit ≤ twice its actual damage, including lethal hits. Missing facts, mechanical targets, zero damage and light injuries do not bleed. Presentation reads do not change snapshots/checksums/IDs. Blood uses deterministic event-ID/birth-tick seeds, directional velocity, gravity and calculated landing positions. Ground fades over nine seconds; surviving-body marks over six. Paused interpolation advances at most one tick; rewind/reset drops visual history.

Speed lines use real charge or sufficiently fast forced displacement. Ordinary walking, stationary transported crew, teleport-sized jumps and stun are excluded. Deck-local displacement rotates by actual hull heading (90-degree regression exists). Deck droplets and ground marks follow the hull and clip at its surface; water impacts are not simulated.

Budgets remain explicit: 48 active bursts, 96 retired residue bursts, up to 10 drops each, 128 lines, 2,048 remembered hit IDs. Capacity pressure can retire airborne drops or evict oldest stains before their full lifetime. Body stains disappear on death; blood already on a corpse is not retained as a separate skin layer. When a hit's original hull is gone, that burst is discarded; a survivor who has since left that hull can consequently lose its associated body mark. These are remaining visual limits, not claims of exact fluid simulation.

## Validation and timing

- `/tmp/animation-audit-tests.log`: 5 files / 72 tests passed at 12:38:49 UTC on 2026-10-11 (1.85 seconds): animation 29, facing 11, projectile origins 6, combat presentation 22, actual simulation release metadata 4.
- Actual coverage includes strikeUnit damage/HP/class, post-hit per-event values, moved projectile shooter, deterministic checksums, same-tick strike/cast/Stage interactions, target loss, equipment changes after release, deck blood and heading, pause/reset and bounded residue.
- After profiling ended, `/tmp/animation-audit-final-tests.log`: 7 files / 79 tests passed at 12:42:04 UTC (5.30 seconds), including the facing assertions, menu lifecycle/reset test and recorder determinism. Baseline confirmed its profile began at 12:39:50, after the previous 72-test run, so neither run overlaps that exclusive profile. Subsequent rig-lane integration retains its own verification responsibility. No new browser recording or performance measurement was started by this lane.
- Full `tsc --noEmit` was attempted (`/tmp/animation-audit-typecheck.log`): no errors in this lane's changed modules; three errors in concurrent rig-lane changes (`shared-caster-skins.test.ts`, `unit-appearance.ts`, `world-renderer.ts`) were sent to that owner. Global type-check success is not claimed by this audit until those are fixed and rechecked.
- Corpse-origin follow-up: `/tmp/projectile-death-facts-tests.log`, 2 files / 14 tests passed at 12:49:50 UTC, after baseline released the profile window. Includes real pickup/wield bow then death, actual boarding then death before first observation, moved hull, cached-origin identity and old-corpse fallback. Global strict checking is coordinated with the GPU lane to avoid duplicate runs.
