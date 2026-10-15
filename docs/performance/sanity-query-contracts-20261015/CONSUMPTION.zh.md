# 从实际消费需求重设导航与几何查询

审计源码：ad85c71bae879e0bfdfe29487caa8f61ac9cf9ca。只读；没有修改生产源码，没有运行编译、测试、profile 或完整场景。本文不继续港口 bound-first、容器合并或局部缓存，不接管 terrain.ts / hullPassageClear。

两个可实际删除中间生产链的契约重设是：

1. 图搜索先返回“搜索完成事实”，由真正需要路线的消费者物化；fallback 只请求终点，voyage refinement 只请求必要 reference。这样删除搜索完成时必经的全路径 Point[]。
2. 将几何的“存在碰撞吗”和“最近接触报告”分开；bool 消费者直接获得 predicate 或分离证明，不再创建最近接触选择、支持点和完整 configuration polygon 后又丢弃。

这不是把任务挪出计时，也不是减少模拟工作频率。能等价删除的工作来自消费者根本不读取的输出；搜索终止、预算、动作提交仍在原 tick。以下同时列出不能等价删掉的部分。

## 先排除“执行器只读第一点，所以只规划第一点”

该推断不成立。sailing 当前一帧的直接 aim 常取 points[0]，但整个 suffix 还有实际消费者：

| 消费者 | 实际读取 | 删后缀的后果 |
|---|---|---|
| ship-guidance | 首个 exact/pivot 的位置；多个点组成的 lookahead；末点；制动 horizon 中未来 speedLimit | maneuver 切换、速度和停止 tick 改变 |
| sailing 风规划 | 最后一个非 pivot leg、是否已 tack、替换前缀及补算 suffix | 风向策略与未来路线改变 |
| queued course | queuedTurn / queuedPassed 标记以及曲线后的下一目标 | 队首消费与交接 tick 改变 |
| walkEnded | route.partial、points.length、route.end | 到达判定改变 |
| snapshotGame / checksum | 已承诺 route.points 和 job 状态 | 旧快照与逐 tick 状态改变 |

精确位置：[guidance 26](/workspace/sketch-rts/src/shared/ship-guidance.ts:26)、[guidance 43](/workspace/sketch-rts/src/shared/ship-guidance.ts:43)、[lookahead 64](/workspace/sketch-rts/src/shared/ship-guidance.ts:64)、[制动 141](/workspace/sketch-rts/src/shared/ship-guidance.ts:141)、[风规划 423](/workspace/sketch-rts/src/shared/sailing.ts:423)、[queued handoff 104](/workspace/sketch-rts/src/shared/ship-queued-course.ts:104)、[walkEnded 3995](/workspace/sketch-rts/src/shared/sim.ts:3995)、[snapshot 944](/workspace/sketch-rts/src/shared/sim.ts:944)。

因此，“以后需要时再规划余下路线”属于新的运动/计划承诺规则，需要用户决定；不能作为等价优化。沿用原图搜索，却只返回第一动作，也不会自动省掉为了保证最优/partial 语义所必需的搜索。

## 契约一：搜索结果先是 outcome，路线只是其中一种投影

### 明确只需要 endpoint 的现有调用

同步 fallback 当前执行：

完整无 traffic 搜索 → parents 回溯 → 每节点创建 ShipPose → reverse → prefix splice → terminal append → 返回 RouteResult → 调用者只读 partial 和 points.at(-1)。

[生产调用](/workspace/sketch-rts/src/shared/ship-navigation.ts:1134) 的实际需求仅为：无 traffic 时最终能到哪里，以及 partial 是否为真。它用这个终点与已找到的受 traffic 路线终点比较，不执行第二条路线。跨切片版本同样只消费这些信息：[fallback 899](/workspace/sketch-rts/src/shared/ship-navigation.ts:899)。完整回溯物化位于 [1115](/workspace/sketch-rts/src/shared/ship-navigation.ts:1115)。

建议把共同搜索核心的完成值设为一个私有 SearchOutcome：终止类型、best state、terminal connector 的终点、partial/deferred。只让需要路线的末端消费者调用 path materialization。内部终点查询返回 endpoint / partial，不返回 points，也不保留 solely-for-output 的 parent/prefix 路线链。

