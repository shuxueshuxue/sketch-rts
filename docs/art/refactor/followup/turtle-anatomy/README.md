# 深渊巨鳌（deepSnapper）：四肢与面部修订

基线：`de3a3823450e2188c5d9d8629f8c3f029dd36de3`。生产改动仅 `creature-painters.ts` 的 `turtleBody`。不改姿态、嘴部释放点、攻击时机或模拟。

`before.png` / `after.png` 使用实际 `paintCreature` 入口及 NAPI Canvas。每行左两列为 2 倍双向，右两列为原尺寸双向；包含 idle、8 个 walk 帧、攻击 contact 的 aim -4/0/4（±60°）、cast。已经人工查看前后两图。

旧远近腿脚几乎重叠，静止时读成两腿。新版将远脚与近脚分为四个落点，保留 shell 遮住远肢根部、近肢盖住 shell 底缘的层次；近脚接地仍为 y=18。四肢根部随 bob，脚不整体随壳上下漂移。脚趾收进落脚线。宽颊、颌部暗面、窄眼和钩喙替代旧尖三角脸，沿用原有洗色与轮廓绘制。壳的原有体块与甲片保持，未改变造型尺寸。

两份 JSON 包含每个姿态的 alpha>8 实际像素边界及原释放点。13 组 release 完全一致；上下边界均维持 -28..19。横向最大为 cast 的 x=58，未扩大既有最大绘制范围。原坐标口缝仍经过 mouth/release 的 x=headX+14、y=headY+4。

复现 after：

```sh
node --import tsx scripts/art-turtle-review.ts after
```

before 使用同一个 review 脚本，由 esbuild 临时 bundle 的 onLoad 将 `creature-painters.ts` 替为 `git show de3a382:src/client/art/creature-painters.ts`；其它入口、姿态、缩放和 NAPI 环境不变。临时 bundle 存于忽略目录 `node_modules/.cache/turtle-before.cjs`，不回写或切换工作树，避免覆盖同文件龙类并行改动。

局限：这是纸面 raster 对照，不是最终游戏 WebGL/远景审查；性能与完整图集测试由集成车道执行。本次不宣称性能收益。向下 60° 咬击时头部会自然遮住远侧前脚，idle/walk 的四脚分离不应通过错误透视覆盖这个遮挡关系。当前沿用原有步态参数，未增加新的脚步锁定系统。
