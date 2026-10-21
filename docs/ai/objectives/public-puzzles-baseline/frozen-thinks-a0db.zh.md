# a0db：11帧完整K20的首末与首次可执行指标

固定共享头 `a0dbb105`，题库源码 `0615cf07`，A100 / Node24.22.0 / `v9_knight`。
**通过0、错误已选动作链0、缺能力11。11帧都完整完成20次think，共220次，没有装配或导航审计异常。**
所有已选动作图、正式readyActions均为空；首次ready、首次完整原判法通过、首次可执行计划三个序号全部为null。
这些是“20次内未出现”的观测，不是耗时0或物理不可行证明。

## 首次与最终结果

W=`waiting-facts`，B=`blocked`；表内的计划均为0个选中动作。“稳定”只表示末两次语义图相同，仍须通过原判法才能算解题通过。
首次可执行要求同一次think完整原判法通过，并出现正式native ready动作；实际分配/发令仍由未来bridge验证。

| 题与变体 | 第1次计划 | 第20次计划 | 首次可执行think | 首/末工作量 | 末两次图稳定 |
| --- | --- | --- | --- | ---: | --- |
| 船在别处：远船 | ConquerIsland W，0候选 | W，0候选；根建址deferred | 未出现 | 3294 / 144 | 否 |
| 船在别处：近船 | 同上 | 同上；过度行动回归保留 | 未出现 | 3294 / 144 | 否 |
| 人口：农场→骑士 | ExpandLand W，0候选 | W，24候选、47事实；9条site-safe pending | 未出现 | 147 / 173 | 是 |
| 人口：已有兵营 | 同上 | 同上；过度行动回归保留 | 未出现 | 148 / 173 | 是 |
| 从零造海军 | ConquerIsland W，0候选 | W，8候选；安全/未来worker绑定缺口 | 未出现 | 3294 / 61 | 是 |
| 守家：约90秒遇袭 | ConquerIsland＋2个DefendSite＋Evacuate为W，ReinforceFront为B | 同目标清单，ConquerIsland有8候选；安全/撤离/到岗候选未齐 | 未出现 | 6144 / 73 | 否 |
| 守家：约360秒遇袭 | ConquerIsland＋DefendSite为W | 同目标清单，ConquerIsland有8候选；安全候选未齐 | 未出现 | 6144 / 6144 | 是 |
| 滩头：八步兵 | ConquerIsland W，0候选 | W，8候选；建址/安全/未来worker绑定缺口 | 未出现 | 3664 / 73 | 否 |
| 滩头：三步兵 | 同上 | 同上；过度行动回归保留 | 未出现 | 3664 / 73 | 否 |
| 穷矿强营 | ConquerIsland＋ExpandLand均W，0候选 | 均W、0候选；两个根建址deferred | 未出现 | 6144 / 284 | 是 |
| 守不住撤离 | DefendSite＋Evacuate为W，ReinforceFront为B | 同上；安全/救出事实和到岗候选未齐 | 未出现 | 6144 / 6144 | 是 |

6帧的末两次图相同，5帧仍变化；没有把稳定的等待图当作通过。
没有产生已选动作链，所以本轮“错误已选链”为0；目标尚未展开也不能当作选择正确。

## 已经向前推进的两处

人口两题的首个陆地距离场在think3完成，首次`route=met`在think4出现在真实计划事实中。第2次已出现24个建造alternatives；第20次，计划图中的路线和建址pending已清掉，仍各有9条`site-safe / goal-world-domain-port-required`。
这里的think4是路线事实发布，不是首次可执行计划，不能代替上表的null。

守家两题都已生成DefendSite。第20次真实SiteThreat中，4名敌军的首次到达分别为1797 tick（89.85秒）和7195 tick（359.75秒）。
敌军仍在原位置、保留原attackMove；观察窗口已不再把这两组已知来袭都筛在45秒之外。
这证明目标观察向前推进，尚未证明已产生守家动作或正确的先守后攻链。

## 剩余能力表

