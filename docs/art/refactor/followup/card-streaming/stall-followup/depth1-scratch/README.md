# Depth-one array scratch: exact, not adopted

The requested public-API candidate has now been implemented **only as an isolated experiment**, proved against the original native output, and measured in a complete-frame ABBA comparison. It is **not adopted into production**. All previous art, spirit no-blood, mercenary, viewport, audio and frontend reuse changes remain intact. Latest production source remains `cc854814473bb684e4444eb69719b9978b6dbdc6`.

The candidate makes exactly four declared replacements in `CardMipUploader`: GPU scratch texture type and constructor become a one-layer `DataArrayTexture`, the upload destination becomes `Vector3`, and its third coordinate is explicitly zero. The CPU-only source remains an uninitialized `DataTexture` sharing the original raster. No original pixels, source dimensions, native mip levels, ROI, LRU, retry contract, page sizes, visibility, simulation or animation rules change. The standalone candidate is retained as evidence; `src` is unchanged by this experiment.

## Exactness before timing

- Both successful [original](native-original-v2/proof.json.gz) and [candidate](native-candidate-v2/proof.json.gz) runs completed with no errors and browser teardown.
- The original 53 actual n135 full-RGBA upload inputs are reused byte-for-byte. The original captured corpus remains in the [earlier exact replay](../exact-upload-replay/README.md).
- Each write is read immediately: **523 native written mip levels** match the independent original-domain sRGB oracle; all **1,040 final resident mip/layer combinations**, including untouched layers, match. Complete prior/final scratch bytes, native mips, page/card ownership and transfer counts/bytes match the frozen original capture.
- Native call comparison allows only the explicit scratch target change: level-zero `texSubImage2D` becomes `texSubImage3D` at layer zero/depth one; `generateMipmap` targets the array. All coordinates, source data descriptions and other selected native content calls stay exact. No additional target storage is allocated by the replay.
- An actual n135 production draw and a separate original summon/enemy-attack game produce **12 full-RGBA image pairs at zero difference**. All **19,080 screen pick samples** match; the mixed draw hits 95 distinct unit IDs. See [strict native/gameplay comparison](native-compare-v2/summary.json.gz), [raw differences](native-compare-v2/raw-differences.json.gz) and [early check before frame timing](early-exact-check.json.gz).
- Every **303 authoritative game snapshots/checksums** matches. Enemy attacks hit the spirit six times; its original five counterattacks give eleven total hit events. Death remains tick112. Blood stays zero through 190 subsequent ticks (9.5 seconds), and every actual draw leaves the simulation checksum unchanged. Eleven GPU/Canvas game captures include [the healthy spirit](native-candidate-v2/actual-gameplay-0.png), [death](native-candidate-v2/actual-gameplay-112.png) and [9.5 seconds later](native-candidate-v2/actual-gameplay-302.png).
- The complete original **1,125-file Git source inventory**, helper bytes and optimized Three identity are verified. The executed candidate is archived separately from original Git bytes. Actual transformed HTTP coverage passes **202 saved response bodies / 392 of 392 inventory mappings** in each successful native run.

Only ten explicitly enumerated clock fields are excluded from mathematical resource equality; their actual values are retained in the comparison. All other bytes, counts, resource structures, picking and facts remain strict. A diagnostic timing is not expected to be numerically equal between runs.

## Complete-frame ABBA results

[The full comparison](frame-compare-v1.json.gz) passes source, fact, asset-coverage, resource and decoded image checks. Four browser arms run in order **A1 original, B1 candidate, B2 candidate, A2 original**, two independent renderer lifetimes per arm. Each lifetime retains the original 18 real preparation draws n0..51, 60 paced CPU warmups n54..113, 60 CPU samples n114..173, twelve real three-pass draws n480..491, then empty/return probes.

CPU samples disable only `renderer.render` and are auxiliary construction measurements. Real samples submit the complete production `WorldPresentation` ground Canvas, actor WebGL and overlay Canvas passes, then wait for GPU completion. No per-upload observers, GPU query markers, extra render or extra fences are inserted into timed samples. Simulation, snapshot construction, screenshots and explicit between-lifetime GC are excluded from these times. The separate actual game validates rules; this frame workload is a controlled 20-kind/100-visible-unit asset scene, not combat FPS or the whole frontend application loop.

