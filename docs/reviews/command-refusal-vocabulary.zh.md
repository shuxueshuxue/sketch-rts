# 命令拒绝原因词表草案

状态：**待确认**；审计与源位置见[审计表](command-refusal-audit.zh.md)。词表拟落在 `src/shared/command-refusal.ts`，中文/英文格式化放在 `src/client/command-refusal-text.ts`。这里没有创建这些源文件。

## 格式

核心为按 reason 区分的联合类型，detail 是参数对象，不是人类句子或可随意添加字段的 `Record<string, unknown>`。下面只展示三个变体，其余由下表列全字段：

```ts
type CommandRefusal =
  | { reason: 'garrison-mechanical'; detail: { buildingId: string } }
  | { reason: 'gold'; detail: { required: number; available: number } }
  | { reason: 'cooldown'; detail: { remainingTicks: number; ability?: AbilityKind; itemId?: string } }
  // ...下表各变体
```

`required - available` 决定当前缺金，不把总价格当缺口。时间用 sim ticks，由客户端按现有 time/formatRemaining 转秒；不存浮点 wall-clock 倒计时。ID 和 catalog kind 供定位/本地化，不直接把技术 ID 当玩家提示。没有证据时不编造数量。

外层反馈另外携带 `owner`（发令者）、`commandType`、单位/目标、`stage`（issue/apply/arrival）、`status`（rejected/waiting）及稳定身份。它们是反馈上下文，不塞进每种 detail。`orderEnded.reason` 和现有 `CommandLegalityError.reason` 均保留粗分类；新增的 `refusal` 才是本词表。这样 AI 现有 gold/cooldown/position 等判断不变。

## 词表

“…”处的单位、建筑、物品、技能名用 catalog 本地化。中文列是默认示例文案，缺金/冷却等实值在实际失败时计算。多码并列的行分别是独立联合变体，复用同一组字段时才合行。

