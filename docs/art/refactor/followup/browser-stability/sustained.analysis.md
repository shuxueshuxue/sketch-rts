# Sustained browser descriptive analysis

Samples: 183; observed fixture duration: 1820.2 s.

No numerical growth threshold or analysis pass/fail is assigned. Slopes describe this sampled workload; they do not by themselves establish or disprove leaks.

RSS sums count shared mappings repeatedly; PSS apportions shared resident pages. Both, GPU-process values and per-PID series are retained. Neither measures physical GPU VRAM. JS heap is the attached CDP target, not all browser heaps.

Each phase reports its actual sampled stages and transitions. Protocol time windows do not imply prepare/dispose happened continuously. Missing fields remain absent/null, never zero-filled. Peak counters may reset on new renderer lifetimes and must not be summed.

## warmup

Planned 0–2 min; 12 samples; stages {'loading': 1, 'battle': 11}.

First/last windows span up to 60 seconds from the first/last observed sample; exact bounds and overlap are recorded in JSON. Byte metrics below are MiB; slopes are MiB/min. Counts retain native units.

| Metric | First window median [min, max] | Last window median [min, max] | OLS / min |
| --- | ---: | ---: | ---: |
| processes.rssSumBytes | 1068.098 [667.906, 1102.074] | 1077.010 [1033.703, 1115.266] | 110.432 |
| processes.pssSumBytes | 752.821 [369.483, 784.367] | 758.113 [711.181, 797.018] | 103.386 |
| processKind.gpu-process.rssBytes | 394.965 [92.602, 411.773] | 395.520 [374.520, 396.359] | 72.593 |
| processKind.gpu-process.pssBytes | 368.521 [75.996, 385.318] | 369.038 [347.884, 369.741] | 70.230 |
| cdp.JSHeapUsedSize | 18.880 [7.530, 20.990] | 18.309 [15.430, 20.726] | 3.097 |
| cards.ownedCpuBytes | 4.346 [3.309, 4.846] | 4.626 [3.424, 4.846] | 0.081 |
| cards.ownedGpuBytes | 90.083 [58.083, 100.750] | 100.750 [58.083, 100.750] | 4.626 |
| cards.peakOwnedCpuBytes | 6.409 [5.909, 6.409] | 6.409 [6.409, 6.409] | 0.136 |
| cards.peakOwnedGpuBytes | 123.416 [100.750, 124.749] | 124.749 [124.749, 146.083] | 13.378 |
| renderer.memory.textures | 8.500 [7.000, 9.000] | 9.000 [7.000, 9.000] | 0.217 |
| renderer.memory.geometries | 7.500 [6.000, 8.000] | 8.000 [6.000, 8.000] | 0.217 |
| renderer.programs | 7.000 [7.000, 7.000] | 7.000 [7.000, 7.000] | 0.000 |
| cdp.Nodes | 72.000 [24.000, 78.000] | 81.000 [78.000, 81.000] | 20.516 |
| cdp.JSEventListeners | 16.000 [4.000, 16.000] | 16.000 [16.000, 16.000] | 2.769 |
| state.frames | 114.000 [0.000, 234.000] | 345.000 [234.000, 450.000] | 248.526 |
| state.evictedKeys | 1341.000 [0.000, 2780.000] | 3971.500 [2780.000, 5165.000] | 2848.257 |
| cards.rasterizations | 1642.000 [431.000, 2844.000] | 4010.500 [2844.000, 5213.000] | 2871.356 |
| state.hits | 77.000 [0.000, 154.000] | 225.000 [154.000, 294.000] | 159.403 |
| state.casts | 4.000 [0.000, 8.000] | 10.000 [8.000, 12.000] | 6.123 |
| canvas.hits | 207.000 [0.000, 591.000] | 1151.500 [591.000, 1441.000] | 844.938 |
| canvas.misses | 4.000 [0.000, 8.000] | 11.000 [8.000, 11.000] | 6.482 |

## same_cache

Planned 2–10 min; 48 samples; stages {'battle': 48}.

First/last windows span up to 60 seconds from the first/last observed sample; exact bounds and overlap are recorded in JSON. Byte metrics below are MiB; slopes are MiB/min. Counts retain native units.

