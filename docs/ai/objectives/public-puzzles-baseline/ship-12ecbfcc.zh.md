# 12ecbfcc：题1原K20与完整8400 tick验收

**正式执行0/2通过，物理目标0/2通过；两局共1120次真实think，均跑满8400 tick。** 冷帧far通过，near失败。下表分别保留真实发令、物理里程碑和原判法。

固定生产`12ecbfcc9cffe71d89af3ba5179c3cc7d1ec3d22`，测试源码`d37c34d7939f18252c8aa99a602417cff40469c0`。包含海域场/风耗时和同目标进度接手；未加入后续fea95证明图、替代缓存保留或stable cohort增量。fd4先完整封存，未启动的3be轮按总指挥指令取消。

## 实际走到哪一步

| 变体 | 首goal命令 | 集结 | 调船 | 运兵 | 清营 | 运工人 | build | 留守 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| far | 10/t150 | 10/t150 | 15/t225 | — | — | — | — | — |
| near | 8/t120 | 8/t120 | — | — | — | — | — | — |

表中为首次accepted命令的think/tick，逐条匹配同代goal-action token、gateway接受和实际返回SDK条目；不是阶段完成时间。首集结两局均向原四名footman发4条move、generation2。wait-income执行单列在[链记录](ship-12ecbfcc.chain.json)，不产生物理命令。build的建筑种类/目标以原SDK参数为准，岛厅完成另按物理判法记录。

| 变体 | accepted命令构成 | 登船 | 部队上岛 | 清营完成 | 工人上岛 | 岛厅完成 | 四项原物理检查 |
| --- | --- | ---: | ---: | ---: | ---: | ---: | --- |
| far | assemble37、position-transport5 | — | — | — | — | — | {'islandHallComplete': False, 'campCleared': False, 'armyTransported': False, 'safeWorkerSequence': False} |
| near | assemble19 | — | — | — | — | — | {'islandHallComplete': False, 'campCleared': False, 'armyTransported': False, 'safeWorkerSequence': False} |

[原执行结果与错误](ship-12ecbfcc.execution.json)、[ready种类](ship-12ecbfcc.ready-kinds.json)。完整原片包含实际before/after memory、allocation、命令、时刻与SDK世界，没有回放短重建分支来代替官方时序。

## 未执行阶段的最近原事实

| 变体 | 首个未发令kind | 最近选中帧 | 节点 / output ready | 非met前置 |
| --- | --- | --- | --- | --- |
| far | transport-force | 560/t8400 | waiting-time / False | 无；7项前置均met，计划start8455 / finish9430 |
| near | transport-force | 560/t8400 | waiting-time / False | 无；7项前置均met，计划start8455 / finish9174 |

末帧两局的route、force-at、两项unit-available、transport-at、transport-in、shore-safe均为met，availableTick均8400；运输仍排在55 tick之后，顶层只放行assemble。终局卡点是时间依赖等待，不能归为仍缺某个世界事实；同一原帧的完整动作声明和前置在[链记录](ship-12ecbfcc.chain.json)。链JSON仅去掉空白以满足单文件限制，全部字段和值与artifact的完整chain-summary.json相同。

这些是标明帧号的原观察；未来前置可以由上游动作满足，不能只凭unmet判世界读取错误。早期far126/t1890、near120/t1800已由37独立只读审计：末名后产lancer距装船点约714.55/658.59，整船deck/cabin为空，尚无运输/清营执行或准入。该force-at未满足有真实位置依据，见[独立域审计](ship-12ecbfcc.domain-audit.json)，不扩成终局根因。

32另在同一原near输入复现精化替代缓存8槽被历史wait-income报价占用、known运输别名被逐出，导致同think反复精化；原near166/t2490账本中search6142、9轮回归，coarse版本1729→1743。far174/t2610那份账本search仅696，余工作实际用于land field/geometry，按不同问题保留。原member与摘要在artifact derived-frames/中。后续修复未热换本轮。

## 冷帧原判法与near因果图

| 变体 | K | 最终原判法 | 最终两图稳定 | 首判法通过 | 首判法通过且有ready |
| --- | ---: | --- | --- | ---: | ---: |
| far | 20 | 通过 | True | 1 | 5 |
| near | 20 | 失败 | False | None | None |

near原checker报告1个“初始position祖先”，原失败和不稳定均保留。对原think1独立读值：首次transport-force为110→230，只依赖loading assemble；position为230→230、依赖首次运输，实际属于返航接工人。当前transport-at(1664,768)/tolerance36本已met，但共享fact节点又挂后来restore的producer，沿全部fact边递归时形成伪祖先。它不能证明实际前缀多调船，也不能据此把本轮K20改成通过。[原时刻/依赖/观察](ship-12ecbfcc.causality.json)、[原checker汇总](ship-12ecbfcc.cold.json)。

