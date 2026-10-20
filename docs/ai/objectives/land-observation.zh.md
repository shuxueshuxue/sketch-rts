# 陆地目标的只读报价

本轮对应战略层设计的第 1 步。`generateLandObjectives`、`decomposeLandObjective`、`landIdleForces` 只消费统一的 `Situation` 和借用的世界/任务上下文，输出候选、效用、前置条件及替代子图；不发命令、不写任务、claim 或预算。当前执行器的先后顺序不变，v8/v9 对手不接入这些报价。

## 合并验收：main 42bf5544

本 PR 已从 #564 的 stacked 分支迁到 main 42bf5544，代码验收头为 `0823ea6a`。只保留陆地只读目标首版和 `b12b275b` 的活动矿机会修复；后续统一资产/整组机会成本、capacity 与实测补员曲线属于独立增量，不在本 PR 中提前启用。下文首版估值口径不能当作未来控制分配器已校准的最终报价。

新 head 的陆地相关 10 个测试 suite／114 项通过，包含三个房间版本的默认 inline/worker-host 零构造与 WithTrace 正对照。七个真实帧的完整计划、运行时观察计划、观察历史以及命令／完整 policy／世界摘要与 rebase 前 `b12b275b` 逐字节一致，旧金标未更新；根 tsc 通过。

默认关闭观察/控制路径的性能直接沿用已冻结、串行三轮 ABBA 的陆地 AV 数据；它测量的是 `3d9b8f41`，不是本次 rebase 后的新 head。两者的生产差异仅为显式观察入口的活动矿收入修复及 #564 合入 main 后的接线基线；上述零构造回归已在新 head 重跑。源代码关系和原始数据见 [共享冻结收据](situation-default-path.evidence.json)，48 文件／23.47 MB 的不可变包保留全部 18 次 run。

| 蓝宝默认路径 | main646 中位数 | 冻结陆地 AV 中位数 | 变化 |
| --- | ---: | ---: | ---: |
| 整局 p95 | 34.9633 ms | 34.9320 ms | −0.0898% |
| 整局 max | 154.4698 ms | 155.2296 ms | +0.4918% |
| 后 6000 tick p95 | 39.4074 ms | 39.3714 ms | −0.0913% |
| 后 6000 tick max | 72.8959 ms | 75.0357 ms | +2.9353% |

MAIN 的 p95 AA 范围 34.5166–35.8345 ms、MAD 0.2443 ms；AV 的 p95 MAD 0.0558 ms。18 次 run 的 Situation 构造次数均为 0，命令、完整 policy-memory 与最终世界均相同。该结果证明默认路径未增加实际战略计算；常开评估约 +13.5% 的性能债务仍留给首个控制切片，不以这组默认关闭数据抵销。

## 金额、条件与方法

全局参数来自 `strategy/utility.ts`：评价窗 120 秒，据点默认威胁窗 45 秒，1 点 field-strength 对应 100 金；成本为兵力强度乘占用时间。效用统一为 `p × 收益 − 预期成本 + 坚持加分`，成本仍是报价而非预算承诺。成功后才付的矿厅费用作为负收益；已经奠基的矿厅不重复收费。概率使用 `a²/(a²+r²)`，拒绝非有限输入；未知的应援路线保留 unknown，不把缺记录当作零。共享 evaluator 明确证明超出整个评价窗的物理下界，可从当前响应窗排除。

| 目标 | 收益 | 必须单列的前置/效果 |
| --- | --- | --- |
| ExpandLand / RecoverSite | 折现后的矿收入，扣尚未支付的矿厅费用 | 清营力量、实际可达工人、400 金与驻防交接；同矿共用 mining-established 效果，失地必须有连续观察中的己方厅消失证据，历史保存在 observation 中 |
| AttackSite | 当前目标资产、断矿收入、迫使应援军回防的压制价值，以及在建/主力外出的时机价值 | 实际目标被摧毁才达成效果；施工窗口要用实际工人数与剩余工时核对，不能把选中过 attack 算完成 |
| ContestRoute | evaluator 给出的真实前压点及其压制报价 | ETA 键是 opportunity.id，不能拿敌厅中心冒充路口；占用整个评价窗，不把驻守算成一 tick |
| CounterHarass | 受威胁厅、工人与采矿收入的风险价值 | 生成于真实 SiteThreat 中的骑射手或正在攻击工人的陆兵；有追上/射程压制与两轮有效伤害的能力要求；和 DefendSite 共用 site-safe 效果 |

