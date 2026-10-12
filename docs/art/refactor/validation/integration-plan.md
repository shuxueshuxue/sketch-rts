# 整合验收安排

工作树：`/workspace/sketch-rts-units`。须等主线程释放性能独占窗口并明确启动；不能与正式采样并发。以下命令尚未因本安排执行。

全套测试（不排除已知失败、不改测试标准）：

```bash
set -o pipefail
npx vitest run --reporter=default --reporter=json --outputFile=docs/art/refactor/validation/unit-integration-tests.json 2>&1 | tee docs/art/refactor/validation/unit-integration-tests.log
```

生产构建（含 TypeScript、Vite 浏览器包及服务端 bundle；本地构建不发布）：

```bash
set -o pipefail
npm run build:production 2>&1 | tee docs/art/refactor/validation/unit-production-build.log
```

顺序执行，分别记录退出状态。JSON 结果用于逐项区分基线已有失败和新增回归，不能只比较失败总数。

基线 981 已确认六项，原证据位于主美术树 `docs/art/refactor/validation/baseline-known-failures.log`，不改写：

- `ship-maneuver-recovery.test.ts`：starts a forward recovery when traffic permits an on-the-spot turn but blocks a sailing circle。
- `ship-voyage-quality.test.ts`：brings six incoming friendly batteries into distinct usable stations around one stopped heavy hull。
- `ship-voyage.test.ts`：backs less than one hull length into an aligned berth without two U-turns。
- `ship-voyage.test.ts`：marks a zero-margin reference for exact control instead of smoothing through it。
- `ai/bootstrap_1/mercenary-control.test.ts`：v9_archer / ember / planner / mirror=false。
- 同上：mirror=true。

不改 AI 策略、导航算法、冻结标准或原基线验收证据。新增失败先定位责任模块再修复；涉及上述边界的非机械问题报告主线程。
