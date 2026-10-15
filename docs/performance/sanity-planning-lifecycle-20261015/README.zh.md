# 私有规划生命周期：可审查实验

本阶段消除规划任务每次 yield 后的容器搬运，并复用固定 arrival 弧的纯地形检查。生产代码净增 34 行，指定重负载事件总耗时下降 38.0%；全局 mean / p99 仅下降约 3.4%，最大值未改善。尚未达到全局 10–100 倍目标，也不能据此推断物理上限。更大的重复搜索证据见 [同步重规划提案](sync-replan-proposal.zh.md)。

## 基准与边界

2026-10-15 核对 upstream main 为 `4804631c22f7be3f83dc6374e71ce03d86068dd8`。rulesVersion 3，checksumVersion 18。

本阶段 A 为本车道既有 COW 提交 `f13b2f73100675aab75a9e8ba7a8fbd186159728`；P 为 `884e5214faa76544fd4c9d38802ea2b5ebf0147a`。这不是 main 与 P 的联合收益测量；前阶段数据独立保留在 [原报告](../sanity-simple-20261015/README.zh.md)。主性能车道的距离场、cold connectivity 和 COW 集成未混入。

本阶段仅修改 ship-navigation.ts、ship-planning-job.ts，新增 ship-planning-search.test.ts。terrain.ts、sailing.ts、hullPassageClear、规则及校验实现均保持 A 的字节内容；[边界校验](source-boundaries.json) 和 [241 个运行模块对照](runtime-source-comparison.json) 可复核。

## 实现与复杂度

私有任务沿用同一个搜索算法，保留 reached Map、Frontier、traffic/prefix/entrance Map，免去每次切片导出数组、下一切片重放完整历史。空间随已访问节点增长，不新增每任务全图数组。公开可变搜索状态仍使用原数组导入导出路径。任务用 WeakMap 持有私有函数，完成或取消后释放；解码或注入的公开状态继续原路径，快照恢复按原 searchSteps 重建。预算、每次 yield、完成 tick 和零预算惰性准备不变。

最多 8 个 arrival 弧只复用纯地形检查。profile、地图内容/尺寸和目标姿态变化会失效；每次仍创建新姿态对象、按原短路顺序执行本次 traffic 回调。风与路径费用照常计算，不保留捕获上一个切片状态的回调。

[最终 diff](candidate.diff)：ship-navigation.ts +49/-19，ship-planning-job.ts +11/-7，生产净 +34；新测试 78 行。含前阶段 COW 的整个 PR 生产净 +43。另有 [几何单独 diff](geometry-only.diff) 与 [容器步骤 diff](container-step.diff)。没有第二套寻路算法；代价是同一算法中的私有容器分支及更多存活稀疏状态。

