# 陆地与经济原子动作

本文件跟随 `goal-planner-types.ts` 的共同词表。目标可以是扩张、摧毁据点、控制路口、结束骚扰；动作不包办整个目标，也不指定前后步骤。

## 经济声明构造器

`goal-economy-actions.ts` 只把共享 grounding 转成声明，不注册到默认行为入口，不执行命令，也不在构造时求路。

| 动作 | 前置 | 数量流与时长 |
| --- | --- | --- |
| 训练(兵种、数量、生产者) | 本种族原生生产边、可用生产通道、金币、人口档位、空余人口、合法出生出口 | start 扣目录金币并预占人口；finish 加真实兵种池及 native combatRating。船的载荷质量由 native shipProfile 给出，贡献海域聚合容量；不声明具名 hull output。工时用原生 trainTime。 |
| 建造(建筑种类、精确地点、工人) | 本种族原生建造许可、共享精确建址、目标陆块工人池、所选工人到工地的独立路线、金币 | start 预留本金并使建址不再空闲；finish 建筑完工并产生容量、同一生产者的原生 production 能力。时长是共享 walk ETA 加剩余工时。已存在的未完基础只续建，不重复付款。 |
| 等收入(金额、期限) | 同一次思考的结构化收入预测 | 只产生当前未预留现金之外的增量。窗内收入不足整个缺口时仍可贡献已知部分，由规划器与赏金等其他正流合算；不建立尚未凑够的金币事实。 |

训练只产出区域兵种池的数量流，不产生 unit 实体 output、出生 ID 证明或实体控制额度。后续动作由分配器从实际池子中选成员并租用。未来生产者建筑仍可用 output/binding；评估副本的 ID 不进入真实 entityIds、lease 或执行参数。船的载荷以原生质量计，不能把容量数当作乘客人数。

`worker-at` 表示同陆块可调用池；它不能证明工人已经站到工地。共享 route 尚未公布时，建造 duration 保留 pending。跨岛工人要由运工人动作建立目标陆块工人池。

人口档位与人口余额独立：骑士需要的 `supply-cap` 来自原生 `requiredSupplyCap`；购买所消耗的是 `population-room`。农场只在真实完成时产出目录规定的容量，不能把一座农场的效果写成任意目标人口上限。

建造的 start 金币负流表示分配后的可用现金预留；原生命令在工人实际破土时付款。它没有把付款提前写进游戏世界。

几何净空不能证明工人施工安全。建造独立要求工地点的 `site-safe` 覆盖其期限；矿厅另保留逻辑矿点的安全前置。营地死亡、回防或清理威胁怎样使该世界事实成立，由共享事实投影和原子 achiever 处理，建造声明不安排一条清营配方。

## 经济候选 grounding

`createGoalEconomicGrounding(context, ports)` 只实现共同 `buildSites / productionOptions`，使用中心注入的 `GoalGeometryReader`、几何 revision 和已准备的 mover-region 索引视图。它不建立 Situation、Arrival query、FactWorkQueue 或另一份预算。

建址以原生 footprint 对齐，按稳定方形环检查原生 `isBuildPlacementClear`；每个候选点和每个已有地基检查都分别记一份工作。游标只保留环、偏移、地基序号和至多八个候选，中心 source 负责分片、JSON 续算和下一次思考才公布。八个点是有界的替代候选，不证明其余地图没有合法点。候选可以互相重叠，不能把它们当作已同时占用的工地；执行前仍须原生重新校验。

每个建址保留原生精确建筑中心与工人的陆地 approach。合法船厂中心可以在水中；共享 route 的终点是 footprint 内可步行的陆地点，`goal.build` 执行参数显式保留它，不能把原建筑中心投到另一点。真实工人的 route/ETA 来自同次事实端口。还没有真实工人的 binding 保留 pending，不用逻辑锚点伪算当前步行时间。

