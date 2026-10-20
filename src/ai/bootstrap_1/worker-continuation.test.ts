import { expect, it } from 'vitest';
import { sketchScene } from '../../sdk/scene';
import { issuePlayerCommand, restoreSnapshotIntoGame, snapshotGame, stepGame } from '../../shared/sim';
import { setBuildingBodies } from '../../shared/terrain';
import { createAiPolicyMemory, type AiPolicyMemory } from '../memory';
import { planAiOwnerCommandEntries } from '../planner-context';
import { buildAiPlanTrace } from '../plan-trace';
import { miningJobSafety } from './mining-job-defense';
import { workerExposure } from '../situation/worker-exposure';
import { commandActors, recordWorkerCommandOverrides, workerOrderRoad } from '../policy/worker-continuation';

function scene() {
  const game = sketchScene('interrupted-construction').map('bareDuel').replaceDefaults()
    .player('us', { team: 'a' }).player('foe', { team: 'b' })
    .townHall('us', 500, 500).townHall('foe', 3500, 3500)
    .unit('us', 'worker', 1100, 1000, { id: 'builder' })
    .unit('foe', 'horseArcher', 1450, 1000, { id: 'raider' }).build().createGame();
  game.players.us!.gold = 2000;
  game.map.terrain = { cell: 32, cols: 128, rows: 128, cells: '.'.repeat(128 * 128) };
  setBuildingBodies(game.map, game.buildings);
  issuePlayerCommand(game, 'us', { type: 'build', unitId: 'builder', buildingKind: 'farm', x: 2208, y: 1024 });
  issuePlayerCommand(game, 'foe', { type: 'holdPosition', unitIds: ['raider'] });
  return game;
}
const think = (game: ReturnType<typeof scene>, memory: AiPolicyMemory) => planAiOwnerCommandEntries(snapshotGame(game),
  { playerId: 'us', version: 'v9_archer', memory, scripts: [miningJobSafety] }, { teams: game.teams });
const apply = (game: ReturnType<typeof scene>, entries: ReturnType<typeof think>) => {
  for (const entry of entries) issuePlayerCommand(game, entry.playerId, entry.command);
};

it('retains only an admitted interruption, then executes a tower-safe detour and acknowledges the native parent', () => {
  const game = scene(), memory = createAiPolicyMemory(), worker = game.units.find(unit => unit.id === 'builder')!;
  const first = think(game, memory);
  expect(first.some(entry => entry.command.type === 'move')).toBe(true);
  expect(memory.unitClaims.builder?.evacuation?.continuation?.parent).toMatchObject({type:'build',x:2208});
  expect(buildAiPlanTrace(snapshotGame(game), 'us', memory, 'v9_archer').workerContinuations).toContainEqual(expect.objectContaining({kind:'retain',threatIds:['raider']}));
  apply(game, first);
  for (let tick=0;tick<240;tick++) stepGame(game);
  // The original threat leaves. A tower still covers the direct construction road.
  game.units = game.units.filter(unit => unit.id !== 'raider');
  const towerScene = sketchScene('tower').map('bareDuel').replaceDefaults().player('foe').tower('foe', 1488, 1008, {id:'tower'}).build().createGame();
  game.buildings.push(towerScene.buildings[0]!); setBuildingBodies(game.map, game.buildings);
  let resumed = false, hurt = 0, detour = false;
  game.observer = { hit(_source,target,damage) { if(target.id==='builder')hurt+=damage; } };
  for (let tick=0; tick<1600; tick++) {
    if (tick%15===0) {
      const entries=think(game,memory); apply(game,entries);
      detour ||= entries.filter(entry=>entry.command.type==='move').length>1;
      const current=snapshotGame(game), road=workerOrderRoad(current,worker);
      if(memory.unitClaims.builder?.evacuation?.continuation?.phase==='resuming'&&road)
        expect(workerExposure(current,worker,road,{allowDeparture:true}),JSON.stringify(entries)).toEqual([]);
      if(worker.order.type==='build') { resumed=true; think(game,memory); break; }
    }
    stepGame(game);
  }
  expect(detour).toBe(true); expect(resumed).toBe(true); expect(hurt).toBe(0);
  expect(memory.unitClaims.builder?.evacuation?.continuation).toBeUndefined();
  expect(memory.workerContinuationEvents).toContainEqual(expect.objectContaining({kind:'end',reason:'native-parent-observed'}));
},30000);

it('keeps the vacancy beyond claim TTL, resumes when a target clears, and forks identically from serialized state', () => {
  const game=scene(),memory=createAiPolicyMemory();apply(game,think(game,memory));
  const worker=game.units.find(unit=>unit.id==='builder')!;
  // Shelter reached, target still covered: no countdown may discard the parent.
  Object.assign(worker,{x:600,y:500,order:{type:'idle'}});game.tick=5000;
  game.units.find(unit=>unit.id==='raider')!.x=2208;
  think(game,memory);
  expect(memory.unitClaims.builder?.evacuation?.continuation).toBeDefined();
  const restored=scene();restoreSnapshotIntoGame(restored,snapshotGame(game),game.nextId);
  const forkMemory=JSON.parse(JSON.stringify(memory)) as AiPolicyMemory;
  game.units=game.units.filter(unit=>unit.id!=='raider');restored.units=restored.units.filter(unit=>unit.id!=='raider');
  const a=think(game,memory),b=think(restored,forkMemory);
  expect(a).toEqual(b);expect(memory).toEqual(forkMemory);
  expect(a.some(entry=>entry.command.type==='build')).toBe(true);
});

it('never resurrects a parent after an external command identical to the evacuation order', () => {
  const game=scene(),memory=createAiPolicyMemory(),entries=think(game,memory);apply(game,entries);
  const move=entries.find(entry=>entry.command.type==='move')!.command;
  recordWorkerCommandOverrides(snapshotGame(game),memory,[move]);
  game.units=game.units.filter(unit=>unit.id!=='raider');
  expect(think(game,memory).filter(entry=>commandActors(entry.command).includes('builder'))).toEqual([]);
  expect(memory.workerContinuationEvents).toContainEqual(expect.objectContaining({kind:'end',reason:'external-order'}));
});

it('does not capture a queued future build', () => {
  const game=scene(),memory=createAiPolicyMemory(),worker=game.units.find(unit=>unit.id==='builder')!;
  const build=worker.order;worker.order={type:'idle'};worker.orderQueue=[build];
  think(game,memory);expect(memory.unitClaims.builder?.evacuation?.continuation).toBeUndefined();
});

it('does not bind a safety proposal overridden by a later effective command', async () => {
  const {planWorkerSafety,recordWorkerSafetyAcceptedCommands,finishWorkerSafetyPlans}=await import('./worker-safety');
  const game=scene(),snapshot=snapshotGame(game),memory=createAiPolicyMemory(),options={memory,version:'v9_archer' as const};
  const proposed=planWorkerSafety(snapshot,'us',options);
  recordWorkerSafetyAcceptedCommands(snapshot,'us',options,proposed);
  const other={type:'move' as const,unitIds:['builder'],x:3000,y:3000};
  finishWorkerSafetyPlans(snapshot,'us',options,[...proposed.map(command=>({scriptId:'miningJobSafety',command})),{scriptId:'commander',command:other}]);
  expect(memory.unitClaims.builder?.evacuation?.continuation).toBeUndefined();
  expect(memory.workerContinuationEvents?.some(event=>event.kind==='retain')).not.toBe(true);
});
