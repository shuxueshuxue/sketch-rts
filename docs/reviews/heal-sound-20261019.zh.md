# 治疗、召唤与召唤物消失音效

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

## 召唤与消失实查

| 行为 | 当前本游戏事件 | 当前文件 / volume | 修改后入口 |
| --- | --- | --- | --- |
| 灵体召唤 | `spell`，按召唤师选录音 | `282737251034bf2a.ogg` / 0.60，ResurrectTarget | `summon`；同一录音 0.36 已获确认 |
| 灵体到期消失或被击杀 | `death` | `2f218ee413d56fc4.ogg` / 0.35，MetalMediumBashFlesh1 | 所有临时召唤物共用 `summonDisappear`；录音待确认 |
| 幽灵狼消失 | 本游戏无此单位，无对应事件和包内音量 | 魔兽素材另查如下 | 不添加单位特例 |

召唤物身份依据模拟已有的 `expiresTick`，不检查 spirit 这个单位名。到期、被击杀、被诅咒消灭都使用相同入口；
永久单位仍用 death，普通船只仍用 shipSink，登船不会被当成消失。
建议消失音量为 0.21，即当前 0.35 的 60%（约 −4.44 dB）；这只是待确认的建议。

## 魔兽原始素材的核对

素材在 `alibaba-public:/opt/sketch-rts/shared/war3-1.27-enUS-sounds/`，同一提取档在
`mac1:/Users/mac1/work/w3all/war3-1.27-enUS-sounds/`。这是 prepare-war3.py 的输入格式。
进一步从 mac1 的原始 War3 / War3x MPQ 只读提取三个模型，输出到本任务自己的审查目录。

- `UI/SoundInfo/AnimSounds.slk`：FeralSpiritDone 和 FeralSpiritTarget **都指向**
  `Abilities/Spells/Orc/FeralSpirit/FeralSpiritTarget1.wav`，源表 volume 均 127/127。
  前者可直接作为“幽灵狼消失”优先候选，现有包文件为 `8ab28a60b0f2c969.ogg`。
- `feralspiritdone.mdx` 与 `feralspirittarget.mdx` 均有 `SNDXAOSF`，
  AnimLookups.slk 将 AOSF 映射到 FeralSpiritTarget；因此这两个特效使用相同录音。
- `Spiritwolf.mdx` 含 `SNDXDDSO`，DDSO 映射到 OrcDissipate，文件为
  `Sound/Units/Orc/OrcDissipate1.wav`，源表 volume 127/127。
  该声音轨在 37333，而当前 Death 区间为 70000–72667，不能仅凭这个事件断言死亡时会播它。
  尚未在魔兽客户端验证实际播放时机，所以作为第二个候选供主人试听。
- HumanDissipate1、NightElfDissipate1、OrcDissipate1 的原始 WAV SHA-256 完全相同：
  `073644b8398dd1cfd25a2bbdfbb228078675a48027df0652c8819e25720d3c2f`。
- Feral Spirit 目录只有 FeralSpiritTarget1；Spiritwolf 目录有 SpiritWolfBirth1、What1–3、
  Yes1–3、YesAttack1–3，共 10 段。没有名为 SpiritWolfDeath 或 FeralSpiritDeath 的录音。
  What / Yes / YesAttack 是单位回应，未作为消失候选。
- 也提取了 Unsummon/CityscapeCrystalShield1、UndeadDissipate2、DispelMagicTarget、Disenchant，
  放在试听页折叠区，与 SpiritWolfBirth1 一起供额外比较。

源表的 127 是魔兽原配置，本游戏的 pack volume 是另一层，不能把它当成现在线上的音量。
本次没有运行魔兽客户端，不声称上述静态检查验证了原版的完整播放行为。

## 代码行为与验证

- `heal`、`summon`、`summonDisappear` 均属于 effects 混音组。
- 普通治疗、群体恢复均走 heal。heal 和 summonDisappear 配置必须提供通用 file，
  播放时不按单位挑 kinds，避免重复配置同一录音。
- 没有新事件的旧包只回退一层：heal / summon → spell，summonDisappear → death。
  回退保留旧包按单位选择录音的规则。
- curse、stomp、web、bloodlust 仍用 spell。包括召唤师或祭司学习战吼时，仍保留其 spell 原配置。
- 本代码 PR 不修改默认包配置，不发布或替换游戏音频。

