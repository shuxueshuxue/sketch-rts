# 长停顿后续：证据索引与结论边界

本目录延续 [上一轮完整集成验证](../latency-investigation/final-validation/report.md)。它记录当前版本的阻塞点诊断、独立候选的正确性与资源/时间对照，以及尚未完成的实验。**这些不同源版本、不同测量方法的结果不能拼成一份最终 pipeline 性能提升。** 旧候选保留自己的源 epoch；新增队列诊断冻结在证据 HEAD `42bd61c74934dc76f30d42b62e1e31eb5c5974ff`，其生产源与 `77a2c307` 相同。

| 项目 | 已完成证据 | 当前结论 |
| --- | --- | --- |
| 当前版本长停顿诊断 | 两份带追踪的 8345 capture，原始样本、逐帧归因与像素/事实/时钟对照 | 新的 n135 阻塞定位到 `texSubImage2D` 内命令缓冲等待；不是 FPS 对照，旧 696.9 ms 停顿仍未归因 |
| 当前源队列分段诊断 | 42bd 三策略、六生命周期；18 张图、事实、时钟、原生 GL 内容序列与实际工作计数严格一致 | 前置完成等待使上传阻塞迁移，后置完成还有约 0.93 s；没有速度收益，也没有唯一定位 mip/copy/staging 根因 |
| 半级 mip 保守余量候选 | 31 相机位置严格正确性对照；完整 v2 ABBA 与严格分析 | 该软件 GPU 环境中 endpoint owned GPU bytes −34.59%，CPU mean +3.37%，完整 real mean 基本不变；未上线，跨 GPU 安全性未证明 |
| Row-band CPU view 候选 | 已归档初次 mock 失败与 v2 mock 通过；原版/候选独立 native mip fixture 均通过；正式时间对照另行推进 | 仍是实验；native 证明限定矩阵像素等价，不能以短 CPU view 声称 GPU 传输、帧时间或游戏性能改善 |
| Canvas 实际入口缓存身份 | 第一、二阶段实际 Atlas 路由严格像素对照、读取计数、测试和类型检查 | 已实现限定的缓存复用；读取次数不是 FPS 或内存测量，不解释 3D 长停顿 |

## 源版本与实验关系

| 源 epoch | 用途 | 不能据此声称的内容 |
| --- | --- | --- |
| `8345a0dcfeb96b6777ac3940ec64cba13816c851` | 当前诊断的冻结生产源；半级 mip/row-band 独立候选的基础；Canvas 第一阶段的旧 Atlas 源 | 后续工作树补丁不是 8345 Git 源的一部分 |
| `d07cda2c513ff055831c1995e4710fdada54d613` | 已提交 Canvas 第一阶段；Canvas 第二阶段对照的旧 Atlas/builder 源 | 第二阶段 proof 的基础 HEAD 不等于已提交第二阶段候选 |
| `d5c9bdccde4a807df813490c0f0820bc8e84af0d` | 已提交 Canvas 第二阶段原对象身份登记与 Atlas 入口复用 | 没有在此整体源上进行新的完整 pipeline FPS/帧时间对照 |
| `42bd61c74934dc76f30d42b62e1e31eb5c5974ff` | 当前队列 v3 诊断；包含新灵体、不流血和已验证局部复用，src 与 77a2c307 相同 | fence/query/完整 GL observer 会扰动排队；不是无观察器性能对照 |

每组证据保存执行时 provider/helper/source 快照与 SHA。候选捕获中记录的基础 HEAD 与工作树补丁必须一起看；分析应使用归档字节，不能拿现在的工作树代替执行源。第一阶段捕获的候选 Atlas 与提交 d07 的 blob、第二阶段在 d07 工作树中捕获的候选 Atlas/builder 与提交 d5c9 的对应 blob，均已另外静态核对完整字节相同；原 proof/README 的历史来源描述不改写。这里没有把独立候选叠加为生产实现，也没有修改模拟、回放、AI、战斗或维护费规则。

## 当前诊断：找到阻塞位置，尚未解释旧停顿

