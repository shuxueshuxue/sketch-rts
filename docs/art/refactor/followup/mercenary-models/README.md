# 三类雇佣单位的独立模型

当前实际雇佣目录、固定地图营地与生成地图营地只供应 `mercenary`、`contractArcher`、`fieldMedic` 三类：见 `src/shared/catalog.ts` 的 `MERCENARY_UNIT_KINDS`、`src/shared/types.ts` 的 `MercenaryUnitKind`、`src/shared/map.ts` 与 `src/shared/generated-map.ts`。原美术仅将三者映射为普通 `sword + armor`、`bow`、`priest`，分别与普通剑士、弓手、牧师重复造型。

`src/client/art/painted-mercenaries.ts` 现在分别作者绘制头、躯干、衣甲、腿部与装备携带细节，`painted-units.ts` 在普通兵绘制前真实分派到这些模型。原 `figures` 三项继续表达动作与武器兼容关系，不再决定通用头身外观。没有将新模型作为普通兵的涂色覆盖层，也没有修改招募、经济、单位属性、技能、伤害、命中时间、AI 或维护费规则。

| 单位 | 独立形体、衣甲与细节 |
| --- | --- |
| 雇佣兵 | 开脸旧铁战盔、短须、分块缀片皮甲、非对称肩披、战裙、缚带护胫与带斜纹的战团盾。 |
| 契约弓手 | 低沿毡帽、卷边肩披、分片长皮衣、箭筒与腰袋、绑腿；避免普通弓手的尖兜帽外形。 |
| 战地医师 | 系带亚麻头巾、短工作袍、皮围裙、急救包与带塞药瓶、露出的绑腿；避免普通牧师的高帽与长宗教袍。 |

保留当前手绘材质、暖光冷影、小头身比例。没有新通用骨架、自动求肘位置或限制长枪碰地。三个作者模型使用现有采样手腕、肘、预备攻击、回收与方向动作，刚性武器沿同一握点绘制，投射物释放和武器血迹仍读取相同坐标。独立衣甲不会挪动握点或改变命中事件。换装长剑、长枪、弓、法杖或圆盾通过现有表现合同与真实装备状态生效，不是新战斗规则。

## 画面

- [lineup.png](lineup.png)：相同配色与闲置姿态下的旧版/新版造型、游戏尺寸、真实头像、双手剑与圆盾表现。旧版实际 painter 来自 `2a0d3a2` worktree，路径、Git head 与源 SHA 在 `catalog.json` 中保存。
- [actions.png](actions.png)：三类实际生产模型的 idle、walk、上/平/下 60°攻击源、施法、上/下预备攻击、左朝向，以及换成长枪后的上戳/下戳。静态接触样本不冒充实战帧；长枪列是表现系统能力示例。
- [remains.png](remains.png)：对应头盔/毡帽/头巾、皮甲/长衣/急救袋的低卧遗骸；保留死亡时捕获的武器和圆盾。

这些是 `@napi-rs/canvas` 绘制实际生产代码的视觉表，没有生成图片替代资产。根线程已实际检查三张图，确认独立轮廓、职业可读性与原作风格；仍以用户视觉反馈为最终判断。真实浏览器运行另见下面的集成验证；本次独立模型不宣称性能提升。

## 调用覆盖

WebGL 世界单位在 `world3d/world-layer.ts` 调用 `paintFigure`。Canvas 世界与录制器经 `atlas-art.ts` 调用同一入口。`main.ts` 的选择头像、分组、队列与乘员，`equipment-panel.ts` 的乘员头像、装备头像和全身图分别经 `drawAtlasUnitPortrait` / `drawAtlasUnitFigure` 汇入同一实际模型。

遗骸在 `corpses.ts` 的 `fallenPerson` 分派到独立雇佣兵遗骸。主地面、Canvas 世界、WebGL 世界与甲板遗骸最终经 `drawAtlasCorpse` 进入此处；死亡时捕获的装备继续由 `corpseAppearanceFor` 供给，遗落武器使用原 `corpses.ts` 武器画笔。三类的命令图标仍使用已有不同职业标记；没有用新头像作为唯一“迁移”。

## 验证

`focused-tests.log`：5 文件 / 27 测试通过。其中新模型 11 项验证覆盖所有真实雇佣类型与普通兵不再同形、idle/步态/攻击变体/施法/方向预备的可见变化、装备长枪在上/下及回收各帧的实际像素挂点、医师施法挂点、武器血迹端点、战场/头像/全身入口，以及普通装备命令和真实死亡记录中的独立服装、捕获装备与模拟校验和不被作画修改。另运行现有死亡装备、释放挂点、武器表面与表现集成测试。

现有缓存共享 idle `0/4`、`1/3`、`5/7` 帧需要针对新画笔重新证明，不能沿用旧模型结果。本次完整 RGBA 对照保存于 `catalog.json` 与 `catalog-run.log`：