已有未完工建筑按实际身份进入候选，建造声明读取原进度并免除第二笔本金；完成后有空训练通道才建立 production 能力。现有生产者候选依据本种族原生生产边和实际 mover-region，未完工或队列占用者不伪造释放时间。尚未公布的可选新工地放在共同 `deferred` 字段，已有可用生产者仍可比较。

`goalEconomyActionProvider.actionsFor` 将一个请求效果映射到单个原子动作的候选。训练同时提供单个成员与所需批量的替代，数量缺口可由不同生产者的正流合成。人口容量枚举原生可建、确实提供容量的建筑；不会把一座农场的效果写成任意高的人口目标。缺少生产者时，训练保留 `building-complete` 前置；建造提供绑定在同一 output 上的 `production` 效果，由规划器反推，动作 provider 不调用另一个 provider 来编排链。

精确现存 cohort 不因训练额外单位就变强；这种绑定不会生成训练 achiever。`camp-force` 的非线性充分性仍由共享整组评估决定，provider 只枚举 native combatRating 的正贡献，不把营力除以单兵评分来承诺人数。此 provider 还未注册到默认命令入口。

## 只读经济事实

`readGoalEconomicFact(fact, context, ports)` 供统一 `GoalFactReader` 调用，ports 是同一几何 source、几何 revision、已准备的 region 视图及显式 `reservedGold`。非经济谓词返回 `null`。它不创建总 reader、Situation、Arrival query、工作预算或世界实体。

金币 quantity 是当前原生现金减去本次显式预留，预留不从旧 ledger 重扣。未来收入沿用同次 Situation 中逐矿当前 staffed rate、剩余矿量和原观察窗；源是有限绝对时间段，不能从总 `predictedIncomeGold` 倒推平均率，也不延长窗尾。它保留观察层原有“维持当前采矿条件”的预测假设，不声明收入保证。

人口读取原生快照的 supplyCap / supplyUsed，后者已含已付训练队列。生产通道非空是已知 occupied，单凭剩余工时不能承诺一个准确释放时间；新建筑 output/binding 尚未出生是 unmet，可回归建造，不写进当前 entityIds。生产者队列、研究队列、完工、升级和实际动态 rally 进入 revision。建址单点校验也通过中心几何工作与下一 think 公布。

陆地出生出口复用 native `landSpawnPoint` 的规划 reachability 回调，回调只读同次 route 事实；不采用暖原生求路缓存。出口路线尚未公布保持 pending。海出生原生 `shipLaunchPose` 尚无规划回调，内部有 steerPoint；当前明确返回 `native-sea-spawn-port-required`，不绕过预算调用。完工大厅按原生矿距/陆块关联绑定逻辑矿，船厂按实际 footprint 邻接海盆读取。

## 陆地动作的共同边界

| 原子动作 | 前置与效果 |
| --- | --- |
| destroy-target | 指定真实作战组到岗、该组的共享战斗评估；建立 enemy-site-destroyed。 |
| hold-position | 指定组到岗并在声明窗口内占用这些成员；建立该窗口的 route-controlled。 |
| engage-units | 指定组到岗及该组的 interception-capability；建立 harassment-ended。 |

速度、射程、火力及 camp-force 都由共享事实/整组评估给出。全池里另有反制兵，不代表被分配的弱兵组具备反制能力；声明前置须绑定实际 cohort。缺反制能力时由生产候选回归到同一训练动作，动作侧不插入特定兵种的固定步骤。

`goalLandActionProvider` 只消费统一 `grounding.combatOptions(effect)`。端口缺失或候选 pending 时不私选军、不另跑战斗；可用候选声明精确 cohort 的能力前置，符号成员仍保留 output/binding，路线和战斗时间 pending 继续透传。测试使用明确的结构化评估端口验证这一绑定，没有将它当作完整战斗预测或题库结果。

`hold-position` 的前置是精确 cohort 已在 post 的 `force-at`。前置成立后，在 start 建立 `route-controlled`，成员继续占用到 finish；它不等守点结束才交出控制事实，也不把同陆块可调用池当作到岗。移动到 post 由对应到岗前置和其 producer 的效果时刻证明，不能在 hold 本身再叠一次行军时间。

