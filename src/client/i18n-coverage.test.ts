import fs from "node:fs";
import { describe, expect, it } from "vitest";

const CLIENT_SOURCES = [
  "src/client/main.ts",
  "src/client/game-shell.ts",
  "src/client/tooltips.ts",
];

const MIGRATED_VISIBLE_TEXT = [
  "Rooms hosted by this server.",
  "Create Room",
  "Nothing selected",
  "Mercenary Camp -",
  "Connecting to Sketch RTS",
  "A-move",
  "Flame Cloak is passive.",
  "has no valid target.",
  "Researching",
  "Training",
  "Queued",
  "Continue game",
  "Mouse lock is paused.",
];

describe("browser-visible i18n coverage", () => {
  it("keeps migrated browser-visible text behind i18n resources", () => {
    const source = CLIENT_SOURCES.map((path) => fs.readFileSync(path, "utf8")).join("\n");

    for (const text of MIGRATED_VISIBLE_TEXT) {
      const escaped = text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      expect(source, `${text} should not be hard-coded in browser code`).not.toMatch(new RegExp(String.raw`["'\`]${escaped}`));
    }
  });
});
