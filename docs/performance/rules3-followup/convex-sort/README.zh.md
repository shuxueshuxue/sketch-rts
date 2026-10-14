# 规则3：生成点凸包候选的独立未采用实验

**局部函数有收益，正式整局没有稳定收益，因此本候选未采用。** 正式ABBA的whole均值 **3.560379→3.569096 ms（变慢0.2448%）**，p99 **26.406573→26.706512 ms**，max **81.748129→99.819483 ms**；**p99≤16 ms、max≤50 ms仍失败**。本归档独立于已封闭三文件证据和PR#378，不扩大该发布范围，也不宣称合并或部署。

## 实际范围与源码

固定`sapphireArchipelago`六人局：一个空闲Grove人类席位、五个AI，12分钟、每次14,400原生tick。五次结束winner均null；这是完整预定tick测试，不是胜利结局或所有地图验收，原附件房间的精确配置仍未知。whole计原生complete tick，另行记录的渲染快照、observer和disk不计入，不是浏览器FPS。

正式A固定 **e51e749d65b6642cb277d1a1ee83b0aefd662e00**，正式B固定 **eef9bf133a08f83898834873bbdb464ae2596b86**。五个arm的241个完整源码输入直接与固定Git blobs逐字节比较；A/B只有`src/shared/navigation-math.ts`与`src/shared/ship-navigation.ts`不同。原probe与实际runtime bundle身份也复核。[完整源码与命令闭环](verified-closure.json)。

局部证明以ce9固定代码为参考：math候选与eef整合模块全文一致；冻结nav候选全文SHA `f529a9c2…` 与eef nav全文SHA **`0938421a8e0f3f6f0234aa9ff825c59ef9a295bee0574d57c757e2bc8bc14031`**不同，因为eef继承了e51已有两槽改动。独立组合比较确认e51=冻结旧nav+两槽改动，eef=冻结新nav+相同两槽改动。新增差异只在相同import和`hullPassageClear`的一个调用，不能给旧proof源码换标签冒充eef全文。[局部源码组合复核历史快照](local-review.json)。

候选保留公共`convexHull`原spread与builtin comparator sort，把原cross/half/result尾部逐字节移入共同私有函数；仅fresh outline双轮廓union调用新入口。≤32个有限普通数字点用稳定插入排序，其余普通输入走原builtin sort。该数字selector不验证对象纯度；getter/Proxy/coercion等公共输入保持公共旧路径。原阈值、WeakSet与plane/radius缓存不改。没有AI相位、规则、命令校验频率或断言改动，仍rulesVersion3/checksumVersion18。

## 完整原生ABBA

串行A1→B1→B2→A2→Bplain，每臂14,400tick，性能合并只使用前四臂。保留tick0、所有冷启动、尾部和异常样本；无forcedGC、CPU profiler、detailed scopes或样本剔除。分位为最近秩ceil(n×p)−1。

| arm | whole mean ms | p99 ms | max ms | >50 ms | max tick |
|---|---:|---:|---:|---:|---:|
| A1 | 3.543168 | 26.057511 | 81.748129 | 8 | 0 |
| B1 | 3.569526 | 26.693546 | 99.819483 | 7 | 0 |
| B2 | 3.568666 | 26.706512 | 89.847406 | 8 | 0 |
| A2 | 3.577590 | 26.653335 | 77.525893 | 5 | 0 |
| Bplain | 3.504102 | 26.189375 | 78.735275 | 4 | 0 |

| pooled指标 | mean ms A→B | mean变化 | p99 ms A→B |
|---|---:|---:|---:|
| whole | 3.560379→3.569096 | +0.2448% | 26.406573→26.706512 |
| 规划whole | 16.132340→16.487114 | +2.1991% | 42.336024→41.742115 |
| 非规划whole | 2.662382→2.646380 | -0.6010% | 19.012504→18.943063 |
| AI | 0.805121→0.831820 | +3.3162% | 17.596618→17.983285 |
| sim | 2.736399→2.717879 | -0.6768% | 19.351432→19.071912 |

A/B各28,800样本。whole >16ms **1392→1373**，>50ms **13→15**；12个分钟区块只有5个whole均值改善。两个run配对收益分别 **-0.7439% / 0.2494%**，方向不同。模拟均值和部分分位略好，AI与整体均值/p99变差；不能从全场模拟总耗时给某个尖峰作因果解释。

所有五次最大值均在tick0；startup样本保留并纳入max目标，不以删首帧得到通过。Bplain只核验钩子透明性，原记录的AI/sim零值与空ownerPlans表示关闭计时hooks，不表示AI免费或没有planning；不能据此把全场判为非规划。[独立原始样本复算](statistics.json)、[原正式预声明](payloads/id0158.bin.gz)、[原执行关闭](payloads/id0156.bin.gz)。

