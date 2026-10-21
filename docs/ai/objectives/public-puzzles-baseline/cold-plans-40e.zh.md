# 首轮真实冷帧计划验收：40e06d3a

11 个冷帧：**通过 0，推出错误动作链 0，缺能力推不出 11**。
所有选中动作图都为空；这不是“11 题不可行”，也不是规划器通过。
当前问题包括缺失 achiever、尚未发布的原生事实被当成无候选，以及守家目标没有进入请求清单。

共享基底 `40e06d3a`，场景/判法源码 `475dd5e8`，A100 / Node 24.22.0，统一 `v9_knight`。
每帧只进行一次真正冷的 owner think，不推进模拟、不预热额外帧、不增加 6144 额度。
`withGoalPlannerInput` 省略 goals，在同一个 Situation/query/scope 内调用正常 Objective 生成和 collector；没有题库专用目标、收益、概率或动作链。

## 三类结果

| 类别 | 数量 | 判定 |
| --- | ---: | --- |
| 通过 | 0 | 没有一帧满足全部依赖图要求 |
| 推出了错误动作链 | 0 | 所有选中动作都是空，不能声称已经观察到训练、调船、登陆或回防的错误链 |
| 因缺能力/事实推不出 | 11 | 逐题见下表。`blocked` 不当作物理不可行证明 |

## 第三类：逐题缺口

G1–G5 的具体证据和补齐边界见下一张表。工作量是生成正常目标并搜索后、事后 grounding 诊断前的真实共用队列用量。

| 题与变体 | 实际生成的目标 | 实际输出与缺口 | 共用工作量 |
| --- | --- | --- | ---: |
| 船在别处：远船 | ConquerIsland | `blocked`，0 动作/候选；G1＋G2。尚未进入调船、运兵、清营链 | 3294/6144 |
| 船在别处：近船 | ConquerIsland | 同上；没有链，不能把“没多调船”单独计作通过 | 3294/6144 |
| 人口：农场→骑士 | ExpandLand | `blocked`，0 动作/候选；G1＋G2。没有进入农场和训练分支 | 147/6144 |
| 人口：已有兵营 | ExpandLand | 同上；不能据此认定选择了更快的步兵方案 | 148/6144 |
| 从零造海军 | ConquerIsland | `blocked`，0 动作/候选；G1＋G2。尚未进入船厂/新船链；真实矿厅预留收据也是后续未接能力 | 3294/6144 |
| 守家：约90秒遇袭 | 只有 ConquerIsland | G1＋G2；另缺 G3：没有 DefendSite 请求，不能比较先守后攻 | 1937/6144 |
| 守家：约360秒遇袭 | 只有 ConquerIsland | G1＋G2＋G3。没有 DefendSite 请求，不能比较夺岛后回防窗口 | 1937/6144 |
| 滩头：八步兵 | ConquerIsland | `blocked`，0 动作/候选；G1＋G2。没有选登陆口，也没有清滩链 | 3664/6144 |
| 滩头：三步兵 | ConquerIsland | 同上；不能把没有进攻危险近口计作安全替代已选对 | 3664/6144 |
| 穷矿强营 | ConquerIsland＋ExpandLand | 两个都 `blocked`，0 动作/候选；G1＋G2。没攻穷岛，但也没安排本土扩张，不能算负收益选择通过 | 6144/6144 |
| 守不住撤离 | DefendSite＋Evacuate＋ReinforceFront | 前两者 `waiting-facts`，第三个 `blocked`，全为0动作；G4＋G5。ReinforceFront 只是未实现的候选目标，没有实际派兵增援链 | 6144/6144 |

## 可交给各线补齐的能力表

