# 中立营路线实验 #569：不合并（2026-10-20）

代码冻结为 `1eb11ede5991857aef6d786cb0f5081179b64d40`，对照 `bc33a34a0695181a271649ae42a29ec6dba79837`。两组同一份 11 图配置、默认地图布局、15 tick 思考间隔、3 tick 交付延迟，全部跑满 18000 tick；逐席位死亡与原生统计一致，账本观测错误为 0。不运行胜率 bench。

**整体失败并搁置。** 非清营野怪死亡少 11 次、1950 金，但战损多 18 次、3765 金，存疑成本增加 560 金、未知成本增加 245 金；总死亡 343→351，总目录价 34615→37235（净增 2620）。扩张和夺岛存在明显退步；旧版“出击”代理混入了清营，不能据此声称对敌出击晚了 354 秒。不能用异常数下降或重派归零声称改善。

## 账本 v2 同口径对照

原 73 条异常队列修正为 50，另有双岸 tick 9789 的零价召唤物清 A 营却死于 B 营，完整基线为 51；沿用 death-ledger 文档已解释的口径，不把归因修正计作本实验收益。

| 分类 | main 次数/目录金 | 候选次数/目录金 | 数量/金额差 |
| --- | --- | --- | --- |
| 战损 | 185/18965 | 203/22730 | +18/+3765 |
| 存疑 | 76/7360 | 81/7920 | +5/+560 |
| 异常 | 51/5295 | 40/3345 | -11/-1950 |
| 未知 | 31/2995 | 27/3240 | -4/+245 |

候选 40 次异常的主分类全部是 `neutral-outside-clearing`。各图、各席位和所有矿厅完工事件见原始 `analysis/comparison.json`；以下列 p0，tick ÷ 20 为秒。`—` 表示 18000 内未发生。

## 逐图目标时间（原代理，已作废）

“首次扩张/夺岛”取原生矿厅完工，夺岛要求陆块与初始基地不同。“首次对敌命令”沿用冻结驱动口径：直接 attack 指向敌军，或 attackMove 指向敌建筑 650 范围内；它包括局部接敌，不能冒称正式战略目标已接纳。所有席位的数值和原命令均保留在证据包。

| 地图（p0） | 首次扩张 main→候选 | 首次夺岛 main→候选 | 旧650范围代理 main→候选 |
| --- | --- | --- | --- |
| brokenSea | —→16850 | —→16850 | 9588→16668 |
| greystonePass | 3766→3766 | —→— | 6993→7593 |
| gullIsland | 3620→3620 | —→14148 | 5403→5403 |
| pineshade | 5101→5088 | —→— | 10293→8043 |
| reedwater | 4423→4423 | —→— | 9873→9843 |
| ringwater | 4917→4917 | —→— | 11733→10413 |
| sapphireArchipelago | 16657→16119 | 16657→16119 | —→— |
| templeSpring | 3890→3890 | —→— | 8163→10488 |
| turtleLake | 5248→5248 | —→— | 7668→7683 |
| twoShores | 5074→5139 | —→15660 | 7338→7998 |
| veiledHill | 5832→6689 | —→— | 14358→15978 |

碎海的旧代理 9588→16668 相差 7080 tick，即 354 秒。9588 实际是清营命令：目标为 0 号营中心，距敌营房约 571；这只是命中了旧650范围规则。16668 也不能未经任务核对就称为第一次对敌出击。后续分别记录夺岛清营开始/完成、对敌出击及矿厅完工，不能把这列沿用为出击指标。

独立真实快照 `summoner-safe-hold-9m10`：main 第四矿 14138 完工，候选到 15000 仍未完工；首次进攻任务 13147→13657。死亡 10→10、目录价 745→355。`expansion-natural-3m45`：第三矿 9251→9062，但死亡 3→6、目录价 385→710。局部进度收益同样不足以通过验收。

## 死亡双向翻转

只把 **原生 ID、owner、kind、出生 tick 全部相同** 的单位视为可比身份。双方共有 62 个可比阵亡身份，281 个 main 阵亡和 289 个候选阵亡没有相同出生身份，不把它们叫作“救活/新增战损”的个体因果。全部 51 个原野怪异常的身份状态另存 `baselineNeutralOutcomes`。下表列全量 24 次主分类变化，原诊断标签及交战证据保留在各组 deaths 文件。

