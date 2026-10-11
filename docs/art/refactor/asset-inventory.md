# 美术资产职责盘点与迁移记录

> 这是最初 57 单位阶段的历史盘点。后续授权的单位收敛、死亡装备／甲板事实及最终调用入口以[当前资产覆盖清单](final-asset-inventory.md)为准；下文旧尸体数据限制不代表新创建的尸体仍缺这些事实。

本轮基线：`9819046b3820c9f843f0d57beaa198e7970fd5a7`。计数取现有规则目录和资源目录；不增加单位、不改变武器规则或维护费。以下区分实际代码迁移与审查后保留的独立表达。视觉提升与性能结论应结合本目录的独立实测，不以搬文件作证据。

| 资产域 | 覆盖数量 | 当前真实入口与职责 | 本轮处理 |
| --- | --- | --- | --- |
| 活体单位 | 57 种，包括 7 船与 4 工程单位 | `world-renderer` / `world3d/world-layer` → 统一单位绘制入口；`appearance` 定义体型，`motion` 动作，`rig` 关节挂点，`equipment` 武器，`materials` 笔触材质 | 人形拆分已接世界与 UI；非人形保留适合其身体结构的 painter，统一动作输入。完整覆盖验证由单位迁移测试负责 |
| 尸体 | 57 种对应入口 | `atlas-art.drawAtlasCorpse` → `art/corpses` | 保留低矮折叠剪影，不旋转活体图冒充尸体；默认装备与造型的映射由单位资产迁移负责 |
| 建筑 | 14 规则建筑 | `art/building-models` authored geometry；`world3d/model-library` GLB；`model-portraits` 共用已解码资源 | 保留专用几何表达；建筑/地点类型与资源清单迁至 `art/model-manifest` |
| 中立建筑与固定设施 | 11 site 类型 | citadel、shop、camp、well、statue、beacon、5 种 fort；与建筑共用上述几何 | `SITE_MODELS` 成为类型与加载清单的同一来源，清除原有独立字符串联合重复 |
| 船体 | 7 船型 | GLB Hull、OwnerFlag → `model-library` / `world-layer`；Canvas 由 `canvas-ships` 服务录制/插画入口 | 保留船体、旗、帆专用表达，不强制套人形骨架 |
| 船帆、甲板人员与挂载武器 | 7 船的已有 rig；3 武器种类 | `sail-rig`、`crew-pose`；模拟已有 `ship-equipment.mountedWeaponPose` 只读提供炮位，武器来自 3 个船 GLB 的 Gun 组件 | 不改炮位规则、瞄准或命中；已有 mast clearance/recoil 测试继续执行 |
| GLB 资源总集 | 32：7 船 + 14 建筑 + 11 site | `art/model-manifest.MATCH_MODEL_KEYS` → `model-library` 资源准备、缓存、释放 | 新增目录精确覆盖测试，缺文件、孤立文件和重复条目都会失败；所有建筑/site portrait geometry 检查有限坐标 |
| 投射物 | 7 look：arrow、orb、streak、fire、spear、stone、shell；另有炮口 flash | `art/effect-presentation` 外观选择、发射点、箭轨迹、法球配色；Canvas `canvas-effects`；WebGL `flight-pose` | 从巨型 `effect-renderer` 实际迁出；3D 不再导入 Canvas dispatcher；不使用随机数与墙钟决定命中 |
| 世界特效与命令反馈 | 39 `WorldEffect.type` | `effect-renderer` 保留筛选、屏幕剔除、坐标投影、分派；`canvas-effects` 绘制；`effect-presentation` 计算 charge frame | 实际调用迁移，无旧实现兜底；普通 hit/command 的短图形保留在分派层；warfare 特效与 veteran effect 保持专用模块 |
| 地形标记 | 21 `TerrainLandmark.kind`，其中 13 decor | `atlas-art` 导出 → `art/environment.paintLandmark` | tree、grove/ridge/ruin/road/ditch、所有 decor 完整迁出；geometry 与 atlas 缓存职责分开 |
| 金矿、阻挡物 | 1 矿模型；rocks/gate 2 类型及破损状态 | atlas 缓存 `environment.paintMine`；`paintObstacle` 按方向与血量绘制 | 实际迁移，保留遮挡高度函数、破损裂缝、所有地面阴影 |
| 底纸、地表、水面 | 按地形数据生成，非离散 unit catalog | `atlas-art.drawAtlasGround`；`terrain-art` chunks、`terrain-materials`、`water-art`、`world3d/water` | 审查保留已有地形分块/材质职责；不把连续地形强塞骨架，不改水纹画质 |
| 剧情道具 | 22 `CORE_SCENERY` 键 | `art/scenery` → story prop painter | 保留剧情专用 authored 插画；hut/ruined、burning 等状态不等同规则建筑，不与 GLB 强行合并 |
| 物品世界掉落、商店、装备栏 | 17 `ItemKind` | 全部共用 `art/items.drawPaintedItem`；入口为 `world-renderer`、`equipment-panel`、`main` | 原本已为统一实现，保留；新增全部物品 UI/drop 像素非空与绘制状态恢复测试 |
| 单位/建筑头像 | 57 单位、14 建筑及需要展示的 site | `atlas-art` / `model-portraits` / `portrait-fit`；GLB 头像共享已解码资源 | 单位实际装备由 `unit-appearance` 只读映射并纳入头像缓存键；不另画廉价替代图标 |
| 技能与状态图标 | 29 手绘 SVG | `ability-icons` → `ABILITY_ICON_FILES` | 审查保留。已有 manifest、内容哈希、目录资源、无外链自包含测试；不是动作/武器 painter 重复 |
| 命令字形 | 12 命令键，攻击键共用一个 SVG path | `command-icons.commandIconMarkup` | 保留语义 UI 小图形。命令图标、状态强调色不等同世界武器材质；机械统一会损害可读性 |