| 缺口 | 实际证据 | 对接线与应补内容 |
| --- | --- | --- |
| G1：留守完成的 achiever | 10 帧的11个矿业目标都要求 `hall-complete`＋`garrison-ready`；后者是 `unmet / observed-garrison-handoff`，没有候选动作。当前注册 provider 没有建立该效果的分支 | 32 事实/绑定，37 留守/守家原子声明，23 配合陆地留守。保留真实交接含义，不能删掉该效果冒充扩张完成 |
| G2：建址 pending 的传播与续行 | `hall-complete` 同样0候选。搜索后的原生 `buildSites` 查询：9帧为 `goal-geometry-publication-pending`；穷矿题两个矿点为 `goal-geometry-pending`，均是 pending、0候选。计划却返回 `blocked / goal-no-feasible-plan`，事实列表没有该 grounding 等待依赖 | 23 经济 grounding/provider，32 搜索依赖与续行。将待发布候选保留为 pending 依赖/alternative，公布后重新回归；不能把 pending 当空候选的不可行结论 |
| G3：90/360秒的已知来袭目标 | 两个冷帧的4名敌军都有原生 `attackMove`。但 SiteThreat 只有900 tick（45秒）的窗口、0 attackers、firstArrival=null；正常清单只有 ConquerIsland。`situation.ts` 的威胁候选距离直接使用该45秒窗口 | 32 Situation/目标观察，37 守家目标。补已知进攻意图和较长 ETA 窗口的观察/目标生成；不把题目敌军移近到45秒以内来规避 |
| G4：持续安全与救出事实 | 撤离题 `site-safe`、`assets-safe` 都是 `pending / goal-world-domain-port-required`。对应计划 `waiting-facts`。原生 scope 的 `combatOptions` 未接 | 32 事实源/证明，37 防守与撤离候选，23 陆地安全配合。建立真实安全/救出效果与候选，不能用当前瞬间安静冒充未来持续安全 |
| G5：field-strength 到岗候选 | 撤离题 ReinforceFront 要求 `force-at(metric=field-strength)`，是 `unmet / native-selected-force`，0候选；`combatOptions` 未接。没有选中增援动作 | 32/37 候选装配，23 配合补兵能力。保留 field-strength 与 combat-rating 的区别，用真实 cohort/到岗评估推导，不能改标签凑数量 |

所有输入还都未接 `readProjectedFact`。未来 cohort、战斗估值和新船出生等下游能力确实尚不完整，但本轮大多在根部已经停住，不能据此声称某个具体训练/运输替代已试过并失败。
海军题的真实分配预留与所有执行检查也仍待正式 bridge，不伪造预算或用人工解代发命令。

## 冷帧忠实性修正

实测发现原守家/撤离场景把敌方 attackMove/unload 推迟到执行 runner 的第一次 think，冷帧里敌军仍是 idle。
现已在场景构造时通过 `issuePlayerCommand` 下达真实进攻/卸载命令；位置、兵力、钱、地形和时间距离不变，执行入口也不会重发、重置已经运行的卸载。
最终表采用修正后的冷帧；守家目标缺失在修正后仍然成立。
证据保留原始地形、实际坐标/速度、attackMove/unload、完整输入 Situation 和共享工作收据。
守家这条站点威胁观察路径在45秒候选距离筛选处就排除了这些敌军；没有其站点威胁路径记录不代表不可达，也没有另求路径或补一份威胁事实。
具体路径为 [situation.ts](../../../../src/ai/strategy/situation.ts) 的 `sites.map` → `candidates` 距离筛选 → `incomingLandArmy`，窗口来自 [utility.ts](../../../../src/ai/strategy/utility.ts) 的 `threatHorizonTicks`。

三个受影响变体的原生前提/人工合法解复测9项通过（包含3个完整人工解），exit 0。
历史 d4ca2668 基线和旧时间表仍对应归档的旧源码，不能与本次冷帧 SHA 混用。

## 重跑与验证

```sh
SKETCH_PUZZLE_PLAN_EVIDENCE=/tmp/planner-cold-40e npx vitest run src/ai/strategy/puzzles -t 'cold-frame dependency graph' --maxWorkers 1 --minWorkers 1
```

本轮该命令 **exit 1，11个真实冷帧断言失败**。检查已经开启，没有将失败改回 todo/skip，也没有削弱原先的依赖图断言。
每个 scope 回调恰好一次，11份快照均未变化，没有装配异常；每帧工作量不超过6144。
根 tsc 与 tools/ai tsc 均 exit 0。执行检查继续等 bridge；未运行全量 src。
另跑 SDK package-boundaries：6项通过、1项失败。唯一失败是共享基底 `40e06d3a` 已有的 `goal-naval-assessment.test.ts:92` 测试名触发禁用旧称检查；已通知32修改，本轮冻结原片未改共享源码。

原始快照、请求、事实、候选、输出图、断言与 Vitest JSON 见 [cold-plans-40e.evidence.json](cold-plans-40e.evidence.json)。
精简机器可读表见 [cold-plans-40e.summary.json](cold-plans-40e.summary.json)。事后 grounding 查询在同一 scope、同一额度中进行，只用于说明缺口，不替换已经固定的计划输出，不进行第二次搜索。
