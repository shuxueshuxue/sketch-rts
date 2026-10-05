import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createCanvas } from "@napi-rs/canvas";
import { drawAtlasBuildingPortrait, drawAtlasUnitPortrait } from "../src/client/atlas-art";
import { setScratchCanvasFactory } from "../src/client/art/scratch-canvas";
import { BUILDING_DEFS, UNIT_DEFS } from "../src/shared/catalog";
import type { BuildingKind, UnitKind } from "../src/shared/types";

beforeAll(() => setScratchCanvasFactory((w,h) => createCanvas(w,h) as unknown as HTMLCanvasElement));
afterAll(() => setScratchCanvasFactory(undefined));

describe("HUD artwork uses transparent subjects", () => {
  it("keeps every unit portrait visible without an opaque background", () => {
    for (const kind of Object.keys(UNIT_DEFS) as UnitKind[]) {
      const canvas = createCanvas(192,192), ctx = canvas.getContext("2d");
      drawAtlasUnitPortrait(ctx as unknown as CanvasRenderingContext2D, kind, 0,0,192,"#65908c");
      const pixels = ctx.getImageData(0,0,192,192).data;
      const visible = pixels.filter((_,i) => i%4 === 3 && pixels[i]! > 8).length;
      expect(visible, kind).toBeGreaterThan(192*192*.05);
      expect(visible, kind).toBeLessThan(192*192*.92);
      expect(pixels[3], kind).toBe(0);
    }
  });
  it("fits shops, camps and every building inside the portrait, with no clipped roof", () => {
    for (const kind of [...Object.keys(BUILDING_DEFS) as BuildingKind[], "shop", "camp"] as const) {
      const canvas = createCanvas(192,192), ctx = canvas.getContext("2d");
      drawAtlasBuildingPortrait(ctx as unknown as CanvasRenderingContext2D, kind,192,"#65908c");
      const pixels = ctx.getImageData(0,0,192,192).data;
      let left=192,top=192,right=0,bottom=0;
      for (let y=0;y<192;y++) for(let x=0;x<192;x++) if(pixels[(y*192+x)*4+3]! > 8) {
        left=Math.min(left,x);top=Math.min(top,y);right=Math.max(right,x);bottom=Math.max(bottom,y);
      }
      expect(Math.max(right-left,bottom-top),kind).toBeGreaterThan(165);
      expect(Math.min(left,top,191-right,191-bottom),kind).toBeGreaterThan(3);
    }
  });
});