| Metric | First window median [min, max] | Last window median [min, max] | OLS / min |
| --- | ---: | ---: | ---: |
| processes.rssSumBytes | 1095.906 [1073.277, 1123.715] | 1069.775 [1061.918, 1110.773] | -1.363 |
| processes.pssSumBytes | 758.341 [697.562, 787.241] | 744.778 [737.085, 791.151] | -0.304 |
| processKind.gpu-process.rssBytes | 388.326 [362.836, 409.438] | 393.848 [376.586, 397.883] | -0.816 |
| processKind.gpu-process.pssBytes | 361.624 [336.130, 382.753] | 366.815 [349.527, 370.846] | -0.865 |
| cdp.JSHeapUsedSize | 17.827 [15.735, 20.815] | 19.232 [16.945, 23.115] | 0.108 |
| cards.ownedCpuBytes | 4.029 [2.502, 4.346] | 4.581 [3.327, 4.846] | 0.058 |
| cards.ownedGpuBytes | 72.375 [58.083, 100.750] | 90.083 [58.083, 100.750] | 0.564 |
| cards.peakOwnedCpuBytes | 6.409 [6.409, 6.409] | 6.409 [6.409, 6.409] | 0.000 |
| cards.peakOwnedGpuBytes | 146.083 [146.083, 146.083] | 146.083 [146.083, 146.083] | 0.000 |
| renderer.memory.textures | 7.500 [7.000, 9.000] | 8.500 [7.000, 9.000] | 0.031 |
| renderer.memory.geometries | 7.000 [6.000, 8.000] | 7.500 [6.000, 8.000] | 0.018 |
| renderer.programs | 7.000 [7.000, 7.000] | 7.000 [7.000, 7.000] | 0.000 |
| cdp.Nodes | 81.000 [81.000, 81.000] | 87.000 [87.000, 87.000] | 0.979 |
| cdp.JSEventListeners | 16.000 [16.000, 16.000] | 16.000 [16.000, 16.000] | 0.000 |
| state.frames | 598.000 [500.000, 700.000] | 2380.000 [2270.000, 2478.000] | 254.714 |
| state.evictedKeys | 6835.000 [5618.000, 7994.000] | 26517.000 [25331.000, 27637.000] | 2809.108 |
| cards.rasterizations | 6884.500 [5636.000, 8042.000] | 26551.000 [25395.000, 27684.000] | 2809.830 |
| state.hits | 383.000 [316.000, 448.000] | 1596.000 [1525.000, 1658.000] | 175.937 |
| state.casts | 16.000 [12.000, 20.000] | 58.000 [56.000, 60.000] | 6.006 |
| canvas.hits | 2044.500 [1807.000, 2510.000] | 8814.500 [8271.000, 9086.000] | 946.846 |
| canvas.misses | 11.000 [11.000, 11.000] | 17.000 [17.000, 17.000] | 0.979 |

## prepare_transitions

Planned 10–20 min; 60 samples; stages {'battle': 60}.

First/last windows span up to 60 seconds from the first/last observed sample; exact bounds and overlap are recorded in JSON. Byte metrics below are MiB; slopes are MiB/min. Counts retain native units.

| Metric | First window median [min, max] | Last window median [min, max] | OLS / min |
| --- | ---: | ---: | ---: |
| processes.rssSumBytes | 1069.904 [1043.184, 1107.777] | 1108.715 [1052.355, 1145.188] | 1.570 |
| processes.pssSumBytes | 744.984 [719.793, 784.430] | 783.593 [727.233, 825.335] | 2.648 |
| processKind.gpu-process.rssBytes | 382.834 [369.207, 398.297] | 392.156 [370.551, 434.434] | 1.319 |
| processKind.gpu-process.pssBytes | 355.763 [342.107, 371.203] | 365.006 [343.400, 407.283] | 1.413 |
| cdp.JSHeapUsedSize | 19.353 [17.138, 21.772] | 20.795 [18.502, 23.064] | 0.132 |
| cards.ownedCpuBytes | 4.282 [3.309, 4.846] | 4.221 [3.571, 4.846] | 0.009 |
| cards.ownedGpuBytes | 79.416 [58.083, 100.750] | 79.416 [58.083, 100.750] | 0.232 |
| cards.peakOwnedCpuBytes | 6.409 [6.409, 6.409] | 6.409 [6.409, 6.409] | 0.000 |
| cards.peakOwnedGpuBytes | 146.083 [146.083, 146.083] | 146.083 [146.083, 146.083] | 0.000 |
| renderer.memory.textures | 8.000 [7.000, 9.000] | 8.000 [7.000, 9.000] | 0.011 |
| renderer.memory.geometries | 7.000 [6.000, 8.000] | 7.000 [6.000, 8.000] | 0.011 |
| renderer.programs | 7.000 [7.000, 7.000] | 7.000 [7.000, 7.000] | 0.000 |
| cdp.Nodes | 87.000 [87.000, 89.000] | 87.000 [87.000, 87.000] | -0.025 |
| cdp.JSEventListeners | 16.000 [16.000, 16.000] | 16.000 [16.000, 16.000] | 0.000 |
| state.frames | 2616.000 [2523.000, 2724.000] | 4907.000 [4765.000, 5021.000] | 254.867 |
| state.evictedKeys | 29205.500 [28072.000, 30444.000] | 54366.000 [52965.000, 55745.000] | 2814.879 |
| cards.rasterizations | 29282.500 [28093.000, 30511.000] | 54511.000 [53115.000, 55928.000] | 2827.062 |
| state.hits | 1752.000 [1689.000, 1823.000] | 3275.000 [3196.000, 3343.000] | 173.101 |
| state.casts | 64.000 [60.000, 68.000] | 116.000 [116.000, 120.000] | 6.004 |
| canvas.hits | 9577.500 [9336.000, 10066.000] | 18554.000 [17771.000, 18798.000] | 950.270 |
| canvas.misses | 17.000 [17.000, 17.000] | 17.000 [17.000, 17.000] | 0.000 |

