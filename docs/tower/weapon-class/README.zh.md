加固塔与武器分类修复
==================

规则以 owner 最后确认的版本为准：只有非机械陆军能上塔；只有远程武器获得射程科技、测距训练和塔顶的射程加成。换武器可以改变类别，数值加成不能。原来的设计确实让近战也获得射程科技：`ORDINARY_COMBAT_UNITS` 包含近战，原 `applyWeaponAttack` 注释也明确描述过延长近战距离。这次按新决定停止这项加成。

`weaponClass` 只比较当前武器**未加成定义**的基础射程与 80。`nonStarUnitStats` 从 `weaponRules` 得到该定义，并在计算实时属性前刷新 `Unit.attackClass`；创建单位、切换装备、variant 刷新、恢复快照也覆盖这条路径。没有缓存的旧对象按 catalog 定义读取；恢复存档时重新读取实际武器，并清掉旧近战单位保存下来的射程加成。缓存可以由已有定义、装备和手持位置完整重建，canonical 不把它作为独立状态，原 fresh-game checksum goldens 不变。玩法规则升到 **8**，拒绝把规则 7 的 replay 或客户端与新规则混用，规则 7 的存档仍可导入。

调用点审计
----------

以下行号均为基线 `a389ec26`。表中“定义”指未加成的当前武器定义，“实时”指 `Unit.attackRange` 或带搜索/瞄准加成的临时 range。

| 调用点 | 修改前 | 修改后 |
| --- | --- | --- |
| shared/combat-geometry.ts:93 `strikeReach` | 实时射程 ≤80 才禁止跨塔顶近战 | 按当前武器类别禁止，任意实时数值都不能越过 |
| shared/combat-geometry.ts:94 `strikeReach` | 本次传入 range >80 就跳过贴身补足 | 只有远程武器跳过；搜索半径不再充当武器类别 |
| shared/aiming.ts:13 `aimingRange` | 实时射程 ≤80 不给瞄准余量 | 调用者传入当前武器类别；近战不获余量 |
| shared/aiming.ts:18 `requiresAiming` | 比较规则里的基础射程 | 通过 `weaponClass(rules)` 统一读定义，保留无武器船的规则 |
| shared/tower-garrison.ts:67 `garrisonRangeMultiplier` | `baseRange` 已经过科技，却用 >80 决定塔顶增程 | 读取定义派生的类别，只给远程武器 1.2 倍 |
| shared/crew-rendezvous.ts:86 `boardingHoldShips` | 用实时射程 ≤80 决定是否为近战登船交战保位 | 当前武器为近战才保位 |
| shared/sim.ts:2050 `updateBoardShipOrder` | 用单位基础规则判断近战船员，忽略换装 | 当前装备的未加成武器类别 |
| shared/sim.ts:2084 `updateBoardOrder` | 用单位基础规则决定跨甲板近战 | 当前武器类别，换弓后不再走近战路径 |
| shared/sim.ts:3463 `applyWeaponAttack` | 已经读取未加成武器射程决定普通投射物 | 读取统一类别，维持其原本正确的武器语义 |
| shared/sim.ts:3518 `applyAttackDamage` | 用射程数字决定直接伤害的画面 | 用伤害 delivery；脚本显式给出的类型仍生效，火焰斗篷保留原近战画面 |
| shared/sim.ts:3527 `addHitEffect` | 比较当前武器定义的射程决定命中类型 | 当前武器类别，保留原定义语义 |
| shared/sim.ts:3660 `navalCombatTarget` | 用兵种基础规则识别应答登船者的近战船员 | 当前装备的武器类别 |
| shared/sim.ts:4000 `nearestEnemyTargetFromPoint` | 传入搜索 range ≤80 才扩大贴身检索 | 按武器类别，贴身检索和跨塔顶限制一起生效 |
| shared/sim.ts:4239 `strikeUnit` | 人造 81/0 射程数字控制脚本的远程/近战画面 | 显式 damage delivery，不再伪造射程 |
| client/sound-cues.ts:62 `meleeKind` | catalog 基础射程 ≤80 识别缺少明确攻击类型的命中声 | 统一 `weaponClass` 读取同一基础定义；声音语义不变 |

一并收口了字面量 80 的分类点，避免只替换常量名字而遗漏等价判断：

