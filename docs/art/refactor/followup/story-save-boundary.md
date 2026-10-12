# 剧情存档规则边界与 checksum 18

2026-10-11，MAIN；本次定向验证 5 文件、37 测试全部通过，原始日志见 [story-save-boundary-tests.log](story-save-boundary-tests.log)。未运行全局 TypeScript 或 AI benchmark。

## 跨规则剧情重演边界

`StorySave` 是 checkpoint 加逐 tick inputs；加载时重新执行剧情脚本和模拟，不是直接恢复最终 snapshot。因此，新存档写入 `rulesVersion: 2`；`Director.load` 在 revive checkpoint、开始剧情及任何输入重演之前检查规则版本。缺失标签按旧规则理解，以及显式 1 或未知版本，都明确拒绝跨规则模拟，即使当前 checksum 算法相同或保存的 checksum 有效。

这是**跨规则重演限制**，不是普通 snapshot 迁移失败。普通游戏存档可以对实体/队列/能力名称及旧数值做已实现的确定性迁移；剧情继续执行输入将产生不同模拟过程，不能借 snapshot 迁移或一致的 checksumVersion 假称规则兼容。普通 replay 已有相同规则检查，本次补齐此前遗漏的剧情入口。RULES_VERSION 仍为未发布的 2。

## 同规则 checksum 格式兼容

新增尸体死亡装备和甲板附着事实使 `CHECKSUM_VERSION` 从 17 升至 18，新记录使用 18。新增字段是 `equipmentCaptured`、`rightItemKind`、`weaponKind`、`leftItemKind`、`ownerRace`、`deck`。

仅当 StorySave 明确带当前 rulesVersion 后，允许以下校验表示：

- 18：完整当前 canonical state。
- 17：复制重演结果的 corpse 记录，只剥离以上六个新增字段，再对其余完整 canonical state 校验；不删除整个 corpses，不修改加载后的实际游戏。
- 2：保留既有同规则兼容语义，在旧校验表示中省略 corpses，其余完整状态仍校验。
- 其他 checksumVersion：明确拒绝；缺失 checksumVersion 按 1 处理并拒绝。

旧 v17 存档若没有规则标签也仍拒绝，不从校验格式猜测规则版本。规则 2 + v17 的测试夹具模拟确实可兼容的同规则旧 hash 表示。

## 证据与覆盖

命令：

```sh
npx vitest run src/story/director.test.ts src/shared/sim/canonical.test.ts src/shared/savegame.test.ts src/shared/unit-save-migration.test.ts src/shared/replay.test.ts
```

- director 11：新存档规则标签；缺失/旧/未知规则在剧情调用前拒绝；正常 checkpoint + inputs 重演；损坏 inputs 拒绝；v2 完整验证及错误 hash 拒绝；规则 2 + v17 的旧尸体表示成功重演，保留新生成死亡事实，并拒绝错误 hash 和篡改原尸体坐标。
- canonical 4：版本 18、新增死亡事实参与当前 hash；v17 仅剥新事实仍验证尸体坐标，且不修改当前游戏；新游戏固定 hash 保持原值。
- savegame 7、unit-save-migration 11、replay 4：既有普通存档迁移、旧 HP 保留和回放规则边界继续通过。

没有跳过完整 checksum、放宽比对、修改 AI/导航行为，或将旧未标记剧情存档伪装为可安全迁移的普通 snapshot。
