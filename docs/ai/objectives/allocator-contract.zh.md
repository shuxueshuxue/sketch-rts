# 正式分配与执行器契约

状态：接口先行，基于 #564 的 `35676cad`（main `646cf9a0`）。本提交只加入类型与可选字段，
不注册分配器、执行器，不初始化正式记忆，也不改变命令。实现依据
[战略目标层设计](strategy-layer.zh.md) §3.3–3.5、§5.1、§7 第 2 步。

公共入口是 `src/ai/strategy/allocation-types.ts`。32 负责正式表、事务、命令入口和观测生产端；
37 负责方法报价、防守与夺岛执行器、policy prepare 拆分和死亡归因；27 负责观测消费、增量与展示。
23 的陆地目标仍只报价，陆地执行迁移另做。

## 权威状态

`AiPolicyMemory.strategyAllocation` 是正式控制的唯一持久根，与 `strategy.observation` 分开。
`StrategyAllocationMemory` 保存目标、每个行动的独立进度、资源租用、单位分配、预算、航次、救命空缺、
实际下令记录、安全阻塞和有界事件日志。数据只含 JSON 值；数值必须有限。不得保存 snapshot、Situation、
单位对象、函数、读取器、缓存引用或 previous 链。构造记忆时仍不自动创建这个字段。

同一 snapshot、完整 AI memory 和确定的 provider 集合必须生成逐字节相同的下一份正式表。
稳定排序和 ID 只依赖输入及持久计数器，不依赖墙钟、缓存冷热、进程寿命或调用顺序。
`revision` 标识一次正式事务；`ActionToken={actionId,generation}` 标识父行动的一次生命期，
普通 think、预算更新、战术移动不改变 generation。替换或重新启动父行动才生成新 token。

`objectiveId`、`methodId`、`actionId`、`assignmentId` 在同一承诺期间稳定；事件 ID 由 owner 和
持久 `nextEventSequence` 生成，带 tick 与 revision。事件只保留最近窗口及未确认交接，确认后可以裁剪，
不能裁掉仍被订单、安全阻塞或交接引用的事实。具体容量与性能上限由实现和实测另行给出。

正式表初始硬上限为每席 256 KiB，按实际 UTF-8 JSON 字节计数；具体记录上限统一定义于
`strategy/control.ts` 的 `STRATEGY_ALLOCATION_LIMITS`。其中事件最多 256 条（通常保留最近 128 条，
另保留未确认交接），单位订单最多 512 条，去重命令最多 256 条，安全 blocked 最多 64 条。
只删除已无当前订单/阻塞引用的命令、已经确认且超过日志窗口的事件及失效父行动的阻塞。
活跃条目超过数量或字节界限必须抛异常，不能为了达标删除仍在履行的承诺。

## 租用、预算和到岗

每个实体只有一个物理键 `unit:<id>`，陆军、工人、船均如此。生产队列用 `queue:<buildingId>`。
甲板乘客仍各有单位租用，不能因为已经登船就又当作岛上可用战力。旧任务须先由统一入口导入为
`origin=imported-task` 的占用，保留来源和 taskId，不能假装这些兵闲着。未知旧任务损失保持未知。

`FormalAssignment` 区分 assigned、en-route、on-station；救命状态另放 `interruption`，保留原归属、
恢复阶段与 vacancy。ETA 用绝对仿真 tick，unknown、conditional、unreachable 都显式表示，不能用 0 或
Infinity 替代。命令被接受只表示下令成功，装载、航行、卸载、到岗必须由世界事实证明。

`ForceQuotation` 的已到岗、在途、不可用成员集合互斥。有效战力只由已到岗与按 ETA 折算的在途成员兑现一次。
`camp-force` 必须调用目标营地相关的整组 `creepForce(group,camp)`；它受整组击杀时间影响，
加入或移除一个单位都重算整组，不能累加单人 camp-force，也不能替换成 `SituationUnit.strength`。
普通 field-strength 仍复用现有强度函数。治疗中的原成员不贡献战力，补位和恢复也不能重复计算同一缺口。

