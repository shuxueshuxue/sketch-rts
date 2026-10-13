# Single-bank explicit-gradient attribution

This experiment isolates **one texture lookup change** in the same production one-bank card pipeline. It does not modify the frozen production helper or formal game harness. The test-only wrapper calls the original `onBeforeCompile`, then changes only `texture(map, vec3(vMapUv, vCardLayer))` to `textureGrad` with `dFdx(vMapUv)` / `dFdy(vMapUv)` calculated before sampling.

The fixture retains a fixed 100-unit snapshot with 20 authored kinds and five pose groups, original density 4, native GPU mip tails beginning at level 1, the same instance order, geometry, alpha tests, texture data, mip chains and anisotropy. All three material passes use the same substitution. It is a direct Three scene, not the complete game's simulation, Canvas world/HUD or animation workload.

## Strict proof

Four independent WebGLRenderer lifetimes run ABBA: implicit, gradient, gradient, implicit. Every lifetime compares native color, directional shadow depth and all six point-shadow distance faces against the first implicit arm. The first implicit lifetime captures 10 oracle targets. The other three lifetimes produce **30 actual comparisons with zero differing channels**: 20 gradient targets and 10 repeated-implicit targets. There are 40 target captures in total; the initial oracle self-checks are not counted as independent comparisons. No alpha mask or tolerance is used. Source hashes before/after match; browser errors, loading failures and GL errors are absent.

## Timing

Compilation, resource setup, strict readback/hash and teardown happen outside sampling. Each lifetime warms six directional-shadow frames, then measures 12 frames paced by `requestAnimationFrame`, with a fence confirming completion before advancing.

| Lifetime | Lookup | Complete wall mean ms | Submission mean ms | Completion wait mean ms |
|---:|---|---:|---:|---:|
| 0 | implicit | 194.99 | 0.708 | 194.28 |
| 1 | grad | 511.34 | 0.642 | 510.68 |
| 2 | grad | 492.22 | 0.558 | 491.62 |
| 3 | implicit | 190.42 | 0.583 | 189.83 |

The two implicit lifetimes average **192.70 ms**; the two explicit-gradient lifetimes average **501.78 ms**, approximately **2.60×** the complete wall time. Submission remains around 0.6 ms in both arms. The added cost appears in completion waiting, even with **one sampler and no bank-selection branch**.

This makes explicit-gradient sampling itself a measured contributor on this Chromium/ANGLE SwiftShader setup. It does **not** prove that an eight-bank shader performs eight physical texture samples, explain the driver's internal implementation, or establish hardware behavior. Changing only switch/if branch layout would still retain this measured lookup-path cost.

Fence completion wall includes GPU command processing and polling/event-loop scheduling. It is **not** a GPU timer-query duration, hardware FPS, or formal game performance result. The 12 samples per lifetime are suitable for this large paired attribution effect, not a stable tail-latency claim.

## Reproduce

```sh
node --import tsx scripts/card-grad-diagnostic.mjs --source . --out /tmp/card-grad-repeat/raw.json --frames 12 --warmup 6 --base-mip 1
```

[raw.json](raw.json) records per-frame values, fence wait details, snapshot/order hashes, all native pixel target hashes, source/script hashes, device/version and the preserved resource/quality settings. Level zero and other graphics devices were not measured in this diagnostic.
