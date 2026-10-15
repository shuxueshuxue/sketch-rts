# 同步空 traffic 重试：输入、结果和生命周期审计

冻结上阶段 `3b4d778e`（运行源码等同 `884e5214`），候选 `1389caa3`。本阶段不包含主性能车道的任何提交。只在 sailing.ts 的 waitForTraffic→replan(false) 原调用处选择内部复用入口；原准入与预算消费仍先发生，之后 exact 标记、路线赋值、age/blockedTicks 重置和实时执行均保持原位置。

源码定位：[原准入后的入口](https://github.com/shuxueshuxue/sketch-rts/blob/1389caa336ec0a10c0cd909536961e767e7a97d9/src/shared/sailing.ts#L253)、[wait 调用](https://github.com/shuxueshuxue/sketch-rts/blob/1389caa336ec0a10c0cd909536961e767e7a97d9/src/shared/sailing.ts#L280)、[守卫与结果所有权](https://github.com/shuxueshuxue/sketch-rts/blob/1389caa336ec0a10c0cd909536961e767e7a97d9/src/shared/ship-navigation.ts#L838)、[取消清理](https://github.com/shuxueshuxue/sketch-rts/blob/1389caa336ec0a10c0cd909536961e767e7a97d9/src/shared/ship-planning-job.ts#L137)、[profile](https://github.com/shuxueshuxue/sketch-rts/blob/1389caa336ec0a10c0cd909536961e767e7a97d9/src/shared/ship-geometry.ts#L69)、[运动限制](https://github.com/shuxueshuxue/sketch-rts/blob/1389caa336ec0a10c0cd909536961e767e7a97d9/src/shared/ship-handling.ts#L22)、[风课程费用](https://github.com/shuxueshuxue/sketch-rts/blob/1389caa336ec0a10c0cd909536961e767e7a97d9/src/shared/ship-wind.ts#L86)、[海域连通](https://github.com/shuxueshuxue/sketch-rts/blob/1389caa336ec0a10c0cd909536961e767e7a97d9/src/shared/terrain.ts#L1034)。

## 实际依赖

| 搜索读取 | 源码位置（候选提交） | 首版守卫 |
| --- | --- | --- |
| 起点 x/y/heading、速度、订单相关字段 | ship-navigation.ts planShipRouteImpl、keelConnector、departureRoute、motionCost | 完整 Unit 值，包括完整 sailing 与订单 |
| 目标 x/y/heading；直接连接器可能传播目标属性 | ship-navigation.ts nearestShipPose、keelConnector、arrivalConnectorFor | 完整 goal 值；不只保存目标 ID |
| 船型、尺度、profile/hull/船长 | ship-geometry.ts shipScale/shipProfile/computeShipProfile；navigation gridFor/masksFor/hullFits | 完整 Unit 的 kind/deckScale/fittings 等原始值 + 完整实际 profile 值 |
| 限速、倒车、加速度、转向 | ship-handling.ts shipMotionLimits/shipPartMax | 完整 Unit 的 speed/maxHp/shipParts/load/balance 等 + 实际 limits 值 |
| 有效风与课程费用 | ship-wind.ts coursePerformance/windAngles；wind-field.ts windAt | 原始 map.wind + 实际 windAt 值；Unit 中速度分量、帆状态仍完整保留 |
| 地形占用/连通、尺寸和量化栅格 | ship-navigation.ts clearOutline/gridFor/nearestShipPose；terrain.ts isWalkable/walkableGoal/sameGround | width/height + 完整 terrain 值（含 cells、cell、cols、rows） |
| 预算与 voyage | planShipRouteImpl | budget 值 + 固定 voyage=false |
| traffic 和嵌套隔离 | planShipRouteImpl 的 noTraffic；routeSearchDepth | 仅真实 reservationTraffic.hasTraffic===false；depth 非零强制原路径 |

terrain 的上述三个 sea 查询使用 runtime(terrain, mover)，并非纳入建筑动态阻挡的 routing 路径。静态几何/极线表属于冻结规则源码，未把它们变成运行时缓存键或改写。公开 planShipRoute/planVoyageRoute 不加入复用；任意回调和嵌套搜索保持原算法。内部入口也检查 hasTraffic 严格为 false 和搜索深度；没有此声明的函数仍收到原检查。

保守守卫是 `{ship, goal, map:{width,height,terrain,wind}, profile, limits, wind, budget, voyage:false}` 的独立副本。递归比较先用 Object.is，再核对 own keys 与子值，区分 absent/undefined、-0/+0、NaN、Infinity/-Infinity。没有 JSON 数值归一化、字符串分隔碰撞或哈希碰撞。只处理游戏已有的普通可结构化克隆数据；不引入任意对象序列化协议。游戏 Unit/terrain 不包含环；复用的输入别名不会被搜索写入。

本实验选择保留完整守卫，没有为了扩大命中率去掉 route 等“看似无关”字段。其复制、比较和 GC 均计入正式计时。较小投影可能提高命中，但需要另做依赖和等价证据；本阶段不把之前投影重复数当作已实现收益。

## 结果所有权

miss 走原 planShipRoute，存入独立 structuredClone(result)，返回原结果。hit 返回存储结果的再次 structuredClone。标准结构化克隆保留内部别名、undefined、非有限数和负零；存储副本从不交给执行器。空 points 与 partial=false 仍是存在的 entry，绝不用空结果判断“没缓存”。

sailing 在返回后才给 point 写 exact，并用末点对象赋 route.end；points.shift()、end 修改和 pivot 修改因此不会污染存储副本。逐调用 shadow 同时比较独立结果图，以及将输入与结果共同遍历的对象图，检测内部和对外别名变化。另将全部实际查询重放，故意破坏每个返回点、pivot、末点和数组后再次命中，与重算比较。

## 生命周期

每个 Unit 一个 WeakMap 条目，值持有输入副本、结果副本、原 motion 和 map 引用。motion/map 替换失效；同对象内容变化由完整值守卫识别。其他 replan、非空 traffic 重试及 cancelShipPlanningJob 清除条目。船对象替换自然冷启动；快照从不序列化此派生状态，恢复替换 map/Unit/motion 后照常重算。保留的输入和路径有存活内存成本，报告分别测活跃期、取消后和正式长场景。

没有跳过碰撞、修改重试频率、改变预算、移动查询时机，或将工作转移到未计时任务。terrain.ts 与 hullPassageClear 未改动。
