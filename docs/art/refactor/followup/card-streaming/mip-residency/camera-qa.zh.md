# 数组页分配候选：31 步相机 QA

**后续正式验证发现遮挡回退，`55d6b3b` 尚非最终验收版本。** held-camera 的 31 步仍严格通过，但另一缓存历史的正式 mixed 有 3 像素回退、真实战斗 frame 8 有像素回退；详情及独立 ablation 见 [缓存绘序诊断](render-order-diagnostic.zh.md)。不能把本报告扩大为全部历史的视觉一致性。

验证 source `55d6b3b5e0c76aa1fbfac59a39dc5b5d941748d3`，对照完整原 mip 链 baseline `2a0d3a27608c9e56ca8de6949759c975ee06c1d9`。本轮包含单一 source 晋升、逐像素相同的 idle key 共享，以及稀疏数组页分配修复。原画、source RGBA、原密度策略、几何域、完整 source picking mask 和实际 2048px 阴影需求保留。

[严格比较](camera-comparison.json) 的 31 个步骤全部通过：62 对原生 actors / 三层 composite PNG decoded RGBA 每个通道完全相同，未用容差或缩图；原始 WebGL `readPixels` 的完整 RGBA（含透明区与阴影 alpha）、production picking、snapshot facts、固定 now 也全相同。GL error 全为 0，返回与晋升第一帧及 repeat 帧相同。所有版本的每步 posed 数完全相同；收益没有来自减少画面内容。

原始 [baseline](camera-before/proof.json) 与 [本候选](camera-after/proof.json) 保留 harness/fixture、client source SHA、物理尺寸、GC/disposal 与原始 counters。全部原始 PNG 编码字节保存在[精确归档](../../png-archives/README.md)，选定图像可直接浏览。DPR 2 图为真实 CDP 下的原生 2560×1440 / 1280×720，并逐物理像素捕获。相同 fixture 的 100 单位 / 20 种、生物/魔像/攻城器械、两队及动作/血迹范围见 [方法说明](camera-qa-coexisting.zh.md)；该场景始终是受控表现 facts probe，不冒称真实模拟战斗。本报告仅是正确性与资源计数验证，正式渲染耗时由独立测量窗口完成。

## 实际内存及剩余回退

[逐步骤资源摘要](camera-memory-summary.json) 保留全部 31 步、四个版本的 actual owned GPU / CPU、allocatedMipBytes、页/卡数、mip copies、compaction copies、posed 与 requested gate。请求 N0/N1 的比例不是实际驻留 histogram：更精细的已有链可继续满足较粗请求，不能据此推导显存节约比例。

程序资源计数如下，单位 MiB。GPU 字节包含真实已分配数组 mip 容量、scratch 和仍驻留的 warm cards；不表示驱动 VRAM 或进程内存。

| 指标 | 原链 baseline | 旧多档共驻 `62b2b1b` | 旧 one-source `3205988` | 本候选 `55d6b3b` |
| --- | ---: | ---: | ---: | ---: |
| draw 后 owned GPU 最大值 | 211.519 | 225.602 | 246.809 | **186.623** |
| tracked transient GPU peak | 264.064 | 261.542 | 261.542 | **233.277** |
| ending owned GPU | 210.185 | 210.185 | 175.061 | **162.019** |
| ending actual array mip allocation | 206.331 | 206.331 | 171.207 | **158.165** |
| draw 后 owned CPU 最大值 | 55.725 | 57.033 | 56.484 | 56.218 |
| tracked transient CPU peak | 59.300 | 59.446 | 59.444 | 59.356 |
| ending owned CPU | 55.725 | 55.666 | 55.400 | 55.095 |

原先不利的 `promotion-low` 已从 baseline 210.185 / 旧 one-source 246.809 MiB 降至 **184.732 MiB**。`camera-battlefield` 为 210.185 → 182.842 MiB，返回第一帧为 211.519 → 175.837 MiB。新页分配解决了这几个大型密度 4 镜头的驻留回退；它没有使每个步骤都更省内存。

31 步中，26 步 owned GPU 下降、2 步相同，以下 **3 步仍回退**，全部 zoom 0.35（原生产 density 2）：

| 步骤 | 原链 owned GPU MiB | 本候选 MiB | 增加 MiB |
| --- | ---: | ---: | ---: |
| DPR 1、1280×720、zoom 0.35 | 52.545 | 59.861 | **7.316** |
| DPR 1、640×360、zoom 0.35 | 52.545 | 61.779 | **9.234** |
| DPR 2、640×360、zoom 0.35 | 52.545 | 57.321 | **4.776** |

这些是同一镜头切换序列中的实际 warm-state 分配差异，不能略去或只选择 ending 值宣称全面改善。high DPR / 小窗口 shadow 在需要时继续请求 N0；原密度边界及全质量 source 没有下调。CPU 最大值与 transient peak 也有小幅增加，完整原始证据继续保留。

## 转移与整理成本

终点累计 GPU layer transfers 为 1,536 → 1,510，mip copies 为 14,964 → 14,613；compaction layers 则从 20 → 39，compaction mip copies 从 200 → 385。显存分配下降伴随更多数组整理工作，是否改善帧时间、是否增加尾部卡顿必须看正式时序实测，不能从 bytes 推导。

终点 source-RGBA cache entries 458、misses 699、hits 811、evictions 241、owned 50,850,072 字节。这些数据同时包含 idle key 共享、source 晋升和分配策略，不能把全部变化只归因于某一项。

[代表性全景原图](camera-after/dpr-1-1280x720-zoom-0p75-composite.png) 和 [DPR 2 原生 actors 的精确归档](camera-after/PNG-ARCHIVE.md) 与 baseline 严格逐通道相同；归档命令可恢复原生图。大型生物的尾部、鹿角、魔像、攻城器械、色彩、阴影及地面/身体血迹继续显示。本 fixture 没有产生武器血迹，不将这轮描述成武器转移接触验证。

## 保留的失败候选

[多档共驻候选报告](camera-qa-coexisting.zh.md) 与 [one-source 稀疏页候选报告](camera-qa-one-source.zh.md) 的原始 proof、PNG 和 comparison 继续独立保存，明确 candidate-not-final；未覆盖不利结果。当前 `camera-after` / `camera-comparison.json` 仅代表 `55d6b3b`，不能将旧 capture 当作本候选证明。复现使用原 `scripts/art-card-mip-camera-proof.mjs` 和 `art-card-mip-camera-fixture.js`；baseline 与本候选的 harness/fixture SHA 完全相同。
