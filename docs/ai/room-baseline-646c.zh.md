# 房间 AI 冻结基线 room-baseline-646c

冻结来源为 `646cf9a0513459d16e6b12007d4945148bb29651`。该提交房间默认 `v9_archer`，另外提供
`v9_summoner`、`v9_knight`；三者都走 `planner-context.ts` 的 bootstrap 分支。它们的实际脚本来自
V9/V7/V8 栈，再由 `bootstrap_1` 替换和插入模块。上下文里的 `version: 'v2'` 不等于只运行裸 V2。

冻结 PR 只封存和验证 planner。满席 FFA 对打、排名/存活/胜局统计及自对打对称性报告见[对打工具说明](room-ab.zh.md)。
线上默认 AI、房间可选版本、sim 规则与校验版本均未改变。

## 产物与边界

仓库内保存构建脚本、固定入口、manifest、Node adapter、测试与证据指针。ESM 和 source map 均不进入 Git。
[manifest](../../src/ai/frozen/room-baseline-646c/manifest.json) 锁定源提交、lockfile、esbuild 版本、构建参数、
逐文件 SHA-256、ESM/source map SHA-256 和长度。入口本身也有哈希。

构建器通过 Git 对象读取固定提交，包含原 `planAiOwnerCommandEntries`，连同 bootstrap、脚本仲裁、老兵技能选择、
memory 初始化、道路复用、executor reasons、SDK selector/intent 和所需 shared helper 一起打包。
为避免重写入口漏掉行为，原 planner-context 的其他分支也可被构建器收集，但公开包装只允许三个原房间流派，
并拒绝 live script overrides。所有 runtime imports 都在产物内闭合，没有到当前 main 策略模块的回调。

`src/ai/frozen/room-baseline.ts` 是 Node/对战 worker 使用的边界：

```ts
const module = await loadRoomBaseline(cacheDirectory);
const planner = module.createRoomPlanner();
const entries = planner.plan(snapshot, {
  playerId: owner, version: 'v9_archer', source: 'internal-ai',
});
const diagnosticMemory = planner.memory(owner); // 独立副本，只用于观测
```

对外基线名是 `room-baseline-646c`，流派仍使用原来的三个名称，不把新基线名或 A/B 标签送入策略。
一次 match 创建一个 planner；不同 match 使用不同的地图对象。memory 由冻结体管理，观测者只能取得副本。

adapter 在加载前校验 ESM 哈希和长度，随后导入已经校验的字节，避免校验后再读路径。缺文件、坏哈希或不兼容接口
直接报错，不切换成 live AI。固定 sourceURL 让运行错误栈可读，不把整个 data URL 打入日志。

冻结体不创建或推进真实世界。它读取当前快照，返回普通 command entries；真实命令准入、交付延迟和 sim 均来自
执行对局的当前 main。旧 helper 的规则/战力估算是冻结预测模型，不会赋予命令越过当前规则的能力。
未来规则改变造成的拒绝应在命令边界显式记录，不通过修改冻结策略来掩盖。快照或命令协议变化需要明确的兼容 adapter。

## 冷构建与恢复缓存

需要包含源提交的 Git 对象和 esbuild **0.28.0**。构建过程不使用工作树里的 AI 源码，不要求工作树切回旧提交。
常规重建必须与已有 manifest 完全一致；`--write-manifest` 仅用于首次封存，不能作为绕过校验的普通重建步骤。

```sh
git fetch --no-tags origin 646cf9a0513459d16e6b12007d4945148bb29651
node --import tsx scripts/build-room-baseline.ts --repo . --cache work/room-baseline-646c/cache
```

输出位置是 `CACHE/<artifact SHA-256>/planner.mjs`，同目录保存 `planner.mjs.map`。
也可从 A100 evidence store 取回经过哈希核对的同一产物：

```sh
mkdir -p work/room-baseline-646c/cache/c230b8f35ef198a86e9e72b2309a1b392e9fa2250a7689f25711fec28f94f581
SKETCH_MACHINES=~/.config/sketch/machines-sound.json bin/sketch evidence get \
  src/ai/frozen/room-baseline-646c/planner.mjs.evidence.json \
  --out work/room-baseline-646c/cache/c230b8f35ef198a86e9e72b2309a1b392e9fa2250a7689f25711fec28f94f581/planner.mjs
```

