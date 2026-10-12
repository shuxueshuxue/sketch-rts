# 活船甲板上的死亡遗骸

补齐原绘制遗漏：船还活着时被杀的船员，以前只有死亡世界坐标，尸体被 ground pass 画到船底；现在保留死亡时的甲板支撑事实，表现层随船移动和转向。

## 事实与职责

- `Corpse.deck` 仅保存 `{shipId,x,y}`。由死亡清理在装备掉落前捕获；复制为独立对象，snapshot/restore 不共享可变 deck。原“船同时沉没时，随船乘员不生成尸体”的规则不变。该事实不参与寻路、选敌或伤害决策。
- `client/deck-remains.ts` 负责不可变局部坐标到当前显示船位的转换、同船索引、固定外观变体和天气透明度。无母船、母船死亡时返回不可见；永不使用旧世界坐标回退到地面。
- Canvas ground pass 永远排除带 deck 的尸体。在 drawCanvasShip 的 afterDeck 回调内绘制，先于桅杆、炮、旗与活船员。尸体本身仍使用 drawAtlasCorpse、已有装备外观及剧情 remains painter。
- WebGL 用同一 PaintedCardBatches 类的独立透明配置实例，不另造模型或栅格实现。卡片实际躺在甲板高度上，而不是竖起的活人卡片。矩阵兼容原裁切纸面坐标，不改变活体脚线或 shader 默认设置。
- 尸体使用 depthTest，禁用 depthWrite、投射阴影和拾取；低 alphaTest 保留淡墨。透明批次先于揭帆透明层绘制，正常船体、桅杆与炮仍能按真实深度遮住它。
- age、船位、转角与 shipId 不进入图像缓存键。透明度逐实例变化，平移/转动只更新矩阵；本层缓存、纹理及材质在 reset/dispose 时释放。

旧存档没有甲板死亡事实时不能可靠反推原支撑船，仍按保存的地面事实绘制；不猜测归属或修改旧存档位置。

## 验证及结果

新增 helper 测试验证平移/转向、不变死亡事实、无船/沉船不落地、索引与透明度无关；矩阵测试检查四种朝向下的 crop 坐标仍在真实甲板平面。Canvas 测试检查 ground pass 排除、完整船层出现、移动/老化不重画缓存、母船消失隐藏。World3DLayer 测试检查独立透明材质、平面高度、缓存复用和生命周期。

实际 GPU 证据脚本：`node --import tsx scripts/deck-remains-proof.mjs`。使用 native strikeUnit/stepGame 生成死亡、native move 让船移动转向，再让母船死亡；保存 24 帧视频和选取截图。实际深度测试通过 readPixels 对照：尸体显隐本应改变可见像素，在上方插入仅用于验证的不透明挡板后显隐必须零像素差；挡板不进入模拟，截图前移除。

实测完成（2026-10-11）：

- 定向 5 文件共 44 测试：首轮 42 通过，原 world-layer 两项测试仍按旧“矩阵包含 quad 尺寸”解释数据而失败；适配 GPU shader 的 `cardRect` 展开后，保持每 texel 尺寸和实际脚线断言，单文件 16/16 复测通过。原始记录见 [focused.log](focused.log)、[world-layer-followup.log](world-layer-followup.log)。新增 Canvas、矩阵、母船消失与 snapshot/restore 别名测试均通过。
- GPU 记录 [gpu-proof.json](gpu-proof.json)、[日志](gpu-proof.log)、[视频](gpu-proof.mp4)；20 个活船帧全部有甲板遗体，移动转角从 0.015 到 1.134 弧度。矩阵高度误差 0.00000184 以下；天气透明度从 0.571 逐渐降至 0.4。全过程栅格化次数为 1。
- 后 4 个母船死亡帧不再提交船员遗体，也没有在地面生成该遗体。原有船体自身的地面死亡残骸仍按既有规则显示。
- 真 GPU depth readPixels：无遮挡时遗体显隐造成 1,637 像素差；上方不透明挡板完全遮住后差异为 0。GL error 为 0，14 个 shader program 均可运行，无浏览器错误。
- 已人工查看 [初始死亡](gpu-proof-0.png)、[航行转向](gpu-proof-12.png)、[沉船后](gpu-proof-20.png)：遗体平躺在甲板并随船转向，未悬浮到活人卡片平面。活人、桅杆及炮保持原有显示。

首次验证场景用 10,000 伤害同时击沉了船体，因此原本正确的 wreck 规则没有生成乘员遗体。将测试攻击改为船员当前 HP 的两倍后保留船体，重跑通过；未修改伤害或 wreck 规则。原始场景诊断保留在 [gpu-fixture-overkill.log](gpu-fixture-overkill.log)。

限制：GPU 检查环境是 Chromium 151 + SwiftShader；这证明实际 shader、深度和生命周期行为，不构成硬件性能提升证明，也不替代全项目集成测试。