| reason | detail 字段 | 中文示例 / 使用边界 |
| --- | --- | --- |
| `garrison-not-infantry` | `buildingId, bodyForm`（mounted/beast/spirit） | 只有徒步单位能登上防御塔。骑兵、野兽、灵体共用此码，机械保留专用码。 |
| `garrison-mechanical` | `buildingId` | 机械单位不能登上防御塔。与 26 对齐。 |
| `tower-full` | `buildingId, used, capacity, required` | 塔顶已满（已用 3/4，此单位需要 2）。与 26 对齐。 |
| `garrison-body-size` | `buildingId, radius, towerRadius` | 单位体型过大，无法登塔。与 26 对齐，文案不显示内部半径。 |
| `garrison-ownership` | `buildingId, owner` | 只能登上自己的防御塔。owner 是塔当前属方，不是反馈可见性的 owner。 |
| `garrison-ineligible` | `buildingId` | 该单位当前不能登塔。只用于现有剩余资格条件；能识别的机械/体型/归属不用此兜底。 |
| `gold` | `required, available` | 金币不足，还差 35 金币。修理、建造、购买、生产等都复用。 |
| `supply` | `required, used, capacity` | 人口不足，还需 2 人口。人数与容量分开，不和科技门槛混用。 |
| `supply-tier` | `requiredCap, currentCap` | 需要先将人口上限提升到 20。 |
| `stock-empty` | `sellerId, kind?, remainingTicks?` | 暂无库存；有确定补货时刻才显示“还需 12 秒”。 |
| `cooldown` | `remainingTicks, ability?, itemId?` | 技能冷却中，还需 2.5 秒。商品补货用 stock-empty，不再伪装技能冷却。 |
| `seller-out-of-range` | `sellerId, recipientId?, requiredRange` | 接收者离商店太远，请靠近后再购买。 |
| `exchange-out-of-range` | `sourceId, targetId, requiredRange` | 靠近目标后才能交换物品。只有规则要求立即近身的转移才拒绝；可走近的 give/drop/use 保留走近订单。 |
| `target-gone` | `targetId, targetKind?` | 目标已不存在。已击杀敌人的攻击订单通常是正常完成，不乱报失败。 |
| `resource-depleted` | `resourceId` | 金矿已枯竭。与目标被销毁、回矿建筑丢失分开。 |
| `dropoff-unavailable` | `resourceId?` | 没有可交付金币的城镇大厅。 |
| `issuer-gone` | `entityId` | 执行命令的单位或建筑已不存在。仅手动命令收据，不给 AI 过时命令刷屏。 |
| `ownership` | `entityId, requiredRelation: 'own' | 'friendly' | 'enemy'` | 该目标不再属于你 / 需要友军目标 / 需要敌方目标。 |
| `target-type` | `targetId?, required: 'living-unit' | 'building' | 'mechanical' | 'non-mechanical' | 'unit-or-point'` | 该技能不能作用于机械单位 / 请选择敌方建筑。阵营由上下文或 ownership 表达，不藏在英文字符串里。 |
| `target-point-required` | 空对象 | 请指定目标位置。非法网络数据仍走协议错误，不用本码掩盖程序问题。 |
| `inside-min-range` | `targetId?, minimum, distance` | 目标太近，处于最小射程以内。冲锋、投石/舰炮技能共用。 |
| `unreachable` | `targetId?` | 无法接近目标。射程外但能走近不是拒绝；普通移动择近点也不一律报失败。 |
| `path-stalled` | `targetId?, stalledTicks` | 前往目标的道路受阻。当前建造的 20 秒进展判定保持。 |
| `separate-waters` | `sourceId, targetId` | 两艘船不在连通水域，无法接舷。 |
| `unit-ineligible` | `required: 'worker' | 'armed' | 'ranged' | 'melee' | 'transport' | 'ship' | 'equipment-carrier'` | 需要工人 / 此单位没有可用武器 / 此单位没有远程武器 / 此单位不能携带装备。上塔有专门细码，不覆盖它。 |
| `ability-unavailable` | `ability` | 该单位不能使用此技能。 |
| `no-valid-targets` | `ability, required: 'wounded-friendly' | 'unbuffed-friendly'` | 附近没有可治疗的受伤友军 / 没有可施加增益的友军。用于现有老兵主动技能实际返回 false，不把已允许消耗的范围卷轴改成拒绝。 |
| `autocast-unavailable` | `ability` | 该技能不支持自动施法。 |
| `stunned` | `remainingTicks?` | 单位正在眩晕，暂时无法施法。只有现有规则禁止的动作使用，不能把眩晕扩大到未禁止动作。 |
| `in-cabin` | `unitId` | 请先返回甲板。适用于现有舱内动作限制。 |
| `must-disembark` | `unitId` | 请先上岸再进行地面工作。 |
| `building-incomplete` | `buildingId` | 建筑尚未完工。 |
| `already-complete` | `targetId, action: 'repair' | 'research' | 'upgrade' | 'veteran-skill'` | 目标已修好 / 研究已满级 / 已学习老兵技能。执行期修满血是正常完成，不触发错误音。 |
| `job-already-queued` | `buildingId, upgradeKind?` | 该研究或升级已在队列中。 |
| `job-gone` | `buildingId, jobId` | 任务已完成或已取消。仍保持取消训练的幂等性；重复回执去重。 |
| `catalog-rule` | `rule: 'race-build' | 'producer-unit' | 'producer-research' | 'race-research' | 'upgrade-path' | 'seller-good' | 'rally-unavailable', kind, sourceKind?` | 该建筑不能训练… / 该建筑不能设置集结点。rule 是封闭枚举，不是原始英文报错。 |
| `veteran-ineligible` | `requirement: 'three-star' | 'permanent' | 'non-hero' | 'offered-choice' | 'unit-class'` | 需要永久三星非英雄单位 / 只能选择此单位提供的技能 / 技能不适合此单位类别。 |
| `site-occupied` | `buildingKind, blockerId?, blockerKind?` | 建造位置被占用。象牙塔、普通建造、升级共用底层规则。 |
| `site-terrain` | `buildingKind, requirement: 'land' | 'shore' | 'walkable'` | 此处地形不能建造 / 船坞需要合适海岸。 |
| `upgrade-site-blocked` | `buildingId, to, refundedGold` | 周围空间不足，升级取消，已退回 150 金币。运行期退款事实，不与 admission 单纯“位置不足”混用。 |
| `spawn-exit-blocked` | `buildingId, unitKind` | 出生出口被堵，等待腾出空间。waiting。 |
| `launch-blocked` | `buildingId, unitKind` | 下水区域被堵，等待腾出空间。waiting。 |
| `deck-full` | `shipId, requiredSpace?, availableSpace?` | 甲板没有足够空间。几何放置失败不编造“还差几格”。 |
| `payload-full` | `shipId, used, capacity, required` | 船只载重不足。载重单位按现有游戏显示格式处理。 |
| `landing-blocked` | `shipId, passengerId?` | 附近没有可用登陆位置，请靠岸或清出空间。 |
| `ships-apart` | `sourceId, targetId` | 等待两艘船靠拢。waiting，保持现有 boarding 阶段。 |
| `boarding-crew` | `shipId` | 接舷需要甲板上的可行动船员。 |
| `boarding-height` | `sourceId, targetId` | 两船甲板高差过大，无法接舷。 |
| `gangway-blocked` | `sourceId, targetId` | 接舷通路被阻挡。仅规则已确认几何失败时用，不把正常 approach 叫拒绝。 |
| `cabin-unavailable` | `shipId` | 舱室不可用。 |
| `cabin-full` | `shipId, used, capacity, required` | 舱室容量不足。 |
| `cabin-door-blocked` | `shipId` | 舱门通路被阻挡。区分等待和最终拒绝，沿用现有门口排队行为。 |
| `inventory-full` | `unitId` | 背包已满。只表示携行位置确已用满。 |
| `inventory-incompatible` | `unitId, itemKind` | 没有适合此物品的空位。可有空格却不兼容，不谎称已满。 |
| `equipment-slot-incompatible` | `itemKind, slot` | 此物品不能放入该装备位置。 |
| `equipment-slot-occupied` | `unitId, slot` | 该装备位置已有物品，请先移开。 |
| `heavy-item-space` | `requiredSlots: 4, destination: 'unit' | 'hold'` | 重型武器需要四个连续空位。 |
| `hold-full` | `shipId, requiredSlots` | 船舱没有足够空位。 |
| `hold-slot-occupied` | `shipId, slot` | 该船舱位置已被占用。 |
| `mount-incompatible` | `shipId, mountId, itemKind` | 该炮位不能安装此武器。 |
| `mount-occupied` | `shipId, mountId` | 该炮位已有武器。 |
| `mount-blocked` | `shipId, mountId` | 请先清出炮位周围的甲板。 |
| `installer-required` | `shipId` | 安装或拆卸武器需要附近的船员。 |
| `item-taken` | `itemId` | 物品已被其他单位拿走。 |
| `item-not-carried` | `itemId, unitId` | 该单位已不再携带此物品。 |
| `item-passive` | `itemKind` | 这是被动物品，无需主动使用。 |
| `item-in-carry-slot-required` | `itemId` | 请先把物品移到携行位置。 |
| `two-handed-main-only` | `itemId` | 双手武器只能放在主手。 |
| `offhand-blocked` | `itemId` | 请先收起双手武器再使用副手。 |
| `weapon-mount-required` | `itemKind` | 舰载武器只能从船上的炮位发射。 |
| `weapon-unavailable` | `itemKind` | 所需武器不可用或已损坏。 |
| `summon-placement` | `surface: 'land' | 'deck'` | 此处无法放置召唤单位。若已知是甲板空间或载重，用相应细码。 |

