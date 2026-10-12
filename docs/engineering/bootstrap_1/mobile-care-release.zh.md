# PR #343 合并与发布

PR：https://github.com/shuxueshuxue/sketch-rts/pull/343 。精确提交 `1d2a3209f07adabef2c99815ac2f28cecd1a03df` 的 Simulation CPU Check #38270415836 首次成功，核对 head、main 和可合并状态后 squash 为 `a8597397c5ba1d1a0a0aa827e036db602d9066c0`。

Production Deploy #38270922201 首次成功，构建、打包、上传部署、公开游戏端点与 GitHub 生产包五步成功；核对时 `production-latest` 精确指向该合并提交。148 项相关 SDK 检查通过，父版本六项新增全控制器会合场景全部失败。真实失败骑射手的 300 tick 对照两版均两次永久阵亡，不宣称该窗口救下患者。

这一批之后新开一次普通 Pineshade / v9_knight / v8+v8 / Grove / seat 0，正常初始资源，原生 20 Hz、15 tick 思考，规则 2 冻结策略和原生胜负。到 48000 tick 无胜者，61 次我方永久阵亡，checksum `418b3ca0`；此前 PR #336 同一新开局为 26136 tick 败北、76 次阵亡。当前前期零永久阵亡维持到 11714 tick，中期仍发生严重塔区损失，后期经济与指挥停滞。本次是一场观察局，不能当作正式胜局、架构单项因果证明或完整验收。

冻结归档和验收请求不变，1620 格规则 2 官方地图与未见种子验收仍待完成。环境 GH_TOKEN 的草稿需求已保存，但 `has_saved_binding` 仍为 false；托管 GitHub 连接已实际完成推送、API 写入、合并和部署。
