# 治疗音效实查与独立事件

以 main `5a3b1a2a` 的 catalog 和 2026-10-19 线上 war3 完整包为准。
原生带 `heal` 能力的单位只有以下四种；四种的老兵专精也都能选择 `veteranHealingWave`（群体恢复）。
两种治疗能力都会生成带施法者身份的 `heal` 效果，当前被映射到 `spell`。

| 治疗者 | 实际文件 | 录音原名 | 包内 volume | 选择来源 |
| --- | --- | --- | --- | --- |
| 祭司 `priest` | `2c95dfd331f5eebf.ogg` | Human/Heal/HealTarget.wav | 0.60 | `spell.kinds.priest` |
| 战地医师 `fieldMedic` | `8ab28a60b0f2c969.ogg` | Orc/FeralSpirit/FeralSpiritTarget1.wav | 0.65 | `spell.file` 默认 |
| 潮汐祭司 `tidePriest` | `8ab28a60b0f2c969.ogg` | 同上 | 0.65 | 默认 |
| 树皮医者 `barkMender` | `8ab28a60b0f2c969.ogg` | 同上 | 0.65 | 默认 |

群体恢复沿用同一行的文件与音量。默认 effects 设置是 0.7，乘后分别为 0.42 / 0.455，
再经过现有距离、随机变化与混音处理；所有行 pitch 均为 0.025。
线上 extras 的 SHA-256 是 `81e5418e246359c8f17735c2f740c44eae09eb9950e65604bdfbf62003c996b0`。

| 非治疗效果 | 施法者 | 实际文件 / volume | 与治疗的重叠 |
| --- | --- | --- | --- |
| `curse` | 女巫 `witch`、林间女巫 `gladeWitch` | `8ab28a60b0f2c969.ogg` / 0.65 | 与医师等三者完全相同 |
| `stomp` | 花岗岩魔像 `graniteGolem` | 同上 | 同上 |
| `bloodlust` | 食人魔法师 `ogreMage` | 同上 | 同上 |
| `web` | 蛛后 `spiderQueen` | 同上 | 同上 |
| `summon` | 召唤师 `summoner` | `282737251034bf2a.ogg` / 0.60，Human/Resurrect/ResurrectTarget.wav | 共用 `spell` 事件，但录音不同 |
| 老兵战吼 `veteranRally` 产生的 `bloodlust` 效果 | 任意可学习者 | 依施法者取 `spell.kinds` 或默认 | 祭司用 HealTarget；召唤师用 ResurrectTarget；其余默认 FeralSpirit |

召唤师的线上键仍是 `pyreCaller`，由 #518 的共用改名表正常解析。
心灵之火产生 `guardianField`，灰烬诅咒产生 `scorch`，不在该发声分支。
月井和治疗卷轴的 `heal` 视觉缺少 `sourceKind`，目前静音；被动回血不产生这类施法音效。
本次保留这些行为，聚焦治疗单位的普通治疗及群体恢复。

本地相关测试共 105 项通过；把运行时实现换回上述 main 后，四种单位的普通治疗、群体恢复和旧包回退共 12 项回归测试失败。
线上现有包仍以 23 个事件通过校验，本次未改变它的配置。

## 代码行为

- 新增 `heal`，归入 effects 混音组。所有治疗单位的普通治疗和群体恢复均产生 `heal` 提示。
- 配置了 `heal` 的包必须提供一个通用 `file`。播放只用该通用录音，不按单位挑 `heal.kinds`。
- 没有 `heal` 的包只回退一层到 `spell`，并保留旧的单位选择规则。因此代码先合并时不会悄悄更换祭司或医师的音色。
  提示中的 kind 只为这种兼容回退保留。
- summon、curse、stomp、web、bloodlust 继续使用 `spell`；不会改成治疗事件。
- 本代码 PR 不增加任何默认包的 `heal` 配置，不上传或替换音频。

## 候选试听与之后发布

[候选比较页](https://lexicalmathical.com/sketch-rts/audio-packs/heal-review-20261019/index.html)：
A 为当前祭司 HealTarget，B 为现有 ResurrectTarget，均以 0.6 比较；折叠区提供当前医师的默认录音作对照。
这些都是站点已有 Warcraft III 私有包录音（© Blizzard Entertainment），页面只引用已有文件。
试听目录不列入 `served.json`，不改变游戏默认包。

等主人选择后另做素材配置 PR：只增加一个全局 `heal.file` 及适当音量，保留其他事件；
是否同时清理不再负责治疗的 `spell.kinds.priest` 可随素材方案审查。
随后取完整线上包快照，更新副本，通过 `tools/audio/validate-pack.ts`，再按通知使用
`tools/audio/publish-pack.sh` 发布。旧客户端不认识新事件，素材应在本代码部署后再发。

## 浏览器脚本（准备完成，交由审核者运行）

```sh
export SKETCH_MACHINES=~/.config/sketch/machines-sound.json
bin/sketch yatu heal-sound --ref fix/unified-heal-sound --on mac1 --locale zh-CN --json
```

脚本是 `tools/cli/scenes/heal-sound.ts`。它启动一次真实对局，让四种治疗者实际施放治疗，
在真实 Web Audio 中检查开始播放的事件、文件和上下文状态，并确认召唤仍产生 `spell`。
测试只在临时浏览器里装载 CC0 录音支撑的两份测试包：一份无 heal 用于兼容回退，一份含统一 heal。
它不选择候选音色，也不修改线上包；输出 `healing-old` / `healing-shared` 截图和 `heal-sound.json`。
脚本尚未运行浏览器，不能把它当成已完成的浏览器证据。
