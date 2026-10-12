# allocation-only 与 alpha-mask 后续隔离验证：ready

2026-10-11；本方案先通过语法检查，后在baseline正式采样、GPUstrict结束后按root授权执行。256冒烟和含512的完整矩阵均通过，见 [null-array-memory-results.md](null-array-memory-results.md)。生产保持未修改。

新fixture：`null-array-memory-fixture.js`；使用现有runner的 `--fixture` 入口，原默认scratch fixture/结果不改。

## 覆盖

- 默认256、NPOT320/640，每页16层。候选始终 `DataArrayTexture(null)` + `source.dataReady=false` + 完整mip描述 + `generateMipmaps=false`。结果逐case报告 `candidateImageDataNull` 与 candidate CPU base=0。
- reference和fixture oracle仍保存完整输入RGBA用于对照/临时scratch输入，明确不把试验进程内存说成生产节省值。
- 初始13占用层、3空层，只对占用层scratch生成/复制；逐LOD对比整16层，包含未写空层；随后dirty1/4/16，所有整数及0.5/2.5分数LOD真实RGBA与独立alpha=.4 mask严等（零差门限）。
- array→array compaction：源层13→目标1、2→5、7→9、0→15，初始源7/0为空；其余目标层保持空。每级采用公开copyTextureToTexture和完整Box3非零源z/目标z，xy为0。同时检查首次搬迁及dirty源先flush后搬迁；所有源完整初始化后才搬，不以stale GPU数据假验证。
- alpha>=102 bitset：每层所有像素、x/y四种镜向组合以及UV=0/1/outside和边界位置与原RGBA阈值判定对照。mask生成独立于GPUalpha滤波，保留当前CPU拾取语义；无paint closure保留。
- context restore：旧wrapper dispose，丢弃旧oracle、reference data及页面对象；恢复后由新的确定性paint输入phase9重绘（恢复前phase3），新建null候选完整上传。对新的独立reference逐LOD验证，明确是重绘恢复，不是GPU内容自动复活。
- 无性能benchmark，只有fence确保质量读回前GPU完成。窗口限定下先256冒烟，再256/320/640矩阵。严格保存失败，不调整门限。

## 授权窗口内命令

```sh
node docs/art/refactor/followup/performance/scratch-mip-proof.mjs --fixture docs/art/refactor/followup/performance/null-array-memory-fixture.js --query 'sizes=256' --out docs/art/refactor/followup/performance/null-array-memory-smoke.json
node docs/art/refactor/followup/performance/scratch-mip-proof.mjs --fixture docs/art/refactor/followup/performance/null-array-memory-fixture.js --query 'sizes=256,320,512,640' --out docs/art/refactor/followup/performance/null-array-memory-result.json
```

这仍不是生产内存优化：还需重组pendingRGBA生命周期、实际cache/compaction事务、全部材质/拾取引用、恢复帧卡顿及真实RSS/ArrayBuffer峰值。现阶段先验证公开API和精确拾取表达，不将后续工作混入当前dirty-mip可回退成绩。
