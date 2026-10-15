# waitForTraffic 同步重试：完整守卫的单项结果复用

局部重复搜索可以获得数量级改善，但整局峰值仍未解决。冻结上一阶段运行源码 `884e5214`（审阅提交 `3b4d778e`）与本阶段 `1389caa3` 独立比较；不混入主性能车道。rulesVersion 3、checksumVersion 18，AI、规则、预算和重试频率不变。

生产净增 **24 行**：navigation +22、sailing 净 +2、planning-job 仅引入取消清理，另有回归测试。只在 waitForTraffic→replan(false) 已知空 traffic 的同步查询上复用，每船一个弱所有权条目；原准入、预算、赋值、计时重置与实时碰撞继续执行。公开查询和嵌套搜索不复用。terrain.ts、hullPassageClear 未改动。

[完整输入/结果/生命周期审计](INPUT-AUDIT.zh.md) 解释实际读取和依赖。首版保留完整船状态、完整目标、地形/尺寸/风和实际 profile/运动限制/风采样的独立副本；用 Object.is 递归比较，保留 undefined、-0 和非有限数。没有把诊断哈希当生产键。miss 保存未交给执行器的结果副本；hit 再克隆，保留结果内部别名并隔离 exact、末点、pivot 和数组修改。守卫、复制、miss、回收成本均在原 tick 内。

## 正式计时

同机官方六人 sapphireArchipelago / six-player-perf-512，空闲人类与固定五 AI，14400 个正常 tick。预先固定此前只读诊断的全部 **321 个严格重复事件**，恰对应 321 个不同 tick。采用 APPAPAAP（ABBA/BAAB），各四次，未带诊断或 shadow 钩子；每个进程从冷启动走完整场景。后续正确性诊断不与这八次计时并跑。

| 指标 | 基线 A | 候选 P | 均值变化 |
| --- | ---: | ---: | ---: |
| wholeTick mean ms | 3.8135 | 3.6792 | -3.52% |
| 每次 p99 的均值 ms | 29.1705 | 28.7092 | -1.58% |
| 每次 max 的均值 ms | 102.1831 | 101.1895 | -0.97% |
| 321 个预选 tick 总耗时均值 ms | 4446.9040 | 1100.3534 | -75.26% / 4.04× |
| 预选集合内每次最大值均值 ms | 44.7750 | 33.2200 | -25.81% |
| 整进程 CPU s | 85.8059 | 83.1212 | -3.13% |
| 最大 RSS 均值 MiB | 908.2598 | 909.8066 | +0.17% |

表中 p99/max 均为各运行统计量的均值，非混合样本分位数。全局 p99 有重叠和反例：候选第三次 p99 30.7123ms，高于四个基线运行；不能称每次都改善。全局 p99≤16/max≤50 未达到。整进程墙钟 -2.91%，sim 总耗时 -5.12%，AI +1.41%，快照 +4.71%，observer +6.05%；计时之外没有新增调度任务。采样 heap 峰值均值 +3.92%、arrayBuffers +0.004%，没有稳定内存下降结论。这里测 Node 仿真 CPU，不测浏览器渲染帧。

321 个事件全部保留：318 个平均改善，3 个平均变差；274 个满足四次 P 全部快于四次 A。149 个均值改善至少 10×，其中 **88 个满足 min(A)/max(P)≥10**，不依赖单次异常。按基线平均耗时排序的最慢事件 tick10069：39.2127→2.3160ms（16.93×）；第三慢 tick9555 只有35.3729→25.3942ms，另一个重事件 tick9225 只有33.4844→28.8170ms。完整逐事件表含所有反例，不能用最佳事件代替整局结论。

预选事件均值合计节省约 3346.55ms，而全部 tick 合计只节省约 1934.50ms；非预选 tick 合计约增加 1412.05ms。分配/GC 时机、缓存冷热和运行波动可能贡献此差异，本轮不能分离因果，不声称完全没有开销转移。整进程 CPU 与全部 tick 均把这部分成本计入。

