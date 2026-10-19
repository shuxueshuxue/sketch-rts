import type { Scene } from '../drivers/browser';
import { pathToFileURL } from 'node:url';

/** A real room-AI/v9 match. Reapply its accepted commands to the hosted room and
 * compare the actual world at every photographed frame, without changing forces. */
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
  const targets = [9196, 15376, 16100, 16216];
  let prior = '', lastResult = '';
  const fingerprint = (world: any) => JSON.stringify({ tick: world.tick,
    units: world.units.map((u: any) => [u.id, u.kind, u.owner, u.x, u.y, u.hp]).sort(),
    buildings: world.buildings.map((b: any) => [b.id, b.owner, b.kind, b.x, b.y, b.hp, b.complete]).sort(),
    resources: world.resources.map((r: any) => [r.id, r.amount]).sort(),
    gold: Object.fromEntries(Object.entries(world.players).map(([id, p]: any) => [id, p.gold])) });
  runGameLoop({ ...match, maxTicks: targets.at(-1)!, commandPlanner: navalObservedPlanner(memories) }, {
    onCommand(e: any) {
      if (!frames.has(e.tick)) frames.set(e.tick, []);
      frames.get(e.tick)!.push({ playerId: e.owner, command: structuredClone(e.command) });
    }, onStep({ game }: any) {
      const task = memories.player.landAttack;
      const key = JSON.stringify([task?.targetId, task?.paused, memories.player.v6?.general?.mode]);
      if (key !== prior) { events.push({ tick: game.tick, task: structuredClone(task), general: structuredClone(memories.player.v6?.general) }); prior = key; }
      const result = memories.player.landAttackResult;
      if (result && JSON.stringify(result) !== lastResult) { results.push({ ...result }); lastResult = JSON.stringify(result); }
      if (targets.includes(game.tick)) shots.set(game.tick, { world: fingerprint(game), task: structuredClone(task),
        result: structuredClone(result), halls: structuredClone(game.buildings.filter((b: any) => b.kind === 'townHall')) });
    },
  });
  s.must(results.some(result => result.result === 'destroyed'), 'real match did not demolish an enemy outpost');
  s.must(events.find(event => event.task)?.task.targetId === 'building-enemy-townHall-1205', 'first wave bypassed the natural');
  const host = await s.page.evaluate(() => JSON.parse(localStorage.getItem('sketch-rts-user')!));
  const created: any = await s.api('/api/rooms', { host, mapId: 'ladder', layoutSeed: match.options.layout.seed,
    visibility: 'private', humanCount: 1, aiCount: 1,
    seatSetup: [{ controller: 'human', team: 'team-1', race: 'grove' }, { controller: 'ai', team: 'team-2', race: 'ember', aiVersion: 'v9_knight' }] });
  const roomId = created.id;
  await s.api(`/api/rooms/${roomId}/start`, { userId: host.id });
  await s.api(`/api/rooms/${roomId}/pause`, {});
  await s.api(`/api/rooms/${roomId}/reset`, { mapId: 'ladder', options: { ...match.options,
    players: ['player', 'enemy'], aiPlayers: [], teams: { player: match.agents.player.team, enemy: match.agents.enemy.team },
    races: { player: 'grove', enemy: 'ember' } } });
  const url = new URL(`?room=${roomId}`, s.page.url()).href;
  let current = 0;
  const proof: any[] = [];
  for (const target of targets) {
    for (const [tick, commands] of frames) {
      if (tick < current || tick >= target) continue;
      if (tick > current) await s.api(`/api/rooms/${roomId}/tick`, { ticks: tick - current });
      await s.api(`/api/rooms/${roomId}/command-tick`, { commands, ticks: 1 }); current = tick + 1;
    }
    if (current < target) await s.api(`/api/rooms/${roomId}/tick`, { ticks: target - current }); current = target;
    const world: any = await s.api(`/api/rooms/${roomId}/snapshot`), expected = shots.get(target);
    s.must(fingerprint(world) === expected.world, `hosted world differs from the real match at tick ${target}`);
    await s.page.goto(url, { waitUntil: 'load' });
    await s.page.waitForFunction((tick: number) => ((window as any).__sketchRtsView?.tick ?? -1) >= tick, target, { timeout: 120000 });
    await s.page.waitForFunction(() => !!(window as any).__sketchRtsDebug?.ready(), null, { timeout: 120000 });
    await s.page.addStyleTag({ content: '[data-pointer-lock-gate]{display:none!important}' });
    const goalId = target === targets[0] ? 'building-enemy-townHall-1205' : 'building-enemy-townHall-2965';
    const hall = expected.halls.find((b: any) => b.id === goalId)
      ?? shots.get(targets[1]).halls.find((b: any) => b.id === goalId);
    await s.camera(hall.x, hall.y, .62); await s.wait(1500);
    if (world.buildings.some((b: any) => b.id === goalId)) await s.select([goalId]);
    const name = `attack-result-tick-${target}`;
    await s.shot(name);
    const output = JSON.parse(process.argv[2]!).out;
    await s.page.screenshot({ path: `${output}/${name}.jpg`, type: 'jpeg', quality: 82 });
    proof.push({ tick: target, task: expected.task, result: expected.result,
      target: world.buildings.find((b: any) => b.id === goalId) ?? null, exactWorld: true });
  }
  s.record('land-attack-real-match', { seed: 'v5-final-1', slot: 'ladder-12',
    subject: 'v9_summoner grove', rival: 'v9 ember', owners: 'public browser seats player/enemy', events, results, proof });
  s.record('land-attack-command-replay', [...frames].map(([tick, commands]) => ({ tick, commands })));
}
