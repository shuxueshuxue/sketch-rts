# 灵体与资源消耗：本轮收敛记录

最新生产源为 `cc85481`，仍在独立 `perf/viewport-presentation` 分支和草稿 PR #346；未合并或部署。最新改动只去重同次前端同步的选择集合与调试遍历。美术、命中表现和此前局部优化继续使用 `77a2c3078b1f14c02f1058dc22fd31a80f9dd314` 的实现；42bd 队列诊断冻结的是这份较早生产源，不能与最新同步改动混成一次整帧测量。本轮没有改变 shared、server、SDK、AI、战斗、经济、维护费或回放规则。

## 实际采用的改动

| 范围 | 实现与验证 |
| --- | --- |
| 灵体作者模型 | 深空兜帽、褪色披罩、连续披袖与漂浮纱尾；没有通用肘部约束。世界、头像、全身、剧情及遗骸共用新画笔，旧实现删除。[美术和视频](spirit-redraw/README.md)、[真实游戏](spirit-models/gameplay/README.md)。 |
| 灵体不流血 | 客户端根据真实 hit 的 `targetKind` 排除 spirit，不改变 nonMechanical 战斗分类。身体也不接收邻血。39 项回归与完整残留周期检查通过；[实际受击证明](spirit-no-blood/gameplay/)另存完整来源和模拟事实。 |
| Canvas 目录配置复用 | Atlas 使用已有像素等价身份；内部原装备对象有私有品牌，自定义细节和配置保留各自身份。[两阶段完整源 RGBA 对照](card-streaming/latency-investigation/canvas-route-identity/README.md)及[真实装备覆盖](card-streaming/latency-investigation/canvas-route-identity/stage2/README.md)。读取次数降低不换算 FPS。 |
| 障碍受击索引 | 障碍复用已有 first-hit 索引，避免每个屏外障碍再次扫描 effects。一行改动、26 项既有测试、六组实际 Canvas 全 RGBA 相等。[局部 renderer 证据](obstacle-hit-index/README.md)。 |
| 本地小地图标记 | 仅缓存实际本地适配器发布的稳定视图；同 tick 新发布重新构造。公共房间和未知可变来源保持实时构造。每帧仍完整绘制小地图，relations、物品、舱内乘员、风和相机保持实时。[边界、测试、CPU 与 Chromium 证据](minimap-cache/README.md)。 |
| 同次前端同步 | 共用已经生成的 live selection IDs；建造/物品模式的其他入口仍即时构造。调试输出把单位和建筑分别合为一次遍历，保留全部 ID 和顺序。[真实 main 函数与输出对照](frontend-sync-reuse/README.md)，不增加跨帧索引假设。 |

灵体真实游戏的原版/新版各包含 80 WebGL 帧、17 Canvas 帧及六张 UI 图，覆盖六次召唤、左右 × 上 60°/水平/下 60°、攻击帧和变体、24 次实际拾取及六次原损伤管线死亡。完整模拟事实相同，四张非灵体 UI 原 RGBA 相同；世界差异限定在灵体、真实阴影、对应 UI 和遗骸范围。保留首版遗漏阴影边缘的失败，不声称重叠包络中的每个邻兵像素都独立相同。

不流血的后续真实对照使用相同新造型：原敌兵六次 16 点攻击使灵体自然死亡，伤害、85 点初始生命和死亡 tick 112 均不变。候选 303 ticks（含死亡后 190 ticks）及插值、独立 Canvas 和 GPU 墨迹都为零；旧版本 max air/ground/body 为 6/18/2，成功复现漏洞。685 份完整模拟快照与 22 项检查通过；104 对原 PNG 中，只有原灵体血迹所在的 50 对发生预期变化，其余 54 对完整 RGBA 相同。普通兵、野怪、机械及真实邻血转移控制均通过。[实际视频与完整证明](spirit-no-blood/gameplay/README.md)。

## 有用的局部资源结果

| 固定输入与成本域 | 改前 | 改后 | 解释 |
| --- | ---: | ---: | --- |
| 1000 屏外障碍 + 1000 特效，实际 Napi Canvas drawWorld；40 样本/方案均值 | 9.969 ms | 0.650 ms | 该压力 fixture 的局部 CPU 成本，非浏览器/GPU/FPS。每帧约百万 predicate 访问降为零次 find。 |
| 2k 单位，120 次小地图派生读取 | 85.83 ms | 28.95 ms | 12 轮均衡次序微测；40 次实际发布，保持所有标记。 |
| 10k 单位，相同发布与读取协议 | 605.24 ms | 207.36 ms | 构造次数 120→40，mark/sourceIds 构造数 1,264,080→421,360；不是 heap bytes 或游戏帧时间。 |

