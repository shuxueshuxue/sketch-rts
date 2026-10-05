# Painted Frontier：D 方向的代码美术试作

这版使用游戏实际 Canvas 渲染器，素材页和录像都由代码绘制。没有使用概念图作为游戏截图。

## 已接入

- 21 种人形/骑乘单位使用新的手工坐标造型：小头身、分层盔甲、布料、皮革、不同兵器。行走 8 帧，攻击/施法 6 帧，沿用模拟事件驱动的动画状态。
- 人物使用固定椭圆落地阴影。造型与动作缓存进入现有有容量和像素上限的 atlas。
- 建筑用代码定义简单三维面片，再以固定相机投影为二维精灵。屋顶、墙体、门窗、附属构件共享材质和方向光，地面阴影由几何投影生成。不是外部建模软件导出的模型。
- 地面、针叶林、岩壁、矿洞及战场操作栏改成低饱和土色、灰绿、青灰和亚麻色。命令按钮、头像、选中态、小地图边框一起调整。
- 没有改变单位数值、寻路或战斗结算。

## 看效果

- `art/painted-frontier/catalog.png`：实际素材放大图、原尺寸单位及头像。
- `art/painted-frontier/poses.gif`：手写行走、武器回收、施法动作。
- `art/painted-frontier/infantry-clash.gif`：真实模拟和世界渲染器生成的固定战斗测试场景。
- `art/painted-frontier/match.png`：浏览器中实际单人房间，选中农民后的建造操作栏。截图脚本仅使用开发钩子将镜头对准本方单位，没有替换世界或界面渲染。
- `art/painted-frontier/narrow.png`：640px 视口的界面检查。

## 当前局限

这是一版可运行的美术实现，不是最终美术交付。人物放大仍偏几何剪纸；不同阵营的一些兵种共用基础结构；左右朝向仍使用镜像，光照并非完整的世界空间动态光照。特殊怪物、船只、自定义剧情角色及部分场景装饰沿用原图。建筑面片使用近似深度排序，复杂交叠构造还需细化。地形的格子重复感仍可见。首页菜单未整体重做。

## 运行与复现

```bash
npm ci
npm run dev:static
node --import tsx scripts/render-painted-catalog.ts
node --import tsx scripts/render-painted-review.ts
node --import tsx src/recorder/cli.ts --scene infantry-clash --seconds 8 --size 1280x720 --camera 2050,2048,1.35 --out docs/art/painted-frontier/infantry-clash.gif --gif-size 960x540 --fps 20
npm run build:static
npx vitest --run src/client src/recorder scripts/painted-sprite-bounds.test.ts
```

验证：静态构建通过；54 个测试文件、251 项测试通过。新增边界测试遍历新版人物各动作帧与两个朝向，以及所有建筑，检查 atlas 裁切；发现并修复了骑士长枪回收帧越界。构建仍有既有的 JavaScript 大包警告。
