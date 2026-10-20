加固塔与武器分类修复
==================

规则以 owner 最后确认的版本为准：只有 bodyForm 为 foot 的徒步单位能上塔；机械仍被排除；只有远程武器获得射程科技、测距训练和塔顶的射程加成。换武器可以改变类别，数值加成不能。原来的设计确实让近战也获得射程科技：`ORDINARY_COMBAT_UNITS` 包含近战，原 `applyWeaponAttack` 注释也明确描述过延长近战距离。这次按新决定停止这项加成。

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

资格政策只在 `canStandOnTower`：存活、bodyForm=foot 的非机械陆军，且不在甲板或舱内。55 种基础单位在 `UNIT_RULES` 逐行显式声明体态；没有按名字、半径、武器或来源推断。完整分类表及边界说明见 [body-forms.zh.md](body-forms.zh.md)。

- foot 27：包括 lancer（长矛步兵）、工人、双足野人/鱼人/食人魔、三种永久雇佣兵。
- mounted 3：knight、raider、horseArcher，均不能上塔。
- beast 9、machine 15、spirit 1：均不能上塔。无足灵体单列 spirit；机械魔像即使双足也不能上塔。
- 召唤和雇佣只表示来源，不改变体态。召唤出的 foot 单位仍按 foot 判定，永久存在的 spirit 仍不能上塔。无人口的徒步单位按 1 人口计。

`UnitVariantDef.bodyForm` 可覆盖；旧 variant 缺少该字段时继承 catalog 基础兵种的显式体态。`unitClass` 与体态各有用途，只改 targeting class 不会把机器形态变成步兵；机械 class 的变体即使声明 foot 也仍被拒绝。命令验证、到达检查、`garrisonRoomFor` 与 AI 计划入口共用这项政策。

`towerTopLayout` 同时检查完整身体是否能排布：按半径和稳定 ID 排序，约束 `距离塔心 + 单位半径 ≤ 塔半径`，并检查身体不重叠。单人站中间，混编重新排位；身体放不下就拒绝，旧存档中骑乘、野兽、机械或灵体占位者会安全下塔。静态组成的布局有弱引用缓存。

每个不合格成员都有结构化 `refusal={reason,detail}`：`garrison-mechanical`、`garrison-not-infantry`（detail 携带 mounted/beast/spirit）、`tower-full`、`garrison-body-size`、`garrison-ownership`、`garrison-ineligible`。直接 sim 命令的拒绝和混合选择的部分拒绝经 `orderEnded` 发出，保留先前的 order/queue，也不消费 nextId。外层既有 reason：机械/非步兵/体型是 refused，满员是 no-room，归属是 target-gone。

整单在客户端 preflight 或服务器 frame admission 被拦住时，`CommandLegalityError` 同样携带精确 refusal。统一私有回执、中文提示和提示样式由 Codex 27 的后续 PR 接入；本 PR 不向只读合法性检查写效果。截图中的英文 Hosted command rejected 是既有开发错误条。

验证与截图
----------

生产代码与测试为 `f5f4baafc64228fc64324f249cb3b5dd8d00a76c`；身体截图场景为 `00643183c7b231c92deec1642f40494ec32b602f`，后者只把截图地点移到空地，没有改变 src。此后的提交只更新文档、图片和证据指针。

两组场景均在 mac1 的真实 Chromium 中运行，同一份脚本分别运行基线和分支：

```sh
export SKETCH_MACHINES=~/.config/sketch/machines-sound.json
bin/sketch yatu tower-trained-melee --ref f5f4baaf --ref2 a389ec26 --on mac1 --json
bin/sketch yatu tower-body-fit --ref 00643183 --ref2 a389ec26 --on mac1 --json
```

两组均为分支通过、main 按目标断言失败，两边页面错误均为 0。第一组实际研究到一级射程科技，明确检查等级为 1；不依赖 HTTP reset 会丢弃的 scenario.players.upgrades。满级科技和换弓由真实 sim 单元测试覆盖。

| 进攻者 | main 射程 / 塔顶工人结果 | 分支射程 / 塔顶工人结果 |
| --- | --- | --- |
| knight | 83 / 死亡 | 72 / 70 HP |
| raider | 83 / 死亡 | 72 / 70 HP |
| lancer（徒步） | 85 / 死亡 | 74 / 70 HP |

第二组展示步兵、弓箭手、牧师以及最大基础徒步体型的食人魔领主；分支单人居中后，身体最远点分别为 18、16、16、28，全部不超过塔半径 40。main 的食人魔领主越界。骑士在分支留在地面并显示拒绝原因，在 main 则仍能上塔。镜头缩小到 0.7，塔台无遮挡。

- [步兵在塔顶](footman-on-tower-zoomed-out.webp)
- [弓箭手在塔顶](archer-on-tower-zoomed-out.webp)
- [牧师在塔顶](priest-on-tower-zoomed-out.webp)
- [最大徒步体型在塔顶](ogre-lord-on-tower-zoomed-out.webp)
- [骑士被拒绝的提示](knight-garrison-refusal.webp)

原 PNG、逐项位置/半径/HP、脚本和远端位置见 [validation.json](validation.json)。WebP 只对原图转码，没有改画面内容。原始浏览器记录与测试日志分别存于 [raw.evidence.json](raw.evidence.json) 和 [checks.evidence.json](checks.evidence.json)，上传后核对 SHA-256。

最终校验：根 `npx tsc --noEmit -p .` 与 CLI tsc 均退出 0。mac1（Node 24.14.0）全量 `npx vitest run --dir src --maxWorkers=2 --minWorkers=1` 为 **714 文件通过、7910 项通过、1 项既有条件跳过、0 失败，退出 0**。退出码由远端 `vitest-confirm.exit` 核对。唯一跳过项是 mac1 PATH 中没有 ffmpeg 时已有 `skipIf` 的 MP4 编码测试；同一份生产代码在 A100（Node 24.22.0）单跑录制文件为 **6/6 通过、退出 0**，涵盖该项。未新增跳过项或放宽超时。

既有断言变化：新训练掠袭兵的科技后射程从 83 改为 72、科技说明改为 ranged weapon reach、四处当前规则版本 7 改为 8（保留规则 7 存档可读）。按新的徒步规则，“无人口单位按 1 人口计”的案例从 spirit 换成同为 0 人口的 foot wildling，容量断言保留；身体排布案例换为徒步体型。没有改变 AI 对战结果断言、删除测试或放宽超时。

```sh
export SKETCH_MACHINES=~/.config/sketch/machines-sound.json
bin/sketch evidence get docs/tower/weapon-class/raw.evidence.json --out work/tower-browser-evidence
bin/sketch evidence get docs/tower/weapon-class/checks.evidence.json --out work/tower-checks-evidence
```
