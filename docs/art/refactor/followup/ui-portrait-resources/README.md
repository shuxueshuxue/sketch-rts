# UI 肖像画布生命周期补齐

这次补齐 `portrait-fit` 与 GLB 肖像两个真实 UI 入口的资源所有权，不改变人物模型、队伍装束或裁切规则。不是新增剧情 HUD，也不将画布预算等同于浏览器进程内存。

## 保持的图像契约

`portrait-fit` 继续在 512×512 的新画布默认状态下，先平移 (256,256)，再按 4 倍绘制；非透明范围仍以 alpha > 8 测量，bust 仍截取原范围顶部 65%，最后仍按目标框 94% 缩放。没有采用世界 RasterCache 的圆角线连接、密度或透明像素阈值。工作画布复用前恢复完整默认状态，清掉像素、路径、clip 和 save 栈。

GLB 的投影、光照、三角形次序和颜色保持原实现，仅增加图像所有权。固定造型的 RGBA 对照和重新生成一致性测试记录在两个对应 test 文件。

## 所有权与借用

- `FittedPortraitCache.draw` 同步完成画到目标的操作，不向调用者返回缓存图像。每一层嵌套 painter 独占工作画布；完成后最多保留 4 张 512² 工作画布。缓存继续限制为 96 张 / 12MP。超预算图像照常当次绘制，之后立即退役。
- 同步 `drawImage` 期间按引用计数借用图像。嵌套清理/淘汰将正在使用的图像放入待退役集合，最后一个借用结束后才将宽高设为 1。普通淘汰及 clear 立即缩小闲置图像。绘制中 clear 增加代次，旧代绘制结束不会重新填充已清理的缓存；异常路径也归还工作画布与借用。
- `currentModelPortrait` 原始返回值只供即时读取，有效期到下一次 provider 调用或 clear；不能跨调用持有为长期资源。生产唯一消费者 `drawModelPortrait` 在同步 `drawImage` 前 pin、finally unpin，因此嵌套画法或 destination 异常不会缩小仍被使用的图像。
- GLB 肖像缓存仍保留最多 64 张 256² 图像。淘汰和 clear 显式缩小 canvas；模型几何仍由既有 ModelLibrary 拥有，不因清理肖像而释放共享模型。
- `clearCanvasArtCache` 同时清理世界与 UI 人物图像。非 BFCache 的 pagehide 在原 teardown 中调用该入口；BFCache 返回仍保留原场景。模型肖像沿用已有异步模块清理入口。
- `fittedPortraitStats` / `modelPortraitStats` 单独记录缓存、闲置工作画布、借用与待退役的实际拥有字节；集合去重，不将借用中的缓存重复计算。

## 验证状态

准备的 targeted：`src/client/art/portrait-fit.test.ts`、`src/client/world3d/model-portraits.test.ts`、既有 UI/装备/阵营外观测试；RGBA 对照包括 3 种真实造型、低 alpha 边缘及空画法，各检查 bust/完整图像，共 10 组固定输入。另测试嵌套、重复借用、clear 中绘制、异常、预算淘汰、深层工作池上限及归零统计。

定向验证已执行（2026-10-11）：4 文件共 19 测试最终通过。[首轮日志](focused.log) 为 18/19：新增 GLB 淘汰测试的 BoxGeometry 夹具有六个材质槽却只提供一个材质，导致测试在缓存动作前失败；清理夹具的组索引后，[模型复测](model-followup.log) 6/6 通过，没有为测试改变生产投影逻辑。portrait-fit 7 项含 10 组旧/新 RGBA 对照，全部零差；另有现有装备集成 3 项与共享种族装束 3 项通过。GPU 车道的同期全局类型检查 exit 0。

既有 UI 肖像消费者 [portrait-consumer.log](portrait-consumer.log) 2/2 通过，因此本轮 5 文件累计 21 测试最终通过。本次未重复整个项目构建/全套测试。

实际开发图鉴脚本 `node --import tsx scripts/unit-sheet-proof.mjs` 已执行。打开真正 `unit-sheet.html`，读取两族 priest/summoner 的四张 DOM canvas，四张与显式种族配置的参考绘制均为零像素差；余烬 priest/summoner 与省略种族参数的旧错误输入分别有 3,973 / 4,660 像素差。旧“薪火召唤者”文案不存在，无浏览器异常。证据：[JSON](unit-sheet-proof.json)、[原始日志](unit-sheet-proof.log)、[实际页面四张画布截图](unit-sheet-proof.png)。已人工查看截图：Grove 的白袍/蓝绿袍和 Ember 的褐色装束均完整可见。该验证是实际开发图鉴的 Canvas 路径，不冒充完整对局验证或 GPU 性能测量。
