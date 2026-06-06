import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const SDK_AGENT_SCRIPTS = ["scripts/sdk-agent-player.ts", "scripts/sdk-agent-15v15.ts"] as const;

describe("SDK external-agent driver boundary", () => {
  it("keeps SDK agent scripts on the shared room driver", () => {
    for (const path of SDK_AGENT_SCRIPTS) {
      const source = readFileSync(path, "utf8");

      expect(source).toContain('from "../src/sdk/external-agent-room-runner"');
      expect(source).toContain("runExternalAgentRoom");
      expect(source).not.toContain(".commandTickRoom(");
      expect(source).not.toContain(".roomCommand(");
      expect(source).not.toContain(".tickRoom(");
    }
  });
});
