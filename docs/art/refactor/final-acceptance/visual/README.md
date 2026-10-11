# Final-source combat and projectile visual acceptance

Executed sequentially against HEAD `8d6e6dba2a8f588e46b7b64a835eaafcfa60b2ab`; production source and the four proof runner/fixture files match `7b8186e`. Both processes exited zero and completed browser/Vite cleanup. Original proof fixtures, frame counts, camera inputs and assertions were retained. Previous proof directories were not overwritten.

[Source manifest](source-manifest.json) records start/end UTC, commits, source tree, commands and SHA-256 for 1,043 source/script/dependency files before and after execution. All hashes matched; the production diff against `7b8186e` was empty. It also records hashes for the 18 generated JSON/log/PNG/MP4 outputs (the manifest itself is excluded).

| Proof | Result |
| --- | --- |
| [Combat JSON](combat-effects-proof.json) / [log](combat-effects-proof.log) / [video](combat-effects-proof.mp4) | Passed; browser errors `[]`; WebGL error `0`; shader diagnostics runnable; mechanical target body blood `false`. 48 land/building frames plus 32 deck frames, two native simulation ticks per frame. |
| Building occlusion negative control | Depth enabled: 0 changed pixels behind the tower; deliberately disabled: 71. |
| Deck lifecycle | Six settled raised marks; deck and airborne ink clear after the hull is gone. |
| [Socket JSON](projectile-socket-proof.json) / [log](projectile-socket-proof.log) / [video](projectile-socket-proof.mp4) | Passed; browser errors `[]`; WebGL error `0`; three native release paths observed across 24 ticks. Maximum authored tip/orb-to-trajectory error: `0.00002607111130954056` world units. |

Visual review performed on the generated images:

- [Combat frame 5](combat-effects-proof-5.png): charge strokes follow travel, actors and held equipment remain readable, and no obvious new detached ink was observed. The visibility of a given small mark is also constrained by scene depth; the numerical occlusion control above supplies the explicit check.
- [Combat frame 65](combat-effects-proof-65.png): crew and retained marks share the raised ship scene; no obvious off-hull hovering stain was observed at the captured view.
- [Combat frame 79](combat-effects-proof-79.png): the ship has sunk; raised ink is gone, leaving the intended sinking/wreck presentation.
- [Socket frame 12](projectile-socket-proof-12.png): upward archer, level mounted archer and downward priest use distinct local gestures. Their projectiles follow those release directions. The upper target extends beyond the fixture's top crop; this is framing, not evidence of atlas clipping.

These are fresh functional and selected-frame visual checks, not a rendering-performance measurement or exhaustive proof against every possible contact/occlusion problem. The unchanged fixtures do not exercise all recently fixed boundaries: same-tick successive strikes, the Canvas recovery-facing mark, a survivor leaving a subsequently lost deck, and death-time equipped socket recovery have focused regression tests documented in [the animation audit](../../followup/animation-audit.md). No simulation coordinates, flight durations, damage, event cadence, RNG or AI rules were changed for these proofs.
