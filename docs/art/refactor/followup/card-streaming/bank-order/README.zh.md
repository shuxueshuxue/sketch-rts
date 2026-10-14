# 稳定绘序与按需纹理驻留：最终单银行配置

本页的 `.gz` 数据链接保存原始输入的完整字节；解压恢复与校验方式见[归档说明](../../release-readiness/README.md)。

当前冻结源为 **`0de509cc01e47b91a3012d33d2e75a7106d3e4a5`**。生产默认使用 **1 bank、原隐式纹理采样**；非空新页按本帧剩余唯一请求分配，不在预算内一律预留十六层。多银行仍是同一有序绘制系统的显式可选能力，但此前默认 8 bank 候选已因严重完成时间回退被拒绝，2/4 bank 诊断也未解决问题。

当前同源正确性、工程验证和独占正式实测已经完成。**单银行避开了多银行严重回退；canonical GPU 完成 wall 基本持平，mixed CPU/wall 仍变慢，不宣称整体帧时间或所有视图内存改善。** 参考与候选都使用 `0de509c`、同一单银行默认和同一页容量策略，仅比较 **完整原始 mip 链**与 **原始 mip 尾部的动态驻留**。这不是旧引擎与新版的版本比较，也不再是 `e02` 的 1→8 银行联合配置。

## 当前已验证的范围

| 验证 | `0de509c` 实际结果 | 证据 |
| --- | --- | --- |
| 客户端测试集 | **124 文件 / 956 项通过** | [client-final.log](../validation/client-final.log) |
| 生产构建 | 通过；包括 TypeScript、Vite 和 server bundle，保留 Vite 大 chunk 提示 | [build-final.log](../validation/build-final.log) |
| 同源 31 步相机 | 原生 actors/composite、raw WebGL RGBA/alpha/阴影逐通道零差异；picks/facts/now 相同 | [最终 QA](final/qa.zh.md)、[camera comparison](final/camera-comparison.json) |
| 同源真实战斗 | **160 真实 ticks / 80 帧**，80 个原 PNG 文件 SHA 和 80 个模拟 snapshot SHA 全部相同 | [battle comparison](final/battle-comparison.json.gz) |
| 三类实际雇佣单位 | e02 原玩法记录与 0de 最终 renderer 的 **40 个原生 PNG 全 RGBA/alpha、模拟与全部记录事实相同**；规则树和美术源相同 | [实际游戏 comparison](../../mercenary-models/gameplay-final/comparison.json) |

客户端测试集通过不是整个仓库、AI 或所有服务器测试都通过。较早 `e02` 的 **952 项**与构建日志已另存为 [client-e02.log](../validation/client-e02.log) / [build-e02.log](../validation/build-e02.log)，不能把旧计数或其 source 标成当前验收。

相机 fixture 覆盖二十类代表资产；guard/blood 是独立的真实战斗场景，不能称为二十类资产覆盖。两者不包含三个新雇佣单位；实际雇佣记录补充这些单位的真实购买、攻击、移动、治疗、拾取与遗骸路径。三次死亡由脚本调用原 `strikeUnit` 规则触发，不描述为自然战斗全部击杀。捕获和编码不是正式性能样本，MP4 只作观看副本。

完整原始 PNG 以 **byte-exact tar.gz** 保留，选定 PNG 仍可直接查看；归档未解码、缩放或重新编码，原 PNG 字节 SHA 与历史通过/失败结果不变。需要运行旧 PNG-based comparison 时，先按[归档与恢复说明](../../png-archives/README.md)恢复对应目录；proof/source 文件保持原样，不能把目录内只留下选图理解为只验证了 keyframes。

原始 [camera reference](final/camera-reference/proof.json.gz)、[camera candidate](final/camera-candidate/proof.json.gz)、[battle reference](final/battle-reference/proof.json)、[battle candidate](final/battle-candidate/proof.json)保留全部输入、时钟、captured files、source/client/helper/harness SHA 与实际 variant 设置。DPR 2 使用真实 CDP 设置及原生 2560×1440 / 1280×720 图像；没有降采样、透明区屏蔽或通道容差。首次返回、首次晋升与 repeat 都覆盖。