| 缺口 | 原片中的证据 | 对接线 |
| --- | --- | --- |
| 安全/救出事实与候选 | 全11输入的combatOptions、readProjectedFact端口仍未接。site-safe/assets-safe出现`goal-world-domain-port-required`；人口两题各9条site-safe pending，守家与撤离的安全目标也无动作 | 32装配/事实源，23安全resolver，37防守/撤离候选 |
| 留守与field-strength到岗 | garrison-ready仍是`unmet / observed-garrison-handoff`；留守效果映射已在源码中，但没有真实选择。ReinforceFront的force-at为`unmet / native-selected-force`、0候选 | 32中央证明/候选端口，37复用hold与增援候选；不是再造一个留守动作 |
| 未来worker绑定 | 守家、滩头、从零海军的建造候选各有8条route为`unmet / route-actor-not-available`，actor实际为binding；worker-at也未满足。不能据此证明未来工人永远不可用 | 32未来投影/绑定，23经济grounding，37运输输出对接 |
| 根建址的几何缓存活锁 | 船在别处两个变体的根建址在think9被逐出，之后重算/逐出，候选8/0往返；穷矿题也反复丢失根结果，见下一节 | 32 pin/LRU/overflow规则；当前16KiB的resident不能用来量真实pinned需求 |
| 局部建址仍pending | 第20次守家急迫/两滩头变体各8条build-site为`goal-geometry-pending`；本轮只报告真实状态，不提高额度或手补可建点 | 23/32在保留依赖后复核发布与续行 |

预算、运输绑定、完整战斗评估和执行桥接还需继续打通。本轮没有越过这些缺口，不能把接口存在或候选增加计为题目通过。

## 16KiB几何缓存的逐次证据

下面跟踪的是第1次真实目标deferred依赖引用的根几何request，按原始key＋revision匹配，无额外查询。
完整根request哈希、每次readyThink、驻留条目和字节数在机器可读诊断中。

| 原帧 | 首次根ready | 后续发生了什么 | 第20次 |
| --- | ---: | --- | --- |
| 远船/近船 | 1 | think9结束memory中根条目消失；10重算readyThink=10；11再消失；12重算；之后重复。候选8/0往返 | 根readyThink=20，候选0；工作量144 |
| 穷矿强营 | 1（两个根） | think2起一个根在结束memory中缺失；另一个的readyThink在3…20每轮重置 | 两个目标均0候选；工作量284 |

相同世界下原请求的key/revision没有改变。条目数约15–18，未到32项；几何段接近16384字节上限，整个observation约17KiB且没有truncated标记。
结合`boundGoalGeometryMemory`的字节逐出规则，这说明缓存逐出让结果反复重算，增加think次数本身不能修复。
这里量到的是逐出后的resident；本版本没有pin记账，**不能把该数当作真实pinned峰值来选新上限**。
后续按批准的measurement-only参数另跑，仍保持6144、冻结世界与审计，并与本轮原快照逐题比较；默认限值下的验收须再单独运行。

## 验证与复跑

每次只沿用同一份快照和owner memory，使用正常collector、原生Situation/query和唯一FactWorkQueue。
220次回调全部完成，序号1…20与memory一致，每次0–6144，物理tick不变；每份快照每次都字节未变。
记录器没有调用额外的buildSites或几何端口。原依赖图、资源账本、先后关系与真实分配收据断言没有削弱。

根tsc、tools/ai tsc、SDK package-boundaries均exit0。题库全目录35通过、11失败、22跳过，exit1。
35项是构造/前提/scope/绑定，不是规划器解题数；22项为11个待bridge执行检查和11个本轮未启用的人工解。未运行全量src。
相对a0db无生产AI/SDK/sim改动，PR保持draft。

```sh
SKETCH_PUZZLE_PLAN_EVIDENCE=/tmp/planner-a0db-k20 npx vitest run src/ai/strategy/puzzles --maxWorkers 1 --minWorkers 1
```

[完整证据指针](frozen-thinks-a0db.evidence.json)、[首末与逐次精简表](frozen-thinks-a0db.summary.json)、[几何驻留诊断](frozen-thinks-a0db.geometry.json)。
此前[82b/K10报告](frozen-thinks.zh.md)及原片独立保留，不与本轮的完整K20混算。
