# 最终资产覆盖清单（共享单位阶段）

本清单是静态代码与资源盘点，不是全局测试或性能验收结论。第一阶段以 `9819046` 的 57 单位、29 技能/状态 SVG 为基线；此阶段纳入另行授权的共享单位规则变更，最终目录为 **55 单位、27 SVG**。初期目录截图及同规则性能证据不能直接当作这个新规则、新效果阶段的最终测量。

## 目录变化

- `pyreCaller → summoner`，`cinderSoul → summon`。
- `emberAcolyte → priest`，`emberMend → heal`。
- 两个旧单位的战斗定义、卡片与独立技能定义移除；两个冗余技能 SVG 移除。旧名称仅在导入边界及拒绝旧名称的验证中出现，不保留运行时单位别名。
- 采用现有 Grove 数值。两族共用一个 priest、一个 summoner，通过 `RACE_TECH_RULES` 分别由 sanctum / cinderSpire 生产，保持原有 42 人口上限门槛。其金价、训练时间和其他变化见 [单位合并说明](unit-consolidation.md)。这是规则版本 2 的真实玩法变化，不是纯换皮。
- Spark Archer、Ash Hexer、Ash Warden 及其他有战术、伤害类型、技能或体型差异的单位保留。共同规则不妨碍依 owner race 配置装束；队伍识别颜色与种族装束分离。

## 覆盖与真实入口

| 资产域 | 最终覆盖 | 实际入口与职责 | 迁移性质 |
| --- | --- | --- | --- |
| 活体单位目录 | 55，包含 7 船、4 工程单位 | 世界/录制 Canvas 与 `world3d/world-layer`；`painted-units` 组合 `appearance`、`rig`、`motion`、`body-parts`、`equipment`、`materials` | 单位卡片改用同一组合入口，删除重复人体/武器实现；船体及非人形走各自适合的表达，不强制共用人形骨架 |
| 人形与骑乘 | 55 目录中的相应子集 | `appearance` 定义身体、衣装、默认装备；`rig` 解算肢体及挂点；`body-parts` 画部位；`equipment` 画刚性武器；`materials` 管表面与笔触 | 世界、肖像、装备面板使用同一身体/装备组合；实际手持装备只读映射进入外观缓存键，不借换武器改变战斗规则 |
| 原生非人形 | 兽类、蜘蛛、巨人、鱼人、灵体等目录子集 | `painted-creatures` 的原生身体与局部链；共同接收动作和方向输入 | 保留四足、颈部/咬合、嘴部、巨人或鱼人的手臂结构；移除复制人体动作的需要，不把所有动物改成人形 |
| 工程单位 | siegeRam、ballista、catapult、organGun | `warfare-units`、工程专用几何与既有物理发射位置 | 保留车架、炮身及武器交付方式；共享动作事件入口，原生硬点不被人形发射挂点覆盖 |
| 默认尸体入口 | 55 目录覆盖 | `atlas-art.drawAtlasCorpse` → `corpses`；`corpseAppearanceFor` 消费死亡时装备及阵营事实 | 独立低矮折叠轮廓，非旋转活体贴图；缓存键包含角色、变体、阵营衣装及死亡装备；甲板遗体使用独立支撑变换与透明批次 |
| 剧情角色与剧情遗骸 | Ashen March 23 个 authored 角色模型 | `campaigns/ashen-march/models` → `storyFigure/storyCreature`；模型附带 `remains` 与 release 回调 | 实际迁出重复身体绘制，保留角色专有冠饰、胡须、披巾、灯笼等细节；视觉体型、尺寸与遗骸依剧情模型，不误套模拟基类的身体 |
| 规则建筑 | 14 | `building-models` 专用几何、`model-library` GLB、`model-portraits` | 保留建筑专用表达；清单、资源加载与头像资源共享，不套角色骨架 |
| 中立建筑/固定设施 | 11 site | `SITE_MODELS`：citadel、shop、camp、well、statue、beacon 与 5 种 fort | 类型和加载名单统一至 `model-manifest`，不复制字符串类型清单 |
| 船体、帆与甲板 | 7 船型 | GLB Hull/OwnerFlag、`sail-rig`、`crew-pose`、`canvas-ships`；既有船载武器硬点 | 保留船体、旗帆及甲板高度专用表达；乘员使用自己的组合外观与姿态，不修改炮位、瞄准、维护费或命中规则 |
| GLB 资源 | 32＝7 船＋14 建筑＋11 site | `MATCH_MODEL_KEYS` → 解码、缓存、实例、释放 | 单一资源 manifest；没有以新体系名义删除仍需展示的模型 |
| 船载武器 | 3 种装备 | `ship-equipment.mountedWeaponPose` 提供只读炮位；既有 GLB Gun 组件 | 保留舰炮、迫击炮、火焰投射器专用表达；不替换物理武器系统 |
| 投射物 | 7 look，另有炮口 flash | `effect-presentation` 选择外观；`canvas-effects` / `world3d/flight-pose` 分别绘制；`projectile-origins` 锁定释放位置 | 巨型 effects 绘制职责已迁出；新解算挂点接通实际 Canvas/GPU 路径；颜色按单位表现及 owner race，不再依旧召唤师名称 |
| 世界效果/命令反馈 | 原 39 个 `WorldEffect.type`，血迹使用已有 hit 的附加事实 | `effect-renderer` 管筛选、剔除和分派；`canvas-effects`、warfare/veteran 专用模块绘制 | 实际调用路径迁移；小型命令提示和语义状态强调保留专用图形，不为统一材质牺牲可读性 |
| 血迹与特殊移动速度线 | 客户端有界效果记录，不新增单位类型或血迹纹理变体 | `combat-presentation` → Canvas `art/combat-effects` 或 WebGL `combat-ink` | 新增真实调用，命中事实驱动；血滴、附体痕迹、地面/甲板残留与速度线分层；机械单位排除，不能影响伤害或回放决策 |
| 地形标记 | 21，其中 13 decor | atlas 缓存 → `environment.paintLandmark` | 树、林地、山脊、道路、沟壑、遗迹及 decor 实际迁出，绘制与缓存分责 |
| 金矿与阻挡物 | 1 矿模型；rocks/gate 2 类型及破损状态 | `environment.paintMine/paintObstacle` | 实际迁移；保留朝向、破损、阴影和遮挡高度 |
| 底纸、地表、水面 | 连续地形数据 | `terrain-art` 分块、`terrain-materials`、`water-art` / WebGL water | 审查后保留既有专用系统；不是遗漏迁移，不强行作为骨架或角色贴图 |
| 剧情道具 | 22 `CORE_SCENERY` 键 | `art/scenery` → story prop painter | 保留剧情插画及燃烧/破损状态，不误并入规则建筑目录 |
| 物品 | 17 `ItemKind` | `items.drawPaintedItem` → 世界掉落、商店、装备栏 | 已有统一实现保留；实际穿戴/持握状态经 `unit-appearance` 组合，UI 和世界不各画一套武器 |
| 世界人物与 UI 肖像 | 世界覆盖 55 单位及剧情模型；UI 单位肖像覆盖 55 kind，建筑/site 按相应目录；没有独立剧情模型肖像入口 | `atlas-art`、`portrait-fit`、`model-portraits`、命令与队列 portrait | 装备和阵营衣装共用世界定义并进入缓存键；实际训练菜单、队列和选择面板已接通 |
| 技能/状态图标 | 27 手绘 SVG，基线 29 减 2 | `ability-icons` manifest → 技能、状态及命令显示 | 删除 emberMend/cinderSoul 冗余图标；其他技能与状态 SVG 保留语义专用表达，不复制动作 painter |
| 命令字形 | 12 命令键 | `command-icons.commandIconMarkup` | 保留语义 UI 小图形；与世界武器、衣料不是同一职责 |

