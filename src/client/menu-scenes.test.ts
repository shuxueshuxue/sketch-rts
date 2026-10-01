import { describe, expect, it } from "vitest";
import { UNIT_DEFS } from "../shared/catalog";
import { stepGame } from "../shared/sim";
import { SIM_TICKS_PER_SECOND } from "../shared/time";
import { MENU_SCENES } from "./menu-scenes";

describe("menu scenes", () => {
  it("names every scene once in both languages", () => {
    expect(new Set(MENU_SCENES.map((scene) => scene.id)).size).toBe(MENU_SCENES.length);
    for (const scene of MENU_SCENES) expect(scene.name.zh && scene.name.en).toBeTruthy();
  });

  it("plays every scene's script on the real simulation, its cast on ground it can stand on", () => {
    for (const scene of MENU_SCENES) {
      const run = scene.create();
      const terrain = run.game.map.terrain!;
      for (const unit of run.game.units) {
        const cell = terrain.cells[Math.floor(unit.y / terrain.cell) * terrain.cols + Math.floor(unit.x / terrain.cell)];
        expect(UNIT_DEFS[unit.kind].naval ? ["~", ","] : [".", ","], `${scene.id}: ${unit.id} stands on ${cell}`).toContain(cell);
      }
      for (let tick = 0; tick < SIM_TICKS_PER_SECOND * 30; tick += 1) {
        run.script(run.game, run.game.tick / SIM_TICKS_PER_SECOND);
        stepGame(run.game);
      }
      expect(run.game.match.winner, scene.id).toBeNull();
    }
  });

  it("brings the forest's two hosts to blows", () => {
    const run = MENU_SCENES.find((scene) => scene.id === "woods")!.create();
    const count = () => run.game.units.filter((unit) => unit.owner !== "neutral").length;
    const before = count();
    for (let tick = 0; tick < SIM_TICKS_PER_SECOND * 30; tick += 1) {
      run.script(run.game, run.game.tick / SIM_TICKS_PER_SECOND);
      stepGame(run.game);
    }
    expect(count()).toBeLessThan(before - 6);
  });
});
