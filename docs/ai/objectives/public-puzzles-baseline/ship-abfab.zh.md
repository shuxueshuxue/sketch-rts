# 题1竖切：abfab两档规划与选后精化

**K20计划0/2、正式执行0/2。40次冻结think和1120次真实think均没有readyActions或正式goal命令。** 两变体在冷帧think1都选出了9步粗链，但最前面的调船、运工人精化到think20仍未发布；同时原资源前缀校验发现真实负债，图中也先运工人再清营。

验收生产头`abfab46059323ec56ec0df75d9f01ba8b6ca7ee5`，运行源码`69355c23a12b0376151de4e2a0a45d4c5f32e2c6`，A100 / Node24.22.0 / `v9_knight`。本轮只跑题1 far/near，代码与判法相对上一轮逐字节未改；没有使用后续4f618167等中间头。

## 两步精化何时发布，ready如何变化

“内存entry变成known”“选中节点带known精化”“exact声明重新进入计划”“动作进入output.readyActions”分别记录。运行原片没有的观察不作推断。

| 模式/变体 | 动作 | 首次选中think | memory known | node known | exact选中 | output ready |
| --- | --- | ---: | --- | --- | --- | --- |
| K20 far | position-transport | 1 | 未出现 | 未出现 | 未出现 | 未出现 |
| K20 far | transport-worker | 1 | 未出现 | 未出现 | 未出现 | 未出现 |
| K20 near | position-transport | 1 | 未出现 | 未出现 | 未出现 | 未出现 |
| K20 near | transport-worker | 1 | 未出现 | 未出现 | 未出现 | 未出现 |
| 真实far，560次 | position-transport / transport-worker | 均1 | 执行原片不含此内存段 | 均未观察到 | 均未出现 | 均未出现 |
| 真实near，560次 | position-transport / transport-worker | 均1 | 执行原片不含此内存段 | 均未观察到 | 均未出现 | 均未出现 |

因此**没有“精化发布后”的ready比较时点**；本轮实际ready始终为0，不能写成“发布成功但ready没变”。
冷帧refinements.revision始终0，前两步都是`coarse / waiting-facts / pending`。后续另有一个position-transport节点，状态为waiting-time，没有开始精化；它与链首调船分别保留。

完整逐think记录：[冷远船](ship-abfab.cold-far-refinement.md)、[冷近船](ship-abfab.cold-near-refinement.md)、[真实远船](ship-abfab.runtime-far-refinement.md)、[真实近船](ship-abfab.runtime-near-refinement.md)。节点ID摘要只用于表格阅读；原始完整ID、coarse/exact声明、sourceRevision、精化reason/delta、真实前置和ready关联均在证据`cold-refinement/*.refinement.jsonl.gz`与`runtime-refinement/*.refinement.jsonl.gz`中。

## K20的精化阻塞

链首调船从实际船位求到`(176,816)`的native point route。think1的reason为`native-point-route-pending`；think15起改为`native-point-route-memory-budget`，到20仍pending。
运工人从boarding-near待发布推进到另一个`(112,816)`的point请求，最终仍为`selected-exact-facts-pending`，没有known精化。

原内存还记录了两个point搜索的失败时刻，两变体相同：

| point目标 | 首次内存failure think | readyThink字段 | 累计native work | 实际failure |
| --- | ---: | ---: | ---: | --- |
| (112,816) | 11 | 11 | 27363 | memory-budget |
| (176,816) | 14 | 14 | 31172 | memory-budget |

这些readyThink伴随的是失败记录，未被当成路线或精化发布成功。point-route缓存限额为原32KiB，本轮未增加限额或切换搜索算法。
独立goal geometry缓存本轮冷帧没有pressure/overflow：两者末次3563B/4项，pin/resident峰值3572B，默认仍为33776B/38项。两种容量分别保留。

## 原资源判法失败与所选顺序

所有40个冷think首先在原断言`shared resource ledger must prove every prefix`失败：正式`projectGoalResources`返回**unmet**。
只读取原片中的初始余额、选中声明、start/finish时刻，再调用同一个纯资源投影器，首末均复现：

| 变体 | 负债动作 | 计划绝对tick | 资源 | required | available |
| --- | --- | ---: | --- | ---: | ---: |
| far | transport-force | 2362 | 本土(1184,704)的post / combat-rating | 4 | 0 |
| near | transport-force | 1654 | 同上 | 4 | 0 |

该探针不调用planner、几何或sim，不补余额。精确actionId/deficit原行在证据`post-deficits.jsonl`第1/2行；完整40次原时间线重放在`resource-replay.json`，脚本为`replay-ship-resources.mts`。37已直接收到原片与JSON路径，核领域来源合同；32另核搜索与同一前缀资源账本的一致性。

图中的先后关系也保留为独立观察。所有40个冷think都选择同样的9步种类与依赖结构：

| 索引 | 所选动作 | 直接前驱索引 |
| ---: | --- | --- |
| 0 | position-transport | 无 |
| 1 | transport-worker | 0 |
| 2 | position-transport | 0、1 |
| 3 | transport-force | 2、0、1 |
| 4 | assemble | 3 |
| 5 | clear-camp | 4、3 |
| 6 | build | 5、1 |
| 7 | assemble | 4、5、3 |
| 8 | hold-position | 6、7、4、5、3 |