## 陆地能力事实端口

`readGoalLandCapabilityFact(fact, context, ports)` 只处理 `interception-capability`、`harassment-ended`、`route-controlled`、`enemy-site-destroyed`；其余返回 null，由 32 的唯一 reader 组合。端口不建队列或 Situation，不选兵，也不调用原生导航。`ports.regionAt` 是已准备的区域查询；所有行军证据经过同一个 `context.readFact(route)`。

拦截能力仅核请求里的真实精确 cohort。空组是已知零，未出生的 output/binding 不产生实体 ID；在另一任务池里的快兵不会补进来。单骚扰者使用旧陆地评估同一个 `canLandIntercept` 和原生 `resolveUnitDamage`，保留射程/速度优势与两轮齐射门槛，另核真实行军 ETA、当前武器冷却和寿命是否允许在声明窗内完成两次开火。冷却在行军途中也流逝，不重复相加。未公布路线、缺 ETA、未来才可用的路线保留 pending；已公布不可达是已知不足。已知成员足够时，另一个未解成员不阻止该能力成立。多名同时骚扰者尚无共同整组评估端口时明确 `land-joint-interception-assessment-required` pending，不能重复花同一份齐射伤害。

持续控制/骚扰结束须由正式执行观察或投影给出同一 fact、同一 epoch 的 `readWindowProof`；当前无敌不保证未来整个 throughTick 窗口。指定敌实体的真实 hp=0 可以证明销毁；实体已从 snapshot 移除时须有 `destroyedEntity` 的原实体 owner、销毁 tick 和 revision。未知 ID、友方、尚未发生的销毁均不当成已摧毁。未来成员和上述证明仍由共享投影/生命周期源处理，本模块不私造预测世界。

## 验证范围

`goalEconomyExecutors` 与 `goalLandExecutors` 独立导出注册表，沿用 `StrategyExecutor`、`ActionGrant`、feedback 和公共命令闸口。`goal-action` 的参数须由中心解析成 existing 引用；共用解码器拒绝 output/binding 和裸字符串冒充实体。训练只用指定 queue 和资金，逐真实 job 串行跟踪；通过本 think 的 `goalTraining` 核同 command/producer/job/兵种的数量状态，fulfilled 且 creditedQuantity=1 才计完成。cancelled 明确失败并撤掉这笔预期，pending 不借当前池中现兵猜兑付。没有训练 `goalOutputs` 或实体 ACK，建筑仍保留精确地基绑定。中心自行核自然完成候选、取消连续性和实际同区域池增量，本 adapter 不实现第二份数量账本。未提交新命令的既有已付地基沿 existing 效果，不再声明新产物。

建造只用精确 site、approach 与获配工人；同共享路线未发布时 pending，施工/付款/完工依据原生地基与接纳前 baseline。等收入只读本 think 注入的 `goalFacts(gold)`，不以 gross cash、预测收入或其他目标的预算代替 free gold。陆地三个 executor 只命令声明中的真实 grant cohort；守点要求已在 post，持续到 throughTick，首次到期后才启动不能补造过去控制；进攻不改目标，驱赶只攻击能力事实里具名的威胁。它们不创建策略入口、导航队列或新 grant，也不把独立命令链测试称为完整 owner-think 执行验收。

构造器和 grounding 测试包括真实原生训练付款/出生、真实农场完成后解锁骑士、同一共享 6144/Arrival 的水中船厂中心建址及公开 move→build 完工，以及 route/income 结构端口、JSON 续行、零预算和无账外原生导航调用。两份 actionsFor 的测试验证单原子候选、生产者 output 连接、数量部分贡献和精确战斗组绑定。它们不替代公开题的完整规划和执行检查；规划器分配接线及执行绑定仍需在同一共享事实源上继续验收。