这证明重复做相同纯查询是实际浪费；71.1% 节点比例不是时延收益比例。当前完整守卫没有抵消局部收益，代码体积小；保留为草案候选供联合评估。没有为了扩大命中去削减守卫或叠加另一层缓存。

## 存活内存

独立强制 GC 诊断使用同一实际重查询的 8 个不同 Unit，保留船与地图，A 直接查询、P 保存每船单项结果。扣除各自 before，P 比 A 多 **879112 字节（0.838MiB）JS heap**，arrayBuffers 增量相同；取消后 heap 为 A 142.3474 / P 142.3545MiB。该诊断预载完整输入档案，占约 141.8MiB，两组相同，不把它当游戏本身基线。结果哈希相同，取消回收后差距约 7KiB。RSS 受分配器历史影响，正式长场景也未显示内存下降，不能宣称零存活成本。

## 验证与复现

本目录的 comparison.json、event-analysis.json、verification.json 与原始日志记录最终结果。第一轮 shadow 对全部 721 次查询（321 hit/400 miss）重跑原搜索，结果和内部别名一致，14400 个逐 tick 状态与命令与上一阶段基线一致；最终验证还比较输入与结果共同对象图，补查对外别名。

实际返回包括 partial 与 pivot。重放工具对所有 721 个实际输入逐个比较，故意修改每个点的 exact/位置、pivot、末点、shift/清空数组及 partial，再次命中并冷复制输入。单测另覆盖空 points/无路线的负结果、undefined/-0/非有限数、同对象地形/风/装备/尺度/派生 profile 变化、目标变化、取消、替换 motion/Unit/map，以及公共/嵌套回调次数。完整场景冷恢复包含上一阶段保存的 tick9660 快照与本场景 tick10010/11010 的 JSON 快照；A/P 使用相同恢复边界。

最终 16 次完整运行均保留相同命令与最终校验和；正式 A/P 与 shadow 的 14400 个逐 tick snapshot SHA 均相同，命中集合严格等于预先固定的 321 个 tick。冷恢复 A/P 也逐 tick 原始 snapshot SHA 相同。基线冷/热在最后 434 个 tick 的原始 JSON SHA 不同；追加两次完整诊断定位到首个差异 `.units[62].sailing` 中 `route` / `yawRate` 的键顺序，值无差异，全部 14400 个排序后的完整快照 SHA 和逐 tick 游戏校验和均一致。详见 restore-difference.json，未为此更改模拟。

全量测试 **6901 通过、5 失败**（634 文件通过、4 失败）。五个失败名称与断言消息均和上一阶段已在未改动 main 复现的失败完全相同：maneuver recovery 点数、voyage quality 未开火、voyage 两项控制、归档 probe 仍断言 rulesVersion 2。没有降低验收；不能称全量绿灯。新增 4 个测试通过，生产构建/类型检查/bootstrap 通过。生产净 +24 行，新增测试 102 行；全部正式计时的 241 个运行模块，只有 sailing、navigation、planning-job 三个预期模块变化，组内八次源码一致。

原始归档的 manifest 逐文件记录路径、字节数和 SHA256，payloads 保存原始 bundle、输入、逐 tick 数据、命令和日志，可验证或恢复：

```sh
python docs/performance/sanity-sync-retry-20261015/evidence.py verify
python docs/performance/sanity-sync-retry-20261015/evidence.py extract /workspace/sanity-sync-evidence-replay
```

检出上述 A/P 提交，安装项目依赖；将解出的 formal.py、timed.py、predeclared-events.json 放在新输出目录，调整 sources/cwd 后运行 formal.py。它先串行执行八个完整无钩子场景，再执行状态验证。post.py 指定 shadow-final、全部输入重放、活跃/取消内存、冷恢复、全量测试和生产构建；调整其中路径，勿覆盖已有证据。formal-plan 初始 post 标签继承了上阶段多余名称，formal-plan-clarification.json 明确实际执行项；counts 不用于本阶段计时。analyze.py / verify.py / event-analysis.json 提供统计与核对依据。

PR #381 保持草案，不合并或部署。上一阶段证据仍独立保存，不将不同基线的百分比相加。
