import { createCanvas } from "@napi-rs/canvas";
import { mkdirSync, writeFileSync } from "node:fs";
import { installHeadlessCanvas } from "../src/recorder/record";
import { drawWorld, worldLabelsFor } from "../src/client/world-renderer";
import { createI18n } from "../src/client/i18n";
import { UnitFacingTracker } from "../src/client/unit-facing";
import { drawAtlasGround, drawAtlasBuildingPortrait } from "../src/client/atlas-art";
import { drawGoldBountyEffect } from "../src/client/effect-renderer";
import { BUILDABLE_BUILDING_KINDS } from "../src/shared/catalog";
import { createBuilding } from "../src/shared/map";
import { createGame, snapshotGame } from "../src/shared/sim";

// Render the actual game painters with identical objects, positions and lighting
// time for an art review. No browser, replacement artwork or added geometry.
installHeadlessCanvas();
const out = process.argv[2] ?? "/tmp/sketch-rts-presentation-review";
mkdirSync(out, { recursive: true });
const game = createGame("verdantCrossroads", { aiPlayers: [] });
game.units = []; game.buildings = []; game.resources = []; game.mercenaryCamps = []; game.items = [];
const kinds = ["townHall", "barracks", "stables", "workshop", "moonWell", "defenseTower", "emberForge", "ashenHall", "cinderSpire"] as const;
for (const [index, kind] of kinds.entries()) {
  game.buildings.push(createBuilding(`site-${index}`, index < 6 ? "player" : "enemy", kind, 250 + index % 3 * 240, 280 + Math.floor(index / 3) * 230, true));
}
for (const [index, kind] of (["footman", "archer", "knight", "golem"] as const).entries()) {
  const unit = game.spawnUnit("player", kind, 240 + index * 105, 490);
  if (index > 0) unit.hp = unit.maxHp * [1, .7, .4, .2][index]!;
}
const world = createCanvas(1440, 1100);
drawWorld({ ctx: world.getContext("2d") as unknown as CanvasRenderingContext2D, snapshot: snapshotGame(game), view: { x: 50, y: 110, width: 1440, height: 1100, zoom: 1.35 }, now: 0, facing: new UnitFacingTracker(), labels: worldLabelsFor(createI18n("en")), viewer: "player", selectedIds: new Set() });
writeFileSync(`${out}/world.png`, world.toBuffer("image/png"));
const gallery = createCanvas(1400, 1000), ctx = gallery.getContext("2d");
drawAtlasGround(ctx as unknown as CanvasRenderingContext2D, 1400, 1000, { x: 0, y: 0 });
for (const [index, kind] of BUILDABLE_BUILDING_KINDS.entries()) {
  const x = 32 + index % 5 * 275, y = 24 + Math.floor(index / 5) * 255;
  ctx.save(); ctx.translate(x, y); drawAtlasBuildingPortrait(ctx as unknown as CanvasRenderingContext2D, kind, 240, index < 8 ? "#477b91" : "#a85644"); ctx.restore();
  ctx.font = "16px sans-serif"; ctx.fillStyle = "#3c4b43"; ctx.textAlign = "center"; ctx.fillText(kind, x + 120, y + 245);
}
writeFileSync(`${out}/buildings.png`, gallery.toBuffer("image/png"));
const coins = createCanvas(760, 200), brush = coins.getContext("2d");
drawAtlasGround(brush as unknown as CanvasRenderingContext2D, 760, 200, { x: 0, y: 0 });
for (let index = 0; index < 4; index++) drawGoldBountyEffect(brush as unknown as CanvasRenderingContext2D, { x: 95 + index * 190, y: 125 }, 1 - index * .24, 130);
writeFileSync(`${out}/bounty.png`, coins.toBuffer("image/png"));
console.log(out);
