# d48峰值记账单变量ABBA

生产记账优化的平均CPU成本有所下降，计数和画面完全一致，**没有解决全部长尾，也没有整帧加速证据**。原算法/生产算法四个lifetime合并后CPU mean43.86→42.75ms（−2.52%）、p95 127.9→122.0ms（−4.61%），但CPU p99 430.5→466.2ms（+8.29%），超过50ms样本78→86；GPU完成wall mean416.55→430.18ms（+3.27%）。不挑选最佳lifetime，也不隐藏不利分位数。

## 这是何种对照

按外部协调的ABBA顺序运行original-A、production-B、production-B2、original-A2，每run两个独立WorldPresentation lifetime，冻结同源 `d48fb3d95d248db91b9237f0dcb290e736f6a75b`，1bank/native、100 visible mixed20类、hidden0、原CPU60/real12、paced、skipSimulation。没有profiler/per-frame observer。双方都保留当前新page mip-byte metadata，**只隔离stats/recordPeaks方法的成本**，不能写成整个历史5b与d48分配策略的对照。

原策略在World3DLayer.create后、任何prepare/draw前，将当前cards/remainsCards的stats与recordPeaks绑定为冻结5b原方法引用；原recordPeaks的this.stats也解析到原stats。生产策略两方法都不覆盖。Baseline类只导入，不实例化。检查实际归档latency-variant.js，它只执行这两个赋值；没有覆盖allocation/slot/raster/upload/draw或美术，也没有创建baseline纹理/canvas/renderer。

四run的client所有SHA、sourceCommit、client diff、harness、entry/fact、variant/metadata helper、viewport/device/browser及baseline provider文件SHA相同。Baseline为 `5b356c7795068bb2a532ad1d486b3c22936cf735`，clean，card batches SHA `1cfd7a43e3c10d84be67d9468667a97d98c5f7194e4bb3a6f98744b040f990bf`；隔离helper SHA `a8cc622f0724440301e960f5edad7fe70ff44d280cd671231a7076ceeedd29e1`。归档当前/原card batches和uploader均按raw SHA核验。

## 全部原始分布

从每策略四个lifetime的原始数组合并后再求分位数，不平均p95/p99。CPU每策略240样本、real48；real interval44。分位数索引floor(n*p)。以下时间ms，CPU>50/>100计数仅描述这些样本；有限lifetime与软件GPU不能证明硬件FPS或所有环境的稳定尾分布。

| 字段 | original mean/p50/p95/p99/max | production mean/p50/p95/p99/max | >50 / >100 original→production |
| --- | --- | --- | --- |
| full CPU | 43.86 /9.10 /127.90 /430.50 /491.80 | 42.75 /7.20 /122.00 /466.20 /494.40 | 78/37→86/32 |
| nested World3D CPU | 43.49 /8.10 /127.60 /429.70 /491.30 | 42.37 /6.80 /121.70 /464.30 /494.00 | 76/37→85/32 |
| Canvas/coordinator残差 | 0.37 /0.30 /0.50 /2.20 /7.20 | 0.38 /0.30 /0.60 /3.40 /4.50 | 0/0→0/0 |
| fresh tick CPU | 74.09 /52.10 /422.60 /491.80 /491.80 | 73.58 /53.00 /442.80 /494.40 /494.40 | 42/8→50/4 |
| repeated tick CPU | 28.74 /1.80 /127.20 /164.80 /178.50 | 27.34 /1.70 /122.00 /157.20 /160.70 | 36/29→36/28 |
| repeated phase1 CPU | 23.75 /1.50 /119.00 /127.90 /127.90 | 22.64 /1.60 /116.00 /123.10 /123.10 | 16/14→16/12 |
| repeated phase2 CPU | 33.74 /6.40 /150.70 /178.50 /178.50 | 32.04 /6.20 /144.10 /160.70 /160.70 | 20/15→20/16 |
| real GPU-completion wall | 416.55 /190.10 /1297.90 /1313.20 /1313.20 | 430.18 /199.60 /1317.00 /1418.00 /1418.00 | 48/48→48/48 |
| real submit | 53.56 /3.00 /269.00 /271.60 /271.60 | 52.49 /3.60 /256.50 /273.70 /273.70 | 12/12→12/12 |
| real frame interval | 447.35 /200.00 /1311.50 /1319.50 /1319.50 | 459.11 /215.10 /1317.40 /1418.20 /1418.20 | 44/44→44/44 |
| first real cold-stream | 1293.10 /1302.20 /1313.20 /1313.20 /1313.20 | 1330.50 /1322.80 /1418.00 /1418.00 /1418.00 | 4/4→4/4 |
| subsequent real | 336.86 /180.10 /1054.50 /1109.10 /1109.10 | 348.34 /195.60 /1087.50 /1106.10 /1106.10 | 44/44→44/44 |
| fence wait | 362.98 /185.10 /1028.60 /1049.60 /1049.60 | 377.68 /192.50 /1060.50 /1147.80 /1147.80 | 48/48→48/48 |
| clientWaitSync调用本身 | 0.33 /0.20 /1.00 /1.40 /1.40 | 0.42 /0.30 /1.10 /4.00 /4.00 | 0/0→0/0 |
| yielded waiting wall | 362.51 /184.80 /1027.80 /1047.90 /1047.90 | 377.12 /192.20 /1059.10 /1145.70 /1145.70 | 48/48→48/48 |