详细结论见 [CURRENT-ATTRIBUTION.md](CURRENT-ATTRIBUTION.md)。两个诊断分别保留 [普通 trace 原始记录](current-trace/raw.json)、[GL trace 原始记录](current-gl-trace/raw.json)及 [普通归因](current-attribution/analysis.json)、[GL 归因](current-gl-attribution/analysis.json)。完整 Chrome 事件以 [普通 trace gzip](current-trace/trace.json.gz)和 [GL trace gzip](current-gl-trace/trace.json.gz)保留。

旧 pipeline candidate-B2 的 cycle 1、n114/tick38 **696.9 ms 未复现，仍未归因**。当前两个 GL 生命周期的最大 CPU 样本位于 n135/tick45：474.2/498.2 ms；其中第 43 次 `texSubImage2D` 分别阻塞 254.799/275.099 ms。该调用更新 512² scratch texture 中 `(81,171)` 的 345×264 mip-0 矩形；`CommandBufferProxyImpl::WaitForToken` 占调用超过 99.9%。该具体 GL 调用没有主线程 GC/Skia 区间重叠。

这证明同步阻塞发生的位置和等待类型，**没有证明是哪一条更早的 GPU 命令造成等待**，也不能用短 `generateMipmap` 提交时间推断其异步执行便宜。n135 每帧同时有 53 次真实 Canvas miss/raster、53 次 layer update、523 次 mip copy 和约 20.05 MB scratch upload；没有新页、压缩、缓存编解码或 backoff 增量。Canvas 绘制/读取和 GPU 命令等待是不同的可重叠成本域，不能把嵌套区间相加。

该协议每生命周期先执行 18 次真实 prep draw；**随后 warm n54..113 和 CPU sample n114..173 都将 `renderer.render` 置为 no-op**，但仍执行绘制、读回与 texture transfer。之后的 n480..491 才是 12 次真实完整 draw。因此这些带 observer/tracing 的数字是诊断数据，不是正式游戏 FPS 或优化对照。[像素、事实与时钟对照](current-trace-comparison.json)严格通过：两个 trace 与旧 pipeline 对应六张图的完整 RGBA 相同，原 PNG SHA、可用的实际事实与 CPU clocks 验证通过；旧 pipeline 未收集的 all-phase telemetry 没有补造。

[cgroup 窗口快照](current-gl-trace/environment-cgroup.json)只提供整个诊断期间的环境背景，不能据累计 throttling/OOM 计数归因单帧。未采集完整 OS off-CPU stack 或命令依赖证明。[启动失败目录](current-gl-trace-startup-failure/)保留了初次输出目录冲突；该次没有启动性能捕获。

## 当前源的前后完成边界：等待迁移，未解决长尾

[旧轨迹的命令流关联](command-wait-offline/FINDINGS.md)显示，上传前已开始的 GPU-main task 跨越大部分 token 等待；紧邻该调用的 flush 在调用返回后才到达 GPU main。这个时间关系不能把 345×264 当前矩形当成全部等待成本。[同版本 Chromium 官方源核验](command-wait-offline/CHROMIUM-SOURCE.md)确认普通像素上传的暂存区不足时可能通过 pending token 回收旧块，但轨迹没有 route、分配块和 token 插入命令映射，实际调用栈仍未证明。

新增 [v3 严格报告](queue-bracket-v3/analysis-strict-v3/REPORT.md)保留三策略各两个完整生命周期。只在 n135 添加观察器完成边界，prep/warm/CPU/real/empty/return 的原协议、模拟与所有可见内容不变。18 张 PNG 的完整 RGBA、所有事实和时钟、源及依赖身份、每生命周期 294,826 条原生 GL 内容命令的顺序/已记录参数与绑定均严格相同。上传 payload 字节没有被该 GL 描述器记录，不能把参数相同说成逐字 payload 验证。

| n135 策略 | 前置完成等待 ms，两个生命周期 | 原 CPU draw ms | 后置完成等待 ms |
| --- | --- | --- | --- |
| control | 0 / 0 | 479.3 / 459.5 | 无新增完成边界 |
| pre | 410.1 / 418.6 | 227.9 / 257.8 | 无新增完成边界 |
| pre-post | 426.9 / 417.9 | 226.0 / 252.3 | 944.3 / 926.1 |

