# Stage14：尾部诊断与 bucket 分配取证

本 scope 固定归档两次原始 focused profile（A=`0ea5bea`、B=`1cfcc0e`）及一次独立 `0ea` bucket 分配计数。原整局目标仍 **FAILED**，联合候选 `1cf` 保持 **HELD_PENDING_FOCUSED_TAIL_ATTRIBUTION_NOT_ADOPTED**。没有新采用结论、产品 PR、合并或部署。

六个 CPU 窗口均通过原时钟区间、非负 delta 和样本数量验证。5280 本次未复现旧慢样本：两 arm 各108次 land exactField 均命中，无 miss/grow/evict；这不能否定旧反例或给出 GC 原因。1859 主要覆盖发船调用链，10950 覆盖 sea goal22916 的恢复链，各只有一次 miss/grow。B 没有独立 grow 采样不等于没有代价。采样区间和重叠的 inclusive wall 不能替代精确 CPU 时间或因果证明，不能从函数名推断动态 owner。

独立 bucket 计数只捕获 tick0 与6990 两组，均 phase2；每组原路径成功初始化8个 Int32Array，累计 payload **6,635,776 B**。mover 未捕获，保持 null。它不证明一 land 一 sea、16次 malloc、峰值、分配率或 CPU 收益。

583个原路径完整保留，包含全部命令、stdout/stderr、UTC、exit、原始 CPU profile、完整14400 ticks、初始快照、command frames、source 图、预检和失败历史。规范化路径与 SHA、大小、原模式见 `manifest.json`；相同内容由完整逐 byte 比较后显式 alias，不省略任何原路径。另封两 head 的原 commit 和所需 tree bytes，离线逐项认证241个 source blob，不复制完整生产树。

原 v2 失败与 v3 预检均保留。首次分析后整树检查因新生成10,458 B pyc 退出1；原55工具源512,808 B与32个 raw 文件未改，pyc 按原授权迁移到分析证据目录，工具树恢复，分析器没有重跑。原派生明文4,066,636 B超过2 MiB预算；后续三份新派生 JSON 无损 gzip 并 roundtrip，首次预算失败不改写成通过。636,774 B收据早于最终 manifest。准备期 hash-helper NameError 与唯一实际 bucket reader attempt01 exit0 分列保存。

`python verify.py --out . --compare-originals` 完整比较本 scope 的 gzip 解码与仍在 `/tmp` 的原件；`python analyze-native.py` 仅从本 scope 重算 source、完整 commands/initial/final、所有 phase/entity/owner 行、原 CPU 交集与 leaf/inclusive/source qualification、原数值计数和独立 readback 输入闭合，不运行应用。原 Python 分析器在只读虚拟归档文件系统中重放，Git callback 由已认证 portable source bytes 提供；产生时间字段不作数值等同要求。

旧九 scope 的3,876个 gzip 工作副本已经稀疏化，Git blobs/refs 与固定提交完整保留。本轮明确不重跑 SDK14，也不把缺少旧 payload 的目录遍历称作完整旧 scope 验证。历史 Stage13 的完整 SDK 实际为13/14，唯一原 Stage5 命名断言失败仍归属其原报告；断言和旧文件未改。以后重跑完整 scope/SDK 前须 hydrate 对应 payload，或明确使用 Git 对象完整逻辑读取的方法和限制。

压缩前原件库存固定于2026-10-15T05:36:04.463394+00:00；后续10950 progressive 输入计数及新候选属于后续独立阶段，本 scope 不借用它们的性能结论。[前一固定 Stage13](https://github.com/shuxueshuxue/sketch-rts/blob/a6aa7996a1bb34b5e70d78a0cb29ad1dcdd266ef/docs/performance/rules3-stage13-naval-hull-combined/README.zh.md)。

存储协议为最多32 MiB全部新增临时空间，保持至少32 MiB空闲；工作 payload 与 Git loose 两份、索引锁、portable、工具与收据一起计量。Git 禁用自动 GC/maintenance，以单线程 `pack-objects --stdout` 推送，不生成本地 pack/spool。固定提交正常 TLS 全字节读回 README、manifest、闭合报告及最大 payload，并校验 gzip 解码 SHA。闭合后仅本 scope tracked gzip 工作副本可逆稀疏化，原 raw、所有 metadata/media/source、Git 对象与 refs不删；完整恢复 argv、空间门与实际校验收据另存。

本轮归档离线复算首次因 Python tuple 与原写入 JSON array 的表示差异退出1；初版源码与完整日志保留。第二版先执行与原 writer 一致的 JSON 序列化，再对相同原件复算通过；没有修改原数据、样本或原断言，也没有重跑应用。

闭合后 sparse 的精确追加规则为 `/docs/performance/rules3-stage14-tail-attribution/` 和 `!/docs/performance/rules3-stage14-tail-attribution/payloads/`。恢复本 scope 工作 payload 使用 `git -c gc.auto=0 -c maintenance.auto=false -C /tmp/whole-stage67-evidence-repo sparse-checkout set --no-cone --stdin < /tmp/whole-stage14-archive-tools/stage14-restore.patterns`，先预留全部 payload 实际 filesystem blocks 加4 MiB临时空间，并另留32 MiB空闲；它保留之前3,876个旧排除项。实际 sparse 及完整 Git gzip 解码读回收据位于本机 `SPARSE-FINAL-CLOSURE.json`，只改变工作副本物化状态。
