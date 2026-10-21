import { observeSimulation } from '../../../shared/sim';
import { BUILDING_DEFS, UNIT_DEFS } from '../../../shared/catalog';
import { shipShorePoints } from '../../../shared/connected-decks';
import { sameGround } from '../../../shared/terrain';
import type { GameCommand, Unit } from '../../../shared/types';
import type { Observed } from '../../../shared/sim/observation';
import type { PublicPuzzleCase } from './scenes';
import { physicallyOnLand, type PuzzleWorld } from './world';
import { observePuzzleWorkerSafety } from './worker-safety';

export type PuzzleExecution = {
  passed: boolean; checks: Record<string, boolean>; tick: number;
  first: Record<string, number>; commands: { tick: number; command: Observed<GameCommand> }[];
  losses: { tick: number; kind: string; owner: string }[];
  final: { gold: number; homeAlive: boolean; armyAlive: number; workersRescued: number;
    guardsAlive: number; localGuardsAlive: number; buildings: Record<string, number> };
  originalChecks?: Record<string, boolean>;
  workerSafety?: ReturnType<ReturnType<typeof observePuzzleWorkerSafety>['finish']>;
};

/** Reads actual simulation transitions, including automatic attacks; issuing an order is not success. */
export function trackPuzzle(puzzle: PublicPuzzleCase, world: PuzzleWorld, options: { workerSafety?: boolean } = {}) {
  const { game, owner } = world, start = game.tick;
  const armyIds = new Set(world.army.map(u => u.id)), workerIds = new Set(world.workers.map(u => u.id));
  const guardIds = new Set(world.guards.map(u => u.id)), beachIds = new Set(world.beachGuards.map(u => u.id));
  const initialBuildings = new Set(game.buildings.map(b => b.id)), initialUnits = new Set(game.units.map(u => u.id));
  const mainlandForce = new Set(world.army.map(u => u.id)), visitedIsland = new Set<string>();
  const first: Record<string, number> = {}, commands: PuzzleExecution['commands'] = [], losses: PuzzleExecution['losses'] = [];
  const workerSafety = options.workerSafety ? observePuzzleWorkerSafety(game, owner) : undefined;
  const mark = (key: string, condition: boolean, tick = game.tick) => { if (condition && first[key] === undefined) first[key] = tick - start; };
  const alive = (units: readonly Unit[]) => units.filter(u => u.hp > 0 && game.units.includes(u));
  const hallAt = (mine: { x: number; y: number }) => game.buildings.some(b => b.owner === owner && b.kind === 'townHall'
    && b.complete && b.hp > 0 && !initialBuildings.has(b.id) && Math.hypot(b.x - mine.x, b.y - mine.y) <= 300
    && sameGround(game.map, b, mine));
  const stop = observeSimulation(game, {
    damage(e) {
      if (e.source.owner !== owner) return;
      mark('target-attacked', guardIds.has(e.target.id), e.tick);
      mark('beach-attacked', beachIds.has(e.target.id), e.tick);
    },
    buildingDamage(e) { mark('home-hit', e.target.id === world.home.id && e.source.owner === world.opponent, e.tick); },
    removed(e) { losses.push({ tick: e.tick - start, kind: e.unit.kind, owner: e.unit.owner }); },
    command(e) { if (e.owner === owner) commands.push({ tick: e.tick - start, command: structuredClone(e.command) }); },
  });
  function sample() {
    workerSafety?.sample();
    const units = game.units.filter(u => u.owner === owner && u.hp > 0);
    for (const unit of units) if (unit.kind !== 'worker' && !UNIT_DEFS[unit.kind].naval && unit.attackDamage > 0
      && physicallyOnLand(world, unit, world.home)) mainlandForce.add(unit.id);
    const army = units.filter(u => mainlandForce.has(u.id));
    for (const unit of army) if (physicallyOnLand(world, unit, world.mine)) visitedIsland.add(unit.id);
    mark('transport-at-embark', !!world.transport && Math.hypot(world.transport.x - world.departure.x, world.transport.y - world.departure.y) < 256);
    mark('army-boarded', army.some(u => !!u.deck || !!u.cabin));
    mark('army-on-island', army.some(u => physicallyOnLand(world, u, world.mine)));
    mark('worker-on-island', units.some(u => workerIds.has(u.id) && physicallyOnLand(world, u, world.mine)));
    mark('camp-cleared', !alive(world.guards).length);
    mark('hall-complete', hallAt(world.mine));
    mark('beach-cleared', !!world.beachGuards.length && !alive(world.beachGuards).length);
    mark('defended', !!world.attackers.length && !alive(world.attackers).length);
    const backAtMine = (u: Unit) => physicallyOnLand(world, u, world.home) && Math.hypot(u.x - world.home.x, u.y - world.home.y) <= 450;
    mark('army-returned', puzzle.key === 'defense-window' && army.some(u => visitedIsland.has(u.id) && backAtMine(u)));
    const deployed = alive(world.army).filter(u => visitedIsland.has(u.id));
    mark('army-all-returned', puzzle.key === 'defense-window' && deployed.length > 0 && deployed.every(backAtMine));
    mark('local-cleared', !!world.localGuards.length && !alive(world.localGuards).length);
    mark('local-hall-complete', !!world.localMine && hallAt(world.localMine));
    mark('farm-complete', game.buildings.some(b => !initialBuildings.has(b.id) && b.owner === owner && b.kind === 'farm' && b.complete));
    mark('knight-trained', units.some(u => !initialUnits.has(u.id) && u.kind === 'knight'));
    mark('footmen-trained', units.filter(u => !initialUnits.has(u.id) && u.kind === 'footman').length >= 2);
    mark('shipyard-complete', game.buildings.some(b => b.owner === owner && b.kind === 'shipyard' && b.complete));
    mark('transport-trained', units.some(u => !initialUnits.has(u.id) && u.kind === 'transport'));
    const newHall = game.buildings.some(b => b.owner === owner && b.kind === 'townHall' && !initialBuildings.has(b.id));
    mark('hall-funding-spent-elsewhere', puzzle.key === 'navy-zero' && !newHall && game.players[owner]!.gold < BUILDING_DEFS.townHall.cost);
    mark('mainland-army-sent-to-island', puzzle.key === 'evacuate' && army.some(u => {
      if (physicallyOnLand(world, u, world.mine)) return true;
      const ship = u.deck && game.units.find(s => s.id === u.deck!.shipId);
      return !!ship && shipShorePoints(ship, game.map).some(p => sameGround(game.map, p, world.mine));
    }));
    mark('workers-rescued', world.islandWorkers.length > 0 && alive(world.islandWorkers).length === world.islandWorkers.length
      && world.islandWorkers.every(u => physicallyOnLand(world, u, world.home)));
    if (first['army-on-island'] !== undefined && first['landing-near'] === undefined && first['landing-far'] === undefined) {
      const landed = army.find(u => physicallyOnLand(world, u, world.mine));
      if (landed) mark(landed.y < 1400 ? 'landing-near' : 'landing-far', true);
    }
  }
  function finish(): PuzzleExecution {
    sample(); stop(); workerSafety?.dispose();
    const seen = (name: string) => first[name] !== undefined;
    const before = (a: string, b: string) => seen(a) && seen(b) && first[a]! <= first[b]!;
    const homeAlive = game.buildings.includes(world.home) && world.home.hp > 0;
    let checks: Record<string, boolean>;
    switch (puzzle.key) {
      case 'supply-tier': checks = { campCleared: seen('camp-cleared'), appropriateForce: puzzle.variant === 'knight'
        ? before('farm-complete', 'knight-trained') && before('knight-trained', 'camp-cleared')
        : before('footmen-trained', 'camp-cleared') && !seen('knight-trained') }; break;
      case 'defense-window': checks = { homeSurvived: homeAlive, defended: seen('defended'), islandHallComplete: seen('hall-complete'),
        priority: puzzle.variant === 'urgent' ? before('defended', 'army-boarded')
          : before('hall-complete', 'defended') && seen('army-returned') && first['army-returned']! < 360 * 20 }; break;
      case 'guarded-shore': checks = { campCleared: seen('camp-cleared'), armyLanded: seen('army-on-island'),
        suitableLanding: puzzle.variant === 'strong' ? seen('landing-near') && before('beach-cleared', 'camp-cleared')
          : seen('landing-far') && !seen('beach-attacked') }; break;
      case 'negative-return': checks = { localExpansion: seen('local-hall-complete') && seen('local-cleared'), rejectedBadIsland: !seen('target-attacked') && !seen('army-on-island') }; break;
      case 'evacuate': checks = { workersRescued: seen('workers-rescued'), noSuicideReinforcement: !seen('mainland-army-sent-to-island') }; break;
      default: checks = { islandHallComplete: seen('hall-complete'), campCleared: seen('camp-cleared'),
        armyTransported: before('army-boarded', 'army-on-island'),
        safeWorkerSequence: before('camp-cleared', 'worker-on-island') && before('worker-on-island', 'hall-complete') };
        if (puzzle.key === 'navy-zero') checks.hallFundingPreserved = !seen('hall-funding-spent-elsewhere');
    }
    const safety = workerSafety?.finish(), originalChecks = { ...checks };
    if (safety && 'safeWorkerSequence' in checks) {
      const { safeWorkerSequence: _sequence, ...remaining } = checks;
      checks = { ...remaining, noWorkerCampExposure: safety.exposedSamples === 0,
        noWorkerCampDamage: safety.campDamage.length === 0, workersSurvived: safety.workerDeaths.length === 0 };
    }
    const buildings: Record<string, number> = {};
    for (const b of game.buildings.filter(b => b.owner === owner && b.hp > 0)) buildings[b.kind] = (buildings[b.kind] ?? 0) + 1;
    return { passed: Object.values(checks).every(Boolean), checks, tick: game.tick - start, first, commands, losses,
      ...(safety ? { workerSafety: safety, originalChecks } : {}),
      final: { gold: game.players[owner]!.gold, homeAlive, armyAlive: alive(world.army).filter(u => armyIds.has(u.id)).length,
        workersRescued: alive(world.islandWorkers).filter(u => physicallyOnLand(world, u, world.home)).length,
        guardsAlive: alive(world.guards).length, localGuardsAlive: alive(world.localGuards).length, buildings } };
  }
  return { sample, sampleWorkerSafety() { workerSafety?.sample(); }, finish,
    dispose() { stop(); workerSafety?.dispose(); } };
}