小地图 Chromium 证据动态运行真实本地 runtime/adapter 与生产 main 的标记读取、断开/启动生命周期；16 张同输入 Canvas 图的 3,379,200 RGBA 字节无差异。这不是完整页面交互或世界绘制 E2E。模型图片、实际游戏视频与局部 CPU 测量不是同一性能实验。

最新同步改动的实际 main 函数子集对照有 27 组，另有 5 组完整 debug 对象与序列化输出对照，全部相同；选择集合构造次数 42→21。混合 9 单位/2 建筑的 debug 输入访问分别 32→9、5→2，map/filter 中间结果数组 6→0。输出数组仍完整；这些是实际调用/构造计数，不是 heap bytes、CPU 时间或 FPS。[原/新相关源与执行程序](frontend-sync-reuse/README.md)保留；停止发布时显式清除旧 live IDs 的真实适配器回归通过。

## 未采用的上传与存储候选

下表三项候选冻结在原 `8345` 美术与运行源，并保存原生 GPU、输入、运行图、Three 身份、优化依赖首尾 SHA、像素与全部计时证据。后续 depth-one scratch 实验单独冻结 `42bd61c74934dc76f30d42b62e1e31eb5c5974ff`；不同来源与成本域的数据不能叠加成最新整体游戏提速。

| 独立候选 | 实测 | 决定 |
| --- | --- | --- |
| 半级 mip 余量 | 完整 v2 ABBA：owned GPU 191.72→125.40 MB；CPU mean 40.13→41.48 ms；complete real mean 426.49→426.08 ms。 | 跨硬件采样安全未证明，CPU 变差、整体帧基本不变；不改生产默认。 |
| 较短 CPU row-band view | 原生逐层像素通过；单 AB/一生命周期 complete real mean 417.36→431.93 ms。 | 无收益信号，不采用；不是完整 ABBA 结论。 |
| 仅 512² 临时纹理双槽 | 每方案 10,684 原生 mip/layer 比较零差异；单 AB complete real mean 409.80→422.58 ms；额外 CPU 1 MiB/GPU 1.33 MiB，上传字节 +0.71%。 | CPU mean 虽降低 4.33%，真实整帧变慢且多占内存；不采用。 |

[追踪与完整实验索引](card-streaming/stall-followup/README.md)保留负结果。旧源诊断定位到 `texSubImage2D` 内 255/275 ms 命令缓冲等待。当前 42bd 源的 [三策略严格队列对照](card-streaming/stall-followup/queue-bracket-v3/analysis-strict-v3/REPORT.md)中，六生命周期的源码、实际工作计数、18 张图、事实、时钟和原生 GL 内容命令一致：前置 410–427 ms 完成等待使约 226–228 ms 上传阻塞迁移，后置完成仍需 926–944 ms。各策略完成边界不同，不能用缩短的 CPU draw 声称提速。没有证明是哪条早前 GPU 命令造成等待，也未解释旧 696.9 ms 停顿。**该长尾仍未解决**，没有硬件 GPU 对照或通用 FPS 提升声明。

[匹配 Chrome 版本的官方源码审阅](card-streaming/stall-followup/command-wait-offline/CHROMIUM-SOURCE.md)确认暂存区回收可等待旧 token，但没有从实际轨迹恢复 token→分配块→纹理/命令的映射。三策略保留失败 v1/v2 和全部完整导出，未把等待加入正式同步渲染路径；仍需精确输入的逐上传/阶段诊断。当前 `/dev/dri` 不存在，SwiftShader 测量不能泛化成硬件 GPU 成绩。

后续 [精确输入重放](card-streaming/stall-followup/exact-upload-replay/README.md)实际保存 n135 的 53 份完整 RGBA（85,458,944 bytes），保留 warm scratch 和全部页状态。独立验证逐次检查 523 个写入 mip，所有 1,040 个最终驻留 mip/layer（含未写层）匹配；全部输入、选定原生调用及完整源身份保持一致。首轮因 Vite JSON `?import` 映射失败而 EXIT1，原记录保留；独立离线审计只用已存 HTTP 正文和实际 import edge 补齐 199 bodies / 388 映射，未把旧失败改为成功。

