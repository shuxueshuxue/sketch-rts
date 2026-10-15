# rules3 stage6：terrain bake 候选完整证据归档

候选 `863016831e25f75589e142c4560b71040902f726` 的正式整局 whole mean **回退 3.615465%**，两对都更慢，故本候选**拒绝采用、不上线**。冷启动均值改善、正确性通过和后续计数诊断均不能改变这一结论。整局目标仍为 **p99 ≤16 ms、max ≤50 ms**，本阶段 **FAILED**。

本文封存实际完成的 terrain bake、五轮整局、24 个 fresh 冷启动及 v13 scalar 诊断。归档结构与最终校验结果见文末、`manifest.json` 和 `verified-closure.json`。既有 `9f3101feb4865644e2f0d914dd709c5a614f055f` 和全部旧文档、旧 archive 保留原样。

## 范围与固定输入

候选基于 main `618f9f5170164aa33d1e21443e86e64fb14d38f8`；正式 A 使用固定 Map31 `31e4e8ba44c48efbbbf7ec3594c93e7537b6dba8`。变更为 exact lazy land/sea wholes 和 radius 44 shore 结果的预生成、解码与窄接入，不改变 AI 相位、船规则、规则 3、checksum 频率或既有验收断言。

候选有 **17 个 changed Git files**，新增 3 个 runtime TypeScript 模块；正式 native 实际输入 A **241**、B **244** 份。生成 asset **52,777 B**，SHA256 `ce9f037e9cff4fe7e5f73a3e8fa650e9bde2d51de8a876fde169eb21dfa47f09`；land count 13、sea count 1、shore44 count **10,430**、labels length **103,684**。这些是源码/数据身份和正确性范围，不是性能节省量。

完整 native 沿用 `StaticSoloDeploymentRuntime.startRoom → LocalGameAdapter.updateToRenderTime → CommandFrameRuntime.tick`。这是固定 Sapphire 房间的 14,400-tick 对照，不是 SDK benchmark、浏览器/GPU 渲染、所有地图或必然获胜的证明。原附件缺少 room id/races，因此该固定房间也不能声称完整复原附件原局。

## 正式整局：负结果完整保留

执行 A1→B1→B2→A2，另保留 Bplain。收益池仅为 A1/A2 与 B1/B2，各 **28,800** 个原始 whole 样本；Bplain 只用于 hook transparency，不混入收益池或 planning 分类。

| whole 指标 | A | B |
| --- | ---: | ---: |
| mean / ms | 3.541760157 | 3.669811266 |
| p99 / ms | 25.878660 | 27.272709 |
| max / ms | 93.637404 | 107.965874 |
| >16 ms 次数 | 1,372 | 1,464 |
| >50 ms 次数 | 13 | 15 |

A1→B1 mean **+3.238131%**，A2→B2 **+4.000883%**；12 个合并分钟块中 **11 个更慢**。分位数为 nearest rank `ceil(n*p)-1`；首 tick、坏块、所有尖峰和尾部均保留，移除离群样本数为 0。

五轮完整 commands 全字节一致，均 **618,189 B**，SHA256 `771222bde4c8d2c0a46a97313563ad2b5de1d52ed92fb2d3c70511ff2276c997`；14,400 frames、612 nonempty frames，rules **3**、checksum schema **18**，最终 checksum **`7d94a5e8`**。各臂实际 241/244 份输入与原 Git bytes/声明 pins 一致。checksum 相同不能替代命令全文或源码全文相同。

每轮 13 个稀疏 process memory 样本只作描述，不能推出连续峰值、allocation rate、泄漏或 GC 因果。render snapshot 在 whole 边界之外；otherSnapshot 与 renderSnapshot 是重叠诊断，不可相加，也不能把 renderSnapshot 的变化直接当作 whole 回退原因。

## 冷启动：均值改善及反例

冷证明共 **24 个 fresh processes，A/B 各 12 个**，保留六个配对块及全部样本。`contiguousImportThroughFirstNativeTickMs` 是从首次模块 import 连续量到第一次 native tick 完成的跨度；parent spawn-to-exit 单列，build/source-recording 的边界也另存。

| 冷路径指标 | A / ms | B / ms |
| --- | ---: | ---: |
| import 至首 tick 连续跨度 mean | 385.860136 | 367.304968 |
| first native adapter tick mean | 90.051521 | 74.059027 |
| first native adapter tick max | 120.590105 | 127.260448 |

六块中 **block 4 adverse**：连续跨度 B−A **+17.069284 ms**，首 tick **+13.803019 ms**。B 首 tick 最大值也更差，不能只给有利均值。无 retries、无删样本；每臂 n=12 时 p99 就是该臂最大值，不能建立总体尾部 SLA，亦不证明整局 p99/max 达标。

全部 initial bytes、首 tick snapshot bytes 与 native frame bytes 一致，首 tick checksum `21709a99`；冷结果只说明这些已观测进程的启动路径。完整整局 oracle 继续单独保留，不把首 tick 的相等代替整场验证。

## 正确性、SDK 与首次失败

`CORRECTNESS.json` 记录 **25 files、172 个 unique tests** 通过：focused 68、actual-map 1、其它适用验收 96、原 SDK boundaries **7**；标准 typecheck、generator strict typecheck、production build 均通过。实际 shipping provider 的完整 Sapphire fast path 与原 BFS/shore 结果比较，覆盖完整数组及 10,430 个 shore points；强制 original 路径也单列验证。同路径生成/检查和不同绝对 checkout 检查均保留。

源码闭合检查 1,157 份原 source files，其中 1,154 份不变，包括 433 AI/71 ship；接入和两份既有 CJS test loader 的变化没有降低断言。支持边界为普通数据 Terrain；eligibility snapshot 不调用 value getter。任意 Proxy reflection traps 或全局 prototype pollution 不属于本证明的通用等值承诺。

