# 冷峰值：版本化查询输入与原始 RTS/导航实现对照

只读研究，2026-10-15。本地核对 HEAD 为 `3898911213a3dbe9220e3da7a036cd61d84ce552`。未修改生产源码，未编译，未运行测试或 CPU 实验；terrain.ts 仍由主车道拥有。下面区分已读源码事实与待验证设计，不声称已经获得十倍收益。

## 本地真实调用链：一次简单查询如何支付全地图成本

| 入口 | 实际冷工作 | 复杂度/已有机制 |
|---|---|---|
| `src/ai/policy/naval.ts:1116` shoreSpot → `:1148` shoreSpots | `terrain.ts:201` 获取 sea runtime；`:1048` wholesOf 扫所有种子、遍历全部可走组件，然后再次统计深水；shoreSpots 建三张积分图并按 row-major 枚举全图 footprint | N 为格数：整体 O(N)，产出 S 个岸位，保留 Point 身份；并非每岸位再做 footprint 全扫描，已有积分图 |
| shoreSpot `:1129` gapOf、`:1149-1152` 逐候选算己/敌 hall 最短路 | `terrain.ts:963` walkingDistance → `:1405` exactField → `:1409` cached → `:1437` grow。首次遇到一个 target hall 即构建完整距离场 | H 个 hall 的冷场约 O(HN)，后续岸位读取约 O(SH)。已有128个目标场缓存，不能把S次调用误算成S次全图Dijkstra |
| shoreSpot 的 held/sameGround/末尾sea连通检查 | `terrain.ts:1034` sameGround 触发同 mover 的 wholesOf | 全局 labels 保证后续 O(1)；组件只算一次。最大的连通海面本身可能占几乎全图，改成单组件 BFS 不保证收益 |
| `ship-navigation.ts:161` nearestShipPose | 同连通性检查后逐ring枚举姿态；各候选可触发hullFits | 早停是当前“第一个有解ring”，不是任意全局欧氏最近姿态；不能换成另一个nearest API就宣称等价 |
| `ship-navigation.ts:369` terrainDistances → `ship-navigation-potential.ts:51` buildSeaPotential | 对起点/目标块及边距界定的矩形构建带边界种子的完整反向势场 | 已有区域边界、最多8个缓存项、方向代价key；并不是无条件全地图构建。改字段、seed或下界会改变A*展开顺序，进而影响预算/完成tick |

应分别记录第一次 land/sea runtime、whole、shore列表、每个hall target field 的时间、分配字节和覆盖格数。温热重复query的调用数不能代替这些冷成本；prepared-shore 的执行结果复用可以删除重复调用，但不会自动删除首次 O(N)+O(HN)。

## 已失败的局部枚举为何是架构约束

已阅读 `/workspace/sanity-cold-peak-audit/local-differential/README.zh.md`。local perimeter 有6个同对象变动值反例；只对旧岸位index分桶也有 `cols-plus-alias-hall` 反例，不能继续包装为等价方案。

根因不是“下界不够保守一点”：`terrain.ts:1239` runtime 按 Terrain 对象身份持有旧 width/walk，但 padAt 等读取当前 cell，shoreSpots 又保留首次生成的Point列表。当前公开对象可变，旧图embedding与当前尺寸可能不同。反例中旧width50把当前cell(50,17)映射到旧cell(0,18)；按当前几何算的1312下界大于真实旧图288路长。这种混合时间输入不能靠当前cols恢复真实版本。

因此，公开旧接口不能悄悄获得“输入变化即invalidate”的新语义；那会修正历史行为而破坏本车道等价约束。也不应加入另一套影子旧尺寸cache来修补优化。

## 精确原始代码对照

所有下列代码都浏览了原始源码；Recast commit 通过 GitHub API解析后重新fetch核对，0 A.D. 沿用已验证commit并重新核对对应函数行号。只借鉴生命周期及查询组织，不宣称这些引擎算法直接适用本项目。

### 0 A.D.：先确定可达区域集合，再在区域中找候选

