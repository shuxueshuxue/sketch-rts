# rules3 stage5：整数 WASM 距离内核证据归档

整数 WASM 内核候选 `48e3d447e4640bdabbbb32ccc4348da3a40d6789` 的正式整局对照为负结果：两对均回退，合并 whole 均值增加 **2.849918%**，p99、max 和 >16 ms 次数也更差。候选未采用、未提交 PR、未合并、未部署，且该本地提交未推送。当前生产仍是 PR [#379](https://github.com/shuxueshuxue/sketch-rts/pull/379) 的 main `618f9f5170164aa33d1e21443e86e64fb14d38f8`。

用户整局目标继续保持 **p99 ≤16 ms、max ≤50 ms**；本阶段未达标。正确性证明、局部 micro、浏览器能力门禁和主线程 CPU 诊断分别回答不同问题，均不能替代整局收益验收，也不构成生产画面、硬件 FPS 或渲染性能结论。

本目录独立新增，原始实验及失败全部保留。最终封存范围、实际体积、执行身份与SDK检查见manifest.json、verified-closure.json及preparation-notes.json，不给旧实测或旧构建换标签。

## 1. 固定对照与正式结果

A 固定为 Map31 `31e4e8ba44c48efbbbf7ec3594c93e7537b6dba8`，B 为整数内核 `48e3d447e4640bdabbbb32ccc4348da3a40d6789`。A 实际读取 **241** 个 runtime source，B 实际读取 **243** 个，增加的两个 runtime TypeScript 模块也包含在逐字节源码闭合中。不能将 B 描述为 241 个输入，或因旧字段名包含 `actual241` 而漏掉新增模块。

正式顺序为 **A1 → B1 → B2 → A2**，另保留 Bplain 完整运行。每轮 14,400 ticks；下表只合并 A1/A2 与 B1/B2，各 28,800 个原始 whole 样本。Bplain 关闭 owner/sim 细探针，不进入收益统计；其中为零的诊断字段表示未测，不能解释为没有成本。所有五轮目标检查均为 **FAILED**。

| whole 指标 | A：Map31 | B：48e | 判读 |
| --- | ---: | ---: | --- |
| mean / ms | 3.505113427 | 3.605006280 | 回退 2.849918% |
| p99 / ms | 25.961519 | 26.525102 | 两边均未达 16 ms |
| max / ms | 88.217217 | 92.446615 | 两边均未达 50 ms |
| >16 ms 次数 | 1,346 | 1,419 | 增加 73 |
| >50 ms 次数 | 9 | 9 | 未减少 |

A1→B1 whole 均值回退 **2.920900%**，A2→B2 回退 **2.779397%**。12 个合并分钟块的 whole 均值全部更慢；每分钟块按原始 1,200 ticks 划分，再合并两次同臂运行。分位数沿用 nearest rank `ceil(n*p)-1`。首 tick、坏块、迟到停顿和尾部均保留；未强制 GC，未剔除离群样本，未将有利 tick 单独作为采纳依据。

数值依据为 `whole-integer-grow-abba-review/statistics.json`；源码计数和外围启动文件的说明见同目录 `source-count-and-launch-addendum.json`。`statistics.json` 末尾 `limitations` 中保留了“Pair signs disagree; mean improvement…”等旧文案，不能覆盖实际两对均回退的数值结论。外围 launch/wrapper pins 是运行后补录，补充记录明确没有虚构成运行前后审计。

## 2. 完整命令、规则与源码身份

五份正式运行、v11 诊断和旧 Map31 B1，加上v12两份，共 **9 份完整 commands** 按全字节核对；不能用 checksum 相同代替命令全文一致。共同记录为 14,400 frames、612 nonempty frames、完整命令 **618,189 B**，SHA256 `771222bde4c8d2c0a46a97313563ad2b5de1d52ed92fb2d3c70511ff2276c997`，rules **3**、checksum schema **18**，最终 checksum **`7d94a5e8`**。

候选保留原 AI 相位、规则 3、船规则、命令顺序和 checksum 频率。正式 whole 边界仍围住 `runtime.tick`；render snapshot 和观察器有各自边界。诊断分段或局部 owner 时间不能直接替代 whole，也不能把某个 owner 总耗时当成 12 次 grow 的精确成本。

48e 尚未推送，因此本包直接携带 **12 个 changed Git source blobs、原始 commit bytes、binary patch、编译器 lock 与完整实现源码**，并在 manifest 中记录其身份。仅保存本地 commit ID、diff 摘要或再生成命令不够。正式各臂实际 241/243 份输入源码全文及原工具/命令 pins 也必须保留，以最终归档读回核验为准。

## 3. 从 v1 到 v2：证明范围与失败分类

v1 是隔离可行性原型，只验证 10 个小型 fixtures、2,155 个完整顺序事件及最终数组/引用等状态；未接入仓库，未做完整 public runtime、micro、native 整局或浏览器验证。它的 `accepts` 只提供 typed array、长度、独立 backing buffer 和 source 边界等窄检查，未建立生产 ownership 契约，也未覆盖所有 offsets 或缓存后修改。不能把 v1 的通过解释成完整生产 guard 已经成立。v1 所有用例 stale-pop 均为零，名为 stale-pop-open 的用例没有实际覆盖 stale 分支。

v2 的结构是可读 WAT、固定 wabt **1.0.39** 开发工具、生成的 Uint8Array 模块和窄 loader；runtime 不依赖 wabt。生产模块为 **684 B**、无 imports，SHA256 `0598399a780ec462ce12c1c1e72d06ba580441f60e1a69154392d11bd7b9591b`。先做只读 guard 和 lazy 同步准备，再保留原 JS 桶/Field 分配或 spare 复用；setup 失败可走旧 JS，内核运行或复制阶段失败传播，不通过旧 JS 重放掩盖失败。next 仍由原 JS fill，8 桶全长 copy-in/out，原 Field、typed views 和 buffers 保持身份。

最终冻结 full proof 报告 **705 cases、12 个重建真实目标、11,321,286 个完整顺序事件**，并比较最终 Field、完整桶尾部、引用、ownKeys、alias、LRU 和 overlay；dispatch 为 WASM 672、JS 31。另保留原始 A/A 校准 192 cases、943,436 events。合法单源实际走 WASM，指定 blocked/multi/非法/OOB/overflow/shared/Proxy 等走旧 JS；这不是任意私有代理或全局 intrinsic 修改的通用兼容承诺。原 Field.dist 的中间写入延至 copyback，证明结论限于合法无回调域的最终状态和算法事件，不能声称所有原 JS 写事件或异常时刻逐一相同。

首次尝试和修正必须一起保留，并分别分类：

- **初始 full proof 源码 pin 与末次文案/元数据编辑重叠**：其输入 hash 出现不匹配，不能作为干净冻结的证明。保留原 attempt；冻结 02 的完整重证独立记录，不能回写首轮 pins 来抹平问题。
- **32×32 memory.grow 测试失败**：fixture 不足 64 KiB，没有触发目标分支，属于新 harness 的覆盖错误；改为 64×64 后仍要求真实 grow，没有放宽断言。
- **own iterator getter 多读**：属于实现问题；guard 改为用 hasOwn 拒绝 own iterator 并避免提前触 getter，严格测试仍要求原路径只读一次。不能将其归为纯 harness 问题。

v2 记录既有 108 tests 与新增 6 tests 合计 **114** 通过；两份旧 harness 改为 bundle 以加载 helper，原验收断言未修改。生产 build（tsc/Vite/server bundle/boot guard）exit 0、21.834 s。以上是已有运行记录，本归档说明没有重新构建或重跑测试。所有旧 attempts、失败日志、raw、source pins 与旧 manifest 原样保留。

## 4. micro 的收益、冷启动反例与整局未复现

micro 只重建历史 tick 6990 的 terrain/12 个 sea target，以 public caller 做 36 个请求；起点为合成 target cell center，使用 3-module factory，不是完整 native bundle/heap/JIT 历史回放。fresh 和 warm 两种 context 各保留 4 warmup +24 measured 四臂 ABBA/BAAB，全部 112 series/4,032 queries；每 context 的 measured 部分为 96 series/3,456 queries。

| context | public batch mean A→B / ms | setup-inclusive mean A→B / ms |
| --- | ---: | ---: |
| fresh | 31.423507 → 26.220082（减少 16.559%） | 31.522304 → 26.333297（减少 16.461%） |
| warm | 31.543098 → 23.545082（减少 25.356%） | 31.733670 → 23.608532（减少 25.604%） |

首次 helper 构造发生在 fresh 首请求内，但同一 Node 进程可能复用 V8 native-code cache，不能称 24 次独立进程冷启动。fresh **firstQuery 均值 3.585937 →4.954840 ms，回退 38.174214%**；fresh block 7 setup-inclusive 回退 28.246%，其 B 最慢 batch 52.209671 ms 也比 A 49.782501 ms 更差。warm A 的 64.406599 ms 离群同样保留。全部坏块和尾部原样进入资料，不因方向有利或不利而删样本。

计时包括 guard、lazy runtime、原 JS allocate/fill、需要时同步 compile/instantiate/memory.grow、全部复制、kernel、cache 和 float 转换；setup/verification 单列并另给 inclusive 值。fixture 解码和完整 oracle 编解码在调用计时之外，另存其时间/字节账本。原始 full oracle、每 operation 后的完整字段和桶尾部、所有 raw/series 都不能缩减。

N=103,684 时，v2 每次 grow 的静态复制量为 **7,154,260 B**，12 次 **85,851,120 B**；private arena 额外保留 **3,866,624 B**，原 JS payload 未减少。这是静态 ABI 账本，不是实测带宽、RSS、峰值、分配、泄漏或内存优化结论。稀疏 RSS 也不能证明连续峰值或 GC 因果。

正式 native 未复现该局部比例。t6990 P6 owner 一对回退、一对改善，且 owner 时间包含其它工作；t0 首次路径更慢。单凭这些 owner 记录不能给出逐 grow/copy/compile/GC 因果分解；后续 v12 的真实 grow 外层记录见第 6 节。“较轻 land 工作被固定全长复制抵销”中的具体复制因果、连通分量大小和复制占比仍待证。micro 不是 FPS，不能据此宣称整局目标已达成。

## 5. v11 主线程 CPU 诊断的精度边界

v11 是 Map31 的独立主线程 CPU 诊断，不能作为候选收益验收。首次校准 70.61 ms、exit 0；随后完整 native 57.218 s、exit 0。其全部 241 个 runtime source 与原 Map31 A1/Git bytes 一致，完整命令和最终 checksum 也闭合。

校准 **1,000 组有 999 组 CPU delta 为零**；唯一正增量为 **990 µs**，该跨度 wall 上界却仅约 0.034 ms，形成约 −0.956 ms signed gap。API 的整数微秒是表达单位；这个观测不能证明 1 µs 实际精度，也不能仅由一个正值断定真实分辨率，更没有保证误差界。

校准中的 1 个负 gap 与完整 native 的 10 个预选样本是两组资料。后者 **5 个 CPU 增量超过 wall 上界**，原始负 gap 全部保留，没有 clamp、删除或从 wall 扣除。CPU snapshot span 还比原 whole 宽约 0.012–0.154 ms，不能当成同一精确跨度。热点 CPU 与数十毫秒 wall 大体同量级，仅支持这些选中热点主要消耗主线程 CPU；不能精确区分计算、GC、JIT、系统工作、调度等待或绝对 off-CPU 时间，也不外推到未选中的尖峰。

该诊断 run 原 whole p99 **27.368 ms**、max **78.380 ms**、>50 ms **9 ticks**，目标仍失败。旧设计、冻结准备版本、短引用 `618` lookup 错误及更正、全部 brackets/raw 和命令闭合记录都保留。

## 6. v12 真实 grow 调用诊断：局部归因及其差距

v12 在另外一个运行时段串行执行 A→B 两次完整 14,400-tick 诊断，是一次带 grow 外层 scope 的调用归因记录，不能代替正式 ABBA。两边逐顺序对应 **240 行**：registered land **165**、registered sea **75**，全部位于原 whole tick 内；setup、observer、unknown 均无 grow 行。两边 N=103,684、terrain 320×320、padded width 322。对齐标量包括 sequence、tick、phase、state ID、registered mover、尺寸、source/target、cache size、clock 和 throw marker；不能只因行数相同而认定调用匹配。

| v12 grow 范围 | A 次数 / 总 ms | B 次数 / 总 ms | B−A / ms |
| --- | ---: | ---: | ---: |
| land | 165 / 44.285116 | 165 / 107.769408 | +63.484292 |
| sea | 75 / 191.376540 | 75 / 163.107618 | −28.268922 |
| 合计 | 240 / 235.661656 | 240 / 270.877026 | +35.215370 |

本次诊断 land 有 156/165 次 B 更慢，sea 有 68/75 次 B 更快；全部 240 行 elapsed 有限且非负、均无 throw，77 个负的 B−A 配对差值也完整保留。t0 为 18 次 land，A/B 合计 6.413709/13.487137 ms；t6990 为 12 次 sea，36.180435/24.628395 ms；t5280 没有 grow。该记录支持“这组真实调用中 land 增量超过 sea 节省”的局部成本结论，仍没有测出某个 copy 阶段的因果贡献。

**35.215370 ms 不能解释正式整局每轮约 1,438.457086 ms 的回退。** 正式 ABBA 的 mean 差为 +0.099892853 ms/tick，而 v12 grow 合计差折合 +0.002445512 ms/tick；两者来自不同运行时段、使用不同插桩，不能精确相减、相除为解释占比，或将未解释部分自动归为 GC/JIT/调度。scope callback/try-finally/dispatch 和元数据观测会影响 whole；metadata A/B 总量 1.991232/1.992313 ms 单列，未从 elapsed 或 whole 扣除，也未覆盖最终 timing 字段写入。GrowRow 是含外层全部工作的 wall 时间，没有 child-time subtraction；继承的 v5 tree-exclusive prose 不适用于本次 scope，须看 v12 的 `METHOD.json`。

该次 A **241**、B **243** 份原始输入归档与各自另存 Git bytes 一致，source roots 保持对应提交且 clean；两份完整 commands 逐字节一致，均为 618,189 B、上述命令 SHA、checksum `7d94a5e8`、rules3/checksum18、14,400 frames/612 nonempty frames，原 v5 与准备工具 pins 不变。诊断 whole p99/max 为 A **26.365174/84.925763 ms**、B **27.397397/110.338515 ms**，目标仍失败。

完整依据为 `whole-performance-diagnostics-v12/REPORT.md`、`analysis.json`、`closure-pins.json` 及该目录的 49 份原证据（约 11.247 MB，最终归档字节量仍待实测）。其原 JSON 中指向 A-native/B-native/raw 的引用保留原样，通过 manifest 定位；不为改写引用再复制一棵 raw 树。本包已逐原manifest核对v12全部49载荷，并按真实241/243源码闭合；最终SDK状态另记。

## 7. 浏览器能力门禁与 TLS/NSS 闭合

普通 TLS 的真实 `https://lexicalmathical.com/sketch-rts/` document 返回 HTTP 200，观测为 secure context；document body **817 B**、SHA256 `4f9a6f5e15deb6511aa6347bb19b426887b36fa66fae8d65b208214cf9dca4d4`，与 PR379 固定生产 artifact 的 document 相同。本次观测未见 CSP response header 或 meta policy；这只描述该 document 当时的策略，不能推广为其它 CSP 配置必然允许。

门禁将固定本地 candidate IIFE 注入实际 document，仅为原 pinned terrain 追加 private `createRuntime/grow` exports，保留原 helper/generated bytes 与算法。没有替换生产资源、拦截 Fetch、修改生产 headers 或部署候选。**3 次 `Runtime.evaluate` 都显式设置 `allowUnsafeEvalBlockedByCSP:false`**，从未调用 `Page.setBypassCSP`；不能省略这个 CDP 选项而将测试误述为无条件自然加载。

浏览器在现有 NSS 信任环境下正常验证 TLS，未关闭证书检查；NSS 前后 inventory 的 listing、证书 DER 和 trust 均相同。launch 使用 headless Chromium/SwiftShader，并包含容器所需的 `--no-sandbox`；它不是用户硬件渲染环境或浏览器沙箱强度验收。20 s 门禁预算包括 launch/navigation/correctness，实际浏览器观测 UTC **23:04:47.759–23:04:50.535**；构建准备和退出/NSS 闭合单列。

7 个小 fixture 全部通过：5 个合法单源覆盖 land/sea、复用或 lazy scratch、小 arena，另 2 个为 two-source/border-source 的旧 JS fallback。实际 native `WebAssembly.Module` 构造一次，供应的确为上述 **684 B 无 import 模块**；真实 arena 内容改变且与 reference/candidate 最终字段一致。观测器临时代理 native Module constructor 并最终恢复原 descriptor；没有单独注入 expand 调用计数器或事件 trace，故这份小 gate 不承担完整顺序事件或 full-native 证明。

cold prepare 约 **1.1 ms**、其中 Module compile 约 **0.6 ms**，五个 WASM 小用例各保留 **65,536 B** arena；这些是成本记录，不能写成收益。浏览器 exit 0，自有 profile 已移除，无遗留自身 Chromium 进程，NSS inventory 未变。门禁证明限于本次 document 中真实 helper/private grow 的能力和小样本正确性；没有生产渲染/FPS、全局性能、完整游戏或视觉验收结论。此前仅 GET/header 的 policy receipt 继续单独保留，不能替代本次浏览器执行。

## 8. 清理记录与原始证据保全

`whole-wasm-generated-output-cleanup` 在清理前保存了待删路径及逐文件 bytes/hash，并完整保留编译器四份源文件：package.json、package-lock.json、wabt/package.json 和 wabt/index.js，合计 **693,193 B**。在该保全完成后，按授权仅移除候选忽略生成目录 `dist/`、`dist-server/` 与可由固定 lock 重装的 `/workspace/toolchain-wabt/node_modules/`。

清理记录确认 source 仍为 48e、Git clean，原 **39/63** 两组既有证据及 manifest 未改变；源码、官方 release、旧截图、raw、公共生产站均未移除。删除逻辑文件量 **16,897,040 B**，观测空闲量增加 **16,404,480 B**，后者可能包含其它轻量 workspace 活动，不能当成精确回收量。清理行为没有额外构建、游戏 import 或新 native 运行。

新归档应流式收纳既有完整 raw、sources、commands、oracles、attempts、执行日志和修正记录；内容相同的完整字节允许通过明确 alias 去重。每个 alias 必须保留原逻辑路径并指向完整 canonical payload，编码后的路径和索引关系载入 manifest，最终读回核对 bytes/hash；不得因此删断言、截取尾部、缩减 fixture/commands/source 全文，或只留下摘要代替原 payload。总payload初始16 MB计量超出后，获准提高为 **19,000,000B硬预算，仍须按实际最终产物测量**，不能根据当前目录估值宣布符合。

## 9. 证据定位与复核入口

下列为原始证据目录名；归档内实际路径与去重 alias 以最终 manifest 为准：

| 目录 | 主要内容 |
| --- | --- |
| `whole-integer-kernel-feasibility-v1` | v1 可行性、窄 guard 契约、tiny 及完整 oracle |
| `whole-integer-kernel-v2-tools` | candidate 实现、全部 proof/test/build attempts、冻结源码闭合 |
| `whole-integer-kernel-v2-micro` | fresh/warm 原始系列、坏块、full oracle、完整调用计时 |
| `whole-integer-grow-abba-review` | 五轮统计、source/commands 闭合与计数/launch 补充 |
| `whole-integer-kernel-native-mismatch-review` | 局部 micro 未推广至 native 的解释边界与待证假设 |
| `whole-performance-map31-cpu-v11-closure-first` | v11 校准、原始 CPU/wall brackets 与完整命令/源码闭合 |
| `whole-performance-diagnostics-v12` | 两次完整串行 grow scope、240 行对齐、局部 land/sea 成本及归因限制 |
| `whole-integer-kernel-browser-policy-v1` | 先前真实 document 的 HTTP/policy receipt |
| `whole-integer-kernel-browser-gate-*` | 冻结准备、构建、实际普通 TLS gate 与退出/NSS 闭合 |
| `whole-wasm-generated-output-cleanup` | 清理前路径/hash 清单、四份编译器完整源码与执行记录 |

旧 [stage4 固定归档](https://github.com/shuxueshuxue/sketch-rts/blob/c54854310d4449aaea7f65557d71a945b8531a65/docs/performance/rules3-stage4-followup/README.zh.md) 继续作为前阶段入口。旧 stage3 图片以固定提交 `19959685782109622b0c89a5b2d9f1ed7f3bcef4` 的既有路径为准，不能用可变 main 链接替换固定证据。

本次逐件原字节和别名读回、九份命令/2177份源码/12变更文件/684字节binary及原39/63/34/54/49载荷已全部通过；最终数量和执行身份见verified-closure.json。

SDK最终检查：四文件14项首次全部通过（32.126926s、exit0）。这是完整证据分支c548既有49代码加新stage5文档的边界/启动检查，不冒充48e的新构建、618实测或远端SDK上传。之后只追加本次退出码/日志和封存metadata，不改候选或旧证据。

候选12个源文件及raw commit、32个Git metadata trees、完整684B生产binary均内嵌；portable checker按Git对象哈希遍历验证，默认不依赖本地48e对象。编译器四份旧pin原文完整保留，LICENSE另由官方locked npm tar新取得并验证原lock SHA512，不冒充旧pin。第二次只按授权删除Hoist的ignored dist/dist-server，原source9407和80payload不变，完整清理SHA清单另载。

本包实际采用完整字节别名去重，每个原source均有独立索引；canonical payload保存完整原字节，别名只在实际完整byte对比相等后建立，compare-originals再逐源和解码canonical全字节比较。小型正反例验证未知alias、SHA不符、伪canonical、路径穿越、符号链接与覆盖解包均严格拒绝，两个alias路径可正确恢复；仅临时小件，不解包原大数据。

仓库根目录复核：

```sh
python3 docs/performance/rules3-stage5-integer-kernel/verify.py --out docs/performance/rules3-stage5-integer-kernel --verify
python3 docs/performance/rules3-stage5-integer-kernel/analyze-native.py
python3 docs/performance/rules3-stage5-integer-kernel/verify.py --out docs/performance/rules3-stage5-integer-kernel --verify --compare-originals
```

源码与Git对象的离线验证不依赖未发布48e commit在本地Git库存在。compare-originals另需原工作目录。原stage3/4固定提交保持不变；本证据分支不合并、不部署候选。

最终无损包：494份原source索引、357份完整canonical、137显式别名；原件63188059B，unique外层gzip18587411B，低于批准19,000,000B。所有原source均保留完整字节，未缩减内容。
