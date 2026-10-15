# AI 数据流：同一帧内重复工作的结构审查

2026-10-15，只读源码和已有 diagnostics；没有启动编译、probe、测试或计时，没有修改生产代码。读取时工作区 HEAD 为 `3898911213a3dbe9220e3da7a036cd61d84ce552`，工作区含父车道正在验证的改动。以下定位描述实际读到的工作区，不把旧 diagnostics 当成当前候选性能。实施所有权仍在父车道；bootstrap_1 的 rulesVersion 2 分支不在本研究修改范围。

## 先纠正两个容易误判的成本来源

`src/ai/runtime.ts:75–119`：默认间隔 15 tick；收集 dueOwners 后只调用一次 snapshotGame，所有 owner 按请求顺序使用同一 snapshot，再统一 normalize commands。不是每个 AI 都复制一份世界。不能以错峰、降低频率或中途执行某个 owner 的命令来消峰，那会改变当前共享世界帧语义。

`src/ai/policy/snapshot.ts` 已有 snapshot/team 身份查询复用、gold-only view 共享底层 query，以及 identity team map 的默认关系复用。`src/sdk/snapshot/query.ts` 已有 units/buildings ID 索引、owner 分类、首次查询才创建的 range index。`equipment.ts:48` 的 itemsFor 也已使用 items 数组的 itemIndex。不要把这些既有优化再次计入收益。

## 可核对的现有计数

数据来自 `diagnostic/focused-diagnostics.json.gz`，只解析既有文件。scope 时间含 instrumentation、GC/调度影响，嵌套 inclusive 不能相加；这里不作为正式 A/B。

| tick | owner planners | claims 尝试 | script.run 调用 | unitClaims inclusive ms | 全 owner planner inclusive ms |
|---:|---:|---:|---:|---:|---:|
| 0 | 5 | 171 | 166 | 19.798 | 154.591 |
| 15 | 5 | 171 | 171 | 2.268 | 127.937 |
| 6990 | 5 | 171 | 171 | 1.879 | 72.755 |
| 12825 | 5 | 171 | 171 | 5.398 | 24.098 |
| 14370 | 5 | 171 | 171 | 4.633 | 21.973 |

注意 `script.claimsUnits` 计数是 optional-call 尝试，包括未定义 callback，不能宣称有 171 次昂贵 claims 算法。应使用 function-specific 计数再拆分。旧诊断里 shoreSpot 的 exactField 调用：tick 0 为 40,325（6 次 grow），tick 15 为 80,650（全部 hit），tick 6990 为 8,071（全部 hit）。这些是字段查询次数，不是 shoreSpot 调用数。tick 6990 chooseNavalMine/nearestByRoute 有 24 次 exactField、12 次 grow，road 有 12 次 hit；父车道已独立验证该矩阵转置方向，此文不重复接管。

`cold-A-profile/report.txt` 仅 32 tick 的旧诊断显示 aiSnapshotMs max 0.125 ms，AI max 81.977 ms。样本不足以代表全场，但足以说明不能未经证据把冷峰主体归罪于 snapshot 深拷贝。

## 优先候选一：删除物品过滤所制造的“新世界”

`bootstrap_1/loot-recovery.ts:61–65` 的 planLootItemCommands 每次过滤 items，构造 `{...snapshot,items}`，交给 item-tactics。这个视图没有登记到 budgetWorlds，于是 `units(snapshot,owner)`、hostileUnitsNear 等认为它是全新 query。五个 owner 最多产生五个这种独立视图，每个可重建 units 分类、teams 分支和 spatial index；即使本来没有需排除的 item，filter 仍分配数组和新 snapshot。

比扩展另一个 WeakMap 更简单的方向：把“供此次 item planner 选择的 items”作为私有数据输入，世界查询仍使用原 snapshot。item-tactics 内 carried/ground 筛选改为从这一列表取得，单位/建筑/空间查询回到共享世界；不需要新的长期缓存或任意视图继承层。先做最小可逆实验：若过滤没有删除任何 item，直接传原 snapshot；完整解法再拆 items 和 world 输入。

