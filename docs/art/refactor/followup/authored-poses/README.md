# 作画主导的人形姿态：代表样例候选

本轮落实用户对 5d7ebe0 的否定，不再微调通用定长 IK。旧提交与旧证据保留；这里是新的实际实现及视觉评审材料，不代表用户已经接受画面。

## 实现

- `sampleFigurePose` 取代 `solveFigureRig`。肩、肘、手是各持械类型自己定义的投影坐标；删除人形的定长双骨链与双肩圆交集求解。部位绘制直接使用这些坐标，不再将画出的姿势强制改成定长链。
- 剑斧、长枪/骑枪、弓、法杖各自定义待机和方向接触画法。原版的身体遮挡恢复：主手臂与装备有独立绘制层次，后臂可以被胸甲遮住，武器和握持手仍可见。
- 剑斧恢复反向回弹，长枪有较短的回弹；弓的拉弦量单独命名为 `bowDraw`，随帧变化，支撑手和弦读取同一值。法杖保持竖向施术，以空手手势和抬杖区别攻击与施法。持盾施法保持盾臂支撑，由持械手表达动作。
- 双手工具的副手直接跟随已画出的握点，副手肘部独立作画；投影缩短无需通过改变角色体型实现。双手武器施法可以逐渐释放副手并回到握点。
- 最终握点继续供实际装备与发射事件使用；模拟攻击/施法时刻、装备规则、AI 与经济未变。已迁移全部既有调用，包括故事角色、尸体装备判定与发射位置，无旧人形求解兼容层。
- 巨人/鱼人现有专用 IK 仅移到它们自己的绘制模块，行为未改。本轮没有以人形结果推断所有生物都应改用同一表达。

## 画面证据与边界

`original-vs-authored.mp4`：16 秒，同一 Canvas、缩放、朝向、动作索引与播放时间，左侧从 9819046 临时提取的原版 painter，右侧当前生产 painter。包含 footman / summoner / archer / lancer / worker 的待机、行走、攻击、施法两轮。它是实际绘制路径的可控动作演示，**不是实战录像**；只比较旧版也支持的水平朝向，不把旧版伪装成支持新方向。

`attack-filmstrip.png` / `cast-filmstrip.png` / `work-filmstrip.png` 展示全部六个采样帧，供检查恢复过程与握点连接。非工人的 work 行只是无工作动作时的状态，不代表新增技能。

`combat-effects-proof.mp4`：8 秒真实模拟及生产 WorldPresentation 实战片段，包含骑枪、剑、施法、速度线、出血及甲板效果。JSON 检查通过、errors=[]、GL error=0。另有真实箭矢及法术的 `projectile-socket-proof.json`，最大挂点误差约 1.75e-5 世界单位，GL error=0。

人工查看五个代表兵种的攻击/施法/工作全采样条、旧新同尺度画面与实战代表帧。可确认的变化是侧向待机轮廓及遮挡重新接近原版，持杖不再像平举枪械，挥击与放箭不再使用同一恢复方式。**这些是候选改善，不宣称已获视觉验收。**上下方向、所有装备变体、全部故事角色与非人形动作没有完成逐项人工验收；方向图仅作补充。先看代表样例反馈，再扩大造型迁移。

## 工程验证

15 个相关测试文件共 148 项通过；`npm run build`（TypeScript + Vite）通过，仍有现有大 chunk 提示。删除的人形骨长不变量被投影姿态/遮挡/握点/恢复/边界检查替代；技术通过不等于视觉通过。未重跑已冻结的大规模性能矩阵，没有新的性能提升声明。

```sh
npx tsx scripts/art-authored-motion-review.ts
npx vitest run src/client/art src/client/projectile-origins.test.ts
npm run build
node --import tsx scripts/combat-effects-proof.mjs --out docs/art/refactor/followup/authored-poses/combat-effects-proof.json
node --import tsx scripts/projectile-socket-proof.mjs --out docs/art/refactor/followup/authored-poses/projectile-socket-proof.json
```

未合并、推送或部署。
