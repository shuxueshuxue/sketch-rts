# Current mercenary models: Chromium idle identity proof

The independent Canvas2D proof passed against frozen source
**`e02b24ef8de3c96cec111a1178a7daf697fc8378`**: **8,640 full-domain RGBA
comparisons and 2,455,695,360 compared pixels**, with zero changed pixels,
channels or maximum channel difference. Every reference and candidate was
nonempty. The existing [7,776-comparison browser evidence](../browser/README.md)
is preserved at its original source; it was not overwritten or relabeled as
covering the new hired-company models.

## Coverage

All comparisons use original idle pairs **0/4, 1/3 and 5/7**, both density **2/4**,
both facing **−1/+1**, and the actual diagnostic colors **`#477b91` / `#a85644`**.
The complete `actionPaintSize(originalPose, kind)` domains remain intact,
including transparent padding and RGB beneath zero alpha. There is no cropping,
resampling, tolerance or change to painter arguments.

| Scope | Comparisons | Compared pixels | Changed pixels / channels |
|---|---:|---:|---:|
| All 44 stock assets with native equipment and compatible carry states | 7,320 | 2,123,857,920 | 0 / 0 |
| Eleven actual mixed-trace extra carry states | 264 | 81,776,640 | 0 / 0 |
| Existing sword/shield representatives | 96 | 22,732,800 | 0 / 0 |
| Existing ember priest/summoner representatives | 96 | 22,732,800 | 0 / 0 |
| Three current mercenary models, six equipment inputs, two carry states | 864 | 204,595,200 | 0 / 0 |
| **Total** | **8,640** | **2,455,695,360** | **0 / 0** |

The native matrix still covers all 23 figures and 21 creatures. Each figure,
including the new `mercenary`, `contractArcher` and `fieldMedic` drawings, and
each of the six armed creatures covers carry zero and strengths 1/3/6 at aims
−6/0/6. The 15 unarmed creatures cover carry zero. No old comparison was removed
to make room for the additional mercenary cases.

[additional-states.json](additional-states.json) contains the exact eighteen
kind/equipment groups. Each of the three mercenary kinds receives these six
production presentation inputs:

- Native equipment (`{}`).
- Great sword (`{weapon:'greatSword'}`).
- Round-shield request (`{shield:true,shieldStyle:'round'}`).
- Pike without a shield (`{weapon:'pike',shield:false}`).
- Bow (`{weapon:'bow'}`).
- Staff (`{weapon:'staff'}`).

Each input covers carry zero and strength 6 at aim −4 or +4 as listed in the
input file. These are representative equipment/carry combinations rather than
the native proof's complete ten-state carry matrix for each equipment option.
Some native comparisons intentionally overlap earlier rows, so **8,640 is a
comparison count, not a count of distinct states**. A round-shield request is
ignored for `contractArcher`'s default bow by the actual equipment compatibility
rules. The proof covers that input's real result and does not claim an archer
can hold both a bow and shield.

The separate [mercenary catalog proof](../../../mercenary-models/catalog.json)
records 6,912 Napi comparisons across the full six-equipment/mercenary carry
matrix. Its source hashes match this browser run's new mercenary model,
dispatcher and corpse module. This Chromium proof uses different recorded team
colors and does not claim Napi-versus-Chromium raster equivalence or repeat all
6,912 equipment/carry combinations in Chromium.

## Source and execution evidence

[proof.json](proof.json), [proof.log](proof.log), the exact
[executed fixture](executed-fixture.js) and [executed harness](executed-harness.mjs)
preserve the grouped comparisons, inputs, browser metadata and provenance.
`--expect-commit e02b24e` verified the complete expected commit and a clean art
source tree before launching. All **32** non-test art TypeScript files have
identical before/after SHA-256 hashes. The report includes the additional-state
input hash and these new-model dependency hashes:

| File | SHA-256 |
|---|---|
| `painted-mercenaries.ts` | `6d454ce8f7f36fe501185e2f19aef0a230bf6cd89c1dd8f0959a49f1a18b49bb` |
| `painted-units.ts` | `ddb1548cadbbbde4d19ebc3ddf904631c36e0ff4c6e0c1af7b18cf678ae594f8` |
| `corpses.ts` | `a8742a6fc3ad312b61e7ddac7dd375ea46e9848b413513818d56dbe9f7eca25a` |

The current Napi runner's explicit source list also gained
`painted-mercenaries.ts`, `corpses.ts` and `kit.ts` for future executions. No old
executed Napi report or script snapshot was changed, and that large Napi runner
was not rerun for this browser task.

The browser is **Chrome/151.0.7922.173**, V8 **15.1.206.23**. All canvases report
SRGB/unorm8, alpha enabled and `willReadFrequently:true`. The run requests only
`2d` contexts; a guard rejects all other context types, and recorded WebGL
attempts are zero. No World3D or card-cache module is imported. GPU and software
WebGL rasterization are disabled in the recorded Chromium arguments.

The original three negative controls remain effective: footman idle 0 versus 2
changes 12,065 pixels; changing its team color changes 3,732; knight walk 0 versus
2 changes 18,518. All detect nonzero channel differences. Walking keys remain
outside the proposed sharing rule.

The driver yields every sixteen complete byte comparisons and retains only
four reusable canvases and the current pair of ImageData buffers. Across 407
cgroup samples at 100 ms intervals, the sampled peak was **3,313,926,144 bytes
(3.086 GiB)** under the 16 GiB limit. `oom` and `oom_kill` both remained 2 → 2.
The root lane could run other CPU checks during this correctness window, so the
cgroup observation includes baseline and concurrent processes. It is not
isolated browser RSS, game memory or a performance measurement, and it cannot
establish an exact instantaneous peak.

## Reproduction and boundaries

```sh
node scripts/art-idle-browser-identity-proof.mjs \
  --expect-commit e02b24e \
  --additional-states docs/art/refactor/followup/card-streaming/idle-identity/browser-current-merc/additional-states.json \
  --out /tmp/current-merc-idle-proof/proof.json
```

If the working checkout has advanced, pass `--source` pointing to an independent
checkout at the recorded commit. The artifact's archived fixture/harness are
audit copies retaining their original script-path assumptions. The default
runner output now uses the new `browser-current-merc` directory; historical
browser evidence is left intact.

This proves finite original-pose drawing equality in the recorded Chromium
version. It does not validate corpse rendering, arbitrary detail callbacks,
every appearance/headwear override, final filtered GPU/shadow sampling, global
draw ordering or performance. The corpse source hash is recorded as a model
dependency, not as a corpse visual test. Integrated renderer validation remains
the root lane's separate task. If a future artist-authored frame branch changes
idle pixels, the sharing rule should opt that asset out; the drawing should not
be constrained merely to preserve cache reuse.
