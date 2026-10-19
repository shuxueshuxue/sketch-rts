# 多台驱动机器共用 sketch-cli 缓存

修复后，juma → ThinkPad → juma 使用同一个 mac1 root 的 `shot pages` 均成功。没有拆分远端缓存，也没有删除原来的缓存树。

## 原因与修复

mac1 的缓存保存在 `/Users/mac1/work/sketch-cli/trees/<sha>`，以 `.sketch-complete` 表示复制完成。`Machine.copy` 每次扫描这些目录，选择与目标提交差异文件数最少、且少于 2000 个文件的增量基准。基准没有另存为某台驱动机器专属的配置。

目录可能由另一台驱动机器的未推送提交或 `--with-local` 临时提交生成。缓存树已存在，不代表该提交对象也存在于当前驱动机器的 Git 对象库。原版直接逐个执行 `git diff <candidate> <target>`，遇到第一个未知对象就退出。

现在先用本地 `git cat-file -t` 确认候选确实是一个提交，再计算差异。不可用候选会被跳过并打印原因；没有可用增量基准时，明确打印 `falling back to full copy`，沿用原有全量归档路径。已有完整目标树的直接复用、2000 文件阈值、完成标记和构建锁不变。

## 回归测试

`npx vitest run tools/cli`：20 项通过；`npx tsc -p tools/cli/tsconfig.json` 通过。新增 `CLI Check` 工作流在 CLI、入口、依赖或相关配置变化时运行这些检查。

新测试使用两个独立 Git 对象库和真实缓存目录，执行实际的归档、补丁流、锁和完成标记，检查新增、修改、删除的文件及外来文件不泄漏：

- 只有远端外来提交：解释原因后全量复制。
- 外来提交与本地可用提交混合：跳过外来提交，继续增量复制。
- SHA 对应本地 blob：不能将它当成提交基准。
- 目标树已经完整：直接复用。

前三项在 main 的实现上失败，第四项原本通过。[测试输出](tests.log)

## 两台机器交替实跑

基线 `710986b1`；实际执行的修复代码为 `d2ef71f5`。所有运行的远端 root 都是 `/Users/mac1/work/sketch-cli`，端口都是 mac1 `5660–5669`，场景均为 `pages`，桌面尺寸、中文界面。后续提交只增加 CI 和证据；`proof.json` 中记录了所测 `runner.ts` 的 SHA-256。

两台驱动分别创建未推送的 `commit-tree` 提交，树内容相同，提交对象只留在各自驱动的 Git 对象库。juma 使用只取一个提交的临时 Git 对象库，确保首次运行的 20 个既有缓存候选全部在本地缺失；这没有改变 mac1 的共享 root。运行前后均用 `git cat-file` 确认另一台机器的私有提交仍未进入当前对象库。

| 顺序 | 驱动 | before → after | 复制行为 | 退出码 |
| --- | --- | --- | --- | ---: |
| 原版复现 | juma / main CLI | `14df1d7c` → `ef8fc1d3` | `fatal: bad object 001f3bfade...` | 2 |
| 1 | juma / 修复 CLI | `14df1d7c` → `ef8fc1d3` | 20 个候选本地缺失，先全量复制 2817 个文件，再增量复制 | 0 |
| 2 | ThinkPad / 修复 CLI | `e3128738` → `c1a26de0` | 跳过 juma 的两个私有提交，使用本地可用的缓存基准 | 0 |
| 3 | juma / 修复 CLI | `a84f1dc0` → `acef2fbd` | 跳过包括 ThinkPad 私有提交在内的 24 个不可用候选，继续增量复制 | 0 |

三次成功运行都生成一对完整图片，`failures`、`errors`、`unpaired` 均为空。每对图片像素差异为 0，已逐张查看。

ThinkPad 第一次尝试已成功完成缓存复制，但浏览器阶段遇到独立的端口身份冲突（before 的端口回答了 after 的 SHA），退出 2；随后用新的私有提交重跑成功。该首次失败的[日志](thinkpad-first-attempt.log)和[结果](thinkpad-first-attempt.result.json)也保留在这里，没有修改端口机制。

原始证据：[完整运行信息](proof.json)、[main 失败日志](main-failed.log)、[juma 首次日志](juma-first.log)、[ThinkPad 日志](thinkpad.log)、[juma 返回日志](juma-return.log)。各次 `*.result.json` 为 CLI 的原始 JSON 输出。

![juma 首次运行](juma-first.webp)

![ThinkPad 运行](thinkpad.webp)

![juma 返回运行](juma-return.webp)
