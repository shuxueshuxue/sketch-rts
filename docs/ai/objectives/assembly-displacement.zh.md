# 集结被抢占的推迟损失

正式集结使用独立的 `AssemblyDelayLossUpperBound`，不采用迁移旧任务的损失上界。父目标、coordinator token、剩余成员与进度保留；抢走成员只改变下一次供给预测，新增或恢复成员仍可加入原方法。

机会 oracle 对已提交集结使用同次、同窗的 before/after 供给与现金流证明。收益下界不能作为被抢损失；当前小组暂时无法单独报价也不能丢失其已知有限上限。逐情景重算首次凑齐时间，未解尾部按窗内不填并使用价值上限，不能拿条件平均时钟代表最坏推迟。

货币 helper 对完整原始现金流计划平移阶段时点、同窗裁剪和重新积分，只计正损失，不把延后付款省下的钱抵扣；无完整计划时，已知有限的整段续行价值 cap 可保守回退。总损失不超过该 cap。价值上限本身未知时仍不抢，`assemblyValueUnknownComparisons` 按每个 think 中唯一的原目标/挑战者对计数，避免重复 gross/net 查询放大数量。移动切换代价在原抢占报价单列，不重复加进推迟损失。

抢占事件的 `displacedLoss.kind` 为 `assembly-delay-upper-bound`，保留窗口、目标、值上限、模式及金额组成。纯事务回归覆盖防守价值高于 cap 时拿走两兵、原进度和两名剩余者保留，下一 think 新兵补回且同 coordinator 继续；该测试不冒充原生路线、真实供给校准或自然 grant 验收。正式 reader 接线和连续运行仍须另验。

正式运行 cap 另由 `assemblyContinuationValueCap` 证明：仅限该矿 mining-established 的 ConquerIsland，使用当帧原生剩余矿量和 mine admission 吞吐上限，在同一窗口内立即满产、无税、P=1、零建造/招募/损失成本，另加该目标持久收益上限。它只界定正式货币结算的正现金流；不引用 imported-task 或迁移上界，也不把这个场景报价成可执行计划。无法确定目标正现金流时仍返回 unknown。整 cap 回退事件直接保留收入/持久收益分项，旁表保留原逐情景推迟证明与 cap 来源。
