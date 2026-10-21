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

船上出发的岸对枚举只按 sea 与目标岸点排序，稳定请求键不含当前船位；同海域内行进不会重启未公布的岸点扫描。船位和 heading 仍进入真实 seaLeg 的物理请求，陆地出发的距离排序仍保留其起点。

工厂接受独立 `shoreGeometryRevision`（省略时兼容 `geometryRevision`），由总 source 绑定已备地形岸点索引版本。动态船位、交通或施工体变化可失效泊位与航段，不重启与其无关的岸点枚举。

`goal-naval-assessment.ts` 提供共享 source 使用的纯 `assessGoalCampCombatOption` / `assessGoalDefenseCombatOption`。调用方明确给出 effect、所选真实/符号组、来源、目标、已发布路线/ETA/行军风险与阶段事实。清营的 target 是实际营地，staging 是另一个合法集合 post；返回 option.target 为 staging，campId 独立绑定，clear-camp 的 force-at 不要求先站到敌营中心。stagingFacts 原样成为前置。

伤亡金额与 P 复用现有整组 camp / defense battle 和保护模型，不加入目标收入、生产费用或第二份 bundle 机会费用。defense 的旧 field-strength 战斗模型与新的 combat-rating 到岗门槛分开，后者必须显式提供 `requiredCombatRating`；缺标量时返回共享 pending 候选，而非填 0。行军风险缺失时成本/P 保持 pending。敌方 aboard-unload 尚无预算化归属端口时，清营 helper 在旧 assessor 触发原生卸载投影前保留 pending。

评估副本只用于条件战斗，不产生世界实体、lease 或输出回执。测试核实际原生快照、同组原 battle 金额/P、集合点绑定、符号引用、持续防守 offset、严格原生导航闸和 JSON/输入不变；固定已发布路线与风险端口不构成完整 source 或题库执行验收。

`goal-naval-executors.ts` 独立导出 `goalNavalExecutors`，注册 ID 为 `goal.<actionKind>`，交由唯一 ready-action bridge 选择。八种海运/防守动作都接现有 `ExecutorInput` / `ActionGrant` / command gateway；仅接受中心已解析的 existing 引用，所选成员、船体及整船实际乘员必须有本 action 的真实 lease，中断成员不能暗借回来。原声明的 strategy executor 名称不构成第二条执行入口。

集结、清营、撤离复用现有原生执行逻辑，目标和所选组来自声明参数；集合 staging 与实际 camp 中心分开。调用前使用同一个 landRoute 端口，unknown 为 pending，不回退私有导航。持续防守可保护尚未施工的明确地点；到岗后守到 throughTick，晚到不能伪称完成过去的保护窗口。纯调船不要求乘员，实际 cargo 仍逐项核租用。

运输直接使用已解析的船、组、水陆点执行串行 move → board → unload，不为 aboard origin 填假原岸或自建 VoyageAllocation。首条 move 保留，未观察到船进入容差前不下 board；已确认的泊位漂移成为顶层 failed。所有装载、航行、卸载进度来自实际快照，全部目标成员实际上岸且实际 cargo 已卸空后才完成。抢占反馈使用现有 handoff ACK，保留状态，由唯一框架决定后续资源和进度。

执行回归使用真实原生快照和显式现有 grant，覆盖严格导航闸、pending/unreachable、extra lease 不扩选组、空地点保护、原 4180 公开登船链、真实 aboard 卸载、清岸与抢占。它们验证领域 adapter/native 协议；统一 source → 规划器 → 分配器 → gateway 的公开题计划/执行检查仍须在共同接线后单独验收。

集结和运输同时声明同一所选组的 `field-strength` 世界效果，数值使用既有 `assessAllocatedForce(..., {metric:'field-strength'})` 整组字段。集结是精确 post 的 force-at，运输是目标陆块 pool 的 force-available；符号成员仍保持原引用。该度量不进入可加 combat-rating 库存，不借用其他同陆块单位，也不把运输到岸当作已经走到任意 post。

`declareGoalGarrison` 复用唯一的 `declareGoalHoldPosition`，只补 garrison-ready 效果与 hall-complete 前置。动作仍是 hold-position，执行器仍是 goal.hold-position；精确组的 force-at(post) 前置负责实际到岗，之后在 start 建立 garrison-ready，守军占用维持至保护窗终点。它不在留守内部再走一次集结或回防。不同矿的义务进入不同 action ID。执行参数的 `target` 是守点，`garrisonMineId` / `garrisonAt` 是逻辑矿绑定，`cohort` 与 `throughTick` 是同一个持续义务。

该声明不把厅完工或命令 ACK 当作守军证明。中央 world reader 必须另外核实厅真实完成、精确组实际到岗、有效 hold-position grant 和实体 lease 覆盖 throughTick、当前整组保护能力；缺证明保持 pending/unmet，并保留活动守军义务。声明/provider 测试只验证这些前置、效果、单位和时钟合同，未宣称中央正式证明或完整扩张执行已通过。

`createArrivalQuery` 的可选第九参 `ArrivalPlanningPhysics` 将同一个 Situation 查询器的 berth、ground 与 launch 交给已发布物理事实。传入该对象后，船厂海点、已有 ferry 起终岸和敌船 unload 归属都经过 ground 端口；未发布的泊位不会退回粗岸点，未来 launch 未知也不会把真实现有船一起丢掉。unknown Arrival 保留原物理 request IDs，查询内重复调用仍保留依赖。不传该对象时维持原只读/native 路径。

