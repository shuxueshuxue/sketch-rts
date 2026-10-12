# Scratch GPU mip：隔离实测结果

2026-10-11，13:08:45–13:09:17 UTC，Chromium / ANGLE Vulkan SwiftShader。最终矩阵退出0，GPU窗口已释放；生产代码未改。原始逐轮/逐LOD数据：[scratch-mip-result.json](scratch-mip-result.json)，摘要含各对原始差值：[scratch-mip-summary.json](scratch-mip-summary.json)。这不是游戏整帧或实际独显性能结果。

## 质量与生命周期

512、640、320、256四种尺寸 × 16层；初始化、1/4/16层更新分别比较每个整数LOD及0.5/2.5分数LOD，再检查一次256上下文恢复。合计195组LOD读回，每组全部16层、真实RGBA采样和独立alpha=.4阈值mask对照，全部maxChannelDifference=0，coverageDifference=0。GL error=0，纹理dispose错误列表为空，程序runnable。

首轮不是直接成功：`scratch-mip-smoke.json` 全像素等价但末尾GL_INVALID_OPERATION(1282)，`scratch-mip-smoke-disposal.json` 定位为上下文恢复后复用旧Texture对象时的reference/candidate/scratch三个dispose调用。没有忽略错误或放宽pass门限。

原型恢复流程修为：收到contextlost时dispose旧texture wrapper，保留CPU基图；恢复后创建全新wrapper并复用原CPU基图、重新生成和复制全部级别，完成后才呈现。新冒烟 `scratch-mip-smoke-rebuilt.json` 及最终矩阵均通过，包括CPU基图不变。此结果证明该明确重建流程可用，不证明Three在任意资源复用方式下都能自动恢复；生产接入必须同样设计并验证生命周期。

## 真 fence 完成时间

单位毫秒，以下为各3次配对样本中位数。每次先独立fence排空前序GPU工作，再计提交到新fence完成的墙钟；轮次交替路径先后。CPU样图/两套基图准备在范围外，候选scratch staging memcpy在范围内。无render/readback混入计时。

| 基图尺寸 | 脏层数/16 | 原数组链 完成ms | scratch+copy 完成ms | CPU提交 原/候选ms |
| --- | --- | --- | --- | --- |
| 512 | 1 | 165.00 | 13.00 | 0.20 / 0.30 |
| 512 | 4 | 160.80 | 46.80 | 0.40 / 1.00 |
| 512 | 16 | 167.90 | 184.70 | 3.00 / 3.00 |
| 640 | 1 | 256.30 | 21.70 | 0.20 / 0.60 |
| 640 | 4 | 262.30 | 75.70 | 0.60 / 1.20 |
| 640 | 16 | 266.60 | 291.30 | 6.30 / 4.90 |
| 320 | 1 | 70.10 | 8.60 | 0.10 / 0.20 |
| 320 | 4 | 65.90 | 21.40 | 0.20 / 0.50 |
| 320 | 16 | 66.40 | 75.70 | 0.50 / 1.70 |
| 256 | 1 | 45.60 | 4.70 | 0.10 / 0.30 |
| 256 | 4 | 41.90 | 13.10 | 0.30 / 0.50 |
| 256 | 16 | 42.40 | 50.90 | 0.40 / 1.50 |

结论限于本环境：稀疏1/4脏层时明显减少完成时间；16层全脏时四尺寸全部更慢。不能以稀疏结果直接宣称无条件替换更快。异步clientWaitSync轮询有计时器粒度、线程调度开销，小值须谨慎；这不是timer-query测得的GPU纯执行时间。

## 接入前仍需解决

- 先用真实页dirty分布评估收益；初次全页构建或全页刷新不应被稀疏收益掩盖。如何选择路径须独立设计，不能随意切换generateMipmaps造成重新分配或隐式整页上传。
- 游戏内保持同一相机、内容、画质、深度/阴影和ray picking，做既有固定画面及动画场景对照。此合成纹理/显式LOD证据不代替相机隐式LOD、斜视各向异性与游戏视觉审查。
- CPU base仍保留，GPU-only copy结果在context restore后必须全重建；缓存淘汰/销毁、页面复用、冷启动和资源峰值都要纳入。
- 当前实际代码仍是DataArray+正常GPU mip，未依据实验改变MAIN。