[三段 v4 最终报告](card-streaming/stall-followup/exact-upload-replay/stage4-report.md)记录实际 EXIT0/PASS：159 个非 disjoint query 中，upload/到达命令段为 0.03892 ms、真实 native generation 命令段为 826.53367 ms、全部 tail copy 段为 95.01889 ms；CPU 提交分别为 32.8 / 0.4 / 9.0 ms。很短的 upload GPU 标记不表示 CPU 上传免费。总 envelope 1109.4 ms 包含 async completion/poll/marker；它是排空历史后的局部诊断，不是正式整帧优化对照。源上传矩形 20,053,380 bytes，完整 mip 复制 102,868,324 bytes；不能从较大的复制字节猜它最慢。生成命令段是当前软件环境的主要观察成本，但 marker 包含到达/等待，旧 token 的资源链仍未证明。真实 HTTP 转换后 JS 正文、原生像素、源/依赖和字段级初末态检查均通过；没有采用绕开原生 mip 或降低画质的方案。

后续 [depth-one scratch 完整实验](card-streaming/stall-followup/depth1-scratch/README.md)仅在独立候选中把 GPU scratch 改为单层 `DataArrayTexture`，锁定四项纹理/向量/零层替换，原 CPU 来源、像素、native mip、ROI、LRU、同步上传和模拟规则均保留。最新生产源仍为 `cc854814473bb684e4444eb69719b9978b6dbdc6`；这次候选经验证后**不采用**，未写入生产 `src`。

[严格原生与真实游戏对照](card-streaming/stall-followup/depth1-scratch/native-compare-v2/summary.json.gz)实际 PASS、差异零：原 53 份完整输入、523 个写入 mip、1,040 个最终驻留层级、12 对完整 RGBA 图、19,080 次拾取、303 份完整模拟快照及校验和均一致。灵体六次受击、五次反击、共十一 hit、死亡 tick112 和零血迹保持原规则；每个成功 run 的 202 份实际 HTTP 正文及 392/392 映射通过。1,125 个原 Git 源文件逐完整 SHA 与固定 `99aa634b…` 集合身份核验，执行候选另外保存。十个指定资源时钟仅从数学状态等价中排除，逐项实际值保留，没有宣称时钟相等。原 [native v1](card-streaming/stall-followup/depth1-scratch/native-original-v1/proof.json.gz)仍为 EXIT1；错误的 total-hit 断言及两处动态 import 映射问题只在后续 v2 helper 修正，没有改写过去记录。

[完整帧 ABBA 对照](card-streaming/stall-followup/depth1-scratch/frame-compare-v1.json.gz)实际 PASS，24 张 battlefield/empty/return 图及资源结构差异零。A1/B1/B2/A2 每 arm 两个 renderer 生命周期，每侧 48 个真实三段绘制加 GPU completion 的 complete-wall 样本均值 **435.723→428.171 ms（−1.73%）**，P95 **1,315.700→1,316.000 ms** 基本不变；每侧 240 个关闭 `renderer.render` 的辅助 CPU 构造样本均值 **40.925→42.034 ms（+2.71%）**。应用 owned card CPU **7,787,776 bytes**、GPU **191,718,124 bytes** 完全相同，不是物理驱动内存。独立 query 的 generation 命令边界 **828.187→826.465 ms** 没有实质变化；它与完整帧不是同一个计时成本，不能相加。该场景是原 20-kind/100-visible-unit 资产输入，实际战斗另作等价验证；Chromium/ANGLE SwiftShader 结果不泛化为硬件 GPU、整应用 FPS 或已解决历史 token 长尾。

[原生因果诊断可行性检查](card-streaming/stall-followup/native-causal-feasibility/README.md)随后只读盘点已安装 ELF、工具、匹配调试数据、权限及普通私有空白页启动；[实际摘要](card-streaming/stall-followup/native-causal-feasibility/feasibility-summary.json)没有将它称为完整 caller/token 链实验。未运行游戏、重抓 trace、重复旧 benchmark 或安装/构建浏览器，生产 cc 源不变。匹配 Build-ID 的 chromium/libEGL/libGLESv2 debug/type 信息在检查位置缺失，二进制没有 `.symtab`/内嵌 DWARF，`perf`/`gdb`/`lldb` 等观测工具未安装；`.eh_frame` 或同版本上游源码不能代替匹配符号与可恢复对象信息。disabled 的 own-task perf descriptor 成功并关闭、own true-child strace exit0，均不等于 Chrome 原生栈/子进程 attach 已可用，不能把权限简单归为全被 sandbox 拒绝。

