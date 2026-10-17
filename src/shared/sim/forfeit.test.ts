import { describe, expect, it } from 'vitest';
import { isGameCommand } from '../command-schema';
import { createGame, issuePlayerCommand, stepGame } from '../sim';
import { checkCommandLegality } from './command-validation';

describe('a player conceding (@@@forfeit)', () => {
  it('ends a duel: all the conceding side owns falls and the other side wins', () => {
    const game = createGame('bareDuel', { aiPlayers: [] });
    expect(game.units.some(unit => unit.owner === 'player')).toBe(true);
    expect(checkCommandLegality(game, 'player', { type: 'forfeit' })).toBeUndefined();
    issuePlayerCommand(game, 'player', { type: 'forfeit' });
    stepGame(game);
    expect(game.units.filter(unit => unit.owner === 'player')).toEqual([]);
    expect(game.buildings.filter(building => building.owner === 'player')).toEqual([]);
    expect(game.match.winner).toBe('enemy');
  });

  it('leaves the others playing when more than two sides remain', () => {
    const game = createGame('ladder', { players: ['player', 'enemy', 'enemy2'], aiPlayers: [], teams: { player: 'north', enemy: 'south', enemy2: 'east' } });
    issuePlayerCommand(game, 'enemy2', { type: 'forfeit' });
    stepGame(game);
    expect(game.buildings.filter(building => building.owner === 'enemy2')).toEqual([]);
    expect(game.match.winner).toBeNull();
    expect(game.units.some(unit => unit.owner === 'player') && game.units.some(unit => unit.owner === 'enemy')).toBe(true);
  });

  it('is a well-formed command only as itself', () => {
    expect(isGameCommand({ type: 'forfeit' })).toBe(true);
    expect(isGameCommand({ type: 'forfeit', unitIds: [] })).toBe(false);
  });
});
