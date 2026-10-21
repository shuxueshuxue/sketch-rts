# 海运与防守原子声明

`goal-naval-actions.ts` 只把已经具体化的候选转换为共享 `GoalActionDeclaration`。它不选择下一步、不生成一串动作，也不构造 Situation、Arrival、导航队列或风险批次。规划器决定哪些效果值得实现，并反推这些声明的前置条件。

| 动作 | 前置事实 | 完成后的世界效果 | 数量与独占 |
| --- | --- | --- | --- |
| assemble | 所选组可调用、各成员路线、集结点安全 | 所选组实际到岗 | pool 的 combat-rating 转到精确 post；同陆块的 unit-pool 不增发 |
| clear-camp | 所选组在岗、针对原生营地的整组兵力、接战路线 | 原营地成员已清除 | 每名存活守卫的原生赏金作为单独 finish/event 金币 flow |
| clear-shore | 所选组到岗、已具体化的敌方成员和路线 | 指定登陆点安全 | 不改变其他登陆点的安全事实；中立守卫赏金沿用同一事件来源 |
| defend | 所选组在该陆块可调用、回防路线 | 据点在给定窗口内安全 | 实际组成员独占，不借用未选中的全池战力 |
| evacuate | 所选工人可调用、避难点安全、逃离路线 | 这些工人位于避难点且安全 | 同陆块移动不制造一份新工人库存 |
| position-transport | 指定船体存在、接近航段已发布 | 指定船体在计划水点容差内 | 船体 entity-control 独占，与 payload 分开 |
| transport-force | 指定船体、载荷余量、接人或实际 aboard 绑定、航线和安全岸点 | 所选组在目标陆块的 pool 可调用 | 载荷用 bodyMass；船体、所选成员及同船依赖明确独占 |
| transport-worker | 同上，选择工人而非战斗组 | 指定工人在目标陆块可调用 | 工人不转化成战斗力 |

`camp-force` 只使用同一营地的整组评估，不进入可加的数值余额。多个集结、训练、运输的正 combat-rating 贡献可合成；每次实际组变化后，仍须重新核对营地门槛。

赏金来源是 `neutral-kill-bounty:<实际守卫 ID>`。不同目标、阈值或清滩头声明引用同一守卫时，共享账本只允许兑现一次。执行完成后的金币以原生余额为准，不能仅凭守卫消失合成一张击杀收据。

当前成员身份只来自输入快照；未来船只和乘员保留 `output`/`binding` 引用。原生评估副本仅提供质量、几何和兵力；同一原型的两个未来产出使用不同评估身份，副本 ID 不进入需求、效果或执行绑定。已在船上的成员通过实际 deck/cabin 与 `cargo-aboard` 关联，从当前船位航行，不要求或编造原陆岸。未被选择的同船成员只作为依赖，不进入本组兵力和到岗效果。撤离的 assets-safe 仍只命名当前被救实体，不为未来工人虚构救援身份。

duration、cost、successProbability 来自同次共享估计。构造器完整保留 met/pending/unmet，不以缺失数据推导零成本或必定成功。换登陆点是 transport 候选绑定的替代方案，不是一个产生安全效果的动作。

本文件和构造器测试只验声明、原生目录金额、组身份及资源含义。actionsFor 的候选枚举、共享事实接线、规划器执行绑定和公开题的整链验收分别由后续接线验证；构造器通过不等于计划或执行验收通过。训练、建造、等收入只消费公共经济动作，不在这里另写一份。

`groundGoalTransportOptions` 通过注入的 `GoalTransportFactPorts` 与同次 `GoalFactReader` 整理运输候选。来源端口负责实际岸点、船型、每名乘客的原生泊位和航段；本模块不求路或新增工作额度。每个候选保留精确船引用、起始 heading、原生水陆点、所有甲板/舱内乘员依赖，以及所选组每人的接人步行事实。所有乘员都在船上时，以当前实际船位出发，不要求原陆岸，也不再收一次装载质量。

候选时长只覆盖船到位之后的串行接人步行、登船设置、载人航行与卸载设置。生产和调船各自是独立前置动作，目标陆块内走到精确 post 也由后续动作负责。未知航段、无效来源结果和未公布的替代方案保留 pending 请求；一条候选可用时仍保留其他候选的 deferred 证据。真正已知不相容的多船乘员组由调用方拆成多个数量贡献者，不合成一趟虚构航次。

