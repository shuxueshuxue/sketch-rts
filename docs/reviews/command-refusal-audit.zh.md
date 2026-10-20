# 玩家命令拒绝反馈：审计与接入草案

状态：**待确认，仅文档，不含实现**。审计基线为 main `a389ec26`。机械单位不得登塔是正在由 Codex 26 实现的新规则，下表不将其写成此基线已经具备的判定。

配套：[结构化原因词表草案](command-refusal-vocabulary.zh.md)。

## 结论

缺口横跨四层，不能只给 `orderEnded` 加一句翻译：

1. 现有 `checkCommandLegality` 已统一下达前校验，有 13 类原因和英文 message；命令卡已覆盖金币、人口、科技门槛、库存、部分冷却和距离。但多数具体条件仍被折成 rules/state/position，`legalityCommandState` 还丢掉了 message。
2. 混合选择通常用 `some` 接受整条命令，再在 apply 或客户端目标解析中 `filter` 掉不合格单位；这些被滤掉的单位没有失败收据。部分右键处理忽略 `sendCommand` 的 false，紧接着写“已下令”，把错误盖掉。
3. 已接受的命令在帧落地、排队激活、走到目标后会再失败。只有一部分走 `endOrder`；物品激活、物品交接、接舷、进舱、攻击等还有静默 return/idle。不能只审搜索到的 `refused`。
4. 现有 `orderEnded` 仅有六类原因，呈现为本人可见的橙色 ×，没有原因文字或对应错误音。合法的等待也可能看起来像失效：建造缺金、修船缺金、出生出口被堵等，应说明“等待”，保持现有命令，不改成取消。

## 阅读约定与源码索引

“即时拒绝”表示校验返回 `CommandLegalityError`。页面/适配器有机会把英文错误写入 statusLabel；它不是稳定、统一的中文失败提示，也没有统一错误音。“×”表示本人可见的 `orderEnded`，不含具体中文解释。“静默”表示该拒绝点未产出失败原因；不否认它之前可能已有落点圈或“已下令”状态。

源码行号针对上述基线，函数名是后续变更后的定位依据。

- V：[command-validation.ts](../../src/shared/sim/command-validation.ts)，`checkCommandLegality` / `narrowFrameCommandToLiveOperands`。
- S：[sim.ts](../../src/shared/sim.ts)，`tryPlayerCommand`、`applyPlayerCommand` 和各订单更新函数。
- F：[frame.ts](../../src/shared/sim/frame.ts)、[command-frame-runtime.ts](../../src/shared/sim/command-frame-runtime.ts)，入队及落地二次校验。
- E：[equipment.ts](../../src/shared/equipment.ts)、[purchase.ts](../../src/shared/purchase.ts)、[shop.ts](../../src/shared/shop.ts)。
- N：[ship-cabin.ts](../../src/shared/ship-cabin.ts)、[ship-gangway.ts](../../src/shared/ship-gangway.ts)、[tower-garrison.ts](../../src/shared/tower-garrison.ts)。
- C：[main.ts](../../src/client/main.ts)、[relations.ts](../../src/client/relations.ts)、[command-button-state.ts](../../src/client/command-button-state.ts)、[unit-hover-cursor.ts](../../src/client/unit-hover-cursor.ts)。

## 下达与入帧审计

下表覆盖 `GameCommand` 的全部 40 种命令；多种共享完全相同的入口时并列。持续执行阶段在下一表展开。

