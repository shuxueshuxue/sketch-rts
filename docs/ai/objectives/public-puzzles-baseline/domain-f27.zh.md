# f27：真实领域装配后的11帧K20

**通过0、错误已选链0、缺能力/待事实或搜索11。** 原11帧全部完成20次原生think，共220次，无装配或严格导航审计异常；所有think均无选中动作、无readyActions，首次可执行计划仍全部未出现。
真实安全事实与战斗候选已开始出现。本轮发现新的**穷矿题39项pin超过38项上限**，显式进入容量压力；其余10帧无overflow。

固定共享源码`f27d1cb113c78696e61e9e97d83a20c524e4ef17`，题库运行源码`df97163c9ac8f7eaae5dbbe3ef6bc1407ff8e9bc`，A100 / Node24.22.0 / `v9_knight`。
运行源码归档为`archive/public-puzzles-domain-f27-source-20261021`。这是领域装配的一轮新观测，不改标此前[a576测量/5ca默认容量对拍](geometry-capacity.zh.md)。后续桥接提交也未混入本轮。

## 首次、最终与首次可执行

W=`waiting-facts`，S=`search-pending`，B=`blocked`；候选计alternatives，不是已选动作。下表所有首次可执行think均为“20次内未出现”。

| 题与变体 | 第1次 | 第20次 | 首/末工作量 |
| --- | --- | --- | ---: |
| 船在别处：远船 | ConquerIsland W，0候选 | W，8个build候选 | 3294 / 6144 |
| 船在别处：近船 | 同上 | 同上；防过度行动变体保留 | 3294 / 6144 |
| 人口：农场→骑士 | ExpandLand W，0候选 | B，24个build候选；没有train/clear候选 | 147 / 177 |
| 人口：已有兵营 | 同上 | 同上；防过度行动变体保留 | 148 / 177 |
| 从零造海军 | ConquerIsland W，0候选 | W，8个build候选；没有造船/运输候选 | 3294 / 65 |
| 守家：约90秒遇袭 | ConquerIsland W/0；农场DefendSite W/35；矿厅DefendSite、Evacuate、ReinforceFront为S/0 | ConquerIsland W/43：8 build＋28 destroy-target＋7 assemble；其余S/0 | 6144 / 6144 |
| 守家：约360秒遇袭 | ConquerIsland W/0，DefendSite W/7 | ConquerIsland W/36：8 build＋28 destroy-target；DefendSite S/0 | 6144 / 6144 |
| 滩头：八步兵 | ConquerIsland W，0候选 | W，8个build候选；没有清滩/运输候选 | 3664 / 6144 |
| 滩头：三步兵 | 同上 | 同上；防过度行动变体保留 | 3664 / 6144 |
| 穷矿强营 | ConquerIsland W/0；ExpandLand W/14（7 hold-position＋7 assemble） | 两目标S/0；显式geometry容量压力 | 6144 / 0 |
| 守不住撤离 | DefendSite、Evacuate、ReinforceFront均W/0 | 同上；无evacuate候选 | 6144 / 6144 |

首次出现的候选种类也单独记录：两守家题的defend在think1出现；急迫守家题的destroy-target也在1出现，晚到题在2出现；急迫题的assemble首次在10。
穷矿题的hold-position和assemble在1出现；build各题在2出现。候选的出现没有被计作已执行或完整计划。
所有220次选中动作节点数为0，所以“错误已选链0”只描述本轮输出，不能据此证明选择或目标清单已经正确。

## 已知事实与待发布依赖

全11输入的`combatOptions`现在为true；`readProjectedFact`端口仍为false。原来的`goal-world-domain-port-required`不再是本轮安全事实的原因。
海岛建厅候选旁已出现真实`site-safe=met / observed-safety-window-clear`和`unmet / observed-safety-threats-present`；营地仍为真实`camp-cleared=unmet / native-camp-present`。
这表示resolver已工作，不表示营地已被清除或运兵链已建立。

| 缺口 | 原帧中的具体证据 | 对接线 |
| --- | --- | --- |
| 跨陆块战斗/运力接续 | 远/近船、从零海军、两滩头、两守家和撤离保留`combat-candidate-facts-pending`；其中有真实`combat-location:<cohort>:crossing`请求。海岛题仍没有transport-force/clear链，不能把请求存在算作路线或运输成立 | 37跨陆块候选/运输，32原生装配与回归 |
| 未来工人/输出形状 | 海岛建厅候选仍有8条`route=unmet / route-actor-not-available`，binding工人对应`output-shape:{kind:binding,...}`依赖；没有用当前实体伪装未来工人 | 32未来投影/绑定，23经济与37运输输出 |
| 人口题的训练、清营及正收入链 | 两题最终只有24个pending build alternatives。gold事实要求400、实际quantity=310、`gold-needs-positive-flow`且无producer；camp-cleared为unmet。没有farm→knight或footman→camp候选，更没有选中链 | 23经济/训练数量/收入声明，37营地战力回归，32搜索；本轮不手补目标或收益 |
| 持续安全的支持窗口 | 守家矿厅的site-safe要求throughTick=12001，撤离矿厅12002；同一真实Situation的horizonTicks=2400。观察为`pending / safety-window-support-pending`，并未把超出窗口当安全；对应守家最终还受6144搜索额度限制 | 23安全窗口/未来证明，37守军候选，32调度与搜索 |
| 急迫防守与增援 | 农场site-safe仍`safety-threat-route-pending`；撤离目标有`assets-safety-site-pending`，ReinforceFront的force-at为unmet。急迫题ConquerIsland已有assemble候选，但最终防守/撤离/增援为S，不是已证不可行 | 32同预算搜索/事实发布，37防守/增援 |
| 撤离接送 | assets-safe当前为`unmet / assets-not-in-target-pool`，目标是原本四个工人回到本土；其achiever依赖仍有工人cohort的`:crossing`，最终无evacuate候选 | 37撤离/运输achiever，32投影；不移动工人或敌军过题 |
| 新领域工作集的项数压力 | 穷矿题从think5起pinnedEntries=39，超过maxEntries=38；27361字节尚低于33776字节。两个计划均显式S，think6…20工作量0，最终overflowCount=16 | 32缓存容量/工作集策略；本轮不放宽限值，不把被停止后的峰值当完整需求峰值 |

