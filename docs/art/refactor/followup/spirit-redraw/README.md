# Spirit model redraw

The actual `spirit` unit now has a veiled, floating silhouette: a deep oblique hood, a broad pale shoulder and chest, continuous empty sleeves, and a fraying shroud that trails into translucent wisps. A single subdued opening defines the head's facing at game scale. The model uses the existing restrained grey-green palette, warm paper light and cool shadow. The old oval head and two cloud-shaped body layers have been removed from the production painter.

The model is implemented in `src/client/art/painted-spirit.ts`. `paintCreatureBody` calls it for the spirit shape, so live world cards, fitted UI portraits, full figures and story creatures consume the same artwork. Remains use the same model's dissolved shroud through `paintSpiritRemains`; they add neither a physical corpse nor blood. Other species keep their existing authored painters.

Animation follows the existing simulation releases and animation clock. A hit starts at contact and recovers over the existing six samples. Three attack variants vary the sleeve's sweep. The upper mass leans toward the target while the hem lags behind it; neither a human skeleton nor an elbow solver is imposed on the shade. The release effect and sleeve terminate at the same socket: `(13 + dx × 20, -21 + dy × 21)` before body bob and world projection. Up, level and down attacks have distinct geometry, with the existing direction bank providing the terminal correction. Casting draws both sleeves toward the release and has its own contour; **the actual spirit has no cast ability**, so cast coverage is an authored-story/painter check and is not represented as a real game skill.

Idle and movement use the existing breath/stride values rather than independently reading the raw frame index. This preserves the actual stock idle aliases `0/4`, `1/3` and `5/7`; attack/cast sample 5 remains exactly the idle drawing. The appearance, statistics, abilities, simulation, AI, combat cadence and renderer resource policies are unchanged by this art change.

## Downloadable visual evidence

- [Same-scale before/after](comparison.png): identical paper, positions, input poses and scale, including a native 1× subject beside every enlarged drawing.
- [All attack variants and directions](attack-directions.png): three variants × up/level/down × both facings.
- [Directional recovery and separate cast contour](recovery-cast.png).
- [Spectral remains, before/after](remains.png).
- [Six-second production-painter video](actions.mp4): 108 frames at 18 fps; both models receive the same input in each frame. This is a painter review, not a recording of simulated gameplay.
- [Raw painter proof](painter-proof.json): source file hashes, immutable old source at `8345a0dcfeb96b6777ac3940ec64cba13816c851`, PNG/RGBA hashes for every image and movie frame, and every identity comparison. The revised source was captured before its source commit; the recorded per-file hashes identify its exact content.

Both the parent reviewer and the author inspected the comparison and attack sheet. The new core remains readable at native scale, the hood's opening points along the unit's facing, and the continuous sleeve cleanly distinguishes the up and down contacts. Real browser/gameplay evidence is produced separately by `art-spirit-gameplay-proof.mjs`; it must be read alongside this painter evidence before making real-game claims.

## Validation and reproduction

The full-RGBA identity proof passed **220 exact comparisons** across both facings and densities 2 and 4: all three idle alias pairs, plus all 13 direction bins and all three attack variants at the ready endpoint. No alpha-only hash or tolerance was used. These comparisons are about source bitmap identity, not performance.

The focused source tests passed **4 files / 60 tests**: spirit sleeve/socket attachment during directional recovery, distinct contact variants and casts, exact idle/ready identity, subdued remains, all 21 creature contact/recovery regressions, existing release transforms, and story remains. Type checking passed. The focused command explicitly excludes archived source snapshots:

```sh
npx vitest run src/client/art/painted-spirit.test.ts src/client/art/painted-creatures.test.ts src/client/art/release-socket.test.ts src/client/art/story-remains.test.ts --exclude 'docs/**' --reporter=dot
npx tsc --noEmit
node --import tsx scripts/art-spirit-review.ts --before /tmp/sketch-stall-baseline-8345 --after /workspace/sketch-rts-viewport --out /tmp/spirit-review-reproduction
ffmpeg -y -framerate 18 -i /tmp/spirit-review-reproduction/frames/%03d.png -c:v libx264 -crf 18 -pix_fmt yuv420p -movflags +faststart /tmp/spirit-review-reproduction/actions.mp4
```

The model does not add a WebGL pass, texture bank, particle system or per-unit animation state. No render-time improvement or hardware FPS claim is made from these art images. The separate rendering experiments retain their frozen original art source, so their timing conclusions must not be attributed to this redraw.