一笔实际支出只有一个语义 `spendId`。例如同矿的 wait-income 与 build-hall 指向同一笔 400 金，
缺工人的 75 金也只能计一次。借兵与训练是替代方法，各自报价，不一起预留。
`paidGold` 与未支付预留分开；已花的钱不能作为未来抢占损失再扣一次。
方法候选先用 `ExecutableMethod.spends` 声明语义支出，每个行动通过 `spendIds` 引用它；
wait-income 与 build-hall 引用同一个 ID。描述性的 gold demand 不再独立产生预留，缺失的支出引用必须报错，
分配器不能从 intent、目标位置或文案猜一笔钱属于谁。
`includedUtilityTermCodes` 关联已经进入效用的费用，`externalReservationIds` 关联尚未迁移的储蓄，
统一入口核对同一笔现金，不能另开一个可重复花钱的池。`budgetProjection` 只是展示兼容投影。

## 方法与边际报价

`AllocationMethodProvider.buildMethods` 消费数值 Situation、目标和该目标既有行动/阻塞，给出可执行子图；
前置不满足时保留具体需求和替代方案。留守交接是落厅后的完成效果，不能作为所有扩张的出发准入。
`quote` 只评估分配器传入的成员与预算，不能暗加别的兵。候选成员必须来自结构化数据，不能解析 reason 文案。
`materialize` 可将方法骨架按候选成员和船只具体化，生成实际载荷所需的船数、支出和前置子图；
随后必须对具体方法重新 quote，并在提交抢占前核清完整成本，不能先承诺“一艘船”再发现需要两艘。
具体化通过 `voyagePlans` 给出逐船 manifest、水侧点、同次验证的陆侧点及真实船/生产前置引用。
每个行动的 `unitIds` 是候选 bundle 的明确子集；缺省只是尚未绑定的骨架，不允许执行器全军选人。
`materialize` 与 `quote` 都显式接收本方法现有 executions，真实出生的 createdShipId 才能解析生产引用，
已经执行过的 action token、state 和 semantic spendId 在重具体化时保留。

`MethodAllocationQuote` 把 feasible 与 blocked 分开。可行项有真实效用；blocked 的当前 utility 为 null，
带缺失前置、可知的条件潜在效用，未知时仍为 null。不能用 0 或负无穷混进可行排序。
效用统一为 `P × benefit − cost + persistenceBonus`；失败仍支付的成本不乘成功概率。

分配器比较“再给一份资源后的整组报价”与当前报价的差值，按边际效用贪心分配；跨方法比较替代方案，
相同效果及父子支持目标的收益不重复兑现。前置子图可以成为下一步行动，不能把条件未满足直接当作停止计划的理由。

从 A 借资源给 B 必须同时有可核实的 B 边际收益、A 未来损失和切换成本，且严格满足
`B 增益 > A 损失 + 切换成本`，并遵守最短驻留与持久 challenger 计数。
任一报价未知时不能按零偷兵。发给 A 的 `preempted` 事件先为 pending，A 回答 shrink、pause 或 fail；
归属变更、交接和新 grant 同属一个事务，不能等 A 自己把少人误判成阵亡。

## 执行、下令与反馈

`StrategyExecutor.execute` 输入目标、方法、该行动独立状态与 `ActionGrant`，只在获配集合内做战术选择。
输出命令提案、下一行动状态、已观察进展、实际失败原因和交接答复。命令注明 task 或 life-saving，
由统一入口给出 commandId 与接受/拒绝结果；执行器没有自己的全军选兵通道。
`ExecutorReason` 直接复用 #574，正式事件另用结构化 code/factIds/values，不把解释字符串当决策事实。

