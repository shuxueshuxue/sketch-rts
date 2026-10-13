# Prior-work gap behind the upload wait

Read-only investigation of the existing 8345 current-gl trace; no browser or production changes. Relative time T=34432389728 µs is cycle 1 n135/tick45 texSubImage2D call43 start.

| Relative time | Recorded event |
|---|---|
| −177.204 ms | GPU-main Scheduler::RunTask starts; duration 423.610 ms, thread CPU duration 0.748 ms, flow 36298 |
| −0.023 ms | Renderer CommandBufferProxyImpl::Flush, put_offset=106902 |
| −0.020 ms | Renderer GpuChannel::Flush flow 36483 begins |
| +0.001 ms | WaitForToken args start=5898,end=5939; duration 249.889 ms |
| +0.075 ms | GPU IO thread ScheduleTask flow 36482 begins |
| +246.406 ms | Prior 423.610 ms GPU-main task ends; token service follows at +246.422 ms |
| +247.277 ms | Another GPU-main task starts, 27.293 ms wall / 0.507 ms thread CPU |
| +249.970 ms | Second WaitForToken args start=5899,end=5939; duration 24.998 ms |
| +274.584 ms | Second GPU WaitForTokenInRange service |
| +275.099 ms | Long texSubImage2D returns |
| +277.868 / +277.870 ms | ScheduleTask36482 / GpuChannel::Flush36483 flows reach GPU main |

The flush immediately preceding the blocked upload reaches GPU main after that API returns. Earlier queued GPU-main work spans most of the wait. Therefore the upload call's synchronous duration cannot be equated to execution cost of its current 345×264 ROI. The prior long task has no nested >1ms complete event in this trace and only 0.748ms thread CPU time. This does **not** identify its untraced driver wait, CPU descheduling, or work on SwiftShader workers. It also does not prove texture hazard versus transfer-buffer reclamation: token IDs lack a captured link to command-buffer identity, staging allocation, texture resource or a specific previous mip/copy command. Short generateMipmap submission time says nothing about its asynchronous completion cost.

Raw selected events and flow IDs are retained in window-events.json, linked-flows.json and prior-task-events.json. Window-events only selects matching names/flows within T−120ms..T+10ms after call end; linked-flows explicitly recovers the earlier task outside that window. These excerpts are not a replacement for the original trace.

## Focused next diagnostics

1. **Frame-boundary completion split.** Unchanged original fixture and pixels; two diagnostic arms, ordinary cadence versus fenceSync+flush+asynchronous clientWaitSync polling before each measured CPU frame (especially n135), with the drain recorded outside draw plus combined drain+draw wall. Preserve all prep/warm/sample/real frames. This tests backlog carried across frames. It cannot isolate backlog generated earlier within n135. A migrated wait is evidence about scheduling, not a product speedup.
2. **Same-frame sequential upload completion split.** In an isolated diagnostic replay of the exact captured uploads, retain original RGBA, order, full mip generation and copies. Compare one end-of-frame fence versus asynchronous completion after each full uploadLayer. Capture every upload's CPU submission, completion upper bound and accumulated total. No pixel/resolution reduction. This tests whether waiting moves from a later scratch update into completion of earlier uploads; it changes queue scheduling and is not formal performance. Do not add async waits to synchronous production wrappers or spin clientWaitSync.
3. **Only if (2) localizes the work:** same exact replay, completion after CPU→scratch upload plus native mip generation, then after scratch→array mip copies. Use an explicit diagnostic staged driver preserving bindings/state/order and verify every mip/RGBA. Compare combined stage totals, not just the shortened later upload API. This separates source upload+mips from array copies without assuming either is cheap.

Every new capture needs cycle/n/tick, stable context/page/scratch IDs, monotonically increasing upload ordinal, source dimensions/baseMip, exact ROI and submitted bytes, cold/partial/retry flags, mip-generation count, source/destination mip/copy list, CPU start/end, fence insertion/poll/status/signaled timestamps, poll count and interval, before/after completion cumulative calls, and all original samples/screenshots/facts. Trace raw args and flow IDs must be retained. Also collect GPU and renderer process/thread CPU, monotonic cgroup cpu.stat throttling deltas, and available scheduler/off-CPU events or mark them unavailable. Without driver instrumentation exposing command-buffer ID, token/staging allocation and decoded command sequence, exact token-to-resource causality may remain unobservable.

This environment lacks /dev/dri and uses SwiftShader. Conclusions apply to this captured software-rendering environment only, not hardware-GPU performance.
