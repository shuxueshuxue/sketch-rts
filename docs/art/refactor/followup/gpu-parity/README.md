# Filtered GPU parity: resolved without relaxing the gate

The final production implementation passes eight scenarios, each with directional-depth and point-distance shadow passes: **zero changed pixels and zero maximum channel difference in all 16 comparisons**. The gate remains ≤1. Source hashes and compact results are in [SUMMARY.json](SUMMARY.json). Original failures and intermediate diagnostics remain available.

## What was wrong

1. **Changing the quad changed filtered cutout coverage.** [baseline.json](baseline.json) reproduces the original maxima 113/95. Reconstructing every base source RGBA texel was already exact. After correcting the fixture's framebuffer binding, the difference remained with nearest filtering, no shadows, and a full-array reference uploaded from identical RGBA. The cropped quad changed screen-space vertex quantization/interpolation; thresholding interpolated alpha at 0.4 amplified that small sampling shift into whole edge pixels. The reference and candidate retained the same world anchor mathematically, which was insufficient for raster parity. [full-geometry.json](full-geometry.json) proves that original geometry plus cropped-texture UV mapping restored zero difference at the original scale.
2. **The crop did not preserve the complete mip domain.** That first repair still failed when reduced to 25% scale: [production-far.json](production-far.json) retains the 113/70 maxima and 557 changed pixels per pass. An eight-texel crop alignment preserves only the first few mip grids. Higher levels use different averaging partitions; smaller textures also reach their terminal mip earlier and clamp at different boundaries. NPOT action sources (320/640) require their original chain as well. Raising alignment just enough for one camera was rejected.
3. **A diagnostic fixture could report false empty-image success.** `readRenderTargetPixels` restored the resolve framebuffer; subsequent draws needed the multisample framebuffer rebound. Shadow rendering had masked the missing explicit rebind. Each draw now binds its target, verifies both candidates differ visibly from an empty scene, captures shader diagnostics and browser errors, and writes an amplified difference image. The invalid initial empty-image controls are identified in [DIAGNOSTICS.md](DIAGNOSTICS.md); their zero differences are not validation.

## Production correction

Nonempty cards now retain the full authored source domain at the existing density, including transparent padding and NPOT dimensions. Empty cards may retain a 16×16 all-zero allocation. The unused crop scan, offsets and crop-UV attributes were removed; texture-array batching, pose caching and resource ownership remain in the same implementation.

`cardRect` reproduces the original `PlaneGeometry(...).translate(...)` float32 endpoints per instance, including different foot anchors and 128/160 domains. Instance matrices retain the original world transform. Conservative bounds cover the expanded geometry; raycasting uses that same authored plane and reads its full-source alpha. Mirror, transparent/out-of-domain rejection and disposal are tested.

The separately configured translucent remains pool supports instance opacity, depth testing with no depth writes, no shadows, no picking and an explicit render order. Its opacity never enters the painted-pose cache key. Default living materials retain their existing opaque cutout policy. The deck remains lane verifies its actual scene integration separately.

## Executed validation

- [Standard](final-standard.json), [mixed domains/densities/feet/mirrors](final-mixed.json), [nearest](final-nearest.json), [linear](final-linear.json), and mixed-domain minification at [0.5](final-minify-0.json), [0.25](final-minify-1.json), [0.125](final-minify-2.json), [0.0625](final-minify-3.json): all pass, RGBA source differences zero, all shader programs runnable, GL error zero, browser errors empty.
- Every corresponding PNG has reference / production / difference ×8 columns. Mixed near-view and the furthest view were manually reviewed; silhouettes remain present and difference panels are black.
- [11 focused tests pass](focused-tests.log), including original mip extents, mirrored alpha picking, cache eviction, resource disposal and translucent policy. [Global typecheck passes](typecheck.log).

Reproduce, for example:

```sh
node --import tsx scripts/painted-card-gpu-proof.mjs --query 'domains=mixed&zoom=.0625' --out work/gpu-parity.json
npx vitest run src/client/world3d/painted-card-batches.test.ts
npx tsc --noEmit
```

## Costs and scope

This restores transparent quad area and full-source texture allocation. Triangles remain two per card, but transparent overdraw and texture/upload bytes can increase versus the cropped implementation. **The a62c95b crop memory savings are historical and must not be attributed to this final version.** This lane did not run a thousand-unit benchmark; performance must be remeasured on the corrected source.

These comparisons use identical CPU canvas source pixels, Chrome 151 and SwiftShader. They establish texture/geometry/filter parity for the tested path, not universal hardware results or equivalence between CPU and GPU canvas antialiasing. The previously measured CPU-versus-GPU scratch-raster differences remain a separate finding.
