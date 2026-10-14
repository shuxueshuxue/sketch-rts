# 首页演出交付记录（待最终性能及归档闭合）

本次首页保留王城、森林战斗、海上船队三个独立入口，统一使用游戏的 `MenuBackdrop → WorldPresentation` 呈现链。各场景是有限、可按时间直接定位的演出：`MenuSceneRun.presentation`、固定演员、预先安排的路线和动作节拍，不执行 `stepGame`、对局 AI 或寻路。不是新的战役系统、城市 AI 或正式海盗夺船规则。

王城复用 `storyFigure` 的身体、动作、装备和服饰绘制，以 scene-local `models`、`painters`、`buildingModels` 表达职业与街区。海战复用真实船体、舰炮挂点、炮口高度、甲板和接舷桥几何，转发 `actions` 及场景绘制；森林复用正式单位与野怪模型、攻击动作、投射物、命中特效和尸体。`MenuBackdrop` 使用演出时钟驱动快照、朝向和动画跟踪，镜头按场景 `frameAt` 组织；无需为背景复制一套游戏渲染器。

演出容器中的位置、伤亡、受损、修补和归属变化只安排首页视觉过程。正式对局的单位目录、伤害、AI 思考相位、船只规则、经济和维护费规则没有因此修改。PR #373 的性能工作与证据须保持独立，不合并上线。

| 场景 | 初始固定规模 | 循环 | 静态参考 |
| --- | --- | --- | --- |
| 王城 `capital` | 24 人，61 件装饰，3 座公共建筑；18 名市民/商贩等、6 名军人 | 90 秒 | 第 15 秒 |
| 海上接舷 `fleet` | 25 个单位，**包括两艘巨大战列舰及 23 名船员**；另有 **16 门舰炮装备**，不计为额外单位 | 60 秒 | 第 38 秒 |
| 森林军阵 `woods` | 18 名军队、22 个野怪，共 40 个初始演员 | 52 秒 | 第 16.7 秒 |

海战船员包括 10 名海盗、10 名守军及 3 名修船工；初始 25 个单位是演出上限，伤亡后活人数量减少，另保留相应甲板尸体。16 门炮是两船的固定侧舷装备，炮击由面向对方的一列舰炮依次开火。森林 18 名军人包含 6 名弓箭手、2 名骑士；22 个野怪包含多种前锋、后备、投掷者和支援者，四个主要大型/首领外形为 `ogreLord`、`spiderQueen`、`graniteGolem`、`ancientStag`，没有新增正式 boss 规则。

## 画面组织及阶段

王城是一条连续的石铺街道，北侧店铺、市集和木梁酒馆，南侧小广场、饮酒桌、长椅及花圃。商人、市民、运货者、酒馆店员与军人使用不同服装和活动路线。店员从实际酒馆门口端托盘往返桌边，商贩与顾客相向交谈，巡逻与运货走分开的通道。镜头在第 2–82 秒缓慢移过市场至酒馆，桌面、酒杯、招牌和职业活动在菜单可读区域组织。手机镜头缩短横移，酒馆始末保持可见。复验截图时点为 **2 / 45 / 80 秒**。

海战按用户给定顺序演出，船体没有整体周期晃动：

1. 第 2.2 和 6.7 秒起，两次依次侧舷炮击；炮口闪光、炮弹轨迹与命中都取自实际挂点及甲板位置，部分守军在对应命中后倒下。代表截图 **2.6 秒**。
2. 第 10–23 秒，农民/修船工敲锤修补破损船体；损伤逐步变成新木板及补丁，船仍漂浮的原因可见。镜头短暂靠近修船区。代表截图 **9 / 13 秒**，分别对照受损和抢修。
3. 第 18–24 秒，两船完成一次有目的的靠拢；24 秒开始铺接舷桥，26 秒桥就绪。代表截图 **25 秒**。
4. 第 28.3 秒起，海盗依次经过实际甲板和桥面登船；第 34–43.5 秒发生甲板近战。代表截图 **32 / 38 秒**。
5. 第 45 秒，目标船归属与旗帜转为海盗，体现夺船结果。代表截图 **47 秒**。

森林将军阵与杂乱野怪进攻分开阅读：第 5.7 秒起弓箭齐射，骑士第 7.5 / 8 秒开始两翼冲锋，多种近战野怪及四个大型/首领外形接近并接触，随后出现明确攻击节拍、投射物、命中和伤亡。尸体及生物/机械命中属性沿用现有表现元数据。代表截图 **6.1 / 13.5 / 16.7 / 31.8 秒**，分别观察开场齐射、冲锋/接触、混战和后续伤亡。演出 43 秒后收束，52 秒淡出循环。

## 已完成的审查与适用检查

已通过真实首页浏览器构图审查：**1440×900、1280×720、390×844**，覆盖上述三个场景的阶段截图。手机首页使用底部紧凑菜单，保持上方活动与战场开放；桌面保持原菜单布局。已检查窗口实时缩放、设置/档案保存、键盘切换场景、Play 地图入口及 Rooms 返回流程；`prefers-reduced-motion` 的固定时点由三场景测试覆盖，浏览器原始记录另含海战静态画面的 stableTick 检查。闭合浏览器记录显示源码未在捕获途中变化，控制台异常和网络失败列表均为空。

