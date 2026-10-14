# 规则3：阶段2未采用候选与 Map 继续搜索改动

**Map 候选在固定原生场景中测得约1.12%的均值改善；整局目标仍失败。** Map 正式ABBA的whole mean **3.612503→3.572160 ms**，两个配对分别改善 **0.84746% / 1.38378%**；p99 **26.755995→26.624290 ms**变化很小，max反而 **81.005048→83.488184 ms**。全部五次均未达到 **p99≤16 ms、max≤50 ms**。本目录不是全游戏、全地图、最终胜负或浏览器FPS验收。

本目录独立新增于证据分支；已发布的[PR #378三处证据](../whole-game-rules3/README.zh.md)和[旧上线记录/凸包阴性实验](../rules3-followup/README.zh.md)保持原样。此目录记录候选及验证，不自行代表Map已合并或部署；其他阶段2候选均未采用。

## 场景、规则与版本归属

固定 `sapphireArchipelago` 六人局，一个空闲Grove人类席位、五个AI；每臂12分钟 / **14,400原生tick**，结束 `winner=null`。这是完整预定tick对照，不冒充原附件精确房间或胜利结局。whole是原生complete tick，模拟、AI及命令帧计入；渲染快照、observer和落盘另计。全部阶段仍 **rulesVersion3 / checksumVersion18**，不改AI思考相位、船只规则、命令校验频率或断言。

| 用途 | 固定源码 |
|---|---|
| v8唯一输入、wholes/Frontier/Map局部基线 | `e51e749d65b6642cb277d1a1ee83b0aefd662e00` |
| 阶段2/Map正式原生基线 | `49e07caa1657687247e6b58180c7b641911f6512` |
| 未采用：仅cached-wholes | `597d5ef09d2e826464c7d37698c6d4e49ade095c` |
| 未采用：cached-wholes＋Frontier winner缓存 | `d0009e5c1c63dfd58e38217c28b946cbf1882255` |
| Map正式候选与新增测试 | `31e4e8ba44c48efbbbf7ec3594c93e7537b6dba8` |

旧草稿、准备时`executed:false`、局部结果当时的未promotion标志都保持原字节；新执行、源码整合与采用状态另行说明。eef凸包、597/d000候选不属于Map源码。Map的完整Git diff有4文件（含2测试），原生241输入中的差异仅 `ship-navigation.ts` 与 `ship-planning-job.ts`。不能把旧局部e51结果换标签当31源码整局测量。

## Map正式五轮ABBA

串行 **A1→B1→B2→A2→Bplain**，A=49，B=31。无forcedGC、profiler或详细捕获插入正式计时，不删tick0、冷启动、离群点或尾部；最近秩分位为 `ceil(n×p)−1`。Bplain只核验普通钩子的命令透明性，**不合入性能池**；其AI/sim零值及空ownerPlans是关闭计时钩子，不是AI免费或没有规划。

| arm | whole mean ms | p99 ms | max ms | >50 ms |
|---|---:|---:|---:|---:|
| A1 |3.597125|26.704741|78.975041|9|
| B1 |3.566641|26.369136|83.488184|4|
| B2 |3.577680|26.754672|76.817127|5|
| A2 |3.627882|26.789370|81.005048|4|
| Bplain |3.561777|26.652246|87.060025|5|

A/B各28,800样本：mean改善 **1.116762%**，p99轻微下降，max变差；>16ms **1423→1386**、>50ms **13→9**。两个均值配对均正，12分钟块中9块whole均值更快，但不等于每个尾部更好或跨机器保证。最大值都在tick0，完整计入目标。

9972whole A **33.034/32.689→B25.523/24.354 ms**；13512 A **25.736/47.419→B26.861/25.447 ms**。5280仍为 A **58.288/68.572→B67.991/60.780 ms**。这些是原样测量值，不据其时间差推断GC或成本转移。每轮保留13次稀疏memory observation及起止值，观测RSS最大约0.949–0.980GB；不是持续peak、分配率、产品留存内存或泄漏结论。[统一重算结果](analysis.json)。

## 阶段2的两个完整阴性对照

第一组49/d000五臂的whole mean **3.553374→3.693769 ms**，p99 **26.214828→27.648911 ms**，max **91.782489→160.102637 ms**，两配对约退化3.91%/3.99%。原始样本全部保留；准备metadata活动与运行重叠，部分精确UTC未采集，因此**不冒充干净独占性能验收**。文件枚举总字节只是stat大小总和，不是读取同等内容。原并发审计和准备快照独立归档，不能用后续严格运行覆盖这次记录。

第二组严格六臂顺序 **A1 B1 C1 C2 B2 A2**：A49、B597、Cd000。根报告所有代理运行期间无工具动作，根仅约定的轻量clock/stdoutpoll/tail。三组各合并28,800样本：

| group | whole mean ms | p99 ms | max ms | >50 ms |
|---|---:|---:|---:|---:|
| A49 |3.566585|26.313815|82.339935|16|
| B597 |3.556217|26.537480|81.999100|16|
| Cd000 |3.565615|26.544782|87.365080|11|

B−A池化均值仅改善0.2907%，两个配对一退1.0743% / 一改善1.6551%；C−B池化退化0.2643%，两个配对一改善0.7288% / 一退1.2844%；C−A池化仅改善0.0272%，两个配对方向也相反。**没有稳定整局收益，三组全部目标失败，两候选均未采用。** 5280改善不能单独当整局改善，也不从6990差值直接宣称tiles成本转移。

该六臂首次派生JSON发生输出路径冲突：主分析1.057s结果被另一代理1.458s重算结果覆盖，后者另存`statistics-native-closure-agent.json`。原六臂raw及旧证据未改，数值方向一致。首次工具`cf75dc`的stdout与UTC留在会话，但首次JSON字节没有另存，**不伪造已恢复首次原件**。本归档的`analysis.json`是从原完整ticks重新计算的新结果，各执行身份分别保留。

## 唯一原生输入及局部证据

v8在固定e51完成唯一14,400tick捕获，9972同一次route调用的before **4,004** / after **3,092**有序active heap slots与20,208→23,330节点全部保存，包括duplicate/stale条目，没有重排、重push或去重。opaque traffic callback、原私有inactive容量历史、module cache、workspace及JIT/GC未恢复；**不是完整调用重放**。v8计时受捕获扰动，禁止混入正式收益。

cached-wholes局部证明4,264cases / 136,340public calls；522最终raw graph顶层私有runtime成员建立顺序不同，原ownKeys/hash保留，仅该顶层顺序规范化，嵌套数值/描述符/数组/Map/alias仍比较。24配对块每setup原trial全部保存：**none中位比率1.02931（回退2.93%，14/24未改善）**，已存groundWholes/shoreSpots的有利组不能掩盖它。普通不可变Terrain契约以外的任意getter或post-cache mutation不冒充等值证明。

Frontier有45合成fixtures / 336operations；真实slot局部证明 **7,096pops / 176,697events / 42,576完整buffer比较**。24微测配对块22更快、2更慢，严格分离16块；原private inactive尾部未捕获、push/pop交错及完整callback未重放。局部约3.74%配对中位收益不能变成整局结论。

Map V1 **真实运行exit1**：setup中的目录变量shadowing使`mkdirSync`收到function，抛`ERR_INVALID_ARG_TYPE`；没有进入候选正确性比较，micro未跑。V2独立目录仅修工具，V1原件、oracle、断言、候选与微测范围保持；proof **2.581s**、micro **42.084s**均exit0，2个实际before/after数据集＋23合成case。

V2局部构造＋恢复均值 **9.02758→4.59180 ms**，24配对块23更快、1更慢（最差 **+2.73092 ms**），严格分离20块。**恢复本身19/24块更慢**，均值0.58764→0.74688ms；setup/verification单列。仅Map构造片段及同源typed restore，不能据此证明const→let、WeakSet、wrappers、闭包、JIT或整条公开路线等值；真实调用集成另由测试及完整原生对照说明。

## 工程检查与所有失败

Map既有 **12文件 / 158项**通过，生产TypeScript、bundle和实际生产client bootstrap检查通过；该build发生在新增测试前，不称它包含后来3项测试。新增2文件3项测试：首次独立基线checkout缺`tools/resource-manifest`，Vitest **exit1 / 0测试**；只补tools后另attempt，baseline decoder1/1、candidate3/3通过，原失败保留。故意JSON `search.nodes=''`是decoder异常契约控制反例，不宣称合法原生保存器会生成它。

新增测试覆盖真实逐slice state/result、callback坐标顺序、记录引用、JSON未登记状态、fallback、重入及异常后scratch/depth恢复；另与同步route和逐段hull clearance对照。新增测试之后根独立tsc报告exit0；其stdout log为0B，**空日志不能独立证明成功**，退出状态归根实际工具回执。

SDK首轮 **13/14、docs ENOENT失败**保留；临时链接完整既有docs后 **4文件 / 14项通过**，29.62s。测试后移除该untracked链接、源码和HEAD不变，不降低断言。本目录落盘后的完整边界检查另在最终封存记录中记载，不给旧检查换标签。

## v9剩余尖峰诊断

v9完整14,400tick、源码241和命令完整字节另组保存，是诊断而非正式性能臂。tick0 profile出现 **−1µs timeDelta**，整个该窗拒绝duration归因；没有clamp、删除或排序。原初稿cell数字及清单身份说明错误保留，修正另件，原封闭报告/manifest不重写。

独立并发补证确认282ms分析脚本实际21:04:16.831725→17.114067，早于v9开始21:04:40.116672约23s；后续小reads/note的完整UTC未知，仍不能宣称整个诊断完全独占。本目录不从累积船路成本、CPU采样区间或memory下降给单个尖峰捏造原因。

## 无损归档与可复核范围

[manifest.json](manifest.json)封存全部原文件，原路径以Base64保留，逐份记录原bytes/SHA与外层gzip bytes/SHA。`payloads/idNNNN.bin.gz`只压缩原字节；原gzip也保留原压缩层。冻结源码副本、失败、准备false、actual执行、完整native输入和全部trial都包含，只排除依赖链接树，原路径记录在exclusions。原组及晚到的人读报告分别追加编号，不改旧载荷。最终数量、容量和具体校验身份见[闭环记录](verified-closure.json)。

从归档直接比较 **19份完整命令日志**（16正式臂＋v8＋旧B1参考＋v9），各 **618,189B / 14,400frames / 612非空frames**，SHA **`771222bde4c8d2c0a46a97313563ad2b5de1d52ed92fb2d3c70511ff2276c997`**，checksum **`7d94a5e8`**。19×241个完整原source inputs直接与各自固定Git blobs逐字节比对；`esbuildBytes`是变换后编译输入长度，不用它冒充原bytes。这是固定场景透明性，不是所有输入形式证明。

在仓库根目录：

```sh
python3 docs/performance/rules3-stage2-map/verify.py --out docs/performance/rules3-stage2-map --verify
python3 docs/performance/rules3-stage2-map/analyze-native.py --repo .
python3 docs/performance/rules3-stage2-map/verify.py --out docs/performance/rules3-stage2-map --verify --compare-originals
```

普通payload复核仅依赖归档；source闭环需相应Git对象，compare-originals另需原工作目录。解码器加`--extract /tmp/new-stage2-evidence`会先完整验证，仅写不存在的新目录，拒绝覆盖及路径穿越。此次读回按流校验，没有为证明解码额外复制144MB原件；安全路径拒绝行为另行记录。`analysis.json`重新执行只比较稳定结果，不覆写既有执行时间。所有后续grow候选属于新阶段，本包不扩入未执行代码。