pre 使约 226–228 ms 的长 `texSubImage2D` 调用消失，但之前新增了约 0.41 s 等待；pre-post 另显示尾部约 0.93 s 完成工作。control/pre 没有等待全部 n135 工作完成，三策略不能当作相同完成边界的正式帧时间对照。GPU query 全部 available/non-disjoint，命令边界 elapsed 约 0.9–1.1 s，包含命令到达/空闲，仍不能称为纯 mip 成本。

n135 六次均为 53 miss/raster、53 layer updates、523 mip copies（报告字节 102,868,324）和 scratch upload 20,053,380 bytes，未增加驱逐或压缩；Canvas readback 仍约 152–165 ms。后续精确上传输入和逐阶段完成诊断必须另外提供实际 RGBA、初始 scratch/page 状态与完整 native mip 对照，不能靠 GL 参数推断。此处没有采用 async 等待作为生产优化，没有声称旧 696.9 ms 停顿已解决或硬件 GPU 提速。

v1 的巨大 CDP 返回失败与 v2 的 V8 输出字符串超限分别保留；v3 使用完整分片导出和独立完整 profile，严格分析只使用 v3。归档/恢复说明见 [证据索引](EVIDENCE-INDEX.md)。当前 capture 保存原源与优化依赖字节，未保存转换后实际 runtime JS；这项来源限制保留在报告中。

## 原像素输入的独立上传与生成命令诊断

[实际输入与重放报告](exact-upload-replay/README.md)补齐 53 份完整 n135 RGBA、真实 warm scratch/page 状态和逐事件 native oracle。首轮整体 EXIT1（三个 JSON 的裸图 ID 与实际 `?import` 响应没有正确匹配）；199 个实际 HTTP 正文已全部保存，独立离线审计凭实际 literal import/graph edge 补齐 388 映射，旧失败元数据不改。之后新的阶段捕获直接通过实际 HTTP 守卫。523 个逐次写入 mip 和 1,040 个最终驻留层均与完整原生 sRGB 链匹配，选定原生内容命令和提交字节保持一致。

[两段命令边界报告](exact-upload-replay/stage-report.md)先观察到 upload+generation 810.939 ms / tail copies 93.383 ms。[最后三区段 v4](exact-upload-replay/stage4-report.md)实际 EXIT0/PASS，159 个非 disjoint query：upload/到达 0.03892 ms，真实 generation 命令段 826.53367 ms，全部 tail copies 95.01889 ms；CPU 提交分别 32.8 / 0.4 / 9.0 ms。每层外部 completion、查询 markers、命令到达与空闲均影响结果，短 upload query 不能抹去实际 CPU 成本。gen 段是该 SwiftShader replay 的主要观察区段，而复制的 102.87 MB 不能直接当作瓶颈证明。此处未将结果当作独占 GPU 算法时间、正式游戏 FPS 或硬件预测，未改变生产 uploader。

原输入、失败、真实转换后 JS、运行程序和所有计时保留并精确归档；恢复说明仍使用实际原 filename/SHA。硬件 GPU 验证和旧 token→资源因果链未完成，批处理或 depth-one array generation 只是后续可检验候选，尚未采用。

## 半级 mip 候选：资源下降与时间代价分别报告

候选仅将冻结 8345 gate 的一级余量 `-1` 改为半级余量 `-.5`，完整原始绘制域、shader、UV、采样、原生 mip 生成、uploader、cache 和模拟不变。[31 步相机对照](mip-half-camera/comparison.json)通过；每臂 62 张 PNG、原生/composite RGBA、拾取、实际事实与时钟严格相同。这里比较的是完整源参考与半级候选；它不是跨 GPU 安全性证明，也没有独立 packed shadow/depth texel 证明。

相机的完整原 proof 字节以 [reference gzip](mip-half-camera/reference/proof.json.gz)与 [candidate gzip](mip-half-camera/candidate/proof.json.gz)保存；两臂的执行 harness 和 parent harness 同样精确压缩，完整路径见 [归档索引](EVIDENCE-INDEX.md)。原 proof 内记录的文件名、来源 SHA 和失败/成功状态保留。

有效时间/资源结论只来自 [完整 v2 ABBA 报告](mip-half-abba-v2/analysis-strict/REPORT.md)与 [严格分析](mip-half-abba-v2/analysis-strict/analysis.json)：四臂依次 production-A/candidate-B/candidate-B2/production-A2，每臂两个生命周期；每种 policy 保留全部 240 个 CPU sample 与 48 个 real sample，没有丢弃慢帧。