持久 query 状态可对照 Detour 原始实现的 [initSlicedFindPath](https://github.com/recastnavigation/recastnavigation/blob/9f4ce64458dfae86e1239c525ddc219c4e9e06f1/Detour/Source/DetourNavMeshQuery.cpp#L1261-L1303)：其查询持有 node pool/open list。这里只借鉴生命周期，不把不同图、启发式或运动约束的性能当作本项目证据。之前只读研究和未采用候选完整保留在证据归档。

## 同机固定输入测量

官方 StaticSoloDeploymentRuntime 六人 sapphireArchipelago，room six-player-perf-512，空闲人类与 5 个固定 AI（v9_archer×2、knight×2、summoner），14400 个正常 50ms tick。未改变输入、AI、规则、思考频率或预算。Node 测的是 AI+sim 的 wholeTick，快照和 observer 另计；不是浏览器帧/GPU测量。

先做 AGPPGA 筛选（各 2 次），G 是 cdb8f075 几何单独版本；最终 P 另有零预算惰性准备修正，筛选不能冒充最终独立组件验收。随后预定 APPAPAAP（ABBA/BAAB），A/P 各 4 次。31 个事件由之前只读基线中搬运 reached 记录≥10000选定，未按候选最快 tick 挑选。详见 [预选事件](predeclared-events.json)、[正式顺序](formal-plan.json)、[逐次统计](comparison.json)。表中 p99 和 max 是各次统计量的均值，不是合并样本分位数。

| 指标 | A | P | 变化 |
| --- | ---: | ---: | ---: |
| wholeTick mean ms | 3.9163 | 3.7823 | -3.42% |
| 每次 p99 均值 ms | 29.6258 | 28.6263 | -3.37% |
| 每次 max 均值 ms | 92.6556 | 96.3996 | +4.04% |
| 31 事件总耗时均值 ms | 638.7244 | 395.9754 | -38.00% |
| 整进程 CPU s | 87.1627 | 84.3036 | -3.28% |
| 最大 RSS 均值 MiB | 990.8135 | 985.3691 | -0.55% |

整体墙钟 -2.97%，sim 总耗时 -4.38%，AI -0.23%，renderSnapshot +0.84%，observer +1.80%。没有把计算移到未计时任务。不能声称稳定降低内存或最大 tick，p99≤16ms/max≤50ms 均未达到。

独立计数诊断（带钩子，不作为时延验收）：3325 次规划调用未变，重复导入 reached 记录从 1,765,840 降为 0；arrival 调用仍 3656；hullPassageClear 少 7160 次，convexHull 少 183142 次。函数包含时间互相重叠，不能相加为 CPU。见 [计数对照](cost-comparison.json)。

## 正确性与内存代价

19 次完整原生运行均为 checksum `7d94a5e8`，完整 command 字节 618189，SHA256 `771222bde4c8d2c0a46a97313563ad2b5de1d52ed92fb2d3c70511ff2276c997`。另一次 A/P 状态对照的全部 14400 个逐 tick checksum 与 snapshot SHA 完全一致：[运行对照](all-run-equivalence.json)、[状态与内存对照](state-and-memory-verification.json)。

新增测试逐 yield 比较结果、回调序列与姿态对象身份，覆盖 12/1024/4096/Infinity 预算、阻塞回退、交错任务、嵌套公开查询、地图变化。相关 54 测试通过。生产构建、类型检查和 bootstrap 通过。

全量测试为 6897 通过、5 失败（633 文件通过、4 失败）。五项失败均在未改动 main480 和 A 上复现相同断言：maneuver recovery 点数、voyage quality 一船未开火、voyage 倒车泊位和零裕量控制两项、归档 six-player probe 仍断言 rulesVersion 2。没有削弱测试：[失败逐项对照](baseline-failure-comparison.json)。不能称全套绿灯。

8 个同时存活任务、各推进 12 次（searchSteps 11），保存状态哈希一致。强制 GC 后 P 活跃期比 A 多约 2.61MiB JS heap、1.11MiB arrayBuffers；取消后 JS heap 回到 A 约 8MiB 的水平。保留容器确有存活内存代价，较低 RSS 可能是分配器历史，不声称零成本。正式长场景内存差异小；未新增全图私有数组。

## 原始证据和复现

`manifest.json` 逐文件记录原路径、字节数、原始和压缩 SHA256；`payloads` 按内容去重，保存原始 bundle、逐 tick 数据、输入、命令、测试日志、源码哈希、脚本。两个归档根是本阶段 sanity-planning-lifecycle-20261015 与之前只读 sanity-readonly-planning-20261015；后者的“等待边界”描述是历史状态。

```sh
python docs/performance/sanity-planning-lifecycle-20261015/evidence.py verify
python docs/performance/sanity-planning-lifecycle-20261015/evidence.py extract /workspace/sanity-evidence-replay
```

在独立源码目录 checkout 上述 A/P 提交并安装项目依赖。复制解出的 formal.py/timed.py/memory.mjs 到新的输出目录，按机器实际位置修改 sources 与项目 cwd，再运行 formal.py；它按固定顺序调用仓库 scripts/six-player-tick-probe.ts（14400 ticks），之后运行 state、memory、counts 诊断。输出目录不要覆盖原证据。analyze.py 保存统计计算；screen.py 和 screen-plan.json 记录筛选，不替代正式结果。内存诊断使用 `--expose-gc`，正式计时不强制 GC。

本阶段提供了可审查、有限收益的简单生命周期改动。同步重复搜索仍占更大的工作量；应先验证具体复用边界，再争取数量级改善，不能把节点减少比例当作已经实现的时延倍数。