报价只挑够用的候选队伍，每类最多四个目标，稳定排序并保留正在执行的身份。旧任务的兵、甲板成员和有条件的跨海路线不是空闲兵。目标的 sinceTick 与最短驻留沿实际任务承诺起点，不从首次观测再续一段驻留；同一效果重启任务时更新承诺起点。借调需要交接；有上一帧目标报价时，按被借战力份额列出原目标的机会损失；原报价未知时明确写明未知，不能视为已获授权。治疗、撤退等局部控制保留原任务身份，同时不兑现为可用战力。

候选先按资产/收入/机会价值与共享 ETA 粗筛，再对前四个精算。除拦截骚扰外，队伍只检查足以覆盖整个评价窗内全部可能援军的保守前缀；对清营，这个粗界只计常驻兵的 combatRating，不提前兑现射程收益或召唤物。这样裁掉的后续单位不会影响“够不够用”的结论。实际精算仍使用营地量纲、寿命和敌援抵达时间。

跨 think 的报价缓存放在 WeakMap 中，跟随 memory 对象生命周期，不写保存状态。输入签名包括精确 ETA/HP、相对剩余寿命、claim/医疗中断、预算是否足够、目标施工/占矿厅、可响应敌人、当地火力、离岗暴露和被借目标的报价；这些事实改变就重算，不对 ETA 或血量分桶。缓存只复用计算值：本帧推理使用本帧 tick，外部证据从本帧 Situation 取得，需求截止 tick 按相对 ETA 推进；不在计划输出里留下缓存命中或驻留年龄。七个真实姿态均测试了跨 think 后完整报价、方法、闲置记录与冷 fork 完全相同。候选消失、地图/阵营改变或时间倒退时丢弃旧项；借调机会成本不向当前目标自身收费。

应援军用统一 ETA 在“我方抵达 + 预计交战时间”内的可达成员计数，最多覆盖 120 秒；不以据点默认的 45 秒截掉远征途中可能赶到的敌人。共享层尚未细算的成员保留缺失/unknown，进攻、前压及清营都不能把它们当成零援军；只有明确的超窗物理下界可以排除。营地沿用 `creepForce/forceFor` 的量纲。召唤物按抵达后的剩余寿命占预计工作时间的份额折算一次；常驻施法者的 ranged 注解不等于前排，现有召唤物也不能独立兑现后续护送/留守。对营地使用战斗评分加权的寿命系数，未虚构施法者在场后的重召。

机会的缓存键仅使用现有结构化字段 `id/kind/target/valueGold`，不读取 `evidence.source/detail`。目标、估值、实际 ETA、守备和施工等变化由各自事实字段触发失效；commitment.source 仍用于区分真实任务和救命中断。证据只在 trace 投影阶段从当前 Situation 取得：改文案不触发数值重算，但展示仍更新。三条回归分别覆盖惰性证据、文案变化及价值/前压点变化；修改前前两条失败，修改后与冷观察一致。

已确认的缺兵保留“借兵”或“训练”两种替代方法，不把两者同时当必做项；缺工人、钱、运力分别保留 deliver-workers、wait-income、obtain-transport。现有兵或工人的 ETA 尚未报价时，保留 unknown 前置，不据此确认训练或调工缺口；已知只是临时召唤物时，也不能用它消除常驻前排的缺口。子图中的建厅依赖清营/清除占矿敌厅及工人和预算，驻防交接依赖实际矿厅。运输、训练的预算/队列落实属于后续统一分配和预算迁移，本轮的 demand 是报价，不是预留。

