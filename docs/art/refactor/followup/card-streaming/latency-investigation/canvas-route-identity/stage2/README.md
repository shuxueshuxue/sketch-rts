# Canvas 真实装备配置的绘制身份复用

第二阶段补齐第一阶段的实际范围缺口：`appearanceFor` 的 issuedWeapon、双手剑、圆盾，以及 Ember priest/summoner 配置通常是非空对象，原先仅允许空 presentation 的条件未覆盖它们。现在 Atlas 接受 `unit-appearance` 内部生成并冻结的目录原对象，保留装备、配色和绘制参数的区分。

独立 Chrome 实际入口对照 **1017 组 / 4068 次调用全部通过**。完整原源图 RGBA（含透明 RGB 和 world 阴影）、实际 crop、drawImage 参数及整个最终 Canvas 输出均严格相同。新增的 480 个非空目录配置共享组使实际完整源读取 **1629→1149**；这是有限矩阵的复用计数，不能换算游戏 FPS、帧时间或内存收益。[原始 proof](browser/proof.json)保存逐组结果、计数、来源和退出状态。

## 生产边界

`unit-appearance` 的私有 WeakSet 仅登记原有 DEFAULT、两个 Ember preset 和 PRESENTATIONS 内部构造结果。登记发生在原来的 freeze/缓存创建位置，不改变对象字段、装备读取、衣色、嵌套 Ember 配置或缓存返回值。外部没有登记入口。

Atlas 的 world、portrait 和 figure 使用这些原对象的现有 `unitPaintKey`，并继续保留 `appearanceKey`、密度、原始 domain 和 facing。画笔收到原 pose/team/facing/presentation，未替换为别名的 pose。真实 `world-renderer`、装备面板和单位列表直接传递 `appearanceFor` 原对象，因此该条件覆盖实际装备路径。

非空 clone（包括冻结复制）、非标准 prototype、Proxy、自定义 detail/appearance/motion 等仍走原 raw key。来自另一个模块实例的目录对象也不会获得本模块品牌。没有改变已经证明的 plain-empty 路径；空对象没有自定义绘制输入。campaign `drawAtlasModel` 无论是否收到目录装备对象，均保留原 key 和原参数。

未修改 `unitPaintKey`、World3D、画笔、动作采样、武器挂点、血迹、接触事件或模拟规则。没有新增跨队伍人形配色别名，也没有统一绘画或骨架求解器。

## 覆盖与实际结果

| 分组 | 组数 | 条件 |
| --- | ---: | --- |
| 全部 23 类 figure 的实际 issued 配置，含三类佣兵 | 276 | 三对 idle 0/4、1/3、5/7；density 2/4；facing −1/+1 |
| 全部 23 类 figure 的 carried issued 配置 | 69 | 三对 idle；carry 6、carryAim −4；density 4、facing +1 |
| Ember priest/summoner 原 preset 与 issued | 48 | 三对 idle、两密度、两朝向 |
| 六类代表单位的双手剑、仅持圆盾、合法 issued+圆盾 | 45 | 三对 idle；density 4、facing +1 |
| Ember 双手剑与仅持圆盾 | 12 | priest/summoner；三对 idle |
| 十种实际 issued 武器、各自 motion family | 30 | 含 creature 来源的 club/javelin；三对 carried idle |
| **新增非空配置共享组** | **480** | 原版 2 次源读取，候选 1 次 |

其余 537 组保留已有空配置、creature/siege 回归、实际 portrait/figure 入口，以及装备、衣色、team、朝向、phase、domain、bust、fit、自定义和 opaque 控组。完整分类见 proof 的 totals/categories；没有将 UI 的固定 IDLE 入口描述成动画采样。

| 计数 | d07 第一阶段 | 第二阶段候选 |
| --- | ---: | ---: |
| 完整源读取 | 1629 | 1149 |
| RasterCache misses | 1296 | 816 |
| UI 完整源读取观测 | 333 | 333 |

UI 在本轮没有新增读取收益：原有固定 IDLE 路由已经能重用同一配置。本轮验证其真实 builder 参数、装备/Ember 区分、缓存隔离与输出正确性。FittedPortraitCache 没有 public miss 字段，UI 读数由实际源 getImageData 观测，并核对无淘汰双调用组的 entry delta。