## 为什么绘序必须独立于缓存

旧实现让纹理页同时拥有材质、几何和 instanced mesh。颜色 pass 的材质排序、阴影的场景树顺序，以及暖命中先于 pending 请求绑定，都可能让缓存的创建与回收改变等深部位遮挡。同一单位状态和相机移开再回来，页材质重新创建也可能反转先后。

以下失败继续原样归档，不以新证明抹去：

| 历史对照或诊断 | 实际失败 |
| --- | --- |
| mixed：`2a0d3a2 → 55d6b3b` | 两次独立生命周期的 battlefield 各 3 个差异像素；returned 恢复旧图 |
| 战斗：`f87c3b7 → 55d6b3b` | frame 8 的 33 个差异像素，模拟 snapshot 相同 |
| 按每页最早单位序号排序的诊断 | 恢复上述交叠，却在战斗 frame 4 新增 113 个差异像素 |

[完整诊断](../mip-residency/render-order-diagnostic.zh.md)说明，整页排序无法表达不同页中单位的任意交错。当前两侧都采用 corrected stable ordering，会有意修复旧缓存相关遮挡，**不能声称当前与旧版 80 帧全部零差异**。历史 `f87 → 742` 上传/缓存证据也不自动证明后续版本。

## 单一有序绘制体系

每个原始绘画身份只对应一个 `Card`。原有美术 key、源密度与作者 tile 决定身份，`baseMip` 记录实际质量，不创建并列美术资产。细链可以直接满足较粗请求；需要更细链时先上传成功，再替换卡及本帧已绑定实例。失败保留原缓存并中止不完整帧；拾取保留原始 `sourceSize` 和 alpha 遮罩。

缓存 `Page` 只拥有纹理、层卡、上传状态及最近使用帧。每次 `add` 在判断冷热缓存之前取得顺序号，暖命中和 pending 请求填入同一组按号索引的实例记录。升级和页压缩只重绑卡指针，不改变顺序、矩阵、脚底位置或透明度。

绘制按实例顺序组装 chunk。当前默认一个 chunk 只引用一个纹理页；下一不同页开始下一批，同一页可在之后的批次再次引用，不复制纹理。显式多银行配置允许一个 chunk 最多八页、遇下一不同页再分批，仍使用同一代码与顺序规则，不存在旧 page-mesh 兼容 renderer。每实例的 bank/layer/rect、矩阵及可选透明度选择原始样本。

`DEFAULT_CARD_BANKS=1` 同时供 batches 构造默认与 WorldLayer 使用，WorldLayer 再与公开纹理单元能力取最小值，并保留四个其他 sampler 单元。默认颜色、深度和距离材质都使用原 `texture(map,...)` 隐式采样。可选多银行使用分支前 UV 导数与 `textureGrad`；它的性能不因 draw calls 更少而获得默认资格。

每个 chunk，包括 chunk 0，都在 `[base + .0001, base + .001)` 内严格递增。当前颜色 pass 中同 groupOrder、同 base 的原生对象在这些批次之前，避免银行分段改变等深关系。公共 group 保持默认 group order，children 按 chunk 顺序排列供阴影遍历。没有每单位 depth bias，没有修改原脚底、UV 或 float32 几何端点。

缓冲和材质池可以复用，所有编译变体读取当前纹理绑定；开始新帧先隐藏旧批次，清卡、页和 sampler 引用，失败帧不暴露上次粗链。闲置池最终释放，context 恢复由下一普通帧重建。raycast 使用原作者平面与真实距离，命中后检查对应实例的原始 alpha 遮罩。

## 页容量按真实需求选择

软预算仍按 **12 × 1024 × 1024 个实际分配的基础像素**计，包含空层；当前可见工作集可以超过预算。`finish` 先聚合每 key 最细请求，再按实际驻留尺寸合并唯一待上传需求。不同原 source 可以共享相同驻留尺寸的页，重复实例不重复计需求。

**非空新页**在预算内外都限制为最多十六层、本帧该尺寸剩余唯一需求，并在预算内受剩余容量限制。已有兼容空位或可淘汰暖卡先复用；不 shrink/reallocate 活页，不增临时第三页，不加另一个 reserve 抽象。大军同帧需求足够时仍分配完整十六层页。空输出使用廉价 16px 域，预算内保留共享十六层页，预算外新增单层：三十二个空 key 用两页，与三十二个单层页总 texel 存储一样，但避免无价值的纹理与 draw 增长。

