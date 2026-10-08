import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { deepStrictEqual } from 'node:assert';
import { runAiGameLoop } from '../src/ai/game-runner';
import { checksumGame } from '../src/shared/sim/checksum';

const versions = ['v5', 'v7', 'v8'] as const;
const results = versions.flatMap((version, index) => (['grove', 'ember'] as const).map(race => {
  const commands = createHash('sha256');
  const loop = runAiGameLoop({
    name: `${version}-${race}`, mapId: 'ladder',
    options: { layout: { seed: 'bootstrap_1-frozen-trace', idea: 'openRing', kind: 'ring' } },
    agents: {
      p0: { version, race, team: 'a', controller: 'external-agent' },
      p1: { version: versions[(index + 1) % versions.length]!, race: race === 'grove' ? 'ember' : 'grove', team: 'b', controller: 'external-agent' },
    },
    maxTicks: 12000, thinkInterval: 15,
  }, { onCommand: event => commands.update(JSON.stringify({tick:event.tick, owner:event.owner, script:event.scriptId, command:event.command})) });
  const result = { version, race, tick: loop.game.tick, commands: commands.digest('hex'), state: checksumGame(loop.game), winner: loop.game.match.winner };
  console.log(JSON.stringify(result));
  return result;
}));
deepStrictEqual(results,JSON.parse(readFileSync('docs/engineering/bootstrap_1/frozen-traces.json','utf8')));
console.log('Frozen v5/v7/v8 command streams and final simulation digests unchanged.');
