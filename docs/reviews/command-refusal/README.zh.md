# 命令拒绝提示：第一期

统一判定在 `src/shared/sim/command-validation.ts` 的 `refusalFor` / `checkCommandLegality`，类型在 `src/shared/command-refusal.ts`。预览、命令卡、整单 admission、混选逐单位执行和到达重验共用这里及其原有规则辅助函数。金币、库存、背包空间等事实取实际判定时的值；前端只格式化，不解析英文错误。

## 四项真实输入对照

mac1，1600×900，中文，真实浏览器鼠标/键盘输入。已逐张查看全部 9 张截图，文字清晰、视角一致，浏览器无异常。GPU 为产物 `yatu-results.json` 中记录的 Apple Metal 设备。

| 场景 | main a389ec26 | 分支 | 截图 |
| --- | --- | --- | --- |
| 床弩右键加固塔 | 仍显示“正在登上防御塔” | 目标悬停及底部说明机械单位不能上塔 | [前](before/tower-refused-desktop.png) / [后](after/tower-refused-desktop.png) |
| 金币 0 时训练 100 金步兵 | 顶部泛提示“金子不足” | 底部和置灰按钮悬停均写“金币不足，还差 100” | [前](before/gold-button-tooltip-desktop.png) / [后](after/gold-button-tooltip-desktop.png) |
| 治疗已进入冷却，再按 H | 只有原有顶部冷却提示 | 底部说明“冷却中，还剩 12 秒” | [前](before/cooldown-refused-desktop.png) / [后](after/cooldown-refused-desktop.png) |
| 满背包右键拾取 | 顶部英文拒绝 | 悬停及底部“背包已满” | [前](before/inventory-refused-desktop.png) / [后](after/inventory-refused-desktop.png) |

复现：`SKETCH_MACHINES=~/.config/sketch/machines-camps.json bin/sketch yatu command-refusal --ref HEAD --ref2 a389ec26 --on mac1 --locale zh-CN --json`。比较侧在截图及四项记录全部完成后，因缺少底部的精确中文原因而失败；分支四项通过。浏览器通过真实设置菜单选择 CC0 音效包并解锁声音；四次拒绝实际触发 4 次错误音，比较侧为 0。静音、关闭音效包和 UI 音量设置继续生效。fixture 用正常生产花掉初始 500 金，不改页面文案，也不注入假提示。上塔机械规则来自 Codex 26 的前置改动。

## 确定性与版本

- 规则 9、校验和表示版本 23。`effects` 参与 canonical，拒绝收据会改变有拒绝/等待事件的校验和；服务器和所有 lockstep 客户端按相同帧、相同数据生成相同收据，不能按观看者决定是否构造。
- admission 与客户端预览仍然只读。服务器 admission 被拒时只回复发令 socket；worker 的竞态拒绝经结构化消息返回。只有已接受命令真正应用时的拒绝写入共享 effects。
- 回执不消耗 nextId，不清除立即被拒单位的原 order/queue。混选合法成员照常执行。等待建造资金、修机器资金、生产出口等保留原任务。
- 等待收据每 tick 由当前阻塞重建，ID 不含 tick/剩余资金等变化值。客户端只在首次看到该等待状态时提示，离开后再进入才重新提示。没有存档外的模拟锁存器；恢复 checkpoint 后逐 tick canonical 一致。
- 旧规则 1–8 存档仍能读取，旧粗分类 effect 也保留。旧客户端和旧规则回放由规则版本边界拒绝，不跨规则做校验和比较。当前规则的剧情存档继续支持 checksum 22 及先前投影。初始状态没有拒绝，fresh-game golden 不变。新增回执只为人类席位构造，以共享 `aiPlayers` 判断，所有 lockstep 端结果一致。AI 原有 `orderEnded`（包括此前已有的上塔拒绝）按原格式保留，不增加 commandType、feedbackStatus 或新回执。历史守卫 AI 录制逐 tick 对照完整 effects，不再过滤新增回执；原 golden 不变。
- 原有 Orange × 保留；waiting 不画失败 ×。提示条和错误音沿用 `command-feedback` 的发令 owner 私有规则，观战/盟友不显示或播放。声音按 owner+原因每秒最多一次，同因单位合并计数。等待不响错误音。

## 边界

第一期包含上塔六码、金币、人口、人口门槛、冷却、库存、背包满/不兼容、目标类型、归属、最小射程、不可达、建筑占地/地形、未完工。船只、甲板、炮位、装备的细码留在第二期，现有拒绝/静默出口先给真实的粗分类提示，不猜更细原因。正常攻击冷却、瞄准、转向、施法后的落空、自动技能不触发、已完成的正常任务不作为错误。矿工等渡船、运输船待航线规划也保留既有等待语义。

完整 src 共执行 716 个文件：7,926 项通过、1 项旧英文断言失败、1 项跳过。将该断言改成检查精确 ownership 后，naval 整文件 21 项复跑全过；原有不可修复、HP 和金币断言保留。加上快照隔离回归，当前覆盖为 7,928 项通过、1 项跳过；这是完整执行加受影响文件复测及新增隔离回归，详见 [验证记录](validation.json)。根 tsc 退出 0；presets 和 large-battle 本轮全过，未放宽性能阈值。

已 rebase 到 main d81b1cba（#567）。与 rebase 前的最终分支相比，`src` 树完全相同；前置新增差异仅为塔的截图文档和截图场景。rebase 后根 tsc 退出 0，拒绝回执、naval、客户端反馈及体态分类四文件 44 项复跑全过。收尾另补拒绝详情的快照隔离：防止读取快照的一方修改嵌套详情时改到模拟。该回归修复前真失败；修复后相关十文件 85 项和根 tsc 全过，存档、canonical、两端确定性和计划链 hash 均通过。模拟中的值不变，截图 UI 代码不变。

