# 陆地进攻与扩张：执行模块契约和目标冲突实录

本稿固定于 **main `883f57c51838ed75057a2a2dc4fce5e16cdcfb4e`**，只描述现有行为，未改运行代码。2026-10-20，陆地线。文中的子目标区分“代码已经请求的动作”和“当前没有向上报告的缺口”，不替统一战略层决定优先级。

这些模块可以成为“局势评估 → 效用选目标 → HTN/GOAP 分解 → 执行动作”的执行端，但它们现在没有共同的目标预算。`unitClaims` 管一名单位当前的归属，不能回答哪个矿或战线更重要，也不能保证一个目标最终凑齐条件。`stage`、一次命令和目标效果也不总是同一件事。

## 1. 调用边界与共同资源

`bootstrapPolicyContext` 先准备夺岛状态、维护新矿留守、产生经济需求，再准备陆地扩张任务；它发生在各脚本的正式争兵之前。[policy.ts:213](https://github.com/shuxueshuxue/sketch-rts/blob/883f57c5/src/ai/bootstrap_1/policy.ts#L213)

脚本 runner 先收集所有 `claimsUnits`，同一单位由列表里更早的脚本获胜；经济脚本先执行，再依次执行战术脚本。战术脚本仍会运行、修改自身状态，但已被认领或已收到本轮移动命令的单位会从结果中删去。因而“模块提出过动作”“动作被接纳”“命令三 tick 后实际交付”必须分别记录，不能把一个空结果当作该模块没有目标。[script-runner.ts:26](https://github.com/shuxueshuxue/sketch-rts/blob/883f57c5/src/ai/policy/script-runner.ts#L26)、[script-runner.ts:91](https://github.com/shuxueshuxue/sketch-rts/blob/883f57c5/src/ai/policy/script-runner.ts#L91)

持久 claim 和这次 think 的脚本 claim 不是一张表。`recordUnitTaskClaim` 只应在命令被接受后登记，任务租约为 3600 tick（180 秒），模块可反复续租；普通 build/retreat 等租约通常 900 tick（45 秒），扩张移动租约则只有 30 tick（1.5 秒）。`expansionMineId` 额外保存扩张成员身份；局部走位改变普通 claim 时，这个身份可以继续存在。`expansionMission` 是只保留成员身份的 kind，不应阻拦新的可选差事。`redirects: local` 保留防守任务，战略重定向才释放防守归属。[claims.ts:230](https://github.com/shuxueshuxue/sketch-rts/blob/883f57c5/src/ai/policy/claims.ts#L230)、[claims.ts:245](https://github.com/shuxueshuxue/sketch-rts/blob/883f57c5/src/ai/policy/claims.ts#L245)、[claims.ts:51](https://github.com/shuxueshuxue/sketch-rts/blob/883f57c5/src/ai/policy/claims.ts#L51)

各目标状态的正式结构见 [memory.ts:114](https://github.com/shuxueshuxue/sketch-rts/blob/883f57c5/src/ai/memory.ts#L114)。这里没有一个通用的 parentGoal、资源预订、依赖完成事件或失败传播接口；下文每个“子目标”都要注明由谁实际实现，不能仅凭命名把两段独立代码当成已连接的计划。

陆地主力的输入先由 `mainArmyIntel` 去掉矿防、追击返回、新矿留守、骑手独立任务、购物、拾取、雇兵 courier 和部分治疗任务。`availableV6Army` 再排除 raid、closeout、support、渡船的 `crewIds`、正在登船的人，并限制到 `intel.home` 所在的陆块。新战略层不能把这个“已经减过几次”的集合误当作全部军队，也不能把海上或另一座岛的兵加进当前陆地战力。[mine-defense.ts:313](https://github.com/shuxueshuxue/sketch-rts/blob/883f57c5/src/ai/bootstrap_1/mine-defense.ts#L313)、[general.ts:159](https://github.com/shuxueshuxue/sketch-rts/blob/883f57c5/src/ai/policy/v6/general.ts#L159)

## 2. 取得一片陆地矿：`landExpansion`

**职责及效果。** 一个 owner 同时保留一个陆地扩张目标，连续完成目标矿及路上营地的清理、护送、矿厅落基和新矿防守交接。它不负责海上运送、工人撤离、全军回防、也不保证完工矿厅已经配好采矿工人。选矿器保留尚未取得的原矿，避开友军已经认领的矿；第一座分矿优先附近的自然扩张，之后再比较清营缺口和可执行的施工路线。[expansion-target.ts:21](https://github.com/shuxueshuxue/sketch-rts/blob/883f57c5/src/ai/bootstrap_1/expansion-target.ts#L21)

**状态与事件。** `memory.landExpansion` 保存 `mineId/sinceTick/stage`，以及 `staging/stagingCheckedTick/roadCamp/combat/interruptions/paused/pausedAt`；阶段是 fund、assemble、clear、escort、build、complete。成员存在 `unitClaims[*].expansionMineId`，行动租约通常为 `expansion`，短租约被清除后可成为 `expansionMission`。目标矿耗尽、被对手占据、被盟友认领，或当前目标完成且仍缺基地时重新选矿；死亡、上船和防守认领会使成员退出。[expansion-mission.ts:27](https://github.com/shuxueshuxue/sketch-rts/blob/883f57c5/src/ai/bootstrap_1/expansion-mission.ts#L27)、[expansion-mission.ts:48](https://github.com/shuxueshuxue/sketch-rts/blob/883f57c5/src/ai/bootstrap_1/expansion-mission.ts#L48)

**挑兵与放兵。** 先排除 mineRally/mineLeash、expansionGarrison、harassSquad 认领的人，再从可用主力中找能打的前排；正在进攻任务中的人原则上不拿，最后工作矿消失时例外。清营时按 `creepForce >= forceFor` 补到足够，已经投入营地战斗的成员保留到营地打完；低于 35% HP、会被清营模块当成患者送走的人不能充当清营强度。清空后只保留最多三名施工护卫，其他人交还 general。满血且无防守/登船任务的雇兵 courier 可被召回扩张；治疗和渡船的既有归属保留。[expansion-mission.ts:94](https://github.com/shuxueshuxue/sketch-rts/blob/883f57c5/src/ai/bootstrap_1/expansion-mission.ts#L94)、[expansion-mission.ts:127](https://github.com/shuxueshuxue/sketch-rts/blob/883f57c5/src/ai/bootstrap_1/expansion-mission.ts#L127)、[expansion-mission.ts:148](https://github.com/shuxueshuxue/sketch-rts/blob/883f57c5/src/ai/bootstrap_1/expansion-mission.ts#L148)

有未被其他小队覆盖的自家威胁、持续中的 rally、矿工救援，或者目标矿 800 范围内的地面威胁强于当前主力的一半时，任务暂停并记原因。暂停清掉移动租约但保留可恢复的任务身份；恢复会补回被其他任务拿走的人，并补偿清营计时。没有工作矿、没有在建矿厅、也没有 400 金时进入 fund 并释放成员，不允许一个无钱施工的愿望长期扣住全军。[expansion-mission.ts:59](https://github.com/shuxueshuxue/sketch-rts/blob/883f57c5/src/ai/bootstrap_1/expansion-mission.ts#L59)、[expansion-mission.ts:103](https://github.com/shuxueshuxue/sketch-rts/blob/883f57c5/src/ai/bootstrap_1/expansion-mission.ts#L103)

**作为计划元素。** 效果应写成“矿 M 有完工的己方矿厅，且防守交接成立”。前置条件是阶段确实需要基地、矿仍有资源且未被友军/敌军占用、陆地有路、清营/护送能凑出对应兵力，并能筹到 400 金及工程兵。现有子链是“清路营 → 清矿营 → 护送施工 → 交接留守”；缺兵会产生本线普通兵种的补兵请求。它不会因为陆路失败而自行推出“造船、渡海、夺岛”计划，也没有绑定此矿的工程兵采购/运输子计划。

资源占用随阶段变化：一支按营地强度决定的清营队，之后最多三名护卫、一名实际施工工人、400 金矿厅费用；建造本身标称 28 秒，行军和战斗时间没有统一 deadline。完成前必须看实际矿厅与防守交接，不能只看 `stage === complete`：陆地函数先因矿厅完工写 complete，再用 `expansionGarrisonReady` 决定能否挑下一矿；夺岛函数则在矿厅与留守都就绪后才写 complete。这两个状态标签的语义目前不同。[expansion-mission.ts:79](https://github.com/shuxueshuxue/sketch-rts/blob/883f57c5/src/ai/bootstrap_1/expansion-mission.ts#L79)、[island-conquest.ts:76](https://github.com/shuxueshuxue/sketch-rts/blob/883f57c5/src/ai/bootstrap_1/island-conquest.ts#L76)

## 3. 清理矿点及路障：`planMiningScreen`

**职责及效果。** 这是陆地扩张与夺岛共用的陆战动作：清掉目标矿的营，必要时先清实际行军路线上的阻挡营，再把护卫送到目标或工程兵身边。它不选全局战略目标，不建船、不决定回防，也不直接下矿厅建造命令。接口接收具体的 `task`、`front` 和以本地锚点读取的 `intel`。[expansion-mission.ts:216](https://github.com/shuxueshuxue/sketch-rts/blob/883f57c5/src/ai/bootstrap_1/expansion-mission.ts#L216)

**状态、前置条件及资源。** `task.combat` 只保存这个父任务自己的 creep/creepRetry，避免改写同时进攻的 `memory.v6.creep`。`roadCamp` 保存正在清的路障。必须有可战斗的前排、营地准入所需的强度、集结队形和安全接近路线；新成员到 staging 的 180 范围后才加入正在清营的 group。没有固定“两人就能清”的契约，`creepForce` 还考虑营地和兵种。占用的就是调用方传入的队伍，无额外金钱预算，没有独立 claim kind。[expansion-mission.ts:185](https://github.com/shuxueshuxue/sketch-rts/blob/883f57c5/src/ai/bootstrap_1/expansion-mission.ts#L185)、[creep.ts:111](https://github.com/shuxueshuxue/sketch-rts/blob/883f57c5/src/ai/policy/v7/creep.ts#L111)

**子目标、完成和失败。** 目标矿营的接近路线被另一营挡住时，会保留矿 M，先把 blocker 作为清营子目标。营还在但不能开打时处于 assemble，至少三名成员时每 15 秒重试 staging；营不存在后转 escort，已经在施工时保留 build。集结人数达到 80% 或等待达到 25 秒时尝试开打，实际到场强度不足标准的 80% 就作 worn 放弃；开战后强度跌到营地强度一半以下可 abort。敌军在营地或军队 900 范围内强于队伍一半时作 enemy 放弃；重试禁用同营 30 秒。这些是局部尝试时钟，不是整个矿任务的总时限。敌军争营、兵力磨损、路线不成立会让现有清营逻辑退出/重试；调用方把 camp-threat 等信息记到父任务。单凭这个动作的“没有命令”不能判断缺兵、缺安全路线还是等集结；这些原因目前没有统一的结构化失败返回值。

**大陆与岛屿的交接。** 陆地由 `planExpansionScreen` 传入 expansion 成员；岛上由 `islandConquestCommands` 传入已登陆且未被骑手或防守任务认领的兵，使用任务 landing 的本地 intel。两者都复制私有 v6 战斗状态，但仍共享全局的兵员、金钱和静态留守模块；这里没有跨父任务比较收益或配额的裁决。[island-conquest.ts:207](https://github.com/shuxueshuxue/sketch-rts/blob/883f57c5/src/ai/bootstrap_1/island-conquest.ts#L207)、[island-conquest.ts:216](https://github.com/shuxueshuxue/sketch-rts/blob/883f57c5/src/ai/bootstrap_1/island-conquest.ts#L216)

## 4. 新矿防守交接：`expansionGarrison`

**职责及效果。** 让已经付钱落基的新矿在清营队离开后仍有一份当地防守，达到“矿口有实际到位的守军或足够的静态火力”。陆地和海外矿共用这份代码。它承担小股袭扰的留守，不负责大军 rally、跨岛救援、全图追击或工人撤离。

**状态与触发。** `memory.expansionGarrisons[hallId]` 只有 mineId/sinceTick，兵员是 `unitClaims` 的 `expansionGarrison`；`garrisonTemporary` 区分被临时留下的健康兵，成员不另存第二份名单。矿厅落基即准备交接，矿厅完工再验实际守军；守军死亡、上船、矿耗尽、矿厅消失、静态火力足够都会触发维护或释放。claim 由被接受的命令登记，`redirects` 为 local。[expansion-garrison.ts:133](https://github.com/shuxueshuxue/sketch-rts/blob/883f57c5/src/ai/bootstrap_1/expansion-garrison.ts#L133)、[expansion-garrison.ts:162](https://github.com/shuxueshuxue/sketch-rts/blob/883f57c5/src/ai/bootstrap_1/expansion-garrison.ts#L162)、[expansion-garrison.ts:201](https://github.com/shuxueshuxue/sketch-rts/blob/883f57c5/src/ai/bootstrap_1/expansion-garrison.ts#L201)

**挑兵与资源。** 从与该矿陆地连通的常驻、能打的前排中选，先留 HP<60% 的近战，再留伤射手，最后才留健康兵。排除骑手任务、courier、购物、拾取、外地治疗、其他防守归属和正在登船的人；同矿扩张护卫可以直接交接。以实际 steering 预测 45 秒内最早到达的两名敌军，按强度补足，绝非固定两人。无静态火力的安全空矿仍会留一名兵；新兵未实际到位前不撤掉旧守卫。有效交接要求人员在矿厅 650 范围内。[expansion-garrison.ts:73](https://github.com/shuxueshuxue/sketch-rts/blob/883f57c5/src/ai/bootstrap_1/expansion-garrison.ts#L73)、[expansion-garrison.ts:96](https://github.com/shuxueshuxue/sketch-rts/blob/883f57c5/src/ai/bootstrap_1/expansion-garrison.ts#L96)、[land-arrivals.ts:9](https://github.com/shuxueshuxue/sketch-rts/blob/883f57c5/src/ai/policy/land-arrivals.ts#L9)

**作为计划元素。** 前置条件是同矿已有己方矿厅，防守缺口仍存在，且兵或工程兵有安全路线。伤兵不足以覆盖预测袭扰时，才请求一座 125 金、标称 6.5 秒的塔，经济优先级 105；矿厅已经支付并落基，补塔不能抢它落基的钱。若伤兵足够、45 秒内没有可达敌军、已有塔/其他防守足够，便不产生这个购塔子目标。除此之外，它没有“招募 N 名专门守军”或“从大陆送一队守军”的子目标。[expansion-garrison.ts:109](https://github.com/shuxueshuxue/sketch-rts/blob/883f57c5/src/ai/bootstrap_1/expansion-garrison.ts#L109)

持续占用的是按强度选中的守军，必要时加一名建塔工人和 125 金。没有最长占用时间；只要该矿缺静态/替补防守便可一直续 claim。完成是静态或其他实际到位防守足以覆盖预测袭扰；矿厅丢失/矿耗尽则放弃。伤兵恢复不必然放人：保留的恢复兵可继续守矿，健康临时护卫要等交接真的成立才释放。更大袭击交给防守线；陆地扩张与渡船都应避让这些 claim。[expansion-garrison.ts:138](https://github.com/shuxueshuxue/sketch-rts/blob/883f57c5/src/ai/bootstrap_1/expansion-garrison.ts#L138)、[policy.ts:188](https://github.com/shuxueshuxue/sketch-rts/blob/883f57c5/src/ai/bootstrap_1/policy.ts#L188)

## 5. 打出结果的进攻：`landAttack`

**职责及效果。** 把一次出击保留成有目标、有结果的任务，优先打最近可拿下的分矿；能在施工结束前到达的在建分矿优先。已选中的目标不会被下一次评分随意换掉。只有真实目标消失、我方战斗力量丧失、或现有 general 明确撤退，才记录 destroyed、army-lost、withdrew。单纯选中 attack、下发一条命令或敌人暂时后退都不是完成。[attack-objective.ts:45](https://github.com/shuxueshuxue/sketch-rts/blob/883f57c5/src/ai/bootstrap_1/attack-objective.ts#L45)、[attack-objective.ts:103](https://github.com/shuxueshuxue/sketch-rts/blob/883f57c5/src/ai/bootstrap_1/attack-objective.ts#L103)

**状态及用兵。** `memory.landAttack` 保存 targetId/sinceTick、原 general 的 group/groupStart/stage 等副本、可选路营 camp、paused/pausedAt；最近结果写到 landAttackResult。group 是这一波的存活成员，常规进攻没有第二份 unitClaims roster。准入使用 general 的战力/守备/增援判断；在建目标额外核对实际 steering 到攻击范围的时间。扩张只保留必要护卫，余兵仍可归 general；部分兵被局部任务借走会从本波 group 排除，但保留出发时的 groupStart，让原有磨损撤退判断生效。

**反应及交接。** 实际回防优先；全部成员被扩张或其他局部任务拿走时，保存原攻击状态并暂停，恢复时补偿 stage/camp 时钟。只有部分被借走则不把整个目标抹掉。进攻道路有营地挡路时，营地是该进攻的私有子目标，原敌矿仍是 parent。这个路营和扩张自己的 combat 状态不会直接互相覆盖，但两者仍要同一批活兵。[mine-defense.ts:146](https://github.com/shuxueshuxue/sketch-rts/blob/883f57c5/src/ai/bootstrap_1/mine-defense.ts#L146)、[attack-objective.ts:131](https://github.com/shuxueshuxue/sketch-rts/blob/883f57c5/src/ai/bootstrap_1/attack-objective.ts#L131)、[attack-objective.ts:158](https://github.com/shuxueshuxue/sketch-rts/blob/883f57c5/src/ai/bootstrap_1/attack-objective.ts#L158)

**作为计划元素。** 效果是“敌方矿厅 B 被实际摧毁”，附带可观测的撤回/失兵失败结果。前置条件是目标仍存在、可用军队通过现有准入、可走到攻击位置，且没有更高优先的防守。占用整波 group；模块本身不支付金钱、没有一波最久多久的 deadline。当前会分解道路清营，却不会针对“还差多少战力才能打 B”产生绑定目标 B 的招兵、治疗、造船或增援计划；通用经济和其他模块自行决定能否补齐。兵都死/被借走不能算敌军已被打垮；目标损失和我方战损需分别记账。

## 6. 安全闲置后的前压：`territory`

**职责及效果。** 在全面进攻准入不成立时，让安全空闲的余兵占据通往对方矿区的道路，或者在当地已经占优时转成有限进攻。它不调整撤退线，不补兵，不派船，也不替代真实回防。

**状态、触发及资源。** `memory.territory` 保存 idleTicks/lastTick/idle/retryUntil、objective 的目标/点/时刻/站位几何、lastAction。没有独立 claim 或名单，用的始终是 general 当下未被别处拿走的兵。累计 1200 tick（60 秒）安全 hold 后启动；回防只暂停累计，进攻、清营、协助扩张不计时。summoner 在两轮召唤之间仍计闲置。新前哨至少三名 HP≥35% 的前排，已有前哨临时被借兵后可由两名维持；有限进攻还要同时占优于当地守备和实际可赶来的敌军。[territory-pressure.ts:18](https://github.com/shuxueshuxue/sketch-rts/blob/883f57c5/src/ai/bootstrap_1/territory-pressure.ts#L18)、[territory-pressure.ts:48](https://github.com/shuxueshuxue/sketch-rts/blob/883f57c5/src/ai/bootstrap_1/territory-pressure.ts#L48)

**作为计划元素。** 效果应分成“建立前哨”和“继续保持前哨”，不能把 reachedTick 当成永远占住该地。每次沿实际 steering 最多前进 600，距敌矿厅约 900 止步；三名兵实际到自身站位 60 内才写 reachedTick，足够的前排/宿主跟上后最多每五秒试下一段。没有安全点时 15 秒重试，期间允许原清营选择继续。[territory-pressure.ts:57](https://github.com/shuxueshuxue/sketch-rts/blob/883f57c5/src/ai/bootstrap_1/territory-pressure.ts#L57)、[territory-pressure.ts:84](https://github.com/shuxueshuxue/sketch-rts/blob/883f57c5/src/ai/bootstrap_1/territory-pressure.ts#L84)

前置条件是安全、general 正在 hold、没有活跃 landAttack、最小兵力仍在且安全路线成立。占用的是余兵的行军和站位时间，不新增金钱；没有最长驻留时间。缺兵/缺路线时不会请求“补一队前压兵”或“攻下另一条路”，只有等待/重试；真正攻击或清营会消费闲置额度并删除前哨，临时回防保留可恢复的意图。真实回防时，即使前排全被借走，也会清除供施法者跟随的旧前压锚点。[mine-defense.ts:167](https://github.com/shuxueshuxue/sketch-rts/blob/883f57c5/src/ai/bootstrap_1/mine-defense.ts#L167)、[territory-pressure.ts:159](https://github.com/shuxueshuxue/sketch-rts/blob/883f57c5/src/ai/bootstrap_1/territory-pressure.ts#L159)

## 7. 补齐经济前置条件：需求、预留与施工

**职责及状态。** `supportWants/expansionGuardWant` 根据阶段和当前军队追加基地、清营兵、治疗、反制等需求；阶段与需求年龄在 `memory.v6.phase/goalAges/doctrine`，`options.armyWants/expansionRecruit` 是本次 context。两个工作矿且有四名 HP≥60% 的前排可请求第三矿，较大军队还会提高基地数量目标；目标矿营地强度不足时，按缺口请求本线 standIn，优先级 80。它不提供一个跨大陆/岛屿按收益分配资源的目标队列。[policy.ts:77](https://github.com/shuxueshuxue/sketch-rts/blob/883f57c5/src/ai/bootstrap_1/policy.ts#L77)、[policy.ts:111](https://github.com/shuxueshuxue/sketch-rts/blob/883f57c5/src/ai/bootstrap_1/policy.ts#L111)

**实际子链和占用。** `rankBootstrapGoals` 复用普通生产、科技、放置和建造准入，矿营战斗时预留 400 金矿厅本金；assemble 缺最后补兵、补给和空闲生产线都允许时，为这一波必要补兵保留普通费用，购物/雇兵只能动余额。工程动作实际选一名可达的空手工人，不因其他种类施工而锁死所有建设；施工 claim 是 build。训练用实际兵种金钱、补给和生产队列，造矿/塔分别为 400/125 金；没有目标级的最长等待时间。[economy.ts:69](https://github.com/shuxueshuxue/sketch-rts/blob/883f57c5/src/ai/bootstrap_1/economy.ts#L69)、[economy.ts:119](https://github.com/shuxueshuxue/sketch-rts/blob/883f57c5/src/ai/bootstrap_1/economy.ts#L119)、[economy.ts:151](https://github.com/shuxueshuxue/sketch-rts/blob/883f57c5/src/ai/bootstrap_1/economy.ts#L151)

**跨线交接。** 同一个经济循环还收海军补运船/殖民、海外矿厅和恢复目标；选出的 nextLift 会被直接移到队首，海军预算还会从其他消费的可用金中扣除。首航缺可运兵时，可以把现有可训练的陆兵需求前移，但仍须本来存在这个需求。这里靠排序和多个 reserve 维系关系，不是一个能解释“为矿 X 的子目标 Y 预留多少金、何时解除”的共同预算系统。[economy.ts:216](https://github.com/shuxueshuxue/sketch-rts/blob/883f57c5/src/ai/bootstrap_1/economy.ts#L216)

**作为计划元素。** 效果应拆成“具体兵已训练完成”“具体工程已完成”“指定目标的本金仍可用”。前置条件分别包含有生产建筑、补给/预算/空闲队列、可达工程兵和合法放置。部分科技/建筑前置由普通经济收集器产生，营地补兵和补塔会明确产生需求；一个任意进攻/夺岛目标缺兵时并没有通用的反向推导入口。经济模块在下单时删除该 goal 的 age，不等训练或建造真的完成；工人死亡、生产建筑被毁后靠下一轮重新收集需求恢复，没有向某个父计划报告 failed/abandoned 的统一回调。等待一个 economy goal、把它年龄加大、或买了一条船，都不能视为父目标已经有一条可执行的完整计划链。

## 8. 路线执行服务的契约

`nativeLandRoad/safeLandTravelTicks` 检查实际 native steering 路线，调用方给自己的到达范围。成功只意味着当前路线/威胁检查通过，并不预留这条路、船、护卫或目标；失败返回 undefined，非法非有限的速度/代价抛出带坐标和单位的错误。它不产生“绕路、清塔、造船、等援军”的子目标，也不承诺威胁不会移动。因此规划器须把路线可行性作为会失效的前置条件，不能把一个有限 ticks 当成战略任务已经获准。[safe-land-route.ts:64](https://github.com/shuxueshuxue/sketch-rts/blob/883f57c5/src/ai/bootstrap_1/safe-land-route.ts#L64)

## 9. 真实对局的测量方法与边界

在 A100 自有目录 `/codegeex/jeffry/sketch-rts-codex/land-objectives-20261020` 跑四局新开局，每局从 tick 0 完整推进至 **18000（15:00）**，未提前终局。使用生产的 `createNavalRoomInput` 构造命名地图的 `side-1 vs-v9` 输入，沿用该输入的 preset/默认 seed，不替换成缩小场景。完整 match 参数在证据包 `records/manifest.json`，可由同一入口重建。主机 cgroup 57 核，本线最多同时四个进程，未超过 16 workers 配额。

| 证据 case | 地图与房间 AI | 地形核验 | 房间 AI 的 owner-thinks | 终局 checksum |
| --- | --- | --- | ---: | --- |
| `land-pineshade-knight` | pineshade，v9_knight，ember | 双方均无隔海矿，敌人陆路可达 | 1200 | `236dfecf` |
| `land-veiledHill-summoner` | veiledHill，v9_summoner，grove | 双方均无隔海矿，敌人陆路可达 | 1200 | `c3f4402c` |
| `sea-gullIsland-archer` | gullIsland，v9_archer，grove | 双方各两片隔海矿，主陆地有桥 | 1200 | `ec9b06c6` |
| `sea-twoShores-knight` | twoShores，v9_knight，ember，2v2 | 四人各三片隔海矿，主陆地有桥 | 2400 | `e156a23f` |

前三局 `player` 对 `enemy`；twoShores 的 `player + enemy2` 是房间 AI，`enemy + player-4` 是 v9。总计 **6000 次房间 AI owner-think**。`enemy2` 名字虽有 enemy，实际是盟友，分析按 team 判断。

探针包裹现有脚本，记录 context、原始 claim 请求、每个脚本想发的命令、runner 接纳结果、claim 写入及各阶段 memory；不追加第二次策略计算。另跑无包裹的完整重放，记录三 tick 后实际交付的命令，以及每次建筑受击。四局的 **完整交付命令 SHA256 和最终状态 checksum 全部相同**；为重点帧再跑的快照重放也全部相同。`analysis/parity.json` 保留三个版本的全值。探针不进 PR。

金额采用该版本 `UNIT_DEFS.cost / BUILDING_DEFS.cost` 的标称金价，不把满血召唤物到期当付费战损，也不计算装备、升级或丢矿后的假想收入。实际损失、仍被占用的资产，以及尚未证明能避免的损失分开记。没有运行改变行为的反事实，不能把冲突后发生的全部损失都归因于冲突。

## 10. 冲突清单及实际后果

全量 claim 重叠和原始命令请求保留在每次 think 的 JSONL 中。自动筛出“同一单位的两个移动目标相距至少 240，或其中一方要求登船”的请求 **65 个单位-think**：pineshade 5、veiledHill 8、gullIsland 5、twoShores 47。逐条的请求、接纳结果、实际交付、随后 60 秒内该单位的移除事件在 `analysis/different-goal-ledger.json`；这只是候选口径，不等于 65 次错误。比如同一目的地的海军恢复和守矿，换了命令来源也不算战略折返。

下列八条核验实录在 `analysis/incidents.json`，附实际交付命令；同一持续事件合成一个区间，不把每 0.75 秒重复下单算成一次新事故。为了表格可读，单位写成 `kind-编号` 时，完整 id 是 `unit-本行 owner-kind-编号`；建筑 id 则在正文写全。

### L1：守矿与清营互相回收人手（c）

pineshade / player。`emberRavager-1039` 在 **7560 → 7605 → 7665** 依次收到 general 清营、回守新矿、再次清营，目标分别是 `(2913.60,988.97)` 和 `(3382.5,2967)`；每条都在三 tick 后实际交付。`emberRavager-1044 / 1058` 在 **7695 → 7755 → 7770** 重复同一轮切换。三名兵标称共 360 金，第一轮指令往返分别耗 **5.25 / 3.75 / 3.75 秒**。1039 在回收段从 y≈2800 实际返走到 y≈2868，证明不只是 memory 标签变化。这个短区间内没有死人，不能记 360 金战损。

根部是 [maintainExpansionGarrisons:149](https://github.com/shuxueshuxue/sketch-rts/blob/883f57c5/src/ai/bootstrap_1/expansion-garrison.ts#L149) 删除未被新方案选中的原守军，general 马上获得这些余兵；下一次 [assignments / claimsUnits:174](https://github.com/shuxueshuxue/sketch-rts/blob/883f57c5/src/ai/bootstrap_1/expansion-garrison.ts#L174) 又把人要回来。相同快照的 delete 调用栈确认从这里删除，未改策略。

触发选择变化的是“最先到的两名敌人”换人：含建筑阻挡的实际 steering 预测中，7560/7605/7665 的要求为 **1.383 / 2.400 / 1.383**；7695/7755/7770 为 **0.559 / 1.576 / 0.529**。静态防守均为零。这是移动敌军使局部配额变化的实录，不能简化成守矿永久优先或清营永久优先；目前缺少一次已经接受的交接应保持多久、什么时候重新协商的共同约定。7830 随后真的出现回防 rally，应与前面的短时折返分开看。详见 `pineshade-guard-forecast.json / pineshade-guard-pool.json / pineshade-delete-trace.json`；离线路线查询也先安装与 sim 相同的建筑阻挡。

### L2：夺岛补运直接结束大陆进攻（a、b）

gullIsland / player。tick **9000** 的 `landAttack` 目标仍是 `building-enemy-townHall-1944`，group 只剩 `archer-1334 / 1515 / 1537`。它们实际订单此刻是 hold，没有普通 attack claim。tick **9015**，夺岛 `gold-gen-4` 的补运选中三人以及 lancer-2032，向 `transport-1917` 下 board；general 同轮要三名射手向 `(1842.27,2450.27)` 撤回，三条请求被 runner 排除。三名射手的登船订单在 **9018** 实际交付。

海军的选择器 [reinforcementCrew:20](https://github.com/shuxueshuxue/sketch-rts/blob/883f57c5/src/ai/bootstrap_1/reinforcement-ferries.ts#L20) 检查 idle/hold、HP 和 claim，却不查 `landAttack.general.group`；夺岛补运在 [planConquestReinforcements:155](https://github.com/shuxueshuxue/sketch-rts/blob/883f57c5/src/ai/bootstrap_1/island-conquest.ts#L155) 建立任务。相反，general 的 [availableV6Army:159](https://github.com/shuxueshuxue/sketch-rts/blob/883f57c5/src/ai/policy/v6/general.ts#L159) 马上扣除 ferry crew。同一 tick 9015，原攻击以 **`general:retreat:worn / withdrew`** 结束。这不是该 tick 三名射手在战场上新死了。

三人标称 **345 金，转运期间均存活**。补运到 **14370** 才实际交付，距认领 **267.75 秒**；general 下次发动陆地进攻在 **15345**，间隔 **316.5 秒**。另一方面，岛上任务得到十二人清营队，14715 清营结束，15345 完成矿厅和留守交接。这是一次真实的海陆目标取舍，有岛上收益，也有被取消的大陆目标；本测量不能证明应该选哪一个。当前系统没有在借走整支波次前共同裁决、保留恢复承诺的步骤，记成“worn”还把兵被借走与战斗磨损混在一起。

### L3：新矿把前线伤兵算作留守，治疗又把它们留在前线（a、b）

twoShores / player，留守矿厅是 `building-player-townHall-5459`，岗位 `(1469.5,2010.5)`。几名兵从进攻 group 转给留守，但当时还在南方前线；`mobileCare` 给的治疗动作先占有该单位，`expansionGarrison` 同轮想发的长途归队动作被排除。

| 单位 | 第一次转留守 tick | 同轮争用 tick | 守矿动作被排除的单位-think | 实际后果 |
| --- | ---: | --- | ---: | --- |
| ashChieftain-3872 | 13950 | 14025 | 1 | 当时在 `(1669,4862)`，治疗目标约 `(1707,4823)`，距岗位约 2850；15 分钟仍存活 |
| emberRavager-3937 | 14100 | 14160–14175 | 2 | 治疗先执行，15 分钟仍存活 |
| ashChieftain-4654 | 14175 | 14220–14400 | 13 | 至少 9 秒的连续 think 仍在争用；14408 死于敌 ravager，标称 190 金 |
| ashChieftain-4301 | 14355 | 14745–14910 | 12 | 至少 8.25 秒；14925 死于敌 ravager，标称 190 金 |

这是 **28 个单位-think，四名兵**。pineshade 另有 ashChieftain-3627 在 12990–13035 的四个同类请求，13047 死于敌塔，标称 190 金。两局合计 32 个单位-think、五名兵；移除事件共 570 金，均是时间关联，**没有证明取消治疗就能救下它们**。

[mobileCare:25](https://github.com/shuxueshuxue/sketch-rts/blob/883f57c5/src/ai/bootstrap_1/mobile-care.ts#L25) 的患者认领没有排除本地守矿任务；[守军池:73](https://github.com/shuxueshuxue/sketch-rts/blob/883f57c5/src/ai/bootstrap_1/expansion-garrison.ts#L73) 会考虑部分外地治疗，但不代表新分配后每个治疗来源都已经完成交接。`redirects: local` 又保留守矿 claim，于是“名册上归守矿”和“实际在治疗”可以同时成立。这里不应靠去掉治疗来统一，目标层需要区分已分配、正在路上、已经到位，以及当前不可投入的伤兵。

### L4：`follow` 绕过同轮争兵，覆盖防守订单（a）

twoShores / player，**16875、16890** 两次 think，`mineDefense` 要 `contractArcher-1923` attackMove 到约 `(1508,2099)`；`mobileCare` 同时让它 follow `priest-9119`。**16878、16893 两条命令都实际交付，顺序都是矿防后治疗**，最后订单为 follow。矿防 claim 仍是 `mineGuard`。16875 的射手在 `(1522,2113)`，医师却在另一端约 `(4382,1646)`，并不是在岗位边上就地治疗。

这是 **1 名兵、2 次实际覆盖**。根在 runner 的三个命令分支：[withoutUnitsClaimedElsewhere:98](https://github.com/shuxueshuxue/sketch-rts/blob/883f57c5/src/ai/policy/script-runner.ts#L98)、[removeOrderedUnitConflicts:117](https://github.com/shuxueshuxue/sketch-rts/blob/883f57c5/src/ai/policy/script-runner.ts#L117)、[reserveOrderedUnits:141](https://github.com/shuxueshuxue/sketch-rts/blob/883f57c5/src/ai/policy/script-runner.ts#L141) 都未处理 follow；治疗在没有当前 striker 的分支直接返回 follow。[patientRendezvousCommands:94](https://github.com/shuxueshuxue/sketch-rts/blob/883f57c5/src/ai/bootstrap_1/expedition-recovery.ts#L94)

之后治疗每 think 沿医师方向继续下短 move，16980 射手走到 `(1845,2127)` 并已降到 41.64 HP；17012 被 emberRavager-2257 杀死，标称 **145 金**。附近防御塔 `building-player-defenseTower-8289` 在 17065 被拆，**125 金**。这两笔是实际发生的损失，但没有反事实证明均由 follow 引起，不能拿 270 金当这个分支的确定收益。全 6000 次被观测的 owner-think 中，只核到这两次“两个脚本的移动/战斗订单都接纳且包含 follow”的覆盖。

### L5：本土挨打时首航继续，岛上收到的却不是清营能力（d、缺计划链）

仍是 twoShores / player，和 L4 同一场袭击，**不可重复累计那座塔**。tick **17030–17065**，敌军对 defenseTower-8289 实际命中九次、拆掉 125 金塔；general 正在 defend，矿厅附近 650 内当时只有 ashChieftain-9501 和 cinderRevenant-9772 两名我方战斗单位。与此同时 `transport-9328` 保持 advance / sailing，甲板上是 **ashHexer-3527**。没有矿厅在航行重叠期掉血，不等于本土未受损；只统计矿厅会漏掉这例。

船在 **17160** 把施法者送至 `gold-gen-6`，建立 conquest；到 **18000** 一直 assemble / `await-clearing-force`，已等待 **42 秒**。17985 的真实快照里，登陆点 300 内只有这一名 backline，传给 `planMiningScreen` 的有效前排为零。仍存活的船和施法者标称共 **380 金（240 + 140）**，这是占用资产，不是战损。

此外，17190 船改为 settle / loading，17985 还在等待 `ashHexer-9655 / priest-7444 / priest-9119` 及工人登船，三名战斗乘员仍都是 backline。不能从首航“送到一个战斗单位”的效果推出“岛矿可以清掉”：[islandConquestCommands:216](https://github.com/shuxueshuxue/sketch-rts/blob/883f57c5/src/ai/bootstrap_1/island-conquest.ts#L216) 会排除这些 backline，再调用清营。现有 [planConquestReinforcements:155](https://github.com/shuxueshuxue/sketch-rts/blob/883f57c5/src/ai/bootstrap_1/island-conquest.ts#L155) 只寻找现成可用前排，不产生绑定此岛的训练/恢复/调兵子目标。

这里需要规划器表达的是“先保本土 → 恢复可调兵力 → 运一份真的能清营的队伍 → 工程落基”。本轮只观测到各模块分别继续自己的动作，没有推出这条带依赖的链。**没有证据证明应在家里挨打时继续抽前排**，也没有把 42 秒的截断等待写成永久卡死。四局里严格核到这一处“建筑受击与有战斗载荷的外送航行重叠”；未找到岛矿厅受击无人理的确证。

### L6：清矿需要持续兵力，实际分给扩张的是换代召唤物（缺计划链）

veiledHill / player，`gold-gen-4` 的扩张在 tick **6315–10650** 持续 assemble，**216.75 秒**。tick **8265**，它的五名成员只有 `spirit-1903 / 1953 / 2034 / 2128 / 2192`，没有常驻战士或施法者；general 另一边把七名 summoner 编入对 `building-enemy-townHall-1344` 的 attack group；本次 context 的 `expansionRecruit` 为空。

五个 spirit 都在 **8598 / 8733 / 8958 / 9183 / 9318** 满血 85 HP 到期消失，没有受击记录，标称战损 **0 金**。并非五人都“还没走到就过期”：8265 的实际路线到 staging 分别需 272/473/468/464/378 tick，剩寿命为 333/468/693/918/1053 tick；第二名连到 staging 都差五 tick，第一名到齐后仅剩约三秒。不能把一次快照上的五份战力当成会同时持续存在的清营队。

这是本轮另一个缺链信号：当前扩张只能请求普通 standIn 或认领现有 front，不能向进攻任务要求“暂借施法者到矿口持续补召唤”，也不会返回目标级的持续兵力缺口。缺口由 [expansionGuardWant:77](https://github.com/shuxueshuxue/sketch-rts/blob/883f57c5/src/ai/bootstrap_1/policy.ts#L77) 与 [扩张选兵:127](https://github.com/shuxueshuxue/sketch-rts/blob/883f57c5/src/ai/bootstrap_1/expansion-mission.ts#L127) 各自处理。216.75 秒是实际 assemble 区间，尚不能全算成这一原因带来的额外延误，也没有证明七名施法者改去清矿就更划算。

### L7 / L8：两类不能误报的重叠

veiledHill 的 `contractArcher-2301` 在 **12150** 被 lootRecovery 要去拾取并排队回家，同轮 shopping 要去商店；12165–12255 又有七次 mercenaryControl / shopping 不同目标请求。它们都被现有 claim 优先级挡住，购物动作未实际交付，单位没有死亡。记为 **8 个候选单位-think、已有仲裁生效**，不等于购物导致八次折返。

twoShores / enemy2 的 `emberRavager-1092` 在 **9097–9187**，naval recovery 和 expansionGarrison 都指向 **`(4305,2143)`**。前者拿到命令、后者被排除，是恢复与留守合作；按脚本名统计的 A→B→A 会把它错记成战略来回切换。本报告将其排除。原始记录仍保留，便于检查筛选边界。

## 11. 给统一规划设计的输入

现有代码能执行清营、护送、施工、守矿、出击、占位和转运，但“这个动作能为父目标提供什么”尚未形成统一契约。上述实录提供五个具体边界，供目标层设计使用，并非本 PR 的实现提案：

- **分配要带交接。** L1 的守军释放/回收、L2 的整波借走，都需要知道谁在接手、何时真的到位、原目标应暂停还是失败；单独删除 claim 或扣除 crew 无法表达这些。
- **战力要有地点、到达时间和有效期。** L3 的伤兵在地图另一端，L6 的 spirit 正在换代。已认领的名册、路上力量和当前岗位战力应分开，不能重复兑现同一份效果。
- **效果要匹配下一步所需能力。** L5 的“有单位登陆”与“有可清营前排”是两种效果。缺前置时，应有可解释的子目标或暂停原因，不能让造船、运医师、等待清营各自闭环。
- **效用比较应看被打断的目标。** L2 确实换来一座岛矿，同时取消大陆进攻；不能仅按首航/矿厅/进攻是否发过命令各自打勾，也不能在不知道反事实的情况下断言这次取舍错了。
- **执行仲裁要覆盖实际订单。** L4 的 follow 与保留着的 mineGuard claim 不一致；即使上层计划正确，也需要执行端准确回报最终订单和真实效果。

对 (e)“局部占优、目标空虚，却没有任何模块去做”，**本轮没有核出满足路线、到达、留守及可响应援军全部前置的确定遗漏**。L5 / L6 单列为“缺计划链”，不冒充能直接拿下的机会；四局 15 分钟样本也不能给出 240 局发生率或胜率结论。

原始证据在同目录 [land-contract.evidence.json](land-contract.evidence.json) 指向的 A100 对象。包内 `README.zh.md` 说明重放入口、逐次 think 字段、实际交付日志和 SHA256 清单；`analysis/incidents.json` 是这八条实录的入口。这个 draft 仅增加文档和证据指针，留待三线契约汇总后再定统一战略层。