压缩只复制到现有非活动空位，全部成功后发布；失败时活动源保留，被部分覆盖的暖目的身份失效。新的小页可能增加页数、初始化、扫描、draw 和淘汰：例如跨帧逐个出现的二十种动作可形成二十个单层页，虽然仍只栅格化二十次。其实际代价必须进入正式测量，不能把减少预留容量直接称为优化成功。

## 原始 mip 尾部与拾取精度

画笔、读回与 scratch 仍保留完整源 RGBA 和原生 mip 链。小数组复制原链从 N 开始的层级，`sourceLevel=N+destinationLevel`；不在小画布重画、不裁透明域，也不从缩小的基图重新生成链。源密度、过滤、各向异性、cutout 阈值与拾取遮罩维持原定义。

动态 gate 同时检查实际颜色 framebuffer/DPR、相机矩阵、单位变换和当前 2048px 太阳阴影需求，保留额外安全级与数值裕量，要求精确整数重定位，最多 N4。非法输入、空 pass 集合或传入的非支持投影保持 N0。gate 不会自动发现未传入的新灯或变形；调用者必须扩展 pass 模型或禁用 gate。已有更细链不强制降级，返回需要细链时在绘制前升级。

这不减少可见内容、不改作画、分辨率或阴影，也不改命中、模拟、AI、经济、维护费或战斗平衡。驱动各向异性实现不同，当前软件 GPU 零差异不能扩大为所有硬件保证。

## 当前相机资源：四个视图仍增加

[最终相机资源报告](final/qa.zh.md)及[逐步摘要](final/camera-resource-summary.json)使用同 `0de` 的 1-bank full / native。31 步 owned GPU texture **10 步下降、17 步相同、4 步上升**，每步 posed 数相同：

| 增加步骤 | full reference MiB | native candidate MiB | 增加 MiB |
| --- | ---: | ---: | ---: |
| DPR 1 / 1280×720 / zoom .35 | 62.654 | 67.424 | **4.769** |
| DPR 1 / 1280×720 / zoom 1.5 | 173.290 | 186.623 | **13.333** |
| DPR 1 / 1280×720 / zoom 2 | 173.290 | 186.623 | **13.333** |
| DPR 1 / 640×360 / zoom .35 | 46.654 | 61.779 | **15.125** |

| 整条序列容量统计 | 1-bank full | 1-bank native |
| --- | ---: | ---: |
| draw 后最大 owned GPU texture | 186.623 MiB | 186.623 MiB |
| tracked transient GPU texture peak | 243.798 MiB | 233.277 MiB |
| ending owned GPU texture | 181.290 MiB | 162.019 MiB |
| draw 后最大 owned CPU | 55.671 MiB | **56.523 MiB** |
| tracked transient CPU peak | 59.356 MiB | 59.356 MiB |
| ending owned CPU | 55.546 MiB | 55.095 MiB |
| 最大 drawBufferBytes | 48,296 B | 44,476 B |

部分视图还增加提交：zoom .65 的 chunks/calls 为 **38/79 → 50/103**，promotion-low 为 **39/81 → 60/123**。这是正确性 probe 的容量与调用记录，不是正式帧时间；不能沿用 e02 八银行的 dispatch 收益，也不能以末值或过渡峰值下降覆盖四个视图与 CPU 峰值的增加。请求 gate 的 N0/N1 数不等于实际驻留 histogram，细链可以继续满足粗请求。

## 保留被拒绝的性能实验

[e02 同源正式报告](e02-performance.md)保留 1-full、8-native 和 1/2/4-native 全部原样本、分布、资源及不利指标。canonical hidden0 的 8-native real mean 为 **258.78 ms**，参考 **142.27 ms**；hidden9900 为 **267.77 / 156.13 ms**，mixed 为 **693.40 / 437.25 ms**。2/4 银行也未恢复完成时间，因此没有发布这些默认。e02 的单银行 native 诊断恢复到参考区间，仍有 CPU/尾部/最终驻留回退，不作为当前 0de 的正式性能验收。