| Measure | Original | Candidate | Observed change |
| --- | ---: | ---: | ---: |
| Complete-wall mean, all 48 real frames per side | 435.723 ms | 428.171 ms | −1.73% |
| Complete-wall P50 | 199.200 ms | 195.900 ms | descriptive |
| Complete-wall P95 | 1,315.700 ms | 1,316.000 ms | effectively unchanged |
| Complete-wall P99 / max | 1,405.300 ms | 1,369.800 ms | descriptive; only 48 samples |
| First cold frame mean, four per side | 1,343.625 ms | 1,320.550 ms | −1.72% |
| Remaining 44-frame complete-wall mean | 353.186 ms | 347.045 ms | −1.74% |
| Render submission mean | 53.760 ms | 53.354 ms | −0.76% |
| Completion-fence wall mean | 381.948 ms | 374.802 ms | −1.87% |
| CPU construction mean, all 240 no-render samples per side | 40.925 ms | 42.034 ms | **+2.71%** |
| CPU construction P95 | 108.600 ms | 130.900 ms | worse in this execution |
| CPU construction max | 507.700 ms | 547.000 ms | worse in this execution |

Every real frame on each side exceeds 50 ms in this software environment (48/48). CPU samples over 50 ms are 75/240 original versus 79/240 candidate. Cold and tail values remain in the main aggregate; the separate groups do not replace it. All 24 battlefield/empty/return PNGs match the A1 life0 reference for the same phase at zero decoded RGBA difference. No content is culled beyond the original visibility rules.

Endpoint owned card CPU bytes remain **7,787,776 B**; owned card GPU raster/mip bytes remain **191,718,124 B**, identically in all eight lifetimes. These are accountable application ownership values, not physical driver memory. Post-GC browser used heap is about 12.19/12.68 MB across the two lifetime positions on both sides; a few KB difference does not establish useful memory savings. Raw heap, peak/endpoint ownership, resource counters and all frame distributions are retained.

Raw arms and logs: [A1](frame-abba/A1/proof.json.gz), [B1](frame-abba/B1/proof.json.gz), [B2](frame-abba/B2/proof.json.gz), [A2](frame-abba/A2/proof.json.gz); [A1 log](frame-A1.log.gz), [B1 log](frame-B1.log.gz), [B2 log](frame-B2.log.gz), [A2 log](frame-A2.log.gz).

## Diagnostic boundary result and decision

The isolated three-stage native observations also preserve the original commands and full native output:

| Summed GPU command-marker boundary | Original | Candidate |
| --- | ---: | ---: |
| Upload before generation | 0.0319 ms | 0.0258 ms |
| Native generation through first tail copy | 828.1867 ms | 826.4646 ms |
| All original tail copies | 94.6346 ms | 94.9772 ms |

That near-identical generation result provides no meaningful reduction of the marked dominant phase. The tiny upload GPU marker is **not** free CPU upload: diagnostic CPU submission is 45.7/36.7 ms, and isolated envelopes are 1,114.4/1,119.8 ms. Query/CPU/fence clocks overlap and include command arrival, polling, scheduler and observer work; they are not exclusive mip algorithm costs and cannot be added as independent costs. They are also not ABBA complete-frame timings.

The measured complete-frame mean changes only slightly, P95 is unchanged, construction cost increases, and owned bytes do not fall. This does not justify changing the production path. The candidate is rejected for adoption rather than declared universally slower or impossible. Complete native mip quality and synchronous upload remain unchanged in production.

Both native and frame observations use **Chromium 151.0.7922.173 / Three 0.186.1 / ANGLE SwiftShader** in the selected environment. `/dev/dri` is absent. No hardware GPU result, general FPS benefit, statistical long-tail guarantee, or physical-driver memory reduction is claimed. The earlier 255–275 ms `WaitForToken` caller/token-resource chain is still unproved; this isolated schedule does not explain that historical invocation. A hardware followup must preserve the same original input and native quality and measure original/candidate complete frames on the same identified device.

