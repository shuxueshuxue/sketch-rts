# 清营后的据点资产风险

`assessPostBattleSiteRisk` 与守家报价共用 `createThreatIntentQuery`、`defenseThreatScenarios`。实际攻击/接近本站的军队进入每个情景；远方 hold 或正在执行其他目标的军队仍是潜在改道，按 `r/(e+r)` 的时间赛跑估计出现概率。每个情景保留真实整组兵力，再计算矿厅存活率，最后求概率期望。不能先把敌力乘改道概率，再交给非线性的战斗概率模型。

调用方传入 `response`，表示移除本报价组之后、其他足额援军的共享响应事实。缺少响应事实且存在潜在组时，结果为 unknown。明确没有其他响应与响应尚未求值是两种不同事实。`assessDefenseResponse` 的 `metric` 默认为 field-strength；用于营地/新厅模型时显式传 camp-force，同时复用真实单位的 creepForce 和静态塔的 structureRating，不能混入 SituationUnit.strength。未来矿厅的 `plannedAssetRadius` 与最终存活评估一致。

第一场条件胜利已解决的成员由 excludedEnemyIds 排除；真正完成清营之后，应改用当前快照仍存活的成员，不能继续假设它们已经死亡。窗口内实际到达与召唤物寿命继续沿用同一 ETA/availability 事实。几何可达不能证明敌人已经在前一阶段自行改道；潜在组的赛跑 ETA 保留观察时的完整几何时长。

`opponentForce` 保留所有已知潜在敌援都参与时的上界，供诊断；它不再作为确定会来的一支平均军队使用。`actualOpponentForce` 是实际组加覆盖本站的敌塔。存活率读取 `scenarios` 的互斥期望；空威胁集仍可直接证明存活率为 1。该模型没有预测未来未观察到的敌兵、追击或敌方战略。
