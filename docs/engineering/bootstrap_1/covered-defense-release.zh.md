# bootstrap_1：覆盖防守发布记录

[PR #309](https://github.com/shuxueshuxue/sketch-rts/pull/309) 已合并并部署，特性提交 `2b2cf492e11889a75200b86f81544e183db40401`，main `aa171b8a8a6fb0bf22199b6e6bbcbbec45412450`。

相关检查 175 项通过，生产构建实际退出 0；45 个普通 v5/v6/v7/v8/v9 规划场景 / 145 条命令及完整记忆与 #308 main 相同。冻结源码档案的 54 个哈希再次核实一致。

CPU [38113389395](https://github.com/shuxueshuxue/sketch-rts/actions/runs/38113389395) 首次通过；生产部署 [38113464589](https://github.com/shuxueshuxue/sketch-rts/actions/runs/38113464589) 第 1 次通过。构建、打包、上传部署、公开入口验证、GitHub 发布包五步均成功，`production-latest` 解引用与 main 一致。未改变 CPU 门槛，未重试。

局部对照与限制见 [covered-defense.zh.md](covered-defense.zh.md)。12000–14400 tick 的正常冻结对手观察，旧指挥最终主力全灭、只余一名工人；新指挥保留 15 名主力与六名工人，但更早失去前矿。固定攻击基地的六个新镜像控制场景只证明实际守位与塔开火，不证明伤害改善；其他未取得收益的压力场景原样记录。

没有新增正式胜局。骑射手全镜像无伤、矿线提前转移、全图验收与未见种子仍未完成，bootstrap_1 继续。
