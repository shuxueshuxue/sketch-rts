# 最终目录联系表审查

2026-10-11；生成时HEAD `8d6e6dba2a8f588e46b7b64a835eaafcfa60b2ab`，生产src与`7b8186e`完全一致。首次生成与联系表编排修正后重生成均退出0：

```sh
npx tsx scripts/art-catalog-review.ts docs/art/refactor/final-acceptance/catalog
```

`generation.log`记录55单位、14建筑、17物品、1650动画样本。`inventory.json`列出全部kind，`manifest.json`记录生成命令、HEAD、工作区状态、源SHA256以及输出尺寸/字节/SHA256。源哈希在生成结束后立即记录，范围是全部tracked src与生成器/package元数据，属于宽范围可追溯快照，不声称所有源都在此命令执行。

## 生成与实际目视范围

11张原始PNG：55单位、55默认遗骸、55共享单位portrait、14建筑、14建筑portrait、17物品，以及idle/walk/attack/cast/work五种模式各55×6帧，共1650个程序生成的动画样本。所有PNG尺寸及文件均非空。

实际目视检查完整units、corpses、unit-portraits、buildings、building-portraits、items六张表；另以原始像素、完整行裁片检查60帧：

- attack：priest、summoner、knight、redDragon各6帧。
- cast：priest、summoner、tidePriest各6帧。
- walk：worker、horseArcher、venomSpider各6帧。

三个`representative-*.png`仅从生成原图按完整行裁出，不重采样、不重画。其余动画表完整保留，但不宣称1650帧全部逐格人工审查。本次不新增测试，不替代已有绘制边界检查或功能GL证明。

## 观察

- 人形保留克制的青灰布料、金属护具与硬边手绘笔触；牧师浅色礼袍/尖顶冠和召唤师深色兜帽/圆杖头仍可区分。骑乘、四足、鱼人、蜘蛛、巨人和龙的身体轮廓没有被统一成人形。
- 完整单位/遗骸表可见所有55类，遗骸为贴地折叠/残片轮廓；石质单位是碎块，船是船骸，幽灵保持很淡的消散痕迹。默认遗骸表没有模拟死亡时换装事实，不能据此声称所有死亡装备组合已覆盖。
- 代表动作保持刚性杖/枪/工具形状；施法首帧可见另一只手收势与光点，攻击和施法不是只换标签。骑兵与龙的动作幅度较克制。步行样本显示腿部相位变化；此静态6帧表不能证明实时无滑步、命中同步或所有攻击变体/方向切换。
- 建筑全身表14种轮廓、阵营屋顶与标志保持清晰；单位portrait以有意的半身/全身混合取景保留识别部位。
- 道具17类均有显示；三种船载装备在此Canvas道具图中仍共用相近舰炮图形，issuedWeapon与greatSword均为剑形。它们不是本阶段新做的完整独立物品造型，不应将资源入口统一描述成每项都获得独特新图。

## 明确的联系表限制

首版建筑portrait联系表存在**生成器编排裁切**：sheet锚点是中心偏下，而`drawAtlasBuildingPortrait`以(0,0)为左上角绘制100×100；首版与标签重叠，末行底部裁去约16px。父线程授权只修生成器后，新增(-50,-50)平移居中，再运行同一完整脚本。已目视检查修正后的`building-portraits.png`：14建筑完整、标签分离、末行未触及画布边界。首版作为`building-portraits.failed-layout.png`保留，原manifest/log也单独归档。

`manifest.json`的correction保存逐图哈希核对：只有building-portraits.png变化，其余10张原始表及3张代表裁片共13张完全相同；源快照仅scripts/art-catalog-review.ts变化，所有生产src保持不变。该修正属于证据版面，未修改生产portrait函数或资产。

其他已检查表/代表行未见明显跨cell裁断；不是穷举所有方向/换装/体型的边界证明。阴影/船体世界GLB、剧情23角色、全部场景效果、真实换武器与两族衣装、13方向、血迹/速度线、UI交互需引用各自独立证据。这里统一使用默认装备、默认朝向、单一队伍颜色，不能替代它们。

本次修改范围仅生成器一处居中平移及审查资料，未改生产，未新增或运行测试。NAPI/两轮生成进程与裁片/manifest进程均已退出，无后台服务。