五份完整native command bytes逐字节相等，并与此前规则3参考再直接比较，共六份，各 **618,189 bytes / 14,400 frames / 612非空帧**，SHA256 **`771222bde4c8d2c0a46a97313563ad2b5de1d52ed92fb2d3c70511ff2276c997`**，final checksum **`7d94a5e8`**。正式四臂逐tick索引、after、mod15、实体数量和规划owner顺序一致。这证明当前固定场景透明性，不是所有输入的形式证明。

RSS/heap/external/arrayBuffers原起止及稀疏观察全部保存；不是持续峰值、分配率、产品留存内存或泄漏测试，未证明全局内存改善。

## 局部证明与微对照

A/A和实际A/B各18,680用例，比较1,428,310排序/叉积事件、完整输出对象引用与顺序、数值/error、懒缓存前缀和数组别名；另六个公共getter/Proxy/coercion/iterator可观察顺序用例。9,219重构union26输入=357捕获transport pose-entry pairs（240+117）、2,142扩展船型、6,720曲线矩阵。40个实际输入模块与ce9固定Git blobs一致。重构输入不证明每个组合在原1859tick实际调用了convexHull或通过clearance；原JIT/堆/cache历史未恢复，numeric用例的query/clip metadata没有逐例重放。

| 微对照整批指标 | 旧 | 候选 | 本轮结果 |
|---|---:|---:|---|
| generated中位ms |33.117187|20.839212|降低37.0743%，24/24块正且两B均低于两A|
| generated均值ms |32.794931|21.860192|降低33.3428%|
| publicDefault中位ms |31.230002|32.020732|变慢2.5320%，16正/8负、严格分离0块|
| publicDefault均值ms |32.476318|32.209121|降低约0.82%，中位方向不同|

四预热/24正式ABBA/BAAB块按声明交替entry/workload顺序；224序列含192正式，正式1,770,048 hull调用、预热295,008。每entry每arm48样本，p99=max，是全批指标，不是单次hull或tick。public曲线子组中位变慢9.8506%保留。原summary顶层按人工相等频率混合generated/public，13.43%中位或17.16%均值不能当真实调用比例或整局收益；本报告只使用byEntry和正式整局结果。[原微对照](payloads/id0037.bin.gz)、[全部原始序列](payloads/id0054.bin.gz)、[局部证明](payloads/id0051.bin.gz)。

## 两项明确的范围纠正

原proof的warm plane对象检查曾与同一live数组自比较，原文件不改。独立addendum保存partial/full.slice对象引用后验证，9,219输入×3arms共27,657条，验证support/full完成与每次warm查询起点身份；随后clip/cell核对缓存数值字段。最后一次clip/cell之后没有再次断言对象身份，因此不声称这个最后边界也直接通过身份断言。仅固定查询生命周期。原proof/micro/raw SHA未改变。[补充实际验证](payloads/id0043.bin.gz)、[补充执行工具](payloads/id0044.bin.gz)。

原RESULTS称匿名comparator完整node metadata保存在attribution JSON，实际该JSON只列convexHull节点。匿名节点30/58的 **1,079+1,075=2,154µs** 应引用[原CPU profile](payloads/id0163.bin.gz)和[原runtime bundle](payloads/id0164.bin.gz)，配合原tick锚；直接hull叶为7,540µs。旧12.98ms是三tick整窗未裁剪估计，不能当7628精确leaf或纯sort成本。严格数据也是采样区间，不是独立函数精确wall。原文与错误粗估保持原样，不改写旧证据。[原归因纠正](payloads/id0049.bin.gz)。

## 工程检查与失败保留

首次input harness因SyntaxError在运行native graph/proof/micro前失败；原失败日志、准备helper与predeclaration保留，语法修正未改变候选source SHA。第二次输入、A/A、A/B、micro均exit0；后补身份验证exit0。source-pin和predeclaration的executed:false是准备时快照，不能重写，也不代表之后没有执行。

整合eef的首轮geometry/navigation检查 **11文件 / 130项中129通过、1项失败**，失败因稀疏工作区缺`assets/naval/ships.json`。恢复实际fixture后，单独geometry文件 **32项通过**；原失败不消失，也不声称原整组一次130项全通过。归档中的实际fixture **4,845 bytes / SHA256 `22acecf80139ea9f084dbc3411a61d94128d400092ef1428e3a45ee86f5ea01e`**与eef/e51/b845固定Git资产相同。生产TypeScript、构建与实际bundle启动检查通过。[首轮失败日志](payloads/id0169.bin.gz)、[独立32项重试](payloads/id0170.bin.gz)、[生产构建](payloads/id0171.bin.gz)、[实际测试fixture](payloads/id0175.bin.gz)。

generic-v1仍为UNRUN且未集成：公共singleton抛异常getter行为会与原实现不同，其反例与源文件单列。较早未采用掩码与既有PR#373/#377/#378证据不修改，不与本次性能判断混合。整局阴性按未采用实验关闭；源码候选保留在独立eef提交，归档不等于采用或发布。

## 独立归档与复核

