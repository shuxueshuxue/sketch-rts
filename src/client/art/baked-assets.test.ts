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
  it("leaves transparent padding around every ship heading, including tall carrier sails", async () => {
    const n=SHIP_CAMERA.frameSize;
    for(const kind of SHIP_KINDS) for(const layer of ["base","upper","depth"]) {
      const image=await loadImage(readFileSync(`public/art/ships/${kind}-${layer}.png`));
      const canvas=createCanvas(n,n),ctx=canvas.getContext("2d");
      for(let direction=0;direction<SHIP_CAMERA.directions;direction++) {
        ctx.clearRect(0,0,n,n);ctx.drawImage(image,direction%8*n,Math.floor(direction/8)*n,n,n,0,0,n,n);
        const pixels=ctx.getImageData(0,0,n,n).data;
        let edgeAlpha=0;
        for(let i=0;i<n;i++) for(const [x,y] of [[i,0],[i,n-1],[0,i],[n-1,i]])
          edgeAlpha=Math.max(edgeAlpha,pixels[(y!*n+x!)*4+3]!);
        expect(edgeAlpha,`${kind}/${layer}/${direction} clipped at atlas edge`).toBeLessThan(16);
      }
    }
  });
});
