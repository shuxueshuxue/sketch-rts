# e02b24e 同源 bank / mip 配置测量

默认 8 bank 候选被拒绝。虽然减少 draw chunks、部分 CPU 工作和 mip 拷贝量，但真实 GPU 完成后的整帧 wall 时间明显变差。2 / 4 bank 诊断也有同样问题。1 bank / native mip 恢复到参考的 wall 时间区间，但 CPU、尾部卡顿和最终驻留仍有回退，不能声称全面改善，更不能把它当作已经修改的 shipping 默认。

## 来源与方法

所有配置使用冻结客户端 `e02b24ef8de3c96cec111a1178a7daf697fc8378`，同一浏览器、fixture、原始事实时钟与美术资源。参考是当前正确稳定绘制顺序体系的 **1 bank / full mip**；这是同源配置消融，不能写成历史旧 renderer 的 before / after。full 配置跳过 residentMip SVD 运算，CPU 成本有利于参考。

独占测量环境：Chrome `151.0.7922.173`、真实 WebGL2、ANGLE Vulkan SwiftShader；1280×720、DPR1、zoom0.75。顺序运行，测量期间其他车道暂停 browser、tests、build、Canvas、编码等重任务。没有模拟成本，未减少可见内容、未改源绘画或过滤。

Canonical：100 visible，hidden0 / 9900，各两个独立 renderer lifetime；每 lifetime CPU360、real18，paced。Mixed：20 类实际资产共100 visible，hidden0，两个 lifetime；CPU60、real12，paced。2 / 4 bank 诊断仅 hidden0，其余 canonical 时钟和冷暖 schedule 相同。

CPU 值是关闭 `renderer.render` 时完整 WorldPresentation 工作，仍包含资源准备、上传提交及可能的 driver backpressure；World3D 是其嵌套部分，不能相加。Real wall 在完整 draw 后等待 GPU fence，包含 GPU 完成与 event-loop / Canvas deferred 成本；不是 GPU timer 纳秒，也不是硬件游戏 FPS。

直接合并两个 lifetime 的**原始样本**再求经验分位数，索引 `floor(n*p)`；没有平均 p95 / p99。Canonical 每人口只有36 real 样本，mixed24，尾部统计样本很少。Mixed 原有 schedule 从 n173 跳到 n480 再做 real；保留全部首帧 cold-stream 大峰值，JSON 另列 first / subsequent 诊断，未剔除尖峰。

## 原始分布

时间单位 ms，表内为 mean / p50 / p95 / p99。完整逐样本数组、每 lifetime、阈值超时计数、嵌套 World3D / Canvas 残差、提交时间和帧开始间隔见 [performance-summary.json](performance-summary.json) 与各目录 raw.json。

| 场景 / 配置 | CPU | GPU 完成后的整帧 wall |
| --- | --- | --- |
| canonical hidden0，1 full reference | 4.32 / 1.50 / 19.30 / 30.80 | 142.27 / 121.80 / 310.80 / 324.50 |
| canonical hidden0，8 native rejected | 3.67 / 1.40 / 17.10 / 24.10 | 258.78 / 242.50 / 441.80 / 446.20 |
| canonical hidden9900，1 full reference | 11.03 / 1.90 / 40.10 / 52.70 | 156.13 / 133.80 / 307.60 / 324.20 |
| canonical hidden9900，8 native rejected | 11.19 / 1.60 / 40.70 / 55.40 | 267.77 / 256.90 / 426.90 / 470.30 |
| mixed，1 full reference | 44.01 / 8.80 / 125.80 / 489.80 | 437.25 / 193.10 / 1364.80 / 1514.10 |
| mixed，8 native rejected | 42.85 / 7.90 / 130.20 / 450.90 | 693.40 / 471.40 / 1629.70 / 1643.90 |
| canonical hidden0，1 native diagnostic | 4.12 / 1.60 / 18.30 / 28.30 | 130.90 / 114.90 / 294.00 / 349.20 |
| canonical hidden9900，1 native diagnostic | 11.82 / 2.00 / 42.80 / 63.80 | 145.84 / 137.40 / 302.50 / 304.10 |
| canonical hidden0，2 native diagnostic | 4.06 / 1.50 / 17.70 / 31.30 | 272.29 / 266.20 / 432.70 / 445.40 |
| canonical hidden0，4 native diagnostic | 3.80 / 1.50 / 19.60 / 29.00 | 255.78 / 242.30 / 448.70 / 450.70 |

8 native real mean 回退分别 +81.9%、+71.5%、+58.6%。1 native hidden0 的 real p99 回退 +7.6%，hidden9900 CPU mean / p99 回退 +7.1% / +21.1%。所有方向不佳的指标保留在汇总 `measuredRegressions`；当前不能把单次微小差异视为统计显著。

## 驻留、容量与提交

下表是最后 real 后的 **untimed 实际对象快照**；两个 lifetime 的结构相同。实际 Card.baseMip 来自 retained cards，不用 requestN 代替。capacity 是 array 已分配层数，live 是 retained card，active 是当前34或97个共享卡片条目；不是可见单位数。