| ID | 命令 / 不执行的条件 | 位置 | 当前给玩家的反馈 |
| --- | --- | --- | --- |
| I01 | 通用：发令玩家、己方单位/建筑不存在或已不归己方 | V `missingUnitError`、`missingBuildingError`、`checkCommandLegality` | 即时拒绝；已入帧后见 I31，可能被静默移除。 |
| I02 | 通用：人在舱内；工作者仍在甲板上却接地面工作；目标在舱内不可选 | V:61–78 | state 类英文拒绝；部分物品/舱室入口另有中文提示，未统一。 |
| I03 | `move`、`attackMove`、`stop`、`holdPosition`：入口只校验单位 ID；hold 跳过工人，attackMove 对无武器单位变成 move | V:88，S:543–589 | move/attackMove 有私有落点圈；hold 被跳过及 attackMove 转换没有原因。stop 正常无失败。 |
| I04 | `aim`：没有远程武器；混选里只有部分能瞄准；点非法 | V:81–87，S:573 | 全部不合格时即时拒绝；部分不合格静默跳过。 |
| I05 | `attack`：目标不存在；无武器单位被跳过；地形不可达部分在客户端被拆出 | V:121，S:593–600，C `targetCommand` | 可能有攻击目标圈；无武器部分无原因，不可达全体有中文泛提示，部分改发移动。 |
| I06 | `follow`：不是可跟随友军或目标消失；跟随自己被跳过 | V:122，S:606–613 | 全拒时英文即时拒绝；自跟随被跳过却仍可有移动确认圈。 |
| I07 | `mine`：矿不存在；非工人被过滤 | V:123，S:617–630 | 只有矿不存在会拒绝；非工人静默跳过，仍可能有采矿确认圈。 |
| I08 | `repair`：建筑不存在、非己方、满血；非工人被过滤 | V:124–132，S:633–641 | 全局条件英文拒绝；不合格单位无原因，可能仍有工具确认。 |
| I09 | `repairShip`、`repairUnit`：无工人、目标消失/非己方、非机械、已修好；混选非工人过滤 | V:133–142，S:643–649 | 英文即时拒绝；混选过滤没有逐单位反馈。 |
| I10 | `build`：不是工人、种族不能建、占地冲突、地形不合、金币不足 | V:143–153，S:652 | 有独立建造预览和若干中文原因；统一校验本身仍是粗分类/英文，尚未到场扣费。 |
| I11 | `setRally`：建筑不归己方/不支持集结；矿或友军目标失效 | V:154–163，S `setRally` / `normalizeRallyTarget` | 即时拒绝；成功才有本人移动确认圈。 |
| I12 | `train`：建筑不存在/未完工、生产规则不符、人口门槛/空余不足、金币不足 | V:165–176，S `queueTraining` | 命令卡已有置灰及部分中文门槛提示；错误 message 不会完整进入 tooltip。 |
| I13 | `cancelTraining`：建筑不存在、任务已结束/重复取消 | V:164 / `narrowFrameCommandToLiveOperands`，S:664–676 | 缺建筑即时拒绝；过时 job 静默忽略，避免误取消下一个单位；不应破坏这个幂等性。 |
| I14 | `research`：建筑/种族/研究规则不符、未完工、已满级、重复排队、金币不足 | V:177–188，S `queueResearch` | 置灰/金币提示部分已有；已满级/已排队等细因可能丢失或退回英文。 |
| I15 | `upgradeBuilding`：目标不符、未完工、正在升级、周围没空间、金币不足 | V:241–251，S:737 | 即时拒绝；升级按钮部分使用标题兜底，未统一给实际规则原因。 |
| I16 | `hire`：营地消失、无库存、冷却、无友军在旁、人口不足、金币不足 | V:189–197，S `hireMercenary` | 命令卡已有部分中文置灰原因及冷却；缺金未给出具体缺口。 |
| I17 | `buy`：商店/商品消失、无库存、无接收者/太远、金币不足 | V:199，E `buyRefusal` | 部分中文购买提示；无货被归为 cooldown，交付错误大量归为 position。 |
| I18 | `buyShipEquipment`：无完工商船坞、接收者不合法/太远、金币不足 | V:198，S:756 | 同样有购买 UI 特例；底层精确原因是裸字符串或粗分类。 |
| I19 | 购买交付共用：背包无兼容位置、重武器缺四个连续位、船舱满/缺连续位、载重超限、接收者在舱内 | E `purchasePlacement` | `purchaseFeedback` 手工翻译部分英文；未成为所有命令共用的理由。 |
| I20 | `learnVeteranSkill`：非存活己方、已学、星级/永久/英雄条件不符、非三选一、单位类别不合 | V:200–209 | 即时英文规则/状态拒绝；部分选项根本不展示，不是统一解释。 |
| I21 | `cast`：无技能、眩晕、冷却、喷火器未就绪、技能目标阵营/类别不合、最小射程、不可达、缺目标点 | V `castError`，S `castAbility` | 技能卡已有冷却数字；指向有若干中文特例，整体错误仍不统一；远目标通常是走近再施法，不能把超出施法射程一律当拒绝。 |
| I22 | `setAutocast`、`setStance`：不支持此开关/姿态、混选不拥有该技能/不是近战者 | V:211–226，S:699–713 | 全拒时英文；混选静默跳过；按钮可隐藏。 |
| I23 | `garrison`：非己方加固塔、所有单位不合格、顶部人口容量不足；混选过滤 | V:252–261，S:746，N `canStandOnTower` | 全拒时仅泛英文；混选静默。基线尚无机械禁入新规则，Codex 26 将增加精确拒绝数据。 |
| I24 | `ungarrison`：非己方加固塔、没有驻军 | V:252–255 | 按钮置灰，但 state 的具体解释可能丢失。 |
| I25 | `board`：目标船不存在、甲板/载重不足、不合格单位被过滤 | V:95–104，S:719–732 | 全拒时泛“无甲板空间或载重”英文；混选无逐单位原因。 |
| I26 | `boardShip`、`cancelBoardShip`：非存活船、无裸露可接舷船员、接舷冷却、目标不合/高差大、隔水域 | V:105–120，S:514–532，N | 接舷专用按钮已有部分中文原因/冷却；仍有合并的 state/range/unreachable，取消空动作无特殊提示。 |
| I27 | `unload`、`unloadPassenger`：非运输单位被跳过、乘员已不在船上/在舱内、没有可用登岸点 | V:88–94，S:733–736，C:2330–2373 | 单乘员入口有英文拒绝及部分中文“无登陆点”；混选非运输单位静默；执行后的部分未卸无统一解释。 |
| I28 | `enterCabin`、`leaveCabin`：无舱室/容量/门路，不能进舱的单位被筛掉，出口没有空位 | V:62–68，S:503–511，N `cabinGroupSelection` / `leaveCabin` | 舱室专用 UI 已有部分中文解释；混选未被接纳者静默；即时退出失败返回 false 未逐人反馈。 |
| I29 | `pickupItem`、`giveItem`、`dropItem`：物品/携带者/接收者不存在、已被拿走、不归己方、无法携带、背包/位置不符、船员不在交换范围 | V:229–240，E `giveRefusal` / `dropRefusal`，S:2556–2640 | 即时错误多为英文或 state/occupied；捡取焦点不足已有本地中文，具体兼容格位仍不统一。 |
| I30 | `transferItem`、`wieldItem`、`useItem`：格位不合/被占、重武器四格、船武器安装/船舱/载重、双手武器、副手受限、物品不在携带者身上；use 入口只验持有，没验冷却和目标 | V:227–240，E `transferRefusal` / `wieldRefusal`，S:762–782 | transfer/wield 多为裸英文被归 state；use 的冷却/被动物品仅部分客户端入口提前说明，直接命令仍可能静默。 |
| I31 | 所有带实体 ID 的命令：入帧后单位/建筑/目标/任务已失效；混选仅余部分存活 ID | V `narrowFrameCommandToLiveOperands`，F `issueFrameCommand` | 命令变小或整条 undefined 后直接跳过，无玩家收据。原始意图 ID 必须留给反馈统计，不能从缩窄后的子集猜原选择。 |
| I32 | 入队后到落地时条件变化：金币、库存、人口、冷却、容量等 transient 不再满足 | F `commandRejection` / `issueFrameCommand`，S `tryPlayerCommand` | admission 可报错；apply 的 transient 拒绝直接跳过。没有到达类 order，因此也没有 ×。 |
| I33 | `forfeit`；协议/房间/观战权限/非有限输入错误 | S:499，适配器、网络解码/命令校验 | 正常认输不是失败；未开局/观战不能发令已有本地错误。非法协议、帧 tick 错、非 transient 分歧仍是程序/同步错误，不能伪装成普通玩法拒绝后吞掉。 |