品牌负控包含 plain/frozen/nonenumerable/symbol/prototype/detail/motion/foreign 八种非空配置 × footman issued 与 Ember priest 两类，共 16 个 world 组、32 个 UI 组；另外保留原 17 类自定义 presentation 的 world 和两种 UI 控组。detail 负控能够画出原本不同的姿态像素，仍保持两次真实绘制。换武器、换 Ember 衣色和非等价 phase 的图像仍明显不同，未为了命中率合并。

7 个实际入口测试和全局 `tsc --noEmit` 均 exit 0：[测试日志](validation/focused-tests.log)、[类型检查日志](validation/typecheck.log)。新增测试通过真实拾取/持械命令生成 11 个 kit/owner 组合，检查共享输出、原 pose/presentation 引用与渲染前后 checksum。Chrome fixture 使用只读 snapshot 调用真实 builder，并以实际 canEquip/itemHands/wieldRefusal 预检合法配置；它不执行模拟命令，不将该部分混称为游戏模拟验证。

## 冻结来源与复现

旧 atlas 与旧 unit-appearance 两份快照在 build 前分别与 Git `d07cda2c513ff055831c1995e4710fdada54d613` 对应 blob 完整字节相等。候选是该 HEAD 上的阶段二工作树补丁，proof 记录独立 diff SHA；基础 HEAD 不能误称为已提交候选。

| 执行源 | SHA-256 |
| --- | --- |
| [旧 atlas](browser/before-atlas-art.ts) | `fc821836ce078244f4f118612ff23c647b97fdfd768d0975428a83b0dc154a16` |
| [旧 builder](browser/before-unit-appearance.ts) | `d9a8ae4c9d3cdb87416a73d2748c4fcc83024994ed2ff643f9d038a86e37cdc6` |
| [候选 atlas](browser/candidate-atlas-art.ts) | `fc530e5fef4559cd5874ce43078154c3d0c0ef87058b62a06f82d7d529f43d0d` |
| [候选 builder](browser/candidate-unit-appearance.ts) | `8d12d8a0792fd2b978542c7323e95fdbb93296feb6e59d0e0049cbb5fcc5f8b2` |

[执行 driver](browser/executed-harness.mjs)、[fixture](browser/executed-fixture.js)、[实际 bundle](browser/executed-modules.js)和[metafile](browser/bundle-metafile.json)保留执行原字节。两套 atlas、unit-appearance 和 portrait-fit 分别隔离；每个 Atlas 只能接受自己 builder 生成的品牌对象，参考缓存不能被候选污染。各 provider 从 run-start snapshot 编译，实际依赖、两份旧源、helper 在结束后重新核验 SHA 不变。

Chrome 151.0.7922.173 / V8 15.1.206.23 仅使用 Canvas2D，拒绝 WebGL。errors/loadingFailures 为空，source/dependency/helper 校验与 teardown 全部通过；捕获数组释放、两个 raster/portrait 的声明 ownedCanvasBytes 为 0，浏览器正常退出。这些字段不代表进程 RSS。观察器增加源图和 crop 读取、hash、task yield，本轮没有性能计时。

从仓库根目录复现，输出使用全新目录，且保持已执行候选与依赖字节；第一阶段 [v1 证据](../README.md)与工具未改动：

```sh
node scripts/art-canvas-route-identity-proof-v2.mjs \
  --source /workspace/sketch-rts-viewport \
  --before docs/art/refactor/followup/card-streaming/latency-investigation/canvas-route-identity/stage2/browser/before-atlas-art.ts \
  --before-appearance docs/art/refactor/followup/card-streaming/latency-investigation/canvas-route-identity/stage2/browser/before-unit-appearance.ts \
  --before-commit d07cda2 \
  --out /tmp/new-canvas-route-proof-v2/proof.json
```

这是明确矩阵的像素与缓存身份证明，不验证任意未来自定义画笔、WebGL、拾取、血迹、事件时序或完整游戏性能。内部目录构造字段或画笔变化时应重新核对共享条件；自定义配置保持 raw 身份，作画自由优先于缓存命中。