[manifest.json](manifest.json)封存 **175份载荷 / 64,846,564原始bytes / 19,817,246存储bytes**。路径以Base64保留，原bytes/SHA与外层gzip bytes/SHA逐项记录，`idNNNN.bin.gz`不复制历史名称到规范正文。75份局部原件、历史准备快照、完整五臂raw与原工具、原CPU支持、失败/重试/build日志和实际fixture分别有group。

| group | 用途 | 文件数 | payload范围 |
|---|---|---:|---|
| `generic-v1-frozen` | 未执行通用提案、反例与初始冻结原件 | 19 | id0001.bin.gz—id0019.bin.gz |
| `narrow-v2-local` | 局部证明、原首轮失败、补充身份检查、微对照与全部输入 | 56 | id0020.bin.gz—id0075.bin.gz |
| `archive-preparation` | 整局闭环前的只读准备快照；等待状态保持历史原值 | 5 | id0076.bin.gz—id0080.bin.gz |
| `whole-abba` | 完整正式五臂整局、原始尾部、命令与源码 | 78 | id0081.bin.gz—id0158.bin.gz |
| `diagnostic-tool` | 实际正式整局使用的原工具源码 | 3 | id0159.bin.gz—id0161.bin.gz |
| `abba-wrapper` | 实际串行执行器原始源码 | 1 | id0162.bin.gz—id0162.bin.gz |
| `prior-attribution-01` | 匿名比较器原CPU节点、真实bundle及tick时钟支持 | 1 | id0163.bin.gz—id0163.bin.gz |
| `prior-attribution-02` | 匿名比较器原CPU节点、真实bundle及tick时钟支持 | 1 | id0164.bin.gz—id0164.bin.gz |
| `prior-attribution-03` | 匿名比较器原CPU节点、真实bundle及tick时钟支持 | 1 | id0165.bin.gz—id0165.bin.gz |
| `prior-attribution-04` | 匿名比较器原CPU节点、真实bundle及tick时钟支持 | 1 | id0166.bin.gz—id0166.bin.gz |
| `prior-attribution-05` | 匿名比较器原CPU节点、真实bundle及tick时钟支持 | 1 | id0167.bin.gz—id0167.bin.gz |
| `prior-attribution-06` | 匿名比较器原CPU节点、真实bundle及tick时钟支持 | 1 | id0168.bin.gz—id0168.bin.gz |
| `integration-log-01` | 初始缺资产失败、独立32项重试、生产构建或正式整局原始日志 | 1 | id0169.bin.gz—id0169.bin.gz |
| `integration-log-02` | 初始缺资产失败、独立32项重试、生产构建或正式整局原始日志 | 1 | id0170.bin.gz—id0170.bin.gz |
| `integration-log-03` | 初始缺资产失败、独立32项重试、生产构建或正式整局原始日志 | 1 | id0171.bin.gz—id0171.bin.gz |
| `integration-log-04` | 初始缺资产失败、独立32项重试、生产构建或正式整局原始日志 | 1 | id0172.bin.gz—id0172.bin.gz |
| `prior-command-reference-01` | 已验证规则3原生序列参考，仅用于完整字节透明性比较 | 1 | id0173.bin.gz—id0173.bin.gz |
| `prior-command-reference-02` | 已验证规则3原生序列参考，仅用于完整字节透明性比较 | 1 | id0174.bin.gz—id0174.bin.gz |
| `integration-fixture` | 32项重试实际输入；与e51/eef及b845固定资产Git blob相同 | 1 | id0175.bin.gz—id0175.bin.gz |

只排除一处依赖链接树，basename Base64 **`bm9kZV9tb2R1bGVz`**，确切原路径见manifest.exclusions[0].originalPathBase64。通用排除策略还包括Base64 `Z2VuZXJhdGVkX21vZHVsZXM=`、`YXJ0aWZhY3RfZGlzdA==`、`LmdpdA==`，本次无相应目录；没有删原始证据或重复打包整个依赖/构建目录。

```sh
python3 /workspace/whole-convex-stage-evidence/verify.py --out /workspace/whole-convex-stage-evidence --verify
python3 /workspace/whole-convex-stage-evidence/verify.py --out /workspace/whole-convex-stage-evidence --verify --compare-originals
python3 /workspace/whole-convex-stage-evidence/verify.py --out /workspace/whole-convex-stage-evidence --verify --extract /tmp/convex-stage-evidence
python3 /workspace/whole-convex-stage-evidence/verify.py --out /workspace/whole-convex-stage-evidence --review-closure --repo /workspace/sketch-rts-whole-perf --isolated /workspace/sketch-rts-whole-perf
python3 /workspace/whole-convex-stage-evidence/analyze-native.py
```

流式复核每份存储和解压后bytes/SHA及完整清单；compare-originals另核对原目录。提取先全量验证，仅写不存在的新root并保留workspace相对层级，拒绝覆盖、路径穿越和已有目录。闭环复核读取归档完整命令与源码并比较固定Git blobs，需相应提交对象仍可访问；原始统计可只从本归档复算。准备快照当时的等待标志按原字节保留，最终结论由本报告、statistics及新verified-closure明确记录，不给旧执行换身份。
