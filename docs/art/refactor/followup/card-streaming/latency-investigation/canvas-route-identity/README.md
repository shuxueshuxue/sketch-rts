# Canvas 实际入口的绘制身份复用

本轮只迁移 catalog 的 `drawAtlasUnit`、`drawAtlasUnitPortrait` 和 `drawAtlasUnitFigure` 缓存身份，使用已经存在的 `unitPaintKey`。独立 Chrome 对照通过 **1302 组 / 5208 次实际 atlas 调用**：每次完整原绘制域 RGBA（含透明 RGB 和 world 阴影）、实际 crop 数据与 drawImage 参数、整个最终 Canvas 输出的 SHA 全部相同。没有容差、缩放后抽样或直接画笔替代入口。

[原始 proof](browser/proof.json)记录源图、调用、缓存计数、负控及退出状态。此结果证明这份有限矩阵的像素等价与实际复用，**没有测量帧时间、FPS、游戏内存或修复 3D Canvas miss 长尾**。

## 改动边界

- 保留原 `pose`、team、facing、presentation 传给画笔；密度、原始 128/176 domain、裁切、世界阴影和 UI bust/fit 规则不改。
- 仅 plain object 且没有任何 own key 的空 presentation 参与共享。任何自定义字段、显式 undefined、不可枚举属性、symbol、自定义或 null prototype 都保留该路由原始 raw key；装备、衣色、motion、appearance 与 detail 不受缓存复用约束。
- `drawAtlasModel` 的 campaign/opaque 画笔完全保留原身份与参数。
- `unitPaintKey`、3D 代码、画笔、武器挂点、动画 tracker、血迹和模拟规则未修改。没有采用新的跨队伍人形配色别名、aim 合并或减少动作采样。

此前共享规则仅进入 World3D；Canvas catalog 仍使用 raw `animationKey`/color。此次使用现有 idle **0/4、1/3、5/7**、intrinsic creature team 与 siege 被忽略输入规则，不扩展已有动作等价关系。源数据[36 个真实 miss](../canvas-attribution/corpus-manifest.json)有 36 个不同的完整域 SHA，不能据此把不同姿态合并。

## 实际验证

Chrome **151.0.7922.173 / V8 15.1.206.23** 仅允许 CPU Canvas2D，WebGL 请求为 0。前后 atlas 模块各自拥有独立真实 RasterCache；portrait-fit 用两个相同原字节模块实例，缓存相互隔离。候选清理和绘制后，原版 cache stats 必须完全不变，防止参考图来自候选暖缓存。

| 分组 | 组数 |
| --- | ---: |
| 全部 44 类 stock 的 idle pairs，density 2/4、facing −1/+1 | 528 |
| 8 类携武器单位的 carry idle pairs | 96 |
| 21 类 intrinsic creature 跨 team，idle/walk/attack/cast/work | 420 |
| 4 类 siege 的已知静态/攻击输入共享 | 128 |
| UI portrait/figure 的 intrinsic creature 跨 team | 42 |
| domain、密度、朝向、team、phase、bust、fit、17 类 presentation guard 和 opaque model 控组 | 88 |
| **合计** | **1302** |

全部组通过。1214 个声明的共享组减少实际原始源读取；其他控组保留应有的缓存区分及不同图像。

| 计数 | 原版 | 候选 |
| --- | ---: | ---: |
| 实际完整源读取 | 2603 | 1389 |
| 实际 RasterCache misses | 2432 | 1260 |
| UI 完整源读取观测值 | 171 | 129 |

这是逐组清缓存的正确性矩阵，不按实际战场人口加权；读取次数不能换算整局速度。FittedPortraitCache 没有 public miss 字段，UI 数值由真实 getImageData 源读取观测，并和非淘汰双调用组的 entry delta 核对。observer 增加额外 crop 读取、hash 和 task yield，没有计时结果。

5 个[实际入口测试](../../../../../../../src/client/atlas-art.test.ts)通过，[原始日志](validation/focused-tests.log)保存执行结果。它们检查 fresh 原画笔收到 frame 4、共享后的 world/阴影/crop 与 fresh draw 相同、world/UI creature 复用，以及自定义细节、朝向、密度、domain、team、bust 和 opaque model 的负控。浏览器结束后 observer 恢复、捕获数组释放、两个 raster/portrait 缓存声明的 ownedCanvasBytes 都为 0；Chrome 正常退出，无 error 或 loading failure。这些容量字段不代表进程 RSS。

## 冻结来源与复现

原版 atlas 快照在 build 前与 Git `8345a0dcfeb96b6777ac3940ec64cba13816c851:src/client/atlas-art.ts` **完整字节相等**：SHA `6008ae43a17a502fab7d4e496e0f3d024328a7819eb798859d215e3454d59ceb`。候选 atlas SHA 为 `fc821836ce078244f4f118612ff23c647b97fdfd768d0975428a83b0dc154a16`。proof 的 sourceCommit 是基础 HEAD 8345，候选工作树差异单独记录；不能把基础 HEAD 误称为已提交候选。

[旧源](browser/before-atlas-art.ts)、[实际候选源](browser/candidate-atlas-art.ts)、[执行 driver](browser/executed-harness.mjs)、[fixture](browser/executed-fixture.js)、[实际 bundle](browser/executed-modules.js)和[metafile](browser/bundle-metafile.json)保留原字节。两套 provider 从 run-start snapshot 编译，body 等依赖共用同一当前源；所有实际读到的依赖、旧源、helper 在结束后重新核验 SHA 不变。

仓库根目录执行，输出必须是不存在的新目录；同样保持旧 Git 源和候选源字节，安排独占窗口：

```sh
node scripts/art-canvas-route-identity-proof.mjs \
  --source /workspace/sketch-rts-viewport \
  --before docs/art/refactor/followup/card-streaming/latency-investigation/canvas-route-identity/browser/before-atlas-art.ts \
  --before-commit 8345a0d \
  --out /tmp/new-canvas-route-proof/proof.json
```

该矩阵不覆盖任意未来 detail 画笔，也不验证 WebGL、命中拾取、模拟或事件时序。custom presentation 因此保持 raw key；画笔改变时应重新验证共享条件，绘制效果优先于缓存命中。根车道的集成检查与其他候选测量独立记录，不将本轮结果混入之前 pipeline ABBA 的性能百分比。
