# 持械姿态返工

用户反馈：所有单位都变成屈肘架着武器。此前的骨长、握点与覆盖验证不能代替自然姿态审查。

基线：eb8eea6。修改主手 IK 的屈肘侧，保持整个动作及恢复阶段使用同一侧，避免切换时肘部跳跃。单手兵器采用低位携行握点，弓、双手工具、长枪、骑枪、法杖分别保留支撑位置。剑斧及法杖的接触姿势向目标伸展，长剑和棍棒向下攻击额外抬高握点，保留地面净空。部位绘制直接消费已求解的关节，不重复求解。

无模拟、命中时刻、装备规则、AI 或数值变化。这是共用人形持械姿态修正，不是所有生物及全部动作重新设计，也没有新的性能提升结论。

验证：rig / action-direction / projectile-origins / motion 共 35 项通过；npm run build（tsc + Vite）通过，保留现有大 chunk 提示。方向测试覆盖全部 13 武器、13 朝向、固定骨长、握点连接、画布边界、向下武器地面净空及恢复终点。新增低位携行与平向攻击伸展回归。

人工对照 before.png / after.png：8 个代表性兵种 × 待机、行走、上/平/下攻击和恢复；comparison.png 并排保留完整原图。before.png 在修改前用相同脚本生成，不由修改后重新构造。重录 combat-effects-proof.mp4（8 秒实际模拟 + 生产 WorldPresentation），JSON passed=true、GL error=0、errors=[]；查看代表帧 5/12/30。该场景不是所有武器的完整视频验收。

复现：

```sh
npx tsx scripts/art-carry-review.ts after
npx vitest run src/client/art/rig.test.ts src/client/art/action-direction.test.ts src/client/projectile-origins.test.ts src/client/art/motion.test.ts
npm run build
node --import tsx scripts/combat-effects-proof.mjs --out docs/art/refactor/followup/carry-posture/combat-effects-proof.json
```
