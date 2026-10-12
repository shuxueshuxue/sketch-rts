# 上下戳与反击朝向修复

对照基线：`f3f91d8`，保持同一 Chromium / SwiftShader、视口与模拟初始状态。没有改模拟、伤害、冷却、目标选择或 AI。

## 根因与修正

1. 待命反击只在 action lock 中记录左向，站立状态仍是右向。300ms 动作结束后恢复旧站立朝向，随后再次左向攻击。实际模拟 100 ticks 复现 5 次。
2. 将一次实际释放的朝向写回站立状态。后续明确目标、移动仍能转向，动作期间的锁定照常保留。
3. 长枪的收回距离和角度原来用了同一衰减；下戳下一帧已经接近水平，短伸展变体连接触角度也被削弱。现在先沿攻击方向回收，再回到持枪姿势。三种变体接触与第一回收采样保持同一目标角度。伤害时刻不变。

## 证据

- `world-before.mp4` / `world-after.mp4`：8 组真实待命对战，80 ticks，每 tick 取样，20fps。前 6 组为长枪兵左右各上60°/平戳/下60°；最后2组是向左反击的步兵。
- `world-before.json`：旧版本的3组左向长枪兵各61帧恢复右向，2组左向步兵各55帧恢复右向。检查按设计失败（`passed:false`），不是录制失败；GL错误为0。
- `world-after.json`：相同8组，首次释放后反向帧全部为0，每组均观察到目标方向接触帧，GL错误为0。
- `facing-before-after.mp4`：从这两段实战视频裁出同一对步兵，左右并列放大，便于看反复闪向问题；并非性能画面。
- `up-level-down.mp4`：生产 painter 的12秒慢动作审查，5类兵种、3个方向、3种攻击变体、左右朝向，包含独立施法。为看清姿势而延长接触/待机停留；不是实战或新增前摇。
- 原精简交付包漏放了这段专门的方向演示；本次补齐。

复现：

```sh
node --import tsx scripts/art-direction-playback.ts docs/art/refactor/followup/direction-facing
node --import tsx scripts/combat-effects-proof.mjs --fixture scripts/art-direction-world-fixture.ts --out docs/art/refactor/followup/direction-facing/world-after.json
```

旧版复现：在 `f3f91d8` 独立 worktree 中放入同一 `art-direction-world-fixture.ts` 与当前 runner，运行上述命令、指定 `world-before.json`；预期方向检查失败。

本次相关测试：18文件215测试通过；`npm run build` 类型检查和 Vite 构建通过。覆盖真实模拟反击、待机恢复、新目标转向、左右投影、长枪三变体角度、释放挂点及绘制范围。此修复证明上述场景的左右闪变消失，不等于所有场景的动作表现均已验收。