## 订单执行与等待审计

| ID | 位置 / 不能按原意执行的分支 | 当前反馈 | 统一机制应表达什么 |
| --- | --- | --- | --- |
| R01 | S `activateQueuedOrder`：队列激活时不做全套语义重验 | 后续分支各自处理，可能静默 | 激活与到达仍用对应规则；不可用入队时的旧数值解释现在的失败。 |
| R02 | S `advanceMoveOrder` / `updateAimOrder`：到达可行走终点但仍不在瞄准射程 | 普通移动/停止，瞄准可转 idle，无拒绝原因 | 区分正常择近落点、路径仍在规划与真正无法接近，不能给每个正常移动播错误音。 |
| R03 | S `updateFollowOrder`：目标不再是可跟随对象 | idle，静默 | target-gone / ownership；玩家主动改命令和自然结束不报失败。 |
| R04 | S `attackStep`：目标失效、预期已被其他弹药击杀、目标无法打/到达 | idle 或换目标，无失败原因 | 目标已死亡可正常完成；明确攻击但武器/可达规则不符要解释，不把自动换敌、驻守回位当错误。 |
| R05 | S `updateMineOrder`：矿消失/耗尽、回矿途中无城镇大厅 | target-gone × | 分开“矿已枯竭”“交付建筑不存在”，而非同一个目标消失。 |
| R06 | S `updateGarrisonOrder`：塔消失/归属变/种类不合，后来被占满 | target-gone / no-room × | 塔失效、归属不符、塔顶已满；新增机械/体型规则由 26 的统一 helper 返回。 |
| R07 | S `updateBoardShipOrder`：目标失效或 `beginShipBoarding` 失败 | 取消接舷，idle，静默 | 保留接舷前置失败的具体原因；不能用泛“船不存在”遮住船员/冷却/几何问题。 |
| R08 | N `updateShipBoardings`：船位/支撑/相对姿态不再允许接舷；S 接近等待 | 桥状态/模型改变，无统一原因提示 | 连接中断或等待条件，明确 ships-apart / 路被挡等；保持现有接近/部署语义。 |
| R09 | S `updateBoardOrder`：船消失/不归己方、转移后容量不足 | target-gone / no-room × | 不同于“没有运输船”的容量/载重/空间原因。 |
| R10 | S `updateBoardOrder`：船未靠拢、入口排队/战斗、甲板暂满 | order.phase / blockedBy 保存 waiting/queued/fighting，暂无统一提示条 | 等待/交战是进展，不取消命令；选中对象能看阻塞原因，不逐 tick 报错。 |
| R11 | S `ferryUnits`：近船登甲板 `boardUnit` 再失败 | no-room × | 对应船当前容量/空间条件，单次拒绝。 |
| R12 | S `unloadCargo` / `ferryUnits`：在舱内/非己方/无登陆点的乘员被跳过；目的地到达后仍有未下船者 | 只有成功者有 unload 圈；未成功者无原因，船命令可能结束 | 区分乘员在舱内、登陆点被占、海岸不可达，报告部分成功，不能谎称全部卸载。 |
| R13 | N `enterCabinStep`：走到舱门前 entryAllowed 已不满足 | idle，静默 | 舱不可用、容量、舱门通路、资格/归属变化。 |
| R14 | N 进舱排队、出口暂堵 | 保留进舱订单；没有统一原因文本 | waiting，保留公平队列；不把短暂门口排队取消。 |
| R15 | S `updateBuildOrder`：20 秒无进展、位置后来被占/地形不符 | stuck / blocked × | 路径无进展 / 建造位置被占 / 地形不合。 |
| R16 | 同上：到场金币已不足 | 保留蓝图、静默等待 | waiting + 当前缺金数，保留命令，不改成取消。 |
| R17 | S `updateRepairOrder` / `repairBuildingTick`：建筑消失/转手；缺一金币 | target-gone / refused × | 建筑失效 / 具体缺金。满血是正常完成，不报错。 |
| R18 | S `updateUnitRepairOrder` / `repairUnitTick`：目标消失；非工人；缺金；冷却未到 | 消失 ×；非工人 idle；缺金/工时保留订单静默等待 | 区分规则失效与缺金等待；正常修理工时不是技能拒绝，不报错。 |
| R19 | S `updateTraining`：付费任务倒计时结束，但没有合法陆地出口/船舶下水位 | 留在队首等待，无统一原因 | waiting：出生口/下水区被堵；不退款、不丢任务、不凭空换出生点。 |
| R20 | S `completeUpgrade`：升级完成时新占地已不容纳 | 退款 goldBounty，未说明升级失败原因 | “周围空间不足，升级取消，已退回 N 金币”。 |
| R21 | S `updatePickupItemOrder`：物品消失/被拿走、到场已无兼容空位 | target-gone / no-room × | item-taken / inventory-full / 兼容位置不足，不能只写“目标不见了”。 |
| R22 | S `updateItemErrandOrder`：携带者已不持有物品、目标消失 | target-gone × | 分开 item-not-carried、target-gone。 |
| R23 | 同上：走近后 `giveRefusal` / `dropRefusal` 再失败 | 先 finish，随后静默保留物品，不给 × | 到达重验的具体原因；这是现有 `endOrder` 搜索漏掉的拒绝出口。 |
| R24 | S `activateItem`：冷却、闪电/炸药/法杖目标/阵营/距离不符、象牙塔位置不合、被动物品直接调用 | 多个直接 return，没有失败效果；UI 仅部分入口提前检查 | 统一用物品规则产生 refusal；有合法走近任务的超射程不直接拒绝。还需核对失败前 `useItem` 自动换手的现有副作用。 |
| R25 | S `updateCastOrder`：技能失效/不再拥有、目标死亡/转阵营/类别不合、治疗机械、武器最小射程、到场冷却、喷火器损坏 | 多数 target-gone / refused ×；veteran 条件不符有无原因 end | 精确技能/装备/目标/冷却原因，保留正常瞄准与转船等待。 |
| R26 | 同上 charge：目标走进最小冲锋距离或不可达 | 落入无原因 end，没有冲锋 | inside-min-range / unreachable；不是成功施法。 |
| R27 | S `applySummon`：地面不能落点、甲板无空位或载重不足，返回 false 被调用方忽略 | 无召唤、无解释 | summon-placement / deck-full / payload-full，不凭空发“已召唤”。 |
| R28 | S `errandWalk`：走到可到达终点但仍不够近（拾取、修理、施法、上塔、物品交接等） | unreachable × | 保留动作/目标上下文的一条中文“无法接近目标”；不能拿总路程超时替代判定。 |
| R29 | S `endOrder` / `finishUnitCommand` 共用出口 | 六类粗原因 + 本人 ×；无原因 finish 没有失败反馈 | 复用现有粗 reason 和队列行为，另带结构化 refusal。下达时失败只发收据，**不能调用 endOrder 清掉原任务**。 |
| R30 | S `updateUnits`：眩晕/踉跄、舱内状态跳过本 tick；冲锋期间新指令排队 | 状态/动作可见，订单保留，没有拒绝收据 | 属于等待或命令排队，不扩大原来的禁令，不每 tick 产出失败。主动 cast 在眩晕时被拒则用具体原因。 |
| R31 | [veteran-runtime.ts](../../src/shared/veteran-runtime.ts) `castVeteranAbility`：主动老兵技能没有可治疗/可增益友军，或技能/状态失效 | 返回 false，调用处可能仍 finish，无拒绝说明 | 仅手动使用失败报 no-valid-targets / 对应状态；自动施法的阈值、无交战等安静跳过。 |
| R32 | S `updateChargeOrder`：冲锋已经发动后，目标死亡/逃离或滑行结束没有命中 | 恢复后续订单，可能没有命中效果 | 已经施放后的未命中是战斗结果，不伪装为命令被拒；不返还或重新收取冷却。 |