[单银行梯度归因](grad-diagnostic/README.md)用相同直接 Three 场景做 ABBA，只替换隐式采样为显式 `textureGrad`：平均完成 wall **192.70 → 501.78 ms，约 2.60×**，submission 均约 .6 ms。40 个 target captures 中有 30 个实际独立对照，全部通道零差异。它显示当前 SwiftShader 的显式梯度路径是实测贡献，**不证明八银行会执行八次物理采样，不解释驱动内部，也不建立硬件行为**。原失败 raw 保留，不以 branch 改写或更少调用掩盖结论。

[135 项核心矩阵](../bank-correctness.md)与[raw](../banks/matrix.json)来自 `02197dc`，覆盖隐式单银行/显式多银行颜色、太阳深度、点光六面及共面原生边界，合计 2,809,036,800 个 RGBA 分量零变更。当前 shader/uploader 未改，但 **batches 默认和新页分配已改变**，不能再称当前三个核心 SHA 都与该矩阵相同，也不能把该矩阵说成已覆盖新雇佣画笔或当前全部 allocator 行为。当前配置的依据是上面的最新测试、相机、战斗与实际雇佣证明。

## 最终正式实测：容量收益与时间回退并存

已完成的正式比较将同 `0de` 的 **1-bank full** 与 **1-bank native**串行执行；两侧单银行、页容量、paint、完整 source、密度、几何、阴影、地面、HUD、事实时钟相同。full reference 只让驻留 gate 返回 N0，也跳过这项 SVD 成本，是有利于参考的控制；候选的 gate 成本必须计入结果。setup 在 prepare/first draw 前，不在 measured draw 内新增资产/key/cache 观察器或排序补丁。harness 的常规及嵌套计时一致，metadata 保存源与脚本身份。

Canonical 保留 100 visible 加 0/9900 hidden、两次新生命周期、CPU360/real18；mixed 保留原二十类/100 visible、两次新生命周期、CPU60/real12及跳时后的首帧峰值。模拟与 snapshot 构造按 harness 放在 presentation 计时外；这些工作没有因此被从游戏删除。原始样本、合并后的经验分布、每生命周期、上传与分配、首帧/返回及所有不利指标见[最终性能报告](final/performance.md)与[汇总 JSON](final/performance-summary.json)。两个正式 comparison 全部通过，共 **18 张 battlefield/empty/returned PNG、6 组 facts/lifetime**，校验同源、脚本、时钟和完整 sample grid；见[canonical comparison](final/canonical-comparison.json.gz)、[mixed comparison](final/mixed-comparison.json.gz)。旧 e02 报告不能移称当前结果。

正式时间均值如下，单位 ms；完整 p50/p95/p99/max 和阈值计数在原始报告，不用平均各生命周期的分位数。

| 场景 | CPU：full → native | GPU 完成 wall：full → native |
| --- | ---: | ---: |
| canonical / hidden 0 | 4.67 → 4.25 | 161.71 → 160.95，基本持平 |
| canonical / hidden 9900 | 11.06 → 10.98 | 149.40 → 149.71，基本持平 |
| mixed / hidden 0 | **42.12 → 44.69（+6.10%）** | **421.68 → 434.76（+3.10%）** |

mixed CPU p95 **115.30 → 132.90 ms**，120 个样本中超过 100 ms 由 **14 → 19**；首 real cold-stream mean **1320.0 → 1354.5 ms**，后续 22 帧也由 **340.02 → 351.15 ms**。首帧峰值保留在主要均值中，不能删掉再称加速。canonical hidden0 wall p95/p99 同样有回退，hidden9900 CPU max 为 **69.00 → 103.60 ms**；所有不利方向列在 summary 的 `measuredRegressions`。

最后 real sample 后的程序卡片容量计数如下，含 warmup/preparation，不是每帧布局或测量区间内净分配：

