# Ordered texture-bank GPU correctness

The final `banks/matrix.json` ran against rendering core commit
`02197dc0a1e521f7580f5416bf53465441ce8d95`. Its shader, batches and uploader file
hashes match the detached `/tmp/sketch-bank-order-source` snapshot. The earlier
105-case result at `0246064` is retained as `banks/matrix-0246064.json`, with
exact fixture and harness snapshots whose hashes match that historical result.
That earlier run precedes the fixed actor/native render-order interval and
does not include the native same-plane tests.

This is the frozen multi-bank core proof, not a measurement of final default
dispatch. The final `0de509c` renderer defaults to one bank with implicit
sampling; its shader and uploader retain these hashes, while batches changed
the default and demand-sized page allocation. Final one-bank camera, actual
combat and performance validation is recorded in
[the current report](bank-order/README.zh.md).

The final matrix has **135 cases**, all passed on Chromium WebGL2 / SwiftShader:

- 1, 2, 8, 9 and 16 resident texture banks. This tested configuration uses
  at most eight banks per draw and splits the 16-bank interleaved stream into
  multiple chunks.
- Full original 256, 352, 512 and 704 domains, mixed sizes, and original native
  mip tails at N1/N2. Original geometry, UVs and literal float32 foot/quad
  endpoints are unchanged.
- Interleaved coplanar `A0/B5/A10/B15` ordering with both warm cache hits and
  cold misses, as well as varied foot offsets and separated rotated cards.
- Actual existing palettes/facing, idle/attack/cast painters, opaque cutout,
  per-instance opacity and a no-blending RGBA diagnostic.
- Native opaque same-plane geometry created both before and after actor
  materials, exercising material-ID ties under different bank segmentation.
  These 30 cases record the native geometry and material ID. All actor chunks
  remain in `(0,.001)`, with observed orders `.0001` through `.0009591`, so a
  native object at order zero has the same relation to both paths.

Both sides execute actual `PaintedCardBatches` allocation, rasterization,
upload, cold/warm lookup, original-mip residency and ordered draw publication.
Test-only calls to the real `createPage(width,height,1)` force the requested
bank count without rasterizing hundreds of otherwise redundant poses. Every
preallocated page receives a real card before the frame finishes. There are no
mock textures or mock GPU operations.

The reference uses one-bank ordered chunks and a frozen copy of the original
implicit `texture(map,vec3(...))` shader, independently of the new bank helper.
The candidate uses the actual production multi-bank `textureGrad` helper and
its public material bindings. The fixture records each chunk's IDs, submission
ordinals, texture dimensions, bank/layer attributes and original cardRect.
Both complete request sequences agree exactly; cache completion order cannot
replace submission order.

Every case compares all RGBA channels in the main image, the actual 2048-square
directional shadow pass's packed-depth color attachment, and all six faces of
the point-light distance pass. In total, **2,809,036,800 RGBA components** were
compared, with **zero changed channels**. The RGBA diagnostic really contains
alpha-zero, nonzero-RGB pixels (at least 901 per image); the comparison applies
no transparency mask or numeric tolerance. The prototype does not introduce
depth bias, move geometry or change the source painter to reconcile results.

No GL, console or network errors occurred. The final core hashes were:

```text
card-bank-shader.ts    53197460498c2d67ed495fb19725c7fdaf6a1cc600f6b19e4491e4e15aa9c144
painted-card-batches.ts b364aadd3144310ec431d799cd3c0978787cf40a78cb3c6e0a148810df7cf5b5
card-mip-uploader.ts   3526789cda89f194eb9ee69ec266c163f043d75d88c8ef892870d1d5dfa1e295
```

Reproduce serially against a detached source snapshot:

```sh
node --import tsx scripts/card-bank-gpu-proof.mjs \
  --source /tmp/sketch-bank-order-source \
  --out docs/art/refactor/followup/card-streaming/banks/matrix.json \
  --cases 9 --banks 1,2,8,9,16 --modes opaque,opacity,rgba
```

For the late native smoke case, use `--start-case 8 --cases 1 --banks 8
--modes opaque`. Browser readback, hashing and instrumentation make this a
correctness result, not a performance measurement. Hardware GPU filtering and
complete game-level behavior remain separate verification requirements.