| 地图/单位 | main→候选 死亡 tick | 主分类 main→候选 | 目录金 |
| --- | --- | --- | --- |
| brokenSea / `unit-p3-worker-1` | 11426→17341 | 未知/unattributed → 战损/combat-loss | 75 |
| gullIsland / `unit-p0-emberRavager-1044` | 14427→14103 | 战损/combat-loss → 未知/unattributed | 120 |
| gullIsland / `unit-p0-emberRavager-1037` | 6015→13820 | 异常/neutral-outside-clearing → 未知/unattributed | 120 |
| gullIsland / `unit-p1-footman-1046` | 10344→10155 | 异常/neutral-outside-clearing → 存疑/recent-reassignment | 100 |
| gullIsland / `unit-p1-footman-1062` | 10887→6836 | 存疑/recent-reassignment → 战损/combat-loss | 100 |
| pineshade / `unit-p1-archer-1076` | 10600→9035 | 异常/neutral-outside-clearing → 战损/combat-loss | 115 |
| pineshade / `unit-p0-emberRavager-1045` | 13280→11391 | 战损/combat-loss → 异常/neutral-outside-clearing | 120 |
| pineshade / `unit-p0-emberRavager-1038` | 11043→14165 | 战损/combat-loss → 未知/unattributed | 120 |
| pineshade / `unit-p1-footman-1046` | 10491→6896 | 未知/unattributed → 战损/combat-loss | 100 |
| pineshade / `unit-p1-archer-1051` | 13991→11159 | 存疑/recent-reassignment → 战损/combat-loss | 115 |
| pineshade / `unit-p1-footman-1061` | 10635→9116 | 异常/neutral-outside-clearing → 存疑/out-of-bounds | 100 |
| pineshade / `unit-p0-emberRavager-1078` | 10952→11674 | 战损/combat-loss → 存疑/post-worn-abandonment | 120 |
| reedwater / `unit-p0-emberRavager-1555` | 10147→13208 | 未知/unattributed → 战损/combat-loss | 120 |
| reedwater / `unit-p0-emberRavager-1558` | 9274→13437 | 异常/neutral-outside-clearing → 战损/combat-loss | 120 |
| reedwater / `unit-p1-footman-1060` | 15293→10318 | 存疑/recent-reassignment → 异常/neutral-outside-clearing | 100 |
| reedwater / `unit-p0-emberRavager-1037` | 10344→9074 | 战损/combat-loss → 未知/unattributed | 120 |
| reedwater / `unit-p0-emberRavager-1043` | 12708→9434 | 存疑/recent-reassignment → 未知/unattributed | 120 |
| ringwater / `unit-p2-footman-1085` | 12306→17726 | 战损/combat-loss → 存疑/recent-reassignment | 100 |
| sapphireArchipelago / `unit-p1-worker-3` | 17242→16852 | 存疑/recent-reassignment → 战损/combat-loss | 75 |
| turtleLake / `unit-p2-footman-1139` | 14632→15093 | 存疑/recent-reassignment → 战损/combat-loss | 100 |
| turtleLake / `unit-p2-worker-1316` | 12431→10383 | 存疑/recent-reassignment → 战损/combat-loss | 75 |
| turtleLake / `unit-p2-footman-1085` | 11512→16044 | 战损/combat-loss → 存疑/recent-reassignment | 100 |
| turtleLake / `unit-p0-emberRavager-1096` | 10528→16366 | 战损/combat-loss → 存疑/recent-reassignment | 120 |
| twoShores / `unit-p3-archer-1101` | 7493→14476 | 异常/neutral-outside-clearing → 未知/unattributed | 115 |

这些是分叉对局中同一出生单位最终死亡情境的变化，不能将它们称为离线分类器修正。既有战损转异常、存疑及未知，也有相反变化；整体金额增加已在总表揭示，不将异常减少解释为纯收益。

## 重派、续行与验证范围

按同一工人、同类建筑、同一点，被 miningJobSafety 下令撤离/换矿后 120 tick 内重发 build 的冻结口径：main **57**，候选 **0**。逐图 main→候选：蓝宝 39→0、芦水 12→0、雾丘 4→0、鸥岛 1→0、龟湖 1→0，其余六图 0→0。主对照 11 段重复循环、47 次循环内重派；不能因为父行动没完成却不重派就宣称经济更好。

救命中断保留 9 次；绕路准入 12 次，实际观察到续行 **11 次**，其中之后在本局死亡 **0 次**；前置集结续行 0 次。准入与实际执行分列，不把下令当作已到岗。没有原有 57 次重派与这 11 次续行的一对一因果对应，原事件都在 retries.json / navigation-events.jsonl.gz。

根目录 `npx tsc --noEmit -p .` 通过。A100 冻结 head 的完整 `vitest run --dir src --maxWorkers 8 --minWorkers 8` 为 7859 通过、6 失败，另 1 个文件收集失败。5 条语义回退如下，原断言未改：