可直接删除这一支上的完整 path Point[]、reverse、splice 和终点之外的 Point 创建。一个终点查询不应被强制为整条路径付费，也不应为输出一条不会执行的路径保留 parent。原受 traffic 的路线仍完整保留，它才是随后可能交给执行器的路线。

**保持语义的边界：**

- 同一个搜索核心、相同 frontier tie、边检查、budget、visited 和 4096/128 expansion yield；终点查询在原算法的同一终止点完成，不能遇见某个可达点就提前成功。
- 准入与预算扣除留在原位置；不提前安装 route，不取消必要的实时 collision。
- direct、arrival、departure、无 frontier、best<0 等所有早退也必须给出原 points.at(-1) 对应的终点；空路线仍由调用者按原规则回退到 start。
- 内部无 traffic fallback 可以改变派生输出形式；公开 planShipRoute / advanceShipRouteSearch 仍保留可观察的完整数组、状态和任意 callback 语义。
- 私有 job 当前把 searchSteps 而非私有 graph 写入 planningJob。若所有 yield 相等，可以用同一冷重建恢复这一终点查询；不能把公共 fallback 的可观察 state.path / nodes 偷换成新格式。

这项可完全等价，但它省的是输出和 parent 维护，搜索本体仍可能是主要成本。旧证据中同步 fallback 数量不大；目前没有证据支持靠这项使真实 global max 降十倍。

### 同一个契约可以删除 voyage 的“先铺满、再过滤”

私有 voyage reference 的唯一下一消费者是 beginVoyageRefinement：[job 196](/workspace/sketch-rts/src/shared/ship-planning-job.ts:196)。当前生产者先物化完整 lattice path，消费者再删除直线内部点，仅保留 maneuver 前缀、拐角和必要的相邻姿态：[beginVoyageRefinement 747](/workspace/sketch-rts/src/shared/ship-navigation.ts:747)。

可把这个私有消费者改为 ReferenceCursor / parent-state reader，直接产生现有 VoyageRefinementState，删除 dense lattice ShipPose[] 这一阶段。只创建最终必须留下的 pose；继续使用现在唯一的 refinement 算法和相同试验顺序，而非增加第二个规划器。

这里存在一个容易漏掉的条件：遇到 pivot/astern 后，现算法会把此前一整段标为 exact；不能先永久丢掉前面的 collinear 点。可以保留便宜的 state-id 顺序直到确认 maneuver 边界，再物化需要的前缀；不能用“只留转角”代替原逻辑。prefix/terminal 的 Point 身份和嵌套 pivot 别名也要按原值保留。原完成 tick 上的 corners/result/cursor、每次 yield 和最终 serialized job 应逐项相等。

这是契约一的另一种消费端，优先级取决于实际 dense path 长度与保留 reference 长度之比。没有这些数量和 CPU 占比之前，不应把它包装成数量级收益。

## 契约二：布尔几何查询不再索取完整接触报告或 polygon

### 可以保持现有数值算法的切口

[staticPassingClear](/workspace/sketch-rts/src/shared/ship-avoidance.ts:166) 为判断一个候选避让动作可不可行，先对两段做 hullPassageClear、traffic，再各调用一次 !sweepShipCollision。它完全不读取 Contact 的 fraction、normal、point、other 或 kind。

但当前 sweepShipCollision 会：

候选 Set → 完整数组 → body.id 排序 → 对全部候选 sweep → 比较最早 fraction → 生成最终 hull outline / 双方 support points / 接触点 → 再检查 terrain → 返回 Contact → 消费者转成 boolean。

位置：[nearby 104](/workspace/sketch-rts/src/shared/ship-collisions.ts:104)、[接触点投影 167](/workspace/sketch-rts/src/shared/ship-collisions.ts:167)、[最近接触与 terrain 206](/workspace/sketch-rts/src/shared/ship-collisions.ts:206)。

建议私有查询明确分成“任一 body 阻挡此 sweep 吗”和“物理执行需要的最近 Contact”。检测核心保持一份：布尔查询在首个有效接触即返回，不排序或选最近 body，不生成最终接触点；详细查询仅由真正需要 fraction / damage 的执行器使用。staticPassingClear 处已经在同一同步调用栈确认 terrain 清楚，因而可以明确请求 bodies-only query，删除重复 terrain 链，不需要新缓存、异步任务或预热。

