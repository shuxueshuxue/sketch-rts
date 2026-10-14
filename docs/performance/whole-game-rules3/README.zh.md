# 规则 3：三处整局性能改动与证据闭环

**三处候选改动的局部收益和本场景回放透明性已验证，但整局目标仍未达到。** 正式对照的整局 p99 从 **28.745→26.851 ms**，均值从 **3.74045→3.63866 ms**，最大 tick 却从 **92.766→115.397 ms**。要求的 **p99≤16 ms、max≤50 ms** 在五次运行中均失败；本报告不代表浏览器 FPS、所有地图或最终胜负验收。

## 场景、计时与代码身份

固定蓝色群岛 `sapphireArchipelago`、六人局、一个 Grove 人类席位保持空闲、五个 AI，原生模拟 **12 分钟 / 14,400 tick**。各次结束的 `winner` 均为 `null`，表示完整完成预定 tick 数，不表示打到胜利结局。当前没有原附件对应房间的精确配置，因此本场景不冒充该房间的复现。

计时的 whole 是原生 complete tick，含原有模拟、AI 与命令帧工作；另行记录的渲染快照、观察器和落盘不纳入 whole。这不是实际渲染帧时长。保留全部冷启动、尾部、样本和命令，没有强制 GC、剔除离群点、CPU profiler 或 detailed scopes 混入正式 ABBA。分位数使用最近秩 `ceil(n×p)−1`。[正式预声明](payloads/id0493.bin.gz)、[原始串行执行器](payloads/id0506.bin.gz)。

| 用途 | 固定代码版本 |
|---|---|
| 正式 A1/A2 主线参考 | `ce9cda65fca34f74586b43e07300f7cc4cc8284f` |
| 两槽导航缓存提交 | `6a868b1bc57696ff081f52fe54d8c7b63cec4ab3` |
| 加权小盒展开提交 | `a79f584fa890ee607025e88c988359fd2cf1cb68` |
| 正式 B1/B2/Bplain 三文件候选 | `8718b717dd8d31b57fcc6a24da89cecd724e295a` |
| 独立工作区等值整合及构建 | `e51e749d65b6642cb277d1a1ee83b0aefd662e00` |

[新建闭环复核](verified-closure.json)将五次实测归档中的 **241 个完整输入字节**直接与固定 Git blobs 比较：A1/A2 与 ce9 一致；B1/B2/Bplain 与 8718 一致；8718 与 e51 的 241 个输入逐项一致。A/B 只有 `src/shared/ship-navigation.ts`、`src/shared/terrain.ts`、`src/shared/decks.ts` 三文件不同。各臂的原始 source、probe 和实际 bundle SHA 也独立复核，不靠当前分支标签推断。

初次 [源准备记录](payloads/id0505.bin.gz)保留准备当时的 ce9 内容与失败状态；其中 whole-perf 的旧 SHA 不代表后来三文件改动后的代码。旧记录、工具源码、源 HEAD 和执行 metadata 的原字节均未修改。全部本阶段运行仍为 **rulesVersion 3 / checksumVersion 18**；守护卷轴规则 3、实际半径 180 已在主线，本次没有修改 AI 相位、规则、校验频率或断言。PR #373/#377 及之前的归档、分支与源码树均保持原样。

## 三处实际改动

- 导航 `moves` 原数组为每状态四槽，但代码只使用前进与后退两个槽；候选压为两槽并保留槽映射。真实重建 320×320 地图中的一个 grid 有 819,200 states，减少 **1,638,400 bytes**。这是该 grid 的数组容量差，不是全局 RSS 降幅。
- 加权 `growBoxInto` 按原方向顺序先保留四个直边通行位，再用于对角判定；即使邻点已不满足严格改善，边通行位也仍须保留。保持加权代价、严格比较、队列事件顺序与输出。
- `deckPlacement` 在一次同步调用内复用多边形投影阈值，并按原控制流延迟读取乘员。优选点的快速路径与公共 `deckPointFits` 保持原行为；乘员的实时属性仍在每候选点检查，结果不跨调用缓存。

## 正式整局 ABBA

同环境串行 **A1→B1→B2→A2→Bplain**，每次 14,400 tick。Bplain 用于观察钩子的命令透明性，不合并进入性能样本。

| arm | whole mean ms | whole p99 ms | whole max ms | >50 ms | sim mean ms | AI mean ms |
|---|---:|---:|---:|---:|---:|---:|
| A1 | 3.72137 | 28.22528 | 81.71102 | 6 | 2.77620 | 0.92563 |
| B1 | 3.66934 | 27.14999 | 81.06452 | 4 | 2.80865 | 0.84172 |
| B2 | 3.60798 | 26.50797 | 115.39718 | 8 | 2.76053 | 0.82909 |
| A2 | 3.75953 | 29.08794 | 92.76612 | 8 | 2.79908 | 0.94043 |