| 调用点 | 修改前 → 修改后 |
| --- | --- |
| shared/deck-combat.ts `deckHullDamageShare` | 当前武器定义的 ≤80 → 同一当前武器类别；近战/施法/箭的分摊比例不变 |
| shared/equipment.ts `itemHands` | 已发行武器的基础射程 >80 → `weaponClass`；占手数不变 |
| ai/policy/naval-services.ts | 船员实时射程 ≤80 → 近战武器船员 |
| ai/policy/item-tactics.ts | 火焰斗篷等道具的实时近战标记 → 固有武器类别 |
| ai/policy-v2prod/item-tactics.ts | 同上；只接共享武器分类，未改偏好权重 |
| ai/policy/skirmish-tactics.ts 两处 | 风筝/保命时用敌人的实时 ≤80 识别近战威胁 → 武器类别 |
| ai/policy-v2prod/skirmish-tactics.ts | 同上；未改阈值距离和权重 |
| ai/policy/threat-reach.ts 两处 | 冲锋最小距离、身体接触距离的实时 ≤80 → 武器类别 |
| ai/policy/v6/backline.ts 两处 | 掩护者计数、敌人接触时间的实时 ≤80 → 武器类别 |
| ai/bootstrap_1/mine-defense.ts | 选矿点近战护卫的实时 ≤80 → 武器类别 |
| ai/bootstrap_1/expansion-garrison.ts | 矿区驻军角色的实时 ≤80 → 武器类别（此处驻军不是上塔） |
| ai/bootstrap_1/summoner-screen.ts | 召唤师屏障近战者的实时 ≤80 → 武器类别 |
| ai/bootstrap_1/worker-safety.ts | 是否需要立即躲避的实时 >80 → 武器类别；有武器建筑仍计为远程威胁 |
| ai/death-ledger-attribution.ts | 死亡归因里的实时 >80 角色 → 观察时保存的武器类别 |

另两处 90 的明确近战/远程分类也统一了：`shared/push.ts::canTakeStance` 及其 UI/AI/命令调用者现在看实际武器；`ai/squad/squad.ts::fight` 以武器类别决定是否跟随集火。AI 里 100、120、200 等数值用于射程足够长的后排、编队或威胁距离启发式，保留其战术意义，没有把这些距离常数全部改成武器类别。

射程加成与 AI
-------------

- `rangeTraining` 的 `affectedUnitKinds` 未改。在计算属性的同一处加“当前武器为远程”的条件。骑士/掠袭兵/长枪骑兵满级后仍是 72/72/74；步兵换弓后获得倍率，放下弓后移除。
- `veteranSiegeDrill` 的新抽取按当前武器过滤，旧选择在近战武器上不能学习，已学技能的近战倍率为 1；换回远程后恢复。陆军投影与独立舰炮测距都有限制。中英文技能说明写明“仅远程武器生效”。
- `ai/policy/core.ts` 的 V5 射手科技与后期科技收益计数改读真正受益的远程武器单位，不再计近战，也不把不受该科技影响的雇佣兵算进去。纯近战军队不会仅因金币多就买没有受益者的射程科技。
- `ai/bootstrap_1/mounted-recruitment.ts` 只在骑射手实际持远程武器时提出测距科技需求。其他声明式军队路线为将来训练的射手准备科技，不属于按现有近战兵数估算收益的逻辑。

上塔规则与反馈
-------------

资格政策只在 `canStandOnTower`：存活、非机械陆军，且不在甲板或舱内。`garrisonRefusal`、`garrisonRoomFor`、命令验证和 AI 计划入口共用这项政策。机械判定读取 `unitClass`，包括 variant，不列兵种白名单。

`garrisonRoomFor` 同时检查人口和 `towerTopLayout` 的整圆身体排布。排布按半径和稳定 ID 排序，约束 `距离塔心 + 单位半径 ≤ 塔半径`，并检查身体不重叠。单人站中间，混编需要重新排位；身体确实放不下就拒绝，存档中的不合格占位者会安全下塔。静态组成的布局有弱引用缓存，避免每 tick 重跑排布搜索。

每个不合格成员都有结构化 `refusal={reason,detail}`：`garrison-mechanical`、`tower-full`、`garrison-body-size`、`garrison-ownership`、`garrison-ineligible`。直接 sim 命令的拒绝和混合选择的部分拒绝经 `orderEnded` 发出；拒绝不会清掉单位先前的 order/queue，也不消费 nextId。外层保留既有 reason：机械/体型是 refused，满员是 no-room，归属是 target-gone。