## 客户端入口与现有反馈缺口

| ID | 位置 | 当前反馈 / 缺口 |
| --- | --- | --- |
| C01 | C `relations.targetCommand`：矿/修理/登塔/登船按类型过滤；攻击不可达子集另发 move | 无合格登塔者时可返回 undefined，随后变成 move。需要保留“点的是塔、意图登塔”，才能解释不能做；不能只在 sim 收到 garrison 后补。 |
| C02 | C `issueContextCommandAtWorld` | `sendCommand` 失败返回 false，但后续仍可覆盖 statusLabel 为 itemPickup/contextOrderStatus/moveOrdered。原因条需独立，成功状态必须以实际受理结果为准。 |
| C03 | C `legalityCommandState` / `commandButtonStateRequirement` | 置灰已有；仅把金币/人口/科技/库存/冷却/position 和少量 detail 显示中文，其余状态可置灰却无解释。应直接格式化结构化 refusal，而不是翻译英文 message。 |
| C04 | C `unitHoverCursor` | 当前光标是关系颜色，注释明确不是可攻击承诺；缺少“选中这队兵能否对这个目标执行当前动作”的判定与解释。关系色仍保留，叠加当前意图的禁止/部分可行提示。 |
| C05 | C 施法/冲锋/建造预览、物品栏/购买/进舱/接舷各自校验 | 有不少中文特例，但各自维护规则和字符串；技能多选还会先选 ready casters。要共用 sim 的只读判定，并解释部分执行，不能再加一张独立规则表。 |
| C06 | C `showInvalidCommand`、`effect-renderer`、`sound-cues` | 文字只是 statusLabel；orderEnded 只画 ×。当前没有把这两者连成同一拒绝通知，也没有 orderEnded 的专用错误音。 |
| C07 | [command-feedback.ts](../../src/client/command-feedback.ts) | orderEnded 已按 owner 私有显示；观战无发令身份、盟友/敌方和缺 owner 默认隐藏。新原因条和 UI 错误音必须复用同一策略，不能从选中单位或目标 owner 推权限。 |
| C08 | 适配器/网络报错 | 本地与 worker 预检、服务器 admission 可退回字符串异常，server 错误有 clientSeq 可关联。要保留结构化 payload，避免 worker/网络把细因压回裸 message；协议损坏和同步失败继续走原错误通道。 |

