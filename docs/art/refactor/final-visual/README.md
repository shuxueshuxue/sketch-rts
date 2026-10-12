# Final browser visual verification

Executed on 2026-10-11 in the `sketch-rts-units` worktree with the final CPU canvas/cropped card cache and read-only release-facing integration. These are functional checks, not performance measurements. Earlier `after/` evidence remains untouched.

| Verification | Result | Evidence |
| --- | --- | --- |
| Live combat, building occlusion and ship deck | PASS; hidden-body region changes 0 pixels with depth, 71 pixels in the deliberately incorrect no-depth control; six deck residues, cleared after sinking | [JSON](combat-effects-proof.json), [8-second video](combat-effects-proof.mp4) |
| Upward archer, level mounted archer, downward priest releases | PASS; maximum authored tip/center trajectory error 0.0000261 world units | [JSON](projectile-socket-proof.json), [video](projectile-socket-proof.mp4) |
| Normal game UI and weapon change | PASS; map/room entry, unit selection, real movement, equipment UI wield action; server right hand and client Greatsword label agree | [JSON](gameplay/gameplay-proof.json), [world](gameplay/gameplay-weapon-world.png) |

Both rendering fixtures report `glError: 0`, all shader programs runnable, and empty browser error lists. The gameplay suite records no runtime/console errors; it does not independently query WebGL errors. All runners exited successfully and released their browser/server processes.

Visual review covered combat frame 5, deck frame 65, socket frame 12, and gameplay equipment before/after plus the final world. Buildings obscure attached marks; residue stays on the deck. The equipped footman drops the shield and holds the greatsword with both hands, matching the equipment preview and selected-unit portrait. No clipped weapon or detached limb was observed in those reviewed frames. Eight gameplay screenshots and both fixture frame sets are retained; this sampled review is not an exhaustive claim about every animation frame.

Reproduce:

```sh
node --import tsx scripts/combat-effects-proof.mjs --out docs/art/refactor/final-visual/combat-effects-proof.json
node --import tsx scripts/projectile-socket-proof.mjs --out docs/art/refactor/final-visual/projectile-socket-proof.json
node scripts/art-gameplay-proof.mjs --suite art --port 34615 --out docs/art/refactor/final-visual/gameplay
```