相关测试 114 项通过；真实模拟测试覆盖全部原生治疗者、两类治疗能力、召唤、到期消失和被击杀的临时单位，
也验证其他临时单位种类共用消失入口，普通死亡、船只沉没和登船保持原有行为。
用 main 的实现替换运行时代码后，21 项回归测试失败（0 通过）；mac1 全量测试结果见 PR。
线上现有完整包仍以 23 个事件通过 readSoundPack 校验。

## 试听与素材发布

[确认试听页](https://lexicalmathical.com/sketch-rts/audio-packs/heal-review-20261019/index.html)
包含已确认的治疗 A（HealTarget / 0.6）、召唤 0.6 → 0.36、消失现状，以及两个优先消散候选的 0.35 / 0.21 对比。
后者的 0.35 是统一的比较参考值，并非本游戏幽灵狼的配置。消失音色和音量仍等待主人确认。
试听文件已烘焙音量，避免移动端忽略 HTML audio.volume；页面不额外乘音量。
全部录音来自主人提供的 Warcraft III 私有素材（© Blizzard Entertainment），不提交音频到仓库。
试听目录不列入 served.json，不改变默认包。

重建试听文件（在 mac1 或 A100 执行，输出目录必须不存在）：

```sh
python3 tools/audio/prepare-war3-support-review.py /path/to/war3-1.27-enUS-sounds \
  /path/to/read-only-live-war3 /path/to/new-review
cp tools/audio/reviews/heal-20261019.html /path/to/new-review/index.html
```

与 prepare-war3.py 相同：loudnorm I=-20:TP=-2:LRA=7，32 kHz 单声道 Vorbis quality 3，
Ogg 文件名为素材路径 SHA-256 的前 16 位。MP3 对比预览另乘明确的包音量。
当前审查输入、录音及 candidates.json 在 A100 `/codegeex/jeffry/sketch-sound-audio/heal/`，
试听副本在服务器 `audio-packs/heal-review-20261019/`。

代码合并、部署且主人确认剩余选择后，素材配置另审：

1. 用 rsync 从线上取**完整** war3 包，保留原副本，另建 staged 副本。
2. 给 staged/extras.json 新增通用 heal（`2c95dfd331f5eebf.ogg`、volume 0.6、pitch 0.025、max 4）
   和 summon（`282737251034bf2a.ogg`、volume 0.36、pitch 0.025、max 4）。
   确认消失录音后，再加入单一 summonDisappear 文件和选定音量；不能新增 spirit 的 kinds 覆盖。
   保留 spell 及其全部 kinds，确保诅咒、践踏、蛛网、嗜血和战吼不变；舰炮、葡萄弹、迫击炮不变。
3. 需要新录音时，将审核通过的 Ogg 及 sources.json 映射加入完整副本。
   所有新事件齐备后应有 26 个事件；若暂不配置消失，则为 25 个。
4. 发布前先通过以下校验；未通过不得上传：

   ```sh
   node --import tsx tools/audio/validate-pack.ts /path/to/staged/war3
   ```

5. 等总指挥合并、通知发布后，备份线上 pack.json / extras.json，再执行：

   ```sh
   RSYNC_RSH="ssh -F $HOME/YellowPage/ssh_config" \
     bash tools/audio/publish-pack.sh /path/to/staged/war3 \
     alibaba-public:/opt/sketch-rts/shared/audio-packs/war3/
   ```

   脚本会再次校验，再先传录音、后传清单。需要 Node、依赖、rsync 和服务器目录写权限（当前为 root）。
   代码发布不会上传私有音频。旧客户端不认识新事件，必须先部署本代码。
6. 总指挥刷新线上游戏、执行浏览器验证，确认配置、无拒收 extras 报错，并验证真实播放。
   需要回退时，通过同一校验和发布流程恢复完整原副本。

## 浏览器脚本（交由审核者运行）

```sh
export SKETCH_MACHINES=~/.config/sketch/machines-sound.json
bin/sketch yatu heal-sound --ref fix/unified-heal-sound --on mac1 --locale zh-CN --json
```

`tools/cli/scenes/heal-sound.ts` 在真实对局中让四种治疗者施放治疗，让召唤师召唤，
再由女巫诅咒消灭临时灵体。在真实 Web Audio 中核对开始播放的事件、文件和上下文，
也确认诅咒仍为 spell。两份临时 CC0 测试包分别验证旧包回退和新事件共享，
不修改线上包，不用测试录音替主人做音色选择。
输出 healing-old / healing-shared、summon-old / summon-shared 截图和 heal-sound.json。
脚本已完成静态检查；本 agent 未执行浏览器，运行结果由总指挥提供。