整单被客户端 preflight 或服务器 frame admission 拦住时，返回的 `CommandLegalityError` 同样携带精确 refusal，并保留现有即时提示。该边界的统一私有网络回执、翻译和提示样式由 Codex 27 的后续 PR 接入；本 PR 不往只读合法性检查里写效果，也没有改 effect-renderer 样式。

验证与截图
----------

两组场景都在 mac1 的真实 Chromium 中运行，同一份场景脚本分别运行基线和分支：

```sh
export SKETCH_MACHINES=~/.config/sketch/machines-sound.json
bin/sketch yatu tower-trained-melee --ref <验证的分支提交> --ref2 a389ec26 --on mac1 --json
bin/sketch yatu tower-body-fit --ref <验证的分支提交> --ref2 a389ec26 --on mac1 --json
```

第一组通过实际研究完成一级射程科技，验证科技等级确实为 1。没有依赖 HTTP reset 会丢弃的 `scenario.players.upgrades`。主分支三个塔顶工人全部被打死；分支三个工人都保持 70 HP。满级科技及换弓由真实 sim 的单元测试覆盖。

| 进攻者 | main 射程 / 塔顶工人结果 | 分支射程 / 塔顶工人结果 |
| --- | --- | --- |
| knight | 83 / 死亡 | 72 / 70 HP |
| raider | 83 / 死亡 | 72 / 70 HP |
| lancer | 85 / 死亡 | 74 / 70 HP |

第二组按 owner 最新规则改成“弩车拒绝提示”以及步兵、骑士、最大体型非机械陆军 ancientStag 的塔顶截图，镜头缩小到 0.7。main 的骑士/古鹿身体越界；分支完整落在半径 40 内，且弩车保持在地面并看到明确提示。单人从偏移 ±14 改为居中后，身体最远点分别为 18、22、32。

- [弩车不能上塔的实际提示](ballista-garrison-refusal.webp)
- [步兵在塔顶](footman-on-tower-zoomed-out.webp)
- [骑士在塔顶](knight-on-tower-zoomed-out.webp)
- [最大体型的非机械陆军在塔顶](ancient-stag-on-tower-zoomed-out.webp)

原 PNG、逐项位置/半径/HP 与执行结果的位置见 [validation.json](validation.json)。WebP 只对原截图转码，没有改画面内容。

既有断言变化是两项新规则所要求的：`sim.test.ts` 将新训练掠袭兵的科技后射程由 83 改为 72；`tooltips.test.ts` 将说明改为 ranged weapon reach。四个规则边界测试把当前版本由 7 改为 8，并保留规则 7 存档可读的断言。没有改变 AI 对战结果断言、删除测试或放宽超时。

最终校验
--------

验证源代码为 `f54a61a5f25aa533a0f8ac57da0c6141cff5e5bb`，此后的提交只增加本文、截图、元数据与证据指针。mac1（Node 24.14.0）上根 `npx tsc --noEmit -p .` 退出 **0**；`npx vitest run --dir src --maxWorkers=2 --minWorkers=1` 为 **7900 通过、1 项既有条件跳过、0 失败，退出 0**。mac1 当前 PATH 未检测到 ffmpeg，唯一跳过项是既有 `skipIf(!hasFfmpeg())` 的 MP4 编码测试；同一项在 A100 全量中已通过。

先前 A100 的 Node 22.23.3 全量为 7900/7901、退出 1，唯一失败是 worker 启动无法解析无扩展名的 `host`。基线也能复现；同一份代码的该文件在 A100 Node 24.22.0、juma Node 24.22.0、mac1 Node 24.14.0 均 5/5 通过。因此保留原测试与 30 秒等待限制，最终在 mac1 重跑整套，未跳过失败项。远端旧 CLI 缓存遗漏的计划历史 JS 夹具由验证提交的 `git archive` 原样补齐，没有改夹具内容。

原始浏览器证据见 [raw.evidence.json](raw.evidence.json)，类型检查与全量日志见 [checks.evidence.json](checks.evidence.json)。取回命令：

```sh
export SKETCH_MACHINES=~/.config/sketch/machines-sound.json
bin/sketch evidence get docs/tower/weapon-class/raw.evidence.json --out work/tower-browser-evidence
bin/sketch evidence get docs/tower/weapon-class/checks.evidence.json --out work/tower-checks-evidence
```
