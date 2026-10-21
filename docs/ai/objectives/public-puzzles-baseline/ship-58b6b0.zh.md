# 58b6b0：题1两变体K20与正式执行

**目标调船/运工人ready为0/2，正式执行0/2，goal命令0。** 原图与资源判法far通过、near失败；两帧第10次出现的唯一ready是exact assemble。它不是调船或运工人精化完成，也没有在真实对局里产生ready。

生产固定`58b6b0ac5bebe6437c9746b7cfb01ac074a63065`，测试源码`ce20233dd1bd53a64a3598c1e7652583ebac4df7`。只跑原题1 far/near，未带后续heading或清营模型修改。根tsc、tools/ai tsc、SDK边界均exit0；单场景文件7通过、3失败、2跳过，exit1。3项失败是near计划与两正式执行；2项跳过是未启用人工解。本轮没有跑其他题或全量src。

## 冷帧首卡与两步精化

| 变体 | 原判法第1次→第20次 | 首次全局ready | 调船known / exact / ready | 运工人known / exact / ready |
| --- | --- | --- | --- | --- |
| far | 通过→通过，图稳定 | think10，assemble | 均未出现 | 均未出现 |
| near | 失败→失败，图稳定 | think10，assemble | 均未出现 | 均未出现 |

两帧目标动作均在think1进入选中图。think10至20的全局ready数为1，来自loading assemble，节点为exact/known/ready。调船有两个被选节点，仍为coarse/waiting-facts/pending，理由`selected-exact-facts-pending`；运工人仍等待前置动作，没有精化entry。没有观察到目标两步的known、exact、invalid或ready，因而也没有“精化发布后ready变化”的比较时点。

冷帧首卡仍是所选调船point路线，原生内存截至think20：

| 变体 | point终点 | 累计native work | 完成/发布 | failure |
| --- | --- | ---: | --- | --- |
| far | (112,816) | 62672 | 未完成，readyThink=null | null |
| far | (1552,688) | 0 | prepare，readyThink=null | null |
| near | (112,816) | 62672 | 未完成，readyThink=null | null |
| near | (1552,688) | 0 | prepare，readyThink=null | null |

这些是读取原memory得到的值，没有事后请求几何或推进模拟。第一条实际收到工作，第二条仍未开算；未将两条都写成已完成，也未把pending写成memory-budget失败。
冷帧独立goal geometry峰值仅6949B/9项，默认33776B/38项下pressure/overflow均0。它与下面动态对局的容量压力分开统计。

[逐think首卡与point状态](ship-58b6b0.blockers.json)、[图/资源诊断](ship-58b6b0.diagnostics.json)、[far精化](ship-58b6b0.cold.far-refinement.md)、[near精化](ship-58b6b0.cold.near-refinement.md)保留具体状态；完整原ID、前置、coarse/exact声明、精化内存与版本在证据JSONL和frames中。

## 顺序、资源与过度行动

40次冷帧使用原初始余额、所选声明与计划时刻，调用正式`projectGoalResources`纯重放，全部met、deficits=[]。pool→装船post的assemble已在图中，清营→运工人顺序也通过；未补余额或事实。
near首次transport-force前仍有2个position-transport前驱，违反“已就位船不需要初始调船”的原断言，20次均失败。没有改断言放过冗余动作。

原记录字段`firstExecutablePlanThink`在far为10、near为null。它按“原图判法通过且有任意ready动作”计算，因此far的10指assemble就绪，不能解释成目标调船/运工人已可执行；两者首次ready仍均为null。[原冷片汇总](ship-58b6b0.cold.json)保留字段原值。

循环生命周期本轮收紧为固定保留全部20次，避免独立assemble或wait-income提前终止目标精化观察。场景构造、计划断言、物理判法与6144额度不变，生命周期diff在证据内。两快照和原a0逐JSON字节相同：far SHA`4f1552e780c76a2d1966646470b744de73436eeb452368df74e1ae4ee28e8a78`，near SHA`e457c849ed51985dcfc184fc02101edc09fd274788b782f26a563fe455a39cea`。K20始终同一snapshot/tick1，仅原生memory和thinkSequence连续推进。