## dispose_recreate

Planned 20–30 min; 60 samples; stages {'dispose': 1, 'battle': 59}.

First/last windows span up to 60 seconds from the first/last observed sample; exact bounds and overlap are recorded in JSON. Byte metrics below are MiB; slopes are MiB/min. Counts retain native units.

| Metric | First window median [min, max] | Last window median [min, max] | OLS / min |
| --- | ---: | ---: | ---: |
| processes.rssSumBytes | 1111.453 [866.773, 1135.566] | 1080.543 [1058.973, 1114.523] | 2.115 |
| processes.pssSumBytes | 754.409 [558.597, 807.702] | 745.085 [689.483, 789.331] | 1.857 |
| processKind.gpu-process.rssBytes | 386.703 [189.578, 395.160] | 382.715 [349.504, 404.012] | 3.310 |
| processKind.gpu-process.pssBytes | 359.554 [170.909, 368.015] | 355.540 [322.323, 376.831] | 3.224 |
| cdp.JSHeapUsedSize | 17.027 [16.581, 20.275] | 20.348 [17.107, 22.685] | 0.112 |
| cards.ownedCpuBytes | 4.700 [3.358, 4.846] | 3.784 [2.315, 4.346] | -0.003 |
| cards.ownedGpuBytes | 100.750 [58.083, 100.750] | 79.416 [58.083, 100.750] | -0.075 |
| cards.peakOwnedCpuBytes | 6.409 [6.409, 6.409] | 6.409 [6.409, 6.409] | 0.000 |
| cards.peakOwnedGpuBytes | 112.750 [100.750, 146.083] | 146.083 [146.083, 146.083] | 1.716 |
| renderer.memory.textures | 9.000 [7.000, 9.000] | 8.000 [7.000, 9.000] | -0.002 |
| renderer.memory.geometries | 8.000 [6.000, 8.000] | 7.000 [6.000, 8.000] | -0.007 |
| renderer.programs | 7.500 [7.000, 8.000] | 7.000 [7.000, 7.000] | -0.029 |
| cdp.Nodes | 90.000 [87.000, 90.000] | 90.000 [90.000, 90.000] | 0.008 |
| cdp.JSEventListeners | 16.000 [16.000, 23.000] | 16.000 [16.000, 16.000] | -0.069 |
| state.frames | 5180.000 [5065.000, 5302.000] | 7410.000 [7273.000, 7532.000] | 251.298 |
| state.evictedKeys | 57530.000 [56202.000, 59006.000] | 82033.000 [80776.000, 83405.000] | 2786.574 |
| cards.rasterizations | 1619.000 [446.000, 2826.000] | 25986.000 [24741.000, 27353.000] | 2802.580 |
| state.hits | 3456.000 [3371.000, 3548.000] | 4988.000 [4871.000, 5063.000] | 170.417 |
| state.casts | 124.000 [120.000, 128.000] | 176.000 [176.000, 180.000] | 6.005 |
| canvas.hits | 19248.000 [19030.000, 19712.000] | 27825.000 [27024.000, 28285.000] | 917.354 |
| canvas.misses | 17.000 [17.000, 17.000] | 17.000 [17.000, 17.000] | 0.000 |

## Interpretation limits

- OLS uses individual sampled points against actual elapsed minutes. It is descriptive; autocorrelation, workload variation and collection jitter preclude an automatic leak verdict or a confidence claim.
- RSS is resident mapped memory with shared-page double counting in process sums. PSS distributes shared residency. Private bytes are also retained, but none is GPU VRAM or a complete application ownership ledger.
- Per-process values and process kinds are retained; process creation/exit changes aggregate composition. Missing PSS for any process makes that aggregate missing, not zero.
- Cache current/peak counters are scoped to their producer/lifetime. Renderer recreation can reset rasterizations, textures and peaks. observedDecreases flags sampled resets/evictions, while positive increments are not exact totals when resets occur between samples.
- rasterBeforeReset and current rasterizations are reported separately, never blindly summed: dispose/recreation and prepare accounting may refer to different producer lifetimes.
- frames/hits/casts/evictedKeys and action modes are workload counters, not all per-frame effects or a proof of whole-game/AI coverage. Scene transitions are reported from observed prepares/disposes and stage changes.
- Sampling approximately every ten seconds can miss transient allocation/resource peaks and brief prepare/dispose states. Final-release observations after 30 minutes are separated from the four requested phases.
- Byte metrics preserve native units in JSON/CSV; Markdown converts bytes to MiB. Counter slopes are not memory-growth slopes. First/last-window differences are descriptive and may overlap in short/incomplete segments.
- Analysis does not introduce growth thresholds, a memory pass/fail, forced GC, browser restarts or adjustments to original evidence.

Per-minute aggregates and all metric slopes/ranges are in the companion JSON/CSV. The runner completion outcome, errors and final release snapshot are preserved separately; completion is not a memory-stability verdict.
