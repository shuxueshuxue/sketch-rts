# CPU→scratch 的 token 等待：静态核查与被拒绝的分段候选

64KiB分段候选已被[正式 ABBA 分析](../upload-abba/report.md)拒绝，未接入生产：完整 CPU mean增加0.72%、完成 wall mean增加0.82%，partial公开copy调用约为原来的6.34倍。24张捕获PNG的完整RGBA一致，独立旧版及便携版mock七项用例也均通过，但这些正确性结果不能抵消完整帧的回退。[mock 执行记录与完整输入](chunk-mock.md)保存实际证据。原241ms上传等待仍未解决：n135/tick45的一次CPU→scratch公开copy包含`CommandBufferProxyImpl::WaitForToken`两段合并240.631ms，主线程GC/Skia overlap均为零。[已有 trace 摘要](../trace-analysis/compact.json)没有记录这次公开调用内部哪条GL API触发等待，不能将其全部称为一次mip生成、像素复制或纹理覆盖hazard。

本报告最初的源码调查只读取源码和既有小摘要，没有自行启动浏览器、基准、测试或重新解析大 trace。后续独立 mock 与正式对照由父线程在独占窗口执行；本车道本次只更新文档。历史证据头中的 prepared 状态和原始测量文件保持原样。

## 已证实的调用链

当前 `CardMipUploader.uploadLayer` 先用 `updateCardPixels` 比较完整 RGBA 并维护原尺寸 CPU buffer，随后通过 `renderer.copyTextureToTexture(cpuSource, scratch.texture, dirtyBox, destination)` 更新 scratch level0。CPU wrapper 保持未初始化、DataTexture 默认 `generateMipmaps=false`；目的 scratch 保持原 SRGB 完整尺寸并有 `generateMipmaps=true`。

Three 0.186.1 的公开 copy 在这里先绑定已初始化 scratch，设置/恢复 UNPACK 参数，然后调用 typed-array `texSubImage2D`，最后生成一次目的原链。`setTexture2D` 仅在 texture version 改变时走 uploadTexture；常规 partial copy 没有改变 scratch version，不会暗中完整重传或多生成一次。UNPACK 参数在 Three 的 WebGLState 中缓存，不能按每次 copy 有五次实际 driver getParameter 来估算同步开销。源不是 Canvas 直接上传；Canvas 完整 readback 和翻行已经在这个调用之前完成。

最后，scratch 原 sourceLevel=N+dstLevel 逐级复制到 array layer。Array 目的 `generateMipmaps=false`，不会再次生成。第一张源和失败重试仍通过完整 initTexture 上传并生成一次；同 RGBA skip 已跳过 scratch 上传/生成，只保留目标尾链复制。未发现可直接删掉的重复 mip 生成。

## 精确 Chromium 来源与排除的误判

实际浏览器为 Chrome/151.0.7922.173，`Browser.getVersion` revision=`a96602f30358e9b5d256a0464e7e4d4bec223004`。下面使用 Chromium 官方 GitHub 镜像的该提交，不使用后来 main 的实现推断当前驱动。[原始 byte SHA 记录](chromium-source-evidence.json)保存 URL、长度和下载原文 SHA；未修改原文。

