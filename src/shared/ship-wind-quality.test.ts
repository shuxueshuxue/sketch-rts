import { describe, expect, it } from 'vitest';
import { createUnit } from './map';
import { createGame, issuePlayerCommand, stepGame } from './sim';
import { shipMotionLimits } from './ship-handling';
import { coursePerformance, updateAutoTrim } from './ship-wind';
import { perTick, seconds } from './time';

const kinds = ['cutter', 'transport', 'warship', 'carrier', 'bombardShip', 'fireShip'] as const;

describe('playable windward progress', () => {
  for (const kind of kinds) {
    it.each([[20, .18], [40, .26], [80, .38]] as const)(`${kind} leaves the wind eye and makes useful sustained VMG in wind %s`, (windSpeed, minimumVmg) => {
      const game = createGame('bareDuel', { aiPlayers: [] });
      game.units = []; game.items = []; game.buildings = []; game.resources = [];
      game.scriptedVictory = true;
      game.map = { ...game.map, width: 40000, height: 40000,
        wind: { direction: Math.PI, speed: windSpeed },
        terrain: { cell: 400, cols: 100, rows: 100, cells: '~'.repeat(10000) } };
      const boat = game.spawnUnit('player', kind, 15000, 20000);
      boat.sailing!.heading = 0;
      const maximum = shipMotionLimits(boat).speed;
      issuePlayerCommand(game, 'player', { type: 'move', unitIds: [boat.id], x: 35000, y: 20000, avoidCombat: true });
      let measuredFrom = boat.x;
      for (let tick = 0; tick < seconds(40); tick++) {
        stepGame(game);
        if (tick === seconds(10) - 1) expect(boat.x - 15000).toBeGreaterThan(40);
        if (tick === seconds(20) - 1) measuredFrom = boat.x;
      }
      // Measure actual progress toward the order, including helm and trim,
      // rather than the ideal speed along a steep sideways sailing course.
      const vmg = (boat.x - measuredFrom) / 20;
      expect(vmg).toBeGreaterThan(maximum * minimumVmg);
      expect(coursePerformance(boat, game.map).trimEfficiency).toBeGreaterThan(.95);
    });

    it(`${kind} luffs through a tack with its canvas hoisted and powers the new side promptly`, () => {
      const boat = createUnit('boat', 'player', kind, 0, 0), map = { wind: { direction: Math.PI, speed: 80 } };
      boat.sailing = { heading: 0, speed: 0, load: 0, balance: 0,
        sail: { angle: 0, billow: 0, set: 1, mode: 'tacking' } };
      const beat = coursePerformance(boat, map).beatAngle, turn = perTick(shipMotionLimits(boat).turnRate);
      boat.sailing.heading = -beat;
      for (let tick = 0; tick < seconds(3); tick++) updateAutoTrim(boat, map);
      let crossedWind = false;
      for (let tick = 0; tick < seconds(30) && boat.sailing.heading < beat; tick++) {
        boat.sailing.heading = Math.min(beat, boat.sailing.heading + turn);
        updateAutoTrim(boat, map);
        expect(boat.sailing.sail!.set).toBe(1);
        const performance = coursePerformance(boat, map);
        if (performance.noGo) {
          crossedWind = true;
          expect(performance.targetSpeed).toBe(0);
        }
      }
      expect(crossedWind).toBe(true);
      expect(boat.sailing.heading).toBe(beat);
      expect(coursePerformance(boat, map).trimEfficiency).toBeGreaterThan(.95);
    });
  }
});
