import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const SDK_AGENT_SCRIPTS = ["scripts/sdk-agent-player.ts", "scripts/sdk-agent-15v15.ts"] as const;

describe("SDK agent planner boundary", () => {
  it("routes external agent scripts through the shared AI command-frame planner", () => {
    for (const path of SDK_AGENT_SCRIPTS) {
      const source = readFileSync(path, "utf8");

      expect(source).toContain('from "../src/ai/runtime"');
      expect(source).toContain("planAiCommandFrameFromSnapshot");
      expect(source).not.toContain("planPresetAiCommands");
      expect(source).not.toContain('from "../src/ai/policy"');
    }
  });
});
