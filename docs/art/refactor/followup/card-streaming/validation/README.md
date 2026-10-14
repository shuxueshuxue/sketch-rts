# Integrated client validation

The final production source is frozen at
`0de509cc01e47b91a3012d33d2e75a7106d3e4a5`. The client source tree was clean;
later documentation, harness and evidence changes do not change that source.

The integration merge `99f84c2b503cf6c37a31c6195daa6aee5e7ea601`
incorporates main `ed22d4c` without changing any `src/client`, `src/shared` or
`src/server` file relative to `0de509c`. Main's AI and workflow changes are
preserved. The frozen art/rendering measurements below remain attributed to
`0de509c`, rather than relabeled as measurements of the later merge.

- [Client suite](client-final.log): **124 files / 956 tests passed**, including
  the complete seven-test paint-identity file, ordered card lifetime/compaction,
  shader patching, world-layer integration, first-gesture audio and independent
  mercenary art, implicit-sampling defaults and demand-sized page allocation.
  Duration 63.12 s; this correctness run overlapped the production build and
  camera correctness captures. It is not a game performance measurement.
- [Production build](build-final.log): `npm run build:production` exited zero.
  This includes TypeScript checking, Vite production assets and the server
  bundle. Vite's chunk-size advisory remains; it is not a build failure.

After the main integration, [28 lockstep client tests](client-integration.log)
and [the full production build](build-integration.log) passed again. This
specifically checks the client integration with the retained main AI changes;
it does not rerun or relabel the frozen GPU performance samples.

The earlier `e02b24e` validation remains separately preserved in
[client-e02.log](client-e02.log) (124 files / 952 tests) and
[build-e02.log](build-e02.log). Its default eight-bank policy was subsequently
rejected after formal timing. These earlier logs do not validate the new
default policy or page allocation.

Reproduce coverage from a detached checkout of that commit with the same locked
dependencies:

```sh
npx vitest run src/client --maxWorkers=1 --minWorkers=1
npm run build:production
```

The test suite includes mocked GPU integration checks and exact native CPU
raster comparisons. It does not replace the separately recorded browser
Canvas, WebGL color/shadow/distance, camera, actual-game and resource proofs.
No test, build, capture, video encoding or raster matrix runs concurrently with
the final formal performance sampling window.
