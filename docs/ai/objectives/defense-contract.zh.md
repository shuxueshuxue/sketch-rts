# 防守模块契约与目标冲突观察

这份契约描述 **main `883f57c51838ed75057a2a2dc4fce5e16cdcfb4e` 的实际行为**，供“局势评估 → 效用选目标 → HTN/GOAP 分解 → 任务执行”设计使用。此 PR 只增加文档，不改变选兵、优先级、命令或测试。本轮从正常开局观察了 8 局至 15:00，逐 think 记录提议、仲裁后命令、记忆和实际位置；没有做胜率验收。

现在最缺的是任务之间的资源交接及前置条件失败后的计划链。已有 claim 能阻止很多直接抢兵，却不能回答“哪一个矿口更值得救”“要不要中断这次装船”“治疗撤走守兵后谁补位”。下面把模块已有的能力与规划器需要补上的子目标分开写。这里的“需要的子目标”是契约推导，**当前模块通常不会输出它们**，不是已经存在的规划功能。

## 共同语义与边界

一次 think 是 15 tick，即 0.75 秒；模拟每秒 20 tick，命令在规划后 3 tick 交付。文中时间均为游戏时间。`strengthOf` 是现有按造价、剩余生命、等级和兵种修正计算的强度，不能当成模拟战斗胜率。本文的射程、650/1000 等距离均为地图世界坐标。

