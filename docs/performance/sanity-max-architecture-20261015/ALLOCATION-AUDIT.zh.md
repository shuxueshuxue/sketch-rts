# 分配与保留审计：港口候选、规划任务和全局字段

审计源码：3898911213a3dbe9220e3da7a036cd61d84ce552，rulesVersion 3。本文只读分析现有源码和已有测量；没有运行新编译、测试、CPU profile 或完整场景，没有修改生产源码。当前正式八轮对照的结果不在此预判。

最值得先验证的净简化是把港口的 poses 数组、entries Map、clear Map、ranked 数组统一为一个 Berth 记录数组。另一个仅需少量删除的候选是 shipTraffic 每 provider 的 configurations Map：它会把本已从全局有界缓存淘汰的 polygon 继续钉在 job 生命周期里。两者目前都没有收益结论；港口提案已生成可独立审查的补丁，未应用。

## 已有测量能说明什么

上一阶段正式 P 的四轮 ArrayBuffers 轨迹高度相似。下表来自 formal-2-P，每 1200 tick 采样一次，单位 MiB：

| tick | 单位数 | heapUsed | ArrayBuffers | RSS |
|---:|---:|---:|---:|---:|
| 0 | 48 | 74.95 | 90.55 | 271.68 |
| 2400 | 70 | 238.29 | 117.65 | 491.08 |
| 4800 | 80 | 156.76 | 138.34 | 630.14 |
| 8400 | 93 | 232.46 | 139.08 | 715.08 |
| 9600 | 94 | 249.62 | 186.77 | 763.82 |
| 10800 | 99 | 263.66 | 267.86 | 857.71 |
| 13200 | 109 | 353.19 | 273.69 | 889.77 |
| 14399 | 109 | 174.77 | 272.44 | 900.11 |

原始数据：[formal-2-P/ticks.json.gz](/workspace/sanity-sync-retry-20261015/formal-2-P/ticks.json.gz)、[summary.json](/workspace/sanity-sync-retry-20261015/formal-2-P/summary.json)。这些不是强制回收后的 live bytes，也没有对象保留路径；不能据此称为泄漏、不能定位两次采样之间某个最大 tick 的 GC。RSS 包含分配器和代码空间，也不等于可达对象大小。

已有独立诊断提供了更直接的区分：[focused-diagnostics.json.gz](/workspace/sanity-max-architecture-20261015/diagnostic/focused-diagnostics.json.gz)。

- tick 1859：sim 61.70 ms，重叠 GC 2.13 ms；主体是训练港口与首次规划工作。
- tick 9659：sim 57.19 ms，无重叠 GC；已有 CPU 调用链是 updateTraining → shipLaunchPose → steerPoint → tilesOf → linkSector。
- tick 13806：本次 sim 6.35 ms，无重叠 GC；此前某一轮 96.57 ms 没有在这轮重现，不能直接指定原因。
- tick 7506：whole 46.00 ms，其中 GC 时间区间重叠 37.95 ms；tick 8095 为 37.83 / 31.59 ms。GC 确实能制造部分漂移峰。
- 全诊断共有 700 个 tick 与 GC 时间区间相交，交集累计 3330.99 ms，约占其 54918.89 ms whole tick 总时长的 6.1%。这是同一 performance 时间轴的区间交集，含诊断扰动，不是正式性能收益，也不是独占脚本 CPU 分解。

因此应同时追查确定性的昂贵构建和分配压力，不能把全部最大值统一归为 GC。

## 当前强保留 ArrayBuffer 的数量级

本局地图 10240 × 10240，terrain 为 320 × 320、cell 32。令 C = 102400，padded terrain 长度 P = 322² = 103684。下面只计算 typed-array payload，不含对象、Map、字符串和分配器开销。

| 所有者 | 字节公式 | 本图数量级 | 何时释放 |
|---|---:|---:|---|
| 全局 search workspace | 172C | 16.80 MiB | 模块常驻；只会扩到更大容量 |
| 一个 NavGrid | 41C | 4.00 MiB | terrain 弱键失活、同组淘汰或替换；同 terrain 最多 32 组 |
| 海水积分场 | 4(cols+1)(rows+1) | 0.393 MiB | terrain 弱键失活或字段替换 |
| 一张 sea potential | ≤8C | ≤0.781 MiB | terrain 组淘汰；最多 8 张，合计 ≤6.25 MiB |
| 一个 Frontier | 20H | 初始 20 KiB | 私有 job 失活；全局 Frontier 常驻 |
| 一张 terrain Field 的 dist + next | 8P | 0.791 MiB | 所属 runtime 失活；满缓存时数组复用于下一张 |
| 一个 terrain runtime 的 8 个 Dijkstra buckets | 32P | 3.164 MiB | runtime 失活 |

