import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { loadImage } from "@napi-rs/canvas";
import { describe, expect, it } from "vitest";
import { ABILITY_KINDS } from "../shared/catalog";
import { VETERAN_SKILLS } from "../shared/veteran-skills";
import { ABILITY_ICON_FILES, abilityIconMarkup, abilityIconUrl, type AbilityIconId } from "./ability-icons";

describe("hand-authored vector ability resources", () => {
  it("covers every catalog ability, every three-star skill and the additional status icons", () => {
    expect(Object.keys(ABILITY_ICON_FILES).sort()).toEqual([...new Set([
      ...ABILITY_KINDS, ...Object.keys(VETERAN_SKILLS), "guardianScroll", "statusSlow", "statusPoison", "statusStun",
    ])].sort());
    expect(new Set(Object.values(ABILITY_ICON_FILES)).size).toBe(Object.keys(ABILITY_ICON_FILES).length);
  });

  it("ships self-contained vector drawings matching the resource manifest", async () => {
    const manifest = JSON.parse(await readFile(fileURLToPath(new URL("../../assets/abilities/ability-icons.json", import.meta.url)), "utf8")) as {
      formatVersion: number;
      authoredWith: string;
      output: { count: number; totalBytes: number; format: string };
      icons: { id: AbilityIconId; file: string; width: number; height: number; bytes: number; sha256: string }[];
    };
    expect(manifest.icons.map(icon => icon.id).sort()).toEqual(Object.keys(ABILITY_ICON_FILES).sort());
    expect(manifest.output.count).toBe(29);
    expect(manifest.formatVersion).toBe(2);
    expect(manifest.authoredWith).toContain("hand-authored SVG");
    expect(manifest.output.format).toBe("svg");
    expect(manifest.output.totalBytes).toBeLessThan(200_000);
    await Promise.all(manifest.icons.map(async icon => {
      expect(icon.file).toBe(`art/abilities/${ABILITY_ICON_FILES[icon.id]}`);
      const bytes = await readFile(fileURLToPath(new URL(`../../public/${icon.file}`, import.meta.url)));
      expect(bytes.length).toBe(icon.bytes);
      expect(bytes.length).toBeLessThan(10_000);
      const svg = bytes.toString("utf8");
      expect(icon.file).toMatch(/\.svg$/);
      expect(svg).toContain('viewBox="0 0 128 128"');
      expect(svg).toContain("<path");
      // Embedded rasters, active SVG, external resources and rasterizing filters are disallowed.
      const artwork = svg.replace('xmlns="http://www.w3.org/2000/svg"', "");
      expect(artwork).not.toMatch(/<(?:image|foreignObject|script|filter|text|use)\b|<!DOCTYPE|(?:data:|https?:|base64|\bon\w+\s*=|\b(?:href|src)\s*=)/i);
      const paints = new Set([...svg.matchAll(/id="([\w-]+)"/g)].map(match => match[1]));
      for (const match of svg.matchAll(/url\(#([\w-]+)\)/g)) expect(paints.has(match[1])).toBe(true);
      expect(createHash("sha256").update(bytes).digest("hex")).toBe(icon.sha256);
      const image = await loadImage(bytes);
      expect([image.width, image.height]).toEqual([128, 128]);
      expect([icon.width, icon.height]).toEqual([image.width, image.height]);
    }));
  });

  it("serves an individual icon under root and mounted deployment paths", () => {
    expect(abilityIconUrl("veteranHealingWave", "/")).toBe("/art/abilities/veteranHealingWave.svg");
    expect(abilityIconUrl("statusPoison", "/sketch-rts/")).toBe("/sketch-rts/art/abilities/statusPoison.svg");
    expect(abilityIconUrl("charge", "/sketch-rts")).toBe("/sketch-rts/art/abilities/charge.svg");
  });

  it("uses decorative image markup while the command retains its own accessible label", () => {
    const markup = abilityIconMarkup("veteranRally");
    expect(markup).toContain('class="ability-symbol"');
    expect(markup).toContain('alt="" aria-hidden="true"');
    expect(markup).toContain("/art/abilities/veteranRally.svg");
    expect(markup).not.toContain("svg-sources");
  });
});
