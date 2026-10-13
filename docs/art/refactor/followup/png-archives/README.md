# Exact PNG evidence archives

All 14 explicitly authorized proof directories were found and processed. **954 original PNG files (792,843,206 bytes)** are preserved byte-for-byte in **4 shared tar.gz containers (211,643,224 bytes)**. **166 selected images (119,238,434 bytes)** remain directly viewable. **788 redundant PNG files (673,604,772 bytes)** were removed only after all source/proof and extracted-file checks completed. Net PNG payload reduction, after charging the archives, is **461,961,548 bytes (440.56 MiB)**; small manifests, documentation and logs are additional overhead. The largest container is **68,627,707 bytes (65.45 MiB)**, below the strict 90 MiB limit. No directories were skipped.

This is evidence preservation, not rendering optimization or a new benchmark. No images were decoded, resized, re-encoded or transcoded. Original PNG encoded SHA values remain valid. Raw proofs, source-tree checksums, failed comparisons and legacy diagnostics were not edited. The older mip-residency battle frame-008/frame-004 preservation scheme remains independent and untouched.

Each proof directory has `png-archive.json` and `PNG-ARCHIVE.md`. The manifest lists every filename, byte size, SHA256, available original-proof encoded checksum, retained-image flag, and original non-PNG source-document SHA. Full sorted `{name,size,sha256}` sets are hashed as canonical JSON; identical complete sets reuse one container. A merely similar set never shares a container. All containers include even the selected images retained outside them.

Archiving freshly hashed all source PNGs against all applicable encoded checksums discoverable in the original proof. Files without a published PNG checksum still have a fresh encoded SHA in the manifest and were extracted and checked identically; they are not falsely described as having an older independent checksum. Every container was extracted to `/tmp`, with exact member names/order/type/size and every extracted PNG SHA verified. After pruning, a separate full `--verify` passed for all 14 directories. The default in-place materialization path was also exercised on the mercenary gameplay directory: all 49 exact PNGs were restored and rehashed, then its 34 non-kept images were re-pruned and the directory independently verified again.

## Verify or restore after cloning

Requirements: Python 3.11+ standard library. No browser, FFmpeg or image library is needed. Run from the repository root:

```sh
# Verify every archive, original source document and selected image.
python scripts/art-png-evidence-archive.py --verify

# Restore one original directory before running its old PNG-based comparison.
python scripts/art-png-evidence-archive.py --materialize --folder card-streaming/bank-order/final/battle-candidate

# Restore all authorized directories in place (about 643 MiB additional space).
python scripts/art-png-evidence-archive.py --materialize

# Alternatively restore one complete file set into a new temporary directory.
python scripts/art-png-evidence-archive.py --materialize --folder mercenary-models/gameplay --out /tmp/mercenary-original-pngs
```

Materialization verifies the container and each extracted file before copying. Existing selected files must match the original SHA and are kept; changed files are never overwritten. In-place restoration makes the original comparison tools work without altering their proof inputs. `--out` restores only PNGs, so tools needing proof JSON should use the original directory or copy the unchanged proof separately. Verification checks manifests against unchanged source/proof documents and checks current retained PNG bytes as well as archive bytes. Archive creation is deliberately non-overwriting: an existing manifest requires `--verify` or `--materialize`, not another `--archive` run.

A verified archive does not change historical pass/fail results. All failed evidence remains recoverable with exact original PNG encoding.

## Inventory

| Directory under followup | PNGs archived | PNGs retained | File-set SHA prefix |
| --- | ---: | ---: | --- |
| card-streaming/mip-residency/camera-before | 62 | 8 | `daccf0681b83` |
| card-streaming/mip-residency/camera-after | 62 | 8 | `daccf0681b83` |
| card-streaming/mip-residency/camera-after-coexisting | 62 | 8 | `daccf0681b83` |
| card-streaming/mip-residency/camera-after-one-source | 62 | 8 | `daccf0681b83` |
| card-streaming/bank-order/camera-before | 62 | 8 | `d7dafc2b6bf5` |
| card-streaming/bank-order/camera-after | 62 | 8 | `d7dafc2b6bf5` |
| card-streaming/bank-order/battle-before | 90 | 18 | `8cec162c21e0` |
| card-streaming/bank-order/battle-after | 90 | 18 | `8cec162c21e0` |
| card-streaming/bank-order/final/camera-reference | 62 | 8 | `d7dafc2b6bf5` |
| card-streaming/bank-order/final/camera-candidate | 62 | 8 | `d7dafc2b6bf5` |
| card-streaming/bank-order/final/battle-reference | 90 | 18 | `8cec162c21e0` |
| card-streaming/bank-order/final/battle-candidate | 90 | 18 | `8cec162c21e0` |
| mercenary-models/gameplay | 49 | 15 | `f7633862b765` |
| mercenary-models/gameplay-final | 49 | 15 | `f7633862b765` |

28 files had no independently published encoded PNG checksum in their proof; the manifest explicitly records `proofEncodedSha256: null` for those files.

See [archive-report.json](archive-report.json), [archive-run.log](archive-run.log), [verify-run.log](verify-run.log), [materialize-smoke.log](materialize-smoke.log), and [materialize-reprune-verify.log](materialize-reprune-verify.log).
