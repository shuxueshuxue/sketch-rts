> 本文保留设计阶段的论证；随后执行的实验与限制以本目录 README 和原始 archive 为准。

# bootstrap 无可选前排时，不求无人使用的 rally

建议只改 `src/ai/bootstrap_1/mine-defense.ts` 的内部确定调用；[具体未应用 patch](G-research.diff) 净增 **4行**（含1条import），没有新API、持久状态、缓存、选择器注册表或第二套规划算法。源码冻结与hash见 [记录](BOOTSTRAP-NO-FRONT.source.json)。未修改生产、编译、跑模拟或CPU测试。

在原 :134 `creep.group.push` 之后、原 :135 `commands` 声明处：

```ts
const noRally = previous?.stage !== 'gather'
  && !intel.army.some(unit => !isBacklineKind(unit) && unit.attackDamage > 0);
if (noRally) v6Doctrine(snapshot, owner, options);
const commands = noRally ? [] : planV6Army(snapshot, owner, options, intel, {
  // 原来的完整 ArmyPlan 对象保持原样。
});
// 原169–188全部后处理继续执行。
```

`noRally` 是当前输入推导的一次局部判定，不是新配置flag。**不对整个 planBootstrapGeneral 提前return。** 公共 `planV6Army` / `ArmyPlan` 原字节不变，所以用户传入的任意 chooseMine 仍在相同条件下调用，调用次数、顺序与抛出的原对象不变。无需基于函数identity识别 closure，也不用让 policy/v6 反向 import bootstrap。当前 bootstrap 的 chooseMine 为每次新建的捕获 owner/options 的匿名closure(:145)，因此“直接比现有函数identity”在这里没有可用的稳定标识；新加注册/品牌/flag反而扩大机制。

## 为什么条件足够

`general.ts:193` availableV6Army 返回 intel.army 的子集；`:194` front 的判定正是 `!isBacklineKind(unit) && unit.attackDamage > 0`。原列表连一个满足该谓词的候选都没有，则 available 的 front 必空。保留 `>0` 谓词本身，避免把 NaN 用 `<=0` 错当成等价取反。

`:205–209` front 空分支只有 gather 情况才使用 rally 写回 `{mode:'hold', target:rally}`；非gather直接返回 []。因此在本guard下，strength、miningFirst、constructing、outweighed、escort、rally、扩张矿全体路长评分与 ArmyPlan 对象构造都没有返回或AI memory消费者。

这是保守充分条件：不会优化“intel.army含前排，但它们全部busy/board/offground”的无front状态。这样避免有军队的慢路径再做一次 busy Set、数组filter和sameGround。实际目标 tick0 intel.army 为空，已全部覆盖。如果后续证据显示这些未覆盖状态也占主成本，再单独决定怎样共享 available；不为先扩大命中引入可选prepared参数或额外全图结构。

## 保留下来的可观察操作

1. `mine-defense.ts:127–134` mainArmyIntel、previous捕获、creep recruits/arrived筛选、creep.group招募写入均在guard前保留。
2. 原 `planV6Army:191–192` 创建v6Memory并调用v6Doctrine；fast分支仍调用同一个v6Doctrine。`select.ts:12–26` 的已知doctrine校验、首次gameRng选profile/strategy、decidedTick与两个recordPlay都保留。只在fast分支额外显式调用，慢分支仍由原内核调用，**不会让有军队的慢分支额外抽签或调用doctrine**。
3. gather状态无条件进入原planV6Army，原escort、rally与gather→hold target完全保留。没有为了避开路径查询而用home代替rally。
4. 原 `:169–176` creep reinforcement及road判断、`:177–183` retreat transition、`:184–188` routeAssaultCampCommands后处理仍执行；它们可以在空commands下检查/更新现存任务，不能被函数early return吞掉。
5. `planV6General` 与任意外部直接调用planV6Army完全不改。不会把“没有最终命令”当理由跳过未知回调/throw。

被省的 bootstrapExpansionMine(:145) 和 v9FrontPoint 只读取 snapshot/intel/options 的确定数据来返回点/矿，内部 walkingDistance/walkRoute/placement会改变私有几何cache热度，不写AI doctrine/general/目标记忆，不使用gameRng。bootstrapExpansionMine→chooseV9ExpansionMine 的 priority/powerNear 回调由该模块自己构造，没有外部任意回调入口。公共ArmyPlan的可观察chooseMine不在此分支中。

## 风险与最小差分验收

- 几何cache热度、Field创建/LRU/nearest键会减少，后续相同tick或后续tick可能承担原先被这里预热的必要查询。正式比较必须计入其后全部工作，不能把省略grow的局部profile当整体收益。
- 现存同对象terrain内容变更与旧快照的first-read历史须继续做A/P序列差分，不能假定省掉预热绝无公开可观察影响。这里没有自行改变地图版本/失效语义。 还包括 build-layout.ts:57–68 的 mineLanes(snapshot) 首次缓存：非opening分支的 v6ExpansionPoint/placement可能预热它，省掉后需覆盖同一旧snapshot被原地修改resources/buildings再查询的序列；未发现额外AI memory/RNG写入不代表这些私有缓存完全没有副作用。
- 有非gather旧general（hold/attack/guard/creep）、creep任务、无军队/纯backline/零或NaN伤害、所有前排被其他任务占用、gather军队全灭、doctrine缺失/有效/失效，都应覆盖。后三类中不能命中的状态仍走原内核，差分应证明没有过度早停。
- 对 fast 命中逐调用比较完整AI memory，尤其 doctrine、plays、general、creep.group；逐tick游戏状态和command逐项相同。对 generic planV6Army 用有记录副作用/抛出固定对象的chooseMine验证原回调trace和throw identity完全不变（必须构造原来会进入escort的fixture，不把未调用误当通过）。
- 这是未实施设计。父线程报告的隔离M中30个grow selfsamples只是剩余归因线索，不是30ms，也不能证明本patch能把整体最大值降10倍；需完整未插桩对照检验。
