# 共同规划器栈上的题库接线

计划判法使用冻结世界下最多20次原生think，沿用同一快照和memory。[f27领域装配结果](domain-f27.zh.md)已完成，仍0/11通过，保留新候选及现组估价、未来绑定、容量压力的具体原因。
[当前8934正式owner执行](execution-8934.zh.md)另完成11局/5520次真实think：0/11新规划器通过、正式ready/发令全部未出现。近船和弱滩头物理达标，但正式goal命令0，未计为规划器成功。
[此前a576/5ca缓存对拍](geometry-capacity.zh.md)保持自己的来源和通过结论；更早a0/82b/40e原片也独立保留。

#585 的共同栈以 main `d36d0543b04077b44690bf4dae9dabb92f5a34a5` 为祖先，当前固定 `feat/strategy-goal-planner` 的 `89342199`，没有混入随后8e/97的garrison增量。正式owner路径已接正常collector、planGoals、实际allocator、goal执行和gateway，执行适配已受测；接口合同正例不算公开题成功。
11个计划验收已全部开启，最多20think。此前40e单次冷帧为通过0、错误动作链0、缺能力11；[旧逐题表与补能力表](cold-plans-40e.zh.md)保留历史来源。下方各固定SHA的skip数字也仅作历史验证记录。
本页记录正式合同接线和共同栈验证；[历史 main 报告](report.zh.md)中的 8/33 只属于原来的 `d4ca2668` 生产代码，不是共同栈的成绩。

## 判法使用的正式合同

- `GoalPlannerInput`、`GoalPlannerOutput`、`GoalActionNode`、`GoalFactPredicate` 直接来自共享类型，不再保留本地只读投影。
- `goalFact` 提供规范事实 ID，`goalCampId` 从实际营地成员生成身份；营地仍由原生 `neutralCampExposure` 识别，不按题号或邻近点猜。
- `projectGoalResources` 从真实输入的 `initialBalances`、当前 epoch 和所选动作的开始/结束时刻重算每个数量资源前缀。已在世界中完成的动作不再重复收支；共享动作只算一次，声明或时刻冲突就报 pending。未知时刻和 pending 都不能算可支付。
- 海军题另外读取真实 `StrategyAllocationTrace`，按矿厅动作的 objective/method/action/generation 对上至少目录价 400 金的未花预留。预测资源时间线不代替实际预留。
- 清滩动作只建立 `shore-safe`，不要求它凭空建立 `camp-cleared`。选中安全远口时检查运输动作的真实 `shore-safe` 前置，不强迫多做一次清滩。
- 晚到敌军题读取真实矿厅的 `site-safe` 效果在 start/offset/finish 中的生效时刻；保护须在敌军到达前激活且覆盖该窗口，不能把发令开始或独占兵力的 lease 结束误当到岗时刻。
- 近船、已有兵营、三步兵三个变体完整保留，并标记为 `main-passing overaction regression`。它们仍检查不必要的初始调船、农场/骑士和危险近口清滩都不出现。

## 尚未实现的能力与开启方法

`goal-planner.ts/planGoals(input)` 已由 32 在 `acb13825` 导出。[planner-binding.ts](../../../../src/ai/strategy/puzzles/planner-binding.ts) 静态导入这个真实函数，绑定测试检查函数引用相同，不再把搜索本身当作可缺省能力。
`goal-world-facts.ts/createGoalFactReader(input: GoalWorldFactInput): GoalFactReader` 已在 `026799d7` 导出，题库同样静态绑定，并检查函数引用相同。输入需要同次 owner-think 的 Situation、ports、memory 等，不能用人工事实替代；未来投影、完整安全和海上出生能力尚未闭合。

`withGoalPlannerInput` 已提供，省略 goals 会在同一次 Situation 中生成原有 Objective 并转换请求。`puzzles/goal-planner-native.ts` 已实现 withInput，使用新的正常 collector/收益来源，不返回已离开物理 scope 的输入。执行适配现已接正式owner入口；冷帧的实际预留适配仍缺：