[`MakeGoalReachable`, 676-705](https://github.com/0ad/0ad/blob/61a3b9507d974084e6badb88a0826bd89a6d5b8b/source/simulation2/helpers/HierarchicalPathfinder.cpp#L676) 先用global region判断目标可达性，失败后只在起点可达region集合中找目标；[`FindNearestNavcellInRegions`, 740-764](https://github.com/0ad/0ad/blob/61a3b9507d974084e6badb88a0826bd89a6d5b8b/source/simulation2/helpers/HierarchicalPathfinder.cpp#L740) 用region距离界排除不可能更近的区域，保留区域内精确查询。注意 [`FindNearestPassableNavcell`, 728-737](https://github.com/0ad/0ad/blob/61a3b9507d974084e6badb88a0826bd89a6d5b8b/source/simulation2/helpers/HierarchicalPathfinder.cpp#L728) 仍先枚举所有region；它不是“首次查询完全不建全图”的证明。

本地对应：whole labels、nearestShipPose、shoreSpot最后的sameGround。可借鉴的是候选与可达标签来自同一图版本。不能复制其距离排序替换当前first-ring/row-order tie行为。

### Detour：查询对象绑定图；tile引用带版本；候选查询限制在相交tiles

[`dtNavMeshQuery::init`, 160起](https://github.com/recastnavigation/recastnavigation/blob/9f4ce64458dfae86e1239c525ddc219c4e9e06f1/Detour/Source/DetourNavMeshQuery.cpp#L160) 把查询绑定到nav并拥有查询工作区；[`findNearestPoly`, 702-725](https://github.com/recastnavigation/recastnavigation/blob/9f4ce64458dfae86e1239c525ddc219c4e9e06f1/Detour/Source/DetourNavMeshQuery.cpp#L702) 调用区域候选查询；[`queryPolygons`, 923-959](https://github.com/recastnavigation/recastnavigation/blob/9f4ce64458dfae86e1239c525ddc219c4e9e06f1/Detour/Source/DetourNavMeshQuery.cpp#L923) 只遍历AABB涉及tiles，tile内部再用BV tree。

[`isValidPolyRef`, 1229-1237](https://github.com/recastnavigation/recastnavigation/blob/9f4ce64458dfae86e1239c525ddc219c4e9e06f1/Detour/Source/DetourNavMesh.cpp#L1229) 检查tile salt；[`removeTile`, 1325-1332](https://github.com/recastnavigation/recastnavigation/blob/9f4ce64458dfae86e1239c525ddc219c4e9e06f1/Detour/Source/DetourNavMesh.cpp#L1325) 增加salt；[`updateSlicedFindPath`, 1280-1296](https://github.com/recastnavigation/recastnavigation/blob/9f4ce64458dfae86e1239c525ddc219c4e9e06f1/Detour/Source/DetourNavMeshQuery.cpp#L1280) 校验引用再按maxIter推进。salt是过期引用防护，不是旧快照的COW或无限期不可变保证。

本地对应：当前WeakMap只回答“同一个对象吗”，没有回答“候选列表、距离图与尺寸是否属于同一版本”。借鉴query-bound geometry，而不是移植navmesh或更改本项目slice预算。

## 一个可能净简化的设计：私有、版本拥有的 query 输入

只建议设计，不在本车道实现：由拥有terrain更新权的主车道提供内部 `TerrainQueryVersion`，让整个naval查询读取一个版本对象。其概念字段是 `{geometry, embedding, land, sea}`：geometry固定cells/levels/cell/cols/rows；embedding固定实际width与坐标转换；land/sea拥有其派生结果。旧快照继续引用旧版本，新几何明确创建新版本。必要时复用已有不可变Terrain对象本身作为version token，不另造递增全局stamp。

`prepareShoreQuery(version, originalShoreList, ownHallCells, enemyHallCells)` 仅活到本次策略执行结束，持有原列表/Point身份、固定图输入和所需距离结果。返回查询对象给本次决策的所有消费者；不另外建全局字符串key、LRU或失效监听器。这样“同版本”成为构造保证，不再由每个函数临时读取公开terrain属性猜测。

这个接口本身只消除不一致和重复读取，不会凭空把冷 O(N) 降低十倍。其价值是让下列简化能被严谨证明：

1. **批量最小距离而不是每个岸位逐hall重新询问。** 同版本、同原图代价下，对己方hall和敌方hall各构建一张multi-source最短距离场即可给出 `min_hall distance(spot,hall)`。现有grow本来就接受sources数组。冷成本由 O(HN)变为约O(N)，岸位求gap由O(SH)变为O(S)，工作集由H个完整场变为2个场。这是关于纯距离值的候选；不得拿multi-source next指针替代现有单目标行走路线，也不得覆盖旧公共缓存。若H=1则没有该数量级空间；跨owner组也不能凭空共享不同来源集合。NaN、负零、非法目标及旧接口可变输入仍走旧契约；不能为拿收益削掉验收。
2. **之后才评估有证明的候选上界/下界。** 原shore列表的ordinal和Point保持不变；由同一embedding计算的区域下界可用于跳过严格不可能胜出的区域，等距必须保留原ordinal。最坏无合法岸位仍需全部候选；若先O(SH)分桶再少量筛选，warm收益可能被预处理抵消。不能用这个设计重启已失败的当前可变Terrain local perimeter方案。
3. **按需component而非无条件所有component。** 连通查询只要求一个来源component及其deep count时，首次只洪泛该component可由O(N)工作降到O(C)，C是该component格数；但初始化大数组仍O(N)，最大海域C≈N，需求groundWholes全局count时仍须完整扫描。故必须先计访问组件占比/面积。不能把未探索标成不可达，也不能只数64个深水后遗漏连通标签。

“净简化”的验收是删除重复结果获取与分散的生命周期判断，而不是在原结构外再叠同规模cache。版本化接口推广属于主车道架构决定：若当前真实生产允许原地修改terrain，切换语义需要明确迁移边界；现有任意可变公开API必须保持原结果。没有这个边界，不实施上述候选。

## 保留预算、yield与完成tick的硬边界

- shoreSpot是同一次同步查询；返回值、原Point身份、row-order tie及策略调用时刻必须相同，不把建场转移到未计时任务或前一tick。
- 使用新的距离获取方式只服务shore评分，不能悄改A* heuristic、终点、搜索展开顺序或代价。`terrainDistances/buildSeaPotential`已有边界seed语义，不能用“更精确”的场偷偷替换它。
- 搜索continuation仍使用原预算和暂停点。版本化数据被持有多久是内存所有权，不能变成多算一片/少等待一tick。
- 数据冷热与旧快照查询都进入差分；现有levels/cols/cell反例必须保留，不以真实地图通常不这么改为由删去。

下一轮最有判别力的记录：首次shoreSpot的 `N,S,H_own,H_enemy`、确切新建target field数/字节、whole组件面积分布、候选实际访问数、该版本query消费者重复数。只有这些量支持H或N/C的放大，才有理由争取相应数量级改善；资料本身不给速度保证。
