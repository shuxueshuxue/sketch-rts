import { describe, expect, it } from 'vitest';
import { createMap, createUnit } from './map';
import {
  advanceShipPlanningJob, beginShipPlanningJob, prepareShipPlanningJob, validShipPlanningJob,
} from './ship-planning-job';
import type { GameMap } from './types';

describe('decoded ship planning graph boundary', () => {
  it('retains the general construction error for an existing JSON search graph', () => {
    const cell = 32, cols = 80, rows = 64;
    const map: GameMap = { ...createMap('bareDuel'), width: cols * cell, height: rows * cell,
      wind: { direction: Math.PI / 2, speed: 80 },
      terrain: { cell, cols, rows, cells: Array.from({ length: cols * rows }, (_, i) =>
        i % cols >= 32 && i % cols < 45 && Math.floor(i / cols) >= 20 && Math.floor(i / cols) < 45
          ? '.' : '~').join('') } };
    const ship = createUnit('decoded', 'player', 'transport', 16.5 * cell, 32.5 * cell);
    ship.sailing = { heading: 0, speed: 0, load: 0, balance: 0 };
    const goal = { x: 62.5 * cell, y: 32.5 * cell, heading: 0 };
    beginShipPlanningJob(ship, goal, map, [ship]);
    const saved = JSON.parse(ship.sailing.planningJob!);
    saved.phase = 'reference';
    // read historically accepts this JSON shape. It must retain its general
    // Map-construction error, rather than treating a decoded graph as owned.
    // An owned for-of would instead accept the empty string as an iterable.
    saved.search = { phase: 'search', target: { ...goal }, nodes: '', heap: [] };
    const source = JSON.stringify(saved);
    ship.sailing.planningJob = source;
    expect(validShipPlanningJob(ship, goal, map)).toBe(true);
    expect(prepareShipPlanningJob(ship, map, 0)).toBe(true);
    expect(ship.sailing.planningJob).toBe(source);
    expect(() => advanceShipPlanningJob(ship, map)).toThrow(TypeError);
    expect(ship.sailing.planningJob).toBe(source);
  });
});