闲置另列 `idleForces`，不伪造 HoldReserve 目标。每兵只记一次：既有驻守、在途、医疗承诺的单位不算可调空闲；有真实可达的正效用备选时，闲置效用为放弃它的负收益；没有这样的备选，alternativeObjectiveId 为 null、原因标为 unknown，不把零报价解释成闲置没有成本。collector 对全部 family 的报价统一去重和排序，陆地函数不自行抢占。

## 数值入口与按需解释

接入共享接口 `32e2eaba` 后，`buildStrategyDecision` 的陆地结果图不携带 evidence/detail/explanation，也不读取或格式化这些字段；需要观察时由 `buildObservedStrategyDecision` 保存本次投影，再用 `projectStrategyTrace` 生成完整解释。数值判断仍读取 Reason.code、UtilityTerm.code 和 commitment.source。blocked 的 utility 拷贝通过 projectedCopy 保留解释投影，不能用对象展开提前触发 getter。

跨 think 缓存只保存数值、稳定 ID、需求和小型文字配方，清掉 Candidate/Opportunity、SituationUnit、原始单位及投影读取器引用。每次命中都按当前 Situation 重绑兵和机会证据，并推进本帧的推理 tick 与相对到达期限。动态文字在观察请求时才格式化；配方只持有当次捕获的数字/ID，不回读后续世界。纯数值→观察→纯数值、跨 think 与调用后输入突变均有真实帧测试。

共享 ETA 存储升级到 c648e634 后，陆地唯一的数组查找入口改为 unitArrival，17 个使用点继续共用这一个入口；未更改默认 family 接线。它读取共享紧凑行，不为每个单位/目标构造兼容数组和条目；普通保存快照中的数组仍走兼容分支。七帧测试将紧凑行单位的 arrivals getter 设为抛错，分别验证冷/暖数值报价与完整解释；旧入口七帧均失败，新入口均通过，未构造 rendered 数组。

旧共享解释金标原本仅含 NAVAL family，本 PR 在这组测试的 worker 输入显式指定 navalOnly；其他默认接线和跨进程冷暖/fork 测试继续包含 LAND family。另固定七帧陆地与完整 collector 的适配前金标，不通过更新旧期望来掩盖差异。

## 机会证据中的事实与缓存失效

