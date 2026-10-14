# 0de509c 最终同源1bank full / native测量

画面校验通过，multibank 的严重回退已避开，但本次结果**不能宣称整体帧时间提升**。同源 native 尾链降低 mixed 卡片 GPU 驻留和峰值，却增加 mixed CPU / wall 时间；canonical 最终驻留仍有小幅增长，CPU / wall 尾部也存在回退。所有原始数据和不利指标都保留。

## 来源与测量边界

冻结客户端 `0de509cc01e47b91a3012d33d2e75a7106d3e4a5`。参考为当前稳定顺序体系的 **1bank/full**，候选为 **1bank/native**；双方均使用本次新的小页策略。不是历史旧 renderer before/after，也不是 e02 默认8bank 对新默认1bank 的同源比较。full 跳过 residentMip SVD，CPU 成本有利于参考。

所有原始 fact / entry / variant helper / untimed metadata / harness 保持冻结不变。Chrome151.0.7922.173、1280×720、DPR1、zoom0.75、真实 WebGL2 ANGLE Vulkan SwiftShader。独占 CPU/GPU 窗口，其他车道暂停 browser / tests / build / Canvas /编码，顺序执行四配置，两次独立 lifetime，paced / skipSimulation。没有减少可见内容、重绘低分辨率源图或改变模拟规则。

Canonical：100 visible，hidden0及9900，各 lifetime CPU360、real18。Mixed：20类实际资产共100 visible，hidden0，各 lifetime CPU60、real12。CPU 是禁用 renderer.render 时的完整 presentation 工作，包括资源准备与可能的 driver backpressure；World3D 是嵌套成本，不可相加。Real wall 等待 GPU fence，包含 GPU 完成 / event-loop / Canvas deferred 成本，不是 GPU timer 纳秒或硬件游戏 FPS。

合并原始样本后求经验分位数，索引 floor(n*p)，不平均 p95/p99。每人口36 canonical real样本、24 mixed real样本，尾部样本很少，微小差异没有统计显著性保证。原 mixed 时钟从 CPU n173 跳到 real n480；首 real cold-stream 峰值全部包含在主要结果中，另列首帧诊断，不剔除。

## 时间分布

单位 ms，表内 mean / p50 / p95 / p99 / max。完整原始样本、每 lifetime、嵌套 World3D / Canvas 残差、submit / real frame intervals 和超时计数见 [performance-summary.json](performance-summary.json)。

| 场景及配置 | 完整 presentation CPU | 完整 presentation GPU-completion wall |
| --- | --- | --- |
| canonical hidden0 reference | 4.67 /1.60 /23.70 /31.30 /45.50 | 161.71 /136.40 /359.80 /395.40 /395.40 |
| canonical hidden0 candidate | 4.25 /1.60 /19.30 /25.40 /38.30 | 160.95 /131.70 /376.50 /407.30 /407.30 |
| canonical hidden9900 reference | 11.06 /1.90 /39.80 /49.50 /69.00 | 149.40 /126.90 /360.60 /399.30 /399.30 |
| canonical hidden9900 candidate | 10.98 /1.90 /37.20 /50.80 /103.60 | 149.71 /129.30 /362.40 /375.60 /375.60 |
| mixed reference | 42.12 /7.50 /115.30 /467.80 /472.70 | 421.68 /195.60 /1283.30 /1356.70 /1356.70 |
| mixed candidate | 44.69 /8.80 /132.90 /436.10 /474.70 | 434.76 /203.50 /1345.00 /1364.00 /1364.00 |

Canonical hidden0 CPUmean −8.87%，但 real wall mean 仅−0.47%，wall p95 /p99 回退+4.64% /+3.01%。Hidden9900 CPUmean −0.71%，CPU p99 /max 回退+2.63% /+50.14%，720 CPU样本中超过100ms由0增至1；real wall mean +0.21%，submit p95 28.9→44.1ms、max36.5→50.5ms。

Mixed CPUmean +6.10%、p95 +15.26%；120 CPU样本超过50ms由38增至45、超过100ms由14增至19。Real wall mean +3.10%、p95 +4.81%、p99 +0.54%。首 real cold-stream mean1320.0→1354.5ms，其余22帧 mean340.02→351.15ms；即使只看后续帧，也不能声称改善。首帧仍包含在421.68→434.76ms的主要结果中。

## 真实驻留与上传

下表是最后 real sample 后的 untimed 实际对象快照，两个 lifetime 的结构和累计提交计数相同。capacity/live为已分配层数/retained cards，active为当前共享card条目；可见单位均100。actual Card.baseMip来自实例，不用当前 requestN 分类推断。

