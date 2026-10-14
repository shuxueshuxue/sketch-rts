# Exact n135 uploader replay (new diagnostic, not yet executed)

The existing v3 GL sequence records contain scalar arguments and ordering, not
RGBA payloads. They cannot supply an exact upload corpus. A new non-performance
capture is required. Production source remains frozen 42bd and synchronous methods
remain unchanged; only new diagnostic scripts and evidence are added.

## Minimal capture

Run the real mixed100 fixture from a cold WorldPresentation: original 18 preparation
draws n0..51 with their completion waits, then the original paced CPU prefix
n54..134 with renderer.render disabled. Immediately before n135, copy the full
application scratch map in LRU iteration order: original dimensions, independent
RGBA bytes, uploaded/retryFull flags, public texture configuration and mip boxes.
Record all live page IDs, uploaded/ready state, dimensions/depth and every mip
shape. These are application objects, not private renderer GL properties.

Drain the historical queue and fingerprint every native mip/layer of all live
pages in this separate untimed capture. This deliberately changes queue history;
no control/frame performance claim is made. Raw framebuffer reads are diagnostic
only and restore bindings/packing/render targets. Keep the whole initial-state
hash table, including untouched layers. Do not dump thousands of historical RGBA
uploads or fabricate prior page contents from GL scalar arguments.

During the original synchronous n135 draw, an uploader prototype observer copies
each readonly full RGBA input into independent storage *before* calling the exact
original method. Capture the actual ordered stream: uploadLayer destination page/
layer, original source dimensions, baseMip, page readiness, and any actual
copyLayers/releaseSize/dispose events. Copy all vectors/boxes/arrays immediately;
production reuses them. New pages have creation-order IDs and the complete public
createCardArray configuration. Require exactly 53 upload payloads, and record
non-upload events rather than assuming no compaction/release.

The actual method still executes synchronously. After the draw, wait for completion
and fingerprint every final live page/mip/layer. Preserve original frame facts.
All RGBA, including nonzero RGB at alpha0 and padding, is retained. The capture is
not an optimization benchmark: input copying, state fingerprinting and fences add
observer work.

## Reproducible preparation and replay

Every replay arm uses a new renderer and executes the same real production fixture
prefix through n134. Page identity is normalized by logical creation/first-use
order. Compare its complete scratch bytes/LRU/flags/config, page readiness/shapes,
and all prior native GPU mip/layer hashes with the capture before accepting it as
a replay starting point. This uses authentic preparation, not handcrafted warm
pages. Drain history explicitly; initial-state reads and preparation are untimed.
Matching warm content does not claim identical undrained scheduler/token history.

Then use the saved n135 RGBA and event stream in an independent async diagnostic
loop. Original uploader methods remain synchronous and receive the original full
source domain/options. New destination pages use the recorded public factory
configuration and exact creation order. Replay compaction/release events in their
original interleaving. Fail on an unsupported event or missing source page rather
than skipping it.

Compare two synchronization policies: a single fence after the complete stream,
and an awaited fence after each successful upload. Each policy preserves all
original upload/native-mip/tail-copy content work. Report submission intervals,
individual waits/flush/poll/yield costs and the entire replay envelope; per-layer
completion is an observer perturbation, not a production wrapper change or speedup.
Independent non-nested native timer queries may mark each whole upload's command
boundary when supported. Their elapsed time includes command arrival/idle; it is
not exclusive algorithm time. No GPU duration is invented when unsupported or
disjoint.

Validate every final native mip/layer against capture. Independently GPU-generate
the full original source RGBA for each payload and compare destination tail
sourceLevel=baseMip+destinationLevel, raw encoded RGBA at tolerance 0. Run a separate untimed validation replay first, reading every destination write
immediately so later overwrites cannot hide a defect. That pass generates the
independent oracle hashes once. The two timed arms reuse those hashes and do not
initialize oracle textures or insert validation reads between uploads. Preserve untouched-layer comparisons. Only after whole-upload isolation
is correct and informative should upload/native-generation vs tail-copy brackets
be added; initialization is a separate observed phase if it actually occurs.

## Runtime execution provenance and storage

The new driver freezes the full dynamic tracked src inventory against 42bd Git
blobs, helpers, explicit Three/GLTF startup optimizer bundles and complete-query
Three identity, with final hashes and module graph. Additionally enable CDP Network
before navigation, collect every actual Script response body after HTTP decoding,
and archive the transformed runtime JS with URL/query, headers/status/mime, byte
size/SHA and loading metadata. Map all loaded production modules to received
bodies. Missing/evicted bodies fail provenance; raw TS snapshots alone are not an
executed-JS claim. Old v3 helpers/evidence are unchanged.

Current n135 has 53 inputs. At 512/704 square domains, full input corpus lies between
53 MiB and 101 MiB; prior CPU scratch is about 2.9 MiB. Actual byte totals, dimensions and
event counts are measured by the new capture, not assumed from this bound. Native
GPU prior/final states retain hashes, with bytes saved for discrepancies, avoiding
~190MiB full page dumps. The implementation is now prepared and all six new entry/helper files pass
`node --check`; no Browser run has been executed. Expected execution is roughly
1–3 minutes for capture, the independent validation replay and two replay policies;
all browser/large IO is owner-scheduled. This is one capture, one untimed validation and two diagnostic
arms, not formal ABBA or hardware-general performance evidence.

Existing >100MiB profiles/runtime corpora are never filtered or truncated. After
capture and analysis, losslessly gzip the complete standalone artifacts, record
compressed and original byte counts/SHA, and verify decompression before pruning
an uncompressed duplicate. Keep each asset payload separate and below Git limits;
full event JSON stays in its own gzip artifact referenced by hash/JSON pointer.
Preserve original filenames in the manifest and add `.gz` explicitly. No naming
rule is changed to hide a match, and no input/raw record is rewritten to pretend
it was produced compressed. Compression must not overlap a browser timing window.

Prepared entry: `node --experimental-strip-types scripts/art-card-upload-replay-proof.mjs --source /tmp/sketch-queue-source-42bd --out docs/art/refactor/followup/card-streaming/stall-followup/exact-upload-replay/run-v1`. The driver requires a new output directory and retains failure evidence. Actual execution awaits the owner's exclusive GPU window.
