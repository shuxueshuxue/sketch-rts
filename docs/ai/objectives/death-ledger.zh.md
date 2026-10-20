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

## 分类口径 v2

先判交战，再给主分类。交战需同时满足：附近有交战对手，并且本单位在保存的 15 秒窗口内实际受过对手阵营伤害或输出过伤害。附近半径为 900；原生致死时战力 ID 提供在场证据，worlds 只补身份，不用事后位置。活着的击杀者在原生致死事件中的位置补足隔岸舰船等跨地形威胁，不把已死亡来源的旧坐标当作当前在场。塔本身不充当“附近战斗单位”；明确清营时野怪才是交战对手，其余野怪伤害不能冒充与附近玩家军队的交战。沉船乘员继承船体证据。

| 主层 | 判定 | 主类别与子标签 |
| --- | --- | --- |
| 战损 normal | 已确认交战，未触发下列结构性诊断 | 主类别 combat-loss；保留 retreat-failed、outmatched、accepted-engagement 等子标签 |
| 存疑 suspicious | 已确认交战，出现结构性诊断 | recent-reassignment、out-of-bounds、post-worn-abandonment；按此顺序取主类别，其他标签保留 |
| 异常 abnormal | 确认交战之外，存在任务/处境诊断 | friendly-source、neutral-outside-clearing、logistics-transit、idle、isolated-without-evacuation-plan、exposed-worker；按此顺序取主类别 |
| 未知 unattributed | 交战证据不足，或交战外没有足够诊断 | 独立列，不并入前三层 |
| 生命周期 lifecycle | 存活到期、脚本退场或行政移除 | 仍独立列，不并入前三层 |

每条 `classification.v1` 原样保留旧完整分类，`classification.tags` 保留全部原标签，并在交战撤退死亡时追加 `retreat-failed`。旧 `retreat-or-treatment`、`outmatched` 等标签不再直接把战损判为异常。主分类和汇总为 `diagnosticVersion:2`，trace 账本为 `schemaVersion:2`；五个互斥统计桶可相加，子标签不可相加。

`classification.engagement` 保存窗口、附近对手 ID、收到/输出伤害、船体继承、证据来源和缺口。v1 没有完整输出伤害事件，离线重分类的 `dealtDamage` 始终为 null。若只知附近有敌军、只记录到非对手伤害且缺输出证据，保持未知；不把“没记到输出”说成“没有输出”。新在线观测记录实际对单位输出的伤害作为正证据，未记录到输出时也不冒充完整零输出。

### v2 同一原始数据的重分类基线

本次没有创建或推进模拟，没有重跑对局。343 次实际死亡、205 次存活到期保持原样；原始观测、v1 分类及非账本 trace 逐条相同，所有原始命令/世界/记忆哈希不变。v1 的 329 次“异常”重新分为：正常 152、存疑 75、异常 73、未知 29；原 14 次正常仍为正常。

| 主层 | 数量 | 单位目录金 |
| --- | ---: | ---: |
| 战损（正常） | 166 | 16,675 |
| 存疑 | 75 | 7,260 |
| 异常 | 73 | 7,745 |
| 未知（单列） | 29 | 2,935 |
| 生命周期（单列） | 205 | 0 |

75 次存疑中，61 次主类为 recent-reassignment、14 次为 out-of-bounds，post-worn-abandonment 为 0（该分支由脚本测试覆盖）。73 次确认的交战外异常均为 neutral-outside-clearing；其他交战外类别在这批数据中没有主分类记录。29 次未知均缺少足以确认与附近玩家部队交战的历史输出证据，不是漏记死亡或不知道击杀者。

| 地图 | 正常 数/金 | 存疑 数/金 | 异常 数/金 | 未知 数/金 | 存活到期 |
| --- | ---: | ---: | ---: | ---: | ---: |
| brokenSea | 33/3165 | 0/0 | 3/360 | 8/350 | 6 |
| greystonePass | 1/120 | 0/0 | 2/215 | 1/115 | 0 |
| gullIsland | 5/585 | 0/0 | 5/510 | 11/1320 | 0 |
| pineshade | 11/1435 | 11/1545 | 4/450 | 2/210 | 0 |
| reedwater | 29/3775 | 7/825 | 4/450 | 4/510 | 0 |
| ringwater | 14/1425 | 5/350 | 8/885 | 0/0 | 31 |
| sapphireArchipelago | 18/2960 | 2/175 | 3/340 | 0/0 | 38 |
| templeSpring | 10/685 | 19/1690 | 16/1425 | 1/190 | 28 |
| turtleLake | 27/630 | 29/2445 | 4/410 | 1/120 | 69 |
| twoShores | 16/1685 | 2/230 | 16/1690 | 1/120 | 33 |
| veiledHill | 2/210 | 0/0 | 8/1010 | 0/0 | 0 |

各层按 tick 排序的前三例（完整订单、击杀者、血量和证据在包内）：