“目录覆盖”表示已有类型有确定入口，并不声称每个单位都获得相同数量的外观变种，或每个保留的专用资产都被重新绘制。

## 动作、方向与释放挂点

- `UnitAnimationTracker` 用模拟快照事件区分 attack/cast，提供 idle、恢复和确定性的攻击变体；`motion` 有 slash、thrust、bow、staff、work、creature、siege 七类可复用动作。表现选择不调用模拟随机数。
- `action-direction` 使用真实释放/接触方向及可用高度差，映射为 13 个方向样本。上身、手臂与装备改变方向；脚和整个身体不会旋转去指向目标。攻击变体与方向相互独立，恢复末帧回到同一 ready 姿态。
- `releasePoseForEffect` 与 `release-socket` 使用同一 frame-zero 姿态和解算后的手/杖/弓挂点。`ProjectileOriginTracker` 在首次看见事件时锁定外观偏移，后续移动或换装不会拖动已经释放的投射物。
- 剧情 painter 自带 release 回调，因此视觉为兽类而规则基类为人形的角色仍从正确身体位置释放。船与工程单位沿用事件中的原生硬点。Canvas 与 GPU 各按其脚线/高度约定映射，保持原始终点和飞行持续时间。
- 战斗方向扩大活动姿态绘制域，血迹增加透明实例；这些都是应纳入本阶段成本测量的新内容，不能沿用第一阶段的耗时结论。

## 已有证据及边界

1. [共享单位实机报告](units/gameplay/gameplay-proof.json)：普通本地服务器、浏览器房间和实际 WebSocket 训练命令。两族各自菜单与队列生成 canonical priest/summoner；4 次训练正常完成；8 次非法生产请求返回 400；17 张截图、0 浏览器异常。菜单/队列肖像一致，跨族肖像重新绘制。已人工查看世界和选择面板的蓝布/余烬褐布装束。初次地形种子错误及修正见 [单位合并说明](unit-consolidation.md)。
2. [方向动作审查](directional-actions.md)：全装备 attack/cast 方向表、原生动物结构图、恢复动画；包含双手刚性支撑、骨长、朝下武器接地约束和裁切边界的 focused 验证。
3. [战斗效果与挂点验证](combat-presentation-validation.md)：真实模拟驱动的血迹/速度线视频和投射物释放视频；建筑遮挡的正常深度/故意禁用深度对照、甲板残留、沉船清除、机械目标排除；不作为性能报告。
4. [生产与 AI 接口 focused 日志](validation/shared-unit-focused.log)：12 文件、132 测试通过。该范围不是全局回归。
5. [存档/网络验证日志](validation/unit-save-net.log)与[迁移边界](save-rules-migration.md)：规则版本分离、一次性旧存档转换、拒绝跨规则回放与联机混跑。冻结 AI 副本和旧验收阈值未因资产整理而修改。

死亡清理已在掉落前捕获装备、阵营与甲板只读事实；剧情活体、遗骸和首见死亡来源的发射挂点共享其组合。见 [装备实证](final-equipment/README.md)、[甲板遗体实证](followup/deck-remains/README.md)。缺少这些事实的旧尸体不能反推历史装备/甲板；若来源仍存活但在首次观察释放事件前已经换装，现有事件不保存该次释放的完整装备快照，这个边界仍存在。旧效果缺少释放或受击事实时不猜测新效果。血迹预算饱和会淘汰最旧残留，越舷滴落裁掉，读档/回跳清空历史表现残留。与正常单位动作不同，专用船体和地形仍依其原有系统。全量测试、构建、最终提交上的联合视觉审查与独占性能结果由最终验证报告给出；本文不宣称已经全部通过或渲染性能已经提升。