世界/判法未改；原far/near snapshot仍分别为SHA`4f1552e780c76a2d1966646470b744de73436eeb452368df74e1ae4ee28e8a78`、`e457c849ed51985dcfc184fc02101edc09fd274788b782f26a563fe455a39cea`。冻结世界始终tick1，memory逐think传递，完整K20，6144/think、严格导航闸不变。

## 精化、搜索与报价观察

| 模式/变体 | 动作 | memory known | node known | exact选中 | output ready |
| --- | --- | ---: | ---: | ---: | ---: |
| cold/far | position-transport | 9 | 11 | 11 | 11 |
| cold/far | transport-worker | — | — | — | — |
| cold/far | assemble | 2 | 3 | 3 | 5 |
| cold/near | position-transport | — | — | — | — |
| cold/near | transport-worker | — | — | — | — |
| cold/near | assemble | 2 | 3 | 3 | 4 |
| runtime/far | position-transport | 13 | 15 | 15 | 15 |
| runtime/far | transport-worker | — | — | — | — |
| runtime/far | assemble | 4 | 8 | 8 | 10 |
| runtime/near | position-transport | 301 | 301 | 301 | — |
| runtime/near | transport-worker | — | — | — | — |
| runtime/near | assemble | 4 | 7 | 7 | 8 |

首次值按kind保留实际记录，不当整链完成。40份冷前缀资源重放使用原余额、流和时刻；原结果在artifact resource-replay.json。

| 模式/变体 | think数 | queue总work | critical-route | existing-field | background-field |
| --- | ---: | ---: | ---: | ---: | ---: |
| cold/far | 20 | 61524 | 11388 | 16322 | 33814 |
| cold/near | 20 | 67793 | 10780 | 8200 | 48813 |
| runtime/far | 560 | 2144473 | 1779622 | 49200 | 315651 |
| runtime/near | 560 | 2068317 | 1795648 | 18713 | 253956 |

1160份receipt逐份核有序services之和=used≤6144。search保留work、expansions、depth、limitReason：work合计同think多次回归，expansions是最后continuation累计值，不相加；几何工作未计作搜索。[Git指标投影](ship-12ecbfcc.metrics.json)保留汇总和首末值；全部完整service ID/work、逐think记录及原完整summary保留在artifact，避免把数MB的唯一缓存key写进单个Git文件。

| 模式/变体 | quotes | empirical | α | outsideSupport | pending |
| --- | ---: | ---: | ---: | ---: | ---: |
| cold/far | 700 | 140 | 560 | 560 | 0 |
| cold/near | 700 | 140 | 560 | 560 | 0 |
| runtime/far | 46986 | 217 | 46769 | 46769 | 0 |
| runtime/near | 47446 | 229 | 47217 | 47217 | 0 |

这是output.campModelUsage报价观察总和，不是实际战斗或独立样本数。原duration/cost/P、支持边界和资产/现金口径均随固定生产源码，没有为过题填事实或改价。

## 独立进程、退出码和封存

| 变体 | 原进程退出码 | 本变体6项：过 / 败 / 跳 | 原report SHA |
| --- | ---: | --- | --- |
| far | 1 | 4 / 1 / 1 | `a429331a078b43f950a6532cd2c7cd11bc6d1b414b2f0978bd0b14b6b190544a` |
| near | 1 | 3 / 2 / 1 | `2755a402f9a13b024026af9ab94a61758ab8529b275aa490c1f2a4c4bab790d6` |

每个原场景文件分别用独立单worker进程匹配一个变体。两份原Vitest JSON、argv和退出码完整保留；tests.json是明确标注的派生汇总，只取每边6项，不重复计另一变体的pattern跳过项。[进程及断言投影](ship-12ecbfcc.processes.json)。

根tsc、tools/ai tsc、SDK边界exit0；派生12项汇总7通过、3失败、2跳过，aggregate exit1。未跑全量src或其他题。

| 变体 | 实际memory份数 | authority峰值 | 峰值帧 | 原262144B上限超出次数 |
| --- | ---: | ---: | --- | ---: |
| far | 560 | 226178B | 462/t6930 | 0 |
| near | 560 | 184255B | 560/t8400 | 0 |

authority按原生UTF-8 JSON.stringify计量，完整[峰值数据](ship-12ecbfcc.authority.json)与逐thinkMD保留，未改上限。[完整验证](ship-12ecbfcc.validation.json)。

[完整证据指针](ship-12ecbfcc.evidence.json)：SHA`84a7a7e4008c96ddaab369269db5f94823b3e023eba2d4f9c38e5658ee2a8823`，221804054B，存储端SHA已核。含原cold/runtime、before/after memory、全部服务账本、原报价、原native报告、首命令逐字节member、独立审计及只读报告脚本。源码归档`archive/public-puzzles-ship-12ecbfcc-source-20261021`，PR继续draft、不合并。
