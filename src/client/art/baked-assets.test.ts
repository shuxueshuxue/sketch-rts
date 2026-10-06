import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { createCanvas, loadImage } from "@napi-rs/canvas";
import { BUILDING_DEFS } from "../../shared/catalog";
import { SHIP_KINDS, SHIP_CAMERA } from "../../shared/ship-geometry";

describe("deployed Blender art", () => {
  it("decodes every building and every ship layer at the expected dimensions", async () => {
    for (const kind of Object.keys(BUILDING_DEFS)) for (const suffix of ["", "-team"]) {
      const image = await loadImage(readFileSync(`public/art/buildings/${kind}${suffix}.png`));
      expect([image.width,image.height]).toEqual([256,256]);
    }
    for (const kind of SHIP_KINDS) for (const layer of ["base", "upper", "depth"]) {
      const image = await loadImage(readFileSync(`public/art/ships/${kind}-${layer}.png`));
      expect([image.width,image.height]).toEqual([SHIP_CAMERA.frameSize*8,SHIP_CAMERA.frameSize*4]);
    }
  });
  it("keeps team masks transparent outside the actual flag", async () => {
    const image = await loadImage(readFileSync("public/art/buildings/townHall-team.png"));
    const canvas = createCanvas(256,256),ctx=canvas.getContext("2d");ctx.drawImage(image,0,0);
    const pixels=ctx.getImageData(0,0,256,256).data;
    expect(pixels[3]).toBe(0);
    let colored=0;for(let i=3;i<pixels.length;i+=4)if(pixels[i]!>32)colored++;
    expect(colored).toBeGreaterThan(20);expect(colored).toBeLessThan(1000);
  });
});
