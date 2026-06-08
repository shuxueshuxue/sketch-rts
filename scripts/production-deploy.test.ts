import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("production CD contract", () => {
  it("deploys only from the production branch and serializes releases", () => {
    const workflow = readFileSync(".github/workflows/production-deploy.yml", "utf8");

    expect(workflow).toContain("branches: [production]");
    expect(workflow).toContain("concurrency:");
    expect(workflow).toContain("group: sketch-rts-production");
    expect(workflow).toContain("cancel-in-progress: false");
    expect(workflow).toContain("SKETCH_RTS_BASE_PATH: /sketch-rts/");
    expect(workflow).toContain("npm run build:production");
    expect(workflow).toContain("scripts/deploy-production.sh");
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
  });
});