## Original failures and reproducibility

[Original native v1](native-original-v1/proof.json.gz) remains **EXIT1**, including its executed helper bytes and logs. Its n135 exact capture/native replay passed, but the test incorrectly asserted six total hits instead of six hits on the spirit plus five counterattacks. Its dynamically imported checksum module also generated two HTTP-address mapping gaps. The successful v2 fixes only that test assertion and uses an explicitly resolved static import of the frozen original checksum module. No gameplay rules or old artifacts were rewritten.

Executed comparison/driver/helper snapshots are retained with each output. Current maintained scripts do not replace past execution bytes. [Provider preservation](provider-preservation.json.gz) records full original/candidate/region SHA and the four exact replacements in [source metadata](source.json.gz). The original work providers remain independent local copies. Reproduction below uses the archived provider identities explicitly after materialization, so a fresh checkout does not depend on an ignored work directory.

Original and candidate native reproduction (first restore archived inputs as the archive guide specifies). On a fresh checkout, recover the original provider filenames, then prepare the default work provider directory before invoking the tools:

```sh
mkdir -p work/art-card-upload-depth1
cp docs/art/refactor/followup/card-streaming/stall-followup/depth1-scratch/original.ts work/art-card-upload-depth1/original.ts
cp docs/art/refactor/followup/card-streaming/stall-followup/depth1-scratch/candidate.ts work/art-card-upload-depth1/candidate.ts
cp docs/art/refactor/followup/card-streaming/stall-followup/depth1-scratch/region.ts work/art-card-upload-depth1/region.ts
cp docs/art/refactor/followup/card-streaming/stall-followup/depth1-scratch/source.json work/art-card-upload-depth1/source.json
node --import tsx scripts/art-card-upload-depth1-proof.mjs --policy original --candidate-source docs/art/refactor/followup/card-streaming/stall-followup/depth1-scratch/candidate.ts --metadata docs/art/refactor/followup/card-streaming/stall-followup/depth1-scratch/source.json --out work/depth1-reproduction/original
node --import tsx scripts/art-card-upload-depth1-proof.mjs --policy candidate --candidate-source docs/art/refactor/followup/card-streaming/stall-followup/depth1-scratch/candidate.ts --metadata docs/art/refactor/followup/card-streaming/stall-followup/depth1-scratch/source.json --out work/depth1-reproduction/candidate
node scripts/art-card-upload-depth1-compare.mjs --original work/depth1-reproduction/original --candidate work/depth1-reproduction/candidate --out work/depth1-reproduction/native-compare
```

These require a clean frozen42bd source checkout at `/tmp/sketch-queue-source-42bd` with the same dependency package, and full-SHA verified original corpus from the earlier exact replay. To reproduce full frames, run `node --import tsx scripts/art-card-upload-depth1-formal-proof.mjs --upload-policy original|candidate --original-source docs/art/refactor/followup/card-streaming/stall-followup/depth1-scratch/original.ts --candidate-source docs/art/refactor/followup/card-streaming/stall-followup/depth1-scratch/candidate.ts --region-source docs/art/refactor/followup/card-streaming/stall-followup/depth1-scratch/region.ts --metadata docs/art/refactor/followup/card-streaming/stall-followup/depth1-scratch/source.json --repeats 2 --out <fresh-arm>/proof.json` serially in A/B/B/A order, then `art-card-upload-depth1-frame-compare.mjs --arms <A1>/proof.json <B1>/proof.json <B2>/proof.json <A2>/proof.json --out <fresh-comparison>.json`. Every output must be new; helpers refuse overwrite.

The [archive guide](archives/README.md) defines lossless packaging, original filenames and full-SHA materialization. Artifact links above point to the gzip sidecars produced by that operation. Actual packaging and restoration outcomes belong to its execution records; packaging is not another performance run. Before using original helper paths or comparisons, materialize their inputs and source snapshots as described there.
