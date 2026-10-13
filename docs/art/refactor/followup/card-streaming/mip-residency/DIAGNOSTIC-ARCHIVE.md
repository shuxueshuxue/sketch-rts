# Historical battle frame preservation

Status: **verified and pruned**. The archive run freshly checked all 160 original PNG encoded SHA values, directly decoded their RGBA samples, verified the reference FFV1 container SHA and all 80 decoded reference-frame hashes, and compared complete RGBA bytes before removal. Exactly **158 redundant PNG files / 82,305,657 bytes (78.49 MiB)** were removed. The original exceptional PNGs remain: `battle-after/frame-008.png` and `battle-order-sort/frame-004.png`. A separate post-prune `--verify` invocation completed successfully and confirmed exactly these two difference indices. See [archive-run.log](archive-run.log), [verify-run.log](verify-run.log), and [diagnostic-frame-archive.json](diagnostic-frame-archive.json). Full materialization was not run.

The archive utility reuses `docs/art/refactor/followup/viewport-performance/battle/before/all-frames-lossless.mkv` from the repository root (the generated manifest records the movie path relative to this directory). It creates no duplicate movie. It touches only `battle-after/frame-NNN.png` and `battle-order-sort/frame-NNN.png`; other diagnostic captures, old failed comparisons and proofs remain unchanged.

Run from the repository root, with Node and FFmpeg installed:

```sh
# Verify every original PNG's encoded SHA against proof.json, directly decode
# RGB/RGBA samples, verify the existing FFV1 container and all 80 raw frames,
# compare complete RGBA bytes, and save diagnostic-frame-archive.json.
node scripts/art-card-battle-diagnostic-archive.mjs --archive

# Repeat verification before removing ONLY reference-identical frame PNGs.
# Exception PNGs retain their original encoded bytes.
node scripts/art-card-battle-diagnostic-archive.mjs --archive --prune

# Independently verify the manifest, proofs, container, every decoded reference
# frame, and retained exception PNGs after pruning.
node scripts/art-card-battle-diagnostic-archive.mjs --verify
```

When an old proof references a removed frame PNG, consult `diagnostic-frame-archive.json`. Each entry records the original encoded PNG SHA, decoded RGBA SHA, simulation snapshot hash, and either a reference movie frame index or a retained exceptional PNG. An encoded PNG hash remains provenance: identical raw pixels do not imply the removed original PNG encoding can be reproduced.

To reconstruct both complete 80-frame sequences into a **new, nonexistent** temporary directory:

```sh
node scripts/art-card-battle-diagnostic-archive.mjs --materialize --out /tmp/art-battle-diagnostic-frames
```

The output is `battle-after/frame-NNN.rgba` and `battle-order-sort/frame-NNN.rgba`, each 1280 × 900 RGBA8, top-to-bottom rows without padding. `materialization.json` is written only after full verification; without that completion record, treat output as incomplete. All 160 raw frames require approximately 737 MB. Any subsequent PNG encoding must be described as pixel-preserving reconstruction, not byte-identical recovery of the original PNG. The existing PNG-only comparison script requires materialized PNGs; the archive utility itself compares all reconstructed pixels against the reference and reports the historical exception indices.

`preservationVerified` means evidence integrity only. The original pixel-difference reports remain failed diagnostics; archiving does not turn them into successful production acceptance or performance results. No numerical benchmark or original proof is rewritten.