完整事实包含predicate、state、reason及其参数，候选包含kind、status、价格/完成时刻、reason和原声明。它们保存在独立证据；仓库中的[逐题首末](domain-f27.summary.json)和[候选/事实/容量精简诊断](domain-f27.details.json)便于对照。
其中守家S图仍可能带`goal-no-feasible-plan`原因码；报告按实际S和pending事实保留，不把该码翻译成物理上无解。

### 当前编组估价与未来绑定分开看

下面直接读取同一f27原片中的候选声明，不补跑物理查询。它区分“现有部队尚缺成本/风险报价”和“未来产物尚缺形状/位置”，不能只补未来池就宣称前者闭合。

| 原片位置 | 原声明的实际估计 | 所属缺口 |
| --- | --- | --- |
| 急迫守家，think20的28个destroy-target | duration已met；cost和successProbability仍pending，均为`movement-observed-exposure-unquoted` | **当前编组移动暴露的成本/P未报价**，不是未来单位缺失 |
| 晚到守家，think20的28个destroy-target | 21个duration/cost/P均pending，原因`land-combat-response-window-uncovered`；另7个为`land-combat-route-pending` | 当前编组的响应窗口/路线证明尚未闭合 |
| 急迫守家，think20的7个assemble | 5个duration/cost/P全部met；另2个均`combat-route-pending` | 已有可估价的现组动作，仍须回归其真实前置并选出整链 |
| 两守家，think20各8个build | cost/P为met，duration为`build-worker-binding-pending` | 未来工人绑定/走路时间，与现组暴露估价分开 |
| 穷矿，think1的7个hold-position | duration/cost/P全部met；另7个assemble为route pending | native hold声明已存在，后续受39项容量压力停止；不能写成“完全没有hold能力” |

## 穷矿题的容量压力

这是领域候选新增后观察到的工作集变化，原5ca缓存回归继续保留自己的来源和结论。本轮没有改默认33776字节/38项，也未启用measurement。

| think | 状态 | 工作量 | pinned | overflow |
| --- | --- | ---: | --- | ---: |
| 1…4 | 有候选展开，尚无pressure | 每次6144 | 尚未超过38项 | 0 |
| 5 | 首次显式pressure，两个目标S | 4991 | 27361字节/39项 | 1 |
| 6…20 | 保留pressure和依赖，两个目标S | 每次0 | 同上 | 最终16 |

pressure记录指明ConquerIsland与ExpandLand两个真实计划及完整requestIds。当前pressure摘要只列bytes/limitBytes，项数原因须连同capacity的pinnedEntries/maxEntries读取；不能因27361小于33776就误称没有超限。
这是显式容量停顿，没有将pin无声逐出；本轮没有证明后续还需多少条目，所以不据此直接建议把默认改成某个新数。

## 检查、来源与复跑

根`tsc --noEmit -p .`、tools/ai tsc、SDK package-boundaries均exit0（SDK 7项通过）。题库全目录35通过、11计划失败、22跳过，exit1；未跑全量src。
35项为构造/前提/scope/绑定，22项为11个尚未接公开执行bridge的检查与11个本轮未启用的人工解；不计作规划器解题。

场景与判法文件相对归档`3330ddf5`逐字节未变；相对f27没有自有生产AI/SDK/sim改动。11份初始snapshot均与原a0帧的JSON字节一致。
每次只传同一份snapshot对象、沿用memory，唯一原生think序号推进1…20；每次上限6144、物理tick不变、快照不变，记录器没有补做几何或建址查询。

```sh
env -u SKETCH_PUZZLE_GEOMETRY_MEASUREMENT -u SKETCH_PUZZLE_WITNESS -u SKETCH_REQUIRE_GOAL_PLANNER SKETCH_PUZZLE_PLAN_EVIDENCE=/tmp/puzzles-f27 npx vitest run src/ai/strategy/puzzles --maxWorkers 1 --minWorkers 1
```

重模拟仍在A100/mac1跑。[f27完整证据指针](domain-f27.evidence.json)包含11份原帧、220次完整native输入/输出/cache/memory/work、严格闸与测试日志、源码和文件哈希、分析及复跑脚本。历史main、a0、a576/5ca证据均独立保留，PR继续draft；执行检查在后续正式桥接固定头另接、另跑。
