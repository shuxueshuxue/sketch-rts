# 题9快骑游击：固定main的单次基线

**main未通过：同一名原生骑兵在三次新工人上路后分别击杀工人，累计损失3人，目标厅未完成。** 两骑兵仍存活。新规则固定后只跑这一局，没有再改敌人、撤退点、属性、数量或触发条件。

要求来源为#590及184的2026-10-22 03:07补全：只袭击工人，遇武装单位立即撤退，等下一工人新上路再返场。初次控制器不完整的运行另记诊断，不能与这局混算。

## 固定源码和行为规则

固定main为`4231d27ee31779286acf3ebb40cf4416aef0f01f`；实际运行源码为`fb2e8b44117d61ffed8a87fe1dfb5f804a81e445`，A100/Node24、v9_knight。AI、SDK、shared/sim对固定main逐文件diff0，strategyControl仍为原默认false；原输入、前后memory、返回命令及实际SDK应用全部保存。

[开跑前冻结清单](worker-fast-raider-main-4231d27e.frozen-before-run.json)与[场景说明](../../../../src/ai/strategy/puzzles/disruption/README.zh.md)锁定以下行为：

- 沿用原往返变体的地图、两敌初始位置、撤退点；新变体把两footman换成原生raider。
- 首个工人进入路段中段带才攻击，attack的目标只能是工人。
- 敌方逐原生tick观察。武装单位进入普通玩家单位的原生idle警戒范围230时，按strikeReach/可达条件立即提出move撤退；原SDK三tick延迟保留。原生自动反击、弹丸和碰撞不被禁用。
- 原生工人死亡后也撤退；两存活骑兵都回到固定撤点且警戒解除后，只有此后新跨入路段的不同工人能触发返场。已经在途的工人不算新上路。
- 至少三次循环，除非我方先以真实战斗清掉袭击者。最多死一名工人，下一工人出发前须有正面保护，480秒内须建成目标厅。

我方仍每15tick正常think；敌方逐tick观察不是额外调用我方AI。整局640次owner think，9600步，初始tick1、末tick9601；原进程exit1是行为断言失败，error为null。

## 实际循环、死亡和目标

| 次数 | 敌方提出攻击/新跨线tick | 本轮结果 | 两骑回到固定撤点 |
| --- | ---: | --- | ---: |
| 1 | 1716，首工人进中段 | 1743警戒触发即撤，首工人存活 | 2056 |
| 2 | 3994，原worker1新跨线 | 4311原生死亡 | 4606 |
| 3 | 6622，原worker2新跨线 | 6942原生死亡 | 7237 |
| 4 | 9249，后产worker1006新跨线 | 9567原生死亡 | 时限内仍在撤退 |

首次警戒来自lancer1015，实际中心距227.5905，原生阈值230。完整原SDK首次attack应用1719、警戒撤退move应用1746，保持三tick延迟；后续首次attack应用3997/6625/9252。前三次均有真实回撤到点记录，第四次不冒称回撤已完成。

三次死亡的原生kill source都是同一名raider1；同时有具名removed/death/countedAsLoss记录，不靠快照缺席推断。末帧raider1/2均活，原生升级和HP变化照存，未重置敌人。原工人1017尚存、HP14，不误记首轮死亡。末帧实际现金45，全SDK无townHall build，只有初始本土厅，没有远矿厅。

[原子检查](worker-fast-raider-main-4231d27e.original-summary.json)中，工人最多一死、不得重复损失、第二工人正面保护、目标完成均false；新跨线/循环覆盖和无死者重发为true。现有保护读取器只是物理证据子集，**重复的原生死亡和未建厅已独立足以确认main失败**，不靠读取器单个false归因AI内部根因。旧main没有这项新风险模型的事实/报价接口，本轮不捏造GOAP原因、q或6144服务账本。

## 快骑条件与可拦截性

整局实际我方战斗单位只有footman62、lancer68，均未骑乘；完成的相关producer只有兵营，潜在产兵也只有这两种，没有马厩或更快兵。没有禁用生产、研究或catalogue选项。该局实际速度条件成立；不能把它夸成游戏规则永远不允许AI发展骑兵。

| 同一交会点 | 原生寻路距离 | 原生速度 | 距离/速度 |
| --- | ---: | ---: | ---: |
| 原撤点→路段中点 | 992 | raider82 | 12.097561秒 |
| 工人上路点→同中点 | 1152 | worker60 | 19.2秒 |

骑兵可早约7.102439秒到达；真实三次击杀补足了“能打断工人”的物理证据。这是原生路径/速度比较，不把它称为完整碰撞/战斗的精确ETA。当前没有战争迷雾，所有敌人一直在plannerView中，走远不被描述成原生不可见。未实现q先验、Beta计数或新生产风险模型。

## 诊断、回归和验证边界

初次`8dd00ed7`运行沿用旧控制器，会把已经在途的工人当成新返场触发，且未遇武装即撤。该局640think、死1工人、两骑被lancer击杀、未建厅，仅为诊断；[原输出](worker-fast-raider-main-4231d27e.diagnostic-original-summary.json)照存，未重标成严格快骑基线。184确认后才补全规则，固定`fb2e8b44`并单次运行上表这局。诊断包SHA`fbac912a054fcc456b6fa8f16a6b2a36dc5794ff0bde05e713c9db840a1a34ae`，1210546B，与严格包分开。

最终固定源29/29合同通过，含SDK7；root/tools-ai/tools-cli均exit0。合同包括三次真实截杀→回撤→返场、拒绝已经在途的旧工人重新触发、遇武装警戒立即撤退、脚本不发向武装单位的attack。SDK/物理合同确实调用原生推进，不能称为全轮纯读。

相同29项在PR集成源`7f3055edf48e93d7e79a16b2101ff6199ce2f575`通过，根tsc0；与原PR头44c5的生产diff0。测试分母不相加。准备阶段一处测试场景类型收窄错误修正后通过，不算main生产反例。独立[旧世界对拍](worker-fast-raider-main-4231d27e.old-worlds-identity.json)确认原七变体初始snapshot JSON逐字节不变，无新AI运行；旧题9两变体和题10小袭仍按原证据保留为main通过的回归题。

严格基线包SHA`28478ee21c84984e56720e1cf16408dc7a5df3072a7c7d22af3f40046bf118fb`，1505278B，存储端字节/SHA及30payload逐一重开一致。[证据指针](worker-fast-raider-main-4231d27e.evidence.json)含本局全原片；[只读汇总](worker-fast-raider-main-4231d27e.audit.json)只解析原JSON/CRC/hash，不重跑AI/SDK/sim。此处得到有效main行为失败，尚未冒充新规划器已通过的正式K20/执行验收。

复跑需显式选择固定归档源码（本轮已按指示只跑一次）：

```sh
git switch --detach archive/public-fast-raider-main-fb2e8b44-source-20261022
node --import tsx scripts/planner-disruption-baseline.ts --mode v9_knight --case worker-ambush/fast-hit-run --out /tmp/fast-raider-independent-run
```

题3仍保持最高优先：收到32的新固定头及正常allocator/ledger冷观察投影后，按原checker重跑冷K20；本次不自行补生产分配，也不拿预计资本替代真实预留。
