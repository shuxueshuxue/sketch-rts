# 正式执行输出与分批付款

中心生命周期在应用 goal-action 的反馈时先核实际付款，再核输出槽。执行器传来的 goalOutputBindings / goalNativeJobs 会被剥离；只保留中心上一轮认可的绑定与真实队列观察。complete 缺少必需输出时退为 active / await-output-validation，不释放任务完成。

训练入令时记录实际已有同类己方实体 ID。中心只从已接受的本动作命令、未存在于原队列的新 paid job 建立出生观察；后续要求同 job 消失、实际已过剩余时钟，以及唯一的新同类永久实体。两个新实体、旧实体、异主、错类型、缺少先前真实 job、伪命令或跨槽重复绑定均不能通过。这里证明的是实际原生队列与唯一出生的观察关联，没有按 nextId 或附近位置猜名字；观测间隔内若有无法区分的多重出生则保持待验证。

地基输出必须匹配真实已接受 build 的精确点、种类和主人，不在入令前建筑列表中，并有本动作已核销的实际地基付款。已有付费地基不产生新 output。后续生产仍要独立满足 building-complete，地基绑定不等于完工。

同一训练 batch 的预算按 (acceptedCommandId, native jobId) 逐笔幂等核销，累计金额不得超过本动作预留；同额不同 job 是两笔付款，重放同笔不再扣账。旧执行器继续原先单笔口径。输出 ACK 仍是 execution.state.goalOutputBindings[output] = 实体 ID 字符串，供下一真实 job 的串行提交使用。

测试覆盖同一正式 grant → 共用 gateway → SDK train/job/birth 两次、两笔预算核销及重放、JSON 冷续行、伪 ACK / 无证完成、多出生歧义，以及真实建造输出。它们不是完整 owner-think 或公开题验收。