## 非人物画面保真证据

执行 `npx tsx scripts/art-domain-parity.ts`，可选第一个参数指定基线 revision。脚本从 Git 临时载入旧环境/效果实现，在同一 `@napi-rs/canvas`、320×320 RGBA 环境对比，结束删除临时模块。

`domain-pixel-parity.json` 记录 94 项：21 地形标记、12 阻挡物朝向/损伤组合、1 金矿、18 投射物种类/寿命组合、42 效果种类/寿命组合。当前全部 changedBytes = 0。该证据说明这些迁移保持已有画面，不代表全游戏视觉验收或浏览器 GPU 性能。

charge painter 去掉复制后 reverse、slice 生成的临时数组，索引遍历保留原绘制次序与数量。这个局部改进尚未单独做统计显著性耗时测试，因此不宣称速度提升。

## 边界与剩余限制

- 尸体状态没有生前装备快照，本轮不为表现扩充模拟/回放结构；可用默认装备，不能宣称忠实保留死前换装。
- Canvas 与 WebGL 原先已有不同的实际投射物几何/透视处理；本轮统一外观判定与数据依赖，不把 Canvas 抛物线直接当作 3D 世界高度，不改变模拟弹道。
- 状态特效的明亮边线用于繁忙战场辨识；它与物品微缩图、人体低饱和材料有不同语义，保留各自配色，不为了抽象统一而改色。
- 本盘点不代替全局集成测试、完整实机截图与性能分布报告；各车道仍需在同一最终提交上联合验收。

## 真实游戏 UI 验证

`node scripts/art-gameplay-proof.mjs` 启动本仓库的 `src/server/index.ts` 开发服务和隔离 Chromium profile，仅访问 127.0.0.1。流程是首页 Play → 选 Pineshade → 房间配置 → 开始权威联网对局；随后通过已有本地 reset API 装入可控场景，真实 minimap/Canvas 指针选兵、右键下移动命令、装备面板点击主手换装。

结果在 `after/gameplay-proof.json` 和其中列出的 8 张 PNG：WS 实际发出了 `move` 与 `wieldItem`；权威 snapshot 的主手为指定 greatSword；脚本进一步等待**客户端**装备面板显示 Greatsword、Attack 22 后才截图。`gameplay-equipment-after.png` 显示盾牌消失、双手持剑，左下单位头像一致；`gameplay-weapon-world.png` 的世界单位也为无盾双手剑。浏览器控制台无错误。固定等待 300 ms 不足以保证无硬件加速的测试浏览器追上服务器，故不得只用权威 snapshot 判断视觉完成。

测试使用原生 DOM click handler 操作菜单/面板，Canvas 用 CDP 指针事件；与已有 e2e 一样隐藏 pointer-lock 邀请遮罩。这些测试工具调整已写入 JSON，不是线上部署或独立渲染 fixture。

此验证发现并修复 `room-schema.ts` 的旧物品白名单仅含 10 类、拒绝合法 greatSword 种子的问题：现在直接使用 `ITEM_DEFS` 判定，6 个 room-schema 测试通过（新增覆盖全部 17 类现有物品及非法名称拒绝）。没有增加物品、改变装备效果或模拟规则。
