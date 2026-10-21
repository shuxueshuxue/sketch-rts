# 海战模块契约与真实对局冲突：883f57c5

本文描述 `883f57c51838ed75057a2a2dc4fce5e16cdcfb4e` 的现有行为，供“局势评估 → 效用选目标 → HTN/GOAP 分解 → 现有模块执行”的战略层设计使用。文中的“子目标缺口”是尚未形成可请求计划元素的地方；不是本 PR 已实现的功能。本 PR 只交文档，不修改 AI、规则、默认房间席位或预算。

时间统一为仿真 tick，20 tick = 1 秒。一次席位 think 间隔 15 tick；席位分相位执行，不能把不同席位相近的 tick 当成同一次决策。

## 共同的执行与归属契约

现有脚本返回 `GameCommand[]`，而不是“目标、所需兵力、优先级、占用期限”的提案。`bootstrapPolicyContext` 先维护夺岛、新矿留守及陆地扩张状态；`bootstrapScripts` 再把海军、矿区安全、修理、微操、主力等执行器装入现有栈（[policy.ts:160](https://github.com/shuxueshuxue/sketch-rts/blob/883f57c51838ed75057a2a2dc4fce5e16cdcfb4e/src/ai/bootstrap_1/policy.ts#L160)、[policy.ts:213](https://github.com/shuxueshuxue/sketch-rts/blob/883f57c51838ed75057a2a2dc4fce5e16cdcfb4e/src/ai/bootstrap_1/policy.ts#L213)）。

`script-runner` 先调用整栈的 `claimsUnits`，同一单位由栈中最早声明者胜出，然后执行经济、战术脚本。脚本仍会运行并改 memory；它提出的移动命令随后可能因静态 claim 或本 think 已有命令而被删除。`onCommands` 收到过滤后命令；`afterPlan` 最后处理交接（[script-runner.ts:26](https://github.com/shuxueshuxue/sketch-rts/blob/883f57c51838ed75057a2a2dc4fce5e16cdcfb4e/src/ai/policy/script-runner.ts#L26)、[script-runner.ts:91](https://github.com/shuxueshuxue/sketch-rts/blob/883f57c51838ed75057a2a2dc4fce5e16cdcfb4e/src/ai/policy/script-runner.ts#L91)）。`board` 不在 `withoutUnitsClaimedElsewhere` 的过滤类型内，但会进入已下单集合，影响随后脚本；这与普通 `move` 的裁决路径不同（[script-runner.ts:98](https://github.com/shuxueshuxue/sketch-rts/blob/883f57c51838ed75057a2a2dc4fce5e16cdcfb4e/src/ai/policy/script-runner.ts#L98)、[script-runner.ts:141](https://github.com/shuxueshuxue/sketch-rts/blob/883f57c51838ed75057a2a2dc4fce5e16cdcfb4e/src/ai/policy/script-runner.ts#L141)）。

海军没有专门的 `unitClaims.kind`。船员归属来自 `naval.ferries[船].crewIds`、物理 `deck`/`board`、`navalUnitIds` 对海外陆军的地域性声明，以及恢复、装备、港务的临时集合。大陆目标、驻矿与防守则主要读 `unitClaims`。因此只查询 `unitClaims` 不能得知完整海军占用。其他执行器要同时检查上述船员名单及 `navalUnitIds`；反过来，海军招募用 `ferryCrewTaskAvailable` 保护 `mineRally`、`mineLeash`、`mineGuard`、`workerSafety`、`expansionGarrison`、`harassSquad`（[naval.ts:50](https://github.com/shuxueshuxue/sketch-rts/blob/883f57c51838ed75057a2a2dc4fce5e16cdcfb4e/src/ai/policy/naval.ts#L50)、[naval.ts:532](https://github.com/shuxueshuxue/sketch-rts/blob/883f57c51838ed75057a2a2dc4fce5e16cdcfb4e/src/ai/policy/naval.ts#L532)、[claims.ts:214](https://github.com/shuxueshuxue/sketch-rts/blob/883f57c51838ed75057a2a2dc4fce5e16cdcfb4e/src/ai/policy/claims.ts#L214)）。

归属也不是固定租约。普通命令 claim 为 900 tick，目标类和防守任务常续为 3600 tick；任务成员还有独立生命周期。海军 ferry 采用物理进展时钟，持续移动能一直续期，没有统一的战略抢占协议（[claims.ts:28](https://github.com/shuxueshuxue/sketch-rts/blob/883f57c51838ed75057a2a2dc4fce5e16cdcfb4e/src/ai/policy/claims.ts#L28)、[claims.ts:230](https://github.com/shuxueshuxue/sketch-rts/blob/883f57c51838ed75057a2a2dc4fce5e16cdcfb4e/src/ai/policy/claims.ts#L230)、[naval.ts:637](https://github.com/shuxueshuxue/sketch-rts/blob/883f57c51838ed75057a2a2dc4fce5e16cdcfb4e/src/ai/policy/naval.ts#L637)）。

基准价格（不含装备/升级、非战力评分）：工人 75、船厂 170、运输船 240、航母 420、战舰 540、矿厅 400、普通防御塔 125、基础兵营 170、farm 120 金。航时与兵力占用没有统一上界，不能把购买价当作完整任务成本。

## 计划元素 1：选择资源岛并开通对应海湾

**职责与效果。** `islandPlans` 找“尚未占有、工人走不到、自己岸线可接通”的正金量矿岛；`planNavalWant`、`navalStep` 将它转为一个当前购买意图。可观察效果依次是目标海域有船厂、有首艘运输船、岛上工人旁有矿厅；候选存在本身不代表已经取得岛屿（[naval.ts:1099](https://github.com/shuxueshuxue/sketch-rts/blob/883f57c51838ed75057a2a2dc4fce5e16cdcfb4e/src/ai/policy/naval.ts#L1099)、[naval.ts:143](https://github.com/shuxueshuxue/sketch-rts/blob/883f57c51838ed75057a2a2dc4fce5e16cdcfb4e/src/ai/policy/naval.ts#L143)、[naval.ts:248](https://github.com/shuxueshuxue/sketch-rts/blob/883f57c51838ed75057a2a2dc4fce5e16cdcfb4e/src/ai/policy/naval.ts#L248)）。

**状态与事件。** `naval.islands` 缓存全体候选 20 秒；`island` 留存当前第一项，`expeditions` 记已经为其付款的海域。矿耗尽、盟友认领、对手矿厅占有、自己的大厅覆盖、实际登陆/施工以及新海域首船下水都会改变候选。已经登陆的未完成任务、已出航的工人任务先保留，未服务海域优先于可选舰队扩张；已付船厂的首船不会被临时出现的本土矿机会撤掉（[naval.ts:1106](https://github.com/shuxueshuxue/sketch-rts/blob/883f57c51838ed75057a2a2dc4fce5e16cdcfb4e/src/ai/policy/naval.ts#L1106)、[naval.ts:1126](https://github.com/shuxueshuxue/sketch-rts/blob/883f57c51838ed75057a2a2dc4fce5e16cdcfb4e/src/ai/policy/naval.ts#L1126)、[naval.ts:155](https://github.com/shuxueshuxue/sketch-rts/blob/883f57c51838ed75057a2a2dc4fce5e16cdcfb4e/src/ai/policy/naval.ts#L155)）。

**前置与分解。** 新候选需可连通岸点、有收入或够矿厅资本，并满足两厅、人口已用 20、本地余矿低于 1800、已有工人远征之一；新本土扩张机会优先。缺船厂时请求船厂，受敌舰封岸时先请求岸炮；缺首船时请求运输船，人口不够时请求 farm，工人不足时请求工人。多个海湾按实际水域连通性区分，没有地图 ID 分支。岛屿效用只包含现有矿点、威胁与航路排序，尚没有“营地掉落/位置价值 → 非矿岛任务”的分解（[naval.ts:1114](https://github.com/shuxueshuxue/sketch-rts/blob/883f57c51838ed75057a2a2dc4fce5e16cdcfb4e/src/ai/policy/naval.ts#L1114)、[naval.ts:1138](https://github.com/shuxueshuxue/sketch-rts/blob/883f57c51838ed75057a2a2dc4fce5e16cdcfb4e/src/ai/policy/naval.ts#L1138)、[naval-mines.ts](https://github.com/shuxueshuxue/sketch-rts/blob/883f57c51838ed75057a2a2dc4fce5e16cdcfb4e/src/ai/policy/naval-mines.ts)）。

**资源、完成与让兵。** 购买经现有经济模块占金、人口、船厂队列与工人。首船/人口是扩张优先级 90，并在 `planBootstrapEconomy` 中预留当前首船成本；普通海军为 60，收官为 80。尚未生效的新远征让本土扩张；已付款的首船保留预算。`navalBudgetReserve` 可保留矿厅和必要运输船资本，但本土 700 范围存在武装对手时取消这笔保留。它不分配清营主力，也不承诺通航时刻；购买后由运输和夺岛元素接管（[v6/economy.ts:442](https://github.com/shuxueshuxue/sketch-rts/blob/883f57c51838ed75057a2a2dc4fce5e16cdcfb4e/src/ai/policy/v6/economy.ts#L442)、[bootstrap_1/economy.ts:216](https://github.com/shuxueshuxue/sketch-rts/blob/883f57c51838ed75057a2a2dc4fce5e16cdcfb4e/src/ai/bootstrap_1/economy.ts#L216)、[naval.ts:105](https://github.com/shuxueshuxue/sketch-rts/blob/883f57c51838ed75057a2a2dc4fce5e16cdcfb4e/src/ai/policy/naval.ts#L105)）。

## 计划元素 2：首次及后续自由运输船建立战斗滩头

**职责与效果。** `planFirstCombatCrossing` 为每个有空闲船的独立海湾选择未占矿岛，产生 `advance/loading` ferry；效果须由战斗单位真实装船并在目标岛落地确认。已完成首航不会阻止新海湾继续发起登陆（[combat-delivery.ts:34](https://github.com/shuxueshuxue/sketch-rts/blob/883f57c51838ed75057a2a2dc4fce5e16cdcfb4e/src/ai/bootstrap_1/combat-delivery.ts#L34)）。

**状态、前置与事件。** 主任务记在 `naval.ferries`；`firstCombatDelivery` 只记录席位第一艘船、航程预算、每船尝试、首名实际卸下的战斗单位及拒绝原因。没有 intrusion、已有可用永久陆兵或能训练它的建筑、船空闲且无需修理/港务/装备、同海湾没有正在去程的 advance，才开始选岛。矿必须正金量、无厅占有、无盟友认领、无同岛未完成夺岛任务，且当前船未耗尽三次重试。实际卸货滩头要安全、海上不能被压制；用风向、辅助操纵速度和海路估航程（[combat-delivery.ts:37](https://github.com/shuxueshuxue/sketch-rts/blob/883f57c51838ed75057a2a2dc4fce5e16cdcfb4e/src/ai/bootstrap_1/combat-delivery.ts#L37)、[combat-delivery.ts:59](https://github.com/shuxueshuxue/sketch-rts/blob/883f57c51838ed75057a2a2dc4fce5e16cdcfb4e/src/ai/bootstrap_1/combat-delivery.ts#L59)、[combat-delivery.ts:86](https://github.com/shuxueshuxue/sketch-rts/blob/883f57c51838ed75057a2a2dc4fce5e16cdcfb4e/src/ai/bootstrap_1/combat-delivery.ts#L86)）。

**兵力、资源与子目标缺口。** 具体装多少兵由 ferry 的承载、甲板几何、本土 45 秒可达威胁和角色筛选决定，不是“已在此处配额的 N 人”。第一趟缺兵时，经济可把已有 doctrine 中可训练的第一名战斗兵提前购买；它不会为后续每个岛的清营缺口自动建立同等训练目标。占用一条船、实际船员、往返航时和被占人口。60 秒只是首分钟拒绝诊断，交付截止还包含航程/转向预算，不是所有航线 60 秒到达的保证（[economy.ts:222](https://github.com/shuxueshuxue/sketch-rts/blob/883f57c51838ed75057a2a2dc4fce5e16cdcfb4e/src/ai/bootstrap_1/economy.ts#L222)、[naval.ts:767](https://github.com/shuxueshuxue/sketch-rts/blob/883f57c51838ed75057a2a2dc4fce5e16cdcfb4e/src/ai/policy/naval.ts#L767)、[combat-delivery.ts:108](https://github.com/shuxueshuxue/sketch-rts/blob/883f57c51838ed75057a2a2dc4fce5e16cdcfb4e/src/ai/bootstrap_1/combat-delivery.ts#L108)）。

**完成、失败与边界。** 必须有记录中的永久武装单位离开 deck，在该目标的异于本土的陆地上才算交付；船被击沉、装兵卡住、滩头变危险都有独立原因。交付后的清营、建厅、留守交给夺岛元素；首航记录本身不负责保卫已经建好的岛厅，也不负责重新评估所有陆海目标的效用（[combat-delivery.ts:128](https://github.com/shuxueshuxue/sketch-rts/blob/883f57c51838ed75057a2a2dc4fce5e16cdcfb4e/src/ai/bootstrap_1/combat-delivery.ts#L128)）。

## 计划元素 3：骑射手跨海清营

**职责与效果。** `planRiderCrossing` 让空闲骑射手到可风筝的异地矿营清守怪，产生 `creep` ferry。它优先于自由首航安排空船，且不会把其他兵混进骑手专用载荷（[rider-crossing.ts:22](https://github.com/shuxueshuxue/sketch-rts/blob/883f57c51838ed75057a2a2dc4fce5e16cdcfb4e/src/ai/bootstrap_1/rider-crossing.ts#L22)、[rider-crossing.ts:29](https://github.com/shuxueshuxue/sketch-rts/blob/883f57c51838ed75057a2a2dc4fce5e16cdcfb4e/src/ai/bootstrap_1/rider-crossing.ts#L29)）。

**前置与状态。** 只有无 intrusion、血量至少 80%、没有 active claim/其他 mounted/ferry 工作的 horseArcher，以及空闲、空载、无需修理/港务/装备的运输船可参加。矿无厅、无敌方驻在、无其他去程，守怪必须慢于骑手，卸货后的实际威胁接触不能在下一次 think/冷却内追到它。状态为 `ferries[船].purpose=creep/riderId/targetId`；落地后交给 `mountedTasks` 的营地任务（[rider-crossing.ts:34](https://github.com/shuxueshuxue/sketch-rts/blob/883f57c51838ed75057a2a2dc4fce5e16cdcfb4e/src/ai/bootstrap_1/rider-crossing.ts#L34)、[mounted-tasks.ts](https://github.com/shuxueshuxue/sketch-rts/blob/883f57c51838ed75057a2a2dc4fce5e16cdcfb4e/src/ai/bootstrap_1/mounted-tasks.ts)）。

**占用、缺条件与结束。** 一名指定骑射手、一艘船和航时；无可风筝骑手/守怪/连通岸时不产生任务，也不会以这个缺口请求一条新的训练链。装兵归属与弃航遵守 ferry 状态机；到岸交接后不管理建厅及岛屿常驻防守。本土需要保留的防守 claim 不在招募集合内。

## 计划元素 4：执行装载、航行、卸载、返回与工人补位

**职责与状态。** `ferryCommands` 执行 `settle/assault/rebase/evacuate/advance/reinforce/creep`，共享 `loading → sailing → return`；持有 `from/to/targetId/crewIds/payloadIds/progress/deliveries/returnTrips`。没有任务时先看撤工人、转移闲置矿工，再看殖民和进攻目标。`planSettlerBoarding` 在船尚驶往装货岸时就给真实工人下 board 单，避免船等待工人、工人又等船的空转（[naval.ts:556](https://github.com/shuxueshuxue/sketch-rts/blob/883f57c51838ed75057a2a2dc4fce5e16cdcfb4e/src/ai/policy/naval.ts#L556)、[ferry-preparation.ts:17](https://github.com/shuxueshuxue/sketch-rts/blob/883f57c51838ed75057a2a2dc4fce5e16cdcfb4e/src/ai/bootstrap_1/ferry-preparation.ts#L17)）。

**前置、挑兵与保留。** 实际 land route 排装船到达次序，按 bodyMass、可用甲板位置和几何预约验载。定居优先带最多两工人，保留本地矿工三人；进攻/advance 在工人至少六人时可带一工人。永久陆战兵不得已在 deck、board、cast，必须与装货岸同陆地，且通过防守任务保护。所有合格本地兵都计入本土留守基数，候选再由任务选择器筛；不能把“骑手专用筛选后的名单”误作全部守军（[naval.ts:737](https://github.com/shuxueshuxue/sketch-rts/blob/883f57c51838ed75057a2a2dc4fce5e16cdcfb4e/src/ai/policy/naval.ts#L737)、[naval.ts:767](https://github.com/shuxueshuxue/sketch-rts/blob/883f57c51838ed75057a2a2dc4fce5e16cdcfb4e/src/ai/policy/naval.ts#L767)、[ferry-preparation.ts:33](https://github.com/shuxueshuxue/sketch-rts/blob/883f57c51838ed75057a2a2dc4fce5e16cdcfb4e/src/ai/bootstrap_1/ferry-preparation.ts#L33)）。

**防守让步。** 留守强度是所有同装货陆地大厅的 `incomingLandArmy`（实际建筑避让路线、45 秒内到达、终点距基地 240 内）和实际 intrusion 攻击组的并集乘 1.3。持续 reinforce 在 loading 时看到 intrusion 会停装/取消；这一门槛不等于已经 sailing 的所有远征都受统一召回。海上被压、滩头变危险、目标被占有或消失才会取消正在执行的特定任务（[land-arrivals.ts:9](https://github.com/shuxueshuxue/sketch-rts/blob/883f57c51838ed75057a2a2dc4fce5e16cdcfb4e/src/ai/policy/land-arrivals.ts#L9)、[naval.ts:713](https://github.com/shuxueshuxue/sketch-rts/blob/883f57c51838ed75057a2a2dc4fce5e16cdcfb4e/src/ai/policy/naval.ts#L713)、[naval.ts:688](https://github.com/shuxueshuxue/sketch-rts/blob/883f57c51838ed75057a2a2dc4fce5e16cdcfb4e/src/ai/policy/naval.ts#L688)）。

**资源与完成/失败。** 船、真实乘员、待登船单位、可用甲板和航路持续占用。装卸、中心平移超过 32、船艏转向弧长超过 32 才刷新物理进展；40 秒没进展取消，冷却 20 秒，同船同目标最多三次。取消会停掉待登船人员，带现有载荷回出发岸，而不是凭空释放海上的兵。真实落地才追加 `deliveries`；普通一次任务返空即释放，reinforce 可以返回重装。它负责运输安全，不负责全局判断“为了救厅是否应牺牲另一岛滩头”，也没有统一的兵力抢占/退款事件（[naval.ts:637](https://github.com/shuxueshuxue/sketch-rts/blob/883f57c51838ed75057a2a2dc4fce5e16cdcfb4e/src/ai/policy/naval.ts#L637)、[naval.ts:657](https://github.com/shuxueshuxue/sketch-rts/blob/883f57c51838ed75057a2a2dc4fce5e16cdcfb4e/src/ai/policy/naval.ts#L657)、[naval.ts:844](https://github.com/shuxueshuxue/sketch-rts/blob/883f57c51838ed75057a2a2dc4fce5e16cdcfb4e/src/ai/policy/naval.ts#L844)、[ferry-retries.ts:3](https://github.com/shuxueshuxue/sketch-rts/blob/883f57c51838ed75057a2a2dc4fce5e16cdcfb4e/src/ai/policy/ferry-retries.ts#L3)）。

## 计划元素 5：已登陆矿岛完成清营、施工和留守交接

**职责与效果。** `prepareIslandConquests` 从真实交付发现矿岛，`islandConquestCommands` 用独立战斗状态运行与大陆扩张共用的 `planMiningScreen`。目标效果是该矿有己方已完成矿厅，且完成 `expansionGarrisonReady` 的防守交接；不是“首批兵到了”就宣布夺岛完成（[island-conquest.ts:32](https://github.com/shuxueshuxue/sketch-rts/blob/883f57c51838ed75057a2a2dc4fce5e16cdcfb4e/src/ai/bootstrap_1/island-conquest.ts#L32)、[island-conquest.ts:216](https://github.com/shuxueshuxue/sketch-rts/blob/883f57c51838ed75057a2a2dc4fce5e16cdcfb4e/src/ai/bootstrap_1/island-conquest.ts#L216)）。

**状态与触发。** `naval.conquests[矿]` 保存 `sinceTick/stage/landing/reason/combat/staging/interruptions/abandonedTick`。每岛一次只保留一项未完成矿任务；有兵实际落地、守怪死亡、工人到达、厅奠基/完工、留守完成、矿被占/耗尽、全岛己方部队消失都会推进或结束它。`assemble/clear/escort/build/complete` 与原因分别可观测。清营 `creep/creepRetry` 独立保存，不覆盖大陆 `landAttack.general`（[memory.ts:75](https://github.com/shuxueshuxue/sketch-rts/blob/883f57c51838ed75057a2a2dc4fce5e16cdcfb4e/src/ai/memory.ts#L75)、[island-conquest.ts:64](https://github.com/shuxueshuxue/sketch-rts/blob/883f57c51838ed75057a2a2dc4fce5e16cdcfb4e/src/ai/bootstrap_1/island-conquest.ts#L64)、[expansion-mission.ts:216](https://github.com/shuxueshuxue/sketch-rts/blob/883f57c51838ed75057a2a2dc4fce5e16cdcfb4e/src/ai/bootstrap_1/expansion-mission.ts#L216)）。

**挑兵与子目标。** 同岛的永久陆军，排除 mounted 与防守类 claim；清营只用非后排、有攻击力者。清营强度按 `creepForce/forceFor`，保留既有 +1.5 余量。缺清营兵时建立指定 `reinforcementTaskId`，允许小批次补兵，不受可选转运“超过六个闲兵”的门槛限制；已登陆/已在途兵一起扣减缺口。营地清完先运工人，再由岛厅购买意图建厅。**当前补兵只搬现有合格闲兵，缺口本身不会生成训练/解散其他远征/跨岛调兵子目标。**（[island-conquest.ts:132](https://github.com/shuxueshuxue/sketch-rts/blob/883f57c51838ed75057a2a2dc4fce5e16cdcfb4e/src/ai/bootstrap_1/island-conquest.ts#L132)、[island-conquest.ts:155](https://github.com/shuxueshuxue/sketch-rts/blob/883f57c51838ed75057a2a2dc4fce5e16cdcfb4e/src/ai/bootstrap_1/island-conquest.ts#L155)、[island-conquest.ts:98](https://github.com/shuxueshuxue/sketch-rts/blob/883f57c51838ed75057a2a2dc4fce5e16cdcfb4e/src/ai/bootstrap_1/island-conquest.ts#L98)）

**资源与让步。** 一块陆地上的可用远征兵、补兵运输船、清营时间、工程工人和矿厅资本。带有防守 claim 的兵让给防守，mounted 任务也保留；没有“当前任务至少分几人、多久必须补足”的统一预算。`planMiningScreen` 可处理营地争夺与施工护送，但不会在此处自行请求本土训练一个新的清营军团；也不会选择下一片非矿领土。

**完成、失败、放弃。** 已完成厅且留守可交接为 `complete`；矿耗尽、对手占厅、盟友认领记原因放弃；既无岛上人员又无在途任务为 `landing-party-lost`。该任务记录不会在厅被拆后自动成为统一的反攻/重建计划。后续是否重启受其他岛屿候选和运输重试共同制约；不能把历史 complete 当作“该岛此刻安全”的世界事实（[island-conquest.ts:66](https://github.com/shuxueshuxue/sketch-rts/blob/883f57c51838ed75057a2a2dc4fce5e16cdcfb4e/src/ai/bootstrap_1/island-conquest.ts#L66)、[island-conquest.ts:80](https://github.com/shuxueshuxue/sketch-rts/blob/883f57c51838ed75057a2a2dc4fce5e16cdcfb4e/src/ai/bootstrap_1/island-conquest.ts#L80)）。

## 计划元素 6：持续向已登陆前线补兵

**职责与前置。** `planReinforcementFerries` 寻找已有己方/友军海外厅或实际陆军所在前线，用一条专用往返船转运本土闲兵。`reinforcementCrew` 仅收血量至少 80%、永久武装、idle/hold、同本土陆地、没有 mounted/support/其他 ferry 占用、没有本地目标 claim 的单位；跨海同目标的 expansion 成员可以保留原目标乘船。看到全局 readV6Intel intrusion 即不派新兵（[reinforcement-ferries.ts:20](https://github.com/shuxueshuxue/sketch-rts/blob/883f57c51838ed75057a2a2dc4fce5e16cdcfb4e/src/ai/bootstrap_1/reinforcement-ferries.ts#L20)、[reinforcement-ferries.ts:69](https://github.com/shuxueshuxue/sketch-rts/blob/883f57c51838ed75057a2a2dc4fce5e16cdcfb4e/src/ai/bootstrap_1/reinforcement-ferries.ts#L69)）。

**效果、状态与资源。** 普通流必须超过六名合格闲兵、目的滩头安全且未被舰队封锁。`ferries.purpose=reinforce` 保持目的地和返回次数；全席位已有一条 reinforce 流时不另开普通流。返空到出发岸后重装，实际卸载才完成一批。目标优先已有基地，再按海路长短；不会按各岛受损速度、经济价值和兵力亏缺排序（[reinforcement-ferries.ts:53](https://github.com/shuxueshuxue/sketch-rts/blob/883f57c51838ed75057a2a2dc4fce5e16cdcfb4e/src/ai/bootstrap_1/reinforcement-ferries.ts#L53)、[naval.ts:657](https://github.com/shuxueshuxue/sketch-rts/blob/883f57c51838ed75057a2a2dc4fce5e16cdcfb4e/src/ai/policy/naval.ts#L657)）。

**缺条件与退出。** 已有适用航线但船被殖民工人占用时可请求专用 reinforcementTransport，沿用同一运输路线和预算保留。它不训练缺失兵，不把正在大陆进攻/守矿的兵变为候选，不自动建立另一岛到受威胁岛的短线接驳站。没有合格闲兵时直接无提案；无法据此推导“全局不需要增援”。指定清营补兵是上一元素的独立触发，清完后退回普通六人门槛（[reinforcement-ferries.ts:97](https://github.com/shuxueshuxue/sketch-rts/blob/883f57c51838ed75057a2a2dc4fce5e16cdcfb4e/src/ai/bootstrap_1/reinforcement-ferries.ts#L97)、[island-conquest.ts:166](https://github.com/shuxueshuxue/sketch-rts/blob/883f57c51838ed75057a2a2dc4fce5e16cdcfb4e/src/ai/bootstrap_1/island-conquest.ts#L166)）。

## 计划元素 7：海外陆军的局部战斗与施工保护

**职责、前置与效果。** `planNavalTacticsWithAssignments` 对未被夺岛清营、mounted、恢复任务拿走的海外陆兵，先做即时交战干预，再按陆地连通块汇总战力，选择当地矿口或敌人推进。入战要求本队战力至少局部 400 范围威胁的 1.35 倍。`navalUnitIds` 则默认声明所有异于第一座本土厅的陆战兵，再由 bootstrap 包装排除新矿留守、防守 claim 和 mounted 所属（[naval.ts:484](https://github.com/shuxueshuxue/sketch-rts/blob/883f57c51838ed75057a2a2dc4fce5e16cdcfb4e/src/ai/policy/naval.ts#L484)、[naval.ts:532](https://github.com/shuxueshuxue/sketch-rts/blob/883f57c51838ed75057a2a2dc4fce5e16cdcfb4e/src/ai/policy/naval.ts#L532)、[policy.ts:189](https://github.com/shuxueshuxue/sketch-rts/blob/883f57c51838ed75057a2a2dc4fce5e16cdcfb4e/src/ai/bootstrap_1/policy.ts#L189)）。

**状态、资源与事件。** 没有独立的“海外守岛目标”记录；地理位置就是常见的 naval 归属依据。对手进入、部队卸下/死亡、营地消失、claim 改变后重新选目标；具体作战命令延续在单位 order。占用该陆块上通过筛选的陆兵，不给全局保留配额，也不预先与主力比较本土反攻的收益。

**完成、失败与边界。** 目标消失或变得不占优就不发这次推进命令；不会因此生成“需要多少援兵、多久后岛厅将被拆、从哪座本土/邻岛来救”的子计划。大陆 readEnemy 只看本土可达的敌军，不能当作岛上无威胁；夺岛用的 `readV6IntelAt` 是岛上的独立局势输入，尚未汇入单一全局防务分配器（[v6/intel.ts:73](https://github.com/shuxueshuxue/sketch-rts/blob/883f57c51838ed75057a2a2dc4fce5e16cdcfb4e/src/ai/policy/v6/intel.ts#L73)、[v6/intel.ts:114](https://github.com/shuxueshuxue/sketch-rts/blob/883f57c51838ed75057a2a2dc4fce5e16cdcfb4e/src/ai/policy/v6/intel.ts#L114)）。

## 计划元素 8：舰队交战、护航与炮位

**职责与效果。** 选同海域可工作的武装舰，给附近载兵船分配最多两艘护航，或向资源岛/进攻目标/沿岸袭击点编队。舰船必须到机械层认可的可射击位置才会产生伤害；planner 下 attackMove 不等于目标血量一定下降（[naval.ts:404](https://github.com/shuxueshuxue/sketch-rts/blob/883f57c51838ed75057a2a2dc4fce5e16cdcfb4e/src/ai/policy/naval.ts#L404)、[ship-attack-station.ts](https://github.com/shuxueshuxue/sketch-rts/blob/883f57c51838ed75057a2a2dc4fce5e16cdcfb4e/src/shared/ship-attack-station.ts)）。

**状态与挑船。** `naval.combat[船]` 保留交战目标、已下单目标；`muster` 记集结点、目的地、旗舰、时刻、出发状态；`assault`、`raid` 是周期性目标缓存。港务/装备/运输任务中的船不入战舰集合；血量低于 40% 回港。至少三艘同海域战舰才编队，75% 到集结点或等待 30 秒就出发。护航优先处理威胁载兵船的敌人；普通舰避塔，bombard 可以从塔外找炮位（[fleet-formation.ts:8](https://github.com/shuxueshuxue/sketch-rts/blob/883f57c51838ed75057a2a2dc4fce5e16cdcfb4e/src/ai/policy/fleet-formation.ts#L8)、[fleet-engagement.ts:9](https://github.com/shuxueshuxue/sketch-rts/blob/883f57c51838ed75057a2a2dc4fce5e16cdcfb4e/src/ai/policy/fleet-engagement.ts#L9)、[naval.ts:440](https://github.com/shuxueshuxue/sketch-rts/blob/883f57c51838ed75057a2a2dc4fce5e16cdcfb4e/src/ai/policy/naval.ts#L440)）。

**前置、子目标与资源。** 海上出兵需在途位置和目的地附近真实可用火力通过 `outgunned`；不能把远处买了但到不了的舰算护航。经济可请求更多战舰、破塔舰、火船、人口和装备，当前意图仍是一个购买目标。占舰、舱内战斗单位、工程人员、金与炮位航路；它没有为多个岛同时保留护航时段的队列。进攻门槛复用 `attackMargin`，`readyToCross` 看目标陆块总体守军；资源岛和运工人任务也可能优先占同一条船（[naval.ts:349](https://github.com/shuxueshuxue/sketch-rts/blob/883f57c51838ed75057a2a2dc4fce5e16cdcfb4e/src/ai/policy/naval.ts#L349)、[naval.ts:1172](https://github.com/shuxueshuxue/sketch-rts/blob/883f57c51838ed75057a2a2dc4fce5e16cdcfb4e/src/ai/policy/naval.ts#L1172)、[naval.ts:1225](https://github.com/shuxueshuxue/sketch-rts/blob/883f57c51838ed75057a2a2dc4fce5e16cdcfb4e/src/ai/policy/naval.ts#L1225)）。

**结束与边界。** 目标消失、没有候选目标、舰沉没、严重损坏或任务接管就释放/切换本次交战；这里不定义“岛厅已保住”“已封锁某岛”的持久效果，也没有把炮位伤害进展反馈给跨陆海总指挥的效果契约。

## 计划元素 9：港务、装备、伤员与运输船恢复

**职责与资源。** `navalServices` 保留工程人员、源船、目标船，执行转移维修和捕获空敌船；`outfitting/outfitCommands` 保存要装的炮架、物品、船和工人；`transportRecovery` 让空闲受损运输船到可达船厂修复，先完成当前渡运再修船。`landRecoveryAssignments` 为海外伤兵、治疗者和安全医疗点占位；`clearTransferLanes` 临时挪开空闲岸上战斗兵，避免实体堵塞装船（[naval-services.ts:20](https://github.com/shuxueshuxue/sketch-rts/blob/883f57c51838ed75057a2a2dc4fce5e16cdcfb4e/src/ai/policy/naval-services.ts#L20)、[naval.ts:1016](https://github.com/shuxueshuxue/sketch-rts/blob/883f57c51838ed75057a2a2dc4fce5e16cdcfb4e/src/ai/policy/naval.ts#L1016)、[transport-recovery.ts:16](https://github.com/shuxueshuxue/sketch-rts/blob/883f57c51838ed75057a2a2dc4fce5e16cdcfb4e/src/ai/bootstrap_1/transport-recovery.ts#L16)、[expedition-recovery.ts:43](https://github.com/shuxueshuxue/sketch-rts/blob/883f57c51838ed75057a2a2dc4fce5e16cdcfb4e/src/ai/bootstrap_1/expedition-recovery.ts#L43)、[transfer-lanes.ts:11](https://github.com/shuxueshuxue/sketch-rts/blob/883f57c51838ed75057a2a2dc4fce5e16cdcfb4e/src/ai/policy/transfer-lanes.ts#L11)）。

**前置、状态与子目标。** 维修要真实可登船的工程人员、有金、安全或濒危的受损船；夺船要空敌船且附近无威胁。装备读 `naval.outfit/outfitRetryUntil`，恢复多用本 think 的集合与原 order，不新增一种统一 claim。没有可达医疗点时 `colonyRecoveryGoals` 可请求岛上医疗建筑；没有可达船厂或工程人员时，各执行器通常直接无提案，不递归申请“先运工程师、再建临时修理港”的完整链（[naval-services.ts:71](https://github.com/shuxueshuxue/sketch-rts/blob/883f57c51838ed75057a2a2dc4fce5e16cdcfb4e/src/ai/policy/naval-services.ts#L71)、[colony-recovery.ts:14](https://github.com/shuxueshuxue/sketch-rts/blob/883f57c51838ed75057a2a2dc4fce5e16cdcfb4e/src/ai/bootstrap_1/colony-recovery.ts#L14)）。

**释放、交接与边界。** 转移、修复、装备或医疗不再需要时释放临时集合；船仍在 ferry 中时不夺走其船体。`planBootstrapNaval` 汇总 reserved，删掉其余海军指令后把医疗/退路/修船命令放到最后，恢复优先于普通远征。这里解决的是局部生存与实体通道，不决定该放弃哪个资源岛；`clearTransferLanes` 依赖单位已有 order 而非全局目标，所以要与矿区回防明确交接（[expedition-recovery.ts:119](https://github.com/shuxueshuxue/sketch-rts/blob/883f57c51838ed75057a2a2dc4fce5e16cdcfb4e/src/ai/bootstrap_1/expedition-recovery.ts#L119)、[expedition-recovery.ts:147](https://github.com/shuxueshuxue/sketch-rts/blob/883f57c51838ed75057a2a2dc4fce5e16cdcfb4e/src/ai/bootstrap_1/expedition-recovery.ts#L147)）。

## 计划元素 10：岛厅生产、防守交接与本土模块的边界

**职责与效果。** `footholdWant` 在已落成海外厅旁请求本地兵营、本地八人以下的基础步兵和塔；`expansionGarrisonReady/maintainExpansionGarrisons` 与陆地新矿共用，要求真实人员到岗或现有火力足以覆盖预测袭击；`colonyRecoveryGoals` 补充可达医疗。其目标是“有可工作的当地基地/静态掩护”，不能把它等价为“任何规模攻击都能守住岛”（[naval.ts:193](https://github.com/shuxueshuxue/sketch-rts/blob/883f57c51838ed75057a2a2dc4fce5e16cdcfb4e/src/ai/policy/naval.ts#L193)、[expansion-garrison.ts:133](https://github.com/shuxueshuxue/sketch-rts/blob/883f57c51838ed75057a2a2dc4fce5e16cdcfb4e/src/ai/bootstrap_1/expansion-garrison.ts#L133)、[expansion-garrison.ts:162](https://github.com/shuxueshuxue/sketch-rts/blob/883f57c51838ed75057a2a2dc4fce5e16cdcfb4e/src/ai/bootstrap_1/expansion-garrison.ts#L162)）。

**状态、兵力与资源。** 岛厅留守名册在 `unitClaims.kind=expansionGarrison`，岗位在 `expansionGarrisons[厅]`；不再另存海军私有守军名单。以可到达的前两名敌方袭击者估小袭击，先用恢复中士兵，必要时临时留健康兵；有其他当地防守/静态火力可以交接。本地兵营、塔和医疗仍争同一金库、工人和构造指令窗口；防守塔覆盖目标通过经济优先级 105 申请，普通海外生产不是同样的紧急增援请求（[expansion-garrison.ts:52](https://github.com/shuxueshuxue/sketch-rts/blob/883f57c51838ed75057a2a2dc4fce5e16cdcfb4e/src/ai/bootstrap_1/expansion-garrison.ts#L52)、[expansion-garrison.ts:73](https://github.com/shuxueshuxue/sketch-rts/blob/883f57c51838ed75057a2a2dc4fce5e16cdcfb4e/src/ai/bootstrap_1/expansion-garrison.ts#L73)、[expansion-garrison.ts:108](https://github.com/shuxueshuxue/sketch-rts/blob/883f57c51838ed75057a2a2dc4fce5e16cdcfb4e/src/ai/bootstrap_1/expansion-garrison.ts#L108)）。

**完成、失败与缺口。** 交接完成可让 `conquest.stage=complete`，静态火力能接岗后释放临时兵；厅/矿消失清理岗位。原始驻矿是小袭击预测，不是面对整队登陆的战区总指挥。岛被更大军团进攻、厅拆掉后，尚没有统一地形成“紧急增援/撤工/反登陆/重新建厅”的共同任务；各模块依其局部条件分别响应。本土主力、矿区驱赶、陆地前压的具体执行契约由 land/defense 文档负责；这里要求战略层同时看到各陆块事实和真正可兑现的运输时延，不能用本土 intel 的零 intrusion 代替全图安全。

## 四局原生房间取证与观测可信度

2026-10-20 在 A100，从指定 main 新跑四局，各一名 AFK 人类，其余席位保持房间原生随机种族/AI 解析；没有换兵、加钱、改命令或改地形。每局连续走到 18,000 tick。另各跑一局无插桩对照，峰值八个独立进程，低于本线 16 workers 限制。不是胜率 benchmark。

| 图 | 实际 AI 席位 | 逐席位 think 数 | 终局校验和 | 同 think 涉海军的同单位请求重叠 | 海军/驻矿 A-B-A 指令三元组 |
| --- | --- | ---: | --- | ---: | ---: |
| 蓝宝群岛 sapphireArchipelago | enemy 弓/ember；enemy2 骑士/grove；player-4 骑士/ember；player-5 召唤/grove；player-6 骑士/ember | 6,000 | `8c5164f6` | 1,248 | 1 |
| 碎海 brokenSea | enemy 骑士/grove；enemy2 弓/ember；player-4 弓/grove | 3,600 | `90993f1e` | 2,910 | 887 |
| 神泉殿 templeSpring | enemy 骑士/grove；enemy2 骑士/ember；player-4 召唤/grove | 3,600 | `ed4a5d24` | 124 | 0 |
| 环海 ringwater | enemy 骑士/ember；enemy2 弓/grove；player-4 骑士/ember | 3,600 | `36dcb1fc` | 14 | 0 |

共 14 个 AI 席位、16,800 次 think。这里“弓/召唤/骑士”分别是 `v9_archer/v9_summoner/v9_knight`。所有对照的初始 GameSnapshot、完整 18,000 帧命令流，以及 900 秒完整 snapshot **和所有 AI memory** 逐项一致。存档的 `createdAt` 当然不同，不拿墙钟元数据作仿真等价条件。观测版只通过构建时只读 hook 记录现有函数调用和返回，不额外运行候选选择；源码没有修改。

记录包含每个 think 的输入单位/建筑/资源、前后完整 memory、所有脚本的 claim 申请、原始提案、claim 过滤后提案、最终接纳命令、海军子阶段状态。另从初始存档冷重放完整命令流，为 41 个重点席位/tick 保存准确 GameSnapshot，逐单位核对 planner 记录的坐标、血量和 order，再继续回放到相同终局校验和。`replay-lifecycle.json` 给出逐 tick 的真实装卸、永久单位死亡和矿厅损毁，不以最近的 30 秒截图代替事件时刻。

**统计口径。** 表中 4,296 条是“单位 × think”的原始命令争用，不是 4,296 个 bug；例如海军与治疗微操会有合理争用。887 个碎海三元组是彼此可重叠的已接纳 A-B-A 模式，涉及 26 名单位，不是 887 场战斗。蓝宝另有一名单位。原始 ledger 保留每条 tick、单位、双方模块、胜出/被过滤命令；(b) 装载停滞候选和 (d) 厅受损候选也保留正确防守/撤离的可能性，下面只对已核实案例作结论。

## (a) 同一次 think 同时拿兵：命令入口并不使用同一裁决路径

**碎海，enemy，tick 8355。** `unit-enemy-lancer-1072/1100/1107`（三个完整 ID 的公共前缀均为 `unit-enemy-lancer-`，替换最后数字即可）在输入 memory 中都有 `expansionGarrison`，目标 `building-enemy-townHall-1319`。海军要求三兵去 `(4853.66,4034.96)` 推进；留守模块要求同三兵去矿口 `(3308.44,4077.02)`。当次只接纳海军命令，留守命令被本 think 已移动集合删除，三个防守 claim 也在接纳海军战略命令时被清掉。下一次 tick 8370 留守重新取得三兵。这是实际命令和状态变化，不是根据坐标猜出的意图。三兵购买价合计 330 金，这是被争用的资本，不是损失金额。

根因链条：留守 `claimsUnits` 只声明“当前需要发命令”的人员；在岗且现有 order 可接受时不声明（[expansion-garrison.ts:190](https://github.com/shuxueshuxue/sketch-rts/blob/883f57c51838ed75057a2a2dc4fce5e16cdcfb4e/src/ai/bootstrap_1/expansion-garrison.ts#L190)、[expansion-garrison.ts:203](https://github.com/shuxueshuxue/sketch-rts/blob/883f57c51838ed75057a2a2dc4fce5e16cdcfb4e/src/ai/bootstrap_1/expansion-garrison.ts#L203)）。海军 bootstrap 的声明回调虽然避开防守 claim，**实际海外战斗候选**却只按 mounted/恢复/夺岛排除，仍可发该三兵的进攻命令（[policy.ts:189](https://github.com/shuxueshuxue/sketch-rts/blob/883f57c51838ed75057a2a2dc4fce5e16cdcfb4e/src/ai/bootstrap_1/policy.ts#L189)、[expedition-recovery.ts:138](https://github.com/shuxueshuxue/sketch-rts/blob/883f57c51838ed75057a2a2dc4fce5e16cdcfb4e/src/ai/bootstrap_1/expedition-recovery.ts#L138)、[naval.ts:484](https://github.com/shuxueshuxue/sketch-rts/blob/883f57c51838ed75057a2a2dc4fce5e16cdcfb4e/src/ai/policy/naval.ts#L484)）。runner 接纳后，战略重定向清防守 claim（[claims.ts:51](https://github.com/shuxueshuxue/sketch-rts/blob/883f57c51838ed75057a2a2dc4fce5e16cdcfb4e/src/ai/policy/claims.ts#L51)）。这是“当前无需重发命令”与“任务已经释放人员”被混为一谈。

**神泉殿，player-4，tick 8095。** `unit-player-4-fieldMedic-1409` 被 `v6Backline` 声明且提出本土掩护移动；海军同 think 发 board 到 `unit-player-4-transport-2042`。`claimWinner=v6Backline`，但 board 仍被接纳，后排移动被已下单集合删除。它在 tick 8510 真登船、9839 真卸下。从争用提案到第一次卸下为 87.2 秒，其间 155 金医疗兵的去向由运输决定。证据是入口不一致；没有声称继续留在本土一定更好。代码入口是 [script-runner.ts:98](https://github.com/shuxueshuxue/sketch-rts/blob/883f57c51838ed75057a2a2dc4fce5e16cdcfb4e/src/ai/policy/script-runner.ts#L98)、[script-runner.ts:141](https://github.com/shuxueshuxue/sketch-rts/blob/883f57c51838ed75057a2a2dc4fce5e16cdcfb4e/src/ai/policy/script-runner.ts#L141)，不是防守 claim 被 `ferryCrewTaskAvailable` 正常保护的那种情况。

**环海，enemy，tick 7785。** `unit-enemy-emberRavager-1114` 的 `frontRecovery` claim 要求 hold，海军发往 `unit-enemy-transport-2302` 的 board 仍胜出；当时 46/118 HP。它在 8041 登船、9148 卸下，卸下时已是 101 HP，说明该争用不能直接写成“打断治疗造成损失”。战略层需要表达医疗与运兵两种效果，而不只是哪个脚本靠前。

## (b)、(c) 借兵让目标停滞，以及已接纳指令之间反复切换

**碎海，enemy，tick 8355 → 8370 → 8385。** 上述三名长枪兵依次收到“海军远处推进 → 驻矿 → 海军远处推进”，间隔各 0.75 秒，后一个海军目的地为 `(4842.88,4064.46)`。留守第一次已经在场，不存在“先完成一次往返再接受另一任务”的交接。这个例子同时证明了 (a) 的当次裁决及 (c) 的跨 think 翻转。

后续同局 `unit-enemy-lancer-1355`（110 金）在 tick 9600–12840 的 162 秒窗口中，被接纳 **96 条海军指令、101 条新矿留守指令**。例如 9615 留守到 `building-enemy-townHall-2284` 矿口 `(3246.69,3488.30)`，9630 海军转到 `(4143.41,3341.38)`，9645 再回留守。`unit-enemy-lancer-1107` 同窗有 95 条海军、91 条留守指令；`unit-enemy-footman-2400` 有 87 条海军、99 条留守指令。海军推进与两座矿厅的留守都不能获得稳定的人力分配，当前层没有给出谁应在这个窗口让谁。162 秒是观察窗口，**不能当作整段净延误**；这些兵仍会移动、战斗，损失反事实尚未测定。

1355 号长枪兵最终在 tick 12894 死亡，110 金；后面两座 enemy 岛厅在 14089、16522 被拆，合计 800 金。它们是同一对局的后果记录，**没有把 910 金全部归因于切换**。要决定修复收益还需要后续实现的对照，这次不改代码。

**蓝宝，player-4，tick 7326 → 7386 → 7401。** `unit-player-4-emberRavager-1176` 由新矿留守到 `(2798.83,4970.79)`，海军再把同岛五名 ravager 拉向 `(2513.07,4360.11)`，15 tick 后留守把五兵拉回。1176 当时仅 22 HP。它后来在 7974 死亡，另一名被争用的 `unit-player-4-emberRavager-1254` 在 8025 死亡，两兵各 120 金；该厅在 9323 被拆。这里也只确认切换、死亡与毁厅的时间，不把低血部队的死亡全部算在一次换目标上。两张海图共观察到 27 名单位的这种海军/留守三元组。

**补充一个已量清的停滞候选，而非误判防守。** 碎海 tick 9570–10365，`transport-1064` 在普通 reinforce 流中报 `await-reinforcement-batch`，持续 39.75 秒。本土两名闲置 `unit-enemy-lancer-1807/1894` 同时归大陆 `landExpansion=gold-mainland-3`，最终没有上这班船。这里还有“普通流需 >6 人”的真实门槛，不能仅因看到两个 claim 就归因于抢兵。具体提案/筛选已保留，优先级与按任务缺口申请运输的边界要由设计层决定（[reinforcement-ferries.ts:20](https://github.com/shuxueshuxue/sketch-rts/blob/883f57c51838ed75057a2a2dc4fce5e16cdcfb4e/src/ai/bootstrap_1/reinforcement-ferries.ts#L20)、[naval.ts:756](https://github.com/shuxueshuxue/sketch-rts/blob/883f57c51838ed75057a2a2dc4fce5e16cdcfb4e/src/ai/policy/naval.ts#L756)）。

## (d) 本土/岛上受击，而可用战力在另一个目标里

**环海，enemy，tick 14010（700.5 秒）。** `building-enemy-townHall-1622` 刚从 900 掉到 882 HP，本土 `readV6Intel.intrusion` 已经成立，攻击组 15 人。`unit-enemy-transport-2302` 仍在 `advance/sailing → gold-gen-5`，带着战斗单位 `unit-enemy-emberRavager-1067/1125/2917/3020`、`unit-enemy-mercenary-2918`、`unit-enemy-priest-2520`，另有一工人。本土仍留有十名有攻击力陆兵，因此不能说“全送空”。这一场本土厅只测到 18 HP 损伤，15 分钟仍存活；没有实际毁厅金损。代码只在新开远征时查 intrusion，在 reinforce 的 loading 阶段查回防；advance 已 sailing 时查海上/滩头危险，没有本土受击后的统一任务重估（[combat-delivery.ts:37](https://github.com/shuxueshuxue/sketch-rts/blob/883f57c51838ed75057a2a2dc4fce5e16cdcfb4e/src/ai/bootstrap_1/combat-delivery.ts#L37)、[naval.ts:688](https://github.com/shuxueshuxue/sketch-rts/blob/883f57c51838ed75057a2a2dc4fce5e16cdcfb4e/src/ai/policy/naval.ts#L688)、[naval.ts:713](https://github.com/shuxueshuxue/sketch-rts/blob/883f57c51838ed75057a2a2dc4fce5e16cdcfb4e/src/ai/policy/naval.ts#L713)）。

**碎海，enemy 的两个岛厅。** `building-enemy-townHall-2284` 在 13620 首次受损，14089 被拆，损失购买资本 400 金。owner 在 14100 的下一次 think 看到厅消失时，本土有五名可选增援而全局 intrusion 为零。`building-enemy-townHall-1319` 在 16095 首次受损，16522 被拆，再损失 400 金；16515 时它只剩 28 HP，岛上无自己的陆兵，岛上 `readV6IntelAt` 能看到 13 名攻击者、威胁 16.689，本土 `readV6Intel` 仍无 intrusion。不能把这个零解释为全图安全（[v6/intel.ts:114](https://github.com/shuxueshuxue/sketch-rts/blob/883f57c51838ed75057a2a2dc4fce5e16cdcfb4e/src/ai/policy/v6/intel.ts#L114)）。

这里海军**确实做了响应**：先撤工人，后来同一 `transport-1064` 带七名战斗单位去增援，落点风险不能通过后返航。16515 甲板上是 `unit-enemy-lancer-1179/1807/1894/2553`、`unit-enemy-footman-2400`、`unit-enemy-priest-2933/4825`。所以不把这两厅写成“有船也完全没救”。缺的是把岛上威胁、到达时间、是否增援得及、是否撤走/放弃的评估汇总给同一目标选择器。

**蓝宝，player-4 的岛厅。** `building-player-4-townHall-1736` 在 tick 8496 首次受损，到 9323 被拆；首次受损的 owner think 已无当地陆战兵，对面三名有攻击力陆兵。第二座 `building-player-4-townHall-4703` 在 15456 已处于施工期并受损，16267 被拆；当时岛上仅一名有攻击力陆兵，而运输船带着另一组人员执行 reinforce。两座共 800 金已付款资本，其中后一座没有完成。前者与前面的留守/海军换目标记录是同一条轨迹，后者涉及不同岛屿分配；不要把未建成厅混写成建成后失守。

四局总共记录 204 个“同 owner 相邻 think 之间矿厅掉血”的样本，其中 188 个在海外；这是受损样本数，不是 204 个任务冲突。AI 海外五座厅实际被拆，购买资本 2,000 金；另有神泉殿一座本土施工厅被拆。逐 tick 毁厅事实和每次掉血时其他兵/船在做什么都在 ledger 与 lifecycle 中。

## (e) 可组成的夺岛方案没有被完整提出：蓝宝的第三个目标

**准确帧：sapphireArchipelago / player-4 / tick 17991（899.55 秒）。** `gold-satellite-2` 的 `unit-player-4-emberRavager-3661` 已登陆，清营可用战力 0.9461，要求 4.1127；任务从 14241 持续报 `await-clearing-force`，观察到 187.5 秒未推进。本土没有 intrusion，也没有 45 秒内能到本土厅的敌军；有四名满血 idle ravager：`unit-player-4-emberRavager-5287/5642/5789/5909`，合计 480 金资本。四兵在这个准确帧可用，不代表整个 187.5 秒窗口始终都有这四人。

四兵当前全归大陆 `landExpansion=gold-mainland-2`，它在中央大陆；待补兵的目标却是另一座卫星岛。对实际卫星岛 landing 调用**现有** `reinforcementCrew`，四人全部因 expansion 目标陆块不同被拒。只在克隆 memory 中释放这四个 claim，再运行同一个纯候选查询，四人全通过；与现有岛兵合计 `creepForce=4.7307 >= 4.1127`。这项反事实仅核对资源/候选可行性，没有执行任何改过的真实对局，不能当成占岛成功率或净收益。

本土 `building-player-4-shipyard-1410` 完工且队列空，支持 transport，人口 29/56，扣除未落地 build 预留后仍有 424 金。现有船到两岸的真实海路为 3046.4，可连通；首船 `unit-player-4-transport-1536` 已被另一个 `gold-mainland-4` 清营任务占用，甲板是 `unit-player-4-emberRavager-3872/4011/4109`。因此这个可选计划应把“从大陆任务申请四兵 → 给卫星岛安排一班船/新造船 → 补足清营 → 清营后再运工人和筹矿厅资本”作为可比较的整体，而不是把已有一艘船理解成所有目标都已有运力。

当前没有这样的提案：`planConquestReinforcements` 只在空船或返程船上接任务；`reinforcementTransportWant` 看到已有任意 reinforce 流即返回；现有四兵又受不同陆块 expansion claim 筛除。此次纯查询返回 `extraTransportWant=null`，当次无运输船训练命令（[island-conquest.ts:174](https://github.com/shuxueshuxue/sketch-rts/blob/883f57c51838ed75057a2a2dc4fce5e16cdcfb4e/src/ai/bootstrap_1/island-conquest.ts#L174)、[reinforcement-ferries.ts:97](https://github.com/shuxueshuxue/sketch-rts/blob/883f57c51838ed75057a2a2dc4fce5e16cdcfb4e/src/ai/bootstrap_1/reinforcement-ferries.ts#L97)、[reinforcement-ferries.ts:35](https://github.com/shuxueshuxue/sketch-rts/blob/883f57c51838ed75057a2a2dc4fce5e16cdcfb4e/src/ai/bootstrap_1/reinforcement-ferries.ts#L35)）。这是大陆争夺、两个夺岛任务对同一兵力和船的争用，以及未形成完整计划链的同一现场。

这不是断言立刻再买船必然最优。240 金首船和 400 金矿厅不能同时从 424 金支付，已有远征也正在航行；战略层必须计入后续资金、在途时间、放弃另一任务的成本，比较先完成中央大陆任务还是先完成卫星岛。证据证明这个可组成的清营方案没有以计划元素进入比较，**没有证明可以无成本同时完成所有岛**。

另两条链缺口作为边界证据而非重复 bug：环海 enemy 的 `gold-gen-6` 从 9150 到 17985，441.75 秒报清营不足，末帧 6.5574/7.1665；神泉殿 enemy 的 `gold-gen-9` 从 14160 到 17985，191.25 秒未过清营门槛，末帧 6.1483/7.6535。环海当前 task 没有把 0.6091 缺口交成训练需求；神泉殿则**已经有指定补兵 ferry、两名真在甲板和三名正在登船**，不能误写成“没有想过增援”。原始计划链/占用状态已分别保留。

## 给战略规划层的输入/输出边界

建议作为设计输入保留以下事实，而不是把冲突简化成“永远防守优先”或“看见岛就派兵”：

- **世界事实与任务状态分开。** 历史 `delivered`、`complete`、已买船不等于当前滩头安全、驻矿仍有人、该目标有可兑现运力。各陆块的 incoming、局部强度、实际炮位与在途 ETA 都应进入局势评估。
- **申请单位与申请命令分开。** 在岗无需发新命令的留守仍有资源占用；有新移动命令也不能自动清掉原任务。已有 claim、物理甲板、ferry crew、施工成员要能被同一个分配器看到。
- **计划应带缺口和替代路径。** 可搬闲兵、需从其他任务借兵、需训练、需船厂/新船、改接驳点、等返程、放弃高威胁岛，都是不同成本与持续时间的分解。缺少候选时返回空命令不能替代“缺 3.166 战力/缺一班船”的反馈。
- **执行结果要能反馈。** 实际装载/卸载、营地伤亡、厅奠基/完工/被拆、守军到岗、航行停滞、因危险返航，应改变目标效用与可行性。微操避让、医疗和当前任务失败不能混为一次战略目标切换。

这些是模块与规划层之间尚需统一的契约，不是本 PR 实现的接口。统一设计、效用、抢占与 HTN/GOAP 分解由总设计汇总后决定。

## 复核与限制

本 PR 的源码树相对 `883f57c5` 没有变化；不新增测试、不改任务策略。基线已跑 `npx vitest run --dir src --minWorkers 1 --maxWorkers 4`：695 个文件通过，7,762 项通过、1 项跳过，638.62 秒。最初一次仅设置 maxWorkers 与仓库默认 minWorkers 冲突，未运行测试；已按上述完整命令重跑通过，错误日志也留在证据包中。

复现 seed/房间 ID 为 `corner-intent-<mapId>`；房间的默认随机席位解析一并记录。四局覆盖多海湾、主大陆、独立起始岛与卫星矿岛，不是整个地图池的冲突发生率估计。没有跑胜率 benchmark，没有凭四局证明某个优先级一定最优；没有把受损样本或所有微操争用都计成 bug。所有金损是实际已付款资产/死亡单位的购买价格，未计升级和装备，也没有自动归因给某次调度。

原始记录已封存在 A100 证据仓库，工作目录为 `/codegeex/jeffry/sketch-rts-naval/objectives-883f57c5`，已发布目录为 `/codegeex/jeffry/sketch-rts-naval/objectives-published-2026-10-20`。

- [复核包指针](naval-contract-2026-10-20-review.evidence.json)：7,116,523 bytes，SHA-256 `727e5ede7520228e354524e231abfa41660ecb475305e6ddcdb110bfe07a99ca`。包含冻结源码及 manifest、41 个准确帧、诊断、冲突 ledger、复核脚本、全量测试日志和四组观测一致性证明。
- [完整原始包指针](naval-contract-2026-10-20-full.evidence.json)：188,359,072 bytes，SHA-256 `0f623d3cda98b07e76e5c4de3377175146d188ef4907830c7f2385b71dba98d4`。另含四局逐 think 全记录、原生初始存档/每 tick 命令流/阶段 memory，以及四局无插桩对照。`FILE_SHA256.json` 可逐文件核验。

取回复核包（仓库 CLI 会校验对象哈希）：

```sh
SKETCH_MACHINES=/root/.config/sketch/machines-naval.json \
  bin/sketch evidence get docs/ai/objectives/naval-contract-2026-10-20-review.evidence.json \
  --out work/naval-objective-contract-review
```

包内 `work/naval-objectives/review/conflict-ledger.jsonl.gz` 保留全部争用候选和已接纳切换的逐条后果；`proof/frames/*/replay-lifecycle.json` 是精确事件时刻；`work/naval-objectives/opportunity.json` 是蓝宝的资源/claim 可行性查询。完整包 `native/runs/<map>/thinks.jsonl.gz` 才是所有 16,800 次 think 的未筛选记录，不能只看摘要来推断某类事件从未发生。

## 分配器接线复核：旧 ferry 泊位契约缺口（待办）

2026-10-20 对 main `0552ff21` 的只读核查确认：`policy/naval.ts` 的 `coastOnWater` 用 terrain 的 `walkableGoal` / `shoreSpots` 选择水点；`ferryOrders` 将其写入 `mission.from`，装载前先向该点移动。真正下达原生 board 后，sim 才调用 `shared/naval.ts` 的 `boardingBerth`，另求船体姿态与陆地点。旧任务没有把这份姿态、陆点及完整航路作为同一个已验证泊位保存，属于规划与执行几何未同源的契约缺口。本控制切片只修正式方法的共享泊位事实，未改旧 ferry 策略；旧任务的统一应在后续迁移时处理。

这不等于已证实旧 ferry 也选中了船厂矩形内的 `(1648,2480)`。用冻结连续诊断 `70ae44e6` 的真实蓝宝 p4 / tick 4180、4495 快照，只调用与 main 逐字相同的 `coastOnWater`，从主厅得到的均是 `(1552,2640)`，位于船厂外；4180 全部 7 个自有厅／陆兵源点的查询也未落入船厂矩形。实际旧任务保存的 `from=(1515.8040695718294,2512)`，阶段是 return。因此这两帧没有复现相同碰撞，不把新报价的 partial 航路归罪于旧 ferry，也不据此估算发生率或损失。原始水点在当前船头角度下未通过 terrain 的 `hullFits`，但这既不检查建筑碰撞，也不能证明所有转向都不可达。

[独立只读证据](main-ferry-berth-audit.evidence.json) 保存两帧、原生重放哈希来源、main 源文件、探针与逐项输出，77,636 bytes，SHA-256 `eb57d5c38d5b41cba0ec53e3f1bea01ea3c7f93f6c1df8bc68cafbceacb45b97`。探针没有运行 AI 或新对局；它证明上述调用和坐标边界，不作为实际停滞的因果证明。

## 控制查询的统一工作账本与点航段（候选，尚未行为验收）

控制 think 的 Situation、方法 ETA、固定航次与航次风险共用 `STRATEGY_FACT_WORK_PER_THINK=6144` 的逻辑工作账本。查询登记继续任务，think 结束依次推进关键航段、已有距离场、后台距离场；同一物理请求在几个入口出现只登记一次。关键集合包含已有正式动作及前 `CRITICAL_FACT_CANDIDATES=4` 个已具体化航次的候选目标；已知兵力／工人等前置不满足或已知净值非正的候选不进入这四个位置。没有具体航次的未知粗筛不冒充关键事实。`observation.factWork` 保留每次 think 的限额、合计逻辑工作及逐请求服务量。完整结果在下一次 think 可读取，重复同 tick 调用不再领取额度。

关键航段复用 `advanceShipRouteSearch` 的有限上限继续搜索，计入 prepare、connector、entrance 和实际扩展，避免 Infinity 分支的整海场预处理。原生 700 名义切片会在不可分操作之后暂停；静态有限搜索预留上界 1400，并按实际工作收费，不能拿「700×切片数」证明未超总额。原生搜索、试探顺序与碰撞规则未改。完整海场仍保留为后台／只读查询，不再阻塞控制的具体航段。

静态几何以地形、建筑、起终点和船体描述区分，原生搜索成本还依赖的操纵参数、起始方向与风也参与失效；ETA 按当前船的真实速率、转向和风重新计价。原生 partial 不公布 ETA，记为精确点对的 static-infeasible，候选遍历继续尝试其余已枚举合法泊位。实际现船的交通遮挡单列 transient-blocked；未来生产船不把当前可移动船体冻结成未来的永久路障。预测不模拟敌船未来机动或追击。搜索图合计限 32 KiB／16 个请求，超出明确保留 memory/entry-budget unknown，不能冒充已证实的静态不可达。

[冻结几何工作量探针](point-route-work-distribution.json.gz)（SHA-256 `3af3de48ec3fa01b5e8672db2c2b67abd4b30615ee56cce0ebf1aa734f5d958e`）含蓝宝、碎海、双岸的真实 9000 tick 地图、合法泊位、冷暖／双向共 12 项及逐 think 工作明细。蓝宝正向完整路需 11910 工作，公布时经过 45 tick；碎海反向完整路需 4600 工作，经过 15 tick。服务峰值 5540，冷暖的路线哈希和逻辑工作相同；完整路 ETA 1275、753 均不小于对应海场估计 838、569。其余 8 项返回 partial/static-infeasible，全部保留，没有从分母删除或填成数值航程；双岸原帧无 ferry，明确只是地图候选。此冻结几何微探针不是连续行为结果，更不能据此宣称真正 eligible 的关键事实 p95≤10 秒、max≤30 秒已通过。

`CrossingEta.expectedLoadedTick` 是本次查询根据实际登船步行、等待和 gangway 阶段给出的绝对装载完成预测；正式航次只在每名未上船成员的同一固定航次均有该预测时取最大值，否则保持 null。全程到达 ETA 和 `expectedFreeTick` 不替代它。实际执行保留首次有效预报、最新修订和原生实载观察时刻，不能拿最后一次重报洗掉误差。

部分装载不代表接人航段已完成。仍有成员在岸上且船未进入计划 water 的一船半径容差时，风险批次保留「当前位置→接人点→登陆点」两段，并让 loaded 请求消费同批 approach 的原生终点；已在船的乘客按同一两段存活率计损，岸上候船者只在成功接近后承担载人段沉船损失。船已到接人点才可以把 approach 记为已完成；全部剩余成员已在船上（已实际卸下者不再算待接人）时，才直接从船当前位置报价后腿。真实 4180 的两名在船、一名岸上、船距接人点 90.51 大于半径 36 的反例，修前错误略过接人航段，修后首请求与后腿原生起点均按执行路径保留。该回归是共享风险端口验证，不是自然 grant 或已兑现的经济损失测量。

## 当前威胁解除的 collector 差异

[逐字段因果表](clear-threat-collector-fact-diff.json.gz)（SHA-256 `cef5e0048f3f435b654090ca3ce1d67c8dda1faf91c765fde1fbc4d726454e6e`）先在 `70ae44e6` 重现原 7 帧完整 plan／observation SHA，再对新事实求差。7 帧 Situation 均逐字相同；仅 L2 有 24 个按 ID 对齐的变化叶：1934 厅当前无实际／潜在敌人且无覆盖敌塔，旧 DefendSite 从 active 结束为 complete，删除其 3 个方法，释放最短停留，排序与 observation 的历史 score 随之调整。其他独立目标除排序外、其他方法均断言逐字一致。原 `control-land-explanation-reference.json` 和所有输入未覆盖；新 `protection-land-explanation-reference.json` 通过旧文件 SHA 及逐帧旧哈希接续该证据链。没有对应当前事实的变化不得纳入新引用。

## 2026-10-21 基础设施诊断边界

`navigation-audit.scene.test.ts` 在原样十一图冷输入和 Ne 输入上调用公开控制入口。六图保留真实 9000 tick memory，另五图保留原始首帧 null，并通过原生 `createAiPolicyMemory` 初始化。夹具内逐项保存原 gzip SHA。诊断 observer 对策略规划阶段未经共享事实回调的原生陆海求路直接报错；生产默认没有 observer，不增加对局异常。事实队列的实际有限任务和此前已公布、具有工作量证明的场重建分别标记，旧脚本自身的执行另列，不能仅凭 helper 所属模块把新增选择器调用豁免。

控制评估读取原生订单及已有成员关系，不再预演旧医疗选择器。五个中期原帧对照 `strategyControl` 开关后，`postRecoveryAssignments` 和 `mobileCare` 的逐操作原生调用计数相同，新增策略调用为零。正式方法和执行器共享同一 think 的 land-route reader；未公布道路保留 pending 并进入原事实队列，不回退同步求路，也不把 pending 当成已知不可达。

集结抢占按同一联合情景分别准备实际 before/after cohort，经唯一航次风险批次后用同一现金流结算。后报身份仅能复用输入完全相同的已公布物理航段；船体、姿态、点位或前腿不同仍 unknown。原六兵减为五兵、两侧 readyTick 都为零的反例，正式事务损失为 `282.3379172514515 − 277.03557440745027 = 5.302342844001203` 金，不能因时间未变归零。资源 key 保留未限制与显式空集合的区别，原生产排除和同窗边界贯穿前后两侧。

本轮只验证事实、记账、命令入口和回退基础设施。冷帧总闸、端口回归不替代连续门槛；最终共同头还须通过 600 tick 六哈希与两图 4500 tick 的逐席逐条 191/278 命令对照。当前固定配方不进行 18000 tick 行为验收；后续目标分解按新的声明式动作约定实施。