[ESM 指针](../../src/ai/frozen/room-baseline-646c/planner.mjs.evidence.json) 对应
`/codegeex/jeffry/sketch-rts-evidence/sha256/c230b8f35ef198a86e9e72b2309a1b392e9fa2250a7689f25711fec28f94f581`；
[source map 指针](../../src/ai/frozen/room-baseline-646c/planner.mjs.map.evidence.json) 同样可以用 evidence get 取回。

CI 只获取固定提交的源码对象，检查 manifest、入口哈希、依赖闭包、禁止外部/动态 runtime imports，以及加载失败行为。
CI 不构建或下载 ESM，也不要求本地已经有缓存。

## 逐命令对拍

参考目录必须是原 SHA 的干净 checkout。验证器先检查 HEAD 和源码工作树，随后从这个目录加载参考 AI 和模拟器。
参考 AI 推进世界；冻结 AI 作为影子，接收值相同、彼此隔离的输入，并维护自己的 memory。
两边各保留一个稳定地图对象，与房间 think worker 的地图生命周期一致。每次 think 对未经排序/删字段的 JSON
命令字节及完整 memory 字节作比较；一旦不同，写出快照、请求、两边命令和记忆并失败退出。

```sh
node --import tsx scripts/verify-room-baseline.ts \
  --reference /path/to/clean-646c-checkout \
  --cache work/room-baseline-646c/cache --out work/room-baseline-646c/parity \
  --ticks 6000 --workers 6
```

矩阵是既有七海四陆 11 图 × 三个流派 × 两种族，**每图使用原满席数**，共 66 局，每局 6000 tick，
沿用房间的 15 tick 思考间隔、按席位分相和 3 tick 命令延迟。另读入八份保存的真实中后期帧，保留其原有记忆和流派，
验证岛屿、运输、进攻和防守状态下的命令。这些保存帧是帧级对拍，不冒称又各跑了 6000 tick。

`--case NAME` 可单独复现一项；`--reverse` 倒序提交 case，`--workers` 改变并发数，不改变输入。
各 case 输出 command/memory/final snapshot 摘要，矩阵汇总在 `matrix.json`。重跑必须使用新的输出目录，
并逐项比较摘要，不能只比较命令数量或胜负。

## 执行结果

[验证摘要](room-baseline-646c/validation.json)：A100 / Node 24.22.0，66 个满席配置均到达 6000 tick，
86,400 次 think、33,484 条命令逐字节相同，完整 memory 字节也逐次相同。八份中后期帧另外比较 18 次
think、72 条命令，全部一致。三 worker 倒序复跑相对于六 worker 正序首轮的 73 个共同 case，
command/memory/final snapshot 三项摘要全部一致，包含全部 66 个完整配置。

首轮进程退出 1 的原因是 `defense-worker-32m36.json` 没有保存版本字段，验证器拒绝空跑；66 个完整配置与
另外七份帧已通过，没有命令差异。最终驱动从该帧原来的 `worker-safety.test.ts:31` 明确声明 knight 版本，
完整 74 项退出 0。原驱动、失败记录、最终驱动与两轮日志均保留在原始证据中。

Juma 和 A100 独立构建的 ESM/source map 哈希相同。ESM 1,560,385 字节，source map 3,988,404 字节；
两份 A100 evidence store 对象也已读回核对 SHA。根 `tsc`、工具 `tsc` 与 18 项定向测试（3 文件）退出码均为 0。
本次验证范围为上述对拍、类型检查和定向测试，未运行全量 src 测试。CI 的 plan-trace 检查通过；初次 sizes job 在 checkout 阶段
5 分钟超时，文件检查尚未执行；本地同一大小检查通过，没有新增/修改文件超过 1536 KB。

[原始证据指针](room-baseline-646c/validation-raw.tar.gz.evidence.json) 保存完整 case 摘要、两轮日志、
执行过的驱动、manifest、构建回执和退出码。当前源码/工具接口封存在 `a7df48c0`，后续提交只补验收文档和证据。
