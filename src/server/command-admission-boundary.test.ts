import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("server command admission boundary", () => {
  it("keeps REST and WebSocket boundaries off local command legality", () => {
    const files = ["src/server/index.ts", "src/server/room-net.ts"];
    const forbidden = ["commandValidationError"];
    const offenders = files.flatMap((file) => {
      const source = readFileSync(file, "utf8");
      return forbidden.filter((needle) => source.includes(needle)).map((needle) => `${file}: ${needle}`);
    });

    expect(offenders).toEqual([]);
  });

  it("keeps command payload shape on the shared command schema instead of a server-local parser", () => {
    const source = readFileSync("src/server/index.ts", "utf8");

    expect(source).not.toContain("function isCommand(");
    expect(source).not.toContain("function isRoomCommandEnvelope(");
    expect(source).toContain("isCommandEnvelope");
  });
});