`createArrivalPlanningPhysics` 可在 Situation 构造之前绑定同一 geometry 与 landRoute。boarding 复用有限原生泊位游标；精确可行地面点的单点检查计入同一队列并在下一 think 发布。非精确的最近地面投影、部分 walkDestination 终点和 harbor launch 排名必须由注入的预算化服务提供，缺失保持 pending，不执行整套 native 扫描。当前定向回归只关闭 Arrival 端口的账外回退；公开 owner scope 的冻结世界 K10、Situation 自身投影及完整题库由共同接线另验。

`createGoalNavalCombatGrounding` 枚举真实当前陆块组及单成员贡献者、具名救援工人、实际在船 manifest。它消费同次 Arrival、landRoute、resolveCohort 与已发布行军风险，不创建查询或扩大可用池；allowed/interrupted 边界在候选组处生效。防守沿 SiteThreat 的整支互斥敌军情景重用同一保护 P 与原生战损，combat-rating 门槛由实际武器/HP 单独评估，不能改名复用 field-strength。估算的 guard post 原样成为执行参数，site-safe 的逻辑据点独立保留。

本地增援建立所选组真实的 field-strength 效果，资源账仍只记 combat-rating。未知 route/risk/响应保持原请求与 pending 估计。跨海 force-available/worker-at 只提供真实源 land 或 aboard sea 的 manifest，实际航次费用/P/时长必须另读 transportOptions；不生成跨水陆路。跨海直接到 post、尚无实际池绑定、未覆盖的保护窗仍保留 deferred/pending，不能把当前候选构造器的测试称作这些依赖或完整公开题已通过。

`assessGoalCombatMovementRisk` 只接受当前真实组和逐成员已发布路线。它在完整行军时窗内检查观察到的移动敌军及技能/物品、敌船载兵、营地 home/return/leash、未完工塔、投射物和持续伤害场；仅无暴露证明返回零损失/P1。有暴露或缺事实时，保留 pending，或消费同 epoch、同请求精确绑定的已发布既有模型结果，不生成另一套风险概率。未来评估组不冒充当前真实成员。

`goalCombatMovementRiskId` 的完整语义键仅供运行时模型绑定，不写入 decision memory 或诊断 request ID。纯 helper 不创建 Situation、查询、风险 batch 或工作额度。其定向测试核原生快照、严格导航闸、整窗接敌、营地/塔、陈旧或替换的路线/组、物品射程及 JSON 不变；不代表 owner-think 6144 或公开题已通过。

`camp-staging(campId, at, cohort)` 独立证明指定营地的集合点、退路与其他营地避让，既不建立持续 `site-safe`，也不免除目标营地的接战损失。清营与 camp-force 集结均消费该事实，避免以自身 `camp-cleared` 的派生安全作为清营前置。`readGoalCampStagingFact` 只读同次共享 ground/landRoute/resolveCohort；未公布的物理请求继续 pending，真实空组、敌方组或敌营中心不能充作集合事实。其 revision 只含相关几何，路线谓词的 point 只保留坐标。

清营候选复用原生集合点顺序和同组 battle/赏金模型，`option.target` 是 staging，实际营地由 campId 绑定。集合负责当前来源到 staging；清营本体只计 staging 后的接战段。跨海和未来池仍 deferred，未发布条件行军风险时即使战斗时长可算，成本/P 也保持 pending；固定风险端口的构造器回归不证明真实 owner-scope 已有该风险事实。

未建厅矿点的 garrison 不再要求已有 SiteThreat 才能枚举：仍是同一个 hold-position，以真实 hall-complete 和精确 force-at(post) 为前置，守到完整 throughTick。只有对应 post 的当前、完整、无威胁安全窗事实才能证明零守点损失；安全靠作战维持、缺时窗或缺保护评估时，候选的成本/P 明确保留 pending。没有把未知保护能力或命令 ACK 填成 P1。
# 清营搜索报价与精确执行

`context.precision='coarse'` 时，清营候选可在运输泊位尚未公布时声明。
它以当前真实成员的 HP、武器和升级属性，条件于整组到达原生
`stagingPoint` 候选后，调用同一个 `GoalCampBattleModel`。候选仍要求
精确组的目标陆块兵池、`force-at`、`camp-staging` 和接战路线；粗估不
建立这些世界事实，也不发 Arrival、路线、地面投影或风险工作请求。
声明显式标为 `precision='coarse'`，必须由中心精确 refinement 后才可授予执行。

临时默认模型明确标记 `casualty-alpha-0.19`，损失分布返回 null，
不冒充清营专模。后续专模可通过同一个 `campBattleModel` 注入口替换，
粗/精确两档均消费期望金币损失、独立胜率与战斗时长，不附加损失余量。
精确档仍使用已公布行军风险和路线；未知敌军卸载归属保留 pending。

题 1 搜索所需的 garrison-ready、force-at/force-available、worker-at、
transport-at 也有同档粗估分支。它们只用已缓存成员、region 与直接距离；
零行军损失和 P1 是标注为乐观的搜索估计，不是无暴露或保护能力证明。
远程 post 显式依赖同一组到目标陆块的兵池，garrison 仍要求真实厅和
安全窗，运输仍消费中心注入的粗 transportOptions。所有返回的声明
（包括 transport 循环内的动作）统一标记 coarse，不能直接执行。
