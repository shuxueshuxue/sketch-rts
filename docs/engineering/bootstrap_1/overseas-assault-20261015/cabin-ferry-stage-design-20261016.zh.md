# 先统一实际装载名单，再贯通船舱运输

建议下一独立候选将**同一目标的装载名单、真实入舱和真实卸岸**作为一个 ferry 任务实现。先修正装船与接兵不使用远征名单的脱节，再让该名单按“步行兵上船并入舱、甲板专用兵后装”的顺序执行。不能只给当前乘员增加一条 `enterCabin`，也不能将舱内乘员从容量或登陆检查中删掉。

本报告是只读设计；没有修改生产代码、冻结树、原存档、driver 或封包，没有导入游戏代码、执行 planner query、native step、测试或新比赛。运行时基线为 `ade412414d9232206f39e20f0182f0086605433c`。读取时根文档 HEAD 为 `b9c076b6232de7b08f12644334d399e4614d4b86`；所读 26 个源码文件逐字节等于 ade Git blob。现成 query 的 `assaultExpedition` 函数来自未合的 `078026`，该函数源码与 ade 严格相同；两个完整 planner 不因此等价。规则 2、冻结 184、原 1.4 门槛及正常对手均不改变。原故障容器未提交修改的恢复缺口仍未补齐。

## 已有实际证据及其范围

输入为未合 `078026` 实际续局的 194400 完整 world / nextId / 三方记忆，压缩文件 SHA256 `adc4d993ac6a25d2151fe077a67e69175372ba0c6caf904dce9855db853e505e`。现船为 carrier 25442，甲板有 3 台 siegeRam、5 summoner、3 emberRavager。后八人均支持入舱，各用 2 额度，总计 16/21；三台机械不支持入舱。这不是 fresh 0、ade 自动策略或胜局。

| 已封分支 | 正常三方 AI 之外唯一追加操作 | 实际结果 | 未证明的事项 |
| --- | --- | --- | --- |
| 194400→195000，600 tick | 一次公开 enter 八人 | 40241 于 194401 实际入舱；另七人排队。194610 原进度超时转 return，194611 十个 open crew 实际卸岸；40241 仍 inside | 一条 enter 不能自动贯通装载，也不能靠原 unload 出舱 |
| 194400→194610，210 tick | 依次公开卸三台 ram，再 enter 同八人 | 八人于 194403、418、432、452、474、495、517、557 实际入舱。正常 naval 于 194415 给 34834 board，194430 实际重新登船。末态仅九 cargo：八 inside 加 34834，load 3073；另两 ram 在岸上，均 420HP | 非全部原军装满；末态 memory 仍 loading，不能称已完成出征；不能唯一归因某一台 ram 的某一个阻塞点 |
| 195000→195030，30 tick | 一次公开 leave 40241 | 195000 当帧真正回到门口甲板；正常 naval 195015 发 unload，195016 真正上岸，HP95，船空 | 未验证自动出舱，也未验证同帧多人 leave/unload |

三分支分别 708、246、28 条 SDK trace，原生 hit 均为 0，无新增永久死亡。SDK `afterApply` 对 transient no-op 也记日志，因此意图数不等于成功次数。首次 metadata 错误的 driver 在 0 native step 时退出，原日志保留；修订重试是另一次同输入恢复，不能覆盖该失败。194595→194625 的 30 tick 冷恢复另严格闭合 2 个 pre-think、最终 world/id/三 mem、33 trace、0 hit、16 events；它继承人工 enter，不是自动策略成绩。

封包保持原样：`/workspace/.playtest/bootstrap-cabin-capability-ade-20261016-evidence.tar.gz`，11,355,683 B，SHA256 `517e4f8f2f20568f285ed16f964c33ed2f48a5b976b8a23178c741dd61b799c9`。封包作者核过 178 payload+INDEX；本设计重新读取压缩包 bytes/SHA 和所用小记录，没有重复解包或重跑。客户端三张已存图已亲看；隐藏 inside 的身份、数量以实际 cabin-events 和完整帧为准。

## 原远征名单与当前载荷确实不同

现成 `actual-loading-packing-counterfactual.json` 的 194400 同输入 query：required=20.115569375546702，选中 28 人、战力 21.548189175497683、质量 5057。其岸上成员分成四个已经过 `sameGround` 的组，而不是一支现成岸边军队：

