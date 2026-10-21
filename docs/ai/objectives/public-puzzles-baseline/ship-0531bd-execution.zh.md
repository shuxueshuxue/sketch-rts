# 0531题1：原时限正式执行与分轮证据

**正式执行0/2，1120次真实owner think，goal命令0。** 两局均跑完原8400tick。far没有建好岛厅，工人与军队同时先于清营落岛；near由原脚本完成物理建厅，但没有正式goal授权，仍失败。
[补满K20](ship-0531bd-k20.zh.md)的原图/资源判法为far通过、near失败，可执行均0；该冷帧成绩与正式执行分开统计。

生产全程固定`0531bd3c9d847a7606535d14d0c136af22e20b36`，原完整运行源码`2f82c4ec6e316bb61f55a963d671f392ec6e59ca`，A100 / Node24.22.0 / `v9_knight`。未热换93e/359及其他后续修复，没有改原世界、命令准入、原时限或判法。

## 两步精化与ready

| 变体/动作 | 首次选中think | 首次node known | 首次exact选中 | 首次output ready |
| --- | ---: | --- | --- | --- |
| far position-transport | 1 | 560次内未出现 | 未出现 | 未出现 |
| far transport-worker | 1 | 560次内未出现 | 未出现 | 未出现 |
| near position-transport | 1 | 560次内未出现 | 未出现 | 未出现 |
| near transport-worker | 1 | 560次内未出现 | 未出现 | 未出现 |

实际输出未观察到这两类动作的精化发布，因此没有“发布后ready变化”的比较时点。完整运行的记录器保存实际output/allocation/commands/work，没有保存执行memory；没有将执行memory里的发布状态作推断。
[far逐think精化](ship-0531bd-execution.far-refinement.md)、[near逐think精化](ship-0531bd-execution.near-refinement.md)保留两类动作的原节点状态、声明精度、精化注解与ready关联。完整ID/声明/前置在证据`runtime-refinement/*.refinement.jsonl.gz`和原始runtime中。

**全局ready曾出现，且只来自wait-income。** 两局首次均为think4/planner tick60；far有92个ready节点观察，near有108个，全部是wait-income。它没有产生原生SDK命令，不能与调船或运工人的ready混称。
[ready种类原值](ship-0531bd-ready-kinds.json)与真实allocation保留这一差别，未将“ready但无命令”单独认定为执行器错误。

## 原物理结果与发令归属

| 变体 | 实际里程碑（从初始帧起tick） | 原物理checks | 正式检查 |
| --- | --- | --- | --- |
| far | 553上船；4773军队、工人同时到岛；5000清营；8400未建好厅 | campCleared、armyTransported通过；islandHallComplete、safeWorkerSequence失败 | 失败，goal命令0 |
| near | 123上船；843军队到岛；1107清营；4921工人到岛；5612建好厅 | 四项通过 | 失败，goal命令0 |

两局实际命令来自原有economy/miningWorkforce/naval/v6Economy/v6General脚本，near另有expansionGarrison。
正式命令计数仍要求actual allocator admission为accepted/executor/goal命名，带同代token并匹配goal-action与实际SDK返回命令；所有1120份真实收据均已逐条核对。近船物理达标没有替代这项归属检查。
本轮没有实际走到goal建厅付款，不能用它宣称中央付款/身份的公开链已通过。
[执行checks、里程碑与命令来源](ship-0531bd-execution.summary.json)保留完整结果；原始snapshot/output/allocation/commands/work没有截断。

## 搜索四字段与6144账本

1120次真实think均保留每个plan.search的work、expansions、depth、limitReason，及最终完整有序services。逐份核对服务work之和等于receipt.used，所有用量≤6144；未把status频次当工作量，也未累加累计expansions或将plan计数再加进队列。

| 变体 | 实际think数 | 总queue work | critical-route | background-field | 峰值单次queue |
| --- | ---: | ---: | ---: | ---: | ---: |
| far | 560 | 1130901 | 670645 | 460256 | 6144 |
| near | 560 | 877703 | 140591 | 737112 | 6144 |

