# Original mip-tail residency: mathematical review and prototype

This is an independent experiment, not a production change. Copying already
generated original mips could remove unused high-resolution residency without
changing art. A fixed mip drop for all cards is not safe.

## Current constraints

`configureWorldCamera` is orthographic. Its vertical projection compensates for
the camera tilt so upright unrotated cards have the same paper scale in both
screen axes. Original card domains are 128 or 176 authored units, rasterized at
density 2 below zoom .65 and density 4 otherwise. Normal unit glyph scale is
clamped to .72–1.65; custom model scale can be larger. The renderer permits DPR
up to 2. The sun uses a 2048-square shadow map with an orthographic span
`max(viewWidth,viewHeight)/zoom + 400`. Cards use linear/trilinear filtering,
anisotropy up to 8, alpha cutout and their original depth material.

The sun can sample a finer original mip than the main camera. A small view does
not reduce its 2048 texture size, so its texels per world unit increase. Actor
screen silhouette bounds also do not determine the texture footprint: the
original padded quad and its UV mapping do. Rotation, pitch, nonuniform scale,
custom model scale, DPR and all relevant shadow passes must be included.

For an unrotated upright card in the main pass, the original source footprint
is approximately `density/(scale*zoom*DPR)` texels per pixel. At density 4,
scale 1.65, zoom 1, DPR 2, that is approximately 1.212 texels/pixel, or LOD .278.
Level zero remains relevant, so an unconditional drop of one mip would alter
the accepted picture.

## Conservative candidate bound

Construct the 2 × 2 Jacobian `A` mapping one **original source texel** along its
U/V axes to physical framebuffer pixels. For an orthographic card it is
constant over each primitive. The reciprocal of its maximum singular value
is a lower bound on source texels per pixel in the most magnified direction:

```text
minimumTexelsPerPixel = 1 / sigmaMax(A)
minimumLod = log2(minimumTexelsPerPixel)
eligibleDrop N requires minimumLod >= N + 1
```

Take the minimum across every instance sharing that texture and every color or
shadow pass. Using only the larger projected quad dimension, a zoom threshold,
or isotropic `max(length(dUVdx),length(dUVdy))` can miss anisotropic sampling of
finer mips. The prototype records the full Jacobian and individual pass bounds.

The extra level is conservative for the anisotropic example in the Khronos
specification: rounding its tap count upward can select a mip nearly one level
finer than the smaller derivative footprint. However, the extension leaves the
actual anisotropic algorithm to the implementation. This bound is a candidate
heuristic to test, **not a specification-backed universal promise** of exact
pixels on every GPU. [Khronos anisotropic filtering specification](https://registry.khronos.org/OpenGL/extensions/EXT/EXT_texture_filter_anisotropic.txt).

## Exact tail construction

Generate the complete native sRGB mip chain on the original full-domain GPU
texture. Create a smaller array with `generateMipmaps=false`, then use public
`copyTextureToTexture` calls to copy original source level `N + destinationLevel`
into each destination level. UVs, original geometry, filters, anisotropy, alpha
test and shader sampling remain unchanged. Do not regenerate mips from a
smaller canvas or reduce authoring density.

For 512, 640 and 704 domains, division by `2**N` is integral for N from 1 to 4.
Their rebased texture dimensions and every subsequent floor-rounded mip match
the original corresponding levels exactly, including NPOT terminal levels.
Nonintegral rebasing can change normalized-UV scale and LOD, so it requires a
separate proof rather than a generalized assumption.

If adopted after broader verification, GPU card identity would need to include
the resident mip drop and invalidate/promote it before any finer sampling pass.
CPU raster identity and full-source picking masks should retain original
dimensions. Per-frame promotion must precede rendering after zoom, DPR, scale,
viewport or pass changes. Full scratch memory and original rasterization cost
remain; the potential benefit concerns page residency and mip-copy volume.

## Independent browser experiment

`scripts/card-mip-tail-gpu-proof.mjs` and its fixture compare the full original
GPU array with tails copied from that same mip chain. The prototype uses actual
authored idle, attack and cast art, including upward lancer attacks and a red
dragon. It checks multiple zooms, density boundaries, scales, rotations, pitch,
nonuniform scaling, DPR 1/2 and small/wide views. It compares every RGBA channel
of both the main image and the actual 2048 PCF sun pass's packed-depth color
attachment, with zero tolerance. It records bounds and source/image hashes.

Eligible and deliberately ineligible rows are distinguished. A mismatch in an
eligible row rejects the current gate. Ineligible mismatches are evidence
against indiscriminate fixed mip removal. Browser elapsed time includes
readback and is not usable as a performance result. SwiftShader success alone
would not settle implementation-dependent filtering on hardware GPUs.

```sh
node --import tsx scripts/card-mip-tail-gpu-proof.mjs \
  --source /workspace/sketch-rts-viewport \
  --out work/card-mip-tail-pilot.json --drops 1 --cases 4
```

## Recorded result

The pilot and full matrix ran on Chromium 151 / SwiftShader. The final
`mip-tail/matrix.json` contains **96 rows**: 12 view/transform configurations,
two authored domains, and drops 1–4. All eight rows meeting the one-level margin
gate had **zero RGBA differences in both main color and the actual sun pass**.
Their drop was one mip; their per-array storage calculation is approximately
75% smaller. That percentage describes the explicitly allocated mip chains,
not actual process memory: the experiment deliberately keeps its full oracle
resident alongside the prototype.

There were **74 mismatching ineligible rows**, including **10 failures at
drop 1**. Fixed level-zero removal is therefore rejected. For example:

| View / original domain | Conservative minimum LOD | Main changed pixels / max channel delta | Shadow changed pixels |
| --- | ---: | ---: | ---: |
| zoom .75, scale .9, DPR 1 / 704 | 2.1074 | 0 / 0 | 0 |
| zoom 1, scale 1.65, DPR 1 / 704 | .8179 | 1,835 / 111 | 2 |
| zoom 1, scale .9, DPR 2 / 704 | .6923 | 4,389 / 111 | 0 |
| zoom 2, scale 1.65, pitch .4 / 704 | -.0942 | 12,222 / 114 | 189 |

A separate float framebuffer probe measured actual shader `dFdx`/`dFdy` of
original source UVs at interior primitive pixels, retaining the corresponding
full physical viewport scale. All main-camera and sun-camera probes agreed
with the CPU Jacobian within .175% maximum relative error. The numerical
tolerance belongs only to this derivative diagnostic; image comparisons still
use **zero tolerance**. There were no GL, console or network errors.

The eight eligible rows were low zoom .35 at density 2, the density-4 boundary
.65, the benchmark zoom .75 and the wider 1920 view. Other configurations
retained their original full texture under this gate. No production rendering
or residency policy was changed. Hardware anisotropic filtering, promotion on
all pass changes, and real-world resource/timing benefit remain unverified.
