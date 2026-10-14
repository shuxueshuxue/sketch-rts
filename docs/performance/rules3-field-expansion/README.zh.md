# 规则 3：局部寻路字段展开与剩余尖峰

本阶段只改变 `src/shared/terrain.ts` 的 `grow` 函数体：按原来的右、下、左、上顺序保留已经读取的通行位，供随后四个对角方向检查使用。方向顺序、5/7 步长、严格小于比较、Dial 桶的后进先出顺序、队列写入、缓存时钟、淘汰和复用均保留。没有新增数组或持久缓存，没有改变 AI 思考相位、船只规则或校验频率。

已有证据支持这个函数的局部收益；**整局均值、尾部和内存的稳定改善尚未证明，p99 ≤16 ms、最大 tick ≤50 ms 的目标仍未达到**。本报告不代表浏览器渲染或 FPS 测量。

## 来源与规则归属

| 用途 | 实际代码版本 |
|---|---|
| 首次规则 3 基线、原窗口定位 | `61f6ded5a5369a49ba35210832f4e561b7bc6894` |
| 正式 ABBA 的 A1/A2 | `6ca7c37396c4873ca90791e6d3b30c80bce89fd7` |
| 正式 B1/B2/plain、微对照与后续 1859 诊断 | `fd2c535decf17f0a1e5eebb21547c8f3740255dc` |
| 集成类型检查、生产构建 | `79b42b54da3eb64816a1408bf88fb8d7c8321aac` |

新旧基线的 241 个实际 headless 输入字节完全相同；候选仅改变其中的 terrain 文件。集成版本的 241 个输入又逐项与实测候选核验一致。两次正式 A 都实际执行新版本，没有将旧 61f 的测量重贴标签。生产代码集成提交与实测候选除提交身份外完全一致。

全部本阶段实测属于 **rulesVersion 3 / checksumVersion 18**。PR #373 及其规则 2 证据保持原样。PR #374 单独将守护卷轴实际半径 **280→180**，视觉圈对齐 180；价格 200、持续 7 秒等其余规则未改。AI 原有 260 的受益估计仍存在，未在等值性能提交中改动。旧规则 2 存档和回放的兼容边界见[平衡报告](../../balance/guardian-scroll-area/README.zh.md)。

## 先定位，再选改动

原规则 3 基线完整运行 14,400 tick：whole mean 3.7176 ms、p99 28.4893 ms、max 94.1534 ms，12 个 tick 超过 50 ms。模拟均值 2.7669 ms、AI 均值 0.93137 ms。whole 不包含另行计时的快照和命令序列化。

预选 tick 6990 的 detailed capture 中，player-6 `chooseNavalMine` 为 51.2305 ms，内含 12 次 `grow` 共 49.3663 ms，其中初始化/填充/播种 3.7212 ms、展开 45.6451 ms。36 次字段请求为 12 misses、24 hits，无淘汰。该诊断会扰动时间；嵌套耗时不可相加，也不能用它与正式对照相减计算收益。12 个实际地图目标、字段 key、源状态与全部时钟保留在归档中。

## 正式整局 ABBA

同环境串行执行 A1 → B1 → B2 → A2 → B plain，各 14,400 tick。没有 detailed scopes、CPU profiler、详细 GC observer、强制 GC、删冷帧或删尾。plain 是命令/校验透明性核验，未混入计时合并。

| arm | whole mean | whole p99 | whole max | >50 ms | sim mean | AI mean |
|---|---:|---:|---:|---:|---:|---:|
| A1 | 3.85624 | 29.19586 | 107.28174 | 9 | 2.86790 | 0.96836 |
| B1 | 3.72096 | 28.58608 | 93.18719 | 8 | 2.77299 | 0.92736 |
| B2 | 3.71473 | 28.11110 | 86.20535 | 6 | 2.77582 | 0.91957 |
| A2 | 3.62939 | 28.41400 | 77.88320 | 7 | 2.70753 | 0.90302 |