| 指标 | 一级余量生产源 | 半级候选 | 含义 |
| --- | ---: | ---: | --- |
| CPU presentation mean | 40.1283 ms | 41.4821 ms | +3.37%，没有 CPU 加速 |
| CPU p99 / max | 459.4 / 482.0 ms | 469.4 / 501.0 ms | 长尾没有消除 |
| Complete real mean | 426.4896 ms | 426.0750 ms | −0.097%，基本不变，不能宣称提速 |
| Endpoint owned GPU bytes | 191,718,124 | 125,395,696 | −34.59% |
| Peak owned GPU bytes | 194,710,892 | 135,613,804 | −30.35% |
| Peak owned CPU bytes | 26,356,908 | 26,103,152 | 只属 renderer ownership，非进程 RSS |
| Empty→returned wall mean | 1397.325 ms | 1018.325 ms | 独立返回探针改善，不能代替整体 real timing |

所有生命周期仍有 1726 次 rasterization；真实 Canvas miss 仅从 1723 变为 1722。这不是减少源绘制/读回需求的有效方案。完整 real sample 数少，最近秩 p99 等于最大值，不能当作稳定的总体尾分布。

全部 24 张原 PNG 编码 SHA 与配对完整 RGBA、8 个实际捕获 fact SHA、CPU ticks 通过。执行 helper 删除了 raw `pixelProof`，所以这里只有 fact SHA 相等，**不能说已逐字段比对 raw facts**。正式运行保持 source/provider/runtime/Three/module graph/optimizer bytes 身份验证通过。

[v1 不完整 A/B/失败 B2](mip-half-abba/)单独保留，不进入 v2 汇总。其 late dependency discovery 令 Three 完整 URL 发生变化，严格 guard 在第三臂计时前拒绝启动。[v2 静态修复记录](mip-half-v2-preparation/README.md)说明依赖显式准备方案；文中的“尚未运行”描述的是当时准备状态，之后完成的运行由上面的 v2 报告证明。不能删改旧失败来组成成功 ABBA。

这些结果来自 Chrome 151/SwiftShader 软件 GPU 环境。不同 GPU/driver 的 anisotropic LOD 选择存在实现差异；半级候选尚无硬件 GPU 对照。**当前不将候选改为生产默认**，也不把资源降低写成完整游戏性能提升。

## Row-band：短视图契约与后续真实验证

[mock 索引](row-band-mock/README.md)保留 [初次 comparator 失败](row-band-mock/initial-failure/proof.json)及 [v2 通过](row-band-mock/v2-pass/proof.json)。初次失败是相同 sentinel bytes 的 TypedArray 构造类型不同；修正仅发生在独立 comparator，原失败没有被覆盖。mock 运行时间不是上传性能。

完整独立 uploader 候选只在 warm update 暴露现有 scratch buffer 的 row-band view：`byteOffset=top*W*4`，`byteLength=dirtyHeight*W*4`，源 width 仍为 `W`，源 y 归零，destination 仍为 `(left,top)`。没有复制/打包新的大像素缓冲。GPU scratch 仍保留完整原 domain，dirty rectangle 的实际上传内容与原生 mip generate/copy 链不变；typed-array view 本身仍可能有小对象分配。

v2 主 512 模式对照了两个完整 provider，其余模式使用明确的独立模型。后续 v3 增补双 provider 全模式对照；其执行/归档状态应以新增 proof 为准，**本索引不将尚未纳入本目录的结果预填为 native/formal 成功**。旧 mock README 的静态准备/quiet-window 描述是历史记录，不作为当前排程依据。

整数 box mip mock 无法代替真实 GPU sRGB/原生 mip readback；dispose/recreate 也不是实际 context loss/restore。之后完成的 [native fixture 汇总](row-band-native/summary.json)中，原版/候选各验证 1974 个 native mip rows、8417 次 layer 对照（含 compaction），channel difference 均为 0。原版/候选所有 raw reference/destination mip SHA、210 次 CPU copy 的实际 rectangle 与调用均相同；physical rectangle bytes 同为 156,098,648，CPU view 从未初始化，输入/source/Three 身份冻结检查通过。它是有限 fixture 正确性证明，不代替另外的 135 color/depth/distance shadow 矩阵，也不是 wall-performance 数据。

