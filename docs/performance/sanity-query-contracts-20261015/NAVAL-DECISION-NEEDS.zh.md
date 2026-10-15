# 从决策需要的信息重新推导：岸点最优解是否需要在当前 tick 求出

2026-10-15。仅阅读工作区源码与既有诊断，未运行编译、测试或 probe，未改生产代码。本文不提出字段缓存、压缩或最近点循环微调；目标是删除调用者根本不需要的最优解计算。生产实现仍由父车道所有。

## 结论先行

当前有三个明确的岸点查询只需要“至少存在一个完全合法岸点”：navalStep 的无船坞分支选择、assaultPlan 的目标可达性筛选、raidPlan 的海域筛选。它们现在求完最优岸点后丢掉坐标。可用同一岸点判定实现，在存在性模式遇到第一个合法见证立即停止；实际建造仍按原有规则求最优点。

全面改成“廉价意图 → 只有经济竞争胜出才判断可行性”则不等价：goal 是否存在已经影响 save 停购、reserve 和 goalAges，naval plan 又写入当前 tick 的 memory 并被 tactics 消费。因此真正可等价拆分的是 **目标身份/存在性 → 最优执行细节**，不是一概推迟所有可行性。

## 每个调用者到底需要什么

| 位置（src/ai/policy/naval.ts） | 当前用途 | 当 tick 最少必要信息 | 能否不求最优岸点 |
|---|---|---|---|
| navalStep:220 附近 `!yard && !shoreSpot(...)` | 选 shipyard 分支还是 coastTower/无目标分支 | strict 合法岸点是否存在 | **可以**；坐标没有保存/使用 |
| assaultPlan:1013 附近 | 按既定目标排序，选择首个有船坞或有岸点的目标；保存 targetId/landing | permissive 合法岸点是否存在 | **可以**；返回坐标被丢弃，外层目标选择顺序不变 |
| raidPlan:1081 附近 | 按既定 door 排序，选择首个能服务的水域；保存 water | strict 合法岸点是否存在 | **可以**；shoreless 记录只依赖布尔结果 |
| navalStep 的 shipyard issue:239 附近 | 找最优 shore，再从其附近选 builder，输出建造坐标 | 原规则最优岸点，原 tie-break | **不能**换成首个见证；但本来已在 issue 阶段 |
| navalStep permissive shore → nearest hall/gun → coastTower | 选 towerSite/shoreTower，且可能返回 undefined | 原最优 shore 及相应 hall/gun；这些影响目标存在性与坐标 | **不能直接**换见证或仅延迟坐标 |
| islandPlan:970 附近 | shore → departure → chooseNavalMine 距离排名；保存 mineId/landing | departure 的确切位置影响 mine 选择 | **不能**换任意岸点 |

`despiteGuns=true` 也不是“随便有水就行”：仍受 own/enemy hall 距离、敌塔、可建造、可达陆地/海域等约束。存在性查询必须保留完整 admissibility predicate，仅停止优化最优性。

## 决策链与不可提前丢弃的信息

`collectV6Goals`（v6/economy.ts:115）先建立 economy，再生成 supply、workers、threats、capabilities、wants、expansion、outpost、naval、engineering、shop、capacity。navalGoals 调用 economy.naval，返回 want 后将其 id/cost/issue 包成 goal；priority 普通60、closeout80、save=true。

bootstrap 的 rankBootstrapGoals（bootstrap_1/economy.ts:116）增加其他目标后，先 `ageV6Goals`，再 productionReserve、wanted/supply 等过滤和 purchase 去重。意味着**后来会被过滤掉的 goal，也可能已经更新 age**。不是只有最终执行或可负担目标才进入 memory。

`ageV6Goals`（v6/economy.ts:453）：创建/更新每个候选 id 的 `{since,seen}`，每6秒等待增加1 priority，最多20；未出现超过10秒清理。stable priority sort 后，planBootstrapEconomy 才遍历执行。执行包括 producer 去重、productionReserve、研究 goal.issue 的提前调用、labs 去重、naval reserve、save/break、issue、hold、supply、command记录、gold扣除，最后删除 bought goal 的 age。

因此 cheap description 至少要给出：

1. **是否存在以及精确 id**：决定 age 记录、去重和后续分支；naval:shipyard 与 naval:coastTower 不能互换。
2. priority/closeout、cost、save、hold、producer：决定排序、预算和是否阻断后续便宜购买。
3. 本轮 goal 生成时产生的 memory 写入：不能推迟到胜出后才发生。
4. issue 可以晚求的坐标/单位选择：只要它们没有参与以上三项，且调用时读取状态/顺序保持一致。

## 钱不够，为什么仍算导航？先核事实再解释

既有 `sanity-max-architecture-20261015/diagnostic/initial-snapshot.json.gz` 显示 tick0 六个玩家都是 gold=500、supplyUsed=3、supplyCap=8；catalog 中 shipyard cost=170、townHall cost=400。所以不能把 tick0 的峰值解释成“本来就买不起船坞还计算”。可能是在高优先目标扣款后不足，或预算视图/预留资金使某次消费不可负担，但需要执行 trace 证明。

代码上，rankBootstrapGoals 在本地 gold 扣减循环之前运行；它拿到的是当前经济视图的 gold，不是所有高优先购买后的余款。可行 naval save goal 即使现在不能购买，也会阻止低优先支出或积累等待优先级，故非冗余。

