# 冻结生产源的最终证据

生产源固定为 `7b8186e668398f7869e27e47eeba626f7af2b1ac`。随后提交仅包含验证脚本、报告和产物；本目录的 `completion-manifest.json` 记录收尾时源码、脚本和输出 SHA-256。浏览器为本容器 Chromium / ANGLE SwiftShader，没有物理 GPU 数据。

- [全量测试与生产构建](validation/README.md)：5270 通过、6 项已归因失败，构建通过。
- [最终同环境性能](../followup/performance/formal-completion/FINAL-RESULTS.md)：15 轮配对，756 个测量样本／版本，模拟、覆盖与最终 RGBA 一致；限定为 GPU 世界路径。
- [最终目录审查](catalog/REVIEW.md)：55 单位与遗骸、14 建筑、17 物品及肖像，程序生成 1650 个姿态样本；人工审查范围单独列明。
- [战斗与发射挂点](visual/README.md)：速度线、伤害阈值出血、遮挡、甲板残留和沉船清除；视频与 GL／挂点误差记录。
- [真实换装流程](gameplay/gameplay-proof.json)：普通本地服务器和真实浏览器，选图、开局、选兵、移动、装备面板换主手，并核实服务器和客户端状态。场景由测试接口布置，操作使用实际 UI；人工查看装备后与世界截图，双手大剑和肖像一致，未见裁切；这不是完整战役通关。
- [双族训练流程](shared-unit-gameplay/gameplay-proof.json)：两族菜单、队列和世界选择，实际训练完成、非法生产拒绝和种族肖像差异。人工查看两族牧师世界与肖像截图：浅色与褐色衣装一致，武器和轮廓可读；不同像素哈希本身不代表美术质量。
- [甲板遗骸](deck-remains/gpu-proof.json)：独立真实 GPU 场景，跟随船体移动／旋转与沉船清理，不作为性能测量。实际遮挡对照：可见时 1637 个差异像素，完全遮挡时 0；GL 错误为 0，策略检查通过。人工查看 tick 9 与 73 截图，尸体贴合转动甲板，未漂移到水面。

复现（仓库根目录，顺序运行，避免测量竞争）：

```sh
node scripts/art-gameplay-proof.mjs --suite shared-units --port 34615 --out /tmp/art-final-shared
node scripts/art-gameplay-proof.mjs --suite art --port 34615 --out /tmp/art-final-gameplay
node --import tsx scripts/deck-remains-proof.mjs --out /tmp/art-final-deck/gpu-proof.json
```

首次 shared-units 运行在 Page.reload 返回后读取到旧文档的同步状态，随后新文档尚未创建小地图节点，因而失败。原记录保留于 `shared-unit-gameplay.initial-reload-race/`；脚本现在先等待 `performance.timeOrigin` 改变且新文档加载完成，再等待客户端同步和小地图。生产代码未因此改变。旧脚本的 art 流程本已通过，保留于 `gameplay.initial-harness/`；最终两个流程均以修正后脚本复验。

这些实证与严格 GPU 对照互补，不能声称人工逐帧检查全部资产组合、完整游戏帧率达标或进程内存存在已验证上限。完整边界见[最终报告](../FINAL-REPORT.zh.md)。
