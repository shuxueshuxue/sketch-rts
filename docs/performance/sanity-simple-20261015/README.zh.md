# 独立 sanity check：删除不必要的工作

**找到了少量代码消除数量级浪费的实例，但没有达成全局十倍目标。** 保留的 9 行 COW 修复，在固定重复对照中让 tick 124 / 187 / 243 分别快 **22.5× / 116.3× / 51.7×**；预声明的全部 38 个事件 tick 合计快 **2.42×**。整局 mean / p99 只观察到约 **1%** 下降，候选仍有 **130.45 ms** 最大值。建议仅作为“消除重复建图”的独立候选审查，不能宣称 p99≤16 / max≤50 或浏览器流畅度目标已达成。

独立车道从主线 `4804631c22f7be3f83dc6374e71ce03d86068dd8`（PR #380）开始；2026-10-15 再次查询远端 main 仍为此 SHA。分支 `perf/sanity-simple-20261015`，rulesVersion **3**，checksumVersion **18**。不接管美术/性能工程车道、不改 bootstrap_1 规则 2 分支。未合并、未部署。

目标是寻找 10–100 倍峰值改善的根本浪费；目标本身不是测量结论。正式对照与诊断分开，所有阴性实验、失败启动和异常大值保留。生产 diff、证明脚本、归档证据的体量分别计算。

## 可重复的原生负载

同机 Node v24.19.0，cgroup 限额 4 CPU。原生 StaticSoloDeploymentRuntime → LocalGameAdapter → CommandFrameRuntime，sapphireArchipelago 六人房间、一个空闲人类和五个 AI，14400 个连续正常 tick（模拟 12 分钟）；每步时间推进 50 ms。AI 为 v9_archer ×2、v9_knight ×2、v9_summoner ×1。未改变预算、路线、规则、AI 相位或正常模拟频率。每次均重新创建进程、房间和所有派生数据。

wholeMs 包含实际 updateToRenderTime 的模拟、命令和 AI；currentSnapshot、日志观察和最终归档另测。这是 Node 模拟 tick，不是浏览器渲染帧或 FPS。保留 tick 0 和所有尾部样本，不强制 GC，不删异常值。四个阶段 hook 的正式系列另有 plain A/B 校准；细粒度计数、CPU profiler、GC observer 的结果仅用于诊断。每个进程的 wall、user/system CPU、最大 RSS、缺页和 cgroup cpu.stat 另存 journal，RSS 包含编译及观测，不能冒充模拟独占内存。

正式顺序在启动前写 plan.json：A B B A / B A A B，之后 plain A、plain B。A 是独立 detached worktree；B 是提交冻结的候选。无并行测试、性能进程或打包压缩干扰。首次执行器使用缺失的 /usr/bin/time，在任何 tick 之前失败；原始失败记录保留，修正为 Python os.wait4 后重新启动完整序列。

## 成本证据和因果边界

第一轮完整基线 whole mean 3.754 ms / p99 28.503 ms / max 85.644 ms。渲染快照均值 0.216 ms、观察器 0.0076 ms，因此不能把 tick 高峰笼统归咎日志。诊断运行 GC 869 次、合计 3502.84 ms；部分峰值与 GC 重叠，另一些没有。一次 5971 tick 的 85.64 ms 在多个互不相同实验里自然消失，不能算任何方案的收益。

CPU profile 的调用树是 **inclusive，不能相加**：完整 updateToRenderTime 52.879 s，stepGame 40.355 s，updateUnits 30.654 s，sailToward 23.404 s，replan 12.623 s，AI 12.142 s，planShipRouteImpl 11.081 s，hullPassageClear 7.721 s，convexHull 7.056 s，sweepShipCollision 6.111 s，arrivalConnectorFor 3.819 s；GC self 3.986 s。这些数值来自带 profiler 的另一次运行，不是正式对照。

