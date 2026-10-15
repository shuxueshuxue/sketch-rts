# rules3 stage7：cached connectivity 完整证据归档

冻结候选 `0ea5beaee063c8443d66f7654333032b070d51ad` 在两次独立五轮 native 评估中，whole pooled mean 从 **3.589228526→3.535270084 ms，减少 1.503344%**。两轮各自合并均值均改善，但四对中有一对 **回退 0.579918%**，plain 运行还出现 **202.566157 ms** 尖峰。整局目标仍是 **p99 ≤16 ms、max ≤50 ms**，本阶段 **FAILED**；不得写成稳定全面提速或目标已达。

本文件封存两轮五臂整局、完整正确性证据与原始聚合/重放。候选代码截至归档准备时仅已提交 [PR #380](https://github.com/shuxueshuxue/sketch-rts/pull/380)，head `0ea5beaee063c8443d66f7654333032b070d51ad`；CI run `38661452635` / job `116183424785` 于 2026-10-15 00:41:22 UTC 开始、00:46:10 UTC 成功结束，全部 34 steps success；截至 00:47:06 UTC main 仍为 618f9f51，尚未合并或部署。后续 release 证据独立追加，不能把本次统计当作已上线回执。旧候选和旧 archive 不回写。

## 固定候选与证明边界

候选 parent 为 main `618f9f5170164aa33d1e21443e86e64fb14d38f8`，runtime A 固定 Map31 `31e4e8ba44c48efbbbf7ec3594c93e7537b6dba8`；B 只改 `src/shared/terrain.ts` **增加 2 行**，复用已有 connectivity 来处理 walk destination。terrain 字节与历史候选 `597d5ef09d2e826464c7d37698c6d4e49ade095c` 相同；其历史 whole 结果混合且未采用，本次重新评估不覆盖历史结果。

候选 terrain SHA256 `da87bde6be0f2067ab5c280fe20df7ab8ff10764b3ffcb201d079dc9a30eee24`，Git blob `d730abf0101d005960ff79f23c573675820f9b56`。每个 native 臂均有 **241 份实际 original source inputs**；没有 Stage6 bake 的新增 runtime 文件。冻结时 working tree clean，scope/源码 pins 与验证记录均保留。

正确性 proof 通过 **4,264 cases、136,340 次 public calls、524 个 delayed-tiles cases、12,771 次 complete-state comparisons、3 overlay cases、12 accessor cases**；实际 map setup 分别覆盖 `none`、`groundWholes`、`shoreSpots44`。**136,340 是 public calls，不能改称 assertions 数。** proof 保留原断言，并固定当前 base 的 1,157 份完整 src pins。

26 files、**211 tests** 全部通过，原 SDK boundaries **7 tests** 包含在该范围；typecheck、build、diff check 通过。已有 build exit 0、19.724 s。SDK 使用与本 base 完全匹配的 **9,766 个 docs blobs** 只读 projection，原断言不变，临时 docs symlink 已移除。Stage5 SDK 是另一个范围的 **4 files、14 tests＝7+5+1+1**，不可与本 runtime candidate 的单文件 7 tests 混写。

## 两轮正式 native 与合并结果

每轮 A1→B1→B2→A2，另加 Bplain，共 **10 次完整 14,400-tick native**。主收益池仅含 4 个 A runs、4 个 B runs，各 **57,600** 原始 whole 样本；两份 Bplain 按预声明独立保留，不混入收益池或 planning 分类。

| whole 指标 | A pooled | B pooled |
| --- | ---: | ---: |
| mean / ms | 3.589228526 | 3.535270084 |
| p99 / ms | 26.804291 | 26.045541 |
| max / ms | 116.333262 | 101.423102 |
| >16 ms 次数 | 2,799 | 2,722 |
| >50 ms 次数 | 26 | 24 |

| 评估块/配对 | mean B 相对 A |
| --- | ---: |
| round 1 pooled | −2.315597% |
| round 2 pooled | −0.693224% |
| r1 A1→B1 | −1.997355% |
| r1 A2→B2 | −2.635683% |
| r2 A1→B1 | **+0.579918%（回退）** |
| r2 A2→B2 | −1.937467% |

合并的 12 个分钟块中仍有 3 个变慢：0-based minute **0 +8.218903%**、minute **1 +1.465020%**、minute **6 +0.157258%**。首 tick、全部慢样本、每分钟结果和有利/不利配对全部保留；nearest rank 为 `ceil(n*p)-1`，未删离群样本、未为了改善结论重选 baseline 或合并方式。

全部 **10 份 commands 全字节一致**：618,189 B，SHA256 `771222bde4c8d2c0a46a97313563ad2b5de1d52ed92fb2d3c70511ff2276c997`；每轮 14,400 frames/612 nonempty frames，rules **3**、checksum schema **18**，最终 checksum **`7d94a5e8`**。各臂 241 份 original inputs 与 Git/current/归档字节闭合。不能仅凭最终 checksum 宣称完整命令或 source 一致。

## 必须保留的尖峰与局部改善

**r1 Bplain tick 3360 max＝202.566157 ms，p99＝26.076570 ms，mean＝3.578999518 ms，>50 ms 共 3 ticks。** r2 Bplain max＝77.133431 ms、p99＝26.057652 ms。前者显著尖峰不能因为 plain 不进收益池而在文字、图表或附件中消失，也不能在没有因果证据时归为 GC/JIT/OS。plain 中 owner/sim 等探针关闭时的零值表示未测，不是成本为零。

四个计时 B runs 的 tick 5280 分别 **10.289085、14.620232、10.120360、11.830214 ms**；都低于四个 A runs 的 **51.698170、53.911762、62.438917、53.320780 ms**。这支持该固定 tick 的局部改善，但不能用它代替 whole 分布、其它 tick 或完整目标检查。B 的首 tick 仍分别为 95.522368、78.373192、98.895290、101.423102 ms；tick 6990 也没有一致同幅改善，完整数据均保留。

池内 B max 101.423102 ms 只描述预声明收益池，不能概括全部 B 原始观测的最大值；若描述全部十轮，须同时明确包含 plain 的 202.566157 ms。

## 方法、限制与首次资料分类

本次使用原 v5 production native caller，固定 Sapphire 房间、14,400 ticks；不改 AI phase、船规则、规则 3、checksum cadence 或原断言。whole 围住原 tick，currentSnapshot/renderSnapshot、命令序列化/哈希观察器和写盘另计。otherSnapshot 与 renderSnapshot 有重叠，不能相加。renderSnapshot 时间不是浏览器/GPU drawing，不等于 FPS。

每次运行只留 13 个稀疏 process memory 样本，不是连续峰值、allocation rate 或泄漏测量。固定场景不能推广为全部地图/硬件/浏览器的收益，也不能把不明尖峰直接解释成调度、GC 或 JIT。两块均值改善和三对改善应与 adverse pair、adverse minutes、plain 尖峰、目标 FAILED 一起阅读。

`preparation.json` 中 proof/tests/build pending 和仅授予 correctness 的说明是准备时快照；最终 `manifest.json` 记录后续验证完成。历史候选未采用、本次 preparation、proof、两轮正式 raw 和聚合重放各有独立来源，不能把后续通过回写成旧尝试当时已成功。

combined 首次聚合由 root 的 inline Python 生成，原文件保持不变；后续固定 `aggregate.py` 独立重放，`replay-closure.json` 记录除 clock metadata 外全部 substantive results 等价。这个重放是统计复算，不能冒充新增 native 样本或第三轮评估。本归档 lane 没有重跑 game proof、build 或 native；它从全部归档 raw 独立复算统计、源码/commands 和原 proof 的完整 semantic projection。

## 证据范围、复现与发布边界

| 原证据目录 | 作用 |
| --- | --- |
| `cached-connectivity-validation-v1` | 冻结 candidate/source closure、完整 proof、tests/build/typecheck 命令和输出、SDK projection provenance |
| `whole-performance-abba-31-cached-connectivity-r1` | 第一轮五份完整 native raw、commands、sources、环境和执行记录 |
| `whole-performance-abba-31-cached-connectivity-r2` | 第二轮五份完整 native raw、commands、sources、环境和执行记录 |
| `cached-connectivity-native-review-r1` / `-r2` | 各轮独立 review、source/command checks、全部慢 tick 与稀疏 memory |
| `cached-connectivity-native-review-combined-v1` | 首次合并统计、全部十轮 special/slow samples、pair/minute 结果 |
| `cached-connectivity-native-review-combined-replay-v1` | 固定脚本重放输出 |
| `cached-connectivity-native-review-tools` | `aggregate.py` 与 replay closure |

先按最终同 scope manifest/alias 表恢复完整逻辑路径、candidate/base Git blobs、原 inputs、工具和 raw；再按 validation 的原 `*-command.json` 和各轮 wrapper/predeclaration 复现，保留原 argv、cwd、运行顺序和边界。proof 原入口为其 tools 下 `proof.draft.mjs`，测试/build 原命令见 manifest，不在文案阶段触发重跑。

聚合复算入口是 `python3 /tmp/cached-connectivity-native-review-tools/aggregate.py <全新输出目录>`；脚本要求输出目录不存在，并读取两个固定 r1/r2 原路径。离线恢复时应先恢复这些输入路径，或独立记录路径映射的适配，不改 raw。它会核对十份完整 commands，并保留 Bplain、nearest-rank、全部慢样本和原配对身份；其运行应由根代理串行安排。

新归档须携带完整 proof/state/oracle、10 份 native raw、241-source 全文、命令全文、环境/执行日志、1 个 changed Git source blob、commit/tree/patch 和聚合工具。允许对全字节相同 payload 用明确 canonical/alias 去重；不得删断言、尾部、失败记录、plain 慢样本或用 summary 替代 raw。最终数量和体积见 `manifest.json`，源码/Git/command/typed-data 的独立结果见 `analysis.json`，完整原件与压缩读回见 `verified-closure.json`。

**代码发布边界：PR #380 已打开、CI success，尚未 merge/deploy（截至上述归档准备状态）。** 合并、CD 与生产核验若随后发生，将以新记录明确其 UTC 时点，不改原始性能数据。整局目标依然 FAILED。

## 归档实现与本 lane 的验证边界

采用 schema 3 的完整文件 lossless gzip，每个原始路径、原件 bytes/SHA256 都有索引。相同完整 bytes 先直接逐块比较，再以显式 alias 引用 canonical payload；不会截断 source、typed arrays、commands、失败日志或不利样本。`verify.py` 检查所有压缩/解压 SHA 与精确库存，可在保留原件的环境用 `--compare-originals` 将每份原件和解压内容逐块全文比较。安全恢复须指定全新目录，拒绝越界、symlink、未知 alias、重复 canonical 等；正例和 8 个拒绝案例均实际通过。

```sh
python3 verify.py --out . --verify
python3 analyze-native.py
# 若需要完整安全恢复（会产生原始解压体积）：
python3 verify.py --out . --extract /absolute/new/empty-parent/restored
```

`analyze-native.py` 只读取本归档，不导入游戏、不依赖未推送 candidate Git objects。4 个 raw commits、30 个 raw trees、完整 17/1 changed blobs 和 patches 同载，逐个源码按真实 Git object header 认证。所有 native command 全文对照固定旧 Map31 原 oracle，保留 rules3/checksum18。完整早期/最终实际 map state JSON 与 typed-value graphs 原件均保留；Stage7 的 early deferred `tiles`/`groundTiles` 是原 proof 的明确合同，不能误称早期 private 图毫无差异。

本 lane 首次 Stage6 复核误把 `source-inputs` 当作已变换的 onLoad TS；实际它是变换前 originalInputs，三个 source archives 的 JSON 全文一致，instrumentation 由完整 helper、精确 hooks 与最终 bundle 单列认证。首次 Stage7 复核误要求 early deferred private tiles 图全等；修正为原 proof 完整 semantic projection，并另外核验/保留仅有的 early cache differences 及最终 required-tiles fingerprint。两次本 lane 错误断言的原 source、exit1、stdout/stderr 全部封存；没有降低任何原游戏测试或 proof 断言。

文档归档的最终 SDK 检查使用原四文件命令（7+5+1+1＝14 tests），与 runtime candidate 原单文件 7 tests 分列。它验证 evidence branch 的 SDK/启动与新文档边界，不构成新的 runtime 性能样本。准确 argv、cwd、UTC、exit 和完整输出随本 lane receipts 保留。

本 lane 最终 SDK 四文件命令的首次实际结果为 **13 passed / 1 failed（14 total）**，耗时32.192416秒；唯一失败指向旧 `9f3101` 的 `rules3-stage5-integer-kernel/preparation-notes.json` 中受原规则禁止的清理时代命名。已核对该旧文件与闭合 Git blob 全字节相同，本次从未修改。新 Stage6/7 没有被列为 offender。原断言、首次 stderr/exit1 和归因记录全部保留；没有为了获得通过而跳过旧文件或降低断言。该项是既有归档文档问题，不能写成新运行时测试失败，也不能宣称最终14全过。

## 最终归档闭合

本 scope 共 **386 个原始路径、278 个完整 gzip、108 个显式 alias**，原件合计 **58,012,818 B**，unique gzip **14,586,750 B**。全部原件与解压 canonical 逐块全文比较，所有 stored/decoded SHA、支持文件与精确库存另由 `verified-closure.json` 记录。独立认证 11 个源码图（共 2651 份完整源码记录）和 11 份完整命令；包含旧 Map31 reference，Bplain 独立保留。

最终四文件 SDK 首次实际结果 **13/14 pass、1 个既有旧 Stage5 文档命名失败**，原命令32.192416秒；原失败和精确归因全部保存，未改旧文档或任何断言。全部新档案在这次 SDK 执行期间 SHA 不变；随后仅追加 receipts 与明确的闭合状态。该 SDK 失败不影响原 runtime candidate 已完成的正确性测试结论，也不能被隐去。