A/B 各合并 **28,800** 个样本：whole mean **3.740451900→3.638660367 ms（改善2.72137%）**；p99 **28.745034→26.851076 ms**；max **92.766118→115.397179 ms**；>16 ms **1543→1424**，>50 ms **14→12**。两个配对均值改善分别为 **1.39822% / 4.03109%**。这些是本轮固定场景的测量结果，不保证跨硬件或重复运行收益。[正式统计及所有臂结果](payloads/id0490.bin.gz)。

AI p99 **20.330358→18.342532 ms**；模拟 p99 **18.718695→19.091702 ms**，略有退化。非规划 whole p99 **18.492332→18.699417 ms** 也略退。均值和部分尾部改善不等于所有尾部改善；候选最大的 115.397 ms 样本完整保留，未删冷帧或把归因诊断当验收。

Bplain whole mean/p99/max 为 **3.559279/26.590058/91.939208 ms**，同样未达目标。五次正式运行的完整原生命令直接逐字节比较，另与 reference、CPU 窗口、v6 边界、v7 捕获及早期两文件探索共 **10 份**记录比对，均为 **618,189 bytes / 14,400 frames / 612 非空帧**。SHA256 `771222bde4c8d2c0a46a97313563ad2b5de1d52ed92fb2d3c70511ff2276c997`，final checksum **`7d94a5e8`**。正式四个计时臂的逐 tick 数量、索引、mod15、规划 owner 顺序均一致。比较完整 bytes，不只比较 SHA；这属于本场景透明性验证，不是所有输入的形式证明。[原执行闭环](payloads/id0491.bin.gz)、[独立复核](verified-closure.json)。

原 RSS、heap、external 与 arrayBuffers 的起止和稀疏观察全部留存；它们不提供连续峰值、分配率、留存内存或泄漏证明。不能将两槽数组的局部容量减少转述为产品总内存的已证实下降。

## 局部精确性和真实输入微对照

| 项目 | 完成证据 | 结论与范围 |
|---|---|---|
| 导航两槽 | 202 成功用例、19,696,000 累计 states、470,535 完整事件；既有选中 7 文件 42 项通过、24 项跳过 | 合成及实际模块精确校验。14 个真实地形 route 用例全为零搜索事件、全零 moves，只覆盖真实 grid 分配，不证明实际首航搜索。 |
| 加权小盒 | 819 操作 / 808 字段；既有 47 项通过 | 字段、严格改善、队列事件与缓存等值，阴性结果保留。 |
| 甲板 | 498 边界用例；既有完整文件 58 项通过 | 公共/优选路径、浮点边界、占用与延迟乘员检查等值；合成速度探针单列。 |

导航首次 201 用例的覆盖不足失败与修正后成功均保留。历史重复 score 计数不等于同时驻留 heap 的 tie；14 个零搜索真实地形用例不补成非零实际首航证明。局部证明按各自原执行记录中的源码与工具 SHA 归属；导航证明加载冻结的 ce9 terrain，不能冒充三文件整合候选对所有输入的证明。[导航完整结果](payloads/id0178.bin.gz)、[加权精确结果](payloads/id0251.bin.gz)、[甲板证明索引](payloads/id0264.bin.gz)。

甲板从 v7 捕获的 **35 次真实调用**按原顺序重建，冷/准备两种状态共 **70 次精确比较**通过；正式 **96 个 ordered 35-call sequences、24 配对区块**全部保留。局部序列均值 **21.865173→7.038297 ms（改善67.810466%）**，24/24 区块为正。输入准备约35 ms、序列后验证约97 ms另计；未重建原 tick 的 JIT/GC、预约、堆或 CPU cache 历史，不能把67.81%用于整局。[真实甲板结果](payloads/id0297.bin.gz)。

加权小盒从真实 5280 规划工作重建 **3,488 字段 / 5,513,298 事件**，每模块两次检查 **348,800 cells**；实际模块的完整字段与 trace 均逐项相同。24 配对 whole-map 冷暖区块的中位改善 **0.820560 ms（约2.63%）**，**8 区块更慢**，warm 查询未见收益。原规划辅助缓存与历史未恢复，重复和检查影响后续堆/缓存条件；不是原规划或整局的直接收益。[真实加权结果](payloads/id0321.bin.gz)。

## 失败、污染与未采用方向

