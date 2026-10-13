# Exact stock idle drawing identities

The `.gz` data links preserve the complete original bytes; see [archive restoration and verification](../../release-readiness/README.md).

The stock figure and creature drawings were investigated before changing their
cache identities. The proposed pairs are idle **0/4, 1/3 and 5/7**. This does not
replace their animation frames: the tracker and painter retain the original
pose. Only the World3D painted-card cache's frame component is shared.

## Executed CPU proofs

The independent runner is `scripts/art-idle-paint-identity-proof.ts`. It uses
`@napi-rs/canvas` and compares every RGBA byte across the complete original
`actionPaintSize(pose, kind)` domain, including RGB under zero alpha. Density 2/4,
both facings and two team colors are covered. Reference art must be nonempty.
There is no resampling, alpha-mask substitution, lowered resolution or tolerance.

| Completed matrix | Comparisons | Compared pixels | Changed channels / pixels | Maximum channel difference |
|---|---:|---:|---:|---:|
| All 23 stock figures and 21 creatures | 18,840 | 5,524,193,280 | 0 / 0 | 0 |
| Additional actual mixed-trace carry states | 264 | 81,776,640 | 0 / 0 | 0 |

[Primary proof](proof.json) contains 276 grouped rows and source hashes;
[run.log](run.log) preserves its raw summaries. Its actually executed script is
archived as [executed-first-run.ts](executed-first-run.ts) for hash auditing.
After that run, the runner gained the additive `--trace-states` option; the
default matrix and comparison code remain unchanged.

The primary matrix includes native equipment, great swords and round shields
for every figure, plus the ember priest/summoner role skins. Every compatible
figure or armed creature is tested with carry strengths 1/3/6 and carry aims
-6/0/6; all assets also cover carry zero. The two colors are `#b79048` and
`#ad5c46`. The original 128/176 authored domains remain in use at their original
densities.

The mixed trace additionally uses carry strength 6 at aims **-4, -1 and 4**.
Those are not treated as covered by the representative -6/0/6 matrix.
[extra-states.json](extra-states.json) lists its 11 distinct kind/appearance
states; [proof-extra-trace.json](proof-extra-trace.json) and
[proof-extra-trace.log](proof-extra-trace.log) prove them separately with the same
full-domain, density, facing and palette matrix. Both runs completed with exit 0;
all three requested pairs have zero differences and no empty controls.

A separate [real Chromium Canvas2D proof](browser/README.md) now covers 7,776
comparisons and 2,251,100,160 original-domain pixels, with zero RGBA differences
and no empty references or candidates. It includes all 44 native stock assets
with compatible carry states, the actual mixed-trace extra states and four
equipment/ember representatives, using the two actual fixture team colors.
This supplements Napi drawing evidence; integrated GPU/shadow rendering and
performance validation remain separate.

After the three hired-company assets gained independently authored models, the
[current-source Chromium proof](browser-current-merc/README.md) reran the whole
7,776 matrix and added 864 mercenary equipment comparisons at frozen `e02b24e`.
All 8,640 comparisons and 2,455,695,360 pixels are exactly equal within their
idle pairs. The original browser and Napi evidence remains archived against
its actual earlier source.

## Source audit and boundaries

`sampleMotion` uses an idle sine phase. The paired sine values are **not all
bitwise equal** in double precision; the report records those values. The
decision relies on the actual final RGBA comparisons, not approximate equality
of the sine samples.

The stock painter audit found no idle-only frame-index branch or blinking:

- `painted-units.ts` reads the raw frame for mounted walking phase only when the
  mode is `walk`.
- `creature-poses.ts` reads it for attack curves, attack recovery and walking
  cosine lift; these branches do not run in idle.
- `rig.ts` reads it for work and attack drawings. Carry preparation retains its
  strength and aim, which are independently covered above.

Walking is deliberately outside this sharing rule. Mounted gait and creature
step lift can depend on cosine/raw frame even when sine happens to match.
Opaque story variants, including an explicitly provided empty variant string,
opt out. Unknown painters and the existing warfare/siege rules are unchanged.
The current ordinary figure/creature appearance path is covered; this is not a
promise for arbitrary future detail callbacks or newly introduced frame branches.

