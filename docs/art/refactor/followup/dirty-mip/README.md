# Per-layer mip generation candidate

Status: production correctness validated. Formal real-scene completed-GPU performance comparison is a separate pending measurement.

`CardMipUploader` stages each dirty full-resolution layer in a reusable ordinary
DataTexture. The GPU generates the same sRGB/alpha mip chain as before; public
`WebGLRenderer.copyTextureToTexture` copies each level into the corresponding
array layer. Array textures allocate the complete chain and keep
`generateMipmaps=false` permanently. The CPU base image remains unchanged for
picking. There is no shader, geometry, source resolution, filtering, or opacity
change.

The scratch pool is bounded to five sizes (the normal 16, 256, 320, 512, 640
source domains), with LRU disposal for other domains. The first array allocation
still uploads its complete base image; copying occupied base layers afterward
is deliberate duplicate work. Later updates never set the array's needsUpdate,
so unrelated layers and mip levels retain their contents. Dense/cold updates can
cost more than whole-array mip generation; formal completed-GPU timings, not
submission times, must determine the benefit on real workloads.

`finish()` prepares CPU data and instances; `upload(renderer)` is an explicit
mandatory operation before any color/shadow render. CPU-only tests may omit it;
renderer mocks must implement the public transfer contract. Copies restore the
current render target, cube face, and mip level through public APIs.

WorldLayer owns context listeners. Loss disposes old wrappers and scratch GPU
resources without issuing new GPU allocations; CPU pixels survive. Fresh array
wrappers replace color/depth/distance maps and all occupied layers become dirty.
The next restored draw rebuilds every occupied chain. Reset reuses listeners;
final disposal removes them. No Three private renderer state or node_modules
changes are used.

Reproduction commands:

```sh
npx vitest run src/client/world3d/card-mip-uploader.test.ts src/client/world3d/painted-card-batches.test.ts src/client/world3d/world-layer.test.ts
npx tsc --noEmit
node docs/art/refactor/followup/performance/scratch-mip-proof.mjs --fixture scripts/card-mip-gpu-fixture.js --out docs/art/refactor/followup/dirty-mip/production-mips.json
```

The production fixture imports the actual uploader and compares every layer at
integer/fractional LODs, sizes 512/640/320/256, dirty counts 1/4/16, alpha-test
coverage, and context restoration against whole-array GPU mip generation. The
existing painted-card strict fixture additionally covers real artwork, mixed
source domains, facing, feet, minification, directional and point shadows.


## Results and limitations

[SUMMARY.json](SUMMARY.json) records final relevant source/test/fixture hashes.
[production-mips.json](production-mips.json) imports the production helper and
passes every sampled RGBA/alpha-cutout comparison: 512/640/320/256, all 16
layers, integer and fractional LODs, dirty counts 1/4/16, and restored context.
All maxima are zero; GL/shader/browser/disposal errors are absent. It records
its run-time hashes separately: WorldLayer subsequently received the additional
context lifecycle fix below; the uploader and batch code did not change.

The eight `strict-*.json` files contain 16 directional/point-light comparisons,
all zero pixels/channel difference. Settings cover normal and mixed 128/160
source domains, density 2/4, mirrored facing, varying feet, nearest/linear
filter probes, and mipmapped zoom 1/.5/.25/.125/.0625. Source RGBA is exact.
Manual inspection of mixed, far-minified, and restored-world PNGs confirms
visible silhouettes, black difference panels, and unchanged ship/crew poses.

The real [WorldLayer context proof](world-context-final.json) renders a native
warship and two crew, forces actual loss/restoration, and compares the rendered
frame: zero pixel difference, unchanged CPU array identities, new texture
wrappers, and no rasterization increase. It then exercises reset, another draw,
and final disposal. GL errors are all zero; public GL delete-call diagnostics
are empty. [PNG](world-context-final.png) places before/after side by side.

The initial real-scene proof **failed** after restoration during reset:
`world-context-first-failure.json` and `world-context-split.json` retain GL1282.
`world-context-diagnostic.json` identifies stale pre-loss VAO/buffer and shadow
render-target dispose listeners. The fix publicly disposes scene-owned resource
views while the context is lost, before Three replaces its renderer registries.
It preserves CPU data and clears shadow targets for reallocation. Global model
assets are not traversed. Hidden cached scene instances are included; detached
retired instances were already disposed. Selection hull templates, rig model
sources, and global templates are never themselves submitted to this renderer;
their owned scene views are the uploaded resources. Final disposal was checked
as well as restored rendering, so the failure is not hidden by successful pixels.

[focussed final log](focused-final.log): 33/33 tests pass.
[global typecheck](tsc-context-final.log): exit 0. The initial typecheck failure
is retained in `tsc.log`; it involved only narrowed nullable/union types in the
new helper/tests. Empty successful typecheck logs are intentional.

The scratch pool allows at most five textures **per batch cache**. With the
normal 16/256/320/512/640 square domains, their combined CPU base is 3,359,744
bytes and complete GPU chains total 4,479,628 bytes (storage estimates, not RSS).
Living cards and deck remains have separate policy caches. Actual occupied
sizes and cumulative base/scratch upload bytes are reported by `cardStats()`;
array CPU/GPU estimates must be added to scratch estimates for the total.
First/cold allocations duplicate the initial array base upload by subsequently
copying each occupied base layer. Every dense dirty layer is still processed;
there is no generateMipmaps toggle or hidden quality reduction.

Production-helper micro timings, mean fence-completed milliseconds (3 runs,
SwiftShader; includes staging/copy and polling; excludes fixture generation):

| Source | Dirty layers | Whole-array | Per-layer |
| --- | ---: | ---: | ---: |
| 512 | 1 | 163.90 | 12.97 |
| 512 | 4 | 165.23 | 50.10 |
| 512 | 16 | 165.00 | 183.57 |
| 640 | 1 | 266.80 | 21.07 |
| 640 | 4 | 254.17 | 75.33 |
| 640 | 16 | 264.10 | 300.23 |

Dense all-layer updates are slower here. These isolated results explain the
optimization mechanism; they are **not** gameplay FPS or real-scene improvement
claims. Formal cold/dynamic/static timings and total memory remain to be measured
on the frozen production candidate. Full source domains and transparent overdraw
remain identical to the corrected baseline; historical cropped-texture memory
savings do not apply.
