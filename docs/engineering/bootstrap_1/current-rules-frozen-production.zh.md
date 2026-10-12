# 规则 2 的冻结生产问题

归档仍为 dba796cfc152379adad9988a1314f94ffc736137，54 个原始文件 SHA-256 经 git show 对照未改变。上游 #329 将 Ember 的 emberAcolyte／pyreCaller 合并为共同 priest／summoner，生产关系改用种族表，规则版本 2。候选与线上源码已迁移，不能直接把旧规则的 1615 个结果当新规则验收。

原始旧模块在当前真实 SDK 中已经复现不可训练命令：v7 的 cinderSpire → pyreCaller、v8 的 cinderSpire → emberAcolyte 都在 0 tick 被明确拒绝。场景只隔离原始经济模块，具备正常已完成生产设施、原始策略阶段、普通初始金币；没有变更归档或用转换器重写命令，不能当对战强度记录。v5 此窗口没有出现非法指令，不能推断它在完整规则 2 对局中均合法。

用户已确认采用规则 2，按最小范围迁移并重新冻结；原非法命令复现保留在本记录中。[已完成迁移的源码差异、哈希与 SDK 证明](./frozen-rules2-migration.zh.md)。

必要的标识迁移是 emberAcolyte → priest、pyreCaller → summoner、emberMend → heal、cinderSoul → summon；生产查询须采用同一套当前规则的种族关系，不能沿用单兵種 trainedAt 字段制造兼容层。任何已确认的新冻结要独立记载源摘要和规则版本，旧原始轨迹永久保留。
