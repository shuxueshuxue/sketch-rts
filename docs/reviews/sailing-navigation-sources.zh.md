# 船舶导航重做：航海教材阅读记录

阅读日期：2026-10-08。下面列出实际打开并阅读的章节；没有声称读完各本书。历史教材用于理解船舶操纵，现代驾驶资料用于交叉核对。最后两节是本项目的工程推导与验收建议，不是原书给出的算法，也不是现实驾驶教程。

## 最影响结构的结论

船舶的目标航向、实际船首方向、转向速度、前进速度是不同的量。路线应允许船保持前进并逐渐转入下一航段；接近目标航向时应提前收住转向，避免转过头后再反打舵。换舷要同时考虑进入时的船速、穿越风眼、恢复新舷航速，不能只把角度改到另一侧就算完成。[Luce，第 XXIV 章](https://maritime.org/doc/luce/part7.php#pg412)、[US Sailing，Tacking Tips I/II](https://www.ussailing.org/education/adult/certification-courses-endorsements/racing-tips-resources/#the-turn)

上风目标不意味着持续左右摆动。应先判断当前舷能否到达目标，再按两舷可达线（laylines）、可用水域和风况决定换舷位置。小幅目标移动不应打断正在完成的转向。[Raymarine，Laylines](https://docs.raymarine.com/81406/en-US/latest/Laylines-1699BA9C.html) 支持前半条；后半条是本项目为移动目标提出的控制稳定性要求。

“每次换舷先向下风摆一下”也不能变成固定动作。历史小艇书会建议先让帆充分受风；现代竞赛龙骨帆船指导则明确反对在已有良好船速时多做这次摆动。共同原则是保留足够前进动量，具体动作取决于船型和当前状态。[Day，Maneuvers](https://www.gutenberg.org/cache/epub/45493/pg45493-images.html#MANEUVERS)、[US Sailing，The Turn](https://www.ussailing.org/education/adult/certification-courses-endorsements/racing-tips-resources/#the-turn)

## 实际阅读的来源

| 来源与所读范围 | 支持的认识 | 对本项目的用法和边界 |
| --- | --- | --- |
| S. B. Luce，Aaron Ward 修订，*Text-Book of Seamanship: The Equipping and Handling of Vessels under Sail or Steam*，1891；第 XXIV 章 *Working to Windward* 中 Steering、Tacking、Wearing、Remarks on Tacking，印刷页约 413–429。[书目信息](https://maritime.org/doc/luce/index.php)、[章节全文](https://maritime.org/doc/luce/part7.php#pg412) | 舵手预判船的偏转，在目标航向前渐渐回舵；保留前进速度，避免猛打舵损失速度；横帆船迎风角与船型有关；不足以完成迎风换舷时可能改用绕过下风的 wearing。 | 最贴近横帆舰的来源。书中给出横帆船距风向约 5.5–6 个罗经点，即约 62–68°；不是所有船的通用极限。不能把现代小艇的近风角直接套给全部横帆舰。历史舵令、索具操作、风浪条件不直接搬进游戏。 |
| Thomas Fleming Day，*On Yacht Sailing*，1904；*Sailing On the Wind*，页 35–41；*Maneuvers* 中 To tack、Miss-staying、To wear，页 56–58。[迎风章节](https://www.gutenberg.org/cache/epub/45493/pg45493-images.html#SAILING_ON_THE_WIND)、[操纵章节](https://www.gutenberg.org/cache/epub/45493/pg45493-images.html#MANEUVERS) | 上风航行可由长短不等的两舷航段组成；换舷前需要有速度，穿风后要防止转过头；失速和倒退时，舵效不同。 | 为长航段、连续操纵、独立失速恢复提供依据。该书针对当时的小游艇；不采用其整套性能描述、社会观念或已经过时的航行规则。 |
| US Sailing，*Racing Tips & Resources*：*Tacking Tips Part I – The Turn*、*Part II – The Acceleration*，以及 *Sail the longer tack first*。[原文](https://www.ussailing.org/education/adult/certification-courses-endorsements/racing-tips-resources/) | 换舷包含转向与重新加速；应保持速度，转弯过快或过慢都有代价；结束转向时提前收舵，避免过冲；合适的出弯风角随风浪变化。 | 换舷完成条件不能只检查越过风眼。不要把比赛中船员移重、绞盘操作及轻风出弯角数值硬编码成全部战舰的物理参数。 |
| Grant Headifen / NauticEd，*Slow Tack or Fast Tack – That is the question*，2010-06-29，正文 1–3 点及结语。[原文](https://sailing-blog.nauticed.org/slow-tack-or-fast-tack-that-is-the-question/) | 猛打舵会把动量耗在水中；转向速度要平衡保速与调帆所需时间。 | 支持平滑舵令与有限转向速率。它是具体航行经验，不能推出“越慢越好”或所有船固定同一转弯半径。 |
| RYA，*Do you know your points of sail?*，Points of sail、Sail Trim、Sailing Upwind。[原文](https://www.rya.org.uk/training/do-you-know-your-points-of-sail/) | 区分禁航区、迎风、横风、顺风；转向时需要随航向调帆；迎风目的地通过换舷接近。 | 核对概念和新手术语。页面的约 40° 是入门概述，不作为本项目所有船型的性能数据。 |
| Raymarine，LightHouse 操作手册，*Laylines*。[原文](https://docs.raymarine.com/81406/en-US/latest/Laylines-1699BA9C.html) | 两舷可达线表示最优风角下的航迹，用来判断当前舷能否到达目的地；使用真风和帆船性能，目标是有利的 VMG。 | 路线层计算两舷可达性，控制层跟随其中一条。当前无潮流、侧漂时可简化；以后引入这些因素需要区分船首方向与实际航迹。 |
| CPT Autopilot，*Operation Manual*，第 7.3 节 *Sea Trials* 的 Rudder、Deadband、Tacking。[原文](https://www.cptautopilot.com/manual/commissioning.html#sea-trials) | 舵量过大导致两侧过冲；死区过小导致反复动作；航向改变后需要给船响应时间；没有足够前进速度时舵效不足。 | 直接帮助解释“抽搐”：增益、阻尼、死区和状态更新节奏要一起设计。真实自动舵只保持航向，不负责本游戏的避岸、追逐与战斗。 |
| US Coast Guard，*Amalgamated Navigation Rules*，Rules 7、8（页面标注 2024-08-21 更新）。[原文](https://www.navcen.uscg.gov/navigation-rules-amalgamated) | 碰撞判断需要连续观察；避让动作应及时、明确，避免连续细碎变向，并持续检查结果。 | 只借鉴可预测避让的原则；民用避碰规则不是敌舰追逐算法，不能据此让战舰回避玩家要求的攻击。攻击靠近、火力位置、撤退要由战术层定义。 |

## 对导航重做的工程推导

1. **意图和路线分开。** 静态移动目标是一个到达区域；追击目标是随对方位置、速度变化的接敌区域。估算有限时间内的目标位置并适度领先，是工程上的拦截策略，不冒充上述教材已有的算法。目标小幅移动时只修正路线末端，保留可用航段和当前转向。
2. **路线和舵手分开。** 路线层选择绕岸方向、两舷航段和足够的转弯空间；舵手沿路线前方的引导点航行。引导点越过已接近的中间节点，不把每个节点当作必须停船并精确对齐的泊位。
3. **转弯具有连续状态。** 保留船首方向、转向速度和船速；用有限转向加速度、提前收舵以及合理死区抑制来回过冲。半径随速度、船型及机动条件变化。低速辅助是既定 RTS 折中，不能用“舵效为零”让单位永久卡死。
4. **换舷是完成一个动作。** 选择哪一舷、承诺穿风方向，穿风后恢复有效推进，再允许常规择舷。用户新命令、即将碰岸、明确危险可以中断；浮动目标的一点变化不构成中断理由。不要按时间强制换舷，也不要把一次路径采样误差当作新的航行意图。
5. **判断整船和前方空间。** 每次实际运动保留扫掠船体碰岸检查；前方需要足够空间来完成转弯，不能到岸边才要求瞬时转身。接敌或抵达用速度与距离控制，不能在射程边界每一帧轮流启停。
6. **把真实差异变成可理解的玩法。** 重型横帆舰可以转得慢、近风性能差；小艇可以更灵活。参数应由可视化场景验证，不把任何一本教材里的角度、时长、船长损失当作跨船型常量。

## 可视化验收应覆盖的场景

| 场景组 | 至少包括 | 人眼要确认的行为 |
| --- | --- | --- |
| 静态开阔水面 | 同向短程和长程；目标偏左/右 45°、90°、180°；起步朝向不同；弱风和无风 | 一条明确航迹；转弯与前进同时发生；无多余摆头、无连续绕圈；到点平稳停下。 |
| 迎风航行 | 正上风；目标靠近禁航区两侧边缘；长短舷不等；途中风变；换舷途中存档恢复 | 有用途的长航段；一次完成换舷；不会在风眼左右来回切换；风变只产生必要调整。 |
| 地形约束 | 岛屿左右绕行；海湾出入口；船身刚够通过的水道；靠岸起步；目的地靠岸 | 提前准备转弯；整船不穿岸；无法抢航时有可理解的低速通过或恢复动作。 |
| 移动敌舰 | 同向逃离；垂直横穿；目标迎面而来；远处点击后目标持续转弯；目标经过禁航区边界 | 接敌方向稳定；明显领先或追赶；不追逐每一帧的旧位置；目标小幅变化不引起航向符号反复跳变。 |
| 接战与多船 | 目标在射程附近移动；多船追一船；迎面友船；并行友船；玩家中途重下命令 | 维持可理解的火力位置；不会在射程边界连续启停；避让后继续原航路；新命令及时生效。 |

轨迹图和动画应同时标出船首方向、实际速度、目标点/接敌区、换舷状态、路线重算次数。量化记录到达时间、航程/直线距离、换舷次数、明显反向修舵次数、零速停滞时间与碰岸次数；通过数值检查后仍要逐场观看，避免“最终到达”掩盖中间的无意义动作。
