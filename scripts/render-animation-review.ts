// Reproducible pose contact sheet: real atlas painters at enlarged scale.
// node --import tsx scripts/render-animation-review.ts
import { createCanvas } from "@napi-rs/canvas";
import { writeFileSync, mkdirSync } from "node:fs";
import { drawAtlasUnit } from "../src/client/atlas-art";
import { installHeadlessCanvas } from "../src/recorder/record";
import { gifSink } from "../src/recorder/sinks";
import type { UnitAnimationFrame } from "../src/client/unit-animation";
import type { UnitKind } from "../src/shared/types";

installHeadlessCanvas();
const canvas = createCanvas(840, 320);
const c = canvas.getContext("2d");
const sink = gifSink("docs/art/animation/poses.gif", { fps: 20 });
const units: { kind: UnitKind; label: string }[] = [
  { kind: "footman", label: "FOOTMAN" }, { kind: "archer", label: "ARCHER" },
  { kind: "knight", label: "KNIGHT" }, { kind: "priest", label: "PRIEST" },
];
for (let index = 0; index < 80; index++) {
  c.fillStyle = "#eae5ce"; c.fillRect(0, 0, 840, 320);
  c.fillStyle = "#29463b"; c.font = "bold 22px sans-serif";
  c.fillText("SKETCH RTS / MOTION STUDY", 26, 36);
  c.font = "13px sans-serif"; c.fillStyle = "#71816a";
  c.fillText(index < 40 ? "WALK / articulated legs, steady ground shadows" : "ACTION / weapon recovery and spell gesture", 26, 60);
  units.forEach(({ kind, label }, column) => {
    const x = 26 + column * 202;
    c.fillStyle = "#e0dbc1"; c.fillRect(x, 82, 188, 214);
    const action = index - 40;
    const pose: UnitAnimationFrame = index < 40
      ? { mode: "walk", frame: Math.floor(index / 2) % 8 }
      : { mode: action % 20 < 10 ? (kind === "priest" ? "cast" : "attack") : "idle", frame: action % 20 < 10 ? Math.min(5, Math.floor((action % 20) * 6 / 10)) : 0 };
    drawAtlasUnit(c as unknown as CanvasRenderingContext2D, kind, { x: x + 84, y: 204 }, 2.35, "#387d72", 1, pose);
    c.fillStyle = "#29463b"; c.font = "bold 12px sans-serif"; c.fillText(label, x + 13, 280);
  });
  const rgba = c.getImageData(0, 0, 840, 320).data;
  await sink.write({ index, tick: index, width: 840, height: 320, canvas, rgba });
  if (index === 44) {
    mkdirSync("docs/art/animation", { recursive: true });
    writeFileSync("docs/art/animation/poses-still.png", canvas.toBuffer("image/png"));
  }
}
await sink.finish();
