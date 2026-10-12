# 野怪头部修订候选

用户指出头部逊于原版后，直接对照 `9819046` 原始 painter 和 `f3f91d8` 上次交付；没有把上次重构中的中间版本冒充原版。

- `original.png`：9819046原版，实际 painter。
- `before.png`：f3f91d8上次交付，实际 painter。
- `after.png` / `comparison.png`：本次修订；同一10种代表生物的正常尺寸与头部放大。使用4倍离屏绘制保证放大能看清线条。
- `world-after.mp4` / PNG / JSON：21种目录生物、真实对战、生产 WebGL；80帧160ticks。GL错误0，浏览器错误0。
- `gait/`：21种目录生物的8步态相位。
- `../creature-redraw/*-heads-after.png`：全21种的 idle / walk / attack / cast 审查表。

修订范围：9种头部表达影响20种目录生物：石魔像4种、石背木体1种、食人魔3种、鱼人3种、猎兽2种、古鹿1种、深水龟1种、蜘蛛3种、龙2种。spirit 保留。

撤掉食人魔缩头和圆头发帽，恢复原版较大的额头/下颌/獠牙。魔像恢复原版宽面部与整体眼槽，鱼人恢复短楔形嘴与后掠头冠。猎兽/鹿/龟恢复简洁的额鼻轮廓，蜘蛛恢复紧凑椭圆脸与能看见的眼点，龙恢复楔形眉颌和较清楚的琥珀色眼线。身体、步态、受击和施法结构保留；未增加通用头骨或约束。

头部挂接仍随已有动作坐标，兽类口部保持原释放位置；没有修改投射物/伤害规则。人形长枪姿势另见 `../direction-facing/README.md`。

复现：

```sh
node --import tsx scripts/art-head-review.ts original /tmp/sketch-art-baseline/src/client/art/painted-creatures.ts
# before 必须在 f3f91d8 worktree 中用同一脚本生成，然后放到本目录。
node --import tsx scripts/art-head-review.ts after
node --import tsx scripts/art-creature-review.ts heads-after
node --import tsx scripts/art-creature-gait-review.ts gait docs/art/refactor/followup/head-review
node --import tsx scripts/combat-effects-proof.mjs --fixture scripts/art-creature-world-fixture.ts --out docs/art/refactor/followup/head-review/world-after.json
```

18文件215测试通过，类型检查/构建通过。已检查放大头部、全目录动作表与实战截图。**这是根据反馈恢复原版优点的候选画面，尚未获得用户视觉验收，不宣称整体艺术质量已达标或性能提升。** 本次未进行新的大场面性能优化；之前性能限制仍成立。