| 最终快照 | canonical 1 full | canonical native（1 / 2 / 4 / 8 同驻留） | mixed 1 full | mixed 8 native |
| --- | ---: | ---: | ---: | ---: |
| pages | 3 | 7 | 10 | 14 |
| retained cards / page capacity | 43 / 43 | 61 / 61 | 107 / 107 | 109 / 109 |
| active card entries | 34 | 34 | 97 | 97 |
| actual baseMip0 / baseMip1 | 43 / 0 | 37 / 24 | 107 / 0 | 88 / 21 |
| owned card GPU bytes | 84,081,948 | 89,062,020 | 210,914,668 | 185,776,188 |
| peak owned card GPU bytes | 91,072,448 | 90,110,592 | 210,914,668 | 195,409,932 |
| owned card CPU bytes | 12,900,160 | 13,956,928 | 7,882,496 | 7,918,848 |
| peak owned card CPU bytes | 15,046,464 | 16,037,696 | 60,720,132 | 60,981,736 |
| scratch uploaded bytes（累计） | 127,195,828 | 112,257,932 | 652,717,160 | 650,310,956 |
| resident mip copy bytes（累计） | 1,370,273,568 | 686,364,040 | 3,593,517,112 | 3,310,352,452 |
| CPU raster cache misses（累计） | 129 | 129 | 1573 | 1571 |
| scratch full-upload fallbacks | 0 | 0 | 0 | 0 |

Canonical native 尾链与全链历史条目共存，最终 owned GPU **增加5.9%**，CPU也增加；不能用“单个 N1 尾链少75%像素”替代实际总量。Mixed owned GPU 减少11.9%，但 wall 回退更严重。以上 owned bytes 是程序跟踪的卡片 array / scratch 估算，不是总 VRAM / RSS，不包含其他 scene 贴图、shadow map 等；typed draw buffers、Canvas、CPU mask、heap after disposal/GC 均在 JSON 分开保存。

Canonical 最终 draw chunks 为 reference70；native 1bank90、2bank44、4bank7、8bank1。相应 typed buffer bytes 为 68,584 / 29,124 / 58,236 / 58,364 / 22,808。8native 实际单 chunk 使用7 banks。Mixed 从61 chunks / 50,088B 到4 chunks / 26,888B，其中3个8bank、1个6bank。减少 draw calls 的证据存在，完整 wall 的严重回退也存在。

计数包含整个 lifetime 的 warmup / preparation，不是 measured-only 的分配。记录只在 timed samples 后读取，不在 measured draw 内遍历 pages/chunks。**没有逐 real 帧的 bank/chunk 快照**，不能把最后快照冒充18/12帧各自布局；若要分析逐帧关联，需要单独 untimed replay，不污染 formal timer。

## 画面与来源校验

五组 comparison 全部通过：共42 PNG /14 facts，客户端所有文件 SHA、sourceCommit、git client diff、helper/harness/fixture、device、viewport、sample ticks、样本数和 lifetime grid 一致；所选每张 battlefield / empty / returned 图 RGBA 完全一致，容差0。2 / 4 的 comparison 明确选择共同 hidden0，同时验证两份原始文件完整 grid，未改写 reference raw。

每个输出目录保存实际 `harness.mjs`、`fixture.js`、`fact-fixture.js`、`bank-variant.js`、`viewport-metadata.js`。Canonical harness SHA256 `e05d9e8eb8ca41d566d616028e2249c85b8a855d3d25ae0a80be7faef9102165`，entry `e16afb3823a50ef0d408ca8e8b071df4fbb462a56e9ee2f3194b574d45fcd06e`，fact `ed6c128d8ca0c8fee5c3fafefe3c41933e009e23c120343c0a289a1731f30193`，variant helper `bfb604d6829915717946c24f091ced65fb23db704846f70721e5d19737390b5b`，metadata `45b0ca53e3d16bc89153e4f49f71e307a481e44b9d65a3f2647fb9bc81e15a81`。Mixed fact 的独立 SHA 在 raw / summary 中。

复现命令，修改 variant / max-banks / mips 对应目录。Mixed 用 `--scene mixed --hidden 0 --cpu-frames 60 --real-frames 12`；2/4 诊断只用 `--hidden 0`，保持 CPU360 / real18。

```sh
node --import tsx scripts/art-card-bank-viewport-proof.mjs \
  --source /workspace/sketch-rts-viewport --variant canonical-reference \
  --max-banks 1 --mips full --scene canonical --hidden 0,9900 \
  --repeats 2 --cpu-frames 360 --real-frames 18 --paced --skip-simulation \
  --out docs/art/refactor/followup/card-streaming/bank-order/canonical-reference/raw.json
node scripts/art-card-bank-compare.mjs --kind viewport \
  --before docs/art/refactor/followup/card-streaming/bank-order/canonical-reference/raw.json \
  --after docs/art/refactor/followup/card-streaming/bank-order/canonical-candidate/raw.json \
  --out docs/art/refactor/followup/card-streaming/bank-order/canonical-comparison.json
node scripts/art-card-bank-performance-summary.mjs --diagnostics \
  --root docs/art/refactor/followup/card-streaming/bank-order
```

这些 e02 数据只支持拒绝当前 multibank 默认与选择进一步试验的策略。最终策略改动后须重新冻结同源，正式 reference / chosen candidate 比较及适用的 camera / battle / tests / build 验证，不能移用本次诊断为最终发布验收。
