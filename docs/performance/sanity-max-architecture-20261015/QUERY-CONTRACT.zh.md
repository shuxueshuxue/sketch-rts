# 交主 terrain 车道：先暴露现存图的保守剪枝界（只读提案）

**不必先迁移可变Terrain语义。** 第一阶段只需terrain内部提供一个无新缓存、无新搜索的只读数值接口，保留所有原候选列表、Point身份和原walkingDistance裁决。前稿将未来持久空间索引的所有权要求提前成为这个小接口的先决条件，范围过大。本文不是实施授权，未修改生产或运行新实验。

## 最小边界

```ts
walkingDistancePruningBound(map, from, goal, mover = "land"): number
// 仅供非负upperBound剪枝；0表示不可证明/不剪枝。
// 不是异常输入下的替代距离，不代替walkingDistance。
```

实现放在terrain.ts内，读取现存`runtimes`条目，**不调用会创建runtime的runtime()，不建field/labels/候选，也不写clock**。没有现存runtime就返回0。复用原padAt（:1285）：当次读取当前terrain.cell/cols/rows及bounds，得到实际node index；再用该runtime真实width解码，而非当前cols+2。node无效、不在walk数组、walk!=1，或width/offset/数组布局不支持普通网格证明时返回0。

对两个有效node，以actual width计算图内Chebyshev步数m；正有限cell的保守界按原浮点操作顺序计算`((m*STRAIGHT)*cell)/STRAIGHT`，而非`m*cell`。walkingDistance:963返回`(cost*cell)/STRAIGHT`，且grow:1437中cost≥m*STRAIGHT；相同正数乘除顺序保持浮点单调，避免1ulp过界。非有限/非正cell或非有限计算结果返回0。这里0是“不可剪枝”值；shoreSpot的bestGap初始Infinity且可接受解至少HALL_BERTH=160，不会拿负upperBound使用它。

这只封装现存runtime真实embedding与padAt转换，不复制导航kernel，不新增版本stamp、全局LRU或shadow旧尺寸缓存。接口可每次重新读取当前map.terrain/现存runtime，避免把借用对象跨tick保存；不用对外暴露可写typed arrays。

## 为什么能保留原对象改动语义

`terrain.ts:201–242`的原shoreSpots列表照旧。levels全2→删除后原缓存仍为空，就仍为空；不调用新的footprint枚举。`naval.ts:1116/1129/1148`（当前38989112；原281为1111/1124/1143）仍从同一readonly列表取`points[index]`，在真实筛选处调用原walkingDistance、塔/枪、placement及海区谓词。原对象cell/cols/rows或Point坐标在**两次同步query之间**改变，每次临时分桶重新读取其当前值，不需要持久索引失效协议。

已知cols反例不再要求修复旧行为：48→52后旧runtime.width仍50；当前hall cell(50,17)经原padAt得到951，actual width解码为旧cell(0,18)。候选(304,592)是旧cell(9,18)，界为288，与原距离288一致；不会再用当前坐标声称1312并错误截掉它。完整反例见`local-differential/bucket-summary.json`。不可达/坏索引返回0只是多保留候选，最终undefined/Infinity/NaN和比较行为仍由原路径决定。

数值index桶按界递增消费，只有`bound>bestGap`才停止；等界按原index。由于查询顺序改变，最终等距也必须按原index决胜，不能沿用简单`gap>=bestGap`。Infinity原本不可胜出，NaN/非正metric降级时应让全体界为0并保持原row-major顺序。所有返回Point均取原列表对象，不能复制。

## 这一步解决正确性，尚未解决全量消费

每query分桶仍为O(H×S)，临时O(S+R)数值index；它可以省掉后续大量精确查询与map/spread数组，但不能声称已经免掉全shore扫描。首次shoreSpots本身仍O(A)，也必须计入冷峰。最小接口应先验证这笔完整成本，不能用“下界正确”替代收益证据。

真正免除每query O(S)需要复用候选空间索引或由主车道同一个按需距离场kernel提供按精确距离消费候选的能力。后者可借grow已有多source入口求min_hall距离，不能另写Dijkstra；若能按(精确distance,原index)产出，可删naval侧我方gapOf临时数组、全S精确查询与best/bestGap中间结果。现阶段不预设数据结构，不增加持久索引。

**只读版本化API是后续可选设计，不是上述小接口的必然前置。** 只有要把索引跨query保留、同时不每次校验所有Point坐标时，才必须明确谁拥有其不变性：现有`readonly Point[]`仅限制外层，Point.x/y仍可写；未知调用者移动一个未读Point，任何索引都无法凭空发现。届时应由所有权/版本协议解决，不加曝光标志或兼容缓存补丁。

## COW、快照及验收边界

`sim.ts:923`浅拷贝map、共享terrain；:978调用shareBuildingBodies。`terrain.ts:1129/1137`的overlay COW及routing:1192不能替代terrain-only walkingDistance的runtime。小接口不改这项关系：旧snapshot读到同一原对象改动时，仍走同一个旧runtime+当次padAt。opaque query/索引不得进序列化、checksum或权威AI记忆；冷恢复原样重建。

若将来希望“geometry改动产生新不可变版本、旧snapshot固定旧版”，或把原sea.shores的陈旧候选语义改为自动失效，这是另一个需决定的API/所有权变化，不能混入本次小接口。当前不要求这个迁移。

交主车道的验证材料是214例local与215例bucket差分，尤其cols+hall alias、levels、cell/rows变化、Point身份、多hall同距与无解；还须加入下界≤原有限正距离的断言、异常输入0界不剪枝、旧snapshot/COW及冷恢复。当前阶段仍只读，不建议据此直接采纳或发布实现。