随后 rebase 到 main `9e90ebf2`（含 #571）。这次 main 的 `src` 差异只有 `debug-tools.ts` 和 `main.ts` 的菜单入口开关；提示机制的模拟和 UI 逻辑未变。主页的调试录制、结算页的已录制回放均继续调用 `debugToolsEnabled()`。根 tsc 和拒绝回执、客户端反馈、主页场景三文件 29 项通过。mac1 实跑 `debug-menu-hidden`：普通主页隐藏入口，`?debug=1` 显示，`?debug=0` 在同一标签页再次隐藏；两张截图均已查看，浏览器无异常。结算页的条件经源码核对仍为 `lastPlanReplay && debugToolsEnabled()`。未新增开发者入口，未自行合并。


## 合并前复核：混选与 AI 校验和

1. 人类混选兵和工人下达 `holdPosition` 时，admission 接受整单，lockstep 帧应用不抛异常；兵正常 hold，工人保留原 order/queue，并且只产生一条精确回执。AI 规划器经 SDK 的 check/延时交付/frame 路径也部分执行，不抛异常；AI 席位不产生新增回执。工人单独 hold 原本是静默忽略，所以此前三个 fixture 改成 stop 以保留原有空闲语义；混选没有因此变成整单失败。
2. `817a6301` 确实会给 AI 产生新增回执。现由共享 `aiPlayers` 统一限制到人类席位，覆盖下达拒绝、issuer-gone、condition-unmet、waiting 及到达拒绝。AI 原有的 orderEnded 和上塔拒绝按 main 原格式保留。三份历史守卫录制不再剔除 effects，完整 7,203 个状态仍通过。七文件 76 项和另外十一文件 97 项边界测试通过；最终回执文件 14 项复跑及根 tsc 退出 0。新增混选、AI 过时/等待和到达测试已加入 duels CI。
3. 在 A100 用正常开局的 11 图、36 个 AI 席位、每图 18,000 ticks（15 分钟）、thinkInterval=15，分别运行 main `9e90ebf2`、分支 `737b507f`、分支开启 plan trace/死亡账本。最多 6 workers，不统计胜率。每组包含 **198,011 个逐 tick 状态**（含 tick 0），三组原始 checksum JSONL 逐字节相同，使用各自原生 checksumGame，**没有过滤、删除或重投影 effects**。完整 planner/实际交付流、最终 canonical/snapshot/memory 的 SHA-256 也逐项一致。开启观察实际产出 43,200 条 trace；新增 AI 回执始终为 0。运行时代码此后未再改变，只有测试 fixture/断言、CI 和本验证文档更新。

| 地图 | main 累计效果 | 分支累计效果 | 分支开启 trace | 效果同时保留峰值（三者相同） | 新增 AI 回执 |
| --- | ---: | ---: | ---: | ---: | ---: |
| brokenSea | 6538 | 6538 | 6538 | 50 | 0 / 0 / 0 |
| greystonePass | 6033 | 6033 | 6033 | 62 | 0 / 0 / 0 |
| gullIsland | 8588 | 8588 | 8588 | 51 | 0 / 0 / 0 |
| pineshade | 10154 | 10154 | 10154 | 120 | 0 / 0 / 0 |
| reedwater | 10938 | 10938 | 10938 | 71 | 0 / 0 / 0 |
| ringwater | 17098 | 17098 | 17098 | 171 | 0 / 0 / 0 |
| sapphireArchipelago | 7456 | 7456 | 7456 | 51 | 0 / 0 / 0 |
| templeSpring | 19931 | 19931 | 19931 | 98 | 0 / 0 / 0 |
| turtleLake | 27372 | 27372 | 27372 | 151 | 0 / 0 / 0 |
| twoShores | 19198 | 19198 | 19198 | 155 | 0 / 0 / 0 |
| veiledHill | 7478 | 7478 | 7478 | 72 | 0 / 0 / 0 |

累计效果按不同 effect.id 计数，在每次命令后和每步前后采样；包含 main 原有所有视觉效果，三组各 140,784 个。峰值也是三组相同。不是把原有 AI 效果删除以后再比较。

完整逐图流哈希、每臂配置及计数见 [ai-parity.json](ai-parity.json)。A100 原始证据在 `/codegeex/jeffry/sketch-rts-camps/command-refusal-ai-737b507f/evidence.tar.gz`，SHA-256 `d26a9c577a3b94e1f0d2493057c7ab686b6682c9c7271675459d77f504e1d521`。包内包含 33 份逐 tick checksum 文件、逐臂 summary、11 份配置、调度脚本、两份不可变源码压缩包和 SHA256SUMS。已取回 juma，独立逐项核对 116 个成员哈希，并重新逐字节比较全部 11 组三臂序列。

单臂复算：`npx tsx scripts/command-feedback-ai-parity.ts <source-tree> <case.json> <output-dir> <plain|trace> <source-sha>`；配置在包内 cases，源码分别解压 main/candidate 两个压缩包。对照 source-tree 必须固定到所记录的提交，trace 臂同时开启 AiPlanTrace 和死亡账本。旧版红测见 [review-red-test.txt](review-red-test.txt)：在 817a6301 上，三条 AI 回执测试和三份完整 effects 的历史录制均真失败；不是配置或启动错误。

原审计表见 [审计](../command-refusal-audit.zh.md)，词表草案见 [词表](../command-refusal-vocabulary.zh.md)。
