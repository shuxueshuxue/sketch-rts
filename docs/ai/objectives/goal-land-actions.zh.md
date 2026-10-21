# 陆地与经济原子动作

本文件跟随 `goal-planner-types.ts` 的共同词表。目标可以是扩张、摧毁据点、控制路口、结束骚扰；动作不包办整个目标，也不指定前后步骤。

## 经济声明构造器

`goal-economy-actions.ts` 只把共享 grounding 转成声明，不注册到默认行为入口，不执行命令，也不在构造时求路。

| 动作 | 前置 | 数量流与时长 |
| --- | --- | --- |
| 训练(兵种、数量、生产者) | 本种族原生生产边、可用生产通道、金币、人口档位、空余人口、合法出生出口 | start 扣目录金币并预占人口；finish 加真实兵种池及 native combatRating。船的载荷质量由 native shipProfile 给出，属于同一 symbolic hull output。工时用原生 trainTime。 |
| 建造(建筑种类、精确地点、工人) | 本种族原生建造许可、共享精确建址、目标陆块工人池、所选工人到工地的独立路线、金币 | start 预留本金并使建址不再空闲；finish 建筑完工并产生容量、同一生产者的原生 production 能力。时长是共享 walk ETA 加剩余工时。已存在的未完基础只续建，不重复付款。 |
| 等收入(金额、期限) | 同一次思考的结构化收入预测 | 只产生当前未预留现金之外的增量。窗内收入不足整个缺口时仍可贡献已知部分，由规划器与赏金等其他正流合算；不建立尚未凑够的金币事实。 |

训练只产出符号槽位（例如 `unit-0`），未来生产者引用也是 output/binding；评估副本的 ID 不进入真实 entityIds、lease 或出生证据。船的载荷以原生质量计，不能把容量数当作乘客人数。

`worker-at` 表示同陆块可调用池；它不能证明工人已经站到工地。共享 route 尚未公布时，建造 duration 保留 pending。跨岛工人要由运工人动作建立目标陆块工人池。

人口档位与人口余额独立：骑士需要的 `supply-cap` 来自原生 `requiredSupplyCap`；购买所消耗的是 `population-room`。农场只在真实完成时产出目录规定的容量，不能把一座农场的效果写成任意目标人口上限。

建造的 start 金币负流表示分配后的可用现金预留；原生命令在工人实际破土时付款。它没有把付款提前写进游戏世界。

## 经济候选 grounding

`createGoalEconomicGrounding(context, ports)` 只实现共同 `buildSites / productionOptions`，使用中心注入的 `GoalGeometryReader`、几何 revision 和已准备的 mover-region 索引视图。它不建立 Situation、Arrival query、FactWorkQueue 或另一份预算。

建址以原生 footprint 对齐，按稳定方形环检查原生 `isBuildPlacementClear`；每个候选点和每个已有地基检查都分别记一份工作。游标只保留环、偏移、地基序号和至多八个候选，中心 source 负责分片、JSON 续算和下一次思考才公布。八个点是有界的替代候选，不证明其余地图没有合法点。候选可以互相重叠，不能把它们当作已同时占用的工地；执行前仍须原生重新校验。

每个建址保留原生精确建筑中心与工人的陆地 approach。合法船厂中心可以在水中；共享 route 的终点是 footprint 内可步行的陆地点，`goal.build` 执行参数显式保留它，不能把原建筑中心投到另一点。真实工人的 route/ETA 来自同次事实端口。还没有真实工人的 binding 保留 pending，不用逻辑锚点伪算当前步行时间。

已有未完工建筑按实际身份进入候选，建造声明读取原进度并免除第二笔本金；完成后有空训练通道才建立 production 能力。现有生产者候选依据本种族原生生产边和实际 mover-region，未完工或队列占用者不伪造释放时间。尚未公布的可选新工地放在共同 `deferred` 字段，已有可用生产者仍可比较。

## 陆地动作的共同边界

| 原子动作 | 前置与效果 |
| --- | --- |
| destroy-target | 指定真实作战组到岗、该组的共享战斗评估；建立 enemy-site-destroyed。 |
| hold-position | 指定组到岗并在声明窗口内占用这些成员；建立该窗口的 route-controlled。 |
| engage-units | 指定组到岗及该组的 interception-capability；建立 harassment-ended。 |

速度、射程、火力及 camp-force 都由共享事实/整组评估给出。全池里另有反制兵，不代表被分配的弱兵组具备反制能力；声明前置须绑定实际 cohort。缺反制能力时由生产候选回归到同一训练动作，动作侧不插入特定兵种的固定步骤。

## 验证范围

构造器和 grounding 测试包括真实原生训练付款/出生、真实农场完成后解锁骑士、同一共享 6144/Arrival 的水中船厂中心建址及公开 move→build 完工，以及 route/income 结构端口、JSON 续行、零预算和无账外原生导航调用。它们验证声明与领域规则的对应，不替代公开题的完整规划和执行检查。自动 actionsFor、规划器分配接线及执行绑定需要在同一共享事实源上继续验收。