文案确实编码了会变的事实。`id/kind/target/valueGold` 只是完整 `factKey` 的 `candidate` 部分，不能把它当成全部输入。以下逐项对应当前公开的 [机会生产器](../../../src/ai/strategy/situation.ts#L97) 与 [完整缓存键](../../../src/ai/strategy/land-objectives.ts#L160)：

| 证据中的事实 | 结构化依赖与失效路径 |
| --- | --- |
| neutral-mine：矿 ID、剩余矿金 | `candidate.key/op.id/op.target` 标识矿；`op.valueGold`、`assets.discountedValueGold` 和资产的评价窗收入标识实际收益。余额在评价窗收益上限之上小幅减少时，数值报价不变，可复用，但证据刷新；降到收益上限以下会改变价值键，归零会移除机会 |
| neutral-mine：矿口没有矿厅 | producer 每次重新检查矿口；出现厅会移除中立机会。若既有扩张任务仍需继续交接，候选可保留，但 `buildings` 中己方厅/占矿敌厅的 ID、owner、位置、完工和施工字段改变，触发重算；已经落基的厅不重复付费 |
| weak-site / construction：厅 ID、complete | `op.id/op.kind` 区分施工与完工；`buildings.complete/buildProgress/buildTime/施工工人数` 和 `assets.complete/discountedValueGold` 覆盖当前资产及能否赶上施工窗口 |
| weak-site / construction：650 内本地陆军人数 | 报价使用可响应成员的 ID、战力、HP、寿命和 ETA，均在 `enemy` 键中；人数跨过零时会增删 `army-away` 机会，也改变 `candidate.opportunities`。人数非零的变化若未改变响应成员、ETA、战力或机会集合，就只改变解释，不改变计算输入，无需额外重算 |
| army-away：650 内没有陆地守军 | 由真实守军检查生成/移除此 kind 的机会；不能仅靠这段话证明据点安全。敌援仍由 `enemy` 的结构化 Arrival、战力和寿命另算；原文“援军另算”没有藏入 ETA 或战力数字 |
| route：已有真实前压点、目标厅仍存在、ETA 用机会 ID | `candidate.target/op.target` 覆盖点位与陆块，`op.id` 是 ETA 键，`pool/enemy` 中的 Arrival 覆盖状态、精确时间和跨海前置。目标厅消失或任务点撤销会移除机会，候选重建后清掉旧缓存 |
| lost-site：原厅曾存在、现在消失、原厅 ID、关联矿、前后 tick | producer 用序列化的历史资产与当前资产确认失地，才生成 `lost-site`，进而生成关联矿的 RecoverSite。关联矿/价值变化由 kind、target、资产键覆盖，夺回或资源耗尽移除机会。对同一矿，原厅 ID 和证据观察 tick 仅作历史归因，不参与当前收益/风险；缓存命中仍取当前证据，保留原始历史 tick |

清营状态和路线可达性没有藏在上述机会文案里：营地的存在、成员、HP/攻击属性、战力和寿命由 `camp` 键覆盖；到达状态、时间、crossing 与 unknown/unreachable 的决策 code 由 Arrival 投影覆盖。无需从解释恢复这些事实。本次核对未发现缺少结构化覆盖的数值依赖，未新增决策字段。

新增单变量回归只改变同一敌兵到敌厅的 ETA：从实际交战窗口之外移入窗口之内，两值都在 120 秒评价窗内；其余单位战力、完整快照、机会四字段及文案不变。断言确实重算、成功概率和效用改变，并与冷观察一致，专门验证机会键之外的 `enemy.arrival` 依赖。

## L1–L6 的真实帧

原始世界来自 [陆地契约证据包](land-contract.evidence.json)，均为执行 owner think **之前**的完整快照。测试夹具同时保存来源 SHA256、evaluator 提交和统一 Situation；没有在测试里另写 ETA 或威胁算法。原始模拟版本是 883f57c5，统一 Situation 来自接口提交 679464e1 的完整单帧入口（基于 main bc33a34a，包含真实医疗投影和骚扰者 ETA）。

| 事件 / tick | 核验结果 |
| --- | --- |
| L1 / 7560 | ravager 1039/1044/1058 的 DefendSite 承诺保留，不进入闲置池；其他目标借兵必须列出交接 |
| L2 / 9015 | archer 1334/1515/1537 同时保留 attack 与 expansion 来源；hold 订单不抹掉原进攻身份，报价将借调交接单列，尚未改变旧执行器的磨损撤回判定 |
| L3 / 14025 | chieftain 3872 保留远方驻守，同时记录 mobileCare.claimsUnits；不兑现为清营/进攻可用兵 |
| L4 / 16875 | contractArcher 1923 保留 mineGuard、当前 mobileCare 选择和 follow 医疗订单证据；不当作闲置 |
| L5 / 16980、17985 | 在途/已登陆 caster 仍归 ConquerIsland；不重复生成同矿陆地扩张，也不把 caster 算成清营前排 |
| L6 / 8265 | spirit 1903/1953 在到达前过期，其他 spirit 的寿命折算后仍不能单独满足常驻前排前置；生成借兵/训练子目标，保留资金和驻防缺口 |

L3 的执行器归因取自原始逐 think 记录：14010 和 14025 是 **mobileCare** 的 accepted move，14040 才是 expansionGarrison 的返回命令。它不是 postRecoveryAssignments 当前选中的患者；不能仅凭血线或避战 move 猜执行器。

联合 collector 将报价分为两段。`feasibleObjectiveIds` 只列当前可行目标，按效用排名；blocked 目标的 `utility.score` 和 `rank` 均为 null，在 `blockedObjectives` 单列缺失前置、条件潜在值、假设和各替代方法的前置成本，不用 0 或非有限数作为排序哨兵。根 `objectives` 保留唯一实体表，观察到的旧任务与救命中断仍可关联到不可行目标。

已命名队伍、路线、敌援和借调原目标的机会成本明确时，前置满足后的潜在效用可按同一公式报价；例如只缺矿厅本金时，不再重复扣已经列为负收益的 400 金。需要尚未定义的新兵/反制兵、未知几何或敌援、未知原任务价值时，`potentialUtility` 保留 null 并记录原因，不拿需求强度虚构新兵已到岗。borrow/train 的前置成本逐 method 列出；`hall-after-clear`、`missing-worker` 等已计入项通过代码引用去重。最小历史只消费 id、承诺起点、稳定性和 nullable 的已知效用分数，条件潜在值不用于借兵损失。

## 验证与边界

陆地函数对七帧的完整输入 JSON 均无修改；重复观察结果相同。在旧 planner 前单独加陆地函数时，命令、完整 memory 与世界快照哈希不变。联合 WithTrace 的框架只新增 `memory.strategy.observation`，用于确定性几何公布进度及最小报价历史；命令、世界快照和所有原 policy 字段仍逐字节相同。陆地函数本身不写观察命名空间。独立进程还核验了冷缓存、其他 owner 预热、逆序预热和中途序列化 fork 的完整 trace/观察历史一致。

679464e1 上的正式接线（代码 887cedd8）通过 98 项模型、事件帧、两段报价、共享 collector 和跨进程一致性测试，根 tsc 通过。完整 src 在 A100 以 4 workers 运行，714 个文件中 712 个通过，7960 项通过，耗时 471 秒。剩余两处为环境/副本问题：think-worker 的已知 30 秒超时，以及缓存副本缺少 `docs/ai/plan-viz/timeline-model.js` 导致 plan-trace-history 未收集；两文件在 juma 分别 4/4、12/12 通过。没有新的断言失败。

机会键去除解释依赖后（7872fcab），同一套相关测试增至 101 项并全部通过，根 tsc 通过。七帧的完整联合计划、运行时计划、观察历史和命令/policy/世界摘要均与 887cedd8 逐字节一致；本次不改公共字段、默认接线或执行器。

惰性解释接口适配（共享基线 32e2eaba）通过 6 文件 117 项测试，根 tsc 通过。七帧的完整陆地、联合 collector、运行时计划、观察历史与命令/policy/世界摘要，均和本次适配前的 fce46006 逐字节一致。新测试固定适配前摘要，覆盖全字段解释拒读、纯数值/完整投影互换、输入突变后的原始解释，以及默认陆地接线的冷暖、fork 与未采集解释模式一致性。

c648e634 紧凑 ETA 适配通过 7 文件 126 项测试，根 tsc 通过。七帧完整陆地与联合 collector 的固定金标无需更新，运行时计划、观察历史及命令/policy/世界摘要也继续和 32e2eaba 适配前记录相同；共享 NAVAL 金标和默认 LAND 跨进程冷暖/fork 均通过。本次 rebase 保留共享 withStrategyFrame 作用域，plan.ts 相对共享基线仍仅增加陆地 family 导入及默认列表项。

首次 rebase 到框架 35676cad／main 646cf9a0 时，保留 withGoalDistanceFieldLease、withStrategyFrame 和 startup 预热；陆地模块计算源码未改。9 文件 137 项相关测试与根 tsc 通过，A100 4 workers 完整 src：735 个文件中 734 个通过，8126 项通过，耗时 495.8 秒；唯一失败是已知 think-worker 的 30 秒超时，该文件在 juma 单独 6/6 通过，没有其他断言失败。七帧完整计划/运行时计划/观察历史旧金标无需更新，命令及世界摘要也不变。跨 main 的原 policy 哈希只因 #574 新增 landExpansion.reason（七帧）及 L5-front 的既有夺岛 reason 精确化而变化；新 main 内普通/观察规划完整 policy 仍逐字节一致，未在这项对照中删除诊断字段。

本轮再 rebase 到 a5d53439（main 仍为 646cf9a0），接入仅供诊断的 `situationConstructionCount()`。11 文件 148 项关键测试与根 tsc 通过；三版本 inline／worker host 的真实构造计数差为 0，WithTrace 正对照为 1。七帧完整计划、运行时计划、观察历史和命令／policy／世界摘要与此前 35676cad 记录继续逐字节一致。陆地计算源码和共享默认 family 差异未变，计数不进入记忆、trace 或决策。

Ne 17991 另有一个活动任务估值边界：四名 ravager 留在起始岛，目标大陆上没有工人；普通扩张候选因此被过滤，活动任务再从 fallback 补入时丢掉了对应的 neutral-mine 机会。Situation 已知该矿剩余 9000 金、评价窗潜在收入为 800，旧报价的 mining-income 却是 0。本次单独修复让 fallback 带回同矿机会，按原 ETA 与施工时间折现后收入项为 413.806 金；运输、兵力、敌援和借调前置仍未满足，当前效用与条件潜在效用继续为 null，不能当作免费借兵的依据。

确实缺少收入机会、又没有实际开采收入时，不再生成数值为 0 的收入项；改为 `mining-income-unknown` 的 unknown 经济前置，保留阻塞与原因。它没有现金 demand，不会误生 wait-income 子目标；资源明确耗尽则仍允许已知的 0 收入，耗尽事实也进入缓存键。Ne 真帧和缺机会两条回归在修复前均失败，修复后通过；零构造测试、根 tsc 和七帧完整计划／运行时／观察／命令-policy-world 字节对照也通过，旧金标未修改。

默认路径的 18 次测量继续使用冻结源码 `3d9b8f41`；上述收入修复另列在其后。修复只在被显式请求的陆地报价函数内生效，默认路径的 Situation 与陆地报价调用次数仍为 0；报告将区分实测冻结版本与最终合并版本，不把旧测量标成新源码实测。

内存验收使用 12:37 校准口径：GC 后每房间存活 heapUsed + external 增量 ≤30 MiB；真实 room host 的 4 worker／8 房间服务树峰值由 main/candidate 各跑三次，整体增量 ≤15%。旧单房间 maxRSS 差仅作历史结果。最终录制器路径/SHA、Node、评估边界与保存的模块历史在两端保持一致；本轮尚未启动该验收。

16:55 调整验收边界：本 PR 与 #564 都是只读接口，默认房间在关闭观察和控制时不构造 Situation。只读 PR 的性能验收改为这一默认路径在蓝宝图的同机串行三轮 ABBA，对比 main 的 p95/max，同时断言 Situation 构造次数为 0。新增 `land-default-path.test.ts` 覆盖三种房间 AI 的 inline 和 worker host，分别检查 Situation、陆地报价调用次数为 0；显式 WithTrace 的正对照各调用一次，防止计数器没有覆盖实际入口。

常开战略评估的性能债务仍保留：共享分支当前报告 p95 比 main 增加 13.5%，不能把默认关闭时的零构造解释成常开也没有成本。首个开启控制的 PR 必须把 Situation、分配器和执行器合起来对比 main，整体 p95/max 中位数均不超过 110%；替换旧执行器挑兵成本后再验收，不在本 PR 放宽测试上限。

历史初版先在计时区外取得同一份 Situation，再比较旧 planner 与“陆地报价/分解/闲置 + 旧 planner”：四军 p95 230.56→233.74 毫秒，海图 44.53→53.14 毫秒，后者未达线，此后才加入候选裁剪与事实缓存。该历史表不能作为当前默认路径或首个控制切片的性能验收。原始逐 think 数据、命令哈希及本轮验证见 [A100 证据包](land-observation.evidence.json)。

本轮报价中的交战时长、风险、压制价值都是注明来源的估计，不是模拟反事实。当前共享输入仅提供已有前压点；没有真实几何的新增路口不拿敌厅位置代替。缺生产/运输前置的 blocked 目标可以保留价值和需求，但不会假造未来兵的 ETA、成功承诺或执行成功。终态、分配、抢占和预算承诺仍由后续阶段建立。