- 最初错误工作目录的构建没有产生任何 native tick；原 [首次失败日志](payloads/id0494.bin.gz)和 [CPU 窗口启动失败日志](payloads/id0496.bin.gz)保留，后续成功结果另存，不重写失败文件。
- v6 早期与 32 项测试重叠，全体标为受污染的归因运行，不能作为性能验收。晚期 CPU 窗口出现 **−53 µs timeDelta**，该窗全部原始样本保留；没有 clamp、排序或删除，也不给该61 tick窗 CPU duration 归因。函数边界 wall 与有效窗证据分别保留，不从全场船路累计时间推断单个尖峰的原因。[v6 说明](payloads/id0047.bin.gz)、[原执行与并发记录](payloads/id0080.bin.gz)。
- 早期两文件单次14,400 tick探索 p99 **28.546 ms**、>50 ms **15**，没有伪装成正式多臂结果。
- 掩码方案已关闭、未集成：687 操作与12真实字段精确性通过，但冷 **23.8554→27.0961 ms**、warm 含setup **23.6078→27.3944 ms**，增加 **103,684 bytes/runtime**。准备时 `executed:false` 与之后的 execution/results 都按原字节保存；准备状态不取消后来的真实执行。[掩码阴性报告](payloads/id0336.bin.gz)、[其关闭记录](payloads/id0342.bin.gz)。
- 导航循环候选只保留静态准备与反例，状态仍 **UNRUN**，实际非零输入不足，无收益结论、无源代码集成。另行排序实验不属于8718三文件候选，也不在本归档。[导航未执行状态](payloads/id0409.bin.gz)。

## 工程验证

独立 e51 工作区的严格 TypeScript、生产构建和实际 bundle 启动检查通过。收档前，完整8718源码与历史 docs 上的 SDK/生产依赖边界 **4 文件 / 14 项**通过（7项包边界、5项生产打包、2项驱动/规划边界）。此日志是收档前结果；本报告不把它冒充新docs落盘之后的检查。[原生产构建日志](payloads/id0503.bin.gz)、[收档前完整边界日志](payloads/id0504.bin.gz)。

此目录仅归档证据与复核工具，不代表已经合并、部署或全部性能目标通过。

## 归档清单与安全提取

[manifest.json](manifest.json)封存 **506 份原始文件**，原始总计 **228,582,533 bytes**，存储总计 **36,466,073 bytes**。每份记录原 absolute path 的 Base64、原 bytes/SHA256、存储 bytes/SHA256 与 group；`payloads/idNNNN.bin.gz` 只压缩原字节，不改内部代码身份或历史文件内容。下面链接下载的是外层gzip，原本gzip文件仍保留其原始压缩字节；使用解码器可恢复原层级。

