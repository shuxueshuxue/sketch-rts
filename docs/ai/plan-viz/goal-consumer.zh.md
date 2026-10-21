# 目标依赖图消费端

#576 保持 draft，固定消费契约为 `feat/strategy-goal-planner` 的 `8afe8a35`。入口是 `AiPlanTrace.goalPlanner?: GoalPlannerOutput`；不调用规划器、事实源或动作 provider，不生成命令、兵力或预算。

当前样稿：[从零造海军，双击打开](goal-navy.html)。它与游戏叠加层使用相同的渲染函数，由 `scripts/export-goal-plan-mockup.ts` 导出，单文件、无需联网。默认按时间推进，点击节点后打开侧栏，支持缩放、查看原始字段和切换时间；也可切换“从目标反推”。

## 公开第 3 题的人工展示

这是公开题“从零造海军”的**版式样例**，不是规划器解题结果。所有页面和截图始终标记人工数据。

- 船厂 170、运输船 240、大厅 400，直接读取游戏 catalog；初始 810 金。
- 展示建船厂 → 造运输船 → 运兵 → 清营 → 运工人 → 建大厅。运兵和运工人共用船，造船同时依赖船厂与金币；大厅需要工人、清空的营地和建造费。
- 资源带先支付 170 和 240，余额保留 400；随后示意赏金 +80、矿工收入 +60，最后支付大厅 400，剩 140。80 和 60 是明确的人工演示金额。
- 当前大厅预留 400 来自样例里显式的正式 budget。图上斜线段延伸到预计付款时间，属于展示投影；不会因此生成或复制一笔世界资源。付款后显示已预留 0、可支配 140；没有预算记录时显示“—”。
- 三帧分别是 tick 50、2100、3600。清营前后和大厅完工由时间轴切换；50 以前及 3700 以后明确显示“未记录”，帧间保持已记录帧。

## 阅读顺序与原始记录

默认从左到右按时间排：最早动作在左，目标完成在右。动作中心对齐预计开始时刻，节点下的横线延伸至预计结束；支出、赏金与收入事件共用同一时间坐标。缩放和横向滚动时，图与金币带同步，竖向可对上哪一步花钱、哪一步入账。实线表示满足条件，虚线表示需要条件，点线表示先后约束；分叉和共享条件继续保留。

条件优先读取 availableTick，否则使用已观测时刻或所选生产动作声明的 start / finish / offset 时刻。缺时间的动作、条件及目标单放“时间未记录”，不拿零点或 deadline 补出 ETA。多个生产者缺任意一个 ETA 时保持未知。

“从目标反推”切换保留目标 → 条件 → 动作 → 前置的阅读顺序，循环记录用前向引用叶子保留。两种模式都只投影视图，不改原始边、ID、方向或计划数据；结构化详情保留原记录。布局限制 200 个事实与动作。

节点和侧栏用中文说明条件、动作、当前进度、预算及结果。pending 路线显示“等路线算完”；缺少执行者、时刻或数值时显示“—”。内部 ID、requestId、执行器代码、原生证据及完整声明收进结构化详情。候选方案仍保留选中/落选、成本、完成时间和原因。

实际执行、分配和预算只关联同一 objective、method、action、generation。当前现金与预留来自 trace；余额曲线直接读取 resourceTimeline 的 before/delta/after，不重新计入收入或赏金。旧代次不能冒充当前执行；未来 output 引用不会变成真实单位。

## 增量、权限与关闭开销

首包完整基线，后续 goalPlannerDelta 按稳定键更新，cache.entries 使用 goalKey；补丁更大时退回整值。旧完整 header 录制仍可读取，历史帧保持不变。目标完成后再次出现会重新起条带；未记录时段不补建。

沿用 all / owner / none 的服务端可见性和现有 debug 入口。关闭视图且未录制时不观察、不构造 trace；关闭时不构造图 DOM。未修改模拟、规则或校验和格式版本。没有新规划器的真实决策、执行或负载证明，后续仍等共同候选和生产端。

## 验证

代码源 `d5ced6379e9010792129c3bf6b4e707b47de124f`：根/CLI tsc 均退出 0，10 文件 54 项通过。新增检查包括默认按时间排序、动作中心与金币事件共用坐标、未知 ETA 不补值、start / finish / offset 生效时刻、分叉与汇合、反推切换、原生边不可变、循环有界、先花后挣及 400 金保护。现有通路回归仍检查零构造、私有过滤、不可变回放、worker、观察开关前后逐命令和逐 tick 哈希一致。

```sh
npx tsc --noEmit -p .
npx tsc --noEmit -p tools/cli/tsconfig.json
npx tsx scripts/export-goal-plan-mockup.ts --check
npx vitest run src/client/ai-goal-plan.test.ts src/client/ai-goal-navy.test.ts src/client/ai-plan-strategy.test.ts src/client/ai-plan-history.test.ts src/ai/plan-output-delta.test.ts src/ai/plan-observer.test.ts src/server/ai-plan-net.test.ts src/ai/plan-observation-gap.test.ts src/ai/think-worker/think-worker.test.ts src/sdk/package-boundaries.test.ts --maxWorkers 2 --minWorkers 1
SKETCH_MACHINES=~/.config/sketch/machines-camps.json bin/sketch yatu ai-goal-plan-contract --ref HEAD --on mac1 --locale zh-CN --json
SKETCH_MACHINES=~/.config/sketch/machines-camps.json bin/sketch yatu ai-goal-navy-mockup --ref HEAD --on mac1 --locale zh-CN --json
```

mac1 使用真实 Metal GPU。游戏场景实际点击候选和预算、鼠标拖到清营后/完工/未记录时段；独立 HTML 从 file 打开并重开。两处均测量 0:10 / 0:25 / 2:30 三次支出的节点中心与金币标记，默认、视图切换、放大并横向滚动 190px 后最大误差小于 0.02 CSS px；候选、预算、结果及未记录处理保持原样。原图逐张查看；SHA256、实际拖动 tick 和来源见 [goal-consumer-capture.json](goal-consumer-capture.json)。本轮不跑胜率 benchmark；未把人工场景当作真实 AI 或性能验收，也未新增完整 src 测试。

CLI 增量复制会漏带 docs 文件，因此独立页面用该源的 git archive 放入 mac1 的独立目录 `runs/camps-navy-preview-d5ced637`；没有覆盖版本缓存。完整副本可直接运行常规命令。

![人工样稿：完整分叉与金币预留](goal-navy-layout.png)
![游戏内人工样例：选中和落选的运兵方案](goal-contract-alternatives.png)
![游戏内人工样例：执行空缺与受保护的大厅预算](goal-contract-execution.png)

[清营之后](goal-contract-progress.png) · [大厅完工](goal-contract-result.png) · [未记录空窗](goal-contract-unrecorded.png) · [游戏内全图](goal-contract-overview.png)