- 3 类 × 6 套装备（默认、双手剑、圆盾、长枪、弓、法杖）。
- 未持方向与强度 1/3/6 的持械状态；持械方向 -6/-4/0/4/6。
- 3 对 idle 相位 × 原图密度 2/4 × 左右朝向 × 两队配色。
- **6,912 对 / 2,078,023,680 像素；所有 RGBA 通道差异为 0**，包括透明像素中的 RGB。保留原 pose 输入，没有改变动画时间线或为了共享缓存限制新作画。

源 SHA 包含新画笔、生产分派、遗骸分派、动作、刚性装备与复现脚本；新画笔冻结 SHA 为 `6d454ce8f7f36fe501185e2f19aef0a230bf6cd89c1dd8f0959a49f1a18b49bb`。根线程已提交实现到 **`e02b24ef8de3c96cec111a1178a7daf697fc8378`**，没有合并或部署。

根线程在这个冻结版本完成 [124 文件 / 952 测试](../card-streaming/validation/client-e02.log) 与 [TypeScript、客户端和服务端生产构建](../card-streaming/validation/build-e02.log)。[新的 Chromium Canvas2D 验证](../card-streaming/idle-identity/browser-current-merc/README.md) 保留原 44 资产矩阵并添加三套新佣兵与装备组合，合计 **8,640 对 / 2,455,695,360 像素，RGBA 差异为 0**；旧 7,776 对浏览器证据保留原始来源，没有重贴成覆盖新模型。

## 真实招募与 WebGL 集成

[gameplay/gameplay.mp4](gameplay/gameplay.mp4) 为 **1440×1000、40 帧、6 秒**的实际生产 WebGL 捕获。原始 `frame-000.png` 至 `frame-039.png` 的全部编码字节保存在[精确 PNG 归档](../png-archives/README.md)，选定关键帧可直接浏览；40 帧均以 SHA-256 重新核对。MP4 为便于播放的 H.264 版本，PNG 才是未损失的原始图像。已实际检查招募、攻击、医师施法、持械移动与死亡后的关键帧。

- [真实招募后的首帧](gameplay/frame-000.png)：`createGame('bareDuel',{aiPlayers:[]})` 加入三座实际类别营地与两座普通农场，友军信使到场，通过原 `hire` 命令买入三类单位。初始钱包仅作为 fixture 设置为 1,000；原价格分别 160 / 145 / 155，招募后余额 540，库存分别 5→4 / 3→2 / 3→2，冷却 180 / 320 / 360 ticks，招募人口每次增加 2，实际人口上限为 20。字幕的 540 明确是**招募完成时的初始余额**，并不冒充后续维护费扣除后的当前金币。
- [原生攻击](gameplay/frame-020.png)：三种真实模型都观察到自己的攻击释放。雇佣剑士向上、契约弓手向下、医师向上，源方向为对应真实目标；没有强制播放攻击动画或修改攻击属性。战地医师在 [第 19 帧](gameplay/frame-019.png) 施放真实 heal，病友从 30 恢复到 85 HP，动作与攻击分开。
- [持械移动与 idle 预备](gameplay/frame-030.png)：真实攻击后，剑士向左后撤，仍面向原上方攻击方向，弓手与医师保留自己的 idle 预备方向。离线对照实际释放向量与原始记录中的 44 个攻击/施法/持械方向样本，朝向和瞄准桶不匹配为 0。
- [真实遗骸](gameplay/frame-035.png)：后段明确使用三次脚本 `strikeUnit` 真实强力伤害，经过原伤害、死亡与装备捕获逻辑生成三份对应 `kind` 遗骸；没有捏造尸体对象。此处不将三次受控致命伤害称为普通单位原生伤害。图下方的头像、全身图与遗骸使用生产 Canvas 入口，并且每类头像均非空、与旧普通兵头像不同。

[gameplay/proof.json](gameplay/proof.json) 保存三笔真实交易、全部采样姿态、真实释放事件、命令、死亡记录、每帧模拟快照 SHA、完整客户端源 SHA、浏览器与渲染器版本。9 次实际像素遮罩拾取均返回对应雇佣单位 ID；40 次绘制前后模拟校验和未改变；WebGL 错误 0，浏览器控制台错误和异常 0，没有降级为 Canvas 世界。生产来源是 `e02b24e`，`src/shared` / `src/ai` / `src/server` 的工作树 diff 为空，其树身份保存在报告中。`analysis.json` 另存原始 PNG 哈希与实际释放向量的离线方向核对。

每个捕获之间正常推进三个真实 tick，死亡阶段另有三个处理 tick，模拟最终为 tick 123。图像不是 Node 录制器的 2D 世界；原 GPU 缓冲以 `preserveDrawingBuffer=true` 做捕获，世界使用生产 `WorldPresentation`。运行环境是 Chromium 151、ANGLE / Vulkan SwiftShader 软件 GPU；这是集成和画面证据，不是硬件帧率或新模型性能收益。

