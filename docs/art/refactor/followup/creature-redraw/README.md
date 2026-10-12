# 非人形重绘与动作约束修订

本阶段基线为 `c36eed3`。这是用户否定通用肘部解算后的一次实质重绘，不以测试通过代替画面认可。没有改模拟、战斗、经济或 AI。

## 实际迁移

| 独立画法 | 资产 |
| --- | --- |
| 岩块承重、凹入岩缝中的面部 | golem、rubbleGolem、rockGolem、graniteGolem |
| 扭曲树干、根足、枝臂与石背 | stonebackBrute |
| 有机胸腹、埋入肩颈的小头、不同装备 | ogreWarrior、ogreMage、ogreLord |
| 低伏长身、鬃毛和尾巴 | wildling、mossGnawer |
| 细长四肢、长颈与分叉鹿角 | ancientStag |
| 腹部、头胸部、八条分段腿、螯肢 | spiderling、venomSpider、spiderQueen |
| 长尾、翼指与翼膜、颈腹鳞片 | dragonWhelp、redDragon |
| 蹲伏、鳍、鳃、鱼吻与握持工具 | murlocPeon、murlocHunter、tidePriest |
| 龟甲、向侧面张开的腿与探颈咬合 | deepSnapper |
| 半透明流动轮廓 | spirit |

以上 21 项直接替换生产 painter，旧通用 giant/quadruped 绘制和生物 IK 已删除。七个战役生物装饰随迁移：三只狼、两个熔岩巨像、两种树人。狼伤痕绑定新头部位置，树人枝叶跟随实际手部。尸体保留各自表达，补画龙的折翼长尾和龟甲纹理；不旋转活体充当尸体。

`creature-poses.ts` 提供按体型创作的接触与恢复坐标，`creature-painters.ts` 负责各类轮廓、遮挡和材质；只共享笔触与基本作画工具，不要求同一根骨骼或固定肢长。`painted-creatures.ts` 负责原点、缩放、战役装饰和释放点。闲置、移动、攻击和施法有独立输入，动作只消费模拟事件，不更改伤害与命中时刻。

## 撤销的假限制与保留的真约束

- 撤销“枪尖不得低于屏幕脚底线”、因此抬手、因此缩短枪杆的补偿与测试。屏幕坐标不是地面碰撞面。
- 肢体透视、遮挡、轮廓可以按动作创作，不强制二维段长恒定，也不强制所有单位同一肘部弯向。
- 保留真实图像边界约束；把活动作画布从 160 增至 176，鹿、红龙与蛛后的待机也用扩展画布，头像同样保留完整鹿角与长尾。战役生物声明自己的绘制范围。
- 保留握点与工具一致、实际画出的释放点与投射物出发点一致、动作结束回到待机、模拟事件不受表现随机数影响。
- 没有增加武器地面碰撞或任何战斗规则。

## 证据与复现

`*-before.png` / `*-after.png` 是同样单位、坐标、比例与动作采样。它们包括所有资产，但并不证明所有连续过渡已经自然。

```
npx tsx scripts/art-creature-review.ts after
node --import tsx scripts/combat-effects-proof.mjs --fixture scripts/art-creature-world-fixture.ts --out docs/art/refactor/followup/creature-redraw/world-proof.json
npx tsx scripts/art-direction-playback.ts docs/art/refactor/followup/directional-refinement
npx vitest run src/client/art src/client/world3d/painted-card-batches.test.ts src/client/projectile-origins.test.ts
npm run build
```

真实场景使用 21 个生物和配对士兵，发出实际攻击指令，推进 160 模拟 tick，由生产 WorldPresentation 渲染；不是把评审动作硬塞进游戏。JSON 分别记录每个种类观察到的动作、WebGL 错误、浏览器错误、逐帧模拟和渲染耗时及卡片内存。施法全覆盖由静态动作图检查，实战只记录自然发生的施法。

性能数据只用于这次同场景回归；SwiftShader 软件渲染不是玩家硬件 FPS。包含 GL finish 的计时排除截图与 PNG 编码，不能当浏览器完整端到端帧时间。扩大画布有空间代价；没有用减少对象、降低画质或改模拟来制造收益。

## 尚未验收的部分

画风和动作仍需以可下载的前后视频检验，不宣称用户已接受。当前只是 8 秒、42 个初始单位的真实场景；千人场景、长时间稳定性和硬件 GPU 性能不能从这里推出。新细节的首次栅格化代价及更大的方向画布需要单独关注。没有合并、部署或发布 PR。

性能试验：测试过有界 Path2D 轮廓及笔触缓存，并验证 189 个生物画面逐像素相同；同场景渲染均值 56.75 / 55.45 ms，未比直接绘制的 54.48 ms 好，故已删除这层缓存，而不是因“复用”保留它。试验原始 JSON 留存以便追溯。

## 同场景回归结果

同一 Chromium/SwiftShader、1280×860、zoom 1.05、21 个生物与 21 个配对士兵、80 帧。基线与最终轮顺序运行，没有并发测试/构建。一次运行不是硬件性能结论。两轮均无浏览器错误，GL error = 0，每种单位都观察到实际攻击。

| 指标 | c36eed3 | 本轮 | 单位 |
| --- | ---: | ---: | --- |
| 模拟均值 | 1.31 | 1.35 | ms |
| 渲染均值（含 GL finish） | 39.69 | 54.98 | ms |
| 帧均值（模拟、快照、渲染） | 41.00 | 56.33 | ms |
| 帧 p50 | 32.80 | 41.30 | ms |
| 帧 p95 | 82.00 | 121.40 | ms |
| 帧 max | 224.80 | 261.30 | ms |
| 帧 over50ms | 28.00 | 29.00 | 帧/80 |
| 卡片 ownedCpuBytes | 4.35 | 4.84 | MiB |
| 卡片 ownedGpuBytes | 79.42 | 86.85 | MiB |
| 卡片 peakOwnedCpuBytes | 6.41 | 7.21 | MiB |
| 卡片 peakOwnedGpuBytes | 146.08 | 167.52 | MiB |

渲染均值回退约 38.5%，不是性能提升。卡片栅格化工作累计从 2454.1 ms 增到 3670.7 ms；这是继续优化的实测重点。owned/peak 数据是渲染器拥有的存储估计，不是进程 RSS，也不包括所有 JS/驱动内存。录像编码固定 10 fps，不能用视频流畅程度判断实时性能。

验证：16 个测试文件、169 项通过；TypeScript 检查及 Vite 构建通过（保留原有大包提示）。本轮没有重跑整仓已知失败的 AI/nav 用例，也没有改它们的阈值。

交付：`before-after.mp4` 为左右同步实战对照（8 秒）；`../directional-refinement/up-level-down.mp4` 为完整枪长三方向评审（12 秒）。视频均已逐帧抽样检查。Library 上传初始化返回 HTTP 401，没有成功生成新的 Library 下载链接；文件仍完整保存在本仓库。
