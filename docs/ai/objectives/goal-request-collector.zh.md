# 现有 Objective 到目标请求

`collectGoalRequests(objectives, context)` 只转换同次局势评估已有的 Objective；不枚举第二套目标，不调用方法分解，不复制旧动作串。缺兵、缺钱等 blocked 目标保留，完成、失败、放弃的目标不再提案。

`rewardGold` 是原 Objective 的正 benefit 项之和，逐项保留 code 和金额。负 benefit（例如成功后付建厅钱）、cost、原成功概率、score 和 persistence 均不带入。已有收益项自己的折现保留并标注 `sourceBenefitsKeepExistingDiscount`；新计划仍按自身关键路径计算时间价值，不把旧方法的 ETA 或概率当新链的物理结论。

效果直接使用原结构化身份。矿业完成分成 hall-complete 与独立 garrison-ready；没有实际防守交接的矿厅不能冒充整个扩张目标完成。旧 force-present 的数值保持 field-strength，不能改标签成 combat-rating；可加库存仍只有 combat-rating。骚扰目标保留具名敌人 ID。期限使用原效果窗口；DefendSite 另复用原生共同 siteCollapseAfter 的当前 HP/DPS 窗口，不增加紧急度常数。

`withGoalPlannerInput` 省略 goals 时，在同一个 Situation/query/6144 scope 内调用原 generateStrategyObjectives，再转换请求。调用方已有本次 Objective 时可传 objectives；已有正式请求时可传 goals。显式 goals=[] 只做装配诊断。回调内取得的输入不能带出物理 scope 延后运行。

本提交证明转换与原生装配，不证明全部目标已可规划或执行：未来输出评估、战斗候选、持续安全与 garrison-ready 的 achiever 仍必须由同一事实源和动作声明补齐。没有这些证明时保留 unmet/pending，不补零费用或虚构成功。
