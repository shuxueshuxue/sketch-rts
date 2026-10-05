import { createGame, issuePlayerCommand, stepGame } from '../src/shared/sim';
import { UNIT_DEFS } from '../src/shared/catalog';
import type { UnitKind, ScenarioUnitSeed } from '../src/shared/types';
const kinds = (Object.keys(UNIT_DEFS) as UnitKind[]).filter(kind => UNIT_DEFS[kind].goldBounty);
for (const kind of kinds) {
    let minimum: number | null = null;
    for (let count = 1; count <= 16; count++) {
        let wins = 0;
        for (let side = 0; side < 3; side++) {
            const seed: ScenarioUnitSeed[] = [{ id: 'creep', owner: 'neutral', kind, x: 2000, y: 2000 }];
            for (let i = 0; i < count; i++) {
                const angle = side * Math.PI * 2 / 3;
                const x = 2000 - Math.cos(angle) * 450 + Math.sin(angle) * (i - (count - 1) / 2) * 52, y = 2000 - Math.sin(angle) * 450 - Math.cos(angle) * (i - (count - 1) / 2) * 52;
                seed.push({ id: `f${i}`, owner: 'p1', kind: i % 3 === 2 ? 'archer' : 'footman', x, y });
            }
            const game = createGame('bareDuel', { players: ['p1', 'p2'], scenario: { replaceDefaultUnits: true, replaceDefaultResources: true, replaceDefaultMercenaryCamps: true, addUnits: seed } });
            game.scriptedVictory = true;
            issuePlayerCommand(game, 'p1', { type: 'attack', unitIds: seed.slice(1).map(unit => unit.id), targetId: 'creep' });
            for (let t = 0; t < 1600 && game.units.some(unit => unit.owner === 'neutral') && game.units.some(unit => unit.owner === 'p1'); t++)
                stepGame(game);
            if (!game.units.some(unit => unit.owner === 'neutral'))
                wins++;
        }
        if (wins >= 2) {
            minimum = count;
            break;
        }
    }
    console.log(JSON.stringify({ kind, hp: UNIT_DEFS[kind].hp, damage: UNIT_DEFS[kind].attackDamage, dps: UNIT_DEFS[kind].attackDamage / (UNIT_DEFS[kind].attackCooldown / 20), minimumSquad: minimum }));
}
