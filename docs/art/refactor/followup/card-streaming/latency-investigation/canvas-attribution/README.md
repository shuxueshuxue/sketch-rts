# Canvas 读取归因工具

本目录保存方法与实际输入。冻结 d48 的独占诊断已完成：36 个实际样本、612 条模式记录完整 RGBA 核验通过。原数据见 [proof.json](proof.json)，完整像素见 [corpus-manifest.json](corpus-manifest.json)，离线核验与归因见 [report.md](report.md) 和 [analysis.json](analysis.json)。先读1px会提前约2.3ms绘制刷新，所有读取总量仍约2.7ms，不能认作优化。这些结果不是正式游戏性能测量。运行时必须占用独立浏览器窗口，不与正式性能测量或其他 CPU/GPU 微基准并发。

```sh
node --import tsx scripts/art-card-canvas-attribution-proof.mjs \
  --source /workspace/sketch-rts-viewport \
  --expect-source d48 \
  --out docs/art/refactor/followup/card-streaming/latency-investigation/canvas-attribution/proof.json
```

重现旧结果应使用实际保存的 d48 冻结源码；`--expect-source` 仅核对 HEAD 前缀，原工作树与全部客户端文件身份由结果中的 SHA 和 dirty 状态记录。不要把后来已修改的工作树当作同一源码。

已有原数据可离线重新核验，不会启动浏览器或执行 Canvas：

```sh
python3 scripts/art-card-latency-evidence-archive.py --materialize --folder canvas-attribution
node scripts/art-card-canvas-attribution-analyze.mjs
```

完整 RGBA 的存储由 [逐字节恢复 manifest](evidence-archive.json) 和 [归档说明](../evidence-archives/README.md)记录。若展开的 `corpus/*.rgba.bin` 已清理，先执行上述恢复命令；它恢复原路径与原 SHA，不重画或重编码。原 `proof.json`、`corpus-manifest.json`、helpers 与分析器无需修改。恢复/hash/解压也须避开性能窗口。

捕获使用原 mixed fixture、一个 native-mip bank、原始时钟。默认仅取 n116/135/158 的 8/20/8 个独特、实际 Canvas miss。捕获器传入原参数、调用原函数、返回原 ImageData；只复制现有完整 getImageData 的返回像素，早于生产原地翻行，不增加绘制或读回。保留真实 callback、完整 key、单位事实、密度/尺寸、n/tick、缓存状态和该 key 是否第一次实际 Canvas paint。捕获复制会增加分配和耗时，该游戏周期不能作为正式性能结果。

游戏周期先正常结束 GPU 等待与 WorldPresentation.dispose，随后调用全局资源 teardown。捕获器确认没有活跃 World/raster，恢复全部 observer hook。所有原 RGBA 先导出 `.bin`、核对传输 SHA 并从浏览器释放；仅在这两个独立阶段之间主动 GC 一次。后续每个实验调用由 Node 载入一张原基线，其余基线不在浏览器常驻。闭包仍可能保留 snapshot/model 对象，不能据此声称没有游戏相关内存。

| 模式 | 完整生产绘制设置之后的读取 | 需要比较的总成本 |
| --- | --- | --- |
| A | 一次完整读取 | paint + full |
| B | 实际绘制内点 1px，再完整读取 | paint + 1px + full |
| C | 原基线中 RGBA 全零的角点 1px，再完整读取 | paint + 1px + full |
| D | 两次完整读取，无新增绘制 | paint + full1 + full2 |

全部模式保持完整源域、同尺寸复用 Canvas、`willReadFrequently:true`，按生产代码执行 getContext/reset/clear/save/scale/translate/callback/restore。没有内点或透明角的模式明确标为 unavailable。1px 数据逐分量验证，不能先假定一次小读会 flush 整张 Canvas。

每个 callback 的第一次复画单独保留，包括每种源尺寸新建 Canvas 的首个样本和创建开销；它同时验证 teardown 后回调仍与实际原像素一致。默认四轮采用 `ABDC/CDBA/BCAD/DACB`：每个模式各占一次四个位置，顺序形成正反对，样本列表每轮也正反交替。没有丢弃慢样本。平衡轮已经预检，不能称为冷游戏测量。

每次完整读取均与实际原基线逐字节、SHA256 比较，含 alpha=0 的 RGB；D 验证两张完整输出，并明确报告 full1 保持到 full2 结束的额外分配。验证、找点、hash、base64 和 host 导出均在计时区间之外，但可能影响后续 GC/缓存，顺序平衡只能缓解这种偏差。所有模式轮结束后才做独立 Uint8ClampedArray 分配、set/copy/touch 控制；该控制不能从 getImageData 时间扣除。getImageData 的公开 API 时间仍包含 deferred 绘制、同步 flush、颜色转换、复制及返回数组分配。

`proof.json` 保存全部原始计时、冷首样本、模式汇总、来源 SHA、验证及不足覆盖；`corpus-manifest.json` 的 `samples[]` 保存详细 provenance，`images[]` 提供 `name/width/height/sourceSize/file/sha256/byteLength/key/n/density/tileSize`。文件路径相对 manifest。`.bin` 是 **top-down RGBA8 原 getImageData**，不是 CPU recovery 中已翻转的像素；mask 微基准应覆盖生产 Canvas miss 的 `flipY=true`，也验证另一翻转分支。

默认最多 36 张完整域，512px 全部样本共 36MiB，704px 全部样本共 68.0625MiB；实际数量和尺寸由 manifest 报告。源与工具文件在运行前后核验。此工具移除了活跃 GPU 提交，只用于 Canvas 归因；判断原读取是否等待 GPU/通道仍需要独立 tracing 或队列控制，不能将这些微测量直接换算为游戏帧提升。
