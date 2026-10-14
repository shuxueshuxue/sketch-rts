# Stage A/B query plan (prepared, not yet executed)

Use new `*-v2` entry/fixture/observer/driver/freeze/HTTP collector files. Used v1
helpers, capture, failed runtime mapping metadata and companion audit remain
unchanged. Production source stays detached frozen 42bd.

The new driver reads the existing actual full capture or its lossless gzip. Before
launching the browser it verifies decoded complete JSON bytes/SHA against the
original capture export; stored compressed bytes/SHA are recorded separately.
The data route loads that same full corpus before any prefix or timing work. No
new actual target draw or fabricated GL-argument reconstruction supplies inputs.

Each pass restores the genuine stock fixture prefix and checks full original
scratch bytes/LRU/flags/config/native mips, actual batch/page map and all resident
native mip/layer hashes. One untimed validation pass generates independent native
source-chain hashes, verifies each immediate write, and supplies immutable oracle
hashes to the stage-query pass. The timing pass initializes no oracle textures.

During each original synchronous `uploadLayer`, a public
`renderer.copyTextureToTexture` diagnostic hook marks the first original
full-domain scratch-to-array tail copy. Stage A starts before the upload and ends
immediately before that tail copy: current CPU-to-scratch copy plus native full
mip generation. Stage B starts there and ends when the original upload returns:
all original tail copies. No GL generation is intercepted, delayed or replaced;
there is no asynchronous wait inside either production method.

Queries never nest: A ends before B begins. Each active query ends in `finally`,
and every created query is tracked for cleanup on failure. Missing or unsupported
public-copy ordering fails the proof. The observed current corpus is entirely
warm: each upload must have exactly one original CPU-view-to-scratch public copy
and the complete native tail copy count. Other events are replayed in recorded
order; this corpus actually contains only its 53 uploads.

After each whole upload, an external async completion fence drains pending work.
Stage query results are collected after completion, and final native state checks
remain outside timing. The selected content API sequence, uploader transfer
counts/bytes and full before/after native contents must match the original corpus.

A/B query elapsed intervals include command arrival/idle and inserted marker
overhead. Submission includes observer checks; fences include polling and
scheduling. Even a clear phase split is not exclusive algorithm time, a game
frame benchmark or hardware-general performance. No ROI/upload optimization is
implemented or promoted by this experiment.

The new HTTP collector admits a bare-JSON graph route only through an actually
captured importer JS literal, the real graph dependency, an exact same-origin
`.json?import` response and saved body SHA/size. It preserves other semantic
queries. Missing provenance remains a failure.

All six new v2 helpers pass `node --check`. Execution is budgeted at roughly
40–70 seconds for two actual prefixes, untimed native validation and one query
pass. It awaits independent static review, evidence IO completion and an explicit
owner-scheduled exclusive window.

```sh
node --experimental-strip-types scripts/art-card-upload-replay-proof-v2.mjs \
  --source /tmp/sketch-queue-source-42bd \
  --capture-run docs/art/refactor/followup/card-streaming/stall-followup/exact-upload-replay/run-v1 \
  --out docs/art/refactor/followup/card-streaming/stall-followup/exact-upload-replay/stage-run-v2
```