| 层 | 地图 / tick | 单位 | 目录金 | 证据摘要 |
| --- | --- | --- | ---: | --- |
| 战损（正常） | greystonePass / 8297 | unit-p0-emberRavager-1070 | 120 | 交战撤退失败，保留 retreat-failed/outmatched |
| 战损（正常） | brokenSea / 9438 | unit-p2-worker-1 | 75 | 敌军交战中死亡，保留 exposed-worker |
| 战损（正常） | brokenSea / 9608 | unit-p0-worker-1 | 75 | 敌军交战中死亡，保留 exposed-worker |
| 存疑 | turtleLake / 10086 | unit-p2-spirit-5777 | 0 | recent-reassignment；时间关联不证明致死原因 |
| 存疑 | turtleLake / 10108 | unit-p2-spirit-6202 | 0 | recent-reassignment；时间关联不证明致死原因 |
| 存疑 | reedwater / 10942 | unit-p1-lancer-1568 | 110 | recent-reassignment；时间关联不证明致死原因 |
| 异常 | turtleLake / 3013 | unit-p2-footman-1073 | 100 | 非清营任务被野怪击杀，未确认附近交战对手 |
| 异常 | veiledHill / 3202 | unit-p0-emberRavager-1067 | 120 | 非清营任务被野怪击杀，未确认附近交战对手 |
| 异常 | veiledHill / 3234 | unit-p0-emberRavager-1049 | 120 | 非清营任务被野怪击杀，未确认附近交战对手 |
| 未知（单列） | greystonePass / 6853 | unit-p1-archer-1697 | 115 | 附近有敌军，仅有非对手伤害，历史输出未记录 |
| 未知（单列） | reedwater / 9844 | unit-p0-priest-1736 | 135 | 附近有敌军，仅有非对手伤害，历史输出未记录 |
| 未知（单列） | reedwater / 9946 | unit-p0-priest-1691 | 135 | 附近有敌军，仅有非对手伤害，历史输出未记录 |

这条交战定义同样适用于工人：工人在敌军交战中被杀时归战损，原 exposed-worker 和建造/跑腿任务证据保留，不能只看“正常”就丢掉经济单位损失。

[新 v2 证据指针](death-ledger-v2.evidence.json) 包含全部重分类记录、每图/每席位新汇总、v1→v2 转移表、逐层示例和独立校验器。原始 v1 包保持不动：[原始证据指针](death-ledger-baseline.evidence.json)。复算命令：

```sh
tsx scripts/ai-death-ledger-reclassify.ts <source-tree> <v1-root> <new-output> <classification-sha> <source-evidence-sha>
```

各图 receipt 的 `source` 与 `simulationSource` 仍指原模拟版本，`classificationSource` 指此次分类源码，不把离线复算说成重跑对局。双岸 v2 的 initial/final/worlds/建筑损失逐字节保留，final tick 为 18000；source 仍 bf9a472b，classificationSource 为 4407d152。26 项死亡/分类/公开观测测试、17 项计划链/包边界测试及 TypeScript 检查通过。下方 ABBA 和全量测试是原观测 v1 的验证记录，此次不冒充重新测量。

## v1 历史口径（不再作为主分类）

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

## 原始观测基线与验收（v1 历史记录）

生成命令：`tsx scripts/ai-death-ledger-baseline.ts <source-tree> <case.json> <output-dir> <control|observe>`。所有地图从正常初始局面运行 18,000 ticks（15 分钟），正常席位数、相同 think 间隔与命令延时；不评胜率。每图同机依次 A/B/B/A，A 是只读层前的 main，B 开启账本与计划链。固定保存完整 planner entries、实际交付流、逐分钟校验和、末态 canonical/snapshot/memory 哈希。

最终采集目录包括 `initial.json`、`worlds.jsonl.gz`、`traces.jsonl.gz`、`deaths.jsonl.gz`、`planned.jsonl.gz`、`commands.jsonl.gz`、`timings.jsonl.gz`、`checksums.jsonl.gz`、`final.json`、`summary.json`。worlds 在每个 think tick 只保存一次全体位置/血量/订单与建筑状态；traces 按席位保存，末尾有结束投影；deaths 是全部记录。完整统计、所有异常明细和每条证据均保留在 A100 包中，便于后续迁移逐单位比较。


### 11 图原始 v1 结果（2026-10-20）

正常初始局面的 36 个房间 AI 席位各运行 15 分钟。共记录 548 条：实际死亡 343、存活召唤物到期 205；推断正常 14、异常诊断 329，异常单位目录价合计 34,495 金。实际死亡逐席位与原生 `unitsLost` 对账一致，击杀者均可还原；包含 11 艘船和 3 名沉船乘员。全部记录在增量 trace 中恰好出现一次，终帧汇总与每局 summary 一致，无订阅错误。