| 已有组锚点 | 选中数 | 质量 | 战力 | 身份概要 |
| --- | ---: | ---: | ---: | --- |
| 船上 25442 | 8 | 873 | 6.375518456350105 | 现有三 ravager、五 summoner |
| A: (3472,2416) | 1 | 121 | 0.8659545396598206 | ravager 1180，当前位置就是该组锚点 |
| B: (7914.747809,2570.300072) | 4 | 357 | 3.199995983259555 | priest 3174、summoner 4085、ashHexer 4268/4420 |
| C: (6888.861609,4154.279828) | 2 | 204 | 1.2 | summoner 7246/8114 |
| D: (7168.393601,6568.383371) | 13 | 3502 | 9.9067201962282 | 六 summoner、五 ravager、一 ashHexer，加 siegeRam 12085 |

完整单位 ID、实际坐标、HP、订单、质量与分组原值保存在旁边 `evidence-and-source-audit.json`。ram 12085 当前位置 `(7102.243840091826,6758.242022686798)`、420HP、idle，属于 D 组。当前另三台 ram 24816/34834/39936 全在 25442 甲板，均不在这份 28 人名单里。其实际 deck 点分别约 `(-3.84,.04)`、`(78.16,10.04)`、`(-49.84,-35.96)`，不能给它们虚构岸上岛屿归属。

这些组名仅为报告标签，不是地图官方岛编号。原 query 没存每人的选定 shore、陆路、到岸 ETA 或实际身体可通行证明；本次遵照不新 query 的范围，**不能声称 D 组、12085 或其他所有选中人均可走到某个指定装船点**。下一实现须先用已有 `coastOnWater → walkableGoal → routeArrivals` 获取当前 shore 的有限地形路程，仍由真实 native boarding 验证建筑、身体和动态会船。`sameGround`、地形预计时间、native 真正登船分别记账，不能互相替代。

质量断裂是确定的：当前 11 cargo 已有质量 7473、战力 11.055814645032301；将它们与原 28 名单去重并集为 31 人，质量 **11657**，超过此船 capacity **9060.480000000001**，超出 **2596.5199999999986**。入舱只释放甲板平面，仍计真实载重，不能让这个并集变得可载。即使只取原 28 人，旧几何 query 的 empty-deck packing 仍为 false；该记录不是入舱顺序搜索，也没有穷举所有组合。不能用“5057 小于质量上限”宣称单船已能装下。

代码来源明确：

- `src/ai/policy/naval.ts:1009` 的 `assaultExpedition` 按全图 rating/mass 取够 1.4 required，未分配具体船或合法 pickup。它是选军见证，不能当作装载承诺。
- 同文件 `:844` 的本岸 soldiers 经 `orderCrew` 装船；bootstrap 的 `riderFerryCrew` 在 `src/ai/bootstrap_1/rider-crossing.ts:23` 只对 creep 筛 rider，assault 仅按到当前 shore 的 `routeArrivals` 排序，没有使用 expedition roster。
- `naval.ts:919` 跨岛 pickup 使用 `troopAvailable`、单人 `convoyCanCarry`、无敌源岛和实际海路，仍未筛 expedition roster；只改 `orderCrew` 会漏掉这里。
- `troopAvailable` 另在 `naval.ts:590` 给已登陆军作战使用。因此不能把全局 roster Set 塞进这个回调，误删不在选军见证中的已登陆战士。
- source 选择 `naval.ts:696` 还按岛上非工人总质量/readiness 排名，未按实际目标名单；新模式至少应按名单中可用的源岛候选建立 source，不能先挑一个只有未选 ram 的岛再空等。

## 最小接口与实现切口

建议只有一个显式 opt-in，沿现有 assignment 接口传入；不引入回调注册架构、历史名字转换或 main 兼容层：

```ts
// src/ai/policy/naval.ts — 设计提案，尚未实现
type NavalAssignments = {
  // 现有成员保持
  assaultCargo?: 'cabin';
};
```

仅 `src/ai/bootstrap_1/expedition-recovery.ts:72` 的调用传 `assaultCargo: 'cabin'`。普通 `planNavalTactics`、冻结执行树、未传该选项的调用继续当前行为。新模式只控制真实 assault ferry 及它的 return/drain 生命周期；初版不扩到经济、医疗接送、creep 或所有海军 owner。

在 shared `ferryCommands` 解析其**实际 mission.targetId 对应的敌目标**后，计算同目标 `assaultExpedition` 见证及已有可用性限制。用这个名单一致地筛三处：初建任务的 source、本岸 soldiers、后续跨岛 pickup。当前军医/护工/矿防/其他 ferry/service/mounted 的原有排除继续适用。原 ready 只是理论能力：名单中单位被既定任务占用、无 shore 路或实际 packing 失败，都应留为没有装好的军力，不能计进实际 assembled。

