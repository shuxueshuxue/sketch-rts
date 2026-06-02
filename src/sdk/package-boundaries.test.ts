import { describe, expect, it } from "vitest";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

describe("SDK package boundaries", () => {
  it("does not import the AI package from the SDK", () => {
    const offenders = filesUnder("src/sdk")
      .filter((file) => !file.endsWith("package-boundaries.test.ts"))
      .filter((file) => /from\s+["'](?:\.\.\/)+ai(?:\/|["'])/.test(readFileSync(file, "utf8")));

    expect(offenders).toEqual([]);
  });

  it("keeps AI claim memory on the SDK snapshot query surface", () => {
    const claimSource = readFileSync("src/ai/policy/claims.ts", "utf8");
    expect(claimSource).not.toMatch(/snapshot\.(units|buildings|resources|mercenaryCamps|items)/);
  });

  it("keeps AI policy entity enumeration on query helpers", () => {
    const policySource = readFileSync("src/ai/policy/core.ts", "utf8");
    expect(policySource).not.toMatch(/snapshot\.(units|buildings|resources|mercenaryCamps|items)/);
  });

  it("keeps AI modules out of SDK and shared", () => {
    expect(existsSync("src/sdk/ai-policy.ts")).toBe(false);
    expect(existsSync("src/sdk/ai-policy")).toBe(false);
    expect(existsSync("src/sdk/ai-ab-test.ts")).toBe(false);
    expect(existsSync("src/sdk/ai-runtime.ts")).toBe(false);
    expect(existsSync("src/sdk/benchmark-presets.ts")).toBe(false);
    expect(existsSync("src/sdk/benchmark-dashboard-store.ts")).toBe(false);
    expect(existsSync("src/shared/ai-policy.ts")).toBe(false);
    expect(existsSync("src/shared/ai-runtime.ts")).toBe(false);
  });

  it("does not carry banned cleanup-era naming in source or specs", () => {
    const bannedName = new RegExp("leg" + "acy", "i");
    const offenders = [...filesUnder("src"), ...filesUnder("docs")]
      .filter((file) => !file.endsWith("package-boundaries.test.ts"))
      .filter((file) => bannedName.test(file) || bannedName.test(readFileSync(file, "utf8")));

    expect(offenders).toEqual([]);
  });
});

function filesUnder(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const path = join(dir, entry);
    return statSync(path).isDirectory() ? filesUnder(path) : [path];
  });
}
