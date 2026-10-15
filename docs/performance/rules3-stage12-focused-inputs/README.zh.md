# Stage12：聚焦输入诊断归档

归档范围：`docs/performance/rules3-stage12-focused-inputs`。本稿记录两个已完成的原 `0ea5beaee063c8443d66f7654333032b070d51ad` 诊断：v2 的6990 naval／9375 physical sweep，以及独立的9375 nav-hull；同时收录其工具、预检、源码审查和独立数据报告。**本scope所归档的两个原0ea诊断不包含候选native性能结果，也不构成采用或性能收益结论。** [Stage11 固定归档提交](https://github.com/shuxueshuxue/sketch-rts/commit/50280adb4da54f1d7c4f1de07c931bf1256a34b1) 保持独立。

两次诊断均来自原完整14,400 tick生命周期，保留241个生产输入及完整618,189 B命令原件。两份独立报告分别完成其声明范围内的字节、计数和数据复核；这不等于候选等价证明或 native 性能验收。本轮归档及原四文件SDK14项的实际结果见最终闭合记录。

## 事实一：physical 不支持全面缓存

9375记录 **24次根 sweep、16次 shape调用、16个segment**，不是24艘不同船或16种唯一形状。同根标量输入重复只有两组：根27的shape28/29、根30的shape31/32，各多一个实例，合计 **2个重复实例**。

这个口径限定同根、同ship/profile/hull identity、同segment index及已记录几何标量的binary64位模式。body/polygon不在自身几何等价key中；没有完整vertices或contact alias证据，不能推出完整contact/Minkowski、跨根缓存正确或CPU节省。独立报告明确 `supportsBroadCacheImplementation=false`、`implementationPerformed=false`；少量局部重复不足以支持全面cache。

## 事实二：naval 的4次必算、8次跳过是反事实

6990的原调用保存了完整实际fleet，以及12个candidate**已经算出的**threat和road。该次fleet为1条；每个下界都包含全部fleet成员与该candidate departure，不能只看selected origin。下界使用cell32的floor网格映射、整数直行/斜行代价5/7及原尺度，不能替换为欧氏距离。

在这批实际有限输入及原candidate顺序上，独立算术回算得到：

| 反事实动作 | candidate索引 |
|---|---|
| 仍需road求值 | 6、9、10、11 |
| threat高于最低值而跳过 | 0–5 |
| 下界已不优于当前best而跳过 | 7、8 |

索引7、8的最小下界5568、6336均高于当时bestRoad4819.2。四个仍需求值项的原road依次为4819.2、4025.6、2329.6、1683.2，反事实winner11与原winner一致。

这里的“跳过8个”**不是B实测调用数、cache miss减少量或时间收益**：原调用已经求完12组评分，候选没有执行。报告明确 `candidateWasExecuted=false`、`candidateMissCountMeasured=false`、`timeSavingMeasured=false`。没有逐threat body清单或route/cache事件；已认证的是原评分记录，不是引擎重算或全面正确性证明。

## 事实三：nav-hull 支持窄范围 carry 尝试

9375原输入共272次hull调用、3117个实际执行segment、3次 `planShipRouteImpl` 调用。独立报告直接比较原used-prefix字节中的前段b与后段a，x/y/heading三个binary64值全部逐位相同的邻接对如下：

| 所属范围 | hull调用 | 实际segment | 邻接机会／raw bit-exact对 |
|---|---:|---:|---:|
| 全部 | 272 | 3117 | 2980／2980 |
| plan调用内 | 106 | 2959 | 2869／2869 |
| plan调用外 | 166 | 158 | 111／111 |

plan内外按实际调用栈归属分列，不代表所有AI规划／非规划阶段或search phase。实际m段仅产生 `max(m−1,0)` 对同call相邻机会，不能用名义steps补出未执行后缀。**135次尚未执行subdivision的调用，其steps/error保留null**，预分配0槽不能当作已计算的0；endpoint from失败时to仍为未观察。

这些原始位模式事实只支持评估同一次hull调用内的窄endpoint carry尝试。尚未证明outline/展开后vertices、对象与buffer alias、完整shape或候选返回语义等价，更没有重放、跨call缓存或时间收益证明。计数是原语句实际到达次数；仪表化时长、稀疏memory、记录buffer的used-prefix大小都不是性能或峰值内存验收。

## 来源、准备历史与待完成项

两份独立报告的状态分别为 `INDEPENDENT_BOUNDED_BYTES_AND_COUNTERFACTUAL_DATA_REVIEW_PASS` 与 `INDEPENDENT_EXECUTED_PREFIX_AND_ENDPOINT_BITS_REVIEW_PASS`。checker源码先冻结，再进行各自的独立数值复核；源码审查与二进制数据复核分列，原工具、原载荷及日志保留。

- v2报告：`/tmp/ship-sweep-capture-v2-independent-review-v1/report.json`，附 `collision-source-review.md`。
- nav-hull报告：`/tmp/ship-nav-hull-9375-independent-review-v1/report.json`，附 `source-review.md`。

另保留的naval-only计划／状态及combined prepared记录，仅表示各自历史prepared截点的状态。standalone23b始终未启动native实测；后续1cf组合的两轮native与24次cold已完成，将归独立Stage13。后续结果没有纳入本scope，也不借用为这两个原0ea诊断的候选收益证据。

原有性能目标和候选证明要求不变；归档闭合不等于候选采用或目标完成。

## 最终归档闭合

库存截点 **2026-10-15T04:35:29.909714+00:00**，只包含8个已完成诊断目录、明确列出的原工具/历史语义引用，以及三份未执行prepared-plan provenance。组合proof/cold-prep、23b正确性及后续candidate native均不并入。便携源码对象仅原0ea一个raw commit及认证241输入所需raw trees，没有候选代码对象。

**350个完整原路径、259个gzip、91个显式alias**；原件21,265,736 B，unique gzip 6,633,256 B。全部stored/decoded SHA、原件全文、库存/alias及支持文件pins通过；两图×241本轮source、3份before图和独立历史oracle图分别核对，不冒称额外native实验。

两个原完整commands均618,189B、SHA256 `771222bde4c8d2c0a46a97313563ad2b5de1d52ed92fb2d3c70511ff2276c997`，初始147,891B全文一致、final `7d94a5e8`、rules3/checksum18。离线复核两个14,400tick phase与全部数值buffers、原报告算术，保留所有不利/否定证据。v2原27、nav9375原23及v1来源17个payload均逐项完整认证，原文件不改写。

原四文件SDK实际一轮 **13/14 pass、唯一既有Stage5文档命名失败、exit1、33.103974s**；唯一offender与旧9f3101原blob完整相同，未修改旧文档或断言。全部八个追加scope在SDK期间SHA不变；后续收据/文档更新再扫描相同命名规则，不重复运行SDK。

本轮归档适配器首轮因数值reader context漏传既有sha函数而NameError退出；执行前封存的原适配器全文、失败stderr/UTC/exit均保留。另存v2只补helper binding并明确历史scope元数据，同一批原件离线重读通过；未更改原诊断工具、样本或数值断言。

复现只读归档：

```sh
python3 verify.py --out . --verify
python3 analyze-native.py
python3 verify.py --out . --extract /absolute/new-parent/restored
```

**本scope只有两个原0ea诊断，没有候选native性能结果；2个physical重复实例、8个naval反事实跳过和2,980个实际端点bit对均不是时间收益或全面几何证明。**
