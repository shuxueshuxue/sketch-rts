# 集结供给预测

`forecastForceAssembly` 只估计供给，不下训练、移动或付款命令。当前获配、可借现存兵和显式恢复服务按各自来源陆块的 rally ETA 入账；真实已付队列按原生逐 job 时钟完成，使用与原生出生同一升级属性结算，预测 job 始终保留 buildingId/jobId，不能当作出生实体。多个 posts 的到岗成员并集只评一次整组 camp-force，不把各单兵或各岛的评分线性相加。

旧经济持续产兵是 `conditional-incumbent-production` 独立条件层。模型 `joint-hurdle` 使用同一历史窗口的联合 producer 情景，保留相关性和零供给质量，不相乘独立概率。每次 gross/net 都按当前成员、允许 lane 和实际占用重求首次凑齐。P_fill 是窗口内凑齐的情景概率之和，T_fill 是成功情景的条件均值；不得用无条件均值率的慢时间再乘失败概率。每条情景的 readyTick、概率和生产占用完整保留，续行按各自时刻和组结算，再对成功情景归一；外层只乘一次 P_fill。

条件量纲明确为自然 `combatRating`，是整组 camp-force 的下界；不能把营地免费齐射的整组协同线性分给 producer。原净库存曲线允许下降，有限支持期外不延续末端库存。样本从原 epoch 对齐到当前 epoch 后，当前已付队列又按各 producer 的实际管线推迟条件层，推迟量及每个原采样时间由输入与输出可复核。离散采样按右连续阶梯求首次凑齐，保留量化误差。无法将局部 lane 占用归属给单个未来出生的库存列，保守整列删除；成功条件速度分支则按半开时间占用扣除服务时间。两种分支都不填补被排除的资源。

管线按各 producer 独立累计，不能用慢厂挡住快厂。原生 queue 工作先入账，再判断该 job 到 rally 的路线收益是否可兑现；路线未发布不能提前释放队列。最后一 tick 的确定到岗与此前条件供给合算。条件供给只在显式 paid-job 管线之后开始，避免同一出生重复；research 不阻塞 training。production uses 只保留成功情景凑齐前需要的占用，合并为保守并集。

运行时情景上限为常量 `ASSEMBLY_SCENARIO_LIMIT=64`。超限仅该 forecast 输出 `unknown`、原因 `scenario-limit`，`diagnostics.scenarioLimitCount=1`，不会抛异常终止玩家 think。测试、同次报价诊断与后续 11 图审计须累计此计数；真实对局触发仍是待解决问题。其他目标可继续报价。

两层在支持的比较窗内仍不够时是已知 `needs-production` 及缺口；未发布实际路线、缺 job 身份、未报价恢复、超出经验曲线支持仍保留对应 unknown。没有校准默认 P=1，也不制造未来成员。当前纯模块尚未接校准/控制 wrapper，不代表自然 grant 或 18000 tick 行为验收通过。
