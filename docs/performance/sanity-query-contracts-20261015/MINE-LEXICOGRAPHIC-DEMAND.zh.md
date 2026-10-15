# 海外矿选择：先 threat，再按需 road

静态审查日期：2026-10-15。读取工作树 HEAD ad85c71bae879e0bfdfe29487caa8f61ac9cf9ca；未修改生产、未运行编译/测试/CPU实验。父车道负责实际6990输入捕获与计时。

## 可删除的工作及证明

`src/ai/policy/naval-mines.ts:14–28`先为所有候选求海路，最终比较器是 `a.threat - b.threat || a.road - b.road`。在 threat 为有限数、route计算成功且输入为普通稳定快照的条件下，非最低threat候选不能胜出，无需读取其road。保留原候选顺序筛选严格相等的最低threat组；只有组大小大于1时才执行原 nearestByRoute、原方向 walkingDistance 和原稳定sort。组大小为1直接返回原candidate对象，连胜者road也无需计算。

这是对比较器所需信息的剪枝，不是反向字段、缓存或近似距离。高威胁候选的road没有其他输出或AI memory用途。保留全部威胁体筛选、各候选威胁累加原顺序，不应同时改求和方式或空间近似。返回对象必须保持 `===`，不要重建candidate；相同threat/road时保持原输入顺序。

若原12个目标均冷且互异，最低组大小k：k=1时可删除全部12字段；k>1时至多删除12-k字段；全12个threat相等时删除0字段。实际还受已有字段、重复landing和缓存淘汰影响，不能仅凭候选数量宣称field收益。新临时工作集是每候选一个数/引用，删除被排除候选的fleet数组展开、路由调用与整图field构建；不会引入长期cache。

## 当前生产调用的准入证明

只有 `naval.ts:974` 一个生产调用者（其余是测试）。`islandPlan`在有terrain时工作，963附近先确认landing可航行，971调用 `coastOnWater(snapshot, shore, landing)` 并仅保留有departure的候选。`coastOnWater:772–782`仅返回与landing处于同sea whole的walkableGoal。`sameGround`与`walkingDistance`都读取terrain-only海上通行图，建筑overlay不影响这两者。因此，正常有限游戏地图中，每个候选至少departure是有限可达origin，无需要求fleet全部可达。`eligible`回调在构造candidate之前运行完，choose函数内部没有用户回调。

## 不可声称任意公开输入完全等价

1. 所有origin不可达：nearestByRoute初始shortest=Infinity，仅接受route<Infinity。全部undefined/NaN/Infinity时返回undefined，随后旧函数walkingDistance(undefined,landing)抛TypeError。即使该candidate威胁最高，旧函数也会抛。剪掉它会改变公开失败行为。最小反例：一个低threat有效候选，加一个高threat候选，其departure和所有船在另一个不连通海区。唯一候选直接返回也可能吞掉异常。
2. NaN threat：原减法产生NaN，`||`转而比较road。把NaN排除或用Math.min得到NaN均不等价，且此时比较器可能不传递。畸形战斗属性能够生成NaN，例如塔attackCooldown=NaN。Infinity不是NaN：有限threat应胜过+Infinity；所有+Infinity间减法NaN但仍由road定序。若支持无NaN扩展实数可特殊证明，但第一版限定有限更简单。不要改为epsilon相等。
3. 无terrain、巨大有限坐标平方溢出、非法cell、未归一化快照不在上述准入证明内。sameGround在无terrain直接true，不能拿它单独证明有限距离。
4. getters/Proxy、可变terrain对象、被mock的模块或有副作用的属性访问，可能观察每个road前后读取threat的顺序。原函数也依赖普通快照不可变约定，不能宣称对任意JavaScript对象保序。未发现普通游戏调用存在这种callback；不是需要新增动态兼容层的依据。
5. 派生terrain字段缓存的clock/LRU与容量占用会不同，但这些不是GameSnapshot/AI memory状态。随后查询可能由warm变cold；验收应包括整个tick/后续tick、旧snapshot交错查询，不能只计choose函数。terrain注释1230附近声明这些字段是terrain纯函数。

## 最小实现边界建议

优先把该函数明确作为“已准入海外矿候选”的内部策略入口：唯一生产调用满足上述保证，类型/注释写清 finite普通快照、每候选departure可达landing。若必须保留现有导出函数对任意输入的历史异常行为，则保留旧入口，增加显式的内部admitted入口或内部布尔mode，仅islandPlan启用；共享threat计算，不另建候选缓存或复杂兼容协议。mode默认旧语义，NaN/Infinity可以直接回旧路径。不要为了保留未承诺的畸形getter行为创建巨大兼容层。

仅使用Number.isFinite(threat)回退不够保留旧API，因为不可达高威胁候选仍会被漏掉。若坚持对所有普通合法terrain点保留异常，需要预检每候选是否存在可达origin（departure或任意fleet）；这重复准入工作，且sameGround须附带有限合法terrain假设，不如利用明确内部准入边界。不能简单遇到departure不连通便抛：fleet仍可能连通。

## 一次有判别力的小实验

父车道捕获6990的原snapshot/options/candidate及threat向量；先报告最低组k、不同landing目标数。若k=12，本候选在该峰值当场证伪，不必做完整性能系列。若k<12，精确原函数与剪枝版比较返回对象身份、snapshot/options序列化以及后续真实AI memory/指令；冷/暖分别统计grow次数与整tick时间，后续ticks检查费用是否延后。

正确性最小矩阵：唯一最低且road最长；最低threat有2个、road不同；最低threat/road完全相同但输入反转；重复位置不同candidate身份；空候选；无船但departure可达；无关fleet不可达；全部threat=0；严格400边界；不同海区但各自departure可达。保留原累加与排序的差分oracle。

边界测试另列：高threat全部origin不可达必须在旧公开入口继续抛；NaN与Infinity threat走约定回退；无terrain原测试继续跑。现有 `naval-mines.test.ts`、`naval-mines-distance-reuse.test.ts`覆盖身份、排列、重复位置、跨海区fleet、无船、无terrain、冷热与输入不变，但未覆盖上述吞异常/NaN。此轮未运行任何验证命令。

## 父车道最新真实分布（非本agent测量）

父车道已完成整局57次调用采集，结果在 `mine-capture/analysis.json`：每次12候选，最低threat组均6候选，合计684→342；tick6990是各6个的两组，threat分别5.02831668385801与2.6127479111061525，没有唯一最低。因此本剪枝可排除一半潜在冷目标字段，不能作为10倍方案，不建议立即开小补丁凑收益。前述k=1只是算法边界说明，不是本局证据。

更根本的查询结果需求是每个landing到fleet+departure的最小距离，nearest origin身份最终被丢弃。后续若研究共享grow内核的query-specific多目标批查询，应把精确停机条件、完整字段与partial结果隔离、warm命中和淘汰生命周期一并作为协议设计。已失败的全局transpose使grow240→256，不应改名重演；本报告不提供第二份生产算法，也未实施此方向。