## 拟实现的统一通路

`共享规则只读判定 → 结构化 refusal → 下达前预览 / sim 实际重验 → 私有反馈归并 → 文字 + × + UI 错误音`。

- 核心只用配套词表的 `{ reason, detail }`，客户端不能凭 UI 快照替 sim 下最终结论。部分选择要返回 accepted 子集与逐单位 refusals；保留原始意图和原选择，不能在 `.filter` 后丢掉失败人数。
- 现有 `CommandLegalityError.reason` 13 类与 transient 保留其语义，供 AI、帧校验、重试判断。新增精确 payload，禁止解析英文 message 或顺便改 AI 决策。
- `orderEnded.reason` 六类保留；新增 `refusal`。整体拒绝、混选被滤掉、帧落地时变得不可执行也必须有收据。即时拒绝只发反馈，不清原 order/queue、不扣资源，不消耗 game.nextId。
- 外层记录发令 owner、commandType、涉及单位、阶段和稳定反馈身份。异步失败的私有属方沿用原发令上下文，不从目标属方或 UI 当前选择猜。正常自动索敌、AI 自主尝试、自动施法的暂不满足不变成人类错误音。
- waiting 与 rejected 分开。保留原来有效的等待、排队、走近、瞄准、修理工时，阻塞原因在状态改变时更新；不得每 tick 报错或改变命令完成条件。
- 意图对象与“当前所有选中者”分开：技能自动挑一名施法者、焦点拾取等单执行者语义，不为其余未请求执行的单位制造失败；确实请求混编部队登塔而被筛掉者必须报告。正常的落点投影、已发动后的未命中，以及当前规则允许消耗但无人受益的范围卷轴，不新增拒绝规则。

