# Spirits do not bleed: original game integration proof

This independent evidence follows the spirit redraw proof without editing or replacing it. It verifies a client presentation rule: spirits produce no blood, while their `nonMechanical` combat class, damage, health, cooldowns, lifetime and all simulation behavior remain unchanged.

- Before: `d7c7f4bf93ffd8364a1ee6ef0c6170ca442657a8`, frozen `/tmp/sketch-spirit-no-blood-before`.
- After: `77a2c3078b1f14c02f1058dc22fd31a80f9dd314`.
- [After selected-frame video](after/gameplay.mp4), [before selected-frame video](before/gameplay.mp4).
- [After actual heavy hit, 21 HP](after/frame-003.png), [before the same heavy hit](before/frame-003.png).
- [After death/landing interval](after/frame-020.png), [after 6 seconds since death](after/frame-023.png), [after 9 seconds since death](after/frame-028.png).
- [Unchanged physical and mechanical controls](after/frame-033.png), [Canvas actual heavy hit](after/canvas-003.png).
- [Strict comparison](comparison.json), [before original proof](before/proof.json), [after original proof](after/proof.json).

## Native spirit scenario

An actual `summon` command creates the original 85-HP spirit, with its original 60-second lifetime. Its caster leaves using the original scripted-exit API. An enemy footman receives a real attack command. Native attacks deal six actual 16-damage hits: `85 → 69 → 53 → 37 → 21 → 5 → -11`. The spirit retaliates using its normal attack and naturally dies on tick 112. No HP, attack damage, cooldown, unit class, lifespan or animation is edited; no synthetic hit effect is injected.

The old client visibly reproduces spirit blood: maxima are 6 airborne droplets, 18 ground marks and 2 body marks. The new client has **zero airborne, ground and body blood throughout all 303 original ticks**, including interpolated samples and the independent Canvas tracker. The original game continues for 190 ticks (9.5 seconds) after the natural death, covering the complete nine-second residue lifetime. All 30 selected native GPU captures also have zero blood-ink instances.

The original hit effects still report `targetKind: spirit`, `targetUnitClass: nonMechanical`, the same 16 damage and the same near-lethal/lethal HP. The change is only the client blood decision. Full complete snapshots, original commands, positions, ticks, effect fields and death records are equal between versions; drawing never changes the simulation checksum.

## Independent controls

The physical-control scene uses explicitly scripted original `strikeUnit` damage calls against untouched full-health units. These calls exercise the original damage/hit pipeline and are deliberately documented as scripted damage, rather than a new combat rule or native equal-damage duel. Footman and wildling targets still emit airborne/ground blood and keep body stains; a genuinely close-to-lethal granite golem hit remains mechanical and emits no blood.

The neighbor scene uses a real footman hit emitted by that same original damage pipeline. A nearby actual summoned spirit receives no transferred blood even when actual airborne droplets pass within 2.78 world units in XY. A separate ordinary footman receives transferred blood while remaining at full HP and never appearing as the target of a hit event. Its stain therefore comes from a neighbor's droplets. This scenario verifies blood passing near a spirit; the accompanying focused `BloodContacts` test verifies the exact swept-contact exclusion against the spirit's position.

The two control scenes have identical full presentation records between versions. All 44 control PNGs across WebGL and Canvas are pixel-identical, including the retained physical blood, independent of the new spirit policy.

## Strict results and provenance

Each version saves 52 WebGL and 52 Canvas PNGs and **685 complete simulation snapshots**: 303 native-spirit ticks plus 191 ticks for each independent control. All 22 strict comparison checks pass. Channel-by-channel comparison of 104 before/after image pairs finds differences only in the 25 native-spirit captures that previously contained blood, across both renderers. The other 54 image pairs are exactly equal. There is no arbitrary pixel mask or permitted-difference rectangle in this comparison.

All source bytes are archived in each `source.tar.gz`; full SHA maps match at start and end. Each Git HEAD is stable during its run, and `src/shared`, `src/ai` and `src/server` trees and rule-diff hashes are equal. The source epoch also includes two independent client optimizations—an obstacle hit-index call and minimap cache—but no authoritative changes. Neither changes the observed scenarios. Both runs have zero GL errors, runtime errors and network loading failures. Their independently prepared Three optimizer roots each use one consistent dependency query version.

Executed driver/fixture and comparison scripts, raw snapshots, every PNG hash, MP4 hash and original run logs are retained. The prior d7 spirit redraw/gameplay evidence remains intact.

## Reproduce

```sh
node --import tsx scripts/art-spirit-no-blood-proof.mjs \
  --source /tmp/sketch-spirit-no-blood-before --expect-spirit-blood yes \
  --out NEW/before/proof.json
node --import tsx scripts/art-spirit-no-blood-proof.mjs \
  --source /workspace/sketch-rts-viewport --expect-spirit-blood no \
  --out NEW/after/proof.json
node scripts/art-spirit-no-blood-compare.mjs \
  --before NEW/before/proof.json --after NEW/after/proof.json \
  --out NEW/comparison.json
```

Output folders must be new; existing evidence is never overwritten. These are untimed Chromium 151/SwiftShader captures with a preserved GPU proof buffer. The video shows selected evidence frames, with original tick labels, rather than real-time replay. This proof makes no performance or hardware-GPU claim.
