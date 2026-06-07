import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("room history ownership boundary", () => {
  it("keeps spectator catch-up from owning a second frame history", () => {
    const source = readFileSync("src/server/room-net.ts", "utf8");

    expect(source).not.toContain("SpectatorSyncLog");
    expect(source).not.toContain("spectatorSync");
  });

  it("keeps hosted debug replay from recording a private replay ledger", () => {
    const source = readFileSync("src/server/room-host.ts", "utf8");

    expect(source).not.toContain("recordReplayFrame");
    expect(source).not.toContain("recordReplayCheckpoint");
  });
});