| 指标 | canonical full → native | mixed full → native |
| --- | ---: | ---: |
| owned card GPU bytes | **69,926,496 → 71,051,352（+1.61%）** | **210,914,668 → 191,718,124（−9.10%）** |
| tracked peak owned card GPU bytes | 79,101,372 → 71,051,352（−10.18%） | 210,914,668 → 194,710,892（−7.68%） |
| owned card CPU bytes | **12,568,384 → 13,143,872（+4.58%）** | 7,882,496 → 7,787,776（−1.20%） |
| resident mip copy bytes，累计 | 1,416,496,852 → 828,988,672（−41.48%） | 3,593,517,112 → 3,312,449,592（−7.82%） |
| CPU raster misses，累计 | 129 → 129 | 1,573 → 1,573 |
| draw buffer bytes | 85,700 → 30,016 | 50,088 → 41,444 |
| 最终 dispatch calls / triangles | **159/424 → 199/424** | **124/404 → 142/404** |

这些数据支持具体的峰值、mip 拷贝及 mixed 驻留容量收益，同时证明有 CPU、尾部、调用次数和部分稳态回退。更小 typed buffers 不是更少 draw calls，CPU raster miss 未改善。当前保留经过画面验证的默认 1-bank；后续仍需要真实硬件 profiling 和这些回退场景的定向处理，**不声明所有优化已经完成**。

两侧都使用新的小页策略，因此本轮 full/native 差值不能单独归因于页策略。旧 e02 的 1-bank native 最终 GPU 容量 **89,062,020 B**、当前 **71,051,352 B**，以及旧 full **84,081,948 B**、当前 **69,926,496 B**，只作为不同源树的绝对分配观察保留；它们不是同源净性能比值，也不与上面的同源收益重复计算。

CPU presentation 包含画笔、Canvas、上传和 driver backpressure，禁普通 `renderer.render` 不等于纯 JavaScript。real 完成 wall 包括 GPU 完成、fence 轮询和事件循环；Chromium/ANGLE Vulkan **SwiftShader 是软件 GPU**，不是硬件 FPS，也不是精确 GPU timer query。canonical 每人口仅 36 个 real 样本、mixed 24 个，不支持稳定硬件 p99 或普适无卡顿结论。复现参数与脚本职责见[方法记录](method.zh.md)，当前[正式运行脚本](../../../../../../scripts/art-card-bank-final-performance.sh)使用冻结 `0de509c`，两侧均 `--max-banks 1`，mips 分别 full/native；不要使用历史 e02 的 1→8 命令代替最终方法。

## 内存统计的范围

| 指标 | 统计范围 | 不代表 |
| --- | --- | --- |
| `ownedGpuBytes` / peak | 已上传活 array 的精确原生 mip 存储及 uploader scratch texture 程序容量 | geometry/buffer 副本、其他 scene/shadow 贴图、驱动实际 VRAM |
| `allocatedMipBytes` / `pixels` | array mip 容量 / 已分配基础像素，含空层 | 活卡像素数或驱动回收时刻 |
| `ownedCpuBytes` | 遮罩、pending RGBA、row/empty buffer、scratch CPU 与压缩缓存 | chunk buffers、Canvas、JS 对象、整进程 RAM/RSS |
| `drawBufferBytes` / capacity | 池内 geometry attribute/index 与 instanceMatrix 的 CPU typed-array 字节及容量 | GPU 实际 buffer 驻留、ID/实例记录/材质对象 |
| Canvas / heap / RSS | 只有明确方法与采样时刻才分别解释 | 不能用 dispose 后 GC heap 代替战斗峰值 |

绘制缓冲单列，不称新属性或池复用零成本；不能把程序纹理容量当实测显存。原画、读回、遮罩和完整 source scratch 仍存在，晋升暂留粗细存储，更多暖卡可增加原遮罩；driver 回收不必与 `dispose` 同时。必须同时看稳态与过渡以及每个回退视图。

## 相关独立交付

`454336d` 的[首页音频](../../../../../validation/homepage-audio/README.zh.md)、`e02b24e` 的[独立雇佣模型](../../mercenary-models/README.md)与[浏览器 idle 身份证明](../idle-identity/browser-current-merc/README.md)保留独立范围；最终 renderer 的[实际雇佣对照](../../mercenary-models/gameplay-final/comparison.json)也单列。它们不是此 full/native 配置比较的变量，不算作纹理驻留的性能收益。