A/B 各 28,800 个样本的合并均值 **3.74281→3.71785 ms（−0.67%）**、p99 **28.84969→28.44910 ms**，>50 ms **16→14**。但 A1/B1 配对 −3.51%、A2/B2 配对 +2.35%，A1→A2 的参考漂移更大，不能据此宣称稳定整局收益。960 个规划 tick 中有 511 个配对差方向翻转。启动 tick 0 的最大值按执行顺序单调降低，不能归功于候选。

此前预选的 tick 6990，player-6 实际规划 A1/A2 为 **52.529/51.769 ms**，B1/B2 为 **37.979/35.894 ms**，均值下降 29.17%。两个 B 均快于两个 A。这是 owner 规划上下文的局部信号，正式运行没有逐 grow 计时，不能将 29.17%称为 grow 的直接测量。

非规划 >50 ms 仍为 **3→3**，p95 **9.06078→9.15047 ms** 略退。RSS/heap 的原始起止、周期观察和最大观察值全部保留；它们不是持续峰值、分配率、留存产品内存或泄漏测试，没有证明内存改善。

## 真实参数的独立函数微对照

从实际 tick 6990 捕获重建 320×320 地图的 sea runtime、12 个 singleton 目标、冷桶/冷字段和每字段两次 hit，独立编译原/候选 whole terrain 模块并调用实际 `createRuntime/cached/grow/exactField`，没有复制算法作为 oracle。4 个预热区块单列；正式 24 个区块交替 ABBA/BAAB，每区块 4 次完整 12-grow 序列。192 次预热、1,152 次正式调用全部保留。

| 12-grow 序列 | 原实现 A | 候选 B |
|---|---:|---:|
| mean | 29.00410 ms | 24.98834 ms |
| median | 28.89434 ms | 23.63589 ms |

均值降低 **13.85%**、中位数降低 **18.20%**；24 区块有 22 个为正，19 个区块两次 B 都严格快于两次 A。两次负区块保留，最差 −8.37%。后续目标组 p99 **3.069→3.710 ms** 上升，不能说全部尾部改善。

完整冷初始化、填充、播种、展开都计入 grow；大字节校验在序列外。原/候选 24 份中间完整字段与队列文件、正式序列全部留存字段和最终队列均一致；104.5 MB 原始字节已读回复核。原运行的 walk 本身未捕获，而是从实际 immutable terrain 与原 `createRuntime` 重建；原 tick 的辅助缓存、堆、CPU cache、JIT/GC 历史未重建。重复和序列后校验会影响后续堆/缓存条件。此结果只证明该局部工作负载，不替代正式规划、整局或 FPS。

## 精确性与工程验证

- whole terrain 模块实际函数的 A/A 校准 171 项；候选 683 个用例，含 land/sea 各 256 个邻接 mask。
- 比较完整字段、队列事件顺序、缓存及 128/129 LRU 边界、tie、spare/数组/buffer 别名；保留 231,139 条完整事件。真实 stale fixture 为 1 次 stale、4 次 valid pop。NaN/Infinity 的可区分标记与反解检查均通过。
- 既有地形相关 6 文件、47 项测试通过。实际生产打包依赖 guard 的 5 项测试、严格类型检查和 `build:production` 通过；构建检查实际输出文件，而非只检查源码 import。
- 新归档落盘后，在完整源码与历史 docs 目录上执行 SDK 边界检查，7 项全部通过；不使用 sparse checkout 冒充完整文档覆盖。
- 所有整局运行的 **618,189 字节原生命令逐字相同**，SHA256 `771222bde4c8d2c0a46a97313563ad2b5de1d52ed92fb2d3c70511ff2276c997`，最终 checksum **`7d94a5e8`**；ABBA 的逐 tick 实体数量/索引/相位一致。单场景透明性不冒充所有输入的形式证明。

原 preparation 中的 `UNRUN/testsExecuted=false` 描述其准备时间，原字节不改；后续 execution/results 明确记录实际运行、命令、返回码、工具和源码 SHA。