- attack-objective.scene：行军兵力 12.369 不大于防守预算 14.8。
- expansion-garrison.scene：避敌事件 6705→6765。
- expansion-mission：第三矿 7995，超出原断言 7800。
- island-conquest.scene：已交付但未物理建成矿厅。
- territory-pressure.scene：未形成原断言要求的前压据点。

另两项是 A100 副本缺少 timeline-model.js 导致 12 项未收集，以及 think-worker 30 秒启动超时；同一 head 本机单跑这两文件 16/16 通过。它们不抵消上述 5 条语义失败。新增真实帧及续行/序列化测试的单独 20 项通过。运行时尚未覆盖“相同外部改令已接收、尚未交给 think 时做 checkpoint”的窗口；不把 memory 分叉测试扩大宣称为该窗口也已通过。

## 搁置边界

保留分支与数据，不合入战斗部队/集结点绕营计价、挡路/旁路营分类、清营借兵。后续工人共享威胁判定及救命中断从当时最新 main 独立实现；本实验的组合数据不能充当拆分后版本的验收。原 5 条行为断言仍是门槛。

## 碎海的中间因果与干预帧

1. **前端改变了未受袭派工。** 全局首个命令分歧为 tick 7293：p1 的 `unit-p1-worker-1` 原为满血 idle，实验的通用 station 扫描给它新增80距离的避险移动。7458，main 为它下 `(3344,4176)` 建矿单；实验改成向当前位置的 move，此后逐 think 重复。这里没有“正在执行建造被 safety 打断”的事实，属于本次搁置的提前改写。
2. **原有海军与经济目标随世界状态分叉。** main 建起 p1 殖民地；候选没有。7920 前 p0 的 `naval.assault.plan.targetId` 在 main 为 `building-p1-townHall-1449`，候选为 `building-p1-shipyard-1020`，island plans 也不同。7612 的 p2 买船、7920 的 p0 建 farm、9585 的 p0 清营指令，分别做“main代码/候选代码 × main状态/候选状态”交叉核对，共12次：输出跟随状态，不跟随这三帧的代码版本。不能把这些后续差异误当成当帧战斗改令的直接效果。
3. **顺路接战消失，几何前置变得不可行。** main 的 p0-worker-1 在执行 `(3152,3632)` 建矿时，9288/9326 拉动 `guard-7-0/1`；9393 第一帧观察到其血量下降，五名既有 ravager 正在攻击，9461 `guard-7-0` 已消失。候选同一工人9585仍 idle，7号营到10500没有一次激活。main 中这次顺路接敌清开了0号营的接近路。
4. **最终阻断是路线/集结几何，原因标签却写成缺兵。** 9585 候选六名兵的 camp-force=5.6768，所需=3.4477，仍在 `assemble / await-clearing-force`。保持候选全 snapshot/memory不变，只把7号营替换为main同帧状态（移除已死7-0、7-1移到其main位置），立即生成六人向 `(4299.97,4377.51)` 的 move，任务进入 `clear/gather`。这锁住了近端因果：有兵，但其他营挡住了可用接近几何。完整分叉链不应简化成“清营借兵不足”，也不能把354秒代理差全归于某一次决定。

原始帧与12次交叉核对位于 `analysis/frames/`、`analysis/brokenSea-chain.json`、`analysis/brokenSea-counterfactual.json`、`analysis/brokenSea-camp7-fork.json`、`analysis/camp7-main.json`。帧替换是因果诊断，不冒充真实对局截图。

**拆分边界：** 新版只在实际命令被 safety 的已接受撤离命令打断后保留空缺、规划安全续行。原始 idle 站位、新工单、经济派工均保持 main。碎海7293与7458加入逐字节回归；即使不再提前改派工，续行也可能改变后续路线，仍须重新跑完整11图，不能承诺原有顺路接战必然相同。

## 同机 ABBA（纯 planner）

A100 / Node v22.23.3；固定 main 的真实15分钟完整帧，逐席位执行；每臂热身80轮、采样240轮，每轮重置原memory，不强制GC。四臂 A/B/B/A，A=bc33a34a，B=1eb11ede。纯planner在账本/trace投影前单独截时，合并A1+A2与B1+B2样本；接触几何查询另列。原始“planner+账本/trace”首轮保留在 `abba/`，没有拿它冒充下表。

| 地图 | A p95/max ms | B p95/max ms | p95/max比率 | B接触查询p95均值 ms |
| --- | --- | --- | --- | --- |
| sapphireArchipelago | 26.203/33.469 | 30.816/43.250 | 117.60%/129.22% | 0.0770 |
| twoShores | 38.041/55.058 | 39.971/58.662 | 105.08%/106.54% | 0.0241 |
| veiledHill | 22.006/45.032 | 26.068/51.892 | 118.46%/115.23% | 0.0400 |