| 导出 | 输入/输出与责任 |
| --- | --- |
| `withInput(snapshot, owner, memory, run)` | 已实现：通过共享正常 collector 和 `withGoalPlannerInput`，在同 Situation/query/FactWorkQueue/物理 scope 内调用 run；沿用调用者的memory，不接收题号、人工解、预期登陆点或合成事实 |
| `allocation(input, output): StrategyAllocationTrace \| null` | 尚未导出。必须返回这次规划对应的实际分配器收据，不能手填“预留了 400” |
| `createExecution(options?)` | 已实现：正式SDK commandPlanner调用受控owner入口，从actual读取真实GoalPlannerOutput及分配回执，完整输入/输出流式写入证据；内存只留首末观察，不接手写目标或人工解 |

11 个冷帧测试体已在 run(input) 回调内直接调用 `planGoals(input)`、正式类型判法和预算断言，并检查输入冷帧未被修改。回调未发生或执行多次都不能通过；不再跳过海军的计划判法。
11 个执行测试体已全部开启，沿原SDK时序推进模拟，保留全部原物理判法，并要求真正的goal执行命令已被gateway接受。
当前11个冷帧检查和11个执行检查均失败；近船/弱滩头物理达标但正式goal命令0的事实单独保留。人工解、scope诊断、构造器或接线合同通过均不计作公开题成功。

每题另有一个明确命名的原生 scope 诊断：用空 goals 只检查实际 cold frame 的唯一 Situation、同一 6144 队列、严格导航授权、scope 恢复和快照不变性。它不声明目标收益、不检查题目计划、不算公开题库通过。

全部计划及执行判法已经默认开启。严格入口仍会在适配丢失时拒绝skip；目前同样真实失败：

```sh
SKETCH_REQUIRE_GOAL_PLANNER=1 npx vitest run src/ai/strategy/puzzles --maxWorkers 1 --minWorkers 1
```

## 先前合同验证（b5c7654c）

A100，Node 24.22.0。正式合同接线代码提交 `9ac0276da24b3867a78c42a61eb9f4c6937a75a6`；后续 `4431c9b7` 只补充旧基线拒绝执行的说明，未改场景、判法或生产规则。
这一版的源码保留在 `archive/public-puzzles-shared-contracts-20261021`，下面的收据仍对应当时的固定 SHA。

| 检查 | 结果 |
| --- | --- |
| 根 `tsc --noEmit -p .` | exit 0 |
| tools/ai `tsc --noEmit -p tools/ai/tsconfig.json` | exit 0 |
| 全部题库 + 共享 facts/resource/economy/land/naval 合同测试 + SDK 边界 | 14 文件，69 通过，22 等待实现而跳过，exit 0 |
| 上一行中的人工合法命令解 | 11/11 通过，只证明当前模拟规则下局面可完成 |
| 动态 TypeScript 入口加载 | 调用真实 `goal-facts.ts`，并核对原生场景营地身份；包含在 69 项中，不算规划器验收 |
| 严格模式，仅选择远船/近船的冷帧入口 | 预期 exit 1：2 项因缺少真实入口/接线而失败，未冒充行为验收 |
| 在共同栈调用历史 main 模式 | 预期 exit 1：生产代码已变化，拒绝标成旧 main 基线 |

未运行全量 src。原始日志、源码哈希和退出码见 [shared-stack.evidence.json](shared-stack.evidence.json)。

## 首个真实搜索导出的验证（acb13825）

接线代码 `b24f54945667bdf8a988517ec4b717559b1a47d2`，A100 / Node 24.22.0：
这一版源码保留在 `archive/public-puzzles-search-entry-20261021`，本段只记录 rebase main 之前的验证。

| 检查 | 结果 |
| --- | --- |
| 根与 tools/ai tsc | 均 exit 0 |
| 题库、全部 goal 合同测试、SDK 边界 | 16 文件，77 通过、22 明确跳过，exit 0 |
| 真实搜索导出绑定 | 题库绑定与 `goal-planner.ts` 导出的函数是同一引用 |
| 原生人工合法解 | 11/11 通过，不计作搜索器的行为成绩 |
| 严格冷帧入口 smoke | 预期 exit 1，两项仅因事实源/原生接线缺失失败，搜索导出已存在 |

没有给搜索器手填 Situation 或事实，也没有用它自带的小声明域算法测试冒充真实题库通过。未运行全量 src。
原始日志与源码哈希见 [search-entry.evidence.json](search-entry.evidence.json)。

## rebase main 后的验证（8ada3fbe）

