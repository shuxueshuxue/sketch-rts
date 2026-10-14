# Chromium Canvas2D stock idle identities

The independent HTMLCanvasElement proof completed with **7,776 exact comparisons
and 2,251,100,160 compared pixels**, with zero changed RGBA channels, zero changed
pixels and maximum channel difference zero. Every reference and candidate was
nonempty. This supplements the native `@napi-rs/canvas` proofs with the actual
browser drawing implementation; it does not compare Chromium pixels against
Napi pixels or establish a performance improvement.

## Executed scope

Every row compares original idle poses **0/4, 1/3 and 5/7**, at density **2/4**,
facing **−1/+1** and the actual diagnostic-fixture colors **`#477b91` / `#a85644`**.
The original `actionPaintSize(pose, kind)` domain remains intact: authored
128/176 tiles produce 256/352/512/704 pixel canvases. No cropping, resampling,
reduced drawing detail or channel tolerance is used. Each Uint32 comparison
covers all four original RGBA bytes, including RGB beneath zero alpha.

| Scope | Comparisons | Compared pixels | Changed channels / pixels |
|---|---:|---:|---:|
| All 44 stock assets with native equipment and compatible carry states | 7,320 | 2,123,857,920 | 0 / 0 |
| Eleven additional actual mixed-trace carry states | 264 | 81,776,640 | 0 / 0 |
| Great sword and round shield representatives | 96 | 22,732,800 | 0 / 0 |
| Ember priest and summoner representatives | 96 | 22,732,800 | 0 / 0 |
| **Total** | **7,776** | **2,251,100,160** | **0 / 0** |

The native matrix includes all 23 figures and 21 creatures. Each figure and the
six armed creatures covers carry zero plus strengths 1/3/6 at aims −6/0/6. The
15 unarmed creatures cover carry zero. [The original trace-state list](../extra-states.json)
supplies the eleven extra native carry-six states at aims −4, −1 and 4. These
additional aims are proved separately, not inferred from the representative
aim bins.

The four appearance representatives each cover carry zero and one carried
state: footman/greatSword at strength 1, aim −6; lancer/roundShield at strength
3, aim 0; ember priest at strength 6, aim −4; ember summoner at strength 6, aim
4. The ember priest appearance is present in the diagnostic traces. The sword,
shield and ember summoner are supplemental production-art paths, not traced
equipment overrides. This browser run does not repeat the Napi proof's complete
equipment-by-every-stock-figure matrix.

## Browser, source and comparator evidence

[proof.json](proof.json) contains every grouped row, original inputs, browser
version, negative controls, loaded module URLs and before/after source hashes.
The browser is **Chrome/151.0.7922.173**, V8 **15.1.206.23**, on Linux headless
Chromium. All four canvas sizes report `alpha:true`, `colorSpace:'srgb'`,
`colorType:'unorm8'` and `willReadFrequently:true`, matching the production
readback context preference. Chromium is launched with GPU and software WebGL
rasterization disabled. A context guard permits only `2d`; the recorded
WebGL-attempt count is zero. No World3D, card-cache or renderer module is loaded.

The source checkout was `454336d814ee131458b0074457f25046d6f91790`.
All 31 non-test art TypeScript files have identical before/after SHA-256 hashes
in the report. In particular, `painted-units.ts` is
`727cc9300943fe8a8c565ce4f48c9f21fa70ff0a653f88ddb268bac5c9818431`.
The executed [fixture](executed-fixture.js) and [harness](executed-harness.mjs)
are preserved for auditing; their hashes and the exact trace-state input hash
are recorded in the report. These archive copies retain their original script
path assumptions; run the repository scripts below to reproduce.
[proof.log](proof.log) preserves the Chromium console summaries.

All three negative controls detect genuine drawing differences:

| Negative control | Changed pixels | Changed channels | Maximum channel difference |
|---|---:|---:|---:|
| Footman idle 0 versus 2 | 12,065 | 35,284 | 255 |
| Footman between the two owner colors | 3,732 | 11,150 | 87 |
| Knight walk 0 versus 2 | 18,518 | 60,756 | 255 |

The [initial attempt](initial-walk-control/proof.json) also completed all 7,776
idle comparisons with zero differences, but its extra knight walk 1/3 negative
control was itself pixel-identical and therefore failed the harness. That
attempt and its executed scripts/log are retained. The negative control was
corrected to walk 0/2 and the complete proof rerun. No painter, animation or
production key was changed. This observation does not authorize merging any
walking frames: other walking drawings depend on cosine, lift and raw phase.

## Resource handling and limits

The runner retains only four reusable canvases and the current pair of
ImageData readbacks. It yields every 16 complete comparisons rather than
retaining historical raster buffers. The passing run sampled the entire
test-run cgroup every 100 ms (364 samples): the sampled peak was
**2,680,840,192 bytes (2.497 GiB)** under the 16 GiB limit; `oom` and `oom_kill`
both remained 2 → 2. These observations include baseline processes and are not
isolated browser RSS, game memory, GPU residency or a timing benchmark. Sampling
cannot establish an exact instantaneous peak.

The CPU Canvas oracle proves these finite drawing inputs on this recorded
Chromium version. It does not establish filtered texture/shadow equivalence,
global instance ordering, shader portability or performance gains. Opaque
story variants remain outside the production idle sharing rule. The original
mixed-trace wrapper/recipe provenance limitation described in the
[parent report](../README.md) remains; this proof cannot retroactively recover
missing capture hashes. Root-lane integrated browser and renderer validation
remains separate.

```sh
node scripts/art-idle-browser-identity-proof.mjs
# Optional independent frozen source checkout and output destination:
node scripts/art-idle-browser-identity-proof.mjs \
  --source /path/to/frozen/sketch-rts \
  --out /tmp/idle-browser-proof/proof.json
```
