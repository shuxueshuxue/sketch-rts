# 林野战记 · Woodland Atlas

[返回项目介绍](../README.md) · [中文说明](README.zh.md)

Sketch RTS 的第一版美术重制：林野战记 / Woodland Atlas。

整体采用墨绿、黄铜和暖纸色：菜单像一本展开的战争地图册，战场使用稀疏的地形纹理，单位、建筑和资源采用有投影的彩色插画。

## 预览

启动本地服务后，访问 <http://127.0.0.1:5173/>。从「房间 → 创建房间 → 开始比赛」进入对局，点击「锁定鼠标开始玩」后操作。

![新版主菜单](art/woodland-home.png)

[查看原版主菜单](art/original-home.png)

![兵种和建筑图鉴](art/woodland-catalog.png)

![实际对局：采金、建造与训练](art/woodland-match.png)

![战场上的中立野怪营地](art/woodland-camp.png)

[查看建筑放置预览](art/woodland-placement.png)

## 本版内容

- 28 种单位与中立生物：每种单独造型，按初级 / 进阶 / 精英区分装备档次。
- 12 种建筑：有明暗面的屋顶与墙体、旗帜、窗户、石基和功能标识。
- 地形与资源：松林、山脊、遗迹、道路、水道、矿洞与佣兵帐篷。
- 主菜单、房间列表、房间设置、对局 HUD、选中头像、建造按钮、训练队列、提示框与鼠标锁定提示。
- 建筑放置时显示半透明的新建筑模型；施工中的建筑同样使用透明度区分。
- 保留阵营颜色；菜单文案覆盖中文和英文；菜单适配较窄的窗口。

## 兵种分级

单位造型按 catalog 的价格、人口与野怪营地食物分级（[`unit-art.ts`](../src/client/unit-art.ts)，由 `unit-art.test.ts` 对照 catalog 校验）：

| 层级 | 条件 | 造型 |
| --- | --- | --- |
| 初级 | ≤120 金 | 布甲、皮甲，朴素武器，没有金饰 |
| 进阶 | 130–160 金（法师、雇佣兵） | 镶金边长袍、法器、黄铜徽记 |
| 精英 | ≥190 金且 3+ 人口 | 板甲、披风、羽饰、马铠，更大体型 |

只有马厩训练的掠袭者（轻骑小马）与骑士（披甲战马）骑马；长枪兵、余烬劫掠者、余火奔袭者都是步兵。图鉴由 `unit-sheet.html` 直接调用游戏内绘制函数生成：本地运行 vite 后打开 `/unit-sheet.html` 截图即可。

## 实现位置

- [`atlas-art.ts`](../src/client/atlas-art.ts)：Canvas 插画与有上限的图形缓存。缓存分辨率随绘制尺寸调整，供战场、菜单插画和头像共用。
- [`atlas-theme.css`](../src/client/atlas-theme.css)：界面主题与响应式布局。
- [`main.ts`](../src/client/main.ts)：渲染接入、头像、指令图标与建造预览。
- [`game-shell.ts`](../src/client/game-shell.ts)、[`i18n.ts`](../src/client/i18n.ts)：菜单结构与中英文文案。

图形均由项目内的 Canvas 代码绘制，可离线使用。本次未新增包依赖。

## 验证

- `npm run build`：TypeScript 检查与生产构建通过。
- `npx vitest --run src/client`：38 个测试文件、147 项测试通过。
- Chrome 实际操作：创建房间、开局、锁定鼠标、选中农民、右键采金、建造兵营、选中主城、加入农民训练队列，均通过。
- 对全部 28 种单位及 12 种建筑进行 Canvas 像素检查，无空白图形、无完全相同的造型输出。
- 检查了 1440 × 900 的桌面菜单与对局，以及 390 × 844 的窄屏首页。浏览器操作检查无未捕获异常。

当前预览采用本地静态运行模式；本轮浏览器操作验证覆盖单人对电脑的基础流程。

## 在 Windows 重启本地预览

在仓库目录运行以下 PowerShell 命令：

```powershell
npm ci
$env:VITE_SKETCH_RTS_DEPLOYMENT = 'static'
npx vite --host 127.0.0.1 --port 5173
```

这版重点是造型、地形与界面；后续可以在此基础上继续迭代行走、攻击和施法动画。
