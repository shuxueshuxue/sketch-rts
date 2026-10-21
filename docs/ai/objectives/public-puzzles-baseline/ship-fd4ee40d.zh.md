# fd4ee40d：回收后跑满时限，岛厅链仍未完成

**远近两局均完成8400 tick、共1120次真实think，没有再触发256KiB异常；正式执行判法0/2。** 冷帧far通过，near仍因首次运兵前多出两步调船而失败。两局实际只发出了集结、调船命令，四项物理目标全部未达成。

生产固定`fd4ee40d9ae5c9c087532e9438490ea3efb37b47`，运行源码`f563cd5fff2273dfb8ff4b42c0b4a3d7bf2481bb`。原远近场景、K20、8400 tick、6144/think和严格导航闸均未改；没有加入后续near选择、资本/PV、海域场或同目标接手增量。

## 正式命令和物理边界

| 变体 | 完整think | 首正式goal命令 | accepted命令构成 | 运兵 / 清营 / 运工人 / 建厅 |
| --- | ---: | --- | --- | --- |
| far | 560 | t135 | assemble25、position-transport4 | 均无正式命令；四项物理检查false |
| near | 560 | t135 | assemble31、position-transport9 | 均无正式命令；四项物理检查false |

首次assemble为think9/t135，向原四名footman发accepted move；首次position为think11/t165，generation3。每条均核对同代goal-action token、gateway接受和真实返回SDK命令。wait-income首次ready为t90，单列且不计物理发令。完整链阶段首次命令、原实体/租约归属及原物理里程碑见[链记录](ship-fd4ee40d.chain.json)。

far在think417–560（t6255–8400）的144份原记录中，船保持同一位置(112,912)和move目标(1552,912)，位移为0；末帧transport-at仍unmet/native-transport-pose，计划净值−72.70344238829671。这只是原片事实，未据此认定导航根因。near末段船已到(1552,912)并idle，规划仍为waiting-facts/goal-required-facts-pending；原物理记录在t6426出现army-boarded，但没有运到岛上或完成运输的证明，armyTransported仍false。[far位置原值](ship-fd4ee40d.far-position.json)、[执行汇总](ship-fd4ee40d.execution.json)、[ready种类](ship-fd4ee40d.ready-kinds.json)。

## K20与精化发布

两原snapshot与之前逐JSON字节相同：far SHA`4f1552e780c76a2d1966646470b744de73436eeb452368df74e1ae4ee28e8a78`，near SHA`e457c849ed51985dcfc184fc02101edc09fd274788b782f26a563fe455a39cea`。冻结世界始终tick1，memory按think连续传递，完整保留20次。far保留调船祖先、运兵→清营→运工人→厅的顺序；near原零初始调船断言未放宽。

| 模式/变体 | 动作 | memory known | node known | exact选中 | output ready |
| --- | --- | ---: | ---: | ---: | ---: |
| cold/far | position-transport | 6 | 6 | 6 | 6 |
| cold/far | transport-worker | — | — | — | — |
| cold/far | assemble | 2 | 3 | 3 | 4 |
| cold/near | position-transport | 6 | 6 | 6 | 6 |
| cold/near | transport-worker | — | — | — | — |
| cold/near | assemble | 2 | 3 | 3 | 4 |
| runtime/far | position-transport | 11 | 11 | 11 | 11 |
| runtime/far | transport-worker | — | — | — | — |
| runtime/far | assemble | 4 | 8 | 8 | 9 |
| runtime/near | position-transport | 11 | 11 | 11 | 11 |
| runtime/near | transport-worker | — | — | — | — |
| runtime/near | assemble | 4 | 8 | 8 | 9 |

表中首次值按kind记录任一选中动作，不等于该阶段或全链完成；ready只取真实output成员，exact允许注明依据的粗估航时，不把后台point路线pending改写为完成。40份原前缀资源重放均met、deficits=[]。完整声明、delta、cost/P及ready变化保留在artifact；见[冷片](ship-fd4ee40d.cold.json)、[指标](ship-fd4ee40d.metrics.json)。

## 终态回收的实际验证

| 变体 | 原156 authority | 实际157 authority | 全560峰值 | 峰值think/tick | 峰值execution数 |
| --- | ---: | ---: | ---: | --- | ---: |
| far | 91712B | 92904B | 227862B | 357/t5355 | 9 |
| near | 91018B | 92211B | 241321B | 407/t6105 | 13 |

字节以原生UTF-8 JSON.stringify计算，保持262144B上限。两局原156的snapshot/output/commands/work与36c原156逐值相同；新157是此次SDK真正执行并落盘的完整member，未重建旧版缺失的157。新旧156的memory大小不同是回收效果，未称整份memory相同。原36c中断证据保持封存不重标。[边界provenance](ship-fd4ee40d.allocation-boundary.json)、[全量峰值](ship-fd4ee40d.authority.json)、[逐think far](ship-fd4ee40d.runtime.far-authority.md)、[near](ship-fd4ee40d.runtime.near-authority.md)。

## 搜索、模型与服务账本

| 模式/变体 | think数 | queue总work | critical-route | existing-field | background-field |
| --- | ---: | ---: | ---: | ---: | ---: |
| cold/far | 20 | 92823 | 10127 | 3893 | 78803 |
| cold/near | 20 | 94445 | 10127 | 3893 | 80425 |
| runtime/far | 560 | 2356952 | 883423 | 3920 | 1469609 |
| runtime/near | 560 | 2862682 | 1500499 | 5348 | 1356835 |

所有1160份冷/动态receipt均逐份验证有序services之和=used≤6144。search保留work、expansions、depth、limitReason：work合计同think多次回归，expansions为最后continuation的累计值，未二次相加，几何工作不计搜索。

| 模式/变体 | quotes | empirical | α | outsideSupport | pending |
| --- | ---: | ---: | ---: | ---: | ---: |
| cold/far | 700 | 140 | 560 | 560 | 0 |
| cold/near | 700 | 140 | 560 | 560 | 0 |
| runtime/far | 46826 | 217 | 46609 | 46609 | 0 |
| runtime/near | 46826 | 217 | 46609 | 46609 | 0 |

模型计数是实际output.campModelUsage的报价观察总和，不是战斗或独立样本数。原清营duration/cost/P及支持边界原样保留，未为过题改价或填事实。

## 校验与封存

根tsc、tools/ai tsc、SDK边界均exit0。原ship场景7通过、3失败、2跳过，exit1；两执行只有终局物理断言失败，没有运行中异常。未跑全量src或其他题。世界/判法与生产diff均exit0，见[验证清单](ship-fd4ee40d.validation.json)。

[证据指针](ship-fd4ee40d.evidence.json)：SHA`b833aca6f3d33103a5cd2d3de8e74083b8d58ee4d3a97a3ef0daf8e262d7f0ee`，234626302B，存储端SHA已核。含完整冷/动态snapshot、实际before/after memory、原退出码、1160份账本、原cost/P与只读报告器。运行源码归档`archive/public-puzzles-ship-fd4ee40d-source-20261021`，PR保持draft。总指挥取消尚未启动的3be轮；下一轮独立固定12ec，不以新修复重标本轮。
