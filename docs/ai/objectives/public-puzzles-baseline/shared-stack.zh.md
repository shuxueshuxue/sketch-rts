# 共同规划器栈上的题库接线

#585 已 rebase 到 `feat/strategy-goal-planner` 的 `b5c7654c126ac2a223fb672ff4244570054097c4`。
本页记录正式合同接线和共同栈验证；[历史 main 报告](report.zh.md)中的 8/33 只属于原来的 `d4ca2668` 生产代码，不是共同栈的成绩。

## 判法使用的正式合同

- `GoalPlannerInput`、`GoalPlannerOutput`、`GoalActionNode`、`GoalFactPredicate` 直接来自共享类型，不再保留本地只读投影。
- `goalFact` 提供规范事实 ID，`goalCampId` 从实际营地成员生成身份；营地仍由原生 `neutralCampExposure` 识别，不按题号或邻近点猜。
- `projectGoalResources` 从真实输入的 `initialBalances`、当前 epoch 和所选动作的开始/结束时刻重算每个数量资源前缀。已在世界中完成的动作不再重复收支；共享动作只算一次，声明或时刻冲突就报 pending。未知时刻和 pending 都不能算可支付。
- 海军题另外读取真实 `StrategyAllocationTrace`，按矿厅动作的 objective/method/action/generation 对上至少目录价 400 金的未花预留。预测资源时间线不代替实际预留。
- 清滩动作只建立 `shore-safe`，不要求它凭空建立 `camp-cleared`。选中安全远口时检查运输动作的真实 `shore-safe` 前置，不强迫多做一次清滩。
- 近船、已有兵营、三步兵三个变体完整保留，并标记为 `main-passing overaction regression`。它们仍检查不必要的初始调船、农场/骑士和危险近口清滩都不出现。

## 尚未实现的能力与开启方法

32 确认的正式入口是 `goal-planner.ts/planGoals(input)` 和 `goal-world-facts.ts/createGoalFactReader(...)`；在上述固定 SHA 中，这两个模块尚不存在。
[planner-binding.ts](../../../../src/ai/strategy/puzzles/planner-binding.ts) 按实际模块和导出检测能力，缺失原因写入测试名称；文件存在但导出不是函数会直接报错。

原生接线文件 `puzzles/goal-planner-native.ts` 也尚未建立，需要真实 source/搜索/owner-think 接口确定后实现以下三个口：

| 导出 | 输入/输出与责任 |
| --- | --- |
| `createInput(snapshot, owner): GoalPlannerInput` | 使用普通目标收集器、动作 provider、真实事实源及同一 think 的 FactWorkQueue；不接收题号、人工解、预期登陆点或合成事实 |
| `allocation(input, output): StrategyAllocationTrace \| null` | 返回这次规划对应的实际分配器收据，不能手填“预留了 400” |
| `createExecution()` | 返回真实 SDK commandPlanner 和其实际输入/规划输出/分配收据；不回退到现役 AI 或人工解 |

11 个冷帧测试体已直接调用 `planGoals(input)`，再调用正式类型判法，并检查输入冷帧未被修改。
11 个执行测试体通过原生运行口推进模拟，必须出现真实规划器输出，再用原来的执行判法计分。
在缺少上述能力时共 22 项明确 skip；人工解通过和构造器测试通过都不算规划器通过。

首版接线后运行以下严格入口，缺能力会失败，不能靠 skip 变绿：

```sh
SKETCH_REQUIRE_GOAL_PLANNER=1 npx vitest run src/ai/strategy/puzzles --maxWorkers 1 --minWorkers 1
```

## 当前验证

A100，Node 24.22.0。正式合同接线代码提交 `9ac0276da24b3867a78c42a61eb9f4c6937a75a6`；后续 `4431c9b7` 只补充旧基线拒绝执行的说明，未改场景、判法或生产规则。

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

重跑可行性与合同检查：

```sh
SKETCH_PUZZLE_WITNESS=1 npx vitest run src/ai/strategy/puzzles src/ai/strategy/goal-facts.test.ts src/ai/strategy/goal-resource-ledger.test.ts src/ai/strategy/goal-economy-actions.test.ts src/ai/strategy/goal-land-actions.test.ts src/ai/strategy/goal-naval-actions.test.ts src/sdk/package-boundaries.test.ts --maxWorkers 1 --minWorkers 1
```

重模拟继续放 A100/mac1。共同栈上的 witness 脚本输出 `mainBaseline: null`；历史三个房间流派要在已归档分支 `archive/public-puzzles-main-baseline-20261021` 或原始证据的源码提交上重跑。
本 PR 继续保持 draft，等真实规划器首版后再作为第一道验收。
