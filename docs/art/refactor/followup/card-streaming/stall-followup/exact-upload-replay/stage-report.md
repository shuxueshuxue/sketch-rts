# Native upload/generation versus tail-copy brackets

The new stage replay completed **EXIT0/PASS** in
[stage-run-v3/proof.json](stage-run-v3/proof.json.gz). It reused the original actual
53 n135 payloads; no production method became asynchronous and no content command
was replaced. The preceding [stage-run-v2 startup failure](stage-run-v2/proof.json.gz)
and [log](stage-run-v2/run.log.gz) remain intact: archive pruning moved the original
proof to gzip, and v2 lacked gzip support for that small metadata file. The failure
occurred before browser/GPU startup, not during native correctness validation.

The new v3 driver supports both proof and corpus gzip. It verifies full stored and
decoded size/SHA against the archive manifest, then independently binds the decoded
corpus to the original proof's complete capture export. The original captured JSON
is 123,861,068 bytes with SHA
`78cbe11c56cc3ca61949f6bff83b7307136bc225366f3ec4fb507e4257fe5721`.
Compressed bytes retain a separate identity; they are never substituted for the
original decoded-input checksum.

- [Stage summary](stage-run-v3/stage-summary.json.gz)
- [Complete stage-query result](stage-run-v3/replay-stage-query.json.gz)
- [Independent per-event validation](stage-run-v3/replay-validate.json.gz)
- [Actual transformed HTTP script proof](stage-run-v3/runtime-http-scripts.json.gz)
- [Complete execution log](stage-run-v3/run.log.gz)
- [Prepared protocol and timing boundary](stage-plan.md)

The independent validation checked every upload immediately: **523 written native
mip levels** were exact against full-domain native sRGB GPU-generated oracles.
Both passes checked **1,040 final resident native mip/layer combinations**, including
untouched layers, and complete prior/final uploader scratch/page state. The actual
prefix's batch page/card maps matched. All 53 upload inputs remain the original
full RGBA domains; transparent RGB, clearing, source-level offsets and mip tails
are retained. Timed replay reuses validation hashes without creating oracle GPU
textures.

The synchronous public `renderer.copyTextureToTexture` hook ended query A just
before the first full-domain scratch-to-destination tail copy, then began query B.
It ended B when the original synchronous upload returned. A and B never overlap.
An external async completion fence followed each whole upload. **106 actual query
results** were available, with no disjoint interval.

| Command boundary | Query intervals | Summed elapsed | Maximum interval | CPU submission total |
| --- | ---: | ---: | ---: | ---: |
| A: CPU diff/source upload plus native full-chain generation | 53 | 810.939 ms | 19.716 ms | 32.10 ms |
| B: all original mip tail copies | 53 | 93.383 ms | 2.429 ms | 6.20 ms |

The complete replay envelope was **1,095.80 ms**, including **38.30 ms** submission
and **1,055.80 ms** completion waits, plus loop/marker overhead. Summed A/B query
intervals were **904.323 ms**. A occupies about 89.7% of those query intervals;
the 102,868,324 native copied bytes do not by themselves identify the dominant
command phase. In this diagnostic, the source upload/generation boundary takes
most of the elapsed marker time.

These are command-boundary intervals, not exclusive algorithms. A includes CPU
scanning and command arrival/idle before source upload/generation; B includes
arrival and marker overhead around the original copies. Fences include polling
and scheduling. Results describe software Chromium 151/ANGLE SwiftShader and one
isolated replay; they are not formal ABBA, a game frame benchmark or a hardware
GPU prediction. Native generation cannot yet be assigned all of A's elapsed time.

The selected native content sequence stayed exact: 53 `texSubImage2D`, 53
`generateMipmap`, 46 `copyTexSubImage3D` and 477 `blitFramebuffer` calls, without
new target storage allocation. Original transfer counts and bytes matched.
All 1,125 source files stayed frozen against 42bd; dependency bundles and complete
query Three identity remained stable. This run's HTTP collector directly passed
**199/199 saved script bodies and 388/388 inventory mappings**. Its six JSON
mapping bridges retain actual literal imports, exact same-origin `?import` URLs,
body identities and real graph dependencies; other semantic queries remain intact.

No production optimization is promoted. A further minimal diagnostic can split A
at the actual `generateMipmap` call entrance while retaining the original call and
all native content. A batched generation candidate would require deliberate
source-slot ownership and flush-before-copy/render semantics, and could recalculate
warm layers; it should not be implemented merely from copied-byte counts.

Used v2-version helper bytes and the actual v3 driver are snapshotted in stage-run-v3. Browser
and temporary server teardown completed, and the exclusive window was released.
No new compression overlapped this measurement; evidence packaging is a separate
parent-lane action.

Exact packaging has now completed independently of measurement. [The stage archive guide](stage-archives/README.md)
records 222 fixed inputs, their original size/SHA and same-path gzip, plus the
single v3 complete source snapshot. The v2 failure saved only its proof/log;
no helper or source snapshot was produced for that startup failure.

Before checking stored stage evidence, restore original v1 inputs if the tool
reads that corpus, then stage inputs and the v3 source snapshot:

```sh
python3 scripts/art-replay-input-archive.py --materialize
python3 scripts/art-replay-stage-input-archive.py --materialize
python3 scripts/art-replay-stage-source-archive.py --materialize --folder exact-upload-replay/stage-run-v3
```

These commands omit `--out` and restore original filenames. Use the executed
driver/helper snapshots preserved in the run, including the [v3 driver](stage-run-v3/art-card-upload-replay-proof-v3.mjs.gz)
and [v2-version observer](stage-run-v3/art-card-upload-replay-observer-v2.mjs.gz); current maintained scripts have
advanced and cannot replace past execution bytes. Restoration preserves the
original v1 corpus identity and all query/validation results. The SDK rerun for
this packaging is deferred until the next stage; prior 22-item baseline results
remain historical observations.
