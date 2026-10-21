# 488cfd83：near真实运兵到岛，far第107次超限中断

**near完整跑到8400 tick，正式运兵到岛；清营、运工人和岛厅均未完成。far仅106次完整think，第107次因allocation达280600B抛错。** 这不是两局完整时限的0/2报告。

固定生产`488cfd832cd4fd0452506ca134c7ae4a7591ac85`、原验收源码`2478e44dd55f7a5896db17b235613a12358c7c84`。原far/near快照、真实collector/owner入口、场景和判法与上一轮保持不变；6144/think、严格导航闸、256KiB authority上限不变。新结构判法代码另交，未热换本轮。

## 原执行覆盖与失败边界

| 变体 | 完整 / 尝试think | 最后完整tick | 结果 |
| --- | ---: | ---: | --- |
| far | 106 / 107 | 1590 | 中断；未产生终局物理评估 |
| near | 560 / 560 | 8400 | 原时限完整；仅armyTransported为true |

far第107次没有observer member、afterMemory或服务账本，未补造或重建。原全时限后处理拒绝mixed coverage：standard exit1、chain exit1，authority读实际记录exit0。之后使用单独命名的审计脚本锁定far106/107和near560/8400，不修改原校验器；原拒绝日志一并封存。[覆盖审计](ship-488cfd83.coverage.json)、[原执行与错误](ship-488cfd83.execution.json)。

far最后完整t1590 authority为256237B，仅5个执行，未见旧版47个终态积累。32对原同帧的只读分解发现运输actionId长4078字符，optionId内重复嵌套转义的泊位/粗档provenance，并被复制进租约、命令与事件；107的真实异常为280600B。此处保留根因定位，不冒称后续身份修复已通过。

| 原完整记录 | authority峰值 | executions | events | assignments | leases | issuedCommands | issuedOrders |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| far 106/t1590 | 256237 | 27589 | 68469 | 58563 | 29230 | 26032 | 23005 |
| near 38/t570 | 252570 | 21506 | 60488 | 57428 | 28530 | 33560 | 28263 |

以上是已完成observer记录的UTF-8 JSON.stringify字节数，不代替失败107的缺失内存。[逐think authority](ship-488cfd83.authority.json)。

## 真正发令与物理里程碑

| 变体 | 首集结 | 首调船 | 首运兵 | 首清营 / 运工人 / 建厅 | accepted命令构成 |
| --- | --- | --- | --- | --- | --- |
| far | 10/t150 | 15/t225 | 106/t1590 | — / — / — | assemble14、position-transport3、transport-force4 |
| near | 8/t120 | 76/t1140 | 14/t210 | — / — / — | assemble7、transport-force9、position-transport5 |

表中为accepted命令的think/tick，逐条核同代goal-action token、gateway和实际返回SDK；不是阶段完成时间。wait-income单列，不当物理命令。far106只有4条board发令，后续已中断，不能外推登船或到岛。[完整命令与依赖记录](ship-488cfd83.chain.json)。

near运输原片与37独立核验：t210 gen3向原4foot下4条board；snapshot t255首次1人cargo，t300原4人全cargo且有同代5份租约；t975执行complete/delivered，4人HP145、无deck/cabin，固定488原生region component均为目标land:2。完成后租约释放符合终态。

原逐tick物理判法更早记录army-boarded=241、army-on-island=961；它们与15tick采样的t255/t300/t975证据分别保留，未混成同一时刻。原终局检查是armyTransported=true，其余islandHallComplete/campCleared/safeWorkerSequence=false。[运输首令独立审计](ship-488cfd83.first-transport-audit.json)、[装卸和目标region独立审计](ship-488cfd83.transport-audit.json)。

## 上岛后的首卡点

37沿完整原流定位：think66/t990首次出现集结精化pendingReasons=`movement-observed-exposure-unquoted`；think67/t1005首个非空六原子图仍卡该项。两个原gzip member已逐字节匹配canonical流对应offset，见artifact的independent-member-verification.json和derived-488-postlanding/。

末560/t8400同一条链仍以assemble waiting-facts开头，显式前置没有unmet；clear-camp在等force-at，工人运输还等site-safe。营地清理报价已知，不能把这个缺口写成缺营地成本/P或又混入新兵。

37另用固定488 movement assessor与同帧已发布有限land-field进度作独立诊断：具名暴露源为目标营地两只idle murlocPeon，路径未触及150 alert，却被650 pursuit/response范围计作未报价暴露。该判断是域诊断，不是新模拟或清营执行成功；诊断脚本、原帧和风险JSON随artifact保存。后续修复不混入本轮。