| 指标 | canonical reference | canonical candidate | mixed reference | mixed candidate |
| --- | ---: | ---: | ---: | ---: |
| pages | 10 | 10 | 10 | 14 |
| retained cards /capacity | 40 /40 | 54 /54 | 107 /107 | 105 /105 |
| active card entries | 34 | 34 | 97 | 97 |
| actual baseMip0 /baseMip1 | 40 /0 | 37 /17 | 107 /0 | 95 /10 |
| owned card GPU bytes | 69,926,496 | 71,051,352 | 210,914,668 | 191,718,124 |
| peak owned card GPU bytes | 79,101,372 | 71,051,352 | 210,914,668 | 194,710,892 |
| owned card CPU bytes | 12,568,384 | 13,143,872 | 7,882,496 | 7,787,776 |
| peak owned card CPU bytes | 14,569,280 | 15,126,336 | 60,720,132 | 60,687,364 |
| visible draw chunks /pooled chunks | 78 /81 | 98 /100 | 61 /68 | 70 /71 |
| typed draw buffer bytes | 85,700 | 30,016 | 50,088 | 41,444 |
| final renderer.info calls /triangles | 159 /424 | 199 /424 | 124 /404 | 142 /404 |
| final renderer.info geometries /textures | 82 /14 | 103 /14 | 67 /14 | 72 /18 |
| cumulative rasterizations | 583 | 542 | 1726 | 1726 |
| cumulative CPU raster misses | 129 | 129 | 1573 | 1573 |
| cumulative scratch upload bytes | 127,140,872 | 115,386,360 | 652,717,160 | 652,717,160 |
| cumulative resident mip copy bytes | 1,416,496,852 | 828,988,672 | 3,593,517,112 | 3,312,449,592 |
| scratch full-upload fallbacks | 0 | 0 | 0 | 0 |

Canonical 最终 GPU驻留仍+1.61%、CPU驻留+4.58%，full/tail历史条目共存；peak GPU −10.18%，mip copy bytes −41.48%，draw buffer −64.98%。更多单bank chunks使最终calls159→199，不能把更小typed buffers当作更少draw calls。

Mixed 最终GPU驻留−9.10%、peak−7.68%、CPU驻留−1.20%、mip copy−7.82%，但页数10→14、textures14→18、calls124→142；cold misses和scratch upload bytes完全相同。GPU驻留减少与时间回退须一起报告。

这些 owned bytes 是程序跟踪的卡片arrays/scratch估算，不是总 VRAM/RSS，排除其他scene贴图、shadow maps等。CPU masks /Canvas backing /draw buffers /GC后的JS及embedder heap在raw和summary分开保存。计数包括warmup/preparation整个lifetime，不是measured-only分配。blank/returned快照及它们的completeWall保留在各资源条目中；这些camera移动采样没有混入正式CPU/real分布。没有每个real帧的bank/chunk快照，不把末帧布局冒充逐帧数据。

## 历史分配观察

旧 e02 的同为1bank/native诊断最终canonical ownedGPU为89,062,020B，当前为71,051,352B。旧参考1full为84,081,948B，当前参考为69,926,496B。**这是不同client source的绝对分配观察**，不能用它替代本次同源69,926,496→71,051,352B的native增量，也没有把跨窗口时间当作正式性能比值。

记录中的client SHA差异仅 `painted-card-batches.ts`、`world-layer.ts`及各自test；源艺术文件SHA保持一致。原e02失败的8bank、2/4bank及1bank诊断raw均未改写，见 [e02报告](../e02-performance.md)。

## 严格校验与复现

本车道两组 comparison 全PASS：18张battlefield/empty/returned PNG，6组facts/lifetime；客户端SHA/sourceCommit/git client diff、harness/fixture/helper、device/viewport、sample ticks、完整grid和样本数相同。PNG checksum验证后RGBA精确比较，容差0。各raw自检GL error0、dispose通过；无模拟工作。

目录保存实际运行 `harness.mjs`、`fixture.js`、`fact-fixture.js`、`bank-variant.js`、`viewport-metadata.js`和所有PNG。Canonical harness SHA256 `e05d9e8eb8ca41d566d616028e2249c85b8a855d3d25ae0a80be7faef9102165`，entry `e16afb3823a50ef0d408ca8e8b071df4fbb462a56e9ee2f3194b574d45fcd06e`，fact `ed6c128d8ca0c8fee5c3fafefe3c41933e009e23c120343c0a289a1731f30193`，variant helper `bfb604d6829915717946c24f091ced65fb23db704846f70721e5d19737390b5b`，metadata `45b0ca53e3d16bc89153e4f49f71e307a481e44b9d65a3f2647fb9bc81e15a81`。Mixed fact及全部client SHA在raw/summary中。

准备0de509c同源checkout/node_modules，只在独占环境运行，使用新的输出目录，脚本拒绝覆盖已有raw：

```sh
bash scripts/art-card-bank-final-performance.sh /path/to/frozen-0de-source /tmp/reproduced-card-bank-final
```

汇总脚本final profile强校验1full/1native、repeat2、canonical原360/18与hidden0/9900、mixed原60/12与hidden0、skipSimulation；参考与候选都使用小页，所有36个测得的正方向回退项存于 `measuredRegressions`。这次结果支持资源/性能权衡的具体说明，不能宣传全面渲染加速。