The adopted stock-only key mapping is **4→0, 3→1, 7→5**. All remaining frame
values and the existing carry, aim, appearance, color, facing, density and domain
distinctions remain. Original painter arguments and animation semantics are not
rewritten. The helper source after this change has SHA-256
`c2c855e1b21ea2fbac101ef1820661d7a88d59eadb88a1f9f0446990f0138ad4`.

The CI regression adds whole-domain comparisons for every current stock asset
at density 2, both facings and two palettes, with a small set of carried and
changed-equipment cases. It also checks variant opt-out, unchanged walking,
other idle frames and retained key dimensions. The complete
`paint-identity.test.ts` run passed **all seven tests** in 35.52 s, including the
existing 6,552 creature comparisons and 4,192 siege comparisons; the new idle
RGBA matrix took 2.080 s. `npx tsc --noEmit` also completed with exit 0. The
18,840-case investigation remains a standalone runner rather than being added
to each CI run. That CI result preceded the later renderer/model changes; the
then-current integrated source was frozen at `3205988` for browser QA.

Two earlier full-file attempts exhausted the 16 GiB cgroup and ended with a
Vitest worker exit, without a reported logical assertion failure. The three
native-raster loops now yield to the event loop after every 32 complete byte
comparisons so native ImageData finalizers can release completed batches. The
full matrices, original drawing domains and RGBA comparisons, including RGB
under zero alpha, are unchanged. No production code was changed for this test
harness fix.

The passing run's [raw log](../validation/paint-identity.log) and
[memory record](../validation/paint-identity-memory.json) preserve the evidence.
Across 717 samples at 50 ms intervals, sampled cgroup memory peaked at
**1.717 GiB**; `oom` and `oom_kill` both remained 2 → 2. This is the CPU test
run's cgroup observation, including baseline processes rather than isolated
process RSS, **not a game-memory or renderer-performance measurement**. Sampling
cannot establish the exact instantaneous peak.

## Observed request identities

[trace-analysis.json](trace-analysis.json.gz) parses the original gzip request keys
and retains every field except the three confirmed stock idle frame pairs.

| Frozen trace | Unique card identities | Idle identities | Instance requests | Requests whose key changes |
|---|---:|---:|---:|---:|
| canonical | 153 → 129 (−24) | 67 → 43 | 44,200 unchanged | 10,482 |
| mixed | 1,077 → 971 (−106) | 323 → 217 | 14,000 unchanged | 2,457 |

These counts now have CPU pixel support for the observed carry and appearance
inputs. They describe possible identity consolidation, **not reduced visible
content or fewer instance requests**, and cannot directly establish a GPU-byte,
upload or frame-time saving.

Canonical was captured from original `f87c3b7`; mixed was captured from
`742d2b8` with the earlier stock-creature color and siege static-key sharing
already present. The workloads are different and cannot be presented as a
same-scene before/after comparison. Mixed's gzip wrapper hash does not directly
hash its imported recipe; the current mixed recipe is byte-identical to both
archived entry fixtures. That provenance limitation is retained in the analysis.

## Reproduction and remaining validation

```sh
node --import tsx scripts/art-idle-paint-identity-proof.ts
node --import tsx scripts/art-idle-paint-identity-proof.ts \
  --trace-states docs/art/refactor/followup/card-streaming/idle-identity/extra-states.json \
  --out docs/art/refactor/followup/card-streaming/idle-identity/proof-extra-trace.json
npx vitest run src/client/art/paint-identity.test.ts
npx tsc --noEmit
```

The runner yields between small batches and writes an incomplete checkpoint on
SIGINT/SIGTERM; `completed:false` is not a successful full proof. A new default
run writes `proof.log`, while `run.log` above is retained from the original run.

The Napi and independent Chromium source-pixel proofs do not establish final
filtered GPU/shadow equivalence or performance improvement. The root lane must
compare the integrated renderer's browser camera, battle and canonical frames
strictly, then measure its final combined source in one controlled environment.
The earlier archived phase-62 mip candidate is not the final implementation.