`navalBudgetReserve`（naval.ts:90）本身**没有 shoreSpot 调用**。它看远端矿、正在 settle 的 ferry、现有矿剩余量、pending hall、localExpansionAvailable，返回 hall/transport 预留金额。这是一项预算决策，不应把所有 shoreSpot 归到 reserve 身上。它可能在 script-runner、economy执行或 outfitting 中重复，但本文不以缓存它作为答案。

`planNavalWant` 还调用 outfitting/islandPlan/assaultPlan/raidPlan。后三者按 PLAN_RETRY 或失效条件写入 `memory.naval.{island,assault,raid}` 的 tick 和目标；planNavalTactics 同一 tick 会再次消费这些计划。islandPlan 的 `if (!income && gold < townHall.cost) return` 已经存在，但有收入时低 gold 不触发这条阻断。不能另加笼统 affordability guard 后称等价。

## 全面 winner-only feasibility 的最小反例

**不存在的贵目标阻断便宜购买。** gold=100，naval目标若存在则 priority=60、cost=170、save=true，另有 priority=50、cost=50 的可执行目标。真实地图没有合法 shore：旧逻辑不产生 naval goal，买便宜目标。若 cheap 阶段先放一个未验证 naval placeholder，执行到它时直接因 gold不足 break，则什么都不买。若因买不起直接丢掉 placeholder，在“有合法shore”的镜像地图又错了：旧逻辑应存钱停购。

**当前命令相同但 memory 不同。** gold不足且没有其他购买，旧逻辑在合法shore存在时更新 `goalAges['naval:shipyard'].since/seen`。新逻辑推迟到资金够才创建，未来竞争排序不同。只比较当tick命令看不出这个偏差。

**坐标决定目标存在性。** 无 strict shore，需要 coastTower；最优 permissive shore 对应的 gun 无合法 tower site，旧逻辑返回 undefined。改用另一个可建塔的见证 shore 会新建目标，改变行为。反过来也成立。

**经济失败但海军任务仍需要计划。** 经济 goal 未胜出，不代表已有舰队/乘客不需要 memory.assault/raid/island 的目标。把这些写入也推迟会改变 tactics，不能靠只测 economy commands 认证。

## 一个真正更懒、又能保持语义的流程

把“可行性”拆成不同信息等级：

1. **describe**：读取现有任务与廉价前提；能确定不存在就不创建。目标身份尚依赖地理分支时标记待证明，不能伪造 id/age。
2. **admit**：只证明目标是否存在及其分类。上述三个布尔岸点调用到首个完整合法见证即停；维持原有 memory 写入、年龄和预算规则。必要时仍需失败穷尽。
3. **realize**：仅到原 issue 的时机求最优坐标、builder、placement。shipyard 的最优岸点自然属于这里；实际发出的点仍按旧规则。

这个结构允许删掉“每个候选都算一次最优解，然后winner再算一次最优解”的第一份工作，但不会谎称 admit 对所有地图都是廉价。需要证明不存在时仍可能扫描全候选；cold shoreSpots 本身的生成成本也仍在。若目标必须从全局最佳 departure 决定（islandPlan），则精确语义要求那部分最优信息现在就求出。

若用户愿意改变“只有已证实可行的目标才开始aging/save”和规划memory更新时间，才能进一步实行全面 intent-based aging + winner-only feasibility；这是一项AI行为设计决定，不能自动归类为等价优化。

## 建议仅做这一项小实验

**仅给现有 shoreSpot 增加“只需存在性”的内部需求参数，复用同一 predicate 和同一枚举；接受首个合法 spot 时立即返回。只在上述三个布尔调用点启用。** 不新增缓存、目标索引或第二套生产算法；所有要求坐标的调用保留原最优流程，现有 best逻辑也不为此次实验重写。

存在性必须保留 `gap < Infinity` 的含义，不能让两边都不可达的 Infinity 被误接受；原 `gap>=bestGap` 在 bestGap=Infinity 时排除它。新逻辑可以省掉找到见证后的所有候选评估，而不是近似路径或缩短必要检查。

等价论证：旧算法返回点 iff 存在至少一个通过全部约束的候选。布尔消费者无法观察点的最优性。首次见证与最终最优点的 truthiness 相同，所以外层target/door选择、goal id、memory、aging不变；issue仍求原点。内部地形缓存冷热变化是代价变化，不是游戏规则变化，但必须测整帧及后续帧防成本转移。

一次判别实验（由父车道在计时结束后实施）：在既有 tick0 原始输入上 A/B 对比完整 command frame 和每 owner memory；分别计数这三个调用点访问的 shore候选数、找到首个见证的位置、仍需穷尽的失败次数。另记录所有 point-consuming调用是否返回同一坐标。检查有/无合法shore、敌舰封锁但可建tower、无tower site、同分岸点、gold100与500、tick0后至少两次goal aging阈值和一次PLAN_RETRY。反例测试必须保留上面save阻断和age时点。

预期证伪条件：若成本主要来自“完全无可行shore”的查询或首次生成 shore候选，exists模式不会有数量级收益；这应推动重新设计目标语义边界或更早的精确不存在性证据，而不是继续在同一循环里雕刻。若多数查询早有见证却继续求最佳，删除剩余最优化才是主要收益来源。
