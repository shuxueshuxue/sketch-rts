# Sketch RTS

一款手绘风格的浏览器即时战略游戏。建造基地，指挥陆海部队，与朋友或可编程的对手交战。

[在线游玩](https://lexicalmathical.com/sketch-rts/) · [English](../README.md) · [开发指南](development.md)

![遭遇战界面预览](reviews/skirmish-live.jpg)

## 游戏特色

- **两个种族**：各有兵种与科技，还有野怪营地、雇佣兵和装备。
- **陆海作战**：法师、骑兵、攻城武器、舰队与岛屿登陆。
- **单人与多人遭遇战**：可选手工设计的地图，也可按种子生成布局。
- **可编程的对手**：TypeScript SDK、回放和基准测试与游戏共用同一套模拟。

项目持续开发中。界面支持中文和英文；游玩需要电脑、键盘和鼠标。

## 开始游戏

打开[在线游戏](https://lexicalmathical.com/sketch-rts/)，选择地图并创建房间。选好种族和电脑对手，或邀请朋友加入，然后开始比赛。

选中农民，右键金矿采金。按 `B` 打开建造菜单，发展经济并训练部队。指令按钮会显示对应的快捷键。

| 操作 | 作用 |
| --- | --- |
| 左键单击 / 拖动 | 单选 / 框选 |
| 右键 | 移动或与目标交互 |
| `A` 后点击 | 攻击移动 |
| `Shift` + 命令 | 排队执行 |
| `Tab` | 切换当前兵种 |
| 方向键 / 屏幕边缘 / 小地图 | 移动镜头 |
| `Esc` | 取消目标选择或释放鼠标 |

## 本地运行

需要 **Node.js 20.19+ 或 22.12+** 和 npm。

```bash
git clone https://github.com/shuxueshuxue/sketch-rts.git
cd sketch-rts
npm ci
npm run dev
```

打开 [localhost:5173](http://localhost:5173/)。

| 命令 | 用途 |
| --- | --- |
| `npm run dev` | 带房间与 SDK 接口的游戏服务器 |
| `npm run dev:static` | 无需后端的本地浏览器游戏 |
| `npm test -- --run` | 运行测试 |
| `npm run build:production` | 构建客户端与服务器 |

## 文档

- [开发指南（英文）](development.md)：部署、SDK、AI 工具、音效包和录制。
- [物理海战与装备](physical-naval-and-equipment.zh.md)：甲板通行、舷炮射界、部件修理和人物船舱交换。
- [AI 规格（英文）](ai-spec.md)：策略架构与行为。
- [遭遇战修复记录](reviews/skirmish-naval-repair.zh.md)：截图、验证结果与已知边界。

## 致谢

游戏灵感来自魔兽争霸 3，并在 [linux.do](https://linux.do/) 社区开发和讨论。音效来源、字体授权与署名见[素材致谢](credits.md)。
