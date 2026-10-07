# 连续生态地形与木框草纸界面

入局后小地图被不透明的 DOM 装饰框遮住，空选时命令托盘仍有边框。小地图框现在仅画边缘；空选时整个托盘隐藏，选中单位、商店或营地才显示相应内容。菜单、装备、设置、载入与战场界面共用胡桃木框、草纸底、深色字与木质按钮。材质定义收回 game-materials，移除后加的深色装备皮肤。

## 生成链路

- `environment/noise`：按世界坐标和种子采样的连续分形噪声；采样顺序、渲染分块不改变结果。
- `environment/fields`：岸线、林缘和岩地距离场，加上连续气候变化，得到温度（摄氏度）、海拔（米）、湿度、盐分、肥沃度、林冠与岩性。内陆水体保持淡水，河口盐分从声明的入海口向内衰减。
- `environment/ecology`：声明式容忍区间与适生度乘积。植物和现有野怪营地读取同一环境，营地保留绿色、橙色、红色的难度预算及镜像阵容。
- `map-dressing`：有最小间距的候选点，连续的群落密度和适生度加权选择。起点、矿点、营地等关键位置留出空间；营火、路标、矿痕只跟随实际地点。
- `terrain-materials`：连续混合地表颜色，叠加原创、可平铺的静态草、土、沙与碎石笔触。与小地图共用颜色场，纹理和地形分块缓存，不在模拟步中生成。

沼泽与林地使用连通轮廓，取消逐格圆形底色。高地沿用当地材质并轻微提亮。群岛岸线使用连续扰动，森林和岩块替换周期性正弦斑块；通路、主矿和登陆带仍由布局约束保证。

地图只保存版本、种子和可选入海口（六人图 38 字节、八人图 74 字节），客户端重建环境。停止保存重复的地表字符网格。现阶段是可扩展的生成与美术基础；物种间的争夺、捕食和繁殖后续在生态状态与自动仇恨层接入，避免中立营地在玩家抵达前自行消耗。

## 静态美术参考与后续制作规范

《英雄无敌 3》的静态画面参考落实为几项独立职责：地表材质、地形过渡、对象摆放限制、对象轮廓和深度排序。VCMI 的 terrain 定义提供贴图与过渡规则，object template 分别定义允许地形、可见/通行范围和 zIndex。我们借鉴这套构造方法，使用本项目的材质和模型。

后续树木、岩石与野怪模型按群落成组制作：统一光向和色域，按实际占地留出通路；外围轮廓先区分兵种/野怪家族，亮暗层次再区分材质。对局主体保持比地面更清晰的轮廓，地面纹理密度随环境变化。UI 延续木框与草纸，文字、图标和状态条各自承担信息职责。

研究来源：

- [AutoBiomes: procedural generation of multi-biome landscapes](https://link.springer.com/article/10.1007/s00371-020-01920-7)：连续地形、简化气候与分阶段生成。
- [Ecologically Sound Procedural Generation of Natural Environments](https://research.tudelft.nl/en/publications/ecologically-sound-procedural-generation-of-natural-environments/)：环境与统计生态数据驱动植被分布。
- [Minecraft 官方世界生成说明](https://www.minecraft.net/en-us/article/new-world-generation-java-available-testing)：减少零碎生物群落与不合理温度邻接。
- [VCMI Terrain Format](https://vcmi.eu/modders/Entities_Format/Terrain_Format/) 与 [Map Object Format](https://vcmi.eu/modders/Map_Object_Format/)：贴图、过渡、适用地形、通行范围与绘制顺序。

## 验证

连续性、种子重建、海岸/河口盐分、温度限制、营地生态位、装饰间距和关键位置保护均有测试。原有地图连通、出生安全、营地预算与镜像阵容检查通过。地图基准中有意更新海岸轮廓和营地家族；`bareDuel` 校验值保持不变，生成地图的校验值随生态配置更新。

本地 Canvas 1280×760 地形绘制（包含像素读取以完成栅格化）：六人图首次 116ms、缓存后约 1.1ms；八人图首次 176ms、缓存后约 1.1ms。这是独立地形绘制，不代表完整游戏或 GPU 帧率。云浏览器核验小地图可见、空选托盘隐藏、选中后指令与头像不重叠，以及人物/船舱窗口的材质和尺寸适配。