tier为真实账本分类，没有把整个critical-route列等同于搜索。每个服务key的原值汇总、各plan四字段首末及两步首次观察在[指标JSON](ship-0531bd-execution.metrics.json)；[far逐think](ship-0531bd-execution.far-search.md)、[near逐think](ship-0531bd-execution.near-search.md)完整列出每个计划。完整service序列另保存在证据的search JSONL中。

动态运行记录的geometry压力也保留，未改33776B/38项上限：

| 变体 | 首个记录到pressure | 末个pressure | request数/末次overflow |
| --- | --- | --- | --- |
| far | think483 / tick7245，34297B | think560 / tick8400，34297B | 24 / 79 |
| near | think199 / tick2985，34776B | think374 / tick5610，34777B | 38 / 177 |

near之后目标列表为空，没有将此当作早先压力已修复。[逐think诊断与压力](ship-0531bd-execution.diagnostics.json)保留具体原值；未混入后续缓存/精确泊位修复。

## 早停原片、K20补录与退出码

| 段 | 运行源码 | 冷think数 | 执行think数 | 原检查退出码 |
| --- | --- | ---: | ---: | --- |
| 原完整运行 | 2f82c4ec | far4＋near20 | 560＋560 | 单文件7通过、3失败、2跳过，exit1 |
| K20补录 | fcfc0bb5 | 20＋20 | 不重复运行 | 两冷检查1通过、1失败、10项按筛选跳过，exit1 |

两段根tsc、tools/ai tsc、SDK边界均exit0；本轮未跑全量src或其他题。原完整运行的3项失败是near计划与两正式执行，2项跳过是未启用人工解。

原完整运行far在图通过且稳定后第4次早停，但ready为0。补录只收紧测试循环的提前退出条件，须连续两次已有可执行动作；原图/资源/顺序断言与物理判法保持不变。
补录前缀与原片已完整对拍：far原4次、near原20次，其observed（含input/output/cache）、memoryAfter、work、planHash、ready和原判法结果逐值相同，[完整对照](ship-0531bd-prefix-final.json)无差异。
冷帧证据封存时的前缀JSON只含当时已写完的far；该文件没有回写，后续完整对照独立留在本段原证据中。

两段初始快照与封存a0均逐JSON字节一致。K20始终同一个snapshot对象/tick1、memory延续、thinkSequence1…20；没有补事实、挪单位、改钱、重置缓存或增加额度。

## 两份独立证据

- [原完整运行](ship-0531bd-execution.evidence.json)：`f06e699bb22658e5f562658be33c2e8474430c624ac66ea8adcbb50e95152659`，64309602B，source=2f82c4ec。含far4/near20早期原冷片、1120份真实输入/输出/分配/命令/work、逐think精化/搜索指标、原资源重放、完整前缀对照、退出码及源码/文件哈希和脚本。
- [K20补录](ship-0531bd-k20.evidence.json)：`2a9a33ff7e65c75bb974615adcd17990825ce02fd8a9d7bed4363162d0011b46`，4609556B，source=fcfc0bb5。含40次完整冷观察、精化内存/原前置、资源纯重放、原早退生命周期diff、首末/全服务账本及复跑脚本。

两对象存储端SHA均已复核。A100目录分别为`/codegeex/jeffry/sketch-public-puzzles/evidence/ship-2f82c4ec`与`ship-fcfc0bb5`，独立封存`public-planner-puzzles-ship-0531bd-original-20261021`和`public-planner-puzzles-ship-0531bd-k20-20261021`。
源码归档分别为`archive/public-puzzles-ship-0531bd-source-20261021`与`archive/public-puzzles-ship-0531bd-k20-source-20261021`。

PR保持draft。本轮结论为冷帧原判法1/2、目标可执行0/2、正式执行0/2；后续共同头须另跑，不重标本轮或此前abfab结果。