源码：[workspace 与 NavGrid](https://github.com/shuxueshuxue/sketch-rts/blob/3898911213a3dbe9220e3da7a036cd61d84ce552/src/shared/ship-navigation.ts#L217)、[Frontier](https://github.com/shuxueshuxue/sketch-rts/blob/3898911213a3dbe9220e3da7a036cd61d84ce552/src/shared/ship-navigation.ts#L290)、[积分场](https://github.com/shuxueshuxue/sketch-rts/blob/3898911213a3dbe9220e3da7a036cd61d84ce552/src/shared/ship-navigation.ts#L43)、[sea potential 上限](https://github.com/shuxueshuxue/sketch-rts/blob/3898911213a3dbe9220e3da7a036cd61d84ce552/src/shared/ship-navigation.ts#L369)、[Field 与 buckets](https://github.com/shuxueshuxue/sketch-rts/blob/3898911213a3dbe9220e3da7a036cd61d84ce552/src/shared/terrain.ts#L1437)。

现有诊断在 tick 12825 和 14370 实际观察到 land runtime 1 的 fields.size = 128，sea runtime 3 的 fields.size = 75。仅这 203 张 dist/next payload 就约 160.58 MiB，两层 buckets 另约 6.33 MiB。这是实际条目数乘源码数组长度的账本，足以解释后期 ArrayBuffers 的大块来源，但不是完整的 272 MiB 对账。仍有本地 tile/goal 字段、导航 grids、临时未回收数组等未逐对象计数。

terrain 的 FIELD_CACHE = 128，GOAL_FIELD_CACHE = 8192；后者源码注释给出的单 routing layer 本地字段容量约 56 MiB。[容量定义](https://github.com/shuxueshuxue/sketch-rts/blob/3898911213a3dbe9220e3da7a036cd61d84ce552/src/shared/terrain.ts#L64)。这些 runtime 由仍活着的 terrain 或 map overlay 所有，取消一条船的 job 不会释放它们。该领域已有主性能车道所有权；本文只提供容量和引用证据，不改容量、不提供第二份 terrain 实现。

## 港口：哪些东西每 tick 生成，哪些长期保留

[shipLaunchPose](https://github.com/shuxueshuxue/sketch-rts/blob/3898911213a3dbe9220e3da7a036cd61d84ce552/src/shared/ship-launch.ts#L56) 只在付费训练任务到期、仍需寻找合法出口时调用。不能把下面的 miss 成本乘上所有正常 tick。

**同几何、同目标、同周边阻挡的重复等待调用：**

- geometry 字符串；
- 合并 units/buildings/obstacles 的临时数组，以及 nearby bodies 数组；
- productionRallyPoint 的 Point；
- bodies.map 的字符串数组、每项字符串、join 和总 signature；
- 若 signature 未变，随后不生成 rank 列表、不做静态或动态几何搜索；
- 有结果时，返回一个新 Point，仍保留公开调用的返回对象独立性。

这一路仍是 O(U+B+O) 读取和 O(K) signature 分配；没有每 tick 新建整套 960 候选。[body 收集与 signature](https://github.com/shuxueshuxue/sketch-rts/blob/3898911213a3dbe9220e3da7a036cd61d84ce552/src/shared/ship-launch.ts#L74)。

**几何 cache miss：**

最多 16 headings × 4 faces × 5 offsets × 3 outward = 960 个原始候选。一个候选会先构造临时 point、pose 和 entry；局部 connected 筛掉后，最终留 N ≤ 960 个 pose 和 N 个 entry。另有最多 320 个 anchor、16 次旋转 hull 及其 Point/边界临时数组。harborWater 新建局部 labels/queue 两个 Int32Array，共 8L 字节；闭包只在候选生成期间使用，返回值不保存这个闭包，生成结束后这些局部数组可回收。[harborPoses](https://github.com/shuxueshuxue/sketch-rts/blob/3898911213a3dbe9220e3da7a036cd61d84ce552/src/shared/ship-launch.ts#L157)、[harborWater](https://github.com/shuxueshuxue/sketch-rts/blob/3898911213a3dbe9220e3da7a036cd61d84ce552/src/shared/ship-launch.ts#L195)。

当前 miss 后的保留图为：

map 弱键 → dock 弱键 → Berths → poses[N]、entries Map、clear Map、ranked[N]、result pose。

entries 是 pose→entry 的另一个索引；clear 是 pose→boolean 的另一个索引；ranked 再为同一 N 个 pose 创建 N 个 RankedBerth 记录。几何不变、rally 变化时，ranked 的 N 个记录会全部重建；其余两张 Map 和 pose/entry 复用。bound-first 避免了多数候选的精确 sweep，但不会自动减少这组保留的候选容器。

特别是没有任何静态合法泊位时，当前代码只清空 poses.length；entries 与 clear 仍可保留这次失败候选的 pose/entry。下一次相同几何会立即返回，直到 geometry 失效或 map/dock 弱所有权失活。单记录数组方案可以让这组失败候选随清空一起释放。

## 可审查的最小港口所有权提案

文件：[BERTH-OWNERSHIP-PROPOSAL.patch](/workspace/sanity-max-architecture-20261015/BERTH-OWNERSHIP-PROPOSAL.patch)、[完整提案源码](/workspace/sanity-max-architecture-20261015/ship-launch-ownership-proposed.ts)、[基准和 diff 统计](/workspace/sanity-max-architecture-20261015/berth-ownership-proposal.json)。

**尚未应用、编译、执行或测量。** 基于 38989112 的 ship-launch.ts，提案是 30 增 / 33 删，净删 3 行。它不改变选择算法，不改 terrain 或 hullPassageClear。

- 统一为 Berth 记录：pose、entry（含 outward）、clear、exit、stable index、reachable、bound、travel、difference。pose 和 entry 仍是原先创建的独立 Point；记录只拥有它们，不把元数据塞进公开 Point。
- 只保留 candidates: Berth[]，删除 entries Map、clear Map、ranked 数组与单独 RankedBerth 分配。
- 初次生成仍先按原 exit 稳定排序，再一次性记录 index。静态可解前置检查仍在这个 exit 顺序中执行。
- rally 变化时原地更新 derived rank 值，并按 reachable/bound/index 原地排序；index 始终是最初的 exit 稳定序。重置 travel/difference 为 undefined，不沿用前一个 rally 的精确角差。
- clear 的 undefined / false / true 三态由记录本身保存；false 不会被当作未计算。选择流程仍按当前 bound-first、reachable gate 与完整精确 comparator。
- cached.result 仍指向原 pose；公开返回仍是原有的新对象 spread，内部 pose/entry 的别名关系不变。

数量级上，这会删除每组 2 个 Map、N 个 entries 索引项、至多 N 个 clear 索引项、1 个排名引用数组；rally 变化也不再额外分配 N 个 rank 记录。Berth wrapper 复用原 RankedBerth 这一层，因此不能宣称每个有效候选的对象总数都减少一个。具体 V8 byte 数依赖 shape 和容量，必须测量，不按固定“每对象若干字节”给保证。

下一自然检查点可独立验证：

1. 冻结 38989112 其余源码，只替换提案 ship-launch。重复已有 1344 次/版本差分，保留首次/暖调用/JSON 冷克隆、blocked/unreachable、rally 与原对象 cells/尺度/位置变化。额外检查返回 Point 只有原字段，返回值仍 fresh，pose/entry 测试探针所见别名不变，tie 的 index 不受原地排序影响。
2. 独立 heap fixture 保留 1、8、32 个 map/dock geometry，分别测首次、100 次换 rally、无合法港口、移除 dock/map 后的回收。强制 GC 仅在非计时阶段、跨 event-loop turn 使用；记录 before/active/invalidated/released，不在模拟 tick 中插入回收。
3. 先观察候选条目数与 Map/数组对象数量是否按预期下降，再对照 plain 场景总 CPU、最大 tick 和 p99。若只是少量 setup 内存改善，应按它的真实收益取舍，不能拿来解释全部 global max。

## 私有规划与快照的分配边界

引用图是 live Unit → decoded 弱表值 job → searches(job) 私有闭包 → graph；trafficViews(job) 另保留冻结障碍和 provider 的派生几何。reference 完成删除 searches，sailing 接受结果后 cancel 会删除 decoded 与 job 字符串；job 失去强可达路径后，其余弱键状态可回收。[job weak maps](https://github.com/shuxueshuxue/sketch-rts/blob/3898911213a3dbe9220e3da7a036cd61d84ce552/src/shared/ship-planning-job.ts#L9)、[完成](https://github.com/shuxueshuxue/sketch-rts/blob/3898911213a3dbe9220e3da7a036cd61d84ce552/src/shared/ship-planning-job.ts#L192)、[取消](https://github.com/shuxueshuxue/sketch-rts/blob/3898911213a3dbe9220e3da7a036cd61d84ce552/src/shared/ship-planning-job.ts#L137)、[执行器接受](https://github.com/shuxueshuxue/sketch-rts/blob/3898911213a3dbe9220e3da7a036cd61d84ce552/src/shared/sailing.ts#L201)。

私有 graph 没有每任务全图数组：reached/traffic/prefix/entrance 四个 Map 和 Frontier。reached 与 traffic 的索引域最多 8C；prefix 最多 72 个入口姿态，entrance 最多 9 个入口格。每次成功 relaxation 仍新建一个 id/cost/parent 记录，所以累计分配次数可以大于最终 reached.size。[setCost](https://github.com/shuxueshuxue/sketch-rts/blob/3898911213a3dbe9220e3da7a036cd61d84ce552/src/shared/ship-navigation.ts#L1025)。每 slice 还生成小型速度/权重列表、closure 与新 arrival Point；公开 callback 的顺序与对象身份约束使其中一部分不能直接改成共享对象。

已有 8 个 pending job 的强制回收 fixture：P active→cancelled 的 heap 27.43→7.97 MiB，ArrayBuffers 15.49→14.24 MiB。1.25 MiB 的数组差值恰与 8 × 20 × 8192 字节 Frontier 一致，但没有逐对象计数，归因仍是推断。[原始结果](/workspace/sanity-planning-lifecycle-20261015/memory-P/result.json)。

空 traffic retry 缓存另有已有 8-entry fixture：相对 A 的 active−before 增量多约 0.838 MiB heap，ArrayBuffers 增量相同；取消后 heap 接近 A。保守输入 structuredClone 会保留完整船/terrain 投影和 pristine 结果，hit 再 clone 返回值；不能把这些 clone 的成本漏出计时，也不能只因为 key 看似相同就改成更弱的输入投影。[retry clone](https://github.com/shuxueshuxue/sketch-rts/blob/3898911213a3dbe9220e3da7a036cd61d84ce552/src/shared/ship-navigation.ts#L849)、[P 内存](/workspace/sanity-sync-retry-20261015/memory-P/result.json)、[A 内存](/workspace/sanity-sync-retry-20261015/memory-A/result.json)。

快照方面，LocalGameAdapter 只保留一个当前 snapshot，advance 会清空；AI 每次到期由全体 owner 共享一个新 snapshot。[adapter](https://github.com/shuxueshuxue/sketch-rts/blob/3898911213a3dbe9220e3da7a036cd61d84ce552/src/client/net/local-adapter.ts#L44)、[AI frame](https://github.com/shuxueshuxue/sketch-rts/blob/3898911213a3dbe9220e3da7a036cd61d84ce552/src/ai/runtime.ts#L104)。当前 snapshotGame 对每 unit 至少新建 unit、order、orderQueue array、effects array，另加 sailing/route/parts/fittings 等已有嵌套复制；仅单位基础层就约 4U 个对象/数组，每 14400 次 render snapshot 是百万量级的累计短命分配。[snapshotGame](https://github.com/shuxueshuxue/sketch-rts/blob/3898911213a3dbe9220e3da7a036cd61d84ce552/src/shared/sim.ts#L926)。这说明存在分配压力，不能由此推断它是某次 max 的主要原因；公开快照的旧状态不可变语义也不允许直接返回 live Unit。

## 第二个小型净删除候选：一份 polygon 只由一个缓存所有

shipTraffic 每 provider 新建 configurations Map 和 sweeps Map。configurations 的本地 key 是 from/to/body id/padding，值却来自已经存在的全局有界 trafficShapes；该 Map 随 trafficViews 的闭包在整个 job 跨切片存活，没有条目上限。[provider 本地缓存](https://github.com/shuxueshuxue/sketch-rts/blob/3898911213a3dbe9220e3da7a036cd61d84ce552/src/shared/ship-avoidance.ts#L289)、[全局有界缓存](https://github.com/shuxueshuxue/sketch-rts/blob/3898911213a3dbe9220e3da7a036cd61d84ce552/src/shared/ship-avoidance.ts#L323)。

可单独试验删除 configurations 的本地 key/get/set，只保留现有完整 shapeKey 与全局 512 条 trafficShapes：大约净删 3 行，不增加另一层缓存。这样全局淘汰后的 polygon 不会被每个活跃 job 的第二索引继续钉住。几何算法、冻结输入、外部回调及返回布尔不变；代价是全局淘汰后可能重算。需要记录 per-provider 当前/峰值条目、淘汰后重建次数、active/released heap 和全局 max 后决定，不能只凭引用图宣布性能改善。ship-avoidance 的实施所有权必须先协调；本次没有改该文件。

剩余重复搬运还包括私有 reference 进入 fallback 后使用公开 continuation 的数组导入导出，但当前没有调用次数或 max 归因证据，不优先另写一套 fallback 算法。