## 兜底、优先级和数值

- 判定优先级沿用实际规则；先报造成当前拒绝的首个确定原因，不凭 UI 猜另一个。26 的上塔机械条件优先；不为制造提示扩大禁令。
- 旧数据缺少 refusal 时，六类 OrderEndReason 映射成“目标已失效 / 无法接近目标 / 道路受阻 / 位置被占 / 没有空位 / 当前条件不允许执行”，明确是粗兜底，不捏造“金币不足”之类细因。
- 新代码不能继续用 refused 或任意字符串当精确原因。词表覆盖不到时，先补一个有明确规则来源的联合变体；程序错误仍抛出，不静默吞掉。
- 同一命令多个单位同因合并；detail 数值不同则真实显示范围或分条。金币、库存、冷却在实际拒绝时取值，不用下达时快照冒充到达后的状态。
- waiting 使用相同原因数据，但不结束原订单。普通攻击间隔、正常瞄准、正常转船、合法排队、主动取消不自动成为错误通知。
- 精确文案兼顾中文和英文；sim 不依赖 locale，客户端不按英文 message 做字符串匹配。

第一期实际输出采用 `src/shared/command-refusal.ts` 的封闭联合类型；船只、甲板、炮位与装备的拟议细码暂不输出，用真实的 `condition-unmet.category` 粗分类保留原因，第二期再细化。界面与验收见 [第一期记录](command-refusal/README.zh.md)。
