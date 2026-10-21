import type { SdkGameCommandPlanner } from '../../../sdk/game-runner';
import { requiredSupplyCap } from '../../../shared/catalog';
import { trainingJobs } from '../../../shared/building-jobs';
import { miningHallSite } from '../../../shared/mining-site';
import { checkCommandLegality } from '../../../shared/sim/command-validation';
import { seconds } from '../../../shared/time';
import type { GameCommand, Unit } from '../../../shared/types';
import type { PublicPuzzleCase } from './scenes';
import { legalBuildingSite, physicallyOnLand, type PuzzleWorld } from './world';

/** A test-only, authored legal solution. This proves feasibility, never planner quality. */
export function createPuzzleWitness(puzzle: PublicPuzzleCase, world: PuzzleWorld): SdkGameCommandPlanner {
  let stage = 'army-load';
  const sent = new Map<string, number>();
  const { game, owner } = world;
  const live = (units: readonly Unit[]) => units.filter(u => u.hp > 0 && game.units.includes(u));
  const aboard = (u: Unit) => !!u.deck || !!u.cabin;
  const pickup = puzzle.key === 'defense-window' ? { x: world.departure.x, y: 1600 } : { x: 1600, y: world.departure.y };
  return context => {
    if (context.owner !== owner) return [];
    const commands: GameCommand[] = [];
    const send = (tag: string, command: GameCommand, repeat = seconds(10)) => {
      if (game.tick - (sent.get(tag) ?? -Infinity) < repeat || checkCommandLegality(context.snapshot, owner, command)) return;
      sent.set(tag, game.tick); commands.push(command);
    };
    const attack = (troops: readonly Unit[], targets: readonly Unit[], tag: string) => {
      const enemy = live(targets)[0];
      if (enemy && troops.length) send(tag, { type: 'attack', unitIds: live(troops).map(u => u.id), targetId: enemy.id });
    };
    const ship = game.units.find(u => u.owner === owner && u.kind === 'transport' && u.hp > 0);
    const army = live(world.army), workers = live(world.workers).filter(u => !world.islandWorkers.includes(u));
    const expedition = puzzle.key === 'defense-window' ? [...army, ...workers.slice(0, 1)] : army;
    const moveShip = (tag: string, at: { x: number; y: number }) => {
      if (ship && Math.hypot(ship.x - at.x, ship.y - at.y) > 80) send(tag, { type: 'move', unitIds: [ship.id], ...at });
    };
    const load = (troops: Unit[], at: { x: number; y: number }, tag: string) => {
      if (!ship) return false;
      if (Math.hypot(ship.x - at.x, ship.y - at.y) > 300) moveShip(`${tag}-position`, at);
      if (Math.hypot(ship.x - at.x, ship.y - at.y) > 240) return false;
      const waiting = troops.filter(u => !aboard(u));
      if (waiting.length) {
        send(`${tag}-board`, { type: 'board', unitIds: waiting.map(u => u.id), transportId: ship.id }, seconds(15));
        // Native cabin admission frees real deck space; it does not change capacity.
        const deck = troops.filter(u => u.deck && !u.cabin);
        if (deck.length) send(`${tag}-cabin`, { type: 'enterCabin', unitIds: deck.map(u => u.id) }, seconds(2));
      }
      return troops.length > 0 && troops.every(aboard);
    };
    const unload = (troops: Unit[], at: { x: number; y: number }, tag: string) => {
      if (!ship) return false;
      const cabin = troops.filter(u => u.cabin);
      if (cabin.length) send(`${tag}-leave-cabin`, { type: 'leaveCabin', unitIds: cabin.map(u => u.id) }, seconds(2));
      if (troops.some(aboard)) send(tag, { type: 'unload', unitIds: [ship.id], ...at }, seconds(10));
      return troops.length > 0 && troops.every(u => physicallyOnLand(world, u, at));
    };
    const buildHall = (mine: { x: number; y: number }, worker: Unit | undefined) => {
      if (!worker) return;
      if (game.buildings.some(b => b.owner === owner && b.kind === 'townHall' && b.hp > 0 && Math.hypot(b.x - mine.x, b.y - mine.y) < 300)) return;
      const at = miningHallSite(context.snapshot, mine);
      if (at) send('hall', { type: 'build', unitId: worker.id, buildingKind: 'townHall', ...at }, seconds(20));
    };
    if (puzzle.key === 'supply-tier') {
      const kind = puzzle.variant === 'knight' ? 'knight' : 'footman', count = kind === 'knight' ? 1 : 2;
      const producer = game.buildings.find(b => b.owner === owner && b.kind === (kind === 'knight' ? 'stables' : 'barracks'))!;
      if (kind === 'knight' && game.players[owner]!.supplyCap < requiredSupplyCap(kind) && !game.buildings.some(b => b.owner === owner && b.kind === 'farm' && !b.complete)) {
        const at = legalBuildingSite(game, 'farm', { x: 416, y: 832 });
        send('farm', { type: 'build', unitId: workers[0]!.id, buildingKind: 'farm', ...at });
      }
      const troops = game.units.filter(u => u.owner === owner && u.kind === kind && u.hp > 0);
      if (troops.length + trainingJobs(producer).length < count) send('train', { type: 'train', buildingId: producer.id, unitKind: kind }, seconds(1));
      if (troops.length >= count) attack(troops, world.guards, 'clear');
    } else if (puzzle.key === 'negative-return') {
      if (live(world.localGuards).length) attack(army, world.localGuards, 'local');
      else buildHall(world.localMine!, workers[0]);
    } else if (puzzle.key === 'evacuate') {
      if (stage === 'army-load' && load(live(world.islandWorkers), { x: 2176, y: 768 }, 'rescue')) stage = 'rescue-cross';
      if (stage === 'rescue-cross') unload(live(world.islandWorkers), world.departure, 'rescue-unload');
    } else {
      if (puzzle.key === 'navy-zero' && !ship) {
        const yard = game.buildings.find(b => b.owner === owner && b.kind === 'shipyard');
        if (!yard) {
          const at = legalBuildingSite(game, 'shipyard', { x: 1536, y: 1280 });
          send('yard', { type: 'build', unitId: workers[0]!.id, buildingKind: 'shipyard', ...at });
        } else if (yard.complete && !trainingJobs(yard).length) send('hull', { type: 'train', buildingId: yard.id, unitKind: 'transport' });
      }
      const urgent = puzzle.key === 'defense-window' && puzzle.variant === 'urgent';
      if (urgent && live(world.attackers).length) {
        // Meet the attack at the mine, not halfway across the map.
        if (live(world.attackers).some(u => Math.hypot(u.x - world.home.x, u.y - world.home.y) < 450)) attack(army, world.attackers, 'defend');
      } else if (stage === 'army-load' && load(expedition, pickup, 'army')) stage = 'army-cross';
      if (stage === 'army-cross' && unload(expedition, world.landing, 'army-unload')) stage = 'clear';
      if (stage === 'clear') {
        const beach = puzzle.key === 'guarded-shore' && puzzle.variant === 'strong' && live(world.beachGuards).length;
        if (beach) attack(army, world.beachGuards, 'beach');
        else if (live(world.guards).length) attack(army, world.guards, 'camp');
        else stage = puzzle.key === 'defense-window' ? 'hall' : 'worker-load';
      }
      if (stage === 'worker-load' && load(workers.slice(0, 1), pickup, 'worker')) stage = 'worker-cross';
      if (stage === 'worker-cross' && unload(workers.slice(0, 1), world.landing, 'worker-unload')) stage = 'hall';
      if (stage === 'hall') {
        buildHall(world.mine, workers[0]);
        if (puzzle.key === 'defense-window' && puzzle.variant === 'later'
          && game.buildings.some(b => b.owner === owner && b.kind === 'townHall' && Math.hypot(b.x - world.mine.x, b.y - world.mine.y) < 300)) stage = 'return-load';
      }
      if (stage === 'return-load' && load(army, { x: world.landing.x, y: world.landing.y - 192 }, 'return')) stage = 'return-cross';
      if (stage === 'return-cross' && unload(army, world.departure, 'return-unload')) stage = 'defend';
      if (stage === 'defend') attack(army, world.attackers, 'late-defend');
    }
    return commands.map(command => ({ playerId: owner, source: context.source, scriptId: `puzzle-witness:${stage}`, command }));
  };
}
