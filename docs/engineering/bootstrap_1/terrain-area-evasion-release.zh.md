# bootstrap_1：地形避让发布记录

[PR #308](https://github.com/shuxueshuxue/sketch-rts/pull/308) 已合并并部署。特性提交 `9306d30c7789556adb51b00fea9597c511601926`，main `2bc5798b1b03d38fb96451cb219ff595c81042c1`。

局部对照与限制见 [terrain-area-evasion.zh.md](terrain-area-evasion.zh.md)：新增八个正常单位炮弹场景从 14–16 伤害降到 0，所有镜像通过；总计 161 项相关检查、生产构建实际退出 0。27 个旧版规划场景 / 79 命令与 70 个普通海军场景 / 10 命令及完整记忆保持相同。冻结档案 `dba796cfc152379adad9988a1314f94ffc736137` 的 54 个哈希再次核实一致。

CPU 检查 [38112329691](https://github.com/shuxueshuxue/sketch-rts/actions/runs/38112329691) 首次通过。生产部署 [38112508592](https://github.com/shuxueshuxue/sketch-rts/actions/runs/38112508592) 第 1 次通过，构建、打包、上传部署、公开入口验证、GitHub 发布包五步均成功。`production-latest` 标签解引用至同一 main SHA。未增加 CPU 门槛或重试。

这是地形行程度量与避让修复，不是新正式胜局。骑射手全镜像无伤压力要求仍未通过，未随本批上线；1620 个正式对局与未见种子验收仍未完成。bootstrap_1 继续。