持久归属在 `memory.unitClaims[unitId]`。`recordUnitTaskClaim` 只由通过仲裁的命令建立或更新任务租约，任务 TTL 为 3600 tick（180 秒）；普通命令租约通常为 900 tick。`activeUnitClaim` 会检查拥有者、TTL、放弃条件与目标存续；`expansionMission` 只表示施工护卫的成员关系，不算普通排他租约。`expansionMineId` 会跨局部命令保留，所以“当前去哪儿”和“属于哪个建设任务”不是同一个状态。[claims.ts：记录与期限](https://github.com/shuxueshuxue/sketch-rts/blob/883f57c5/src/ai/policy/claims.ts#L26)、[任务写入与成员保留](https://github.com/shuxueshuxue/sketch-rts/blob/883f57c5/src/ai/policy/claims.ts#L229)、[有效性查询](https://github.com/shuxueshuxue/sketch-rts/blob/883f57c5/src/ai/policy/claims.ts#L334)。

还有一套每帧的 `AiScript.claimsUnits` 预留：脚本列表靠前者先拿兵，然后每个脚本的实际命令再经过预留过滤和已下令单位过滤。`onCommands` 看到的是过滤后的命令；`afterPlan` 才收尾。这个仲裁比较执行顺序，不比较目标收益或损失。`redirects: 'local'` 保留防守任务，`strategic` 的实际命令会转移它。**同一个脚本内部的多个子任务并未因此获得独立仲裁**。[script-runner.ts：入口与执行](https://github.com/shuxueshuxue/sketch-rts/blob/883f57c5/src/ai/policy/script-runner.ts#L25)、[预留与命令过滤](https://github.com/shuxueshuxue/sketch-rts/blob/883f57c5/src/ai/policy/script-runner.ts#L91)、[局部/战略重定向](https://github.com/shuxueshuxue/sketch-rts/blob/883f57c5/src/ai/policy/claims.ts#L48)。

本土与岛屿的观察范围不对称：`readV6Intel` 的敌军只来自当前首个完工自有矿厅（无则首建筑）选出的 home 陆地连通块，而 `ownHalls` 和原始 `army` 可含其他连通块；`availableV6Army` 才再按当前 home 筛选可用军队，并去掉渡船 crew、raid、closeout、support、正在登船的兵。岛屿执行器另用 `readV6IntelAt(anchor)`。已有一座岛上矿厅不会自动扩大本土敌情模型。[intel.ts：局部视图](https://github.com/shuxueshuxue/sketch-rts/blob/883f57c5/src/ai/policy/v6/intel.ts#L70)、[本土视图与敌情](https://github.com/shuxueshuxue/sketch-rts/blob/883f57c5/src/ai/policy/v6/intel.ts#L89)、[可用兵](https://github.com/shuxueshuxue/sketch-rts/blob/883f57c5/src/ai/policy/v6/general.ts#L159)。规划动作必须带具体基地/连通块，不能把全图兵力直接承诺给一个矿口。

## 执行动作契约

### 1. `workerSafety`：撤离工人并恢复安全采矿

**职责与效果。** 对自有、未登船、未驻扎、未在执行登船的工人，防止远程威胁下一次射击继续命中；效果是“工人到达安全掩护点，若有安全矿则继续采，原矿安全后返回”。新撤离由射程大于 80 的敌方武器触发，已有撤离任务继续考虑所有武装威胁。危险范围使用实际物理/技能威胁在一个 think 内的可达范围，再加 160 余量；不依赖矿厅或塔已经被拆。[workerSafetyPlans，worker-safety.ts:53](https://github.com/shuxueshuxue/sketch-rts/blob/883f57c5/src/ai/bootstrap_1/worker-safety.ts#L53)。

**状态与资源。** claim kind 是 `workerSafety`，targetId 是工人自身；claim 的 `evacuation` 保存 origin、原 resourceId、shelter、可选 safeResourceId，无独立工人名单。每个危险工人独立分配，数量不设固定上限；不占军队、船或直接金币预算，占用撤离路程和采矿中断时间。只有实际被接受的命令才能绑定。[recordWorkerSafetyAcceptedCommands:102](https://github.com/shuxueshuxue/sketch-rts/blob/883f57c5/src/ai/bootstrap_1/worker-safety.ts#L102)。

**前置条件与分解。** 必须有已完工、至少半血的自有塔或矿厅，并有能真正走到其背面、终点安全的撤离路线。优先走路程最短的掩护点，再找健康矿厅附近未耗尽、未被盟友认领且路线安全的矿；没有安全矿则停在掩护点。如果连安全掩护点也没有，本模块返回空，不会请求造塔、护送、救援船或放弃建筑。规划器需要把这个失败转成“建立撤退通道/接应/运走工人”等子目标；不能把空命令解释为已经安全。[evacuation:28](https://github.com/shuxueshuxue/sketch-rts/blob/883f57c5/src/ai/bootstrap_1/worker-safety.ts#L28)。

**结束与交接。** 工人当前位置和原矿/原点都安全才解除，原矿仍有效且未被盟友认领时重新下采矿命令；死亡、目标消失、过期由 claim 清理处理。撤离由 `miningJobSafety` 的预留和命令钩子接入。它不评估矿厅是否值得救、不安排战斗小队，也不以“守军正在赶来”替代工人撤离。与建造、修塔、采矿重分配、海军招募工人有直接交接；海军在脚本顺序上更早，且已登船者不再属于本动作的候选池。[finishWorkerSafetyPlans:112](https://github.com/shuxueshuxue/sketch-rts/blob/883f57c5/src/ai/bootstrap_1/worker-safety.ts#L112)、[miningJobSafety，mining-job-defense.ts:91](https://github.com/shuxueshuxue/sketch-rts/blob/883f57c5/src/ai/bootstrap_1/mining-job-defense.ts#L91)、[naval 接入，policy.ts:188](https://github.com/shuxueshuxue/sketch-rts/blob/883f57c5/src/ai/bootstrap_1/policy.ts#L188)。

### 2. `miningJobDefense`：矿厅丢失后的采矿接应

**职责与效果。** 保护仍有工人采矿、但 baseRange 内没有已完工矿厅的矿业工作。仅选与当前 home 同陆地、未被盟友认领的未耗尽矿；敌兵已经够得着矿工，或指向矿工且在 1300 可达范围内时，构造一个主力防守目标。目标的 post 是靠近敌军平均位置的矿工，hall 是按陆路最近的己方矿厅；它不拥有一支独立护卫队。[miningJobDefenseTarget:21](https://github.com/shuxueshuxue/sketch-rts/blob/883f57c5/src/ai/bootstrap_1/mining-job-defense.ts#L21)。

**状态、选兵与资源。** 没有独立 memory 字段或持久 claim kind；主力接应通过 general，临时工人移动通过 `miningJobSafety`。`exposedMiners` 用可用、非后排、至少 35% 血的战士，比较实际拦截/到达矿工的时间和敌人最早接触时间。全部来不及才让矿工退到可达且安全的战士身后，附带恢复原采矿工作；找不到接应点就不下命令。占用选中的矿工和主力既有兵力，没有造兵、造厅或跨海资源预算。[exposedMiners:49](https://github.com/shuxueshuxue/sketch-rts/blob/883f57c5/src/ai/bootstrap_1/mining-job-defense.ts#L49)。

**前置条件、子目标、结束。** 需要真实矿业工作、仍可用的原矿和陆路接应者；矿耗尽、盟友取得矿权、矿厅恢复、威胁解除后不再产生该目标。失去可用兵或陆路时，当前实现不会推导补兵、跨海救援、重建矿厅或永久放弃采矿这些子目标。此动作不负责新矿建设，也不能承诺全图任意孤立矿都有人接应。交接点是 `planBootstrapGeneral` 的 defense selector 和工人安全脚本，二者可看见同一威胁却分别决策。[mine-defense.ts:155](https://github.com/shuxueshuxue/sketch-rts/blob/883f57c5/src/ai/bootstrap_1/mine-defense.ts#L155)。

### 3. `mineDefense` 普通小队：就近挡住一轮小袭击

**职责与效果。** 为工作矿厅挡住局部袭击，让主力继续原任务。敌人在矿厅 650 内、明确指向矿厅且在 1800 内，或属于附近 intrusion 时形成 raid；按明确打厅、威胁强度等排序。已被小队/塔覆盖的 raid 可从主力侵入目标里扣掉；小规模纯骑射另交给第 6 项。[miningRaids:46、uncoveredRaid:67](https://github.com/shuxueshuxue/sketch-rts/blob/883f57c5/src/ai/bootstrap_1/mine-defense.ts#L46)。

**状态、选兵与资源。** 普通 detachment 没有持久 task/成员名单；每帧重算，`mineGuardUnitIds` 做当帧预留。优先两名近战，遇召唤物补驱散者，再用非后排补到至少 3 人且小队加塔强度达到敌军 1.25 倍；队伍本身不能超过原始军力的 55%。候选至少 60% 血、未在船上，不在登船/施法/冲锋，不占新矿留守和 rally 人选；行程限制为 1300 等效距离，临时召唤物须活到抵达。命令是矿厅向来敌方向 200 的固定 post 附近 attackMove/冲锋，保留 post 450 范围内的当前接敌。[detachment:79、mineDefense:113、mineGuardUnitIds:141](https://github.com/shuxueshuxue/sketch-rts/blob/883f57c5/src/ai/bootstrap_1/mine-defense.ts#L79)。

**前置条件与子目标。** 需工作矿厅、威胁、够得上且不超过主力预算的小队。凑不够则不派，未覆盖袭击进入主力目标选择；不会单独输出“训练射手/调回护卫/盖塔”。不直接花金、占船；占本地战士至当帧任务消失，实际走完不设承诺时间。

**结束与边界。** 下一帧没有相应 raid 就不再预留；普通小队的 `onCommands` 没有独立的持久 mineGuard 写入，不能把“被挑中”当成跨帧归属。`mineGuard` 持久 claim 来自主力真正下达的守矿命令。主力入口 `mainArmyIntel` 剔除这支 detachment，再按未覆盖袭击决定是否回防；它不负责全局不同矿口的兵力配额，也不替岛屿任务补运输。[mainArmyIntel:313](https://github.com/shuxueshuxue/sketch-rts/blob/883f57c5/src/ai/bootstrap_1/mine-defense.ts#L313)、[recordMiningGeneralCommands，mining-leash.ts:79](https://github.com/shuxueshuxue/sketch-rts/blob/883f57c5/src/ai/bootstrap_1/mining-leash.ts#L79)。

### 4. `miningRally`：固定受袭矿口，分批抵达并接敌

**职责与效果。** 把已承诺回防的队伍送到同一个受袭矿口；已到兵力能打就先打，未到者继续赶路。首次选择靠近 intrusion 的已完工矿厅，其附近要有未耗尽矿或工人；已有任务固定 hall 和 post，不因敌军跨过两矿中线改锚点。[miningRallyAssignment，mining-rally.ts:19](https://github.com/shuxueshuxue/sketch-rts/blob/883f57c5/src/ai/bootstrap_1/mining-rally.ts#L19)。

**状态、选兵与资源。** `memory.miningDefense` 存 hallId、point、attackerIds、protectedHp、gather/fight；成员只来自 `mineRally` claim 或 resumeKind 为 mineRally 的 `mineLeash`。新任务拿当时可用、非后排、能打、至少 35% 血且不是 expansionGarrison 的全部主力；已有任务不自动补新人。post 是矿厅朝初次威胁方向 200，抵达半径 240。记录曾到达的 arrived 与本次实际在圈内的 arrived 分别参与状态判断；局部治疗能保留原 claim，所以 claim.arrived 并不意味着此刻仍在矿口。只有通过命令仲裁的人确认绑定。[planMiningRally:71、accepted:110、afterPlan:122](https://github.com/shuxueshuxue/sketch-rts/blob/883f57c5/src/ai/bootstrap_1/mining-rally.ts#L71)。

**前置条件与分解。** 当实际到圈兵力至少为附近来敌的 1.25 倍，或矿厅/650 范围工人已经掉血、被弹道指向、被射程内敌军指向，或成员均曾抵达，切 fight；fight 不回退 gather。未到者可以边走边射击当前射程内敌人。gather 只认领本任务的人，不停住整个 general；fight 中已到者回到 general 的可用视图。没有足够抵达兵力、有人治疗离开或兵被合法转移时，当前动作不输出“补齐 N 强度/换治疗地点/另找接应部队”等子目标。

**完成、失败与交接。** 已有任务在成员均曾抵达且附近无攻击者时结束，残存 rally 租约降成 mineGuard；矿厅不存在或再无有效成员时清任务。无固定完成时限；租约 TTL 不是到达期限。它不调船、不造兵、不重建矿厅，也不决定两个同时受袭矿口谁优先；状态是一份单锚点。`miningRallyOwns:60` 及 `mainArmyIntel:322` 控制 general 能看见谁，`anchoredMiningDefense:135` 把主力防守目标固定在本厅；局部恢复、battlefield、海军及扩张都经过共享仲裁。[脚本钩子，mine-defense.ts:285](https://github.com/shuxueshuxue/sketch-rts/blob/883f57c5/src/ai/bootstrap_1/mine-defense.ts#L285)。

### 5. `miningLeash` / `mineGuard`：越界收队，回到原矿口

**职责与效果。** 使守矿兵离开本厅 650 后停止追击，回固定 point 的 240 圈内，再恢复先前的守矿任务。650 来自“矿口前 200 + 原有交战空间 450”；约一个屏幕的战术范围，不是以追兵当前位置滚动计算的半径。[miningLeashAssignment，mining-leash.ts:22](https://github.com/shuxueshuxue/sketch-rts/blob/883f57c5/src/ai/bootstrap_1/mining-leash.ts#L22)。

**状态、兵力与资源。** `memory.miningLeash` 只存 hallId、point；`mineLeash` claim 存 target hall、resumeKind、arrived。先延续正在返回的厅，再参考 rally、旧 leash、general.defend。选已归该厅的 mineGuard/已到 rally，实际位于 650 外且在 attack/attackMove 的兵；已经回收者持续走到 240 内。排除工人、船上/正在登船、施法/冲锋、活动扩张护卫及 expansionGarrison；不招新人、不花金、不占船。接受返回 move 才确认 mineLeash；完成后降回 mineRally 或 mineGuard。[plan:47、accepted:60、afterPlan:71](https://github.com/shuxueshuxue/sketch-rts/blob/883f57c5/src/ai/bootstrap_1/mining-leash.ts#L47)。

**前置条件、子目标与结束。** 需要有效厅、仍属于该厅的守兵及可执行地面返回命令。任务结束于实际回圈、厅消失、租约失效或真正转交其他战略任务；没有回程超时/路线失败的独立上报。缺安全回路时应产生“清通道路/安全中继点/运输撤回”子目标，当前不生成。它不否决更高价值的任务转交；它约束已经承诺的守矿追击，不给所有军队套 650。

**交接。** `expansionOwnsDefender:14` 尊重活动建设成员及 expansion/expansionGarrison；`recordMiningGeneralCommands:79` 只为实际 general 守厅命令写 mineGuard，空的 general 状态不分兵。`planBootstrapGeneral` 还在 `pursue` 和逃敌分支执行同一基地边界（mine-defense.ts:223、235），防止主力绕过专用 leash；这层与陆地进攻/扩张共享函数，统一规划器接入要保留实际命令确认归属。[general 防守边界](https://github.com/shuxueshuxue/sketch-rts/blob/883f57c5/src/ai/bootstrap_1/mine-defense.ts#L223)。

### 6. `harassSquad`：把骑射骚扰绑定给固定反制小队

**职责与效果。** 把小规模纯骑射手骚扰从主力目标中剥离；有可反制的小队就驱赶同一个骑射手，其他守兵和主力继续任务。判定骚扰要求附近全部是 horseArcher，总强度不超过 intel.power 的 30%，且在同一个工作矿厅的同陆地 1000 内；骑射大军仍按普通袭击处理。[mountedHarassment，harass-squad.ts:23](https://github.com/shuxueshuxue/sketch-rts/blob/883f57c5/src/ai/bootstrap_1/harass-squad.ts#L23)。

**状态、选兵与资源。** `memory.harassDefense` 保存 hallId、targetId、point；`harassSquad` claim 绑定骚扰者，含 returning。先用射程严格大于目标的远程，再用速度不低于目标的 horseArcher/raider/knight；至少 60% 血、非后排、不在船上/驻扎/登船/施法/冲锋，不拿活动进攻 group、扩张成员、新矿留守或其他 claim（mineGuard 可用）。按实际路径筛 1300 等效距离；累计两轮有效齐射至少能打掉目标当前 HP，且强度至少为附近骑射的 1.25 倍，不超过原始军力 55%，因此人数不是固定常数。[harassSquadAssignment:45](https://github.com/shuxueshuxue/sketch-rts/blob/883f57c5/src/ai/bootstrap_1/harass-squad.ts#L45)。

**前置条件、子目标与占用。** 需要合适射程/速度、健康、数量和可达路线。找不到就不派近战追骑射；主力视图仍可把这类小骚扰排除，依赖工人撤离。此时没有显式“训练反制射手/调回可用骑兵/建设火力覆盖”的需求输出；这正是规划动作需要暴露的能力缺口。已有小队不补死者、不换人、不换目标。无直接金/船需求；占成员至目标死亡/离开或任务失效，没有预计解决时长。

**完成、失败与交接。** 目标死、离开本厅 1000、变成不可见于本土敌情池、厅丢失等使任务解除；目标或队员越过本厅 650 时收回 post，不解除绑定，回到 240 内可再接敌。低于 35% 血允许治疗，不找替补；实际接受的指令才写 claim。`harassSquadGuard:85` 只为绑定的那个目标计覆盖，新来的骑射仍需另算。它经 mineDefense 接入，`mainArmyIntel`/uncoveredRaid 抑制小骚扰；不负责对敌海军或另一个连通块独立招募小队。[planHarassSquad:91、record:123](https://github.com/shuxueshuxue/sketch-rts/blob/883f57c5/src/ai/bootstrap_1/harass-squad.ts#L91)。

### 7. `coveredDefense`：借现成塔建立交战/等待点

**职责与效果。** 输入一股 intrusion 和可用军队，输出靠近受袭厅、真正处于塔射程覆盖内的 post；军队不足时在这里停住，避免普通自动索敌重启无遮蔽追逐。候选塔须完工，能覆盖 post 加 80 半径；后撤候选位于塔后射程的三分之一深度，要求开放、陆路可达，且塔离厅不超过自身射程加 450。没有塔则仍能输出普通防守位置。[coveredDefenseTarget，covered-defense.ts:22](https://github.com/shuxueshuxue/sketch-rts/blob/883f57c5/src/ai/bootstrap_1/covered-defense.ts#L22)。

**状态与资源。** 不持有名单或独立 claim；`holdCoveredPost:50` 把 `v6.general` 写为 guard/target，对传入 line 发 move 或圈内 hold。消耗由 general 分到的兵；塔是已付资源，本动作不花金、不造塔、不进驻建筑、不建墙，也不重新分配海陆兵力。[holdCoveredPost:50](https://github.com/shuxueshuxue/sketch-rts/blob/883f57c5/src/ai/bootstrap_1/covered-defense.ts#L50)。

**前置条件、分解与结束。** 需调用者提供当前侵入和阵线；要获得“塔下防守”效果还需可用塔和通路。不满足时应有“建覆盖塔/维修/改用另一处矿口/暂弃基地”子目标，当前仅返回较弱的站位方案。到达 post 80 内是完成移动，清除威胁才完成防守；目标消失、塔失效由下一 think 重新求解，没有任务级成功/失败回执。与 rally 的 `anchoredMiningDefense:135` 共用目标计算，最终战斗取舍仍在 `planV6Army`，不是塔模块独立决策。

### 8. `frontRecovery`：把危重或已在恢复中的兵送往安全治疗建筑

**职责与效果。** `postRecoveryAssignments` 为永久、可治疗的伤兵选实际可达且安全的已完工治疗建筑。低于 35% 血或一个 think 内预估入射伤害足以致死者可主动退出；非危重者只延续已经在恢复点/去恢复点的恢复。效果是“兵到达治疗范围并恢复”，不是“原目标已有替补”。新矿留守的治疗地点还须离 claim 锚点 650 内。[postRecoveryAssignments，front-recovery.ts:42](https://github.com/shuxueshuxue/sketch-rts/blob/883f57c5/src/ai/bootstrap_1/front-recovery.ts#L42)。

**状态、资源与选择。** 无独立持久任务/claim，候选病人作为当帧 `frontRecovery` 预留，命令为 move(avoidCombat) 或 hold；局部命令保留原防守 claim。按真实地面路线和敌人威胁选点；耗时是走到治疗圈再回血，不设固定期限，不直接占金/船。`recoverBootstrapFront:28` 也是 general 的恢复回调，找不到安全治疗建筑时可退到给定点。[frontRecovery:65、postRecoveryCommands:71](https://github.com/shuxueshuxue/sketch-rts/blob/883f57c5/src/ai/bootstrap_1/front-recovery.ts#L65)。

**前置条件、子目标与结束。** 主动建筑恢复需要可治疗的病人、可达的安全治疗建筑；满血/病人死亡/治疗源不再可达则释放当帧预留。缺治疗源不会生成“造治疗建筑/派军医/运回去”，没有“恢复超过 N 秒则换点”上报。它不决定这个伤兵的旧目标要不要继续保留，也不补足守矿配额。与 rally、garrison、扩张/进攻在 preclaim 时可能同时要人；海军 wrapper 也会再次调用这些恢复动作，这是同一目标跨脚本重复表达的接口位置。

### 9. `campRecovery`：清营任务中的濒死兵短撤

**职责、状态与效果。** 在 `v6.creep` 或 `landExpansion.combat.creep` 的 group 中寻找永久伤兵；低于 35% 血，或到恢复点之前预估投射物和指向性攻击足以致死就短撤。状态依附原营地 group/staging，没有新 claim；选择现成、可治疗且按路线最近的安全军医，否则用营地 staging。当前不读取 naval.conquests 的独立 combat 状态。[campRecoveryPatients，camp-recovery.ts:16](https://github.com/shuxueshuxue/sketch-rts/blob/883f57c5/src/ai/bootstrap_1/camp-recovery.ts#L16)。

**前置条件、资源与结束。** 需已有清营任务、病人、可达 care 点；当帧占病人，不占船/直接金。近身危险/范围伤害用 `mountedEscape`，否则走到集结圈后 hold；不再符合危重条件或原任务消失就不认领。没有军医时只撤退，不会自动造军医；无法清营、被其他任务挪人或旧 staging 已不适合时，缺少补兵/更换医疗/取消清营的计划回执。它不负责矿口警戒和跨海撤军。[campRecovery:48](https://github.com/shuxueshuxue/sketch-rts/blob/883f57c5/src/ai/bootstrap_1/camp-recovery.ts#L48)。

### 10. `mobileCare`：本土病人与现成军医会合

**职责、状态与效果。** 只看与首个自有矿厅同陆地、永久、非工人、未登船的伤兵；使用 `landRecoveryAssignments` 的病人与军医配对，危重/预期致死者走向现成军医。排除海军已预留者、军医本身、现有 creep.group。无独立持久字段或 claim，预留的是病人；不直接造军医、不保证军医停下等病人。[mobile-care.ts:8、mobileCare:23](https://github.com/shuxueshuxue/sketch-rts/blob/883f57c5/src/ai/bootstrap_1/mobile-care.ts#L8)。

**前置条件、资源与结束。** 需要能沿地面抵达、能治疗该兵种的军医。会合路若受威胁用短路段/逃离，安全时 follow；占病人直至不再危重/不再有可达照护，走路和施法时间未统一承诺。无直接金/船请求。缺军医、道路或军医被另一目标调动时应产出“照护资源就位”的子目标，当前只是没有配对。恢复前后原守矿 claim 可以存在，但本动作不负责其岗位补缺。[landRecoveryAssignments，expedition-recovery.ts:43、patientRendezvousCommands:78](https://github.com/shuxueshuxue/sketch-rts/blob/883f57c5/src/ai/bootstrap_1/expedition-recovery.ts#L43)。

### 11. `medicalRecovery`：危重患者优先获得军医技能

**职责与效果。** 为低于 35% 血、永久、可被治疗且非工人的病人分配现成军医；效果是可施法的治疗命令、向病人移动或等待冷却。先按军医冷却排序，按当前可施法距离优先，再按血量比例/路线挑病人；用本帧预计治疗量避免所有军医重复救同一个人。[recoveryPatients:11、assignments:17、planMedicalRecovery:42](https://github.com/shuxueshuxue/sketch-rts/blob/883f57c5/src/ai/bootstrap_1/medical-recovery.ts#L11)。

**状态、前置条件与资源。** 无独立持久状态或 claim，`medicalRecoveryUnitIds:51` 当帧认领军医；预条件是已有能治疗该兵种的军医和病人。不直接花金/用船，占军医移动及技能冷却，人数由病人和现成军医自然决定。病人不再危重/死亡或无匹配军医时释放；不会为没有治疗单位的病人建一条生产链。它不负责病人安全路线、不把病人从船上撤回、不决定该牺牲哪个基地。

**交接。** 此模块在 general/backline 前，因而同帧能压过后排站位；岛上恢复会从 `planBootstrapNaval` 调用同一治疗原语，再加独立的 medicalRecovery 脚本。它们应被规划层看成共享的一份医疗资源，不能各承诺一次同一军医的时间。[medicalRecovery:56](https://github.com/shuxueshuxue/sketch-rts/blob/883f57c5/src/ai/bootstrap_1/medical-recovery.ts#L56)、[naval 内恢复收尾:143](https://github.com/shuxueshuxue/sketch-rts/blob/883f57c5/src/ai/bootstrap_1/expedition-recovery.ts#L143)。

### 12. `shellEvasion`：躲开正在落下的范围伤害

**职责与效果。** 对敌方炮弹/穿刺弹、storm、burningGround，预测兵当前行走轨迹在命中时的位置，选择能在命中前到达且离开所有伤害区的终点；优先减少暴露，再减少移动/队员拥挤。效果是局部躲弹，不是另选战略目标。[planShellEvasion，shell-evasion.ts:34](https://github.com/shuxueshuxue/sketch-rts/blob/883f57c5/src/ai/bootstrap_1/shell-evasion.ts#L34)。

**状态、资源与触发。** `memory.jobs` 中 `kind='shellEvasion:'+hazardId`、id 为单位，记录 created/updated tick；无专用 unitClaims kind，局部命令保留旧防守任务。考虑地面、未登船、非冲锋、未被定身的自有单位，包括工人；每帧预留实际逃逸人选。占原单位至危险消失，无金/船预算。`claimsUnits` 会调用带 jobs 写入的计划函数，因此观测时不能额外调用它来“试算”。

**前置条件、子目标与结束。** 要有当前可见危险、能在剩余 tick 内走到的安全点；没有可达点就无命令，不产生“解控/拦截炮兵/转移阵地”的请求。危险消失或单位不存在时清 job；已离开范围者在危险持续时仍保持避开，治疗中的兵可交给恢复。它不评估炮击源是否值得进攻，也不决定放弃被轰击的矿口。[hazards 与清理:35、候选终点:87](https://github.com/shuxueshuxue/sketch-rts/blob/883f57c5/src/ai/bootstrap_1/shell-evasion.ts#L35)。

### 13. `battleRepair`：用余量矿工抢修被攻击的塔

**职责与效果。** 只抢修已完工、受伤且当前被敌方命令/弹道指向的 defenseTower；先救血量比例低的塔，每塔至多一名工人。挑 baseRange 内同陆地、未登船、idle/mine/repair 的工人，优先正在修该塔者，再按距离；采矿工仅能从超过普通 5 工位预算的矿上取。[repairAssignments，repair.ts:23](https://github.com/shuxueshuxue/sketch-rts/blob/883f57c5/src/ai/bootstrap_1/repair.ts#L23)。

**状态、前置条件与资源。** 没有独立持久 memory/claim，当帧预留维修工，实际 repair 命令属于 local。需要至少 1 金币、受袭受伤塔和余量工人；占工人，原生修理继续消耗金币，但没有预留“修完要多少金”的任务预算。缺钱/工人时不生成补钱、调工人、另建塔的子目标。

**结束与边界。** 塔满血、死亡、不再受攻击、无金或无工人就停止产生分配；原生 repair 的实际结束由模拟器处理。它不修矿厅、不负责重建塔、造墙或守军补缺。海军和 workerSafety 在它之前认领工人，安全撤离优先于修塔；这是需要统一计划器保留的局部救命中断关系。[battleRepair:10](https://github.com/shuxueshuxue/sketch-rts/blob/883f57c5/src/ai/bootstrap_1/repair.ts#L10)。

### 14. 防守调用的战斗原语与主力适配边界

`mountedMicro` / `mountedEscape` 接收已经确定的单兵、敌人和 camp/raid/field goal，负责射击、拉开距离、逃出攻击/技能范围；它们没有独立持久战略状态、招募和金币预算。前置条件是上层已经把兵和目标交进来；完成是这一帧生成可执行命令，目标解决/失败由上层判断。无安全射点/退路不会自动推导招募或运输计划。[mounted-micro.ts:26、82](https://github.com/shuxueshuxue/sketch-rts/blob/883f57c5/src/ai/bootstrap_1/mounted-micro.ts#L26)。

`mountedField` 本身是战略重定向模块：`mountedFieldPlans:60` 在没有 uncoveredMiningRaid 时选自由骑兵，避开守矿人选、rally、新矿驻守、独立 mounted 任务和清营 group；`onCommands:77` 才记录当帧实际占有者，`mountedFieldOwns:19` 供主力剔除。此模块及 mounted 独立出击的完整目标契约属于陆地线；防守侧必须保留上述门槛，不能把它的预选兵视作一定已经出击。[mounted-field.ts:60](https://github.com/shuxueshuxue/sketch-rts/blob/883f57c5/src/ai/bootstrap_1/mounted-field.ts#L60)。

`planBootstrapGeneral` 是共享适配器，先产生扩张命令，再从 mainArmyIntel 拿兵、选锚定回防/孤矿接应/塔下防守，交给 `planV6Army`；同一函数还在 hold 时调用领土前压或扩张协助，并保留陆地攻击目标的暂停/恢复。它写 `v6.general`、通过回调写 mineGuard，读取 landExpansion/landAttack/territory，不能把这些分支统称一个拥有全部军队的动作。[mine-defense.ts:146、175、259](https://github.com/shuxueshuxue/sketch-rts/blob/883f57c5/src/ai/bootstrap_1/mine-defense.ts#L146)。

## 跨模块的交接面

| 交接 | 当前真实条件 | 规划层需要看见的资源/结果 |
| --- | --- | --- |
| 本土扩张 → 新矿驻守 | `expansionGarrisonReady` 检查现成火力或真实到场守兵；未交接好不算建设完成。`expansionGarrison` 只接受已下达命令写入 claim。 | 不是只交矿厅建筑；还要交“该矿口所需的防守强度已到场”。 |
| 岛屿建设 → 新矿驻守 | `prepareIslandConquests:76` 同样等待 hall.complete 与 garrisonReady，完成后岛屿 screen 不再持续处理它。 | 岛屿的后续守矿/援军/撤退路线，以及本土任务是否可以借这些兵。 |
| 已有防守 → 海军招募 | `policy.ts:190` 的 navalUnitIds 排除 active isDefenseTaskClaim 与 garrison 预选者。 | “已经归防守”的兵会保住；新出现袭击还没写 claim 时，已存在的 ferry crew/board 仍可把兵排除在回防池外。 |
| 受袭岛屿 → 本土主力 | 普通 readV6Intel 只认所选 home 陆块敌军；岛屿由局部 intel 和征服任务处理。 | 需要明确的跨海增援、撤离或放弃目标；普通主力回防不会自己生成航线。 |
| 守矿 → 治疗 → 守矿 | local 命令保留原 claim；恢复模块当帧预留病人。rally 的曾抵达标志可继续存在。 | 同时保留“任务成员”与“当前可用/实际在岗兵力”；治疗期间岗位缺口与恢复后的重返承诺。 |
| 夺岛 A → 夺岛 B | `conquestCrew` 按同陆块的所有未归防守的登陆兵选队；每个任务自己调用一次，没有任务间 used 集合。 | 同一连通块多矿任务仍需一份预算和一个分解顺序，不能重复承诺同一兵。 |

以上实现位置：[新矿驻守的选择/交接，expansion-garrison.ts:73、133、162、201](https://github.com/shuxueshuxue/sketch-rts/blob/883f57c5/src/ai/bootstrap_1/expansion-garrison.ts#L73)；[岛屿任务交接，island-conquest.ts:68](https://github.com/shuxueshuxue/sketch-rts/blob/883f57c5/src/ai/bootstrap_1/island-conquest.ts#L68)；[岛屿共享兵池与局部 screen，island-conquest.ts:207](https://github.com/shuxueshuxue/sketch-rts/blob/883f57c5/src/ai/bootstrap_1/island-conquest.ts#L207)；[海军恢复与征服合成，expedition-recovery.ts:105](https://github.com/shuxueshuxue/sketch-rts/blob/883f57c5/src/ai/bootstrap_1/expedition-recovery.ts#L105)。扩张留守、岛屿征服、船运的完整生产链由 land/naval 契约补充；本防守契约不重新规定它们的收益权重或兵力配额。

## 正常对局与观测可信度

所有对局均使用该提交的正常地图、正常经济与正常开局，p0 是观察席，p1 为 Grove `v9_archer` 对手。四人图额外有盟友 p2（Grove `v9_summoner`）和敌方 p3（Grove `v9_archer`）。无快照注兵、无预设袭击、无改动生产 AI。8 个不同地图案例各连续运行 tick 0–18000（15:00）；另外各跑一份未包装脚本的对照，共 16 个 worker 上限。到 15:00 截止，不声称打到比赛分出胜负。

| 案例 / 地图 | p0（Ember） | 敌方骑射峰值 | 骑射命中 p0 / 其中工人 | 完整命令条数（全席） | 验证 |
| --- | --- | ---: | ---: | ---: | --- |
| D01 / pineshade | v9_knight | 3 | 79 / 8 | 9692 | 命令 SHA、终局快照 SHA 均与原版相同 |
| D02 / veiledHill | v9_knight | 3 | 40 / 6 | 13648 | 同上 |
| D03 / greystonePass | v9_summoner | 3 | 4 / 0 | 5307 | 同上 |
| D04 / reedwater | v9_archer | 3 | 12 / 0 | 7068 | 同上 |
| D05 / gullIsland | v9_knight | 3 | 80 / 0 | 7826 | 同上 |
| D06 / twoShores（四人） | v9_knight | 6 | 54 / 11 | 16142 | 同上 |
| D07 / brokenSea（四人） | v9_knight | 0 | 0 / 0 | 5461 | 同上；补充跨海任务冲突 |
| D08 / ringwater（四人） | v9_archer | 5 | 0 / 0 | 15357 | 同上；补充回防/恢复重叠 |

每局 p0 有 1200 次 think，总计 9600 次；包内保留其他席的 think，合计 26400 次。`thinks.jsonl.gz` 中每条都有 tick、owner、预留名单、各脚本原始命令提议、过滤后命令、最终 entries、前后 memory 和全场实体位置；`commands.jsonl.gz` 是经过 SDK 交付的命令；`events.jsonl.gz` 是实际 hit、创建、完工及消失事件。命令的提议、接受、交付及实体实际位置分别记录，不能互相替代。

观测器只包住原本要调用的函数，每次原函数仍调用一次；保留 readiness 两个身份检测函数的原引用，保持原有缓存路径。8/8 对照的命令流 SHA256 与规范化终局 snapshot SHA256 都相同，完整摘要在证据包 `verification.json`。这里验证的是观测器没有改变这 8 局的行为，没有用这些对照统计胜率。

观察有明确边界：不额外调用 selector 试探“被早期 return 挡住的想法”，所以拿不到未执行分支的潜在需求；readiness 的提议/预留未包装，但最终命令仍记录。逐 think memory 去掉了 perception 缓存和通用 jobs，因而 shellEvasion 的 job 生命周期须从命令、危险及源码核对。普通兵/建筑位置与订单均有记录；伤害日志是实际命中，不是潜在伤害。岛/本土分类另外用原版 `sameGround` 校验，没有按地图名称猜。

## 可核查的冲突事件链

下列编号与包内 `episodes.json` 一致。单位在本节首次出现时写完整 ID，后文用同一编号简称。括号 a–e 对应任务要求；“损失”只陈述实际事件，不把同时发生的伤害全算成某一模块的反事实责任。建筑/工人目录价用于识别受损资产，未计算退款、替补训练和少采的金币。

### E01：本土矿厅受袭，原定第二次装船仍完成（b、d）

D05 的第一批登陆在 tick **8160（6:48）**完成，`gold-gen-4` 的征服任务仍为 assemble/await-clearing-force。**8190**，海军又给运输船 `unit-p0-transport-1665` 建立去 `gold-gen-3` 的 advance 任务，征用工人 `unit-p0-worker-2` 和六名满血 ravager：`unit-p0-emberRavager-1687`、`-1720`、`-2015`、`-2047`、`-2066`、`-2094`（后五个 ID 均沿用完整前缀 `unit-p0-emberRavager`）。

到 **9930（8:16.5）**，本土矿厅 `building-p0-townHall-1166` 的 650 内没有己方武装单位，上述六人仍在执行 board。general 已为本厅 defend，却因 ferry crew/board 不在可用池中而拿不到这些兵。实际命中区间 **9935–10192**，矿厅收到 **22 次、377 HP** 伤害，从 900 掉到 523；守塔 `building-p0-defenseTower-1398` 在 **9899** 已被拆。**10245（8:32.25）** 海军仍把同一船切到 sailing，六名战士和工人都已在船上。

模块双方是 ongoing ferry 的 advance/装载动作，与 `miningRally`/`planBootstrapGeneral` 的本土防守。这里没有同帧抢同一兵的提议：回防入口先把 ferry 人员排除，冲突表现为防守需求得不到兵。首个登陆任务 **8160–17115（447.75 秒）**没有完成清场、进入可建厅的 escort；期间会发生自动接敌，不能把 assemble 标签解释为“从未开过火”。缺的是同时为本土和既有滩头重排船/兵的计划，而非新建的第三份兵名单。原始定位：D05 `thinks` 的 8190/9930/10245，`events` 的 9899/9935–10192。

### E02：岛上新矿厅被拆，本土主力仍守旧矿（d，缺失计划链）

同一 D05，`gold-gen-4` 的岛上护卫最终全部消失，仅剩工人 `unit-p0-worker-1`。在 **17385（14:29.25）** 出现未完工矿厅 `building-p0-townHall-9337`；`expansionGarrisons` 已创建该厅记录，但没有当地守军。**17505** 的实际位置：岛厅 650 内己方武装单位 **0**，1000 内四名敌军为 `unit-p1-archer-1450`、`unit-p1-lancer-1600`、`unit-p1-archer-1683`、`unit-p1-archer-2734`；本土旧矿厅附近却有 **16 名**有攻击能力的己方单位（含军医/后排，不等于 16 名前排）。本土 general 仍 defend `building-p0-townHall-1166`，rally 也仍绑定该厅。

岛厅实际被命中 **17512–17907**，共 **42 次、810 HP**；它仍在施工/修复，所以累计伤害可以大于当时已建成的 HP。工人在 **17878** 死亡，未完工矿厅在 **17907（14:55.35）** 消失；资产目录价分别 75 金、400 金。主力在 **17910** 仍对旧矿口发守矿命令。船 `unit-p0-transport-1665` 同时处于去第二个目标的 sailing/unload，携带 E01 的旧乘员，没有出现转向该岛救援/撤工的计划。

模块双方是本土 anchored defense，与 islandConquest/build→expansionGarrison/workerSafety 的岛屿保全。普通本土敌情池看不到该岛袭击；当地没有军队可交给 garrison，工人也没有已完工、半血以上且陆路可达的安全 shelter。**缺失的分解链**是“岛厅被打 → 评估可救/不可救 → 调整船与援军，或撤出工人/停止投入”，当前只留下 await-garrison/建设状态和本土防守动作。本文没有证明此时一定来得及救下矿厅；证明的是没有生成救援/放弃的跨海计划。定位：D05 17385/17505/17865/17910 及上述实际死亡 tick。

### E03：治疗保住任务成员标记，矿口失去实际在岗兵（a、b、d）

D04，`building-p0-townHall-2814` 的 rally 从 **10125** 建立。`unit-p0-ashWarden-2020` 原先已到矿口，**10500** 起 mobileCare 带它离开，**10545** 起 frontRecovery 持续接管；其 `mineRally.arrived=true` 仍保留。**10785（8:59.25）**，`unit-p0-sparkArcher-1079` 仅剩 **4/85 HP**，frontRecovery 提议向 `(2544,1232)` 撤退，miningRally 同帧仍提议让它 hold。前者接受、后者被过滤。这是应当允许的救命中断，不能为了“回防人数齐”强留 4 HP 射手。

问题在中断后的目标配额：已有 rally 只继续认旧成员，不补位。warden 到 **10785** 已距锚点 **881**，到 **11355** 距 **2012**、恢复到 **136/165 HP**，仍保留 arrived 的 rally 身份。矿厅 650 内可攻击单位从 10515 的 5 人降至 11355 的 **0**；general 从 11010 起已是 defend 该厅，记忆中的任务没有转成实际可用的守军。矿厅在 **11028–11366** 受到 **900 HP** 实际伤害，**11366（9:28.3）** 被拆（目录价 400 金）。

双方是 mobileCare/frontRecovery 的恢复动作，与 miningRally/general 的固定矿口防守。E03 不把治疗本身判错，也未证明补兵就能守住；它表明计划必须同时暴露“成员尚属于这里”“目前离岗治疗”“需要替补多少可用强度”。只有 claim 或 arrived 位不足以兑现防守效果。定位：D04 `thinks` 的 10500/10785/11010/11355；`windows.json` 保留两个病人的命令轨迹。

### E04：回防与扩张协助在 12 秒里往返改令（c）

D05，`unit-p0-emberRavager-4667`、`unit-p0-emberRavager-4748`、`unit-p0-emberRavager-4831` 被 `planBootstrapGeneral` 内的两个目标轮流使用：**14535（12:06.75）** 回防 `townHall-1166`，去 `(1756,2367)`；**14595**，前两人被改为去扩张 `gold-gen-6` 的 `(2807,1710)`（第三人 14640 跟上）；**14775** 三人再改回 `(1774,2347)`。

`landExpansion` 在这段时间 paused→恢复→paused，均是实际交付过的方向改变。以 4667 为例，它到被守矿厅的实际距离为 **1304 → 1102 → 1247**：第二个目标让已经获得的靠近进度回吐约 **145**；整个往返发生在 **240 tick / 12 秒** 内。矿厅这段时间保持 523 HP，未观察到这次往返对应的额外建筑损失。双方是 defense selector 与 hold 阶段的 `assistExpansionMission`，虽同属 v6General，仍是两个战略目标；不是把射手短退/绕路误算成换目标。定位：D05 14535/14595/14640/14775，`unit-tasks.json` 和 `windows.json`。

### E05：海军借走陆攻核心，被当成“磨损”撤销原目标（b、c）

D06，**17685（14:44.25）** 发起对 `building-p3-townHall-7099` 的陆地进攻，出发预算 `groupStart=17.5667`；**17775** 原攻击目标仍存在，六名核心成员也都在。**17790**，naval 新建去已经完成建设的 `gold-gen-6` 的 reinforce loading，实际招募：`unit-p0-cinderRevenant-15237`、`unit-p0-ashChieftain-16685`、`unit-p0-emberRavager-12318`、`unit-p0-emberRavager-8734`、`unit-p0-ashChieftain-11909`、`unit-p0-ashChieftain-8672`。board 命令在 **17793** 交付。

同一 think，原 landAttack 被记为 `withdrew / general:retreat:worn`。这些兵因 ferry crew/board 从 `availableV6Army` 消失；`prepareLandAttack` 把借走者从 group 去掉而保留出发预算，`continueArmyAttack` 用剩余强度低于原预算一半判断 worn。这次是**外借导致有效兵池变小**，不能由这个 reason 反推六人战死。[attack-objective.ts:131](https://github.com/shuxueshuxue/sketch-rts/blob/883f57c5/src/ai/bootstrap_1/attack-objective.ts#L131)、[general.ts:351](https://github.com/shuxueshuxue/sketch-rts/blob/883f57c5/src/ai/policy/v6/general.ts#L351)。

**17820**（仅过 **30 tick / 1.5 秒**）海军取消装船，对六人发 stop，**17823** 交付；**17835** 至少 8672 已回到 general 的实际命令中，但原 attack 目标没有恢复。前一个进攻只持续 **105 tick / 5.25 秒**就被撤销。已完成岛矿当时安全，本土后来出现新一轮骑射威胁；没有观察到这几秒的新增基地损失。这里的代价是攻击链被打断、取消返还资源后目标没接回，不是净战损。双方是 landAttack/主力进攻，与 reinforcementFerries/海军装船。定位：D06 17685/17775/17790/17820/17835 及 `commands` 17793/17823。

### E06：同一 naval 脚本的两个夺矿任务给同一兵下两个方向（a；重复承诺）

D07，`gold-mainland-0` 与 `gold-mainland-6` 都在同一个登陆大陆连通块，分别持有 naval.conquests 任务。**17985（14:59.25）**，两者都到 escort/await-engineer-transport，`conquestCrew` 分别选到尚存的 `unit-p0-emberRavager-1117`（仅 **15 HP**）。同一个 naval 脚本先给它 attackMove `(3978.04,4407.12)`，再给 attackMove `(4407.12,3701.96)`，两点相距 **826**；两条非 queued 命令都在 **17988** 实际交付，后者覆盖前者的前进目标。

这不是两个顶层脚本之间的预留冲突，`unitClaims` 的跨脚本避让挡不住。双方是 `islandConquest(gold-mainland-0)` 与 `islandConquest(gold-mainland-6)` 两个计划实例。原始脚本对这两个任务都按“同陆地所有未归防守的兵”重选，没有跨任务 used 集合；所以不能给规划器回报“两个目标各已分到一支队”。此例只在截止前 0.75 秒观察到，**没有后续净损失/完成延迟的反事实证据**；确切后果是同帧两个已接受、已交付的互斥前进方向。定位：D07 `thinks` 17985、`commands` 17988；`conflicts.jsonl.gz` 的 internal-orders-review 条目。

### E07：恢复与新矿留守重叠，但仲裁保护了旧岗（a，正常避让对照）

D06 **15135**，naval 的岛上恢复与 frontRecovery 都提议 `unit-p0-contractArcher-2128` hold，expansionGarrison 则提议它向该岛矿口 `(3319,3528)` attackMove；实际由 frontRecovery 接管，它未因此被招去另一座矿。到 **15495**，garrison 命令被接受并写入 claim，等待 **360 tick / 18 秒**；同段守兵 `unit-p0-emberRavager-1141` 的 expansionGarrison 仍保留。岛厅 `building-p0-townHall-8744` 在两端均为 900 HP，周围无敌军。

这是“原始提议有重叠，但恢复优先且已有守军”的对照，不列为丢矿缺陷。特别是 naval/frontRecovery 的同向 hold 不能被统计成两套相反战略。原始分析保留全部提议重叠，正文按实际目标和后果筛选。定位：D06 15135/15495（后者在 `windows.json` 与原始 think 中）。

### E08：反制骑射没有形成任务时，撤工动作不等于骚扰已解决（d，缺失计划链线索）

D02 **16620（13:51）**，`unit-p1-horseArcher-2736` 已进入 `building-p0-townHall-1702` 附近。workerSafety 对五名工人实际发出撤离/换矿指令；主力当时 hold，后在 **16935** 处于另一处 creep 目标。该厅实际在 **16633–16836** 挨三箭共 **39 HP**，`unit-p0-worker-1031` 被同一骑射追击，**17238** 死亡（目录价 75 金）。全局 1200 次 p0 think 中没有建立 harassDefense/harassSquad。

双方是 workerSafety 的即时避险，与 harassSquad 的能力门槛及主力清营目标。已有规格允许“没有够射程/速度的队伍就不派”，本轮也未额外调用 selector 找出每一帧究竟卡在兵种、路程、健康还是归属，因此不把空队伍直接归因于造兵错误。**已证明的计划缺口**是没有显式未满足反制需求/解决期限；撤工和“骚扰已被处置”应是两个效果。这里没有证明让近战主力改追就会更好。

## 机会遗漏与缺失计划链的分界

(a) 同帧需求重叠有 E03/E06/E07；(b) 已承诺目标失去有效兵力有 E01/E03/E05；(c) 实际方向/任务切换有 E04/E05；(d) 本土或岛上挨打而兵在另一任务有 E01/E02/E08。

**(e) 本轮没有确认“当时已具备安全进攻/占领条件，却完全没有模块负责”的案例。** 逐 think 初筛要求：敌厅 1100 内至少 3 名无 claim、非后排、永久、至少六成血、idle/hold 的本方战士，强度大于附近敌兵与塔的 1.5 倍，再人工检查地面连通性与其他目标。本轮这个严格候选集为空；这只说明没有找到此种现成局部机会，不能证明所有跨海/远程机会都被利用。原始 `opportunity-candidates.json` 为空，筛选程序一起归档。

另外单列两种**当前没有推完整的链**，它们不冒充已证明的空城进攻机会：

- **E01/E02：已有滩头不足 → 给它凑清场/驻守资源 → 再开第二运输目标；岛厅后来受袭 → 增援/撤出/放弃。** 当前表现为旧任务长期等兵、船继续第二目标、最终施工资产丢失。各个局部动作存在，但没有统一计划在它们之间分配。
- **D07 tick 17505–17985：两个大陆矿任务等工程师，钱、工人和船厂存在，运输资源却被维护/另一任务占用。** 17505 时有 820 金、6 名本土采矿工人、已完工 `building-p0-shipyard-1038`；原工程师 `unit-p0-worker-1` 已在 9608 死亡。运输船 `unit-p0-transport-1086` 仍为 reinforce/loading、crewIds 空，ferryDecisions 为 port-service；另有战舰 outfit 和一名 ravager 卡在换船 ships-apart。到截止，两项仍 await-engineer-transport，至少 **480 tick / 24 秒**未接上送工人链。**17505 时目标附近仍有敌军，不能宣称此时安全可建；17985 附近敌兵离开但仍有敌兵营。** 缺的是“重评安全 → 解除/完成维护 → 可用运输 → 工程师与保护就位”的整体资源计划，而非没写过 planConquestEngineers。[现有工程师条件，island-conquest.ts:98](https://github.com/shuxueshuxue/sketch-rts/blob/883f57c5/src/ai/bootstrap_1/island-conquest.ts#L98)。

## 后续实验发现的施工交接缺口（未合入行为）

工人救命中断的三版实验见 [工人续行对照](./worker-continuation-evaluation.zh.md)。它补充了 Assignment 从“救命中断”恢复前必须兑现的接口：保留施工责任后，经济去重、未支付预算、已有护送都要看见同一父行动；责任存在不等于工人在原地点，更不等于路线已经安全。

真实召唤帧中，工人在 11077 被 camp9 逼退。只给经济增加保留父行动的占位后，`planMiningScreen` 仍只从 native build 找 builder；12247 原三名护卫不再走 builder 的实际 steering 前缀，改去矿中心。main 的 camp9 在 13286 清完、14137 的 think 已观察到第四矿完工；实验 C 到 15000 仍未完成。16 名工人的实际路线都受同营或敌塔影响，不能靠反复换工人兑现该目标。父行动需要显式报告“路线受阻，需要先清障/护送”，由父计划决定资源与前置，不能仅在 memory 留着责任和预算。

另一个既有交接是 `prepareExpansionMission` 读取全局 intrusion 后暂停整项扩张（此帧 11137、11407）。这是防守与扩张之间的资源争用，后续分配器应按实际认领/回防命令表示离岗和空缺。实验没有改写该全局开关，也没有新增清营借兵规则。上述续行候选仍有原场景失败、目标延误和异常死亡上升，不能作为已完成的生产契约。

## 证据位置与复核

原始证据位于 A100 的本 lane 目录：

`/codegeex/jeffry/sketch-rts-defense/runs/mvg5dej7-e78fd4/defense-objectives`

归档指针见 [defense-objectives-883f57c5.evidence.json](./defense-objectives-883f57c5.evidence.json)。证据采用仓库 `docs/EVIDENCE.md` 的内容哈希存储约定；取回后每个 `defense-<编号>-<地图>/observe/` 下有完整 think/commands/events，`baseline/` 下有对应初末快照与 receipt。`episodes.json` 提供上述事件链的定位和量化结果；`conflicts.jsonl.gz` 是逐 think 的原始命令需求重叠、同脚本多命令待核查项和受袭时任务上下文，包含接受/拒绝者的即时后果及原始 think 行号。它是审查索引，不把每个局部微操重叠都判为战略缺陷。`windows.json` 为 E03/E04/E05/E07 保存选定单位的连续命令变化。

```sh
SKETCH_MACHINES=/tmp/sketch-defense-machines-owned.json \
  bin/sketch evidence get docs/ai/objectives/defense-objectives-883f57c5.evidence.json \
  --on a100 --out /tmp/defense-objectives-review
```

复跑使用归档内 `cases.json` 和 `observe.mts`，在该提交的源码树里执行：

```sh
node_modules/.bin/tsx /tmp/defense-objectives-review/observe.mts \
  "$PWD" /tmp/defense-objectives-review/defense-05-gullIsland.json \
  /tmp/defense-objectives-rerun observe
```

把最后一个参数改成 `baseline` 即原版对照。程序不复制或修改 AI 实现；日志有初始快照、nextId、activePlayers、完整交付命令，可用于定位后续快照/分叉。分析脚本也在包内，源码函数定位全部固定到本轮提交。本 PR 的验证是文档链接/行号/证据哈希核对、8 份命令流与终局快照一致；生产代码未改，未为文档重复跑全量测试。