真实整局计数：hullPassageClear 1,284,343 次；convexHull 1,575,565 次（输入点合计 44,715,927，单次最大 1300）；sweepShipCollision 303,736 次；walkingDistance 1,463,687 次，但完整 grow 仅 240 次。不能把所有距离查询都误算成全图搜索。planShipRouteImpl 3325 次，恢复节点总数 1,765,840、单次 31,755；累计重建确实存在，但尚不能据此说它占据全部峰值。

另一个明确结构问题：snapshot 标记建筑 overlay 为 shared 后，下一次真实建筑变化 createRuntime 丢掉分块图。下一位需要绕障碍的地面单位重建整图；最初注意到 tick 9659 的 3489 次 growBoxInto（约 31.82 ms），但后续 COW 对照确认 **该 tick 是首次建图，不是本修复覆盖的重复建图**，该假设已纠正。真正被消除的重复全图工作发生在 124、187、194、243 等后续建筑变更 tick（完整计数归档保留）。该快照路径在实际 room-host 中也存在，不能简单删除测试快照“提速”。候选继承分块图的独立可变容器，继续使用原有 redoTiles，仅重建脏区域。旧 snapshot 必须保持旧路线。

## 研究来源和进一步的设计边界

[RTS 几何、空间组织与 COW](research/rts-geometry.md) 和 [搜索所有权、距离需求、COW 审查](research/search-ownership.md) 给出固定提交的原始开源代码定位及论文链接。Spring/0 A.D./OpenRA 的局部空间更新、Detour 的持久 sliced search 是结构先例，不是本项目性能证据。

更激进的候选是 job 真正拥有搜索状态，避免每片恢复/导出整个 reached graph 与 heap，保留 goal-only arrival 计算。复杂度可从累计 O(N²/B) 拷贝回到 O(N)，但当前公开 live API 的每片 nodes/heap、身份、callback 顺序、嵌套异常恢复都有现成验收，不能删测试冒充等价。应以私有 job engine 和公开协议适配层共享同一算法，先量恢复/导出/arrival 生命周期，再决定是否值得增加边界。

替换为 support-map shape cast、合并海岸格、改变航路图可能降低几何工作，但会涉及初始重叠、法线、接触点、平局和选路语义。它们需要独立语义决定，本车道没有把这种改规则当作等价优化。

## 已淘汰实验

| 方案 | 单跑 whole mean / p99 / max ms | 结论与复杂度成本 |
|---|---|---|
| lazy arrival，实际需要时才准备 | 3.805 / 28.800 / 83.803 | 未证明整局收益；不解决跨 slice 重建，保留 patch |
| 一次 sweep 共享自身分段 hull | 3.776 / 27.939 / 143.396 | 单跑不稳定；局部 closure/parts 增加分配及证明负担 |
| 上项加实际配置空间 AABB 排除 | 3.788 / 29.075 / 93.441 | +34/−10 行仍无整局收益；48027 私有、168 公有接触比较通过，仍不选用 |
| 冷 walkingDistance 的合法 octile witness | 3.789 / 28.242 / 126.864 | 避免部分全图场，但重复目标可从 O(V+k) 退化 O(kL)，不选用 |
| 距离矩阵转置初试 | 3.784 / 27.772 / 108.538 | 后续正式八次对照否决，见下 |

这些都是同源同规则同输入完整 14400 tick，各次完整命令字节与最终 checksum 一致；**单跑仅筛选，不代表收益证明**。各自 patch 均已撤回；AABB 的数值边界还没有覆盖所有可表示输入的形式化证明。

距离矩阵正式候选提交 `eaaf9afd`（生产 +8/−3 行、净 +5）用 4 个 A 和 4 个 B 新进程对照：各次 mean 的平均 **3.72168→3.77680 ms (+1.48%)**；各次 p99 的平均 **27.84333→28.61719 ms (+2.78%)**。最大值范围 A **89.45–125.30**、B **80.30–98.01 ms**，不能把最大值平均下降叫稳定全局收益。plain A/B 也没有显示优势（mean **3.81730→3.97483 ms**）。[逐次完整汇总](transpose-summary.json)。

