# Exact PNG archive

All 62 original PNGs are stored, including selected images retained here, in the shared archive identified by [png-archive.json](png-archive.json). Complete sorted filename/size/SHA sets select archive reuse; similarity alone never deduplicates. Original encoded PNG SHA values are preserved exactly. Raw proofs, source hashes, numerical results and any failed diagnostics are unchanged.

Run from the repository root:

```sh
python scripts/art-card-current-correctness-archive.py --verify --folder card-streaming/latency-investigation/current-correctness/camera
python scripts/art-card-current-correctness-archive.py --materialize --folder card-streaming/latency-investigation/current-correctness/camera
```

Materialization defaults to this original folder so old comparison tools work unchanged. Existing retained PNGs must match their original SHA; changed files are never overwritten. Add `--out /tmp/new-directory` to restore elsewhere. Both commands verify the original source documents, full container SHA, exact member set and each extracted PNG SHA. Archive verification proves evidence preservation, not that a historical failed comparison passed.