## 原时限执行与动态容量

两局均原8400tick、每15tick一次think，共1120次。实际输出的全局ready始终0，目标两步也从未known/exact/ready。runtime未保留memory，因此未推断执行memory内的发布状态。

| 变体 | 物理里程碑（初始帧起tick） | 原物理判法 | 正式执行 |
| --- | --- | --- | --- |
| far | 553上船；4773军队和工人同时落岛；5000清营；8400未建好厅 | 失败：厅未完成，工人先于清营落岛 | 失败，goal命令0 |
| near | 123上船；843军队到岛；1107清营；4921工人到岛；5612厅完成 | 四项通过 | 失败，goal命令0 |

实际命令来自economy/miningWorkforce/naval/v6Economy/v6General，near另有expansionGarrison。正式命令仍须实际allocator accepted/executor/goal命名、同代token、goal-action与实际SDK返回命令全部匹配；物理建厅不替代这条归属检查。本轮没有走到goal建厅付款。[checks与命令来源](ship-58b6b0.execution.json)、[实际ready种类](ship-58b6b0.ready-kinds.json)保留原值。

| 变体 | 首个dynamic pressure | 末个pressure | 末次request数 / overflow |
| --- | --- | --- | --- |
| far | think16/tick240，30063B，39项 | think560/tick8400，30064B | 39 / 546 |
| near | think71/tick1065，33853B，37项 | think374/tick5610，33854B | 37 / 305 |

far触及38项上限而不是字节上限；near触及33776B字节上限。对应计划标search-pending，未提高限额或清缓存。near之后目标列表为空，没有据此宣称压力已修复。[完整压力诊断](ship-58b6b0.diagnostics.json)保留首末收据。
32在本轮结束后静态核对bridge，只取readyActionIds及其资源/lease；没有等待未来动作全部ready。本轮没有把冷assemble ready、动态ready0解释成“整包全ready闸”故障，也没有混入后续修复。

## 搜索四字段与6144服务账本

| 模式/变体 | think数 | 总queue work | critical-route | existing-field | background-field | 峰值单次 |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| 冷far | 20 | 80479 | 8140 | 3895 | 68444 | 6144 |
| 冷near | 20 | 80479 | 8140 | 3895 | 68444 | 6144 |
| 动态far | 560 | 32114 | 11810 | 0 | 20304 | 6144 |
| 动态near | 560 | 124695 | 109229 | 3934 | 11532 | 6144 |

40次冷计划的search均为work407/expansions407/depth6/limitReason=null。动态每个计划的四字段逐条保留，包含expansion-limit与容量暂停后的0值；没有用status频次代替工作量，未累加累计expansions。全部1160份原有序service账本逐份核对sum=used≤6144。tier是队列原分类，没有将整个critical-route当作搜索或再加上plan计数。

[指标与服务key汇总](ship-58b6b0.metrics.json)；逐think搜索：[冷far](ship-58b6b0.cold.far-search.md)、[冷near](ship-58b6b0.cold.near-search.md)、[动态far](ship-58b6b0.runtime.far-search.md)、[动态near](ship-58b6b0.runtime.near-search.md)；动态精化：[far](ship-58b6b0.runtime.far-refinement.md)、[near](ship-58b6b0.runtime.near-refinement.md)。完整服务顺序、原ID与每次输出在证据JSONL中。

## 独立封存

[证据指针](ship-58b6b0.evidence.json)：`a91fd7e83e6515964b264352b959bfa5f3a99645dede735e74921a7541f8a9a5`，16798366B，a100存储端SHA已复核。
包含40冷+1120动态的原snapshot/output/allocation/commands/work、精化memory、逐plan搜索与6144服务、纯资源重放、point首卡、退出码、源码/文件哈希和复跑/只读分析脚本。完整blockers与首末大图只进证据，仓库保留小汇总。

A100原目录`/codegeex/jeffry/sketch-public-puzzles/evidence/ship-ce20233d`；封存目录`public-planner-puzzles-ship-58b6b0-20261021`；源码归档`archive/public-puzzles-ship-58b6b0-source-20261021`。本轮无热换，0531及abfab原片不变，PR继续draft。
