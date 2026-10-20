# 只读死亡账本与迁移基线

本阶段实现 [战略设计 5.1 节](strategy-layer.zh.md)，只观察房间 AI 的行为，不改变命令、分配、战斗、存档或校验和。
当前模块尚无正式分配器，任务、阶段、到岗、撤退和分类均为旧状态的**推断**。`objectiveId`、`methodId`、`assignmentId`、目标效用和计划许可战力区间明确为空；不能把基线诊断读成规划器批准了某场交战。

## 接入边界

`observeSimulation(game, observer)` 从 `src/shared/sim.ts` 公开导出，可给服务端房间、单机及回放挂载。订阅在外部 WeakMap 中，不写 Game、AI memory、snapshot、canonical 或 command frame。未订阅时，伤害/清理/命令路径仅检查一个模块级启用标记，不分配事件、不查订阅表、不复制实体；没有声称连一个条件分支都不存在。

回调收到深度冻结的副本，可观察伤害、致死、移除和实际合法命令。不要通过回调闭包修改模拟。订阅者异常输出订阅者标签、事件和完整栈；同步模拟与其他订阅者继续运行，Vitest 下通过微任务抛出以使测试失败。结束时调用返回的 dispose。

`AiDeathLedger` 同样由调用者持有。用法如下：

```ts
const ledger = new AiDeathLedger(game, { owners: roomAiOwners });
// 普通 planner 恰好执行一次之后：
ledger.recordThink(snapshot, owner, actualPolicyMemory);
// SDK/server 实际应用命令之后，补充执行器。不能仅凭 proposed/accepted intent 绑定：
ledger.recordIssuedCommand(game.tick, owner, entry.command, entry.scriptId, entry.source);
// 或向 planAiOwnerCommandEntriesWithTrace 传入 { deathLedger: ledger }。
const traceWithDeaths = ledger.withPlanTrace(trace, previousTraceTick);
const finalSummary = ledger.summary(owner);
ledger.dispose();
```

原生合法命令回调确认命令确实已应用。`recordIssuedCommand` 只丰富该实际命令一次，并保留帧过滤后的实际单位集合；瞬时拒绝的帧意图不会制造订单。仅挂 sim 订阅时，执行器未知；有 afterIssue 补充时才标为 recorded。现有服务端网络包不携带 scriptId，本 PR 不扩展网络协议，也不默认开启线上采集。

`AiPlanTrace.deathLedger` 包含自上一次 trace 到本次的增量记录，以及本局累计统计。记录的 `tick` 是致死时刻，`removedTick` 是移除时刻；增量使用后者，避免帧外命中、下一帧清理时漏记。读取历史 frame 不会混入未来死亡。结束采集时还需关闭最后一次 think 到对局结束的区间；生成脚本会输出最终状态投影，未再调用 planner。

## 每条归因记录

- 身份、目录造价、坐标、陆块/海域、甲板/船舱/驻守及载体。ID 为 `land:${label}`、`sea:${label}`，label 直接来自同一 `terrain.groundWholeAt`；不可行走点为 unknown，不造虚构陆块。连接块只描述地形，不把建筑阻挡重新编号。
- 击杀者、来源种类与置信来源、致死 damage profile、最近 15 秒按来源与 profile 汇总的实际扣血。`present:false` 表示来源实体已消失，原生合成来源的 kind 可能是占位值；击杀者能从先前已见身份恢复时明确标明，否则保留 unresolved。
- 当前任务及其他候选、阶段和推断到岗情况。实际位置不被 claim 的 arrived 替代；rally/guard/leash 的同一矿口统一为同一个推断目标，避免把战术收队算成战略换目标。显式 ferry 乘员、进攻成员、扩张成员与清营成员均可保留候选证据。
- 致死命中时的订单、与其匹配的实际下令记录，以及最后下发的命令。排队/瞬时命令不冒充当前订单；自动接敌没有匹配记录时执行器未知。最多保留最近 64 条单位订单供匹配。
- 最近 15 秒血量轨迹（think、伤害前后和移除，最多 128 点）、撤退/治疗、局部有效战力比、650 矿口范围、近期目标切换和 worn 撤销。击杀前后即生成又消失的单位也由原生边界捕获，不依赖两次 snapshot 的 diff。
- 共享 `DeathAttributionContext` 保存 provenance、候选 commitments 和证据；旧任务不会被转换成正式 allocator 的承诺。血量和局部战力是处境证据，不证明某个换令导致了死亡。

