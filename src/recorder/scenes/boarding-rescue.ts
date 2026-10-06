import { boardUnit, deckPlacement, syncDecks } from '../../shared/decks';
import { localToWorld } from '../../shared/ship-geometry';
import { createGame } from '../../shared/sim';
import { defineRecordingScene, timedCommands } from '../scene';
/** Ordinary walking across touching hulls rescues one vessel and captures another. */
export const boardingRescue = defineRecordingScene({
    name: 'boarding-rescue',
    description: 'A worker repairs a disabled neighboring hull while infantry boards and captures an empty enemy ship.',
    createGame() {
        const game = createGame('bareDuel', { players: ['player', 'enemy'], aiPlayers: [], scenario: { replaceDefaultUnits: true, replaceDefaultBuildings: true, replaceDefaultResources: true, replaceDefaultMercenaryCamps: true, replaceDefaultLandmarks: true } });
        game.scriptedVictory = true;
        game.map = { ...game.map, width: 2000, height: 1600, terrain: { cell: 40, cols: 50, rows: 40, cells: '~'.repeat(2000) } };
        game.players.player!.gold = 3000;
        const source = game.spawnUnit('player', 'transport', 940, 850), disabled = game.spawnUnit('player', 'transport', 940, 930), enemy = game.spawnUnit('enemy', 'transport', 940, 1010);
        for (const ship of [source, disabled, enemy])
            ship.order = { type: 'hold', x: ship.x, y: ship.y };
        for (const kind of ['worker', 'footman'] as const) {
            const unit = game.spawnUnit('player', kind, 940, 850);
            boardUnit(source, unit, game.units);
            unit.order = { type: 'hold', x: unit.x, y: unit.y };
        }
        disabled.shipParts!.rigging = 0;
        disabled.hp -= 30;
        syncDecks(game.units);
        return game;
    },
    commands: timedCommands([
        { at: .2, commands: game => [{ playerId: 'player', command: { type: 'repairShip', unitIds: [game.units.find(unit => unit.kind === 'worker')!.id], targetId: game.units.filter(unit => unit.kind === 'transport')[1]!.id } }] },
        { at: 2, commands: game => { const enemy = game.units.find(unit => unit.owner === 'enemy')!, soldier = game.units.find(unit => unit.kind === 'footman')!, at = deckPlacement(enemy, soldier, game.units, { x: 20, y: 0 })!; return [{ playerId: 'player', command: { type: 'move', unitIds: [soldier.id], ...localToWorld(enemy, at) } }]; } },
    ]),
    defaults: { seconds: 10, width: 960, height: 700, fps: 20, camera: { type: 'fixed', x: 940, y: 925, zoom: 1.8 } },
});
