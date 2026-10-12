# 存档与规则版本边界

当前 RULES_VERSION = 2，未写版本的存档视为 PREVIOUS_RULES_VERSION = 1。CHECKSUM_VERSION = 17 不变，校验算法和游戏内容规则分别版本化。

旧存档仅在导入时转换 pyreCaller → summoner、emberAcolyte → priest、cinderSoul → summon、emberMend → heal。运行 catalog 不保留旧单位行或别名兜底；重新保存写版本 2。当前版本文件里的旧名称、未知版本和未知单位/技能均拒绝。

转换覆盖单位与 cargo、训练队列、尸体、弹道来源与武器种类、世界效果来源、施法及排队命令、冷却与自动施法表、变体 base/abilities、snapshot.map.scenario.addUnits。ID、描述等非语义文本保留。RoomState 本身没有 settings/scenario，保存的场景种子在 snapshot.map 内。

刷新派生上限后生命值采用 min(原 HP, 新 maxHp)，不按比例治疗。队列剩余时间、已付金额、冷却、自动施法开关和已抽取老兵选项保留。缺失 paidGold 的旧召唤师/祭司队列分别补回历史价格 174/130，避免新价格改变退费。变体保留保存的数值，只改 base/abilities 并删除废止的生产来源字段，不重新生成变体或老兵选项。

同时存在旧、新技能键时冷却取较大值，自动施法任一明确关闭即保持关闭。转换不修改输入对象。

回放 trace 与 initialSave 必须都显式属于当前规则，检查先于选择 checkpoint。旧回放不能用新规则重新模拟；当前回放导出帧存档写当前规则版本。

联网 join 携带 rulesVersion，服务端匹配前不接受游戏消息，也不发送 frame/checkpoint。hello/frame/checkpoint/desync 均携带规则版本，客户端应用前验证，不匹配则报错并关闭。缺失网络版本解码为不兼容值 0。

测试：unit-save-migration.test.ts 覆盖语义转换、金额、HP/冷却/老兵选项不重置、输入不变、重复键合并、未知及原型键拒绝、当前版本拒旧名称、跨版本回放 checkpoint 拒绝。room-net.test.ts 与 lockstep-client.test.ts 覆盖联网拒绝。实际执行结果由主线程统一记录，本文不预先宣称通过。

2026-10-11 实测：13 个 focused 文件、122 项测试全部通过，见 validation/unit-save-net.log。首轮唯一失败为训练拒绝信息增加种族后测试旧文本未更新，按新精确错误文本修复后整组重跑通过。类型检查由主线程协调，不在此重复执行。