tick 6990 的四次平均 **53.844→30.943 ms**，局部有改善但不达十倍。诊断确认该 tick grow **12→2**；整局 grow 却 **240→256**，walkingDistance **1463687→1463003**。反转目标后移动船只产生新目标场，成本转移真实存在；不能凭 16 次 grow 的增加断言解释了全部运行时差。方案撤回，新增的边界测试也随实验 patch 保留，没有混入最终生产 diff。

## 保留候选的边界与验收

生产候选 `90cacfbc`，回归测试提交 `b6af347b`：`terrain.ts` **+9/−0 行**，测试 **+26/−0 行**，无新依赖、无新长期缓存、无新调度器。当前 runtime 源码只比基线多这 9 行。复制 nodes 的对象和可变 Map/数组，让原有 redoTiles 处理真正 dirty sectors；不变的局部距离场继续共享。复制和更新仍全部在原来的 setBuildingBodies 同步调用内计时，没有移到未计时任务。

复杂度从每次快照后变化都重建全图窗口距离场，改为 O(V + windows + cachedGoals) 的容器复制，加 dirty sectors 的局部场重建。全图 walk 扫描、clearance、island 标号仍存在，**不是完全 O(变化区域)**。维护成本是增加一处所有权边界：未来 Tiles 新增可变成员时必须更新复制清单；共享 next 是局部几何的纯 memo，并非不变内存。沿用项目现有的 Terrain 对象身份更新协议，不引入就地修改 terrain.cells 的兼容层。

- [完整状态验证](state-verification.json)：两臂 **14,400 次快照 hash 与 checksum** 逐项相同，全部命令 **618,189 bytes** 逐字节相同，SHA256 `771222bde4c8d2c0a46a97313563ad2b5de1d52ed92fb2d3c70511ff2276c997`；最终 checksum `7d94a5e8`。
- [完整模块 overlay 差分](validation/overlay.json)：**219,933** 次比较、3 类地形、13 代建筑状态、72 次 snapshot 共享；覆盖非空→非空、重叠、跨 sector、无 walk 变化、旧 snapshot lazy 查询和独立冷重建。
- 10 个相关测试文件 **67 tests passed**，含新回归、terrain-flow-equivalence、snapshot-ground、building-body、restore、room-frame-snapshot、room-planning-restore。`npm run build:production` 通过，含 TypeScript、客户端构建、服务端 bundle 和 production bootstrap；未部署。

真实建造宏场景是独立的合成压力场景：256×256 地形、24 个正常行军 footman、一个 worker、已有 town hall；8 tick 自然预热并生成 snapshot，随后用正常 build 命令建 farm。没有在计时期间手改/删建筑；旧 snapshot 与新世界均检查。ABBA×2 同一进程加载独立完整模块，是**带相同轻量计数的诊断对照**，不混入正式整局样本。原候选四次变更 tick 约 **14.57–16.61 ms**，原实现 **38.39–44.34 ms**；该 tick 重连 sector **676→5**，工作次数约降 **135 倍**，完整 tick 仅约 **2.7 倍**。当前给出的全步时长包括复制及首次 routing；snapshot 成本另列。[全部宏场景结果](macro-summary.json)。

进一步用 region/window DSU 取代全格八邻洪泛的实验，通过 **21,032** 次完整 island 数组比较（**5,437,968 格**、5120 种布局放置、含棋盘格与多代 snapshot）。先试两数组，再试单数组负根编码与统一压缩；后者减少临时数组容量，但宏场景仍无稳定额外收益。因此 **不保留**，没有因为算法理论更漂亮就叠加复杂度。[差分报告](validation/rejected-islands.json)与 patch 均留存。

## 后续结构工作与协调

本次发现证明了“局部世界变化不应触发全图重建”确有数量级浪费，不意味着全局 peak 已解决。仍需保留 10–100 倍作为下一轮工作假设，继续把真正的工作寿命改成 job/scene 的寿命，而不是沿热点添加越来越多细粒度缓存。