| group | 用途 | 原始文件数 | payload 范围 |
|---|---|---:|---|
| `ce9-reference` | 主线完整整局参考 | 11 | id0001.bin.gz—id0011.bin.gz |
| `ce9-cpu-windows` | 预选窗口CPU诊断及全部原始时钟 | 25 | id0012.bin.gz—id0036.bin.gz |
| `followup-plan` | 以已有数据预选后续观察窗口 | 6 | id0037.bin.gz—id0042.bin.gz |
| `diagnostics-v5` | 正式整局工具原始源码 | 3 | id0043.bin.gz—id0045.bin.gz |
| `diagnostics-v6` | 边界诊断工具、并发元数据、错误窗口与修正分析 | 40 | id0046.bin.gz—id0085.bin.gz |
| `ce9-boundaries-v6` | 边界诊断完整整局原始结果 | 19 | id0086.bin.gz—id0104.bin.gz |
| `diagnostics-v7` | 无损参数捕获工具原始源码与执行记录 | 11 | id0105.bin.gz—id0115.bin.gz |
| `ce9-inputs-v7` | 实际快照、无损图与甲板调用输入 | 14 | id0116.bin.gz—id0129.bin.gz |
| `moves-proof` | 导航两个槽位的失败首轮与成功精确性验证 | 110 | id0130.bin.gz—id0239.bin.gz |
| `launch-review` | 真实下水机会复核 | 4 | id0240.bin.gz—id0243.bin.gz |
| `weighted-proof` | 加权字段算法等值证明与既有测试 | 17 | id0244.bin.gz—id0260.bin.gz |
| `deck-proof` | 甲板调用边界等值证明、既有测试及合成探针 | 20 | id0261.bin.gz—id0280.bin.gz |
| `deck-native-micro` | 甲板真实参数精确比较与序列微对照 | 17 | id0281.bin.gz—id0297.bin.gz |
| `weighted-native-micro` | 加权字段真实参数、冷暖对照与阴性区块 | 24 | id0298.bin.gz—id0321.bin.gz |
| `weighted-moves-exploration` | 早期两文件单次整局探索 | 11 | id0322.bin.gz—id0332.bin.gz |
| `sim-review` | 重复与混合计划复核 | 2 | id0333.bin.gz—id0334.bin.gz |
| `mask-rejected` | 已否决掩码方案的完整输入、字节校验、结果与关闭说明 | 67 | id0335.bin.gz—id0401.bin.gz |
| `nav-unrun` | 尚未执行的导航候选及反例；未纳入候选代码 | 13 | id0402.bin.gz—id0414.bin.gz |
| `abba` | 正式五次整局、完整原生命令、输入源码与阴性尾部 | 79 | id0415.bin.gz—id0493.bin.gz |
| `failed-baseline` | 首次错误工作目录的空输出目录 | 0 | 无文件；首次运行未产生 tick |
| `root-log-01` | 原始执行或失败日志；版本身份以原字节为准 | 1 | id0494.bin.gz—id0494.bin.gz |
| `root-log-02` | 原始执行或失败日志；版本身份以原字节为准 | 1 | id0495.bin.gz—id0495.bin.gz |
| `root-log-03` | 原始执行或失败日志；版本身份以原字节为准 | 1 | id0496.bin.gz—id0496.bin.gz |
| `root-log-04` | 原始执行或失败日志；版本身份以原字节为准 | 1 | id0497.bin.gz—id0497.bin.gz |
| `root-log-05` | 原始执行或失败日志；版本身份以原字节为准 | 1 | id0498.bin.gz—id0498.bin.gz |
| `root-log-06` | 原始执行或失败日志；版本身份以原字节为准 | 1 | id0499.bin.gz—id0499.bin.gz |
| `root-log-07` | 原始执行或失败日志；版本身份以原字节为准 | 1 | id0500.bin.gz—id0500.bin.gz |
| `root-log-08` | 原始执行或失败日志；版本身份以原字节为准 | 1 | id0501.bin.gz—id0501.bin.gz |
| `root-log-09` | 原始执行或失败日志；版本身份以原字节为准 | 1 | id0502.bin.gz—id0502.bin.gz |
| `root-log-10` | 原始执行或失败日志；版本身份以原字节为准 | 1 | id0503.bin.gz—id0503.bin.gz |
| `root-log-11` | 原始执行或失败日志；版本身份以原字节为准 | 1 | id0504.bin.gz—id0504.bin.gz |
| `source-preparation` | 初次源代码准备记录；状态与身份保留原值 | 1 | id0505.bin.gz—id0505.bin.gz |
| `abba-wrapper` | 正式整局串行执行器原始源码 | 1 | id0506.bin.gz—id0506.bin.gz |

实际排除三处依赖链接树（basename Base64 **`bm9kZV9tb2R1bGVz`**）；这些不属于证据原件。一般目录排除策略也包含 Base64 **`Z2VuZXJhdGVkX21vZHVsZXM=`**、**`YXJ0aWZhY3RfZGlzdA==`**、**`LmdpdA==`**，本次没有相应目录。仅另外排除已保留原文件的重复容器，basename Base64 **`d2hvbGUtZmllbGQtbWFzay1wcm9vZi50YXIuZ3o=`**，原 **5,425,947 bytes / SHA256 `b0710482b813e88b4a21dc35daace4ea31c9e38370b7930796a9156099c1e06e`**。其66份原始证据与后续归档说明逐文件保留。每个确切排除路径在manifest的 `exclusions[].originalPathBase64` 中无损列出，没有递归打包依赖或重复大型产物。

```sh
python3 docs/performance/whole-game-rules3/verify.py --out docs/performance/whole-game-rules3 --verify
python3 docs/performance/whole-game-rules3/verify.py --out docs/performance/whole-game-rules3 --verify --compare-originals
python3 docs/performance/whole-game-rules3/verify.py --out docs/performance/whole-game-rules3 --verify --extract /tmp/whole-game-rules3-evidence
python3 docs/performance/whole-game-rules3/verify.py --out docs/performance/whole-game-rules3 --review-closure --repo /workspace/sketch-rts-production-init-fix --isolated /workspace/sketch-rts-whole-perf
```

`--verify` 流式核对存储与解压后的每份 bytes/SHA及完整文件清单；`--compare-originals`还读取原始目录核对，需原文件仍可访问。`--extract`先完整校验，再仅写入一个**不存在的新目录**，拒绝已有目录、路径穿越与覆盖原文件；提取后的 `workspace/...` 保留原绝对路径的相对层级。新闭环复核读取归档里的完整命令与源码，并与固定 Git blobs 比较；提交对象需仍可访问。复测时先读对应 predeclaration/execution/environment，使用固定版本和已记录完整命令，在新的输出目录执行。没有用新文件标签替旧运行改身份。
