# 船厂待下水提示、龙脸与巨鳌四肢

本轮基线为 `de3a3823450e2188c5d9d8629f8c3f029dd36de3`。独立分支 `art/creature-faces-and-launch-hint`；生产改动限于客户端表现，没有改变共享模拟、SDK、AI、维护费、攻击时机或下水规则。

## 实际改动

- 已完成但尚未下水的队首船只，在按钮显示“待下水”，说明船已造好、可驶开附近拥挤船只、空出合适位置后自动下水。保留取消与全额退款操作。世界进度条变为琥珀色，等待标注使用浅纸色底条和深棕文字保证拥挤背景可读。普通训练、未完工建筑和后续排队任务保持原状态。
- 红龙和幼龙改为扁长爬行类吻部、较小眼睛、连续头颈与后掠双角。静止时闭嘴，攻击时张口；成年与幼年保留区别。原身体、翅膀、朝向与释放点不变。
- 深渊巨鳌（deepSnapper）的远近前后脚分为四个落点，保留壳遮根部的透视关系；宽颊、钩喙与颌部层次替代尖三角脸。行走沿用原步态，不强制所有姿态都露出四脚。
- 相同三种生物的尸体对应调整吻部、角与折叠四肢，世界、头像和尸体来自同一生产路径。

## 查看证据

[改后游戏视频](gameplay/after/gameplay.mp4) / [改前游戏视频](gameplay/before/gameplay.mp4)。同一原生指令场景包含三种生物各自向上、向下的攻击释放。[上向释放](gameplay/after/frame-009.png) / [下向攻击](gameplay/after/frame-029.png) / [静止全景](gameplay/after/frame-000.png)。

[最终船厂组件图](gameplay/menu-readable-final/menu.png)使用真实付费生产并运行完整 240 tick 后的堵塞快照、生产按钮函数与 CSS，包含中英文。这是组件截图，提示框是 tooltip 数据的审查面板，不能当作完整菜单导航或实时 hover 验证。[战场中文标注](gameplay/menu-readable-final/world-blocked-zh-overlay-review-composite.png)与[英文标注](gameplay/menu-readable-final/world-blocked-en-overlay-review-composite.png)是同一快照的生产 Canvas 帧加生产透明 overlay 的审查合成，明确区别于完整 WebGL 截图；原透明 overlay、下水后图及源身份也全部保存。

[龙脸前后图](../dragon-faces/README.md) / [巨鳌四肢前后图](../turtle-anatomy/README.md) / [完整改后资产表](after-final/roster.png)。完整表涵盖 21 种野怪的静止、行走、攻击、施法、头像与尸体。本轮实际重画的是上述三种。

## 一致性与测量

[asset-comparison.json](asset-comparison.json)逐项比较 2,904 个实际 raster 状态：全部释放点一致，另外 18 种生物的 RGBA 与 54 个世界/头像/尸体 surface 字节完全相同。三种目标生物的 1,968 个状态和九个 surface 发生预期绘制变化。

[浏览器报告](gameplay/README.md)验证生产 WorldPresentation 的 40 帧与六次真实攻击释放。前后快照、命令、姿态与事件一致；WebGL error 为 0，浏览器错误列表为空。真实堵塞场景付费 480 金币，驶开挡船后原生自动下水并恢复下一任务，前后模拟快照相同。

这一轮**没有性能提升结论**。同环境独立冷绘制样本中，每 60 次绘制的均值为 37.61 → 45.42 ms，P95 为 42.30 → 52.11 ms；新细节增加了未缓存 raster 的工作量。该指标不含模拟，也不是完整帧、缓存命中或真实硬件 FPS。一次 SwiftShader 完成帧中位数为 166.45 → 188.15 ms，缺乏重复和真实 GPU，仅保留为诊断。没有通过删可见内容、降画质或改模拟规则制造收益。

## 复现与保留

集成验证：138 个文件、1,132 项测试通过，覆盖客户端、故事、SDK 边界、sprite/头像边界和船只下水/训练费用。随后修正了一处可选回调 spy 的 TypeScript 测试类型推断问题；没有改变生产代码或断言，受影响世界测试 22 项复测通过。最终 `npm run build:production` 通过（类型检查、Vite 客户端与服务端 bundle）。[执行记录和完整原始日志 SHA](validation/results.json)保留首次类型失败及最终成功日志，没有把构建失败隐藏掉。

范围限制：没有重新运行整个 AI/航海测试矩阵，没有原生 GPU 性能结果。船厂截图验证的是实际组件与世界 overlay，尚未验证完整实时菜单导航和 tooltip hover。此前琥珀色小字在树背景上不清楚的版本也保留，最终版本增加纸色底条后重新审查；不改快照或删除树来通过画面审查。

资产脚本接受独立 source 根目录与新输出目录：

```sh
node --import tsx scripts/art-creature-followup-review.ts --source SOURCE_ROOT --out NEW_DIRECTORY
node --import tsx scripts/art-creature-gameplay-proof.mjs --source SOURCE_ROOT --out NEW_DIRECTORY/world/proof.json
node --import tsx scripts/art-launch-menu-proof.mjs --source SOURCE_ROOT --out NEW_DIRECTORY/menu/proof.json
```

`before-final/manifest.json` 与 `after-final/manifest.json` 保存 raster/surface 哈希、释放点、边界、环境和源文件身份。浏览器各次运行另外保留执行脚本、完整源归档、原生快照与原始 proof。首次组件 CSS 导入失败的记录原样保留；后续只修正审查脚本，没有调整模拟结果。

游戏演示的原始 80 张 PNG 使用标准 tar 容器保存完整编码字节，十张代表帧、全部小图和两个 MP4 仍可直接查看。存储调整不改画质、模拟或游戏性能；具体归档尺寸、完整 SHA 与恢复命令见两个运行目录中的归档说明。
