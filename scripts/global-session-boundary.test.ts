import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

describe("script global session boundary", () => {
  it("does not configure or fall back to old global gameplay APIs", () => {
    const forbidden = ["SESSION_AUTOTICK", '"/api/snapshot"', '"/api/reset"', '"/api/command"', '"/api/tick"'];
    const offenders = scriptFiles()
      .flatMap((file) => {
        const source = readFileSync(file, "utf8");
        return forbidden.filter((needle) => source.includes(needle)).map((needle) => `${file}: ${needle}`);
      });

    expect(offenders).toEqual([]);
  });
});

function scriptFiles() {
  return readdirSync("scripts")
    .filter((file) => (file.endsWith(".ts") || file.endsWith(".mjs")) && !file.endsWith(".test.ts"))
    .map((file) => join("scripts", file));
}