## 最终渲染版本补验

最终渲染实现冻结为 **`0de509cc01e47b91a3012d33d2e75a7106d3e4a5`**。这个版本默认使用单组卡片页、原生隐式 mip 采样，并按当前可见画面的唯一源需求决定新页容量；独立模型和作画代码没有改变。根线程在该版本完成 [124 文件 / 956 测试](../card-streaming/validation/client-final.log) 与 [TypeScript 和完整生产构建](../card-streaming/validation/build-final.log)。这里保留 e02 的原证据及原始测试日志，未把它们重新标成最终实现。

用**字节不变的原 fixture 与捕获 harness**重跑真实招募、攻击、治疗、持械及死亡场景，新证据位于 [gameplay-final/proof.json](gameplay-final/proof.json)，新 [6 秒演示](gameplay-final/gameplay.mp4) 与 40 张原始 PNG 的精确归档另行保留。新旧 fixture SHA 均为 `da86cda593c1dd5df2d166cbe19e4d0a17f1e43c5c0100577cfb318c64390ad5`，harness SHA 均为 `338cb0be6792277934f510a6425a29f09c0b6e0afbf34007d8a10955ce78ecb8`。

[严格对照](gameplay-final/comparison.json) 解码所有 40 对 **1440×1000 原图，完整比较 57,600,000 像素的全部 RGBA 通道**，没有裁剪、缩放或允许差异：变化像素 0、变化通道 0、最大差异 0；40 对 PNG 编码文件也逐字节相同。每帧模拟快照 SHA、初始招募快照、三笔交易、命令、真实释放、所有采样姿态、9 次拾取与 3 份实际死亡记录均逐字段相同。

两个版本的 32 个非测试作画模块源 SHA 与 `shared` / `ai` / `server` 树身份全部相同；e02 的 8,640 对 Chromium 作画验证因此仍覆盖相同画笔，而最终 GPU 路径由本次实际重跑验证。最终 44 个攻击/施法/持械方向样本继续无不匹配，9 次拾取均正确，40 次绘制未改模拟，WebGL 错误与浏览器错误均为 0。此前根线程与该车道实际检查的招募、攻击/治疗、预备持械和遗骸关键帧，与本次原图也完全一致。这里不把“逐像素不变”当作性能收益，性能结果由渲染主报告独立实测。

## 复现

给 `2a0d3a2` 的独立 worktree 链接同版本 `node_modules` 后，在当前工作树执行：

```sh
node --import tsx scripts/art-mercenary-catalog.ts \
  --before /tmp/sketch-mip-residency-baseline/src/client/art/painted-units.ts \
  --out docs/art/refactor/followup/mercenary-models \
  > docs/art/refactor/followup/mercenary-models/catalog-run.log

npx vitest run \
  src/client/art/painted-mercenaries.test.ts \
  src/client/art/death-equipment.test.ts \
  src/client/art/release-socket.test.ts \
  src/client/art/weapon-surface.test.ts \
  src/client/appearance-integration.test.ts \
  --maxWorkers=1 --minWorkers=1 \
  > docs/art/refactor/followup/mercenary-models/focused-tests.log

node --import tsx scripts/art-mercenary-gameplay-proof.mjs \
  --source /workspace/sketch-rts-viewport \
  --out docs/art/refactor/followup/mercenary-models/gameplay/proof.json \
  > docs/art/refactor/followup/mercenary-models/gameplay-run.log

# 指向 0de509c 的冻结 worktree，保留 e02 原目录：
node --import tsx scripts/art-mercenary-gameplay-proof.mjs \
  --source /workspace/sketch-rts-viewport \
  --out docs/art/refactor/followup/mercenary-models/gameplay-final/proof.json \
  > docs/art/refactor/followup/mercenary-models/gameplay-final-run.log

node scripts/art-mercenary-gameplay-compare.mjs \
  --before docs/art/refactor/followup/mercenary-models/gameplay/proof.json \
  --after docs/art/refactor/followup/mercenary-models/gameplay-final/proof.json \
  --out docs/art/refactor/followup/mercenary-models/gameplay-final/comparison.json \
  > docs/art/refactor/followup/mercenary-models/gameplay-final-comparison.log
```

无需旧 worktree 时省略 `--before`，新模型视觉表与 6,912 对缓存身份对照仍可生成。真实集成脚本支持 `--source` 指向冻结版本；报告保留原始脚本 SHA，两个 gameplay 目录的 `harness.mjs` / `original-fixture.ts` 为执行源存档，`fixture.ts` 为带实际绝对导入的执行版本，最终目录另保留 `comparator.mjs`。根线程负责最终交付，没有合并或部署。
