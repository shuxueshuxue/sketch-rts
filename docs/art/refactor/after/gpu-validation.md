# Painted card GPU validation

Validation environment: Chromium 151.0.7922.173, headless ANGLE/SwiftShader in the development container. These checks establish rendering correctness and resource ownership; their timings are not desktop hardware FPS.

## Production runtime smoke

`gpu-runtime-smoke.json` records six renderer lifetimes and 72 real WebGL interaction cases. Validation passed with no browser, shader or GL errors. It covers ground/deck/hull/boarding bridge interaction, selected/hovered own/ally/enemy actors, model loading, and explicit resource disposal while retaining references to disposed layers. `gpu-runtime-smoke.png` is the scene capture. This smoke preceded the final cache compaction and orb palette changes; those changes have targeted CPU integration coverage, and the separate final performance runs exercise the final renderer.

Reproduce:

```sh
node --import tsx scripts/browser-runtime-benchmark.mjs --out work/gpu-runtime-smoke.json --screenshot work/gpu-runtime-smoke.png
```

## Controlled texture/shadow comparison: strict pixel equality failed

`painted-card-gpu-proof.json` and its PNG compare the same four Canvas drawing functions and the original individual CanvasTexture/instanced material route against full-resolution texture-array instances. Both retain 512 × 512 source resolution, mipmaps, anisotropic filtering, sRGB textures, the MeshBasic color pipeline, alphaTest 0.4, and PCF shadows. The PNG places the original on the left and array instances on the right; the upper row uses directional depth shadows and the lower row point-light distance shadows.

| Pass | Changed pixels / 262,144 | Mean absolute channel difference (0–255) | Maximum channel difference |
| --- | ---: | ---: | ---: |
| Directional depth | 179 | 0.0003204346 | 16 |
| Point-light distance | 175 | 0.0002288818 | 4 |

There were no shader or GL errors. The strict maximum channel difference ≤ 1 assertion remains **false**, and the script exits nonzero. Do not describe this result as pixel-identical or silently treat the strict assertion as passed.

The source RGBA comparison also found differences at antialiased alpha boundaries (186 alpha samples per source, maximum alpha difference 5). Canvas surface rasterization/readback and RGBA array upload do not produce exactly the same boundary quantization in this environment. Explicitly retaining the GPU-oriented Canvas backend reduced the visible difference substantially compared with `willReadFrequently: true`; it did not eliminate it. The remaining mismatch is disclosed rather than attributed to a successful equivalence proof. Shapes, contact positions and shadows can be inspected in the supplied comparison image.

Reproduce the exact diagnostic, including its strict failure:

```sh
node --import tsx scripts/painted-card-gpu-proof.mjs --out work/painted-card-gpu-proof.json
```

## Cache and integration checks

The focused run passed 43 tests: 7 painted-array cache tests, 14 World3D integration tests, 10 actor batch tests, and 12 effect rendering tests. `tsc --noEmit` passed at that point. Coverage includes full-resolution layer sampling, alpha picking, foot offsets, both shadow shader patches, oversized visible sets, protecting later warm poses from an early cache miss, sparse-page compaction without rerasterization, shared story painters/scale, three shared spell palettes, and resource disposal. The later optional story `unitActions` forwarding is included in the final repository-wide checks.

The cache retains every visible pose even when its working set exceeds the 12-million-pixel soft budget. New poses are rasterized only after all warm poses required by the frame have been protected. Severe page fragmentation above that budget is compacted by copying existing RGBA layers, preserving resolution and alpha picking. `cardStats().cpuBytes` and `.gpuBytes` estimate texture storage only, not total process/GPU memory; `.rasterizations` counts generated poses and `.copiedLayers` records compaction copies.

Spell palette selection currently reads the authored race of `sourceKind`; a missing kind maps to the unaligned palette. If catalog unit kinds later become faction-neutral, the palette input must gain the shooter's owner race at launch. This change does not alter projectile trajectories, hits, or simulation rules.