首次 `tests-acceptance-01` exit 1 保留：sparse checkout 没有 docs，原 SDK 断言 `scandir('docs')` 报 **ENOENT**。这是测试环境覆盖错误，不能改成实现通过，也不能删除该 attempt。修正采用 **9,766 个精确目标 Git docs blobs** 的只读 projection，零复制数据；原始 7 tests 随后通过，自己的临时 docs symlink 已移除。

**SDK 数量须区分版本和范围：本 runtime candidate 的 SDK 原文件只有 7 tests；Stage5 的 SDK 验证是 4 files、14 tests＝7+5+1+1。** 不能把本轮 7 写成 Stage5 14，或将两个范围混加成候选测试结果。

## v13：完整运行的频率诊断，不是成本归因

v13 是冻结 B863 单臂的一次完整 14,400-tick scalar-frequency 诊断，实际 `B-counter-validation.json` 已记录 complete/native equality pass、244 份 original Git/current/archive 输入一致、source clean、原命令和 checksum 闭合。`METHOD.md` 的“pending grant”保留为执行前预声明，不代表运行仍未发生。

从归档内完整 focused diagnostics 解压并独立核验的实际计数为：

- **46 次 createRuntime＝1 land＋1 sea＋44 overlay**。
- **50 次 input snapshot＝46 creation＋4 current**；semantics 3、provider 1。
- wholes **4,128,613 calls＝4,128,611 hits＋2 misses**；2 次 miss 均在 tick 0。
- setup/observer 两相位记录均为 0；原 33 个 aggregate rows、空行及全部 42 个非负标量 counters 保留。

完整 focused diagnostics 已随 archive 保留并由 `analyze-native.py` 独立解压读回：33 行、全部计数、两次 miss 的 tick、4 个 hooks 的精确 path/functions 映射和 setup/observer 全零均核验。

静态 review 显示 cache hit 在 bake matching 前返回，因此计数不支持把每次 hit 都解释成一次 eligibility/current-input capture；但它们**没有单次 wall clocks，不能换算成本、证明回退原因或排除编译/分配等其它因素**。v13 无新增 per-call clocks、profiler、GC observer、per-cell hook、数组扫描/捕获或逐事件 trace；原 v5 的边界时钟仍存在，计数自身也会扰动执行，不能作新收益验收。

首次 source-anchor 审计曾把 terrain.ts 中 3 个同类表达式当作单一目标，exit 1；修正为 function-qualified ranges。该准备 selector 错误、原报错及更正后检查一起保留，不能归为候选实现或 native 失败。静态 review 的“运行总数未知”和旧 method 的未来时态均是其当时边界，不得回写旧报告抹除时间顺序。

## 证据范围与离线复现

| 原证据目录 | 作用 |
| --- | --- |
| `terrain-bake-validation-v1` | CORRECTNESS、完整 manifest、生成/检查/测试/build 命令与所有 attempts、源码闭合、SDK docs projection |
| `terrain-bake-cold-proof-v1` | 24 fresh 原始样本、六配对块、连续计时边界、完整 oracle 与 closure |
| `terrain-bake-native-review-v1` | 正式五轮 review、DECISION、完整 commands/source 检查及统计 |
| `whole-performance-abba-31-8630168` | 五轮原始 native sources、ticks、commands、初始状态、环境及执行记录 |
| `terrain-bake-regression-static-review` | source-only 分支/边界审查与因果限制 |
| `terrain-bake-call-count-v13-tools` | 冻结工具、首次 selector 失败、source anchors、完整 B-counter-native 与 validation |

复现时先按同 scope manifest/alias 表恢复全部逻辑路径和完整 bytes，核对 Git commit/tree/blob、工具 pins、原 source inputs 与命令全文，再使用各 step 的 `*-command.json`/`*-execution.json` 中原 argv、cwd 和边界。v13 原命令记录为在其 tools cwd 执行 `python3 run-counter.py --root-cpu-grant`；它需完整独占运行授权，不能在归档读回阶段自动触发。复算 formal 必须保留五轮身份、原分位数、全部慢样本和 Bplain 排除规则；不得用冷 micro 或 v13 计数代替正式池。

归档须保留完整 raw、17 个 changed Git files 的字节、commit/tree/blob、patch、工具及失败日志；全字节相同 payload 可通过明确 canonical/alias 表去重，但不能删路径、断言、尾部或 oracle。最终数量和体积见 `manifest.json`，源码/Git/command/typed-data 的独立结果见 `analysis.json`，完整原件与压缩读回见 `verified-closure.json`。

**候选发布状态：8630168 拒绝采用，没有 PR、合并或部署。** 本文件仅发布证据文档；当前生产版本在本阶段仍为 618f9f51，后续独立 Stage7 候选另行记录。

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

本 scope 共 **630 个原始路径、415 个完整 gzip、215 个显式 alias**，原件合计 **49,960,683 B**，unique gzip **12,926,731 B**。全部原件与解压 canonical 逐块全文比较，所有 stored/decoded SHA、支持文件与精确库存另由 `verified-closure.json` 记录。独立认证 9 个源码图（共 2184 份完整源码记录）和 7 份完整命令；包含旧 Map31 reference，Bplain 独立保留。

最终四文件 SDK 首次实际结果 **13/14 pass、1 个既有旧 Stage5 文档命名失败**，原命令32.192416秒；原失败和精确归因全部保存，未改旧文档或任何断言。全部新档案在这次 SDK 执行期间 SHA 不变；随后仅追加 receipts 与明确的闭合状态。该 SDK 失败不影响原 runtime candidate 已完成的正确性测试结论，也不能被隐去。