| 地图 | 死亡/原生计数 | 存活到期 | 推断正常 | 异常诊断 | 异常目录金 | 建筑损失 |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| brokenSea | 44/44 | 6 | 0 | 44 | 3875 | 6 |
| greystonePass | 4/4 | 0 | 0 | 4 | 450 | 2 |
| gullIsland | 21/21 | 0 | 0 | 21 | 2415 | 2 |
| pineshade | 28/28 | 0 | 0 | 28 | 3640 | 3 |
| reedwater | 44/44 | 0 | 1 | 43 | 5440 | 7 |
| ringwater | 27/27 | 31 | 0 | 27 | 2660 | 2 |
| sapphireArchipelago | 23/23 | 38 | 1 | 22 | 3475 | 1 |
| templeSpring | 46/46 | 28 | 2 | 44 | 3990 | 4 |
| turtleLake | 61/61 | 69 | 8 | 53 | 3605 | 6 |
| twoShores | 35/35 | 33 | 2 | 33 | 3725 | 2 |
| veiledHill | 10/10 | 0 | 0 | 10 | 1220 | 0 |

| 异常主类别 | 数量 | 目录金 |
| --- | ---: | ---: |
| retreat-or-treatment | 142 | 18215 |
| recent-reassignment | 50 | 4270 |
| neutral-outside-clearing | 37 | 3080 |
| out-of-bounds | 35 | 4120 |
| logistics-transit | 26 | 2825 |
| unattributed | 14 | 350 |
| isolated-without-evacuation-plan | 12 | 760 |
| outmatched | 12 | 635 |
| idle | 1 | 240 |

这 329 条是 v1 诊断命中，不等于 329 个已证实的策略错误。缺少正式效用与许可战力范围时，撤退、越界和近期换目标只能提供可复查的线索，不能单独证明换令致死。后续比较必须保持诊断版本一致，或用同一版规则重算双方原始记录。`analysis/abnormal-deaths.jsonl.gz` 为每条异常保存地图、tick、席位、单位、任务、实际订单/执行器、来源、战力及中文说明和完整记录。

### 只读与耗时

11 图按 A/B/B/A 完整运行，共 44 局；A 为 main `276e5d29`，B 为 `8d2e9f21`。完整 planner entries、实际命令流、末态 snapshot/memory/canonical 五项 SHA-256 逐项一致，最终和逐分钟模拟校验和也一致。最终导出再次与四臂核对：9 图用 `bf9a472b`（`final/<map>/B3`）；碎海、蓝宝群岛用 `b7b203a3`（`final-sinking/<map>/B4`），修正沉船乘员继承船体沉没前的战力，不使用清理后为零的己方战力。其余地图没有乘员沉船事件，因此输出不受该修正影响。

think ABBA 独立使用真实 15 分钟帧：双岸 188 单位、蓝宝群岛 214 单位，分别按 4/6 个席位逐个执行原 planner，然后把账本和 trace 的同步成本计入该次 think。每臂热身 80 轮、采样 240 轮；每轮重置原 memory，不强制 GC，JSON 输出在计时外。A1+A2 与 B1+B2 的每次 think 合并统计如下，机器为 A100 / Node v22.23.3。

| 场景 | A p95 / max (ms) | B p95 / max (ms) | p95 / max 增幅 |
| --- | --- | --- | --- |
| 双岸 188 单位 | 37.576 / 49.696 | 38.705 / 50.568 | +3.00% / +1.75% |
| 蓝宝群岛 214 单位 | 26.759 / 37.620 | 27.351 / 38.016 | +2.21% / +1.05% |

四臂命令与 memory 哈希一致，前后模拟校验和不变。耗时取最终 `bf9a472b`，最后的沉船回调修正不进入这些静态 think 帧。初版蓝宝 max 曾增加 49.5%；改为原地裁剪、合并同 tick 同来源同血量点后，重跑得到表中结果。两轮原始数据均保留，不能把初版失败藏入最终通过结果。

### 验证与证据

A100 完整 `vitest run --dir src`：7,792/7,793 通过（`bf9a472b`）。唯一失败为 think-worker 启动超时；同机 main 对照和候选各单跑均为 3/4、同一失败，本机 Node 24 单跑 4/4。此处只陈述对照结果，不推定具体根因。最后的沉船修正后，账本 12 项与 sim 公开观测 6 项全过，TypeScript 检查通过。canonical/固定命令流、地形标签、计划链测试与原防守四个快照场景通过；生产 build 通过。

[完整证据指针](death-ledger-baseline.evidence.json) 对应 A100 内容寻址包；用 `bin/sketch evidence get docs/ai/objectives/death-ledger-baseline.evidence.json` 取回。包内 `README.zh.md` 说明来源与复跑方法，`analysis/summary.json` 含逐图/逐席位汇总，`SHA256SUMS` 覆盖全部成员。`ui-twoShores` 为 Codex 27 已接入的 0–15 分钟样本：4804 traces、35 阵亡、33 存活到期、2 个按真实清理边界记录的建筑损失；对照是 `twoShores/A1/summary.json`。