边界：不能直接套 gold-only query 复用，因为 items/groundItems/carriedItems 的语义确实不同；不能让回调读错 snapshot。`StormPointSelector` 是公开任意 callback，当前收到过滤后 snapshot，可能读取 snapshot.items 或身份。因此只在已知 bootstrap stormPoint 的内部路径拆数据，或者明确保留给外部 callback 的原视图。freeItemSlot/itemSlot 也读取 items，不能不加区分地改成原始全量 items。items 数组已存在 index，避免再平行建立另一套。验收需比较完整 commands、传给 callback 的对象身份/内容、query 返回数组独立性，以及无删除/排除 experienceBook/已有 loot task 等边界。

## 优先候选二：lootAssignments 不必物化全部组合再排序

`loot-recovery.ts:31–52`：遍历每个 ground item × eligible own unit；每一对都检查 freeItemSlot/score，再重复 `nearestByRoute(halls,unit)`，再算 retreatLandTravelTicks，创建记录，最后排序全部记录只取第一条。

其中 nearest home 只依赖 map、halls、unit 位置，与 item 无关。一次调用内，可把单位及其 home 的必要投影作为输入，而不是在 I×U 内重复求同一 home。但不应为了预计算把原来没有任何合格 item 的单位也全部算一遍。可在第一次通过 slot/score 的组合才确定 home，生命周期仅此函数；这是一处去重，不建议泛化成跨 snapshot memo framework。

另一种净删除：保留 item-major、unit-major 原枚举顺序，将 `.flatMap(...records).sort(...).slice(0,1)` 改成严格 comparator 更优才替换的单 best 累加，删除 O(IU) 中间对象和 O(K log K) 排序。所有原 route 计算仍执行，不能凭早期 best 跳过可能更优的组合。有限数值时严格 `<0` 保留 stable ties；需针对 NaN/Infinity 明确验证原 sort 的行为，不能偷偷修改错误输入语义。返回第一物品身份、unit.id localeCompare 和 item-major 完全相同。

更大的成本是同函数可能多次调用：直接 lootRecovery claims、shoppingAssignment→lootRecoveryUnitIds、mineGuardUnitIds→lootRecoveryUnitIds、最终 lootRecovery.run 都有入口。静态可见每 owner 一轮存在四个入口，部分有条件，不能说每帧必有四次。已有 diagnostics 没有 lootAssignments-specific call count。应在正式计时结束后验证“调用次数×I×U×退路长度”，再判断是否足以影响峰值。

## 不应直接做：把所有 claims 和 run 合成一次计划

`script-runner.ts:26–69,88–94` 的顺序是 prune memory → 所有 claims（按优先级）→ economy/budget/bookkeeping → tactics/bookkeeping。claims 的输出与 run 的输入不一定是同一 memory 状态。

具体反例：liveLootTask 会写 returning 或删除 memory.loot；lootAssignments 读 memory.unitClaims、creep、raid、mounted；recordAiMemoryForCommands 在 run 之间写 claims。mountedTasks.claimsUnits 的 assign 会重写 memory.mounted、追加 raid recruits；bootstrap naval claims 又显式调用 mountedTasks.claimsUnits，且 mountedTasks 本身仍有直接 claims 入口。mountedTasks.run 已直接消费 memory.mounted，不是又调用一次 assign，不能把它误计为三次纯重算。

`script-runner.test.ts:298–326` 明确测试“后续 claims callback 修改 general 后，readiness 执行必须重算”。combat-readiness.ts 已用同步 scope + 完整依赖值检查，且退出/异常/nested scope 恢复。照抄给 loot 会涉及大量可变 memory dependency，容易膨胀成通用失效系统。

值得探索但应独立设计的是把**纯世界投影**（单位列表、关系、几何候选）与**有序任务状态转移**分离，前者单次生成，后者依原顺序全部执行。不要缓存整个命令结果，也不要把脚本提前执行来“顺便拿 claims”。任何新设计先要求 commands 和 memory 每个阶段的 trace 完全一致，不只 final checksum。

## 优先候选三：消除 owner 查询的重复底层布局

`snapshot/query.ts:99–126,185–239,264–295` 同时保存 unitsByOwner、combatUnitsByOwner、完整 playerEntityViews、hostileCombatUnitsByOwner、nearIndexes。第一次 `unitsFor(owner)` 扫全 units；第一次 playerUnits(owner,...) 又调用 playerEntityViews 扫全 units/buildings，重复 own 分类。每 owner 的 opponent/hostile range index 分别筛全 units；五 owner 可建立最多十份高度重叠的空间布局。

