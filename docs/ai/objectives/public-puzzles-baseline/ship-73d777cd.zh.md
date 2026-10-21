# 73d777cd：题1逐步骤归属验收

**严格五步1/2通过，原物理＋任一goal口径1/2；结构K20 2/2。** 两局各560次真实think、8400 tick。留守另行观察，不增加本轮断言。

固定生产`73d777cda3af5fbc01c7c9fcc103a5967b107080`，运行源码`229e82d0ac91372b51280929b9e60ee675fa7939`。包含目标厅资本保存/接管和安全finish窗。新判法沿用9cb的五步要求，ba收据版只投影实际SDK字段、另存SDK流并在失败时保留步骤结果；没有热换后续ACK修复。此前324旧2/2、新0/2及v6Economy两笔原生400付款保留在[324报告](ship-324670da.zh.md)。

## SDK命令与自己的效果

| 变体 | 步骤 | 归属结果 | goal返回命令数 | SDK应用数 | 首观测效果绝对tick | 归属script |
| --- | --- | --- | ---: | ---: | ---: | --- |
| far | position-transport | goal-confirmed | 7 | 7 | 2205 | goal.position-transport |
| far | transport-force | goal-confirmed | 9 | 9 | 3090 | goal.transport-force |
| far | clear-camp | goal-confirmed | 6 | 6 | 3660 | goal.clear-camp |
| far | transport-worker | unconfirmed | 0 | 0 | — |  |
| far | build | unconfirmed | 0 | 0 | — |  |
| near | position-transport | goal-confirmed | 4 | 4 | 4485 | goal.position-transport |
| near | transport-force | goal-confirmed | 9 | 9 | 975 | goal.transport-force |
| near | clear-camp | goal-confirmed | 4 | 4 | 1860 | goal.clear-camp |
| near | transport-worker | goal-confirmed | 77 | 2 | 6165 | goal.transport-worker |
| near | build | goal-confirmed | 1 | 1 | 6855 | goal.build |

每步需要对应goal的正式准入、实际SDK应用后的onCommand owner/scriptId/命令原文，以及该步自己的真实世界效果。船到达、真实装船后在目标陆块卸载、指定原生尸体、精确声明厅完成分别验证；相同参数的旧脚本命令不能冒领。原runtime/sdk流逐事件与原result中保存的nativeApplications完全相同；重复gateway/SDK提案不能代替物理完成。[逐步骤与SDK核验](ship-73d777cd.native-ownership.json)。

| 变体 | 集结命令 | 调船命令 | 运兵命令 | 清营命令 | 运工命令 | build命令 | hold命令 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| far | 10/t150 | 15/t225 | 147/t2205 | 232/t3480 | — | — | — |
| near | 8/t120 | 83/t1245 | 14/t210 | 116/t1740 | 311/t4665 | 411/t6165 | — |

上述为首次同代goal命令的think/绝对tick。首build的建筑种类、精确坐标、工人、预算和实际付款以原命令及独立审计为准，不能拿任意farm命令算岛厅。

| 变体 | 部队登船 | 部队上岛 | 清营完成 | 工人上岛 | 岛厅完成 | 原物理检查 |
| --- | ---: | ---: | ---: | ---: | ---: | --- |
| far | 2208 | 3077 | 3652 | — | — | 运兵、清营通过；运工、厅未通过 |
| near | 241 | 961 | 1847 | 6161 | 6845 | 四项通过 |

物理里程碑来自原生逐tick tracker，时刻相对初始tick1；owner原member和SDK应用使用绝对tick。两种时钟保留各自值，不混成同一帧。[原执行结果](ship-73d777cd.execution.json)。

远船原时限8400已走过运兵、原生清营，但全程没有运工或建厅命令。原末帧transport-worker显式前置均met，动作仍waiting-facts，顶层理由为selected-exact-actions-reenter-search；下游build等待真实worker-at。该原片和7485原片已交32，不能把有余预算或粗链存在当成执行成功。原far进程exit1、near exit0均完整保留。

## 中央付款ACK与目标承诺边界

