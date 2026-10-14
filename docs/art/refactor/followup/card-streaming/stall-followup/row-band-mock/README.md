# Row-band CPU transfer contract (native GPU passed, timing pending)

The standalone complete uploader candidate changes only the warm CPU view/Box2
setup from source `8345a0dcfeb96b6777ac3940ec64cba13816c851`. Its GPU scratch
keeps the full authored domain and original native generate/copy chain. There
is no pixel packing, new large pixel buffer, quality/content change or production
integration. Candidate/source/region SHA identities remain `7523e7c…`/`3526789…`/
`25d852a8…`; full hashes and source bytes are in each evidence set.

The warm view aliases the existing full scratch buffer: byteOffset is
`top*W*4`, byteLength `dirtyHeight*W*4`, image width remains `W`, source y is
rebased to zero, source x remains `left`, destination remains `(left,top)`.
The same `dirtyWidth*dirtyHeight*4` physical rectangle and one public copy/native
generation remain. A shorter view is not an already measured reduction of GPU
transport bytes or wall time. A full-height column still exposes the full view.

## Actual executions

- [Initial failure](initial-failure/proof.json), process exit 1, wall 0.765 s:
  a sentinel comparator incorrectly compared `Uint8ClampedArray` against
  `Uint8Array` using strict deep equality. Their seven sentinel bytes were equal;
  the array constructors differed. Original proof, metadata and all executed
  source bytes remain [archived](initial-failure/proof.json.inputs/).
- [v2 pass](v2-pass/proof.json), process exit 0, wall 0.797 s: all 16 cases and
  10 negative checks pass, with no violations. v2 changes only that comparator
  to normalize byte-array type. Candidate, original, helper and source metadata
  stayed byte-identical before/after; [executed inputs](v2-pass/proof.json.inputs/)
  retain v2 driver/mock bytes separately from the initial failure.

- [v3 pass](v3-pass/proof.json), process exit 0: both complete providers run
  all 16 modes, each with 10 negative checks, and all actual modeled RGBA SHA
  sequences match. [Executed inputs](v3-pass/proof.json.inputs/) preserve both
  providers, dependency, metadata and the exact v3 mock/driver.

These process durations are mock execution facts, not upload/game performance.
Metadata's historical `staticPreparedOnly` and preparation tool hashes remain
unchanged. Actual run status/tool hashes are in each proof; preparation metadata
is not rewritten to conceal a failed execution. Raw absolute paths describe
the original `/tmp` run; this directory preserves identical portable artifacts.

The passing v2 checks full base/every modeled mip RGBA, shared alias/stride/
byteOffset, readonly offset/clamped caller inputs, transparent RGB/old-pixel
clearing, unchanged reuse, 640/704 NPOT boundaries, 704/256 native tails,
non-square 640x704, compaction, complete-public-copy failure/full retry, target/
face/mip restoration, dispose/recreate and invalid input prevalidation.
Its 512 main case explicitly runs both complete providers; the other modes
compare the candidate against full input and the fixed model. The v3 execution additionally runs both complete providers in every mode and
compares actual modeled RGBA SHA sequences. v2 source, driver, failure and pass
evidence remain intact.

## Scope and subsequent validation

The integer-box mip model is deliberately not native GPU sRGB filtering. It
checks every actual model byte independently of the expected full input before
hashing, but cannot replace per-layer/per-native-mip raw WebGL readback. Context
lifecycle here is dispose/recreate, not real loss/restore. Failure injection is
after the complete modeled public copy, not inside Three UNPACK setup/restoration;
Three's existing internal-exception state boundary is not claimed covered.
CPU wrapper must never be initialized or registered through renderer properties.

The [real native GPU proof](../row-band-native/README.md) subsequently passed
both providers, including raw encoded RGBA at every native mip, NPOT tails,
real context loss/restore and public-copy failure retry. It is correctness
evidence, with deliberate fences/readbacks, not a performance measurement.

The original formal driver remains historical preparation. New
`scripts/art-card-upload-row-band-formal-proof-v2.mjs` additionally captures
complete tracked source and runtime helper bytes, the module graph, third-party
module hashes, and completed startup/final optimized entry/chunk hashes. All
Three identities include version queries and must match the startup entry.
It selects the whole standalone provider at the exact production batches import
and keeps frozen 8345, the original mixed100 hidden0 schedule, 16 MiB cache,
one-level mip gate, one-bank implicit sampling, 60 CPU / 12 real samples and
the cold jump. No per-frame observer is added. v2 has passed syntax checking;
browser runtime/pilot and balanced ABBA remain pending an owner-scheduled quiet
window. No performance acceptance or production uploader change is claimed.
