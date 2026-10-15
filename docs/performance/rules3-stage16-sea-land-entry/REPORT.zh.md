# 本轮采用决定：69e 不采用，整局目标仍未达成

候选 69e778602a5f8700c482574787cb7b82087ea713 保留在独立本地分支 perf/sea-distance-frontiers-land-entry。没有新增产品 PR、推送、合并或部署。PR #381 仍按用户指定保留草案，不自动合并。本轮不以继续堆候选替代结论。

两轮正式顺序均为 A1 B1 B2 A2 Bplain，共10局；性能池每侧4局57600 tick，包含tick0及全部异常。A是生产0ea，B是69e；Bplain独立，不混入性能池。没有轮间分析、重跑、替换或剔除。完整命令618189字节逐字节一致，最终checksum 7d94a5e8，rules3/checksum18；10局的初态、源码241输入、阶段、实体数量及完整命令验证均通过。

|整tick指标|生产A|候选B|
|---|---:|---:|
|mean ms|3.639541|3.623460|
|p99 ms|27.223901|26.875853|
|max ms|99.069112|90.472690|
|超过50 ms|24|32|
|非规划超过50 ms|8|17|
|模拟超过50 ms|8|18|

均值仅改善0.441832%；两块分别回归0.396525%、改善1.278374%，四对有两对回归。规划长tick16→15，但非规划8→17，不能用AI均值降低掩盖模拟尾部。p99≤16/max≤50目标仍失败，以上结果不足以支持采用。

focused profile和独立scalar计数确认了真实局部工作量：6990同36个海路查询，完成cost层17489→8627；10950海路目标22916首次1983→39层，第二次命中已结算区域，无新增层。它们是算法工作量证据，不等于整局倍数收益。旧11970约261ms和6893模拟尖峰未复现，仍未解释；本次新增模拟尾部也未归因，不能直接归罪GC、JIT、continuation或船只重规划。所有原始异常完整保留。

语义证明849查询/10组、1698输入语义检查通过。回归704项中700通过、4失败，完整stderr与生产0ea逐字节相同；这不能证明测试本身错误。类型检查、SDK7项、Vite构建和实际83个输出文件核验通过。每局13个内存采样不是峰值或分配率，最终RSS候选更高而heapUsed更低，没有稳定资源降低结论。renderSnapshot仅是独立的数据抽取，没有浏览器/GPU性能结论。

新候选冷启动只有来源准备，NOT_BOUND / NOT_RUN；整局结果已不支持采用，因此未继续冷启动测量。旧bccc冷启动结果保持旧评测归属，绝不移植给69e。

所有权：本车道处理terrain精确按需sea distance fields及cold connectivity；本候选只改terrain.ts。不改ship-navigation.ts/ship-planning-job.ts规划任务私有生命周期或arrival geometry复用，也不改sailing.ts waitForTraffic→replan(false)重复结果实验。既有1cf仅hullPassageClear同次调用相邻端点/轮廓复用。PR381头3b4的terrain全文仍等于f13，但旧联合1392比较/13892断言只证明f13 COW+bccc sea，不能认证新增规划状态；当前组合仍须共同审查可变continuation queue的快照所有权。

完整十局、56条计时超过50ms行、逐tick和所有owner原值，见原始native目录与native-analysis/phase-tail-specials.json。机器可读数值及证据SHA见ROOT-DECISION.json。后续只围绕真实尖峰作精确归因，保持AI相位、船只规则、预算、校验频率和断言。
