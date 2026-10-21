# 冻结世界连续 think 的计划判法

固定共享基底 `82b22a5d`，题库源码 `8f028867`，A100 / Node 24.22.0，统一 `v9_knight`。
结果：**通过0、错误已选动作链0、缺能力11**。其中2帧完成10次think，9帧在第2次装配Situation时被严格导航审计中断。
已观察到的选中动作图全部为空；没有把异常、待发布事实或空图当成物理不可行证明。

计划检查从单次冷 think 改为最多10次原生 owner think。只在第一次创建快照和 owner memory，之后每次使用同一个快照对象、同一个游戏 tick，并沿用完整 memory（含真实搜索 cache）。
不推进 sim，不改敌军、命令、坐标、钱、ETA 或期限，不改缓存的发布字段，不另外创建工作队列。

每次 think 都在原生物理 scope 内直接调用 `planGoals` 和原来的 `checkPuzzlePlan`。原依赖图、数量账本、先后关系和真实矿厅预留断言均保留。
每次退出 scope 后检查最终原生工作收据不超过6144，并再次检查快照字节未变。正常 Objective collector 没有题库专用目标、收益或概率。

稳定性比较包含真实目标、事实状态、选择的动作图、替代、数量和时间安排；排除搜索工作计数、cache游标和解释元数据。完整值仍写入逐次原始证据。
连续两次图一致且原判法都通过才提前停止；重复的 blocked、waiting-facts 或 ready 空图不会提前结束，也不会因此判题通过。
否则运行满10次，并采用第10次的原判法结果和末两次稳定性，不挑选中间最好的一次。

证据包含第1次、最终一次和全部中间 think 的输入、输出、原断言结果、最终工作收据、memory及快照不变性。
记录器只序列化数据，不调用额外的建址/几何端口，避免证据开关影响下一次 think。

共享层已把发布边界接到 owner memory 的 `thinkSequence`。本轮不手建work、不改世界tick或缓存ready字段。
[40e 单次冷帧的0通过/0错误链/11缺口](cold-plans-40e.zh.md)及原始证据独立保留在 `archive/public-puzzles-cold-plans-40e-20261021`。

## 首次与最终结果

表中 W 为 `waiting-facts`，B 为 `blocked`。所有列出的计划均为0个选中动作。
9帧的第2次think没有进入规划回调，因此没有本次计划和完成收据；其最后成功返回的计划只有第1次，不能写成“完成10次仍失败”。

| 题与变体 | 第1次计划 | 第1次工作量 | 最终一次尝试 | 判定 |
| --- | --- | ---: | --- | --- |
| 船在别处：远船 | ConquerIsland W | 3294 | 第2次：Arrival装配异常 | 缺原生有限物理口 |
| 船在别处：近船 | ConquerIsland W | 3294 | 第2次：同上 | 同上；过度行动回归保留 |
| 人口：农场→骑士 | ExpandLand W，0候选 | 147 | 第10次：W，24候选、47事实，工作量6144 | 仍缺事实；末两次图不一致 |
| 人口：已有兵营 | ExpandLand W，0候选 | 148 | 第10次：W，24候选、47事实，工作量6144 | 图已重复，原判法仍失败 |
| 从零造海军 | ConquerIsland W | 3294 | 第2次：Arrival装配异常 | 缺原生有限物理口 |
| 守家：约90秒遇袭 | 只有ConquerIsland W | 1937 | 第2次：同上 | 缺物理口；首次仍无DefendSite |
| 守家：约360秒遇袭 | 只有ConquerIsland W | 1937 | 第2次：同上 | 同上 |
| 滩头：八步兵 | ConquerIsland W | 3664 | 第2次：同上 | 缺原生有限物理口 |
| 滩头：三步兵 | ConquerIsland W | 3664 | 第2次：同上 | 同上；过度行动回归保留 |
| 穷矿强营 | ConquerIsland W＋ExpandLand W | 6144 | 第2次：同上 | 同上；尚未比较两条完整链 |
| 守不住撤离 | DefendSite W＋Evacuate W＋ReinforceFront B | 6144 | 第2次：同上 | 同上；未实际选择增援链 |