下一优先候选是私有船舶 planning job 持有真实 search runtime：图、frontier、已验证 arrival arcs、prefix/entrance 不应每片重建。先记录同一 job 的累计恢复/导出量和 goal-only arrival 重建次数，再做最小共享引擎，保留所有公开 API 的逐片数组/身份/callback、序列化回退、异常和嵌套调用验收。该设计的分配与并发 job 工作集必须随速度一起测；不允许扩大每 job 全图 typed arrays、重复两套算法或改变预算与完成 tick。当前仅研究与设计，尚未实现或声称收益。ship-navigation 的实施所有权需由父线程与原性能车道协调。

## 最终 COW 正式对照

冻结 A=`4804631c22f7be3f83dc6374e71ce03d86068dd8`，B=`b6af347b`，8 次正式新进程、另 2 次 plain 校准。逐次 source 闭包与提交 blobs、命令原始字节均验证：[闭包复核](source-command-verification.json)。所有 241 个输入文件均逐字节检查，B 的运行时差别只有 terrain.ts 的 9 行。

| run | whole mean ms | p99 ms | max ms | >50 ms |
|---|---:|---:|---:|---:|
| plain-A | 4.04187 | 31.15931 | 102.29372 | 13 |
| plain-B | 3.85797 | 28.89811 | 100.77466 | 9 |
| r1-A1 | 3.95705 | 29.43578 | 97.01733 | 11 |
| r1-A2 | 3.78592 | 28.06439 | 88.92518 | 7 |
| r1-B1 | 3.68005 | 27.79008 | 82.10095 | 5 |
| r1-B2 | 3.86068 | 28.56064 | 101.82096 | 10 |
| r2-A1 | 3.93598 | 29.94093 | 104.84060 | 6 |
| r2-A2 | 3.80070 | 28.54362 | 99.18736 | 6 |
| r2-B1 | 3.94812 | 29.88536 | 130.45462 | 15 |
| r2-B2 | 3.83196 | 28.54437 | 115.37199 | 7 |

四次运行统计量的平均（不是将多次样本混成一次分位数）：mean **3.86991→3.83020 ms (−1.03%)**，p99 **28.99618→28.69511 ms (−1.04%)**。各轮有相反方向和明显波动，不能据此认定稳定的整体提升。最大值范围 A **88.93–104.84 ms**，B **82.10–130.45 ms**；B 的最大值均值也更差。反例 r2-B1 tick 10710：whole **130.4546 ms**、AI **110.4554 ms**、sim **19.9713 ms**。该正式运行未开 GC/profiler，**其具体暂停原因未归因**，不能用另一次 profiler 的结果解释掉它。

[预声明事件集合](cow-events-predeclared.json)在正式运行前按诊断计数选取：baseline growBoxInto 减 candidate >1000 的 **全部 38 tick**，不按耗时挑选。其完整 tick 合计平均 **709.20→293.28 ms (2.42×)**，只有 3 个达到 ≥10×；其余 35 个全部列于[逐事件原始值和比例](cow-events-summary.json)。tick 9659 四次平均 **61.43→66.69 ms**，明确没有改善。全部整局样本在[cow-summary.json](cow-summary.json)，包含冷启动及非事件 tick。

| 整个测量进程（含编译与观察），四次平均 | A | B |
|---|---:|---:|
| wall seconds | 61.269 | 60.670 |
| user+system CPU seconds | 86.525 | 85.263 |
| max RSS MiB | 952.134 | 915.047 |

RSS 单次范围 A **915.45–1052.00 MiB**，B **903.86–922.84 MiB**（原始 KiB 以 event summary/journal 为准）；平均 RSS 被 A 的一次较大峰值影响。没有观察到 CPU/进程峰值内存向别处增加，但这不是全平台内存保证，也不是纯模拟分配率。完整 tick 耗时合计平均 **55.727→55.155 s**，wall 与 CPU 另外列出，未把并行后台 CPU 或编译开销冒充模拟时间。

生产保留 +9 行、回归测试 +26 行；独立诊断/证明/汇总脚本共约 915 行，均不进入运行时包，不能拿工具体量掩盖生产复杂度。该轮保留简单的所有权修复；没有采用 DSU、几何 AABB 或新的搜索兼容层。

