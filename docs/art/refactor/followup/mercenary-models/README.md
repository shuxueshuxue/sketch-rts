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

这些是 `@napi-rs/canvas` 绘制实际生产代码的视觉表，没有生成图片替代资产。根线程已实际检查三张图，确认独立轮廓、职业可读性与原作风格；仍以用户视觉反馈为最终判断。这里不宣称新的浏览器实战或性能提升。

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

源 SHA 包含新画笔、生产分派、遗骸分派、动作、刚性装备与复现脚本；新画笔冻结 SHA 为 `6d454ce8f7f36fe501185e2f19aef0a230bf6cd89c1dd8f0959a49f1a18b49bb`。浏览器画笔、真实 WebGL 战场与总构建由根线程随后统一验证，旧版全资产证据不能直接覆盖新模型。

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
```

无需旧 worktree 时省略 `--before`，新模型视觉表与 6,912 对缓存身份对照仍可生成。此子任务未提交、合并或部署；根线程负责最终验证与交付。