独立正式 ABBA 的完成状态与验收结果应另行归档。短 CPU view 既不意味着 ROI 字节减少，也不证明命令缓冲等待被解决。当前生产 uploader 未替换。

## Canvas route：实际缓存复用，不换算 FPS

这部分证据位于相邻目录，保持自己的源 epoch 与测量范围：

- [第一阶段说明](../latency-investigation/canvas-route-identity/README.md)及 [原始 proof](../latency-investigation/canvas-route-identity/browser/proof.json)：基于旧 8345 Atlas，1302 组/5208 次实际 world/portrait/figure Atlas 调用严格通过。1214 个声明共享组的完整源读取 2603→1389，RasterCache misses 2432→1260。共享限定为 plain empty presentation，保留所有原画笔参数、domain、facing、appearance、crop 和 world 阴影；custom/opaque 路由仍保留原始身份。
- [第二阶段说明](../latency-investigation/canvas-route-identity/stage2/README.md)及 [原始 proof](../latency-investigation/canvas-route-identity/stage2/browser/proof.json)：基于旧 d07 Atlas/builder，1017 组/4068 次实际入口调用严格通过。私有 WeakSet 登记 `appearanceFor` 内部冻结的原目录配置，使实际 issued weapon/盾/Ember 路径参与现有共享规则；480 个新增非空配置共享组令完整源读取 1629→1149、RasterCache misses 1296→816。非空 clone、自定义 detail/motion、非标准 prototype、Proxy、foreign builder 对象和 campaign model 不获得共享身份。

两阶段都复用既有 `unitPaintKey` 等价条件，未合并不同动作画面或扩展跨队伍人形配色别名；画笔收到真实原 pose 和 presentation。完整原源 RGBA、透明 RGB、阴影、crop、drawImage 参数和最终 Canvas 输出全部严格相等。第二阶段 UI 源读取仍为 333→333，没有新增 UI 读取收益。7 个实际入口测试与全局类型检查通过；WebGL 请求为零。

这些逐组清缓存的 observer 正确性矩阵没有测量帧时间、FPS、实际战场权重或进程内存。它证明实际限定入口的复用，不能解释或者宣称解决 3D Canvas miss 的长尾。

## 静态归档审阅

本索引新增前，`stall-followup` 为 **12,757 个文件 / 804,938,592 bytes**，Canvas route identity 为 **25 个文件 / 74,385,672 bytes**；后续捕获会改变这些计数。已有本地 Markdown 证据链接未发现缺失目标。

静态盘点时，两份未压缩 trace 超过 GitHub 单文件限制：`current-trace/trace.json` 为 180,401,405 bytes，`current-gl-trace/trace.json` 为 180,497,570 bytes。对应 `.gz` 分别为 14,251,482 / 14,387,594 bytes。以上数字保留该静态审阅时点；本轮命名证据归档沿用既有 gzip 的完整事件与解压 SHA，并在验证后清理这两个本地 ignored 裸副本，恢复步骤见 [归档索引](EVIDENCE-INDEX.md)。

来源快照数量较多，归档大小和审阅成本应单独处理。归档整理不能改变执行 provider/helper/raw 内容、掩盖失败，或把尚未完成的实验标成已验证。

[归档索引](EVIDENCE-INDEX.md)记录已完成 source-snapshot 的完整字节集合、去重边界与可复原路径。原 11 个 run 与后来完成的四个 row-band/ring512 pilot run 均逐解压文件 SHA 验证，共用一份 2,212,438-byte 压缩容器。两批先完整验证，再分别清理 12,320 和 4480 个裸快照文件；`current-trace` 与 `ring512-pilot-v2/candidate-B` 各 1120 文件均恢复到全新 `/tmp` 目录并逐 SHA 通过。原 raw/provider/helper 字节保留；本轮另将 16 份命名匹配证据精确压缩为同路径 `.gz`，正常单测无需保留其裸副本。运行原 source-archive 校验/恢复、helper 或 analyzer 前，先执行 `python3 scripts/art-naming-evidence-archive.py --materialize`，再按索引 materialize 所需源码快照。native、未来 formal 或其他活动捕获不纳入这两批固定清单。