不要每次按战力排序就强制倒腾全部已载老兵。已载者仍是实际 cargo，其兵力按原公式计入真实出发/登陆评估；若与选定见证冲突且不能载下，必须提出明确的当前合法源岸重排方案。只有实际公开卸岸后才能扣其载重并释放该成员，不能直接改 deck/HP/owner 或在 shadow 中删除后当作世界已变。原 28 并不是必须无条件保留的永久名单，伤亡、任务冲突和合法目标变化需要重审，但不能靠反复换名单/换 pickup 刷新 physical progress。

最低层新增一个具体 helper，例如 `src/ai/policy/ferry-cabin.ts`，由 shared ferry 和 bootstrap beach 共同使用，不反向 import bootstrap。它提供当前 cargo 分视图和**按序公开卸载的投影**；所有 native 资格、quota、质量、甲板和 landing 规则来自现有函数。不要给 `convoyCanCarry` 加“未来已经入舱”的乐观分支：它已正确处理真正 inside 的平面释放，而仍保留其质量。

最小状态仍挂现有 `memory.naval.ferries[boat.id]`，沿用 phase loading/sailing/return、from/pickup/to 和 crewIds；只新增有限子阶段，例如：

```ts
cabinLoad?: { stage: 'clear' | 'walkers' | 'stow' | 'deck' | 'drain' };
```

`crewIds` 在该 opt-in 中表示**此船当前已实际认领的装载队列**，而不是全图 28 人自动归此船。只有当前 shore 可用、有路、未被其他任务占用且有真实预算的子集才加入。该模式需调整 `naval.ts:817` 的 attached-only prune：本任务合法重排后正在岸边等待的成员不应被立即删掉；又不得无条件保留已死亡、变 owner、被更高既定任务接管、没有此岸可行路线的成员。原默认模式 prune 保持。不要另造与 crewIds 重复的一套永久全图 roster。

原 `crewIds` 对其他 ferries、`expeditionDeparture`、rider busy 和 `navalUnitIds` 的现有认领机制继续承担排他性；新模式起航不能在仍有 inside 或待实际卸岸成员时盲目清掉所需认领。真实 landing 后释放成员给现有 landed combat/医疗，而不是以排队阶段锁死岸军。更高任务导致中断时走现有取消/返程路径，保留实际船上身体的归属，不新增 TTL。

## 一条完整装载及卸岸链

| 子阶段 | 此 owner 可发布的动作 | 允许推进的真实条件 |
| --- | --- | --- |
| clear | 在原合法源岸按当前身体公开 portrait unload 阻门的 deck-only 乘员；已卸成员暂由本任务保留，禁止立即重新 board | 后续 snapshot 确实离船；没有合法源岸则不清空重排 |
| walkers | 按同 target、同岸有路、当前可用队列请求真实 board；一次装不下则分批 | 后续 snapshot 真正 `deck.shipId` 是本船；order board 或 afterApply 不算已登船 |
| stow | 对真甲板、native eligible、没有既定排队冲突的选择发布 enter；额度同时保留 actual inside 与本任务 pending enter，不让多次命令各自过订 | 真正 `isInCabin` 才释放甲板平面；不在 stow 时重新装阻门机械。不得以发 enter 或命令 idle 推进 |
| deck | 只在该批步行乘员已实际 stow 后，按原真实 mass/floor packing 请求名单内 deck-only 身体；额外不入舱的步行者也需留门路 | 实际 boarding 完成；所有 inside 继续计质量；能否继续 pickup/出发仍用原 assembled、required、原护卫和原安全条件 |
| sailing / drain | 现有 explicit approach 到位、现有 whole-body 与联合登陆安全成立后，按下述同序投影清 open，再逐人 leave→portrait unload；return 也必须有 egress | 后续真实 snapshot 全部所需 cargo 已离船，才结束 drain/释放 hull；inside 永不算 landed |

每次只对**当前合法可走通的批次**承诺状态推进，不提前模拟整个多岛征兵世界。若 cabin cap 不够、door 静态不连通、native cabin 不可用、机械占门未能合法卸出或真实 mass 超限，就没有“未来舱位”。保持已有失败/取消规则，不降低原 required 来让船出发。