实际审查修正过的王城问题包括屋顶卫兵、路人经过花箱，以及地砖后画覆盖桌面。已分别通过街口摆放/路线、花箱间距、固定地砖绘制锚点解决；复验中桌面杯碟与职业形象可辨。没有以共享模型或统一约束强迫作画。

**18 个不同首页测试用例已通过**：王城 4、海战 3、森林 6、通用场景 4、表现历史清理 1。首次组合执行为 17 通过 / 1 个 fixture 失败，修正后重跑通用场景与历史清理 5 个用例全部通过；这是 18 个不同用例的覆盖，不把重复重跑计作新的用例。历史清理测试原先假定初始演出没有投射物，但新的森林静态画面已经含齐射；修正为先清空该测试自己的效果和跟踪历史，再放入指定测试投射物，仍保留“1 条显式投射物、切换后 0 条、流血历史清空”的断言。

王城初始两个 fixture 错误也已保留：`Game.aiPlayers` 并不是状态接口，`players` 还含保留席位；正确检查的是 `activePlayers`。修正后 4 个用例全部通过，演员/HP、items、buildings、variants、tick、props 不变检查，以及 180 秒连续路线、三尺寸慢镜头和真实 128 像素卡片画幅检查均保留。

渲染调整后的相关单测 **75 个通过**：`raster-cache` 10、`painted-card-batches` 58、`atlas-art` 7。这些是已有渲染测试，覆盖相应像素、锚点、密度、缓存与绘制顺序等行为，**不是新增的真实浏览器 RGBA 等值检查**。优化后 `tsc --noEmit`、Vite 生产构建和 server bundle 已通过；构建日志包含循环 chunk 提示，完整原日志保留；未据此宣称已解决打包依赖问题。

## 外部原始证据与尚待闭合的边界

构图基线与最终演出捕获：

- `/workspace/homepage-pirate-baseline-a052/`：原王城与船队三尺寸画面。
- `/workspace/homepage-forest-baseline-a052/`：原森林场景。
- `/workspace/homepage-pirate-visual-iteration1/` 与对应日志：首次工具时间滞后/流程失败，保留，不用作精确时点证明。
- `/workspace/homepage-pirate-visual-iteration2/`、`/workspace/homepage-pirate-visual-iteration3/`：时点确认与 GPU 完成等待后的实际复验；第三轮 `proof.json` 为闭合源哈希及三场演出审查。
- `/workspace/homepage-pirate-visual-final/proof.json` 与 `/workspace/homepage-pirate-visual-final.log`：最终构图与 UI 记录，捕获时 git HEAD 是 `a052` 加未提交源码；演出字节对应 root 后续 `a13878465d7de94311476c7c591b18fc3a39bcc4` checkpoint。

适用测试、类型与构建原日志：

- `/workspace/homepage-root-targeted-tests.log`：18 个不同场景用例首次执行，含原 fixture 失败。
- `/workspace/homepage-root-integration-rerun.log`：修正后 5 个集成用例通过。
- `/workspace/homepage-capital-tests.log`、`/workspace/homepage-capital-tests-iteration2.log`、`/workspace/homepage-capital-tests-iteration3.log`：王城原 fixture 失败及最终 4/4 通过。
- `/workspace/homepage-root-typecheck-final.log`、`/workspace/homepage-production-build.log`：演出集成检查。
- `/workspace/homepage-crop-readback-tests.log`：75 个相关渲染单测通过。
- `/workspace/homepage-crop-readback-typecheck.log`、`/workspace/homepage-crop-readback-production-build.log`：渲染调整后的类型、生产构建及 server bundle。

**当前 `raster-cache.ts` 已在上述最终构图捕获之后调整**：原视觉记录中的 SHA256 为 `c289d22e6aa91c56699e6e5a5c3dbfc4d0e0c3dcadd1c8bc6b9f23392c577705`，当前为 `03c11b66ad3fa6647c7a6f0d456be1068e0be05b14b4d93e583a0a1e74bfeab6`。三场演出模块、菜单核心与样式字节仍与该最终构图捕获一致。不可写成“原阶段图已验证优化后全部源码”；优化后的最终源冻结、浏览器视觉及真实 RGBA 对照需引用新的独立记录。75 个相关单测不能代替尚未完成的真实 RGBA 对照。

性能数值、对照运行与结论：**待 root 根据最终重复/交错对照填写**。现存 `/workspace/homepage-pirate-native-abba/`、`/workspace/homepage-pirate-native-cycles/`、`/workspace/homepage-pirate-focused-profile1/`、`/workspace/homepage-pirate-focused-profile2/` 及对应日志必须保留；本记录不推断收益。新旧首页的内容与规模不同，不能把内容差异直接当作同场景渲染优化的证明，也不把软件 GPU 浏览器的 CPU 提交时间说成 GPU 计时或正式对局 FPS。

最终 evidence manifest、优化后视觉/RGBA记录、演示下载链接及独立提交：**待 root 闭合填写**。不要覆盖原失败或旧构图证据，不自动合并、发布或部署。