首real冷流的原n173→480跳变保持，所有首帧包含headline；后续44 real帧同样没有加速。GPU完成wall包含提交、Canvas deferred、GPU完成和scheduler，不是GPU timer。Full/World3D/Canvas是嵌套/残差，不能相加。

各run两life合并分布，显示整个顺序，避免只挑B的最快life：

| run | CPU mean/p95/p99/max | real wall mean/p95/p99/max |
| --- | --- | --- |
| original-A | 44.37 /134.60 /422.60 /430.50 | 424.79 /1259.10 /1313.20 /1313.20 |
| production-B | 42.49 /122.00 /442.80 /466.20 | 436.79 /1317.00 /1418.00 /1418.00 |
| production-B2 | 43.01 /123.10 /488.90 /494.40 | 423.57 /1264.20 /1322.80 /1322.80 |
| original-A2 | 43.34 /120.60 /466.10 /491.80 | 408.31 /1297.90 /1302.20 /1302.20 |

所有八life的独立原始分布和after-dispose/teardown heap、24份camera资源快照均在[analysis.json](analysis.json)的perRun里，不将其heap波动当内存分配率或GC归因。

## 全资源/峰值与画面校验

逐run/life的before、empty、returned共24份快照，**全部非计时Card字段、实际pages/capacity/live/baseMip、draw布局、owned/peak、scratch/uploader/coldmiss及renderer几何/纹理/call计数精确一致**。排除的仅stage时间、rasterWork/gpuTransfer时间和cache work/avoidedPaint计时，不隐藏任何字节或计数差异。

末real共通：14 pages，105 live/capacity，97 active entries，actual baseMip0=95/baseMip1=10，70 visible/71 pooled chunks、41,444 typed draw buffer bytes；ownedGPU191,718,124B、peak194,710,892B、peakRetired10,572,976B，ownedCPU7,787,776B、peak60,687,364B、peakPendingRGBA1,982,464B。最终render142 calls、404 triangles、72 geometries、18 textures；源艺术内容没有减少。

每life累计rasters1726、misses1573、hits153；scratch upload652,717,160B（partial649,686,120B/1724次）、unchanged0/fallback0；mip copies17,073次/3,312,449,592B；array init29、compaction7 layers/67mip copies。所有值两策略一致。记账优化没有低报峰值来制造收益。

全部24 PNG checksum核验并**逐张解码RGBA**，与original-A六张life/phase oracle精确一致，容差0（18次跨run对照，6张oracle本身也解码）。八份最终facts/pixelProof及captured snapshot SHA一致；所有八life每一CPU index的60 tick格都核验为floor((114+i)/3)，共480个样本时钟。没有profiler或simulation，GL error0/dispose全部通过。

## 结论与下一步

记账精简保持了图像、真实资源布局、峰值和工作量，在这次ABBA里平均CPU降低约1.1ms/frame，与先前profile的热路径成本量级一致。CPU p95/部分repeated分布改善，但p99、>50计数和real wall回退都存在；它是有边界的工程修复，不能宣称主长尾消失或整帧性能全面提升。

继续按[同步profile报告](../profile-report.md)定位getImageData/Canvas flush与n135 copy阻塞，使用源/目标类型、level及trace区分具体路径；下一mask静态候选必须保持原alpha mask和RGBA语义。ABBA已经验证了peak方案的计数正确性，不应继续通过改时间窗口/筛life追求好看的数字。

复现离线分析：`node docs/art/refactor/followup/card-streaming/latency-investigation/peak-abba/analyze.mjs`。脚本保存所有输入raw SHA，在完成前再次复核；原始四run未修改，旧0de/e02证据也保留。
