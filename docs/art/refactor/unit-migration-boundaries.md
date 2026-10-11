# 同质单位合并：接口与持久化边界审计

只读审计基于美术重构期间工作树；本文件不表示已经修改规则。先完成同规则性能比较，再实施用户追加授权的实际单位合并与共享单位/种族科技树。主车道统筹 canonical 数值和合并范围。

## 单位目录与科技树

`shared/types.ts` 的 `UnitKind` 直接取 `keyof UNIT_RULES`；`TrainableUnitKind` 当前通过 `{ trainedAt: string }` 条件类型推导。`catalog.ts` 又从单值 `trainedAt` 推导 `BUILDING_DEFS.trains`，从 `UnitDef.race` 推导 `RACE_DEFS.trainableUnits`。仅删除 `pyreCaller`、把 summoner 的 `race` 清空，并不能让同一单位在两族不同建筑训练。

干净的目标是：单位目录保留一条 canonical 行，种族科技树/生产关系独立表达共享单位在各族的生产建筑。训练资格、生产建筑列表、解锁 UI 和 AI 生产查询均由该关系派生，不再各维护一份例外表。当前每族所有升级共用 `UPGRADE_KINDS`；升级所属建筑、单位范围已有 `UPGRADE_DEFS`，不应为共享单位复制升级规则。

最小集成入口：

- `catalog.ts`：UnitDef、TrainableUnitKind 推导、BUILDING_DEFS、RACE_DEFS、训练资格/生产建筑查询。
- `sim/command-validation.ts` 与 `sim.ts:queueTraining`：同时核验种族资格和建筑生产关系，不能只改客户端列表。
- `client/main.ts` 的训练命令状态与提交：消费同一关系。
- `client/content/cards.test.ts`：训练卡覆盖、同一建筑热键唯一性、种族技能展示。
- `unit-value`、人口/升级、单位目标类型、装备熟练度、老兵专精等按 kind 查询的语义：删除旧行后完整检查。

召唤师例子中，`summon` 与 `cinderSoul` 的实际行为参数相同：同样召唤 spirit，范围、冷却、持续时间和自动施法设置一致。但 `summoner` 与 `pyreCaller` 的生命、速度、普攻伤害、射程、瞄准速度、价格、训练时间并不相同。合并必须明确选定一套数值；这属于新的规则变更，不能包装成纯美术优化。`witch/ashHexer` 的诅咒还包含不同减伤比例及 scorch 特例，不能凭职业名称归类后盲目合并。

## AI 接口与冻结边界

多个 AI 路线直接硬编码 summoner/pyreCaller，部分按能力目录动态发现召唤者。`bootstrap_1/policy.ts` 及其测试直接读取 `UNIT_DEFS[kind].trainedAt`；其他路线的阵容、兵种计数、施法、估值和生产建筑选择也引用这些键。

用户追加授权允许必要的机械 kind/producer 接口适配：把已确认的旧 kind 映射到 canonical kind、从同一科技树查询生产建筑，保持算法和优先级原义。不得顺带重调目标数量、预算、阈值、路线选择、冻结基线或验收证据。若替换后出现同一数组的两个旧角色都映成一个 kind，需明确它们原本是互斥种族分支还是应累加的组成；不能机械去重改变军队规模。无法保持原义的调用报告主车道。

应通知长期 AI 车道的具体接口变化为：删除哪些 UnitKind/AbilityKind、生产建筑查询签名、共享单位在各族的合法性、新规则版本。不向该车道索要状态，也不覆盖其进行中的策略改动。

保留两个活跃规则行或长期把旧 kind 伪装成新 kind 的运行时适配器不是真合并。历史输入可在持久化加载边界进行一次性升级，升级结束后运行态只含 canonical 行。

## 训练、召唤、雇佣和物品

- `ABILITY_DEFS` 的召唤目标是 `summonKind`；统一施法名后同时处理 `Unit.abilities`、自动施法、技能命令、能力冷却、技能 UI 文案和图标引用。
- 建筑训练队列持久化 `unitKind`、`remaining`、`paidGold`。转换 kind 时保留已付款和剩余时间，不能按新价覆盖退款基础。
- 当前佣兵池是 mercenary/contractArcher/fieldMedic 三种；商店出售 17 类物品，不直接出售 summoner。若合并 fieldMedic 与 priest，则 `MercenaryUnitKind`、camp 雇佣池/库存与 UI 是额外边界。
- 制式武器通过 `WorldItem.weaponKind` 引用单位种类。删除旧 kind 后须规范化此字段，不能让人物表现读到不存在的目录行。
- 剧情使用 `VariantRules.base` 与规则覆盖；不能把剧情独立数值当作另一条常规种族单位留下来，也不能误删授权范围外的剧情变体。

## 存档、网络与复播

当前 `SAVEGAME_SCHEMA_VERSION = 1`、`DEBUG_REPLAY_SCHEMA_VERSION = 1`；`CHECKSUM_VERSION = 17`。checksum 版本同时被既有存档升级使用，但不是独立规则集版本，也未发现网络层有可隔离本次规则变更的独立规则版本。

建议保存明确的规则版本，而不是仅递增 checksum 算法编号。新游戏、save、debug replay、网络初始 checkpoint/握手必须能确定所用规则版本。结构格式版本与战斗规则版本分开判断。

旧存档的一次性升级至少遍历：

1. `snapshot.units[].kind`、`snapshot.corpses[].kind`、`snapshot.effects[].sourceKind`。
2. `snapshot.items[].weaponKind`、`buildings[].queue[].unitKind`。
3. `variants[].base` 及覆盖规则中的能力名。
4. 活体当前/排队 cast order、`abilityCooldowns` 键、`autocast` 键；不能覆盖更长的有效冷却，也不能丢失用户关闭自动施法的意图。
5. scenario 单位种子、train/cast/setAutocast 等序列化命令输入的历史名字。

升级应复制输入、显式验证、幂等，完成后旧名字不再留在运行态。既有 `paidGold`、训练剩余时间、真实血量、维护费规则必须保留；若 maxHp 改变要明确限幅方案，不能偷偷治疗。旧存档缺失 paidGold 时沿用既有加载规则，尤其保留已完成维护费/退款变更的约束。

**历史复播必须拒绝跨规则版本重模拟，不能把旧 kind 改名后交给新数值并声称原复播仍确定。** 可以明确提示用对应旧引擎打开；或者只导入 checkpoint 转为新规则存档继续玩，但后者不等于复现历史战斗。复播入口需在加载初始存档/最近 checkpoint 前检查规则版本，防止一个路径拒绝而另一路径静默混算。

网络命令验证从当前 catalog 派生合法 kind；升级部署后的旧客户端不能凭名字映射继续参加新规则比赛，应在版本握手处明确拒绝，避免双方本地确定性模拟使用不同规则。

## 必要验证

- canonical 单位只有一行，两族训练资格、生产建筑和热键正确；无旧名字运行态兜底。
- 训练排队/取消/退款、人口门槛、召唤/自动施法/冷却、各族科技升级正确。
- 旧 save 转换覆盖队列、尸体、装备和能力状态；不修改原输入，重复升级结果一致。
- 旧 replay 明确拒绝跨规则版本；新 replay 同版本逐 tick checksum 一致，最近 checkpoint 路径同样校验。
- AI 仅接口机械变更的源码审查与适用测试；冻结基线和验收产物不改。
- 规则合并后重新记录资产数量与实机验证；此前 57 单位的同规则性能基线仍保留，不能拿新规则减少单位种类或可见内容当渲染性能收益。