## 冷帧：新旧两种判法并列

| 变体 | 原完整数值hash稳定 / 原通过 | 末三次图断言 | 新结构稳定（只读派生） | 数值变化项 |
| --- | --- | --- | --- | ---: |
| far | True / True | [True, True, True] | True | 0 |
| near | False / False | [True, True, True] | True | 19 |

按总指挥18:28新约定，最后3次选中动作种类、顺序、动作依赖和参与者集合相同即结构稳定；动作ID中的数值身份归一为选中序号。时间、坐标和报价变化单列。near末三次结构相同，运输航时[669,669,719]、landing.ground.y=[304,240,304]，共19项delta。32已定位为native point于18完成、19才发布后正常重报价，海场未变；不是旧缓存逐出循环。

原near K20失败、不稳定和原Vitest退出码保持原值。新列仅从同一原20片纯投影，不重新调用AI/事实/寻路/模拟，也不改本轮结果。[完整结构与数值delta](ship-488cfd83.structure.json)、[原K20](ship-488cfd83.cold.json)。

新运行判法在e0b2edad实现、746bec49完成fixture类型收口，[判法文档](../planner-puzzles.zh.md)同步原因；从下一轮源码起使用。新代码在独立A100目录验证：根tsc/tools-ai exit0，9项结构合同与7项SDK边界通过。它们不是488原正式轮的新执行成绩。[独立检查](ship-488cfd83.stability-checks.json)。

## 预算、精化与报价原值

| 模式/变体 | 实际think数 | queue总work | critical-route | existing-field | background-field |
| --- | ---: | ---: | ---: | ---: | ---: |
| cold/far | 20 | 61608 | 11472 | 16355 | 33781 |
| cold/near | 20 | 67874 | 10861 | 8209 | 48804 |
| runtime/far | 106 | 206831 | 83541 | 26465 | 96825 |
| runtime/near | 560 | 498242 | 193192 | 77641 | 227409 |

666动态+40冷帧共706份实际receipt逐份核有序服务和=used≤6144；缺失far107不计。search的work/expansions/depth/limitReason逐份保留；work合计同think回归，expansions不重复加。完整服务ID/work在artifact，Git指标省去巨大唯一key数组，汇总/首末值不变。40冷资源前缀以原余额重放，deficits均空。

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
| runtime/near | position-transport | 75 | 76 | 76 | 76 |
| runtime/near | transport-worker | 85 | 85 | 85 | — |
| runtime/near | assemble | 4 | 7 | 7 | 8 |

| 模式/变体 | quotes | empirical | α | outsideSupport | pending |
| --- | ---: | ---: | ---: | ---: | ---: |
| cold/far | 700 | 140 | 560 | 560 | 0 |
| cold/near | 700 | 140 | 560 | 560 | 0 |
| runtime/far | 1022 | 742 | 280 | 280 | 0 |
| runtime/near | 4174 | 3950 | 224 | 224 | 0 |

模型计数是报价观察次数，不是战斗或独立样本数。原duration/cost/P、选中声明、支持范围和现金前缀都保留。[指标](ship-488cfd83.metrics.json)、[原ready种类](ship-488cfd83.ready-kinds.json)。

## 原进程与封存

| 变体 | 进程退出码 | 选定6条原断言：过 / 败 / 跳 |
| --- | ---: | --- |
| far | 1 | 4 / 1 / 1 |
| near | 1 | 3 / 2 / 1 |

两变体各独立单worker进程，两份原Vitest JSON/argv/退出码完整保留；派生12项只取各自6项，7过3败2跳，aggregate exit1。原source2478根tsc/tools-ai/SDK exit0，未跑全量src或其他题。[原进程](ship-488cfd83.processes.json)、[完整验证](ship-488cfd83.validation.json)。

[完整证据指针](ship-488cfd83.evidence.json)：SHA`f11134ec7ff14e695cef3ef521c3d95b43d9e062b2cc173267feba7aae249f7b`，156966038B，A100存储端SHA已核。含原cold/runtime和结果、前后memory、706账本、原失败full-guard日志、单独mixed审计脚本、SDK/租约原值、装卸与清营前原member、独立审计及新旧判法只读投影。

原源码归档`archive/public-puzzles-ship-488cfd83-source-20261021`；新判法归档`archive/public-puzzles-structure-stability-20261021`。12ec/58ed旧归档不变，PR继续draft，不合并。
