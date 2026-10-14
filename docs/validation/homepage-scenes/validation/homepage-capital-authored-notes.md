# Capital street authoring notes

Working source: `/workspace/sketch-rts-homepage-board/src/client/menu-capital-street.ts` (not committed; root owns integration).

- Fixed 24 actors: 18 civilians/shopkeepers/porters and 6 soldiers (4 patrol, 2 gate sentries).
- 61 static props, 3 civic buildings. Local atlas kinds have fixed state keys. Each custom painter fits the existing 128-pixel prop card (tested separately on a 256-pixel canvas to detect clipping).
- Civilian models are scene-local presentation functions for existing worker bodies, with unarmed loadouts, different muted costume colours, hair/caps, aprons, merchant fur trim and porter crates. No catalog/rule enlistment.
- Hero architecture: wooden upper-storey tavern at `(1740,973)`, scale 2.2, hanging carved tankard sign, lit windows, barrels, open street door. Market stalls at `(1160,1015)` and `(1370,1012)`, produce and cloth. Tavern square table/bench groups at x1640/1780,y1310..1354.
- Camera: 90-second scene, unhurried smoothstep over seconds 2..82. After browser review: desktop focus x1580→1795, y1210→1222 (720p uses y1172→1184); mobile focus x1710→1760,y1115→1127, anchorY .40. `stillSecond=15` fixes the reduced-motion composition; root disables camera jitter for presentation scenes.
- Bounded route arithmetic only; no `stepGame`, path search, orders sent through match runtime, city AI, damage, economy or corpse updates. Match `Game` state is used only as a renderer snapshot container. Root advances its presentation tick for shared gait/idle tracking.
- Phase-based routes are independent of accumulated updates and support deterministic seeking. Through 180 seconds at 30 Hz, all observed per-frame displacements are ≤28/30 world units, including route joins. There are 13 moving actors.
- Initial test log `/workspace/homepage-capital-tests.log`: 3 pass / 1 test fixture failure (`Game.aiPlayers` does not exist). The assertion target will be retained via actual players and no simulation/cast/rules mutations, after visual source freeze is released.
- Real browser inspection is pending. Particular review targets: mobile upper tavern/sign and lower square remain recognisable despite the central menu; no actor roof/table overlap; restrained architectural colours remain consistent with the existing sketched world. Do not claim final art/performance based on this authoring note.

## First real browser review and corrections

- Reviewed actual desktop and mobile screenshots from both initial browser passes. The first harness pass had timestamp lag; the second confirmed painted time and waited for the GPU. The first pass is not precise-time proof.
- Two background sentries appeared on the roofs of foreground street houses. They now stand at clear east/west street entrances `(990,1067)` and `(2150,1074)`. No renderer depth changes.
- A bottom pedestrian crossed a flower box. The two south flower boxes moved to y1475, and the right endpoint of the lower citizen route moved from2030 to1940, away from the foreground shop roof.
- Tavern tables and mugs were hidden because y-sorted square paving drew after them. Square tiles now use a fixed `square` state, sort at y1250 and paint with local y+39, keeping the actual surface at y1320 while drawing before furniture. The whole picture still fits a128-pixel card. No changing state keys.
- The innkeeper now carries a tray with two mugs from the visible doorway at `(1722,1045)` to the table edge at `(1748,1300)`.
- Root changed only the mobile home menu to a compact bottom arrangement, leaving the street scene open above it. The city camera keeps its hero tavern, frontage trade and patrols in that open upper region.
- Final targeted tests: **4/4 pass**, `/workspace/homepage-capital-tests-iteration3.log`, 6.01seconds wall. The initial two test fixture failures are preserved in the earlier logs. They used the wrong Game interface (`aiPlayers`, then reserve `players`), corrected to the actual `activePlayers` property. No production failure was hidden and no assertions were dropped.
- Final source SHA256 (before second visual review): `9120b11213d645da947057301eda48bcf938d62fe729b4ccfa3578d002e34c77`.
- Final test SHA256: `333378617a019fc2d36cb0a9b097a13ff4f3b6231b34b53597fd3abf09eadad2`.
- Corrected-source real browser review is pending. Root owns integration, full final type/build checks, screenshot/video evidence and independent commits.

## Corrected-source visual review

Completed actual production-homepage browser inspection against `/workspace/homepage-pirate-visual-iteration3` (closed with source unchanged by the review lane). Personally reviewed:

- 1440×900 at2 and80seconds.
- 1280×720 at45seconds.
- 390×844 at2,45 and80seconds.

The reviewer also checked all nine capital captures. Sentries no longer sit on roofs, lower pedestrians do not cross the flower boxes, tabletop mugs/plates are visible in the correct layer, the tavern/merchant costumes/soldiers are readable, and the mobile tavern remains visible throughout the camera pass with its scene activity above the compact menu. No remaining city visual blocker was found. Root fixed citadel model preloading alongside integration. No further city source changes were needed after the four passing targeted tests.

This review establishes visual composition, not frame-time or memory improvement. Root owns the separate browser performance measurements and screenshot/demo archive. All initial failed test and browser captures remain retained for attribution.