共同栈已以 main `d36d0543` 为祖先，题库基于其 `71b13eca` 初测，再接入 `8ada3fbe` 的共享修复。
A100 / Node 24.22.0，最终代码 `370e24be82b50d3a45bb4f4e2b5e993acc2ae5d1`：

| 检查 | 结果 |
| --- | --- |
| 题库、全部 goal 合同测试、SDK 边界 | 初测 21 文件，112 通过、22 明确跳过，exit 0；人工合法解 11/11 |
| 根 tsc | 初测发现共享搜索展示节点的 nullable 时刻类型错误，exit 2；32 的 `8ada3fbe` 修复后复跑 exit 0 |
| tools/ai tsc | 初测及修复后均 exit 0 |
| 修复后的搜索与陆地动作复测 | 2 文件、12 项通过，exit 0 |
| 真实入口严格 smoke | 预期 exit 1，事实源/原生接线仍缺失，不计作规划器验收 |

初测源码为 `f7f01c8a`；共享修复前后，题库、SDK、sim 和 bootstrap 源码逐字节相同。
本轮没有改动相对共享基底的生产代码，也未运行全量 src。22 项仍等待真实 source 和 owner-think 装配。
原始日志、退出码、源码哈希与初测源码 bundle 见 [main-rebase.evidence.json](main-rebase.evidence.json)。

## current-world reader 绑定（026799d7）

接线代码 `d1c92dc5de454d302225a775f24b06f6d0da1999`，A100 / Node 24.22.0：
根与 tools/ai tsc 均 exit 0；reader、共享导出绑定与 SDK 边界 3 文件、12 项通过，exit 0。
严格冷帧 smoke 仍预期 exit 1，两项只报原生接线缺失，真实 reader 不再作为缺省能力。

本轮不重跑人工解，也不把 reader 自带的原生营地/路由合同测试计作公开题库通过。22 项计划/执行验收仍未开启。
同 Situation、同 query、同 FactWorkQueue 的 owner-think 装配，以及未来投影、完整安全/海上出生能力仍等共享栈完成。
原始日志与绑定哈希见 [world-reader.evidence.json](world-reader.evidence.json)。此前 main rebase 源码保留在 `archive/public-puzzles-main-rebase-20261021`。

## 原生 owner-think scope 诊断（2988f233）

接线代码 `da495241e0d766b07464040abfee775880064a55`，A100 / Node 24.22.0：根与 tools/ai tsc 均 exit 0。
题库、正式输入/reader 合同和 SDK 边界共 11 文件、58 通过、22 等待真实能力而跳过，exit 0。
58 项包括 11 个空 goals 的 scope 诊断和 11 个人工合法解，均不算规划器解题成绩。

每个 scope 诊断都核验唯一 Situation、与 currentFactWork 相同的队列、6144 上限、严格导航授权、scope 恢复、无分配发令及冷帧不变。
正常计划检查已改成 `withInput(..., run)`：搜索、资源投影和实际预算断言都在 run(input) 回调中执行，不能返回悬空输入再搜索。

32 确认正常 `GoalRequest` collector/效果收益口尚未交，不能用题库手设 rewardGold 代替。
因此 scope 诊断只传空请求以验证原生装配，不宣称推导了题目的计划；全部 22 项计划/执行验收继续跳过。
严格冷帧 smoke 按预期 exit 1，只报告目标收集/估值适配及 bridge 缺失。combatOptions、未来评估投影、完整安全与海上出生能力也仍待闭合，blocked 不当作已证不可行。
本轮未跑全量 src。日志、退出码和逐文件哈希见 [owner-input.evidence.json](owner-input.evidence.json)。

重跑可行性与合同检查：

```sh
SKETCH_PUZZLE_WITNESS=1 npx vitest run src/ai/strategy/puzzles src/ai/strategy/goal-*.test.ts src/sdk/package-boundaries.test.ts --maxWorkers 1 --minWorkers 1
```

重模拟继续放 A100/mac1。共同栈上的 witness 脚本输出 `mainBaseline: null`；历史三个房间流派要在已归档分支 `archive/public-puzzles-main-baseline-20261021` 或原始证据的源码提交上重跑。
本PR继续保持draft。当前已完成真实冷帧及8934正式执行首轮，结果均0/11；按缺口表补齐后再固定新头复测，接口存在不代表题库通过。