近船原6300/6855/8400三帧plans为空，同v46 goal.build仍active/await-foundation，goalOutputBindings为空，厅预算400仍reserved/paid0，且没有hold执行。这是本次真实题库的中央ACK缺口；严格五步只证明同goal实际SDK命令及声明位置的真实厅完成，不能代替中央付款/目标承诺完成。32的原帧只读收据SHA为`5ea12bcc8d40396aa69c2e01114acae7483680db54881e3a0b68ffc302be054f`，未调用规划器或模拟。23已独立核原6180→6300的goldSpent从1971增至2371，恰付400；现金409→49之间另有40收入，不能将360现金差当成本。真实地基与命令坐标一致。原生付款已发生、中央账本仍未ACK，两项并列保留在[资金审计](ship-73d777cd.economy-audit.json)。后续bbee修复没有热换进本轮。

## 留守边界：只读记录，不增加断言

| 变体 | 首完整厅观察 | 首厅后hold命令 | 首厅后hold执行 | 首当前可用garrison-ready met | 含hold执行帧数 |
| --- | --- | --- | --- | --- | ---: |
| far | — | — | — | — | 0 |
| near | 457/t6855 | — | — | — | 0 |

[留守原观察](ship-73d777cd.garrison.json)保留实际hold状态、garrison-ready事实/availableTick及附近存活战兵的位置、订单和距矿点距离。300距离只用于列出附近兵，不是新加的原生驻防阈值。五步通过不自动证明持续留守或整个目标义务已完成。 37独立使用固定73d原生组件纯读，四名原步兵在6165/6300/6855/8400均存活于目标land2、距矿42.595–102.810且订单idle；只证明物理在岛，不代替持续guard证明。[同代建厅与在岗兵审计](ship-73d777cd.domain-audit.json)。

## 冷帧、预算与原进程

| 变体 | K | 原计划判法 | 末3次结构稳定 | 首可执行think |
| --- | ---: | --- | --- | ---: |
| far | 20 | 通过 | True | 5 |
| near | 20 | 通过 | True | 4 |

价格、地形、单位、钱和营地未改，原far/near快照SHA仍为`4f1552e780c76a2d1966646470b744de73436eeb452368df74e1ae4ee28e8a78`、`e457c849ed51985dcfc184fc02101edc09fd274788b782f26a563fe455a39cea`，原JSON字节相同。冷帧始终tick1、memory按think传递。结构比较仍为末三次种类/顺序/依赖/单位集合；数值发布变化单列，未把时间或坐标变化视为换方案。近船末三次有19项数值差异，远船为0；[结构与数值变化原表](ship-73d777cd.structure.json)保留全部变化。

| 模式/变体 | think数 | queue总work | critical-route | existing-field | background-field |
| --- | ---: | ---: | ---: | ---: | ---: |
| cold/far | 20 | 61636 | 11500 | 16366 | 33770 |
| cold/near | 20 | 67901 | 10888 | 8212 | 48801 |
| runtime/far | 560 | 1330688 | 541945 | 69862 | 718881 |
| runtime/near | 560 | 1116495 | 292445 | 46143 | 777907 |

1160份receipt均逐项核services相和=used≤6144。search work合计同think回归，expansions保留最后continuation累计值，depth/limitReason原样记录，几何工作不充搜索。原报价、精化first known/exact/ready、模型观察和前缀资源账本在[指标](ship-73d777cd.metrics.json)及artifact原表；campModelUsage是报价观察，不能当战斗次数。

| 变体 | 原进程退出码 | 本变体6项：过/败/跳 | authority峰值 | 超262144B次数 |
| --- | ---: | --- | ---: | ---: |
| far | 1 | 4/1/1 | 38764B | 0 |
| near | 0 | 5/0/1 | 63866B | 0 |

根/tools-ai tsc、SDK7、结构9、步骤7预检均exit0。两个独立单worker原进程的argv、原Vitest JSON和退出码完整保存；派生汇总只取各自6项，不重复统计另一个变体的pattern跳过项。未跑全量src或其他题。原物理失败与严格归属失败不相互替换。[完整验证](ship-73d777cd.validation.json)。

[完整证据指针](ship-73d777cd.evidence.json)：SHA`feacc51683ebe210321bb2f08cc3c05ddf827d536f045421051e251a98a7e030`，252848729B，存储端字节/SHA已核。含560×2原member、SDK应用原流、before/after memory、原账本与全部只读脚本。源码归档`archive/public-puzzles-ship-73d777cd-source-20261021`，PR仍draft，不合并。
