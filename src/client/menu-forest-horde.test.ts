import { describe, expect, it } from 'vitest';
import { snapshotGame, stepGame } from '../shared/sim';
import { SIM_TICKS_PER_SECOND } from '../shared/time';
import { MENU_BATTLES } from './menu-battles';
import { createForestHorde } from './menu-forest-horde';
import { battleDecided } from './menu-scene-world';

// Fights the battle to its end, or to the longest the home screen shows one.
function fight(seed: number) {
  const run = createForestHorde(seed), game = run.game, terrain = game.map.terrain!;
  const hits = new Set<string>(), standing: string[] = [];
  let firstHit: number | undefined, decided: number | undefined;
  for (let tick = 1; tick <= 150 * SIM_TICKS_PER_SECOND && decided === undefined; tick++) {
    stepGame(game);
    for (const effect of game.effects) if (effect.type === 'hit') { hits.add(effect.id); firstHit ??= tick; }
    for (const unit of game.units) standing.push(terrain.cells[Math.floor(unit.y / terrain.cell) * terrain.cols + Math.floor(unit.x / terrain.cell)]!);
    if (battleDecided(game)) decided = tick;
  }
  return { run, game, hits, standing, firstHit, decided };
}

describe('army against a forest horde home battle', () => {
  it('opens with the bounded cast drawn up and marching, every fighter on the attack', () => {
    const run = createForestHorde(), units = run.game.units;
    expect('battle' in run && run.battle).toEqual({ scene: 'woods', seed: 1 });
    expect(run.game.activePlayers).toEqual(['court', 'wilds']);
    expect(units).toHaveLength(36); expect(run.game.buildings).toHaveLength(0);
    const army = units.filter(unit => unit.owner === 'court'), horde = units.filter(unit => unit.owner === 'wilds');
    expect(army).toHaveLength(18); expect(horde).toHaveLength(18);
    expect(army.filter(unit => unit.kind === 'archer')).toHaveLength(6);
    expect(army.filter(unit => unit.kind === 'knight')).toHaveLength(2);
    expect(horde.filter(unit => ['spiderQueen', 'graniteGolem', 'ancientStag'].includes(unit.kind))).toHaveLength(3);
    expect(horde.some(unit => unit.kind === 'ogreLord')).toBe(false);
    expect(new Set(horde.map(unit => unit.kind)).size).toBeGreaterThanOrEqual(10);
    for (const unit of units) {
      const healer = unit.kind === 'priest' || unit.kind === 'barkMender';
      expect(unit.order.type).toBe(healer ? 'move' : 'attackMove');
    }
    // The army starts left of the horde and marches right; the horde the other way.
    expect(Math.max(...army.map(unit => unit.x))).toBeLessThan(Math.min(...horde.map(unit => unit.x)));
  });

  it('builds the same opening from the same seed, so the thread fights what the page drew', () => {
    const page = snapshotGame(createForestHorde(7).game), thread = snapshotGame(MENU_BATTLES.woods(7));
    expect(JSON.stringify(thread)).toBe(JSON.stringify(page));
    expect(JSON.stringify(snapshotGame(MENU_BATTLES.woods(8)).units)).not.toBe(JSON.stringify(page.units));
  });

  it('is fought by the simulation: real hits and deaths in the clearing, decided within the scene', () => {
    const { game, hits, standing, firstHit, decided } = fight(1);
    expect(firstHit).toBeGreaterThan(SIM_TICKS_PER_SECOND);
    expect(firstHit).toBeLessThan(15 * SIM_TICKS_PER_SECOND);
    expect(hits.size).toBeGreaterThan(40);
    expect(decided).toBeDefined();
    // Everyone who fell left remains where they fell; nobody walked into the trees.
    expect(game.corpses!.length).toBe(36 - game.units.length);
    expect(game.corpses!.length).toBeGreaterThan(15);
    expect(new Set(standing)).toEqual(new Set(['.']));
  });

  // @@@woods-even: the battle is not decided before it starts. Seed 1 falls to the army; on seed 4 the army leads at
  // twenty seconds and the horde still takes the field.
  it('can go either way: the army takes one seed, the horde another after trailing', () => {
    const owners = (game: ReturnType<typeof fight>['game']) => new Set(game.units.filter(unit => unit.hp > 0 && unit.attackDamage > 0).map(unit => unit.owner));
    expect(owners(fight(1).game)).toEqual(new Set(['court']));
    const run = createForestHorde(4), game = run.game, count = (owner: string) => game.units.filter(unit => unit.owner === owner && unit.hp > 0).length;
    while (game.tick < 20 * SIM_TICKS_PER_SECOND) stepGame(game);
    expect(count('court')).toBeGreaterThan(count('wilds'));
    for (let tick = 0; tick < 130 * SIM_TICKS_PER_SECOND && !battleDecided(game); tick++) stepGame(game);
    expect(owners(game)).toEqual(new Set(['wilds']));
  }, 60_000);

  it('keeps the body of both armies inside the uncovered portrait region and the desktop right field', () => {
    const run = createForestHorde(), game = run.game;
    for (const second of [0, 8, 16, 30]) {
      while (game.tick < second * SIM_TICKS_PER_SECOND) stepGame(game);
      const snapshot = snapshotGame(game);
      for (const [width, height] of [[1440, 900], [1280, 720], [390, 844]] as const) {
        // The camera eases toward the fight; let it settle on this moment.
        let view = run.frameAt!(second, width, height, snapshot);
        for (let frame = 0; frame < 200; frame++) view = run.frameAt!(second, width, height, snapshot);
        expect(view.zoom).toBeGreaterThan(0); expect(Number.isFinite(view.zoom)).toBe(true);
        // The camera promises the body of both armies; a straggler at either end may step out of frame.
        const body = snapshot.units.slice().sort((a, b) => a.x - b.x).slice(Math.floor(snapshot.units.length * .1), Math.ceil(snapshot.units.length * .9));
        const screen = body.map(unit => ({ x: (unit.x - view.focus.x) * view.zoom + width * view.anchorX, y: (unit.y - view.focus.y) * view.zoom + height * view.anchorY }));
        expect(Math.min(...screen.map(p => p.x))).toBeGreaterThan(width < 700 ? 0 : width * .4);
        expect(Math.max(...screen.map(p => p.x))).toBeLessThan(width);
        expect(Math.min(...screen.map(p => p.y))).toBeGreaterThan(65);
        expect(Math.max(...screen.map(p => p.y))).toBeLessThan(width < 700 ? height - 280 : height - 80);
      }
    }
  });
});