较小候选：让同一 owner 的 own view 与 unitsFor/buildingsFor 使用单一分类结果，删除平行 own 分类储存。公开返回依然 slice，不能把共享内部数组交给 sort/splice 的调用者。若只调用 unitsFor 却为所有 relation 提前分类，可能冷启动更慢；需保持需求驱动，不能“整齐”但增加工作。

较大胆候选：一个全 units spatial layout 加关系过滤，替代每 owner 两套空间布局。理论上初建 O(PN) → O(N)，不改变 tick/AI 频率。但现有 nearIndexes 首次调用冻结 membership，而 isOpponent 方法直接读可变 options.teams；无脑将 membership 改成每次读取 teams 会改变 first-read 语义。范围 API 的 matches callback 必须只对原集合中、距离合格的实体调用，且顺序相同；不能让外部 callback 看见先前被 owner 关系过滤的单位。query 的所有返回 fresh arrays、第一 ID 胜出、source order、sparse slots、非有限坐标 fallback 都要保留。

因此该重构不是现在就给每个查询加一层 cache。先以计数证实相同 units 数组被 indexCells 构建多少次、各 index 实际查询多少次；若大多很少查询，直接扫描或单布局才有价值。当前 range-index.ts 已在 <32 项、超大范围、非有限参数时走 plain scan，不要重复做自适应阈值优化。

## shoreSpot：热 hit 洪流比单次冷字段更值得看

80,650 次 exactField 全命中说明某个冷峰仍可能由“正确地缓存、却反复问同样的问题”组成。shoreSpot 内的 halls/guns/towers/敌方 halls 只依赖当前 snapshot、owner、teams；gapOf 对某 shore 与 hall 集合的距离也不依赖 water。water 只影响海域 membership 和 held，despiteGuns 只影响枪威胁门控。

当前代码已经有 bestGap 单遍选择，islandPlan 也已按同一水域复用 coast；不要再建议 sort→argmin 或复制同水域缓存。剩余具体入口：navalStep:223 普通 shore，失败后 :230 permissive shore，返回 issue closure 后 :243 在非 preparedShore 路径重算普通 shore。其他 island/assault/raid 也调用 shoreSpot。当前 preparedShore 私有路径已经存在，可能与主车道工作重合，必须先协调。

净简化候选是在同一受控调用内生成一次 shore 候选投影（gap/owner-side/placement/敌塔），同时得 strict/permissive 两个结果；issue 消费准备结果，而不是重跑全 shore scans。边界是 NavalWant.issue 属于延迟闭包：外部调用可能在期间修改 snapshot、teams、builders。不能把普通公开 navalWant 的重验证静默删掉；仅已证明不变的同步内部路径可使用 prepared结果。共同投影也应保留原短路：不需要 permissive 的情况不要额外评估所有 gun/placement。新增记录的内存成本必须小于省下的查询，优先只持有两个 best，不构造全 shore 列表副本。

## 明确不采用的捷径与下一步证伪指标

- 不错峰 owner，不缩减单位、路线、思考次数、预算；不移到计时外。
- 不全局 memo claims/run；任意 callbacks、memory mutation 与 budget snapshot 边界有实质语义。
- 不把返回列表改成共享数组：现有 query 注释明确允许 sort/splice；resources/mercenaryCamps 甚至保留原数组并有原地排序调用，所以不能把“整个 snapshot 完全不可变”当成新前提。
- 不把 item slot 检查诊断为每次扫描全 items：已有 itemIndex。仍可能反复分配局部 occupied Sets，可单独计数但不是首要结构目标。

正式序列结束后，最小新计数只需：每 owner/snapshot 的 createSnapshotQuery、indexCells、lootAssignments 次数，loot pair/home/retreat 次数，shoreSpot 次数及 gapOf/placement 次数。用函数调用计数与对象身份标记，不重新采全部CPU profile。对照条件必须包括无 item/no deletion、多个 carried items、同 world 不同 gold视图、非 identity teams、claims/run之间 memory修改、nested runner/throw、owner顺序与旧snapshot复用。

推荐验证顺序：先物品视图“不删除就不新建”及私有 input 分离；再 loot 内部 home去重/streaming best；再共享查询布局。shore prepared改动先确认没有重复主车道。目标是删掉被反复物化的世界/候选/布局，而不是叠加一套通用缓存依赖图。以上均为待测设计，不宣称10×，也不因当前正式候选的局部收益而判定上限。
