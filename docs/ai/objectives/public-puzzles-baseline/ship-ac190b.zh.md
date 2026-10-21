# 题1竖切：ac190b远船、近船

**计划0/2、正式执行0/2；40次冻结think和1120次真实think均没有选中动作或readyActions，正式goal命令0。** 近船物理目标通过，发令来源仍是原有脚本，未计作规划器成功。本轮只跑题1的两个原始变体。

固定生产头`ac190b30ca2234029aed66e453ad92932a780c97`，运行源码`9fa9bbb475f226c8e048757f3688e3d6ae7e1ba4`，A100 / Node24.22.0 / `v9_knight`。源码归档`archive/public-puzzles-ship-ac190b-source-20261021`。
场景、原物理判法、规划判法和执行适配相对8934轮的`2618247e`逐字节未变；相对ac190b没有自有生产AI/SDK/sim改动。

## 卡在第几层

两变体都停在根目标的**第一层achiever候选发现**，尚未回归出调船→运兵→清营→运工人→建厅→留守的选中依赖图。因此不能把下列deferred请求排成一条已成立的动作链，也不能宣称清营成本/P已通过验收。

| 根事实 | 第20次观察 | 未发布/未满足的候选依赖 |
| --- | --- | --- |
| `garrison-ready` | unmet / `observed-garrison-handoff`；0 producer | `combat-candidate-facts-pending`保留18个请求：5个现有部队`combat-location:…:crossing`、8个未来shipyard producer、2个boarding-cells、2个point route、1个shore-pair remaining |
| `hall-complete` | unmet / `native-mine-hall-missing`；0 producer | `cohort-landing-facts-pending`保留13个请求：8个未来shipyard producer、4个point route、1个shore-pair remaining；其原因指向真实`worker-at`前置 |

两者从第1次到第20次都是`waiting-facts`，没有alternatives或选中动作。`combatOptions`和`futureProjection`端口都已实际出现；端口存在没有被计作能力或题目通过。
[首末完整目标、事实与deferred](ship-ac190b.details.json)保留全部原始请求ID，便于32/37/23在相同输入上定位，不用另写题号事实。

## K20搜索开销与实际队列

两变体逐次数据完全相同。每次计划的`search`均为`{work:5, expansions:5, depth:0, limitReason:null}`；这里展示的是本次实际输出，未累加累计expansions。
每变体20次实际队列总工作量118001，其中`goal-search:ConquerIsland:planner:resource-1`服务100，其他117901来自几何/距离场。每次都核对完整有序`services`之和等于`receipt.used`，未把plan计数另加进队列用量。

| think | queue used / 6144 | 每计划work / expansions / depth / limitReason |
| ---: | ---: | --- |
| 1 | 5782 | 5 / 5 / 0 / null |
| 2 | 2753 | 5 / 5 / 0 / null |
| 3…18 | 每次6144 | 每次5 / 5 / 0 / null |
| 19 | 5018 | 5 / 5 / 0 / null |
| 20 | 6144 | 5 / 5 / 0 / null |

实际tier总计：`critical-route=100`、`existing-field=19495`、`background-field=98406`。完整逐think、逐计划四项搜索指标及tier分项分别在[远船](ship-ac190b.far-search.md)、[近船](ship-ac190b.near-search.md)；[冷帧原值摘要](ship-ac190b.cold.json)另保留全部服务key、tier、work和最终收据。
两变体首次ready、首次原判法通过、首次可执行think都为null。

冷帧始终使用同一个snapshot对象和tick1，memory沿用，thinkSequence为1…20；没有修改tick、缓存、预算或场景，也没有事后补做几何查询。
两份快照与封存a0原片的JSON字节相同：远船SHA`4f1552e780c76a2d1966646470b744de73436eeb452368df74e1ae4ee28e8a78`，近船SHA`e457c849ed51985dcfc184fc02101edc09fd274788b782f26a563fe455a39cea`。
冷帧容量无pressure/overflow；两者pin峰值32403B，末次32354B/34项，resident峰值33772B，默认限值仍为33776B/38项。

## 真实执行及动态容量阻塞

两局各推进8400tick，各560次普通owner think。所有实际输出、分配、命令、work及快照已完整解析；没有`goal.*`正式命令、没有选中动作。原有`naval/economy/miningWorkforce/v6Economy/v6General`仍会发令，近船另有`expansionGarrison`。

| 变体 | 原物理结果 | 实际里程碑（从冷帧起的tick） | 正式结果 |
| --- | --- | --- | --- |
| 远船 | 失败 | 4773军队和工人同到岛；5000清营；8400时未建好厅，工人顺序不安全 | 0 goal命令，失败 |
| 近船 | 通过 | 123上船、843落岛、1107清营、4921工人到岛、5612建好厅 | 0 goal命令，归属要求失败 |

真实运行还出现了与冻结轮不同的阻塞：**两者第7次think/tick105首次显式geometry压力**。远船33909B、近船33905B，均超过33776B；该pressure各列20个requestIds。
远船末次pressure为33911B、overflowCount554；近船结束时目标列表已经空，不能据此说早先容量压力消失或已修复。
32正在核动态revision的旧pin释放，本轮未改容量；上述数值是实际观测压力，不能当成完整工作集需求峰值。

| 变体 | 实际队列总work | critical-route | existing-field | background-field | `goal-search:*`服务work |
| --- | ---: | ---: | ---: | ---: | ---: |
| 远船 | 2488813 | 99 | 4953 | 2483761 | 99（ConquerIsland35、ExpandLand64） |
| 近船 | 1599876 | 35 | 23920 | 1575921 | 35（ConquerIsland35） |

真实执行每次的plan.search四字段及实际队列tier分项完整列于[远船执行](ship-ac190b.far-execution-search.md)、[近船执行](ship-ac190b.near-execution-search.md)。它们保留没有plan的think行，不用status频次代替工作量。
[执行摘要](ship-ac190b.execution.json)保留实际物理checks、命令来源、首末里程碑和具体失败。完整有序service与按key汇总在证据的`runtime-search/*.metrics.jsonl.gz`、`runtime-search/summary.json`，所有1160份冷/热收据都已核对用量之和。

## 检查与证据

根`tsc --noEmit -p .`、tools/ai tsc、SDK package-boundaries均exit0。只跑`ship-away.scene.test.ts`：**6通过、4失败、2跳过，exit1**。6项为构造/真实前提/原生scope，4项为两冷帧计划与两正式执行，2项仅未启用人工解；未跑其他题或全量src。

[完整证据](ship-ac190b.evidence.json)：SHA`ba20d380257dde1df0768b1fb0794ec9d65fb8a599156196b231e1a0ce5fcc67`，6397921B，存储端SHA已复核。它包含两原帧及完整逐think input/output/cache/memory、两真实模拟及1120份snapshot/output/allocation/commands/work、逐think搜索报表与服务key明细、测试退出码、文件和源码哈希、复跑和只读分析脚本。
A100原目录`/codegeex/jeffry/sketch-public-puzzles/evidence/ship-9fa9bbb4`，独立封存为`public-planner-puzzles-ship-ac190b-20261021`。

```sh
python3 /codegeex/jeffry/sketch-public-puzzles/run-ship-vertical-slice.py 9fa9bbb475f226c8e048757f3688e3d6ae7e1ba4 ac190b30ca2234029aed66e453ad92932a780c97
```

脚本校验checkout的准确SHA和基底、只挑题1两变体并先比原快照；已有`commands.json`时拒绝覆盖。本轮已完成，复跑应使用新的独立输出目录。此前f27、8934、a576/5ca证据继续独立保留；未改标本轮结果，PR继续draft。