**不可越过的边界：**

- [advanceShip 56](/workspace/sketch-rts/src/shared/ship-motion.ts:56) 虽然最终也返回 boolean，却实际用最近 fraction 推进到接触面、记录 damage、更新预算与位置。它必须保留最近接触报告，不能换成“任意第一个接触”。
- segmentContact 的 normal 用于判断初始轻微重叠能否分离：[112](/workspace/sketch-rts/src/shared/ship-collisions.ts:112)。布尔消费者不需要最终 normal 对象，不代表这些决定布尔值的数值计算都能删除。
- 保留 frameFor 初始化、当前 units/solids、activeBody、全部旋转采样和初始重叠规则。bodies-only 的调用点必须能证明刚刚通过同一段 terrain 检查，不能公开一个任意调用者可伪造的“已安全”flag。
- 早退只影响纯存在性结果，不改变游戏物理提交和伤害顺序。需要 shadow 验证公开 callback / 重入不被绕过；本例使用引擎自己的 query，不把任意用户 callback 推广到这种早退。

这能删除整个详细报告投影和全量 nearest-contact 选择链；它不是少建一个 Map。但目前没有其调用次数与真实 max 的独占成本，不能声称解决十倍目标。

### 更激进的合同：碰撞查询消费 shape，不生产 configuration polygon

[shipBodyClearAtPose 173](/workspace/sketch-rts/src/shared/ship-collisions.ts:173) 也只返回 boolean，却构造：

world hull → 负 hull → Minkowski sum → convexHull → polygonPlanes → 检查一个点是否在内部。

最终消费者不需要 Minkowski polygon。可把合同改成两个只读 convex shape 的 overlap / separation query：以局部 hull + pose 作为输入，按需要读取支持投影，找到分离轴即返回；只有明确需要画 polygon 或计算接触报告的消费者才物化 polygon。它删除完整 configuration polygon、排序和中间 Point/Plane 列表这一生产链，不是把它们长期缓存起来。

**这不能直接视作数值等价。** 当前 minkowskiSum 的合并使用 cross ±1e-9，convexHull 会去掉近重复点和近共线角，polygonPlanes 的内部检查用非归一化 1e-6 门槛：[Minkowski 240](/workspace/sketch-rts/src/shared/navigation-math.ts:240)、[hull 212](/workspace/sketch-rts/src/shared/navigation-math.ts:212)。普通 SAT 的数学等价不保证 IEEE 边界、恰好接触和微小重叠也一致。

可争取的验证路线是先将现有 overlap 的每个原返回值与新 predicate shadow，重点包含转角、近共线、不同尺度、±0、极窄缝、切触及初始分离。若无法在既有数值规则下证明并保留布尔判定，需要把“改用统一容差的碰撞定义”作为明确游戏语义决定交给用户；不能把少数边界差异算优化噪声。不得借此修改当前被排除的 hullPassageClear。

## 一个具体的先验测量门槛

下一次诊断只需按消费者标签记录：endpoint-only fallback 的次数/扩展数/完整路径长度；reference 完成时 dense poses 与最终 corners 数；staticPassingClear 的 bool sweep 次数/候选 body 数/已生成又丢弃的 Contact 数；布尔 overlap 中 configuration polygon 的总顶点数。先把这些量与最大 tick 对齐，决定是删除路线物化链还是删除 shape 物化链。

如果它们在真正最大 tick 的占比很小，应明确转向其实际主因，而不是为这里继续补缓存或包装层。当前已知冷 AI 最大值有 terrain 查询链；本任务没有拿这些形状/终点契约冒充那条链的替代，也没有接管主 terrain 实现。

## 父线程协调工具发现

只发现元数据，未调用外部发送工具。记录：[coordination-tool-discovery.json](/workspace/sanity-reset-20261015/coordination-tool-discovery.json)。

当前团队的原生 collaboration.send_message / followup_task / list_agents 可以联系 /root 和本团队 agent。functions.ALL_TOOLS 中没有发现可按任意 Codex source_thread_id 读写另一会话的工具，也没有通用 app send_message；匹配 thread/conversation 的是 GitHub review/issue 工具。Pages parent_page_id 是文档层级，不是会话路由。故不能假装已向另一个主 terrain 会话发出协调消息；需由有该会话上下文的父线程继续协调。