## 显示与归并草案

1. 执行后拒绝：保留本人单位上的橙色 ×；屏幕下方独立提示条显示中文（其他语言走同一 formatter）；错误音走 UI 通道，不受镜头距离影响，不从公开战场音效链路泄漏。
2. 同一发令批次、相同具体原因和目标归并：例如“3 个单位不能登上防御塔：机械单位不能登塔”。一批最多播放一次错误音。参数不同时给真实范围或分条，不能把不同缺金数/冷却数假装相同。
3. hover 不播音。命令卡只在全体不可执行时置灰；混选可执行时说明“5 个可执行，3 个受限”，接受子集沿用原规则。hover 目标显示具体原因，所有光标模式（普通/锁定、2D/3D）共用一次判定。
4. 跨快照以稳定反馈身份去重；本地预检和 sim/服务器回执也按同一命令关联，避免一条失败播两次音。重复取消、过时输入不改变幂等行为。
5. waiting 以“等待资金 / 等待甲板入口 / 出生口被堵”等状态说明为主，不假装成功，不以持续错误音骚扰玩家。

## 与 Codex 26 的边界

已对齐 `src/shared/command-refusal.ts` 作为纯数据词表文件。26 可在其已授权的上塔规则 PR 中先导出 `GarrisonRefusal` 与 `CommandRefusal = GarrisonRefusal`；`types.ts` 引用 `CommandRefusal`。本线确认后扩充联合类型和客户端格式化，不来回迁文件。

