import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { validatePack } from "./validate-pack";

const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });

function fixture() {
  const root = mkdtempSync(join(tmpdir(), "sound-pack-release-"));
  roots.push(root);
  const staged = join(root, "war3"), destination = join(root, "published");
  mkdirSync(staged);
  mkdirSync(destination);
  writeFileSync(join(staged, "click.ogg"), "core audio");
  writeFileSync(join(staged, "summon.ogg"), "spell audio");
  writeFileSync(join(staged, "pack.json"), JSON.stringify({ name: "Warcraft III", sounds: { click: { file: "click.ogg" } } }));
  const extras = { sounds: { spell: { kinds: { pyreCaller: { file: "summon.ogg" } } } } };
  writeFileSync(join(staged, "extras.json"), JSON.stringify(extras));
  writeFileSync(join(destination, "keep.ogg"), "existing recording");
  return { staged, destination, extras };
}

describe("audio pack release validation", () => {
  it("checks the merged core and extras with the runtime reader and shared unit renames", () => {
    const { staged } = fixture();
    const pack = validatePack(staged);
    expect(pack.sounds.click!.clip!.file).toBe("click.ogg");
    expect(pack.sounds.spell!.kinds.summoner!.file).toBe("summon.ogg");
  });

  it("rejects an extras variant whose audio is absent from the staged folder", () => {
    const { staged, extras } = fixture();
    writeFileSync(join(staged, "extras.json"), JSON.stringify({ sounds: {
      spell: { kinds: { pyreCaller: { ...extras.sounds.spell.kinds.pyreCaller, variants: ["missing.ogg"] } } },
    } }));
    expect(() => validatePack(staged)).toThrow("Sound pack war3: spell.pyreCaller variants must name files in the pack");
  });

  it("refuses to publish an invalid supplement before touching the destination", () => {
    const { staged, destination } = fixture();
    writeFileSync(join(staged, "extras.json"), JSON.stringify({ sounds: { spell: { kinds: { unknownCaster: { file: "summon.ogg" } } } } }));
    const result = spawnSync("bash", [resolve("tools/audio/publish-pack.sh"), staged, destination], { encoding: "utf8" });
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("Sound pack war3: spell.kinds.unknownCaster names no unit kind unknownCaster");
    expect(readdirSync(destination)).toEqual(["keep.ogg"]);
  });

  it("publishes a valid complete pack while keeping existing destination recordings", () => {
    const { staged, destination } = fixture();
    const result = spawnSync("bash", [resolve("tools/audio/publish-pack.sh"), staged, destination], { encoding: "utf8" });
    expect(result.stderr).toBe("");
    expect(result.status).toBe(0);
    expect(readFileSync(join(destination, "summon.ogg"), "utf8")).toBe("spell audio");
    expect(readFileSync(join(destination, "keep.ogg"), "utf8")).toBe("existing recording");
    expect(validatePack(destination).sounds.spell!.kinds.summoner!.file).toBe("summon.ogg");
  });

  it("removes an old supplement when the reviewed complete pack omits extras", () => {
    const { staged, destination } = fixture();
    unlinkSync(join(staged, "extras.json"));
    writeFileSync(join(destination, "extras.json"), "broken older supplement");
    const result = spawnSync("bash", [resolve("tools/audio/publish-pack.sh"), staged, destination], { encoding: "utf8" });
    expect(result.status).toBe(0);
    expect(existsSync(join(destination, "extras.json"))).toBe(false);
    expect(readFileSync(join(destination, "keep.ogg"), "utf8")).toBe("existing recording");
    expect(Object.keys(validatePack(destination).sounds)).toEqual(["click"]);
  });
});