普通 [v2 launch](card-streaming/stall-followup/native-causal-feasibility/stock-browser-v2/proof.json)在 DevTools 前 SIGABRT，helper 只读 stat 为 uid65534/mode4755；没有绕开 sandbox 或改配置，实际 CDP categories、live protocol 和 native sampling 未取得。原 wrapper exit13 失败保留，v2 只修 teardown。继续需要可用且获授权的启动方式，加匹配 native debug/type data 与 debugger/sampler，或来源可核的 instrumented build，并实际记录 caller→helper/route→allocation/block/shmem→token→服务端 command 身份链。记录不得额外调用会变更状态的 getter，SetToken 也不等于 GPU completion。旧 WaitForToken 的真实 caller 和资源链仍未证明；硬件 GPU 性能/质量验证是另一个缺口，不能用缺少 `/dev/dri` 替代这项 CPU 因果观测不足。新增证据及这两份更新文档的静态 naming 匹配为零，13 份文档/400 个本地链接有效；没有重跑 SDK、客户端测试、构建或任何 native/capability 检查。

## 最终检查与剩余边界

最新同步源的客户端/剧情测试 **132 文件 / 1067 tests 全通过**：[日志](frontend-sync-reuse/all-client-tests.log)。`build:production` 包含全局 TypeScript、Vite 和 server bundle，exit 0：[日志](frontend-sync-reuse/production-build.log)；[源首尾 SHA](frontend-sync-reuse/all-client-build-checks.json)一致。此前 77a2c307 的 1066 tests 和构建日志仍保留在 spirit-no-blood 目录，真实灵体和小地图证明在该源冻结后完成，原始失败及来源不改写。

较早的 d7 全仓测试为 609 文件、6466 通过/5 失败：[完整日志](spirit-redraw/validation/full-tests.log)。四个船舶导航失败在冻结 8345 上完全复现，shared/SDK 树及工作区无变化；另一个文档命名门已在基线失败，但本轮证据新增匹配项（该次 22→34），不能把整个失败称为未变。[复现与精确树证据](spirit-redraw/validation/baseline-8345-comparison.json)。未修改这些规则或测试，也未宣称全仓全绿。

新增证据归档前命名匹配一度到 40 项；完整输入逐字压缩、恢复校验和清理后，原 SDK 单测实际仍为 6 pass/1 fail、22 个匹配，名单严格等于冻结基线。[新增影响清零与未通过的原测试](naming-gate/README.md)分开报告；未修改测试、旧基线字节或检查标准。最新 fetch 的 main 为 `98cf811`，从共同基线 a644 的新增提交没有修改 client/shared/server/SDK；AI 与工作流的上游改动不由本车道重写。

Depth-one 阶段随后完成 [全部输入与来源精确归档](card-streaming/stall-followup/depth1-scratch/archives/README.md)：799 份输入逐原 size/SHA 恢复，七组共 7,875 个源文件逐 Git blob 与完整 SHA 恢复，50 份原 PNG/Markdown、全部 manifest 及共享容器字节通过。首次打包排序校验失败完整保留，后续 verify/materialize/prune/final verify 实际通过；归档不重写 native v1 失败或候选否决结论。原 SDK 单测仅再运行一次，[新日志](naming-gate/final-depth1-single-test.log.gz)实测 **6 pass / 1 fail / 23.78 秒**，[新逐项验证](naming-gate/final-depth1-validation.json)仍严格等于原 22 项、新增零；[source/public 首尾冻结](naming-gate/final-depth1-source-freeze.json)证明生产树、工作 diff 与原测试 SHA 未变。最新 cc 源的 1067 个客户端测试和构建沿用前述原执行证明，本阶段没有重复运行或宣称全仓全绿。

公共房间每次读取的快照复制与派生成本仍未优化。渲染器已在作画/提交前裁剪单位、建筑、船只、尸体、投射物和接触墨迹；地形仅保留可见 chunk。必要模拟、动作/血迹历史和完整小地图仍覆盖全世界，不能通过删去它们冒充渲染收益。

完整源快照与原 Chrome trace 精确压缩保留，并提供 materialize 工具；SHA 检查及恢复通过。[归档索引](card-streaming/stall-followup/EVIDENCE-INDEX.md)记录压缩前后字节、失败与复原路径。
