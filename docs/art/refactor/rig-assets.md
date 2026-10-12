# Figure and creature migration

The live catalogue and its selection cards now share the same authored composer. The previous `units-common/grove/ember/neutral/creeps` inline painters are removed; `kit.ts` contains only the primitives and scenery accents still used by buildings, maps and story decoration. The implicit Canvas-context `pose.ts` / WeakMap path is removed.

## Responsibilities

- `appearance.ts`: body silhouettes, clothing roles, armor, mounts and creature anatomy. Identity does not change when an item is equipped.
- `motion.ts`: finite shared, immutable poses, sampled from snapshot animation events. No random source or simulation mutations.
- `rig.ts`: explicit primary shoulder/elbow/wrist chain, fixed 11 / 10.5 segment lengths, two-hand reach constraints, equipment socket transform, and compatible motion selection.
- `body-parts.ts`: skin, limbs, boots and joint detail.
- `equipment.ts`: local weapon geometry, grip attachment, supporting hands, shield material and surface details. Sling/javelin releases, bow string/nock and staff effects use the same local grip transform as the hands. Greatswords suppress shields.
- `materials.ts`: shared warm grazing light, cool shadows and deterministic dry-brush grain; distinct authored finishes for cloth/metal and hide/stone, plus quiet remains and inventory colors. Grain uses the same mark counts, with two batched stroke paths instead of one path per mark.
- `painted-units.ts`: composition of ground legs/mount, upper body, equipment, head and explicit detail layers. Catalog cards call this composer directly.
- `painted-creatures.ts`: separate anatomies for quadrupeds, spiders, heavy bipeds, fish, spirits and winged creatures. Boats are removed from this domain. Ogre clubs/staves and fish javelins/staves now follow their hands; the former static duplicate dragon head no longer covers the animated jaw.
- `warfare-units.ts`: machinery wheels/recoil consume an explicit siege motion; sailing portraits stay in their separate hull painter.
- `unit-appearance.ts`: read-only projection of existing `activeItem` hand state to visual equipment. Cache identity includes equipment, shield, motion, clothing, headwear, appearance flags and stable detail function identity.

## Review and checks

Run `npx tsx scripts/art-rig-review.ts` to reproduce `after/rig-equipment-actions.png` and `after/creature-rigs.png`. The human sheet shows the same footman's body with sword, axe, greatsword, bow and staff; another body sharing slash; mounted pikes; independent cast, deterministic contact variants and return to ready.

`npx vitest run src/client/art/rig.test.ts src/client/art/painted-creatures.test.ts src/client/appearance-integration.test.ts` passes 32 checks. These check bone lengths, reachable support sockets, all-catalog coverage, raster-different attack variants and idle frames, independent cast, exact last-frame/ready recovery and presentation cache identity. Static raster checks do not establish perfect contacts at every world angle or cadence; browser recordings and runtime checks remain part of the parent integration review.

The native human bone rig accepts presentation-only equipment swaps. Non-humanoid bodies retain anatomically authored equipment rather than being forced into human arms. Existing `canEquip` rules can allow owned non-humanoids to carry items; not every such gameplay item has a compatible visible attachment on every creature. The initial stage had no death-time inventory facts. The completed [equipment follow-up](final-equipment/README.md) now captures current issued weapon, greatsword, round shield, owner race and deck attachment before dropping items; older records retain defaults. These are death-time facts, not a release-time inventory history. This migration does not change equipment, attack, spell, AI or economy rules.

Issued-weapon item rendering now passes each actual item’s `weaponKind` through world drops, inventory buttons, equipment slots and drag ghosts. These use the same weapon geometry as held figures; generic shop previews without an item source remain a generic sword study. Dedicated tests and final root verification cover this consumer correction.

Story-model world rendering and release/remains composition accept real gear. The application currently has no live campaign HUD/model context: story drivers inject models in the recorder. Consequently the ordinary selection/cargo UI is a catalog-unit consumer, and this work does not claim a newly added story-portrait interface.
