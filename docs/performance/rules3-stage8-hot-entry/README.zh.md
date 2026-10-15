# rules3 stage8：hot entry 拒绝候选证据

候选 `909886a7f61397e1c5fdbbc455eae181072c5a60` **REJECTED**。两轮正式 ABBA 的八个计时臂中，whole pooled mean **3.544055390 → 3.583168227 ms，回退 1.103618%**；p99 **26.066795 → 26.602562 ms**，max **93.085113 → 262.831052 ms**。目标 **p99 ≤16 ms / max ≤50 ms：FAILED**。没有推送该候选代码、开 PR 或合并；本分支仅追加证据文档。

## 源码与正确性边界

base `0ea5beaee063c8443d66f7654333032b070d51ad`，候选仅 `src/shared/terrain.ts` 增加4行，将原 cold body 拆到函数；冻结 working tree clean。完整原始源图每臂241份（238 TS、3 JSON）。归档携带两个原始 commit、23个相关 tree、唯一 changed blob 与 binary patch，`analyze-native.py` 按真实 Git object header 独立认证源码，完全不依赖未发布候选对象库。

原 correctness 已通过40个实际 private-runtime cases、11,544比较字节、24个原测试文件/192 tests（185 regression + 7 SDK）、typecheck 与 production build。冷函数体1,153字节及逆重建证据保留。额外 cold stack frame 会改变 Error.stack 文本；不声称任意 Proxy/全局原型改写等价。所有原断言未改。准备时标记“尚未运行”的文件是当时快照，后续完成记录独立保留。

## 正式 native 全部结果

两轮均 A1→B1→B2→A2，另加 Bplain，共10次完整14,400 ticks。收益池仅4A/4B，每侧57,600样本；两份 plain 独立保留。正式外层窗口为2026-10-15 01:12:29–01:21:50 UTC、560.2846秒，两轮 exit0；原 barrier、preflight、argv、cwd、stdout/stderr、UTC、exit 均随档。

| whole 指标 | A pooled | B pooled |
| --- | ---: | ---: |
| mean / ms |3.544055390|3.583168227|
| p99 / ms |26.066795|26.602562|
| max / ms |93.085113|262.831052|
| >16 ms |2732|2776|
| >50 ms |22|24|

四对 mean delta 依次 **−1.823420%、+2.887224%、+2.866446%、+0.665813%**。三对回退，全部首 tick、每分钟统计及慢 tick 保留；nearest-rank=`ceil(n*p)-1`，删除离群样本数为0。262.831052 ms尖峰成因未知，不能直接归为GC、OS、JIT，也不能由trace deopt记录数解释。

两份 Bplain 分别 mean **3.441740429 / 3.538875808 ms**、p99 **25.476403 / 26.754114 ms**、max **108.083091 / 105.735086 ms**、>50 ms **2 / 8次**。不混入计时池；plain探针关闭的分项零值表示未测，不表示无成本。

10份正式 commands，以及独立2份trace commands，全字节相同：**618,189 B**，SHA256 `771222bde4c8d2c0a46a97313563ad2b5de1d52ed92fb2d3c70511ff2276c997`；每份14,400 frames / 612 nonempty、rules3、checksum18、最终 `7d94a5e8`。不能以最终checksum替代完整commands或source对照。

## V8 诊断与原失败

V8 A/B各唯一一次原V5完整14,400 ticks，串行执行、native children exit0；trace wall time不进入正式收益池。wholesOf bytecode **445→19**；A已有4条callee inline记录，B为16条；B cold helper仍有19条具名deopt。A445也已低于报告的默认460阈值。inline记录不是调用次数、保留机器码或速度证明；缺少记录不证明没有inline；本阶段没有新增当前base动态调用频率测量。

A首次外部后验工具错误地比较异步hook发现顺序而失败；原失败、旧runner/pins和原顺序完整保留。修正只将全部(path,function)含重数排序比较，独立闭合已保存A，未重跑A，再运行唯一B。三个路径/四函数及原probe边界保持原样。不能把这次工具修正写成原运行首次全部通过。

归档lane首次独立分析另有一个新增错误断言：将单次witness字节和误当作原重复比较计数。30个witness单次合计5,324 B；原11,544计数还包含重复cache检查、overlay与成功accessor。首次exit1、完整source/stdout/stderr及归因保留；修正只作用于新增归档断言，原proof没有修改或重跑。最终离线认证12份source图、12份完整commands、全分布/配对/每分钟/慢样本和完整具名trace行。

## 范围、恢复与限制

原准备、correctness、V8全输出、两轮ABBA原件、两轮/combined review、执行receipt、原wrapper与review/aggregate工具均逐文件lossless归档。manifest中路径以base64记录；相同全文先逐块比较，再用显式canonical/alias去重。所有原文件的压缩与解压SHA、全字节原件比较和精确库存均校验；旧scope与旧对象不回写。

```sh
python3 verify.py --out . --verify
python3 analyze-native.py
# 完整恢复需要原始体积；目标必须是全新目录
python3 verify.py --out . --extract /absolute/new-parent/restored
```

复跑原始实验应先按manifest恢复完整原路径，或单列路径映射，再遵从原command/predeclaration；不改raw、不凭summary重建数据。`analyze-native.py`只读归档、不导入游戏；量化重算不构成新native样本。图形snapshot不是浏览器/GPU drawing，不等于FPS。每运行13份稀疏memory记录不构成连续峰值、allocation rate或泄漏测量；固定Sapphire场景不能推广全部地图/硬件。

SDK归档核验使用原四文件14 tests（7+5+1+1），与候选原单文件7 tests分列。最终真实结果及旧文档归因由`preparation-notes.json`和原执行receipt记录；原断言不改。PR380发布属于独立[生产证据scope](../pr380-production/README.zh.md)，不改变本阶段拒绝决定与FAILED目标。

## 最终归档闭合

**503个完整原路径、349个gzip、154个显式alias**；原件101,986,044 B，unique gzip 20,253,045 B。全部原件与解压canonical逐块全文比较、全部SHA和精确库存校验通过。

原四文件SDK实际 **13/14 pass、1个既有Stage5文档命名失败，exit1，32.132257秒**。唯一offender与旧9f3101闭合blob全文相同；新scope未被列为offender。旧文档及原断言未改，原stdout/stderr/UTC/argv/cwd/exit和精确归因全部保留。SDK执行期间四个追加scope全部SHA不变；随后仅追加归档receipts和明确闭合状态。
