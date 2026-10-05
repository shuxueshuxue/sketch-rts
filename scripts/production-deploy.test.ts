import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("production CD contract", () => {
  it("deploys main and production with serialized releases", () => {
    const workflow = readFileSync(".github/workflows/production-deploy.yml", "utf8");

    expect(workflow).toContain("branches: [main, production]");
    expect(workflow).toContain("workflow_dispatch:");
    expect(workflow).toContain("main_sha:");
    expect(workflow).toContain("concurrency:");
    expect(workflow).toContain("group: sketch-rts-production");
    expect(workflow).toContain("cancel-in-progress: false");
    expect(workflow).toContain("SKETCH_RTS_BASE_PATH: /sketch-rts/");
    expect(workflow).toContain("npm run build:production");
    expect(workflow).toContain("scripts/deploy-production.sh");
  });

  it("updates one GitHub release package from the production artifact", () => {
    const workflow = readFileSync(".github/workflows/production-deploy.yml", "utf8");

    expect(workflow).toContain("contents: write");
    expect(workflow).toContain("RELEASE_TAG: production-latest");
    expect(workflow).toContain("gh release view \"$RELEASE_TAG\"");
    expect(workflow).toContain("gh release delete \"$RELEASE_TAG\" --yes");
    expect(workflow).toContain("gh release create \"$RELEASE_TAG\"");
    expect(workflow).toContain("gh release create \"$RELEASE_TAG\" sketch-rts-production.tar.gz");
    expect(workflow).not.toContain("gh release edit \"$RELEASE_TAG\"");
    expect(workflow).not.toContain("--clobber");
  });

  it("promotes the main tree without importing merge history", () => {
    const workflow = readFileSync(".github/workflows/production-deploy.yml", "utf8");
    const script = readFileSync("scripts/resolve-production-revision.sh", "utf8");
    expect(workflow).toContain("bash scripts/resolve-production-revision.sh");
    expect(script).toContain('git commit-tree "$deploy_sha^{tree}" -p "$production_tip"');
    expect(script).toContain('git push origin "$release_commit:refs/heads/production"');
    expect(script).not.toContain("--force");
  });

  it("does not keep a pull-request merge lane for production promotion", () => {
    expect(existsSync(".github/workflows/production-source-guard.yml")).toBe(false);
  });

  it("does not split promotion and deployment into separate workflows", () => {
    expect(existsSync(".github/workflows/production-promote.yml")).toBe(false);
  });

  it("publishes one active server through an atomic release symlink", () => {
    const script = readFileSync("scripts/deploy-production.sh", "utf8");

    expect(script).toContain("flock");
    expect(script).toContain("systemctl stop");
    expect(script).toContain("systemctl start");
    expect(script).toContain("releases");
    expect(script).toContain("current");
    expect(script).toContain(".benchmark-dashboard");
    expect(script).toContain("Retain legacy files and previous releases");
    expect(script).toContain("trap rollback_on_error ERR");
    expect(script).toContain("--noproxy 127.0.0.1");
  });
});
