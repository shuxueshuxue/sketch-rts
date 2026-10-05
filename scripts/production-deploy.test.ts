import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("production CD contract", () => {
  it("deploys only from the production branch and serializes releases", () => {
    const workflow = readFileSync(".github/workflows/production-deploy.yml", "utf8");

    expect(workflow).toContain("branches: [production]");
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

  it("deploys production only when its tree matches main", () => {
    const workflow = readFileSync(".github/workflows/production-deploy.yml", "utf8");

    expect(workflow).toContain("Resolve production deployment revision");
    expect(workflow).toContain("git fetch --no-tags origin main");
    expect(workflow).toContain('deploy_sha="$MAIN_SHA"');
    expect(workflow).toContain('main_tip="$(git rev-parse origin/main)"');
    expect(workflow).toContain('git push origin "$deploy_sha:refs/heads/production"');
    expect(workflow).toContain('git diff --quiet "$deploy_sha" "origin/main"');
    expect(workflow).toContain('echo "DEPLOY_SHA=$deploy_sha" >> "$GITHUB_ENV"');
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
    expect(script).toContain("find \"$releases_dir\"");
    expect(script).toContain("-mindepth 1 -maxdepth 1");
    expect(script).toContain("sketch-rts-deploy-*");
  });
});
