import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const repoRoot = process.cwd();
const thisTest = "src/client/net/wrapper-boundary.test.ts";

describe("client net wrapper boundary", () => {
  it("does not carry unused room or spectator wrapper modules", () => {
    const removedWrappers = ["src/client/net/room-adapter.ts", "src/client/net/spectator-client.ts"];

    expect(removedWrappers.filter((path) => existsSync(join(repoRoot, path)))).toEqual([]);
  });

  it("does not import removed room or spectator wrapper modules", () => {
    const sourceFiles = ["src", "scripts", "docs/superpowers/specs"]
      .flatMap((directory) => collectTextFiles(join(repoRoot, directory)))
      .filter((path) => path.replace(`${repoRoot}/`, "") !== thisTest);
    const staleWrapperReferences = [/from\s+["'][^"']*(?:room-adapter|spectator-client)["']/, /`room-adapter\.ts`/, /`spectator-client\.ts`/, /\bSpectatorClient\b/];
    const offenders = sourceFiles
      .map((path) => ({ path, content: readFileSync(path, "utf8") }))
      .filter(({ content }) => staleWrapperReferences.some((pattern) => pattern.test(content)))
      .map(({ path }) => path.replace(`${repoRoot}/`, ""));

    expect(offenders).toEqual([]);
  });
});

function collectTextFiles(directory: string): string[] {
  return readdirSync(directory)
    .flatMap((entry) => {
      const path = join(directory, entry);
      if (statSync(path).isDirectory()) return collectTextFiles(path);
      return /\.(ts|mjs|md)$/.test(path) ? [path] : [];
    })
    .sort();
}
