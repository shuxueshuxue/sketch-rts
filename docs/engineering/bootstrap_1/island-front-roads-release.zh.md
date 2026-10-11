# 岛矿无治疗前排发布回执

[PR #317](https://github.com/shuxueshuxue/sketch-rts/pull/317) 合并为 `7de2bac7863ce619269a9697299e369d42f0a78d`。实现和证据见 [岛矿前排退路](./island-front-roads.zh.md)，失败原型保留在 [试验记录](./island-front-experiments.zh.md)。

149 项不同相关 SDK 检查通过；12 个新增完整战斗规划场景的父版全部丢失前排，候选全部保住原队。63 个普通状态、167 命令及完整记忆相同；54 个已批准冻结源码哈希未改。历史群岛 12000→15000 tick 在 #316 规则下的同世界比较从 1 损失降为 0；双方完成岛基地、实际配置 5 矿工，毛开采分别 400 和 370，不能称收入提高或正式胜局。

[CPU 38126902524](https://github.com/shuxueshuxue/sketch-rts/actions/runs/38126902524) 首次仅默认 v2 的两个 CPU 上限失败（14.68 秒 / 12 秒，17.32 秒 / 16 秒）；精确未改提交第二次通过。

[部署 38127729538](https://github.com/shuxueshuxue/sketch-rts/actions/runs/38127729538) 首次在同样默认 v2 CPU 步骤中止，未到构建和上传；精确合并提交第二次成功，生产构建、打包、上传、公开端点验证、发布包均通过。production-latest 解引用为上述合并提交，详情见 [机器回执](./island-front-roads-receipt.json)。CPU 预算和全部断言未改，这不是性能优化证据。

新增正式胜局为零，全部地图的单敌与双敌及未见生成地图验收未完成。
