# 8934：正式owner入口的11题真实执行

**新规划器执行通过0/11。** 11局完整推进至原时限，共5520次真实owner think；每次都从正常collector经正式控制入口规划、分配和执行，没有正式ready动作，也没有`goal.<kind>`命令被接受。
近船和弱滩头两题的物理目标全部达成，但发令来自仍在控制路径中的原有脚本；这两题未计作新规划器通过。

固定生产基底`89342199976127342a153bd8479e987f905a532e`，实际运行源码`2618247e85261df1548890a5ff15ab5af889d8e7`，A100 / Node24.22.0 / `v9_knight`。
源码归档`archive/public-puzzles-owner-execution-8934-source-20261021`。8e/97的后续garrison增量没有混入；此前[f27/K20](domain-f27.zh.md)和[a576/5ca缓存对拍](geometry-capacity.zh.md)继续保持各自来源。

## 执行接线与验收归属

`createExecution`直接调用`planAiOwnerCommandEntries(..., {strategyControl:true, observeBootstrapPlan(...)})`，使用实际SDK的owner、version、source、teams与持续memory。
不提供goals、scripts、事实、reward或grant，不另跑一个规划器。回调读取`actual.goalPlanner`和`actual.project().allocation`，保存这次真正的输出、预算、lease、执行与gateway命令回执。
每条正式命令必须对上accepted/executor/goal命名、真实action token及同代`goal-action`执行，并实际出现在owner返回的SDK条目中。

适配合同的正例使用普通物理目标：正常AttackSite collector生成destroy-target，真实lease/gateway发出`goal.destroy-target`，SDK单位收到攻击订单。该合同通过，只证明接线有效，不占11题的成功分母。

公开执行继续使用原SDK think分相和三tick命令延迟、原场景、原敌军入侵命令、原时限及全部物理判法。
在这些原判法之后新增“确有正式goal执行命令回执”的要求，避免仅有goalPlanner旁路输出、实际由原有脚本达成目标时产生假阳性。本轮两个物理达标局正是在这一项被拒。

## 逐题实际结果

所有行的新规划器验收均失败，正式ready/正式发令首次时刻均为null，正式命令数均为0。下表单独保留物理成绩，不混成0或2的同一口径。
时限按游戏秒，事件时刻以下用相对起始帧的tick；20 tick为1秒。

| 题与变体 | 时限/秒 | owner think数 | 物理达标 | 实际行为/失败原因 |
| --- | ---: | ---: | --- | --- |
| 船在别处：远船 | 420 | 560 | 否 | 兵和工人均在4773登陆，营地到5000才清；顺序不符，未建好矿厅 |
| 船在别处：近船 | 420 | 560 | **是** | 清营、后运工人、5612建好厅；只有原有脚本发令，正式goal命令0 |
| 人口：农场→骑士 | 180 | 240 | 否 | 2428清营，但没有规定的农场→骑士→清营顺序 |
| 人口：已有兵营 | 180 | 240 | 否 | 1763清营，但没有先训练两步兵的要求 |
| 从零造海军 | 480 | 640 | 否 | 318时建厅保留金已被花穿；虽有船厂和运输船，未把兵运上岛、清营或建厅 |
| 守家：约90秒遇袭 | 480 | 640 | 否 | 754已登船去岛，后方受袭；主厅丢失，未守住，也未建好岛厅 |
| 守家：约360秒遇袭 | 480 | 640 | 否 | 主厅存活、7265消灭来敌，但岛厅和规定的往返时序未完成 |
| 滩头：八步兵 | 420 | 560 | 否 | 走远滩并清目标营；未按要求先清近滩 |
| 滩头：三步兵 | 480 | 640 | **是** | 走安全远滩并清营；只有原有脚本发令，正式goal命令0 |
| 穷矿强营 | 420 | 560 | 否 | 2130上穷矿岛，6187打目标营，后在岛上建厅；本土扩张未完成 |
| 守不住撤离 | 180 | 240 | 否 | 1484已救回工人，2392又把大陆兵送往岛上，违反禁止送死增援 |

原物理checks、全部里程碑、死亡、最终资产与实际脚本发令计数见[机器可读执行表](execution-8934.summary.json)。
实际发令来源包括economy、miningWorkforce、naval、v6Economy、v6General等原有脚本。它们是本次正式控制入口的实际产出；没有用另一局旧AI结果替换本局。

## 计划与资源的具体阻塞

同一源码还完成了11帧的220次冻结世界计划检查，仍0/11；首末状态和首次可执行指标见[8934冷帧表](execution-8934.cold.json)。
f27原片进一步按候选原声明分开的[现组成本/风险与未来绑定表](domain-f27.zh.md#当前编组估价与未来绑定分开看)也已补齐：急迫守家28个destroy-target的duration已知，cost/P仍`movement-observed-exposure-unquoted`；build则是`build-worker-binding-pending`。两类缺口分别保留。

真实对局末帧另有6局保留`goal-geometry-pinned-capacity`。这里只列实际计划pressure中的字节和requestIds数量；没有在本轮放宽默认限值或重跑measurement。

| 末帧所在局 | pressure字节 | pressure请求数 |
| --- | ---: | ---: |
| 守家：晚到 | 35383 | 29 |
| 守家：急迫 | 33969 | 30 |
| 滩头：八步兵 | 34067 | 36 |
| 滩头：三步兵 | 33252 | 39 |
| 船在别处：远船 | 33825 | 31 |
| 人口：骑士 | 34563 | 22 |

固定源码的默认容量仍33776字节/38项。这些是各局末帧记录，不是整个对局的完整工作集峰值；不据此重新设容量。
冷帧海军题的实际资本回执适配仍未导出：直接planGoals不会授予资本，不能用这里已存在的执行预算旁路替它填一个400金预留。
当前应继续分别补现组风险报价、未来pool/projection、持续保护证明与容量压力，接口合同正例不能代替这些题目通过。

## 验证与证据

根tsc、tools/ai tsc、SDK package-boundaries与执行适配正例均exit0。完整题库为**36通过、22失败、11跳过，exit1**：

- 36通过：原35个构造/前提/scope/绑定，加1个真实正式执行接口正例。
- 22失败：11个冻结计划、11个已开启的真实执行；两项物理成功被正式发令归属要求拦住。
- 11跳过：本轮未启用的人工合法解。执行检查已全部开启，未用skip隐藏失败。

未跑全量src。相对8934没有自有生产AI/SDK/sim改动；场景和原物理断言保持原样。11份初始snapshot与原a0帧的JSON字节一致。
5520个逐次记录全部解压、解析并核对owner think序号、同tick的6144工作上限、实际命令/admission/执行身份；规划期间物理世界未被改写，SDK视图自有列表的排序沿用其正常语义。
内存只保留首个非空计划与最新完整观察，逐次真实snapshot/output/allocation/commands/work以独立gzip成员同步写盘。

```sh
env -u SKETCH_PUZZLE_GEOMETRY_MEASUREMENT -u SKETCH_PUZZLE_WITNESS SKETCH_PUZZLE_PLAN_EVIDENCE=/tmp/puzzles-8934/cold SKETCH_PUZZLE_EXECUTION_EVIDENCE=/tmp/puzzles-8934/runtime npx vitest run src/ai/strategy/puzzles --maxWorkers 1 --minWorkers 1
```

在A100/mac1复跑。[完整证据指针](execution-8934.evidence.json)包含冷帧与5520份真实执行输入/输出、实际资本/lease/发令回执、物理结果、测试和退出码、源码/文件哈希、分析与复跑脚本。PR继续draft，不合并，不将本轮改标为后续共同头通过。