雾丘和蓝宝不满足p95/max≤110%，性能验收失败。静态帧前后模拟checksum一致；B1/B2命令/记忆摘要一致，未把A/B的行为差异说成只读同流。

## 修正口径的分列指标（22组同流观测）

新观测重复运行同一22组配置，planned/实际命令、末态snapshot/memory/canonical五项SHA及最终checksum全部与原始运行一致。另从原initial+实际命令逐tick原生回放22组，不运行AI；所有最终snapshot/canonical/checksum也完全一致。自动接营从原生attack订单读取，不会漏掉没有显式attackMove的接敌。

- **夺岛目标营接敌/清空**：按现有neutralCamps与目标矿守营关联；我方非工人单位首次原生attack目标营成员为接敌，实际成员全部hp≤0或消失为清空。完成只统计本方有接敌记录的任务；由其他席位清空、我方未接敌的效果另外保留，不冒称我方清营。
- **对敌出击**：既有general进攻状态且非gather时的攻击命令、明确以敌建筑为目标的命令，或实际载员进攻航次的航渡命令；显式夺岛清营命令排除。不再使用附近650有敌建筑的规则。旧模块尚无正式分配器，这个状态归属仍是推断，原生指令和筛选源码可复核。
- **扩张**：新矿厅实际完工tick。—表示18000内本口径没有观测到，不推断从未发生任何战斗。

| 地图（p0） | 首次扩张 main→候选 | 夺岛目标营接敌 main→候选 | 我方参与的目标营清空 main→候选 | 首次对敌出击 main→候选 |
| --- | --- | --- | --- | --- |
| brokenSea | —→16850 | 9741→12655 | 9793→15817 | —→— |
| greystonePass | 3766→3766 | —→— | —→— | 6993→7398 |
| gullIsland | 3620→3620 | 14019→13692 | 17109→17222 | 5403→5403 |
| pineshade | 5101→5088 | —→— | —→— | 10533→8043 |
| reedwater | 4423→4423 | —→— | —→— | 9798→9843 |
| ringwater | 4917→4917 | —→— | —→— | 11733→10413 |
| sapphireArchipelago | 16657→16119 | 15458→14921 | 15660→15040 | —→— |
| templeSpring | 3890→3890 | —→— | —→— | 8163→10488 |
| turtleLake | 5248→5248 | —→— | —→— | 7668→7683 |
| twoShores | 5074→5139 | 17601→— | 17865→— | 7338→7878 |
| veiledHill | 5832→6689 | —→— | —→— | 7773→8253 |

碎海在修正口径下，p0目标营接敌 **9741→12655（+145.7秒）**、清空 **9793→15817（+301.2秒）**。双方15分钟内均没有本口径的对敌出击记录。夺岛清营确有退步，但354秒旧代理不能再写成对敌出击延误。

## 原始证据包

[完整证据指针](death-ledger-routes.evidence.json)对应 A100 内容寻址包，SHA-256 `0d1e7d4c7a57ac831793147a7daa5477e4d852181b1743b2f9d64f28159a67f6`，309,879,222 字节。用 `bin/sketch evidence get docs/ai/objectives/death-ledger-routes.evidence.json` 取回；内含同配置11图的原始对照与候选、修正指标的22组同流观测及22组原生命令回放、逐条双向翻转、因果干预帧、两轮ABBA和完整测试日志。代码来源为上述冻结SHA，文档补录不改变模拟结果。

### 可复用的观测入口

`npx tsx scripts/ai-objective-metrics.ts <不可变源码目录> <case.json> <输出目录> observe` 重新运行同一配置，仅观测 `objectiveMilestones` 的扩张、显式夺岛清营、对敌出击分列；同时输出五项SHA、账本及最终checksum。此脚本的阶段归属来自现有任务记忆，明确标记 inferred，计时不用于上文纯planner ABBA。`case.json` 使用 `AiGameRunInput`，含 `source`、`thinkInterval` 和 `maxTicks`。原生自动索敌可能没有显式清营命令，因此清营的最终两列以如下回放为准。

`npx tsx scripts/ai-objective-clearing-replay.ts <不可变源码目录> <原导出目录> <输出.json>` 读取原始 `initial.json / summary.json / commands.jsonl.gz / traces.jsonl.gz`，逐tick执行保存的命令，不运行AI。它记录目标营原生接敌/清空和其他参与席位，只有本方接敌过才计入本方清空；最终snapshot/canonical/checksum有一项不一致即失败退出。组合观测的 `firstExpansion / firstEnemySortie` 与回放的 `firstIslandClearAttackOrder / firstIslandClearComplete`，不再输出旧650范围“出击”代理。
