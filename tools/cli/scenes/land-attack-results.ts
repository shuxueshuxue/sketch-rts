import type { Scene } from '../drivers/browser';
import { pathToFileURL } from 'node:url';

/** A real room-AI/v9 match, independently run by the SDK and live room AIs.
 * Compare each photographed world, without altering units, resources or commands. */
export default async function(s: Scene) {
  const load = (path: string) => import(pathToFileURL(`${process.cwd()}/${path}`).href);
  const { createSubjectGauntletInput } = await load('src/ai/benchmark/subject-gauntlet.ts');
  const { roomGauntlet } = await load('src/ai/benchmark/room-gauntlet.ts');
  const { runGameLoop } = await load('src/sdk/game-runner.ts');
  const { navalObservedPlanner } = await load('src/ai/benchmark/naval-room-worker.ts');
  const { input } = createSubjectGauntletInput(roomGauntlet('v9_summoner', ['v9']), { seed: 'v5-final-1', mapCount: 20 });
  const match = input.evaluations[0].matches[2];
  // The actual browser seats use these public IDs; both planners still play the
  // entire match. The snapshot regression separately retains the original IDs.
  match.agents = { player: match.agents.v9_summoner, enemy: match.agents.p1 };
  const memories: any = {}, frames = new Map<number, any[]>(), shots = new Map<number, any>();
  const events: any[] = [], results: any[] = [];
  let firstWave: any;
  let photographed: any[] = [];
  const damage = new Map<string, { first: any; last: any }>();
  let prior = '', lastResult = '';
  const fingerprint = (world: any) => JSON.stringify({ tick: world.tick,
    units: world.units.map((u: any) => [u.id, u.kind, u.owner, u.x, u.y, u.hp]).sort(),
    buildings: world.buildings.map((b: any) => [b.id, b.owner, b.kind, b.x, b.y, b.hp, b.complete]).sort(),
    resources: world.resources.map((r: any) => [r.id, r.amount]).sort(),
    gold: Object.fromEntries(Object.entries(world.players).map(([id, p]: any) => [id, p.gold])) });
  const capture = (game: any, goal: any, name: string) => ({ tick: game.tick, name, goal: structuredClone(goal),
    world: fingerprint(game), task: structuredClone(memories.player.landAttack),
    result: structuredClone(memories.player.landAttackResult) });
  runGameLoop({ ...match, maxTicks: 18000, commandPlanner: navalObservedPlanner(memories) }, {
    onCommand(e: any) {
      if (!frames.has(e.tick)) frames.set(e.tick, []);
      frames.get(e.tick)!.push({ playerId: e.owner, command: structuredClone(e.command) });
    }, onStep({ game }: any) {
      const task = memories.player.landAttack;
      const key = JSON.stringify([task?.targetId, task?.paused, memories.player.v6?.general?.mode]);
      if (key !== prior) { events.push({ tick: game.tick, task: structuredClone(task), general: structuredClone(memories.player.v6?.general) }); prior = key; }
      const result = memories.player.landAttackResult;
      if (result && JSON.stringify(result) !== lastResult) { results.push({ ...result }); lastResult = JSON.stringify(result); }
      const goal = game.buildings.find((b: any) => b.id === task?.targetId);
      if (goal && !firstWave) firstWave = capture(game, goal, 'first-expansion-goal');
      if (goal && goal.hp < goal.maxHp && task.general.group.some((id: string) => game.units.some((unit: any) =>
        unit.id === id && Math.hypot(unit.x - goal.x, unit.y - goal.y) < 1000))) {
        const prior = damage.get(goal.id);
        if (!prior || prior.last.goal.hp !== goal.hp) {
          const frame = capture(game, goal, 'outpost-under-attack');
          damage.set(goal.id, { first: prior?.first ?? frame, last: frame });
        }
      }
      if (!photographed.length && result?.result === 'destroyed') {
        const hit = damage.get(result.targetId);
        s.must(hit, 'destroyed result has no preceding physical assault');
        photographed = [firstWave, hit!.first, { ...hit!.last, name: 'outpost-near-demolition' },
          capture(game, hit!.last.goal, 'outpost-demolished')];
      }
    },
  });
  s.must(results.some(result => result.result === 'destroyed'), 'real match did not demolish an enemy outpost');
  s.must(firstWave?.goal.id !== 'building-enemy-townhall', 'first wave bypassed the natural');
  for (const frame of photographed) shots.set(frame.tick, frame);
  const host = await s.page.evaluate(() => JSON.parse(localStorage.getItem('sketch-rts-user')!));
  const created: any = await s.api('/api/rooms', { host, mapId: 'ladder', layoutSeed: match.options.layout.seed,
    visibility: 'private', humanCount: 1, aiCount: 1,
    seatSetup: [{ controller: 'human', team: 'team-1', race: 'grove' }, { controller: 'ai', team: 'team-2', race: 'ember', aiVersion: 'v9_knight' }] });
  const roomId = created.id;
  await s.api(`/api/rooms/${roomId}/start`, { userId: host.id });
  await s.api(`/api/rooms/${roomId}/pause`, {});
  await s.api(`/api/rooms/${roomId}/reset`, { mapId: 'ladder', options: { ...match.options,
    players: ['player', 'enemy'], aiPlayers: ['player', 'enemy'],
    aiVersions: { player: 'v9_summoner', enemy: 'v9' }, teams: { player: match.agents.player.team, enemy: match.agents.enemy.team },
    races: { player: 'grove', enemy: 'ember' } } });
  const url = new URL(`?room=${roomId}`, s.page.url()).href;
  let current = 0;
  const proof: any[] = [];
  for (const target of [...shots.keys()].sort((a, b) => a - b)) {
    if (current < target) await s.api(`/api/rooms/${roomId}/tick`, { ticks: target - current }); current = target;
    const world: any = await s.api(`/api/rooms/${roomId}/snapshot`), expected = shots.get(target);
    s.must(fingerprint(world) === expected.world, `hosted world differs from the real match at tick ${target}`);
    await s.page.goto(url, { waitUntil: 'load' });
    await s.page.waitForFunction((tick: number) => ((window as any).__sketchRtsView?.tick ?? -1) >= tick, target, { timeout: 120000 });
    await s.page.waitForFunction(() => !!(window as any).__sketchRtsDebug?.ready(), null, { timeout: 120000 });
    await s.page.addStyleTag({ content: '[data-pointer-lock-gate]{display:none!important}' });
    const hall = expected.goal, goalId = hall.id;
    await s.camera(hall.x, hall.y, .62); await s.wait(1500);
    if (world.buildings.some((b: any) => b.id === goalId)) await s.select([goalId]);
    const name = `${expected.name}-tick-${target}`;
    await s.shot(name);
    const output = JSON.parse(process.argv[2]!).out;
    await s.page.screenshot({ path: `${output}/${name}.jpg`, type: 'jpeg', quality: 82 });
    proof.push({ tick: target, task: expected.task, result: expected.result,
      target: world.buildings.find((b: any) => b.id === goalId) ?? null, exactWorld: true });
  }
  s.record('land-attack-real-match', { seed: 'v5-final-1', slot: 'ladder-12',
    subject: 'v9_summoner grove', rival: 'v9 ember', owners: 'public browser seats player/enemy, both autonomous in the sim',
    method: 'SDK reference and live room AI run independently; each photographed world matches exactly', events, results, proof });
  s.record('land-attack-sdk-reference-commands', [...frames].map(([tick, commands]) => ({ tick, commands })));
}