现有 `progress` 只记录 hull 坐标/heading、phase、乘员 ID，见 `naval.ts:716`。因此实际 enter 不改 aboard ID，194401 的入舱未算进度。新模式应将**本任务永久成员的实际 deck→inside / inside→deck / offdeck 变化**纳入同一 physical-progress 记录；若记录甲板走路，使用真实 local deck 位移及原 32 距离门限，不能按发布 enter、子阶段变化、重新指定 pickup、临时 spirit 出生或 donor 空意图刷新。40 秒 stale、20 秒 retry 及原有真实护送/联合出发条件保持；首次真实入舱只能更新实际进度，不保证其余七人可通行。

## 出舱、登陆投影与公开命令必须一致

`src/ai/bootstrap_1/assault-beach.ts:18` 的 `assaultBeachBodies` 现有 shadow 是正确起点，但 `:27` 遇到任何 inside 返回 undefined。既不能删掉这项判断后原样算甲板 landing，也不能过滤 inside 假称整队可部署。

应由同一个纯 helper 输出顺序及 projected bodies，在每艘船、每个候选 pose 上：

1. 保留真实单位数组顺序，克隆船和所有将改动的乘员；不在 live snapshot 上调用任何变更 helper，不复用 live 的位置索引。
2. 令 shadow 船的 pose、heading、helm order 与最终实际发出的命令相符。native `landingSpot` 在 unload order 下按其指定岸点并限制 ground；idle/move 时会按 index/count 选方向，不能只在 shadow 假造 unload。
3. 先逐个对 open crew 调 `passengerLandingSpot`，验证同 target ground，替换为真正占位的岸上 shadow body。每次更改乘员集合后重新计算下一人的 index/count。
4. 对每位 inside 先在更新后的 shadow 上求 `cabinExitPoint`，按 native leave 的实际门口 deck/world 坐标放回甲板，再求 `passengerLandingSpot`，并将该人替换为岸上 shadow body。任一环节不成立就没有完整序列证明。
5. 以原 `assaultBeachExposure` 和现有跨舰 joint shadow 检查全部 projected bodies，仍保留原停船/速度、全岛门槛与岸防规则。在完整安全投影成立前不承诺半队先落。
6. 真正发布与投影**一一对应**的 open portrait unload、`leaveCabin([id]) → unloadPassenger(id)` 逐人序列；不要一次批量 leave 八人再考虑被第一人占住的门。

现有 frame apply 支持同帧逐人序列：`src/shared/sim/frame.ts:18` 逐条立即执行，并在每条之前读 live game 重新检查；native leave 当帧清 cabin、放门口、idle/清 queue，随后 portrait unload 当帧能真实卸岸。批次 runtime 的 apply 预检放行 transient，随后实际检查仍可能 no-op；`admit()` 则拒绝当下 transient，不能误走该入口。normalize 不重排 cabin/unload。上述结论经过另一只读审查者独立确认，但**本批没有实际跑新的同帧多人序列**，应在候选里用 native 证伪。

当前输入已经是标准化 deck 形态。不要在浅 shadow 上调用旧 `restoreCargoDecks`：该迁移会删 cargo、追加单位、改订单、可能扩大 deckScale 并 sync 全船。`passengerLandingSpot` 优先读旧 cargo；最小候选沿真实已恢复输入实现，不添加旧存档兼容分支。leave/portrait 原生本身不强制停船，停船是原有策略安全门槛，不能因命令可执行就删除它。

public hull unload 仍可能在途中 incidental shore 自动卸掉 open crew。cabin 模式应沿已有 selected-beach 的 explicit move/current-pose 入口，在**实际完整部署姿态**成立时开始 drain；否则不能宣称整队仍在船上。return/cancel 同样要真实开门卸岸，不能在剩 inside 时删除 ferry、把船交给修理/另一个任务。

## 既有 owner/publisher 的准确接线

`navalUnitIds` 已认领所有 deck（包括 inside）、native board 和 mission.crewIds；不能据此认为完整发布链已保护完毕。`src/ai/policy/script-runner.ts:93` 的 claims 过滤没有涵盖 stop、board、enter、leave、普通非 charge cast；其 moved reserve 也不覆盖 enter/leave。因此新增 enter 仍可能被后续 script 的 stop 或 walk-to-cast 改令。inside 自身多数动作会 native transient no-op，但这也会浪费规划并不能代替 owner 合同。

