# bootstrap_1：扩张上限发布记录

[PR #313](https://github.com/shuxueshuxue/sketch-rts/pull/313) 已合并并部署。

- 候选：`a08b97a0a84f9969c537ef09e2a80ba935cba5a2`。
- 合并：`88d33bd68daf9734ac6a1d264bd5661165b70464`。
- CPU 检查：[38120114066](https://github.com/shuxueshuxue/sketch-rts/actions/runs/38120114066)，首次通过。
- 生产部署：[38120202150](https://github.com/shuxueshuxue/sketch-rts/actions/runs/38120202150)，第一次运行成功。
- 生产构建、打包、上传与部署、公开端点核验、GitHub 生产包发布五项关键步骤均成功；`production-latest` 解引用后与合并提交一致。

本批 98 项不同 SDK 检查通过，45 个普通策略状态、145 条命令及完整记忆原样，冻结 54 个文件哈希原样。运行时一行修改，新增正式胜局为零。具体场景与限制见 [验证记录](expansion-target-cap.zh.md)。bootstrap_1 全地图与未见种子验收仍未完成。
