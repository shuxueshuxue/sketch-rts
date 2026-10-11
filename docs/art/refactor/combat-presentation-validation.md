# Combat presentation validation

Implementation is in the isolated `sketch-rts-units` worktree. No deployment or merge is implied.

- `CombatInk` draws airborne drops, attached marks, raised deck residue and directional speed strokes in one transparent, depth-tested instance batch. It writes no depth, casts no shadows and does not intercept picking. Land residue remains below actors in the Canvas ground pass; Canvas fallback consumes the same presentation records.
- The diagnostic ceiling is 2,096 instances, including up to 1,440 settled marks. Buffers grow by powers of two, are reused after reset, and are released on disposal. No unit-specific blood textures or card cache variants are created.
- Attached marks use the actual GPU crew floor, facing and interpolated position. Deck residue comes from the presentation tracker's ship-local coordinates and disappears with its host.

## Executed evidence

Run `node --import tsx scripts/combat-effects-proof.mjs`.

The production `WorldPresentation` fixture runs 48 land/building frames and 32 deck frames, two simulation ticks per frame. It issues actual charge and damage commands. The output includes [JSON](after/combat-effects-proof.json), an [8-second MP4](after/combat-effects-proof.mp4), [building scene](after/combat-effects-proof-5.png), [deck residue](after/combat-effects-proof-65.png), and [post-sinking scene](after/combat-effects-proof-79.png).

The building probe compares the same rendered frame with ink enabled, ink absent, and ink depth testing disabled. The selected mark is behind `ink-tower`: normal depth changes **0 pixels** in its 12×12 region; the deliberately incorrect no-depth control changes **71 pixels**. The assertions were not relaxed when earlier fixture placements left the target outside the roof silhouette.

The deck scene records six raised residue marks and clears airborne/deck marks after sinking. The mechanical target receives no attached blood. Shader program diagnostics are runnable; browser errors are empty and WebGL reports zero errors. The PNGs have been visually reviewed. These are correctness checks, not performance measurements or claims of pixel equality with Canvas.

Executed focused checks: 82 tests across rendering, cards, shared-faction UI, palettes and ink; another 18 tests covering projectile origins, flight endpoints and Canvas effects. Socket boundary checks subsequently pass 8 tests across origins and flight endpoints. Two subsequent full-tree typechecks passed; final regression/build is coordinated by the parent lane.

## Release sockets

`ProjectileOriginTracker` captures the shared rig's frame-zero release socket on the first observed event ID. It uses the event's fixed firing coordinates and action metadata, never the shooter's current location. Appearance, radius and story model are sampled once; moving or changing equipment while a shot flies does not move its origin. GPU arrows account for their authored tip offset and align to the visual trajectory tangent. Arrival fraction, endpoint, flight duration and authoritative projectile collision remain unchanged. Native ship and engineering hardpoints keep their existing path.

GPU and Canvas fallback map the same socket into their existing foot/body anchor conventions separately; deck events encode `deckHeight + 18`, which is not counted twice. If a shooter is already dead when the client first observes an event, corpse metadata can restore its size and story variant but does not contain its historical equipment. For ground events that case uses the surviving authored model/default loadout rather than inventing equipment history. Elevated events whose shooter is already absent retain their event hardpoint, because corpses have no deck metadata and subtracting a guessed deck offset would be incorrect. Near-vertical releases use the same projected facing deadzone as the body animation. Old effects without release action metadata retain their original launch calculation.


Run `node --import tsx scripts/projectile-socket-proof.mjs` for [socket JSON](after/projectile-socket-proof.json), [24-frame MP4](after/projectile-socket-proof.mp4) and [release scene](after/projectile-socket-proof-12.png). The real simulation releases upward archer, level mounted archer and downward priest projectiles. The authored GPU arrow tip/orb center matches the locked visual trajectory within 0.000027 world units; all shader diagnostics are runnable, browser errors are empty and WebGL reports zero errors. Release frames were visually reviewed. The test also preserves exact endpoint and duration checks in the focused suite; this is not a performance claim.
