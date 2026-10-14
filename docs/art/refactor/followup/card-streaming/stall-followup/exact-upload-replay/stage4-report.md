# Final upload / native-generation / tail-copy diagnostic

The three-boundary replay completed **EXIT0/PASS**. It isolates where the current
software renderer spends command-marker time without changing production work.
It does not promote an upload or mip optimization.

- [Actual v4 proof](stage-run-v4/proof.json.gz)
- [Small generation summary](stage-run-v4/generation-summary.json.gz)
- [All 159 query intervals and waits](stage-run-v4/replay-stage-query.json.gz)
- [Independent native validation](stage-run-v4/replay-validate.json.gz)
- [Actual HTTP script provenance](stage-run-v4/runtime-http-scripts.json.gz)
- [Complete execution log](stage-run-v4/run.log.gz)

## Actual results and clock boundaries

All 53 uploads have three supported, non-disjoint query intervals. The observer
ends the upload query at the actual `gl.generateMipmap` entrance, begins the
native-generation query, and calls the original GL function immediately with its
original receiver and arguments. At the first original scratch-to-array public
copy, it ends generation and begins the tail-copy query. Queries do not nest and
close in `finally`; each whole upload is followed by an external completion fence.

| Original command boundary | Actual intervals | Summed query elapsed | CPU submission total |
| --- | ---: | ---: | ---: |
| Upload before native generation | 53 | 0.03892 ms | 32.80 ms |
| Native generation through first tail copy | 53 | 826.53367 ms | 0.40 ms |
| All original tail copies | 53 | 95.01889 ms | 9.00 ms |

The summed query elapsed time is **921.59147 ms**, of which the native-generation
boundary represents approximately **89.7%**. The entire replay envelope is
**1,109.40 ms**, with **42.20 ms** submission and **1,064.80 ms** completion waits,
plus loop/marker overhead.

The tiny upload query value is a result in this driver's GPU timer domain. It does
**not** mean CPU scanning, transport or uploading is free: that segment submits
for 32.80 ms on the CPU. Query and CPU clocks cover different work, overlap and
must not be added as independent costs. Native-generation query intervals can
include command arrival/idle and instrumentation around the original call; they
are not exclusive mip algorithm time. Completion waits include polling and
scheduling. These values are isolated diagnostic timings, not general FPS,
formal before/after measurements or hardware GPU predictions.

The actual command phase evidence points to full native mip generation in this
software environment. The 102,868,324 copied mip bytes are not sufficient grounds
to prioritize tail-copy changes: their measured boundary occupies roughly 10.3%
of the marked elapsed time.

## Exactness and provenance

The replay reused the original captured 53 full RGBA inputs. Original proof and
corpus gzip **stored and decoded** sizes/SHA were checked against the verified
archive manifest; the complete decoded corpus also matched the original capture
export. Each pass restored the actual 18 preparation draws and all 81 paced prefix
frames through n134, then compared complete scratch bytes/LRU/flags/config/native
mips, actual batch/page/card map and every prior page mip/layer.

Independent validation read each destination write immediately: **523 written
native mip levels** matched independently GPU-generated, original-domain sRGB
source chains at zero RGBA difference. Both passes verified all **1,040 final
resident native mip/layer combinations**, including untouched layers. Full source
RGBA, transparent RGB, source-level offsets and original native mip tails remain
unchanged. Timed replay reused validated oracle hashes without creating oracle
textures.

The selected native content sequence remained exactly 53 `texSubImage2D`, 53
`generateMipmap`, 46 `copyTexSubImage3D` and 477 `blitFramebuffer` calls, with no
new target storage allocation. Original transfer counts and bytes matched. The
CPU-only source view remained uninitialized. The observer did not add, defer or
replace source uploads, native generation or tail copies.

All **1,125 source files** stayed frozen against
`42bd61c74934dc76f30d42b62e1e31eb5c5974ff`; startup/finish dependency bundles and
complete-query Three identity stayed stable. Actual transformed HTTP JS coverage
passed **199 saved bodies / 388 of 388 inventory entries**. JSON bridges retain
actual import literals, real graph dependency edges, same-origin complete
`?import` URLs and body identities. All prior failures remain in their original
artifacts: the v1 HTTP mapping failure and the v2 pre-browser gzip metadata-layout
failure were not rewritten into successful runs.

## Production decision and remaining conditions

Keep the current complete native mip chain and public partial-upload path. None
of the measured synchronization diagnostics, earlier row-band/two-slot pilots,
or upload chunking results justify a new production upload change. Do not cut
visible content, lower animation frequency, remove mip levels or substitute a
handmade mip filter to claim a speedup.

This execution uses Chromium 151 / ANGLE SwiftShader. `/dev/dri` is absent in the
selected environment, so there is no local hardware GPU result. A hardware followup
must record the actual adapter/backend/browser, compare original and candidate on
that same device, and verify every original-domain native mip plus real game
frames. SwiftShader's marker distribution alone cannot select a universal policy.

One future, unimplemented public-API experiment is a depth-one DataArrayTexture
scratch instead of a 2D DataTexture scratch. It can retain the same full source
domain and synchronous upload contract without increasing raster/mip bytes, but
changes native generation and base-copy paths. Its independent oracle role proves
contents in the tested environment, not that it is faster. It requires its own
native proof and complete-frame comparison before any adoption. No such candidate
is implemented or promoted by this report.

Earlier long `WaitForToken` / 255–275 ms API spans still lack a proven caller-stack
and token-resource chain for that exact historical invocation. This replay drains
history and changes submission scheduling; its result does not retrospectively
prove the root cause of an old stall. Preserve that causal limit alongside the
now measured generation boundary.

Browser/server teardown completed and the exclusive CPU/GPU/IO window was released.
No production files, simulation rules or quality controls changed in this lane.
Evidence compression is a later parent-lane action and did not overlap capture.

That separate packaging has now completed. [The generation archive guide](generation-archives/README.md)
preserves 220 original inputs as exact same-path gzip, plus this run's single
complete source snapshot; original values, query data and failures remain intact.
Before checking stored evidence with its executed snapshots, restore original
v1 inputs when the tool needs that corpus, then v4 inputs and v4 source:

```sh
python3 scripts/art-replay-input-archive.py --materialize
python3 scripts/art-replay-generation-input-archive.py --materialize
python3 scripts/art-replay-generation-source-archive.py --materialize --folder exact-upload-replay/stage-run-v4
```

These commands omit `--out` and recover original filenames. The executed
[v4 driver](stage-run-v4/art-card-upload-replay-proof-v4.mjs.gz) and
[v4 observer](stage-run-v4/art-card-upload-replay-observer-v4.mjs.gz) are retained
in this run; current maintained scripts cannot replace past execution bytes.
Source recovery supplies the original `src` evidence, not a runnable checkout
with `.git`, `public` and `package.json`. Packaging is byte preservation, not
another replay or an additional production performance result.
