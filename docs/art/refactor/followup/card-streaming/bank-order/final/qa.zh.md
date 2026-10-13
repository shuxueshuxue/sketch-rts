# `0de509c`：单 bank 最终配置正确性与资源计数

source `0de509cc01e47b91a3012d33d2e75a7106d3e4a5`，production default 为 **1 bank**。两侧使用同一稳定绘序、同一 source / paint / cache / nonempty page capacity 策略：reference 保留完整原 mip 链，candidate 使用 native residency gate。这次不改变 bank 数，不能沿用先前 `e02` 的 1→8 bank dispatch 收益。override 在 `World3DLayer.create` 后、prepare / first draw 前完成，不增加每帧 pose/key 计算。

本轮只做正确性验证，允许 root 的正确性 tests / build 并行。**捕获、GPU fence 或编码 walltime 不是本报告的性能数据。** 正式时序须在独占窗口另行验证。

## 严格图像与真实战斗

[相机 comparison](camera-comparison.json)：同一 fixture 的 **31 步**全部通过，native actors/composite 的 decoded RGBA 每个通道相同，原始 WebGL RGBA（含透明区 RGB、alpha、真实阴影 alpha）、production picking、facts 与固定 now 全部相同，没有容差或 downsample。实际 CDP DPR 2 原生图为 2560×1440 / 1280×720；camera return / promotion 的 first frame 及 repeat 也相同，GL error 全为 0。

[战斗 comparison](battle-comparison.json)：原 guard/blood 场景 **160 真实 ticks、80 captures**，两侧 80 个实际 PNG 文件字节 SHA 全部相同、80 个 simulation snapshot SHA 全部相同。真实身体与武器沾血、向后移动 / idle 预备持械、正确方向和 guard 到期的 self-validation 全部通过。tick 2 的空相机 probe 保留 tracker 的 30 个真实 airborne droplets，GPU 提交为 0 / cull 30；返回后提交 32（30 air + 2 body），图和模拟都不变。

原始 [camera reference](camera-reference/proof.json)、[camera candidate](camera-candidate/proof.json)、[battle reference](battle-reference/proof.json)、[battle candidate](battle-candidate/proof.json) 保留完整 captures、输入脚本、source / client / helper / fact / harness SHA 与实际 variant setup。全部原始 PNG 的编码字节保存在[精确归档](../../../png-archives/README.md)，选定图像仍可直接浏览；按归档命令恢复后，可重跑原比较工具。

oracle 是同 source 的 corrected stable ordering，旧 `55` 的 cache-dependent overlap 差异与失败 ablation 继续归档；这里不声称与旧 80 帧零差异。20-kind camera 和 guard/blood 场景不包含新 3 个 merc，merc 的真实 hire / 造型验证使用独立证据。

## 实际资源：全部正负步骤

[逐步资源摘要](camera-resource-summary.json) 记录所有 31 步的实际 allocated array mip bytes、scratch、owned GPU textures、owned CPU、mask、drawBuffer、live / pooled chunks、page/card 数、calls 及 requested gate。程序 owned GPU 此处仅指纹理分配，不含 geometry / draw-buffer 的 GPU 分配，不等于驱动 VRAM 或进程内存。requested N0/N1 数量也不等于实际驻留 histogram，因为已有较精细链可以继续满足较粗请求。

| 指标，MiB（buffer 为 bytes） | 1-bank full reference | 1-bank native candidate |
| --- | ---: | ---: |
| draw 后最大 owned GPU texture | 186.623 | 186.623 |
| tracked transient GPU texture peak | 243.798 | 233.277 |
| ending owned GPU texture | 181.290 | 162.019 |
| draw 后最大 owned CPU | 55.671 | 56.523 |
| tracked transient CPU peak | 59.356 | 59.356 |
| ending owned CPU | 55.546 | 55.095 |
| 最大 drawBufferBytes | 48,296 | 44,476 |

31 步 texture owned GPU **10 步下降、17 步相同、4 步上升**，每步 posed 数相同。全部上升步骤如下：

| 步骤 | reference MiB | candidate MiB | 增加 MiB |
| --- | ---: | ---: | ---: |
| DPR 1 / 1280×720 / zoom 0.35 | 62.654 | 67.424 | **4.769** |
| DPR 1 / 1280×720 / zoom 1.5 | 173.290 | 186.623 | **13.333** |
| DPR 1 / 1280×720 / zoom 2 | 173.290 | 186.623 | **13.333** |
| DPR 1 / 640×360 / zoom 0.35 | 46.654 | 61.779 | **15.125** |

candidate 在部分镜头中还增加了 draw chunks / dispatch calls。原因和实际速度必须由正式实测评估，不能仅凭纹理字节或 ending 值宣称性能改善：

| 步骤 | reference chunks / calls | candidate chunks / calls | texture MiB：reference → candidate |
| --- | ---: | ---: | ---: |
| full DPR 1 / zoom 0.65 | 38 / 79 | **50 / 103** | 186.623 → 163.274 |
| full DPR 1 / zoom 0.75 | 38 / 79 | **55 / 113** | 186.623 → 183.732 |
| camera-returned-first | 39 / 81 | **54 / 111** | 186.623 → 172.170 |
| promotion-low | 39 / 81 | **60 / 123** | 186.623 → 184.732 |
| promotion-high-first / repeat | 30 / 58 | **42 / 81** | 181.290 → 162.019 |

高 DPR 的多数相机步骤 chunk / call 与 reference 相同；不能把局部增加或局部下降扩展为所有视图。full source RGBA、原密度边界、geometry、source picking mask 和实际阴影需求均保留，画面收益/代价没有靠降低可见内容或原画质量取得。

## 原生画面与复现

[全景 candidate](camera-candidate/dpr-1-1280x720-zoom-0p75-composite.png) 与 [reference](camera-reference/dpr-1-1280x720-zoom-0p75-composite.png) 逐通道相同；[DPR 2 原生全景](camera-candidate/dpr-2-1280x720-zoom-2-composite.png) 为未缩小的 2560×1440。其余原生 actors 图可从精确归档恢复。完整输入与参数见两侧 proof 和保存的 harness / fixture，工具为 `art-card-bank-camera-proof.mjs`、`art-card-bank-battle-proof.mjs`，`--max-banks 1` 两侧相同，mips 分别 full / native，source 固定于上述 commit。

所有浏览器、ffmpeg、comparison 在本轮结束时已退出；正式 benchmark 由 root 另行安排。没有 production 修改、stage 或 commit。