## 原始证据与复现

**33 次完整原生运行，共 475,200 tick** 的命令原字节、rulesVersion/checksumVersion 与最终状态均一致：[逐运行核对](all-run-equivalence.json)。计时接受样本是两套各 8 次正式对照；plain、profiler、计数和逐 tick hash 运行分别保留，不混合统计。正式与初试 probe 的完整输入闭包在原始 source-inputs 中；额外 cost probe 只捕获 TS 原文，不能取代官方 probe 的 JSON 资源/完整闭包记录。[探索阶段源码差异](exploratory-source-diffs.json)确认每项试验只改变指定的一个运行时文件。

[manifest.json](manifest.json)列出 **437 份原文件**的原路径、字节数和 SHA256。payload 按原始字节内容去重，gzip 的存储字节另有 SHA；解包后恢复原字节，不规范化日志或删除异常样本。总归档约 **47 MiB**，包含所有正式/探索/计数/状态运行、CPU/GC 原始数据、失败启动日志、阴性方案源码、证明结果与构建日志。未打包 node_modules、工作树或构建产物目录；AABB proof 的重建工作树可从其完整官方 source-inputs 复原，保留了 proof 原始输出。归档与安全新目录提取均已执行，并再次从提取内容复核 COW 十次运行的源码 blobs 和完整命令。

```sh
python3 docs/performance/sanity-simple-20261015/evidence.py verify
python3 docs/performance/sanity-simple-20261015/evidence.py extract /tmp/sketch-sanity-evidence
python3 scripts/sanity-summarize.py /tmp/sketch-sanity-evidence/tmp/sanity-cow-formal
python3 scripts/sanity-event-summary.py /tmp/sketch-sanity-evidence/tmp/sanity-cow-formal
python3 scripts/sanity-cost-summary.py /tmp/sketch-sanity-evidence/tmp
```

复跑先建立基线 `4804631c22f7be3f83dc6374e71ce03d86068dd8` 和候选工作树；候选运行时必须与 `b6af347b` 的 241 个输入一致（后续提交仅补证据/工具）。安装同一 lockfile 依赖，使用记录的 Node 版本；不要同时运行其他 CPU 任务。每个输出目录必须不存在。

```sh
python3 scripts/sanity-native-series.py /tmp/control-tree /tmp/candidate-tree /tmp/new-native-series
node scripts/sanity-cost-probe.mjs /tmp/control-tree /tmp/new-control-state state
node scripts/sanity-cost-probe.mjs /tmp/candidate-tree /tmp/new-candidate-state state
node scripts/sanity-overlay-proof.mjs /tmp/control-tree /tmp/candidate-tree/src/shared/terrain.ts /tmp/new-overlay-proof.json
node scripts/sanity-cow-scenario.mjs /tmp/control-tree /tmp/candidate-tree /tmp/candidate-tree/src/shared/terrain.ts
```

series runner 保存预声明、完整命令、源 HEAD、probe hash、执行器原文、事件选择、wall/CPU/RSS/cgroup 日志。计数记录里的 grow work 是数组容量，planShipRouteImpl work 是恢复节点数，均不是“新扩展节点数”；profile/counter inclusive 时间不可相加。浏览器帧卡顿、更多地图/玩家规模、长时间 snapshot 保留以及未归因的 10710 tick 仍需下一轮独立验证。

历史 stage7 文档并未存在于本轮 main；核对的是[此前证据提交中的文档](https://github.com/shuxueshuxue/sketch-rts/blob/a5bfd25969d06f38e9dc42f2274367032b45bf5d/docs/performance/rules3-stage7-cached-connectivity/README.zh.md)。本报告的基线和所有数值均来自本工作区重测，没有沿用历史基线数值。

远端 CI 首轮在 SDK 的文档命名约束检查失败；只调整了研究稿措辞，原始研究文件仍保留在压缩归档。没有修改或放宽检查。对应 package-boundaries 本地复测通过，运行时源码仍与正式候选完全相同；远端检查以 PR 的最新状态为准。
