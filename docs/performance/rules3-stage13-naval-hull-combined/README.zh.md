# Stage13：naval pruning 与同次 hull endpoint carry

本scope归档原standalone23b正确性、1cf组合两轮完整native与cold24及其独立读回；本轮归档没有重跑游戏或性能实验。[Stage12固定归档](https://github.com/shuxueshuxue/sketch-rts/commit/a02899e4542336ba5cb44bdbf14e7fcddd889ef5) 保持独立。本阶段区分standalone23b正确性与1cf组合实测，不能把组合结果拆给单项。

**当前未采用，无产品PR、push、merge或deploy。** 整局p99≤16 ms、max≤50 ms目标仍失败；profile/tail归因未闭合。独立cold attempt02已PASS；当前root决定为HELD_PENDING_FOCUSED_TAIL_ATTRIBUTION_NOT_ADOPTED。较早pending决定和原draft逐字节保留。

## 三个源码版本

| 版本 | HEAD | 241输入总字节 | manifest SHA256 |
|---|---|---:|---|
| 实际0ea基线 | `0ea5beaee063c8443d66f7654333032b070d51ad` | 2,811,947 | `1e7fd434649c758e9ff720d42f2e789858d0197972e0ca6e2150e57e209731c1` |
| standalone naval23b | `23b09f4ce6618c286a26545b422bb89f21ddc69f` | 2,813,927 | `d03ffc8871a1d0a08714e602faf8e5d15dbd1edb1218542a242b7b18facd1ced` |
| naval＋hull组合1cf | `1cfcc0e418930d5c38925f94b4793554a526f2b6` | 2,814,144 | `f8a12b41c721c44905ca9e6e4b56dd3b9088dec764c174c28c2d070b9d802015` |

23b仅改naval-mines及其永久测试；1cf在23b之上增加ship-navigation同次循环端点复用及永久测试，naval生产文件保持23b完整原字节。各版本Git/live/实际build及0ea原native来源按原source closure分列。源码审查、专项proof、父车道整局和冷测属于不同证据范围，不能相互替代。

## standalone23b：正确性完成，未运行native

实际完整模块AA/AB校准覆盖120 fixtures、240组cold/warm比较和729次choose；公开选择、原对象身份、异常及输入字节一致。其后14,244次public distance查询一致，跨阈值后128个保留field完整payload一致。30文件、283项回归（含16项新增永久测试）、候选阶段原SDK7项及原tsc/Vite build通过。

direct cold正确性fixture确实由3个goal field变1个，并新增wholes构建；它不是实际6990的B miss数或时间测量。剪枝允许pure-derived membership、LRU/spare及未来cold位置改变，不允许placeholder、partial或min-of-goals field。异常/fallback、完整origin集合、稳定tie和后续实际消费仍保留原合同。

**23b standalone从未native计时**，也没有standalone cold/profile收益。原6990的4项必算与8项跳过是实际原输入上的反事实判断；后面的组合6990改善不能单独归因于23b。

## 1cf组合正确性与失败保留

完整navigation模块proof-v2为874 cases、2622 calls，比较完整有序polygon、实际pose、输入不变、返回/异常及有意carry身份；包含1248实际segments、66多段calls、49早退前缀、10个NaN零循环和4个原异常。实际消费中仅省去重复pose/outline构造，原convex/expand/clear序列保持。省去各1133次构造不是CPU收益；原9375的2980端点标量重复也不是完整顶点重放。

58文件、721项回归为**717通过、4失败**；四项在原0ea定向复现，完整stderr3014 B逐字节相同，双方exit1、test/assertion和日志原样保留，不写成全部通过。新4项永久测试、候选阶段原SDK7项及原build另外通过。初版proof与补强v2分别保留；较早独立审查中的873-case结论保持其时点，最终874-case记录不回填旧报告。

实现验证报告中的“未执行native/cold”仅描述该车道封口时点；父车道随后完成下述组合实测，不反向赋予standalone23b性能数据。

## 两组ABBA与Bplain

两组均为固定 `A1 B1 B2 A2 Bplain`，共10次完整14,400 tick。A/B同探针性能池各57,600 tick，Bplain不入池；保留tick0、所有最大值和慢tick，无筛除或替换。完整618,189 B命令、初始snapshot、原probe、最终checksum `7d94a5e8`、rules3/checksum18及原AI相位闭合。

| whole指标 | A | B |
|---|---:|---:|
| mean ms | 3.580605 | 3.514492 |
| p99 ms | 26.586027 | 26.025644 |
| max ms | 88.248036 | 107.818852 |
| >50 ms次数 | 26 | 22 |

合池mean变化−1.8464%，两组分别−3.0456%、−0.6391%；四配对中仍有一项+0.3187%。首分钟mean **+10.9386%**，第1/10/11分钟也变差。非规划>50 ms由**6→8**，最大值变坏；总>50次数减少不能覆盖这些反例。

6990在联合样本中改善，9375没有一致改善；5280有3/4个B hook样本约15–16 ms，对照A约10 ms，需继续取证。B最大值为r2-B1 tick0的107.818852 ms；同局1859为87.151949 ms，10950为84.146359 ms。以上inclusive wall观测不归因于JIT/GC或单个优化。

| 独立plain | whole mean ms | p99 ms | max ms | >50次数 |
|---|---:|---:|---:|---:|
| r1-Bplain | 3.649060 | 27.807289 | 84.937561 | 9 |
| r2-Bplain | 3.547379 | 26.259336 | 84.439451 | 2 |

没有Aplain；不能以plain与hook的差异作额外AB收益。Bplain无sim/AI hooks，原始0表示未测量。每局13个稀疏memory点不是峰值、allocation rate、retained heap或leak证据；没有一致内存下降结论，external与arrayBuffers不能相加。

## cold24：原运行与独立数据读回完成

原runner已完成6块ABBA、每arm12个fresh Node进程；原summary报告初始／完整首帧／tick1字节一致，未移除样本、未重试。下表原summary统计已经后出的独立reader及本scope离线重算核对：

| 冷测边界 | mean ms A→B | max ms A→B |
|---|---:|---:|
| 首次native tick | 90.757622→87.045585 | 101.745512→98.664092 |
| import至首tick连续区间 | 390.037561→381.506210 | 406.927658→400.441072 |

每arm仅12次，nearest-rank p95/p99等于样本最大值，不证明总体尾延迟SLA或整局16/50目标。OS缓存不受控；build、连续区间和parent wall边界分开，不能据此归因JIT/GC或把减法解释为纯launcher成本。

冷测工具的初始prepared/PENDING是准备时状态；实际绑定与24次执行分别留存。独立reader首次因错误读取 `execution.json.argv` 而失败，分类为 `READER_SCHEMA_ERROR_NOT_GAME_OR_COLD_DATA_FAILURE`：argv实际在command.json。首次源码封存、完整失败日志及exit保留；修正仅读取位置，数据/源码/语义/计时门不变，不重跑cold或引擎。后续attempt02已PASS，同一批24样本未改写或重跑；首次完整source与错误日志保留。

## 决策时态与来源

`decision-native-only.json` 的 `PROMISING_BUT_COLD_UNRESOLVED_NOT_ADOPTED` 及 `decision-at-cold-cutpoint.json` 的 `HELD_PENDING_COLD_INDEPENDENT_REVIEW_AND_FOCUSED_TAIL_ATTRIBUTION` 均保留原时态。后续decision-after-independent-cold.json已追加：HELD_PENDING_FOCUSED_TAIL_ATTRIBUTION_NOT_ADOPTED。profile/tail未闭合、目标仍FAILED。1859/5280/10950的后续归因准备记录不等于已执行诊断，也不是采纳性能数据。


## 最终状态补充：独立冷测通过，仍待尾部归因

本段依据后续实际记录更新当前状态；较早draft、native-only决定及cold-cutpoint决定中的“reader待执行／进行中”均保留为当时截点，不能当作当前结论。

2026-10-15 04:50:05 UTC的 `decision-after-independent-cold.json` 明确决定为 **`HELD_PENDING_FOCUSED_TAIL_ATTRIBUTION_NOT_ADOPTED`**：`coldIndependentReview=PASS`，`nativeTargetPassed=false`，`candidatePrPushMergeDeploy=false`。冷测独立核验通过不等于采用；profile/tail归因仍未闭合，无产品PR、push、merge或deploy。较早 `decision-at-cold-cutpoint.json` 的pending状态与冻结native决定原样保留，不回写历史。

### cold attempt01失败与attempt02通过

`report-v2.json` 已完成，状态为 `INDEPENDENT_RAW_BYTE_SOURCE_AND_ARITHMETIC_READBACK_PASS`，reader源码在执行前封存。attempt01因错误从最小execution记录读取argv而失败；实际argv属于command.json，分类为reader schema错误，不是游戏或cold原数据失败。首次源码、seal、原stdout/stderr、退出及执行记录保留。attempt02仅改同一argv断言的读取位置，核对同一批24个原样本；`priorAttempt01Preserved=true`、`noColdRerunOrSampleChange=true`，没有cold重跑或样本修改。

独立回算确认首tick mean **90.757622→87.045585 ms（−4.0901%）**，max **101.745512→98.664092 ms**；连续import至首tick mean **390.037561→381.506210 ms（−2.1873%）**。六块首tick均值为四块改善、两块变差，全部24次与不利块保留。每arm仅12次，nearest-rank p95/p99等于样本最大值，不是总体尾延迟SLA；不能借cold结果宣称整局16/50目标通过，或归因JIT/GC/OS。

### 组合收益与不利尾部仍须分列

两轮整局 `A1 B1 B2 A2 Bplain` 及cold24均属于 **1cf组合候选**；不是23b standalone或hull单项的性能数据。23b仍从未native计时，不能拆算6990等焦点的单项收益。Bplain继续独立列示，无Aplain，不用plain/hook差异制造额外AB结论。

整局合池mean虽为−1.8464%，但B whole p99 **26.025644 ms**、max **107.818852 ms**，原目标仍FAILED。首分钟mean **+10.9386%**，非规划>50 ms **6→8**，tick5280与其他保留尾部反例未被冷测通过消除。1859/5280/10950的后续聚焦归因是下一步，不放宽目标或删除慢tick。

### proof计数的时点和口径

| 原报告时点 | cases | module calls | 实际segments | steps1 | 完整polygon比较 |
|---|---:|---:|---:|---:|---:|
| 较早独立审查保存的proof | 873 | 2619 | 1247 | 37 | 4665 |
| 实施车道最终proof-v2 | 874 | 2622 | 1248 | 38 | 4670 |

873来自 `executed-proof-summary.json` 的旧artifact；874来自最终 `VALIDATION.json.proofTotals` 与实施报告。两份原件分别保留，不把新数字回填旧报告。回归仍为717通过、4个与0ea完全相同的失败，不改称全部通过。

原9375诊断中的 **137** 是 `actual-capture-summary.json.allHull.projectionOnly.positiveExecutedCalls`：272次hull调用中有实际执行segment的调用数。该原捕获另列3117个segments及2980个相邻端点重复；它不是137次native整局、proof用例数或候选重放。该处6234→3254与少2980次pose/outline是 `projectionOnly` 推演，不能当作B实测或时间收益。实际完整模块proof另有上述独立覆盖与有意私有alias变化的证明边界，均不冒充原9375全顶点重放。


## 归档闭合与限制

库存截点 **2026-10-15T04:55:07.168004+00:00**；完整保留1,330份冻结原路径及所有字节，后续profile输出没有混入本scope。便携源码仅0ea/23b/1cf三个raw commit、所需27个raw tree，以及standalone两路径和combined四路径Git差异（含两份永久测试）；没有完整树复制。

**1614个原路径，836份gzip，778个显式alias**；原件101,265,210 B，unique gzip 20,505,092 B。stored/decoded/original全文、inventory、alias witness与支持文件pins均逐项闭合。10份完整commands均618,189B／SHA `771222bde4c8d2c0a46a97313563ad2b5de1d52ed92fb2d3c70511ff2276c997`；2410条native source、单独23b build241条、cold build482条以及所有14,400tick相位、cold/slow全文和稀疏memory分列认证。

离线重读重新计算全部整局分布、配对／分钟及所有24个cold样本锚点、统计与完整初始／首帧／tick1字节。正确性部分认证原执行源码、日志及原报告，并重算保存的proof记录算术；原proof只保存部分trace hash，不能从hash独立重建未保存的全field／polygon数组。本轮不重跑Node proof或引擎，也不把这些hash当成全数组重放。原proof专用import图为111／35，完整生产图仍严格241。

本归档适配器首轮误把proof专用图按生产241图检查而退出；执行前封存的原source与失败日志全部保留，v2改为精确111／35并继续严格认证241生产图。早期storage inspector误匹配本地help的可选threads拼写，同样保留失败与修正版；原工具／样本／断言未修改。

原四文件归档SDK实际唯一一轮 **13/14 pass，exit1，33.590562s**；唯一失败仍是原Stage5的8,196B文档命名，其全文与旧9f3101 blob相同。旧文档与完整断言不改；九个追加scope在SDK期间所有SHA不变。候选阶段SDK7另外保存，不能与本14项混算。后续文档／收据仅再作相同精确命名扫描。

四副本预算失败与streaming size/hash测量保留；执行改用工作树／新loose各22MiB硬cap、实际index/lock等reserve及32MiB硬余量，不删旧证据、不硬链、不增加本地pack/spool。Git禁自动gc/maintenance、单线程低window-memory，push以安全过滤Trace2核实际pack-objects --stdout；正常TLS完整下载README/manifest/closure和最大payload并解压认证，最终收据另列。

只读复核：

```sh
python3 verify.py --out . --verify
python3 analyze-native.py
python3 verify.py --out . --extract /absolute/new-parent/restored
```

**归档闭合不等于采用或目标完成；整局目标FAILED，候选保持HELD_PENDING_FOCUSED_TAIL_ATTRIBUTION_NOT_ADOPTED，无产品PR／merge／deploy。**