图把运工人安排在运兵、清营之前，未满足原题“清营后再运工人”的顺序；near也因此有调船作为首次运兵的前驱。
原测试先被资源校验挡住，没有继续运行到后续顺序断言；这里明确区分原断言结果与读取实际依赖图得到的顺序问题。[逐think诊断](ship-abfab.diagnostics.json)保留全部40次计划、前驱索引、精化reason和资源负债。

## 逐think搜索与6144账本

冷帧两变体的`plan.search`在每次实际输出中均为`work=401, expansions=401, depth=6, limitReason=null`；未将累计expansions相加充当工作量。
每变体队列总work71397，其中搜索服务8020，background-field63377。每次服务明细之和均等于实际receipt.used，所有用量≤6144。

| think | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 实际queue work | 5303 | 5226 | 5117 | 5118 | 5022 | 5301 | 5113 | 5114 | 5015 | 5114 |

| think | 11 | 12 | 13 | 14 | 15 | 16 | 17 | 18 | 19 | 20 |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 实际queue work | 5114 | 5015 | 5114 | 2305 | 401 | 401 | 401 | 401 | 401 | 401 |

冷帧首次ready、首次原判法通过、首次可执行think均为null。第15…20次只有401搜索work，精化仍pending。
每计划四项搜索原值和每think队列分项见[冷远船](ship-abfab.cold-far-search.md)、[冷近船](ship-abfab.cold-near-search.md)；[冷帧JSON](ship-abfab.cold.json)保留完整有序services、每次原断言和候选种类。

真实执行也保留全部1120份搜索四字段与服务账本，不以status频次代替工作量：

| 变体 | 总queue work | critical-route | background-field | 搜索服务work |
| --- | ---: | ---: | ---: | ---: |
| far | 167747 | 14799 | 152948 | 14799：ConquerIsland14202、ExpandLand597 |
| near | 187710 | 29610 | 158100 | 29610：ConquerIsland29610 |

[真实远船逐think](ship-abfab.runtime-far-search.md)、[真实近船逐think](ship-abfab.runtime-near-search.md)、[四组首末/按服务key汇总与精化首次观察](ship-abfab.metrics.json)。完整有序服务序列另在证据的search JSONL中保留，全部1160份收据已逐条求和校验。

## 正式执行结果

两局各8400tick、560次普通owner think；正式命令仍须匹配真实allocator accepted admission、goal executor、同代token/goal-action及SDK返回条目。两局正式goal命令均0。

| 变体 | 实际物理里程碑（从初始帧起tick） | 原物理判法 | 正式执行 |
| --- | --- | --- | --- |
| far | 工兵4773同时落岛，5000清营；8400未建厅 | 失败，工人先于清营到岛 | 失败，goal命令0 |
| near | 843落岛、1107清营、4921工人落岛、5612建好厅 | 通过 | 失败，仅原脚本发令 |

动态运行还记录了goal geometry压力：far首个记录在think34/tick510（34557B，32 requests），末次34558B/overflow528；near首个在think80/tick1200（34425B，34 requests），最后仍有目标的think374/tick5610为34426B/overflow296。限值未改。
本轮没有将两种容量失败或物理达标当成正式行为成功。[执行结果](ship-abfab.execution.json)保留实际checks、命令来源和失败原因。

## 检查、快照与封存

根`tsc --noEmit -p .`、tools/ai tsc、SDK package-boundaries均exit0。只跑`ship-away.scene.test.ts`：**6通过、4失败、2跳过，exit1**；通过为构造/真实前提/原生scope，失败为两计划加两正式执行，跳过仅本轮未启用的人工解。未跑其他题或全量src。

两原快照与封存a0逐JSON字节一致，K20始终同一snapshot对象/tick1、memory延续、thinkSequence1…20，未改地形、单位、钱、判法或时限，也没有事后补做世界查询。far快照SHA`4f1552e780c76a2d1966646470b744de73436eeb452368df74e1ae4ee28e8a78`；near为`e457c849ed51985dcfc184fc02101edc09fd274788b782f26a563fe455a39cea`。

[独立证据指针](ship-abfab.evidence.json)：SHA`bf312b4b460ff8b9ae763b92209447789e1735cbc37c85b9613a57864fbf6e77`，19097810B，存储端SHA已复核。
含原始40冷帧与1120真实输出、全部精化/memory/事实/预算/命令/work、纯资源重放、源码/文件哈希和复跑/只读分析脚本。完整首末plans较大，保存在证据`cold-details.json`，未作为大文件写入git。

A100原目录`/codegeex/jeffry/sketch-public-puzzles/evidence/ship-69355c23`，封存`public-planner-puzzles-ship-abfab-20261021`；源码归档`archive/public-puzzles-ship-abfab-source-20261021`。
复跑脚本固定准确source/base并拒绝覆盖已有commands.json，复跑须用新的独立输出目录：

```sh
python3 /codegeex/jeffry/sketch-public-puzzles/run-ship-vertical-slice.py 69355c23a12b0376151de4e2a0a45d4c5f32e2c6 abfab46059323ec56ec0df75d9f01ba8b6ca7ee5
```

PR继续draft。ac190b、f27、8934及a576/5ca证据独立保留；本轮结果保持abfab标签，后续精化/资源/付款修复应在新的共同固定头另验。