统一入口先建立控制上下文，再调用有副作用的 prepare。受控任务的 prepare/run 消费 grant；未迁移的
陆地扩张等候选入口也必须尊重正式 lease，不能先抢写成员/claim，再等末端删除命令。
这一处 policy.ts 拆分由 37 完成，32 接统一入口，避免并改。

所有命令类型，包括 board、follow，以及工人、船和队列命令，都验证同一份资源权属和预算。
脚本 runner 的旧 board 占位只有在 grant 提供实际抢占事件、事务修订号和对应单位时才解除，
不能全局关闭 board 保护。反方向的 board 同样不能绕过正式占用。

`IssuedActionCommand` 按 ID 存一次，`IssuedActionOrder` 记录实际单位订单与来源命令的关联。
接受提案不等于订单已经在世界生效，故 observedOrder 可以为空。后续 safety 只能捕获实际被打断的订单，
不能从已经被覆盖的旧意图恢复。
`CommandAdmission` 记录实际 source、执行器、父 token、修订号、purpose 和接受/拒绝原因；
只存在于本次事务的 trace，不形成保存上一轮完整解释的链。未知投递 tick 保持 null。
runner 的可选 admission hook 在旧 claim/order 过滤与 onCommands/记账之前运行，所有命令类型共用闸口。

现金只为当前可运行阶段预留：蓝宝 N(e) 的 424 金能先付 240 金造船，后续 400 金矿厅等待收入，
不能以完整链资本 640 金为由阻断第一步。完整链成本仍进入报价。同一矿厅的 wait-income/build-hall
引用同一 spendId，不重复预留。`payments` 必须带接受命令和原生队列/地基证据；
队列无 native id 时用命令前基线及真实新增位置验证，不能把 commandId 冒充 native jobId。

救命动作可以立即执行，但保留 A 的租用，产生 unavailable/vacancy；下一 think 统一补位。
`SafetyBlockedQuote` 必须带有效父 token、实际原订单及下令器、被占工人/单位租用、未支付预算、
营地成员/敌塔/实际路段或落点，分别报价续行、改派、清障和放弃。替代费用及已计入支出明确分开。
父行动被新战略或玩家改令替换时，在同一输入立即释放占位和未支付预留；安全暂避本身不算替换。

航次保存真实乘客与计划船员的区别。每次 think 重新评估继续、停装、返航或改目的地，
按已经走过的航程和剩余路线定切换成本；已上船的兵不能瞬间变成岸上回防兵。
`departure/destination` 保留水侧航点，`departureGround/landingGround` 是同一次规划已经验证陆块的陆侧点，
执行器直接消费并核实，不再从水侧点另猜岸。清营 refuge 复用这个实际陆点。

共享 `arrivalWeightedForce` 对每批相同 ETA 的成员重评整个队伍，按到达顺序折算整组边际；
在岗兵完整计入，在途贡献按 `1/(1+ETA/评价窗)` 折算。同一成员不能同时出现在两组。
防守概率使用折算后的有效兵力及实际塔掩护，资源占用成本仍按真实获配队伍和耗时计。

attack-site、contest-route、counter-harass、recover-site 的最终执行 intent 在第 3 步陆地切片才启用，
本切片不会据类型存在就注册这些执行器。第 2 步合并前再逐项审计其余字段的实际消费者与测试。

2026-10-20 17:45 的 incumbent 边界：只有真实来源可核对、当前订单仍在推进的旧任务才导入 committed lease。
仅刷新的 claim 加 idle 订单属于 observed/proposed；可行新方案选走后发 candidate-reassigned，旧任务清理预留，
不伪造零金抢占损失，也不计入 preempted。候选重分配在 8 次 think 内重复时单列来回改派诊断。
旧存档缺少真实 commandId/执行器/接受 tick 时保持 unknown，不能补造已执行的来源。

