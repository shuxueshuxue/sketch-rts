# CPU raster codec diagnostic

This is a CPU-only recovery-cache investigation. It changes no production codec, cache budget, art, simulation, or GPU operation. [raw.json](raw.json) contains every image descriptor, full-domain SHA-256, encoded byte count, encode/decode sample, and pool retention result. The exact intrusive browser request input is archived as [input-request-trace.json.gz](input-request-trace.json.gz); its timings are **not** benchmark data.

The actual mixed-scene request trace contains **1077 distinct stock painted-unit card identities** across 141 frames and 100 visible instances. The captured density is 4. A further check includes both resident-key captures and density-2 versions of observed poses: **2412 images, all 20 asset kinds, both owner colors and both facings**. No identities were rejected.

All codecs reconstructed all four RGBA components over each original domain, including transparent padding, with **zero differing bytes across 27,751,956,480 decoded bytes**. Samples are rendered once by the production `paintFigure` into native Skia Canvas, then row-flipped as the actual GPU recovery cache expects. The RGBA domain is never cropped or resampled.

## Actual density-4 trace pool

The byte columns below sum the complete **observed** pose pool, not just the final visible or resident GPU poses. Encode/decode timings select those same 1077 identities from the diagnostic. Each image is encoded once and decoded three times. Every decode timer includes full output allocation. Deflate level-1/6 execution order alternates; the hybrid is measured after the full-domain arms.

| Codec | Encoded pool MiB | Encode mean / p95 ms | Decode mean / p95 ms |
|---|---:|---:|---:|
| row-rle | 125.35 | 1.747 / 4.617 | 0.278 / 0.599 |
| deflate-1 | 46.43 | 11.408 / 16.585 | 3.309 / 4.597 |
| deflate-6 | 39.97 | 17.523 / 24.934 | 3.147 / 4.327 |
| row-rle-deflate-1 | 43.08 | 4.023 / 8.171 | 1.079 / 2.074 |

Native Canvas paint + readback for this pool: **4.199 ms mean / 7.582 ms p95**. These are Node Skia costs, **not browser Canvas costs**, hardware FPS, GPU times, or a measured game speedup.

- The production row-RLE decoder is fast, but its **125.35 MiB** complete pose pool cannot fit the unchanged 48 MiB recovery budget. Final resident keys alone hide this pressure.
- Raw-RGBA DEFLATE fits the byte budget but spends **11.41 / 17.52 ms mean** encoding each density-4 card. Its full-domain reconstruction is also much slower than production RLE. Synchronously swapping to it would move substantial work into first-use frames.
- DEFLATE applied only to the production RLE typed stream fits at **43.08 MiB** and avoids processing the megabytes of zero padding twice. It costs **4.02 ms mean** to encode including the RLE stage, versus **1.08 ms** to restore. The native per-image break-even median is **2 genuine CPU recovery hits**, p95 **4**, provided the pose remains retained. This excludes GPU uploads and does not forecast browser hits or performance.
- **1077 keys also exceed the current 1024-entry metadata cap.** In the two-pass all-request retention replay, either DEFLATE representation still incurs 575 evictions from the count cap. Changing compression alone therefore does not retain this whole pool. The script preserves both 48 MiB and 1024 entries.
- The replay includes warm GPU requests and duplicate instances; its hits cannot be reported as CPU recovery-cache hits. It intentionally has no adaptive backoff, so it isolates retention pressure instead of pretending to model the production profitability gate.

## Memory evidence and limits

The experiment's production RLE instance uses an unlimited **diagnostic-only byte budget**, with the real 1024-entry cap, to keep per-image codec measurements independent of byte evictions/backoff. No runtime budget changes were made.

Its recorded maximum explicitly owned RLE storage was **120.36 MiB** including reusable encode scratch. Maximum known live input/output/cache buffers across the diagnostic were **124.56 MiB**. These are experiment ownership figures, not proposed runtime requirements. For an actual hybrid cache, the 43.08 MiB pool is encoded payload only; row-spans, packed-stream scratch, decode output, JS metadata, and compression work storage must still be budgeted separately.

Whole-process `arrayBuffers` sampled after codec calls peaked at **192.45 MiB**, heap at **24.15 MiB**. These samples do not capture in-call peaks; fflate transient working arrays and Canvas native backing are not included in the explicitly owned-buffer figure. This is **not** a precise fflate allocation-peak claim or a browser RAM measurement.

## Reproduce

Run from the repository root using the recorded painter/cache source hashes in `raw.json`. No new dependency is installed: `three/examples/jsm/libs/fflate.module.js` is Three's bundled official fflate 0.8.2.

```sh
gunzip -c docs/art/refactor/followup/card-streaming/codec-diagnostic/input-request-trace.json.gz > /tmp/card-mixed-codec-trace.json
node --import tsx scripts/art-card-raster-codec-diagnostic.ts --input /tmp/card-mixed-codec-trace.json --input docs/art/refactor/followup/card-streaming/mixed-before/raw.json --input docs/art/refactor/followup/card-streaming/mixed-after/raw.json --add-density-2 --output /tmp/card-codec-repeat
```

The input content hashes remain the same when the temporary path changes. Encoded bytes and decoded SHA-256 are deterministic for these source/data versions; timing and sampled process memory vary with environment. Script and relevant source hashes, CPU, Node and library provenance are recorded.

A production candidate needs **browser CPU recovery traces and a controlled whole-frame comparison** before adoption. The evidence favors experimenting with a compact-stream codec and a bounded metadata policy; it does not authorize a budget increase or establish that sync DEFLATE improves the game.