## 剩余非规划尖峰

| tick | A1 / B1 / B2 / A2 whole ms | 当前结论 |
|---|---|---|
| 1859 | 51.241 / 56.179 / 61.879 / 53.431 | 重复模拟尖峰，继续窄范围归因 |
| 10960 | 22.264 / 26.171 / 32.522 / 26.866 | 未重现旧 >50 ms，保留数值，不强行归因 |

后续 v3 只在 1858–1860 观察 CPU/GC，包裹 5 个实际导航函数边界，关闭 AI/terrain hit 计数和内循环插桩。完整 14,400 tick、原生命令、checksum、源码/工具 SHA 和 profiler 时钟锚均通过。

该诊断 tick1859 whole **48.421 ms**、sim **48.329 ms**，其中 `updateUnits` **19.287 ms**；新运输船 1105 的 `sailToward` **14.903 ms**，内含 route **6.718 ms**、grid **3.105 ms**。另一个明显样本链是 **updateTraining→shipLaunchPose→harborPoses→hullFits/clearOutline**，本 tick 实际生成两艘船。样本祖先区间重叠，不能相加或当作每次下水的准确计时。GC 重叠约 **1.635 ms** 仅占一部分。结论是下水位搜索与首次航行准备的组合成本，不能用全场 route 累计值解释这个尖峰。此捕获属于诊断，不作为候选优化收益。

## 已上线三场景的恢复证据

PR #373/#374/#375 已合并。首次组合上线出现实际产物模块初始化环，PR #376 拆出纯投影计算并增加实际打包检查，正式 `6ca7c373…` 已恢复启动。三张公网 GPU fenced 截图均实际审查：

| 场景 | 公网截图 |
|---|---|
| 海盗巨舰炮击/修船/接舷夺船 | [下载 fleet.png](media/fleet.png) |
| 王城慢镜头街景 | [下载 capital.png](media/capital.png) |
| 正规军对野怪大军 | [下载 woods.png](media/woods.png) |

公网恢复原检查 **59 项中 56 项通过，3 项失败保持 false**。这 3 项均是部署侧 `audio-packs/served.json`（41 B、默认 war3）与发布包占位配置（16 B）不同。源码明确支持服务器覆盖，但没有读取实际服务器路由配置，因此不能声称所有公网资源等于发布包。实际执行 JS/Stylesheet/models 均匹配；CSS 的精确 CDP 文本表示与独立正常 TLS 实体请求分别保留，独立请求不冒充原浏览器 wire bytes。没有启动异常、HTTP/网络失败或 WebGL 丢失。

恢复检查仅验证启动，不能代替完整动画相位/FPS/移动端/reduced-motion 验收。旧失败、旧构建和旧证据均未改写。最终本地包和正式 CI 包分别保留，不宣称两个独立构建二进制一致。

## 归档与复现

[manifest.json](manifest.json) 按 group 标明用途，原绝对路径以 base64 无损记录，所有 payload 均保存原始 bytes/SHA；顺序存储名避免将历史工具名称或源码字符串复制到当前规范正文。三张 PNG 另外保留原字节，便于下载。没有重新统计 payload 数作为测试数量。

```sh
python3 docs/performance/rules3-field-expansion/verify.py --out docs/performance/rules3-field-expansion --verify
python3 docs/performance/rules3-field-expansion/verify.py --out docs/performance/rules3-field-expansion --verify --extract /tmp/rules3-evidence
```

提取后的目录保留 `workspace/...` 原相对层级；读取各组 execution、predeclared、source/probe/tool identity 后，在对应代码版本安装依赖，使用记录的完整命令与相同 Node 24.19 环境复测。production CI 使用其自身 Node 20，不与本机计时混合。实测版本由独立 Git 分支保留；完整参数、native commands、原始样本、CPU profiles、字节 oracle、工具源码和阴性结果均在本归档。旧 PR #373/#374/#375/#376 的关闭归档仍独立保留。