| 原始文件 | 字节数 | SHA256 |
| --- | ---: | --- |
| [gles2_implementation.cc](https://raw.githubusercontent.com/chromium/chromium/a96602f30358e9b5d256a0464e7e4d4bec223004/gpu/command_buffer/client/gles2_implementation.cc) | 258877 | c7a47a5d7f773a7b262237593d6b8b6085a52558cf09987599cb6e5e606aeeaf |
| [transfer_buffer.cc](https://raw.githubusercontent.com/chromium/chromium/a96602f30358e9b5d256a0464e7e4d4bec223004/gpu/command_buffer/client/transfer_buffer.cc) | 11011 | b75bd6677464ce7388d4af321140b3acec1a19c77daf4a232e014d50f645b81d |
| [ring_buffer.cc](https://raw.githubusercontent.com/chromium/chromium/a96602f30358e9b5d256a0464e7e4d4bec223004/gpu/command_buffer/client/ring_buffer.cc) | 6401 | deaf072c337177cedf8123d879ebcd86717ab96f5b64f8f4204c76a88d5cc94a |
| [cmd_buffer_helper.cc](https://raw.githubusercontent.com/chromium/chromium/a96602f30358e9b5d256a0464e7e4d4bec223004/gpu/command_buffer/client/cmd_buffer_helper.cc) | 13772 | a2dfae2845fbaed16705a5d5b6951f724d467911ab6417854adceb145ebb0a98 |

`TexSubImage2D` 会按 rectangle 的 width/height 重算 service-side size，应用 skip 参数并将源行通过 `CopyRectToBuffer` 打包到共享 transfer buffer。因此 CPU view 持有 full512/704 数组，不等于运输整个数组。已定位的 345×264 RGBA rectangle 对应 364320 bytes。再在应用层打包一个小矩形不能据此声称减少传输字节，通常只是重复浏览器已做的工作。

`ScopedTransferBufferPtr` 请求 rectangle 大小；`AllocUpTo` 可以选取包括 pending 空间的尺寸，再交给 `RingBuffer::Alloc`。当连续 free 空间不足时，后者回收最旧块并可能 `WaitForToken`；release 插入 token，helper wait 会 flush 后等待服务处理。这个源码路径与 observed token 等待相容。Trace 没有 C++ caller stack，仍不足以确认具体回收块、buffer capacity、wait 是否全部来自该路径。

已有证据也不足以将等待归为单 scratch 的 read→overwrite hazard。换成两个 GPU scratch 会增加 CPU/GPU占用，且没有证明能加快该 transfer buffer 的回收；不优先加新缓存。

## 选择的唯一对照：大 rectangle 分段，末段生成一次原链

当时选择这个诊断对照，是因为source allocation size有明确token-wait路径；最终测量未支持采用它。单变量是“大partial upload的最大行段payload”，控制组保持现有一次rectangle，候选限制为64KiB。没有额外Canvas read、CPU重新打包、GPU纹理或缓存容量变化，继续复用现有full CPU scratch与从未初始化的CPU wrapper。以下保留候选设计和验证计划，不表示生产实现。

只修改 warm scratch 的 partial branch，首次完整 init 和失败后完整重传保持原样。每段以原源坐标及相应目的坐标调用公开 copy。前几段临时把目的 `generateMipmaps=false`；最后一段设为 true，生成一次相同完整原链，然后照旧复制所有 source mip 到 array。finally 恢复原 generate flag，沿用外层 target/face/mip 恢复和失败后的保守 full retry。

这次 345×264 rectangle 每行1380 bytes，64KiB可容47行，产生47×5+29的六段。六段传输总量仍364320 bytes，mip generation仍一次，source尺寸、sRGB、alpha0 RGB、旧像素清除、各目标level及渲染顺序均不变。小 rectangle 和完全相同 RGBA 仍用现有路径。

当前游戏宽度的实现要点可局限为一个 private helper 的循环；独立候选还在超宽行边界横分相邻列，保证每次始终≤64KiB：

```ts
const rowBytes = dirtyWidth * 4;
const rows = Math.max(1, Math.floor(65536 / rowBytes));
const originalGenerate = scratch.texture.generateMipmaps;
try {
  for (let y = top; y < bottom; y += rows) {
    const end = Math.min(bottom, y + rows);
    scratch.texture.generateMipmaps = end === bottom;
    region.min.set(left, y); region.max.set(right, end);
    destination.set(left, y);
    renderer.copyTextureToTexture(scratch.cpuSource, scratch.texture,
      region, destination);
  }
} finally {
  scratch.texture.generateMipmaps = originalGenerate;
}
```

不设置 source/destination needsUpdate，不重新创建 Texture，也不调用 renderer 私有状态。期间 scratch 不供场景采样；只有最后的完整源链生成与全部 array copies 成功后发布当前卡片。任一段抛错仍使该 scratch 未提交，下一次通过原完整上传重建。恢复路径要求 generate flag 已被 finally 还原。

独立文件已归档为 [完整候选](../upload-chunk-mock/proof.json.inputs/candidate.ts)、[完整原版](../upload-chunk-mock/proof.json.inputs/original.ts)、[共享 region](../upload-chunk-mock/proof.json.inputs/card-upload-region.ts)、[已执行 mock 语义工具](../upload-chunk-mock/proof.json.inputs/art-card-upload-chunk-mock.ts)、[已执行运行入口](../upload-chunk-mock/proof.json.inputs/art-card-upload-chunk-mock.mjs)及[来源/依赖SHA](../upload-chunk-mock/proof.json.inputs/metadata.json)。原版完整class取自5b，与制作时当前uploader字节相同，SHA=`3526789cda89f194eb9ee69ec266c163f043d75d88c8ef892870d1d5dfa1e295`；候选SHA=`8151202f0add0044a30147645515200e69fde494f439cb801888e62e75f75783`。`card-upload-region`原文SHA=`25d852a8b6424c81648e93b68db98de1076cee90659d3f2b01cc5b07878c8439`。两个provider和mock均保留裸`three`，运行入口通过限定导入点的esbuild resolver同绑一个本仓库安装包公共ESM入口，不改源import，也不制造第二套Three身份。父线程便携运行的[proof](../upload-chunk-mock/proof.json)和[log](../upload-chunk-mock.log)记录七项全通过，所有工具/provider/依赖运行前后SHA一致。便携重放命令见 [chunk-mock.md](chunk-mock.md)，入口为：

```sh
node scripts/art-card-upload-chunk-mock.mjs --out /tmp/card-upload-chunk-mock-replay.json
```

新scalar `partialUploadCopyCalls`计公开partial调用尝试，包括可能抛错的一次。旧partialUploads/byte统计仍在全部段成功后每逻辑raster计一次；mock事件另外保留中断前真实模拟写入，不能把失败写入当作零传输。Mock核CPU/base/layer0所有RGBA与mip生成顺序戳，不模拟或冒充真实native sRGB过滤结果。

## 最小验证与否决条件

正式隔离采用[完整 uploader provider 驱动](../../../../../../../scripts/art-card-upload-formal-proof.mjs)，没有用公开copy的per-call hook拼接候选行为。Vite只将production `PaintedCardBatches`的`./card-mip-uploader`导入替换为原版完整模块或候选完整模块；`CardMipUploader`、`createCardArray`、`cardTextureBytes`共同来自所选provider。原版与候选region bytes一致，两provider的裸Three导入按production uploader上下文解析，每次运行内的完整resolved ID一致；该证据不等于独立测得整个WorldLayer模块图的对象singleton。没有额外flush、fence、render或逐次wrapper；仅候选warm scratch的partial branch发生变化，array/mip copies原样。四轮、每轮两个生命周期的原始结果保存于[A](../upload-abba/original-A/raw.json)、[B](../upload-abba/candidate-B/raw.json)、[B2](../upload-abba/candidate-B2/raw.json)、[A2](../upload-abba/original-A2/raw.json)。[最终报告](../upload-abba/report.md)保存拒绝结论、全部回退和首次analyzer失败；修正后的分析只核验单次运行内provider依赖身份，不错误要求独立运行的临时optimizer URL一致。

候选因正式性能回退被拒绝，没有继续安排它的真实GPU raw-mip验证。以下保留原条件验证计划。已有[card-streaming-gpu-proof.mjs](../../../../../../../scripts/card-streaming-gpu-proof.mjs)与[fixture](../../../../../../../scripts/card-streaming-gpu-fixture.js)逐层读取GPU存储的原编码RGBA8，与独立完整DataArrayTexture的原生generateMipmap oracle比较；保留全部通道，不用shader色彩转换或alpha mask。它覆盖256/320/512/640/704，额外检查256/640/704的N1/N2尾链、alpha0非零RGB、移位清除、完全相同源复用、非默认RT恢复、实际copy后失败的full重试、compaction及context重建。任何未来再提出的分段候选还须确认中间第2段copy已真实完成后才注入失败，以及所有分段合计字节不变、变化源只生成一次完整原链。

现有raw-mip runner的`--source`是工作树根目录，fixture从该根导入uploader；它没有独立`--candidate` provider参数。因此不能直接把`/tmp`候选文件当作`--source`，也不能把当前生产uploader的proof记成815候选验证。若未来另行提出候选，需在批准的独立工作树中提供冻结来源，或先批准一个测试专用的同源provider resolver，再按该实际入口记录SHA。原计划中runner对批准工作树的命令为：

```sh
node --import tsx scripts/card-streaming-gpu-proof.mjs \
  --source /path/to/approved-candidate-worktree \
  --sizes 256,320,512,640,704 --require-skip --require-tail \
  --out work/card-upload-chunk-correctness/raw-mips.json
```

还应保留已有135种 bank/order/material 全RGBA oracle：[card-bank-gpu-proof.mjs](../../../../../../../scripts/card-bank-gpu-proof.mjs) 在9种配置、5种bank数、3种alpha模式下，以隐式采样的单bank顺序作为基准，逐字节比较color、sun-depth及point-distance六面，并检查实际绘制顺序。这是整条呈现路径的验证，不能替代每级原始 mip 存储验证。相同批准工作树上的实际入口为：

```sh
node --import tsx scripts/card-bank-gpu-proof.mjs \
  --source /path/to/approved-candidate-worktree \
  --banks 1,2,8,9,16 --modes opaque,opacity,rgba --cases 9 \
  --out work/card-upload-chunk-correctness/bank-135.json
```

上述候选 GPU 命令在本次文档更新期间未执行，也没有新建工作树或修改客户端。不能先通过 shader 可见结果就跳过 raw mip proof。

已完成性能对照使用相同真实mixed request顺序、缓存provider、时钟和冷暖流程，独立lifetimes ABBA。正式harness没有逐copy observer或内部trace，因此不能证明原241ms等待消失、单次copy最大值缩短，或等待移到了哪个分段/generate/renderer/frame completion。完整CPU及完成wall回退已经足以拒绝本候选；不能以CPU-only no-op render阶段的等待直接代替真实游戏阶段结果。

Chromium自身已经能按可用transfer size分行，候选并不减少总字节、最终mip工作或array复制；额外公开copy和UNPACK命令会增加开销。若ring已完全占满，64KiB也会等待；若根因是GPU吞吐或其他service任务，分段没有消除这些工作。门槛64KiB只是一个可证伪对照，不是浏览器通用最优值。Mock通过而完整帧测量回退，本候选最终拒绝，未集成生产，也没有新增常驻调参/变体池；上传卡顿仍不能宣称已修复。
