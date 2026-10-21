# 冻结世界连续 think 的计划判法

计划检查从单次冷 think 改为最多10次原生 owner think。只在第一次创建快照和 owner memory，之后每次使用同一个快照对象、同一个游戏 tick，并沿用完整 memory（含真实搜索 cache）。
不推进 sim，不改敌军、命令、坐标、钱、ETA 或期限，不改缓存的发布字段，不另外创建工作队列。

每次 think 都在原生物理 scope 内直接调用 `planGoals` 和原来的 `checkPuzzlePlan`。原依赖图、数量账本、先后关系和真实矿厅预留断言均保留。
每次退出 scope 后检查最终原生工作收据不超过6144，并再次检查快照字节未变。正常 Objective collector 没有题库专用目标、收益或概率。

稳定性比较包含真实目标、事实状态、选择的动作图、替代、数量和时间安排；排除搜索工作计数、cache游标和解释元数据。完整值仍写入逐次原始证据。
连续两次图一致且原判法都通过才提前停止；重复的 blocked、waiting-facts 或 ready 空图不会提前结束，也不会因此判题通过。
否则运行满10次，并采用第10次的原判法结果和末两次稳定性，不挑选中间最好的一次。

证据包含第1次、最终一次和全部中间 think 的输入、输出、原断言结果、最终工作收据、memory及快照不变性。
记录器只序列化数据，不调用额外的建址/几何端口，避免证据开关影响下一次 think。

共享层正在把发布边界从世界 tick 改为 owner memory 的 think 序号。正式11帧首末报告须在该提交上重跑；当前不把旧实现同 tick 的重复调用当成几何已续行。
[40e 单次冷帧的0通过/0错误链/11缺口](cold-plans-40e.zh.md)及原始证据独立保留在 `archive/public-puzzles-cold-plans-40e-20261021`。

```sh
SKETCH_PUZZLE_PLAN_EVIDENCE=/tmp/planner-frozen-thinks npx vitest run src/ai/strategy/puzzles -t 'frozen-world dependency graph' --maxWorkers 1 --minWorkers 1
```

执行检查仍等正式 bridge。人工解、构造器与 scope 诊断不计入规划器通过数。