两个人口题在第1次保留了真实geometry deferred依赖，状态是W；第2次发布后重新回归，展开24个真实建造alternatives。
这证明该原帧的G2传播和下一think发布已向前推进，不能把第1次的空候选当最终结论。
到第10次，两题仍没有选中动作，原来的农场/训练/清营先后断言失败。候选数量增加不算通过。

| 完整K10的题 | 第10次pending route | pending build-site | pending site-safe | 末两次语义图相同 |
| --- | ---: | ---: | ---: | --- |
| 农场→骑士 | 12 | 8 | 9 | 否 |
| 已有兵营 | 15 | 8 | 9 | 是，仍未通过原判法 |

对应原生原因分别为 `goal-land-route-pending`、`goal-geometry-pending`、`goal-world-domain-port-required`。
不把10次内未完成的计算说成永远不可行，也不补人工事实或提高额度来过题。

## 本轮能力缺口

| 缺口 | 证据与下一步 | 对接线 |
| --- | --- | --- |
| Arrival调用未授权原生几何 | 9帧在第2次think的Situation装配中，`arrivals.crossingTable → berth → nativeVoyageBerth → boardingBerth → walkDestination`被原有导航审计拒绝。尚未进入plan回调，不能绕过审计、借额外额度或虚构第2次计划 | 32装配、37有限物理口 |
| 深层路线/建址仍pending | 两个人口题完成K10后仍有上表中的pending请求，均为6144内的真实工作。保留连续memory和全部中间帧，供检查候选发布/续行；本轮未证明这些请求永久无法发布 | 32事实续行、23经济grounding |
| 安全事实缺domain port | 两人口题各9条site-safe为`goal-world-domain-port-required`，原生combatOptions仍缺。不能以眼下未遇敌代替持续安全证明 | 32事实源、37防守候选，23配合 |
| G1/G3/G4/G5后续复核 | 守家首次仍只有ConquerIsland；其他新留守/战斗/撤离能力未能越过上述装配异常。保留原输入，等共同头后统一重跑，不根据新增接口就宣称已过 | 32/37，按原分工 |

32后续的`993527ed`已补无achiever空失败图cache合同，并接G1效果映射；本报告固定82b，不混用其源码或声称已经验收这些后续修改。

## 验证与证据

共尝试38次think，完成29次原生规划回调；9次在第2次装配中断。
29份完成收据的think序号、memory序号一致，游戏tick未动，每次工作量都在0–6144内。
所有11份快照在每次尝试后字节不变。中断处memory序号为2，但没有本次完成收据，原片明确记`work=null`，不沿用第1次收据。

根tsc、tools/ai tsc、SDK package-boundaries均exit 0。题库全目录35通过、11失败、22跳过，exit 1。
35项是构造、原生前提、scope诊断及绑定检查，不是规划器解题数；22项跳过为11个等bridge的执行检查和11个本轮未启用的人工解。
相对82b未改生产AI/SDK/sim；未运行全量src。

完整快照、每次输入/输出/memory、工作收据、异常栈及退出码见 [frozen-thinks-82b.evidence.json](frozen-thinks-82b.evidence.json)。
首末和逐次精简表见 [frozen-thinks-82b.summary.json](frozen-thinks-82b.summary.json)。

```sh
SKETCH_PUZZLE_PLAN_EVIDENCE=/tmp/planner-frozen-thinks npx vitest run src/ai/strategy/puzzles -t 'frozen-world dependency graph' --maxWorkers 1 --minWorkers 1
```

执行检查仍等正式 bridge。人工解、构造器与 scope 诊断不计入规划器通过数。
