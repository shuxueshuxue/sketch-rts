# Upload chunk candidate: portable CPU contract proof

The repository entry point is [art-card-upload-chunk-mock.mjs](../../../../../../../scripts/art-card-upload-chunk-mock.mjs), with the fixed [test source](../../../../../../../scripts/art-card-upload-chunk-mock.ts). This is a deterministic renderer model; it creates no Canvas, browser, WebGL context or performance workload. It checks full RGBA/base-layer bytes, dirty rectangle coverage, mip generation order, native-tail copy coordinates, recovery, texture identity and original non-time counter semantics. The model does not reproduce native sRGB mip filtering. Strict native GPU mip comparisons and whole-frame ABBA remain separate requirements.

The candidate is frozen at SHA-256 `8151202f0add0044a30147645515200e69fde494f439cb801888e62e75f75783`. Its full original provider is SHA-256 `3526789cda89f194eb9ee69ec266c163f043d75d88c8ef892870d1d5dfa1e295`, from commit `5b356c7795068bb2a532ad1d486b3c22936cf735`. Both providers must use the same unchanged region helper, SHA-256 `25d852a8b6424c81648e93b68db98de1076cee90659d3f2b01cc5b07878c8439`. The driver validates these bytes before bundling. It leaves the frozen metadata untouched; that metadata's old `/tmp` mock hashes describe the earlier tool, while each repository run records the ported driver and mock source hashes independently.

Both the earlier frozen tool and this repository entry point have now been executed by the owner:

| Execution | Result | Exit code | Process wall time reported by owner | Saved evidence |
| --- | --- | ---: | ---: | --- |
| Earlier frozen `/tmp` tool | All seven cases passed | 0 | 0.215 s | [Initial JSON](../upload-chunk-mock-initial.json), [log](../upload-chunk-mock-initial.log) |
| Repository entry point | All seven cases passed | 0 | 0.147 s | [Portable proof](../upload-chunk-mock/proof.json), [log](../upload-chunk-mock.log) |

These process durations are execution facts, not upload or game performance measurements. The portable proof records identical before/after driver, mock, provider, region and bundled dependency hashes, with no violations. The candidate remains frozen at `8151202…`. The repository driver also passed `node --check`. Original evidence headers and the source metadata's historical `staticPreparedOnly` field remain unchanged; they describe preparation provenance, rather than the subsequent run's status.

For a portable replay, from the repository root use the archived inputs:

```sh
node scripts/art-card-upload-chunk-mock.mjs \
  --candidate docs/art/refactor/followup/card-streaming/latency-investigation/upload-chunk-mock/proof.json.inputs/candidate.ts \
  --original docs/art/refactor/followup/card-streaming/latency-investigation/upload-chunk-mock/proof.json.inputs/original.ts \
  --region docs/art/refactor/followup/card-streaming/latency-investigation/upload-chunk-mock/proof.json.inputs/card-upload-region.ts \
  --metadata docs/art/refactor/followup/card-streaming/latency-investigation/upload-chunk-mock/proof.json.inputs/metadata.json \
  --out /tmp/card-upload-chunk-mock-replay.json
```

The four provider flags default to the original `/tmp` preparation locations; the explicit archived paths above remove that lifetime dependency. The [candidate](../upload-chunk-mock/proof.json.inputs/candidate.ts), [original provider](../upload-chunk-mock/proof.json.inputs/original.ts), [shared region helper](../upload-chunk-mock/proof.json.inputs/card-upload-region.ts), [source metadata](../upload-chunk-mock/proof.json.inputs/metadata.json), [executed driver](../upload-chunk-mock/proof.json.inputs/art-card-upload-chunk-mock.mjs) and [executed mock](../upload-chunk-mock/proof.json.inputs/art-card-upload-chunk-mock.ts) are all available as repository artifacts.

The driver derives the mock path and repository package resolution from its own location, independent of the caller's working directory. It imports `esbuild` through the repository package. Its resolver redirects the two virtual provider imports only at the fixed mock import point, redirects the region import only for those two provider paths, and resolves bare `three` for the mock and both providers to the one public ESM entry resolved from this repository. Providers retain their bare Three imports. The model asserts that textures created by each provider share the mock's public `THREE.DataArrayTexture` constructor.

The JSON output records argv, requested and canonical input paths, source metadata and its byte SHA, tool SHA, original/candidate/region/Three SHA before and after, every controlled resolver binding, bundle SHA, and before/after SHA of all bundled dependencies including the public Three entry's transitive source modules. Its sibling `.inputs` directory archives original, candidate, region, metadata, mock and driver bytes. Existing archive files may be reused only when their hashes match; conflicting bytes are preserved and fail the run. A temporary esbuild bundle is removed on completion.

To replay a captured input set from any directory, run this repository's driver and pass the archived files:

```sh
node /path/to/sketch-rts/scripts/art-card-upload-chunk-mock.mjs \
  --candidate /path/to/run.json.inputs/candidate.ts \
  --original /path/to/run.json.inputs/original.ts \
  --region /path/to/run.json.inputs/card-upload-region.ts \
  --metadata /path/to/run.json.inputs/metadata.json \
  --out /path/to/replay.json
```

The seven model cases cover the 345×264 dirty rectangle split into six ≤64 KiB copies, transparent nonzero RGB and old-pixel clearing, unchanged-source reuse, interruption after a physical segment write and conservative full retry, original 704→352 mip-tail copies and compaction, exact 64 KiB boundaries, and a mock-only row wider than 64 KiB. The latter tests subdivision arithmetic without allocating a real GPU texture or claiming hardware support for that width. `partialUploadCopyCalls` counts attempted physical partial copies, including an injected throwing call; existing byte counters retain completed logical-transfer semantics, with no per-segment double counting.

The owner also completed four whole-class uploader formal runs, each with two lifetimes, in ABBA order: [original A](../upload-abba/original-A/raw.json), [candidate B](../upload-abba/candidate-B/raw.json), [candidate B2](../upload-abba/candidate-B2/raw.json), [original A2](../upload-abba/original-A2/raw.json). Each process exited 0. The [formal driver](../../../../../../../scripts/art-card-upload-formal-proof.mjs) redirects the production batch module's uploader import to one complete frozen provider, including `CardMipUploader`, `createCardArray` and `cardTextureBytes`; it introduces no per-call copy wrappers. Both arms retain the same current art, cache, mask, peak accounting, order, native mip policy, preparation and timing flow.

The final [formal analysis](../upload-abba/report.md) rejects this candidate: CPU mean rises 0.72%, completion-wall mean rises 0.82%, and partial public-copy calls increase approximately 6.34×. All 24 captured PNGs retain exact decoded RGBA, but neither that result nor this passing mock establishes a useful performance gain or real native-mip filtering parity. No production integration or follow-up candidate raw-mip GPU run is claimed. The earlier invalid cross-run optimizer-path assertion and its failure remain archived alongside the corrected analysis; original evidence is not rewritten.
