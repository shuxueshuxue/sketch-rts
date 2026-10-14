# Default-budget-only canonical identity check

The 16 MiB default preserves the canonical workload exactly where the budget never binds. All **24 PNGs matched at zero decoded RGBA tolerance and identical PNG SHA**, all eight fact snapshots and **2880 CPU sample clocks** matched. Source/provider/default-budget/no-admission validation passed. Across every recorded before, empty and returned phase, the only non-timing card/resource difference is `rasterCache.budget`; all GPU bytes, resident mips, page capacities, draw resources, upload/copy counters and recorded geometry/order fields are equal.

Reproduce with `node docs/art/refactor/followup/card-streaming/latency-investigation/rle-budget-only-canonical/analyze.mjs`. [analysis.json](analysis.json) records source and input hashes, every lifetime, full distributions and all comparisons. Historical inputs remained unchanged.

This is a two-run identity check, original-A then candidate-B, each with two lifetimes and hidden populations 0 and 9900, 360 paced CPU samples and 18 real frames per lifetime/population. Both use the frozen `aec09d620801dd07852042732831e5b2de1c4193` renderer, one native bank, current peaks and mask. The complete candidate cache class differs from original bytes only in its constructor default 48 → 16 MiB, as independently checked from archived sources. The runtime cache has the original 12 stats fields and no probation/admission/ghost fields.

For every population and lifetime, before-view cache occupancy is 129 encoded entries / **7,859,264 B**, with 131,072 B reconstruction scratch. The cache records **129 fresh Canvas misses and 413 hits**, with zero evictions, backoffs and bypasses. Owned CPU buffers are **13,143,872 B** and peak ownership **15,126,336 B** on both policies. This is below 16 MiB even when counting all tracked CPU buffers, so the smaller encoded-payload cap does not cause extra Canvas painting here. Actual residency is ten pages and 98 draw chunks on both sides. Endpoint and peak resources are identical.

Timing is retained as diagnostic evidence, not an ABBA performance claim. Each population has 720 CPU and 36 real samples per policy; quantiles pool its raw samples and first cold frames remain included.

| Hidden units | Policy | CPU mean / max, ms | CPU >50 / >100 | Real complete-wall mean, ms |
|---|---|---:|---:|---:|
| 0 | 48 MiB | 4.087 / 54.2 | 1 / 0 | 168.356 |
| 0 | 16 MiB | 4.089 / 74.5 | 1 / 0 | 164.544 |
| 9900 | 48 MiB | 10.818 / 89.1 | 6 / 0 | 154.375 |
| 9900 | 16 MiB | 10.782 / 91.2 | 9 / 0 | 168.278 |

These timing differences, including the hidden-9900 real-wall and tail regressions, are not discarded. With only sequential original/candidate runs and no ABBA reversal they cannot establish a stable speed benefit or regression from a budget that is inactive in this workload. The separate [mixed ABBA](../rle-budget-only-abba/report.md) measures the active-cap tradeoff, including its additional fresh paintings and remaining long tails. Completed wall time includes scheduling and GPU-completion polling; it is not a GPU timer. Tracked buffer ownership excludes process-wide, Canvas backing and JavaScript metadata allocation.