26 提出的五个码为 `garrison-mechanical`、`tower-full`、`garrison-body-size`、`garrison-ownership`、`garrison-ineligible`，具体 detail 见词表。26 负责整体拒绝、混选过滤和执行期的上塔拒绝产出；本线负责其余命令接入和全部客户端显示。**本草案尚未开始修改 sim/types 或实现 UI。**

## 验证与兼容性边界

- 四个 mac1 真浏览器场景：机械弩车点加固塔、金币不足、技能冷却、拾取/交接时背包满。相同镜头/操作在 main 缺少目标精确提示，在分支出现正确原因。不是只往页面注入一条文本；要断言实际 sim payload 与画面一致。
- 混选：可执行者照常执行；受限者有收据；原任务不被拒绝清掉。补充到达后条件变化、入帧后 transient 拒绝、满员/冷却/缺金的数值、同因合并、重复快照不重复音。
- 私有性：发令者可见可听，盟友/敌方/无发令身份观战不可见不可听；检查敌方单位不能切换权限。
- 覆盖卡片置灰与 hover 使用共享规则、2D/3D 与 pointer lock，提示不得被“已下令”覆盖；旧无精确字段数据有六类粗原因的中文兜底。
- **兼容性必须核对**：`canonicalGameState` 包含 effects，给 `orderEnded` 加 payload 或新增失败收据会改变状态哈希；它不是“只改 UI 所以校验和必然不变”。实现时与 26 对齐规则版本、checksum 表示、剧情/存档 golden 及旧数据读取，按实质变化处理。提示不能制造额外扣费/伤害/命令中断。
- 当前阶段只有文档；确认词表和 waiting 的处理后，再实现通路、显示与四个浏览器证明。