整理器测试使用原 4180 身份和固定已发布物理端口，覆盖当前/未来船及成员、整船依赖、原生质量、逐成员泊位核查和混合 known/pending 候选；严格导航诊断闸确认整理器不回退原生求路。这些测试不验证注入航段的物理 ETA，也不代表真实 source 或完整题库已通过。

`goalNavalActionProvider.actionsFor` 消费共享 `combatOptions` 的精确组、来源与估计，再经 `resolveCohort` 取得当前/未来评估形状。它枚举清营、赏金贡献、清岸、防守、撤离、本地集结、跨海到 pool 和调船的单独声明，不选兵、不串动作。跨海候选只使用自己那条 hull/landing 的 cost/P；没有这两项时声明保留 pending，不能借用另一种战斗候选的价格。金币请求可选择显式 campId 的部分赏金贡献。

纯调船声明 `declareGoalTransportReposition` 不需要乘员或陆岸。持续 defend 的已知 duration 必须覆盖承诺的 throughTick 窗口，成员独占也覆盖同一窗口；移除当帧营地障碍仍由 clear-camp 和共享 derived 事实证明，不能当作未来驻防。读取到尚未解析的组或来源时，由共享 source 保留请求，本 provider 不拿邻兵或目录默认原型补齐。

provider 测试用真实场景快照和真实 Situation，加固定的已发布领域选组/物理估计，覆盖符号组、部分贡献、独立航次价、精确救援、纯船位和持续防守窗口。它验证领域端口和声明构造，不代表统一 source、规划器就绪动作、执行适配器或公开题已完成。现有 strategy executor 名称仍需要统一入口根据解析后的引用和真实 grant 适配执行意图。

持续防守的安全效果在共享 `effectDelayTicks` 指定的实际到岗时刻建立（0 为 start，其余为 offset），实体占用仍持续至 finish。duration 必须覆盖到岗以及保护窗口；缺少到岗时钟或时钟 pending/unmet 会使动作时长同步保留该状态，不能把“当前可调用”当作“已经到岗”。这样建造可以在守军到岗后、保护尚在持续时消费安全事实，而不必等整段保护结束。

`createGoalBoardingGeometry` 将原生登船浅水候选的排序、逐候选合法性及最多四次稳定投影转换为小 JSON 游标。浅水格逐个计工作，最近船位复用 shared 的有限 pose 游标；原生 `boardingBerth` 也复用同一个单格候选规则。未知的地面投影或部分步行终点会暂停当前原生优先候选，不跳到另一个点，也不把 exact-route 的 unmet 当作 native fallback 失败。

`GoalNativeGroundReader` 是同次共享服务注入的端点事实：`project-goal` 对应原生 `walkableGoal`，`walk-destination` 对应原生到达点。没有专用端口时，只接受已发布 exact route 对其终点的证明，其他情况保持 pending。4180 回归将 native 端点作为测量范围外的固定事实逐次发布，几何本身在同一 6144 队列内续算并经 JSON 恢复，得到与原生 helper 相同的 water/ground；该回归不证明端点服务或完整控制入口的总工作量。

`createGoalTransportFactPorts` 是领域物理工厂，只接同次共享 geometry、已备 region index、readFact/resolveCohort、productionOptions 和 pointRoute 回读。它输出上述四个端口，不创建 Situation、查询器或工作额度。当前船按真实 deck/cabin 载荷算可用公斤数；未来船只能消费显式 `resolveProducedHull` 元数据，缺失时保留 deferred，不能由生产建筑名称猜实体或原型。逐航次风险价格由总 source 后续附到 option，本工厂不估战斗 P。

岸点枚举默认发布 16 个距离排序的几何候选，并明确保留其余候选的 prefix-limit 叶；该排序是候选工作顺序，不是航行 ETA 或效用。对于可加的两端距离排序，先逐岸点保留两端各 K，再检查 K² 组合，与全组合排序前缀完全一致。4180 原始输入的逐组合初稿需要 413851 工作，因子化后至多 1556；测试用独立全组合顺序逐 ID 核对，没有缩小源岸点集合来降低账本。候选前缀和通用 geometry 存储上限仍是覆盖边界，未展开候选不被称作不可达。

工厂保留 pointRoute 的 source ID、pending/transient/static 状态和精确起始 heading。生产或地面端点服务缺失不会触发原生求路回退。当前测试核原始快照、共享字段注入、有限 work/JSON、独立前缀 oracle 和未来元数据边界；统一总 reader、端点服务、真实调度与执行题库仍由共同接线验收。
