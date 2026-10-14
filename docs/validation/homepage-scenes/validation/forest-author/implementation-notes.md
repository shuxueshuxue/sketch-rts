林间血战首页模块

范围：menu-forest-horde.ts + menu-forest-horde.test.ts；未改正式规则 / catalog / core / AI / 导航。
演出 52s，40 个固定角色，7 个时间轴伤亡。主要角色 18 正规军（4盾兵4枪兵6弓手2骑兵1牧师1预备盾兵）对22野怪。野怪种类 wildling、mossGnawer、spiderling、venomSpider、thornSlinger、barkMender、stonebackBrute、rockGolem、ogreWarrior、ogreLord、spiderQueen、graniteGolem、ancientStag。大型体型 4 个。

阶段：1–9s军阵推进；弓手5.4s站稳；5.7 / 8.7s首轮齐射；3–15s怪群抵达；7.5–14.5s两翼骑兵对大型生物；13–43s近战 / 遥击；43s后保持场面，50.6–52s由MenuBackdrop现有fade隐藏重置。
建议真实截图时间：0s全军、6.1s齐射、13.5s刚接触、16.7s双方近战、31.8s伤亡。
手机：场景上部显示全军；真实人物x解析边界决定pan / zoom，900world-units最小span，宽屏主体位于右60%。

验证：6项targeted测试通过。逐帧完整51秒站位、地形、树石间隙、速度连续性、七个fatal / corpse对应、武器range、双方朝向与实际release-frame方向、无随机 seek、移动及静止设备framing。完整逐帧oracle检查身体最小间隙≥2 units，最大单帧位移≤3.05 units。root另负责真实浏览器画面与动画性能，尚未由本子车道独立确认。

修复：怪群投石手推进路径与预备兽交叉，调整纵深/出发时间；弓手站稳后再射；把接触点调整到武器reach内而非只求身体不重叠；靠边树石不侵入骑兵/古鹿路线；framing依据真实解析群体边界避免后排被裁。

测试问题与实现问题区分：初始fixture猜Game.aiPlayers错误，Game只存activePlayers；初始action test误认为cue仍在0.5s观察窗口便应始终attack，但当前攻击只0.3s且无武器生物不会携持weapon direction，因此改为真实release+1tick验证动作方向，身体朝向另测FacingTracker。未改断言门槛来掩盖站位、reach和framing缺陷。