沉船乘员单独记录，继承沉船击杀者与致死 profile，不捏造乘员受到的直接命中。存活召唤物到期、脚本退场和投降单列；到期帧被杀的召唤物仍是实际死亡，但原生 `unitsLost` 因先处理到期而不增加，两个计数均保留。

## 分类口径 v1

分类函数独立于策略，既不向 AI 提供评分，也不下命令。每条只有一个主类别，按下表顺序取第一个；标签可重叠，所以标签计数不能相加。正常、异常与生命周期三组可相加；金额为单位目录价，未加装备、招募附加费，也不是实际支付成本。

| 类别 | 可复查证据 |
| --- | --- |
| friendly-source | 己方/盟友来源致死，包括碰撞与沉船 |
| out-of-bounds | 实际超过当前防守基地中心 650 |
| post-worn-abandonment | 原进攻波次 45 秒内以 worn 撤销，永久单位仍在敌方火力附近死亡 |
| recent-reassignment | 死前 10 秒内两个非空推断目标发生变化；只报告时间关联 |
| retreat-or-treatment | 撤退/保护任务，或撤退、医疗执行器的移动/等待处境 |
| logistics-transit | 行军、跑腿、登船或运输中死亡 |
| neutral-outside-clearing | 野怪击杀且当前推断任务不是清营 |
| isolated-without-evacuation-plan | 与当前本土厅不同陆块，无健康完工己方据点，也无记录的撤离任务 |
| exposed-worker | 工人在经济/建设/撤离中死亡 |
| idle | 没有可归因目标且致死命中时实际 idle/hold |
| outmatched | 半径 900 内有效战力比低于 0.6 |
| unattributed | 来源/任务或局部战力证据不足，不能推断为正常交战 |
| accepted-engagement | 可归因战斗任务、局部比值至少 0.6，且未触发异常诊断；**仅推断正常** |
| summon-expired / script-exit / forfeit | 生命周期/行政事件，单独统计 |

0.6 只是可重复的基线诊断线，后续应由目标记录的可接受交战范围替换。局部战力复用有效战力估计，不模拟整场战斗，也不证明远处援军能及时抵达。孤立诊断没有计算撤离路线；`escapeRoute:'not-evaluated'`，不能解释成“所有撤离路线都不可行”。缺正式任务、首次观察之前的订单和看不见的致死来源都保持未知。

## 基线与验收

生成命令：`tsx scripts/ai-death-ledger-baseline.ts <source-tree> <case.json> <output-dir> <control|observe>`。所有地图从正常初始局面运行 18,000 ticks（15 分钟），正常席位数、相同 think 间隔与命令延时；不评胜率。每图同机依次 A/B/B/A，A 是只读层前的 main，B 开启账本与计划链。固定保存完整 planner entries、实际交付流、逐分钟校验和、末态 canonical/snapshot/memory 哈希。

每个 `B1` 目录包括 `initial.json`、`worlds.jsonl.gz`、`traces.jsonl.gz`、`deaths.jsonl.gz`、`planned.jsonl.gz`、`commands.jsonl.gz`、`timings.jsonl.gz`、`checksums.jsonl.gz`、`final.json`、`summary.json`。worlds 在每个 think tick 只保存一次全体位置/血量/订单与建筑状态；traces 按席位保存，末尾有结束投影；deaths 是全部记录。完整统计、所有异常明细和每条证据均保留在 A100 包中，便于后续迁移逐单位比较。
