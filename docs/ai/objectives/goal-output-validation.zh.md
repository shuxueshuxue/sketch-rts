# 正式训练数量与建筑输出

训练按原生 job 与区域池数量记账，不追查出生来源，也不产生 unit output / 实体 ACK。`goalTrainingReader(memory,snapshot)` 返回同 epoch、同 command / producer / job / kind 的 training、cancelled、pending 或 fulfilled；fulfilled 的 creditedQuantity 为 1。adapter 只提交已获准的原生训练并读取该结果，后续清营、运兵等动作从实际池里另行取兵、租用。

`recordAllocationCommands` 只给正式训练记录兵种及 mover-region 的数量基线。`observeGoalTraining` 先观察已实际付款的新 native job：提前消失、已获准取消或连续性损坏的 job 永久 cancelled，之后另一厂的同类新兵不能复活该笔预期。正常退出并经过剩余原生工作时钟的 job，还须对应池总量的实际增加足够才能兑付。并发同种 job 共用池账，增量只分配一次；没有待完成 job 时下一批以新的实际余额开窗。净数量不足则 pending。

同一 batch 预算按 (acceptedCommandId, native jobId) 分笔幂等核销，同额不同 job 是两笔付款，重放同笔不再扣账。训练 complete 由中心再次核足量 fulfilled job，反馈自带实体绑定会被剥离。建筑仍按精确地点和原生地基绑定：须与 accepted build 的坐标、种类、主人、入令前列表及实际付款一致；已有付费地基没有新 output，地基存在也不等于建筑完工。

没有修改 sim、GameCommand 或快照 schema。测试覆盖真实 gateway → SDK 的双 job 数量兑现与两笔付款/重放、JSON 续行、取消 A 后 B 厂出兵仍保持 A cancelled、两厂并发增量不重复、伪绑定和真实地基输出。此处不是完整 owner-think 或公开题验收。
