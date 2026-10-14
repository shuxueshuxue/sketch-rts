# Spirit redraw: real game integration

The new shade is exercised through actual summon, movement, attack and death rules, using the production WebGL renderer, Canvas world renderer and Atlas UI/remains entry points. The comparison keeps the same commands, scene, original catalog values and original simulation ticks.

- Before source: `8345a0dcfeb96b6777ac3940ec64cba13816c851`, immutable `/tmp/sketch-stall-baseline-8345`.
- After source: `d7c7f4bf93ffd8364a1ee6ef0c6170ca442657a8`.
- [Before video](before/gameplay.mp4), [after video](after/gameplay.mp4).
- [Actual six-direction attack frame](after/frame-025.png), [recovery frame](after/frame-029.png), [actual death/remains frame](after/frame-075.png).
- [Canvas attack frame](after/canvas-025.png), [actual selection portrait](after/spirit-png.png), [actual equipment figure](after/spirit-bodyPng.png).
- Full original results: [before/proof.json](before/proof.json), [after/proof.json](after/proof.json), [comparison-v2.json](comparison-v2.json).

## Verified behavior

Each version renders 80 WebGL captures and 17 Canvas world captures. Six real `summon` commands produce spirits with the original 85 HP, 70 speed, 13 damage, 55 reach, 1.2-second attack cooldown and 60-second lifetime. Every spirit performs a real move and real attacks against native enemy footmen. The six lanes cover left/right facing and targets at up 60 degrees, horizontal and down 60 degrees. Every lane observes all five contact/recovery frames, two deterministic attack variants and idle/walk/attack modes. All 24 actual production picks select the intended body.

Casters leave through the real `removeUnit` scripted-exit API after eight ticks. This isolates their spirits' attacks without changing caster damage, range, cooldown or AI rules. Six explicitly scripted `strikeUnit` calls go through the original damage/death pipeline and produce actual death records. Those lethal calls validate remains; they are not advertised as naturally occurring equal-damage combat. Spirit has no cast ability, and the fixture neither gives it a cast skill nor forces an animation.

The two runs' full 80 simulation snapshots, commands, releases, HP, clocks, observed poses/facings, pick identities and death records are exactly equal. Draws never change the game checksum. Source start/end SHA maps, Git HEAD and rule-diff hashes are stable; `src/shared`, `src/ai` and `src/server` Git trees are equal. Both runs have zero GL errors, console errors and network loading failures. Each run uses one consistent Three optimizer query version; independent runs may have different query hashes because they have different temporary optimizer roots.

All 80 WebGL and 17 Canvas PNGs are independently decoded and compared channel by channel. Changed pixels are confined to explicitly identified spirit body/remains, spirit UI and physically projected spirit-shadow envelopes. Four independent nonspirit UI images—summoner and footman portraits/full figures—are pixel-identical. Full source hashes additionally establish that nonspirit painters and rendering modules are unchanged. The allowed spirit rectangles can overlap nearby target pixels; this check therefore does not prove every nearby target pixel individually identical.

## Preserved initial range-check failure

[comparison.json](comparison.json) and [executed-compare-v1.mjs](executed-compare-v1.mjs) preserve the first conservative body-envelope result. The original right pad of 75 screen pixels left 17 changed pixels at frame 25 and 12 at frame 49 outside its boundary. All were at the right ground-shadow edge, around `(368–371, 626–631)`; Canvas images passed that original bound.

The production cards cast shadows, and the sun is offset `(-450, 650, +250)`. The v2 analyzer extends only the right spirit envelope edge to 112 screen pixels. Its bound follows the conservative authored local drawing bounds, `15/18` glyph scale, foot offset 17, camera tilt 0.72, zoom 1.3 and the sun's `450/650` shadow projection, with PCF padding. The sparse initial outliers are consistent with the changed sleeve's native ground shadow. The v2 result passes with zero changed pixels outside these explicit body/shadow/UI/remains envelopes. No pixels, raw proofs, fixture or original failed result were edited.

## Reproduce

Run from a worktree with the installed repository dependencies and Chromium/FFmpeg:

```sh
node --import tsx scripts/art-spirit-gameplay-proof.mjs \
  --source /tmp/sketch-stall-baseline-8345 \
  --out NEW/before/proof.json
node --import tsx scripts/art-spirit-gameplay-proof.mjs \
  --source /workspace/sketch-rts-viewport \
  --out NEW/after/proof.json
node scripts/art-spirit-gameplay-compare-v2.mjs \
  --before NEW/before/proof.json \
  --after NEW/after/proof.json \
  --out NEW/comparison-v2.json
```

Output directories must be new. Each run archives its executed driver and fixture, full source bytes in `source.tar.gz`, source SHA map, raw snapshots, native PNG hashes and the MP4 hash. Failed startup or runtime runs are retained in `failure.json`; previous evidence is never overwritten. Videos are presentation evidence, while original PNGs and JSON are the correctness evidence.

The captures use Chromium 151 and software SwiftShader with an explicitly preserved GPU buffer. This is an untimed integration and visual proof, not a frame-time, hardware-GPU, or performance-improvement claim.
