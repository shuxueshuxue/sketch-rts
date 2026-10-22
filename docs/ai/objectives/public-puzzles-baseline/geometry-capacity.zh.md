# 几何缓存：测量与默认容量的原帧对拍

**缓存对拍通过。** 11份原冷帧各运行20次原生think；11个根建址结果第一次ready后，在目标保持有效期间一直保留到think20，readyThink和work均未重置。默认轮无pressure、无overflow。
默认轮与测量轮的完整规划输出220/220逐字节一致。**公开题计划仍通过0、错误已选链0、缺能力11**，首次可执行计划均未出现；缓存保持性通过不等于题目通过。

## 两轮来源与边界

| 轮次 | 固定共享基底 | 实际运行题库源码 | 参数 |
| --- | --- | --- | --- |
| 测量 | `a5764f9646691f945f30748be40407612296dc3a` | `b6cb3d854ed4395b5cac93bd2f01aeb59a74bee0` | 显式`geometryMeasurement:true`，只放开几何缓存逐出容量 |
| 默认 | `5ca744cf8fc1e385c7d3a1db5965918266253e1d` | `e10e1317a64bdaa1a392624644c73e5aebae03d5` | 未传测量参数；正式默认33776字节、38项 |

测量源码归档在`archive/public-puzzles-measurement-a576-source-20261021`，默认源码归档在`archive/public-puzzles-default-5ca-source-20261021`。
5ca是a576上的容量外壳记账修正、按实测校准限值及SDK测试命名修复；这次不接后续安全/战斗装配或执行桥，避免混入其他行为变化。
11份快照在开跑前与每次记录后，都与[a0db原片](frozen-thinks-a0db.zh.md)的JSON字节核对；两轮之间也再次核对，全部相同。

两轮均在A100、Node24.22.0、`v9_knight`运行。每帧使用同一个snapshot对象、同一个owner memory，物理tick不变；每次think完整完成、序号1…20，每次工作量不超过6144。
使用正常Objective collector、真实Situation/query和唯一FactWorkQueue。记录器不请求额外建址或几何计算，严格导航审计无异常。

## 容量依据

按同版`observationJsonBytes`计算真实`{version,entries}`有效载荷，不把容量诊断头混入该限值。a576原生计数只包含entries数组，少计24字节外壳；下表两轮统一按含外壳口径重算。

| 题与变体 | pinned峰值/字节 | pinned项数峰值 | think结束时resident峰值/字节 |
| --- | ---: | ---: | ---: |
| 船在别处：远船 | 9665 | 10 | 25761 |
| 船在别处：近船 | 9665 | 10 | 25761 |
| 人口：农场→骑士 | 12287 | 9 | 12287 |
| 人口：已有兵营 | 13070 | 9 | 13070 |
| 从零造海军 | 9665 | 10 | 9665 |
| 守家：约90秒遇袭 | 9729 | 10 | 19792 |
| 守家：约360秒遇袭 | 9729 | 10 | 17906 |
| 滩头：八步兵 | 9729 | 10 | 23497 |
| 滩头：三步兵 | 9729 | 10 | 23497 |
| 穷矿强营 | **16888** | **19** | **29467** |
| 守不住撤离 | 26 | 0 | 18608 |

实测pinned峰值16888字节、19项；默认取两倍，即**33776字节、38项**。空pinned集合仍有26字节的JSON外壳，不表示撤离题有pin。
两轮结束时resident最大28项；原生记录的过程中resident瞬时峰值为29514字节，与表内结束时峰值29467字节分开报告。
默认轮220次容量诊断均为bounded/33776/38，pressure为空，累计overflow为0；容量诊断头另在机器记录中量出。

## 根结果保持与逐次等值

根请求从a0db第1次**正常目标**的deferred依赖及原几何requestId推导，按原始key＋revision匹配；没有另做诊断查询或按题号指定可建点。
10帧有根建址，其中穷矿题有两个，共11个；撤离题没有这类根，不能补一个凑数。11个根都在think1计算ready，后续发布规则仍照原生think边界执行。
两轮中，从该次ready直到think20，目标持续有效时，条目始终存在且ready，readyThink一直为1，累计work不增加。
这与a0db原片中远/近船根条目从think9起逐出、穷矿两根反复丢失/重算形成直接对照；原片及原判法没有修改。

对每个think用原属性顺序`JSON.stringify`后核对字节，并保存SHA-256：

| 比较对象 | 相同次数 |
| --- | ---: |
| 原生context、正常目标、初始余额、限制及provider清单 | 220/220 |
| **完整GoalPlannerOutput（含cache）** | **220/220** |
| 完整最终FactWork receipt | 220/220 |
| 几何entries（含游标、pin、readyThink） | 220/220 |

容量头的mode、限值和含外壳计数位于owner memory的独立几何段，按两版约定分别核对；上表比较保留完整规划输出。

## 原计划判法仍然失败