最窄 bootstrap 入口是 `src/ai/bootstrap_1/policy.ts:130` 的 `planBootstrapScriptEntries`：给它传入的**非 naval script.run** 包一层针对当前活跃 ferry 装载成员/目标 hull 的命令 operand 过滤，读取先前 naval 当帧刚写出的 memory。过滤发生在 `recordAiMemoryForCommands` 之前，保留混合命令中的其他单位与完全无关的购买/宏观命令；不在最后 entries 上事后删令并留下虚假命令 claim，不改共享 runner 的默认行为，不合入未合 a90c stop 修复。

该过滤须处理所有本任务 actor 的 unitIds/unitId 形态，尤其 stop、board、非 charge cast、items；对目标是同一正在装舱 hull 的无关 board、目标是 inside 的无效治疗也按这一明确任务范围处理，不能全局禁用医师或技能。已在更高医疗/service/mounted 任务的单位应在选入前排除，而不是进入 cargo plan 后抢走。`medicalRecovery` 的 patient/healer 查询本来就要求 `!deck`，不能将它说成现有 inside 施法的原因。

同一 naval owner 内部也需处理：`src/ai/bootstrap_1/expedition-recovery.ts:84` 给 `planLandedCombat` 的 unavailable 集合应加入当前 staging crew 与此 think 的 enter/leave/discharge actor；其局部护理/ports/departure 合成也须尊重该阶段，避免对本任务刚卸到源岸的机械立刻攻击/护理/重上。真正完成卸岸的部队立即交回原 landed combat/恢复判断。`combatDeckRecovery` 已排除有 ferry 的 hull 与 inside；最终复核仍需证明不破坏新的公开序列顺序，不能靠广泛重排所有 script 优先级解决。

## 下一候选如何被证伪

先做有实义的契约与局部 native 比较，不先开新矩阵：

- 同目标名单必须同时控制 source/本岸 loading/跨岛 pickup；默认无 opt-in、三条路线风格和无关已登陆兵输出保持。原 ram 不在计划时，必须能在真实日志中看见合法卸岸及其后质量变化，不能仅把 ID 从数组去掉。
- 仍用原 194400 完整输入可检验：机械不会提前重上，八人实际入舱而非只有 enter 订单；临时灵体/issued command 不刷进度；实际 cargo/mass/quota/HP/金币/owner 不人工改。该已开发存档只作因果诊断。
- 无舱、损坏舱、敌 boarder、满 quota、pending enter、体积超限、额外 holdMass、无 door 静态路、unsupported 骑乘/机械、真实 boarded/gangway 与混合命令边界都保留 native 拒绝语义；其他任务成员不被新认领。
- 同 frame 多人的 leave→portrait 必须逐条保存真实 before/after，证明出口被释放、所有 landing bodies 与投影一致；无合法 land/两船挤岸/guard 覆盖时不得计 landed 或提前释放 hull。一次 leave/一次 portrait no-op 不能让阶段“完成”。
- 实际装了多少、可战力是否达到原 required、是否真到了敌岛并持续参战分开记录。若只把八人藏进舱、仍无法汇集原 required 或 deployment 失败，候选未解决跨海进攻。
- 局部闭合后再由 root 固定源码、完整 source/frozen、正常三方 AI，从可核对完整存档至自然结局，随后才用普通 0 与另一个预声明未见样本检验泛化。完整胜也不能借给原 ade 或据此完成三路线验收。

本报告没有预先承诺二十八人单船装满，没有改全图选军/防御阈值或承诺新的普适分组算法。当前最紧要的未知仍是四个岸上组到实际岸点的可用任务/身体路线、选定队伍的真实装舱顺序与整队卸岸能力，以及修复对完整正常比赛的实际作用。

## 实施交接边界

下一实现应在新的独立 ade-base control，先固定最小 opt-in、名单三处接线、真实 cargo 分视图/子阶段及同序 discharge helper，再补 bootstrap publisher 的有限 owner 保护。这些是一个可完整验证的候选，不能只提交 enter 命令后称功能完成。当前 fa 的 coastal policy `af` 源及其三文件仍是另一固定实验；本报告没有修改、比较或整合它们。root 后续整合 shared naval 时应逐 hunk 保留其已经验证的目标/策略增量，不能用本报告的 ade 文件整份覆盖。

独立子审 `cabin_sequence_review` 只读确认了 frame 顺序、transient admission/apply 差别、原 cargo 迁移副作用和 shadow 订单一致性；没有运行 native 或测试。新的同帧多人顺序仍需要上述实际验证。复核脚本只读取封存 JSON、流和 Git blob；运行 `python /workspace/.playtest/cabin-ferry-stage-design-ade-20261016/audit-existing-records.py` 可重新提取同一事实，不能将其视为策略测试。
