# rules3 stage10：cache builder 分派候选拒绝记录

候选 `77be19f73578ab8d2f6efa0c6f727e3884c63cf1` **REJECTED_NOT_ADOPTED**。两轮独立固定ABBA块均值均回退，八个计时臂pooled mean **+1.086668862%**，四对有三对变慢，p99变差。较低max和已通过正确性完整保留；这些不足以建立总体收益。无候选产品PR或合并，整局目标 **p99≤16ms / max≤50ms 仍FAILED**。

## 正式两轮与全部不利观测

base为 `0ea5beaee063c8443d66f7654333032b070d51ad`。每轮A1→B1→B2→A2，另加Bplain；共10个完整14,400tick进程。外层2026-10-15 02:45:23.555661–02:54:46.692847 UTC，563.137851603秒、exit0。收益池仅四A/四B，各57,600原样本；Bplain单列。

|whole指标|A pooled|B pooled|
|---|---:|---:|
|mean|3.5601419801909633|3.598828934531254|
|p99|26.212288000002445|26.740300000001298|
|max|93.41073699999993|82.46154200000001|
|over16|2789|2842|
|over50|23|27|

两轮块mean delta分别 **+1.398097% / +0.775626%**。四对为 **-0.055958% / +2.908918% / +0.912578% / +0.637150%**。mean与p99回退、>50ms次数23→27，与max93.410737→82.461542ms一起阅读；未删除首tick、慢样本或不利分钟。

sim mean **2.727593776→2.762367897ms**，AI mean **0.813415182→0.817510326ms**。全部cold tick0、七个指定ticks、所有>50ms原样本、13份稀疏memory及12分钟分布随原review保留，nearest-rank=`ceil(n*p)-1`，无离群点删除。

r1-Bplain独立whole：mean3.545018604、p9926.018213、max93.489466ms，>50ms 6次。plain的未测分项零值不能解释成无成本。

r2-Bplain独立whole：mean3.451246842、p9925.486423、max76.625742ms，>50ms 6次。plain的未测分项零值不能解释成无成本。

全部10份完整commands为618,189B，SHA256 `771222bde4c8d2c0a46a97313563ad2b5de1d52ed92fb2d3c70511ff2276c997`；14,400frames/612nonempty、rules3/checksum18、最终`7d94a5e8`。每臂完整241份original source inputs认证；不能用最终checksum替代source或commands全文比较。

## 源码、正确性与保留的原失败

候选只改terrain.ts的cache builder miss dispatch；ordinary field/next仍完整建立，不引入field.next延迟。grow、growBoxInto、nextStep、createRuntime原函数完整字节保持。原private/public proof用4个实际module完成1,877 comparisons，覆盖AA校准、AB混合hit/miss/eviction/reuse、identity、shared-backed views及overlay/COW别名图。原测试记录26files/204passed、SDK原单文件7tests，按原记录分别列示，不擅自相加。typecheck、Vite build与68份public输入/输出、89个manifest assets完整验证均保留。

首次AA proof工具发生跨realm原型canonicalization错误，在candidate比较前失败；首次失败命令、stdout/stderr与分类保留；后用host Array.from和明确realm校准修正工具，最终harness全文同行归档。两次sparse缺输入失败也保留：第一次缺配置依赖tools、零测试加载；第二次203pass但一个原边界测试缺scripts输入。补齐全部原non-docs package输入后通过，未修改原断言或候选来掩盖失败。

实施验证的`VALIDATION.json`中native/V8/cold未执行及performance未评估，是当时快照。随后两轮正式native与02:56:09 UTC拒绝决定独立保留，不回写早期状态。本阶段在负向native结果后没有追加cold timing、微基准或V8实验以重新选择结论。

## 选择来源与证据边界

`sea-field-light-v1`仅保留原6990消费路径、V8及既有资料的LIGHT来源/引用和命令ledger。其外部历史raw按固定[Stage9档案](https://github.com/shuxueshuxue/sketch-rts/blob/ea30afc9a121c0a502af3309daa99c990c563594/docs/performance/rules3-stage9-lazy-tile-fields/README.zh.md)及原source-references路径/hash查阅；这些不是新增Stage10性能样本。未验证Next原件或未实现geometry工具不并入本scope，也不宣布其收益。

本scope仅11个指定原目录，以及本候选/base的便携commit/tree/唯一changed blob和patch；不改任何旧scope。完整准备、实施、AA/sparse失败、10臂raw、两轮/combined独立review、拒绝决定、原controller/review/aggregate及执行barrier/argv/cwd/UTC/exit全部逐文件保留。`combined-v1/decision.json`明确纳入库存。

库存按2026-10-15 02:56:32.360783 UTC准备快照与03:04:55 UTC首批捕获固定；共享review-tools目录只纳入当时5个原文件。03:13:51 UTC新增lazy-whole-next-plan.prepared.json属于下一候选未执行source-only计划，排除于Stage10库存与分析结论。

## 归档复现与限制

使用既有schema3 lossless gzip与显式canonical/alias。去重前对完整bytes逐块比较；最终验证所有stored/decoded SHA、原件全文、精确库存和支持文件pins。便携Git decoder按真实object header认证两个commit和241-source图，不依赖候选分支发布。

```sh
python3 verify.py --out . --verify
python3 analyze-native.py
python3 verify.py --out . --extract /absolute/new-parent/restored
```

离线统计只读归档，不导入游戏。整局、plain及历史LIGHT资料分列；renderSnapshot是数据抽取，不是GPU drawing或FPS。13份process memory样本不是连续峰值、分配率、retained heap或泄漏测量。未将未知尖峰解释为GC/JIT/OS，固定Sapphire场景不能推广全部地图与硬件。

## 最终归档闭合

**428个完整原路径、263个gzip、165个显式alias**；原件52,268,302 B，unique gzip 13,683,365 B。所有stored/decoded SHA、原件全文和精确库存校验通过。

原四文件SDK实际 **13/14 pass、1个既有Stage5文档命名失败，exit1，32.441352秒**。唯一offender与旧9f3101闭合blob全文相同，新scope未被列为offender；未改旧文档或断言，原stdout/stderr/UTC/argv/cwd/exit保留。SDK执行期间全部六个追加scope SHA不变；后续仅追加receipts与闭合状态。

候选结论 **REJECTED_NOT_ADOPTED**；两轮native回退与较低max共同保留，目标仍FAILED，无产品PR或merge。