11题第1次均无选中动作；第20次也都无选中动作、无正式readyActions。11帧最终两次语义图稳定，但原判法全部失败，首次ready/原判法通过/可执行三个序号均为null。
逐题的首末目标、候选数、事实、工作量和20次序列见[默认轮计划表](geometry-default-5ca.plans.json)。近船、已有兵营、三步兵三个防过度行动变体完整保留。

W=`waiting-facts`，B=`blocked`；候选是alternatives数量，不是已选动作。下表所有首次可执行think均为“20次内未出现”。

| 题与变体 | 第1次 | 第20次 | 首/末工作量 |
| --- | --- | --- | ---: |
| 船在别处：远船 | ConquerIsland W，0候选 | W，8候选 | 3294 / 6144 |
| 船在别处：近船 | 同上 | 同上 | 3294 / 6144 |
| 人口：农场→骑士 | ExpandLand W，0候选 | W，24候选 | 147 / 173 |
| 人口：已有兵营 | 同上 | 同上 | 148 / 173 |
| 从零造海军 | ConquerIsland W，0候选 | W，8候选 | 3294 / 61 |
| 守家：约90秒遇袭 | ConquerIsland、两个DefendSite、Evacuate为W，ReinforceFront为B；均0候选 | 同状态；ConquerIsland有8候选，其余0 | 6144 / 6144 |
| 守家：约360秒遇袭 | ConquerIsland、DefendSite为W；均0候选 | 同状态；ConquerIsland有8候选，防守0 | 6144 / 6144 |
| 滩头：八步兵 | ConquerIsland W，0候选 | W，8候选 | 3664 / 6144 |
| 滩头：三步兵 | 同上 | 同上 | 3664 / 6144 |
| 穷矿强营 | ConquerIsland、ExpandLand均W、0候选 | 均W，分别8/24候选 | 6144 / 6144 |
| 守不住撤离 | DefendSite、Evacuate为W，ReinforceFront为B；均0候选 | 同状态、0候选 | 6144 / 6144 |

| 剩余缺口 | 本固定默认头的实际证据 | 后续责任 |
| --- | --- | --- |
| 安全与救出 | 全11输入的combatOptions、readProjectedFact仍未装配；site-safe/assets-safe仍是`goal-world-domain-port-required` | 32装配，23安全源，37防守/撤离候选；后续共同头另验 |
| 未来worker路线 | 船/海军/守家/滩头各8个候选仍为`route-actor-not-available`，actor是未来binding | 32未来投影、23/37输出绑定 |
| 留守和增援 | garrison-ready仍`observed-garrison-handoff`；ReinforceFront仍无到岗候选 | 32中央证明与37候选；本轮不据blocked证明不可行 |
| 完整链、预算与执行 | 已能保留根建址并继续展开，但没有选出的完整链；真实400金预留及执行bridge仍未验 | 正式分配/执行接线完成后启用执行检查 |

本轮最终所有建址事实都已met，人口及穷矿的大陆路线也有真实published结果。此前“根建址丢失”和局部建址pending不再作为这次的缺口；安全/未来绑定尚未闭合，不能据此称题目无解。

## 检查与证据

| 检查 | a576测量轮 | 5ca默认轮 |
| --- | --- | --- |
| 根tsc / tools/ai tsc | 0 / 0 | 0 / 0 |
| 题库全目录 | exit1：35通过、11计划失败、22跳过 | 同左 |
| SDK package-boundaries | exit1：6通过、1个共享测试命名失败 | exit0：7通过，5ca已修名称 |
| 原片同一性、220次原生think、根保持 | 全部通过 | 全部通过 |
| 相对固定共享基底的生产AI/SDK/sim差异 | 无 | 无 |

35项通过属于构造/前提/scope/绑定；22项跳过为11个尚缺bridge的执行检查和11个本轮未启用的人工解。未跑全量src，不把测量轮SDK失败改记为通过。

重跑须在A100的独立checkout中使用上述准确源码；默认轮先清掉环境里的测量开关：

```sh
env -u SKETCH_PUZZLE_GEOMETRY_MEASUREMENT SKETCH_PUZZLE_PLAN_EVIDENCE=/tmp/puzzles-default npx vitest run src/ai/strategy/puzzles --maxWorkers 1 --minWorkers 1
```

测量轮另在b6cb源码上设置`SKETCH_PUZZLE_GEOMETRY_MEASUREMENT=1`，输出到另一个目录，不当作默认验收。
[测量轮证据](geometry-measurement-a576.evidence.json)与[默认轮证据](geometry-default-5ca.evidence.json)分别封存；含11份完整原帧、每次输入/输出/memory/work、日志、源码与文件哈希、分析及复跑脚本。
[容量逐次诊断](geometry-capacity.summary.json)、[220对完整输出哈希与等值结果](geometry-capacity.comparison.json)保留在仓库；大体积原始帧在A100 evidence store，PR继续draft。
