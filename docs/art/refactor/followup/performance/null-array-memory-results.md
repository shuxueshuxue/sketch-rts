# allocation-only / bitset / GPU layer compaction 实证

2026-10-11，13:36:04–13:36:39 UTC；独占Chromium/ANGLE Vulkan SwiftShader。256冒烟及256/320/512/640完整矩阵均退出0。浏览器/Vite已退出，窗口已释放。没有性能benchmark，没有生产修改，当前dirty-mip成绩保持独立。

原始证据：[null-array-memory-smoke.json](null-array-memory-smoke.json)、[null-array-memory-result.json](null-array-memory-result.json)及同名日志；紧凑摘要：[null-array-memory-summary.json](null-array-memory-summary.json)。原始JSON包含commit、fixture hash、浏览器/GPU身份和每层/每LOD结果。

## 严格结果

| 尺寸 | 每级比较组数（每组16层） | RGBA最大差 | alpha阈值覆盖差 | bitset逐像素镜向检查 | bitset边界检查 | mask差异 |
| --- | --- | --- | --- | --- | --- | --- |
| 256 | 66 | 0 | 0 | 25,165,824 | 4,704 | 0 |
| 320 | 66 | 0 | 0 | 39,321,600 | 4,704 | 0 |
| 512 | 72 | 0 | 0 | 100,663,296 | 4,704 | 0 |
| 640 | 72 | 0 | 0 | 157,286,400 | 4,704 | 0 |

另有320恢复后11组LOD与6,553,600像素/784边界检查。总计287组LOD×16层严格RGBA/alpha mask零差，328,990,720次CPU阈值像素检查及19,600次UV边界检查零差。glError=0、disposalErrors=[]、console errors=[]、shader programs可运行。

候选所有case及恢复后均保持 `image.data === null`，候选DataArray的CPU整页基图字节为0。使用官方 `source.dataReady=false` 分配全部mip storage；只对初始13个占用层上传scratch完整链，3个未写空层也经过所有LOD对照。dirty1/4/16更新后继续严格验证。

fixture刻意保存输入RGBA作为oracle及reference，并使用单层scratch。因此此结果**不是整个试验进程节省了多少内存的测量**，更不是当前生产已经移除CPUbase。无需CPU页面的候选DataArray与测试oracle必须分开表述。

## 搬迁与恢复

公开array→array复制覆盖非零源/目标layer：13→1、2→5、7→9、0→15；初始化时7与0为空，未映射的目标层也保留空。每个mip通过完整Box3和明确src/dstLevel复制。对dirty1/4/16源全部上传之后再搬迁一次，各尺寸均零差。该结果不授权从尚未flush的源复制，也不证明任意非零xy子矩形：测试xy始终为0、搬运完整层级。

恢复测试在contextlost释放旧wrapper、丢弃旧oracle/reference数据及缓存对象；恢复后以新phase9确定性绘制输入重建，恢复前是phase3。新参考路径与候选逐LOD零差。没有保留paint闭包、没有把原GPU内容或旧CPUbase偷偷用于恢复；它证明可由fresh paint重新构建，不证明丢数据后自动恢复。

bitset保存原CPU拾取的alpha>=102布尔值，逐像素检验四种xy镜向及UV越界/端点/格边界，与原RGBA判定一致。它不用于绘制、不替代原GPUalpha，不被宣称支持未来可变阈值或双线性拾取。

## 尚未完成的生产工作

1. upload前pendingRGBA的有界生命周期与真实内存峰值，避免从整页缓存转成整帧临时缓存。
2. 将当前CPU compaction改为源flush→分配新页→逐级GPU搬迁→更新实例/拾取映射→释放旧页的事务，处理热/冷混合和全部材质。
3. context restore清缓存后的完整可见场景重绘、选择/拾取一致与恢复帧卡顿。
4. 真实场景CPU ArrayBuffer、GPU存储、SwiftShader进程RSS、closure保留、draw及帧时分布。

以上仍属下一阶段，未借此修改生产或声称内存/性能已提升。公开API正确性和固定阈值表达已得到当前环境隔离证据。

完整复现命令：

```sh
node docs/art/refactor/followup/performance/scratch-mip-proof.mjs --fixture docs/art/refactor/followup/performance/null-array-memory-fixture.js --query 'sizes=256,320,512,640' --out docs/art/refactor/followup/performance/null-array-memory-result.json
```
