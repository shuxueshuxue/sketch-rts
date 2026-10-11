# Creature gait follow-up

Baseline `b2f74b7`. All 21 creature painters are shown at all eight walk phases in `before/` and `after/`; `before-after.mp4` stacks baseline above candidate, at eight phases per second for eight cycles. This is a slowed painter review, not simulated traversal footage. `world-proof.mp4` is the real simulation and renderer with attack commands.

The previous drawing moved every foot horizontally while leaving its height fixed. The candidate lifts only the returning foot, using the existing distance-driven phase. Stone feet, root contours, fleshy ankles, paws, hooves, claws and spider tips retain their respective authored shapes. Turtle front/rear phase alternation is corrected. Spirit remains floating. No IK, reach clamp, weapon/ground constraint, hit timing or simulation change.

420 idle/attack/cast PNG SHA256 values are identical between the manifests. The real-world proof passed without browser or GL errors; 17 of the 21 creatures entered walk in that battle, while the eight-phase painter sequence covers all 21. The four without real walk in that scene are dragonWhelp, ogreMage, murlocHunter and tidePriest. Visual review of phases 0 and 3 covers the complete roster; supported feet and swinging feet separate, claws remain attached, and no new domain clipping is visible. This does not establish perfect ground locking at all speeds or stop transitions, nor replace user art acceptance.

Validation: 14 art test files / 144 tests passed; TypeScript and production build passed. Reproduce with `node --import tsx scripts/art-creature-gait-review.ts before` at baseline, `... after` at candidate, and `node --import tsx scripts/combat-effects-proof.mjs --fixture scripts/art-creature-world-fixture.ts --out docs/art/refactor/followup/creature-gait/world-proof.json`. Encode the two eight-frame PNG sequences at 8 fps with ffmpeg vstack for the comparison movie.

Performance measurements belong to the separate frozen `creature-performance/` pair; this additional gait change is not silently substituted into those results. Library download delivery remains blocked by hosted-tool HTTP 401; repository media are local deliverables, not public links.
