# Caster 安全撤退锚点：试验后不合并（2026-10-18）

PR [#519](https://github.com/shuxueshuxue/sketch-rts/pull/519) 关闭，`codex/caster-safe-retreat-anchor` 分支保留。单局不可走锚点是真 bug，两版修复却在正常对局引入大量先手变化，240局收益不支持上线。没有继续调参。

## 快照与范围教训

快照：`v9_summoner` grove 对 v9，`v5-final-1` 的20图抽样，ladder-12，布局 seed `v9_summoner-layout:v5-final-1:ladder-12:1`，tick **11000**。该状态来自此前仅去重分支的诊断，不声称新 main 自然重放也会到达此状态。

[完整快照](../../src/ai/bootstrap_1/test-fixtures/caster-ladder-12-11000.json)和[回归测试](../../src/ai/bootstrap_1/caster-anchor.test.ts)保留在本分支。main `41c9c208` 恢复快照后，summoner-1559 的锚点约 (2259.5,1412.7) 不可走；sim 吸附到另一岸，steering 先向北穿塔再绕回南侧。候选选择 (2480,1360)，检查可走、整条原生道路离开已知塔覆盖，再推进15tick验证实际远离塔。测试 main 失败、两个候选通过。

- `928e3516`：bootstrap 的两个 screen 入口注入锚点生成器，覆盖三个房间 AI；使用 #516 的完整 steering 退路检查，旧点不安全则在附近/回家方向找替代，holdPosition 尊重任务所有权。v8/v9 对手保留旧锚点。
- **范围过宽**：跟进屏障、走进骑士冲锋最小距离以内的前移也被当成撤退。现有 mirrored melee-stand 测试 tick15 的正确前移点 (2277,1495) 被替换成侧退点 (2413,1769)，后排散开；tick112 caster-4 被骑士造成48伤害。这证明不能对所有后排 move 套逃离威胁规则；没有据此断言全部240局回退都来自这一原因，也没有把48伤害直接定性为冲锋伤害。
- `3990a581`：按相对本地敌军方向区分前移和撤退；前移只查可到达，远离敌人/无敌人时回家才查逃离覆盖。四个 melee-stand、13个 loot 测试和快照均通过，240局却仍回退。

## 两版240局

baseline main `41c9c208` 与已测 #516 `d5a81cf4` 的完整 Git tree 相同（`72d47e7073498dac8c2c5322da5b4d2e683f5829`），故复用该 A100 baseline。两个候选分别重跑；种子 `v5-final-1`，20图×两阵营×三个房间AI×两个对手。v8/v9分开各120局，候选48workers，baseline32workers。表为胜/负/平。

| 房间AI | 对手 | main | 928e3516 | 3990a581 |
|---|---|---:|---:|---:|
| archer | v8 | 34/5/1 | 32/8/0 | 27/9/4 |
| archer | v9 | 28/5/7 | 27/5/8 | 25/6/9 |
| summoner | v8 | 31/8/1 | 25/14/1 | 34/5/1 |
| summoner | v9 | 25/13/2 | 24/15/1 | 20/15/5 |
| knight | v8 | 35/3/2 | 37/1/2 | 37/1/2 |
| knight | v9 | 23/8/9 | 22/9/9 | 21/4/15 |
| 合计 | | **176/42/22** | **167/52/21** | **164/40/36** |

928e：W→L24、L→W15、W→D10、D→W10、D→L5、L→D4，共68局翻转、净少9胜。3990：W→L23、L→W17、W→D16、D→W10、D→L2、L→D10，共78局翻转、净少12胜。完整翻转列表、trade@15/@20、stall@60 在[验收数据](caster-safe-retreat-anchor-results.json)。stall 不含 idle 集结等待。

```sh
npx tsx scripts/ai-room-gauntlet-benchmark.ts \
  --subjects v9_archer,v9_summoner,v9_knight --rivals v8 \
  --seeds v5-final-1 --map-count 20 --workers 48 \
  --metrics trade@15,trade@20,stall@60 --out-dir <directory> --label <label>
# 每个候选再单独把 --rivals 换成 v9；逗号 v8,v9 会变成1v2。
```

同机 large-battle-think（A100，CPU affinity190/191，1worker，顺序各一次）：

| commit | 测试主体 | 整次调用 | 结果 |
|---|---:|---:|---|
| main 41c9c208 | 42.912s | 47.81s | pass |
| 928e3516 | 29.322s | 34.75s | pass |
| 3990a581 | 30.490s | 35.41s | pass |

场景包含行为改变后的演化，不能据此声称单次 steering 检查更便宜。

3990 全仓显式列表：672文件通过、2文件失败；7345项通过、1项跳过、2项失败。两处为已有 probe 工具过期断言，baseline 同样复现（当前 scheduler11次而期望3；归档规则期望2而当前4）。高内存 renderer 在A100单跑71项通过，CLI单跑16项通过；tsc、文件大小检查通过。功能测试不能抵消实战回退。

## 决定

不可走锚点与穿塔退路确实存在。第一版还违反已有近战站位约定，收窄后仍减少胜场。保留失败证据，暂停行为修改；接下来只量化安全路线调用、召唤物可兑现战力、沿路塔群损失在240局中的次数和金额，再判断修复价值。

参照 [general 去重与 hold 不合并记录](https://github.com/shuxueshuxue/sketch-rts/blob/codex/general-threat-and-wait/docs/ai/general-threat-and-wait-not-merged.md) 和 [Tower Lane arrival-posts 记录](https://github.com/shuxueshuxue/sketch-rts/blob/96ed40fd862c1a5c3a6249010a08d985ae045da7/docs/naval/arrival-posts-not-merged.md)。