2026-10-20 22:00 的迁移例外：真实旧任务已有来源，但剩余计划不能完整重报时，允许用其目标的
**全部潜在效用上界**收费。当前只证明了采矿终态的包络：同一估值窗内，目标矿从现在立即以原生
税前产能上限满产、成功率为 1、所有成本为 0，再加该目标最大的已知 persistence。它不声称旧船
能立即满产，也不据旧任务的未知 P 或未知补员曲线收紧上界。其他终态、缺目标、缺产能或缺对应
采矿目标均仍为 unknown；正式分配不能使用这条迁移例外。

新方案的净边际价值已扣除该上界，仍须严格大于切换成本，并取得旧下令器的 shrink/pause/fail
交接确认。岸上 board 的取消不收费，但新方案仍用真实到岗 ETA；已在船中的返航/卸载成本未知时
不批准抢占。事件 quotation.displacedLoss.kind='upper-bound'，bound 保存窗口、目标和逐项事实，
而正式任务为 remaining-utility。原生命令重放指标 upperBoundPreemptions 单列这类抢占。
同一批被取走的多个已执行任务保留各自 displacement，推测的次优方案不能从记录中覆盖它们；
机会成本不低于这些实际任务损失之和。同一目标的重复报价仅保留最大边际损失，不重复收费。

当前分支已实现但尚未注册控制入口的组件包括统一闸口和分阶段资本/原生支付校验。
E01 原生场景验证六个 board 订单只接受正式回防，旧脚本 onCommands 收到空集；
N(e) 场景验证分阶段资金、原生支付、旧队列不能重复抵账及 JSON fork 一致。
这些组件测试不代表整个分配器已完成行为或性能验收。

## 观测与死亡归因

正式输出位于 `AiPlanTrace.strategy.allocation`，与 observed/proposed 表明确区分。
一般尚未获得分配的需求保存在 `unmet`，与救命中断后的 `vacancies` 分开，两者都进入正式 trace，
展示端不需要从人数倒推缺口。落厅后转入 DefendSite 的驻守交接原子转移同一租用并发出 `lease-transferred`，
中间不经过“释放为空闲兵”的状态。
32 负责将其接入真正房间 runtime/think-worker 的 `AiThinkObservation.trace`；关闭观察时只执行数值路径。
27 负责单位位置、稳定 ID 增量、历史和叠加层，保留初始完整基线与旧录像兼容。

死亡归因优先引用正式 objective/method/action/assignment 和实际订单来源，旧任务推断仍保留为 inferred。
`ActionIntent.clear-camp.memberIds` 只对应正在执行的真实清营；整个 ConquerIsland 不代表过路时被野怪击杀
就是正常清营战损。所有单位包括工人、召唤物、船都要有归因。

## 验收与迁移边界

此接口提交只跑类型检查与完整 src 测试，不宣称行为验收。实现之后用真实帧 E01/E02/E05/E06、N(a)–N(e)
验证本土受袭召回、岛上防守、抢占交接、救命空缺和借四兵加一班船的计划链；冷/热、另一 owner 预热、
目标逆序和存档 fork 的正式表及 trace 必须逐字节一致。

最终联合候选使用同一 main 的 7 海图加 4 陆图控制局，记录逐席目标、首次夺岛/扩张/出击、空闲兵力秒、
A-B-A、响应到岗时间、异地执行时丢据点、完成数、进攻占比、抢占分布及全部死亡双向表。
首次行动不能变晚，异常不能转成更高战损。37 采集行为与死亡，32 验正式表和 ABBA，mac1 至少两局观测录像。
延迟按固定驱动/串行数值路径三轮 ABBA，p95/max 中位数比值均不超过 main 的 110%；解释成本另列。
2026-10-20 16:44 的新增验收：每个行为切片还须用 26 提供的冻结 main646 房间 AI 对打工具，
在 11 图、多种子、交换出生位的对照中至少不输；整轮重构以明显胜出为目标。待工具冻结后统一运行，
不以临时自建的胜率比测替代这项验收。
#564 的只读性能收尾继续独立进行，任何正式控制变化都不能混入其对照源码。
